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
$function$

