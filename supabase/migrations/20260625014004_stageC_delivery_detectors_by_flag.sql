-- Stage C: replace label-ILIKE delivery detection with the is_delivered master flag (by id).
CREATE OR REPLACE FUNCTION public.set_order_date_livraison_on_delivery()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  new_is_delivered boolean := false;
  old_is_delivered boolean := false;
BEGIN
  IF NEW.package_status_id IS NOT NULL THEN
    SELECT is_delivered INTO new_is_delivered FROM public.package_statuses WHERE id = NEW.package_status_id;
    new_is_delivered := COALESCE(new_is_delivered, false);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.package_status_id IS NOT NULL THEN
    SELECT is_delivered INTO old_is_delivered FROM public.package_statuses WHERE id = OLD.package_status_id;
    old_is_delivered := COALESCE(old_is_delivered, false);
  END IF;
  IF new_is_delivered AND NOT old_is_delivered AND NEW.date_livraison IS NULL THEN
    NEW.date_livraison := NOW();
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
    cur_category text;
BEGIN
    IF COALESCE(NEW.replace, false) THEN
        RETURN NEW;
    END IF;

    IF NEW.package_status_id IS DISTINCT FROM OLD.package_status_id THEN
        IF NEW.current_return_note_id IS NOT NULL
           OR NEW.current_courier_return_note_id IS NOT NULL THEN
            RETURN NEW;
        END IF;

        SELECT category INTO cur_category FROM order_statuses WHERE id = NEW.order_status_id;
        IF cur_category = 'return' THEN
            RETURN NEW;
        END IF;

        SELECT id INTO paid_status_id
        FROM order_statuses
        WHERE category = 'paid' AND (active IS DISTINCT FROM false)
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
            WHERE code ILIKE 'UNPAID' AND (active IS DISTINCT FROM false)
            LIMIT 1;
            IF unpaid_status_id IS NOT NULL AND NEW.order_status_id IS DISTINCT FROM unpaid_status_id THEN
                NEW.order_status_id := unpaid_status_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_order_unpaid_on_delivery()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    unpaid_status_id uuid;
    v_is_delivered boolean := false;
BEGIN
    IF NEW.status_id IS NOT NULL THEN
        SELECT is_delivered INTO v_is_delivered FROM public.package_statuses WHERE id = NEW.status_id;
        v_is_delivered := COALESCE(v_is_delivered, false);
    ELSIF NEW.status_label NOT ILIKE '%retour%'
          AND (NEW.status_label ILIKE '%livré%'
               OR NEW.status_label ILIKE '%livre%'
               OR NEW.status_label ILIKE '%delivered%') THEN
        v_is_delivered := true;
    END IF;

    IF v_is_delivered AND NEW.order_id IS NOT NULL THEN
        SELECT id INTO unpaid_status_id
        FROM public.order_statuses
        WHERE code ILIKE 'UNPAID' AND (active IS DISTINCT FROM false)
        LIMIT 1;

        IF unpaid_status_id IS NOT NULL THEN
            UPDATE public.orders o
            SET order_status_id = unpaid_status_id
            FROM public.order_statuses cur
            WHERE o.id = NEW.order_id
              AND o.order_status_id IS DISTINCT FROM unpaid_status_id
              AND cur.id = o.order_status_id
              AND cur.category NOT IN ('paid','return')
              AND o.current_return_note_id IS NULL
              AND o.current_courier_return_note_id IS NULL
              AND o.replace IS NOT TRUE;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
