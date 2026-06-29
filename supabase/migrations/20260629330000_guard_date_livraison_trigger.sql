-- HYGIENE (T7 trigger-sweep #2, 2026-06-29): add a status-change short-circuit to
-- set_order_date_livraison_on_delivery so it stops doing package_statuses lookups on every order
-- UPDATE.
--
-- trg_set_order_date_livraison is BEFORE UPDATE on ALL columns; the function unconditionally ran up
-- to two SELECTs against package_statuses (NEW then OLD) even when package_status_id was unchanged
-- (note edits, phone edits, price edits, provider syncs...). When it is unchanged,
-- new_is_delivered always equals old_is_delivered, so the stamping condition (new AND NOT old) is
-- always false and the work is pure waste. The sibling orders write-stack functions
-- (orders_set_unpaid_on_delivery, set_order_unpaid_on_delivery) already carry this guard.
--
-- FIX: early RETURN NEW when this is an UPDATE that did not change package_status_id. INSERT is
-- unaffected (handled by trg_set_order_date_livraison_insert). Behavior identical on a genuine
-- delivery transition.
--
-- Rollback: remove the guard block.

CREATE OR REPLACE FUNCTION public.set_order_date_livraison_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  new_is_delivered boolean := false;
  old_is_delivered boolean := false;
BEGIN
  -- Only relevant when the package status actually changed; skip the lookups otherwise.
  IF TG_OP = 'UPDATE' AND NEW.package_status_id IS NOT DISTINCT FROM OLD.package_status_id THEN
    RETURN NEW;
  END IF;

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
