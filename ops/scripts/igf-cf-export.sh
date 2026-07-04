#!/usr/bin/env bash
# igf-cf-export.sh — export Cloudflare dashboard state to /root/config-exports/.
# The tunnel is token-based remote-managed: ingress rules, DNS, Access apps, WAF/rate rules
# exist ONLY in the CF dashboard. This exports them (read-only token) so restic captures them —
# without this, a DR rebuild has no record of routing/Access/rules. Also snapshots R2 bucket
# lifecycle configs and local docker image digests (cloudflared/socket-proxy run :latest).
#
# Per-item best-effort: CF-managed rulesets 403 on read (Normalization, DDoS L7) — skipped, they
# carry none of our config. Exits nonzero only if a CRITICAL export failed.
set -uo pipefail
umask 077
# shellcheck disable=SC1091
. /root/.config/igf-backup/cf-ro.env
OUT=/root/config-exports
mkdir -p "$OUT"
API=https://api.cloudflare.com/client/v4
H="Authorization: Bearer $CF_EXPORT_TOKEN"
FAILED=()

get() { # get PATH OUTFILE critical|optional
  local path=$1 out=$2 kind=${3:-critical}
  if curl -fsS --max-time 60 -H "$H" "$API/$path" -o "$out.tmp" 2>/dev/null; then
    mv "$out.tmp" "$out"
  else
    rm -f "$out.tmp"
    [ "$kind" = critical ] && FAILED+=("$path")
  fi
}

get "accounts/$CF_ACCOUNT/cfd_tunnel" "$OUT/tunnels.json"
if [ -f "$OUT/tunnels.json" ]; then
  python3 -c '
import json
for t in json.load(open("'"$OUT"'/tunnels.json"))["result"]:
    if not t.get("deleted_at"): print(t["id"])' | while read -r tid; do
    get "accounts/$CF_ACCOUNT/cfd_tunnel/$tid/configurations" "$OUT/tunnel-$tid-config.json"
  done
fi
get "zones/$CF_ZONE/dns_records?per_page=200" "$OUT/dns-records.json"
get "accounts/$CF_ACCOUNT/access/apps" "$OUT/access-apps.json"
get "zones/$CF_ZONE/rulesets" "$OUT/zone-rulesets.json"
if [ -f "$OUT/zone-rulesets.json" ]; then
  # CF-managed rulesets (kind=managed) may 403 — optional; ours (kind=zone) are critical
  python3 -c '
import json
for r in json.load(open("'"$OUT"'/zone-rulesets.json"))["result"]:
    print(r["id"], "optional" if r.get("kind") == "managed" else "critical")' \
  | while read -r rid kind; do
    get "zones/$CF_ZONE/rulesets/$rid" "$OUT/zone-ruleset-$rid.json" "$kind"
  done
fi
for b in igf-storage igf-db-backups igf-config-backups igf-logs; do
  get "accounts/$CF_ACCOUNT/r2/buckets/$b/lifecycle" "$OUT/r2-lifecycle-$b.json" optional
done
docker images --digests --format '{{.Repository}}:{{.Tag}} {{.Digest}}' > "$OUT/docker-image-digests.txt" 2>/dev/null || true
chmod -R go-rwx "$OUT"

# stale-empty cleanup from earlier failed runs
find "$OUT" -type f -name '*.json' -empty -delete

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "cf-export: CRITICAL failures: ${FAILED[*]}" >&2
  exit 1
fi
echo "cf-export: $(ls "$OUT" | wc -l) files OK"
