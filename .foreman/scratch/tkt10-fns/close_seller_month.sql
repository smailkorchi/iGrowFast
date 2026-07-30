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
$function$

