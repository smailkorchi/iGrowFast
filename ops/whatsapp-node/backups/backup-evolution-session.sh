#!/usr/bin/env bash
# Periodic backup of Evolution's Baileys credentials so a 401/device_removed
# (which CASCADE-deletes the Session row) doesn't lose a pairing forever.
# 1:1 from WA Mancer's proven script (paths adapted). Restore:
#   gunzip -c <file> | docker compose exec -T postgres psql -U evolution -d evolution
set -euo pipefail
BK=/opt/igf-wa/backups
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$BK/evolution-session-$TS.sql.gz"
cd /opt/igf-wa/stack

docker compose exec -T postgres pg_dump -U evolution -d evolution \
  -t 'evolution_api."Session"' -t 'evolution_api."Instance"' \
  --no-owner --no-privileges 2>/dev/null | gzip > "$OUT"

# Guard: drop empty/failed dumps so we never keep a useless file.
if [ ! -s "$OUT" ] || [ "$(gzip -dc "$OUT" 2>/dev/null | wc -c)" -lt 100 ]; then
  rm -f "$OUT"
  logger -t wa-session-backup "dump empty/failed, removed $OUT"
  exit 1
fi

# Rotate: keep newest 60 (~15 days at 4/day).
ls -1t "$BK"/evolution-session-*.sql.gz 2>/dev/null | tail -n +61 | xargs -r rm -f
logger -t wa-session-backup "ok $OUT ($(stat -c%s "$OUT") bytes)"
