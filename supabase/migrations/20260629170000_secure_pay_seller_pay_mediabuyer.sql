-- SECURITY (T6-SEC, db-function sweep 2026-06-29): harden the payout RPCs pay_seller / pay_mediabuyer.
--
-- Both are SECDEF (run as postgres, bypass RLS) and had PUBLIC+anon+authenticated EXECUTE. The admin
-- guard was FAIL-OPEN: `if auth.uid() IS NOT NULL and not is_owner() and not check_user_role(...)` —
-- an anon PostgREST call has auth.uid()=NULL, so the AND short-circuits FALSE and the guard never
-- fires, letting anon forge money-out txns (created_by NULL) against any business/amount.
--
-- Two-part fix:
--   1) Flip the guard to FAIL-CLOSED: `if not (is_owner() or check_user_role(auth.uid(), [...]))`.
--      A NULL subject now fails the check and is rejected. (Same allowed-role set; structure only.)
--      Defense-in-depth: this DB has a history of grant resets on clone, so the guard must be safe
--      regardless of who holds EXECUTE.
--   2) REVOKE EXECUTE FROM PUBLIC, anon. KEEP authenticated — the admin frontend pays in the user's
--      authenticated session (Salaries.tsx, PayoutPaymentDialogs.tsx) and the guard then enforces
--      owner / super admin. service_role retained. No cron/SECDEF/NULL-uid caller exists.
-- Everything else in both bodies is byte-identical to the prior definition.
--
-- Rollback: re-create with the prior `auth.uid() is not null and ...` guard + GRANT EXECUTE TO anon.

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
    IF NOT (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin'])) THEN
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
  if not (public.is_owner() or public.check_user_role(auth.uid(), array['super admin','admin'])) then
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

REVOKE EXECUTE ON FUNCTION public.pay_seller(uuid, uuid, numeric, timestamptz, text)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_mediabuyer(uuid, uuid, numeric, timestamptz, text) FROM PUBLIC, anon;
