-- whatsapp_040_message_broadcast.sql
-- Stage: move the message-THREAD realtime off postgres_changes onto the private
-- wa:conv:<conversation_id> broadcast (readiness blocker #3 — realtime.list_changes
-- is 62.6% of DB exec time; whatsapp.messages is the hottest table still in the
-- supabase_realtime publication). ADDITIVE: this only ADDS broadcast rows; the
-- postgres_changes thread subscriptions stay authoritative until a later, gated
-- removal + DROP of messages from the publication.
--
-- Authorization for wa:conv:<uuid> was built + proven in migration 035
-- (can_access_conv_topic + wa_conv_broadcast_read RLS on realtime.messages;
-- cross-tenant isolation airtight).
--
-- Payload = the DECRYPTED message row (same field set as messages_decrypted) PLUS
-- hidden_for_user_ids. It does NOT read messages_decrypted (that view filters
-- per-user via uid(); a frontend RPC that hides a message for the ACTOR would
-- otherwise yield a null payload and never reach the other agents). It decrypts
-- body directly and lets the CLIENT apply the per-user delete-for-me filter using
-- hidden_for_user_ids. SECDEF/postgres so realtime.send's INSERT always lands.
-- Fail-safe: realtime.send swallows its own errors — a broadcast failure can
-- never break a message write.
--
-- Reversible: drop trigger messages_broadcast on whatsapp.messages;
--             drop function whatsapp._broadcast_message();
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp._broadcast_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload jsonb;
begin
  if TG_OP = 'DELETE' then
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
$function$;

comment on function whatsapp._broadcast_message() is
  'AFTER INSERT/UPDATE/DELETE on whatsapp.messages: publishes the decrypted message (+ hidden_for_user_ids for client delete-for-me) to the private wa:conv:<conversation_id> broadcast; DELETE sends a {id,deleted} tombstone. Source-agnostic, fail-safe (realtime.send swallows errors). SECDEF/postgres.';

drop trigger if exists messages_broadcast on whatsapp.messages;
create trigger messages_broadcast
  after insert or update or delete on whatsapp.messages
  for each row
  execute function whatsapp._broadcast_message();

alter function whatsapp._broadcast_message() owner to postgres;

commit;
