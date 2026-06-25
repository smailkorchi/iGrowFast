-- F2c-1: parcel→order sync keys on status_id only; drop the master-edit cache resync.
CREATE OR REPLACE FUNCTION public.sync_company_parcel_status_to_order()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' OR OLD.status_id IS DISTINCT FROM NEW.status_id THEN
        UPDATE public.orders SET package_status_id = NEW.status_id WHERE id = NEW.order_id;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_courier_parcel_status_to_order()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' OR OLD.status_id IS DISTINCT FROM NEW.status_id THEN
        UPDATE public.orders SET package_status_id = NEW.status_id WHERE id = NEW.order_id;
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

DROP TRIGGER IF EXISTS trg_resync_status_caches_on_master_edit ON public.package_statuses;
DROP FUNCTION IF EXISTS public.resync_status_caches_on_master_edit();
