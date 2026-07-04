#!/usr/bin/env bash
# igf-restore-plan.sh --target "YYYY-MM-DD HH:MM:SS+00"
# READ-ONLY. Validates a proposed restore target and prints a JSON plan of what a
# restore WOULD do. No side effects whatsoever — safe to call on every wizard step.
# Emits: { ok, target, in_window, wal_min_time, latest, drill_fresh, armed,
#          safety_backup, live_orders, warnings[] }
set -euo pipefail
umask 077
CONF=/etc/postgresql-custom/pgbackrest.conf
LIVE=supabase-db
ARM=/etc/igf-backup-agent/RESTORE_ARMED

TARGET=""
while [ $# -gt 0 ]; do case "$1" in
  --target) TARGET="${2:-}"; shift 2;;
  *) shift;;
esac; done

jq_escape(){ python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
lq(){ docker exec -u postgres "$LIVE" psql -U supabase_admin -d postgres -Atc "$1" 2>/dev/null; }

warnings=()
[ -n "$TARGET" ] || warnings+=("no target supplied — would restore to latest (end of WAL)")

# repo window
INFO=$(docker exec -u postgres "$LIVE" pgbackrest --config="$CONF" --stanza=igf --output=json info 2>/dev/null || echo '[]')
WAL_MIN=$(printf '%s' "$INFO" | python3 -c 'import json,sys
try:
  j=json.load(sys.stdin)[0]; print(j["archive"][0]["min"])
except Exception: print("")')
LATEST_STOP=$(printf '%s' "$INFO" | python3 -c 'import json,sys
try:
  j=json.load(sys.stdin)[0]; print(j["backup"][-1]["timestamp"]["stop"])
except Exception: print("")')
STATUS=$(printf '%s' "$INFO" | python3 -c 'import json,sys
try: print(json.load(sys.stdin)[0]["status"]["message"])
except Exception: print("unknown")')
[ "$STATUS" = ok ] || warnings+=("pgBackRest repo status is not ok: $STATUS")

# oldest full backup start = earliest restorable moment
WAL_MIN_TIME=$(printf '%s' "$INFO" | python3 -c 'import json,sys,datetime
try:
  j=json.load(sys.stdin)[0]
  ts=j["backup"][0]["timestamp"]["start"]
  print(datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S+00"))
except Exception: print("")')

# drill freshness (the trust gate) — read our own heartbeat
DRILL_FRESH=false
if [ -f /root/.config/igf-backup/r2-db-backups.env ]; then
  set -a; . /root/.config/igf-backup/r2-db-backups.env; set +a
  export RCLONE_CONFIG=/dev/null
  HB=$(rclone cat "r2dbro:igf-db-backups/heartbeat/vmi3390870/restore-drill.json" 2>/dev/null || echo '{}')
  DRILL_FRESH=$(printf '%s' "$HB" | python3 -c 'import json,sys,time
try:
  d=json.load(sys.stdin); print("true" if (time.time()-d.get("ts",0))<=d.get("max_age_sec",0) else "false")
except Exception: print("false")')
fi
[ "$DRILL_FRESH" = true ] || warnings+=("restore drill not proven-fresh — in-place restore is blocked until the monthly drill is green")

ARMED=false; [ -f "$ARM" ] && ARMED=true
[ "$ARMED" = true ] || warnings+=("in-place swap is NOT armed on the server — only validate-into-clone is available until an operator arms it")

# target window check
IN_WINDOW=true
if [ -n "$TARGET" ] && [ -n "$WAL_MIN_TIME" ]; then
  IN_WINDOW=$(python3 -c '
import sys,datetime
def p(s):
  return datetime.datetime.strptime(s.strip()[:19],"%Y-%m-%d %H:%M:%S")
try:
  t=p(sys.argv[1]); lo=p(sys.argv[2])
  print("true" if t>=lo else "false")
except Exception: print("unknown")' "$TARGET" "$WAL_MIN_TIME" 2>/dev/null || echo unknown)
  [ "$IN_WINDOW" = true ] || warnings+=("target is before the earliest restorable point ($WAL_MIN_TIME)")
fi

LIVE_ORDERS=$(lq 'select count(*) from public.orders' || echo '?')

W=$(printf '%s\n' "${warnings[@]:-}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))')
cat <<JSON
{
  "ok": $([ "$STATUS" = ok ] && echo true || echo false),
  "target": $( [ -n "$TARGET" ] && jq_escape "$TARGET" || echo null ),
  "in_window": $( [ "$IN_WINDOW" = unknown ] && echo null || echo "$IN_WINDOW" ),
  "wal_min_time": $( [ -n "$WAL_MIN_TIME" ] && jq_escape "$WAL_MIN_TIME" || echo null ),
  "latest_backup_epoch": $( [ -n "$LATEST_STOP" ] && echo "$LATEST_STOP" || echo null ),
  "repo_status": $(jq_escape "$STATUS"),
  "drill_fresh": $DRILL_FRESH,
  "armed": $ARMED,
  "safety_backup": "an incremental pgBackRest backup is taken BEFORE any swap, so the pre-restore state is itself a recovery point",
  "live_orders": $( [ "$LIVE_ORDERS" = '?' ] && echo null || echo "$LIVE_ORDERS" ),
  "warnings": $W
}
JSON
