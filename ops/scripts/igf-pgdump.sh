#!/usr/bin/env bash
# igf-pgdump.sh — nightly logical backup of the self-hosted Supabase DB → R2 igf-db-backups/logical/.
#
# pg_dumpall --globals-only + pg_dump -Fc (postgres, _supabase) as supabase_admin over the
# container's local-trust socket → validate → manifest (row counts + sha256) → age-encrypt
# (plaintext shredded) → rclone upload → download-back verify with the RO token → heartbeat.
# Any failure alerts via igf-alert.sh. Success is silent (heartbeat + watchdog cover "did not run").
#
# NOTE: this backup alone cannot decrypt Vault on restore — pgsodium_root.key + VAULT_ENC_KEY are
# escrowed separately (igf-config-backups/escrow). See RESTORE_RUNBOOK.md next to the dumps.
set -euo pipefail
umask 077

JOB=pgdump
CONT=supabase-db
BUCKET=igf-db-backups
STAGE_ROOT=/var/backups/igf
ENVF=/root/.config/igf-backup/r2-db-backups.env
LOGDIR=/var/log/igf-backup
LOG="$LOGDIR/$JOB.log"
LOCK=/var/lock/igf-$JOB.lock
HEARTBEAT_MAXAGE=$((26*3600))   # nightly cadence; watchdog adds its own grace

mkdir -p "$STAGE_ROOT" "$LOGDIR"
exec 9>"$LOCK"
if ! flock -n 9; then echo "$(date -uIs) another run in progress; abort" >>"$LOG"; exit 0; fi

# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
export RCLONE_CONFIG=/dev/null

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
YM=$(date -u +%Y/%m)
WORK="$STAGE_ROOT/$STAMP"
DEST="logical/$YM/$STAMP"
mkdir -p "$WORK"

fail() {
  local msg="$1"
  echo "$(date -uIs) FAIL: $msg" >>"$LOG"
  # never leave plaintext dumps on disk after a failure
  find "$WORK" -type f \( -name '*.sql' -o -name '*.dump' \) -exec shred -u {} + 2>/dev/null || true
  printf 'Logical DB backup FAILED on %s\nWhen: %s\nStamp: %s\nError: %s\n\nLast log lines:\n%s\n' \
    "$(hostname)" "$(date -uIs)" "$STAMP" "$msg" "$(tail -n 20 "$LOG" 2>/dev/null)" \
    | igf-alert.sh "DB logical backup FAILED" || true
  exit 1
}
trap 'fail "unexpected error near line $LINENO"' ERR

echo "$(date -uIs) === start $STAMP ===" >>"$LOG"
START=$(date -u +%s)

# 1. dumps
docker exec "$CONT" sh -c 'pg_dumpall -U supabase_admin --globals-only' > "$WORK/globals.sql" 2>>"$LOG"
docker exec "$CONT" sh -c 'pg_dump -U supabase_admin -Fc -d postgres' > "$WORK/postgres.dump" 2>>"$LOG"
docker exec "$CONT" sh -c 'pg_dump -U supabase_admin -Fc -d _supabase' > "$WORK/_supabase.dump" 2>>"$LOG"

# 2. validate structure
grep -q 'CREATE ROLE' "$WORK/globals.sql" || fail 'globals.sql missing CREATE ROLE'
for d in postgres _supabase; do
  head -c5 "$WORK/$d.dump" | grep -q 'PGDMP' || fail "$d.dump not a PGDMP archive"
  docker exec -i "$CONT" pg_restore --list < "$WORK/$d.dump" >/dev/null 2>>"$LOG" || fail "$d.dump pg_restore --list failed"
done

# 3. row counts (for the manifest — drift signal on restore)
q() { docker exec "$CONT" psql -U supabase_admin -d postgres -tA -c "$1"; }
ORD=$(q 'select count(*) from public.orders')
USR=$(q 'select count(*) from auth.users')
OIT=$(q 'select count(*) from public.order_items')
SPY=$(q 'select count(*) from public.seller_payments')

# 4. hash plaintext, encrypt to escrow age key, shred plaintext
declare -A PSHA ASHA SZ
for f in globals.sql postgres.dump _supabase.dump; do
  PSHA[$f]=$(sha256sum "$WORK/$f" | cut -d' ' -f1)
  SZ[$f]=$(stat -c%s "$WORK/$f")
  age -r "$IGF_AGE_RECIPIENT" -o "$WORK/$f.age" "$WORK/$f"
  ASHA[$f]=$(sha256sum "$WORK/$f.age" | cut -d' ' -f1)
  shred -u "$WORK/$f"
done

END=$(date -u +%s); DUR=$((END-START))

# 5. manifest.json (safe to store unencrypted: counts + hashes only)
python3 - "$WORK/manifest.json" "$STAMP" "$(hostname)" "$DUR" "$ORD" "$USR" "$OIT" "$SPY" \
  "${PSHA[globals.sql]}" "${SZ[globals.sql]}" "${ASHA[globals.sql]}" \
  "${PSHA[postgres.dump]}" "${SZ[postgres.dump]}" "${ASHA[postgres.dump]}" \
  "${PSHA[_supabase.dump]}" "${SZ[_supabase.dump]}" "${ASHA[_supabase.dump]}" <<'PY'
import json, sys
o, stamp, host, dur, ordc, usr, oit, spy = sys.argv[1:9]
g_p, g_sz, g_a, p_p, p_sz, p_a, s_p, s_sz, s_a = sys.argv[9:18]
def f(name, psha, sz, asha):
    return {"name": name, "plaintext_sha256": psha, "plaintext_bytes": int(sz),
            "encrypted": name + ".age", "encrypted_sha256": asha}
json.dump({
  "stamp": stamp, "host": host, "duration_sec": int(dur),
  "engine": "pg_dump -Fc / pg_dumpall --globals-only (supabase_admin)",
  "row_counts": {"orders": int(ordc), "auth_users": int(usr),
                 "order_items": int(oit), "seller_payments": int(spy)},
  "files": [f("globals.sql", g_p, g_sz, g_a),
            f("postgres.dump", p_p, p_sz, p_a),
            f("_supabase.dump", s_p, s_sz, s_a)],
  "vault_note": "Vault decryption requires pgsodium_root.key + VAULT_ENC_KEY from igf-config-backups/escrow — NOT in this dump."
}, open(o, "w"), indent=2)
PY

# 6. upload (.age + manifest)
rclone copy "$WORK/" "r2db:$BUCKET/$DEST/" --include '*.age' --include 'manifest.json' \
  --s3-upload-cutoff 200M --retries 5 --low-level-retries 10 2>>"$LOG"

# 7. download-back verify with the READ-ONLY token (proves R2 copy intact + RO path works)
for f in globals.sql postgres.dump _supabase.dump; do
  dl=$(rclone cat "r2dbro:$BUCKET/$DEST/$f.age" 2>>"$LOG" | sha256sum | cut -d' ' -f1)
  [ "$dl" = "${ASHA[$f]}" ] || fail "download-back sha mismatch for $f.age (local ${ASHA[$f]} vs r2 $dl)"
done

# 8. prune local staging to last 3 sets (warm local copies; R2 is the retained store)
ls -1dt "$STAGE_ROOT"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

# 9. heartbeat (success is otherwise silent)
igf-heartbeat.sh "$JOB" "$HEARTBEAT_MAXAGE"

echo "$(date -uIs) OK $STAMP dur=${DUR}s orders=$ORD users=$USR → r2:$BUCKET/$DEST" >>"$LOG"
