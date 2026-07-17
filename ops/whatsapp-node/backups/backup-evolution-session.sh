#!/usr/bin/env bash
# Periodic backup of Evolution's Baileys credentials so a 401/device_removed
# (which CASCADE-deletes the Session row) doesn't lose a pairing forever.
# --data-only: the creds ROWS only. Tables + the InstanceConnectionStatus enum
# are NOT dumped (a schema-qualified -t dump omits the dependent type and will
# not restore into a fresh DB — proven by restore rehearsal 2026-07-17).
# RESTORE (401 case — the Session row was wiped, live DB still has the schema):
#   gunzip -c <file> | (cd /opt/igf-wa/stack && docker compose exec -T postgres \
#                       psql -U evolution -d evolution)
#   (re-inserts the wiped rows; a still-present row errors harmlessly + is skipped)
# DR (box loss): rebuild the stack (compose up → app creates schema+enum on an
#   empty DB), then run the same restore.
set -uo pipefail
BK=/opt/igf-wa/backups
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$BK/evolution-session-$TS.sql.gz"
TMP=$(mktemp)
cd /opt/igf-wa/stack

# Dump to a temp file first (NOT a bare pipeline) so a pg_dump failure can never
# leave an empty .gz behind — the guard below always runs. 'if !' also keeps a
# failure from tripping set -e. Instance before Session (FK-safe load order).
if ! docker compose exec -T postgres pg_dump -U evolution -d evolution --data-only \
      -t 'public."Instance"' -t 'public."Session"' \
      --no-owner --no-privileges > "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  logger -t wa-session-backup "pg_dump failed"
  exit 1
fi

# Guard: a real dump carries the Session COPY (the creds blob). Reject anything
# missing it or implausibly small.
if [ "$(wc -c < "$TMP")" -lt 500 ] || ! grep -q 'COPY public."Session"' "$TMP"; then
  rm -f "$TMP"
  logger -t wa-session-backup "dump empty/invalid, removed"
  exit 1
fi

gzip -c "$TMP" > "$OUT"
rm -f "$TMP"

# Rotate: keep newest 60 (~15 days at 4/day).
ls -1t "$BK"/evolution-session-*.sql.gz 2>/dev/null | tail -n +61 | xargs -r rm -f
# Heartbeat: 6h cadence, flag if >9h stale (auto-watched by the peer box —
# this is what would have caught the silent-empty failure).
igf-heartbeat.sh wa-session 32400 || true
logger -t wa-session-backup "ok $OUT ($(stat -c%s "$OUT") bytes)"
