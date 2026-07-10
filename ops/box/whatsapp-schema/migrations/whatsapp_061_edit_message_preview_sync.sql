-- whatsapp_061_edit_message_preview_sync.sql
--
-- BUG: editing the LAST message of a conversation leaves the sidebar preview
-- stale. whatsapp.edit_message() updates messages.body_ciphertext + edited_at
-- (the open ChatPane refreshes fine), but it never touches the denormalized
-- last_message_preview_ct on whatsapp.conversations — so every list row (admin
-- sidebar AND assigned seller sidebar) keeps showing the OLD text until some
-- unrelated write bumps the conversation.
--
-- FIX: after persisting the new body, when the edited message is the
-- conversation's newest non-revoked message (same ordering the schema already
-- uses everywhere for "latest": whatsapp_timestamp DESC, id DESC — see
-- merge_conversation), re-encrypt the preview with the new text and touch
-- updated_at. The existing conversations_broadcast_bump trigger fires on that
-- UPDATE and live-syncs every client's list row over wa:biz/wa:user — no new
-- realtime plumbing, no client change required.
--
-- Everything else in edit_message is preserved verbatim from the live
-- definition (gates, 15-minute window, outbound edit enqueue, audit line).

begin;

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

  -- Keep the denormalized sidebar preview honest: if the edited message is the
  -- conversation's newest message (canonical "latest" ordering:
  -- whatsapp_timestamp DESC, id DESC — INCLUDING revoked rows: a newer revoked
  -- message keeps preview ownership with its revoked marker, per
  -- _mark_conversation_preview_revoked; excluding it here would let an edit of
  -- an older message steal that preview. Editing the revoked row itself is
  -- already rejected above with already_revoked), re-encrypt the preview with
  -- the new text. The conversations_broadcast_bump trigger then live-syncs
  -- every list row.
  IF p_message_id = (
       SELECT m2.id
         FROM whatsapp.messages m2
        WHERE m2.conversation_id = v_msg.conversation_id
        ORDER BY m2.whatsapp_timestamp DESC, m2.id DESC
        LIMIT 1
     ) THEN
    UPDATE whatsapp.conversations
       SET last_message_preview_ct = whatsapp.encrypt_text(p_new_text),
           updated_at              = now()
     WHERE id = v_msg.conversation_id;
  END IF;

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

comment on function whatsapp.edit_message(uuid, text) is
  'Edit an outbound text message (15-min window): re-encrypts the body, enqueues '
  'the WhatsApp edit, and — when the message is the conversation''s newest — syncs '
  'last_message_preview_ct so the sidebar preview matches (bump trigger broadcasts it).';

grant execute on function whatsapp.edit_message(uuid, text) to authenticated, service_role;

commit;
