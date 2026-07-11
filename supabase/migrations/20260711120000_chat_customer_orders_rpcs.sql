-- Chat "orders history" button (WhatsApp inbox header).
--
-- Two read-only RPCs powering the per-customer order history in the chat
-- header. Design constraints (owner-approved walkthrough 2026-07-11):
--   • Badge count fires ONCE per thread open (react-query cached) and the
--     page query ONLY on click — never on the conversation list (no N+1).
--   • Both hit the EXISTING partial expression index
--     idx_orders_business_phonenorm_live ("DigiCom Business",
--     normalize_phone_for_customer(phone)) WHERE date_deleted IS NULL —
--     no new index needed. WhatsApp remote_jid digits are already the
--     canonical '212…' form normalize_phone_for_customer produces.
--   • SECURITY DEFINER because the owner ruled the history is BUSINESS-WIDE
--     in the seller inbox too (seller RLS on orders would hide other
--     sellers' orders). Business is derived from the CALLER (never a
--     parameter) and the caller must be admin or seller. Column discipline:
--     list fields only (name/price/date/status labels/product/seller_id) —
--     no notes, no addresses, no commissions.

begin;

create or replace function public.chat_customer_orders_count(p_phone text)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case when exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('super admin', 'admin', 'commercial')
    )
    then (
      select count(*)::int
      from public.orders o
      where o."DigiCom Business" = public.current_user_digicom_business_id()
        and public.normalize_phone_for_customer(o.phone)
              = public.normalize_phone_for_customer(p_phone)
        and o.date_deleted is null
    )
    else 0
  end;
$function$;

create or replace function public.chat_customer_orders_page(
  p_phone text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  price numeric,
  order_date timestamptz,
  order_status_label text,
  order_status_color text,
  order_status_icon text,
  package_status_label text,
  package_status_color text,
  package_status_icon text,
  product_name text,
  product_image text,
  extra_items integer,
  seller_id uuid
)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.id, o.name, o.price, o.date,
         os.label, os.color, os.icon,
         ps.label, ps.color, ps.icon,
         pi.product_name, pi.image_url, coalesce(pi.extra, 0),
         o.seller_id
  from public.orders o
  left join public.order_statuses   os on os.id = o.order_status_id
  left join public.package_statuses ps on ps.id = o.package_status_id
  left join lateral (
    select p.name as product_name, p.image_url,
           (select count(*)::int - 1
              from public.order_items oi2
             where oi2.order_id = o.id and oi2.product_id is not null) as extra
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = o.id and oi.product_id is not null
    order by oi.created_at
    limit 1
  ) pi on true
  where exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('super admin', 'admin', 'commercial')
    )
    and o."DigiCom Business" = public.current_user_digicom_business_id()
    and public.normalize_phone_for_customer(o.phone)
          = public.normalize_phone_for_customer(p_phone)
    and o.date_deleted is null
  order by o.date desc nulls last, o.id desc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$function$;

revoke all on function public.chat_customer_orders_count(text)                    from public, anon;
revoke all on function public.chat_customer_orders_page(text, integer, integer)   from public, anon;
grant execute on function public.chat_customer_orders_count(text)                  to authenticated;
grant execute on function public.chat_customer_orders_page(text, integer, integer) to authenticated;

commit;
