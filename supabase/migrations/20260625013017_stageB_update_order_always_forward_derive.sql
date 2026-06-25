-- ALWAYS forward-derive label/color from master whenever package_status_id is set.
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
        SELECT label, color INTO v_label, v_color
        FROM package_statuses WHERE id = NEW.package_status_id;
        NEW.package_status_label := v_label;
        NEW.package_status_color := v_color;
    END IF;
    RETURN NEW;
END;
$function$;
