-- whatsapp_054_renew_leases_node_scoped.sql
-- Re-audit RANK 1 (HIGH correctness). worker_renew_instance_leases renewed EVERY
-- lease held by a worker regardless of the instance's current node_id. mig 042
-- node-scoped worker_claim_instance_leases but the RENEW RPC was missed. Effect:
-- after an instance is reassigned from node A to node B, node A's worker keeps
-- renewing its lease → the dispatcher runs FOREVER on the wrong node and node B
-- can never claim it (A holds the lease). This also made the keystone's asserted
-- self-heal ("a missed wa:node broadcast self-heals within the lease interval")
-- FALSE in the losing (reassign-away) direction.
--
-- Fix: node-scope the renewal (+ the returned still-owned set) by joining the
-- instance and gating on node_id = p_node_id. A lease whose instance moved to
-- another node is NOT renewed → it drops out of the returned set (renewLeases()
-- then stopDispatcher()s it on the old node) AND its lease expires within
-- LEASE_DURATION_SEC so node B's expired-claim path takes it. p_node_id NULL =
-- legacy back-compat (renew all leases whose instance still exists).
--
-- The JOIN also drops a lease whose instance was deleted (should never be
-- renewed) — matches the wa:node DELETE tombstone path.
--
-- Reversible: re-run the pre-054 body (renew all leases for the worker_id, no join).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp.worker_renew_instance_leases(
  p_worker_id text,
  p_lease_secs integer default 60,
  p_node_id smallint default null
)
returns table(out_instance_id uuid, out_lease_seq bigint)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update whatsapp.worker_instance_leases l
     set leased_until = now() + make_interval(secs => p_lease_secs),
         renewed_at   = now()
    from whatsapp.whatsapp_instances wi
   where l.worker_id = p_worker_id
     and wi.id = l.instance_id
     and (p_node_id is null or wi.node_id = p_node_id);

  return query
    select l.instance_id, l.lease_seq
      from whatsapp.worker_instance_leases l
      join whatsapp.whatsapp_instances wi on wi.id = l.instance_id
     where l.worker_id = p_worker_id
       and (p_node_id is null or wi.node_id = p_node_id);
end;
$function$;

commit;
