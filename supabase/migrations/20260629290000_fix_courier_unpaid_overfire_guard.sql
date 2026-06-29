-- BUG (T7 trigger-sweep #1, 2026-06-29): courier unpaid-on-delivery trigger over-fires and can
-- silently revert a delivered courier order back to UNPAID on an unrelated parcel edit.
--
-- trigger_set_order_unpaid_on_delivery_courier was AFTER INSERT OR UPDATE (ALL columns, no scope),
-- while its company twin trigger_set_order_unpaid_on_delivery is scoped to UPDATE OF status_id.
-- The shared function set_order_unpaid_on_delivery() had NO status-change guard (unlike its siblings
-- set_courier_parcel_delivered_at / sync_courier_parcel_status_to_order, which both short-circuit on
-- `NEW.status_id IS NOT DISTINCT FROM OLD.status_id`). So ANY courier_parcels UPDATE (tracking_code,
-- is_fragile, is_open, is_try_on, delivered_at, ...) re-ran the function; if the parcel's current
-- status is_delivered=true, it re-asserted orders.order_status_id = UNPAID. The in-function UPDATE
-- already protects paid / returned / replace / return-note / already-unpaid orders, but a DELIVERED
-- order parked in any other non-paid limbo status (cancelled-post-delivery, suivi, etc.) would be
-- flipped to UNPAID by an edit that never touched status. Latent today (0 orders in the vulnerable
-- state) but a real money-column footgun.
--
-- FIX (two layers):
--  1) Add the same change-guard the sibling functions carry, at the top of the shared function. This
--     makes BOTH company and courier paths no-op on any non-status update (and on a redundant
--     `SET status_id = status_id`). This is the robust core fix.
--  2) Scope the courier trigger to `AFTER INSERT OR UPDATE OF status_id`, mirroring the company twin
--     exactly (the company unpaid twin has NO WHEN clause; order_id is guarded inside the function),
--     so the function is not even entered on unrelated courier_parcels edits.
--
-- Behavior on a genuine delivery transition is unchanged. Rollback: drop the guard and recreate the
-- courier trigger AFTER INSERT OR UPDATE (all columns).

CREATE OR REPLACE FUNCTION public.set_order_unpaid_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    unpaid_status_id uuid;
    v_is_delivered boolean := false;
BEGIN
    -- Only act on an actual status change (mirrors set_courier_parcel_delivered_at /
    -- sync_courier_parcel_status_to_order). Prevents unrelated parcel-attribute edits from
    -- re-asserting UNPAID on an already-delivered order.
    IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
        RETURN NEW;
    END IF;

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

DROP TRIGGER IF EXISTS trigger_set_order_unpaid_on_delivery_courier ON public.courier_parcels;
CREATE TRIGGER trigger_set_order_unpaid_on_delivery_courier
  AFTER INSERT OR UPDATE OF status_id ON public.courier_parcels
  FOR EACH ROW EXECUTE FUNCTION public.set_order_unpaid_on_delivery();
