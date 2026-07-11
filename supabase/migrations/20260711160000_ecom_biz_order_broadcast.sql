-- E-commerce realtime seam — FIRST piece of W7 (owner's whole-app realtime port).
--
-- Goal now: the WhatsApp chat-header "customer orders" button must reflect a
-- newly-created / changed order for the open customer WITHOUT a manual refetch,
-- following the SAME broadcast discipline as the WhatsApp side (private
-- realtime.send topics, at-most-once, tiny payloads) instead of a postgres_changes
-- firehose. Built as a clean, reusable topic family so W7 can extend it (Orders
-- page, notifications, dashboards) rather than bolt on more postgres_changes.
--
-- Topic: ecom:biz:<business_id>  (private broadcast)
--   • READ by any AUTHENTICATED member of that business (admins AND sellers) —
--     the chat order history is business-wide, so a seller must also learn of a
--     colleague's order for the same customer. current_user_digicom_business_id()
--     is the existing public SECDEF helper.
--   • WRITE only from the trigger below (SECURITY DEFINER / postgres → bypasses
--     RLS; authenticated/anon cannot send).
--
-- Trigger cost is bounded: INSERT/DELETE always fire; UPDATE fires ONLY when a
-- column the button cares about actually changes (status, package status,
-- soft-delete, phone, price). The whole emit is wrapped so a realtime hiccup can
-- NEVER abort an order write — orders is the hottest table in the app.

begin;

-- ── read authorization (mirrors whatsapp.can_read_biz_topic) ─────────────────
create or replace function public.can_read_ecom_biz_topic(p_topic text)
returns boolean
language sql
stable
security invoker
set search_path to ''
as $function$
  select case
    when p_topic ~ '^ecom:biz:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(p_topic from 10)::uuid = public.current_user_digicom_business_id()
    else false
  end;
$function$;
revoke all on function public.can_read_ecom_biz_topic(text) from public, anon;
grant execute on function public.can_read_ecom_biz_topic(text) to authenticated;
alter function public.can_read_ecom_biz_topic(text) owner to postgres;

-- Additive SELECT policy on the broadcast table (OR'd with the wa_* policies).
drop policy if exists ecom_biz_broadcast_read on realtime.messages;
create policy ecom_biz_broadcast_read on realtime.messages
  for select to authenticated
  using (public.can_read_ecom_biz_topic(realtime.topic()));

-- ── emitter ──────────────────────────────────────────────────────────────────
create or replace function public.broadcast_order_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_biz   uuid;
  v_phone text;
  v_id    uuid;
begin
  begin
    if tg_op = 'DELETE' then
      v_biz := old."DigiCom Business"; v_phone := old.phone; v_id := old.id;
    else
      v_biz := new."DigiCom Business"; v_phone := new.phone; v_id := new.id;
    end if;
    if v_biz is not null then
      perform realtime.send(
        jsonb_build_object(
          'id',    v_id::text,
          'phone', public.normalize_phone_for_customer(v_phone),  -- matches the button's query key
          'op',    tg_op
        ),
        'order',
        'ecom:biz:' || v_biz::text,
        true
      );
    end if;
  exception when others then
    -- A broadcast failure must NEVER roll back the order write.
    null;
  end;
  return coalesce(new, old);
end;
$function$;
alter function public.broadcast_order_change() owner to postgres;

drop trigger if exists trg_broadcast_order_change_ins on public.orders;
drop trigger if exists trg_broadcast_order_change_del on public.orders;
drop trigger if exists trg_broadcast_order_change_upd on public.orders;

create trigger trg_broadcast_order_change_ins
  after insert on public.orders
  for each row execute function public.broadcast_order_change();

create trigger trg_broadcast_order_change_del
  after delete on public.orders
  for each row execute function public.broadcast_order_change();

create trigger trg_broadcast_order_change_upd
  after update on public.orders
  for each row
  when (
       old.order_status_id   is distinct from new.order_status_id
    or old.package_status_id is distinct from new.package_status_id
    or old.date_deleted      is distinct from new.date_deleted
    or old.phone             is distinct from new.phone
    or old.price             is distinct from new.price
  )
  execute function public.broadcast_order_change();

commit;
