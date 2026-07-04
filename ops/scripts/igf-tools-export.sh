#!/usr/bin/env bash
# Export toolbox runtime state that exists in no config file (socket-proxy run config, image digests).
set -euo pipefail
umask 077
OUT=/root/config-exports; mkdir -p "$OUT"
docker inspect docker-socket-proxy > "$OUT/docker-socket-proxy.json" 2>/dev/null || echo '[]' > "$OUT/docker-socket-proxy.json"
docker images --digests --format '{{.Repository}}:{{.Tag}} {{.Digest}}' > "$OUT/docker-image-digests.txt" 2>/dev/null || true
docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' > "$OUT/containers.txt" 2>/dev/null || true
