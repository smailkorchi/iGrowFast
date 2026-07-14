-- D2 — per-role dashboard stats RPCs (contract: docs/d2-recon/05-design.md).
--
-- Kills the dashboard download storm: the admin dashboard fetched 8 independent
-- FULL-history orders copies (+ full order_items + full parcels ×2) per mount;
-- the seller pages fetched their own-orders full scan + TWO business-wide
-- parcel dumps + an order_items reverse scan; the MB dashboard downloaded the
-- whole business's order rows 3×. Each RPC below returns ONE jsonb payload with
-- a keyed section per widget, with byte-exact formula parity to the client math
-- documented in docs/d2-recon/01..04 (per-widget date anchors and NULL-date
-- rules deliberately NOT unified — see the per-section comments).
--
-- D4/D1 conventions: SECURITY INVOKER (RLS is the row gate; explicit p_business
-- = defense in depth + index driver), STABLE, `set search_path to ''`, jsonb
-- returns, grants footer, Casablanca day boundaries from yyyy-MM-dd params
-- (window null = all-time), flag-column status semantics, scope params
-- validated vs auth.uid() (business-admin override) raising 42501.
--
-- Shared vocabulary (d2-recon/04 §0, verified live 2026-07-14):
--   * pool (admin)   = "DigiCom Business" = p_business AND date_deleted IS NULL
--                      AND source_review_status <> 'pending'. The column is
--                      NOT NULL default 'approved' with 0 NULLs live, so `<>`
--                      is byte-identical to the old PostgREST `neq` (which
--                      drops NULLs) — verified before choosing this form.
--   * seller pools do NOT exclude source_review_status='pending' (parity with
--     seller pages, recon 02) — only the self-perf section (biz-wide) does.
--   * tracked        = order_id has a non-blank tracking_code in
--                      company_parcels OR courier_parcels (hashed set, never
--                      per-row subplans).
--   * rate-confirmed = tracked OR (a pending_confirmation status exists AND
--                      order_status_id IS NOT NULL AND NOT pending_confirmation)
--                      — mirrors isRateConfirmed incl. its empty-pendingIds
--                      guard (server-side the guard is the EXISTS check).
--   * pullback       = tracked AND excluded_from_delivery_rate on either the
--                      order or the package status.
--   * delivery rate (Coliaty) = delivered ÷ (tracked − pullback); clamped ≤100
--                      ONLY where the client clamps (admin KPI cards); the
--                      seller pages render the raw ratio — preserved as-is.
--   * Casablanca window: ts >= (p_from::timestamp AT TIME ZONE 'Africa/Casablanca')
--                      AND ts < ((p_to+1)::timestamp AT TIME ZONE tz). The old
--                      client used browser-local startOfDay/endOfDay — the
--                      D4 Casablanca convention is an accepted, documented delta.
--
-- Documented deviations from the old client behavior (accepted):
--   * browser-local day math → Africa/Casablanca everywhere (D4 convention).
--   * seller money `already_paid` adds the missing "DigiCom Business" filter
--     on seller_payments (client bug register d2-recon/04 §7.12; identical
--     results live — sellers belong to exactly one business).
--   * "first order_item" (seller recent-orders / product_table) is made
--     deterministic: min(created_at, id) instead of PostgREST's unspecified
--     embed order.
--   * MB month card prior_paid replicates the client literally:
--     payout_month = 'YYYY-MM' — stored rows use 'YYYY-MM-01' so this matches
--     0 rows today, exactly like the live dashboard (latent client bug kept
--     for parity; fix is a separate owner decision).
--
-- Reversible: drop the three functions and the one index.

begin;

-- ---------------------------------------------------------------------------
-- Supporting index: every dashboard cohort/count windows on orders.date
-- (placement) but no (biz, date) index existed — only the D1 created_at keyset
-- (d2-recon/04 §6.4). Partial on live rows like the rest of the family.
-- Delivery-anchored scans (coalesce(date_livraison, updated_at)) stay filter-
-- level: EXPLAIN at live scale shows the biz+date index absorbing the pool
-- scan; an expression index was evaluated and not warranted (2,109 rows).
-- ---------------------------------------------------------------------------
create index if not exists idx_orders_biz_date
  on public.orders ("DigiCom Business", date)
  where date_deleted is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 1 — admin_dashboard_stats
-- Consumer: src/pages/admin/Dashboard.tsx (all 8 widgets, d2-recon/01).
-- Caller must be a business member (orders RLS scopes rows anyway; INVOKER).
-- Per-widget window anchors + NULL-date rules (recon 01 §11 — NOT unified):
--   kpi_cards              placement o.date; NULL dates excluded ALWAYS
--                          (all-time = epoch..now(), so future dates excluded)
--   sales_chart            orders line: placement; revenue line:
--                          coalesce(date_livraison, updated_at); NULL drops out
--   pending_breakdown      placement; NULL dates pass EVERY window
--   confirmation_pipeline  same pool as pending_breakdown
--   shipping_pipeline      placement; NULLs pass only on all-time
--   city_stats             placement; NULLs pass only on all-time
--   sellers_performance    cohort coalesce(assignment_date, date); NULL anchor
--                          excluded always; totalInWindow by placement over the
--                          replace-excluded pool; no epoch/now bound on all-time
--   products_performance   placement; NULL excluded always; same no-bound rule
-- Exchange legs (replace=true): kept in kpi/sales-orders-line/pending/
-- confirmation/shipping/city counts; excluded from ALL revenue and from the
-- sellers/products sections entirely (recon 01 §11.2).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.admin_dashboard_stats(
    p_business uuid,
    p_from date default null,
    p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
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
$$;

revoke all on function public.admin_dashboard_stats(uuid, date, date) from public, anon;
grant execute on function public.admin_dashboard_stats(uuid, date, date) to authenticated;
alter function public.admin_dashboard_stats(uuid, date, date) owner to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 2 — seller_dashboard_stats
-- Consumers: src/pages/seller/{Dashboard,Statistics,Profile}.tsx +
-- src/components/dashboard/SellerSelfPerformanceSection.tsx (recon 02 + 01 §9).
-- Kills the own-orders full scan, the TWO business-wide parcel dumps per page,
-- and the Profile order_items reverse scan. Statistics keeps direct fetches
-- ONLY for real row lists (earnings history rows, payments table, presence
-- rows) — their aggregates (presence_days, total_realized) are returned here.
--
-- SECURITY: orders RLS SELECT is business-wide — p_seller is the boundary,
-- validated vs auth.uid() / business admin (D1 rule, 42501).
--
-- Sections & their pools (parity per page — deliberately NOT unified):
--   stat_strip / money / recent_orders / product_table / statistics:
--       LIFETIME pool = seller_id + biz + date_deleted IS NULL, NO
--       source_review_status filter (seller pages never had it), replace
--       excluded. (Profile's stat strip omits the biz filter client-side;
--       identical results — a seller has one business.)
--   profile_products: replicates the Profile order_items reverse scan
--       EXACTLY — only orders.seller_id filters the pool (NO date_deleted,
--       NO replace exclusion, NO biz filter on orders; parcels tracked set
--       still biz-scoped like the page).
--   self_perf: BIZ-WIDE pool (+ source_review_status <> 'pending', replace
--       excluded) windowed by p_from/p_to on coalesce(assignment_date, date);
--       total_in_window returned as a SCALAR so the seller no longer needs
--       peers' rows.
-- Rates here are UNCLAMPED (the seller pages render the raw ratio).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.seller_dashboard_stats(
    p_business uuid,
    p_seller uuid,
    p_from date default null,
    p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_now       timestamptz := now();
    v_today     date := (now() at time zone 'Africa/Casablanca')::date;
    v_today_start timestamptz := ((now() at time zone 'Africa/Casablanca')::date)::timestamp
                                     at time zone 'Africa/Casablanca';
    v_start     timestamptz := case when p_from is not null
                                    then p_from::timestamp at time zone 'Africa/Casablanca' end;
    v_end_excl  timestamptz := case when p_to is not null
                                    then (p_to + 1)::timestamp at time zone 'Africa/Casablanca' end;
    v_has_win   boolean := (p_from is not null or p_to is not null);
    v_rate      numeric;
    v_basis     text;
    v_prod_ids  text[];
    v_paid      numeric;
    v_accrued   numeric;
    v_strip     jsonb;
    v_money     jsonb;
    v_recent    jsonb;
    v_ptable    jsonb;
    v_stats     jsonb;
    v_selfperf  jsonb;
    v_profprod  jsonb;
begin
    if p_seller is distinct from (select auth.uid())
       and not coalesce(public.current_user_is_business_admin(), false) then
        raise exception 'd2_dashboard: p_seller not permitted' using errcode = '42501';
    end if;

    -- Seller commission config (normalizeCommissionBasis: 'per_unit' iff exact).
    select coalesce(u.commission_price, 0),
           case when u.commission_basis = 'per_unit' then 'per_unit' else 'per_order' end,
           case when jsonb_typeof(u.products) = 'array'
                then coalesce((select array_agg(x) from jsonb_array_elements_text(u.products) x where x <> ''), '{}'::text[])
                else '{}'::text[] end
    into v_rate, v_basis, v_prod_ids
    from public.users u where u.id = p_seller;
    v_rate := coalesce(v_rate, 0);
    v_basis := coalesce(v_basis, 'per_order');
    v_prod_ids := coalesce(v_prod_ids, '{}'::text[]);

    -- already_paid: Σ paid_amount across ALL payout rows (pending+partial+paid)
    -- — the trigger keeps paid_amount in lockstep with disbursements.
    -- DEVIATION (documented): adds the biz filter the client omits.
    select coalesce(sum(coalesce(sp.paid_amount, 0)), 0)
    into v_paid
    from public.seller_payments sp
    where sp.seller_id = p_seller and sp."DigiCom Business" = p_business;

    -- ── LIFETIME pool sections (Dashboard stat strip / money / recent /
    --    product table / Statistics extras) ─────────────────────────────────
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
    own as (
        select o.id, o.price, o.created_at, o.updated_at, o.date_livraison, o.name,
               o.order_status_id, o.package_status_id, o.master_city_id,
               coalesce(os.pending_confirmation, false) as pending_status,
               (coalesce(os.is_fake, false) or coalesce(os.is_double, false)) as fake_flag,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               coalesce(ps.is_delivered, false) as is_delivered,
               os.code as status_code,
               (t.order_id is not null) as has_tracking,
               ((t.order_id is not null)
                 or (pf.ready and o.order_status_id is not null
                     and not coalesce(os.pending_confirmation, false))) as confirmed_calc
        from public.orders o
        cross join pending_flag pf
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o.seller_id = p_seller
          and o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.replace is distinct from true
        -- NOTE: NO source_review_status filter — parity with the seller pages.
    ),
    strip as (
        select
            count(*)::int as total,
            (count(*) filter (where created_at >= v_today_start))::int as today_orders,
            (count(*) filter (where is_delivered
                and coalesce(date_livraison, updated_at) >= v_today_start
                and coalesce(date_livraison, updated_at) < v_today_start + interval '1 day'))::int as delivered_today,
            (count(*) filter (where not has_tracking and pending_status))::int as pending,
            (count(*) filter (where confirmed_calc))::int as confirmed,
            (count(*) filter (where is_delivered))::int as delivered,
            (count(*) filter (where has_tracking))::int as tracked,
            (count(*) filter (where has_tracking and pullback_flag))::int as pullback,
            (count(*) filter (where fake_flag))::int as fake_count
        from own
    ),
    accrual as (
        -- computeUnpaidCommission accrual: per_order = delivered count;
        -- per_unit = Σ assigned-product units over delivered orders (empty
        -- users.products ⇒ 0 — matches sum_order_units_for_seller_products).
        select case when v_basis = 'per_unit'
                    then coalesce(sum(un.units), 0)
                    else count(*) end::numeric as accrued_total
        from own o
        left join lateral (
            select sum(coalesce(oi.quantity, 0)) as units
            from public.order_items oi
            where oi.order_id = o.id
              and oi.product_id is not null
              and cardinality(v_prod_ids) > 0
              and oi.product_id::text = any(v_prod_ids)
        ) un on true
        where o.is_delivered
    ),
    recent as (
        select jsonb_agg(jsonb_build_object(
                   'id', r.id,
                   'order_status_id', r.order_status_id,
                   'status', coalesce(lower(nullif(r.status_code, '')), 'unknown'),
                   'price', coalesce(r.price, 0),
                   'created_at', r.created_at,
                   'customer_name', coalesce(nullif(r.name, ''), 'Unknown'),
                   'product_name', r.product_name,
                   'product_image', r.product_image
               ) order by r.created_at desc, r.id) as rows
        from (
            select o.id, o.order_status_id, o.status_code, o.price, o.created_at, o.name,
                   fi.product_name, fi.product_image
            from own o
            left join lateral (
                select p2.name as product_name, p2.image_url as product_image
                from public.order_items oi
                left join public.products p2 on p2.id = oi.product_id
                where oi.order_id = o.id
                order by oi.created_at, oi.id
                limit 1
            ) fi on true
            order by o.created_at desc, o.id
            limit 10
        ) r
    ),
    ptable as (
        -- Dashboard per-product table: grouped by the FIRST order_item's
        -- product NAME ('Unknown' when absent); orders with no items skipped;
        -- revenue = Σ order.price over delivered (seller TOTAL display rule).
        -- Image = first-seen (orders id-ordered, like the client's map build).
        select jsonb_agg(jsonb_build_object(
                   'name', g.pname, 'image', g.image,
                   'total', g.total, 'tracked', g.tracked, 'pullback', g.pullback,
                   'delivered', g.delivered, 'revenue', g.revenue
               ) order by g.revenue desc, g.pname) as rows
        from (
            select f.pname,
                   (array_agg(f.pimage order by f.oid))[1] as image,
                   count(*)::int as total,
                   (count(*) filter (where f.has_tracking))::int as tracked,
                   (count(*) filter (where f.has_tracking and f.pullback_flag))::int as pullback,
                   (count(*) filter (where f.is_delivered))::int as delivered,
                   coalesce(sum(coalesce(f.price, 0)) filter (where f.is_delivered), 0)::numeric as revenue
            from (
                select o.id as oid, o.price, o.has_tracking, o.pullback_flag, o.is_delivered,
                       coalesce(nullif(fi.pname, ''), 'Unknown') as pname, fi.pimage
                from own o
                join lateral (
                    select p2.name as pname, p2.image_url as pimage
                    from public.order_items oi
                    left join public.products p2 on p2.id = oi.product_id
                    where oi.order_id = o.id
                    order by oi.created_at, oi.id
                    limit 1
                ) fi on true
            ) f
            group by f.pname
        ) g
    ),
    stat_dist as (
        select jsonb_agg(jsonb_build_object('order_status_id', t.order_status_id, 'count', t.n)
                         order by t.n desc, t.order_status_id) as rows
        from (select order_status_id, count(*)::int as n from own group by 1) t
    ),
    regional as (
        select jsonb_agg(jsonb_build_object('city', t.city, 'delivered', t.n)
                         order by t.n desc, t.city) as rows
        from (
            select coalesce(nullif(mc.name, ''), 'Unknown') as city, count(*)::int as n
            from own o
            left join public.master_cities mc on mc.id = o.master_city_id
            where o.is_delivered
            group by 1
        ) t
    ),
    prod_perf as (
        -- Statistics per-product cards: attributed/tracked/pullback/delivered
        -- counted ONCE per product per order; revenue = Σ unit_price×qty per
        -- LINE on delivered orders; name 'Generic Item' when the line has no
        -- product; top 5 by delivered.
        select jsonb_agg(jsonb_build_object(
                   'name', g.pname, 'image', g.image,
                   'attributed', g.attributed, 'tracked', g.tracked,
                   'pullback', g.pullback, 'delivered', g.delivered,
                   'revenue', g.revenue
               ) order by g.delivered desc, g.pname) as rows
        from (
            select l.pname,
                   (array_agg(l.pimage order by l.oid, l.icreated, l.iid))[1] as image,
                   count(distinct l.oid)::int as attributed,
                   count(distinct l.oid) filter (where l.has_tracking)::int as tracked,
                   count(distinct l.oid) filter (where l.has_tracking and l.pullback_flag)::int as pullback,
                   count(distinct l.oid) filter (where l.is_delivered)::int as delivered,
                   coalesce(sum(l.line_rev) filter (where l.is_delivered), 0)::numeric as revenue
            from (
                select o.id as oid, o.has_tracking, o.pullback_flag, o.is_delivered,
                       coalesce(nullif(p2.name, ''), 'Generic Item') as pname,
                       p2.image_url as pimage,
                       oi.created_at as icreated, oi.id as iid,
                       coalesce(oi.unit_price, 0) * coalesce(oi.quantity, 0) as line_rev
                from own o
                join public.order_items oi on oi.order_id = o.id
                left join public.products p2 on p2.id = oi.product_id
            ) l
            group by l.pname
            order by delivered desc, l.pname
            limit 5
        ) g
    )
    select
        jsonb_build_object(
            'today_orders', s.today_orders,
            'delivered_today', s.delivered_today,
            'pending', s.pending,
            'confirmed', s.confirmed,
            'delivered', s.delivered,
            'total', s.total,
            'tracked', s.tracked,
            'pullback', s.pullback,
            'success_rate', case when (s.tracked - s.pullback) > 0
                then s.delivered::numeric * 100 / (s.tracked - s.pullback) else 0 end,
            'confirm_rate', case when s.total > 0
                then s.confirmed::numeric * 100 / s.total else 0 end
        ),
        a.accrued_total,
        coalesce(r.rows, '[]'::jsonb),
        coalesce(pt.rows, '[]'::jsonb),
        jsonb_build_object(
            'status_distribution', coalesce(sd.rows, '[]'::jsonb),
            'regional', coalesce(rg.rows, '[]'::jsonb),
            'product_perf', coalesce(ppf.rows, '[]'::jsonb),
            'fake_count', s.fake_count,
            'presence_days', (select count(*) from public.seller_presences spr
                              where spr.seller_id = p_seller),
            'total_realized', v_paid
        )
    into v_strip, v_accrued, v_recent, v_ptable, v_stats
    from strip s, accrual a, recent r, ptable pt, stat_dist sd, regional rg, prod_perf ppf;

    v_money := jsonb_build_object(
        'commission_rate', v_rate,
        'commission_basis', v_basis,
        'already_paid', v_paid,
        'accrued_total', v_accrued,
        'earned_commission', v_accrued * v_rate,
        'live_commission', greatest(0, v_accrued * v_rate - v_paid),
        'unpaid_deliveries', case when v_rate > 0
            then greatest(0, v_accrued * v_rate - v_paid) / v_rate else 0 end
    );

    -- ── self_perf (windowed; SellerSelfPerformanceSection parity) ──────────
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
        select o.id, o.date, o.seller_id, o.source_name,
               o.order_status_id, o.package_status_id,
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
    cohort as (
        select p.* from pool p
        where p.seller_id = p_seller
          and p.cohort_anchor is not null
          and ((not v_has_win) or (
                (v_start is null or p.cohort_anchor >= v_start)
            and (case when v_end_excl is not null then p.cohort_anchor < v_end_excl else p.cohort_anchor <= v_now end)))
    ),
    counts as (
        select count(*)::int as assigned,
               (count(*) filter (where confirmed_calc))::int as confirmed,
               (count(*) filter (where is_delivered))::int as delivered,
               (count(*) filter (where has_tracking))::int as tracked,
               (count(*) filter (where has_tracking and pullback_flag))::int as pullback
        from cohort
    ),
    total_win as (
        select count(*)::int as n from pool p
        where p.date is not null
          and ((not v_has_win) or (
                (v_start is null or p.date >= v_start)
            and (case when v_end_excl is not null then p.date < v_end_excl else p.date <= v_now end)))
    ),
    comm_client as (
        select coalesce(sum(case when v_basis = 'per_unit'
                                 then coalesce(un.units, 0) * v_rate
                                 else v_rate end), 0)::numeric as commission_client
        from cohort c
        left join lateral (
            select sum(coalesce(oi.quantity, 0)) as units
            from public.order_items oi
            where oi.order_id = c.id
              and oi.product_id is not null
              and cardinality(v_prod_ids) > 0
              and oi.product_id::text = any(v_prod_ids)
        ) un on true
        where c.is_delivered
    ),
    comm_view as (
        -- NULL when the seller has no in-window view rows (client `?? null`).
        select sum(sde.commission_earned)::numeric as commission_view
        from public.seller_daily_earnings sde
        where sde."DigiCom Business" = p_business
          and sde.seller_id = p_seller
          and (p_from is null or sde.date >= p_from)
          and (p_to is null or sde.date <= p_to)
        having count(*) > 0
    ),
    src as (
        select jsonb_agg(jsonb_build_object(
                   'source', source, 'assigned', a, 'confirmed', cf, 'delivered', dl
               ) order by a desc, source) as sources
        from (
            select lower(coalesce(nullif(source_name, ''), 'other')) as source,
                   count(*)::int as a,
                   (count(*) filter (where confirmed_calc))::int as cf,
                   (count(*) filter (where is_delivered))::int as dl
            from cohort group by 1
        ) t
    ),
    pre_conf as (
        select jsonb_agg(jsonb_build_object('order_status_id', order_status_id, 'count', n)
                         order by n desc, order_status_id) as entries
        from (
            select order_status_id, count(*)::int as n
            from cohort where not confirmed_calc group by 1
        ) t
    ),
    post_conf as (
        select jsonb_agg(jsonb_build_object('kind', kind, 'id', sid, 'count', n)
                         order by n desc, kind, sid) as entries
        from (
            select case when package_status_id is not null then 'pkg'
                        when order_status_id is not null then 'os'
                        else 'unset' end as kind,
                   coalesce(package_status_id, order_status_id) as sid,
                   count(*)::int as n
            from cohort
            where confirmed_calc and not is_delivered
            group by 1, 2
        ) t
    )
    select jsonb_build_object(
        'total_in_window', (select n from total_win),
        'assigned', c.assigned,
        'confirmed', c.confirmed,
        'delivered', c.delivered,
        'tracked', c.tracked,
        'pullback', c.pullback,
        'sources', coalesce((select sources from src), '[]'::jsonb),
        'pre_conf', coalesce((select entries from pre_conf), '[]'::jsonb),
        'post_conf', coalesce((select entries from post_conf), '[]'::jsonb),
        'commission_view', (select commission_view from comm_view),
        'commission_client', (select commission_client from comm_client)
    )
    into v_selfperf
    from counts c;

    -- ── profile_products (Profile order_items reverse scan parity) ─────────
    -- Pool = orders.seller_id ONLY (the page's reverse scan has NO
    -- date_deleted / replace / biz filters — replicated exactly). One row per
    -- attributed product id (users.products); `confirmed` = is_confirmed flag
    -- set (different from rate_confirmed — both returned, like the page).
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
    prof_pool as (
        select o.id, o.order_status_id, o.package_status_id,
               coalesce(os.is_confirmed, false) as is_confirmed_flag,
               coalesce(os.pending_confirmation, false) as pending_status,
               (coalesce(os.excluded_from_delivery_rate, false)
                 or coalesce(ps.excluded_from_delivery_rate, false)) as pullback_flag,
               coalesce(ps.is_delivered, false) as is_delivered,
               (t.order_id is not null) as has_tracking,
               pf.ready
        from public.orders o
        cross join pending_flag pf
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        left join tracked t on t.order_id = o.id
        where o.seller_id = p_seller
    ),
    attributed as (
        select distinct x as pid from unnest(v_prod_ids) x
    ),
    item_pairs as (  -- distinct (product, order) pairs — hashed, no per-row subplans
        select distinct oi.product_id::text as pid, oi.order_id
        from public.order_items oi
        where oi.product_id is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
               'product_id', t.pid,
               'total', t.total,
               'tracked', t.tracked,
               'pullback', t.pullback,
               'confirmed', t.confirmed,
               'rate_confirmed', t.rate_confirmed,
               'delivered', t.delivered
           ) order by t.pid), '[]'::jsonb)
    into v_profprod
    from (
        select a.pid,
               count(p.id)::int as total,
               (count(*) filter (where p.has_tracking))::int as tracked,
               (count(*) filter (where p.has_tracking and p.pullback_flag))::int as pullback,
               (count(*) filter (where p.is_confirmed_flag))::int as confirmed,
               (count(*) filter (where p.has_tracking
                   or (p.ready and p.order_status_id is not null and not p.pending_status)))::int as rate_confirmed,
               (count(*) filter (where p.is_delivered))::int as delivered
        from attributed a
        left join item_pairs ip on ip.pid = a.pid
        left join prof_pool p on p.id = ip.order_id
        group by a.pid
    ) t;

    return jsonb_build_object(
        'stat_strip', v_strip,
        'money', v_money,
        'recent_orders', v_recent,
        'product_table', v_ptable,
        'statistics', v_stats,
        'self_perf', v_selfperf,
        'profile_products', v_profprod
    );
end;
$$;

revoke all on function public.seller_dashboard_stats(uuid, uuid, date, date) from public, anon;
grant execute on function public.seller_dashboard_stats(uuid, uuid, date, date) to authenticated;
alter function public.seller_dashboard_stats(uuid, uuid, date, date) owner to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 3 — mb_dashboard_stats
-- Consumers: src/pages/mediabuyer/{Dashboard,Statistics}.tsx via
-- useMediaBuyerStats + useMediaBuyerEarnings (recon 03).
--
-- HARD RULE (MB-facing data rule): the payload exposes ONLY the recon-verified
-- MB surface — OWN spend/leads (self-entered), confirmed/livré counts on own
-- (day, source) buckets, own campaign metadata, own month earnings. NO order
-- money columns, NO business revenue/ROAS/profit, NO peers' rows. Revenue /
-- ROAS / profit stay CLIENT-side derivations from the MB's own commission_price
-- (own-commission semantics per campaign-report-role-semantics) — deliberately
-- NOT returned here so the payload greps clean.
--
-- Attribution (parity with the client engine + mb_month_earned):
--   * entries by created_by = p_mb (denormalized key, orphan-safe).
--   * order buckets keyed (Casablanca day of orders.date, lower(source_name)),
--     pool = biz + date_deleted IS NULL + source_review_status <> 'pending'
--     + replace IS DISTINCT FROM true (the client's exchange guard — kept over
--     mb_month_earned's swap_only form; coincident live, recon 03 §divergence 1).
--   * confirmed = pending-flag-exists AND status NOT NULL AND NOT
--     pending_confirmation (NO tracking override — MB engine differs from
--     admin isRateConfirmed here, by design).
--   * delivered = package_statuses.is_delivered.
--   * daily/platform totals count each (day, source) bucket ONCE; per-campaign
--     rows RE-COUNT the bucket per campaign (documented client behavior).
--   * platform→source map = the shared 12-entry CASE (unmapped ⇒ '' ⇒ no join).
-- month_earnings replicates useMediaBuyerEarnings CLIENT math for the current
-- Casablanca month (delivered × own commission_price for 'commission',
-- salary_amount flat for 'salary'; prior_paid = Σ mediabuyer_payments.
-- total_amount with payout_month = 'YYYY-MM' — client-literal, see header).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.mb_dashboard_stats(
    p_business uuid,
    p_mb uuid,
    p_from date default null,
    p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_today      date := (now() at time zone 'Africa/Casablanca')::date;
    v_month      text := to_char((now() at time zone 'Africa/Casablanca')::date, 'YYYY-MM');
    v_month_from date := date_trunc('month', (now() at time zone 'Africa/Casablanca')::date)::date;
    v_month_to   date := (date_trunc('month', (now() at time zone 'Africa/Casablanca')::date)
                          + interval '1 month' - interval '1 day')::date;
    v_payment_type text;
    v_comm_price numeric;
    v_salary     numeric;
    v_result     jsonb;
begin
    if p_mb is distinct from (select auth.uid())
       and not coalesce(public.current_user_is_business_admin(), false) then
        raise exception 'd2_dashboard: p_mb not permitted' using errcode = '42501';
    end if;

    select u.payment_type, coalesce(u.commission_price, 0), coalesce(u.salary_amount, 0)
    into v_payment_type, v_comm_price, v_salary
    from public.users u where u.id = p_mb;

    with entries_w as (
        select e.entry_date, e.platform, e.campaign_id,
               coalesce(e.spend, 0)::numeric as spend,
               coalesce(e.leads, 0)::int as leads,
               case lower(e.platform)
                   when 'whatsapp ads'  then 'whatsapp'
                   when 'messenger ads' then 'messenger'
                   when 'instagram ads' then 'instagram'
                   when 'facebook ads'  then 'facebook'
                   when 'google ads'    then 'google'
                   when 'tiktok ads'    then 'tiktok'
                   when 'native ads'    then 'native'
                   when 'snapchat ads'  then 'snapchat'
                   when 'twitter ads'   then 'twitter'
                   when 'bing ads'      then 'bing'
                   when 'pinterest ads' then 'pinterest'
                   when 'reddit ads'    then 'reddit'
                   else ''
               end as src
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.created_by = p_mb
          and (p_from is null or e.entry_date >= p_from)
          and (p_to is null or e.entry_date <= p_to)
    ),
    entries_m as (
        select e.entry_date, e.platform, e.campaign_id,
               coalesce(e.spend, 0)::numeric as spend,
               case lower(e.platform)
                   when 'whatsapp ads'  then 'whatsapp'
                   when 'messenger ads' then 'messenger'
                   when 'instagram ads' then 'instagram'
                   when 'facebook ads'  then 'facebook'
                   when 'google ads'    then 'google'
                   when 'tiktok ads'    then 'tiktok'
                   when 'native ads'    then 'native'
                   when 'snapchat ads'  then 'snapchat'
                   when 'twitter ads'   then 'twitter'
                   when 'bing ads'      then 'bing'
                   when 'pinterest ads' then 'pinterest'
                   when 'reddit ads'    then 'reddit'
                   else ''
               end as src
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.created_by = p_mb
          and e.entry_date >= v_month_from
          and e.entry_date <= v_month_to
    ),
    pending_flag as (
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    pairs as (
        select distinct entry_date as d, src from entries_w where src <> ''
        union
        select distinct entry_date as d, src from entries_m where src <> ''
    ),
    buckets as (
        select pr.d, pr.src,
               (count(*) filter (where pf.ready and o.order_status_id is not null
                    and not coalesce(os.pending_confirmation, false)))::int as confirmed,
               (count(*) filter (where coalesce(ps.is_delivered, false)))::int as delivered
        from pairs pr
        cross join pending_flag pf
        join public.orders o
          on o."DigiCom Business" = p_business
         and o.date_deleted is null
         and o.source_review_status <> 'pending'
         and o.replace is distinct from true
         and o.source_name is not null
         and lower(o.source_name) = pr.src
         and (o.date at time zone 'Africa/Casablanca')::date = pr.d
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        group by pr.d, pr.src, pf.ready
    ),
    d_rows as (
        select entry_date as d, sum(spend)::numeric as spend, sum(leads)::int as leads
        from entries_w group by entry_date
    ),
    d_srcs as (select distinct entry_date as d, src from entries_w),
    d_ord as (
        select ds.d,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from d_srcs ds
        left join buckets b on b.d = ds.d and b.src = ds.src
        group by ds.d
    ),
    daily as (
        select dr.d, dr.spend, dr.leads,
               coalesce(dq.confirmed, 0) as confirmed,
               coalesce(dq.delivered, 0) as delivered
        from d_rows dr left join d_ord dq on dq.d = dr.d
    ),
    p_rows as (
        select platform, max(src) as src,
               sum(spend)::numeric as spend, sum(leads)::int as leads
        from entries_w group by platform
    ),
    p_days as (select distinct platform, entry_date as d, src from entries_w),
    p_ord as (
        select pd.platform,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from p_days pd
        left join buckets b on b.d = pd.d and b.src = pd.src
        group by pd.platform
    ),
    c_rows as (
        select case when c.id is not null then c.id::text
                    else '__deleted__' || e.platform end as ckey,
               c.id as campaign_id,
               coalesce(c.name, '(Deleted) ' || e.platform) as name,
               coalesce(c.platform, e.platform) as platform,
               coalesce(c.status, 'deleted') as status,
               case when c.id is not null then c.currency else 'MAD' end as currency,
               e.entry_date, e.src, e.spend, e.leads
        from entries_w e
        left join public.campaigns c
          on c.id = e.campaign_id
         and c."DigiCom Business" = p_business
         and c.created_by = p_mb
    ),
    c_agg as (
        select ckey, max(campaign_id::text) as campaign_id,
               max(name) as name, max(platform) as platform,
               max(status) as status, max(currency) as currency,
               sum(spend)::numeric as spend, sum(leads)::int as leads
        from c_rows group by ckey
    ),
    c_days as (select distinct ckey, entry_date as d, src from c_rows),
    c_ord as (
        select cd.ckey,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from c_days cd
        left join buckets b on b.d = cd.d and b.src = cd.src
        group by cd.ckey
    ),
    month_pairs as (select distinct entry_date as d, src from entries_m where src <> ''),
    month_agg as (
        select
            (select coalesce(sum(spend), 0) from entries_m)::numeric as total_spend,
            (select count(distinct coalesce(campaign_id::text, '__orphan__' || platform))
             from entries_m)::int as campaigns_count,
            coalesce((select sum(b.delivered)
                      from month_pairs mp
                      join buckets b on b.d = mp.d and b.src = mp.src), 0)::int as delivered
    ),
    prior_paid as (
        select coalesce(sum(coalesce(mp.total_amount, 0)), 0)::numeric as amount
        from public.mediabuyer_payments mp
        where mp."DigiCom Business" = p_business
          and mp.mediabuyer_id = p_mb
          and mp.payout_month = v_month
    )
    select jsonb_build_object(
        'totals', (
            select jsonb_build_object(
                'spend', coalesce(sum(spend), 0),
                'leads', coalesce(sum(leads), 0),
                'confirmed', coalesce(sum(confirmed), 0),
                'delivered', coalesce(sum(delivered), 0)
            ) from daily
        ),
        'daily', coalesce((
            select jsonb_agg(jsonb_build_object(
                'date', d, 'spend', spend, 'leads', leads,
                'confirmed', confirmed, 'delivered', delivered
            ) order by d)
            from daily), '[]'::jsonb),
        'per_platform', coalesce((
            select jsonb_agg(jsonb_build_object(
                'platform', pr.platform, 'spend', pr.spend, 'leads', pr.leads,
                'confirmed', coalesce(po.confirmed, 0),
                'delivered', coalesce(po.delivered, 0)
            ) order by pr.spend desc, pr.platform)
            from p_rows pr left join p_ord po on po.platform = pr.platform), '[]'::jsonb),
        'per_campaign', coalesce((
            select jsonb_agg(jsonb_build_object(
                'key', ca.ckey,
                'campaign_id', ca.campaign_id,
                'name', ca.name, 'platform', ca.platform,
                'status', ca.status, 'currency', ca.currency,
                'spend', ca.spend, 'leads', ca.leads,
                'confirmed', coalesce(co.confirmed, 0),
                'delivered', coalesce(co.delivered, 0)
            ) order by ca.ckey)
            from c_agg ca left join c_ord co on co.ckey = ca.ckey), '[]'::jsonb),
        'today_entry_campaign_ids', coalesce((
            select jsonb_agg(distinct e.campaign_id)
            from public.campaign_daily_entries e
            where e."DigiCom Business" = p_business
              and e.created_by = p_mb
              and e.entry_date = v_today
              and e.campaign_id is not null), '[]'::jsonb),
        'month_earnings', (
            select jsonb_build_object(
                'month', v_month,
                'delivered_orders', ma.delivered,
                'total_spend', ma.total_spend,
                'campaigns_count', ma.campaigns_count,
                'salary_earned', case when v_payment_type = 'salary' then v_salary else 0 end,
                'commission_earned', case when v_payment_type = 'commission'
                    then ma.delivered * v_comm_price else 0 end,
                'total_amount',
                    (case when v_payment_type = 'salary' then v_salary else 0 end)
                  + (case when v_payment_type = 'commission' then ma.delivered * v_comm_price else 0 end),
                'prior_paid_amount', pp.amount,
                'remaining_amount', greatest(0,
                    (case when v_payment_type = 'salary' then v_salary else 0 end)
                  + (case when v_payment_type = 'commission' then ma.delivered * v_comm_price else 0 end)
                  - pp.amount)
            )
            from month_agg ma, prior_paid pp
        )
    )
    into v_result;

    return v_result;
end;
$$;

revoke all on function public.mb_dashboard_stats(uuid, uuid, date, date) from public, anon;
grant execute on function public.mb_dashboard_stats(uuid, uuid, date, date) to authenticated;
alter function public.mb_dashboard_stats(uuid, uuid, date, date) owner to postgres;

commit;
