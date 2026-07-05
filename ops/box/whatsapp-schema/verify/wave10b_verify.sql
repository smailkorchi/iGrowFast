-- POST-APPLY VERIFY (wave 10b). (Functional resolution + triggers proven in rehearsal.)
\pset pager off
\echo '### 16 fns + 2 triggers'
select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and p.proname in ('identifier_trust','pick_survivor','chase_merged_into','_resolve_lid_to_phone','pair_lid_to_contact','link_alt','consolidate_contact','resolve_identity','resolve_contact_from_mapping','upsert_jid_mapping','upsert_contact_profile','consolidate_lid_conversation','import_phone_book_entry','merge_conversations','_on_jid_mapping_resolved','_conversations_resolve_identity')) as fns,
       (select count(*) from pg_trigger where tgname in ('jid_mapping_resolved','conversations_resolve_identity') and not tgisinternal) as triggers;
\echo '### W6: no search_path=public among these fns (expect 0)'
select count(*) as public_sp from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='whatsapp' and array_to_string(p.proconfig,',') like '%search_path=public%'
 and p.proname in ('resolve_contact_from_mapping','upsert_jid_mapping','import_phone_book_entry','pair_lid_to_contact');
\echo '### spot grants (no anon; identifier_trust svc-only W3)'
select proname, has_function_privilege('authenticated',p.oid,'EXECUTE') as authd, has_function_privilege('service_role',p.oid,'EXECUTE') as svc, has_function_privilege('anon',p.oid,'EXECUTE') as anon
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and proname in ('identifier_trust','resolve_identity','pair_lid_to_contact','merge_conversations','import_phone_book_entry') order by 1;
