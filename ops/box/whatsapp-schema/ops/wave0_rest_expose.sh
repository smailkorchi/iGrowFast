#!/usr/bin/env bash
# Wave 0, PostgREST exposure. Runs ON THE BOX:  ssh igf 'bash -s' < ops/wave0_rest_expose.sh
# Adds `whatsapp` to PGRST_DB_SCHEMAS in /opt/supabase-project/.env and recreates ONLY rest+studio
# (--no-deps => does not touch supabase-db). Idempotent. Verify health/env via host-side docker
# inspect + `docker logs supabase-rest` (the postgrest image is distroless: no in-container shell).
set -euo pipefail
cd /opt/supabase-project
TS=$(date +%Y%m%d-%H%M%S)
cp .env ".env.bak-whatsapp-$TS"
echo "== before =="; grep -n '^PGRST_DB_SCHEMAS=' .env
if grep -qE '^PGRST_DB_SCHEMAS=.*(,| )whatsapp( |$|,)' .env; then
  echo "whatsapp already present; no edit."
else
  sed -i 's/^PGRST_DB_SCHEMAS=public,storage,graphql_public$/PGRST_DB_SCHEMAS=public,storage,graphql_public,whatsapp/' .env
fi
echo "== after =="; grep -n '^PGRST_DB_SCHEMAS=' .env
docker compose up -d --no-deps rest studio
