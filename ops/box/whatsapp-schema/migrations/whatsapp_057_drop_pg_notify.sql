-- whatsapp_057_drop_pg_notify.sql
-- Phase 3a/3b tail cleanup. The worker moved from session-mode LISTEN/NOTIFY to
-- transaction-mode pooling with wa:node broadcast wakes (Phase 3a, commit d111083):
-- db.ts listenClient + index.ts listenOn were deleted, so NOTHING LISTENs on the
-- 'outbound_enqueued' / 'media_fetch_ready' channels anymore. The three producers
-- kept their pg_notify calls purely as a rollback net during the 3a/3b soak. Soak
-- is done (3a cap-break + 3b dispatch_prep both verified live, 0 errors), so the
-- dead pg_notify calls are removed here. Each function KEEPS its wa:node
-- realtime.send wake untouched — that is the sole live wake path.
--
-- Producers (one pg_notify each, all removed):
--   whatsapp._outbound_queue_notify()                 'outbound_enqueued'
--   whatsapp.enqueue_media_fetch(uuid,uuid,text,kind) 'media_fetch_ready'
--   whatsapp.force_dispatch_now(uuid)                 'outbound_enqueued'
--
-- CREATE OR REPLACE preserves owner + grants (no owner/grant churn). Reversible by
-- re-adding the single pg_notify line to each (needed only if rolling back to
-- session-mode pooling, which also requires re-adding the worker's LISTEN client).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1. outbound enqueue trigger --------------------------------------------------
create or replace function whatsapp._outbound_queue_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_node smallint;
begin
  -- Phase 3b: pg_notify('outbound_enqueued') removed (worker no longer LISTENs).
  -- wa:node wake is the sole live wake path.
  begin
    select node_id into v_node from whatsapp.whatsapp_instances where id = NEW.number_id;
    if v_node is not null then
      perform realtime.send(
        jsonb_build_object('number_id', NEW.number_id::text),
        'wake_outbound', 'wa:node:' || v_node::text, true);
    end if;
  exception when others then null;
  end;
  return NEW;
end;
$function$;

-- 2. media fetch enqueue -------------------------------------------------------
create or replace function whatsapp.enqueue_media_fetch(p_message_id uuid, p_instance_id uuid, p_evolution_message_id text, p_kind whatsapp.message_kind)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_id bigint; v_node smallint;
begin
  insert into whatsapp.media_fetch_jobs (message_id, instance_id, evolution_message_id, kind)
  values (p_message_id, p_instance_id, p_evolution_message_id, p_kind)
  on conflict (message_id) where completed_at is null do nothing
  returning id into v_id;

  update whatsapp.messages
    set media_pending = true,
        media_storage_bucket = coalesce(media_storage_bucket, 'whatsapp-media')
    where id = p_message_id;

  -- Phase 3b: pg_notify('media_fetch_ready') removed — wa:node wake only.
  begin
    select node_id into v_node from whatsapp.whatsapp_instances where id = p_instance_id;
    if v_node is not null then
      perform realtime.send(
        jsonb_build_object('message_id', p_message_id::text),
        'wake_media', 'wa:node:' || v_node::text, true);
    end if;
  exception when others then null;
  end;
  return v_id;
end;
$function$;

-- 3. force dispatch now (admin/sender override) --------------------------------
create or replace function whatsapp.force_dispatch_now(p_message_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
DECLARE
  v_msg   record;
  v_until timestamptz := now() + interval '60 seconds';
  v_node  smallint;
BEGIN
  SELECT m.id, m.instance_id, m.direction, m.sent_by_agent_id, m.delivery_status
    INTO v_msg FROM whatsapp.messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.direction <> 'outbound' THEN
    RAISE EXCEPTION 'can_only_force_outbound' USING ERRCODE = '22023';
  END IF;
  IF v_msg.delivery_status NOT IN ('PENDING', 'FAILED') THEN
    RAISE EXCEPTION 'message_not_in_dispatchable_state: %', v_msg.delivery_status USING ERRCODE = '22023';
  END IF;
  IF NOT (whatsapp.is_wa_admin(v_msg.instance_id) OR v_msg.sent_by_agent_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: must be admin or original sender' USING ERRCODE = '42501';
  END IF;
  UPDATE whatsapp.whatsapp_instances
     SET quiet_hours_override_until = GREATEST(COALESCE(quiet_hours_override_until, now()), v_until), updated_at = now()
   WHERE id = v_msg.instance_id;
  UPDATE whatsapp.outbound_queue SET not_before = now()
   WHERE payload->>'message_id' = p_message_id::text AND status IN ('queued', 'failed');
  -- Phase 3b: pg_notify('outbound_enqueued') removed — wa:node wake only.
  begin
    select node_id into v_node from whatsapp.whatsapp_instances where id = v_msg.instance_id;
    if v_node is not null then
      perform realtime.send(
        jsonb_build_object('number_id', v_msg.instance_id::text),
        'wake_outbound', 'wa:node:' || v_node::text, true);
    end if;
  exception when others then null;
  end;
  PERFORM whatsapp.audit('message.force_dispatched', 'message', p_message_id::text,
    jsonb_build_object('instance_id', v_msg.instance_id, 'override_until', v_until, 'reason', 'agent or admin override of schedule gate'));
  RETURN jsonb_build_object('message_id', p_message_id, 'override_until', v_until, 'status', 'dispatching');
END;
$function$;

commit;
