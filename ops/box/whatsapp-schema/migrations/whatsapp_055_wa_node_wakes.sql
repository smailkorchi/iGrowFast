-- whatsapp_055_wa_node_wakes.sql
-- Enterprise-scale plan PHASE 3a (W2), STEP 1 — additive. Moves the worker's
-- dispatch/media WAKES off LISTEN/NOTIFY onto the wa:node broadcast, so the worker
-- can eventually drop its dedicated LISTEN connection and move from supavisor
-- SESSION mode (5432, pins a backend per connection → ~2-node fleet cap) to
-- TRANSACTION mode (6543, multiplexes → ~15-40 nodes). LISTEN/NOTIFY is the last
-- session-state dependency (search_path was removed in Phase 1d).
--
-- ADDITIVE + FAIL-SAFE: the existing pg_notify calls are KEPT (still the live wake
-- path); this only ADDS a wa:node broadcast wake, wrapped in an exception guard so
-- a broadcast hiccup can NEVER break the hot enqueue path (a failed send just means
-- the pg_notify still wakes the worker). The wa:node route targets the OWNING node
-- (one delivery, no all-node fan-out); a cheap PK lookup gets node_id.
--
-- Events on wa:node (the worker already subscribes wa:node:<node_id> for 'instance'
-- control): 'wake_outbound' (payload {number_id}) + 'wake_media' (payload {message_id}).
--
-- Cutover (LATER, gated by a canary that proves wakes fire via broadcast at
-- unchanged p50 with pg_notify disabled): drop the pg_notify + the worker's LISTEN,
-- flip DATABASE_URL 5432→6543, remove db.ts listenClient. NOT in this migration.
--
-- Reversible: re-run the pre-055 bodies (remove the wa:node send blocks).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1) Outbound enqueue trigger (HOT — fires per outbound_queue INSERT/UPDATE).
create or replace function whatsapp._outbound_queue_notify()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_node smallint;
begin
  perform pg_notify('outbound_enqueued', NEW.number_id::text);   -- KEEP: live wake path
  -- Phase 3a additive wa:node wake (best-effort; never break the enqueue).
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
alter function whatsapp._outbound_queue_notify() owner to postgres;

-- 2) Manual force-dispatch.
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
  PERFORM pg_notify('outbound_enqueued', v_msg.instance_id::text);   -- KEEP
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
alter function whatsapp.force_dispatch_now(uuid) owner to postgres;

-- 3) Media fetch enqueue.
create or replace function whatsapp.enqueue_media_fetch(
  p_message_id uuid, p_instance_id uuid, p_evolution_message_id text, p_kind whatsapp.message_kind)
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

  perform pg_notify('media_fetch_ready', p_message_id::text);   -- KEEP
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
alter function whatsapp.enqueue_media_fetch(uuid, uuid, text, whatsapp.message_kind) owner to postgres;

commit;
