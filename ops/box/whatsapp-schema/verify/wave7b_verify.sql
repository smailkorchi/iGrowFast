-- POST-APPLY VERIFY (wave 7b-1). (Auto-assign/release lifecycle proven in rehearsal.)
\pset pager off
\echo '### agent_assign_cursor (deny-all: cursor_tbl=1, authd_can_read=f, rls=t)'
select (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relname='agent_assign_cursor') as cursor_tbl,
       has_table_privilege('authenticated','whatsapp.agent_assign_cursor','SELECT') as authd_can_read,
       (select relrowsecurity from pg_class where oid='whatsapp.agent_assign_cursor'::regclass) as rls;
\echo '### triggers present + on which table'
select tgname, tgrelid::regclass::text as on_table from pg_trigger where tgname in ('messages_auto_assign_on_inbound','whatsapp_release_dms_on_deactivation') and not tgisinternal order by 1;
\echo '### fn ACLs (service_role only, no public)'
select proname, proacl from pg_proc where pronamespace='whatsapp'::regnamespace and proname in ('_auto_assign_on_inbound','_release_dms_on_profile_deactivation') order by 1;
\echo '### cursor pristine (expect 0)'
select count(*) as cursor_rows from whatsapp.agent_assign_cursor;
