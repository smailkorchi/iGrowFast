-- order_statuses no longer has "DigiCom Business" (global reference table).
-- Resolve UNPAID by code only.

CREATE OR REPLACE FUNCTION public.orders_set_unpaid_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    unpaid_status_id uuid;
    is_delivered boolean := false;
    matched_label text;
BEGIN
    IF NEW.package_status_id IS DISTINCT FROM OLD.package_status_id OR NEW.package_status_label IS DISTINCT FROM OLD.package_status_label THEN

        IF NEW.package_status_label ILIKE '%livré%' OR NEW.package_status_label ILIKE '%livre%' OR NEW.package_status_label ILIKE '%delivered%' THEN
            is_delivered := true;
        ELSIF NEW.package_status_id IS NOT NULL THEN
            SELECT label INTO matched_label FROM package_statuses WHERE id = NEW.package_status_id;
            IF matched_label ILIKE '%livré%' OR matched_label ILIKE '%livre%' OR matched_label ILIKE '%delivered%' THEN
                is_delivered := true;
            END IF;
        END IF;

        IF is_delivered THEN
            SELECT id INTO unpaid_status_id
            FROM order_statuses
            WHERE code ILIKE 'UNPAID'
              AND (active IS DISTINCT FROM false)
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
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    unpaid_status_id uuid;
    is_delivered boolean := false;
    matched_label text;
BEGIN
    IF NEW.status_label ILIKE '%livré%' OR NEW.status_label ILIKE '%livre%' OR NEW.status_label ILIKE '%delivered%' THEN
        is_delivered := true;
    ELSIF NEW.status_id IS NOT NULL THEN
        SELECT label INTO matched_label FROM public.package_statuses WHERE id = NEW.status_id;
        IF matched_label ILIKE '%livré%' OR matched_label ILIKE '%livre%' OR matched_label ILIKE '%delivered%' THEN
            is_delivered := true;
        END IF;
    END IF;

    IF is_delivered AND NEW.order_id IS NOT NULL THEN
        SELECT id INTO unpaid_status_id
        FROM public.order_statuses
        WHERE code ILIKE 'UNPAID'
          AND (active IS DISTINCT FROM false)
        LIMIT 1;

        IF unpaid_status_id IS NOT NULL THEN
            UPDATE public.orders
            SET order_status_id = unpaid_status_id
            WHERE id = NEW.order_id AND order_status_id IS DISTINCT FROM unpaid_status_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
