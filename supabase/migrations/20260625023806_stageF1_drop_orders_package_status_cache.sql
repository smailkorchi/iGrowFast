-- Stage F1: drop orders.package_status_label/color cache. Remove every writer, drop the
-- forward-derive trigger, then drop the 2 columns.
CREATE OR REPLACE FUNCTION public.sync_company_parcel_status_to_order()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT'
       OR OLD.status_id    IS DISTINCT FROM NEW.status_id
       OR OLD.status_label IS DISTINCT FROM NEW.status_label
       OR OLD.status_color IS DISTINCT FROM NEW.status_color THEN
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
    IF TG_OP = 'INSERT'
       OR OLD.status_id    IS DISTINCT FROM NEW.status_id
       OR OLD.status_label IS DISTINCT FROM NEW.status_label
       OR OLD.status_color IS DISTINCT FROM NEW.status_color THEN
        UPDATE public.orders SET package_status_id = NEW.status_id WHERE id = NEW.order_id;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_order_logistics_when_no_parcels()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_confirmed_id uuid;
  v_processed_id uuid;
BEGIN
  IF OLD.order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = OLD.order_id) THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'company_parcels' THEN
    IF OLD.company_delivery_note_id IS NULL THEN RETURN OLD; END IF;
  ELSIF TG_TABLE_NAME = 'courier_parcels' THEN
    IF OLD.courier_delivery_note_id IS NULL THEN RETURN OLD; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_parcels WHERE order_id = OLD.order_id)
     OR EXISTS (SELECT 1 FROM public.courier_parcels WHERE order_id = OLD.order_id) THEN
    RETURN OLD;
  END IF;
  SELECT id INTO v_confirmed_id FROM public.order_statuses WHERE code = 'CONFIRMED' LIMIT 1;
  SELECT id INTO v_processed_id FROM public.order_statuses WHERE code = 'PROCESSED' LIMIT 1;
  UPDATE public.orders
  SET tracking_number          = NULL,
      package_status_id        = NULL,
      current_delivery_note_id = NULL,
      processing               = false,
      courier_id               = NULL,
      order_status_id          = CASE
                                   WHEN order_status_id = v_processed_id AND v_confirmed_id IS NOT NULL
                                   THEN v_confirmed_id ELSE order_status_id END
  WHERE id = OLD.order_id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resync_status_caches_on_master_edit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.label IS DISTINCT FROM OLD.label OR NEW.color IS DISTINCT FROM OLD.color THEN
        UPDATE public.company_parcels
           SET status_label = NEW.label, status_color = NEW.color
         WHERE status_id = NEW.id
           AND (status_label IS DISTINCT FROM NEW.label OR status_color IS DISTINCT FROM NEW.color);
        UPDATE public.courier_parcels
           SET status_label = NEW.label, status_color = NEW.color
         WHERE status_id = NEW.id
           AND (status_label IS DISTINCT FROM NEW.label OR status_color IS DISTINCT FROM NEW.color);
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_update_order_package_status_id ON public.orders;
DROP FUNCTION IF EXISTS public.update_order_package_status_id();

ALTER TABLE public.orders
  DROP COLUMN package_status_label,
  DROP COLUMN package_status_color;
