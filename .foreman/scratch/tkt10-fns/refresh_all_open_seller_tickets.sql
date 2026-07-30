CREATE OR REPLACE FUNCTION public.refresh_all_open_seller_tickets()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_month     date    := date_trunc('month', now())::date;
  v_month_txt text    := to_char(v_month, 'YYYY-MM-01');
  v_id        uuid;
  v_n         integer := 0;
begin
  -- Identical gate to refresh_open_seller_ticket. auth.uid() is NULL under cron.
  if auth.uid() is not null
     and not public.is_owner()
     and not public.check_user_role(auth.uid(), array['super admin','admin']) then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  for v_id in
    with earned as (
      -- ONE pass over the view for every seller in every business.
      select sde.seller_id,
             sde."DigiCom Business"                     as biz,
             coalesce(sum(sde.commission_earned), 0)    as earned,
             coalesce(sum(sde.delivered_count), 0)::int as units
        from public.seller_daily_earnings sde
       where date_trunc('month', sde.date)::date = v_month
       group by 1, 2
    ),
    tgt as (
      -- LEFT JOIN: an open ticket with no earnings rows this month resolves to
      -- 0, exactly as the per-row COALESCE(SUM(...),0) does.
      select sp.id,
             coalesce(e.earned, 0)     as new_earned,
             coalesce(e.units, 0)::int as new_units
        from public.seller_payments sp
        left join earned e
          on e.seller_id = sp.seller_id
         and e.biz       = sp."DigiCom Business"
       where sp.period_state = 'open'
         and sp.payout_month = v_month_txt
    ),
    upd as (
      update public.seller_payments sp
         set month_earned     = t.new_earned,
             delivered_orders = t.new_units,
             total_amount     = sp.carried_in + t.new_earned
        from tgt t
       where sp.id = t.id
         and (sp.month_earned     is distinct from t.new_earned
           or sp.delivered_orders is distinct from t.new_units)
      returning sp.id
    )
    select id from upd
  loop
    -- Reuse the trusted balance/status function for the FEW changed rows.
    -- total_amount just moved, so status ('paid'/'partial'/'pending') and
    -- paid_at must be re-derived. paid_amount itself is already kept in lockstep
    -- by trg_seller_payment_txns_aiud.
    perform public.refresh_seller_payment_balance(v_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$

