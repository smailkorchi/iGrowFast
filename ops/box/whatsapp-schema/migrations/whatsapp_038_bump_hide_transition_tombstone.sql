-- whatsapp_038_bump_hide_transition_tombstone.sql
-- Stage-C correctness (verify pass): a conversation that transitions from
-- list-VISIBLE to list-HIDDEN via an UPDATE (merged_into set, or remote_jid
-- rewritten to @lid) passes the bump noise-gate but then yields a NULL payload
-- (conversations_decrypted excludes merged/@lid rows), so the current trigger
-- returns WITHOUT broadcasting — leaving a ghost loser row in loaded list caches
-- (symmetric to the hard-DELETE ghost fixed in 037, but via the merge path).
--
-- Fix: when a bump-eligible UPDATE yields a NULL (view-excluded) payload AND the
-- row was list-visible BEFORE, emit the same {id,deleted:true} tombstone the
-- delete trigger uses. Rows that were ALREADY hidden (steady-state @lid writes)
-- emit nothing — no tombstone noise.
--
-- Visibility predicate mirrors conversations_decrypted exactly:
--   visible := merged_into IS NULL AND remote_jid NOT LIKE '%@lid'
--
-- Reversible: re-run whatsapp_037's _broadcast_conversation_bump body.
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp._broadcast_conversation_bump()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload  jsonb;
  v_assignee uuid;
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

  select to_jsonb(cd.*) into v_payload
  from whatsapp.conversations_decrypted cd
  where cd.id = NEW.id;

  -- Row is NOT list-visible (merged/@lid). If it JUST became hidden (was visible
  -- before this UPDATE), broadcast a tombstone so clients evict the ghost;
  -- otherwise it was already hidden → nothing to do.
  if v_payload is null then
    if TG_OP = 'UPDATE'
       and (OLD.merged_into is null and OLD.remote_jid not like '%@lid')          -- OLD visible
       and not (NEW.merged_into is null and NEW.remote_jid not like '%@lid')      -- NEW hidden
    then
      v_payload := jsonb_build_object('id', NEW.id::text, 'deleted', true);
      perform realtime.send(v_payload, 'bump', 'wa:inst:' || NEW.instance_id::text, true);
      for v_assignee in
        select ca.user_id from whatsapp.conversation_assignments ca where ca.conversation_id = NEW.id
      loop
        perform realtime.send(v_payload, 'bump', 'wa:user:' || v_assignee::text, true);
      end loop;
    end if;
    return NEW;
  end if;

  -- Normal visible bump.
  perform realtime.send(v_payload, 'bump', 'wa:inst:' || NEW.instance_id::text, true);
  for v_assignee in
    select ca.user_id from whatsapp.conversation_assignments ca where ca.conversation_id = NEW.id
  loop
    perform realtime.send(v_payload, 'bump', 'wa:user:' || v_assignee::text, true);
  end loop;

  return NEW;
end;
$function$;

alter function whatsapp._broadcast_conversation_bump() owner to postgres;

commit;
