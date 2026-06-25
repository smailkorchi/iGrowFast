-- F3-S2b: stock trigger off category onto precise flags.
-- v_hold (confirmed|relaunch_new) -> deducts_stock OR is_relaunch
-- v_commit (confirmed)            -> deducts_stock (exact: only category 'confirmed')
-- v_receipt (return)              -> is_return
CREATE OR REPLACE FUNCTION public.handle_order_status_stock_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
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
       (COALESCE(btrim(NEW.tracking_number), '') <> '')
    OR EXISTS (SELECT 1 FROM public.company_parcels cp
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
