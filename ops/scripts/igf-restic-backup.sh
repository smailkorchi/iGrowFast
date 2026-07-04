#!/usr/bin/env bash
# igf-restic-backup.sh — nightly config/state backup → R2 igf-config-backups/restic/<host-repo>.
# Reads job definition from /root/.config/igf-backup/restic-job.conf:
#   PRE_HOOK        optional command run before backup (e.g. igf-cf-export.sh)
#   INCLUDES=( ... )  paths to back up
#   EXCLUDES=( ... )  restic --exclude args
#   SENTINELS=( ... ) paths that MUST appear in `restic ls latest` — the heartbeat is
#                     content-gated on these, not on exit code alone.
#   HB_JOB / HB_MAXAGE  heartbeat identity
# Stale-lock auto-recovery: exclusive-lock failure + lock older than 1h → unlock, retry once.
set -euo pipefail
umask 077

CONF=/root/.config/igf-backup/restic-job.conf
ENVF=/root/.config/igf-backup/restic.env
LOGDIR=/var/log/igf-backup
LOG="$LOGDIR/restic.log"
LOCK=/var/lock/igf-restic.lock

mkdir -p "$LOGDIR"
exec 9>"$LOCK"
if ! flock -n 9; then echo "$(date -uIs) another run in progress; abort" >>"$LOG"; exit 0; fi

# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
# shellcheck disable=SC1090
. "$CONF"

fail() {
  local msg="$1"
  echo "$(date -uIs) FAIL: $msg" >>"$LOG"
  printf 'Config backup (restic) FAILED on %s\nWhen: %s\nError: %s\n\nLast log lines:\n%s\n' \
    "$(hostname)" "$(date -uIs)" "$msg" "$(tail -n 20 "$LOG" 2>/dev/null)" \
    | igf-alert.sh "Config backup FAILED" || true
  exit 1
}
trap 'fail "unexpected error near line $LINENO"' ERR

echo "$(date -uIs) === start ===" >>"$LOG"

# 0. pre-hook (CF dashboard-state export on the box; non-fatal failures alert separately)
if [ -n "${PRE_HOOK:-}" ]; then
  if ! $PRE_HOOK >>"$LOG" 2>&1; then
    printf 'PRE_HOOK (%s) failed on %s — restic backup continued WITHOUT fresh exports.\n' \
      "$PRE_HOOK" "$(hostname)" | igf-alert.sh "Config backup pre-hook FAILED" || true
    echo "$(date -uIs) WARN: pre-hook failed, continuing" >>"$LOG"
  fi
fi

# 1. preflight: sentinels must exist on disk (never back up a broken source)
for s in "${SENTINELS[@]}"; do
  [ -e "$s" ] || fail "sentinel missing on disk: $s"
done

# 2. backup with stale-lock auto-recovery
EXARGS=()
for e in "${EXCLUDES[@]:-}"; do [ -n "$e" ] && EXARGS+=(--exclude "$e"); done
run_backup() { restic backup "${INCLUDES[@]}" "${EXARGS[@]}" --tag nightly 2>>"$LOG" >>"$LOG"; }
if ! run_backup; then
  if tail -n 5 "$LOG" | grep -qi 'unable to create lock\|repository is already locked'; then
    AGE=$(restic list locks --no-lock -q 2>/dev/null | head -1 | xargs -r -I{} restic cat lock {} 2>/dev/null | grep -o '"time":"[^"]*"' | head -1 || true)
    echo "$(date -uIs) stale lock suspected ($AGE); unlocking + retry once" >>"$LOG"
    restic unlock 2>>"$LOG" || true
    run_backup || fail "backup failed after unlock retry"
  else
    fail "restic backup failed (not a lock issue)"
  fi
fi

# 3. postflight content gate: latest snapshot must actually CONTAIN the sentinels
LSOUT=$(restic ls latest 2>>"$LOG")
for s in "${SENTINELS[@]}"; do
  echo "$LSOUT" | grep -qF "$s" || fail "content gate: $s missing from latest snapshot"
done

# 4. heartbeat (only after content gate passes)
igf-heartbeat.sh "$HB_JOB" "$HB_MAXAGE"

SNAP=$(restic snapshots latest --json 2>/dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin); print(s[0]["short_id"] if s else "?")' 2>/dev/null || echo '?')
echo "$(date -uIs) OK snapshot=$SNAP" >>"$LOG"
