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
    v_remaining numeric;
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

  -- ── OVERPAY GUARD (owner ruling 2026-07-15: NO advances) ──────────────────
  -- AFTER refresh, so `remaining` reflects the just-synced live earned.
  -- Nothing anywhere rejected an overpayment: refresh_*_balance uses `>=` and
  -- merely LABELS paid_amount > total_amount as 'paid'; the excess then rolls
  -- into a negative carried_out -> negative next-month carried_in (the -280
  -- incident shape). This makes "no advances" true in the DB, not by convention.
  -- Tolerance 0.005 (half a centime): money columns are `numeric` = exact, and
  -- 0 live tickets carry a remaining beyond 2dp (measured), so the only dust is
  -- the client computing remaining in float64 then .toFixed(2). 0.005 absorbs
  -- that rounding and still rejects every real overpay.
  -- ERRCODE 23514 = a DEFINITIVE server rejection, distinguishable from a
  -- transport failure of unknown outcome.
  select total_amount - paid_amount into v_remaining
    from public.seller_payments where id = v_ticket;
  if p_amount > coalesce(v_remaining, 0) + 0.005 then
    raise exception 'pay_seller: montant % superieur au reste du % (aucune avance autorisee)',
      p_amount, coalesce(v_remaining, 0) using errcode = '23514';
  end if;

    INSERT INTO public.seller_payment_txns (seller_payment_id, amount, paid_at, note, created_by, "DigiCom Business")
    VALUES (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id)
    RETURNING id INTO v_txn;
    RETURN v_txn;
END;
$function$

