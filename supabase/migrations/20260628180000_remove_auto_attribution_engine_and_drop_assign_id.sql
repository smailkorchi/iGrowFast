-- Phase 2/N: remove the early-stage auto-attribution engine at the root + drop orders.assign_id.
--
-- Verified 2026-06-28 (full pg_get_functiondef bodies read; prod==dev byte-identical for the two
-- rewritten fns; pre-flight assign_only_seller_null=0, divergent_both=1 [seller_id wins]; seller_attribution_state
-- 68 rows all orders_today=0/credit=0; money keys only on seller_id — seller_daily_earnings untouched).
--
-- End state: seller_id is the single MANUAL attribution key. No order gets a seller automatically anymore
-- (intended; super-admin/admin-created orders legitimately stay unassigned, seller-created keep their seller).
-- Existing seller_id values and ALL existing commission are untouched — this only removes future auto-assignment.
--
-- Statement order is mandatory: rewrite callers (approve_sheet_order drops the attribute_single_order call;
-- delete_business drops its assign_id null-out) BEFORE dropping callees; drop the assign_id event-list trigger
-- (trg_sync_attribution_manual) BEFORE dropping the column.
--
-- Rollback: restore the engine from migration history (re-create the 9 fns, 4 triggers, seller_attribution_state
-- table + its trigger/indexes/RLS), then `ALTER TABLE orders ADD COLUMN assign_id uuid; ADD CONSTRAINT
-- orders_assign_id_fkey FOREIGN KEY (assign_id) REFERENCES users(id); CREATE INDEX idx_orders_assign_id ON orders(assign_id);
-- UPDATE orders SET assign_id = seller_id;` and revert approve_sheet_order/delete_business to their prior bodies.

-- STMT 1 — approve_sheet_order: stop auto-attributing; approved sheet orders stay seller_id NULL.
-- (regex '[^0-9]' is identical to the prior '\D' digit-strip; swapped only to avoid backslash escaping in transit.)
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
  SELECT "DigiCom Business", source_review_status, name, phone, master_city_id, order_status_id
    INTO v_biz, v_review, v_name, v_phone, v_city, v_status
    FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order not found'); END IF;

  IF v_caller_biz IS NOT NULL AND v_biz IS DISTINCT FROM v_caller_biz THEN
    RAISE EXCEPTION 'forbidden: cross-tenant approval';
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

-- STMT 2 — delete_business: drop the single assign_id null-out line (else tenant teardown errors once the column is gone).
CREATE OR REPLACE FUNCTION public.delete_business(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_member_ids uuid[];
  v_state text; v_msg text; v_detail text; v_ctx text; v_constraint text; v_table text;
begin
  select coalesce(array_agg(id), '{}') into v_member_ids
  from public.users where "DigiCom Business" = p_business_id and role <> 'owner';

  begin
    delete from public.company_payment_note_orders where "DigiCom Business" = p_business_id;
    delete from public.courier_payment_note_orders where "DigiCom Business" = p_business_id;
    delete from public.company_return_note_orders  where "DigiCom Business" = p_business_id;
    delete from public.courier_return_note_orders  where "DigiCom Business" = p_business_id;

    delete from public.orders where "DigiCom Business" = p_business_id;

    delete from public.company_payment_notes  where "DigiCom Business" = p_business_id;
    delete from public.courier_payment_notes  where "DigiCom Business" = p_business_id;
    delete from public.company_return_notes   where "DigiCom Business" = p_business_id;
    delete from public.courier_return_notes   where "DigiCom Business" = p_business_id;
    delete from public.company_delivery_notes where "DigiCom Business" = p_business_id;
    delete from public.courier_delivery_notes where "DigiCom Business" = p_business_id;

    delete from public.trns_purchase where "DigiCom Business" = p_business_id;
    delete from public.trns_payment  where "DigiCom Business" = p_business_id;
    delete from public.transactions  where "DigiCom Business" = p_business_id;

    delete from public.products    where "DigiCom Business" = p_business_id;
    delete from public.accessories where "DigiCom Business" = p_business_id;

    delete from public.customers               where "DigiCom Business" = p_business_id;
    delete from public.mediabuyer_payment_txns where "DigiCom Business" = p_business_id;
    delete from public.seller_payment_txns     where "DigiCom Business" = p_business_id;

    if array_length(v_member_ids, 1) > 0 then
      update public.orders set seller_id = null      where seller_id = any(v_member_ids);
      update public.orders set confirmed_by_id = null where confirmed_by_id = any(v_member_ids);
      update public.orders set canceled_by_id = null  where canceled_by_id = any(v_member_ids);
      update public.company_delivery_notes set created_by = null where created_by = any(v_member_ids);
      update public.company_return_notes   set created_by = null where created_by = any(v_member_ids);
    end if;

    delete from public.businesses where id = p_business_id;

    if array_length(v_member_ids, 1) > 0 then
      delete from auth.users   where id = any(v_member_ids);
      delete from public.users where id = any(v_member_ids);
    end if;
  exception when others then
    get stacked diagnostics
      v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail,
      v_ctx = pg_exception_context, v_constraint = constraint_name, v_table = table_name;
    raise warning 'DELETE_BUSINESS_FAILURE sqlstate=% msg=% detail=% table=% constraint=% context=%',
      v_state, v_msg, v_detail, v_table, v_constraint, v_ctx;
    raise;
  end;
end;
$function$;

-- STMT 3-6 — drop the four engine triggers (clears the assign_id event-list dependency).
DROP TRIGGER IF EXISTS trg_auto_attribute_order ON public.orders;
DROP TRIGGER IF EXISTS trg_auto_assign_seller ON public.order_items;
DROP TRIGGER IF EXISTS trg_reassign_sellers_on_user_update ON public.users;
DROP TRIGGER IF EXISTS trg_sync_attribution_manual ON public.orders;

-- STMT 7 — drop the 8 engine functions by exact signature (robust to arg types/overloads).
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('auto_attribute_order','auto_assign_seller_from_products',
                      'reassign_sellers_on_user_products_change','sync_attribution_on_manual_assign',
                      'attribute_single_order','reattribute_unassigned_orders',
                      'get_daily_attribution_progress','reset_daily_attribution')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig::text;
  END LOOP;
END
$do$;

-- STMT 8 — drop the per-day state table (cascades its trigger, indexes, FKs, and RLS policies).
DROP TABLE IF EXISTS public.seller_attribution_state CASCADE;

-- STMT 9 — drop the now-orphan touch function (its trigger went with the table).
DROP FUNCTION IF EXISTS public.update_seller_attribution_state_updated_at();

-- STMT 10 — drop assign_id (FK + index auto-drop with the column; no CASCADE needed — STMT 6 cleared the blocker).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_assign_id_fkey;
DROP INDEX IF EXISTS public.idx_orders_assign_id;
ALTER TABLE public.orders DROP COLUMN IF EXISTS assign_id;
