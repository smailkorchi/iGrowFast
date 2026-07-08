-- whatsapp_037_bump_gate_and_delete_tombstone.sql
-- Stage-C correctness hardening (adversarial review of the conversations-off-
-- publication cutover). Two gaps the bump path must close before the frontend
-- stops relying on conversations postgres_changes:
--
--  1) VISIBILITY-TRANSITION bumps were missed. The UPDATE noise-gate skipped
--     changes to remote_jid and left_at. But @lid->phone "promote in place"
--     (whatsapp_010b_resolution) rewrites remote_jid with contact_id already set
--     => no gated column changed => no bump => the newly list-VISIBLE conversation
--     (conversations_decrypted filters remote_jid LIKE '%@lid') never appeared.
--     And a group-leave sets left_at alone => stale "left" state. Fix: add
--     remote_jid + left_at to the gate.
--
--  2) HARD DELETE emitted NOTHING. The bump trigger is INSERT/UPDATE only, and
--     conversations is leaving the supabase_realtime publication, so a
--     conversation-cleanup mode='delete' (DELETE FROM conversations) produced no
--     realtime signal => a ghost row lingered on every non-acting client. Fix: a
--     BEFORE DELETE trigger broadcasts a tombstone {id, deleted:true} to
--     wa:inst:<instance> (admins) and each assignee's wa:user:<uid>. BEFORE (not
--     AFTER) so conversation_assignments is still present to enumerate assignees,
--     and it is transactionally safe (realtime.send's INSERT rolls back with the
--     delete if it aborts, so a tombstone is delivered only if the delete commits).
--
-- Reversible: re-run whatsapp_036's function body (without the 2 gate lines) and
--   drop trigger conversations_broadcast_delete + function
--   whatsapp._broadcast_conversation_delete().
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1) Recreate the bump trigger fn with remote_jid + left_at added to the gate.
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
     and NEW.remote_jid             is not distinct from OLD.remote_jid   -- @lid->phone promote (visibility transition)
     and NEW.left_at                is not distinct from OLD.left_at      -- group-leave state
  then
    return NEW;
  end if;

  select to_jsonb(cd.*) into v_payload
  from whatsapp.conversations_decrypted cd
  where cd.id = NEW.id;

  if v_payload is null then
    return NEW;
  end if;

  perform realtime.send(v_payload, 'bump', 'wa:inst:' || NEW.instance_id::text, true);

  for v_assignee in
    select ca.user_id
    from whatsapp.conversation_assignments ca
    where ca.conversation_id = NEW.id
  loop
    perform realtime.send(v_payload, 'bump', 'wa:user:' || v_assignee::text, true);
  end loop;

  return NEW;
end;
$function$;

alter function whatsapp._broadcast_conversation_bump() owner to postgres;

-- 2) Delete tombstone. BEFORE DELETE so assignees are still enumerable.
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
  -- Admins of the instance.
  perform realtime.send(v_tomb, 'bump', 'wa:inst:' || OLD.instance_id::text, true);
  -- Each assignee (belt-and-suspenders; agents also self-heal via the assignment
  -- cascade DELETE -> conversation_assignments postgres_changes -> onAssignmentChange).
  for v_assignee in
    select ca.user_id
    from whatsapp.conversation_assignments ca
    where ca.conversation_id = OLD.id
  loop
    perform realtime.send(v_tomb, 'bump', 'wa:user:' || v_assignee::text, true);
  end loop;
  return OLD;
end;
$function$;

comment on function whatsapp._broadcast_conversation_delete() is
  'BEFORE DELETE on whatsapp.conversations: broadcasts a {id,deleted:true} tombstone to wa:inst:<instance> + each assignee wa:user:<uid> so non-acting clients evict the ghost row (conversations is no longer in the realtime publication). Fail-safe via realtime.send.';

drop trigger if exists conversations_broadcast_delete on whatsapp.conversations;
create trigger conversations_broadcast_delete
  before delete on whatsapp.conversations
  for each row
  execute function whatsapp._broadcast_conversation_delete();

alter function whatsapp._broadcast_conversation_delete() owner to postgres;

commit;
