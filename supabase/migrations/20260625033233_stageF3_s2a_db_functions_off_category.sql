-- F3-S2a: flip category-string reads to semantic flags in the cleaner DB functions.
CREATE OR REPLACE FUNCTION public.approve_sheet_order(p_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller_biz uuid := current_user_digicom_business_id();
  v_biz uuid; v_review text; v_name text; v_phone text; v_city uuid; v_status uuid; v_new_status uuid;
  v_seller uuid;
BEGIN
  SELECT "DigiCom Business", source_review_status, name, phone, master_city_id, order_status_id
    INTO v_biz, v_review, v_name, v_phone, v_city, v_status
    FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order not found'); END IF;

  IF v_caller_biz IS NOT NULL AND v_biz IS DISTINCT FROM v_caller_biz THEN
    RAISE EXCEPTION 'forbidden: cross-tenant approval';
  END IF;

  IF v_review IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order is not pending');
  END IF;

  IF COALESCE(btrim(v_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name required'); END IF;
  IF length(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g')) < 9 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valid phone required'); END IF;
  IF v_city IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city required'); END IF;

  IF v_status IS NOT NULL THEN
    v_new_status := v_status;
  ELSE
    SELECT id INTO v_new_status FROM public.order_statuses WHERE is_new LIMIT 1;
  END IF;
  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no entry status available'); END IF;

  INSERT INTO public.order_status_history (order_id, status_id, "DigiCom Business", changed_by, comment)
  VALUES (p_order_id, v_new_status, v_biz, auth.uid(), 'Approved from sheet sync');

  UPDATE public.orders
  SET source_review_status = 'approved', order_status_id = v_new_status, updated_at = now()
  WHERE id = p_order_id;

  v_seller := public.attribute_single_order(p_order_id);
  PERFORM public.sync_imported_orders(v_biz);

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'seller_id', v_seller, 'status_id', v_new_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_keep_paid_when_noted()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    paid_status_id uuid;
BEGIN
    IF COALESCE(NEW.replace, false) THEN
        RETURN NEW;
    END IF;

    SELECT id INTO paid_status_id
    FROM order_statuses
    WHERE is_paid AND (active IS DISTINCT FROM false)
    LIMIT 1;

    IF paid_status_id IS NULL OR NEW.order_status_id = paid_status_id THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
            SELECT 1
            FROM company_payment_note_orders l
            JOIN company_payment_notes n ON n.id = l.payment_note_id
            WHERE l.order_id = NEW.id AND n.status = 'paid'
        ) OR EXISTS (
            SELECT 1
            FROM courier_payment_note_orders cl
            JOIN courier_payment_notes cn ON cn.id = cl.payment_note_id
            WHERE cl.order_id = NEW.id AND cn.status = 'paid'
        ) THEN
        NEW.order_status_id := paid_status_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_set_unpaid_on_delivery()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    unpaid_status_id uuid;
    paid_status_id uuid;
    v_is_delivered boolean := false;
    v_is_return boolean := false;
BEGIN
    IF COALESCE(NEW.replace, false) THEN
        RETURN NEW;
    END IF;

    IF NEW.package_status_id IS DISTINCT FROM OLD.package_status_id THEN
        IF NEW.current_return_note_id IS NOT NULL
           OR NEW.current_courier_return_note_id IS NOT NULL THEN
            RETURN NEW;
        END IF;

        SELECT is_return INTO v_is_return FROM order_statuses WHERE id = NEW.order_status_id;
        IF COALESCE(v_is_return, false) THEN
            RETURN NEW;
        END IF;

        SELECT id INTO paid_status_id
        FROM order_statuses
        WHERE is_paid AND (active IS DISTINCT FROM false)
        LIMIT 1;
        IF paid_status_id IS NOT NULL AND NEW.order_status_id = paid_status_id THEN
            RETURN NEW;
        END IF;

        IF NEW.package_status_id IS NOT NULL THEN
            SELECT is_delivered INTO v_is_delivered FROM package_statuses WHERE id = NEW.package_status_id;
            v_is_delivered := COALESCE(v_is_delivered, false);
        END IF;

        IF v_is_delivered THEN
            SELECT id INTO unpaid_status_id
            FROM order_statuses
            WHERE is_unpaid AND (active IS DISTINCT FROM false)
            LIMIT 1;
            IF unpaid_status_id IS NOT NULL AND NEW.order_status_id IS DISTINCT FROM unpaid_status_id THEN
                NEW.order_status_id := unpaid_status_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_note_cascade_paid()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    paid_status_id uuid;
BEGIN
    IF NEW.status <> 'paid' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'paid' THEN
        RETURN NEW;
    END IF;

    SELECT id INTO paid_status_id
    FROM order_statuses
    WHERE is_paid AND (active IS DISTINCT FROM false)
    LIMIT 1;
    IF paid_status_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'company_payment_notes' THEN
        UPDATE orders o
        SET order_status_id = paid_status_id, payed = true, updated_at = now()
        FROM company_payment_note_orders l
        WHERE l.payment_note_id = NEW.id
          AND o.id = l.order_id
          AND o.replace IS NOT TRUE
          AND (o.order_status_id IS DISTINCT FROM paid_status_id OR o.payed IS DISTINCT FROM true);
    ELSIF TG_TABLE_NAME = 'courier_payment_notes' THEN
        UPDATE orders o
        SET order_status_id = paid_status_id, payed = true, updated_at = now()
        FROM courier_payment_note_orders l
        WHERE l.payment_note_id = NEW.id
          AND o.id = l.order_id
          AND o.replace IS NOT TRUE
          AND (o.order_status_id IS DISTINCT FROM paid_status_id OR o.payed IS DISTINCT FROM true);
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_note_cascade_unpaid()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_paid_status_id   uuid;
  v_unpaid_status_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid') THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status IS DISTINCT FROM 'paid' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT id INTO v_paid_status_id   FROM order_statuses WHERE is_paid   AND (active IS DISTINCT FROM false) LIMIT 1;
  SELECT id INTO v_unpaid_status_id FROM order_statuses WHERE is_unpaid AND (active IS DISTINCT FROM false) LIMIT 1;
  IF v_paid_status_id IS NULL OR v_unpaid_status_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'company_payment_notes' THEN
    UPDATE orders o
    SET order_status_id = v_unpaid_status_id, payed = false, updated_at = now()
    FROM company_payment_note_orders l
    WHERE l.payment_note_id = OLD.id
      AND o.id = l.order_id
      AND o.order_status_id = v_paid_status_id
      AND NOT EXISTS (SELECT 1 FROM company_payment_note_orders l2
                      JOIN company_payment_notes n2 ON n2.id = l2.payment_note_id
                      WHERE l2.order_id = o.id AND n2.status = 'paid' AND n2.id <> OLD.id)
      AND NOT EXISTS (SELECT 1 FROM courier_payment_note_orders cl2
                      JOIN courier_payment_notes cn2 ON cn2.id = cl2.payment_note_id
                      WHERE cl2.order_id = o.id AND cn2.status = 'paid');
  ELSIF TG_TABLE_NAME = 'courier_payment_notes' THEN
    UPDATE orders o
    SET order_status_id = v_unpaid_status_id, payed = false, updated_at = now()
    FROM courier_payment_note_orders l
    WHERE l.payment_note_id = OLD.id
      AND o.id = l.order_id
      AND o.order_status_id = v_paid_status_id
      AND NOT EXISTS (SELECT 1 FROM courier_payment_note_orders l2
                      JOIN courier_payment_notes n2 ON n2.id = l2.payment_note_id
                      WHERE l2.order_id = o.id AND n2.status = 'paid' AND n2.id <> OLD.id)
      AND NOT EXISTS (SELECT 1 FROM company_payment_note_orders cl2
                      JOIN company_payment_notes cn2 ON cn2.id = cl2.payment_note_id
                      WHERE cl2.order_id = o.id AND cn2.status = 'paid');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_courier_parcel_delivered_at()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    v_is_delivered boolean := false;
BEGIN
    IF NEW.status_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
        RETURN NEW;
    END IF;

    SELECT ps.is_delivered INTO v_is_delivered
    FROM public.package_statuses ps
    WHERE ps.id = NEW.status_id;

    IF COALESCE(v_is_delivered, false) AND NEW.delivered_at IS NULL THEN
        NEW.delivered_at := now();
    END IF;

    RETURN NEW;
END;
$function$;
