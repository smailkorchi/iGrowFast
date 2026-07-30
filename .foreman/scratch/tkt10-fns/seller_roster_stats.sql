CREATE OR REPLACE FUNCTION public.seller_roster_stats(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    v_out jsonb;
begin
    -- ADMIN GATE (standing rule 1). Route: /collaborators/sellers (+ the
    -- /sellers back-compat alias) inside allowedRoles={['super admin','admin']}
    -- ⇒ current_user_is_business_admin() is an exact match; the gate is free.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'seller_roster_stats: admin only' using errcode = '42501';
    end if;

    with roster as (
        -- Sellers.tsx L186-191. normalizeCommissionBasis: 'per_unit' iff exact.
        -- products: jsonb array of strings; '' entries dropped
        -- (getSellerProducts' typeof filter + sumAssignedProductUnits'
        -- .filter(Boolean)).
        select u.id,
               u.created_at,
               coalesce(u.commission_price, 0)::numeric as commission_price,
               case when u.commission_basis = 'per_unit' then 'per_unit' else 'per_order' end as basis,
               case when jsonb_typeof(u.products) = 'array'
                    then coalesce((select array_agg(x) from jsonb_array_elements_text(u.products) x where x <> ''), '{}'::text[])
                    else '{}'::text[] end as prod_ids
        from public.users u
        where u."DigiCom Business" = p_business
          and u.role = 'commercial'
    ),
    tracked as (
        -- D2 hashed tracked set — kills useTrackedOrders' 2 unbounded dumps.
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
        -- isRateConfirmed's empty-set guard: client `statusMapsReady =
        -- pendingIds.size > 0`; server-side the guard IS this EXISTS check.
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    pool as (
        select o.id,
               o.seller_id,
               o.price,
               o.master_city_id,
               coalesce(ps.is_delivered, false) as is_delivered,
               (t.order_id is not null) as has_tracking,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               -- rateConfirmedCount predicate (Sellers.tsx L296-301).
               ((t.order_id is not null)
                 or (pf.ready and o.order_status_id is not null
                     and not coalesce(os.pending_confirmation, false))) as rate_confirmed_calc,
               -- Status chain L271-290, first match wins.
               case
                   -- 1 isDeliveredForCommission(o, deliveredPkgIds)
                   when coalesce(ps.is_delivered, false) then 'delivered'
                   -- 2 isOrderCategory(sid,'processed')
                   when coalesce(os.is_confirmed, false)
                        and not coalesce(os.deducts_stock, false)
                        and not coalesce(os.is_paid, false)
                        and not coalesce(os.is_unpaid, false) then 'shipped'
                   -- 3 confirmedIds.has(sid)  [computed then DISCARDED by the client]
                   when coalesce(os.is_confirmed, false) then 'confirmed'
                   -- 4 isOrderCategory(sid,'cancelled')
                   when coalesce(os.is_cancelled, false)
                        and not coalesce(os.is_fake, false)
                        and not coalesce(os.is_double, false)
                        and not coalesce(os.is_blacklisted, false) then 'cancelled'
                   -- 5 isOrderInCategories(sid,['fake','double'])
                   when coalesce(os.is_fake, false)
                        or coalesce(os.is_double, false) then 'fake'
                   -- 6 pendingIds.has(sid) → pending ; else → pending (D5-DEV-S5)
                   else 'pending'
               end as bucket
        from public.orders o
        cross join pending_flag pf
        join roster r on r.id = o.seller_id
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
    ),
    per as (
        select p.seller_id,
               count(*)::int as total_orders,
               (count(*) filter (where p.bucket = 'delivered'))::int as delivered,
               (count(*) filter (where p.bucket = 'shipped'))::int as shipped,
               (count(*) filter (where p.bucket = 'cancelled'))::int as cancelled,
               (count(*) filter (where p.bucket = 'fake'))::int as fake,
               (count(*) filter (where p.bucket = 'pending'))::int as pending,
               (count(*) filter (where p.rate_confirmed_calc))::int as rate_confirmed,
               (count(*) filter (where p.has_tracking))::int as tracked,
               (count(*) filter (where p.has_tracking and p.pullback_flag))::int as pullback,
               -- D5-DEV-S1: Σ RAW price over delivered. NOT pureRevenueForOrder.
               coalesce(sum(p.price) filter (where p.is_delivered), 0)::numeric as total_revenue
        from pool p
        group by 1
    ),
    accrual_raw as (
        -- computeUnpaidCommission accrual (D2's shape): per_order ⇒ delivered
        -- count; per_unit ⇒ Σ assigned-product units over delivered orders.
        -- EMPTY users.products ⇒ 0 (sumAssignedProductUnits' early return;
        -- matches the DB fn sum_order_units_for_seller_products).
        select p.seller_id,
               count(*)::numeric as delivered_cnt,
               coalesce(sum(u.units), 0)::numeric as unit_sum
        from pool p
        join roster r2 on r2.id = p.seller_id
        left join lateral (
            select sum(coalesce(oi.quantity, 0)) as units
            from public.order_items oi
            where oi.order_id = p.id
              and oi.product_id is not null
              and cardinality(r2.prod_ids) > 0
              and oi.product_id::text = any(r2.prod_ids)
        ) u on true
        where p.is_delivered
        group by 1
    ),
    accrual as (
        select r.id as seller_id,
               case when r.basis = 'per_unit' then coalesce(ar.unit_sum, 0)
                    else coalesce(ar.delivered_cnt, 0) end as accrued_total
        from roster r
        left join accrual_raw ar on ar.seller_id = r.id
    ),
    pay as (
        -- totalPaid = Σ paid_amount over ALL payout rows (pending+partial+paid)
        -- — the trigger keeps paid_amount in lockstep with seller_payment_txns,
        -- so this is the single source of truth for disbursed cash. Identical
        -- to alreadyPaidAmount (L318-319), which feeds live_commission.
        -- totalUnpaid = the OPEN month's remaining ONLY: closed months' unpaid
        -- already rolled forward into the open ticket, so summing every row
        -- would double-count it. THIS IS THE ROLLING-LEDGER MODEL — preserve.
        select sp.seller_id,
               coalesce(sum(coalesce(sp.paid_amount, 0)), 0)::numeric as total_paid,
               coalesce(sum(case when sp.period_state = 'open'
                                 then greatest(0, coalesce(sp.total_amount, 0) - coalesce(sp.paid_amount, 0))
                                 else 0 end), 0)::numeric as total_unpaid
        from public.seller_payments sp
        join roster r on r.id = sp.seller_id
        where sp."DigiCom Business" = p_business
        group by 1
    ),
    sde as (
        -- seller_daily_earnings is a security_invoker VIEW — an INVOKER RPC
        -- inherits the caller's RLS (consistent; do NOT wrap in SECDEF without
        -- re-adding the tenant predicate).
        select e.seller_id,
               coalesce(sum(coalesce(e.commission_earned, 0)), 0)::numeric as total_commission_earned,
               coalesce(sum(coalesce(e.total_earned, 0)), 0)::numeric as total_earnings
        from public.seller_daily_earnings e
        join roster r on r.id = e.seller_id
        where e."DigiCom Business" = p_business
        group by 1
    ),
    pres as (
        select sp.seller_id,
               count(*)::int as days_present,
               max(sp.date) as last_active
        from public.seller_presences sp
        join roster r on r.id = sp.seller_id
        where sp."DigiCom Business" = p_business
        group by 1
    ),
    city as (
        -- topCity = argmax over DELIVERED orders of (city.name || 'Unknown').
        -- Tie-break made deterministic (header deviation).
        select distinct on (c.seller_id) c.seller_id, c.city_name as top_city
        from (
            select p.seller_id,
                   coalesce(mc.name, 'Unknown') as city_name,
                   count(*) as n
            from pool p
            left join public.master_cities mc on mc.id = p.master_city_id
            where p.is_delivered
            group by 1, 2
        ) c
        order by c.seller_id, c.n desc, c.city_name
    ),
    payouts as (
        -- monthlyPayments (L374-381). `|| 'pending'` / `|| 'closed'` are JS
        -- truthiness: '' is falsy too ⇒ nullif(...,'') before coalesce.
        select sp.seller_id,
               jsonb_agg(jsonb_build_object(
                   'month', sp.payout_month,
                   'total_amount', coalesce(sp.total_amount, 0),
                   'paid_amount', coalesce(sp.paid_amount, 0),
                   'delivered_orders', coalesce(sp.delivered_orders, 0),
                   'status', coalesce(nullif(sp.status, ''), 'pending'),
                   'period_state', coalesce(nullif(sp.period_state, ''), 'closed')
               ) order by sp.payout_month desc, sp.id) as rows
        from public.seller_payments sp
        join roster r on r.id = sp.seller_id
        where sp."DigiCom Business" = p_business
        group by 1
    ),
    rows_out as (
        select r.id as seller_id,
               r.created_at,
               coalesce(pr.total_orders, 0) as total_orders,
               coalesce(pr.pending, 0) as pending,
               coalesce(pr.rate_confirmed, 0) as rate_confirmed,
               coalesce(pr.delivered, 0) as delivered,
               coalesce(pr.cancelled, 0) as cancelled,
               coalesce(pr.fake, 0) as fake,
               coalesce(pr.shipped, 0) as shipped,
               coalesce(pr.tracked, 0) as tracked,
               coalesce(pr.pullback, 0) as pullback,
               (coalesce(pr.tracked, 0) - coalesce(pr.pullback, 0)) as delivery_denom,
               coalesce(pr.total_revenue, 0)::numeric as total_revenue,
               -- computeUnpaidCommission: max(0, accruedTotal × price − max(0, paidCash))
               greatest(0, coalesce(ac.accrued_total, 0) * r.commission_price
                           - greatest(0, coalesce(pa.total_paid, 0)))::numeric as live_commission,
               coalesce(sd.total_earnings, 0)::numeric as total_earnings,
               coalesce(sd.total_commission_earned, 0)::numeric as total_commission_earned,
               coalesce(pa.total_paid, 0)::numeric as total_paid,
               coalesce(pa.total_unpaid, 0)::numeric as total_unpaid,
               coalesce(ps2.days_present, 0) as days_present,
               ps2.last_active,
               ct.top_city,
               r.prod_ids,
               coalesce(po.rows, '[]'::jsonb) as monthly_payments
        from roster r
        left join per pr      on pr.seller_id = r.id
        left join accrual ac  on ac.seller_id = r.id
        left join pay pa      on pa.seller_id = r.id
        left join sde sd      on sd.seller_id = r.id
        left join pres ps2    on ps2.seller_id = r.id
        left join city ct     on ct.seller_id = r.id
        left join payouts po  on po.seller_id = r.id
    )
    select jsonb_build_object(
        'globals', jsonb_build_object(
            -- D5-DEV-S4 / D5-BUG-6: NO `active` filter (parity with the pill).
            'total_sellers', (select count(*)::int from roster),
            'total_delivered', coalesce((select sum(delivered) from rows_out), 0)::int,
            'total_revenue', coalesce((select sum(total_revenue) from rows_out), 0)::numeric,
            'total_paid', coalesce((select sum(total_paid) from rows_out), 0)::numeric,
            -- delivered_sum / denom_sum ship SEPARATELY: the client divides →
            -- pooled-ratio parity for avgDeliveryRate (L425). delivered_sum ≡
            -- total_delivered by construction; both are in the contract's shape.
            'delivered_sum', coalesce((select sum(delivered) from rows_out), 0)::int,
            'denom_sum', coalesce((select sum(delivery_denom) from rows_out), 0)::int
        ),
        'sellers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'seller_id', ro.seller_id,
                'total_orders', ro.total_orders,
                'pending', ro.pending,
                -- `confirmed` = rate_confirmed (Sellers.tsx L391), NOT the
                -- chain's discarded `confirmed++` counter. See the header.
                'confirmed', ro.rate_confirmed,
                'delivered', ro.delivered,
                'cancelled', ro.cancelled,
                'fake', ro.fake,
                'shipped', ro.shipped,
                'tracked', ro.tracked,
                'pullback', ro.pullback,
                'delivery_denom', ro.delivery_denom,
                'confirm_rate', case when ro.total_orders > 0
                    then ro.rate_confirmed::numeric * 100 / ro.total_orders else 0 end,
                -- D5-DEV-S3: UNCLAMPED, numerator NOT tracked-gated.
                'delivery_rate', case when ro.delivery_denom > 0
                    then ro.delivered::numeric * 100 / ro.delivery_denom else 0 end,
                'cancellation_rate', case when ro.total_orders > 0
                    then (ro.cancelled + ro.fake)::numeric * 100 / ro.total_orders else 0 end,
                'live_commission', ro.live_commission,
                'total_revenue', ro.total_revenue,
                'total_earnings', ro.total_earnings,
                'total_commission_earned', ro.total_commission_earned,
                'total_paid', ro.total_paid,
                'total_unpaid', ro.total_unpaid,
                'days_present', ro.days_present,
                'last_active', ro.last_active,
                'top_city', ro.top_city,
                'product_ids', to_jsonb(ro.prod_ids),
                'monthly_payments', ro.monthly_payments
            ) order by ro.created_at, ro.seller_id)
            from rows_out ro
        ), '[]'::jsonb)
    )
    into v_out;

    return v_out;
end
$function$

