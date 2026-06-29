-- SECURITY (T6-SEC, db-function sweep 2026-06-29): authz guard on approve_sheet_order.
--
-- SECDEF (bypasses RLS), EXECUTE to PUBLIC+anon+authenticated. Its only guard was a cross-tenant
-- check `v_caller_biz IS NOT NULL AND v_biz IS DISTINCT FROM v_caller_biz` that was SKIPPED whenever
-- the caller's business was NULL (anon) — so anon could approve any pending sheet order in any
-- business — and there was NO role check, so any same-business member (commercial/courier) could
-- approve, not just an admin.
--
-- FIX: (1) reject NULL auth.uid() up front; (2) require super-admin of the ORDER'S OWN business.
-- NOT owner: approve_sheet_order is a per-business admin op (SheetReview, /admin), and the owner is
-- confined to /owner/* and stripped of per-business access ([[owner-confinement-model]]) — owner has
-- DigiCom Business=NULL and is excluded by both the role check and the IS NOT NULL check. The nested
-- PERFORM sync_imported_orders(v_biz) stays consistent (caller is a super-admin of v_biz).
-- (3) REVOKE EXECUTE FROM PUBLIC, anon (keep authenticated — SheetReview calls it authed).
-- Body otherwise identical.
--
-- Rollback: re-create with the prior cross-tenant-only guard + GRANT EXECUTE TO anon.

CREATE OR REPLACE FUNCTION public.approve_sheet_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller_biz uuid := current_user_digicom_business_id();
  v_biz uuid; v_review text; v_name text; v_phone text; v_city uuid; v_status uuid; v_new_status uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT "DigiCom Business", source_review_status, name, phone, master_city_id, order_status_id
    INTO v_biz, v_review, v_name, v_phone, v_city, v_status
    FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order not found'); END IF;

  -- AUTHZ: super-admin of the order's OWN business only. NOT owner (per-business op, /owner/*-confined).
  IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
          AND v_caller_biz IS NOT NULL AND v_biz = v_caller_biz) THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  IF v_review IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order is not pending');
  END IF;

  IF COALESCE(btrim(v_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name required'); END IF;
  IF length(regexp_replace(COALESCE(v_phone, ''), '[^0-9]', '', 'g')) < 9 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'valid phone required'); END IF;
  IF v_city IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'city required'); END IF;

  IF v_status IS NOT NULL THEN
    v_new_status := v_status;
  ELSE
    SELECT id INTO v_new_status FROM public.order_statuses WHERE is_new LIMIT 1;
  END IF;
  IF v_new_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no entry status available'); END IF;

  INSERT INTO public.order_status_history (order_id, status_id, "DigiCom Business", changed_by, comment)
  VALUES (p_order_id, v_new_status, v_biz, auth.uid(), 'Approved from sheet sync');

  UPDATE public.orders
  SET source_review_status = 'approved', order_status_id = v_new_status, updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.sync_imported_orders(v_biz);

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'seller_id', NULL, 'status_id', v_new_status);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_sheet_order(uuid) FROM PUBLIC, anon;
