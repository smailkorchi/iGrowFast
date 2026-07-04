#!/usr/bin/env bash
# igf-db-pull.sh (TOOLBOX) — weekly second-location copy of the DB backups (F9/F2):
#   1. newest logical dump set  -> /srv/db-pulls/logical/<STAMP>/  (keep newest 4)
#      each .age verified against manifest encrypted_sha256 (no decryption key on this host)
#   2. whole pgBackRest repo    -> /srv/db-pulls/pgbackrest/       (mirror)
# Sentinel-gated: if the R2 source is missing its sentinels (manifest / backup.info),
# ABORT BEFORE any local delete — an upstream wipe must not propagate here.
# Everything pulled is ciphertext (age / pgbackrest aes-256-cbc); keys are NOT on this box.
set -euo pipefail
umask 077
LOG=/var/log/igf-backup/db-pull.log
LOCK=/var/lock/igf-db-pull.lock
ENVF=/root/.config/igf-backup/r2-ro.env
BASE=/srv/db-pulls
KEEP=4

mkdir -p "$(dirname "$LOG")" "$BASE/logical" "$BASE/pgbackrest"
exec 9>"$LOCK"; flock -w 3600 9 || { echo "$(date -uIs) lock timeout" >>"$LOG"; exit 1; }
say(){ echo "$(date -uIs) $*" >>"$LOG"; }
fail(){
  say "PULL FAILED: $*"
  printf 'Weekly DB pull FAILED on %s\n\nReason: %s\n\nLast log:\n%s\n' \
    "$(hostname)" "$*" "$(tail -n 25 "$LOG")" | igf-alert.sh "toolbox DB pull FAILED" || true
  exit 1
}
trap 'fail "unexpected error at line $LINENO"' ERR

set -a; . "$ENVF"; set +a
export RCLONE_CONFIG=/dev/null
say "=== db pull start ==="

# --- sentinels: refuse to run against an empty/wiped source ---
NEWEST=$(rclone lsf r2dbro:igf-db-backups/logical/ -R --dirs-only | grep -E '^[0-9]{4}/[0-9]{2}/[0-9]{8}T[0-9]{6}Z/$' | sort | tail -1)
[ -n "$NEWEST" ] || fail "sentinel: no logical dump sets visible in R2"
rclone lsf "r2dbro:igf-db-backups/logical/${NEWEST}manifest.json" | grep -q manifest.json \
  || fail "sentinel: newest set $NEWEST has no manifest.json"
rclone lsf r2dbro:igf-db-backups/pgbackrest/backup/igf/backup.info | grep -q backup.info \
  || fail "sentinel: pgbackrest backup.info missing in R2"

# --- 1. newest logical set, sha-verified against its manifest ---
STAMP=$(basename "$NEWEST")
DEST="$BASE/logical/$STAMP"
if [ -f "$DEST/.verified" ]; then
  say "logical set $STAMP already pulled + verified"
else
  rm -rf "$DEST"; mkdir -p "$DEST"
  rclone copy "r2dbro:igf-db-backups/logical/$NEWEST" "$DEST/" >>"$LOG" 2>&1 || fail "logical copy failed"
  while read -r ENC WANT; do
    GOT=$(sha256sum "$DEST/$ENC" | cut -d' ' -f1)
    [ "$GOT" = "$WANT" ] || fail "sha mismatch on $ENC (got $GOT want $WANT)"
  done < <(jq -r '.files[] | .encrypted + " " + .encrypted_sha256' "$DEST/manifest.json")
  touch "$DEST/.verified"
  say "logical set $STAMP pulled, all encrypted_sha256 verified"
fi
# retention: keep newest $KEEP sets
ls -1 "$BASE/logical" | sort | head -n -"$KEEP" | while read -r OLD; do
  rm -rf "$BASE/logical/$OLD"; say "pruned old logical set $OLD"
done

# --- 2. mirror the pgBackRest repo (sentinel already proven above) ---
rclone sync r2dbro:igf-db-backups/pgbackrest/ "$BASE/pgbackrest/" --fast-list >>"$LOG" 2>&1 \
  || fail "pgbackrest repo mirror failed"

SIZ=$(du -sh "$BASE" | cut -f1)
say "PULL OK: logical=$STAMP repo+logical total=$SIZ"
igf-heartbeat.sh db-pull $((8*24*3600)) || say "WARN: heartbeat write failed (pull itself OK)"
say "=== db pull end ==="
