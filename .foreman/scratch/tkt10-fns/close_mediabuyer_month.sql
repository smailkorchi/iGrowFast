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
$function$

