-- whatsapp_065_inbound_edit.sql
--
-- Inbound message EDIT support (customer edits a message they sent us).
--
-- WhatsApp delivers an inbound edit to a companion session ONLY as an encrypted
-- secretEncryptedMessage (secretEncType=2, targetMessageKey → the original) —
-- there is NO plaintext edit event (proven on the live wire 2026-07-10). Neither
-- bundled nor upstream Baileys decrypts this envelope, so the worker showed a
-- broken "Ce message n'a pas pu être chargé" bubble. The decryption key is the
-- ORIGINAL message's messageContextInfo.messageSecret; the derivation
-- (authoritative, from whatsmeow) is:
--   secretKey = HKDF-SHA256(ikm = messageSecret, salt = 0^32,
--                           info = origMsgId ++ origSenderJid ++ editSenderJid
--                                  ++ "Message Edit", len = 32)
--   plaintext = AES-256-GCM(secretKey, encIv, encPayload, aad = ∅)   -- Message proto
-- AES-GCM's auth tag means a wrong key/JID-form can only FAIL, never corrupt.
--
-- This migration provides the two DB seams the worker (which does the crypto in
-- node:crypto) needs:
--   1. message_secret column — the worker persists each inbound text message's
--      secret at ingest so a later edit can be decrypted. Not in the
--      conversations/messages_decrypted view → never exposed to clients.
--   2. set_message_secret() / apply_inbound_edit() RPCs (SECURITY DEFINER,
--      service_role) — capture the secret, and apply the decrypted new text
--      (mirrors edit_message / mig 061: body_ciphertext + edited_at + refresh the
--      denormalized last_message_preview_ct when the edited message is the
--      conversation's latest, so the bump trigger live-syncs every list).

begin;

alter table whatsapp.messages add column if not exists message_secret bytea;

comment on column whatsapp.messages.message_secret is
  'messageContextInfo.messageSecret of an inbound text message, captured at ingest '
  'so a later secretEncryptedMessage EDIT can be decrypted (mig 065). Key material — '
  'NOT in messages_decrypted; never select into any client-facing surface.';

-- ── capture the secret at ingest (worker, service_role) ──────────────────────
create or replace function whatsapp.set_message_secret(p_message_id uuid, p_secret bytea)
  returns void
  language sql
  security definer
  set search_path to ''
as $function$
  update whatsapp.messages
     set message_secret = p_secret
   where id = p_message_id
     and message_secret is null;   -- write-once; ignore re-deliveries
$function$;

-- ── apply the decrypted inbound edit (worker, service_role) ──────────────────
create or replace function whatsapp.apply_inbound_edit(p_evolution_message_id text, p_new_text text)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_msg   record;
begin
  if p_new_text is null or length(p_new_text) = 0 then
    return jsonb_build_object('applied', false, 'reason', 'empty_text');
  end if;

  select m.id, m.conversation_id, m.direction, m.kind, m.revoked_at, m.whatsapp_timestamp
    into v_msg
    from whatsapp.messages m
   where m.evolution_message_id = p_evolution_message_id
   order by m.whatsapp_timestamp desc
   limit 1;

  if v_msg.id is null then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;
  -- Only inbound text edits flow here; outbound edits use edit_message. A revoked
  -- message keeps its tombstone.
  if v_msg.direction <> 'inbound' or v_msg.kind <> 'text' or v_msg.revoked_at is not null then
    return jsonb_build_object('applied', false, 'reason', 'not_editable');
  end if;

  update whatsapp.messages
     set body_ciphertext = whatsapp.encrypt_text(p_new_text),
         edited_at       = now()
   where id = v_msg.id;

  -- Preview parity with mig 061: if the edited message owns the conversation's
  -- latest slot (newest by whatsapp_timestamp, id — including revoked), refresh
  -- the denormalized preview; the bump trigger then live-syncs every list.
  if v_msg.id = (
       select m2.id from whatsapp.messages m2
        where m2.conversation_id = v_msg.conversation_id
        order by m2.whatsapp_timestamp desc, m2.id desc
        limit 1
     ) then
    update whatsapp.conversations
       set last_message_preview_ct = whatsapp.encrypt_text(p_new_text),
           updated_at              = now()
     where id = v_msg.conversation_id;
  end if;

  perform whatsapp.audit('message.inbound_edit_applied', 'message', v_msg.id::text,
    jsonb_build_object('conversation_id', v_msg.conversation_id));

  return jsonb_build_object('applied', true, 'message_id', v_msg.id);
end;
$function$;

revoke all on function whatsapp.set_message_secret(uuid, bytea)         from public, anon;
revoke all on function whatsapp.apply_inbound_edit(text, text)          from public, anon;
grant execute on function whatsapp.set_message_secret(uuid, bytea)      to service_role;
grant execute on function whatsapp.apply_inbound_edit(text, text)       to service_role;

commit;
