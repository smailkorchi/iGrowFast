-- Stage B: make orders.package_status_id id-authoritative; forward-derive label/color cache.
CREATE OR REPLACE FUNCTION public.update_order_package_status_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_label text;
    v_color text;
BEGIN
    IF NEW.package_status_id IS NOT NULL THEN
        IF TG_OP = 'INSERT'
           OR NEW.package_status_id IS DISTINCT FROM OLD.package_status_id
           OR NEW.package_status_label IS NULL
           OR NEW.package_status_color IS NULL THEN
            SELECT label, color INTO v_label, v_color
            FROM package_statuses WHERE id = NEW.package_status_id;
            NEW.package_status_label := v_label;
            NEW.package_status_color := v_color;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_company_parcel_status_to_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.order_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT'
       OR OLD.status_id    IS DISTINCT FROM NEW.status_id
       OR OLD.status_label IS DISTINCT FROM NEW.status_label
       OR OLD.status_color IS DISTINCT FROM NEW.status_color THEN
        IF NEW.status_id IS NOT NULL THEN
            UPDATE public.orders
               SET package_status_id = NEW.status_id
             WHERE id = NEW.order_id;
        ELSE
            UPDATE public.orders
               SET package_status_id    = NULL,
                   package_status_label = NEW.status_label,
                   package_status_color = NEW.status_color
             WHERE id = NEW.order_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_courier_parcel_status_to_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.order_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT'
       OR OLD.status_id    IS DISTINCT FROM NEW.status_id
       OR OLD.status_label IS DISTINCT FROM NEW.status_label
       OR OLD.status_color IS DISTINCT FROM NEW.status_color THEN
        IF NEW.status_id IS NOT NULL THEN
            UPDATE public.orders
               SET package_status_id = NEW.status_id
             WHERE id = NEW.order_id;
        ELSE
            UPDATE public.orders
               SET package_status_id    = NULL,
                   package_status_label = NEW.status_label,
                   package_status_color = NEW.status_color
             WHERE id = NEW.order_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resync_status_caches_on_master_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.label IS DISTINCT FROM OLD.label OR NEW.color IS DISTINCT FROM OLD.color THEN
        UPDATE public.orders
           SET package_status_label = NEW.label, package_status_color = NEW.color
         WHERE package_status_id = NEW.id
           AND (package_status_label IS DISTINCT FROM NEW.label
                OR package_status_color IS DISTINCT FROM NEW.color);
        UPDATE public.company_parcels
           SET status_label = NEW.label, status_color = NEW.color
         WHERE status_id = NEW.id
           AND (status_label IS DISTINCT FROM NEW.label
                OR status_color IS DISTINCT FROM NEW.color);
        UPDATE public.courier_parcels
           SET status_label = NEW.label, status_color = NEW.color
         WHERE status_id = NEW.id
           AND (status_label IS DISTINCT FROM NEW.label
                OR status_color IS DISTINCT FROM NEW.color);
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_resync_status_caches_on_master_edit ON public.package_statuses;
CREATE TRIGGER trg_resync_status_caches_on_master_edit
AFTER UPDATE OF label, color ON public.package_statuses
FOR EACH ROW EXECUTE FUNCTION public.resync_status_caches_on_master_edit();
