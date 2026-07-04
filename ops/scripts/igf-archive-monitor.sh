#!/usr/bin/env bash
# igf-archive-monitor.sh — the ONLY reliable archiver-health signal on this box.
# The postmaster runs with `-c log_min_messages=fatal` (outranks all config), so archiver
# WARNING/ERROR never reach docker logs. pg_stat_archiver (SQL) is the sole source of truth.
# Alerts on: archive_mode off, archiver failures, stale last_archived_time, or root fs >70%.
# Runs every 5 min. Stateful: only alerts on NEW failures / transitions (marker file).
set -euo pipefail
CONT=supabase-db
STATE=/var/lib/igf-backup/archive-monitor.state
mkdir -p "$(dirname "$STATE")"
prev_failed=$(cat "$STATE" 2>/dev/null || echo 0)

read -r amode failed lastage <<<"$(docker exec "$CONT" psql -U supabase_admin -d postgres -tA -F' ' -c \
  "select (select setting from pg_settings where name='archive_mode'),
          failed_count,
          coalesce(extract(epoch from (now()-last_archived_time))::int, 999999)
   from pg_stat_archiver" 2>/dev/null || echo "ERR 0 0")"

alert() { printf '%s\n' "$2" | igf-alert.sh "$1" || true; }

if [ "$amode" = "ERR" ]; then
  alert "PITR archiver: DB UNREACHABLE" "archive-monitor could not query supabase-db on $(hostname). DB down or auth broken. Investigate."
elif [ "$amode" != "on" ]; then
  alert "PITR archiver: archive_mode=$amode" "archive_mode is '$amode' (expected on) on $(hostname). WAL archiving OFF = no PITR + WAL may accumulate. Investigate NOW."
elif [ "$failed" -gt "$prev_failed" ]; then
  alert "PITR archiver FAILING" "pg_stat_archiver.failed_count rose $prev_failed→$failed on $(hostname). archive_command failing to R2. Risk: pg_wal fills the 242G root fs → PANIC. Check pgbackrest + R2 token."
elif [ "$lastage" -gt 1800 ]; then
  alert "PITR archiver STALE" "Last successful WAL archive was ${lastage}s ago on $(hostname) (archive_timeout=60, expect a segment every ~60s). archive-push may be stuck. Investigate."
fi
echo "$failed" > "$STATE"

# disk guard (independent of archiver)
usep=$(df --output=pcent / | tail -1 | tr -dc 0-9)
if [ "${usep:-0}" -ge 70 ]; then
  alert "Box disk ${usep}%" "Root fs on $(hostname) at ${usep}%. pg_wal growth from stalled archiving is the prime suspect. df -h and check pgbackrest archive-push queue."
fi

# heartbeat LAST — this monitor is the only archiver-stall + disk-fill detector, and
# log_min_messages=fatal hides archiver logs, so its OWN death must be caught fast.
# Tight max-age (20min) so the peer watchdog alerts within minutes if it stops.
igf-heartbeat.sh archive-monitor 1200 || true
