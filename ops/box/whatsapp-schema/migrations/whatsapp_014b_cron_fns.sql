-- whatsapp_014b_cron_fns.sql  (Wave 14b) — the 11 _cron_* maintenance fn bodies
-- Ported via workflow (wf_a0517b08-7a3) + adversarial-verify. INERT: nothing scheduled here;
-- cron.schedule happens in 14c (activation) after explicit owner GO.
set check_function_bodies = off;


CREATE OR REPLACE FUNCTION whatsapp._cron_consolidate_split_conversations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM whatsapp.conversations
     WHERE remote_jid LIKE '%@lid' AND merged_into IS NULL AND is_group = false
  LOOP
    BEGIN
      PERFORM whatsapp.consolidate_lid_conversation(r.id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_consolidate_split_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_consolidate_split_conversations() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_lifecycle_auto_promote()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_promoted     int := 0;
  v_eligible_ids uuid[];
  v_id           uuid;
BEGIN
  -- Find instances eligible for promotion
  SELECT array_agg(i.id) INTO v_eligible_ids
    FROM whatsapp.whatsapp_instances i
   WHERE i.lifecycle_state = 'warming'
     AND i.worker_paused = false
     AND i.paired_at IS NOT NULL
     AND i.paired_at < now() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM whatsapp.audit_log a
        WHERE a.event_type = 'message.dead'
          AND a.occurred_at > now() - interval '7 days'
          AND (a.payload->>'number_id')::uuid = i.id
     );

  IF v_eligible_ids IS NULL OR array_length(v_eligible_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'eligible', 0);
  END IF;

  FOREACH v_id IN ARRAY v_eligible_ids LOOP
    UPDATE whatsapp.whatsapp_instances
       SET lifecycle_state = 'established',
           updated_at = now()
     WHERE id = v_id
       AND lifecycle_state = 'warming';

    IF FOUND THEN
      v_promoted := v_promoted + 1;
      PERFORM whatsapp.audit(
        'instance.lifecycle_auto_promoted',
        'whatsapp_instance',
        v_id::text,
        jsonb_build_object(
          'from', 'warming',
          'to',   'established',
          'reason', '30d clean (no message.dead events in last 7d)'
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'eligible', array_length(v_eligible_ids, 1)
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_lifecycle_auto_promote() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_lifecycle_auto_promote() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_outbound_queue_cleanup()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_deleted bigint;
BEGIN
  DELETE FROM whatsapp.outbound_queue
  WHERE status IN ('sent','cancelled')
    AND completed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    PERFORM whatsapp.audit('outbound_queue_pruned', 'outbound_queue', NULL,
      jsonb_build_object('rows_deleted', v_deleted));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_outbound_queue_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_outbound_queue_cleanup() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_prune_host_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from whatsapp.host_metrics where captured_at < now() - interval '14 days';
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_prune_host_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_prune_host_metrics() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_prune_r2_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from whatsapp.r2_metrics where sampled_at < now() - interval '30 days';
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_prune_r2_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_prune_r2_metrics() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_prune_system_logs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from whatsapp.system_logs where occurred_at < now() - interval '14 days';
end
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_prune_system_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_prune_system_logs() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_purge_metric_samples()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from whatsapp.metric_samples where captured_at < now() - interval '7 days';
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_purge_metric_samples() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_purge_metric_samples() TO anon;
GRANT EXECUTE ON FUNCTION whatsapp._cron_purge_metric_samples() TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp._cron_purge_metric_samples() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_reclaim_stale_dispatching()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_reclaimed bigint;
BEGIN
  UPDATE whatsapp.outbound_queue
  SET status     = 'queued',
      not_before = now() + interval '30 seconds',
      error      = coalesce(error || ' | ', '') || 'reclaimed: stale dispatching at ' || now()::text
  WHERE status = 'dispatching'
    AND dispatched_at < now() - interval '5 minutes';
  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  IF v_reclaimed > 0 THEN
    PERFORM whatsapp.audit('outbound_queue_reclaimed', 'outbound_queue', NULL,
      jsonb_build_object('rows_reclaimed', v_reclaimed));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_reclaim_stale_dispatching() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_reclaim_stale_dispatching() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_scheduled_messages_drain()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sm            record;
  v_conv          whatsapp.conversations;
  v_msg_id        uuid;
  v_step          jsonb;
  v_step_type     text;
  v_kind          whatsapp.message_kind;
  v_is_audio      boolean;
  v_ptt           boolean;
  v_att_meta      jsonb;
  v_processed     int := 0;
  v_failed        int := 0;
  v_due_ids       uuid[];
  v_now           timestamptz;
  v_prev_kind     whatsapp.message_kind;
  v_prev_body_ct  bytea;
  v_prev_meta     jsonb;
  v_have_preview  boolean;
BEGIN
  SELECT array_agg(id) INTO v_due_ids
    FROM (
      SELECT id
        FROM whatsapp.scheduled_messages
       WHERE status = 'pending'
         AND scheduled_at <= now()
       ORDER BY scheduled_at
       LIMIT 200
    ) due;

  IF v_due_ids IS NULL OR array_length(v_due_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('processed', 0, 'failed', 0);
  END IF;

  FOR v_sm IN
    SELECT * FROM whatsapp.scheduled_messages WHERE id = ANY(v_due_ids)
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF v_sm.status <> 'pending' THEN
        CONTINUE;
      END IF;

      v_now          := now();
      v_have_preview := false;
      v_prev_kind    := NULL;
      v_prev_body_ct := NULL;
      v_prev_meta    := NULL;

      SELECT * INTO v_conv FROM whatsapp.conversations WHERE id = v_sm.conversation_id;
      IF v_conv.id IS NULL THEN
        UPDATE whatsapp.scheduled_messages
           SET status = 'failed', failure_reason = 'conversation_not_found', updated_at = now()
         WHERE id = v_sm.id;
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      IF jsonb_typeof(v_sm.steps) = 'array' THEN
        FOR v_step IN SELECT value FROM jsonb_array_elements(v_sm.steps) LOOP
          v_step_type := v_step->>'type';

          IF v_step_type = 'text' THEN
            -- Skip blank text nodes (defensive; the UI shouldn't save them).
            IF v_step->>'body' IS NULL OR length(trim(v_step->>'body')) = 0 THEN
              CONTINUE;
            END IF;

            v_msg_id := gen_random_uuid();
            INSERT INTO whatsapp.messages (
              id, conversation_id, instance_id, direction, kind,
              body_ciphertext, whatsapp_timestamp, delivery_status, sent_by_agent_id
            ) VALUES (
              v_msg_id, v_sm.conversation_id, v_sm.instance_id, 'outbound', 'text',
              whatsapp.encrypt_text(v_step->>'body'),
              v_now, 'PENDING', v_sm.created_by
            );
            INSERT INTO whatsapp.outbound_queue (
              number_id, conversation_id, agent_id, action_type, payload,
              status, priority, not_before, origin
            ) VALUES (
              v_sm.instance_id, v_sm.conversation_id, v_sm.created_by, 'send_text',
              jsonb_build_object(
                'message_id',           v_msg_id,
                'remote_jid',           v_conv.remote_jid,
                'kind',                 'text',
                'reply_to_message_id',  NULL,
                'ptt',                  false,
                'is_forward',           false,
                'forward_score',        0,
                'poll_options',         NULL,
                'source',               'scheduled_message',
                'scheduled_message_id', v_sm.id
              ),
              'queued', 100, v_now, 'scheduled'::whatsapp.outbound_origin
            );

            v_prev_kind    := 'text'::whatsapp.message_kind;
            v_prev_body_ct := whatsapp.encrypt_text(v_step->>'body');
            v_prev_meta    := NULL;
            v_have_preview := true;

          ELSE
            -- media node: map node type → message kind + ptt
            v_is_audio := v_step_type IN ('voice', 'audio_file');
            v_ptt      := (v_step_type = 'voice');
            v_kind     := CASE v_step_type
              WHEN 'image'      THEN 'image'
              WHEN 'video'      THEN 'video'
              WHEN 'document'   THEN 'document'
              WHEN 'voice'      THEN 'audio'
              WHEN 'audio_file' THEN 'audio'
              ELSE 'document'
            END::whatsapp.message_kind;

            v_att_meta := jsonb_strip_nulls(jsonb_build_object(
              'fileName', v_step->>'file_name',
              'ptt',      CASE WHEN v_is_audio THEN v_ptt ELSE NULL END,
              'seconds',  CASE WHEN v_is_audio THEN NULLIF(v_step->>'seconds', '')::numeric ELSE NULL END
            ));

            v_msg_id := gen_random_uuid();
            INSERT INTO whatsapp.messages (
              id, conversation_id, instance_id, direction, kind,
              media_storage_bucket, media_storage_key, media_mime, media_size_bytes,
              media_meta, whatsapp_timestamp, delivery_status, sent_by_agent_id
            ) VALUES (
              v_msg_id, v_sm.conversation_id, v_sm.instance_id, 'outbound', v_kind,
              COALESCE(v_step->>'r2_bucket', 'wamancer-media'),
              v_step->>'r2_key',
              v_step->>'mime',
              NULLIF(v_step->>'size_bytes', '')::bigint,
              v_att_meta,
              v_now, 'PENDING', v_sm.created_by
            );
            INSERT INTO whatsapp.outbound_queue (
              number_id, conversation_id, agent_id, action_type, payload,
              status, priority, not_before, origin
            ) VALUES (
              v_sm.instance_id, v_sm.conversation_id, v_sm.created_by, 'send_media',
              jsonb_build_object(
                'message_id',           v_msg_id,
                'remote_jid',           v_conv.remote_jid,
                'kind',                 v_kind::text,
                'reply_to_message_id',  NULL,
                'ptt',                  v_ptt,
                'is_forward',           false,
                'forward_score',        0,
                'poll_options',         NULL,
                'source',               'scheduled_message',
                'scheduled_message_id', v_sm.id
              ),
              'queued', 100, v_now, 'scheduled'::whatsapp.outbound_origin
            );

            v_prev_kind    := v_kind;
            v_prev_body_ct := NULL;
            v_prev_meta    := v_att_meta;
            v_have_preview := true;
          END IF;
        END LOOP;
      END IF;

      IF v_have_preview THEN
        UPDATE whatsapp.conversations
           SET last_message_at          = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_now),
               last_message_preview_ct   = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                                THEN v_prev_body_ct ELSE last_message_preview_ct END,
               last_message_kind         = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                                THEN v_prev_kind ELSE last_message_kind END,
               last_message_direction    = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                                THEN 'outbound'::whatsapp.message_direction ELSE last_message_direction END,
               last_message_sender_name  = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                                THEN NULL ELSE last_message_sender_name END,
               last_message_media_meta   = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                                THEN v_prev_meta ELSE last_message_media_meta END
         WHERE id = v_sm.conversation_id;
      END IF;

      UPDATE whatsapp.scheduled_messages
         SET status = 'sent', sent_at = now(), updated_at = now()
       WHERE id = v_sm.id;

      v_processed := v_processed + 1;

      PERFORM whatsapp.audit(
        'scheduled_message.dispatched',
        'scheduled_message',
        v_sm.id::text,
        jsonb_build_object(
          'conversation_id', v_sm.conversation_id,
          'instance_id',     v_sm.instance_id,
          'scheduled_at',    v_sm.scheduled_at,
          'sent_at',         now(),
          'step_count',      COALESCE(jsonb_array_length(v_sm.steps), 0)
        )
      );

    EXCEPTION WHEN OTHERS THEN
      UPDATE whatsapp.scheduled_messages
         SET status = 'failed', failure_reason = SQLERRM, updated_at = now()
       WHERE id = v_sm.id;
      v_failed := v_failed + 1;
      PERFORM whatsapp.audit(
        'scheduled_message.failed',
        'scheduled_message',
        v_sm.id::text,
        jsonb_build_object('error', SQLERRM)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_scheduled_messages_drain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_scheduled_messages_drain() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_unpin_expired_messages()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE whatsapp.messages
     SET is_pinned = false, pinned_at = NULL, pinned_by = NULL, pin_expires_at = NULL
   WHERE is_pinned = true
     AND pin_expires_at IS NOT NULL
     AND pin_expires_at <= now();
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_unpin_expired_messages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_unpin_expired_messages() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_worker_health_alert()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT worker_id, hostname, last_heartbeat_at,
           EXTRACT(EPOCH FROM (now() - last_heartbeat_at))::int AS seconds_since
    FROM whatsapp.worker_health
    WHERE last_heartbeat_at < now() - interval '60 seconds'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM whatsapp.audit_log
      WHERE event_type = 'worker_heartbeat_stale'
        AND target_id  = r.worker_id
        AND occurred_at > now() - interval '60 seconds'
    ) THEN
      PERFORM whatsapp.audit('worker_heartbeat_stale', 'worker', r.worker_id,
        jsonb_build_object('hostname', r.hostname, 'seconds_since', r.seconds_since, 'last_heartbeat_at', r.last_heartbeat_at));
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._cron_worker_health_alert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_worker_health_alert() TO service_role;

