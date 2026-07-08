-- whatsapp_042_node_sharding.sql
-- Blocker #2 (node_id sharding) — DB half. Makes the fleet multi-node-correct so a
-- 2nd Evolution box can be added without silently stealing/serving another node's
-- numbers. THREE additive, back-compat pieces:
--
--   1. reveal_node_base_url(smallint): SECDEF/service_role helper returning a node's
--      decrypted Evolution base URL (mirrors reveal_instance_token). Lets the edge
--      functions route each lifecycle call to the instance's OWN node's Evolution
--      (Half B) instead of a single hardcoded EVOLUTION_API_URL. base_url_ct carries a
--      per-node key_id, so we decrypt with it (not the key_id=1 default).
--
--   2. worker_claim_instance_leases gains a trailing p_node_id smallint DEFAULT NULL.
--      NULL ⇒ IDENTICAL to today (no node filter) — so the CURRENTLY-RUNNING worker's
--      3-arg calls keep working unchanged across this migration. When set, the RPC
--      refuses to claim / steal / return any instance whose node_id <> p_node_id, so a
--      mis-configured worker cannot lease another node's numbers even if its app-level
--      filter were wrong (defense in depth behind the worker's own node predicate).
--      DROP+CREATE in one txn is atomic: concurrent callers block on the DDL lock and
--      resolve the new 4-arg-with-default afterward (the old 3-arg call shape still
--      binds via the default).
--
--   3. worker_health.node_id (nullable smallint): which node a worker serves, for
--      fleet observability. No FK (health rows must never fail to upsert on an
--      unregistered node).
--
-- Reversible: drop reveal_node_base_url; restore the 3-arg claim fn; drop the column.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1. Per-node Evolution base URL reveal (service_role only; no admin gate — same
--    posture as reveal_instance_token: the worker/edge reveal credentials to reach
--    Evolution, business admins never see raw node URLs).
create or replace function whatsapp.reveal_node_base_url(p_node_id smallint)
returns text language plpgsql security definer set search_path to '' as $function$
declare v_ct bytea; v_key_id smallint;
begin
  if p_node_id is null then return null; end if;
  select base_url_ct, key_id into v_ct, v_key_id from whatsapp.wa_nodes where id = p_node_id;
  if v_ct is null then return null; end if;
  return whatsapp.decrypt_text(v_ct, v_key_id);
end; $function$;
revoke all on function whatsapp.reveal_node_base_url(smallint) from public;
grant  execute on function whatsapp.reveal_node_base_url(smallint) to service_role;
alter function whatsapp.reveal_node_base_url(smallint) owner to postgres;

-- 2. Node-scoped instance-lease claim. Trailing p_node_id DEFAULT NULL keeps the
--    live worker's existing 3-arg calls behaving exactly as before.
drop function if exists whatsapp.worker_claim_instance_leases(text, uuid[], integer);
create function whatsapp.worker_claim_instance_leases(
  p_worker_id text,
  p_instance_ids uuid[],
  p_lease_secs integer default 60,
  p_node_id smallint default null
)
returns table(out_instance_id uuid, out_lease_seq bigint)
language plpgsql security definer set search_path to '' as $function$
begin
  -- Claim currently-unowned instances that live on THIS node.
  insert into whatsapp.worker_instance_leases (instance_id, worker_id, leased_until)
  select i.id, p_worker_id, now() + make_interval(secs => p_lease_secs)
    from whatsapp.whatsapp_instances i
   where i.id = any(p_instance_ids)
     and (p_node_id is null or i.node_id = p_node_id)
     and not exists (select 1 from whatsapp.worker_instance_leases l where l.instance_id = i.id)
  on conflict (instance_id) do nothing;

  -- Steal EXPIRED leases (a peer worker died) — only for on-node instances.
  update whatsapp.worker_instance_leases l
     set worker_id    = p_worker_id,
         leased_until = now() + make_interval(secs => p_lease_secs),
         lease_seq    = l.lease_seq + 1,
         acquired_at  = now(),
         renewed_at   = now()
   where l.instance_id = any(p_instance_ids)
     and l.leased_until < now()
     and (p_node_id is null or exists (
           select 1 from whatsapp.whatsapp_instances i
            where i.id = l.instance_id and i.node_id = p_node_id));

  -- Return only the on-node leases we now hold.
  return query
    select l.instance_id, l.lease_seq
      from whatsapp.worker_instance_leases l
     where l.instance_id = any(p_instance_ids)
       and l.worker_id = p_worker_id
       and (p_node_id is null or exists (
             select 1 from whatsapp.whatsapp_instances i
              where i.id = l.instance_id and i.node_id = p_node_id));
end; $function$;
revoke all on function whatsapp.worker_claim_instance_leases(text, uuid[], integer, smallint) from public;
grant  execute on function whatsapp.worker_claim_instance_leases(text, uuid[], integer, smallint) to service_role;
alter function whatsapp.worker_claim_instance_leases(text, uuid[], integer, smallint) owner to postgres;

-- 3. Fleet observability: which node a worker serves.
alter table whatsapp.worker_health add column if not exists node_id smallint;

commit;
