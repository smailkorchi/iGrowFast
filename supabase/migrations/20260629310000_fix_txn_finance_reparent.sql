-- BUG (T7 trigger-sweep #5, 2026-06-29): handle_transaction_financial_updates leaves a stale total
-- on the OLD transaction when a trns_purchase / trns_payment row is reparented to a different
-- transaction_id.
--
-- The function recomputed only target_id = NEW.transaction_id on UPDATE. If an UPDATE changes
-- transaction_id (A -> B), it recomputes B's total but never re-subtracts the row from A, so
-- transactions.total_price (purchases) / paid_price (payments) on A stays inflated until something
-- else touches A. The *_payment_txns_refresh siblings already recompute both old and new keys; this
-- function did not.
--
-- FIX: build the set of affected transaction ids (NEW for INSERT, OLD for DELETE, and BOTH when an
-- UPDATE moves the row between transactions) and recompute each, NULL-safe. Behavior is identical for
-- the common case (no reparent); only the reparent edge is corrected.
--
-- Rollback: restore the single-target_id version.

CREATE OR REPLACE FUNCTION public.handle_transaction_financial_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
    v_ids uuid[];
    v_id  uuid;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        v_ids := ARRAY[NEW.transaction_id];
    ELSIF (TG_OP = 'DELETE') THEN
        v_ids := ARRAY[OLD.transaction_id];
    ELSE  -- UPDATE: recompute the new parent, plus the old parent if the row was reparented
        IF NEW.transaction_id IS NOT DISTINCT FROM OLD.transaction_id THEN
            v_ids := ARRAY[NEW.transaction_id];
        ELSE
            v_ids := ARRAY[NEW.transaction_id, OLD.transaction_id];
        END IF;
    END IF;

    IF (TG_TABLE_NAME = 'trns_purchase') THEN
        FOREACH v_id IN ARRAY v_ids LOOP
            IF v_id IS NULL THEN CONTINUE; END IF;
            UPDATE public.transactions
            SET total_price = (
                SELECT COALESCE(SUM(sub_total), 0) + COALESCE(SUM(accessory_sub_total), 0)
                FROM public.trns_purchase
                WHERE transaction_id = v_id
            )
            WHERE id = v_id;
        END LOOP;
    ELSIF (TG_TABLE_NAME = 'trns_payment') THEN
        FOREACH v_id IN ARRAY v_ids LOOP
            IF v_id IS NULL THEN CONTINUE; END IF;
            UPDATE public.transactions
            SET paid_price = (
                SELECT COALESCE(SUM(amount), 0)
                FROM public.trns_payment
                WHERE transaction_id = v_id
            )
            WHERE id = v_id;
        END LOOP;
    END IF;
    RETURN NULL;
END;
$function$;
