CREATE OR REPLACE FUNCTION public.chat_customer_orders_page(p_phone text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, price numeric, order_date timestamp with time zone, order_status_label text, order_status_color text, order_status_icon text, package_status_label text, package_status_color text, package_status_icon text, product_name text, product_image text, extra_items integer, seller_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

