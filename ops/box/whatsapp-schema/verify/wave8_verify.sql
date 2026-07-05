-- POST-APPLY VERIFY (wave 8). (Agent-visibility scoping proven in rehearsal.)
\pset pager off
\echo '### is_wa_admin_conv helper (expect prosecdef=t)'
select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and proname='is_wa_admin_conv';
\echo '### agent-select policy counts'
select tablename, count(*) as policies from pg_policies where schemaname='whatsapp' and tablename in ('whatsapp_instances','conversations','messages','contacts','contact_identifiers','jid_mapping','merge_decisions','merge_review','contact_profiles','group_participants') group by tablename order by 1;
\echo '### ca_* policies now use is_wa_admin_conv (no inline conversations subquery)'
select policyname, (qual ~ 'is_wa_admin_conv') as uses_helper from pg_policies where schemaname='whatsapp' and tablename='conversation_assignments' order by policyname;
