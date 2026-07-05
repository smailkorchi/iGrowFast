-- POST-APPLY VERIFY (wave 4). Structural + grant + FK-seam checks; NO test rows on live.
-- (Cross-business RLS, audit-trigger, deny-all behavior proven in the BEGIN/ROLLBACK rehearsal.)
\pset pager off
\echo '### object counts (expect inst_cols=59, triggers=3, policies=4, indexes=9, wa_nodes=1)'
select (select count(*) from information_schema.columns where table_schema='whatsapp' and table_name='whatsapp_instances') as inst_cols,
       (select count(*) from pg_trigger where tgrelid='whatsapp.whatsapp_instances'::regclass and not tgisinternal) as triggers,
       (select count(*) from pg_policies where schemaname='whatsapp' and tablename='whatsapp_instances') as policies,
       (select count(*) from pg_indexes where schemaname='whatsapp' and tablename='whatsapp_instances') as indexes,
       (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relname='wa_nodes') as wa_nodes;
\echo '### seam FKs present'
select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid='whatsapp.whatsapp_instances'::regclass
  and conname in ('whatsapp_instances_business_id_fkey','whatsapp_instances_node_id_fkey','whatsapp_instances_key_id_fkey') order by 1;
\echo '### is_wa_admin ACL (authenticated+service_role, no public)'
select proname, proacl from pg_proc where pronamespace='whatsapp'::regnamespace and proname='is_wa_admin';
\echo '### instances grants + rls + policies'
select grantee, string_agg(privilege_type,',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='whatsapp' and table_name='whatsapp_instances' group by grantee order by grantee;
select relrowsecurity as rls_on from pg_class where oid='whatsapp.whatsapp_instances'::regclass;
select policyname, cmd, qual, with_check from pg_policies where schemaname='whatsapp' and tablename='whatsapp_instances' order by policyname;
\echo '### wa_nodes deny-all'
select has_table_privilege('authenticated','whatsapp.wa_nodes','SELECT') as authd,
       has_table_privilege('anon','whatsapp.wa_nodes','SELECT') as anon,
       has_table_privilege('service_role','whatsapp.wa_nodes','SELECT') as svc,
       (select relrowsecurity from pg_class where oid='whatsapp.wa_nodes'::regclass) as rls_on;
\echo '### pristine (expect 0 / 0)'
select (select count(*) from whatsapp.whatsapp_instances) as instances, (select count(*) from whatsapp.wa_nodes) as nodes;
