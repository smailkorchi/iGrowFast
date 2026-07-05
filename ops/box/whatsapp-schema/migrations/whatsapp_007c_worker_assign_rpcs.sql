-- whatsapp_007c_worker_assign_rpcs  (Wave 7b-2) — 15 operational RPCs
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ported from WA Mancer via a port + adversarial-verify workflow (each fn diffed against the live source;
-- all 15 verified fidelity_ok + l1_complete). Assembled deterministically from the workflow JSON.
--   * Worker RPCs (dispatch_gate_check, pacing_take_token, queue_claim_next/mark_sent/mark_failed/mark_dead,
--     worker_claim/renew/release_instance_leases, worker_heartbeat): SECDEF, EXECUTE service_role only.
--   * assign_conversation / unassign_conversation / claim_conversation: SECDEF, EXECUTE authenticated+service_role
--     (internal whatsapp.is_wa_admin(instance) gate; claim self-inserts as auth.uid(), same-business guard applies).
--   * admin_assign_conversations / admin_unassign_conversations: SECURITY DEFINER (CORRECTNESS FIX over the
--     source's INVOKER form — verified in box rehearsal: under INVOKER+RLS the is_wa_admin gate is defeated
--     because a non-admin can't see the conversations, so EXISTS finds nothing and it hits a raw INSERT
--     permission error instead of a clean forbidden; the source INVOKER form is also non-functional for
--     direct authenticated admins who lack the conversation_assignments INSERT grant). DEFINER + the internal
--     is_wa_admin(EVERY involved instance) gate is the correct secure pattern (same as assign_conversation).
--   * enum outbound_action_type qualified whatsapp.* (lives in whatsapp, wave 1).


CREATE OR REPLACE FUNCTION whatsapp.dispatch_gate_check(p_number_id uuid)
 RETURNS TABLE(allowed boolean, reason text, resume_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caps   record;
  v_now    timestamptz := now();
  v_daily  int;
  v_hourly int;
  v_oldest_daily  timestamptz;
  v_oldest_hourly timestamptz;
  v_content whatsapp.outbound_action_type[] := ARRAY[
    'send_text','send_media','send_poll','react','edit_message','delete_message','send_contact'
  ]::whatsapp.outbound_action_type[];
BEGIN
  SELECT hourly_send_cap, daily_send_cap INTO v_caps
    FROM whatsapp.whatsapp_instances WHERE id = p_number_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'instance_not_found', v_now;
    RETURN;
  END IF;

  SELECT count(*)::int, min(dispatched_at) INTO v_daily, v_oldest_daily
    FROM whatsapp.outbound_queue
   WHERE number_id = p_number_id AND status = 'sent'
     AND action_type = ANY(v_content)
     AND dispatched_at >= v_now - interval '24 hours';

  SELECT count(*)::int, min(dispatched_at) INTO v_hourly, v_oldest_hourly
    FROM whatsapp.outbound_queue
   WHERE number_id = p_number_id AND status = 'sent'
     AND action_type = ANY(v_content)
     AND dispatched_at >= v_now - interval '1 hour';

  IF v_hourly >= v_caps.hourly_send_cap THEN
    RETURN QUERY SELECT false, 'hourly_send_cap', COALESCE(v_oldest_hourly, v_now) + interval '1 hour';
    RETURN;
  END IF;
  IF v_daily >= v_caps.daily_send_cap THEN
    RETURN QUERY SELECT false, 'daily_send_cap', COALESCE(v_oldest_daily, v_now) + interval '24 hours';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, NULL::timestamptz;
END;
$function$;
revoke all on function whatsapp.dispatch_gate_check(uuid) from public;
grant execute on function whatsapp.dispatch_gate_check(uuid) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.pacing_take_token(p_number_id uuid, p_rate_per_min integer, p_capacity integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rate   numeric := GREATEST(COALESCE(p_rate_per_min, 10), 1);
  v_cap    numeric := GREATEST(COALESCE(p_capacity, 5), 1);
  v_now    timestamptz := now();
  v_tokens numeric;
  v_last   timestamptz;
  v_refill numeric;
  v_wait   int;
BEGIN
  SELECT tokens, last_refill_at INTO v_tokens, v_last
    FROM whatsapp.number_pacing_state
   WHERE number_id = p_number_id
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO whatsapp.number_pacing_state (number_id, tokens, last_refill_at)
    VALUES (p_number_id, v_cap, v_now)
    ON CONFLICT (number_id) DO NOTHING;
    v_tokens := v_cap;
    v_last   := v_now;
  END IF;

  IF v_last IS NULL OR v_tokens IS NULL THEN
    v_refill := v_cap;
  ELSE
    v_refill := LEAST(v_cap, v_tokens + EXTRACT(EPOCH FROM (v_now - v_last)) * v_rate / 60.0);
  END IF;

  v_refill := v_refill - 1;
  IF v_refill >= 0 THEN
    v_wait := 0;
  ELSE
    v_wait   := CEIL((-v_refill) / (v_rate / 60.0) * 1000.0);
    v_refill := GREATEST(v_refill, -1);
  END IF;

  UPDATE whatsapp.number_pacing_state
     SET tokens = v_refill, last_refill_at = v_now, updated_at = v_now
   WHERE number_id = p_number_id;

  RETURN v_wait;
END;
$function$;
revoke all on function whatsapp.pacing_take_token(uuid, integer, integer) from public;
grant execute on function whatsapp.pacing_take_token(uuid, integer, integer) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.queue_claim_next(p_number_id uuid, p_content_allowed boolean DEFAULT true)
 RETURNS whatsapp.outbound_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row whatsapp.outbound_queue;
  v_id  uuid;
  v_passive whatsapp.outbound_action_type[] := ARRAY[
    'mark_read','typing_start','typing_stop'
  ]::whatsapp.outbound_action_type[];
BEGIN
  IF EXISTS (
    SELECT 1 FROM whatsapp.whatsapp_instances
     WHERE id = p_number_id
       AND (worker_paused = true OR lifecycle_state = 'banned')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT q.id INTO v_id
    FROM whatsapp.outbound_queue q
   WHERE q.number_id = p_number_id
     AND q.status = 'queued'
     AND q.not_before <= now()
     AND (p_content_allowed OR q.action_type = ANY(v_passive))
   ORDER BY
     CASE WHEN q.action_type = ANY(v_passive) THEN 1 ELSE 0 END ASC,
     (
       SELECT max(q2.dispatched_at)
         FROM whatsapp.outbound_queue q2
        WHERE q2.number_id = p_number_id
          AND q2.conversation_id = q.conversation_id
          AND q2.status IN ('dispatching','sent')
          AND q2.dispatched_at > now() - interval '30 seconds'
     ) ASC NULLS FIRST,
     q.priority ASC,
     q.seq ASC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE whatsapp.outbound_queue
     SET status = 'dispatching',
         dispatched_at = now(),
         attempts = attempts + 1
   WHERE id = v_id
     AND status = 'queued'
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
revoke all on function whatsapp.queue_claim_next(uuid, boolean) from public;
grant execute on function whatsapp.queue_claim_next(uuid, boolean) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.queue_mark_sent(p_id uuid, p_evolution_msg_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row whatsapp.outbound_queue;
  v_msg_id text;
  v_audit_id text;
  v_is_content boolean;
BEGIN
  UPDATE whatsapp.outbound_queue
     SET status = 'sent', completed_at = now(), evolution_msg_id = p_evolution_msg_id, error = NULL
   WHERE id = p_id AND status = 'dispatching'
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'queue_mark_sent: row % not in dispatching status', p_id;
  END IF;

  v_is_content := v_row.action_type IN ('send_text','send_media','send_poll','react','edit_message','delete_message','send_contact');

  UPDATE whatsapp.number_pacing_state
     SET last_completed_at = v_row.completed_at,
         last_send_at = CASE WHEN v_is_content THEN v_row.completed_at ELSE last_send_at END,
         last_send_conversation_id = CASE WHEN v_is_content THEN v_row.conversation_id ELSE last_send_conversation_id END
   WHERE number_id = v_row.number_id;

  v_msg_id   := v_row.payload->>'message_id';
  v_audit_id := COALESCE(v_row.payload->>'message_id', v_row.payload->>'target_message_id');

  IF v_row.action_type IN ('send_text','send_media','send_poll','send_contact')
     AND v_msg_id IS NOT NULL AND p_evolution_msg_id IS NOT NULL
     AND p_evolution_msg_id NOT LIKE 'local:%'
  THEN
    BEGIN
      UPDATE whatsapp.messages
         SET evolution_message_id = p_evolution_msg_id, delivery_status = 'SERVER_ACK'
       WHERE id = v_msg_id::uuid AND delivery_status IN ('PENDING','FAILED','ERROR');
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING 'queue_mark_sent: non-uuid message_id in payload for queue %: %', p_id, v_msg_id;
    END;
  END IF;

  PERFORM whatsapp.audit('message.dispatched','message', COALESCE(v_audit_id, v_row.id::text),
    jsonb_build_object('queue_id', v_row.id, 'number_id', v_row.number_id,
      'conversation_id', v_row.conversation_id, 'action_type', v_row.action_type,
      'evolution_msg_id', p_evolution_msg_id, 'attempts', v_row.attempts,
      'dispatched_at', v_row.dispatched_at, 'completed_at', v_row.completed_at,
      'duration_ms', EXTRACT(EPOCH FROM (v_row.completed_at - v_row.dispatched_at)) * 1000));
END;
$function$;
revoke all on function whatsapp.queue_mark_sent(uuid, text) from public;
grant execute on function whatsapp.queue_mark_sent(uuid, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.queue_mark_failed(p_id uuid, p_error text, p_retry_in_seconds integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row whatsapp.outbound_queue;
  v_msg_id text;
BEGIN
  UPDATE whatsapp.outbound_queue
     SET status = 'queued',
         error = p_error,
         not_before = now() + make_interval(secs => p_retry_in_seconds),
         dispatched_at = dispatched_at
   WHERE id = p_id AND status = 'dispatching'
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'queue_mark_failed: row % not in dispatching status', p_id;
  END IF;

  UPDATE whatsapp.number_pacing_state
     SET last_completed_at = now()
   WHERE number_id = v_row.number_id;

  v_msg_id := v_row.payload->>'message_id';
  PERFORM whatsapp.audit(
    'message.failed',
    'message',
    COALESCE(v_msg_id, v_row.id::text),
    jsonb_build_object(
      'queue_id',         v_row.id,
      'number_id',        v_row.number_id,
      'conversation_id',  v_row.conversation_id,
      'action_type',      v_row.action_type,
      'error',            p_error,
      'attempts',         v_row.attempts,
      'retry_in_seconds', p_retry_in_seconds
    )
  );
END;
$function$;
revoke all on function whatsapp.queue_mark_failed(uuid, text, integer) from public;
grant execute on function whatsapp.queue_mark_failed(uuid, text, integer) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.queue_mark_dead(p_id uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row whatsapp.outbound_queue;
  v_msg_id text;
  v_audit_id text;
BEGIN
  UPDATE whatsapp.outbound_queue
     SET status = 'dead', completed_at = now(), error = p_error
   WHERE id = p_id AND status IN ('dispatching','queued')
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'queue_mark_dead: row % not in dispatching or queued status', p_id;
  END IF;
  UPDATE whatsapp.number_pacing_state SET last_completed_at = now() WHERE number_id = v_row.number_id;

  v_msg_id   := v_row.payload->>'message_id';
  v_audit_id := COALESCE(v_row.payload->>'message_id', v_row.payload->>'target_message_id');

  IF v_row.action_type IN ('send_text','send_media','send_poll','send_contact') AND v_msg_id IS NOT NULL THEN
    BEGIN
      UPDATE whatsapp.messages SET delivery_status = 'FAILED'
       WHERE id = v_msg_id::uuid
         AND delivery_status NOT IN ('DELIVERY_ACK','READ','PLAYED','DELETED','CANCELLED');
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE WARNING 'queue_mark_dead: non-uuid message_id in payload for queue %: %', p_id, v_msg_id;
    END;
  END IF;

  IF v_row.action_type = 'delete_message' AND v_audit_id IS NOT NULL THEN
    BEGIN
      UPDATE whatsapp.messages SET revoked_at = NULL, revoked_by = NULL
       WHERE id = v_audit_id::uuid AND revoked_by = 'us';
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
  END IF;

  PERFORM whatsapp.audit('message.dead','message', COALESCE(v_audit_id, v_row.id::text),
    jsonb_build_object('queue_id', v_row.id, 'number_id', v_row.number_id,
      'conversation_id', v_row.conversation_id, 'action_type', v_row.action_type,
      'error', p_error, 'attempts', v_row.attempts));
END;
$function$;
revoke all on function whatsapp.queue_mark_dead(uuid, text) from public;
grant execute on function whatsapp.queue_mark_dead(uuid, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.worker_claim_instance_leases(p_worker_id text, p_instance_ids uuid[], p_lease_secs integer DEFAULT 60)
 RETURNS TABLE(out_instance_id uuid, out_lease_seq bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO whatsapp.worker_instance_leases (instance_id, worker_id, leased_until)
  SELECT i.id, p_worker_id, now() + make_interval(secs => p_lease_secs)
    FROM whatsapp.whatsapp_instances i
   WHERE i.id = ANY(p_instance_ids)
     AND NOT EXISTS (SELECT 1 FROM whatsapp.worker_instance_leases l WHERE l.instance_id = i.id)
  ON CONFLICT (instance_id) DO NOTHING;

  UPDATE whatsapp.worker_instance_leases l
     SET worker_id    = p_worker_id,
         leased_until = now() + make_interval(secs => p_lease_secs),
         lease_seq    = l.lease_seq + 1,
         acquired_at  = now(),
         renewed_at   = now()
   WHERE l.instance_id = ANY(p_instance_ids)
     AND l.leased_until < now();

  RETURN QUERY
    SELECT l.instance_id, l.lease_seq
      FROM whatsapp.worker_instance_leases l
     WHERE l.instance_id = ANY(p_instance_ids)
       AND l.worker_id = p_worker_id;
END;
$function$;
revoke all on function whatsapp.worker_claim_instance_leases(text, uuid[], integer) from public;
grant execute on function whatsapp.worker_claim_instance_leases(text, uuid[], integer) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.worker_renew_instance_leases(p_worker_id text, p_lease_secs integer DEFAULT 60)
 RETURNS TABLE(out_instance_id uuid, out_lease_seq bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE whatsapp.worker_instance_leases l
     SET leased_until = now() + make_interval(secs => p_lease_secs),
         renewed_at   = now()
   WHERE l.worker_id = p_worker_id;

  RETURN QUERY
    SELECT l.instance_id, l.lease_seq
      FROM whatsapp.worker_instance_leases l
     WHERE l.worker_id = p_worker_id;
END;
$function$;
revoke all on function whatsapp.worker_renew_instance_leases(text, integer) from public;
grant execute on function whatsapp.worker_renew_instance_leases(text, integer) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.worker_release_instance_leases(p_worker_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_released int;
BEGIN
  DELETE FROM whatsapp.worker_instance_leases WHERE worker_id = p_worker_id;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$function$;
revoke all on function whatsapp.worker_release_instance_leases(text) from public;
grant execute on function whatsapp.worker_release_instance_leases(text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.worker_heartbeat(p_worker_id text, p_hostname text, p_version text, p_active_numbers integer, p_queue_depth integer, p_dispatching_count integer, p_drain_rate_1m real, p_last_dispatch_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO whatsapp.worker_health
    (worker_id, hostname, version, started_at, last_heartbeat_at,
     active_numbers, queue_depth, dispatching_count, drain_rate_1m,
     last_dispatch_at, notes)
  VALUES
    (p_worker_id, p_hostname, p_version, now(), now(),
     p_active_numbers, p_queue_depth, p_dispatching_count, p_drain_rate_1m,
     p_last_dispatch_at, p_notes)
  ON CONFLICT (worker_id) DO UPDATE SET
    hostname=EXCLUDED.hostname, version=EXCLUDED.version,
    last_heartbeat_at=EXCLUDED.last_heartbeat_at,
    active_numbers=EXCLUDED.active_numbers, queue_depth=EXCLUDED.queue_depth,
    dispatching_count=EXCLUDED.dispatching_count, drain_rate_1m=EXCLUDED.drain_rate_1m,
    last_dispatch_at=EXCLUDED.last_dispatch_at, notes=EXCLUDED.notes;
END;
$function$;
revoke all on function whatsapp.worker_heartbeat(text, text, text, integer, integer, integer, real, timestamp with time zone, jsonb) from public;
grant execute on function whatsapp.worker_heartbeat(text, text, text, integer, integer, integer, real, timestamp with time zone, jsonb) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.assign_conversation(p_conversation_id uuid, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
  v_added uuid[]   := '{}';
  v_removed uuid[] := '{}';
  v_uid uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = p_conversation_id)) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv FROM whatsapp.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_conv.is_group AND COALESCE(array_length(p_user_ids,1),0) > 1 THEN
    RAISE EXCEPTION 'dm_singleton_violation' USING ERRCODE = '22023';
  END IF;

  -- compute diff
  SELECT array_agg(u) INTO v_removed FROM (
    SELECT user_id u FROM whatsapp.conversation_assignments
     WHERE conversation_id = p_conversation_id
    EXCEPT
    SELECT unnest(p_user_ids)
  ) s;

  SELECT array_agg(u) INTO v_added FROM (
    SELECT unnest(p_user_ids) u
    EXCEPT
    SELECT user_id FROM whatsapp.conversation_assignments
     WHERE conversation_id = p_conversation_id
  ) s;

  -- apply
  DELETE FROM whatsapp.conversation_assignments
   WHERE conversation_id = p_conversation_id
     AND user_id = ANY(COALESCE(v_removed, ARRAY[]::uuid[]));

  IF v_added IS NOT NULL THEN
    FOREACH v_uid IN ARRAY v_added LOOP
      INSERT INTO whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
      VALUES (p_conversation_id, v_uid, auth.uid(), v_conv.is_group);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'added',   COALESCE(v_added,   '{}'::uuid[]),
    'removed', COALESCE(v_removed, '{}'::uuid[])
  );
END;
$function$;
revoke all on function whatsapp.assign_conversation(uuid, uuid[]) from public;
grant execute on function whatsapp.assign_conversation(uuid, uuid[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp.unassign_conversation(p_conversation_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = p_conversation_id)) AND p_user_id <> v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM whatsapp.conversation_assignments
   WHERE conversation_id = p_conversation_id AND user_id = p_user_id;

  RETURN jsonb_build_object('removed', FOUND);
END;
$function$;
revoke all on function whatsapp.unassign_conversation(uuid, uuid) from public;
grant execute on function whatsapp.unassign_conversation(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp.claim_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv FROM whatsapp.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_conv.is_group THEN
    -- DM: claim only if unassigned
    IF EXISTS (SELECT 1 FROM whatsapp.conversation_assignments WHERE conversation_id = p_conversation_id) THEN
      RAISE EXCEPTION 'dm_already_assigned' USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
  VALUES (p_conversation_id, v_uid, v_uid, v_conv.is_group)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('claimed', true, 'user_id', v_uid);
END;
$function$;
revoke all on function whatsapp.claim_conversation(uuid) from public;
grant execute on function whatsapp.claim_conversation(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_assign_conversations(p_user_id uuid, p_conversation_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM whatsapp.conversations c
    WHERE c.id = ANY (p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;
  WITH ins AS (
    INSERT INTO whatsapp.conversation_assignments (conversation_id, user_id, assigned_by)
    SELECT unnest(p_conversation_ids), p_user_id, auth.uid()
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$function$;
revoke all on function whatsapp.admin_assign_conversations(uuid, uuid[]) from public;
grant execute on function whatsapp.admin_assign_conversations(uuid, uuid[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION whatsapp.admin_unassign_conversations(p_user_id uuid, p_conversation_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM whatsapp.conversations c
    WHERE c.id = ANY(p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;
  WITH del AS (
    DELETE FROM whatsapp.conversation_assignments
    WHERE user_id = p_user_id AND conversation_id = ANY(p_conversation_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END;
$function$;
revoke all on function whatsapp.admin_unassign_conversations(uuid, uuid[]) from public;
grant execute on function whatsapp.admin_unassign_conversations(uuid, uuid[]) to authenticated, service_role;

