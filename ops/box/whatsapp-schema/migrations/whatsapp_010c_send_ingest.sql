-- whatsapp_010c_send_ingest.sql  (Wave 10c) — send/ingest/message-op RPCs
-- 24 fns ported via port+adversarial-verify workflow; assembled from JSON. check_function_bodies=off
-- for order-independence (behaviour proven by rehearsal). Missing helper(s) prepended by hand below header.
set check_function_bodies = off;

-- Missing helper (referenced by ensure_conversation + ingest_message; calls whatsapp._resolve_lid_to_phone from 10b).
create or replace function whatsapp._canonical_remote_jid(p_instance_id uuid, p_raw_jid text)
returns text language sql stable security definer set search_path to '' as $function$
  select case when p_raw_jid like '%@lid'
    then coalesce(whatsapp._resolve_lid_to_phone(p_instance_id, p_raw_jid), p_raw_jid)
    else p_raw_jid end;
$function$;
revoke all on function whatsapp._canonical_remote_jid(uuid, text) from public;
grant  execute on function whatsapp._canonical_remote_jid(uuid, text) to service_role;

CREATE OR REPLACE FUNCTION whatsapp._assert_conversation_access(p_conversation_id uuid)
 RETURNS whatsapp.conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_conv FROM whatsapp.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT whatsapp.is_wa_admin(v_conv.instance_id) AND NOT EXISTS (
    SELECT 1 FROM whatsapp.conversation_assignments ca
    WHERE ca.conversation_id = p_conversation_id AND ca.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden_not_assigned' USING ERRCODE = '42501';
  END IF;
  RETURN v_conv;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp._assert_conversation_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._assert_conversation_access(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.ensure_conversation(p_instance_id uuid, p_remote_jid text, p_peer_display_name text DEFAULT NULL::text, p_peer_profile_pic text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_norm_jid text; v_contact_id uuid;
BEGIN
  IF NOT whatsapp.is_wa_admin(p_instance_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_instance_id IS NULL OR p_remote_jid IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  v_norm_jid := trim(p_remote_jid);
  IF v_norm_jid = '' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_norm_jid = 'status@broadcast' OR v_norm_jid LIKE '%@broadcast' OR v_norm_jid LIKE '%@newsletter' THEN
    RAISE EXCEPTION 'pseudo_chat_jid';
  END IF;
  v_norm_jid := whatsapp._canonical_remote_jid(p_instance_id, v_norm_jid);
  IF NOT EXISTS (SELECT 1 FROM whatsapp.whatsapp_instances WHERE id = p_instance_id) THEN
    RAISE EXCEPTION 'instance_not_found';
  END IF;
  SELECT whatsapp.chase_merged_into(id) INTO v_contact_id FROM whatsapp.contacts
    WHERE instance_id = p_instance_id AND merged_into IS NULL AND (phone_jid = v_norm_jid OR lid = v_norm_jid)
    ORDER BY (phone_jid = v_norm_jid) DESC LIMIT 1;
  SELECT id INTO v_id FROM whatsapp.conversations
    WHERE instance_id = p_instance_id AND remote_jid = v_norm_jid LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE whatsapp.conversations SET peer_display_name = COALESCE(peer_display_name, p_peer_display_name),
      peer_profile_pic = COALESCE(peer_profile_pic, p_peer_profile_pic),
      contact_id = COALESCE(contact_id, v_contact_id), updated_at = now() WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO whatsapp.conversations (instance_id, remote_jid, peer_display_name, peer_profile_pic,
    contact_id, status, unread_count, is_pinned, is_archived)
  VALUES (p_instance_id, v_norm_jid, NULLIF(trim(coalesce(p_peer_display_name, '')), ''),
    NULLIF(trim(coalesce(p_peer_profile_pic, '')), ''), v_contact_id, 'open'::whatsapp.conversation_status, 0, false, false)
  RETURNING id INTO v_id;
  PERFORM whatsapp.audit('conversation.created_manual', 'conversation', v_id::text,
    jsonb_build_object('conversation_id', v_id, 'remote_jid', v_norm_jid));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.ensure_conversation(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.ensure_conversation(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.ensure_conversation(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.ingest_message(p_instance_id uuid, p_remote_jid text, p_evolution_message_id text, p_direction whatsapp.message_direction, p_kind whatsapp.message_kind, p_body text, p_media_meta jsonb, p_reply_to text, p_sender_jid text, p_whatsapp_ts timestamp with time zone, p_delivery_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_conv_id uuid; v_msg_id uuid; v_body_ct bytea; v_is_live boolean; v_reply_id uuid; v_remote_jid text; v_contact_id uuid;
BEGIN
  v_remote_jid := whatsapp._canonical_remote_jid(p_instance_id, p_remote_jid);
  IF v_remote_jid NOT LIKE '%@g.us' THEN
    SELECT whatsapp.chase_merged_into(id) INTO v_contact_id FROM whatsapp.contacts
      WHERE instance_id = p_instance_id AND merged_into IS NULL AND (phone_jid = v_remote_jid OR lid = v_remote_jid)
      ORDER BY (phone_jid = v_remote_jid) DESC LIMIT 1;
  END IF;
  INSERT INTO whatsapp.conversations (instance_id, remote_jid, contact_id)
  VALUES (p_instance_id, v_remote_jid, v_contact_id)
  ON CONFLICT (instance_id, remote_jid) DO UPDATE
    SET updated_at = now(), contact_id = COALESCE(whatsapp.conversations.contact_id, EXCLUDED.contact_id)
  RETURNING id INTO v_conv_id;
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id FROM whatsapp.conversations WHERE instance_id = p_instance_id AND remote_jid = v_remote_jid;
  END IF;
  IF p_reply_to IS NOT NULL AND p_reply_to <> '' THEN
    SELECT id INTO v_reply_id FROM whatsapp.messages
      WHERE instance_id = p_instance_id AND evolution_message_id = p_reply_to LIMIT 1;
  END IF;
  v_body_ct := CASE WHEN p_body IS NULL THEN NULL ELSE whatsapp.encrypt_text(p_body) END;
  INSERT INTO whatsapp.messages (conversation_id, instance_id, evolution_message_id, direction, kind,
    body_ciphertext, media_meta, reply_to_message_id, sender_jid, whatsapp_timestamp, delivery_status)
  VALUES (v_conv_id, p_instance_id, p_evolution_message_id, p_direction, p_kind,
    v_body_ct, p_media_meta, v_reply_id, p_sender_jid, p_whatsapp_ts, p_delivery_status)
  ON CONFLICT (instance_id, evolution_message_id) DO NOTHING RETURNING id INTO v_msg_id;
  IF v_msg_id IS NOT NULL THEN
    v_is_live := p_whatsapp_ts >= now() - interval '2 minutes';
    UPDATE whatsapp.conversations
      SET last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), p_whatsapp_ts),
          last_message_preview_ct = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN v_body_ct ELSE last_message_preview_ct END,
          last_message_kind = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_kind ELSE last_message_kind END,
          last_message_direction = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_direction ELSE last_message_direction END,
          last_message_sender_name = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_media_meta->>'pushName' ELSE last_message_sender_name END,
          last_message_media_meta = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_media_meta ELSE last_message_media_meta END,
          unread_count = CASE WHEN p_direction = 'inbound' AND v_is_live THEN unread_count + 1 ELSE unread_count END
      WHERE id = v_conv_id;
  END IF;
  RETURN v_msg_id;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.ingest_message(uuid, text, text, whatsapp.message_direction, whatsapp.message_kind, text, jsonb, text, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.ingest_message(uuid, text, text, whatsapp.message_direction, whatsapp.message_kind, text, jsonb, text, text, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.ingest_message(p_instance_id uuid, p_remote_jid text, p_evolution_message_id text, p_direction whatsapp.message_direction, p_kind whatsapp.message_kind, p_body text, p_media_meta jsonb, p_reply_to uuid, p_sender_jid text, p_whatsapp_ts timestamp with time zone, p_delivery_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_conv_id uuid; v_msg_id uuid; v_body_ct bytea; v_is_live boolean; v_remote_jid text; v_contact_id uuid;
BEGIN
  v_remote_jid := whatsapp._canonical_remote_jid(p_instance_id, p_remote_jid);
  IF v_remote_jid NOT LIKE '%@g.us' THEN
    SELECT whatsapp.chase_merged_into(id) INTO v_contact_id FROM whatsapp.contacts
      WHERE instance_id = p_instance_id AND merged_into IS NULL AND (phone_jid = v_remote_jid OR lid = v_remote_jid)
      ORDER BY (phone_jid = v_remote_jid) DESC LIMIT 1;
  END IF;
  INSERT INTO whatsapp.conversations (instance_id, remote_jid, contact_id)
  VALUES (p_instance_id, v_remote_jid, v_contact_id)
  ON CONFLICT (instance_id, remote_jid) DO UPDATE
    SET updated_at = now(), contact_id = COALESCE(whatsapp.conversations.contact_id, EXCLUDED.contact_id)
  RETURNING id INTO v_conv_id;
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id FROM whatsapp.conversations WHERE instance_id = p_instance_id AND remote_jid = v_remote_jid;
  END IF;
  v_body_ct := CASE WHEN p_body IS NULL THEN NULL ELSE whatsapp.encrypt_text(p_body) END;
  INSERT INTO whatsapp.messages (conversation_id, instance_id, evolution_message_id, direction, kind,
    body_ciphertext, media_meta, reply_to_message_id, sender_jid, whatsapp_timestamp, delivery_status)
  VALUES (v_conv_id, p_instance_id, p_evolution_message_id, p_direction, p_kind,
    v_body_ct, p_media_meta, p_reply_to, p_sender_jid, p_whatsapp_ts, p_delivery_status)
  ON CONFLICT (instance_id, evolution_message_id) DO NOTHING RETURNING id INTO v_msg_id;
  IF v_msg_id IS NOT NULL THEN
    v_is_live := p_whatsapp_ts >= now() - interval '2 minutes';
    UPDATE whatsapp.conversations
      SET last_message_at = greatest(coalesce(last_message_at, '-infinity'::timestamptz), p_whatsapp_ts),
          last_message_preview_ct = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN v_body_ct ELSE last_message_preview_ct END,
          last_message_kind = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_kind ELSE last_message_kind END,
          last_message_direction = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_direction ELSE last_message_direction END,
          last_message_sender_name = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_media_meta->>'pushName' ELSE last_message_sender_name END,
          last_message_media_meta = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= p_whatsapp_ts THEN p_media_meta ELSE last_message_media_meta END,
          unread_count = CASE WHEN p_direction = 'inbound' AND v_is_live THEN unread_count + 1 ELSE unread_count END
      WHERE id = v_conv_id;
  END IF;
  RETURN v_msg_id;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.ingest_message(uuid, text, text, whatsapp.message_direction, whatsapp.message_kind, text, jsonb, uuid, text, timestamp with time zone, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.ingest_message(uuid, text, text, whatsapp.message_direction, whatsapp.message_kind, text, jsonb, uuid, text, timestamp with time zone, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.apply_reaction(p_instance_id uuid, p_remote_jid text, p_target_evo_id text, p_emoji text, p_sender_jid text, p_whatsapp_ts timestamp with time zone, p_is_from_me boolean DEFAULT false, p_sender_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv_id  uuid;
  v_target   uuid;
  v_existing jsonb;
BEGIN
  SELECT id INTO v_conv_id
  FROM whatsapp.conversations
  WHERE instance_id = p_instance_id AND remote_jid = p_remote_jid;

  IF v_conv_id IS NULL THEN RETURN; END IF;

  SELECT id, reactions INTO v_target, v_existing
  FROM whatsapp.messages
  WHERE conversation_id = v_conv_id
    AND evolution_message_id = p_target_evo_id
  LIMIT 1;

  IF v_target IS NULL THEN RETURN; END IF;

  IF v_existing IS NULL THEN v_existing := '[]'::jsonb; END IF;

  IF p_emoji IS NULL OR p_emoji = '' THEN
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_existing
    FROM jsonb_array_elements(v_existing) AS elem
    WHERE elem->>'senderJid' IS DISTINCT FROM COALESCE(p_sender_jid, 'unknown');
  ELSE
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_existing
    FROM jsonb_array_elements(v_existing) AS elem
    WHERE elem->>'senderJid' IS DISTINCT FROM COALESCE(p_sender_jid, 'unknown');

    v_existing := v_existing || jsonb_build_array(jsonb_build_object(
      'emoji', p_emoji,
      'senderJid', COALESCE(p_sender_jid, 'unknown'),
      'timestamp', p_whatsapp_ts
    ));

    UPDATE whatsapp.conversations
    SET last_message_kind        = 'reaction'::whatsapp.message_kind,
        last_message_direction   = (CASE WHEN p_is_from_me THEN 'outbound' ELSE 'inbound' END)::whatsapp.message_direction,
        last_message_sender_name = p_sender_name,
        last_message_media_meta  = jsonb_build_object('emoji', p_emoji),
        last_message_preview_ct  = NULL,
        last_message_at          = p_whatsapp_ts
    WHERE id = v_conv_id;
  END IF;

  UPDATE whatsapp.messages SET reactions = v_existing WHERE id = v_target;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.apply_reaction(uuid, text, text, text, text, timestamp with time zone, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.apply_reaction(uuid, text, text, text, text, timestamp with time zone, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.append_group_system_event(p_instance_id uuid, p_remote_jid text, p_body text, p_media_meta jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv_id     uuid;
  v_msg_id      uuid;
  v_event       text := coalesce(p_media_meta->>'event', '');
  v_actor       text := regexp_replace(coalesce(p_media_meta->>'actor_jid',''), '[^0-9]', '', 'g');
  v_targets     text;
  v_canonical   text;
  v_key         uuid;
  v_existing    uuid;
  v_body_ct     bytea;
  v_now         timestamptz := now();
BEGIN
  IF p_remote_jid IS NULL OR right(p_remote_jid, 5) <> '@g.us' THEN
    RAISE EXCEPTION 'not_a_group_jid' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_conv_id FROM whatsapp.conversations
    WHERE instance_id = p_instance_id AND remote_jid = p_remote_jid;
  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT string_agg(d, ',' ORDER BY d) INTO v_targets
  FROM (
    SELECT regexp_replace(jt::text, '[^0-9]', '', 'g') AS d
    FROM jsonb_array_elements_text(coalesce(p_media_meta->'target_jids','[]'::jsonb)) AS jt
  ) s
  WHERE d <> '';
  v_targets := coalesce(v_targets, '');

  -- Dedup guard: actor-agnostic (event, targets) within a SHORT 60s window —
  -- just long enough to merge an optimistic edge-fn write with its webhook echo.
  SELECT id INTO v_existing
  FROM whatsapp.messages
  WHERE conversation_id = v_conv_id
    AND kind = 'system'
    AND media_meta->>'subtype' = 'group_event'
    AND coalesce(media_meta->>'event','') = v_event
    AND created_at >= v_now - interval '60 seconds'
    AND coalesce((
      SELECT string_agg(d, ',' ORDER BY d)
      FROM (SELECT regexp_replace(jt::text,'[^0-9]','','g') AS d
            FROM jsonb_array_elements_text(coalesce(media_meta->'target_jids','[]'::jsonb)) jt) s2
      WHERE d <> ''), '') = v_targets
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_canonical := p_instance_id::text || '|' || p_remote_jid || '|' || v_event
                 || '|' || v_targets || '|' || v_actor
                 || '|' || floor(extract(epoch FROM v_now) / 60)::text;
  v_key := md5(v_canonical)::uuid;

  v_body_ct := CASE WHEN p_body IS NULL OR p_body = '' THEN NULL ELSE whatsapp.encrypt_text(p_body) END;

  INSERT INTO whatsapp.messages (
    conversation_id, instance_id, evolution_message_id, direction, kind,
    body_ciphertext, media_meta, whatsapp_timestamp, delivery_status, idempotency_key
  )
  VALUES (
    v_conv_id, p_instance_id, NULL, 'outbound', 'system',
    v_body_ct, p_media_meta, v_now, NULL, v_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_msg_id;

  IF v_msg_id IS NULL THEN
    SELECT id INTO v_msg_id FROM whatsapp.messages
      WHERE idempotency_key = v_key LIMIT 1;
    RETURN v_msg_id;
  END IF;

  UPDATE whatsapp.conversations
    SET last_message_at          = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_now),
        last_message_preview_ct  = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN v_body_ct ELSE last_message_preview_ct END,
        last_message_kind        = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN 'system'::whatsapp.message_kind ELSE last_message_kind END,
        last_message_direction   = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN 'outbound'::whatsapp.message_direction ELSE last_message_direction END,
        last_message_media_meta  = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN p_media_meta ELSE last_message_media_meta END
    WHERE id = v_conv_id;

  RETURN v_msg_id;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.append_group_system_event(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.append_group_system_event(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.send_message(p_conversation_id uuid, p_body text DEFAULT NULL::text, p_kind whatsapp.message_kind DEFAULT 'text'::whatsapp.message_kind, p_reply_to uuid DEFAULT NULL::uuid, p_media_storage_key text DEFAULT NULL::text, p_media_storage_bucket text DEFAULT 'wamancer-media'::text, p_media_mime text DEFAULT NULL::text, p_media_size_bytes bigint DEFAULT NULL::bigint, p_media_meta jsonb DEFAULT NULL::jsonb, p_ptt boolean DEFAULT false, p_forward_from uuid DEFAULT NULL::uuid, p_poll_options jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid, p_origin whatsapp.outbound_origin DEFAULT 'interactive'::whatsapp.outbound_origin)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv          whatsapp.conversations;
  v_uid           uuid := auth.uid();
  v_message_id    uuid := gen_random_uuid();
  v_queue_id      uuid;
  v_action_type   whatsapp.outbound_action_type;
  v_forward_score smallint := 0;
  v_src_dir       whatsapp.message_direction;
  v_src_fwd       boolean := false;
  v_is_forwarded  boolean := false;
  v_existing      record;
  v_body_ct       bytea;
  v_now           timestamptz := now();
BEGIN
  v_conv := whatsapp._assert_conversation_access(p_conversation_id);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT m.id AS message_id, q.id AS queue_id, m.delivery_status, m.created_at AS enqueued_at
      INTO v_existing
      FROM whatsapp.messages m
      LEFT JOIN whatsapp.outbound_queue q
        ON q.conversation_id = m.conversation_id
       AND (q.payload->>'message_id')::uuid = m.id
     WHERE m.idempotency_key = p_idempotency_key
       AND m.conversation_id = p_conversation_id
     ORDER BY q.enqueued_at DESC NULLS LAST
     LIMIT 1;
    IF v_existing.message_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'message_id',  v_existing.message_id,
        'queue_id',    v_existing.queue_id,
        'enqueued_at', v_existing.enqueued_at,
        'status',      COALESCE(v_existing.delivery_status, 'PENDING'),
        'duplicate',   true
      );
    END IF;
  END IF;

  IF p_kind = 'text' AND (p_body IS NULL OR length(p_body) = 0) THEN
    RAISE EXCEPTION 'text_body_required' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'poll' AND (p_poll_options IS NULL OR jsonb_typeof(p_poll_options) <> 'array' OR jsonb_array_length(p_poll_options) < 2) THEN
    RAISE EXCEPTION 'poll_requires_min_2_options' USING ERRCODE = '22023';
  END IF;
  IF p_kind IN ('image','video','audio','document','sticker') AND p_media_storage_key IS NULL THEN
    RAISE EXCEPTION 'media_storage_key_required_for_kind' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'contact' AND (p_media_meta IS NULL OR NOT (p_media_meta ? 'vcard' OR p_media_meta ? 'vcards')) THEN
    RAISE EXCEPTION 'contact_payload_required' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'poll' THEN
    v_action_type := 'send_poll';
  ELSIF p_kind IN ('image','video','audio','document','sticker') THEN
    v_action_type := 'send_media';
  ELSIF p_kind = 'contact' THEN
    v_action_type := 'send_contact';
  ELSE
    v_action_type := 'send_text';
  END IF;

  IF p_forward_from IS NOT NULL THEN
    SELECT direction, COALESCE(forwarding_score, 0), COALESCE(forwarded, false)
      INTO v_src_dir, v_forward_score, v_src_fwd
    FROM whatsapp.messages WHERE id = p_forward_from;
    v_is_forwarded := COALESCE(v_src_dir = 'inbound', false) OR v_src_fwd;
    IF v_is_forwarded THEN
      v_forward_score := LEAST(COALESCE(v_forward_score, 0) + 1, 127);
    ELSE
      v_forward_score := 0;
    END IF;
  END IF;

  v_body_ct := CASE WHEN p_body IS NULL OR p_body = '' THEN NULL ELSE whatsapp.encrypt_text(p_body) END;

  INSERT INTO whatsapp.messages (
    id, conversation_id, instance_id, evolution_message_id, direction, kind,
    body_ciphertext,
    media_storage_bucket, media_storage_key, media_mime, media_size_bytes,
    media_meta, reply_to_message_id, sender_jid,
    whatsapp_timestamp, delivery_status, sent_by_agent_id, forwarded, forwarding_score,
    idempotency_key
  ) VALUES (
    v_message_id, p_conversation_id, v_conv.instance_id, NULL, 'outbound', p_kind,
    v_body_ct,
    CASE WHEN p_media_storage_key IS NOT NULL THEN p_media_storage_bucket ELSE NULL END,
    p_media_storage_key, p_media_mime, p_media_size_bytes,
    p_media_meta, p_reply_to, NULL,
    v_now, 'PENDING', v_uid, v_is_forwarded, v_forward_score,
    p_idempotency_key
  );

  UPDATE whatsapp.conversations
     SET last_message_at         = greatest(coalesce(last_message_at, '-infinity'::timestamptz), v_now),
         last_message_preview_ct = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN v_body_ct ELSE last_message_preview_ct END,
         last_message_kind       = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN p_kind ELSE last_message_kind END,
         last_message_direction  = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN 'outbound'::whatsapp.message_direction ELSE last_message_direction END,
         last_message_sender_name = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN NULL ELSE last_message_sender_name END,
         last_message_media_meta = CASE WHEN coalesce(last_message_at, '-infinity'::timestamptz) <= v_now
                                        THEN p_media_meta ELSE last_message_media_meta END
   WHERE id = p_conversation_id;

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload, status, priority, not_before, origin
  ) VALUES (
    v_conv.instance_id, p_conversation_id, v_uid, v_action_type,
    jsonb_build_object(
      'message_id',          v_message_id,
      'remote_jid',          v_conv.remote_jid,
      'kind',                p_kind,
      'reply_to_message_id', p_reply_to,
      'ptt',                 p_ptt,
      'is_forward',          v_is_forwarded,
      'forward_score',       v_forward_score,
      'poll_options',        p_poll_options
    ),
    'queued', 100, v_now,
    CASE WHEN p_forward_from IS NOT NULL THEN 'forward'::whatsapp.outbound_origin
         ELSE COALESCE(p_origin, 'interactive'::whatsapp.outbound_origin) END
  )
  RETURNING id INTO v_queue_id;

  PERFORM whatsapp.audit('message.enqueued', 'message', v_message_id::text,
    jsonb_build_object('queue_id', v_queue_id, 'kind', p_kind, 'action_type', v_action_type,
                       'has_idempotency_key', p_idempotency_key IS NOT NULL));

  RETURN jsonb_build_object(
    'message_id',  v_message_id,
    'queue_id',    v_queue_id,
    'enqueued_at', v_now,
    'status',      'PENDING',
    'duplicate',   false
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.send_message(uuid, text, whatsapp.message_kind, uuid, text, text, text, bigint, jsonb, boolean, uuid, jsonb, uuid, whatsapp.outbound_origin) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.send_message(uuid, text, whatsapp.message_kind, uuid, text, text, text, bigint, jsonb, boolean, uuid, jsonb, uuid, whatsapp.outbound_origin) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.send_message(uuid, text, whatsapp.message_kind, uuid, text, text, text, bigint, jsonb, boolean, uuid, jsonb, uuid, whatsapp.outbound_origin) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.send_reaction(p_message_id uuid, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg       whatsapp.messages;
  v_conv      whatsapp.conversations;
  v_queue_id  uuid;
  v_owner_jid text;
BEGIN
  SELECT * INTO v_msg FROM whatsapp.messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.evolution_message_id IS NULL THEN
    RAISE EXCEPTION 'cannot_react_to_pending_message' USING ERRCODE = '22023';
  END IF;
  v_conv := whatsapp._assert_conversation_access(v_msg.conversation_id);

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload, status, priority, not_before
  ) VALUES (
    v_conv.instance_id, v_msg.conversation_id, auth.uid(), 'react',
    jsonb_build_object(
      'remote_jid',           v_conv.remote_jid,
      'evolution_message_id', v_msg.evolution_message_id,
      'emoji',                COALESCE(p_emoji, ''),
      'from_me',              v_msg.direction = 'outbound'
    ),
    'queued', 100, now()
  ) RETURNING id INTO v_queue_id;

  -- Optimistic local reflection (instant UI feedback + dedupe key for echoes).
  SELECT wa_owner_jid INTO v_owner_jid
    FROM whatsapp.whatsapp_instances WHERE id = v_conv.instance_id;

  PERFORM whatsapp.apply_reaction(
    v_conv.instance_id,
    v_conv.remote_jid,
    v_msg.evolution_message_id,
    COALESCE(p_emoji, ''),
    COALESCE(v_owner_jid, 'me@s.whatsapp.net'),
    now(),
    true,    -- p_is_from_me
    NULL     -- p_sender_name
  );

  -- A sent reaction is an outbound response → clear "awaiting reply".
  IF COALESCE(p_emoji, '') <> '' THEN
    UPDATE whatsapp.conversations
       SET last_outbound_at = now()
     WHERE id = v_msg.conversation_id;
  END IF;

  PERFORM whatsapp.audit('message.reaction_enqueued', 'message', p_message_id::text,
    jsonb_build_object('queue_id', v_queue_id, 'emoji', p_emoji));

  RETURN jsonb_build_object('queue_id', v_queue_id);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.send_reaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.send_reaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.send_reaction(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.send_read_receipt(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
  v_ids  text[];
  v_queue_id uuid;
BEGIN
  v_conv := whatsapp._assert_conversation_access(p_conversation_id);

  SELECT array_agg(evolution_message_id ORDER BY whatsapp_timestamp DESC)
    INTO v_ids
  FROM whatsapp.messages
  WHERE conversation_id = p_conversation_id
    AND direction = 'inbound'
    AND evolution_message_id IS NOT NULL
    AND (delivery_status IS DISTINCT FROM 'READ');

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN jsonb_build_object('queue_id', NULL, 'noop', true);
  END IF;

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload, status, priority, not_before
  ) VALUES (
    v_conv.instance_id, p_conversation_id, auth.uid(), 'mark_read',
    jsonb_build_object(
      'remote_jid',     v_conv.remote_jid,
      'message_ids',    to_jsonb(v_ids)
    ),
    'queued', 80, now()
  ) RETURNING id INTO v_queue_id;

  RETURN jsonb_build_object('queue_id', v_queue_id, 'count', array_length(v_ids,1));
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.send_read_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.send_read_receipt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.send_read_receipt(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.send_typing(p_conversation_id uuid, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
  v_action whatsapp.outbound_action_type;
  v_queue_id uuid;
BEGIN
  IF p_state NOT IN ('composing', 'recording', 'paused') THEN
    RAISE EXCEPTION 'invalid_presence_state: %', p_state USING ERRCODE = '22023';
  END IF;
  v_conv := whatsapp._assert_conversation_access(p_conversation_id);

  DELETE FROM whatsapp.outbound_queue
   WHERE conversation_id = p_conversation_id
     AND status = 'queued'
     AND action_type IN ('typing_start','typing_stop');

  v_action := CASE WHEN p_state = 'paused'
                   THEN 'typing_stop'::whatsapp.outbound_action_type
                   ELSE 'typing_start'::whatsapp.outbound_action_type END;

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload, status, priority, not_before
  ) VALUES (
    v_conv.instance_id, p_conversation_id, auth.uid(), v_action,
    jsonb_build_object(
      'remote_jid', v_conv.remote_jid,
      'presence',   p_state
    ),
    'queued', 50,
    now()
  ) RETURNING id INTO v_queue_id;

  RETURN jsonb_build_object('queue_id', v_queue_id);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.send_typing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.send_typing(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.send_typing(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.edit_message(p_message_id uuid, p_new_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg       record;
  v_conv      whatsapp.conversations;
  v_queue_id  uuid;
BEGIN
  IF p_new_text IS NULL OR length(trim(p_new_text)) = 0 THEN
    RAISE EXCEPTION 'text_required' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.conversation_id, m.instance_id, m.direction, m.kind,
         m.evolution_message_id, m.sender_jid, m.whatsapp_timestamp, m.revoked_at
    INTO v_msg
    FROM whatsapp.messages m
   WHERE m.id = p_message_id;

  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.direction <> 'outbound' THEN
    RAISE EXCEPTION 'can_only_edit_outbound' USING ERRCODE = '22023';
  END IF;
  IF v_msg.kind <> 'text' THEN
    RAISE EXCEPTION 'can_only_edit_text_kind' USING ERRCODE = '22023';
  END IF;
  IF v_msg.evolution_message_id IS NULL THEN
    RAISE EXCEPTION 'message_not_yet_dispatched' USING ERRCODE = '22023';
  END IF;
  IF v_msg.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_revoked' USING ERRCODE = '22023';
  END IF;
  -- WhatsApp edit window: 15 minutes from send.
  IF now() - v_msg.whatsapp_timestamp > interval '15 minutes' THEN
    RAISE EXCEPTION 'edit_window_expired' USING ERRCODE = '22023';
  END IF;

  v_conv := whatsapp._assert_conversation_access(v_msg.conversation_id);

  -- Persist the new body + edited marker now (UI sees it immediately via Realtime).
  UPDATE whatsapp.messages
     SET body_ciphertext = whatsapp.encrypt_text(p_new_text),
         edited_at       = now()
   WHERE id = p_message_id;

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload,
    status, priority, not_before
  ) VALUES (
    v_msg.instance_id, v_msg.conversation_id, auth.uid(), 'edit_message',
    jsonb_build_object(
      'key', jsonb_build_object(
        'id', v_msg.evolution_message_id, 'fromMe', true,
        'remoteJid', v_conv.remote_jid, 'participant', v_msg.sender_jid),
      'text', p_new_text,
      'message_id', p_message_id,          -- canonical key for audit linkage
      'target_message_id', p_message_id    -- kept for back-compat
    ),
    'queued', 100, now()
  )
  RETURNING id INTO v_queue_id;

  PERFORM whatsapp.audit('message.edit_enqueued', 'message', p_message_id::text,
    jsonb_build_object('queue_id', v_queue_id));

  RETURN jsonb_build_object('message_id', p_message_id, 'queue_id', v_queue_id, 'status', 'PENDING');
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.edit_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.edit_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.edit_message(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.delete_message(p_message_id uuid, p_scope text DEFAULT 'everyone'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg       record;
  v_conv      whatsapp.conversations;
  v_queue_id  uuid;
  v_uid       uuid := auth.uid();
BEGIN
  IF p_scope NOT IN ('everyone','me') THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.conversation_id, m.instance_id, m.direction,
         m.evolution_message_id, m.sender_jid, m.whatsapp_timestamp, m.revoked_at
    INTO v_msg
    FROM whatsapp.messages m
   WHERE m.id = p_message_id;

  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ACL: caller must have access to the conversation (works for inbound + outbound).
  v_conv := whatsapp._assert_conversation_access(v_msg.conversation_id);

  -- ── Delete for me — pure app-local hide. No WhatsApp call. Any direction/age. ──
  IF p_scope = 'me' THEN
    UPDATE whatsapp.messages
       SET hidden_for_user_ids = array_append(hidden_for_user_ids, v_uid)
     WHERE id = p_message_id
       AND NOT (v_uid = ANY(hidden_for_user_ids));
    PERFORM whatsapp.audit('message.hidden_for_me', 'message', p_message_id::text, '{}'::jsonb);
    RETURN jsonb_build_object('message_id', p_message_id, 'status', 'HIDDEN_FOR_ME');
  END IF;

  -- ── Delete for everyone — revoke on WhatsApp via the dispatcher. ──
  IF v_msg.direction <> 'outbound' THEN
    RAISE EXCEPTION 'can_only_retract_outbound' USING ERRCODE = '22023';
  END IF;
  IF v_msg.evolution_message_id IS NULL THEN
    RAISE EXCEPTION 'message_not_yet_dispatched' USING ERRCODE = '22023';
  END IF;
  IF v_msg.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_revoked' USING ERRCODE = '22023';
  END IF;
  -- WhatsApp delete-for-everyone window: 60 hours from send.
  IF now() - v_msg.whatsapp_timestamp > interval '60 hours' THEN
    RAISE EXCEPTION 'delete_window_expired' USING ERRCODE = '22023';
  END IF;

  -- Optimistic tombstone (drives the deleted bubble). Rolled back by
  -- queue_mark_dead if WhatsApp rejects the revoke. We DO NOT touch
  -- delivery_status (it drives the tick and 'DELETED' there is a UI no-op).
  UPDATE whatsapp.messages
     SET revoked_at = now(), revoked_by = 'us'
   WHERE id = p_message_id;

  INSERT INTO whatsapp.outbound_queue (
    number_id, conversation_id, agent_id, action_type, payload,
    status, priority, not_before
  ) VALUES (
    v_msg.instance_id, v_msg.conversation_id, v_uid, 'delete_message',
    jsonb_build_object(
      'key', jsonb_build_object(
        'id', v_msg.evolution_message_id, 'fromMe', true,
        'remoteJid', v_conv.remote_jid, 'participant', v_msg.sender_jid),
      'message_id', p_message_id,
      'target_message_id', p_message_id
    ),
    'queued', 100, now()
  )
  RETURNING id INTO v_queue_id;

  PERFORM whatsapp.audit('message.delete_enqueued', 'message', p_message_id::text,
    jsonb_build_object('queue_id', v_queue_id, 'scope', 'everyone'));

  RETURN jsonb_build_object('message_id', p_message_id, 'queue_id', v_queue_id, 'status', 'PENDING');
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.delete_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.delete_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.delete_message(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.cancel_outbound_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg           record;
  v_queue_deleted int;
BEGIN
  SELECT m.id, m.conversation_id, m.instance_id, m.direction,
         m.sent_by_agent_id, m.delivery_status, m.evolution_message_id
    INTO v_msg
    FROM whatsapp.messages m
   WHERE m.id = p_message_id;

  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.direction <> 'outbound' THEN
    RAISE EXCEPTION 'can_only_cancel_outbound' USING ERRCODE = '22023';
  END IF;
  IF NOT (whatsapp.is_wa_admin(v_msg.instance_id) OR v_msg.sent_by_agent_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: must be admin or original sender' USING ERRCODE = '42501';
  END IF;
  -- Already dispatched to WhatsApp → can't silently cancel; must use retract.
  IF v_msg.evolution_message_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_dispatched_use_delete_message_instead' USING ERRCODE = '22023';
  END IF;

  DELETE FROM whatsapp.outbound_queue
   WHERE (payload->>'message_id')::uuid = p_message_id
     AND status IN ('queued', 'failed', 'dead');
  GET DIAGNOSTICS v_queue_deleted = ROW_COUNT;

  -- Hard-delete the never-sent message so the thread drops the bubble.
  DELETE FROM whatsapp.messages WHERE id = p_message_id;

  PERFORM whatsapp.audit('message.cancelled', 'message', p_message_id::text,
    jsonb_build_object('queue_rows_deleted', v_queue_deleted, 'hard_deleted', true));

  RETURN jsonb_build_object(
    'message_id', p_message_id,
    'queue_rows_deleted', v_queue_deleted,
    'status', 'DELETED'
  );
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.cancel_outbound_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.cancel_outbound_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.cancel_outbound_message(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.force_dispatch_now(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_msg   record;
  v_until timestamptz := now() + interval '60 seconds';
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
  PERFORM pg_notify('outbound_enqueued', v_msg.instance_id::text);
  PERFORM whatsapp.audit('message.force_dispatched', 'message', p_message_id::text,
    jsonb_build_object('instance_id', v_msg.instance_id, 'override_until', v_until, 'reason', 'agent or admin override of schedule gate'));
  RETURN jsonb_build_object('message_id', p_message_id, 'override_until', v_until, 'status', 'dispatching');
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.force_dispatch_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.force_dispatch_now(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.force_dispatch_now(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.mark_conversation_read(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT whatsapp.is_wa_admin((SELECT instance_id FROM whatsapp.conversations WHERE id = p_conversation_id)) AND NOT EXISTS (
    SELECT 1 FROM whatsapp.conversation_assignments
    WHERE conversation_id = p_conversation_id AND user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE whatsapp.conversations
    SET unread_count = 0
    WHERE id = p_conversation_id AND unread_count > 0;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.mark_conversation_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.mark_conversation_read(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.update_conversation_status(p_conversation_id uuid, p_status whatsapp.conversation_status, p_snoozed_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv whatsapp.conversations;
  v_uid  uuid := auth.uid();
BEGIN
  v_conv := whatsapp._assert_conversation_access(p_conversation_id);

  IF p_status = 'snoozed' AND (p_snoozed_until IS NULL OR p_snoozed_until <= now()) THEN
    RAISE EXCEPTION 'snooze_requires_future_timestamp' USING ERRCODE = '22023';
  END IF;

  UPDATE whatsapp.conversations
     SET status         = p_status,
         snoozed_until  = CASE WHEN p_status = 'snoozed' THEN p_snoozed_until ELSE NULL END,
         resolved_at    = CASE WHEN p_status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END,
         resolved_by    = CASE WHEN p_status = 'resolved' THEN COALESCE(resolved_by, v_uid) ELSE NULL END,
         updated_at     = now()
   WHERE id = p_conversation_id;

  RETURN jsonb_build_object('status', p_status, 'snoozed_until', p_snoozed_until);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.update_conversation_status(uuid, whatsapp.conversation_status, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.update_conversation_status(uuid, whatsapp.conversation_status, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.update_conversation_status(uuid, whatsapp.conversation_status, timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.toggle_pin(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_new boolean;
BEGIN
  PERFORM whatsapp._assert_conversation_access(p_conversation_id);
  UPDATE whatsapp.conversations
     SET is_pinned = NOT is_pinned,
         updated_at = now()
   WHERE id = p_conversation_id
  RETURNING is_pinned INTO v_new;
  PERFORM whatsapp.audit('conversation.pin_toggled', 'conversation', p_conversation_id::text,
    jsonb_build_object('pinned', v_new));
  RETURN jsonb_build_object('is_pinned', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.toggle_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_pin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.toggle_archive(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_new boolean;
BEGIN
  PERFORM whatsapp._assert_conversation_access(p_conversation_id);
  UPDATE whatsapp.conversations
     SET is_archived = NOT is_archived,
         updated_at  = now()
   WHERE id = p_conversation_id
  RETURNING is_archived INTO v_new;
  PERFORM whatsapp.audit('conversation.archive_toggled', 'conversation', p_conversation_id::text,
    jsonb_build_object('archived', v_new));
  RETURN jsonb_build_object('is_archived', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.toggle_archive(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_archive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_archive(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.toggle_star(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv_id uuid;
  v_new boolean;
BEGIN
  SELECT conversation_id INTO v_conv_id FROM whatsapp.messages WHERE id = p_message_id;
  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM whatsapp._assert_conversation_access(v_conv_id);

  UPDATE whatsapp.messages
     SET is_starred = NOT is_starred
   WHERE id = p_message_id
  RETURNING is_starred INTO v_new;

  PERFORM whatsapp.audit('message.star_toggled', 'message', p_message_id::text,
    jsonb_build_object('starred', v_new));
  RETURN jsonb_build_object('is_starred', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.toggle_star(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_star(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_star(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.toggle_message_pin(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv_id uuid;
  v_new boolean;
BEGIN
  SELECT conversation_id INTO v_conv_id FROM whatsapp.messages WHERE id = p_message_id;
  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM whatsapp._assert_conversation_access(v_conv_id);

  -- SET RHS reads the pre-UPDATE row: on pin (was false) stamp now()/uid; on unpin clear.
  UPDATE whatsapp.messages
     SET is_pinned = NOT is_pinned,
         pinned_at = CASE WHEN is_pinned THEN NULL ELSE now() END,
         pinned_by = CASE WHEN is_pinned THEN NULL ELSE (SELECT auth.uid()) END
   WHERE id = p_message_id
  RETURNING is_pinned INTO v_new;

  PERFORM whatsapp.audit('message.pin_toggled', 'message', p_message_id::text,
    jsonb_build_object('pinned', v_new));
  RETURN jsonb_build_object('is_pinned', v_new);
END;
$function$;

REVOKE ALL ON FUNCTION whatsapp.toggle_message_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_message_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_message_pin(uuid) TO service_role;
REVOKE ALL ON FUNCTION whatsapp.toggle_message_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_message_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_message_pin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.toggle_message_star(p_message_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_new_val boolean;
BEGIN
  UPDATE whatsapp.messages
  SET is_starred = NOT is_starred
  WHERE id = p_message_id
  RETURNING is_starred INTO v_new_val;
  RETURN COALESCE(v_new_val, false);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.toggle_message_star(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.toggle_message_star(uuid) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.set_message_pin(p_message_id uuid, p_pinned boolean, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT conversation_id INTO v_conv_id FROM whatsapp.messages WHERE id = p_message_id;
  IF v_conv_id IS NULL THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM whatsapp._assert_conversation_access(v_conv_id);

  UPDATE whatsapp.messages
     SET is_pinned      = p_pinned,
         pinned_at      = CASE WHEN p_pinned THEN now() ELSE NULL END,
         pinned_by      = CASE WHEN p_pinned THEN (SELECT auth.uid()) ELSE NULL END,
         pin_expires_at = CASE WHEN p_pinned THEN p_expires_at ELSE NULL END
   WHERE id = p_message_id;

  PERFORM whatsapp.audit('message.pin_set', 'message', p_message_id::text,
    jsonb_build_object('pinned', p_pinned, 'expires_at', p_expires_at));
  RETURN jsonb_build_object('is_pinned', p_pinned);
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.set_message_pin(uuid, boolean, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.set_message_pin(uuid, boolean, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.set_message_pin(uuid, boolean, timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.search_conversations(p_instance_id uuid, p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, instance_id uuid, remote_jid text, peer_display_name text, peer_profile_pic text, is_group boolean, last_message_at timestamp with time zone, last_message_preview text, unread_count integer, status whatsapp.conversation_status, match_score real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_query text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;
  v_query := trim(p_query);

  return query
  select
    c.id,
    c.instance_id,
    c.remote_jid,
    c.peer_display_name,
    c.peer_profile_pic,
    c.is_group,
    c.last_message_at,
    whatsapp._decrypt_conv_preview(c.id) as last_message_preview,
    c.unread_count,
    c.status,
    greatest(
      extensions.similarity(coalesce(c.peer_display_name, ''), v_query),
      extensions.similarity(c.remote_jid, v_query)
    )::real as match_score
  from whatsapp.conversations c
  where c.instance_id = p_instance_id
    and (
      c.peer_display_name operator(extensions.%) v_query
      or c.remote_jid     operator(extensions.%) v_query
      or c.peer_display_name ilike '%' || v_query || '%'
      or c.remote_jid     ilike '%' || v_query || '%'
    )
  order by match_score desc nulls last, c.last_message_at desc nulls last
  limit greatest(least(p_limit, 100), 1);
end;
$function$;
REVOKE ALL ON FUNCTION whatsapp.search_conversations(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.search_conversations(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.search_conversations(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.merge_conversation(p_survivor uuid, p_loser uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_s record; v_l record;
BEGIN
  IF p_survivor IS NULL OR p_loser IS NULL OR p_survivor = p_loser THEN RETURN; END IF;

  -- Lock both rows in a deterministic order to avoid deadlocks.
  SELECT * INTO v_s FROM whatsapp.conversations WHERE id = p_survivor FOR UPDATE;
  SELECT * INTO v_l FROM whatsapp.conversations WHERE id = p_loser    FOR UPDATE;
  IF v_s.id IS NULL OR v_l.id IS NULL THEN RETURN; END IF;
  IF v_l.merged_into IS NOT NULL THEN RETURN; END IF;            -- already merged (idempotent)
  IF v_s.instance_id <> v_l.instance_id THEN RETURN; END IF;     -- never cross-instance
  IF v_s.is_group OR v_l.is_group THEN RETURN; END IF;           -- never groups

  -- Children with no unique collision risk → straight reassign.
  UPDATE whatsapp.messages          SET conversation_id = p_survivor WHERE conversation_id = p_loser;
  UPDATE whatsapp.conversation_notes SET conversation_id = p_survivor WHERE conversation_id = p_loser;
  UPDATE whatsapp.scheduled_messages SET conversation_id = p_survivor WHERE conversation_id = p_loser;
  UPDATE whatsapp.outbound_queue
     SET conversation_id = p_survivor,
         payload = CASE WHEN payload ? 'remote_jid'
                        THEN jsonb_set(payload, '{remote_jid}', to_jsonb(v_s.remote_jid))
                        ELSE payload END
   WHERE conversation_id = p_loser;

  -- conversation_assignments: composite UNIQUE (conversation_id, user_id) → dedup.
  UPDATE whatsapp.conversation_assignments a SET conversation_id = p_survivor
   WHERE a.conversation_id = p_loser
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_assignments b
                      WHERE b.conversation_id = p_survivor AND b.user_id = a.user_id);
  DELETE FROM whatsapp.conversation_assignments WHERE conversation_id = p_loser;

  -- conversation_tags: UNIQUE (conversation_id, tag_id) → dedup.
  UPDATE whatsapp.conversation_tags t SET conversation_id = p_survivor
   WHERE t.conversation_id = p_loser
     AND NOT EXISTS (SELECT 1 FROM whatsapp.conversation_tags u
                      WHERE u.conversation_id = p_survivor AND u.tag_id = t.tag_id);
  DELETE FROM whatsapp.conversation_tags WHERE conversation_id = p_loser;

  -- Survivor aggregates: sum unread, refresh last_* from the merged message set.
  UPDATE whatsapp.conversations s
     SET unread_count = COALESCE(v_s.unread_count, 0) + COALESCE(v_l.unread_count, 0),
         updated_at   = now()
   WHERE s.id = p_survivor;

  UPDATE whatsapp.conversations s SET
      last_message_at          = n.whatsapp_timestamp,
      last_message_preview_ct  = n.body_ciphertext,
      last_message_kind        = n.kind,
      last_message_direction   = n.direction,
      last_message_sender_name = n.media_meta->>'pushName',
      last_message_media_meta  = n.media_meta
   FROM (SELECT * FROM whatsapp.messages WHERE conversation_id = p_survivor
          ORDER BY whatsapp_timestamp DESC, id DESC LIMIT 1) n
   WHERE s.id = p_survivor;

  UPDATE whatsapp.conversations s SET
      last_inbound_at  = (SELECT max(whatsapp_timestamp) FROM whatsapp.messages WHERE conversation_id = p_survivor AND direction = 'inbound'),
      last_outbound_at = (SELECT max(whatsapp_timestamp) FROM whatsapp.messages WHERE conversation_id = p_survivor AND direction = 'outbound'),
      last_outbound_status = (SELECT delivery_status FROM whatsapp.messages WHERE conversation_id = p_survivor AND direction = 'outbound'
                               ORDER BY whatsapp_timestamp DESC, id DESC LIMIT 1)
   WHERE s.id = p_survivor;

  -- Soft-tombstone the loser (no hard delete; children already moved).
  UPDATE whatsapp.conversations SET merged_into = p_survivor, updated_at = now() WHERE id = p_loser;
END;
$function$;
REVOKE ALL ON FUNCTION whatsapp.merge_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.merge_conversation(uuid, uuid) TO service_role;

