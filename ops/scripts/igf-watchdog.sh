#!/usr/bin/env bash
# igf-watchdog.sh WATCH_HOST
# Reads heartbeat/<WATCH_HOST>/*.json from R2 (remote "r2wd" in r2-hb.env) and alerts if any
# job heartbeat is older than its declared max_age_sec + grace. Runs on the OTHER box, so it
# still fires when WATCH_HOST is fully down. No heartbeats yet = nothing to watch = silent.
set -euo pipefail
WATCH="${1:?watch_host required}"
ENVF=${IGF_HB_ENV:-/root/.config/igf-backup/r2-hb.env}
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
export RCLONE_CONFIG=/dev/null
BUCKET="${IGF_WD_BUCKET:?IGF_WD_BUCKET not set}"
GRACE=${IGF_WD_GRACE:-7200}
NOW=$(date -u +%s)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
rclone copy "r2wd:${BUCKET}/heartbeat/${WATCH}/" "$TMP/" 2>/dev/null || true
shopt -s nullglob
files=("$TMP"/*.json)
[ ${#files[@]} -eq 0 ] && exit 0   # nothing registered yet
STALE=""
for f in "${files[@]}"; do
  job=$(basename "$f" .json)
  ts=$(grep -o '"ts":[0-9]*' "$f" | cut -d: -f2)
  maxage=$(grep -o '"max_age_sec":[0-9]*' "$f" | cut -d: -f2)
  [ -z "$ts" ] && continue
  age=$((NOW - ts)); limit=$((maxage + GRACE))
  if [ "$age" -gt "$limit" ]; then
    STALE="${STALE}"$'\n'"- ${job}: last success ${age}s ago (limit ${limit}s)"
  fi
done
if [ -n "$STALE" ]; then
  printf 'Watchdog on %s: backup job(s) on %s have STOPPED reporting.%s\n\nLikely: cron dead, box hung, R2 write failing, or %s is down. Investigate now.\n' \
    "$(hostname)" "$WATCH" "$STALE" "$WATCH" | igf-alert.sh "BACKUP STALE on ${WATCH}"
fi
