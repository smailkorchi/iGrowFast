#!/usr/bin/env bash
# igf-restore-drill.sh [--target "YYYY-MM-DD HH:MM:SS+00"] [--keep]
# PITR restore drill: restores the live pgBackRest repo from R2 (READ-ONLY token)
# into a throwaway container, proves the clone (promotion, roles, vault decryption,
# row counts vs live), then destroys everything. Touches NOTHING live.
#
# Safety properties (each independently sufficient to protect prod):
#   - plain `docker run`, never compose            -> cannot recreate/affect live services
#   - RO R2 token (r2dbro creds)                   -> repo physically unwritable
#   - restore --archive-mode=off + cmdline -c      -> clone never pushes WAL
#   - COPY of db-config volume, mounted ro         -> live config untouchable
#   - listen_addresses='' (unix socket only)       -> no TCP, nothing can connect
#   - cron/pg_net database_name -> nonexistent db  -> background workers inert
#   - network disconnect right after promote       -> no outbound (courier/email APIs)
#
# --target: prove point-in-time recovery to a timestamp instead of end-of-WAL.
# --keep:   skip teardown for manual inspection (tear down yourself after).
set -euo pipefail
umask 077

IMG=igf/supabase-postgres:17.6.1.136-pgbackrest.1
LIVE=supabase-db
CONT=igf-restore-drill
RCONT=igf-drill-restore
D=/srv/restore-drill
LOG=/var/log/igf-backup/restore-drill.log
LOCK=/var/lock/igf-restore-drill.lock
CREDS=/root/.config/igf-backup/r2-db-backups.env
CONFVOL=/var/lib/docker/volumes/supabase_db-config/_data

TARGET=""; KEEP=0
while [ $# -gt 0 ]; do case "$1" in
  --target) TARGET="${2:?--target needs a timestamp}"; shift 2;;
  --keep)   KEEP=1; shift;;
  *) echo "usage: $0 [--target 'YYYY-MM-DD HH:MM:SS+00'] [--keep]" >&2; exit 2;;
esac; done

mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -n 9 || { echo "another drill is already running" >&2; exit 1; }
say(){ echo "$(date -uIs) $*" | tee -a "$LOG"; }

# stay clear of the backup job window (pgdump 01:10, pgbackrest 01:45, restic 03:35 …)
H=$(date -u +%H)
if [ "$H" -ge 1 ] && [ "$H" -lt 6 ] && [ "${IGF_DRILL_FORCE:-0}" != 1 ]; then
  say "refusing to run inside the 01:00-06:00 UTC job window (IGF_DRILL_FORCE=1 to override)"; exit 1
fi

teardown(){
  if [ "$KEEP" = 1 ]; then say "--keep: leaving container + workspace for inspection"; return 0; fi
  docker rm -f "$CONT" "$RCONT" >/dev/null 2>&1 || true
  [ -f "$D/config/pgbackrest.conf" ] && shred -u "$D/config/pgbackrest.conf" 2>/dev/null || true
  rm -rf "$D"
}
fail(){
  say "DRILL FAILED: $*"
  printf 'PITR restore drill FAILED on %s\n\nReason: %s\n\nLast log:\n%s\n' \
    "$(hostname)" "$*" "$(tail -n 30 "$LOG")" | igf-alert.sh "PITR restore drill FAILED" || true
  KEEP=0 teardown
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

T0=$(date -u +%s)
say "=== restore drill start (mode: ${TARGET:+target=$TARGET}${TARGET:-latest}) ==="
docker image inspect "$IMG" >/dev/null || fail "image $IMG not present"
docker ps -a --format '{{.Names}}' | grep -qx "$CONT" && fail "$CONT already exists — previous drill not torn down"

# --- workspace: copy of config volume + drill-only pgbackrest.conf (RO token) ---
set -a; . "$CREDS"; set +a
: "${RCLONE_CONFIG_R2DBRO_ACCESS_KEY_ID:?RO creds missing}" "${RCLONE_CONFIG_R2DBRO_SECRET_ACCESS_KEY:?RO creds missing}"
rm -rf "$D"; mkdir -p "$D/pgdata" "$D/config"
cp -a "$CONFVOL/." "$D/config/"
CIPHER=$(grep '^repo1-cipher-pass=' "$D/config/pgbackrest.conf" | cut -d= -f2-)
[ -n "$CIPHER" ] || fail "could not extract cipher pass from live conf copy"
shred -u "$D/config/pgbackrest.conf"
cat > "$D/config/pgbackrest.conf" <<EOF
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
chmod 600 "$D/config/pgbackrest.conf"
chown -R 100:101 "$D/config" "$D/pgdata"
say "workspace ready at $D"

# --- restore from R2 (one-shot container, entrypoint = pgbackrest only) ---
RESTORE_OPTS=(--config=/etc/postgresql-custom/pgbackrest.conf --stanza=igf --archive-mode=off)
[ -n "$TARGET" ] && RESTORE_OPTS+=(--type=time "--target=$TARGET" --target-action=promote)
docker run --rm --name "$RCONT" -u postgres \
  -v "$D/pgdata":/var/lib/postgresql/data \
  -v "$D/config":/etc/postgresql-custom:ro \
  --entrypoint pgbackrest "$IMG" "${RESTORE_OPTS[@]}" restore >>"$LOG" 2>&1 \
  || fail "pgbackrest restore failed"
[ -f "$D/pgdata/recovery.signal" ] || fail "recovery.signal missing after restore"
say "restore from R2 complete"

# --- start the clone: socket-only, archiving off, cron/pg_net inert ---
docker run -d --name "$CONT" \
  -v "$D/pgdata":/var/lib/postgresql/data \
  -v "$D/config":/etc/postgresql-custom:ro \
  -e POSTGRES_PASSWORD=drill-unused-init-skipped \
  "$IMG" postgres -c config_file=/etc/postgresql/postgresql.conf \
    -c listen_addresses= \
    -c archive_mode=off \
    -c cron.database_name=drill_disabled \
    -c pg_net.database_name=drill_disabled >/dev/null

q(){ docker exec -u postgres "$CONT" psql -U supabase_admin -d postgres -Atc "$1"; }
lq(){ docker exec -u postgres "$LIVE" psql -U supabase_admin -d postgres -Atc "$1"; }

say "waiting for WAL replay + promotion"
PROMOTED=0
for _ in $(seq 1 90); do
  ST=$(q "select pg_is_in_recovery()" 2>/dev/null || echo starting)
  [ "$ST" = "f" ] && { PROMOTED=1; break; }
  docker ps -q -f name="$CONT" | grep -q . || fail "clone container died: $(docker logs --tail 15 "$CONT" 2>&1 | tail -5)"
  sleep 10
done
[ "$PROMOTED" = 1 ] || fail "clone did not promote within 15 minutes"

# --- isolate, then assert ---
docker network disconnect bridge "$CONT" || fail "network disconnect failed"
q "update cron.job set active=false" >/dev/null
say "promoted + isolated; running assertions"

[ "$(q 'select pg_is_in_recovery()')" = f ] || fail "still in recovery"
[ "$(q "select current_setting('data_checksums')")" = on ] || fail "data_checksums not on"
TL=$(q 'select timeline_id from pg_control_checkpoint()')
[ "$TL" -ge 2 ] || fail "unexpected timeline $TL (promotion did not fork)"
ROLES=$(q "select count(*) from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','supabase_admin')")
[ "$ROLES" = 5 ] || fail "roles missing ($ROLES/5)"
VT=$(q 'select count(*) from vault.decrypted_secrets')
VD=$(q 'select count(*) from vault.decrypted_secrets where decrypted_secret is not null')
{ [ "$VT" -gt 0 ] && [ "$VD" = "$VT" ]; } || fail "vault decryption broken ($VD/$VT)"
ORD=$(q 'select count(*) from public.orders')
[ "$ORD" -gt 0 ] || fail "orders table empty"
if [ -n "$TARGET" ]; then
  OK=$(q "select coalesce(max(greatest(created_at,updated_at)) <= '$TARGET'::timestamptz, false) from public.orders")
  [ "$OK" = t ] || fail "clone contains writes newer than target $TARGET"
else
  LP=$(lq 'select count(*) from pg_policies'); DP=$(q 'select count(*) from pg_policies')
  [ "$DP" = "$LP" ] || fail "policy count drill=$DP live=$LP"
  LO=$(lq 'select count(*) from public.orders')
  { [ "$ORD" -le "$LO" ] && [ $((LO - ORD)) -le 100 ]; } || fail "orders drift drill=$ORD live=$LO"
fi

ELAPSED=$(( $(date -u +%s) - T0 ))
say "DRILL OK: mode=${TARGET:+target}${TARGET:-latest} timeline=$TL orders=$ORD vault=$VD/$VT elapsed=${ELAPSED}s"
teardown
igf-heartbeat.sh restore-drill $((40*24*3600)) || say "WARN: heartbeat write failed (drill itself OK)"
say "=== restore drill end ==="
