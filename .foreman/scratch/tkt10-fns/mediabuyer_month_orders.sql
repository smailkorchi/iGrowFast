CREATE OR REPLACE FUNCTION public.mediabuyer_month_orders(p_mb uuid, p_business uuid, p_month date)
 RETURNS TABLE(order_id uuid, client text, phone text, tracking text, bucket_date date, source text, delivered_at timestamp with time zone, units integer, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id, o.name, o.phone,
    COALESCE(
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
    AND (auth.uid() = p_mb
         OR (public.current_user_digicom_business_id() = p_business
             AND check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  ORDER BY COALESCE(o.date_livraison, o.updated_at) ASC;
$function$

