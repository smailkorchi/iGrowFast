-- POST-APPLY VERIFY (wave 3). Structural + grant + empty-chain checks; NO test rows on live.
-- (Functional hash-chain/tamper/RLS behavior was proven exhaustively in the BEGIN/ROLLBACK rehearsal.)
\pset pager off
\echo '### object counts (expect tbl=1, fns=4, trg=1, idx=6)'
select (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relname='audit_log') as tbl,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and p.proname in ('audit','_audit_log_hash','validate_audit_chain','admin_audit_chain_status')) as fns,
       (select count(*) from pg_trigger where tgrelid='whatsapp.audit_log'::regclass and not tgisinternal) as trg,
       (select count(*) from pg_indexes where schemaname='whatsapp' and tablename='audit_log') as idx;
\echo '### function ACLs (audit/admin_status -> authenticated+service_role; hash/validate -> service_role; no public)'
select proname, proacl from pg_proc where pronamespace='whatsapp'::regnamespace and proname in ('audit','_audit_log_hash','validate_audit_chain','admin_audit_chain_status') order by 1;
\echo '### table grants + rls + policy'
select grantee, string_agg(privilege_type,',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='whatsapp' and table_name='audit_log' group by grantee order by grantee;
select relrowsecurity as rls_on, relforcerowsecurity as force_rls from pg_class where oid='whatsapp.audit_log'::regclass;
select policyname, cmd, roles, qual from pg_policies where schemaname='whatsapp' and tablename='audit_log';
\echo '### empty chain validates (expect 0 broken) + pristine (expect 0 rows)'
select (select count(*) from whatsapp.validate_audit_chain()) as broken, (select count(*) from whatsapp.audit_log) as rows;
