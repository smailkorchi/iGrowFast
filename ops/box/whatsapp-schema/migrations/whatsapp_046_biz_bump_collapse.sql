-- whatsapp_046_biz_bump_collapse.sql
-- Enterprise-scale plan PHASE 2a (W5 + W4-B2). Two coupled changes, ADDITIVE and
-- reversible — nothing is removed here (the wa:inst drop is a later, gated cleanup):
--
--  1) COLLAPSE the admin inbox's per-instance channel fan-out. The admin shell
--     opens ONE realtime channel PER instance (wa:inst:<id>); a business with 93
--     numbers = 93 channels per tab — the channel wall. This adds a business-scoped
--     topic wa:biz:<business_id> so the frontend can subscribe ONE channel for the
--     whole business (Phase 0 mig 044 already shipped can_read_biz_topic + policy).
--     Every emit point (normal bump, hide-transition tombstone, delete tombstone)
--     now DUAL-publishes to BOTH wa:inst (kept for rollout) AND wa:biz.
--
--  2) DECRYPT-FROM-NEW. The bump is the #1 WAL-churn trigger (fires on ~every
--     message). It re-read the whole row via `to_jsonb(conversations_decrypted
--     WHERE id=NEW.id)` — a second conversations PK lookup + a contacts JOIN +
--     _decrypt_conv_preview (which does yet ANOTHER conversations PK lookup + an
--     auth exists() check). This builds the identical list row DIRECTLY from NEW
--     (one cheap contacts PK lookup for book_name remains). Byte-identical key set
--     to conversations_decrypted (proven by the ROLLBACK parity assertion below).
--     Unconditionally decrypting here is safe: delivery is access-gated by the
--     can_read_{inst,biz,user}_topic policies on realtime.messages, so every
--     recipient is already authorized to see the preview. (This also removes the
--     latent quirk where the WRITER's own auth.uid()/assignment could null a
--     RECIPIENT's preview — for real traffic, worker ingests run auth.uid()=null
--     and already decrypt, so this is behaviour-neutral.)
--
--  Prerequisite for both: denormalize business_id onto conversations (source =
--  whatsapp_instances.business_id, immutable per instance). Populated by a BEFORE
--  INSERT trigger for all writers (worker ingest AND frontend conversationCreate);
--  the bump/delete triggers then read NEW/OLD.business_id with ZERO extra lookup on
--  the hot path (the instance→business lookup moves to the cold new-conversation
--  path).
--
-- Reversible: re-run whatsapp_038's _broadcast_conversation_bump body + whatsapp_037's
--   _broadcast_conversation_delete body; drop trigger conversations_set_business_id +
--   function _conversations_set_business_id(); alter table drop column business_id.
--   (wa:biz authz from mig 044 stays; it is harmless with no emitters.)
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Denormalize business_id onto conversations.
-- ───────────────────────────────────────────────────────────────────────────
alter table whatsapp.conversations add column if not exists business_id uuid;

update whatsapp.conversations c
   set business_id = wi.business_id
  from whatsapp.whatsapp_instances wi
 where wi.id = c.instance_id
   and c.business_id is distinct from wi.business_id;

alter table whatsapp.conversations alter column business_id set not null;

-- Populate on INSERT for every writer. SECDEF/postgres so it can read
-- whatsapp_instances regardless of the inserting role. Idempotent (only fills a
-- NULL, so an explicit insert value is honoured).
create or replace function whatsapp._conversations_set_business_id()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if NEW.business_id is null then
    select wi.business_id into NEW.business_id
    from whatsapp.whatsapp_instances wi
    where wi.id = NEW.instance_id;
  end if;
  return NEW;
end;
$function$;
alter function whatsapp._conversations_set_business_id() owner to postgres;

drop trigger if exists conversations_set_business_id on whatsapp.conversations;
create trigger conversations_set_business_id
  before insert on whatsapp.conversations
  for each row
  execute function whatsapp._conversations_set_business_id();

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Bump trigger: decrypt-from-NEW + wa:biz dual-publish. Preserves mig 038's
--    19-column noise-gate and hide-transition tombstone EXACTLY.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function whatsapp._broadcast_conversation_bump()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload   jsonb;
  v_tomb      jsonb;
  v_assignee  uuid;
  v_new_vis   boolean;
  v_old_vis   boolean;
begin
  -- Noise-gate (identical to mig 038): on UPDATE, publish only when a
  -- LIST-RELEVANT column actually changed (updated_at is bumped on every write).
  if TG_OP = 'UPDATE'
     and NEW.last_message_at        is not distinct from OLD.last_message_at
     and NEW.last_message_preview_ct is not distinct from OLD.last_message_preview_ct
     and NEW.last_message_kind      is not distinct from OLD.last_message_kind
     and NEW.last_message_direction is not distinct from OLD.last_message_direction
     and NEW.last_message_sender_name is not distinct from OLD.last_message_sender_name
     and NEW.last_message_media_meta is not distinct from OLD.last_message_media_meta
     and NEW.unread_count           is not distinct from OLD.unread_count
     and NEW.is_archived            is not distinct from OLD.is_archived
     and NEW.is_pinned              is not distinct from OLD.is_pinned
     and NEW.status                 is not distinct from OLD.status
     and NEW.snoozed_until          is not distinct from OLD.snoozed_until
     and NEW.resolved_at            is not distinct from OLD.resolved_at
     and NEW.contact_id             is not distinct from OLD.contact_id
     and NEW.peer_display_name      is not distinct from OLD.peer_display_name
     and NEW.peer_profile_pic       is not distinct from OLD.peer_profile_pic
     and NEW.last_outbound_status   is not distinct from OLD.last_outbound_status
     and NEW.merged_into            is not distinct from OLD.merged_into
     and NEW.remote_jid             is not distinct from OLD.remote_jid
     and NEW.left_at                is not distinct from OLD.left_at
  then
    return NEW;
  end if;

  -- List visibility mirrors conversations_decrypted's WHERE exactly.
  v_new_vis := (NEW.merged_into is null and NEW.remote_jid not like '%@lid');

  if not v_new_vis then
    -- Row is hidden now. If it JUST became hidden via this UPDATE (was visible
    -- before), emit the same {id,deleted:true} tombstone so clients evict the
    -- ghost row (mig 038 semantics). Already-hidden writes emit nothing.
    if TG_OP = 'UPDATE' then
      v_old_vis := (OLD.merged_into is null and OLD.remote_jid not like '%@lid');
      if v_old_vis then
        v_tomb := jsonb_build_object('id', NEW.id::text, 'deleted', true);
        perform realtime.send(v_tomb, 'bump', 'wa:inst:' || NEW.instance_id::text, true);
        perform realtime.send(v_tomb, 'bump', 'wa:biz:'  || NEW.business_id::text, true);
        for v_assignee in
          select ca.user_id from whatsapp.conversation_assignments ca
          where ca.conversation_id = NEW.id
        loop
          perform realtime.send(v_tomb, 'bump', 'wa:user:' || v_assignee::text, true);
        end loop;
      end if;
    end if;
    return NEW;
  end if;

  -- Visible row → build the decrypted list row DIRECTLY from NEW (byte-identical
  -- to to_jsonb(conversations_decrypted)). One contacts PK lookup for book_name.
  v_payload := jsonb_build_object(
    'id',                        NEW.id,
    'instance_id',               NEW.instance_id,
    'remote_jid',                NEW.remote_jid,
    'is_group',                  NEW.is_group,
    'peer_display_name',         NEW.peer_display_name,
    'peer_profile_pic',          NEW.peer_profile_pic,
    'last_message_at',           NEW.last_message_at,
    'last_message_preview',      whatsapp.decrypt_text(NEW.last_message_preview_ct, NEW.key_id),
    'last_message_kind',         NEW.last_message_kind,
    'last_message_direction',    NEW.last_message_direction,
    'last_message_sender_name',  NEW.last_message_sender_name,
    'last_message_media_meta',   NEW.last_message_media_meta,
    'unread_count',              NEW.unread_count,
    'is_archived',               NEW.is_archived,
    'is_pinned',                 NEW.is_pinned,
    'status',                    NEW.status,
    'snoozed_until',             NEW.snoozed_until,
    'resolved_at',               NEW.resolved_at,
    'resolved_by',               NEW.resolved_by,
    'created_at',                NEW.created_at,
    'updated_at',                NEW.updated_at,
    'last_inbound_at',           NEW.last_inbound_at,
    'last_outbound_at',          NEW.last_outbound_at,
    'contact_id',                NEW.contact_id,
    'contact_book_name',         (select ct.book_name from whatsapp.contacts ct where ct.id = NEW.contact_id),
    'last_outbound_status',      NEW.last_outbound_status,
    'left_at',                   NEW.left_at
  );

  perform realtime.send(v_payload, 'bump', 'wa:inst:' || NEW.instance_id::text, true);
  perform realtime.send(v_payload, 'bump', 'wa:biz:'  || NEW.business_id::text, true);

  for v_assignee in
    select ca.user_id from whatsapp.conversation_assignments ca
    where ca.conversation_id = NEW.id
  loop
    perform realtime.send(v_payload, 'bump', 'wa:user:' || v_assignee::text, true);
  end loop;

  return NEW;
end;
$function$;
alter function whatsapp._broadcast_conversation_bump() owner to postgres;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Delete tombstone: add wa:biz alongside wa:inst (mig 037 semantics kept).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function whatsapp._broadcast_conversation_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tomb     jsonb := jsonb_build_object('id', OLD.id::text, 'deleted', true);
  v_assignee uuid;
begin
  perform realtime.send(v_tomb, 'bump', 'wa:inst:' || OLD.instance_id::text, true);
  perform realtime.send(v_tomb, 'bump', 'wa:biz:'  || OLD.business_id::text, true);
  for v_assignee in
    select ca.user_id from whatsapp.conversation_assignments ca
    where ca.conversation_id = OLD.id
  loop
    perform realtime.send(v_tomb, 'bump', 'wa:user:' || v_assignee::text, true);
  end loop;
  return OLD;
end;
$function$;
alter function whatsapp._broadcast_conversation_delete() owner to postgres;

commit;
