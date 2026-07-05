-- whatsapp_000_bootstrap  (Wave 0)
-- TARGET: LIVE box .102 self-host Postgres ONLY  (ssh igf -> docker exec supabase-db psql -U postgres).
-- NEVER apply to managed -prod (zjkqprrfbibjoslvlmxf) or -dev (pcgvfwqkzyozzxktfogi).
-- Applied 2026-07-05 (pre-apply PITR anchor: LSN 6/11002C48, 2026-07-05 19:36:55+00).
--
-- Wave 0 = create the empty `whatsapp` schema and lock it to authenticated+service_role.
--
-- Security model — EMPIRICALLY VERIFIED on this box 2026-07-05 (not assumed from the plan):
--   * anon gets NO schema USAGE -> cannot reach any whatsapp object regardless of object ACL.
--   * No all-schema/global default privileges exist and none are scoped to `whatsapp`; the plan's
--     W1 "grant-all trap" (auto-grant of new objects to anon/authenticated) is ABSENT here. New
--     whatsapp TABLES/SEQUENCES are created with owner-only ACLs.
--   * On this box `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` does NOT
--     take effect (new funcs keep the built-in PUBLIC=EXECUTE). It is therefore OMITTED (a no-op
--     would only create false confidence). Function PUBLIC-execute is instead stripped
--     deterministically PER FUNCTION in every function-creating wave:
--         REVOKE ALL ON FUNCTION whatsapp.fn(args) FROM PUBLIC;
--         GRANT EXECUTE ON FUNCTION whatsapp.fn(args) TO <intended roles only>;
--     (W5 grant==policy). Sensitive crypto fns (wave 2) -> EXECUTE to postgres+service_role only.

create schema if not exists whatsapp authorization postgres;
revoke all on schema whatsapp from public;                       -- no implicit PUBLIC usage/create
grant usage on schema whatsapp to authenticated, service_role;   -- anon gets NOTHING (S4/W2)

-- OUT-OF-BAND (not SQL): add `whatsapp` to PGRST_DB_SCHEMAS in /opt/supabase-project/.env and
-- `docker compose up -d --no-deps rest studio`.  See ../ops/wave0_rest_expose.sh.
