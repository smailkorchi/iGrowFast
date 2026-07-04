#!/usr/bin/env bash
# igf-escrow.sh — refresh the age-encrypted secrets escrow bundle in R2.
# The three files that a restored DB cannot decrypt itself (pgsodium_root.key +
# .env + functions.env) are captured by restic too, but the escrow is a SEPARATE
# copy under a DIFFERENT key (age, not the restic password) — a distinct trust
# domain so the vault chain is recoverable without the restic secret. This keeps
# it FRESH (the manual bundle drifted on every secret change — sweep M1).
#   -> igf-config-backups/escrow/<UTC-date>/{pgsodium_root.key.age,env.age,functions.env.age,MANIFEST.sha256}
set -euo pipefail
umask 077
LOG=/var/log/igf-backup/escrow.log
LOCK=/var/lock/igf-escrow.lock
DBENV=/root/.config/igf-backup/r2-db-backups.env      # IGF_AGE_RECIPIENT
RESTICENV=/root/.config/igf-backup/restic.env         # igf-config-backups RW creds
PGSODIUM=/var/lib/docker/volumes/supabase_db-config/_data/pgsodium_root.key
ENVFILE=/opt/supabase-project/.env
FNENV=/opt/supabase-project/functions.env

mkdir -p "$(dirname "$LOG")"
exec 9>"$LOCK"; flock -n 9 || { echo "$(date -uIs) already running" >>"$LOG"; exit 0; }
say(){ echo "$(date -uIs) $*" >>"$LOG"; }
fail(){ say "FAIL: $*"; printf 'Secrets escrow FAILED on %s: %s\n\n%s\n' "$(hostname)" "$*" "$(tail -n 15 "$LOG")" | igf-alert.sh "Secrets escrow FAILED" || true; exit 1; }
trap 'fail "unexpected error at line $LINENO"' ERR

set -a; . "$DBENV"; . "$RESTICENV"; set +a
: "${IGF_AGE_RECIPIENT:?age recipient missing}" "${AWS_ACCESS_KEY_ID:?config creds missing}" "${AWS_SECRET_ACCESS_KEY:?}"
for f in "$PGSODIUM" "$ENVFILE" "$FNENV"; do [ -r "$f" ] || fail "source missing: $f"; done

# rclone remote for igf-config-backups from the restic token (already on box)
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_R2CFG_TYPE=s3 RCLONE_CONFIG_R2CFG_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2CFG_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  RCLONE_CONFIG_R2CFG_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2CFG_ENDPOINT=https://8897211ce4bdb3eff028770e3dc584be.r2.cloudflarestorage.com \
  RCLONE_CONFIG_R2CFG_REGION=auto RCLONE_CONFIG_R2CFG_NO_CHECK_BUCKET=true

STAMP=$(date -u +%F)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"; shred -u "$TMP"/* 2>/dev/null || true' EXIT
say "=== escrow start ($STAMP) ==="

# age-encrypt each source (encrypt-only recipient; the private key is NOT on this box)
declare -A MAP=( [pgsodium_root.key]="$PGSODIUM" [env]="$ENVFILE" [functions.env]="$FNENV" )
: > "$TMP/MANIFEST.sha256"
for name in "${!MAP[@]}"; do
  src="${MAP[$name]}"
  age -r "$IGF_AGE_RECIPIENT" -o "$TMP/$name.age" "$src" || fail "age encrypt $name"
  psha=$(sha256sum "$src" | cut -d' ' -f1)
  esha=$(sha256sum "$TMP/$name.age" | cut -d' ' -f1)
  printf '%s  plaintext=%s  cipher(%s.age)=%s\n' "$name" "$psha" "$name" "$esha" >> "$TMP/MANIFEST.sha256"
done

DEST="r2cfg:igf-config-backups/escrow/$STAMP"
rclone copy "$TMP/" "$DEST/" --no-traverse >>"$LOG" 2>&1 || fail "upload failed"
# verify the objects landed
CNT=$(rclone lsf "$DEST/" | grep -c . || echo 0)
[ "$CNT" -ge 4 ] || fail "expected >=4 objects at $DEST, saw $CNT"

say "OK escrow refreshed at $DEST ($CNT objects)"
igf-heartbeat.sh escrow $((30*3600)) || say "WARN heartbeat failed"
say "=== escrow end ==="
