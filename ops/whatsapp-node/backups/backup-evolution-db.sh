#!/usr/bin/env bash
# Full logical backup of the Evolution WhatsApp DB (conversations, contacts,
# chats, messages + Baileys creds). -Fc custom format = compressed, pg_restore-
# ready, self-contained (types+tables+data). Lives in /opt/igf-wa/backups which
# is in restic INCLUDES -> ships OFFSITE to R2 (encrypted) on the nightly run.
# RESTORE (into a fresh/rebuilt DB):
#   cat evolution-db-<stamp>.dump | (cd /opt/igf-wa/stack && docker compose \
#     exec -T postgres pg_restore -U evolution -d evolution --clean --if-exists --no-owner)
#   (DR: 'docker compose exec -T postgres createdb -U evolution evolution' first)
set -uo pipefail
BK=/opt/igf-wa/backups
TS=$(date -u +%Y%m%d-%H%M%S)
OUT="$BK/evolution-db-$TS.dump"
TMP=$(mktemp)
cd /opt/igf-wa/stack

if ! docker compose exec -T postgres pg_dump -U evolution -d evolution -Fc \
      --no-owner --no-privileges > "$TMP" 2>/dev/null; then
  rm -f "$TMP"; logger -t wa-db-backup "pg_dump failed"; exit 1
fi

# Guard: custom-format PGDMP magic + plausible size (real dump ~33 MB).
if [ "$(head -c5 "$TMP")" != "PGDMP" ] || [ "$(wc -c < "$TMP")" -lt 100000 ]; then
  rm -f "$TMP"; logger -t wa-db-backup "dump invalid/small, removed"; exit 1
fi

mv "$TMP" "$OUT"
# Rotate: keep newest 7 local (restic snapshot history covers older).
ls -1t "$BK"/evolution-db-*.dump 2>/dev/null | tail -n +8 | xargs -r rm -f
# Heartbeat: daily cadence, flag if >30h stale (auto-watched by the peer box).
igf-heartbeat.sh wa-dbdump 108000 || true
logger -t wa-db-backup "ok $OUT ($(stat -c%s "$OUT") bytes)"
