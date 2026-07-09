-- whatsapp_048_wa_node_keystone.sql
-- Enterprise-scale plan PHASE 2b KEYSTONE. Builds the service-role
-- wa:node:<node_id> control-plane broadcast so the worker can stop consuming
-- whatsapp_instances via postgres_changes (wal2json decodes EVERY node's instance
-- changes for EVERY worker; wa:node delivers each node ONLY its own). This is the
-- gate that must land before whatsapp_instances can leave the supabase_realtime
-- publication.
--
-- ADDITIVE: whatsapp_instances STAYS in the publication; the worker's existing
-- 'worker-instances' postgres_changes channel keeps running. This only ADDS the
-- wa:node broadcast. Cutover order:
--   1) apply this (wa:node starts emitting);
--   2) worker dual-subscribes wa:node ALONGSIDE postgres_changes (idempotent
--      applyState → double-apply is a no-op) and is verified;
--   3) worker drops the postgres_changes channel;
--   4) (after the Numbers list is also re-homed to wa:biz) whatsapp_instances
--      leaves the publication.
--
-- Payload = the worker's RawInstanceRow (instance-manager.ts INSTANCE_SELECT): the
-- 17 non-secret operational columns applyState/toConfig read. The Evolution token
-- is fetched separately (fetchToken), never broadcast. Event name 'instance'
-- (distinct from the conversation-bump 'bump' event).
--
-- Reassignment (node_id A→B) sends the NEW row to BOTH wa:node:A and wa:node:B:
-- B sees node_id=B → applyState (starts); A sees node_id≠A → stopDispatcher
-- (stops). Exactly the current node-gate semantics, but scoped per node.
--
-- wa:node needs NO realtime.messages policy: service_role (the worker) bypasses
-- RLS; authenticated/anon are denied by default (documented in mig 044).
--
-- Reversible: drop trigger whatsapp_instances_broadcast_control + function
--   whatsapp._broadcast_instance_control().
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp._broadcast_instance_control()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload jsonb;
begin
  if TG_OP = 'DELETE' then
    if OLD.node_id is not null then
      perform realtime.send(
        jsonb_build_object('id', OLD.id::text, 'deleted', true),
        'instance', 'wa:node:' || OLD.node_id::text, true);
    end if;
    return OLD;
  end if;

  -- INSERT / UPDATE: the worker RawInstanceRow (17 cols applyState/toConfig use).
  v_payload := jsonb_build_object(
    'id',                         NEW.id,
    'evolution_instance_name',    NEW.evolution_instance_name,
    'node_id',                    NEW.node_id,
    'status',                     NEW.status,
    'lifecycle_state',            NEW.lifecycle_state,
    'worker_paused',              NEW.worker_paused,
    'business_hours',             NEW.business_hours,
    'business_hours_enabled',     NEW.business_hours_enabled,
    'send_rate_per_min',          NEW.send_rate_per_min,
    'minute_burst_cap',           NEW.minute_burst_cap,
    'typing_base_ms',             NEW.typing_base_ms,
    'typing_per_char_ms',         NEW.typing_per_char_ms,
    'typing_cap_ms',              NEW.typing_cap_ms,
    'typing_enabled',             NEW.typing_enabled,
    'read_receipts_mode',         NEW.read_receipts_mode,
    'manual_presence',            NEW.manual_presence,
    'quiet_hours_override_until', NEW.quiet_hours_override_until
  );

  -- Current owner node.
  if NEW.node_id is not null then
    perform realtime.send(v_payload, 'instance', 'wa:node:' || NEW.node_id::text, true);
  end if;

  -- Reassignment: the losing node must stop its loop.
  if TG_OP = 'UPDATE'
     and OLD.node_id is not null
     and OLD.node_id is distinct from NEW.node_id then
    perform realtime.send(v_payload, 'instance', 'wa:node:' || OLD.node_id::text, true);
  end if;

  return NEW;
end;
$function$;
alter function whatsapp._broadcast_instance_control() owner to postgres;

drop trigger if exists whatsapp_instances_broadcast_control on whatsapp.whatsapp_instances;
create trigger whatsapp_instances_broadcast_control
  after insert or update or delete on whatsapp.whatsapp_instances
  for each row
  execute function whatsapp._broadcast_instance_control();

commit;
