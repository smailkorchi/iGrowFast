#!/usr/bin/env bash
# igf-heartbeat.sh JOB MAX_AGE_SEC
# Writes a heartbeat marker to R2 after a successful backup job. The watchdog on the
# OTHER box reads these and alerts if one goes stale (= job stopped running / box down).
# Remote "r2hb" + bucket come from /root/.config/igf-backup/r2-hb.env (per-host).
set -euo pipefail
JOB="${1:?job name required}"
MAXAGE="${2:?max_age_sec required}"
ENVF=${IGF_HB_ENV:-/root/.config/igf-backup/r2-hb.env}
# shellcheck disable=SC1090
set -a; . "$ENVF"; set +a
export RCLONE_CONFIG=/dev/null
BUCKET="${IGF_HB_BUCKET:?IGF_HB_BUCKET not set in r2-hb.env}"
HOST=$(hostname)
TS=$(date -u +%s)
ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"host":"%s","job":"%s","ts":%s,"iso":"%s","max_age_sec":%s}' \
  "$HOST" "$JOB" "$TS" "$ISO" "$MAXAGE" \
  | rclone rcat "r2hb:${BUCKET}/heartbeat/${HOST}/${JOB}.json"
