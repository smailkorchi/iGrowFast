-- F3-S2d: parcel-side unpaid trigger off category onto flags (NOT paid AND NOT return; UNPAID by flag).
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
    END IF;

    IF v_is_delivered AND NEW.order_id IS NOT NULL THEN
        SELECT id INTO unpaid_status_id
        FROM public.order_statuses
        WHERE is_unpaid AND (active IS DISTINCT FROM false)
        LIMIT 1;

        IF unpaid_status_id IS NOT NULL THEN
            UPDATE public.orders o
            SET order_status_id = unpaid_status_id
            FROM public.order_statuses cur
            WHERE o.id = NEW.order_id
              AND o.order_status_id IS DISTINCT FROM unpaid_status_id
              AND cur.id = o.order_status_id
              AND NOT cur.is_paid
              AND NOT cur.is_return
              AND o.current_return_note_id IS NULL
              AND o.current_courier_return_note_id IS NULL
              AND o.replace IS NOT TRUE;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
