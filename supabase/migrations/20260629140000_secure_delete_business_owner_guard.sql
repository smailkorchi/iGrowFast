-- SECURITY (T6-SEC, db-function sweep 2026-06-29): add an internal owner guard to delete_business.
--
-- delete_business is SECURITY DEFINER (runs as postgres, bypasses RLS) and EXECUTE is granted to
-- role `authenticated`, yet the body had ZERO authorization check. The only owner-gate lived in the
-- edge function (delete-business/index.ts:28 checks role==='owner'), and that edge fn deliberately
-- invokes the RPC in the caller's authenticated JWT context (asOwner = ANON client + owner Bearer).
-- So ANY authenticated user (seller/mediabuyer/courier) could bypass the edge fn and call
-- supabase.rpc('delete_business', {p_business_id:<ANY uuid>}) directly via PostgREST, wiping that
-- business's orders/notes/products/customers/transactions AND deleting its members from
-- auth.users + public.users. Verified live-exploitable against prod (workflow wf_2b34ab3f).
--
-- FIX: gate on public.is_owner() as the first statement. is_owner() keys on auth.uid() and returns
-- TRUE in the edge fn's owner-JWT context (legit path preserved), FALSE for any non-owner direct
-- call (rejected with 42501 before any DELETE). Do NOT revoke EXECUTE from authenticated — the edge
-- fn runs the RPC as authenticated, so a revoke would break the real path. anon already lacks EXECUTE.
-- No trigger/cron/cross-fn caller exists, so the guard cannot break any other path.
--
-- Rollback: re-run the prior definition without the IF NOT public.is_owner() block.

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
  -- AUTHZ: SECDEF + EXECUTE to authenticated; the edge fn calls this in the owner's JWT context.
  -- Block any non-owner direct PostgREST call before touching data.
  if not public.is_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

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
$function$
