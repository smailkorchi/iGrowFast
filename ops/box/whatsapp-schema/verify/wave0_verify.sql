-- POST-APPLY VERIFY (wave 0). Every assertion below must hold. Run:
--   ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres' < verify/wave0_verify.sql
-- Verified pass 2026-07-05: owner=postgres; anon_usage=f authenticated/service_role=t;
-- nspacl {postgres=UC,authenticated=U,service_role=U}; 0 default ACLs; 0 rels / 0 routines.
\pset pager off
\echo '### 1. schema exists, owner=postgres'
select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace where nspname='whatsapp';
\echo '### 2. USAGE  (expect anon=f, authenticated=t, service_role=t)'
select has_schema_privilege('anon','whatsapp','USAGE') as anon_usage,
       has_schema_privilege('authenticated','whatsapp','USAGE') as authenticated_usage,
       has_schema_privilege('service_role','whatsapp','USAGE') as service_role_usage;
\echo '### 3. nspacl  (expect authenticated=U + service_role=U + postgres=UC; NO anon, NO bare PUBLIC)'
select nspacl from pg_namespace where nspname='whatsapp';
\echo '### 4. no auto-grant default ACLs for whatsapp  (expect 0 rows)'
select d.defaclrole::regrole as grantor, d.defaclobjtype as objtype, d.defaclacl
from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='whatsapp';
\echo '### 5. schema empty  (expect rels=0, routines=0)'
select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='whatsapp') as rels,
       (select count(*) from pg_proc  p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp') as routines;
