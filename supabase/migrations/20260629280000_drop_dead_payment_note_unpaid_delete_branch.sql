-- CLEANUP (T6-BUG, db-function sweep 2026-06-29): remove the dead DELETE branch from
-- payment_note_cascade_unpaid (owner: "nothing deletes the payment note, it's useless — remove it,
-- it might cause confusion").
--
-- The function fired AFTER DELETE OR UPDATE on company/courier_payment_notes. Its UPDATE path
-- (revert linked orders to unpaid when a note leaves 'paid') WORKS and is kept. Its DELETE path was
-- DEAD: the note<->orders junction FK is ON DELETE CASCADE, so the RI cascade deletes the link rows
-- BEFORE this AFTER-ROW trigger runs, so `WHERE payment_note_id = OLD.id` matched 0 rows and reverted
-- nothing. No app path deletes an individual paid note (only delete_business, full teardown). So the
-- branch only ever misled readers into thinking deletion reverts orders.
--
-- Make the function UPDATE-only and recreate both triggers as AFTER UPDATE. Behavior-identical
-- (deleting a note already reverted nothing); just removes the confusing dead code.
--
-- Rollback: recreate the triggers AFTER DELETE OR UPDATE and restore the TG_OP='DELETE' branch.

DROP TRIGGER IF EXISTS trg_company_payment_note_cascade_unpaid ON public.company_payment_notes;
DROP TRIGGER IF EXISTS trg_courier_payment_note_cascade_unpaid ON public.courier_payment_notes;

CREATE OR REPLACE FUNCTION public.payment_note_cascade_unpaid()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_paid_status_id   uuid;
  v_unpaid_status_id uuid;
BEGIN
  -- AFTER UPDATE only. When a note leaves 'paid', revert its linked orders to unpaid (unless another
  -- still-paid note covers them). DELETE is intentionally not handled: the junction is ON DELETE
  -- CASCADE so the link rows vanish before any AFTER trigger could revert — impossible by design.
  IF NOT (OLD.status = 'paid' AND NEW.status IS DISTINCT FROM 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_paid_status_id   FROM order_statuses WHERE is_paid   AND (active IS DISTINCT FROM false) LIMIT 1;
  SELECT id INTO v_unpaid_status_id FROM order_statuses WHERE is_unpaid AND (active IS DISTINCT FROM false) LIMIT 1;
  IF v_paid_status_id IS NULL OR v_unpaid_status_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'company_payment_notes' THEN
    UPDATE orders o
    SET order_status_id = v_unpaid_status_id, payed = false, updated_at = now()
    FROM company_payment_note_orders l
    WHERE l.payment_note_id = OLD.id
      AND o.id = l.order_id
      AND o.order_status_id = v_paid_status_id
      AND NOT EXISTS (SELECT 1 FROM company_payment_note_orders l2
                      JOIN company_payment_notes n2 ON n2.id = l2.payment_note_id
                      WHERE l2.order_id = o.id AND n2.status = 'paid' AND n2.id <> OLD.id)
      AND NOT EXISTS (SELECT 1 FROM courier_payment_note_orders cl2
                      JOIN courier_payment_notes cn2 ON cn2.id = cl2.payment_note_id
                      WHERE cl2.order_id = o.id AND cn2.status = 'paid');
  ELSIF TG_TABLE_NAME = 'courier_payment_notes' THEN
    UPDATE orders o
    SET order_status_id = v_unpaid_status_id, payed = false, updated_at = now()
    FROM courier_payment_note_orders l
    WHERE l.payment_note_id = OLD.id
      AND o.id = l.order_id
      AND o.order_status_id = v_paid_status_id
      AND NOT EXISTS (SELECT 1 FROM courier_payment_note_orders l2
                      JOIN courier_payment_notes n2 ON n2.id = l2.payment_note_id
                      WHERE l2.order_id = o.id AND n2.status = 'paid' AND n2.id <> OLD.id)
      AND NOT EXISTS (SELECT 1 FROM company_payment_note_orders cl2
                      JOIN company_payment_notes cn2 ON cn2.id = cl2.payment_note_id
                      WHERE cl2.order_id = o.id AND cn2.status = 'paid');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_company_payment_note_cascade_unpaid
  AFTER UPDATE ON public.company_payment_notes
  FOR EACH ROW EXECUTE FUNCTION public.payment_note_cascade_unpaid();

CREATE TRIGGER trg_courier_payment_note_cascade_unpaid
  AFTER UPDATE ON public.courier_payment_notes
  FOR EACH ROW EXECUTE FUNCTION public.payment_note_cascade_unpaid();
