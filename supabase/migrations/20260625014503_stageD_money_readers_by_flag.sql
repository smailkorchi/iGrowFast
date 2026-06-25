-- Stage D: money readers key delivered on is_delivered flag (== category='delivered', proven).
CREATE OR REPLACE FUNCTION public.mb_month_earned(p_mb uuid, p_business_id uuid, p_month date)
 RETURNS TABLE(earned numeric, delivered integer, spend numeric, campaigns integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_pt text; v_price numeric; v_salary numeric; v_del int; v_spend numeric; v_camps int;
begin
  select payment_type, coalesce(commission_price,0), coalesce(salary_amount,0)
    into v_pt, v_price, v_salary from public.users where id = p_mb;
  select coalesce(sum(cde.spend),0), count(distinct coalesce(cde.campaign_id::text, '__orphan__'||cde.platform))
    into v_spend, v_camps
    from public.campaign_daily_entries cde
   where cde.created_by = p_mb and cde."DigiCom Business" = p_business_id
     and date_trunc('month', cde.entry_date)::date = date_trunc('month', p_month)::date;
  if v_pt = 'salary' then
    return query select coalesce(v_salary,0)::numeric, 0, coalesce(v_spend,0), coalesce(v_camps,0)::int; return;
  end if;
  select count(distinct o.id)::int into v_del
  from public.campaign_daily_entries e
  join public.orders o
    on (o.date at time zone 'Africa/Casablanca')::date = e.entry_date
   and lower(o.source_name) = case lower(e.platform)
        when 'whatsapp ads' then 'whatsapp'  when 'messenger ads' then 'messenger'
        when 'instagram ads' then 'instagram' when 'facebook ads' then 'facebook'
        when 'google ads' then 'google'       when 'tiktok ads' then 'tiktok'
        when 'native ads' then 'native'       when 'snapchat ads' then 'snapchat'
        when 'twitter ads' then 'twitter'     when 'bing ads' then 'bing'
        when 'pinterest ads' then 'pinterest' when 'reddit ads' then 'reddit'
        else '' end
  join public.package_statuses ps on ps.id = o.package_status_id
  where e.created_by = p_mb and e."DigiCom Business" = p_business_id
    and date_trunc('month', e.entry_date)::date = date_trunc('month', p_month)::date
    and o."DigiCom Business" = p_business_id and ps.is_delivered
    and o.date_deleted is null and o.source_review_status is distinct from 'pending' and coalesce(o.swap_only, false) = false;
  return query select coalesce(v_del,0) * v_price, coalesce(v_del,0), coalesce(v_spend,0), coalesce(v_camps,0)::int;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mediabuyer_month_orders(p_mb uuid, p_business uuid, p_month date)
 RETURNS TABLE(order_id uuid, client text, phone text, tracking text, bucket_date date, source text, delivered_at timestamp with time zone, units integer, commission numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    o.id, o.name, o.phone,
    COALESCE(
      NULLIF(btrim(o.tracking_number), ''),
      (SELECT cp.tracking_code FROM courier_parcels cp WHERE cp.order_id = o.id AND NULLIF(btrim(cp.tracking_code), '') IS NOT NULL ORDER BY cp.created_at DESC LIMIT 1),
      (SELECT pp.tracking_code FROM company_parcels pp WHERE pp.order_id = o.id AND NULLIF(btrim(pp.tracking_code), '') IS NOT NULL ORDER BY pp.created_at DESC LIMIT 1)
    ),
    (o.date AT TIME ZONE 'Africa/Casablanca')::date,
    lower(o.source_name),
    COALESCE(o.date_livraison, o.updated_at),
    COALESCE((SELECT sum(oi.quantity)::int FROM order_items oi WHERE oi.order_id = o.id), 0),
    COALESCE(u.commission_price, 0)
  FROM orders o
    JOIN users u ON u.id = p_mb
    JOIN package_statuses ps ON ps.id = o.package_status_id
  WHERE o."DigiCom Business" IS NOT DISTINCT FROM p_business
    AND ps.is_delivered
    AND o.date_deleted IS NULL
    AND o.source_review_status IS DISTINCT FROM 'pending'
    AND COALESCE(o.swap_only, false) = false
    AND EXISTS (
      SELECT 1 FROM campaign_daily_entries e
      WHERE e.created_by = p_mb AND e."DigiCom Business" = p_business
        AND date_trunc('month', e.entry_date)::date = date_trunc('month', p_month)::date
        AND e.entry_date = (o.date AT TIME ZONE 'Africa/Casablanca')::date
        AND lower(o.source_name) = CASE lower(e.platform)
            WHEN 'whatsapp ads' THEN 'whatsapp'  WHEN 'messenger ads' THEN 'messenger'
            WHEN 'instagram ads' THEN 'instagram' WHEN 'facebook ads' THEN 'facebook'
            WHEN 'google ads' THEN 'google'       WHEN 'tiktok ads' THEN 'tiktok'
            WHEN 'native ads' THEN 'native'       WHEN 'snapchat ads' THEN 'snapchat'
            WHEN 'twitter ads' THEN 'twitter'     WHEN 'bing ads' THEN 'bing'
            WHEN 'pinterest ads' THEN 'pinterest' WHEN 'reddit ads' THEN 'reddit'
            ELSE '' END
    )
    AND (auth.uid() = p_mb OR is_owner() OR check_user_role(auth.uid(), ARRAY['super admin','admin']))
  ORDER BY COALESCE(o.date_livraison, o.updated_at) ASC;
$function$;

CREATE OR REPLACE FUNCTION public.seller_month_orders(p_seller uuid, p_business uuid, p_month date)
 RETURNS TABLE(order_id uuid, client text, phone text, tracking text, delivered_at timestamp with time zone, units integer, commission numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT
        o.id, o.name, o.phone,
        COALESCE(
            NULLIF(btrim(o.tracking_number), ''),
            (SELECT cp.tracking_code FROM courier_parcels cp WHERE cp.order_id = o.id AND NULLIF(btrim(cp.tracking_code), '') IS NOT NULL ORDER BY cp.created_at DESC LIMIT 1),
            (SELECT pp.tracking_code FROM company_parcels pp WHERE pp.order_id = o.id AND NULLIF(btrim(pp.tracking_code), '') IS NOT NULL ORDER BY pp.created_at DESC LIMIT 1)
        ),
        COALESCE(o.date_livraison, o.updated_at),
        CASE WHEN COALESCE(u.commission_basis, 'per_order') = 'per_unit'
             THEN sum_order_units_for_seller_products(o.id, o.seller_id)
             ELSE 1 END::integer,
        CASE WHEN COALESCE(u.commission_basis, 'per_order') = 'per_unit'
             THEN COALESCE(u.commission_price, 0) * sum_order_units_for_seller_products(o.id, o.seller_id)::numeric
             ELSE COALESCE(u.commission_price, 0) END
    FROM orders o
        JOIN users u ON u.id = o.seller_id
        JOIN package_statuses ps ON ps.id = o.package_status_id
    WHERE o.seller_id = p_seller
      AND o."DigiCom Business" IS NOT DISTINCT FROM p_business
      AND ps.is_delivered
      AND o.date_deleted IS NULL
      AND o.source_review_status IS DISTINCT FROM 'pending'
      AND date_trunc('month', COALESCE(o.date_livraison, o.updated_at)) = date_trunc('month', p_month::timestamptz)
      AND (auth.uid() = p_seller OR is_owner() OR check_user_role(auth.uid(), ARRAY['super admin','admin']))
    ORDER BY 5 DESC;
$function$;

CREATE OR REPLACE VIEW public.seller_daily_earnings AS
 SELECT md5((o.seller_id::text || date(COALESCE(o.date_livraison, o.updated_at))::text) || COALESCE(o."DigiCom Business"::text, ''::text))::uuid AS id,
    o.seller_id,
    date(COALESCE(o.date_livraison, o.updated_at)) AS date,
    0::numeric AS salary_earned,
    sum(CASE WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN COALESCE(u.commission_price, 0::numeric) * sum_order_units_for_seller_products(o.id, o.seller_id)::numeric ELSE COALESCE(u.commission_price, 0::numeric) END) AS commission_earned,
    sum(CASE WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN sum_order_units_for_seller_products(o.id, o.seller_id) ELSE 1::bigint END)::integer AS delivered_count,
    sum(CASE WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN COALESCE(u.commission_price, 0::numeric) * sum_order_units_for_seller_products(o.id, o.seller_id)::numeric ELSE COALESCE(u.commission_price, 0::numeric) END) AS total_earned,
    max(o.updated_at) AS created_at,
    o."DigiCom Business"
   FROM orders o
     JOIN users u ON u.id = o.seller_id
     JOIN package_statuses ps ON ps.id = o.package_status_id
  WHERE o.seller_id IS NOT NULL AND ps.is_delivered AND o.date_deleted IS NULL AND o.source_review_status IS DISTINCT FROM 'pending'::text AND COALESCE(o.swap_only, false) = false
  GROUP BY o.seller_id, (date(COALESCE(o.date_livraison, o.updated_at))), o."DigiCom Business";
