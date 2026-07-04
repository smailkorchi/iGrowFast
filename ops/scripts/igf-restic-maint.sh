#!/usr/bin/env bash
# igf-restic-maint.sh [--deep] — weekly retention + integrity for the restic config repo.
# forget --prune (keep 30 daily / 12 weekly / 12 monthly), then restic check.
# --deep adds --read-data-subset=33% (monthly rotation covers the repo ~quarterly).
set -euo pipefail
umask 077
ENVF=/root/.config/igf-backup/restic.env
LOG=/var/log/igf-backup/restic-maint.log
LOCK=/var/lock/igf-restic.lock   # shared with backup job — never run concurrently

mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"
flock -w 3600 9 || { echo "$(date -uIs) could not get lock" >>"$LOG"; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a

fail() {
  echo "$(date -uIs) FAIL: $1" >>"$LOG"
  printf 'restic maintenance FAILED on %s: %s\n\n%s\n' "$(hostname)" "$1" \
    "$(tail -n 20 "$LOG" 2>/dev/null)" | igf-alert.sh "Config backup maintenance FAILED" || true
  exit 1
}
trap 'fail "unexpected error near line $LINENO"' ERR

echo "$(date -uIs) === maint start ($*) ===" >>"$LOG"
restic forget --keep-daily 30 --keep-weekly 12 --keep-monthly 12 --prune >>"$LOG" 2>&1
if [ "${1:-}" = "--deep" ]; then
  restic check --read-data-subset=33% >>"$LOG" 2>&1
else
  restic check >>"$LOG" 2>&1
fi
igf-heartbeat.sh restic-maint $((8*24*3600))
echo "$(date -uIs) maint OK" >>"$LOG"
