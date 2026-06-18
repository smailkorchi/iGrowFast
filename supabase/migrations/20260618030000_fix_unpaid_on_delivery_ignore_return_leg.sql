-- =====================================================================
-- BUG: orders_set_unpaid_on_delivery / set_order_unpaid_on_delivery
-- classified provider return-leg tracking text such as
-- "Retour livré à la clientèle" as a forward delivery because it matched
-- ILIKE '%livré%'. That overwrote a returned order's status
-- (RETURN -> UNPAID), even when the order sits in a return note. The flip
-- is one-way (the trigger only ever sets UNPAID), so the order stayed
-- stuck UNPAID after the label reset back to "Retourné".
--
-- FIX:
--  1. A label containing "retour" is a return movement, never a forward
--     delivery to customer -> exclude it from delivery detection.
--  2. Defense in depth on the orders-level trigger: never auto-UNPAID an
--     order already in a RETURN status or linked to a return note.
--  3. Parity guard on the parcel-level trigger (already skips paid/return
--     categories; add the same "retour" label exclusion + return-note link).
--
-- One-time data repair (run via MCP at apply time, kept here for the record):
--   UPDATE orders SET order_status_id = <RETURN>
--   WHERE order_status_id = <UNPAID>
--     AND (current_return_note_id IS NOT NULL OR current_courier_return_note_id IS NOT NULL)
--     AND date_deleted IS NULL
--     AND EXISTS (SELECT 1 FROM order_status_history h
--                 WHERE h.order_id = orders.id AND h.status_id = <RETURN>);
--   -> restored 9 orders flipped by this bug.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.orders_set_unpaid_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    unpaid_status_id uuid;
    paid_status_id uuid;
    is_delivered boolean := false;
    matched_label text;
    cur_category text;
BEGIN
    -- Only act when package status changes, not on any arbitrary order update
    IF NEW.package_status_id IS DISTINCT FROM OLD.package_status_id
       OR NEW.package_status_label IS DISTINCT FROM OLD.package_status_label THEN

        -- Never touch an order that is being returned: already RETURN status,
        -- or linked to a company/courier return note. The provider keeps
        -- emitting "Retour livré ..." tracking for the return leg; that is not
        -- a sale delivery and must not flip the order to UNPAID.
        IF NEW.current_return_note_id IS NOT NULL
           OR NEW.current_courier_return_note_id IS NOT NULL THEN
            RETURN NEW;
        END IF;

        SELECT category INTO cur_category
        FROM order_statuses WHERE id = NEW.order_status_id;
        IF cur_category = 'return' THEN
            RETURN NEW;
        END IF;

        -- If the caller is explicitly setting the order to PAID, never override
        SELECT id INTO paid_status_id
        FROM order_statuses
        WHERE category = 'paid'
          AND (active IS DISTINCT FROM false)
        LIMIT 1;

        IF paid_status_id IS NOT NULL AND NEW.order_status_id = paid_status_id THEN
            RETURN NEW;
        END IF;

        -- Delivery detection. A label containing "retour" is a return-leg
        -- event, NOT a forward delivery, so it is explicitly excluded.
        IF NEW.package_status_label NOT ILIKE '%retour%'
           AND (NEW.package_status_label ILIKE '%livré%'
                OR NEW.package_status_label ILIKE '%livre%'
                OR NEW.package_status_label ILIKE '%delivered%') THEN
            is_delivered := true;
        ELSIF NEW.package_status_id IS NOT NULL THEN
            SELECT label INTO matched_label FROM package_statuses WHERE id = NEW.package_status_id;
            IF matched_label NOT ILIKE '%retour%'
               AND (matched_label ILIKE '%livré%'
                    OR matched_label ILIKE '%livre%'
                    OR matched_label ILIKE '%delivered%') THEN
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
    -- "retour" in the label => return leg, not a forward delivery (excluded).
    IF NEW.status_label NOT ILIKE '%retour%'
       AND (NEW.status_label ILIKE '%livré%'
            OR NEW.status_label ILIKE '%livre%'
            OR NEW.status_label ILIKE '%delivered%') THEN
        is_delivered := true;
    ELSIF NEW.status_id IS NOT NULL THEN
        SELECT label INTO matched_label FROM public.package_statuses WHERE id = NEW.status_id;
        IF matched_label NOT ILIKE '%retour%'
           AND (matched_label ILIKE '%livré%'
                OR matched_label ILIKE '%livre%'
                OR matched_label ILIKE '%delivered%') THEN
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
            UPDATE public.orders o
            SET order_status_id = unpaid_status_id
            FROM public.order_statuses cur
            WHERE o.id = NEW.order_id
              AND o.order_status_id IS DISTINCT FROM unpaid_status_id
              AND cur.id = o.order_status_id
              AND cur.category NOT IN ('paid','return')
              AND o.current_return_note_id IS NULL
              AND o.current_courier_return_note_id IS NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
