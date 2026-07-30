CREATE OR REPLACE FUNCTION public.pay_mediabuyer(p_mb uuid, p_business_id uuid, p_amount numeric, p_paid_at timestamp with time zone DEFAULT now(), p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month date := date_trunc('month', now())::date;
  v_month_txt text := to_char(v_month, 'YYYY-MM-01');
  v_ticket uuid; v_txn uuid; v_carry numeric;
    v_remaining numeric; v_pt text;
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
    from public.mediabuyer_payments where id = v_ticket;
  if p_amount > coalesce(v_remaining, 0) + 0.005 then
    raise exception 'pay_mediabuyer: montant % superieur au reste du % (aucune avance autorisee)',
      p_amount, coalesce(v_remaining, 0) using errcode = '23514';
  end if;

  insert into public.mediabuyer_payment_txns (mediabuyer_payment_id, amount, paid_at, note, created_by, "DigiCom Business")
  values (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id)
  returning id into v_txn;
  return v_txn;
end;
$function$

