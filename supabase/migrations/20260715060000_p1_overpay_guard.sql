-- P-1 — OVERPAY GUARD on the payout authority (pay_seller + pay_mediabuyer).
--
-- OWNER RULING 2026-07-15: advances / intentional overpayments are NOT
-- legitimate. Supporting them would push `remaining` negative -> negative
-- carried_out -> negative carried_in, forcing every "Reste" surface to render
-- and explain negative money. So: HARD BLOCK, no p_allow_advance opt-in.
--
-- WHAT WAS WRONG (recon-proven, live): no overpay guard existed ANYWHERE.
-- p_amount was inserted verbatim; refresh_*_balance uses `>=` and labels
-- paid_amount > total_amount as 'paid' — it records overpayment, never rejects
-- it. The excess then rolls into a negative carried_out and poisons the next
-- month's carried_in: the shape of the documented -280 incident. This is not a
-- redesign — the system was ALREADY designed with no advances; nothing enforced
-- it. This makes the code assert the design.
--
-- NOT A DATA FIX: live data is clean (overpaid_tickets = 0, owner-confirmed by
-- manual check). No backfill, no row touched.
--
-- TOLERANCE 0.005 — measured, not guessed: every money column is `numeric`
-- (exact, no float dust server-side) and ZERO live tickets carry a remaining
-- beyond 2 decimals (seller and MB, worst deviation 0.00). The only dust is the
-- client computing remaining in float64 then .toFixed(2), which can round at
-- most half a centime above the true value. 0.005 absorbs exactly that and
-- still rejects every real overpay. A stricter guard would block a legitimate
-- settle-in-full on a rounding artefact.
--
-- ERRCODE 23514 (check_violation): a DEFINITIVE server rejection — callers can
-- tell it apart from a transport failure, where the outcome is unknown.
--
-- Bodies below are the LIVE pg_get_functiondef output with ONLY the declare +
-- guard added; every other byte is unchanged. Reversible: re-apply the prior
-- definitions (migrations 20260629170000 / the pay_mediabuyer original).
--
-- Apply: ~/.igrowfast/db.sh < this file   (dry-run first: commit -> rollback)

begin;

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
$function$;

revoke all on function public.pay_seller(uuid, uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.pay_seller(uuid, uuid, numeric, timestamptz, text) to authenticated;
alter function public.pay_seller(uuid, uuid, numeric, timestamptz, text) owner to postgres;

revoke all on function public.pay_mediabuyer(uuid, uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.pay_mediabuyer(uuid, uuid, numeric, timestamptz, text) to authenticated;
alter function public.pay_mediabuyer(uuid, uuid, numeric, timestamptz, text) owner to postgres;

commit;
