-- Drop the dead public.orders.tracking_number column (phase 2/2).
--
-- tracking_number was a legacy column fully superseded by company_parcels.tracking_code /
-- courier_parcels.tracking_code. Verified 2026-06-28 (7-agent blast-radius audit + adversarial
-- completeness & money-parity verification): 0 of 1719 rows populated; the ONLY DB writer was
-- clear_order_logistics_when_no_parcels (SET = NULL only); referenced read-side by exactly 4
-- functions, all of which use it only as an always-empty fallback term.
--
-- This migration rewrites all 4 functions to drop the dead term, THEN drops the column — in ONE
-- migration so a from-scratch replay (which recreates the historical function bodies) stays
-- consistent and the DROP never meets a function that still references the column.
--
-- Behavior is identical: the column was always NULL, so every removed term was inert
--   * handle_order_status_stock_update: first OR-term of v_has_tracking was always false (parcels decide)
--   * clear_order_logistics_when_no_parcels: SET tracking_number = NULL was a no-op on an always-NULL col
--   * seller_month_orders / mediabuyer_month_orders: first COALESCE arm of the DISPLAY `tracking` column
--     was always NULL (parcels already supplied the value); tracking_number is in NO WHERE/JOIN/commission
--     math, so seller & MB commissions are byte-identical.
--
-- Phase 1 (commit 416de7d, deployed BEFORE this migration) removed all 15 PostgREST select strings,
-- every dead frontend fallback, and the provider-webhook .eq('tracking_number',...) fallback lookup
-- (edge fn redeployed prod+dev), so neither the live bundle nor the webhook references the column.
--
-- DROP also auto-removes idx_orders_tracking_number (an index over a 100%-NULL column).
--
-- Rollback:
--   ALTER TABLE public.orders ADD COLUMN tracking_number text;
--   CREATE INDEX idx_orders_tracking_number ON public.orders USING btree (tracking_number);
--   -- then restore the 4 function bodies from migration history (re-add the tracking_number terms).

CREATE OR REPLACE FUNCTION public.handle_order_status_stock_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_deducts      boolean := false;
  v_relaunch     boolean := false;
  v_is_return    boolean := false;
  v_hold         boolean := false;
  v_commit       boolean := false;
  v_release      boolean := false;
  v_receipt      boolean := false;
  v_has_tracking boolean := false;
  rec            RECORD;
  v_have         integer;
BEGIN
  IF NEW.order_status_id IS NOT NULL THEN
    SELECT deducts_stock, is_relaunch, is_return
      INTO v_deducts, v_relaunch, v_is_return
      FROM public.order_statuses WHERE id = NEW.order_status_id LIMIT 1;
    v_deducts   := COALESCE(v_deducts, false);
    v_relaunch  := COALESCE(v_relaunch, false);
    v_is_return := COALESCE(v_is_return, false);
  END IF;

  v_has_tracking :=
       EXISTS (SELECT 1 FROM public.company_parcels cp
                WHERE cp.order_id = NEW.id AND COALESCE(btrim(cp.tracking_code), '') <> '')
    OR EXISTS (SELECT 1 FROM public.courier_parcels cpa
                WHERE cpa.order_id = NEW.id AND COALESCE(btrim(cpa.tracking_code), '') <> '');

  v_hold    := v_deducts OR v_relaunch;
  v_commit  := v_deducts;
  v_release := (NOT v_hold) AND (NOT v_has_tracking);
  v_receipt := v_is_return
               AND (NEW.current_return_note_id IS NOT NULL OR NEW.current_courier_return_note_id IS NOT NULL);

  IF TG_OP = 'INSERT' THEN
    IF v_commit THEN
      RAISE EXCEPTION 'confirm_via_update: create the order in a non-confirmed status, then set it to CONFIRMED so stock is validated and deducted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.date_deleted IS NOT NULL AND OLD.date_deleted IS NULL
     AND COALESCE(NEW.stock_changed,false) = true AND NOT v_has_tracking THEN
    FOR rec IN SELECT product_id AS id, SUM(quantity) AS q FROM public.order_items
               WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0 GROUP BY product_id LOOP
      UPDATE public.products SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
    FOR rec IN SELECT accessory_id AS id, SUM(accessory_quantity) AS q FROM public.order_items
               WHERE order_id = NEW.id AND accessory_id IS NOT NULL AND accessory_quantity > 0 GROUP BY accessory_id LOOP
      UPDATE public.accessories SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
    NEW.stock_changed := false;
    RETURN NEW;
  END IF;

  IF v_commit AND COALESCE(NEW.stock_changed,false) = false THEN
    FOR rec IN SELECT product_id AS id, SUM(quantity) AS need FROM public.order_items
               WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0
               GROUP BY product_id ORDER BY product_id LOOP
      SELECT stock INTO v_have FROM public.products WHERE id = rec.id FOR UPDATE;
      IF COALESCE(v_have,0) < rec.need THEN
        RAISE EXCEPTION 'insufficient_stock: product % needs % has %', rec.id, rec.need, COALESCE(v_have,0)
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    FOR rec IN SELECT accessory_id AS id, SUM(accessory_quantity) AS need FROM public.order_items
               WHERE order_id = NEW.id AND accessory_id IS NOT NULL AND accessory_quantity > 0
               GROUP BY accessory_id ORDER BY accessory_id LOOP
      SELECT stock INTO v_have FROM public.accessories WHERE id = rec.id FOR UPDATE;
      IF COALESCE(v_have,0) < rec.need THEN
        RAISE EXCEPTION 'insufficient_stock_accessory: accessory % needs % has %', rec.id, rec.need, COALESCE(v_have,0)
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    FOR rec IN SELECT product_id AS id, SUM(quantity) AS need FROM public.order_items
               WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0 GROUP BY product_id LOOP
      UPDATE public.products SET stock = COALESCE(stock,0) - rec.need WHERE id = rec.id;
    END LOOP;
    FOR rec IN SELECT accessory_id AS id, SUM(accessory_quantity) AS need FROM public.order_items
               WHERE order_id = NEW.id AND accessory_id IS NOT NULL AND accessory_quantity > 0 GROUP BY accessory_id LOOP
      UPDATE public.accessories SET stock = COALESCE(stock,0) - rec.need WHERE id = rec.id;
    END LOOP;
    NEW.stock_changed := true;
    RETURN NEW;
  END IF;

  IF (v_release OR v_receipt) AND COALESCE(NEW.stock_changed,false) = true THEN
    FOR rec IN SELECT product_id AS id, SUM(quantity) AS q FROM public.order_items
               WHERE order_id = NEW.id AND product_id IS NOT NULL AND quantity > 0 GROUP BY product_id LOOP
      UPDATE public.products SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
    FOR rec IN SELECT accessory_id AS id, SUM(accessory_quantity) AS q FROM public.order_items
               WHERE order_id = NEW.id AND accessory_id IS NOT NULL AND accessory_quantity > 0 GROUP BY accessory_id LOOP
      UPDATE public.accessories SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
    NEW.stock_changed := false;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_order_logistics_when_no_parcels()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed_id uuid;
  v_processed_id uuid;
BEGIN
  IF OLD.order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = OLD.order_id) THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'company_parcels' THEN
    IF OLD.company_delivery_note_id IS NULL THEN RETURN OLD; END IF;
  ELSIF TG_TABLE_NAME = 'courier_parcels' THEN
    IF OLD.courier_delivery_note_id IS NULL THEN RETURN OLD; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_parcels WHERE order_id = OLD.order_id)
     OR EXISTS (SELECT 1 FROM public.courier_parcels WHERE order_id = OLD.order_id) THEN
    RETURN OLD;
  END IF;
  SELECT id INTO v_confirmed_id FROM public.order_statuses WHERE code = 'CONFIRMED' LIMIT 1;
  SELECT id INTO v_processed_id FROM public.order_statuses WHERE code = 'PROCESSED' LIMIT 1;
  UPDATE public.orders
  SET package_status_id        = NULL,
      current_delivery_note_id = NULL,
      processing               = false,
      courier_id               = NULL,
      order_status_id          = CASE
                                   WHEN order_status_id = v_processed_id AND v_confirmed_id IS NOT NULL
                                   THEN v_confirmed_id ELSE order_status_id END
  WHERE id = OLD.order_id;
  RETURN OLD;
END;
$function$;

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
      AND (auth.uid() = p_seller OR is_owner() OR check_user_role(auth.uid(), ARRAY['super admin','admin']))
    ORDER BY 5 DESC;
$function$;

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
    AND (auth.uid() = p_mb OR is_owner() OR check_user_role(auth.uid(), ARRAY['super admin','admin']))
  ORDER BY COALESCE(o.date_livraison, o.updated_at) ASC;
$function$;

ALTER TABLE public.orders DROP COLUMN IF EXISTS tracking_number;
