-- WA-RT-1 (2026-07-17): statement-coalesce bulk WhatsApp message-delete broadcasts.
-- conversations_clear_all / conversations_delete_all fired whatsapp._broadcast_message
-- once PER deleted message -> one realtime.messages tombstone/row onto the shared
-- broadcast slot (head-of-line pressure on ALL live realtime during an admin bulk op).
-- MEASURED (faithful synthetic, rolled-back): 12k-msg clear = 1,818ms/12,016 broadcasts;
-- 132k = 10,447ms; suppressed = 470ms (22x). Same OR-13/OR-C pattern.
-- FIX: a txn-local suppress flag set by the two bulk RPCs; the trigger's DELETE branch
-- early-returns when it's on. Single-message revoke/cancel (flag unset) keeps its
-- tombstone; conversation-level delete/bump already evicts/refreshes the client.
-- Owner: supabase_admin (whatsapp-schema functions).

BEGIN;

CREATE OR REPLACE FUNCTION whatsapp._broadcast_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payload jsonb;
begin
  if TG_OP = 'DELETE' then
    -- WA-RT-1: bulk clear/delete-all set a txn-local suppress flag — the
    -- conversation-level delete/bump tombstone already evicts the client, so the
    -- per-message tombstones (N of them, one realtime.messages INSERT each on the
    -- shared broadcast slot) are pure head-of-line pressure during a bulk op.
    -- Single-message revoke/cancel (flag unset) keeps its tombstone.
    if coalesce(current_setting('whatsapp.suppress_msg_broadcast', true), '') = 'on' then
      return OLD;
    end if;
    -- Cancelled/hard-deleted message → tombstone so open threads drop the bubble.
    perform realtime.send(
      jsonb_build_object('id', OLD.id::text, 'deleted', true),
      'msg', 'wa:conv:' || OLD.conversation_id::text, true);
    return OLD;
  end if;

  -- Decrypted message row (same shape as messages_decrypted) + hidden_for_user_ids
  -- for client-side delete-for-me. Decrypt directly (NOT via the per-user view).
  v_payload := jsonb_build_object(
    'op',                   TG_OP,          -- 'INSERT' | 'UPDATE' → client mirrors postgres_changes semantics
    'id',                   NEW.id,
    'conversation_id',      NEW.conversation_id,
    'instance_id',          NEW.instance_id,
    'evolution_message_id', NEW.evolution_message_id,
    'direction',            NEW.direction,
    'kind',                 NEW.kind,
    -- Decrypt directly from NEW (already has body_ciphertext + key_id): avoids a
    -- redundant PK self-lookup on the hot path, AND is correct — _decrypt_message_body
    -- is auth.uid()-gated (would return NULL for a frontend-RPC actor who isn't
    -- admin/assigned, blanking the body for ALL recipients). Recipients are already
    -- gated by the wa:conv RLS topic policy (035), so unconditional decrypt is right.
    'body',                 whatsapp.decrypt_text(NEW.body_ciphertext, NEW.key_id),
    'media_meta',           NEW.media_meta,
    'reply_to_message_id',  NEW.reply_to_message_id,
    'sender_jid',           NEW.sender_jid,
    'whatsapp_timestamp',   NEW.whatsapp_timestamp,
    'delivery_status',      NEW.delivery_status,
    'created_at',           NEW.created_at,
    'reactions',            NEW.reactions,
    'forwarded',            NEW.forwarded,
    'forwarding_score',     NEW.forwarding_score,
    'is_starred',           NEW.is_starred,
    'sent_by_agent_id',     NEW.sent_by_agent_id,
    'media_storage_bucket', NEW.media_storage_bucket,
    'media_storage_key',    NEW.media_storage_key,
    'media_pending',        NEW.media_pending,
    'media_size_bytes',     NEW.media_size_bytes,
    'media_mime',           NEW.media_mime,
    'media_uploaded_at',    NEW.media_uploaded_at,
    'media_failed_at',      NEW.media_failed_at,
    'edited_at',            NEW.edited_at,
    'revoked_at',           NEW.revoked_at,
    'revoked_by',           NEW.revoked_by,
    'is_pinned',            NEW.is_pinned,
    'pinned_at',            NEW.pinned_at,
    'pinned_by',            NEW.pinned_by,
    'pin_expires_at',       NEW.pin_expires_at,
    'hidden_for_user_ids',  coalesce(to_jsonb(NEW.hidden_for_user_ids), '[]'::jsonb)
  );

  perform realtime.send(v_payload, 'msg', 'wa:conv:' || NEW.conversation_id::text, true);
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION whatsapp.conversations_clear_all(p_instance_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queue_deleted integer;
  v_msg_deleted   integer;
  v_convs_reset   integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.is_wa_admin(p_instance_id), false) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  -- WA-RT-1: suppress the per-message delete broadcasts during this bulk op
  -- (the conversation-level events below still evict/refresh the client).
  perform set_config('whatsapp.suppress_msg_broadcast', 'on', true);

  with d as (
    delete from whatsapp.outbound_queue oq
     using whatsapp.conversations c
     where c.id = oq.conversation_id
       and c.instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_queue_deleted from d;

  -- messages.instance_id is denormalized per conversation, so this equals the
  -- conversation-set delete but rides messages_instance_ts_idx directly.
  with d as (
    delete from whatsapp.messages
     where instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_msg_deleted from d;

  -- Same summary reset as admin_conversation_clear, restricted to rows that
  -- actually have something to reset (no dead-row churn, no no-op trigger work).
  update whatsapp.conversations
     set last_message_at          = null,
         last_message_preview_ct  = null,
         last_message_kind        = null,
         last_message_direction   = null,
         last_message_sender_name = null,
         last_message_media_meta  = null,
         last_inbound_at          = null,
         last_outbound_at         = null,
         unread_count             = 0,
         updated_at               = now()
   where instance_id = p_instance_id
     and (last_message_at is not null
       or last_message_preview_ct is not null
       or last_message_kind is not null
       or last_message_direction is not null
       or last_message_sender_name is not null
       or last_message_media_meta is not null
       or last_inbound_at is not null
       or last_outbound_at is not null
       or unread_count <> 0);
  get diagnostics v_convs_reset = row_count;

  perform whatsapp.audit('conversation.bulk_clear', 'instance', p_instance_id::text,
    jsonb_build_object(
      'conversations_reset',    v_convs_reset,
      'messages_deleted',       v_msg_deleted,
      'outbound_queue_deleted', v_queue_deleted
    ));
  return v_convs_reset;
end;
$function$
;

CREATE OR REPLACE FUNCTION whatsapp.conversations_delete_all(p_instance_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.is_wa_admin(p_instance_id), false) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  -- WA-RT-1: suppress the per-message delete broadcasts during this bulk op
  -- (the conversation-level events below still evict/refresh the client).
  perform set_config('whatsapp.suppress_msg_broadcast', 'on', true);

  with d as (
    delete from whatsapp.conversations
     where instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_deleted from d;

  perform whatsapp.audit('conversation.bulk_delete', 'instance', p_instance_id::text,
    jsonb_build_object('conversations_deleted', v_deleted));
  return v_deleted;
end;
$function$
;

COMMIT;
