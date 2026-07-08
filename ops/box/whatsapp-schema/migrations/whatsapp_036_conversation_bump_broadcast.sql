-- whatsapp_036_conversation_bump_broadcast.sql
-- Stage-2 list-bump cutover (owner-chosen first signal). Moves the conversations
-- "bump" firehose (~89% of WhatsApp WAL on the supabase_realtime slot) toward
-- worker-independent broadcast. ADDITIVE + fail-safe: postgres_changes on
-- whatsapp.conversations stays live and authoritative; this only ADDS broadcast
-- rows. No frontend change here. The WAL win lands later (Stage C) when the
-- frontend consumes these broadcasts and conversations is dropped from the
-- supabase_realtime publication.
--
-- Mechanism = an AFTER INSERT/UPDATE trigger on whatsapp.conversations (fires no
-- matter WHO writes: worker ingest_message, dispatcher, or a frontend RPC like
-- pin/archive/mark-read), SECURITY DEFINER owned by `postgres` (BYPASSRLS) so the
-- realtime.messages INSERT always lands regardless of the writing role. It
-- publishes ONE decrypted list-row (identical shape to conversations_decrypted)
-- to:
--    wa:inst:<instance_id>   -- business-admins of that instance (see all convs)
--    wa:user:<user_id>       -- each currently-assigned agent (their convs only)
-- => no per-instance leak to agents. realtime.send() swallows its own errors
-- (RAISE WARNING), so a broadcast failure can never break a conversation write.
--
-- Topics carry the DECRYPTED preview (safe: both channels are access-gated), so
-- the client patches its list entry with zero refetch.
--
-- Reversible:
--   drop trigger conversations_broadcast_bump on whatsapp.conversations;
--   drop function whatsapp._broadcast_conversation_bump();
--   drop policy wa_inst_broadcast_read on realtime.messages;
--   drop policy wa_user_broadcast_read on realtime.messages;
--   drop function whatsapp.can_read_inst_topic(text);
--   drop function whatsapp.can_read_user_topic(text);
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- ---------------------------------------------------------------------------
-- 1) Read-authorization guards for the two new topic families.
-- ---------------------------------------------------------------------------

-- wa:inst:<uuid> -> only business-admins of that instance. Delegates to the
-- existing is_wa_admin -> admin_instance_ids chain (already SECDEF). Never throws.
create or replace function whatsapp.can_read_inst_topic(p_topic text)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when p_topic ~ '^wa:inst:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then whatsapp.is_wa_admin(substring(p_topic from 9)::uuid)
    else false
  end;
$function$;

comment on function whatsapp.can_read_inst_topic(text) is
  'Realtime read gate for wa:inst:<uuid>: true iff caller is a business-admin of that instance. Malformed topics return false.';

-- wa:user:<uuid> -> only that user. Pure claim comparison, no table access.
create or replace function whatsapp.can_read_user_topic(p_topic text)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when p_topic ~ '^wa:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(p_topic from 9)::uuid = auth.uid()
    else false
  end;
$function$;

comment on function whatsapp.can_read_user_topic(text) is
  'Realtime read gate for wa:user:<uuid>: true iff the topic uuid equals auth.uid(). Malformed topics return false.';

grant execute on function whatsapp.can_read_inst_topic(text) to authenticated, service_role;
grant execute on function whatsapp.can_read_user_topic(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) SELECT policies on realtime.messages (permissive; OR with 035's conv policy).
-- ---------------------------------------------------------------------------
drop policy if exists wa_inst_broadcast_read on realtime.messages;
create policy wa_inst_broadcast_read
  on realtime.messages
  for select
  to authenticated
  using ( whatsapp.can_read_inst_topic(realtime.topic()) );

drop policy if exists wa_user_broadcast_read on realtime.messages;
create policy wa_user_broadcast_read
  on realtime.messages
  for select
  to authenticated
  using ( whatsapp.can_read_user_topic(realtime.topic()) );

-- ---------------------------------------------------------------------------
-- 3) The bump publisher trigger.
-- ---------------------------------------------------------------------------
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
  -- On UPDATE, only publish when a LIST-RELEVANT column actually changed. The
  -- BEFORE conversations_updated_at trigger bumps updated_at on every write, so
  -- gate on display columns to avoid noise while never missing a real change.
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
  then
    return NEW;
  end if;

  -- Build the decrypted list row (same shape the frontend already consumes).
  -- The view filters merged/@lid convs -> null payload -> nothing to publish
  -- (those never appear in the list anyway).
  select to_jsonb(cd.*) into v_payload
  from whatsapp.conversations_decrypted cd
  where cd.id = NEW.id;

  if v_payload is null then
    return NEW;
  end if;

  -- Admins of the instance.
  perform realtime.send(v_payload, 'bump', 'wa:inst:' || NEW.instance_id::text, true);

  -- Each currently-assigned agent.
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

comment on function whatsapp._broadcast_conversation_bump() is
  'AFTER INSERT/UPDATE on whatsapp.conversations: publishes the decrypted list row to wa:inst:<instance> (admins) and wa:user:<assignee> (agents) via realtime.send. Fail-safe (realtime.send swallows errors). SECDEF/postgres so the realtime.messages INSERT lands for any writing role.';

drop trigger if exists conversations_broadcast_bump on whatsapp.conversations;
create trigger conversations_broadcast_bump
  after insert or update on whatsapp.conversations
  for each row
  execute function whatsapp._broadcast_conversation_bump();

-- ---------------------------------------------------------------------------
-- 4) Ownership hygiene: own new SECDEF objects (and the 035 pair) as `postgres`
--    (BYPASSRLS, non-superuser) to match existing whatsapp SECDEF convention and
--    avoid superuser-owned SECURITY DEFINER.
-- ---------------------------------------------------------------------------
alter function whatsapp._broadcast_conversation_bump()          owner to postgres;
alter function whatsapp.can_read_inst_topic(text)               owner to postgres;
alter function whatsapp.can_read_user_topic(text)               owner to postgres;
alter function whatsapp.can_access_conversation(uuid)           owner to postgres;
alter function whatsapp.can_access_conv_topic(text)             owner to postgres;

commit;
