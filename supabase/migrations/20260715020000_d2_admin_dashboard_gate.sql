-- D3 review retrofit — admin gate on the already-live admin_dashboard_stats.
--
-- The D2 design (and the D3 contract that copied its stance) locked "no scope
-- guard: admin-only page, RLS + biz predicate suffice". The D3 SQL agent
-- challenged that and is right: RLS blocks privilege escalation (payments
-- tables are own-rows-or-admin), but orders + campaign_daily_entries carry
-- TENANT-WIDE RLS, so any authenticated business member could call this RPC
-- straight through PostgREST and get a pre-aggregated business-wide
-- money/performance payload — exactly what the MB-facing data rule forbids the
-- UI to show them.
--
-- Body below = the live pg_get_functiondef output with ONLY the gate prepended
-- (byte-identical otherwise). ads_history_metrics stays UNGATED deliberately:
-- the media-buyer AdsHistory route calls it by design, scoped via p_created_by.
--
-- Reversible: re-apply mig 20260714230000's admin_dashboard_stats block.

begin;

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(p_business uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
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
    v_kpi       jsonb;
    v_sales     jsonb;
    v_pending   jsonb;
    v_confirmation jsonb;
    v_shipping  jsonb;
    v_city      jsonb;
    v_sellers   jsonb;
    v_products  jsonb;
begin
    -- ADMIN GATE (D3 review retrofit): this payload aggregates business-wide
    -- money + per-collaborator performance. SECURITY INVOKER + RLS prevents
    -- privilege escalation, but tenant-wide RLS on orders/campaign_daily_entries
    -- means an authenticated non-admin could call this RPC directly and receive
    -- a pre-aggregated payload the MB-facing data rule forbids. The consumer
    -- page (admin Dashboard) is admin-only — no legitimate caller regresses.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'admin_dashboard_stats: admin only' using errcode = '42501';
    end if;
    -- ───────────────────────── kpi_cards (recon 01 §1) ─────────────────────
    -- Window: strict — NULL/invalid dates dropped even on All Time, and the
    -- all-time upper bound is now() (client used epoch..now). Rates clamped
    -- ≤100 like the client; divide-by-zero → 0.
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
        select o.id, o.order_status_id,
               coalesce(os.pending_confirmation, false) as pending_status,
               coalesce(os.is_cancelled, false)         as cancelled_flag,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               coalesce(ps.is_delivered, false)         as is_delivered,
               coalesce(ps.is_shipped, false)           as is_shipped,
               coalesce(ps.is_refused, false)           as is_refused,
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
          and o.date is not null
          and (v_start is null or o.date >= v_start)
          and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)
    ),
    agg as (
        select
            count(*)::int as total,
            (count(*) filter (where has_tracking
                or (ready and order_status_id is not null and not pending_status)))::int as rate_confirmed,
            (count(*) filter (where is_delivered))::int as delivered,
            (count(*) filter (where has_tracking))::int as tracked,
            (count(*) filter (where has_tracking and pullback_flag))::int as pullback,
            (count(*) filter (where not has_tracking and pending_status))::int as pending_confirmation,
            (count(*) filter (where is_shipped))::int as in_transit,
            (count(*) filter (where cancelled_flag))::int as canceled,
            (count(*) filter (where is_refused))::int as refused
        from pool
    ),
    -- Invoices tile: company_payment_notes count + Σnet_amount over created_at
    -- in the SAME strict window (NULL created_at excluded; column has default
    -- now(), 0 nulls live). Kills the unpaginated 1000-cap select.
    notes as (
        select count(*)::int as invoices_count,
               coalesce(sum(coalesce(n.net_amount, 0)), 0)::numeric as invoices_net_total
        from public.company_payment_notes n
        where n."DigiCom Business" = p_business
          and n.created_at is not null
          and (v_start is null or n.created_at >= v_start)
          and (case when v_end_excl is not null then n.created_at < v_end_excl else n.created_at <= v_now end)
    )
    select jsonb_build_object(
        'total', a.total,
        'rate_confirmed', a.rate_confirmed,
        'confirmation_rate', case when a.total > 0
            then least(100, a.rate_confirmed::numeric * 100 / a.total) else 0 end,
        'delivered', a.delivered,
        'tracked', a.tracked,
        'pullback', a.pullback,
        'delivery_denom', a.tracked - a.pullback,
        'delivery_rate', case when (a.tracked - a.pullback) > 0
            then least(100, a.delivered::numeric * 100 / (a.tracked - a.pullback)) else 0 end,
        'pending_confirmation', a.pending_confirmation,
        'in_transit', a.in_transit,
        'canceled', a.canceled,
        'refused', a.refused,
        'invoices', jsonb_build_object(
            'count', n.invoices_count,
            'net_total', n.invoices_net_total
        )
    )
    into v_kpi
    from agg a, notes n;

    -- ───────────────────────── sales_chart (recon 01 §2) ───────────────────
    -- Day-bucketed (Casablanca) arrays; the client re-buckets to its grain and
    -- runs the vs-Prev comparison itself (second call with the shifted window).
    -- Orders line: full pool incl. replace legs, placement-bucketed.
    -- Revenue line: replace excluded AND delivered, delivery-bucketed
    -- (coalesce(date_livraison, updated_at)); per-order revenue uses the
    -- COLLAPSED pureRevenueForOrder — this widget's select omits order_items
    -- and raw_price, so the client formula degenerates to the price/shipping
    -- branch (recon 04 §0) — replicated byte-exactly, NOT the full chain.
    with pool as (
        select o.id, o.date, o.date_livraison, o.updated_at, o.price, o.shipping_cost,
               o.include_delivery_in_total, o.replace,
               coalesce(ps.is_delivered, false) as is_delivered
        from public.orders o
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
    ),
    orders_by_day as (
        select (p.date at time zone 'Africa/Casablanca')::date as d, count(*)::int as n
        from pool p
        where p.date is not null
          and ((not v_has_win) or (
                (v_start is null or p.date >= v_start)
            and (case when v_end_excl is not null then p.date < v_end_excl else p.date <= v_now end)))
        group by 1
    ),
    revenue_by_day as (
        select (coalesce(p.date_livraison, p.updated_at) at time zone 'Africa/Casablanca')::date as d,
               sum(
                   (case when p.include_delivery_in_total is false
                         then coalesce(p.price, 0)
                         else greatest(0, coalesce(p.price, 0) - coalesce(p.shipping_cost, 0)) end)
                 + (case when p.include_delivery_in_total is true
                         then coalesce(p.shipping_cost, 0) else 0 end)
               )::numeric as revenue
        from pool p
        where p.replace is distinct from true
          and p.is_delivered
          and coalesce(p.date_livraison, p.updated_at) is not null
          and ((not v_has_win) or (
                (v_start is null or coalesce(p.date_livraison, p.updated_at) >= v_start)
            and (case when v_end_excl is not null
                      then coalesce(p.date_livraison, p.updated_at) < v_end_excl
                      else coalesce(p.date_livraison, p.updated_at) <= v_now end)))
        group by 1
    )
    select jsonb_build_object(
        'orders_by_day', coalesce((
            select jsonb_agg(jsonb_build_object('d', d, 'orders', n) order by d)
            from orders_by_day), '[]'::jsonb),
        'revenue_by_day', coalesce((
            select jsonb_agg(jsonb_build_object('d', d, 'revenue', revenue) order by d)
            from revenue_by_day), '[]'::jsonb)
    )
    into v_sales;

    -- ─────────────── pending_breakdown + confirmation_pipeline ─────────────
    -- (recon 01 §3-§4) Shared pool: NOT tracked AND pending_confirmation AND
    -- date in window — NULL dates pass EVERY window here (isInRange(null)=true).
    -- Age buckets measured against NOW (Casablanca days), not window end;
    -- anchor = coalesce(date, created_at).
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
    pend as (
        select o.id, o.price, o.order_status_id,
               (coalesce(o.date, o.created_at) at time zone 'Africa/Casablanca')::date as anchor_day,
               os.label as status_label, os.code as status_code, os.color as status_color
        from public.orders o
        join public.order_statuses os
          on os.id = o.order_status_id and os.pending_confirmation
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and t.order_id is null
          -- All-Time is UNBOUNDED (D2 review fix: the old client applied no now()
          -- cap, so future-dated pending orders must stay in the breakdown).
          and (o.date is null or (not v_has_win) or (
                (v_start is null or o.date >= v_start)
            and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)))
    ),
    aged as (
        select *, case when anchor_day is null then null else (v_today - anchor_day) end as age
        from pend
    ),
    buckets as (
        select
            count(*)::int as total,
            coalesce(sum(coalesce(price, 0)), 0)::numeric as total_value,
            (count(*) filter (where age <= 0))::int as c_today,
            coalesce(sum(coalesce(price, 0)) filter (where age <= 0), 0)::numeric as v_today_b,
            (count(*) filter (where age > 0 and age <= 3))::int as c_1_3,
            coalesce(sum(coalesce(price, 0)) filter (where age > 0 and age <= 3), 0)::numeric as v_1_3,
            (count(*) filter (where age > 3 and age <= 7))::int as c_4_7,
            coalesce(sum(coalesce(price, 0)) filter (where age > 3 and age <= 7), 0)::numeric as v_4_7,
            (count(*) filter (where age > 7))::int as c_7p,
            coalesce(sum(coalesce(price, 0)) filter (where age > 7), 0)::numeric as v_7p
        from aged
    )
    select jsonb_build_object(
        'total', b.total,
        'total_value', b.total_value,
        'buckets', jsonb_build_object(
            'today',  jsonb_build_object('count', b.c_today, 'value', b.v_today_b),
            'd1_3',   jsonb_build_object('count', b.c_1_3, 'value', b.v_1_3),
            'd4_7',   jsonb_build_object('count', b.c_4_7, 'value', b.v_4_7),
            'd7_plus',jsonb_build_object('count', b.c_7p, 'value', b.v_7p)
        )
    ),
    (
        select jsonb_build_object(
            'total', (select count(*) from aged),
            'statuses', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'order_status_id', s.order_status_id,
                    'label', coalesce(nullif(s.status_label, ''), nullif(s.status_code, ''), 'Unknown'),
                    'color', coalesce(nullif(s.status_color, ''), '#6b7280'),
                    'count', s.n
                ) order by s.n desc, s.order_status_id)
                from (
                    select order_status_id, max(status_label) as status_label,
                           max(status_code) as status_code, max(status_color) as status_color,
                           count(*)::int as n
                    from aged group by order_status_id
                ) s), '[]'::jsonb)
        )
    )
    into v_pending, v_confirmation
    from buckets b;

    -- ───────────────────── shipping_pipeline (recon 01 §5) ─────────────────
    -- Window on placement: All-Time passes NULL dates, explicit excludes them.
    -- shipped = pkg ∈ (is_shipped ∪ is_delivered ∪ is_returned); header
    -- in_transit = total − delivered − returned (raw arithmetic, like client).
    -- Fulfiller key: provider:company_id precedence, else courier:courier_id,
    -- neither → invisible in that pane. Overall rate = Coliaty denom over the
    -- FULL filtered set (reconciles with the KPI tile). Names/logos stay
    -- client-side (providers/couriers support queries remain).
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
        select o.id, o.package_status_id, o.company_id, o.courier_id,
               coalesce(ps.is_delivered, false) as is_delivered,
               coalesce(ps.is_shipped, false)   as is_shipped,
               coalesce(ps.is_returned, false)  as is_returned,
               ps.label as pkg_label,
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
          and ((not v_has_win) or (o.date is not null
                and (v_start is null or o.date >= v_start)
                and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)))
    ),
    shipped as (
        select * from pool where is_shipped or is_delivered or is_returned
    ),
    header as (
        select
            (select count(*) from pool)::int as filtered_total,
            count(*)::int as shipped_total,
            (count(*) filter (where is_delivered))::int as delivered,
            (count(*) filter (where is_returned))::int as returned
        from shipped
    ),
    overall as (
        select
            (count(*) filter (where has_tracking))::int
              - (count(*) filter (where has_tracking and pullback_flag))::int as denom,
            (count(*) filter (where is_delivered))::int as delivered
        from pool
    ),
    by_status as (
        select package_status_id, max(pkg_label) as label, count(*)::int as n
        from shipped group by package_status_id
    ),
    by_fulfiller as (
        select
            case when company_id is not null then 'provider' else 'courier' end as kind,
            coalesce(company_id, courier_id) as fid,
            count(*)::int as total,
            (count(*) filter (where is_delivered))::int as delivered,
            (count(*) filter (where is_returned))::int as returned,
            ((count(*) filter (where has_tracking))
              - (count(*) filter (where has_tracking and pullback_flag)))::int as denom
        from shipped
        where company_id is not null or courier_id is not null
        group by 1, 2
    )
    select jsonb_build_object(
        'filtered_total', h.filtered_total,
        'shipped_total', h.shipped_total,
        'delivered', h.delivered,
        'returned', h.returned,
        'in_transit', h.shipped_total - h.delivered - h.returned,
        'overall_denom', o.denom,
        'overall_rate', case when o.denom > 0
            then least(100, o.delivered::numeric * 100 / o.denom) else 0 end,
        'by_status', coalesce((
            select jsonb_agg(jsonb_build_object(
                'package_status_id', s.package_status_id,
                'label', coalesce(nullif(s.label, ''), s.package_status_id::text),
                'count', s.n
            ) order by s.n desc, s.package_status_id)
            from by_status s), '[]'::jsonb),
        'by_fulfiller', coalesce((
            select jsonb_agg(jsonb_build_object(
                'kind', f.kind,
                'id', f.fid,
                'total', f.total,
                'delivered', f.delivered,
                'returned', f.returned,
                'in_transit', greatest(0, f.total - f.delivered - f.returned),
                'denom', f.denom,
                'rate', case when f.denom > 0
                    then least(100, f.delivered::numeric * 100 / f.denom) else 0 end
            ) order by f.total desc, f.fid)
            from by_fulfiller f), '[]'::jsonb),
        'provider_shipments', coalesce((select sum(total) from by_fulfiller where kind = 'provider'), 0),
        'courier_shipments', coalesce((select sum(total) from by_fulfiller where kind = 'courier'), 0)
    )
    into v_shipping
    from header h, overall o;

    -- ─────────────────────── city_stats (recon 01 §8) ──────────────────────
    -- Window on placement (All-Time passes NULLs, explicit excludes). Orders
    -- without a master_cities.name are SKIPPED entirely (also from totals).
    -- Grouped by city NAME. total/delivered include replace legs; revenue =
    -- delivered AND replace excluded, COLLAPSED pureRevenue (select omitted
    -- order_items/raw_price — recon 04 §0, same rule as sales_chart).
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
        select mc.name as city,
               o.replace,
               coalesce(ps.is_delivered, false) as is_delivered,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking,
               (case when o.include_delivery_in_total is false
                     then coalesce(o.price, 0)
                     else greatest(0, coalesce(o.price, 0) - coalesce(o.shipping_cost, 0)) end)
             + (case when o.include_delivery_in_total is true
                     then coalesce(o.shipping_cost, 0) else 0 end) as revenue
        from public.orders o
        join public.master_cities mc
          on mc.id = o.master_city_id and nullif(mc.name, '') is not null
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and ((not v_has_win) or (o.date is not null
                and (v_start is null or o.date >= v_start)
                and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)))
    ),
    per_city as (
        select city,
               count(*)::int as total,
               ((count(*) filter (where has_tracking))
                 - (count(*) filter (where has_tracking and pullback_flag)))::int as denom,
               (count(*) filter (where is_delivered))::int as delivered,
               coalesce(sum(revenue) filter (where is_delivered and replace is distinct from true), 0)::numeric as revenue
        from pool
        group by city
    )
    select jsonb_build_object(
        'cities', coalesce((
            select jsonb_agg(jsonb_build_object(
                'name', c.city, 'total', c.total, 'denom', c.denom,
                'delivered', c.delivered, 'revenue', c.revenue
            ) order by c.delivered desc, c.total desc, c.city)
            from per_city c), '[]'::jsonb),
        'totals', (
            select jsonb_build_object(
                'orders', coalesce(sum(total), 0),
                'denom', coalesce(sum(denom), 0),
                'delivered', coalesce(sum(delivered), 0),
                'revenue', coalesce(sum(revenue), 0)
            ) from per_city
        )
    )
    into v_city;

    -- ───────────────── sellers_performance (recon 01 §6) ───────────────────
    -- Pool: replace legs excluded FIRST. Cohort anchor coalesce(assignment_date,
    -- date); total_in_window by placement over the SAME replace-excluded pool.
    -- Financials over delivered cohort orders: revenue = FULL pureRevenue chain
    -- (this widget selects order_items + raw_price); COGS gated on product
    -- quantity > 0 per line INCLUDING its accessory part (the client `continue`s
    -- before the accessory branch); adsShare = ads with start_date in window
    -- (FULL amount, no pro-rating — deliberately different from the products
    -- widget) split by sellerDeliveredQty/globalDeliveredQty, where the global
    -- qty replicates the client's `quantity || 1` quirk (null/0 → 1) and spans
    -- ALL cohort-window delivered orders (any seller, incl. NULL seller_id).
    -- Commission: seller_daily_earnings windowed Σ (source of truth; NULL when
    -- the seller has no view rows in-window) + the client-formula fallback for
    -- the drift indicator (per_unit with empty users.products ⇒ 0).
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
               o.include_delivery_in_total, o.order_status_id, o.package_status_id,
               o.seller_id, o.source_name,
               coalesce(o.assignment_date, o.date) as cohort_anchor,
               coalesce(ps.is_delivered, false) as is_delivered,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking,
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
          and o.replace is distinct from true
    ),
    win as (  -- cohort-window rows, ANY seller (globalDeliveredQty universe)
        select p.* from pool p
        where p.cohort_anchor is not null
          and ((not v_has_win) or (
                (v_start is null or p.cohort_anchor >= v_start)
            and (case when v_end_excl is not null then p.cohort_anchor < v_end_excl else p.cohort_anchor <= v_now end)))
    ),
    sellers as (
        select u.id, u.name,
               coalesce(u.commission_price, 0)::numeric as rate,
               case when u.commission_basis = 'per_unit' then 'per_unit' else 'per_order' end as basis,
               case when jsonb_typeof(u.products) = 'array'
                    then coalesce((select array_agg(x) from jsonb_array_elements_text(u.products) x where x <> ''), '{}'::text[])
                    else '{}'::text[] end as prod_ids
        from public.users u
        where u."DigiCom Business" = p_business and u.role = 'commercial'
    ),
    cohort as (
        select w.* from win w join sellers s on s.id = w.seller_id
    ),
    ads_win as (  -- full amount when start_date in window (no pro-rating here)
        select ah.product_id, sum(coalesce(ah.amount, 0))::numeric as amount
        from public.ads_history ah
        where ah."DigiCom Business" = p_business
          and ah.product_id is not null
          and ah.start_date is not null
          and ((not v_has_win) or (
                (p_from is null or ah.start_date >= p_from)
            and (case when p_to is not null then ah.start_date <= p_to else ah.start_date <= v_today end)))
        group by ah.product_id
    ),
    global_qty as (
        select oi.product_id,
               sum(case when coalesce(oi.quantity, 0) = 0 then 1 else oi.quantity end)::numeric as qty
        from win w
        join public.order_items oi on oi.order_id = w.id
        where w.is_delivered and oi.product_id is not null
        group by oi.product_id
    ),
    counts as (
        select c.seller_id,
               count(*)::int as assigned,
               (count(*) filter (where c.confirmed_calc))::int as confirmed,
               (count(*) filter (where c.is_delivered))::int as delivered,
               (count(*) filter (where c.has_tracking))::int as tracked,
               (count(*) filter (where c.has_tracking and c.pullback_flag))::int as pullback
        from cohort c group by c.seller_id
    ),
    fin as (
        select c.seller_id,
               sum(
                   (case when coalesce(li.line_sum, 0) > 0 then li.line_sum
                         when coalesce(c.raw_price, 0) > 0 then c.raw_price
                         else case when c.include_delivery_in_total is false
                                   then coalesce(c.price, 0)
                                   else greatest(0, coalesce(c.price, 0) - coalesce(c.shipping_cost, 0)) end end)
                 + (case when c.include_delivery_in_total is true then coalesce(c.shipping_cost, 0) else 0 end)
               )::numeric as revenue,
               sum(coalesce(c.shipping_cost, 0))::numeric as shipping,
               sum(coalesce(li.cogs, 0))::numeric as cogs
        from cohort c
        left join lateral (
            select
                sum(case when coalesce(oi.total_price, 0) > 0 then oi.total_price
                         else coalesce(oi.unit_price, 0) * oi.quantity end)
                    filter (where oi.product_id is not null and coalesce(oi.quantity, 0) > 0) as line_sum,
                sum(
                    coalesce(case when oi.product_id is not null then
                        (case when coalesce(oi.product_unit_cost_snapshot, 0) > 0
                              then oi.product_unit_cost_snapshot
                              else coalesce(pr.cost_price, 0) end) * oi.quantity end, 0)
                  + coalesce(case when oi.accessory_id is not null and coalesce(oi.accessory_quantity, 0) > 0 then
                        (case when coalesce(oi.accessory_unit_price, 0) > 0
                              then oi.accessory_unit_price
                              else coalesce(ac.cost_price, 0) end) * oi.accessory_quantity end, 0)
                ) filter (where coalesce(oi.quantity, 0) > 0) as cogs
            from public.order_items oi
            left join public.products pr on pr.id = oi.product_id
            left join public.accessories ac on ac.id = oi.accessory_id
            where oi.order_id = c.id
        ) li on true
        where c.is_delivered
        group by c.seller_id
    ),
    seller_qty as (
        select c.seller_id, oi.product_id, sum(oi.quantity)::numeric as qty
        from cohort c
        join public.order_items oi on oi.order_id = c.id
        where c.is_delivered and oi.product_id is not null and coalesce(oi.quantity, 0) > 0
        group by c.seller_id, oi.product_id
    ),
    ads_share as (
        select sq.seller_id, sum((sq.qty / gq.qty) * aw.amount)::numeric as ads_share
        from seller_qty sq
        join global_qty gq on gq.product_id = sq.product_id and gq.qty > 0
        join ads_win aw on aw.product_id = sq.product_id and aw.amount > 0
        group by sq.seller_id
    ),
    comm_client as (
        select c.seller_id,
               sum(case when s.basis = 'per_unit' then coalesce(un.units, 0) * s.rate
                        else s.rate end)::numeric as commission_client
        from cohort c
        join sellers s on s.id = c.seller_id
        left join lateral (
            select sum(coalesce(oi.quantity, 0)) as units
            from public.order_items oi
            where oi.order_id = c.id
              and oi.product_id is not null
              and cardinality(s.prod_ids) > 0
              and oi.product_id::text = any(s.prod_ids)
        ) un on true
        where c.is_delivered
        group by c.seller_id
    ),
    comm_view as (
        select sde.seller_id, sum(sde.commission_earned)::numeric as commission_view
        from public.seller_daily_earnings sde
        where sde."DigiCom Business" = p_business
          and (p_from is null or sde.date >= p_from)
          and (p_to is null or sde.date <= p_to)
        group by sde.seller_id
    ),
    src as (
        select seller_id, jsonb_agg(jsonb_build_object(
                   'source', source, 'assigned', a, 'confirmed', cf, 'delivered', dl
               ) order by a desc, source) as sources
        from (
            select c.seller_id,
                   lower(coalesce(nullif(c.source_name, ''), 'other')) as source,
                   count(*)::int as a,
                   (count(*) filter (where c.confirmed_calc))::int as cf,
                   (count(*) filter (where c.is_delivered))::int as dl
            from cohort c
            group by 1, 2
        ) t group by seller_id
    ),
    pre_conf as (
        select seller_id, jsonb_agg(jsonb_build_object(
                   'order_status_id', order_status_id, 'count', n
               ) order by n desc, order_status_id) as entries
        from (
            select c.seller_id, c.order_status_id, count(*)::int as n
            from cohort c where not c.confirmed_calc
            group by 1, 2
        ) t group by seller_id
    ),
    post_conf as (
        select seller_id, jsonb_agg(jsonb_build_object(
                   'kind', kind, 'id', sid, 'count', n
               ) order by n desc, kind, sid) as entries
        from (
            select c.seller_id,
                   case when c.package_status_id is not null then 'pkg'
                        when c.order_status_id is not null then 'os'
                        else 'unset' end as kind,
                   coalesce(c.package_status_id, c.order_status_id) as sid,
                   count(*)::int as n
            from cohort c
            where c.confirmed_calc and not c.is_delivered
            group by 1, 2, 3
        ) t group by seller_id
    ),
    total_win as (
        select count(*)::int as n from pool p
        where p.date is not null
          and ((not v_has_win) or (
                (v_start is null or p.date >= v_start)
            and (case when v_end_excl is not null then p.date < v_end_excl else p.date <= v_now end)))
    )
    select jsonb_build_object(
        'total_in_window', (select n from total_win),
        'sellers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'seller_id', s.id,
                'assigned', coalesce(ct.assigned, 0),
                'confirmed', coalesce(ct.confirmed, 0),
                'delivered', coalesce(ct.delivered, 0),
                'tracked', coalesce(ct.tracked, 0),
                'pullback', coalesce(ct.pullback, 0),
                'sources', coalesce(sr.sources, '[]'::jsonb),
                'pre_conf', coalesce(pc.entries, '[]'::jsonb),
                'post_conf', coalesce(po.entries, '[]'::jsonb),
                'revenue', coalesce(f.revenue, 0),
                'cogs', coalesce(f.cogs, 0),
                'shipping', coalesce(f.shipping, 0),
                'ads_share', coalesce(a.ads_share, 0),
                'commission_view', cv.commission_view,
                'commission_client', coalesce(cc.commission_client, 0),
                'net', coalesce(f.revenue, 0) - coalesce(f.cogs, 0) - coalesce(f.shipping, 0)
                     - coalesce(a.ads_share, 0)
                     - coalesce(cv.commission_view, coalesce(cc.commission_client, 0))
            ) order by coalesce(ct.delivered, 0) desc, s.name, s.id)
            from sellers s
            left join counts ct on ct.seller_id = s.id
            left join fin f on f.seller_id = s.id
            left join ads_share a on a.seller_id = s.id
            left join comm_client cc on cc.seller_id = s.id
            left join comm_view cv on cv.seller_id = s.id
            left join src sr on sr.seller_id = s.id
            left join pre_conf pc on pc.seller_id = s.id
            left join post_conf po on po.seller_id = s.id
        ), '[]'::jsonb)
    )
    into v_sellers;

    -- ──────────────── products_performance (recon 01 §7) ───────────────────
    -- Cohort = placement-windowed, replace-excluded pool (NULL dates excluded
    -- always). Units funnel over q>0 product lines. Ads pro-rated by
    -- inclusive-day window overlap (all-time overlap window = 1970-01-01..
    -- today, like the client's epoch..now). Commission per delivered order
    -- uses the LENIENT per_unit rule (empty seller.products = all allowed) —
    -- known asymmetry vs the seller-side strict rule, replicated as-is
    -- (recon 01 §11.5). Sources: delivered counted only inside the confirmed
    -- branch. Filter ordered_units>0; sort deliveredUnits desc, revenue desc,
    -- name asc.
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
    cohort as (
        select o.id, o.shipping_cost, o.order_status_id, o.package_status_id,
               o.source_name, o.seller_id,
               coalesce(ps.is_delivered, false) as is_delivered,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               (t.order_id is not null) as has_tracking,
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
          and o.replace is distinct from true
          and o.date is not null
          and ((not v_has_win) or (
                (v_start is null or o.date >= v_start)
            and (case when v_end_excl is not null then o.date < v_end_excl else o.date <= v_now end)))
    ),
    opq as (  -- per-order total PRODUCT qty (q>0 lines) for shipping/commission allocation
        select oi.order_id, sum(oi.quantity)::numeric as qty
        from cohort c join public.order_items oi on oi.order_id = c.id
        where coalesce(oi.quantity, 0) > 0
        group by oi.order_id
    ),
    plines as (
        select oi.product_id, oi.order_id, oi.quantity::numeric as q,
               oi.total_price, oi.unit_price, oi.product_unit_cost_snapshot,
               c.is_delivered, c.has_tracking, c.pullback_flag, c.confirmed_calc,
               c.shipping_cost
        from cohort c
        join public.order_items oi on oi.order_id = c.id
        where oi.product_id is not null and coalesce(oi.quantity, 0) > 0
    ),
    units as (
        select pl.product_id,
               sum(pl.q) as ordered_units,
               coalesce(sum(pl.q) filter (where pl.confirmed_calc), 0) as confirmed_units,
               coalesce(sum(pl.q) filter (where pl.has_tracking), 0) as tracked_units,
               coalesce(sum(pl.q) filter (where pl.has_tracking and pl.pullback_flag), 0) as pullback_units,
               coalesce(sum(pl.q) filter (where pl.is_delivered), 0) as delivered_units,
               coalesce(sum(case when coalesce(pl.total_price, 0) > 0 then pl.total_price
                                 else coalesce(pl.unit_price, 0) * pl.q end)
                   filter (where pl.is_delivered), 0)::numeric as revenue,
               coalesce(sum((case when coalesce(pl.product_unit_cost_snapshot, 0) > 0
                                  then pl.product_unit_cost_snapshot
                                  else coalesce(pr.cost_price, 0) end) * pl.q)
                   filter (where pl.is_delivered), 0)::numeric as product_cogs,
               coalesce(sum(coalesce(pl.shipping_cost, 0) * pl.q / coalesce(oq.qty, pl.q))
                   filter (where pl.is_delivered), 0)::numeric as shipping_alloc
        from plines pl
        left join public.products pr on pr.id = pl.product_id
        left join opq oq on oq.order_id = pl.order_id
        group by pl.product_id
    ),
    dopq as (  -- delivered orders of each product + this product's qty therein
        select pl.product_id, pl.order_id, sum(pl.q)::numeric as qty
        from plines pl where pl.is_delivered
        group by pl.product_id, pl.order_id
    ),
    acc as (
        select oi.product_id,
               sum((case when coalesce(oi.accessory_unit_price, 0) > 0
                         then oi.accessory_unit_price
                         else coalesce(ac2.cost_price, 0) end) * oi.accessory_quantity)::numeric as accessory_cogs
        from cohort c
        join public.order_items oi on oi.order_id = c.id
        left join public.accessories ac2 on ac2.id = oi.accessory_id
        where oi.product_id is not null
          and oi.accessory_id is not null
          and coalesce(oi.accessory_quantity, 0) > 0
          and exists (select 1 from dopq d
                      where d.product_id = oi.product_id and d.order_id = oi.order_id)
        group by oi.product_id
    ),
    users_x as (
        select u.id, coalesce(u.commission_price, 0)::numeric as rate,
               case when u.commission_basis = 'per_unit' then 'per_unit' else 'per_order' end as basis,
               case when jsonb_typeof(u.products) = 'array'
                    then coalesce((select array_agg(x) from jsonb_array_elements_text(u.products) x where x <> ''), '{}'::text[])
                    else '{}'::text[] end as prod_ids
        from public.users u
        where u."DigiCom Business" = p_business
    ),
    comm as (
        select d.product_id,
               sum(case when u.rate <= 0 then 0
                        when u.basis = 'per_unit' then
                            case when cardinality(u.prod_ids) = 0
                                   or d.product_id::text = any(u.prod_ids)
                                 then d.qty * u.rate else 0 end
                        else u.rate * d.qty / coalesce(oq.qty, d.qty) end)::numeric as commission
        from dopq d
        join cohort c on c.id = d.order_id
        join users_x u on u.id = c.seller_id
        left join opq oq on oq.order_id = d.order_id
        group by d.product_id
    ),
    ads_pr as (
        select ah.product_id,
               sum(coalesce(ah.amount, 0) * f.frac)::numeric as ads_share
        from public.ads_history ah
        cross join lateral (
            select case
                when (coalesce(ah.end_date, ah.start_date) - ah.start_date + 1) <= 0 then 0
                when (least(coalesce(ah.end_date, ah.start_date), coalesce(p_to, v_today))
                      - greatest(ah.start_date, coalesce(p_from, date '1970-01-01')) + 1) <= 0 then 0
                else greatest(0::numeric, least(1::numeric,
                    (least(coalesce(ah.end_date, ah.start_date), coalesce(p_to, v_today))
                     - greatest(ah.start_date, coalesce(p_from, date '1970-01-01')) + 1)::numeric
                    / (coalesce(ah.end_date, ah.start_date) - ah.start_date + 1)))
            end as frac
        ) f
        where ah."DigiCom Business" = p_business
          and ah.product_id is not null
          and ah.start_date is not null
          and f.frac > 0
        group by ah.product_id
    ),
    pords as (  -- distinct cohort orders carrying a q>0 line of the product
        select distinct pl.product_id, pl.order_id from plines pl
    ),
    pord_flags as (
        select po.product_id, po.order_id, c.confirmed_calc, c.is_delivered,
               c.order_status_id, c.package_status_id, c.source_name
        from pords po join cohort c on c.id = po.order_id
    ),
    ord_counts as (
        select product_id,
               count(*)::int as total_orders,
               (count(*) filter (where confirmed_calc))::int as confirmed_orders,
               (count(*) filter (where is_delivered))::int as delivered_orders
        from pord_flags group by product_id
    ),
    p_src as (
        select product_id, jsonb_agg(jsonb_build_object(
                   'source', source, 'assigned', a, 'confirmed', cf, 'delivered', dl
               ) order by a desc, source) as sources
        from (
            select product_id,
                   lower(coalesce(nullif(source_name, ''), 'other')) as source,
                   count(*)::int as a,
                   (count(*) filter (where confirmed_calc))::int as cf,
                   (count(*) filter (where confirmed_calc and is_delivered))::int as dl
            from pord_flags group by 1, 2
        ) t group by product_id
    ),
    p_pre as (
        select product_id, jsonb_agg(jsonb_build_object(
                   'order_status_id', order_status_id, 'count', n
               ) order by n desc, order_status_id) as entries
        from (
            select product_id, order_status_id, count(*)::int as n
            from pord_flags where not confirmed_calc group by 1, 2
        ) t group by product_id
    ),
    p_post as (
        select product_id, jsonb_agg(jsonb_build_object(
                   'kind', kind, 'id', sid, 'count', n
               ) order by n desc, kind, sid) as entries
        from (
            select product_id,
                   case when package_status_id is not null then 'pkg'
                        when order_status_id is not null then 'os'
                        else 'unset' end as kind,
                   coalesce(package_status_id, order_status_id) as sid,
                   count(*)::int as n
            from pord_flags
            where confirmed_calc and not is_delivered
            group by 1, 2, 3
        ) t group by product_id
    )
    select jsonb_build_object(
        'products', coalesce((
            select jsonb_agg(jsonb_build_object(
                'product_id', p.id,
                'ordered_units', un.ordered_units,
                'confirmed_units', un.confirmed_units,
                'tracked_units', un.tracked_units,
                'pullback_units', un.pullback_units,
                'delivered_units', un.delivered_units,
                'total_orders', coalesce(oc.total_orders, 0),
                'confirmed_orders', coalesce(oc.confirmed_orders, 0),
                'delivered_orders', coalesce(oc.delivered_orders, 0),
                'revenue', un.revenue,
                'product_cogs', un.product_cogs,
                'accessory_cogs', coalesce(a.accessory_cogs, 0),
                'shipping_alloc', un.shipping_alloc,
                'ads_share', coalesce(ap.ads_share, 0),
                'commission', coalesce(cm.commission, 0),
                'net', un.revenue - un.product_cogs - coalesce(a.accessory_cogs, 0)
                     - un.shipping_alloc - coalesce(ap.ads_share, 0) - coalesce(cm.commission, 0),
                'sources', coalesce(ps2.sources, '[]'::jsonb),
                'pre_conf', coalesce(pp.entries, '[]'::jsonb),
                'post_conf', coalesce(pq.entries, '[]'::jsonb)
            ) order by un.delivered_units desc, un.revenue desc, p.name, p.id)
            from public.products p
            join units un on un.product_id = p.id and un.ordered_units > 0
            left join ord_counts oc on oc.product_id = p.id
            left join acc a on a.product_id = p.id
            left join ads_pr ap on ap.product_id = p.id
            left join comm cm on cm.product_id = p.id
            left join p_src ps2 on ps2.product_id = p.id
            left join p_pre pp on pp.product_id = p.id
            left join p_post pq on pq.product_id = p.id
            where p."DigiCom Business" = p_business
        ), '[]'::jsonb)
    )
    into v_products;

    return jsonb_build_object(
        'kpi_cards', v_kpi,
        'sales_chart', v_sales,
        'pending_breakdown', v_pending,
        'confirmation_pipeline', v_confirmation,
        'shipping_pipeline', v_shipping,
        'city_stats', v_city,
        'sellers_performance', v_sellers,
        'products_performance', v_products
    );
end;
$function$;

revoke all on function public.admin_dashboard_stats(uuid, date, date) from public, anon;
grant execute on function public.admin_dashboard_stats(uuid, date, date) to authenticated;
alter function public.admin_dashboard_stats(uuid, date, date) owner to postgres;

commit;
