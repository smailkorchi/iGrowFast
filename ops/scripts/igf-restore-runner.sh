#!/usr/bin/env bash
# Started by igf-restore.service. Reads the request the agent wrote and invokes
# the gated execute engine. The engine itself enforces arm/drill/confirm gates.
set -euo pipefail
REQ=/run/igf-restore/request.json
[ -f "$REQ" ] || { echo "no restore request"; exit 1; }
TARGET=$(python3 -c 'import json;print(json.load(open("/run/igf-restore/request.json")).get("target",""))')
CONFIRM=$(python3 -c 'import json;print(json.load(open("/run/igf-restore/request.json")).get("confirm",""))')
MODE=$(python3 -c 'import json;print(json.load(open("/run/igf-restore/request.json")).get("mode","validate"))')
shred -u "$REQ" 2>/dev/null || rm -f "$REQ"
ARGS=(--mode "$MODE")
[ -n "$TARGET" ] && ARGS+=(--target "$TARGET")
[ -n "$CONFIRM" ] && ARGS+=(--confirm "$CONFIRM")
exec /usr/local/bin/igf-restore-execute.sh "${ARGS[@]}"
