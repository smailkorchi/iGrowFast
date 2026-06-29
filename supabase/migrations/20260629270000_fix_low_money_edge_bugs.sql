-- BUG (T6-BUG #3, db-function sweep 2026-06-29): three low-impact money-edge fixes, seller + mediabuyer twins.
--
-- (A) close_seller_month / close_mediabuyer_month: the NOT-FOUND backfill branch hardcoded carried_in=0,
--     dropping a prior closed month's carried_out on a multi-month-gap backfill. Seed carried_in from the
--     latest prior closed ticket (like pay_seller does); only skip when both earned and carry-in are 0.
-- (B) refresh_seller_payment_balance / refresh_mediabuyer_payment_balance: an overpayment against a
--     zero/NULL-total ticket stayed 'partial' forever (paid branch required total>0). Drop the >0
--     requirement so a fully-covered ticket is 'paid'.
-- (C) refresh_open_seller_ticket / refresh_open_mediabuyer_ticket: the only-when-changed UPDATE didn't
--     compare delivered_orders, leaving the (display-only) delivered count stale when units changed but
--     the recomputed money did not. Add delivered_orders to the change predicate.
-- Bodies otherwise identical (the cron-only fail-open guards are left as-is — moot since anon/auth EXECUTE
-- was revoked in T6-SEC #3; defense-in-depth hardening of those is tracked separately).
--
-- Rollback: restore carried_in=0 / the `> 0` clause / the narrower change predicate respectively.

-- (A) seller close
CREATE OR REPLACE FUNCTION public.close_seller_month(p_close_month date DEFAULT ((date_trunc('month'::text, now()) - '1 mon'::interval))::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_close date := date_trunc('month', p_close_month)::date;
    v_close_txt text := to_char(v_close, 'YYYY-MM-01');
    v_next date := (v_close + interval '1 month')::date;
    v_next_txt text := to_char(v_next, 'YYYY-MM-01');
    r record;
    v_earned numeric;
    v_units int;
    v_carry_in numeric;
    v_paid numeric;
    v_total numeric;
    v_carry_out numeric;
    v_state text;
    v_nxt_earned numeric;
    v_nxt_units int;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() AND NOT public.check_user_role(auth.uid(), ARRAY['super admin','admin']) THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    FOR r IN
        SELECT DISTINCT seller_id, "DigiCom Business" AS biz FROM (
            SELECT seller_id, "DigiCom Business" FROM public.seller_daily_earnings WHERE date_trunc('month', date)::date = v_close
            UNION
            SELECT seller_id, "DigiCom Business" FROM public.seller_payments WHERE payout_month = v_close_txt AND period_state = 'open'
        ) s
        WHERE seller_id IS NOT NULL AND "DigiCom Business" IS NOT NULL
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(r.seller_id::text || r.biz::text, 0));
        SELECT COALESCE(SUM(commission_earned),0), COALESCE(SUM(delivered_count),0)
          INTO v_earned, v_units
          FROM public.seller_daily_earnings
         WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz AND date_trunc('month', date)::date = v_close;
        SELECT carried_in, paid_amount, period_state INTO v_carry_in, v_paid, v_state
          FROM public.seller_payments
         WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz AND payout_month=v_close_txt;
        IF NOT FOUND THEN
            v_carry_in := COALESCE((SELECT carried_out FROM public.seller_payments
                WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz
                  AND period_state='closed' AND payout_month < v_close_txt
                ORDER BY payout_month DESC LIMIT 1), 0);
            IF v_earned = 0 AND v_carry_in = 0 THEN CONTINUE; END IF;
            v_carry_out := v_carry_in + v_earned;
            INSERT INTO public.seller_payments
                (seller_id,"DigiCom Business",payout_month,carried_in,month_earned,delivered_orders,total_amount,period_state,earned_frozen,closed_at,carried_out)
            VALUES (r.seller_id,r.biz,v_close_txt,v_carry_in,v_earned,v_units,v_carry_in + v_earned,'closed',true,now(),v_carry_out);
        ELSIF v_state = 'open' THEN
            IF v_earned = 0 AND COALESCE(v_carry_in,0)=0 AND COALESCE(v_paid,0)=0 THEN CONTINUE; END IF;
            v_total := COALESCE(v_carry_in,0) + v_earned;
            v_carry_out := v_total - COALESCE(v_paid,0);
            UPDATE public.seller_payments
               SET month_earned=v_earned, delivered_orders=v_units, total_amount=v_total, period_state='closed', earned_frozen=true, closed_at=now(), carried_out=v_carry_out
             WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz AND payout_month=v_close_txt AND period_state='open';
        ELSE
            SELECT carried_out INTO v_carry_out FROM public.seller_payments
             WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz AND payout_month=v_close_txt;
            v_carry_out := COALESCE(v_carry_out,0);
        END IF;
        SELECT COALESCE(SUM(commission_earned),0), COALESCE(SUM(delivered_count),0)
          INTO v_nxt_earned, v_nxt_units
          FROM public.seller_daily_earnings
         WHERE seller_id=r.seller_id AND "DigiCom Business"=r.biz AND date_trunc('month', date)::date = v_next;
        INSERT INTO public.seller_payments
            (seller_id,"DigiCom Business",payout_month,carried_in,month_earned,delivered_orders,total_amount,period_state,earned_frozen)
        VALUES (r.seller_id,r.biz,v_next_txt,v_carry_out,v_nxt_earned,v_nxt_units,v_carry_out + v_nxt_earned,'open',false)
        ON CONFLICT (seller_id,payout_month,"DigiCom Business") DO UPDATE
           SET carried_in=EXCLUDED.carried_in, month_earned=EXCLUDED.month_earned, delivered_orders=EXCLUDED.delivered_orders, total_amount=EXCLUDED.carried_in + EXCLUDED.month_earned
         WHERE public.seller_payments.period_state='open';
        PERFORM public.refresh_seller_payment_balance(sp.id) FROM public.seller_payments sp
         WHERE sp.seller_id=r.seller_id AND sp."DigiCom Business"=r.biz AND sp.payout_month IN (v_close_txt, v_next_txt);
    END LOOP;
END;
$function$;

-- (A) mediabuyer close
CREATE OR REPLACE FUNCTION public.close_mediabuyer_month(p_close_month date DEFAULT ((date_trunc('month'::text, now()) - '1 mon'::interval))::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_close date := date_trunc('month', p_close_month)::date;
  v_close_txt text := to_char(v_close, 'YYYY-MM-01');
  v_next date := (v_close + interval '1 month')::date;
  v_next_txt text := to_char(v_next, 'YYYY-MM-01');
  r record; v_earned numeric; v_del int; v_spend numeric; v_camps int; v_carry_in numeric; v_paid numeric;
  v_total numeric; v_carry_out numeric; v_state text; v_nxt_earned numeric; v_nxt_del int; v_nxt_spend numeric; v_nxt_camps int; v_pt text;
begin
  if auth.uid() is not null and not public.is_owner() and not public.check_user_role(auth.uid(), array['super admin','admin']) then
    raise exception 'forbidden: admin only'; end if;
  for r in
    select distinct mb_id, biz from (
      select created_by as mb_id, "DigiCom Business" as biz from public.campaign_daily_entries where date_trunc('month', entry_date)::date = v_close
      union
      select mediabuyer_id, "DigiCom Business" from public.mediabuyer_payments where payout_month=v_close_txt and period_state='open'
    ) s where mb_id is not null and biz is not null
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.mb_id::text || r.biz::text, 0));
    select e.earned, e.delivered, e.spend, e.campaigns into v_earned, v_del, v_spend, v_camps from public.mb_month_earned(r.mb_id, r.biz, v_close) e;
    select payment_type into v_pt from public.users where id=r.mb_id;
    select carried_in, paid_amount, period_state into v_carry_in, v_paid, v_state
      from public.mediabuyer_payments where mediabuyer_id=r.mb_id and "DigiCom Business"=r.biz and payout_month=v_close_txt;
    if not found then
      v_carry_in := coalesce((select carried_out from public.mediabuyer_payments
          where mediabuyer_id=r.mb_id and "DigiCom Business"=r.biz
            and period_state='closed' and payout_month < v_close_txt
          order by payout_month desc limit 1), 0);
      if v_earned = 0 and v_carry_in = 0 then continue; end if;
      v_carry_out := v_carry_in + v_earned;
      insert into public.mediabuyer_payments
        (mediabuyer_id,"DigiCom Business",payout_month,payment_type,carried_in,month_earned,delivered_orders,total_spend,campaigns_count,commission_earned,salary_earned,total_amount,period_state,earned_frozen,closed_at,carried_out,status)
      values (r.mb_id,r.biz,v_close_txt,coalesce(v_pt,'commission'),v_carry_in,v_earned,v_del,v_spend,v_camps,
              case when v_pt='salary' then 0 else v_earned end, case when v_pt='salary' then v_earned else 0 end,
              v_carry_in + v_earned,'closed',true,now(),v_carry_out,'pending');
    elsif v_state = 'open' then
      if v_earned = 0 and coalesce(v_carry_in,0)=0 and coalesce(v_paid,0)=0 then continue; end if;
      v_total := coalesce(v_carry_in,0) + v_earned;
      v_carry_out := v_total - coalesce(v_paid,0);
      update public.mediabuyer_payments
         set month_earned=v_earned, delivered_orders=v_del, total_spend=v_spend, campaigns_count=v_camps,
             commission_earned=case when v_pt='salary' then 0 else v_earned end, salary_earned=case when v_pt='salary' then v_earned else 0 end,
             total_amount=v_total, period_state='closed', earned_frozen=true, closed_at=now(), carried_out=v_carry_out
       where mediabuyer_id=r.mb_id and "DigiCom Business"=r.biz and payout_month=v_close_txt and period_state='open';
    else
      select carried_out into v_carry_out from public.mediabuyer_payments where mediabuyer_id=r.mb_id and "DigiCom Business"=r.biz and payout_month=v_close_txt;
      v_carry_out := coalesce(v_carry_out,0);
    end if;
    select e.earned, e.delivered, e.spend, e.campaigns into v_nxt_earned, v_nxt_del, v_nxt_spend, v_nxt_camps from public.mb_month_earned(r.mb_id, r.biz, v_next) e;
    insert into public.mediabuyer_payments
      (mediabuyer_id,"DigiCom Business",payout_month,payment_type,carried_in,month_earned,delivered_orders,total_spend,campaigns_count,commission_earned,salary_earned,total_amount,period_state,earned_frozen,status)
    values (r.mb_id,r.biz,v_next_txt,coalesce(v_pt,'commission'),v_carry_out,v_nxt_earned,v_nxt_del,v_nxt_spend,v_nxt_camps,
            case when v_pt='salary' then 0 else v_nxt_earned end, case when v_pt='salary' then v_nxt_earned else 0 end,
            v_carry_out + v_nxt_earned,'open',false,'pending')
    on conflict (mediabuyer_id,payout_month,"DigiCom Business") do update
       set carried_in=excluded.carried_in, month_earned=excluded.month_earned, delivered_orders=excluded.delivered_orders,
           total_spend=excluded.total_spend, campaigns_count=excluded.campaigns_count, commission_earned=excluded.commission_earned,
           salary_earned=excluded.salary_earned, total_amount=excluded.carried_in+excluded.month_earned
     where public.mediabuyer_payments.period_state='open';
    perform public.refresh_mediabuyer_payment_balance(mp.id) from public.mediabuyer_payments mp
     where mp.mediabuyer_id=r.mb_id and mp."DigiCom Business"=r.biz and mp.payout_month in (v_close_txt, v_next_txt);
  end loop;
end;
$function$;

-- (B) seller balance
CREATE OR REPLACE FUNCTION public.refresh_seller_payment_balance(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_paid numeric;
    v_total numeric;
    v_new_status text;
    v_paid_at timestamptz;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.seller_payment_txns WHERE seller_payment_id = p_payment_id;

    SELECT total_amount INTO v_total
    FROM public.seller_payments WHERE id = p_payment_id;

    IF v_paid <= 0 THEN
        v_new_status := 'pending';
        v_paid_at := NULL;
    ELSIF v_paid >= COALESCE(v_total, 0) THEN
        v_new_status := 'paid';
        SELECT MAX(paid_at) INTO v_paid_at FROM public.seller_payment_txns WHERE seller_payment_id = p_payment_id;
    ELSE
        v_new_status := 'partial';
        v_paid_at := NULL;
    END IF;

    UPDATE public.seller_payments
    SET paid_amount = v_paid,
        status      = v_new_status,
        paid_at     = v_paid_at
    WHERE id = p_payment_id;
END;
$function$;

-- (B) mediabuyer balance
CREATE OR REPLACE FUNCTION public.refresh_mediabuyer_payment_balance(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_paid numeric;
    v_total numeric;
    v_new_status text;
    v_paid_at timestamptz;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.mediabuyer_payment_txns WHERE mediabuyer_payment_id = p_payment_id;

    SELECT total_amount INTO v_total
    FROM public.mediabuyer_payments WHERE id = p_payment_id;

    IF v_paid <= 0 THEN
        v_new_status := 'pending';
        v_paid_at := NULL;
    ELSIF v_paid >= COALESCE(v_total, 0) THEN
        v_new_status := 'paid';
        SELECT MAX(paid_at) INTO v_paid_at FROM public.mediabuyer_payment_txns WHERE mediabuyer_payment_id = p_payment_id;
    ELSE
        v_new_status := 'partial';
        v_paid_at := NULL;
    END IF;

    UPDATE public.mediabuyer_payments
    SET paid_amount = v_paid,
        status      = v_new_status,
        paid_at     = v_paid_at
    WHERE id = p_payment_id;
END;
$function$;

-- (C) seller open-ticket refresh
CREATE OR REPLACE FUNCTION public.refresh_open_seller_ticket(p_seller_id uuid, p_business_id uuid, p_month date DEFAULT (date_trunc('month'::text, now()))::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_month_txt text := to_char(date_trunc('month', p_month), 'YYYY-MM-01');
    v_earned numeric;
    v_units int;
    v_id uuid;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() AND NOT public.check_user_role(auth.uid(), ARRAY['super admin','admin']) THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    SELECT COALESCE(SUM(commission_earned),0), COALESCE(SUM(delivered_count),0)
      INTO v_earned, v_units
      FROM public.seller_daily_earnings
     WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id
       AND date_trunc('month', date)::date = date_trunc('month', p_month)::date;
    UPDATE public.seller_payments sp
       SET month_earned=v_earned, delivered_orders=v_units, total_amount = sp.carried_in + v_earned
     WHERE sp.seller_id=p_seller_id AND sp."DigiCom Business"=p_business_id AND sp.payout_month=v_month_txt
       AND sp.period_state='open' AND (sp.month_earned IS DISTINCT FROM v_earned OR sp.delivered_orders IS DISTINCT FROM v_units)
     RETURNING sp.id INTO v_id;
    IF v_id IS NOT NULL THEN
        PERFORM public.refresh_seller_payment_balance(v_id);
    END IF;
END;
$function$;

-- (C) mediabuyer open-ticket refresh
CREATE OR REPLACE FUNCTION public.refresh_open_mediabuyer_ticket(p_mb uuid, p_business_id uuid, p_month date DEFAULT (date_trunc('month'::text, now()))::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_month_txt text := to_char(date_trunc('month', p_month), 'YYYY-MM-01'); v_earned numeric; v_del int; v_spend numeric; v_camps int; v_id uuid; v_pt text;
begin
  if auth.uid() is not null and not public.is_owner() and not public.check_user_role(auth.uid(), array['super admin','admin']) then
    raise exception 'forbidden: admin only'; end if;
  select e.earned, e.delivered, e.spend, e.campaigns into v_earned, v_del, v_spend, v_camps from public.mb_month_earned(p_mb, p_business_id, p_month) e;
  select payment_type into v_pt from public.users where id = p_mb;
  update public.mediabuyer_payments mp
     set month_earned=v_earned, delivered_orders=v_del, total_spend=v_spend, campaigns_count=v_camps,
         commission_earned = case when v_pt='salary' then 0 else v_earned end,
         salary_earned = case when v_pt='salary' then v_earned else 0 end,
         total_amount = mp.carried_in + v_earned
   where mp.mediabuyer_id=p_mb and mp."DigiCom Business"=p_business_id and mp.payout_month=v_month_txt and mp.period_state='open'
     and (mp.month_earned is distinct from v_earned or mp.total_spend is distinct from v_spend or mp.campaigns_count is distinct from v_camps or mp.delivered_orders is distinct from v_del)
   returning mp.id into v_id;
  if v_id is not null then perform public.refresh_mediabuyer_payment_balance(v_id); end if;
end;
$function$;
