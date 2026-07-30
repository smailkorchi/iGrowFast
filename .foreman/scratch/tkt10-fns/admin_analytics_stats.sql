CREATE OR REPLACE FUNCTION public.admin_analytics_stats(p_business uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_sections text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    v_now       timestamptz := now();
    v_today     date := (now() at time zone 'Africa/Casablanca')::date;
    v_start     timestamptz := case when p_from is not null
                                    then p_from::timestamp at time zone 'Africa/Casablanca' end;
    v_end_excl  timestamptz := case when p_to is not null
                                    then (p_to + 1)::timestamp at time zone 'Africa/Casablanca' end;
    v_has_win   boolean := (p_from is not null or p_to is not null);
    v_from_day  date := coalesce(p_from, date '1970-01-01');
    v_to_day    date;  -- assigned below (declare-order limitation safety)
    v_profitability jsonb;
    v_health    jsonb;
    v_orders    jsonb;
    v_ads       jsonb;
    v_shipping  jsonb;
    v_inventory jsonb;
    v_channels  jsonb;
    v_customers jsonb;
    v_sellers   jsonb;
    v_couriers  jsonb;
    v_mediabuyers jsonb;
    v_users     jsonb;
    v_all       boolean := (p_sections is null);
    v_out       jsonb := '{}'::jsonb;
begin
    -- ADMIN GATE (D3 review — corrects the design contract's "no scope guard"
    -- lock): this payload aggregates business-wide P&L, ad spend, ROAS and
    -- per-collaborator performance. SECURITY INVOKER + RLS already prevents
    -- privilege escalation (payments tables are own-rows-or-admin scoped), but
    -- campaign_daily_entries/orders carry tenant-wide RLS, so an authenticated
    -- non-admin could otherwise call this RPC directly and receive a
    -- pre-aggregated spend/ROAS/profit payload the MB-facing data rule forbids.
    -- The consumer page is admin-only, so this regresses no legitimate caller.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'admin_analytics_stats: admin only' using errcode = '42501';
    end if;

    v_to_day := coalesce(p_to, v_today);

    if v_all or 'profitability' = any(p_sections) then
    -- ───────────────────── profitability (recon 02 §1 / 03 §1) ─────────────
    -- Pool: replace-excluded. Per-stream window anchors are NOT unified
    -- (contract rule): revenue/COGS/shipping/provisional anchor on
    -- coalesce(date_livraison, updated_at); return fees on updated_at;
    -- expenses cash-basis on expenses.date; seller salaries on sde.date;
    -- MB payouts pro-rated by payout-month overlap; product ads pro-rated by
    -- inclusive-day range overlap; campaign entries on entry_date; the
    -- Conversion denominator alone anchors on placement.
    -- Trend = per-day component arrays (product-ads per day = amount ÷
    -- total_days over range ∩ window; MB salary per day = total ÷
    -- days-in-month over payout month ∩ window — exact day-bucket equivalents
    -- of overlapFraction/payoutMonthOverlap; recon 03 §1 RPC shape).
    with pool as (
        select o.id, o.date, o.price, o.raw_price, o.shipping_cost,
               o.include_delivery_in_total, o.courier_id, o.company_id,
               o.master_city_id, o.updated_at,
               coalesce(o.date_livraison, o.updated_at) as delivery_ts,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(os.is_paid, false)      as is_paid,
               coalesce(os.is_unpaid, false)    as is_unpaid,
               coalesce(ps.is_returned, false)  as is_returned
        from public.orders o
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
    ),
    -- delivered rows with delivery anchor in window: the revenue (paid) and
    -- provisional (unpaid) universes. FULL pureRevenue chain + cogsForOrder
    -- (accessory part INDEPENDENT of product qty — no `continue`, unlike the
    -- D2 sellers-fin replication).
    fin_orders as (
        select p.id, p.is_paid, p.is_unpaid, p.shipping_cost, p.delivery_ts,
               (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                     when coalesce(p.raw_price, 0) > 0 then p.raw_price
                     else case when p.include_delivery_in_total is false
                               then coalesce(p.price, 0)
                               else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end end)
             + (case when p.include_delivery_in_total is true then coalesce(p.shipping_cost, 0) else 0 end)
                 as revenue,
               coalesce(li.cogs, 0) as cogs
        from pool p
        left join lateral (
            select
                sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                         else coalesce(oi.unit_price, 0) * oi.quantity end)
                    filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum,
                sum(
                    coalesce(case when oi.product_id is not null and coalesce(oi.quantity, 0) > 0 then
                        (case when coalesce(oi.product_unit_cost_snapshot, 0) > 0
                              then oi.product_unit_cost_snapshot
                              else coalesce(pr.cost_price, 0) end) * oi.quantity end, 0)
                  + coalesce(case when oi.accessory_id is not null and coalesce(oi.accessory_quantity, 0) > 0 then
                        (case when coalesce(oi.accessory_unit_price, 0) > 0
                              then oi.accessory_unit_price
                              else coalesce(ac.cost_price, 0) end) * oi.accessory_quantity end, 0)
                ) as cogs
            from public.order_items oi
            left join public.products pr on pr.id = oi.product_id
            left join public.accessories ac on ac.id = oi.accessory_id
            where oi.order_id = p.id
        ) li on true
        where p.is_delivered
          and p.delivery_ts is not null
          and (v_start is null or p.delivery_ts >= v_start)
          and (case when v_end_excl is not null then p.delivery_ts < v_end_excl else p.delivery_ts <= v_now end)
    ),
    -- returned orders anchored on updated_at; fee lookup = courier PRECEDENCE
    -- (courier_id set → courier_fees hit or 0, company NEVER consulted), else
    -- company_fees, 0 without a city. Uniq (entity, city, biz) index → the
    -- scalar subqueries are single-row.
    ret as (
        select p.updated_at,
               case when p.master_city_id is null then 0
                    when p.courier_id is not null then
                        coalesce((select coalesce(cf.return_fee, 0)
                                  from public.courier_fees cf
                                  where cf."DigiCom Business" = p_business
                                    and cf.courier_id = p.courier_id
                                    and cf.master_city_id = p.master_city_id
                                  limit 1), 0)
                    when p.company_id is not null then
                        coalesce((select coalesce(cof.return_fee, 0)
                                  from public.company_fees cof
                                  where cof."DigiCom Business" = p_business
                                    and cof.company_id = p.company_id
                                    and cof.master_city_id = p.master_city_id
                                  limit 1), 0)
                    else 0 end as return_fee
        from pool p
        where p.is_returned
          and p.updated_at is not null
          and (v_start is null or p.updated_at >= v_start)
          and (case when v_end_excl is not null then p.updated_at < v_end_excl else p.updated_at <= v_now end)
    ),
    placed as (
        select count(*)::int as placed_count,
               (count(*) filter (where is_delivered and is_paid))::int as converted_count
        from pool p
        where p.date is not null
          and (v_start is null or p.date >= v_start)
          and (case when v_end_excl is not null then p.date < v_end_excl else p.date <= v_now end)
    ),
    exp_rows as (  -- strict cash basis: amount > 0, expenses.date (timestamptz) in window
        select e.amount, e.date,
               coalesce(nullif(btrim(et.name), ''), 'Uncategorized') as type_name
        from public.expenses e
        left join public.expense_types et on et.id = e.type_id
        where e."DigiCom Business" = p_business
          and coalesce(e.amount, 0) > 0
          and e.date is not null
          and (v_start is null or e.date >= v_start)
          and (case when v_end_excl is not null then e.date < v_end_excl else e.date <= v_now end)
    ),
    sde_rows as (
        select s.date, coalesce(s.total_earned, 0) as total_earned
        from public.seller_daily_earnings s
        where s."DigiCom Business" = p_business
          and s.date is not null
          and s.date >= v_from_day and s.date <= v_to_day
    ),
    mbp_rows as (  -- payoutMonthOverlap: calendar-month overlap fraction
        select coalesce(mp.total_amount, 0) as total_amount, f.m_start, f.m_end,
               (f.m_end - f.m_start + 1) as days_in_month,
               greatest(f.m_start, v_from_day) as ov_start,
               least(f.m_end, v_to_day) as ov_end
        from public.mediabuyer_payments mp
        cross join lateral (
            select to_date(left(mp.payout_month, 7) || '-01', 'YYYY-MM-DD') as m_start,
                   (to_date(left(mp.payout_month, 7) || '-01', 'YYYY-MM-DD')
                       + interval '1 month' - interval '1 day')::date as m_end
        ) f
        where mp."DigiCom Business" = p_business
          and mp.payout_month is not null
          and left(mp.payout_month, 7) ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    ),
    ads_rows as (  -- overlapFraction sorts its endpoints; end null → start
        select coalesce(ah.amount, 0) as amount,
               least(ah.start_date, coalesce(ah.end_date, ah.start_date))    as s,
               greatest(ah.start_date, coalesce(ah.end_date, ah.start_date)) as e
        from public.ads_history ah
        where ah."DigiCom Business" = p_business
          and ah.start_date is not null
    ),
    cde_rows as (
        select c.entry_date, coalesce(c.spend, 0) as spend
        from public.campaign_daily_entries c
        where c."DigiCom Business" = p_business
          and c.entry_date >= v_from_day and c.entry_date <= v_to_day
    ),
    sums as (
        select
            (select placed_count from placed)    as placed_count,
            (select converted_count from placed) as converted_count,
            (select count(*)::int from fin_orders where is_paid) as revenue_order_count,
            coalesce((select sum(revenue) from fin_orders where is_paid), 0)::numeric as total_revenue,
            coalesce((select sum(cogs) from fin_orders where is_paid), 0)::numeric as total_cogs,
            coalesce((select sum(coalesce(shipping_cost, 0)) from fin_orders where is_paid), 0)::numeric as total_shipping_cost,
            coalesce((select sum(return_fee) from ret), 0)::numeric as total_return_fees,
            coalesce((select sum(amount) from exp_rows), 0)::numeric as total_expenses,
            coalesce((select sum(total_earned) from sde_rows), 0)::numeric as total_seller_salaries,
            coalesce((select sum(total_amount * least(1, greatest(0,
                          (ov_end - ov_start + 1)::numeric / days_in_month)))
                      from mbp_rows where ov_end >= ov_start), 0)::numeric as total_mediabuyer_salaries,
            coalesce((select sum(amount * least(1, greatest(0,
                          (least(e, v_to_day) - greatest(s, v_from_day) + 1)::numeric / (e - s + 1))))
                      from ads_rows where least(e, v_to_day) >= greatest(s, v_from_day)), 0)::numeric as spend_product_ads,
            coalesce((select sum(spend) from cde_rows), 0)::numeric as spend_global_ads,
            (select count(*)::int from fin_orders where is_unpaid) as provisional_count,
            coalesce((select sum(revenue) from fin_orders where is_unpaid), 0)::numeric as provisional_revenue,
            coalesce((select sum(revenue - cogs - coalesce(shipping_cost, 0))
                      from fin_orders where is_unpaid), 0)::numeric as provisional_profit
    ),
    -- per-day trend components (Casablanca days; client re-buckets)
    t_rev as (
        select (delivery_ts at time zone 'Africa/Casablanca')::date as d,
               sum(revenue)::numeric as revenue,
               sum(cogs)::numeric as cogs,
               sum(coalesce(shipping_cost, 0))::numeric as shipping
        from fin_orders where is_paid group by 1
    ),
    t_prov as (
        select (delivery_ts at time zone 'Africa/Casablanca')::date as d,
               sum(revenue - cogs - coalesce(shipping_cost, 0))::numeric as provisional
        from fin_orders where is_unpaid group by 1
    ),
    t_ret as (
        select (updated_at at time zone 'Africa/Casablanca')::date as d,
               sum(return_fee)::numeric as return_fees
        from ret group by 1
    ),
    t_exp as (
        select (date at time zone 'Africa/Casablanca')::date as d,
               sum(amount)::numeric as expenses
        from exp_rows group by 1
    ),
    t_cde as (
        select entry_date as d, sum(spend)::numeric as global_ads from cde_rows group by 1
    ),
    t_sde as (
        select date as d, sum(total_earned)::numeric as seller_salaries from sde_rows group by 1
    ),
    t_adp as (
        select (a.s + g.i)::date as d,
               sum(a.amount / (a.e - a.s + 1))::numeric as product_ads
        from ads_rows a
        cross join lateral generate_series(greatest(a.s, v_from_day) - a.s,
                                           least(a.e, v_to_day) - a.s) g(i)
        group by 1
    ),
    t_mbp as (
        select (m.ov_start + g.i)::date as d,
               sum(m.total_amount / m.days_in_month)::numeric as mb_salaries
        from mbp_rows m
        cross join lateral generate_series(0, m.ov_end - m.ov_start) g(i)
        where m.ov_end >= m.ov_start
        group by 1
    ),
    t_days as (
        select d from t_rev union select d from t_prov union select d from t_ret
        union select d from t_exp union select d from t_cde union select d from t_sde
        union select d from t_adp union select d from t_mbp
    ),
    trend as (
        select td.d,
               coalesce(r.revenue, 0)  as revenue,
               coalesce(r.cogs, 0)     as cogs,
               coalesce(r.shipping, 0) as shipping,
               coalesce(rt.return_fees, 0) as return_fees,
               coalesce(ex.expenses, 0) as expenses,
               coalesce(ap.product_ads, 0) as product_ads,
               coalesce(cd.global_ads, 0) as global_ads,
               coalesce(sd.seller_salaries, 0) as seller_salaries,
               coalesce(mb.mb_salaries, 0) as mb_salaries,
               coalesce(pv.provisional, 0) as provisional
        from t_days td
        left join t_rev r  on r.d = td.d
        left join t_ret rt on rt.d = td.d
        left join t_exp ex on ex.d = td.d
        left join t_adp ap on ap.d = td.d
        left join t_cde cd on cd.d = td.d
        left join t_sde sd on sd.d = td.d
        left join t_mbp mb on mb.d = td.d
        left join t_prov pv on pv.d = td.d
    )
    select jsonb_build_object(
        'placed_count', s.placed_count,
        'converted_count', s.converted_count,
        'revenue_order_count', s.revenue_order_count,
        'total_revenue', s.total_revenue,
        'total_cogs', s.total_cogs,
        'total_shipping_cost', s.total_shipping_cost,
        'total_return_fees', s.total_return_fees,
        'total_expenses', s.total_expenses,
        'total_seller_salaries', s.total_seller_salaries,
        'total_mediabuyer_salaries', s.total_mediabuyer_salaries,
        'spend_product_ads', s.spend_product_ads,
        'spend_global_ads', s.spend_global_ads,
        'all_expenses',
            s.total_cogs + s.total_shipping_cost + s.total_return_fees + s.total_expenses
          + s.total_seller_salaries + s.total_mediabuyer_salaries
          + s.spend_product_ads + s.spend_global_ads,
        'net_profit',
            s.total_revenue - (s.total_cogs + s.total_shipping_cost + s.total_return_fees
          + s.total_expenses + s.total_seller_salaries + s.total_mediabuyer_salaries
          + s.spend_product_ads + s.spend_global_ads),
        'profit_margin', case when s.total_revenue > 0
            then (s.total_revenue - (s.total_cogs + s.total_shipping_cost + s.total_return_fees
                  + s.total_expenses + s.total_seller_salaries + s.total_mediabuyer_salaries
                  + s.spend_product_ads + s.spend_global_ads)) * 100 / s.total_revenue
            else 0 end,
        'roi', case when (s.total_cogs + s.total_shipping_cost + s.total_return_fees
                  + s.total_expenses + s.total_seller_salaries + s.total_mediabuyer_salaries
                  + s.spend_product_ads + s.spend_global_ads) > 0
            then (s.total_revenue - (s.total_cogs + s.total_shipping_cost + s.total_return_fees
                  + s.total_expenses + s.total_seller_salaries + s.total_mediabuyer_salaries
                  + s.spend_product_ads + s.spend_global_ads)) * 100
                 / (s.total_cogs + s.total_shipping_cost + s.total_return_fees
                  + s.total_expenses + s.total_seller_salaries + s.total_mediabuyer_salaries
                  + s.spend_product_ads + s.spend_global_ads)
            else 0 end,
        'provisional_count', s.provisional_count,
        'provisional_revenue', s.provisional_revenue,
        'provisional_profit', s.provisional_profit,
        'expense_by_type', coalesce((
            select jsonb_agg(jsonb_build_object('name', t.type_name, 'amount', t.amount)
                             order by t.amount desc, t.type_name)
            from (select type_name, sum(amount)::numeric as amount from exp_rows group by 1) t
        ), '[]'::jsonb),
        -- all-time trend anchor: earliest placement-or-delivery over the pool
        'earliest_day', (
            select min(least((p.date at time zone 'Africa/Casablanca')::date,
                             (p.delivery_ts at time zone 'Africa/Casablanca')::date))
            from pool p
        ),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'revenue', t.revenue, 'cogs', t.cogs, 'shipping', t.shipping,
                'return_fees', t.return_fees, 'expenses', t.expenses,
                'product_ads', t.product_ads, 'global_ads', t.global_ads,
                'seller_salaries', t.seller_salaries, 'mb_salaries', t.mb_salaries,
                'provisional', t.provisional
            ) order by t.d)
            from trend t
        ), '[]'::jsonb)
    )
    into v_profitability
    from sums s;
    end if;

    if v_all or 'health' = any(p_sections) then
    -- ───────────────────── health (recon 01 §2 / 03 §2) ────────────────────
    -- Pool: replace legs KEPT (rates count real parcels), STRICT placement
    -- window. Revenue re-excludes replace inline and is paid-gated AND
    -- PLACEMENT-windowed/bucketed (deviates from P&L's delivery anchor —
    -- deliberate, recon 01 §2). Rates unclamped. avg_confirm_hours = mean of
    -- max(0, confirmation_date − date) over rows having both. Velocity span:
    -- explicit window → (to − from) + 1; All-Time → min..max placement day
    -- span (+1, min 1); no data → 1.
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    pending_flag as (
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    pool as (
        select o.id, o.date, o.price, o.raw_price, o.shipping_cost,
               o.include_delivery_in_total, o.replace, o.confirmation_date,
               o.order_status_id,
               coalesce(os.pending_confirmation, false) as pending_status,
               coalesce(os.is_cancelled, false)         as cancelled_flag,
               coalesce(os.is_paid, false)              as is_paid,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               coalesce(ps.is_delivered, false)         as is_delivered,
               (t.order_id is not null)                 as has_tracking,
               ((t.order_id is not null)
                 or (pf.ready and o.order_status_id is not null
                     and not coalesce(os.pending_confirmation, false))) as confirmed_calc
        from public.orders o
        cross join pending_flag pf
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    rev as (  -- FULL pureRevenue chain (this section selects items + raw_price)
        select (p.date at time zone 'Africa/Casablanca')::date as d,
               (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                     when coalesce(p.raw_price, 0) > 0 then p.raw_price
                     else case when p.include_delivery_in_total is false
                               then coalesce(p.price, 0)
                               else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end end)
             + (case when p.include_delivery_in_total is true then coalesce(p.shipping_cost, 0) else 0 end)
                 as revenue
        from pool p
        left join lateral (
            select sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                            else coalesce(oi.unit_price, 0) * oi.quantity end)
                       filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum
            from public.order_items oi where oi.order_id = p.id
        ) li on true
        where p.replace is distinct from true and p.is_delivered and p.is_paid
    ),
    agg as (
        select count(*)::int as total,
               (count(*) filter (where confirmed_calc))::int as confirmed,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where cancelled_flag))::int as failed,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback,
               avg(greatest(0, extract(epoch from (confirmation_date - date)) / 3600.0))
                   filter (where confirmation_date is not null) as avg_confirm_hours,
               (count(*) filter (where confirmation_date is not null))::int as confirm_time_count,
               min((date at time zone 'Africa/Casablanca')::date) as min_day,
               max((date at time zone 'Africa/Casablanca')::date) as max_day
        from pool
    ),
    t as (
        select (p.date at time zone 'Africa/Casablanca')::date as d,
               count(*)::int as total,
               (count(*) filter (where confirmed_calc))::int as confirmed,
               (count(*) filter (where is_delivered))::int as delivered,
               ((count(*) filter (where has_tracking))
                 - (count(*) filter (where has_tracking and pullback_flag)))::int as denom
        from pool p group by 1
    ),
    t_rev as (select d, sum(revenue)::numeric as revenue from rev group by 1)
    select jsonb_build_object(
        'total', a.total,
        'confirmed', a.confirmed,
        'delivered', a.delivered,
        'failed', a.failed,
        'confirm_rate', case when a.total > 0 then a.confirmed::numeric * 100 / a.total else 0 end,
        'delivery_denom', a.tracked - a.pullback,
        'delivery_rate', case when (a.tracked - a.pullback) > 0
            then a.delivered::numeric * 100 / (a.tracked - a.pullback) else 0 end,
        'avg_confirm_hours', a.avg_confirm_hours,
        'confirm_time_count', a.confirm_time_count,
        'total_revenue', coalesce((select sum(revenue) from rev), 0),
        'velocity_day_span', case
            when v_has_win then greatest(1, (v_to_day - v_from_day) + 1)
            when a.min_day is not null then greatest(1, (a.max_day - a.min_day) + 1)
            else 1 end,
        'min_day', a.min_day,
        'max_day', a.max_day,
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'total', t.total, 'confirmed', t.confirmed,
                'delivered', t.delivered, 'denom', t.denom,
                'revenue', coalesce(tr.revenue, 0)
            ) order by t.d)
            from t left join t_rev tr on tr.d = t.d
        ), '[]'::jsonb)
    )
    into v_health
    from agg a;
    end if;

    if v_all or 'orders' = any(p_sections) then
    -- ───────────────────── orders (recon 01 §1 / 03 §3) ────────────────────
    -- Pool: replace-excluded, STRICT placement window. avg_order_value = mean
    -- of raw orders.price (customer-paid total — deliberately NOT pureRevenue,
    -- volume metric). Today/This-week chips are WINDOW-INDEPENDENT: computed
    -- over the unwindowed replace-excluded pool (today = Casablanca day;
    -- week = last-7-days timestamp interval, inclusive). Cities: orders with
    -- no master_cities.name are SKIPPED (no 'Unknown' bucket — deviates from
    -- Customers, deliberate). Rates unclamped.
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    pending_flag as (
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    base as (  -- unwindowed (for the absolute chips)
        select o.id, o.date, o.price,
               mc.name as city,
               coalesce(os.pending_confirmation, false) as pending_status,
               coalesce(os.is_cancelled, false)         as cancelled_flag,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               coalesce(ps.is_delivered, false)         as is_delivered,
               (t.order_id is not null)                 as has_tracking,
               ((t.order_id is not null)
                 or (pf.ready and o.order_status_id is not null
                     and not coalesce(os.pending_confirmation, false))) as confirmed_calc
        from public.orders o
        cross join pending_flag pf
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join public.master_cities mc on mc.id = o.master_city_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
    ),
    pool as (
        select * from base
        where date is not null
          and (v_start is null or date >= v_start)
          and (case when v_end_excl is not null then date < v_end_excl else date <= v_now end)
    ),
    agg as (
        select count(*)::int as total,
               (count(*) filter (where confirmed_calc))::int as confirmed,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where cancelled_flag))::int as failed,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback,
               coalesce(sum(coalesce(price, 0)), 0)::numeric as price_sum
        from pool
    ),
    chips as (
        select (count(*) filter (where date is not null
                    and (date at time zone 'Africa/Casablanca')::date = v_today))::int as today_orders,
               (count(*) filter (where date is not null
                    and date >= v_now - interval '7 days' and date <= v_now))::int as week_orders
        from base
    ),
    cities as (
        select city, count(*)::int as n
        from pool
        where city is not null and city <> ''
        group by city
        order by n desc, city
        limit 10
    ),
    t as (
        select (date at time zone 'Africa/Casablanca')::date as d, count(*)::int as n
        from pool group by 1
    )
    select jsonb_build_object(
        'total', a.total,
        'confirmed', a.confirmed,
        'delivered', a.delivered,
        'failed', a.failed,
        'confirm_rate', case when a.total > 0 then a.confirmed::numeric * 100 / a.total else 0 end,
        'delivery_denom', a.tracked - a.pullback,
        'delivery_rate', case when (a.tracked - a.pullback) > 0
            then a.delivered::numeric * 100 / (a.tracked - a.pullback) else 0 end,
        'failed_rate', case when a.total > 0 then a.failed::numeric * 100 / a.total else 0 end,
        'avg_order_value', case when a.total > 0 then a.price_sum / a.total else 0 end,
        'today_orders', c.today_orders,
        'week_orders', c.week_orders,
        'top_cities', coalesce((
            select jsonb_agg(jsonb_build_object('city', city, 'count', n))
            from cities), '[]'::jsonb),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object('d', d, 'orders', n) order by d)
            from t), '[]'::jsonb)
    )
    into v_orders
    from agg a, chips c;
    end if;

    if v_all or 'ads' = any(p_sections) then
    -- ───────────────────── ads (recon 02 §3 / 03 §4) ───────────────────────
    -- Two spend sources: ads_history pro-rated by inclusive-day overlap;
    -- campaign_daily_entries by entry_date. Attribution ports the client
    -- matchers exactly: product ad = normalized-source equality (empty never
    -- matches) + placement within ad-range ∩ user window + (product_id set ⇒
    -- order carries that product); global entry = normalized-source equality
    -- + placement day = entry_date (Casablanca — the client compared the raw
    -- UTC string slice; accepted D3 delta). Orders deduped GLOBALLY for the
    -- top-line; per-platform buckets dedupe within the bucket only (an order
    -- CAN appear under two platforms — replicated). Platform key = RAW
    -- method/platform string ('Other' when empty). Revenue = the AdsSection
    -- collapsed chain (see header). ads_history_metrics is NOT reused (5
    -- semantic gaps, recon 02 §3).
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    pending_flag as (
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    pool as (  -- all-time replace-excluded; the matchers confine to the window
        select o.id, o.date, o.price, o.shipping_cost, o.order_status_id,
               public.normalize_ad_source(o.source_name) as src,
               (o.date at time zone 'Africa/Casablanca')::date as place_day,
               coalesce(os.pending_confirmation, false) as pending_status,
               coalesce(ps.is_delivered, false)         as is_delivered,
               (t.order_id is not null)                 as has_tracking,
               pf.ready
        from public.orders o
        cross join pending_flag pf
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and o.date is not null
    ),
    ads_win as (  -- kept when range (sorted, end null → start) touches the window
        select ah.id, ah.product_id, coalesce(ah.amount, 0) as amount,
               ah.start_date, ah.end_date,
               coalesce(nullif(ah.method, ''), 'Other') as platform,
               public.normalize_ad_source(ah.method) as src,
               least(ah.start_date, coalesce(ah.end_date, ah.start_date))    as s,
               greatest(ah.start_date, coalesce(ah.end_date, ah.start_date)) as e
        from public.ads_history ah
        where ah."DigiCom Business" = p_business
          and ah.start_date is not null
          and least(ah.start_date, coalesce(ah.end_date, ah.start_date)) <= v_to_day
          and greatest(ah.start_date, coalesce(ah.end_date, ah.start_date)) >= v_from_day
    ),
    ads_attr as (  -- attribution-capable ads: end_date set + non-empty match interval
        select * from ads_win
        where end_date is not null
          and greatest(start_date, v_from_day) <= least(end_date, v_to_day)
    ),
    entries_win as (
        select c.id, c.campaign_id, coalesce(c.spend, 0) as spend, c.entry_date,
               coalesce(nullif(c.platform, ''), 'Other') as platform,
               public.normalize_ad_source(c.platform) as src
        from public.campaign_daily_entries c
        where c."DigiCom Business" = p_business
          and c.entry_date >= v_from_day and c.entry_date <= v_to_day
    ),
    prod_pairs as (  -- (platform, order) matched via a product ad
        select distinct a.platform, o.id
        from ads_attr a
        join pool o on a.src <> '' and o.src = a.src
          and o.date >= greatest(a.start_date::timestamp at time zone 'Africa/Casablanca',
                                 coalesce(v_start, '-infinity'::timestamptz))
          and o.date < ((a.end_date + 1)::timestamp at time zone 'Africa/Casablanca')
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
        where a.product_id is null
           or exists (select 1 from public.order_items oi
                      where oi.order_id = o.id and oi.product_id = a.product_id)
    ),
    glob_pairs as (  -- (platform, order) matched via a campaign entry
        select distinct e.platform, o.id
        from entries_win e
        join pool o on e.src <> '' and o.src = e.src and o.place_day = e.entry_date
    ),
    matched as (
        select id from prod_pairs union select id from glob_pairs
    ),
    mo as (  -- matched orders + flags + AdsSection collapsed revenue
        select p.id, p.place_day, p.is_delivered,
               (p.has_tracking or (p.ready and p.order_status_id is not null
                                   and not p.pending_status)) as confirmed_calc,
               case when p.is_delivered then
                   (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                         else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end)
               else 0 end as revenue
        from pool p
        join matched m on m.id = p.id
        left join lateral (
            select sum(coalesce(oi.unit_price, 0) * oi.quantity)
                       filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum
            from public.order_items oi where oi.order_id = p.id
        ) li on true
    ),
    top_line as (
        select count(*)::int as total_orders,
               (count(*) filter (where confirmed_calc))::int as total_confirmed,
               (count(*) filter (where is_delivered))::int as total_delivered,
               coalesce(sum(revenue), 0)::numeric as total_gross_revenue
        from mo
    ),
    spend_line as (
        select coalesce((select sum(a.amount * least(1, greatest(0,
                    (least(a.e, v_to_day) - greatest(a.s, v_from_day) + 1)::numeric / (a.e - a.s + 1))))
                from ads_win a), 0)::numeric as spend_product_ads,
               coalesce((select sum(spend) from entries_win), 0)::numeric as spend_global_ads,
               (select count(*)::int from ads_win) as product_campaign_count,
               (select count(distinct campaign_id)::int from entries_win
                where campaign_id is not null) as global_campaign_count
    ),
    plat_ads as (  -- platform spend/count: attribution-capable ads only (client early-return)
        select platform,
               sum(amount * least(1, greatest(0,
                   (least(e, v_to_day) - greatest(s, v_from_day) + 1)::numeric / (e - s + 1))))::numeric as spend,
               count(*)::int as product_count
        from ads_attr group by 1
    ),
    plat_entries as (
        select platform, sum(spend)::numeric as spend from entries_win group by 1
    ),
    plat_campaigns as (  -- deterministic: campaign → platform of its earliest windowed entry
        select platform, count(*)::int as global_count
        from (
            select distinct on (campaign_id) campaign_id, platform
            from entries_win where campaign_id is not null
            order by campaign_id, entry_date, id
        ) x group by 1
    ),
    plat_pairs as (
        select platform, id from prod_pairs union select platform, id from glob_pairs
    ),
    plat_orders as (
        select pr.platform,
               count(*)::int as orders,
               (count(*) filter (where mo.is_delivered))::int as delivered,
               coalesce(sum(mo.revenue), 0)::numeric as revenue
        from plat_pairs pr join mo on mo.id = pr.id
        group by pr.platform
    ),
    plat_keys as (
        select platform from plat_ads union select platform from plat_entries
        union select platform from plat_orders
    ),
    platforms as (
        select k.platform,
               coalesce(pa.spend, 0) + coalesce(pe.spend, 0) as spend,
               coalesce(po.orders, 0) as orders,
               coalesce(po.delivered, 0) as delivered,
               coalesce(po.revenue, 0) as revenue,
               coalesce(pa.product_count, 0) as product_count,
               coalesce(pc.global_count, 0) as global_count
        from plat_keys k
        left join plat_ads pa on pa.platform = k.platform
        left join plat_entries pe on pe.platform = k.platform
        left join plat_campaigns pc on pc.platform = k.platform
        left join plat_orders po on po.platform = k.platform
    ),
    t_ads as (  -- per-day product-ad spend: amount/total_days on each covered day
        select (a.s + g.i)::date as d,
               sum(a.amount / (a.e - a.s + 1))::numeric as spend
        from ads_win a
        cross join lateral generate_series(greatest(a.s, v_from_day) - a.s,
                                           least(a.e, v_to_day) - a.s) g(i)
        group by 1
    ),
    t_entries as (
        select entry_date as d, sum(spend)::numeric as spend from entries_win group by 1
    ),
    t_rev as (  -- per-day deduped delivered revenue (order lands on its placement day)
        select place_day as d, sum(revenue)::numeric as revenue
        from mo where is_delivered group by 1
    ),
    t_days as (
        select d from t_ads union select d from t_entries union select d from t_rev
    ),
    trend as (
        select td.d,
               coalesce(ta.spend, 0) + coalesce(te.spend, 0) as spend,
               coalesce(tr.revenue, 0) as revenue
        from t_days td
        left join t_ads ta on ta.d = td.d
        left join t_entries te on te.d = td.d
        left join t_rev tr on tr.d = td.d
    )
    select jsonb_build_object(
        'spend_product_ads', s.spend_product_ads,
        'spend_global_ads', s.spend_global_ads,
        'product_campaign_count', s.product_campaign_count,
        'global_campaign_count', s.global_campaign_count,
        'total_orders', tl.total_orders,
        'total_confirmed', tl.total_confirmed,
        'total_delivered', tl.total_delivered,
        'total_gross_revenue', tl.total_gross_revenue,
        'platforms', coalesce((
            select jsonb_agg(jsonb_build_object(
                'platform', p.platform, 'spend', p.spend, 'orders', p.orders,
                'delivered', p.delivered, 'revenue', p.revenue,
                'product_count', p.product_count, 'global_count', p.global_count
            ) order by p.spend desc, p.platform)
            from platforms p
        ), '[]'::jsonb),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'spend', t.spend, 'revenue', t.revenue
            ) order by t.d)
            from trend t
        ), '[]'::jsonb)
    )
    into v_ads
    from spend_line s, top_line tl;
    end if;

    if v_all or 'shipping' = any(p_sections) then
    -- ───────────────────── shipping (recon 01 §3 / 03 §5) ──────────────────
    -- Pool: NO replace exclusion (real parcels), STRICT placement window.
    -- shipped = tracked set (NOT lifecycle statuses — deviates from the D2
    -- dashboard pipeline, deliberate). delivered/returned counted over the
    -- FULL filtered pool (not just shipped). Rate = delivered ÷ (shipped −
    -- pullback), UNCLAMPED. Shipping cost = Σ shipping_cost over delivered.
    -- Stuck measured vs NOW (> 5 days since placement). Fulfillers over ALL
    -- assigned (company precedence); names/logos stay client-side.
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    pool as (
        select o.id, o.date, o.shipping_cost, o.company_id, o.courier_id,
               coalesce(o.date_livraison, o.updated_at) as delivery_ts,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(ps.is_returned, false)  as is_returned,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking
        from public.orders o
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    agg as (
        select
            (count(*) filter (where has_tracking))::int as total_shipments,
            (count(*) filter (where is_delivered))::int as delivered,
            (count(*) filter (where is_returned))::int as returned,
            ((count(*) filter (where has_tracking))
              - (count(*) filter (where has_tracking and pullback_flag)))::int as denom,
            coalesce(sum(coalesce(shipping_cost, 0)) filter (where is_delivered), 0)::numeric as shipping_cost,
            coalesce(avg(trunc(extract(epoch from (delivery_ts - date)) / 86400.0))
                filter (where is_delivered and delivery_ts is not null), 0)::numeric as avg_delivery_days,
            (count(*) filter (where has_tracking and not is_delivered and not is_returned
                and trunc(extract(epoch from (v_now - date)) / 86400.0) > 5))::int as stuck_count
        from pool
    ),
    ful as (
        select coalesce(company_id, courier_id) as fid,
               case when company_id is not null then 'provider' else 'courier' end as kind,
               count(*)::int as total,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback
        from pool
        where company_id is not null or courier_id is not null
        group by 1, 2
    ),
    t as (
        select (date at time zone 'Africa/Casablanca')::date as d,
               count(*)::int as shipped,
               (count(*) filter (where is_delivered))::int as delivered,
               coalesce(sum(coalesce(shipping_cost, 0)) filter (where is_delivered), 0)::numeric as cost
        from pool where has_tracking group by 1
    )
    select jsonb_build_object(
        'total_shipments', a.total_shipments,
        'delivered', a.delivered,
        'returned', a.returned,
        'delivery_denom', a.denom,
        'delivery_rate', case when a.denom > 0
            then a.delivered::numeric * 100 / a.denom else 0 end,
        'return_rate', case when a.total_shipments > 0
            then a.returned::numeric * 100 / a.total_shipments else 0 end,
        'total_shipping_cost', a.shipping_cost,
        'avg_delivery_days', a.avg_delivery_days,
        'stuck_count', a.stuck_count,
        'fulfillers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', f.fid, 'kind', f.kind, 'total', f.total, 'delivered', f.delivered,
                'tracked', f.tracked, 'pullback', f.pullback
            ) order by f.total desc, f.fid)
            from ful f
        ), '[]'::jsonb),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'shipped', t.shipped, 'delivered', t.delivered, 'cost', t.cost
            ) order by t.d)
            from t
        ), '[]'::jsonb)
    )
    into v_shipping
    from agg a;
    end if;

    if v_all or 'inventory' = any(p_sections) then
    -- ───────────────────── inventory (recon 02 §2 / 03 §6) ─────────────────
    -- Catalog scalars + per-item low-stock rows (stock < 10 STRICT AND active
    -- — NOT catalog_totals' <= 10, threshold drift replicated on the client
    -- side of the drift). "Sold": order_items ↔ parent orders windowed on
    -- placement (All-Time passes NULL dates, explicit excludes), replace legs
    -- skipped per-item, delivered-category strict, product must still exist;
    -- revenue = qty × unit_price ONLY (no total_price preference, no
    -- fallbacks); COGS snapshot-preferred. Parent-order predicate gap
    -- (date_deleted / source_review_status NOT applied) REPLICATED — see
    -- header. Transactions windowed by t.date; unpaid = Σtotal − Σpaid
    -- (aggregate diff, may go negative on overpayment — deliberately NOT
    -- transactions_totals' per-row clamp).
    with prod as (
        select id, name, code, image_url,
               coalesce(stock, 0) as stock,
               coalesce(cost_price, 0) as cost_price,
               coalesce(selling_price, 0) as selling_price,
               coalesce(active, false) as active
        from public.products where "DigiCom Business" = p_business
    ),
    acc as (
        select id, name, code,
               coalesce(stock, 0) as stock,
               coalesce(cost_price, 0) as cost_price,
               coalesce(active, false) as active
        from public.accessories where "DigiCom Business" = p_business
    ),
    sold as (
        select oi.product_id,
               sum(coalesce(oi.quantity, 0))::numeric as sold,
               sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_price, 0))::numeric as revenue,
               sum(coalesce(oi.quantity, 0)
                   * (case when coalesce(oi.product_unit_cost_snapshot, 0) > 0
                           then oi.product_unit_cost_snapshot
                           else p.cost_price end))::numeric as cost
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join prod p on p.id = oi.product_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        where oi."DigiCom Business" = p_business
          and o.replace is distinct from true
          and coalesce(ps.is_delivered, false)
          and ((not v_has_win) or (o.date is not null
                and (v_start is null or o.date >= v_start)
                and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)))
        group by oi.product_id
    ),
    tx as (
        select coalesce(sum(coalesce(total_price, 0)), 0)::numeric as value,
               coalesce(sum(coalesce(paid_price, 0)), 0)::numeric as paid
        from public.transactions t
        where t."DigiCom Business" = p_business
          and ((not v_has_win) or (t.date is not null
                and (p_from is null or t.date >= p_from)
                and t.date <= v_to_day))
    )
    select jsonb_build_object(
        'total_products', (select count(*)::int from prod),
        'active_products', (select count(*)::int from prod where active),
        'total_accessories', (select count(*)::int from acc),
        'stock_value_at_cost',
            coalesce((select sum(stock * cost_price) from prod), 0)::numeric
          + coalesce((select sum(stock * cost_price) from acc), 0)::numeric,
        'stock_value_at_selling',
            coalesce((select sum(stock * selling_price) from prod), 0)::numeric,
        'low_stock', coalesce((
            select jsonb_agg(jsonb_build_object(
                'kind', r.kind, 'id', r.id, 'name', r.name,
                'stock', r.stock, 'cost_price', r.cost_price
            ) order by r.stock asc, r.kind desc, r.name)
            from (
                select 'product' as kind, id, name, stock, cost_price
                from prod where stock < 10 and active
                union all
                select 'accessory', id, name, stock, cost_price
                from acc where stock < 10 and active
            ) r
        ), '[]'::jsonb),
        'units_sold', coalesce((select sum(sold) from sold), 0)::numeric,
        'product_sales', coalesce((
            select jsonb_agg(jsonb_build_object(
                'product_id', s.product_id, 'name', p.name, 'image_url', p.image_url,
                'sold', s.sold, 'revenue', s.revenue, 'cost', s.cost
            ) order by s.sold desc, p.name, s.product_id)
            from sold s join prod p on p.id = s.product_id
        ), '[]'::jsonb),
        'transactions_value', (select value from tx),
        'transactions_paid', (select paid from tx),
        'unpaid_amount', (select value - paid from tx)
    )
    into v_inventory;
    end if;

    if v_all or 'channels' = any(p_sections) then
    -- ───────────────────── channels (recon 01 §5 / 03 §7) ──────────────────
    -- Pool: replace-excluded, STRICT placement window. Channel key =
    -- normalize_ad_source(source_name || sales_channels[source_id].name),
    -- empty raw → 'direct' (whitespace-only raw keeps its '' key — client
    -- quirk replicated). converted = paid+delivered; revenue = FULL
    -- pureRevenue chain over converted. Trend = per-day counts for the top-5
    -- channels by window orders (server ranks — top-5 is window-dependent).
    with pool as (
        select o.id, o.price, o.raw_price, o.shipping_cost, o.include_delivery_in_total,
               (o.date at time zone 'Africa/Casablanca')::date as place_day,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(os.is_paid, false)      as is_paid,
               case when coalesce(nullif(o.source_name, ''), nullif(sc.name, ''), '') = ''
                    then 'direct'
                    else public.normalize_ad_source(coalesce(nullif(o.source_name, ''), nullif(sc.name, ''))) end
                   as ckey
        from public.orders o
        left join public.sales_channels sc
          on sc.id = o.source_id and sc."DigiCom Business" = p_business
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    conv as (
        select p.ckey,
               (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                     when coalesce(p.raw_price, 0) > 0 then p.raw_price
                     else case when p.include_delivery_in_total is false
                               then coalesce(p.price, 0)
                               else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end end)
             + (case when p.include_delivery_in_total is true then coalesce(p.shipping_cost, 0) else 0 end)
                 as revenue
        from pool p
        left join lateral (
            select sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                            else coalesce(oi.unit_price, 0) * oi.quantity end)
                       filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum
            from public.order_items oi where oi.order_id = p.id
        ) li on true
        where p.is_delivered and p.is_paid
    ),
    per_channel as (
        select p.ckey,
               count(*)::int as orders,
               coalesce(c.converted, 0)::int as converted,
               coalesce(c.revenue, 0)::numeric as revenue
        from (select ckey, count(*)::int as cnt from pool group by 1) x
        join lateral (select x.ckey) p on true
        left join lateral (
            select count(*)::int as converted, coalesce(sum(revenue), 0)::numeric as revenue
            from conv where conv.ckey = x.ckey
        ) c on true
        cross join lateral (select x.cnt as cnt2) y
        group by p.ckey, c.converted, c.revenue, x.cnt
        -- (structural no-op grouping; orders taken from the pre-count)
        , x.ckey
        having x.ckey = p.ckey
    ),
    channels as (
        select oc.ckey, oc.orders, coalesce(cv.converted, 0) as converted,
               coalesce(cv.revenue, 0) as revenue
        from (select ckey, count(*)::int as orders from pool group by 1) oc
        left join (select ckey, count(*)::int as converted,
                          coalesce(sum(revenue), 0)::numeric as revenue
                   from conv group by 1) cv on cv.ckey = oc.ckey
    ),
    top5 as (
        select ckey from channels order by orders desc, ckey limit 5
    ),
    t as (
        select p.place_day as d, p.ckey, count(*)::int as orders
        from pool p
        where p.ckey in (select ckey from top5)
        group by 1, 2
    )
    select jsonb_build_object(
        'total_orders', (select count(*)::int from pool),
        'channels', coalesce((
            select jsonb_agg(jsonb_build_object(
                'key', c.ckey, 'orders', c.orders, 'converted', c.converted, 'revenue', c.revenue
            ) order by c.orders desc, c.ckey)
            from channels c
        ), '[]'::jsonb),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'key', t.ckey, 'orders', t.orders
            ) order by t.d, t.ckey)
            from t
        ), '[]'::jsonb)
    )
    into v_channels;
    end if;

    if v_all or 'customers' = any(p_sections) then
    -- ───────────────────── customers (recon 01 §4 / 03 §8) ─────────────────
    -- Pool: replace-excluded. Customer key = normalize_phone_for_customer
    -- (live fn, verified byte-identical to the client normalizePhone; NULL =
    -- skipped). "Seen before" scans the FULL history (< window start) — the
    -- reason the section can't be windowed naively. Revenue = the LIVE
    -- collapsed formula greatest(0, price) on paid+delivered (see header).
    -- Cities over ALL windowed orders (incl. phone-less), 'Unknown city'
    -- bucket, top 8. Trend: per-day distinct customers, new on their first
    -- in-window day when not seen before (day-buckets re-group cleanly).
    with base as (
        select o.id, o.date, o.price,
               public.normalize_phone_for_customer(o.phone) as ckey,
               (o.date at time zone 'Africa/Casablanca')::date as place_day,
               mc.name as city_raw,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(os.is_paid, false)      as is_paid
        from public.orders o
        left join public.master_cities mc on mc.id = o.master_city_id
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
    ),
    seen_before as (
        select distinct ckey from base
        where ckey is not null
          and v_start is not null
          and date is not null and date < v_start
    ),
    pool as (
        select * from base
        where date is not null
          and (v_start is null or date >= v_start)
          and (case when v_end_excl is not null then date < v_end_excl else date <= v_now end)
    ),
    cust as (
        select ckey,
               count(*)::int as orders,
               coalesce(sum(greatest(0, coalesce(price, 0)))
                   filter (where is_delivered and is_paid), 0)::numeric as revenue
        from pool where ckey is not null
        group by ckey
    ),
    hdr as (
        select count(*)::int as total_customers,
               (count(*) filter (where c.orders > 1))::int as repeat_customers,
               coalesce(sum(c.orders), 0)::numeric as orders_sum,
               coalesce(sum(c.revenue), 0)::numeric as revenue_sum,
               (count(*) filter (where sb.ckey is null))::int as new_customers
        from cust c
        left join seen_before sb on sb.ckey = c.ckey
    ),
    cities as (
        select coalesce(nullif(btrim(city_raw), ''), 'Unknown city') as city,
               count(*)::int as n
        from pool
        group by 1
        order by n desc, city
        limit 8
    ),
    cust_days as (
        select ckey, place_day as d from pool where ckey is not null group by 1, 2
    ),
    firsts as (
        select ckey, min(d) as first_d from cust_days group by 1
    ),
    -- D3 REVIEW FIX — the server owns the grain. A distinct-customer count is
    -- NOT additive across days: summing day rows into a week/month re-counts a
    -- customer once per extra order-day (measured up to 2x on the returning
    -- band). No client-side re-bucketing can recover bucket-level distinctness,
    -- so one PRE-DEDUPED series is emitted per client grain (ladder: <=31d
    -- daily, <=120d weekly Monday-start, else monthly). Within a bucket each
    -- customer counts ONCE: `new` iff not seen before the window AND the bucket
    -- holds their first in-window day, else `returning` — exactly the old
    -- client's forward walk + cumulative seen-set (git HEAD CustomersSection
    -- `bucketCustomers`). date_trunc('week') is Monday-start = date-fns
    -- startOfWeek({weekStartsOn:1}). Buckets need no window clamping: cust_days
    -- only holds in-window days, so a partial week/month aggregates in-window
    -- days only.
    t as (
        select cd.d,
               (count(*) filter (where f.first_d = cd.d and sb.ckey is null))::int as new,
               (count(*) filter (where not (f.first_d = cd.d and sb.ckey is null)))::int as returning
        from cust_days cd
        join firsts f on f.ckey = cd.ckey
        left join seen_before sb on sb.ckey = cd.ckey
        group by cd.d
    ),
    cust_weeks as (
        select ckey, date_trunc('week', d)::date as b from cust_days group by 1, 2
    ),
    t_week as (
        select cw.b,
               (count(*) filter (where date_trunc('week', f.first_d)::date = cw.b
                                   and sb.ckey is null))::int as new,
               (count(*) filter (where not (date_trunc('week', f.first_d)::date = cw.b
                                        and sb.ckey is null)))::int as returning
        from cust_weeks cw
        join firsts f on f.ckey = cw.ckey
        left join seen_before sb on sb.ckey = cw.ckey
        group by cw.b
    ),
    cust_months as (
        select ckey, date_trunc('month', d)::date as b from cust_days group by 1, 2
    ),
    t_month as (
        select cm.b,
               (count(*) filter (where date_trunc('month', f.first_d)::date = cm.b
                                   and sb.ckey is null))::int as new,
               (count(*) filter (where not (date_trunc('month', f.first_d)::date = cm.b
                                        and sb.ckey is null)))::int as returning
        from cust_months cm
        join firsts f on f.ckey = cm.ckey
        left join seen_before sb on sb.ckey = cm.ckey
        group by cm.b
    )
    select jsonb_build_object(
        'total_customers', h.total_customers,
        'repeat_customers', h.repeat_customers,
        'repeat_rate', case when h.total_customers > 0
            then h.repeat_customers::numeric * 100 / h.total_customers else 0 end,
        'new_customers', h.new_customers,
        'returning_customers', h.total_customers - h.new_customers,
        'avg_orders_per_customer', case when h.total_customers > 0
            then h.orders_sum / h.total_customers else 0 end,
        'avg_customer_value', case when h.total_customers > 0
            then h.revenue_sum / h.total_customers else 0 end,
        'total_customer_revenue', h.revenue_sum,
        'top_cities', coalesce((
            select jsonb_agg(jsonb_build_object('city', city, 'count', n))
            from cities), '[]'::jsonb),
        'trend', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t.d, 'new', t.new, 'returning', t.returning
            ) order by t.d)
            from t), '[]'::jsonb),
        'trend_week', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t_week.b, 'new', t_week.new, 'returning', t_week.returning
            ) order by t_week.b)
            from t_week), '[]'::jsonb),
        'trend_month', coalesce((
            select jsonb_agg(jsonb_build_object(
                'd', t_month.b, 'new', t_month.new, 'returning', t_month.returning
            ) order by t_month.b)
            from t_month), '[]'::jsonb)
    )
    into v_customers
    from hdr h;
    end if;

    if v_all or 'sellers' = any(p_sections) then
    -- ───────────────────── sellers (recon 02 §4 / 03 §9) ───────────────────
    -- Volume anchor = placement (replace-excluded pool, STRICT window);
    -- commission anchor = seller_daily_earnings.date (view = source of truth,
    -- never re-derived). Paid = Σ paid_amount over ALL payout rows (lifetime,
    -- partials counted); Pending = Σ max(0, total − paid) over
    -- period_state='open' rows ONLY (rolling ledger). Attendance = presences
    -- in window ÷ (active sellers × Mon–Sat working days; explicit window
    -- needs BOTH bounds, otherwise earliest-presence → today). Per-seller
    -- success rate = deliveredAny ÷ (tracked − pullback), UNCLAMPED, with the
    -- numerator over ALL own orders (recon 02 §4 deviation, replicated).
    -- Rows for the whole roster (client renders top-10 AFTER totals).
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    roster as (
        select u.id, u.name, coalesce(u.active, false) as active
        from public.users u
        where u."DigiCom Business" = p_business and u.role = 'commercial'
    ),
    pool as (
        select o.id, o.seller_id, o.price, o.raw_price, o.shipping_cost,
               o.include_delivery_in_total,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(os.is_paid, false)      as is_paid,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking
        from public.orders o
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    counts as (
        select p.seller_id,
               count(*)::int as orders,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where is_delivered and is_paid))::int as delivered_paid,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback
        from pool p group by 1
    ),
    fin as (  -- FULL pureRevenue chain over paid+delivered own orders
        select p.seller_id,
               sum(
                   (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                         when coalesce(p.raw_price, 0) > 0 then p.raw_price
                         else case when p.include_delivery_in_total is false
                                   then coalesce(p.price, 0)
                                   else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end end)
                 + (case when p.include_delivery_in_total is true then coalesce(p.shipping_cost, 0) else 0 end)
               )::numeric as revenue
        from pool p
        left join lateral (
            select sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                            else coalesce(oi.unit_price, 0) * oi.quantity end)
                       filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum
            from public.order_items oi where oi.order_id = p.id
        ) li on true
        where p.is_delivered and p.is_paid
        group by 1
    ),
    comm as (
        select sde.seller_id, sum(coalesce(sde.commission_earned, 0))::numeric as commission
        from public.seller_daily_earnings sde
        where sde."DigiCom Business" = p_business
          and sde.date is not null
          and sde.date >= v_from_day and sde.date <= v_to_day
        group by 1
    ),
    pres as (
        select sp.seller_id, count(*)::int as n
        from public.seller_presences sp
        where sp."DigiCom Business" = p_business
          and sp.date is not null
          and sp.date >= v_from_day and sp.date <= v_to_day
        group by 1
    ),
    pay as (
        select coalesce(sum(coalesce(paid_amount, 0)), 0)::numeric as paid,
               coalesce(sum(greatest(0, coalesce(total_amount, 0) - coalesce(paid_amount, 0)))
                   filter (where period_state = 'open'), 0)::numeric as pending
        from public.seller_payments sp
        where sp."DigiCom Business" = p_business
    ),
    pres_min as (
        select min(sp.date) as d0
        from public.seller_presences sp
        where sp."DigiCom Business" = p_business and sp.date is not null
    ),
    wd as (
        select case
            when p_from is not null and p_to is not null then
                (select count(*)::int
                 from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
                 where extract(dow from g) <> 0)
            when (select d0 from pres_min) is not null then
                (select count(*)::int
                 from generate_series((select d0 from pres_min)::timestamp,
                                      v_today::timestamp, interval '1 day') g
                 where extract(dow from g) <> 0)
            else 0 end as working_days
    )
    select jsonb_build_object(
        'total_sellers', (select count(*)::int from roster),
        'active_sellers', (select count(*)::int from roster where active),
        'total_commission', coalesce((
            select sum(c.commission) from roster r join comm c on c.seller_id = r.id), 0)::numeric,
        'total_paid', (select paid from pay),
        'total_pending', (select pending from pay),
        'presence_total', coalesce((select sum(n) from pres), 0)::int,
        'working_days', (select working_days from wd),
        'attendance_rate', case
            when (select count(*) from roster where active) * (select working_days from wd) > 0
            then coalesce((select sum(n) from pres), 0)::numeric * 100
                 / ((select count(*) from roster where active) * (select working_days from wd))
            else 0 end,
        'sellers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'seller_id', r.id,
                'orders', coalesce(ct.orders, 0),
                'delivered', coalesce(ct.delivered, 0),
                'delivered_paid', coalesce(ct.delivered_paid, 0),
                'tracked', coalesce(ct.tracked, 0),
                'pullback', coalesce(ct.pullback, 0),
                'revenue', coalesce(f.revenue, 0),
                'presences', coalesce(pr.n, 0),
                'commission', coalesce(c.commission, 0)
            ) order by coalesce(ct.delivered, 0) desc, r.name, r.id)
            from roster r
            left join counts ct on ct.seller_id = r.id
            left join fin f on f.seller_id = r.id
            left join comm c on c.seller_id = r.id
            left join pres pr on pr.seller_id = r.id
        ), '[]'::jsonb)
    )
    into v_sellers;
    end if;

    if v_all or 'couriers' = any(p_sections) then
    -- ───────────────────── couriers (recon 02 §5 / 03 §10) ─────────────────
    -- Pool: courier-assigned orders ONLY (courier_id IS NOT NULL), NO replace
    -- exclusion, STRICT placement window. Pending payouts LIFETIME = Σ
    -- total_shipping_fees where status <> 'paid' (NULL status counts unpaid —
    -- deliberately NOT payment_notes_unpaid_total's net_amount/'unpaid').
    -- total_pending sums ALL couriers in the notes (roster or not) — client
    -- parity. Per-courier rows for the roster; rates unclamped, derived
    -- client-side from denom columns.
    with tracked as (
        select cp.order_id
        from public.company_parcels cp
        where cp."DigiCom Business" = p_business
          and cp.order_id is not null
          and nullif(btrim(cp.tracking_code), '') is not null
        union
        select crp.order_id
        from public.courier_parcels crp
        where crp."DigiCom Business" = p_business
          and crp.order_id is not null
          and nullif(btrim(crp.tracking_code), '') is not null
    ),
    roster as (
        select u.id, u.name, (u.active is distinct from false) as active_calc
        from public.users u
        where u."DigiCom Business" = p_business and u.role = 'courier'
    ),
    pool as (
        select o.id, o.courier_id,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(ps.is_returned, false)  as is_returned,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking
        from public.orders o
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.courier_id is not null
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    notes as (
        select n.courier_id,
               coalesce(sum(coalesce(n.total_shipping_fees, 0)), 0)::numeric as pending
        from public.courier_payment_notes n
        where n."DigiCom Business" = p_business
          and n.courier_id is not null
          and n.status is distinct from 'paid'
        group by 1
    ),
    per as (
        select p.courier_id,
               count(*)::int as total,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where is_returned))::int as returned
        from pool p group by 1
    ),
    hdr as (
        select count(*)::int as total_shipments,
               ((count(*) filter (where has_tracking))
                 - (count(*) filter (where has_tracking and pullback_flag)))::int as denom,
               (count(*) filter (where is_delivered))::int as delivered
        from pool
    )
    select jsonb_build_object(
        'total_couriers', (select count(*)::int from roster),
        'active_couriers', (select count(*)::int from roster where active_calc),
        'total_shipments', h.total_shipments,
        'overall_denom', h.denom,
        'total_delivered', h.delivered,
        'overall_rate', case when h.denom > 0
            then h.delivered::numeric * 100 / h.denom else 0 end,
        'total_pending', coalesce((select sum(pending) from notes), 0)::numeric,
        'couriers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'courier_id', r.id,
                'total', coalesce(p.total, 0),
                'tracked', coalesce(p.tracked, 0),
                'pullback', coalesce(p.pullback, 0),
                'denom', coalesce(p.tracked, 0) - coalesce(p.pullback, 0),
                'delivered', coalesce(p.delivered, 0),
                'returned', coalesce(p.returned, 0),
                'pending', coalesce(n.pending, 0)
            ) order by coalesce(p.delivered, 0) desc, r.name, r.id)
            from roster r
            left join per p on p.courier_id = r.id
            left join notes n on n.courier_id = r.id
        ), '[]'::jsonb)
    )
    into v_couriers
    from hdr h;
    end if;

    if v_all or 'mediabuyers' = any(p_sections) then
    -- ───────────────────── mediabuyers (recon 02 §6 / 03 §11) ──────────────
    -- Admin-facing full-money surface. Buckets keyed (Casablanca placement
    -- day, normalized source) over windowed replace-excluded orders with a
    -- non-empty source; per bucket: leads, delivered, revenue (FULL chain,
    -- delivered — NOT paid-gated), COGS (product part = CURRENT cost_price
    -- ONLY — no snapshot, replicated deviation; accessory part snapshot-else-
    -- current), shipping, seller commission (STRICT per_unit: empty
    -- users.products ⇒ 0). Attribution key = campaign_daily_entries.created_by
    -- (standing rule); a (day, platform) bucket claimed by N roster MBs is
    -- split 1/N. MB cost: commission type → attributed delivered × rate;
    -- salaried → salary × window_days/30. Entries all-time lower bound
    -- '2020-01-01' replicated. net/roas derivable; net returned for sorting.
    with roster as (
        select u.id, u.payment_type,
               coalesce(u.commission_price, 0)::numeric as commission_price,
               coalesce(u.salary_amount, 0)::numeric as salary_amount
        from public.users u
        where u."DigiCom Business" = p_business and u.role = 'mediabuyer'
    ),
    sellers_x as (
        select u.id, coalesce(u.commission_price, 0)::numeric as rate,
               case when u.commission_basis = 'per_unit' then 'per_unit' else 'per_order' end as basis,
               case when jsonb_typeof(u.products) = 'array'
                    then coalesce((select array_agg(x) from jsonb_array_elements_text(u.products) x where x <> ''), '{}'::text[])
                    else '{}'::text[] end as prod_ids
        from public.users u
        where u."DigiCom Business" = p_business and u.role = 'commercial'
    ),
    pool as (
        select o.id, o.seller_id, o.price, o.raw_price, o.shipping_cost,
               o.include_delivery_in_total,
               (o.date at time zone 'Africa/Casablanca')::date as place_day,
               public.normalize_ad_source(o.source_name) as src,
               coalesce(ps.is_delivered, false) as is_delivered
        from public.orders o
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and nullif(o.source_name, '') is not null
          and public.normalize_ad_source(o.source_name) <> ''
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    pool_fin as (
        select p.*,
               case when p.is_delivered then
                   (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                         when coalesce(p.raw_price, 0) > 0 then p.raw_price
                         else case when p.include_delivery_in_total is false
                                   then coalesce(p.price, 0)
                                   else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end end)
                 + (case when p.include_delivery_in_total is true then coalesce(p.shipping_cost, 0) else 0 end)
               else 0 end as revenue,
               case when p.is_delivered then coalesce(li.cogs_cur, 0) else 0 end as cogs,
               case when p.is_delivered and sx.id is not null and sx.rate > 0 then
                   case when sx.basis = 'per_unit' then
                       case when cardinality(sx.prod_ids) = 0 then 0
                            else coalesce(un.units, 0) * sx.rate end
                        else sx.rate end
               else 0 end as seller_commission
        from pool p
        left join sellers_x sx on sx.id = p.seller_id
        left join lateral (
            select
                sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                         else coalesce(oi.unit_price, 0) * oi.quantity end)
                    filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum,
                sum(
                    coalesce(case when oi.product_id is not null and coalesce(oi.quantity, 0) > 0
                                  then coalesce(pr.cost_price, 0) * oi.quantity end, 0)
                  + coalesce(case when oi.accessory_id is not null and coalesce(oi.accessory_quantity, 0) > 0 then
                        (case when coalesce(oi.accessory_unit_price, 0) > 0
                              then oi.accessory_unit_price
                              else coalesce(ac.cost_price, 0) end) * oi.accessory_quantity end, 0)
                ) as cogs_cur
            from public.order_items oi
            left join public.products pr on pr.id = oi.product_id
            left join public.accessories ac on ac.id = oi.accessory_id
            where oi.order_id = p.id
        ) li on true
        left join lateral (
            select sum(coalesce(oi.quantity, 0)) as units
            from public.order_items oi
            where oi.order_id = p.id
              and oi.product_id is not null
              and sx.id is not null
              and cardinality(sx.prod_ids) > 0
              and oi.product_id::text = any(sx.prod_ids)
        ) un on true
    ),
    buckets as (
        select place_day as d, src,
               count(*)::int as leads,
               (count(*) filter (where is_delivered))::int as delivered,
               coalesce(sum(revenue), 0)::numeric as revenue,
               coalesce(sum(cogs), 0)::numeric as cogs,
               coalesce(sum(coalesce(shipping_cost, 0)) filter (where is_delivered), 0)::numeric as shipping,
               coalesce(sum(seller_commission), 0)::numeric as seller_commission
        from pool_fin
        group by 1, 2
    ),
    entries_w as (
        select e.created_by, e.entry_date, coalesce(e.spend, 0) as spend,
               public.normalize_ad_source(e.platform) as src
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.entry_date >= coalesce(p_from, date '2020-01-01')
          and e.entry_date <= v_to_day
    ),
    mb_keys as (  -- distinct (MB, day, source) claims — roster MBs only
        select distinct e.created_by, e.entry_date, e.src
        from entries_w e
        join roster r on r.id = e.created_by
        where e.src <> '' and e.entry_date is not null
    ),
    claims as (
        select entry_date, src, count(*)::int as n from mb_keys group by 1, 2
    ),
    attr as (
        select mk.created_by,
               sum(b.leads::numeric / c.n)     as orders,
               sum(b.delivered::numeric / c.n) as delivered,
               sum(b.revenue / c.n)            as revenue,
               sum(b.cogs / c.n)               as cogs,
               sum(b.shipping / c.n)           as shipping,
               sum(b.seller_commission / c.n)  as seller_commission
        from mb_keys mk
        join claims c on c.entry_date = mk.entry_date and c.src = mk.src
        join buckets b on b.d = mk.entry_date and b.src = mk.src
        group by 1
    ),
    spend as (
        select created_by, sum(spend)::numeric as spend from entries_w group by 1
    ),
    wdays as (
        select case
            when p_from is not null and p_to is not null then greatest(1, (p_to - p_from) + 1)
            else coalesce((
                select greatest(1, (v_today - min(x.d)) + 1)
                from (
                    select min(entry_date) as d from entries_w
                    union all
                    select min((o.date at time zone 'Africa/Casablanca')::date)
                    from public.orders o
                    where o."DigiCom Business" = p_business
                      and o.date_deleted is null
                      and o.source_review_status <> 'pending'
                      and o.replace is distinct from true
                      and o.date is not null
                ) x where x.d is not null
            ), 30)
        end as wd
    ),
    rows_mb as (
        select r.id,
               coalesce(s.spend, 0)::numeric as spend,
               coalesce(a.orders, 0)::numeric as orders,
               coalesce(a.delivered, 0)::numeric as delivered,
               coalesce(a.revenue, 0)::numeric as revenue,
               coalesce(a.cogs, 0)::numeric as cogs,
               coalesce(a.shipping, 0)::numeric as shipping,
               coalesce(a.seller_commission, 0)::numeric as seller_commission,
               case when r.payment_type = 'commission'
                        then coalesce(a.delivered, 0) * r.commission_price
                    when r.salary_amount > 0
                        then r.salary_amount * (select wd from wdays) / 30.0
                    else 0 end::numeric as mb_cost
        from roster r
        left join spend s on s.created_by = r.id
        left join attr a on a.created_by = r.id
    )
    select jsonb_build_object(
        'window_days', (select wd from wdays),
        'mediabuyers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'mb_id', m.id, 'spend', m.spend, 'orders', m.orders,
                'delivered', m.delivered, 'revenue', m.revenue, 'cogs', m.cogs,
                'shipping', m.shipping, 'seller_commission', m.seller_commission,
                'mb_cost', m.mb_cost,
                'net_profit', m.revenue - m.cogs - m.shipping - m.seller_commission
                            - m.mb_cost - m.spend
            ) order by (m.revenue - m.cogs - m.shipping - m.seller_commission
                        - m.mb_cost - m.spend) desc, m.id)
            from rows_mb m
        ), '[]'::jsonb)
    )
    into v_mediabuyers;
    end if;

    if v_all or 'users' = any(p_sections) then
    -- ───────────────────── users (recon 03 §12) ────────────────────────────
    -- Window-INDEPENDENT (fixed 30-day activity rule computed here on
    -- now()/v_today). truly_active = active flag AND (owner/admin/super admin
    -- exempt OR appeared as seller/courier on an order touched in the last 30
    -- days OR authored a campaign entry in the last 30 days). The orders
    -- activity scan deliberately omits date_deleted (client parity).
    with u as (
        select u.id, coalesce(u.role::text, 'unknown') as role,
               coalesce(u.active, false) as active_flag
        from public.users u
        where u."DigiCom Business" = p_business
    ),
    act as (
        select distinct uid from (
            select o.seller_id as uid
            from public.orders o
            where o."DigiCom Business" = p_business
              and o.source_review_status <> 'pending'
              and o.updated_at >= v_now - interval '30 days'
              and o.seller_id is not null
            union all
            select o.courier_id
            from public.orders o
            where o."DigiCom Business" = p_business
              and o.source_review_status <> 'pending'
              and o.updated_at >= v_now - interval '30 days'
              and o.courier_id is not null
            union all
            select e.created_by
            from public.campaign_daily_entries e
            where e."DigiCom Business" = p_business
              and e.entry_date >= v_today - 30
              and e.created_by is not null
        ) s
    ),
    flags as (
        select u.id, u.role,
               (u.active_flag and (u.role in ('owner', 'admin', 'super admin')
                                   or a.uid is not null)) as truly_active
        from u
        left join act a on a.uid = u.id
    )
    select jsonb_build_object(
        'total_users', (select count(*)::int from flags),
        'active_users', (select count(*)::int from flags where truly_active),
        'inactive_users', (select count(*)::int from flags where not truly_active),
        'roles', coalesce((
            select jsonb_agg(jsonb_build_object(
                'role', r.role, 'total', r.total, 'active', r.active
            ) order by r.total desc, r.role)
            from (
                select role, count(*)::int as total,
                       (count(*) filter (where truly_active))::int as active
                from flags group by role
            ) r
        ), '[]'::jsonb)
    )
    into v_users;
    end if;

        -- Only computed sections are present; default (null) returns all 12.
    if v_profitability is not null then v_out := v_out || jsonb_build_object('profitability', v_profitability); end if;
    if v_health is not null then v_out := v_out || jsonb_build_object('health', v_health); end if;
    if v_orders is not null then v_out := v_out || jsonb_build_object('orders', v_orders); end if;
    if v_ads is not null then v_out := v_out || jsonb_build_object('ads', v_ads); end if;
    if v_shipping is not null then v_out := v_out || jsonb_build_object('shipping', v_shipping); end if;
    if v_inventory is not null then v_out := v_out || jsonb_build_object('inventory', v_inventory); end if;
    if v_channels is not null then v_out := v_out || jsonb_build_object('channels', v_channels); end if;
    if v_customers is not null then v_out := v_out || jsonb_build_object('customers', v_customers); end if;
    if v_sellers is not null then v_out := v_out || jsonb_build_object('sellers', v_sellers); end if;
    if v_couriers is not null then v_out := v_out || jsonb_build_object('couriers', v_couriers); end if;
    if v_mediabuyers is not null then v_out := v_out || jsonb_build_object('mediabuyers', v_mediabuyers); end if;
    if v_users is not null then v_out := v_out || jsonb_build_object('users', v_users); end if;
    return v_out;
end;
$function$

