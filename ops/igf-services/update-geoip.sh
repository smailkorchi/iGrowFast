#!/usr/bin/env bash
# igf-svc GeoIP DB refresh — DB-IP City Lite (CC BY 4.0), monthly.
# Validates the download by actually opening it and doing a known lookup BEFORE
# it replaces the live file, and rolls back if the service fails to come up.
# Cron: /etc/cron.d/igf-geoip
set -euo pipefail
cd /opt/igf-services
DB=data/dbip-city-lite.mmdb
TMP=data/.new.mmdb
PREV=data/.prev.mmdb

fail() { echo "$(date -Is) geoip update FAILED: $*" >&2; rm -f "$TMP" "$TMP.gz"; exit 1; }

got=""
for m in "$(date +%Y-%m)" "$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m)"; do
  if curl -fsSL --max-time 300 "https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz" -o "$TMP.gz"; then got="$m"; break; fi
done
[ -n "$got" ] || fail "download (tried current + previous month)"

gunzip -f "$TMP.gz" || fail "gunzip"
[ -s "$TMP" ] || fail "empty file"

# Open the candidate DB with the same reader the service uses and require a
# known-good lookup — a gzip-valid but truncated mmdb must never reach the live path.
docker run --rm -v "$PWD/$TMP:/candidate.mmdb:ro" --entrypoint node igf-services-svc \
  -e 'require("maxmind").open("/candidate.mmdb").then(r=>{const x=r.get("8.8.8.8");if(!x||!x.country||x.country.iso_code!=="US")throw new Error("sanity lookup failed");console.log("candidate ok")}).catch(e=>{console.error(e.message);process.exit(1)})' \
  || fail "candidate validation"

[ -f "$DB" ] && cp -f "$DB" "$PREV"
mv -f "$TMP" "$DB"

docker restart igf-svc >/dev/null || fail "container restart"
for _ in $(seq 1 15); do
  sleep 2
  if docker exec igf-svc node -e 'fetch("http://127.0.0.1:8080/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
    echo "$(date -Is) geoip db updated from ${got}"
    rm -f "$PREV"
    exit 0
  fi
done

# Service did not come back healthy on the new DB — restore and surface it.
if [ -f "$PREV" ]; then mv -f "$PREV" "$DB"; docker restart igf-svc >/dev/null || true; fi
fail "service unhealthy after update — rolled back to previous DB"
