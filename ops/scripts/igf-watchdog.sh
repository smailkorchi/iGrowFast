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

# Distinguish "R2 read failed" from "no heartbeats yet". A failed read (expired/
# revoked r2wd token, R2 outage, network partition) must NOT be mistaken for
# all-clear — that is the exact blind spot the watchdog exists to avoid.
if ! rclone lsjson "r2wd:${BUCKET}/heartbeat/${WATCH}/" >"$TMP/.ls" 2>"$TMP/.err"; then
  printf 'Watchdog on %s CANNOT READ heartbeats for %s from R2.\n\nError:\n%s\n\nCause: r2wd token expired/revoked, R2 outage, or network. This BLINDS monitoring of %s — fix now.\n' \
    "$(hostname)" "$WATCH" "$(head -c 400 "$TMP/.err")" "$WATCH" | igf-alert.sh "WATCHDOG BLIND on ${WATCH}"
  exit 1
fi
rclone copy "r2wd:${BUCKET}/heartbeat/${WATCH}/" "$TMP/" 2>/dev/null || true
shopt -s nullglob
files=("$TMP"/*.json)
# heartbeat: this watchdog ran and could read R2 — the peer reads THIS to catch a
# silently-dead watchdog (mutual liveness). Own-heartbeat write must not gate the check.
igf-heartbeat.sh "watchdog-${WATCH}" 5400 || true
[ ${#files[@]} -eq 0 ] && exit 0   # read OK, nothing registered yet
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
