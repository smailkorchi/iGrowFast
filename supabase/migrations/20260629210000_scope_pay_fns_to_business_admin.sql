-- SECURITY (T6-SEC, db-function sweep 2026-06-29): scope pay_seller/pay_mediabuyer to the
-- super-admin OF THE TARGET BUSINESS; drop the is_owner() bypass.
--
-- After #4 the guard was `is_owner() OR check_user_role(auth.uid(),['super admin','admin'])`. Two gaps:
--   (a) is_owner() let the platform owner run payouts — a per-business op the owner is confined out of
--       ([[owner-not-in-per-business-rpcs]] / [[owner-confinement-model]]).
--   (b) check_user_role only checks ROLE, not business — so a super-admin of business X could pay
--       sellers/mediabuyers in business Y (cross-tenant payout fabrication).
-- Fix: require super-admin AND caller's own business = p_business_id. NULL-safe. Matches the UI
-- (owner is /owner/*-only; super-admins are per-business and pay with their own activeBusinessId).
-- Grants unchanged (anon already revoked in #4; authenticated retained). Bodies otherwise identical to #4.
--
-- Rollback: restore the `is_owner() OR check_user_role(...)` guard.

CREATE OR REPLACE FUNCTION public.pay_seller(p_seller_id uuid, p_business_id uuid, p_amount numeric, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_month date := date_trunc('month', now())::date;
    v_month_txt text := to_char(v_month, 'YYYY-MM-01');
    v_ticket uuid;
    v_txn uuid;
    v_carry numeric;
BEGIN
    IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
            AND public.current_user_digicom_business_id() IS NOT NULL
            AND public.current_user_digicom_business_id() = p_business_id) THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text || p_business_id::text, 0));
    SELECT id INTO v_ticket FROM public.seller_payments
     WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id AND payout_month=v_month_txt AND period_state='open';
    IF v_ticket IS NULL THEN
        v_carry := COALESCE((SELECT carried_out FROM public.seller_payments
            WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id AND period_state='closed'
            ORDER BY payout_month DESC LIMIT 1),0);
        INSERT INTO public.seller_payments
            (seller_id,"DigiCom Business",payout_month,carried_in,month_earned,delivered_orders,total_amount,period_state,earned_frozen)
        VALUES (p_seller_id,p_business_id,v_month_txt,v_carry,0,0,v_carry,'open',false)
        RETURNING id INTO v_ticket;
    END IF;
    PERFORM public.refresh_open_seller_ticket(p_seller_id, p_business_id, v_month);
    INSERT INTO public.seller_payment_txns (seller_payment_id, amount, paid_at, note, created_by, "DigiCom Business")
    VALUES (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id)
    RETURNING id INTO v_txn;
    RETURN v_txn;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_mediabuyer(p_mb uuid, p_business_id uuid, p_amount numeric, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month date := date_trunc('month', now())::date;
  v_month_txt text := to_char(v_month, 'YYYY-MM-01');
  v_ticket uuid; v_txn uuid; v_carry numeric; v_pt text;
begin
  if not (public.check_user_role(auth.uid(), array['super admin','admin'])
          and public.current_user_digicom_business_id() is not null
          and public.current_user_digicom_business_id() = p_business_id) then
    raise exception 'forbidden: admin only'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_mb::text || p_business_id::text, 0));
  select id into v_ticket from public.mediabuyer_payments
   where mediabuyer_id=p_mb and "DigiCom Business"=p_business_id and payout_month=v_month_txt and period_state='open';
  if v_ticket is null then
    v_carry := coalesce((select carried_out from public.mediabuyer_payments
       where mediabuyer_id=p_mb and "DigiCom Business"=p_business_id and period_state='closed'
       order by payout_month desc limit 1),0);
    select payment_type into v_pt from public.users where id=p_mb;
    insert into public.mediabuyer_payments
      (mediabuyer_id,"DigiCom Business",payout_month,payment_type,carried_in,month_earned,delivered_orders,total_amount,period_state,earned_frozen,status)
    values (p_mb,p_business_id,v_month_txt,coalesce(v_pt,'commission'),v_carry,0,0,v_carry,'open',false,'pending')
    returning id into v_ticket;
  end if;
  perform public.refresh_open_mediabuyer_ticket(p_mb, p_business_id, v_month);
  insert into public.mediabuyer_payment_txns (mediabuyer_payment_id, amount, paid_at, note, created_by, "DigiCom Business")
  values (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id)
  returning id into v_txn;
  return v_txn;
end;
$function$;
