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
$function$

