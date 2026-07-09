-- whatsapp_049_instance_wa_biz_feed.sql
-- Enterprise-scale plan PHASE 2b — whatsapp_instances retirement, admin half.
-- The keystone (mig 048) re-homed the WORKER's whatsapp_instances feed onto
-- wa:node. The admin frontend Numbers list (instances.ts useInstancesRealtime,
-- mounted in numbers/Numbers.tsx + NumberDetail.tsx) still consumes
-- whatsapp_instances via postgres_changes. This ADDS a business-scoped admin feed
-- so that consumer can move to wa:biz, after which whatsapp_instances can leave
-- the supabase_realtime publication.
--
-- Extends _broadcast_instance_control (mig 048) to ALSO emit a minimal
-- {id[, deleted]} 'instance' event to wa:biz:<business_id> (admins invalidate the
-- Numbers list — a cheap refetch of a low-cardinality list; no in-place patch, so
-- no full-row payload and no secret columns cross the wire). The wa:node worker
-- payload is UNCHANGED. business_id is NOT NULL on whatsapp_instances.
--
-- ADDITIVE: whatsapp_instances stays in the publication; the frontend keeps its
-- postgres_changes binding until the wa:biz consumer is verified, then that binding
-- is removed and the table dropped from the publication.
--
-- Reversible: re-run mig 048's _broadcast_instance_control body.
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
    -- Worker (losing node stops the loop).
    if OLD.node_id is not null then
      perform realtime.send(
        jsonb_build_object('id', OLD.id::text, 'deleted', true),
        'instance', 'wa:node:' || OLD.node_id::text, true);
    end if;
    -- Admin Numbers list (evict the row via refetch).
    perform realtime.send(
      jsonb_build_object('id', OLD.id::text, 'deleted', true),
      'instance', 'wa:biz:' || OLD.business_id::text, true);
    return OLD;
  end if;

  -- INSERT / UPDATE worker payload → wa:node (17-col RawInstanceRow, unchanged).
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

  if NEW.node_id is not null then
    perform realtime.send(v_payload, 'instance', 'wa:node:' || NEW.node_id::text, true);
  end if;
  if TG_OP = 'UPDATE'
     and OLD.node_id is not null
     and OLD.node_id is distinct from NEW.node_id then
    perform realtime.send(v_payload, 'instance', 'wa:node:' || OLD.node_id::text, true);
  end if;

  -- Admin Numbers list → wa:biz (minimal id signal → the list invalidates+refetches).
  perform realtime.send(
    jsonb_build_object('id', NEW.id::text),
    'instance', 'wa:biz:' || NEW.business_id::text, true);

  return NEW;
end;
$function$;
alter function whatsapp._broadcast_instance_control() owner to postgres;

commit;
