-- whatsapp_047_drop_wa_inst_bump.sql
-- Enterprise-scale plan PHASE 2a CLEANUP. Removes the now-unused wa:inst:<id>
-- conversation-bump channel family, leaving wa:biz:<business_id> (admins) and
-- wa:user:<uid> (agents). Mig 046 dual-published to wa:inst + wa:biz during
-- rollout; the frontend (commit aec3e8f) moved admins to wa:biz.
--
-- ⚠️ GATE — APPLY ONLY AFTER A GRACE WINDOW. Admin browser tabs opened BEFORE the
-- aec3e8f bundle deployed still subscribe wa:inst:<id> from their cached JS until
-- they reload. Dropping the wa:inst emitters + read policy strands those live
-- sessions (their inbox stops live-updating until refresh). Apply this only once
-- all active admin tabs have picked up the new bundle (a day is safe; or confirm
-- no wa:inst subscribers remain). Everything here is reversible by re-running
-- mig 046 + mig 044's can_read_inst pieces.
--
-- Removes: the two wa:inst perform-sends in _broadcast_conversation_bump (normal
-- bump + hide-transition tombstone), the wa:inst send in
-- _broadcast_conversation_delete, the wa_inst_broadcast_read policy, and
-- can_read_inst_topic(text). KEEPS wa:user (agents) + wa:biz (admins) intact.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp._broadcast_conversation_bump()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_payload   jsonb;
  v_tomb      jsonb;
  v_assignee  uuid;
  v_new_vis   boolean;
  v_old_vis   boolean;
begin
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

  v_new_vis := (NEW.merged_into is null and NEW.remote_jid not like '%@lid');

  if not v_new_vis then
    if TG_OP = 'UPDATE' then
      v_old_vis := (OLD.merged_into is null and OLD.remote_jid not like '%@lid');
      if v_old_vis then
        v_tomb := jsonb_build_object('id', NEW.id::text, 'deleted', true);
        perform realtime.send(v_tomb, 'bump', 'wa:biz:' || NEW.business_id::text, true);
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

  perform realtime.send(v_payload, 'bump', 'wa:biz:' || NEW.business_id::text, true);
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

create or replace function whatsapp._broadcast_conversation_delete()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_tomb     jsonb := jsonb_build_object('id', OLD.id::text, 'deleted', true);
  v_assignee uuid;
begin
  perform realtime.send(v_tomb, 'bump', 'wa:biz:' || OLD.business_id::text, true);
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

-- Read authz for the retired topic family.
drop policy if exists wa_inst_broadcast_read on realtime.messages;
drop function if exists whatsapp.can_read_inst_topic(text);

commit;
