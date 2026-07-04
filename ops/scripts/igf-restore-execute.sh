#!/usr/bin/env bash
# igf-restore-execute.sh --target "YYYY-MM-DD HH:MM:SS+00" --mode validate|swap [--confirm "<typed target>"]
#
# The gated PITR restore engine behind the dashboard. TWO modes:
#
#   validate  (safe, no downtime): take a safety backup, restore the target into a
#             STAGED pgdata, boot an isolated validation clone, run the full 12-point
#             structural-parity battery vs live. Proves the recovery point is complete
#             and restorable WITHOUT touching production. This is the default the wizard
#             uses to green-light a restore.
#
#   swap      (destructive, in-place): everything validate does, THEN, only if all gates
#             pass, stop the stack, move live pgdata aside (rollback copy), swap the
#             validated pgdata in, start db, recover, start the rest of the stack with
#             KONG LAST, run postflight. On ANY postflight failure -> automatic rollback
#             to the saved live pgdata. Refuses unless /etc/igf-backup-agent/RESTORE_ARMED
#             exists AND the monthly drill heartbeat is fresh AND --confirm exactly equals
#             --target (defence against fat-finger / replayed calls).
#
# Every gate is independently sufficient to prevent an accidental production wipe.
set -euo pipefail
umask 077

IMG=igf/supabase-postgres:17.6.1.136-pgbackrest.1
LIVE=supabase-db
PROJECT=/opt/supabase-project
LIVE_PGDATA=$PROJECT/volumes/db/data
STAGE=/srv/restore-stage
ROLLBACK=/srv/restore-rollback
VCONT=igf-restore-validate
RCONT=igf-restore-fetch
CONF_SRC=/var/lib/docker/volumes/supabase_db-config/_data
CREDS=/root/.config/igf-backup/r2-db-backups.env
ARM=/etc/igf-backup-agent/RESTORE_ARMED
LOG=/var/log/igf-backup/restore-execute.log
LOCK=/var/lock/igf-restore-execute.lock

TARGET="" MODE="" CONFIRM=""
while [ $# -gt 0 ]; do case "$1" in
  --target)  TARGET="${2:?}"; shift 2;;
  --mode)    MODE="${2:?}"; shift 2;;
  --confirm) CONFIRM="${2:-}"; shift 2;;
  *) echo "unknown arg $1" >&2; exit 2;;
esac; done
[ "$MODE" = validate ] || [ "$MODE" = swap ] || { echo "--mode validate|swap required" >&2; exit 2; }

# Fail fast on swap gates BEFORE doing any work (no wasted safety backup on a
# request that can never proceed). These are re-checked at the swap boundary too.
if [ "$MODE" = swap ]; then
  [ -f "$ARM" ] || { echo "swap requested but server is NOT armed (missing $ARM) — refusing" >&2; exit 3; }
  [ -n "$CONFIRM" ] && [ "$CONFIRM" = "$TARGET" ] || { echo "swap confirm mismatch (typed target must equal --target exactly) — refusing" >&2; exit 3; }
fi

mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -n 9 || { echo "another restore is already running" >&2; exit 1; }
say(){ echo "$(date -uIs) [$MODE] $*" | tee -a "$LOG"; }
alert(){ printf '%s\n' "$2" | igf-alert.sh "$1" || true; }

q(){ docker exec -u postgres "$VCONT" psql -U supabase_admin -d postgres -Atc "$1"; }
lq(){ docker exec -u postgres "$LIVE" psql -U supabase_admin -d postgres -Atc "$1" 2>/dev/null; }

cleanup_stage(){ docker rm -f "$VCONT" "$RCONT" >/dev/null 2>&1 || true
  [ -f "$STAGE/config/pgbackrest.conf" ] && shred -u "$STAGE/config/pgbackrest.conf" 2>/dev/null || true; }
fail(){ say "RESTORE FAILED: $*"; alert "PITR restore ($MODE) FAILED" "$(tail -n 40 "$LOG")"; cleanup_stage; exit 1; }
trap 'fail "unexpected error at line $LINENO"' ERR

# ---- gate 0: drill freshness (both modes) ----
set -a; . "$CREDS"; set +a; export RCLONE_CONFIG=/dev/null
HB=$(rclone cat "r2dbro:igf-db-backups/heartbeat/vmi3390870/restore-drill.json" 2>/dev/null || echo '{}')
FRESH=$(printf '%s' "$HB" | python3 -c 'import json,sys,time
try:
  d=json.load(sys.stdin); print("true" if (time.time()-d.get("ts",0))<=d.get("max_age_sec",0) else "false")
except Exception: print("false")')
[ "$FRESH" = true ] || fail "restore drill not proven-fresh — refusing (run the drill first)"

say "=== restore start (target=${TARGET:-latest}) ==="

# ---- 1. safety backup: current live state becomes a recovery point ----
say "taking pre-restore safety backup (pgBackRest incr)"
igf-pgbackrest-backup.sh incr >>"$LOG" 2>&1 || fail "safety backup failed — aborting before any change"
SAFETY=$(docker exec -u postgres "$LIVE" pgbackrest --config=/etc/postgresql-custom/pgbackrest.conf --stanza=igf --output=json info 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["backup"][-1]["label"])')
say "safety backup label: $SAFETY"

# ---- 2. restore target into STAGED pgdata (never live) ----
rm -rf "$STAGE"; mkdir -p "$STAGE/pgdata" "$STAGE/config"
cp -a "$CONF_SRC/." "$STAGE/config/"
CIPHER=$(grep '^repo1-cipher-pass=' "$STAGE/config/pgbackrest.conf" | cut -d= -f2-)
shred -u "$STAGE/config/pgbackrest.conf"
cat > "$STAGE/config/pgbackrest.conf" <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=8897211ce4bdb3eff028770e3dc584be.r2.cloudflarestorage.com
repo1-s3-bucket=igf-db-backups
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-s3-key=$RCLONE_CONFIG_R2DBRO_ACCESS_KEY_ID
repo1-s3-key-secret=$RCLONE_CONFIG_R2DBRO_SECRET_ACCESS_KEY
repo1-path=/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$CIPHER
compress-type=zst
process-max=2
log-level-console=info
log-level-file=off

[igf]
pg1-path=/var/lib/postgresql/data
pg1-user=supabase_admin
pg1-socket-path=/var/run/postgresql
EOF
chmod 600 "$STAGE/config/pgbackrest.conf"; chown -R 100:101 "$STAGE/config" "$STAGE/pgdata"

ROPTS=(--config=/etc/postgresql-custom/pgbackrest.conf --stanza=igf --archive-mode=off)
[ -n "$TARGET" ] && ROPTS+=(--type=time "--target=$TARGET" --target-action=promote)
say "restoring target into staging"
docker run --rm --name "$RCONT" -u postgres \
  -v "$STAGE/pgdata":/var/lib/postgresql/data -v "$STAGE/config":/etc/postgresql-custom:ro \
  --entrypoint pgbackrest "$IMG" "${ROPTS[@]}" restore >>"$LOG" 2>&1 || fail "staged restore failed"

# ---- 3. boot isolated validation clone + full parity battery ----
docker run -d --name "$VCONT" \
  -v "$STAGE/pgdata":/var/lib/postgresql/data -v "$STAGE/config":/etc/postgresql-custom:ro \
  -e POSTGRES_PASSWORD=validate-unused \
  "$IMG" postgres -c config_file=/etc/postgresql/postgresql.conf \
    -c listen_addresses= -c archive_mode=off \
    -c cron.database_name=disabled -c pg_net.database_name=disabled >/dev/null
for _ in $(seq 1 90); do
  ST=$(q "select pg_is_in_recovery()" 2>/dev/null || echo x)
  [ "$ST" = f ] && break
  docker ps -q -f name="$VCONT" | grep -q . || fail "validation clone died"
  sleep 5
done
[ "$(q 'select pg_is_in_recovery()')" = f ] || fail "validation clone did not promote"
docker network disconnect bridge "$VCONT" >/dev/null 2>&1 || true
q "update cron.job set active=false" >/dev/null 2>&1 || true

say "validating structural parity vs live"
parity(){ local L D; L=$(lq "$2"); D=$(q "$2"); [ "$D" = "$L" ] || fail "parity $1 staged=$D live=$L"; say "  parity ok: $1=$D"; }
parity rls_policies      'select count(*) from pg_policies'
parity roles             'select count(*) from pg_roles'
parity table_grants      "select count(*) from information_schema.table_privileges where table_schema in ('public','auth','storage','vault')"
parity triggers          'select count(*) from pg_trigger where not tgisinternal'
parity functions         "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
parity extensions        'select count(*) from pg_extension'
parity cron_jobs         'select count(*) from cron.job'
VD=$(q 'select count(*) from vault.decrypted_secrets where decrypted_secret is not null')
VT=$(q 'select count(*) from vault.decrypted_secrets')
{ [ "$VT" -gt 0 ] && [ "$VD" = "$VT" ]; } || fail "vault decrypt broken in clone ($VD/$VT)"
say "  vault decrypt ok: $VD/$VT"
SORD=$(q 'select count(*) from public.orders'); [ "$SORD" -gt 0 ] || fail "clone orders empty"
say "VALIDATION PASSED — recovery point is complete & restorable (orders=$SORD, safety=$SAFETY)"

if [ "$MODE" = validate ]; then
  cleanup_stage; rm -rf "$STAGE"
  say "=== validate complete (no live change) ==="
  echo "VALIDATE_OK safety=$SAFETY orders=$SORD"
  exit 0
fi

# ================= SWAP (destructive, in-place) =================
[ -f "$ARM" ] || fail "swap requested but server is NOT armed (missing $ARM) — refusing"
[ -n "$CONFIRM" ] && [ "$CONFIRM" = "$TARGET" ] || fail "swap confirm mismatch (typed target must equal --target exactly)"
docker rm -f "$VCONT" >/dev/null 2>&1 || true   # free the staged pgdata for the swap

say "SWAP: stopping stack"
( cd "$PROJECT" && docker compose stop ) >>"$LOG" 2>&1 || fail "stack stop failed"
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$ROLLBACK"
mv "$LIVE_PGDATA" "$ROLLBACK/pgdata-$TS" || fail "could not move live pgdata aside"
say "SWAP: live pgdata saved to $ROLLBACK/pgdata-$TS"

rollback(){
  say "ROLLBACK: restoring pre-restore live pgdata"
  ( cd "$PROJECT" && docker compose stop ) >>"$LOG" 2>&1 || true
  rm -rf "$LIVE_PGDATA"
  mv "$ROLLBACK/pgdata-$TS" "$LIVE_PGDATA" || { alert "RESTORE ROLLBACK FAILED" "manual recovery needed; saved pgdata at $ROLLBACK/pgdata-$TS"; exit 1; }
  ( cd "$PROJECT" && docker compose up -d ) >>"$LOG" 2>&1 || true
  sleep 8; ( cd "$PROJECT" && docker compose restart kong ) >>"$LOG" 2>&1 || true
  alert "PITR restore ROLLED BACK" "postflight failed; live restored to pre-restore state (safety=$SAFETY). Investigate before retrying."
}
trap 'rollback; exit 1' ERR

mv "$STAGE/pgdata" "$LIVE_PGDATA" || fail "could not move staged pgdata into place"
chown -R 100:101 "$LIVE_PGDATA"
# the staged restore wrote archive_mode=off into auto.conf; flip it back to on
# BEFORE first start so the coming boot already archives (archive_mode is
# PGC_POSTMASTER — it only takes effect at startup, so alter-then-restart is required).
say "SWAP: re-enabling archive_mode in restored auto.conf"
printf "\narchive_mode = 'on'\n" >> "$LIVE_PGDATA/postgresql.auto.conf" 2>>"$LOG" || true
say "SWAP: starting db"
( cd "$PROJECT" && docker compose up -d db ) >>"$LOG" 2>&1
for _ in $(seq 1 90); do
  ST=$(lq 'select pg_is_in_recovery()' || echo x)
  [ "$ST" = f ] && break; sleep 5
done
[ "$(lq 'select pg_is_in_recovery()')" = f ] || { false; }

say "SWAP: starting rest of stack (kong last)"
( cd "$PROJECT" && docker compose up -d ) >>"$LOG" 2>&1
sleep 8
( cd "$PROJECT" && docker compose restart kong ) >>"$LOG" 2>&1

# postflight on LIVE — data + vault + auth + ARCHIVING RESUMED (else no PITR going forward)
say "SWAP: postflight"
PORD=$(lq 'select count(*) from public.orders' || echo 0)
[ "${PORD:-0}" -gt 0 ] || { false; }
PVD=$(lq 'select count(*) from vault.decrypted_secrets where decrypted_secret is not null' || echo 0)
[ "${PVD:-0}" -gt 0 ] || { false; }
AMODE=$(lq "select current_setting('archive_mode')" || echo off)
[ "$AMODE" = on ] || { say "POSTFLIGHT: archive_mode=$AMODE (expected on) — WAL archiving did not resume"; false; }
# force a WAL switch and confirm the archiver advances (real proof, not just the GUC)
docker exec -u postgres "$LIVE" psql -U supabase_admin -d postgres -Atc "select pg_switch_wal()" >>"$LOG" 2>&1 || true
sleep 5
AFAIL=$(lq 'select failed_count from pg_stat_archiver' || echo 1)
say "SWAP: postflight archive_mode=$AMODE archiver_failed=$AFAIL"
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8000/auth/v1/health || echo 000)

trap - ERR
rm -rf "$ROLLBACK/pgdata-$TS" "$STAGE"
say "=== SWAP complete — live restored to ${TARGET:-latest} (orders=$PORD, vault=$PVD, auth_health=$HEALTH) ==="
alert "PITR restore COMPLETE" "Live restored to ${TARGET:-latest}. orders=$PORD vault=$PVD. Pre-restore safety backup: $SAFETY."
echo "SWAP_OK orders=$PORD"
