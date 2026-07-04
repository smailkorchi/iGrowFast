#!/usr/bin/env bash
# igf-pgbackrest-verify.sh — weekly repo integrity check (pgbackrest verify).
set -euo pipefail
umask 077
CONT=supabase-db
CONF=/etc/postgresql-custom/pgbackrest.conf
LOG=/var/log/igf-backup/pgbackrest-verify.log
LOCK=/var/lock/igf-pgbackrest.lock
mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -w 3600 9 || { echo "$(date -uIs) lock timeout" >>"$LOG"; exit 1; }
echo "$(date -uIs) === verify start ===" >>"$LOG"
if docker exec -u postgres "$CONT" pgbackrest --stanza=igf --config="$CONF" verify >>"$LOG" 2>&1; then
  igf-heartbeat.sh pgbackrest-verify $((8*24*3600))
  echo "$(date -uIs) verify OK" >>"$LOG"
else
  printf 'pgBackRest VERIFY FAILED on %s — repo may be corrupt.\n\n%s\n' "$(hostname)" \
    "$(tail -n 25 "$LOG")" | igf-alert.sh "PITR repo verify FAILED" || true
  exit 1
fi
