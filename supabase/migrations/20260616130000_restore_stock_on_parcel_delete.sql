-- =====================================================================
-- Delete a parcel / delivery note must return the order's stock.
--
-- Stock is deducted as soon as an order is PROCESSED (finalize). When the
-- order's last parcel is removed, the order is pulled out of fulfillment, so
-- the deducted stock must come back.
--
-- For an order still in PROCESSED, the previous trigger reverted it to
-- CONFIRMED, which (via handle_order_status_stock_update) restored stock. But
-- for an order that had advanced to a terminal status (e.g. CANCELED) the
-- lifecycle status is intentionally preserved, so no status change fired and
-- the stock was never restored.
--
-- FIX: clear_order_logistics_when_no_parcels() now restores the deducted stock
-- directly (independent of status) and takes ownership of stock_changed, so
-- handle_order_status_stock_update does not also restore on the PROCESSED->
-- CONFIRMED flip (no double count).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clear_order_logistics_when_no_parcels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_confirmed_id uuid;
  v_processed_id uuid;
  v_stock_was_deducted boolean;
  item RECORD;
BEGIN
  -- Guard 1: NULL order_id, and order-/business-delete CASCADE.
  IF OLD.order_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = OLD.order_id) THEN
    RETURN OLD;
  END IF;

  -- Guard 2: ignore deletes of UNLINKED (orphan) parcels; they never wrote the
  -- mirror nor caused a stock deduction.
  IF TG_TABLE_NAME = 'company_parcels' AND OLD.company_delivery_note_id IS NULL THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'courier_parcels' AND OLD.courier_delivery_note_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Guard 3: cross-table zero-check. Only act when NO parcel of EITHER type
  -- remains (the order is still being fulfilled if a sibling parcel exists).
  IF EXISTS (SELECT 1 FROM public.company_parcels WHERE order_id = OLD.order_id)
     OR EXISTS (SELECT 1 FROM public.courier_parcels WHERE order_id = OLD.order_id) THEN
    RETURN OLD;
  END IF;

  SELECT id INTO v_confirmed_id FROM public.order_statuses WHERE code = 'CONFIRMED' LIMIT 1;
  SELECT id INTO v_processed_id FROM public.order_statuses WHERE code = 'PROCESSED' LIMIT 1;
  SELECT COALESCE(stock_changed, false) INTO v_stock_was_deducted
  FROM public.orders WHERE id = OLD.order_id;

  -- Return the deducted stock. Done directly so it also covers terminal-status
  -- orders (e.g. CANCELED) whose lifecycle status we intentionally leave alone.
  IF v_stock_was_deducted THEN
    FOR item IN SELECT product_id, quantity, accessory_id, accessory_quantity
                FROM public.order_items WHERE order_id = OLD.order_id LOOP
      IF item.product_id IS NOT NULL AND item.quantity > 0 THEN
        UPDATE public.products
        SET stock = COALESCE(stock, 0) + item.quantity
        WHERE id = item.product_id;
      END IF;
      IF item.accessory_id IS NOT NULL AND item.accessory_quantity > 0 THEN
        UPDATE public.accessories
        SET stock = COALESCE(stock, 0) + item.accessory_quantity
        WHERE id = item.accessory_id;
      END IF;
    END LOOP;
  END IF;

  -- Clear the logistics mirror, reset stock_changed (we just restored), and
  -- revert PROCESSED->CONFIRMED only (terminal states preserved; company_id
  -- preserved). Setting stock_changed=false here also prevents
  -- handle_order_status_stock_update from double-restoring on the status flip.
  UPDATE public.orders
  SET tracking_number          = NULL,
      package_status_id        = NULL,
      package_status_label     = NULL,
      package_status_color     = NULL,
      current_delivery_note_id = NULL,
      processing               = false,
      courier_id               = NULL,
      stock_changed            = false,
      order_status_id          = CASE
                                   WHEN order_status_id = v_processed_id
                                        AND v_confirmed_id IS NOT NULL
                                   THEN v_confirmed_id
                                   ELSE order_status_id
                                 END
  WHERE id = OLD.order_id;

  RETURN OLD;
END;
$function$;

ALTER FUNCTION public.clear_order_logistics_when_no_parcels() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.clear_order_logistics_when_no_parcels() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- One-time repair: order 26996107 (Orelle Maroc) had its parcel deleted while
-- CANCELED with stock_changed=true, so its stock was never returned. Restore
-- it. Idempotent: gated on stock_changed=true, then the flag is cleared.
-- ---------------------------------------------------------------------
UPDATE public.products p
SET stock = COALESCE(p.stock, 0) + s.qty
FROM (
  SELECT oi.product_id, sum(oi.quantity) AS qty
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.order_id = '26996107-2c68-4256-abbf-f3b88a8972bd'
    AND o.stock_changed = true
    AND oi.product_id IS NOT NULL AND oi.quantity > 0
  GROUP BY oi.product_id
) s
WHERE p.id = s.product_id;

UPDATE public.accessories a
SET stock = COALESCE(a.stock, 0) + s.qty
FROM (
  SELECT oi.accessory_id, sum(oi.accessory_quantity) AS qty
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.order_id = '26996107-2c68-4256-abbf-f3b88a8972bd'
    AND o.stock_changed = true
    AND oi.accessory_id IS NOT NULL AND oi.accessory_quantity > 0
  GROUP BY oi.accessory_id
) s
WHERE a.id = s.accessory_id;

UPDATE public.orders
SET stock_changed = false
WHERE id = '26996107-2c68-4256-abbf-f3b88a8972bd' AND stock_changed = true;
