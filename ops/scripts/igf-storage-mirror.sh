#!/usr/bin/env bash
# igf-storage-mirror.sh — nightly mirror of the live igf-storage bucket (user uploads,
# Supabase storage-api backend) into igf-db-backups/storage-mirror/.
#   current/            = exact mirror of igf-storage
#   archive/<UTC date>/ = objects deleted or overwritten that day (45-day retention),
#                         so an accidental delete in the app is recoverable.
# Source read uses a dedicated RO token (r2src) — this job cannot write to live storage.
# Dest uses the box RW token for igf-db-backups (r2db).
# Restore note: PITR restores storage.objects METADATA to time T while R2 objects live
# here — see the metadata<->objects reconciliation section in logical/RESTORE_RUNBOOK.md.
set -euo pipefail
umask 077
LOG=/var/log/igf-backup/storage-mirror.log
LOCK=/var/lock/igf-storage-mirror.lock
SRC_ENV=/root/.config/igf-backup/r2-storage-mirror.env
DST_ENV=/root/.config/igf-backup/r2-db-backups.env
SRC=r2src:igf-storage
DST=r2db:igf-db-backups/storage-mirror
ARCHIVE_KEEP_DAYS=45

mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -w 1800 9 || { echo "$(date -uIs) lock timeout" >>"$LOG"; exit 1; }
say(){ echo "$(date -uIs) $*" >>"$LOG"; }
fail(){
  say "MIRROR FAILED: $*"
  printf 'igf-storage mirror FAILED on %s\n\nReason: %s\n\nLast log:\n%s\n' \
    "$(hostname)" "$*" "$(tail -n 25 "$LOG")" | igf-alert.sh "igf-storage mirror FAILED" || true
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

set -a; . "$SRC_ENV"; . "$DST_ENV"; set +a
export RCLONE_CONFIG=/dev/null
STAMP=$(date -u +%F)
say "=== storage mirror start ==="

rclone sync "$SRC" "$DST/current" \
  --backup-dir "$DST/archive/$STAMP" \
  --fast-list --transfers 8 --checkers 16 >>"$LOG" 2>&1 || fail "rclone sync failed"

# every source object must exist in the mirror with matching hash/size
rclone check --one-way "$SRC" "$DST/current" --fast-list >>"$LOG" 2>&1 || fail "post-sync verify (rclone check) failed"

# prune archived deletions older than retention
rclone delete "$DST/archive" --min-age "${ARCHIVE_KEEP_DAYS}d" --fast-list >>"$LOG" 2>&1 || say "WARN: archive prune failed (mirror itself OK)"

SIZ=$(rclone size "$DST/current" --fast-list 2>/dev/null | tr '\n' ' ')
say "MIRROR OK: $SIZ"
igf-heartbeat.sh storage-mirror $((30*3600)) || say "WARN: heartbeat write failed (mirror itself OK)"
say "=== storage mirror end ==="
