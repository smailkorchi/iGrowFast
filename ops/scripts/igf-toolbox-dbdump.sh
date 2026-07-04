#!/usr/bin/env bash
# igf-toolbox-dbdump.sh (TOOLBOX) — INDEPENDENT second producer of the full logical
# DB backup, so the logical backup never stops even if the box's ENTIRE backup
# subsystem breaks (timers dead, disk full, R2 token expired, script broken).
# Everything here is the toolbox's OWN: its timer, its SSH key, its R2 RW token,
# its staging disk. The only shared dependency is the box's DB container being up
# (if it's down there is nothing to back up). Runs 12h offset from the box's dump.
#   -> igf-db-backups/logical-toolbox/YYYY/MM/<stamp>/ (age-encrypted, own manifest)
# The box streams each artifact via a locked SSH forced-command (igf-remote-dump.sh).
set -euo pipefail
umask 077
JOB=toolbox-dbdump
BUCKET=igf-db-backups
STAGE_ROOT=/var/backups/igf
ENVF=/root/.config/igf-backup/r2-db-backups-tb.env    # toolbox RW + RO remotes + age recipient
BOX_SSH=(ssh -i /root/.ssh/igf-box-dump -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes igf-box-dump)
LOGDIR=/var/log/igf-backup; LOG="$LOGDIR/$JOB.log"; LOCK=/var/lock/igf-$JOB.lock
HEARTBEAT_MAXAGE=$((30*3600))

mkdir -p "$STAGE_ROOT" "$LOGDIR"
exec 9>"$LOCK"; if ! flock -n 9; then echo "$(date -uIs) another run in progress" >>"$LOG"; exit 0; fi
set -a; . "$ENVF"; set +a
export RCLONE_CONFIG=/dev/null

STAMP=$(date -u +%Y%m%dT%H%M%SZ); YM=$(date -u +%Y/%m)
WORK="$STAGE_ROOT/tb-$STAMP"; DEST="logical-toolbox/$YM/$STAMP"; mkdir -p "$WORK"

fail() {
  echo "$(date -uIs) FAIL: $1" >>"$LOG"
  find "$WORK" -type f \( -name '*.sql' -o -name '*.dump' \) -exec shred -u {} + 2>/dev/null || true
  printf 'TOOLBOX failover DB dump FAILED on %s\nStamp: %s\nError: %s\n\n%s\n' \
    "$(hostname)" "$STAMP" "$1" "$(tail -n 20 "$LOG" 2>/dev/null)" | igf-alert.sh "TOOLBOX failover dump FAILED" || true
  exit 1
}
trap 'fail "unexpected error near line $LINENO"' ERR
echo "$(date -uIs) === start $STAMP ===" >>"$LOG"; START=$(date -u +%s)

# 0. reach the box (forced-command SSH). If the box DB container is down, nothing to do.
"${BOX_SSH[@]}" ping >/dev/null 2>>"$LOG" || fail "cannot reach box via forced-command SSH"

# 1. pull each artifact over the locked channel
"${BOX_SSH[@]}" globals   > "$WORK/globals.sql"    2>>"$LOG"
"${BOX_SSH[@]}" postgres  > "$WORK/postgres.dump"  2>>"$LOG"
"${BOX_SSH[@]}" _supabase > "$WORK/_supabase.dump" 2>>"$LOG"

# 2. validate (toolbox has pg_restore? no — validate structurally: magic bytes + non-empty)
grep -q 'CREATE ROLE' "$WORK/globals.sql" || fail 'globals.sql missing CREATE ROLE'
for d in postgres _supabase; do
  head -c5 "$WORK/$d.dump" | grep -q 'PGDMP' || fail "$d.dump not a PGDMP archive"
  [ "$(stat -c%s "$WORK/$d.dump")" -gt 1000 ] || fail "$d.dump implausibly small"
done

# 3. row counts from the box (json), for the manifest drift signal
RC=$("${BOX_SSH[@]}" rowcounts 2>>"$LOG") || fail "rowcounts query failed"
ORD=$(printf '%s' "$RC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["orders"])')
USR=$(printf '%s' "$RC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["auth_users"])')
OIT=$(printf '%s' "$RC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["order_items"])')
SPY=$(printf '%s' "$RC" | python3 -c 'import json,sys;print(json.load(sys.stdin)["seller_payments"])')

# 4. hash + age-encrypt (same escrow recipient) + shred plaintext
declare -A PSHA ASHA SZ
for f in globals.sql postgres.dump _supabase.dump; do
  PSHA[$f]=$(sha256sum "$WORK/$f" | cut -d' ' -f1); SZ[$f]=$(stat -c%s "$WORK/$f")
  age -r "$IGF_AGE_RECIPIENT" -o "$WORK/$f.age" "$WORK/$f"
  ASHA[$f]=$(sha256sum "$WORK/$f.age" | cut -d' ' -f1); shred -u "$WORK/$f"
done
END=$(date -u +%s); DUR=$((END-START))

# 5. manifest (marked producer=toolbox so it's never confused with the box's set)
python3 - "$WORK/manifest.json" "$STAMP" "$(hostname)" "$DUR" "$ORD" "$USR" "$OIT" "$SPY" \
  "${PSHA[globals.sql]}" "${SZ[globals.sql]}" "${ASHA[globals.sql]}" \
  "${PSHA[postgres.dump]}" "${SZ[postgres.dump]}" "${ASHA[postgres.dump]}" \
  "${PSHA[_supabase.dump]}" "${SZ[_supabase.dump]}" "${ASHA[_supabase.dump]}" <<'PY'
import json, sys
o, stamp, host, dur, ordc, usr, oit, spy = sys.argv[1:9]
g_p,g_sz,g_a,p_p,p_sz,p_a,s_p,s_sz,s_a = sys.argv[9:18]
def f(n,ps,sz,a): return {"name":n,"plaintext_sha256":ps,"plaintext_bytes":int(sz),"encrypted":n+".age","encrypted_sha256":a}
json.dump({"stamp":stamp,"host":host,"producer":"toolbox-failover","duration_sec":int(dur),
  "engine":"pg_dump -Fc / pg_dumpall (remote via forced-command SSH from toolbox)",
  "row_counts":{"orders":int(ordc),"auth_users":int(usr),"order_items":int(oit),"seller_payments":int(spy)},
  "files":[f("globals.sql",g_p,g_sz,g_a),f("postgres.dump",p_p,p_sz,p_a),f("_supabase.dump",s_p,s_sz,s_a)],
  "vault_note":"Vault decryption requires pgsodium_root.key + VAULT_ENC_KEY from igf-config-backups/escrow — NOT in this dump."
}, open(o,"w"), indent=2)
PY

# 6. upload with the TOOLBOX's own RW token, then download-back verify with RO
rclone copy "$WORK/" "r2tbdb:$BUCKET/$DEST/" --include '*.age' --include 'manifest.json' --retries 5 2>>"$LOG"
for f in globals.sql postgres.dump _supabase.dump; do
  dl=$(rclone cat "r2tbdbro:$BUCKET/$DEST/$f.age" 2>>"$LOG" | sha256sum | cut -d' ' -f1)
  [ "$dl" = "${ASHA[$f]}" ] || fail "download-back sha mismatch $f.age"
done

# 7. prune local staging to last 3 toolbox sets
ls -1dt "$STAGE_ROOT"/tb-*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
igf-heartbeat.sh "$JOB" "$HEARTBEAT_MAXAGE"
echo "$(date -uIs) OK $STAMP dur=${DUR}s orders=$ORD → r2:$BUCKET/$DEST" >>"$LOG"
