-- BUG (T6-BUG, db-function sweep 2026-06-29): phantom-inventory inflation in restore_stock_on_order_delete.
--
-- This BEFORE DELETE trigger on orders restocks whenever COALESCE(OLD.stock_changed,false)=true with
-- NO has_tracking guard. Its sibling soft-delete path in handle_order_status_stock_update restocks only
-- `... AND COALESCE(NEW.stock_changed,false)=true AND NOT v_has_tracking` (and zeroes stock_changed).
-- Consequence: a SHIPPED order (parcel with a non-empty tracking_code, stock_changed=true) soft-deleted
-- -> the soft-delete branch is SKIPPED (has_tracking) so stock_changed stays true; 14 days later
-- purge_soft_deleted_orders hard-deletes it and THIS trigger adds the units back even though the goods
-- physically left the warehouse. Same over-restock on any direct hard-delete of a shipped order.
--
-- FIX: add the same `NOT v_has_tracking` guard (parcels still exist at BEFORE DELETE time, before the
-- FK cascade removes them), so only orders that never shipped are restocked. Mirrors the proven
-- soft-delete semantics. Body otherwise unchanged.
--
-- Rollback: re-create without the v_has_tracking computation + guard.

CREATE OR REPLACE FUNCTION public.restore_stock_on_order_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  rec RECORD;
  v_has_tracking boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = OLD."DigiCom Business") THEN
    RETURN OLD;  -- business being wiped: products/accessories are going away too, skip restock
  END IF;

  -- A shipped order (parcel with a non-empty tracking_code) had its goods leave the warehouse, so
  -- deleting it must NOT add the units back. Mirrors the soft-delete path in handle_order_status_stock_update.
  v_has_tracking :=
       EXISTS (SELECT 1 FROM public.company_parcels cp
                WHERE cp.order_id = OLD.id AND COALESCE(btrim(cp.tracking_code), '') <> '')
    OR EXISTS (SELECT 1 FROM public.courier_parcels cpa
                WHERE cpa.order_id = OLD.id AND COALESCE(btrim(cpa.tracking_code), '') <> '');

  IF COALESCE(OLD.stock_changed,false) = true AND NOT v_has_tracking THEN
    FOR rec IN SELECT product_id AS id, SUM(quantity) AS q FROM public.order_items
               WHERE order_id = OLD.id AND product_id IS NOT NULL AND quantity > 0 GROUP BY product_id LOOP
      UPDATE public.products SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
    FOR rec IN SELECT accessory_id AS id, SUM(accessory_quantity) AS q FROM public.order_items
               WHERE order_id = OLD.id AND accessory_id IS NOT NULL AND accessory_quantity > 0 GROUP BY accessory_id LOOP
      UPDATE public.accessories SET stock = COALESCE(stock,0) + rec.q WHERE id = rec.id;
    END LOOP;
  END IF;
  RETURN OLD;
END;
$function$;
