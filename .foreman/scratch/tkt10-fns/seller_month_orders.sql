CREATE OR REPLACE FUNCTION public.seller_month_orders(p_seller uuid, p_business uuid, p_month date)
 RETURNS TABLE(order_id uuid, client text, phone text, tracking text, delivered_at timestamp with time zone, units integer, commission numeric)
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
      AND COALESCE(o.swap_only, false) = false
      AND date_trunc('month', COALESCE(o.date_livraison, o.updated_at)) = date_trunc('month', p_month::timestamptz)
      AND (auth.uid() = p_seller
           OR (public.current_user_digicom_business_id() = p_business
               AND check_user_role(auth.uid(), ARRAY['super admin','admin'])))
    ORDER BY 5 DESC, 1;
$function$

