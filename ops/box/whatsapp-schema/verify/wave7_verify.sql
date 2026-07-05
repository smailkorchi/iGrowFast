-- POST-APPLY VERIFY (wave 7). Structural; NO test rows on live. (Guard/RLS/pacing proven in rehearsal.)
\pset pager off
\echo '### 6 tables + sequence'
select (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relkind='r' and relname in ('conversation_assignments','outbound_queue','number_pacing_state','worker_instance_leases','dispatcher_snapshot','worker_health')) as tables,
       (select count(*) from pg_class where relnamespace='whatsapp'::regnamespace and relkind='S' and relname='outbound_queue_seq_seq') as seq;
\echo '### authenticated grants'
select table_name, string_agg(privilege_type,',' order by privilege_type) as authd from information_schema.role_table_grants where table_schema='whatsapp' and grantee='authenticated' and table_name in ('conversation_assignments','outbound_queue','number_pacing_state','worker_instance_leases','dispatcher_snapshot','worker_health') group by table_name order by 1;
\echo '### rls + policy counts'
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.schemaname='whatsapp' and p.tablename=c.relname) as policies
from pg_class c where c.relnamespace='whatsapp'::regnamespace and c.relkind='r' and c.relname in ('conversation_assignments','outbound_queue','number_pacing_state','worker_instance_leases','dispatcher_snapshot','worker_health') order by 1;
\echo '### guard + deferred triggers present (expect 3)'
select tgname from pg_trigger where tgname in ('conversation_assignments_guard','whatsapp_instances_ensure_pacing','conversations_sync_assignment_is_group') and not tgisinternal order by 1;
\echo '### pristine (expect all 0)'
select relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from whatsapp.%I', relname), false, true, '')))[1]::text::int as rows
from pg_class where relnamespace='whatsapp'::regnamespace and relkind='r' and relname in ('conversation_assignments','outbound_queue','number_pacing_state','worker_instance_leases','dispatcher_snapshot','worker_health') order by 1;
