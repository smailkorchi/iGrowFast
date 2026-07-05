-- POST-APPLY VERIFY (wave 1). Expect exactly 12 enums with values matching WA Mancer source.
-- Verified pass 2026-07-05 (PITR anchor pre-apply LSN 6/230046A8): 12 enums, user_role absent,
-- values verbatim-match source, no custom type ACLs.
\pset pager off
\echo '### enum count (expect 12) + no user_role'
select count(*) as enum_count from pg_type t join pg_namespace n on n.oid=t.typnamespace
where n.nspname='whatsapp' and t.typtype='e';
select count(*) as user_role_present_expect_0 from pg_type t join pg_namespace n on n.oid=t.typnamespace
where n.nspname='whatsapp' and t.typname='user_role';
\echo '### enums + ordered values'
select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as values
from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
where n.nspname='whatsapp' group by t.typname order by t.typname;
\echo '### type ACLs (expect 0 rows = default PUBLIC usage, matching source)'
select t.typname, t.typacl from pg_type t join pg_namespace n on n.oid=t.typnamespace
where n.nspname='whatsapp' and t.typtype='e' and t.typacl is not null;
