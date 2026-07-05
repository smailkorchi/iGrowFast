-- POST-APPLY VERIFY (wave 7b-2). 15 RPCs present + correct grant posture. (Functional lifecycle proven in rehearsal.)
\pset pager off
\echo '### 15 RPCs present'
select count(*) as rpc_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp'
 and p.proname in ('dispatch_gate_check','pacing_take_token','queue_claim_next','queue_mark_sent','queue_mark_failed','queue_mark_dead','worker_claim_instance_leases','worker_renew_instance_leases','worker_release_instance_leases','worker_heartbeat','assign_conversation','unassign_conversation','claim_conversation','admin_assign_conversations','admin_unassign_conversations');
\echo '### grant posture (worker->service_role only; assignment->authenticated+service_role; no public)'
select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authd, has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='whatsapp' and p.proname in ('dispatch_gate_check','queue_claim_next','worker_heartbeat','worker_claim_instance_leases','assign_conversation','claim_conversation','unassign_conversation','admin_assign_conversations','admin_unassign_conversations') order by 1;
\echo '### security type of admin_* (expect prosecdef=t, the DEFINER fix)'
select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='whatsapp' and proname in ('admin_assign_conversations','admin_unassign_conversations') order by 1;
