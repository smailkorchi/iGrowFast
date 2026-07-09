-- whatsapp_051_qr_scheduled_wa_biz.sql
-- Enterprise-scale plan PHASE 2b — the two ADMIN-ONLY low-churn tables. Both
-- realtime hooks are mounted only in admin conversation panels (QuickRepliesPanel,
-- ScheduledMessagesPanel), so they route to wa:biz:<business_id> ONLY (no agent
-- wa:user fan-out). SECDEF triggers → realtime.send; the frontend consumers move
-- off postgres_changes to a wa:biz broadcast, then both tables leave the
-- supabase_realtime publication.
--
--   • quick_replies   — business-scoped (HAS business_id). Event 'quick_reply'.
--   • scheduled_messages — instance-scoped; business_id resolved via the instance.
--     Payload carries conversation_id (the frontend hook keys its list on it).
--     Event 'scheduled'.
--
-- Minimal payloads: the frontend consumers only INVALIDATE (refetch), so the
-- broadcast just needs to carry the routing/scope key. Fail-safe (realtime.send
-- swallows its own errors). ADDITIVE — postgres_changes stays live until the
-- frontend is verified on wa:biz.
--
-- Reversible: drop the two triggers + functions.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- quick_replies → wa:biz (business_id is a direct column).
create or replace function whatsapp._broadcast_quick_reply()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if TG_OP = 'DELETE' then
    perform realtime.send(jsonb_build_object('id', OLD.id::text),
      'quick_reply', 'wa:biz:' || OLD.business_id::text, true);
    return OLD;
  end if;
  perform realtime.send(jsonb_build_object('id', NEW.id::text),
    'quick_reply', 'wa:biz:' || NEW.business_id::text, true);
  return NEW;
end;
$function$;
alter function whatsapp._broadcast_quick_reply() owner to postgres;

drop trigger if exists quick_replies_broadcast on whatsapp.quick_replies;
create trigger quick_replies_broadcast
  after insert or update or delete on whatsapp.quick_replies
  for each row execute function whatsapp._broadcast_quick_reply();

-- scheduled_messages → wa:biz (business_id via the owning instance).
create or replace function whatsapp._broadcast_scheduled_message()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_biz uuid;
begin
  if TG_OP = 'DELETE' then
    select wi.business_id into v_biz from whatsapp.whatsapp_instances wi where wi.id = OLD.instance_id;
    if v_biz is not null then
      perform realtime.send(
        jsonb_build_object('id', OLD.id::text, 'conversation_id', OLD.conversation_id::text),
        'scheduled', 'wa:biz:' || v_biz::text, true);
    end if;
    return OLD;
  end if;
  select wi.business_id into v_biz from whatsapp.whatsapp_instances wi where wi.id = NEW.instance_id;
  if v_biz is not null then
    perform realtime.send(
      jsonb_build_object('id', NEW.id::text, 'conversation_id', NEW.conversation_id::text),
      'scheduled', 'wa:biz:' || v_biz::text, true);
  end if;
  return NEW;
end;
$function$;
alter function whatsapp._broadcast_scheduled_message() owner to postgres;

drop trigger if exists scheduled_messages_broadcast on whatsapp.scheduled_messages;
create trigger scheduled_messages_broadcast
  after insert or update or delete on whatsapp.scheduled_messages
  for each row execute function whatsapp._broadcast_scheduled_message();

commit;
