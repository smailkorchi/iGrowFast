-- whatsapp_052_assignment_tag_broadcasts.sql
-- Enterprise-scale plan PHASE 2b (unified-channel foundation). The last 3 WhatsApp
-- tables on postgres_changes — conversation_assignments, conversation_tags, tags —
-- get SECDEF triggers → realtime.send so the frontend can retire their
-- postgres_changes bindings (and, with the whole app off postgres_changes + W7,
-- the wal2json slot can eventually be dropped). These are AGENT-FACING, so routing
-- is dual: wa:biz:<business_id> for business admins + wa:user:<user_id> for the
-- affected agent(s). Minimal payloads (the consumers only invalidate).
--
--   • conversation_assignments → event 'assignment'. business_id via the
--     conversation (denormalized conversations.business_id). Agent routing is the
--     SECURITY-critical part: an unassign (DELETE) must reach the removed agent's
--     wa:user so their inbox drops the conversation (revocation). INSERT→NEW.user,
--     DELETE→OLD.user, UPDATE→both if user changed.
--   • conversation_tags → event 'conv_tag'. business_id via conversation. Fans out
--     to wa:user for EACH current assignee of the conversation (they see the chip).
--   • tags (the label library) → event 'tag'. business_id via the instance.
--     ADMINS ONLY (wa:biz) — agents pick up label edits via the 60 s staleTime
--     refetch (rare changes), avoiding an instance-wide agent fan-out.
--
-- Fail-safe (realtime.send swallows errors). ADDITIVE — postgres_changes stays
-- live until the frontend unified channel is verified.
--
-- Reversible: drop the 3 triggers + functions.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- conversation_assignments → 'assignment' (wa:biz + affected wa:user).
create or replace function whatsapp._broadcast_assignment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conv uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  v_biz  uuid;
  v_payload jsonb;
begin
  select c.business_id into v_biz from whatsapp.conversations c where c.id = v_conv;
  v_payload := jsonb_build_object('conversation_id', v_conv::text);

  -- Admins of the business (skip if the conversation is already gone — its own
  -- delete tombstone covered eviction).
  if v_biz is not null then
    perform realtime.send(v_payload, 'assignment', 'wa:biz:' || v_biz::text, true);
  end if;

  -- Affected agent(s): the one gaining/losing the assignment (revocation-critical).
  if TG_OP <> 'DELETE' and NEW.user_id is not null then
    perform realtime.send(v_payload, 'assignment', 'wa:user:' || NEW.user_id::text, true);
  end if;
  if TG_OP <> 'INSERT' and OLD.user_id is not null
     and (TG_OP = 'DELETE' or OLD.user_id is distinct from NEW.user_id) then
    perform realtime.send(v_payload, 'assignment', 'wa:user:' || OLD.user_id::text, true);
  end if;

  return coalesce(NEW, OLD);
end;
$function$;
alter function whatsapp._broadcast_assignment() owner to postgres;

drop trigger if exists conversation_assignments_broadcast on whatsapp.conversation_assignments;
create trigger conversation_assignments_broadcast
  after insert or update or delete on whatsapp.conversation_assignments
  for each row execute function whatsapp._broadcast_assignment();

-- conversation_tags → 'conv_tag' (wa:biz + each conversation assignee's wa:user).
create or replace function whatsapp._broadcast_conv_tag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conv uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  v_biz  uuid;
  v_payload jsonb;
  v_assignee uuid;
begin
  select c.business_id into v_biz from whatsapp.conversations c where c.id = v_conv;
  v_payload := jsonb_build_object('conversation_id', v_conv::text);

  if v_biz is not null then
    perform realtime.send(v_payload, 'conv_tag', 'wa:biz:' || v_biz::text, true);
  end if;

  for v_assignee in
    select ca.user_id from whatsapp.conversation_assignments ca where ca.conversation_id = v_conv
  loop
    perform realtime.send(v_payload, 'conv_tag', 'wa:user:' || v_assignee::text, true);
  end loop;

  return coalesce(NEW, OLD);
end;
$function$;
alter function whatsapp._broadcast_conv_tag() owner to postgres;

drop trigger if exists conversation_tags_broadcast on whatsapp.conversation_tags;
create trigger conversation_tags_broadcast
  after insert or update or delete on whatsapp.conversation_tags
  for each row execute function whatsapp._broadcast_conv_tag();

-- tags (label library) → 'tag' (wa:biz admins only; agents use 60s staleTime).
create or replace function whatsapp._broadcast_tag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inst uuid := coalesce(NEW.instance_id, OLD.instance_id);
  v_biz  uuid;
begin
  select wi.business_id into v_biz from whatsapp.whatsapp_instances wi where wi.id = v_inst;
  if v_biz is not null then
    perform realtime.send(
      jsonb_build_object('instance_id', v_inst::text),
      'tag', 'wa:biz:' || v_biz::text, true);
  end if;
  return coalesce(NEW, OLD);
end;
$function$;
alter function whatsapp._broadcast_tag() owner to postgres;

drop trigger if exists tags_broadcast on whatsapp.tags;
create trigger tags_broadcast
  after insert or update or delete on whatsapp.tags
  for each row execute function whatsapp._broadcast_tag();

commit;
