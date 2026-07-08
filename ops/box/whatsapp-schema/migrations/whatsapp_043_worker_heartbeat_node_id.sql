-- whatsapp_043_worker_heartbeat_node_id.sql
-- Fleet observability follow-up to 042: let the heartbeat record which node a worker
-- serves. Adds a trailing p_node_id smallint DEFAULT NULL to worker_heartbeat and
-- writes it into worker_health.node_id (column added in 042). DEFAULT NULL keeps the
-- CURRENTLY-RUNNING worker's named-arg call (which omits p_node_id) working unchanged
-- across the deploy; DROP+CREATE in one txn is atomic (concurrent 5s heartbeats block
-- on the DDL lock, then bind the new signature).
--
-- Reversible: restore the 9-arg worker_heartbeat.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

drop function if exists whatsapp.worker_heartbeat(
  text, text, text, integer, integer, integer, real, timestamptz, jsonb);

create function whatsapp.worker_heartbeat(
  p_worker_id text,
  p_hostname text,
  p_version text,
  p_active_numbers integer,
  p_queue_depth integer,
  p_dispatching_count integer,
  p_drain_rate_1m real,
  p_last_dispatch_at timestamptz default null,
  p_notes jsonb default '{}'::jsonb,
  p_node_id smallint default null
)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  insert into whatsapp.worker_health
    (worker_id, hostname, version, started_at, last_heartbeat_at,
     active_numbers, queue_depth, dispatching_count, drain_rate_1m,
     last_dispatch_at, notes, node_id)
  values
    (p_worker_id, p_hostname, p_version, now(), now(),
     p_active_numbers, p_queue_depth, p_dispatching_count, p_drain_rate_1m,
     p_last_dispatch_at, p_notes, p_node_id)
  on conflict (worker_id) do update set
    hostname=excluded.hostname, version=excluded.version,
    last_heartbeat_at=excluded.last_heartbeat_at,
    active_numbers=excluded.active_numbers, queue_depth=excluded.queue_depth,
    dispatching_count=excluded.dispatching_count, drain_rate_1m=excluded.drain_rate_1m,
    last_dispatch_at=excluded.last_dispatch_at, notes=excluded.notes,
    node_id=excluded.node_id;
end; $function$;
revoke all on function whatsapp.worker_heartbeat(
  text, text, text, integer, integer, integer, real, timestamptz, jsonb, smallint) from public;
grant  execute on function whatsapp.worker_heartbeat(
  text, text, text, integer, integer, integer, real, timestamptz, jsonb, smallint) to service_role;
alter function whatsapp.worker_heartbeat(
  text, text, text, integer, integer, integer, real, timestamptz, jsonb, smallint) owner to postgres;

commit;
