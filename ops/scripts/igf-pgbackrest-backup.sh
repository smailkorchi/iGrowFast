#!/usr/bin/env bash
# igf-pgbackrest-backup.sh full|incr — scheduled pgBackRest backup + heartbeat.
# Runs pgbackrest inside supabase-db as the postgres OS user (local-trust supabase_admin).
set -euo pipefail
umask 077
TYPE="${1:?full|incr}"
CONT=supabase-db
CONF=/etc/postgresql-custom/pgbackrest.conf
LOG=/var/log/igf-backup/pgbackrest.log
LOCK=/var/lock/igf-pgbackrest.lock
mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -n 9 || { echo "$(date -uIs) busy; skip" >>"$LOG"; exit 0; }

fail() {
  echo "$(date -uIs) FAIL($TYPE): $1" >>"$LOG"
  printf 'pgBackRest %s backup FAILED on %s: %s\n\n%s\n' "$TYPE" "$(hostname)" "$1" \
    "$(tail -n 25 "$LOG" 2>/dev/null)" | igf-alert.sh "PITR backup FAILED ($TYPE)" || true
  exit 1
}
trap 'fail "unexpected error line $LINENO"' ERR

echo "$(date -uIs) === $TYPE start ===" >>"$LOG"
docker exec -u postgres "$CONT" pgbackrest --stanza=igf --config="$CONF" --type="$TYPE" backup >>"$LOG" 2>&1 \
  || fail "pgbackrest backup returned nonzero"
# gate heartbeat on the backup actually being registered
docker exec -u postgres "$CONT" pgbackrest --stanza=igf --config="$CONF" info >>"$LOG" 2>&1 \
  || fail "pgbackrest info failed after backup"
# heartbeat window per type: incr is daily (36h catches a missed day fast), full is
# weekly (9d covers a missed Sunday). A too-generous window would let a daily incr
# silently stop for a week (sweep L2).
if [ "$TYPE" = incr ]; then HB_MAXAGE=$((36*3600)); else HB_MAXAGE=$((9*24*3600)); fi
igf-heartbeat.sh "pgbackrest-$TYPE" "$HB_MAXAGE"
echo "$(date -uIs) OK $TYPE" >>"$LOG"
