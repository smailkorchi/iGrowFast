-- =====================================================================
-- Root fix: keep orders' denormalized logistics mirror consistent with parcels.
--
-- PROBLEM: orders carries a mirror of its parcel (tracking_number,
-- package_status_id/label/color, current_delivery_note_id, processing,
-- courier_id). The mirror was only ever cleared inside the parcel-removal
-- RPCs, and the clear was gated on `order_status_id = PROCESSED`. The parcel
-- DELETE was unconditional. So removing a parcel from an order in any
-- non-PROCESSED status (CANCELED / UNPAID / PAID / RETURN / CONFIRMED) left
-- the order with a stale tracking/package status and no parcel behind it.
-- There was no AFTER DELETE trigger, so direct deletes bypassed cleanup too.
--
-- FIX: enforce the invariant at the data layer. An AFTER DELETE trigger on
-- both parcel tables clears the mirror whenever an order has zero remaining
-- parcels, regardless of which code path deleted the parcel. The
-- PROCESSED -> CONFIRMED lifecycle revert is preserved (guarded); the mirror
-- clear is unconditional; company_id is intentionally preserved.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trigger function: single source of truth for mirror clearing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_order_logistics_when_no_parcels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_confirmed_id uuid;
  v_processed_id uuid;
BEGIN
  -- Guard 1: NULL order_id, and order-/business-delete CASCADE.
  -- company_parcels.order_id and courier_parcels.order_id are ON DELETE
  -- CASCADE. When an order (or its business) is deleted, this trigger fires
  -- against a parent row that is being erased in the same statement. Skip it
  -- so we never spuriously fire orders' 13 downstream triggers (stock,
  -- status history, audit) on a doomed row. The legitimate provider-cascade
  -- case (provider deleted, orders survive) still passes this guard.
  IF OLD.order_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = OLD.order_id) THEN
    RETURN OLD;
  END IF;

  -- Guard 2: ignore deletes of UNLINKED (orphan) parcels. A parcel not
  -- attached to a delivery note never wrote the mirror, so deleting it must
  -- clear nothing. This makes the delivery-note wizard's orphan-sweep and
  -- duplicate-skip deletes clean no-ops and avoids any transient mirror wipe
  -- in delete-then-reinsert flows. The real bug class is LINKED parcels.
  IF TG_TABLE_NAME = 'company_parcels' AND OLD.company_delivery_note_id IS NULL THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'courier_parcels' AND OLD.courier_delivery_note_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Guard 3: cross-table zero-check. Only clear when NO parcel of EITHER type
  -- remains for the order (protects future split shipments where an order has
  -- both a company and a courier parcel). AFTER DELETE => OLD row is already
  -- gone, so a plain EXISTS reflects the post-delete state.
  IF EXISTS (SELECT 1 FROM public.company_parcels WHERE order_id = OLD.order_id)
     OR EXISTS (SELECT 1 FROM public.courier_parcels WHERE order_id = OLD.order_id) THEN
    RETURN OLD;
  END IF;

  SELECT id INTO v_confirmed_id FROM public.order_statuses WHERE code = 'CONFIRMED' LIMIT 1;
  SELECT id INTO v_processed_id FROM public.order_statuses WHERE code = 'PROCESSED' LIMIT 1;

  -- Clear the logistics mirror UNCONDITIONALLY. Revert the lifecycle status
  -- to CONFIRMED only when the order is still in PROCESSED (respect terminal
  -- states like CANCELED/UNPAID/PAID/RETURN). company_id is PRESERVED.
  UPDATE public.orders
  SET tracking_number          = NULL,
      package_status_id        = NULL,
      package_status_label     = NULL,
      package_status_color     = NULL,
      current_delivery_note_id = NULL,
      processing               = false,
      courier_id               = NULL,
      order_status_id          = CASE
                                   WHEN order_status_id = v_processed_id
                                        AND v_confirmed_id IS NOT NULL
                                   THEN v_confirmed_id
                                   ELSE order_status_id
                                 END
  WHERE id = OLD.order_id;

  RETURN OLD;
END;
$function$;

ALTER FUNCTION public.clear_order_logistics_when_no_parcels() OWNER TO postgres;

-- This is a trigger function only; it must never be reachable as a PostgREST
-- RPC. Triggers fire regardless of EXECUTE grants, so revoke RPC exposure.
REVOKE EXECUTE ON FUNCTION public.clear_order_logistics_when_no_parcels() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. AFTER DELETE triggers on both parcel tables (idempotent).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_clear_order_logistics_company ON public.company_parcels;
CREATE TRIGGER trg_clear_order_logistics_company
AFTER DELETE ON public.company_parcels
FOR EACH ROW
EXECUTE FUNCTION public.clear_order_logistics_when_no_parcels();

DROP TRIGGER IF EXISTS trg_clear_order_logistics_courier ON public.courier_parcels;
CREATE TRIGGER trg_clear_order_logistics_courier
AFTER DELETE ON public.courier_parcels
FOR EACH ROW
EXECUTE FUNCTION public.clear_order_logistics_when_no_parcels();

-- ---------------------------------------------------------------------
-- 3. Refactor the two company RPCs: the mirror clear + lifecycle revert are
--    now owned by the trigger. Remove the old guarded UPDATE so there is one
--    unambiguous source of truth (the previous guarded clause was the bug).
--    Permission / finalized / single-parcel checks and parcel_count refresh
--    are unchanged. (Faithful subtraction of the buggy UPDATE only.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_company_parcel_from_delivery_note(p_parcel_id uuid, p_delivery_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_uid uuid;
  v_role text;
  v_parcel_count int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT cp.order_id, cdn."DigiCom Business", cdn.is_finalized, cdn.created_by
  INTO v_order_id, v_business, v_finalized, v_created_by
  FROM public.company_parcels cp
  JOIN public.company_delivery_notes cdn ON cdn.id = cp.company_delivery_note_id
  WHERE cp.id = p_parcel_id AND cp.company_delivery_note_id = p_delivery_note_id;

  IF v_order_id IS NULL THEN RAISE EXCEPTION 'parcel_not_found'; END IF;
  IF v_finalized IS TRUE THEN RAISE EXCEPTION 'note_finalized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users me
                 WHERE me.id = v_uid AND me."DigiCom Business" = v_business) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT me.role::text INTO v_role FROM public.users me WHERE me.id = v_uid LIMIT 1;
  IF COALESCE(v_role, '') = 'commercial' AND v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::int INTO v_parcel_count
  FROM public.company_parcels WHERE order_id = v_order_id;
  IF v_parcel_count <> 1 THEN RAISE EXCEPTION 'order_has_multiple_parcels'; END IF;

  -- Order mirror clear + PROCESSED->CONFIRMED revert handled by
  -- the AFTER DELETE trigger clear_order_logistics_when_no_parcels().
  DELETE FROM public.company_parcels WHERE id = p_parcel_id;

  UPDATE public.company_delivery_notes
  SET parcel_count = (SELECT count(*)::int FROM public.company_parcels
                      WHERE company_delivery_note_id = p_delivery_note_id),
      updated_at = now()
  WHERE id = p_delivery_note_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_open_company_delivery_note(p_delivery_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_uid uuid;
  v_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT cdn."DigiCom Business", cdn.is_finalized, cdn.created_by
  INTO v_business, v_finalized, v_created_by
  FROM public.company_delivery_notes cdn WHERE cdn.id = p_delivery_note_id;

  IF v_business IS NULL THEN RAISE EXCEPTION 'note_not_found'; END IF;
  IF v_finalized IS TRUE THEN RAISE EXCEPTION 'note_finalized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users me
                 WHERE me.id = v_uid AND me."DigiCom Business" = v_business) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT me.role::text INTO v_role FROM public.users me WHERE me.id = v_uid LIMIT 1;
  IF COALESCE(v_role, '') = 'commercial' AND v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Per-order mirror clear + revert handled by the AFTER DELETE trigger,
  -- which counts BOTH parcel tables (more correct than the old single-table loop).
  DELETE FROM public.company_parcels WHERE company_delivery_note_id = p_delivery_note_id;

  DELETE FROM public.company_delivery_notes WHERE id = p_delivery_note_id;
END;
$function$;

-- The courier twins carried the identical guarded-clear bug. Same treatment:
-- delete only, let the trigger own the mirror + lifecycle revert.
CREATE OR REPLACE FUNCTION public.remove_courier_parcel_from_delivery_note(p_parcel_id uuid, p_delivery_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_uid uuid;
  v_role text;
  v_parcel_count int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT cp.order_id, cdn."DigiCom Business", cdn.is_finalized, cdn.created_by
    INTO v_order_id, v_business, v_finalized, v_created_by
  FROM public.courier_parcels cp
  JOIN public.courier_delivery_notes cdn ON cdn.id = cp.courier_delivery_note_id
  WHERE cp.id = p_parcel_id AND cp.courier_delivery_note_id = p_delivery_note_id;

  IF v_order_id IS NULL THEN RAISE EXCEPTION 'parcel_not_found'; END IF;
  IF v_finalized IS TRUE THEN RAISE EXCEPTION 'note_finalized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users me
                 WHERE me.id = v_uid AND me."DigiCom Business" = v_business) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT me.role::text INTO v_role FROM public.users me WHERE me.id = v_uid LIMIT 1;
  IF COALESCE(v_role,'') = 'commercial' AND v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*)::int INTO v_parcel_count
  FROM public.courier_parcels WHERE order_id = v_order_id;
  IF v_parcel_count <> 1 THEN RAISE EXCEPTION 'order_has_multiple_parcels'; END IF;

  -- Order mirror clear + lifecycle revert handled by the AFTER DELETE trigger.
  DELETE FROM public.courier_parcels WHERE id = p_parcel_id;

  UPDATE public.courier_delivery_notes
  SET parcel_count = (SELECT count(*)::int FROM public.courier_parcels
                      WHERE courier_delivery_note_id = p_delivery_note_id),
      updated_at = now()
  WHERE id = p_delivery_note_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_open_courier_delivery_note(p_delivery_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business uuid;
  v_finalized boolean;
  v_created_by uuid;
  v_uid uuid;
  v_role text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT cdn."DigiCom Business", cdn.is_finalized, cdn.created_by
    INTO v_business, v_finalized, v_created_by
  FROM public.courier_delivery_notes cdn WHERE cdn.id = p_delivery_note_id;

  IF v_business IS NULL THEN RAISE EXCEPTION 'note_not_found'; END IF;
  IF v_finalized IS TRUE THEN RAISE EXCEPTION 'note_finalized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users me
                 WHERE me.id = v_uid AND me."DigiCom Business" = v_business) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT me.role::text INTO v_role FROM public.users me WHERE me.id = v_uid LIMIT 1;
  IF COALESCE(v_role,'') = 'commercial' AND v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Per-order mirror clear + revert handled by the AFTER DELETE trigger.
  DELETE FROM public.courier_parcels WHERE courier_delivery_note_id = p_delivery_note_id;

  DELETE FROM public.courier_delivery_notes WHERE id = p_delivery_note_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. One-time data repair: clear the single stale orphan (Orelle Maroc).
--    Terminal status (CANCELED) and company_id are preserved.
-- ---------------------------------------------------------------------
UPDATE public.orders
SET tracking_number          = NULL,
    package_status_id        = NULL,
    package_status_label     = NULL,
    package_status_color     = NULL,
    current_delivery_note_id = NULL,
    processing               = false,
    courier_id               = NULL
WHERE id = '26996107-2c68-4256-abbf-f3b88a8972bd';
