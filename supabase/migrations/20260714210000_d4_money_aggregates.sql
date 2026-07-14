-- D4 — money-correctness server aggregates (W7 Phase D wave 1, MASTER_TODO §3).
--
-- Kills the wrong-money class: client-side reduce() over bare selects silently
-- capped at 1000 rows by PostgREST. Every money KPI below moves to a
-- SECURITY INVOKER aggregate (RLS scopes visibility; explicit p_business filter
-- for index use). Authored per-page by the D4 implementation wave; each block
-- names its consumer page(s). Companion FE commit swaps the pages to these RPCs
-- and converts completeness-critical fetches to fetchAllRows.
--
-- Reversible: drop each function.

begin;


-- ════════ ads-history ════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Consumer: src/pages/AdsHistory.tsx ("Product Ads" — admin route + /mediabuyer view).
--
-- Replaces two client-side defects:
--   1. KPI strip (total spend + per-platform spend) reduced over a bare
--      ads_history fetch silently capped at 1000 rows.
--   2. Per-campaign attribution pulled the FULL business order history
--      (orders + order_items + status joins) to the client and filtered there.
--
-- ads_history_metrics returns one jsonb payload:
--   {
--     total_spend:      numeric,
--     platform_totals:  [{platform, spend}],           -- desc by spend
--     per_campaign:     [{ads_history_id, total_orders, confirmed_orders,
--                         delivered_orders, cancelled_orders, fake_orders,
--                         tracked_orders, pullback_orders, gross_revenue,
--                         shipping_costs, cost_price}]  -- one row per campaign,
--                                                       -- zeros when no orders
--   }
--
-- Order→campaign matching replicates the page's client logic exactly:
--   * same business, date_deleted IS NULL, replace IS NOT true (exchange legs excluded)
--   * order's Casablanca-local calendar date within [start_date, end_date]
--     (same convention as public.mediabuyer_month_orders)
--   * lower(orders.source_name) equals the platform→source map of ads_history.method
--     (unmapped methods match nothing, like the client's empty-string guard)
--   * at least one order_items row carries the campaign's product_id
-- Status tallies use the owner-governable flag columns (the same flags
-- useStatusCategories exposes client-side):
--   delivered  = package_statuses.is_delivered
--   cancelled  = NOT delivered AND order_statuses.is_cancelled AND NOT (is_fake OR is_double)
--   fake       = NOT delivered AND order_statuses.is_cancelled AND (is_fake OR is_double)
--   confirmed  = has tracking OR (a pending_confirmation status exists AND the
--                order's status is non-null and not pending) — mirrors the
--                client's statusMapsReady guard
--   tracked    = order_id has a non-empty tracking_code in company_parcels or
--                courier_parcels for the business (useTrackedOrders semantics)
--   pullback   = tracked AND excluded_from_delivery_rate on either the order
--                or package status (isAdminPullback semantics)
--
-- SECURITY INVOKER: RLS scopes the data to the caller's business; the explicit
-- p_business filter is defense in depth + index use.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ads_history_metrics(
    p_business uuid,
    p_created_by uuid default null,
    p_from date default null,
    p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
with campaigns as (
    select
        ah.id,
        ah.product_id,
        ah.method,
        ah.amount,
        ah.start_date,
        ah.end_date,
        case lower(ah.method)
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
        end as source_name
    from public.ads_history ah
    where ah."DigiCom Business" = p_business
      and (p_created_by is null or ah.created_by = p_created_by)
      and (p_from is null or ah.end_date >= p_from)
      and (p_to is null or ah.start_date <= p_to)
),
pending_flag as (
    select exists (
        select 1 from public.order_statuses where pending_confirmation
    ) as pending_exists
),
tracked as (
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
matched as (
    select
        c.id as campaign_id,
        o.id as order_id,
        coalesce(o.price, 0) as price,
        coalesce(o.shipping_cost, 0) as shipping_cost,
        coalesce(ps.is_delivered, false) as is_delivered,
        coalesce(os.is_cancelled, false) as is_cancelled,
        (coalesce(os.is_fake, false) or coalesce(os.is_double, false)) as is_fake_or_double,
        (t.order_id is not null) as has_tracking,
        (pf.pending_exists
            and o.order_status_id is not null
            and coalesce(os.pending_confirmation, false) = false) as not_pending,
        (coalesce(os.excluded_from_delivery_rate, false)
            or coalesce(ps.excluded_from_delivery_rate, false)) as is_pullback
    from campaigns c
    cross join pending_flag pf
    join public.orders o
      on o."DigiCom Business" = p_business
     and o.date_deleted is null
     and o.replace is distinct from true
     and c.source_name <> ''
     and lower(coalesce(o.source_name, '')) = c.source_name
     and o.date >= (c.start_date::timestamp at time zone 'Africa/Casablanca')
     and o.date <  ((c.end_date + 1)::timestamp at time zone 'Africa/Casablanca')
    left join public.order_statuses os on os.id = o.order_status_id
    left join public.package_statuses ps on ps.id = o.package_status_id
    left join tracked t on t.order_id = o.id
    where exists (
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and oi.product_id = c.product_id
    )
),
per_campaign as (
    select
        c.id,
        c.product_id,
        count(m.order_id)::int as total_orders,
        (count(*) filter (where m.is_delivered))::int as delivered_orders,
        (count(*) filter (where not m.is_delivered and m.is_cancelled and not m.is_fake_or_double))::int as cancelled_orders,
        (count(*) filter (where not m.is_delivered and m.is_cancelled and m.is_fake_or_double))::int as fake_orders,
        (count(*) filter (where m.has_tracking or m.not_pending))::int as confirmed_orders,
        (count(*) filter (where m.has_tracking))::int as tracked_orders,
        (count(*) filter (where m.has_tracking and m.is_pullback))::int as pullback_orders,
        coalesce(sum(m.price) filter (where m.is_delivered), 0) as gross_revenue,
        coalesce(sum(m.shipping_cost) filter (where m.is_delivered), 0) as shipping_costs
    from campaigns c
    left join matched m on m.campaign_id = c.id
    group by c.id, c.product_id
)
select jsonb_build_object(
    'total_spend', coalesce((select sum(amount) from campaigns), 0),
    'platform_totals', coalesce(
        (
            select jsonb_agg(
                jsonb_build_object('platform', pt.method, 'spend', pt.spend)
                order by pt.spend desc
            )
            from (
                select method, sum(amount) as spend
                from campaigns
                group by method
            ) pt
        ),
        '[]'::jsonb
    ),
    'per_campaign', coalesce(
        (
            select jsonb_agg(jsonb_build_object(
                'ads_history_id', pc.id,
                'total_orders', pc.total_orders,
                'confirmed_orders', pc.confirmed_orders,
                'delivered_orders', pc.delivered_orders,
                'cancelled_orders', pc.cancelled_orders,
                'fake_orders', pc.fake_orders,
                'tracked_orders', pc.tracked_orders,
                'pullback_orders', pc.pullback_orders,
                'gross_revenue', pc.gross_revenue,
                'shipping_costs', pc.shipping_costs,
                'cost_price', coalesce(p.cost_price, 0)
            ))
            from per_campaign pc
            left join public.products p on p.id = pc.product_id
        ),
        '[]'::jsonb
    )
);
$$;

revoke all on function public.ads_history_metrics(uuid, uuid, date, date) from public, anon;
grant execute on function public.ads_history_metrics(uuid, uuid, date, date) to authenticated;
alter function public.ads_history_metrics(uuid, uuid, date, date) owner to postgres;

-- ════════ catalog ════════
-- ============================================================================
-- D4 · Catalog KPI aggregates
-- Consumers:
--   src/pages/admin/Products.tsx    (KPI strip: count / active / units / inventory cost / inventory value)
--   src/pages/admin/Accessories.tsx (KPI strip: count / active / units / inventory cost)
-- Replaces client-side reduce() over bare PostgREST selects (silently capped at
-- 1000 rows by PGRST_DB_MAX_ROWS) with server-side SUMs so money KPIs stay
-- correct at any catalog size. SECURITY INVOKER: RLS scopes row visibility;
-- the explicit "DigiCom Business" filter is defense in depth + index use.
-- ============================================================================

create or replace function public.catalog_totals(p_business uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    select jsonb_build_object(
        'products', (
            select jsonb_build_object(
                'count',           count(*),
                'active_count',    count(*) filter (where p.active),
                'stock_sum',       coalesce(sum(coalesce(p.stock, 0)), 0),
                'inventory_cost',  coalesce(sum(coalesce(p.stock, 0)::numeric * coalesce(p.cost_price, 0)), 0),
                'inventory_value', coalesce(sum(coalesce(p.stock, 0)::numeric * coalesce(p.selling_price, 0)), 0),
                'low_stock_count', count(*) filter (where coalesce(p.stock, 0) <= 10)
            )
            from public.products p
            where p."DigiCom Business" = p_business
        ),
        'accessories', (
            select jsonb_build_object(
                'count',           count(*),
                'active_count',    count(*) filter (where a.active),
                'stock_sum',       coalesce(sum(coalesce(a.stock, 0)), 0),
                'inventory_cost',  coalesce(sum(coalesce(a.stock, 0)::numeric * coalesce(a.cost_price, 0)), 0),
                'low_stock_count', count(*) filter (where coalesce(a.stock, 0) <= 10)
            )
            from public.accessories a
            where a."DigiCom Business" = p_business
        )
    );
$$;

revoke all on function public.catalog_totals(uuid) from public, anon;
grant execute on function public.catalog_totals(uuid) to authenticated;
alter function public.catalog_totals(uuid) owner to postgres;

-- ════════ money-admin ════════
-- D4 money-admin: server-side KPI aggregates replacing client reduce() over
-- PostgREST selects capped at 1000 rows (PGRST_DB_MAX_ROWS).
--
-- Consumers:
--   * src/pages/admin/ExpensesDetails.tsx -> public.expenses_totals(uuid)
--       KPI strip: "This month" / "All time" / "Records" / "Avg ticket"
--       (avg is derived client-side as all_time / count).
--   * src/pages/admin/Transactions.tsx    -> public.transactions_totals(uuid)
--       KPI strip: "Transactions" / "Invoiced" / "Paid" / "Outstanding"
--       + status-tab counts (all / paid / partial / unpaid).
--
-- Both SECURITY INVOKER: caller's RLS scopes the rows; the explicit
-- "DigiCom Business" filter is defense-in-depth + drives the
-- idx_expenses_digicom_business / idx_transactions_digicom_business indexes.
--
-- Status semantics mirror the page's getPaymentStatus() EXACTLY
-- (Transactions.tsx L99-106):
--   paid    = total > 0 AND (total - paid) <= 0
--   partial = paid  > 0 AND (total - paid) >  0
--   unpaid  = everything else (including total=0 rows)
-- outstanding = sum(greatest(total - paid, 0))  -- per-row clamp, like the page.

-- ---------------------------------------------------------------------------
-- expenses_totals: all-time total, current-month total, record count.
-- this_month boundary = date_trunc('month', now()) (DB is UTC; the old client
-- math used the browser-local month start — at worst a 1h drift at boundaries).
-- ---------------------------------------------------------------------------
create or replace function public.expenses_totals(p_business uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    select jsonb_build_object(
        'all_time',   coalesce(sum(e.amount), 0),
        'this_month', coalesce(sum(e.amount) filter (where e.date >= date_trunc('month', now())), 0),
        'count',      count(*)
    )
    from public.expenses e
    where e."DigiCom Business" = p_business;
$$;

revoke all on function public.expenses_totals(uuid) from public, anon;
grant execute on function public.expenses_totals(uuid) to authenticated;
alter function public.expenses_totals(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- transactions_totals: invoiced / paid / outstanding sums + status counts.
-- ---------------------------------------------------------------------------
create or replace function public.transactions_totals(p_business uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    with t as (
        select coalesce(tx.total_price, 0) as total,
               coalesce(tx.paid_price, 0)  as paid
        from public.transactions tx
        where tx."DigiCom Business" = p_business
    ), s as (
        select total, paid,
               case
                   when total > 0 and (total - paid) <= 0 then 'paid'
                   when paid > 0 and (total - paid) > 0 then 'partial'
                   else 'unpaid'
               end as status
        from t
    )
    select jsonb_build_object(
        'invoiced',      coalesce(sum(total), 0),
        'paid',          coalesce(sum(paid), 0),
        'outstanding',   coalesce(sum(greatest(total - paid, 0)), 0),
        'count_all',     count(*),
        'count_paid',    count(*) filter (where status = 'paid'),
        'count_partial', count(*) filter (where status = 'partial'),
        'count_unpaid',  count(*) filter (where status = 'unpaid')
    )
    from s;
$$;

revoke all on function public.transactions_totals(uuid) from public, anon;
grant execute on function public.transactions_totals(uuid) to authenticated;
alter function public.transactions_totals(uuid) owner to postgres;

-- ════════ payments-kpi ════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Consumer: src/pages/admin/Payments.tsx (admin "Delivery payments" page)
-- KPI: "Pending amount" — sum of net_amount over UNPAID payment notes under the
-- page's active filters. Previously a bare PostgREST select('net_amount')
-- reduced client-side, silently capped at PGRST_DB_MAX_ROWS=1000 → wrong money
-- past 1000 notes. This server-side aggregate replaces it.
--
-- Filter surface mirrors the page's applyFilters() exactly:
--   business, status, entity (provider_id | courier_id), created_at date range
--   (to-date exclusive +1 day, same as the client), total_amount min/max, and
--   an optional id set produced by search_company/courier_payment_note_ids.
-- The page always stacks status='unpaid' ON TOP of the status filter, so a
-- 'paid' filter yields 0 — reproduced here via the AND of both predicates.
-- SECURITY INVOKER: caller's RLS scopes rows; p_business is defense in depth
-- plus index use on "DigiCom Business".
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.payment_notes_unpaid_total(
    p_business uuid,
    p_kind text,
    p_status text default null,
    p_entity uuid default null,
    p_date_from date default null,
    p_date_to date default null,
    p_amount_min numeric default null,
    p_amount_max numeric default null,
    p_ids uuid[] default null
)
returns numeric
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_total numeric;
begin
    if p_kind = 'company' then
        select coalesce(sum(n.net_amount), 0)
        into v_total
        from public.company_payment_notes n
        where n."DigiCom Business" = p_business
          and n.status = 'unpaid'
          and (p_status is null or n.status = p_status)
          and (p_entity is null or n.provider_id = p_entity)
          and (p_date_from is null or n.created_at >= p_date_from)
          and (p_date_to is null or n.created_at < p_date_to + 1)
          and (p_amount_min is null or n.total_amount >= p_amount_min)
          and (p_amount_max is null or n.total_amount <= p_amount_max)
          and (p_ids is null or n.id = any(p_ids));
    elsif p_kind = 'courier' then
        select coalesce(sum(n.net_amount), 0)
        into v_total
        from public.courier_payment_notes n
        where n."DigiCom Business" = p_business
          and n.status = 'unpaid'
          and (p_status is null or n.status = p_status)
          and (p_entity is null or n.courier_id = p_entity)
          and (p_date_from is null or n.created_at >= p_date_from)
          and (p_date_to is null or n.created_at < p_date_to + 1)
          and (p_amount_min is null or n.total_amount >= p_amount_min)
          and (p_amount_max is null or n.total_amount <= p_amount_max)
          and (p_ids is null or n.id = any(p_ids));
    else
        raise exception 'payment_notes_unpaid_total: unknown kind %', p_kind;
    end if;

    return v_total;
end;
$$;

revoke all on function public.payment_notes_unpaid_total(uuid, text, text, uuid, date, date, numeric, numeric, uuid[]) from public, anon;
grant execute on function public.payment_notes_unpaid_total(uuid, text, text, uuid, date, date, numeric, numeric, uuid[]) to authenticated;
alter function public.payment_notes_unpaid_total(uuid, text, text, uuid, date, date, numeric, numeric, uuid[]) owner to postgres;

-- ════════ return-notes ════════
-- D4 · Return notes (src/pages/admin/ReturnNote.tsx, src/pages/seller/ReturnNote.tsx)
--
-- NO RPC NEEDED for this brief.
--
-- The defect was the returned-orders pool (bare PostgREST select, silently capped
-- at 1000 rows by PGRST_DB_MAX_ROWS) feeding BOTH the wizard money totals AND the
-- note-generation WRITES (total_amount / order_count / line_items persisted to
-- company_return_notes / courier_return_notes and their *_orders tables).
--
-- A server-side sum RPC is NOT sufficient here: the individual rows themselves are
-- required client-side to build and insert the line items. The fix is therefore
-- frontend-only — both pools now use fetchAllRows (chunked .range pagination over
-- a stable unique `id` order, then client-side created_at DESC sort to preserve
-- the original display order) with filters preserved verbatim:
--   admin : "DigiCom Business" eq + package_status_id eq RETOURNE
--           + current_return_note_id IS NULL + current_courier_return_note_id IS NULL
--           + date_deleted IS NULL + source_review_status neq 'pending'
--   seller: same minus source_review_status, plus seller_id eq (unchanged from
--           the original query — the seller page never had the neq filter).

-- ════════ import-fees ════════
-- D4: src/pages/admin/ImportOrders.tsx — courier_fees 1000-row cap fix.
-- No RPC needed: the page genuinely needs every fee row client-side (the fee
-- matrix elects the cheapest provider per imported order and the result is
-- written back into the imported orders). Fixed frontend-only by switching the
-- bare PostgREST select to fetchAllRows (chunked .range pagination, stable
-- order on 'id'), identical to the sibling company_fees query in the same file.

-- ════════ courier-pages ════════
-- ============================================================================
-- D4 — Courier pages: server-side aggregates
--
-- Consumers:
--   * src/pages/admin/collaborators/Couriers.tsx  → public.courier_roster_stats(p_business)
--   * src/pages/courier/Dashboard.tsx             → public.courier_self_stats(p_courier, p_business)
--   * src/pages/courier/Orders.tsx                → public.courier_parcel_counts(p_courier, p_business)
--
-- All functions are SECURITY INVOKER (RLS scopes row visibility to the caller)
-- and additionally filter explicitly on "DigiCom Business" (defense in depth +
-- index use). Pure reads → STABLE. No DDL on tables, no triggers, no policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- courier_roster_stats: one row per courier_id having orders and/or payment
-- notes in the business. Replicates the per-courier math previously done
-- client-side in admin/collaborators/Couriers.tsx over a fetchAllRows dump:
--   * base order universe: business + courier assigned + not soft-deleted +
--     source_review_status <> 'pending' (exact PostgREST `neq` semantics:
--     NULL rows excluded — column defaults to 'approved', never NULL today).
--   * delivered / in_transit / returned follow the page's if/else chain over
--     package_statuses flags: is_delivered first, else is_shipped, else
--     is_returned.
--   * fees_sum (delivered orders only): include_delivery_in_total=true →
--     the order's own shipping_cost, else the courier's configured city fee
--     from courier_fees (0 when no fee row / no master_city_id). courier_fees
--     has no unique key on (courier_id, master_city_id) — LATERAL LIMIT 1
--     (latest updated_at) keeps the join 1:1 like the client's Map lookup.
--   * notes_paid_sum / notes_unpaid_sum: courier_payment_notes.total_shipping_fees
--     split on status = 'paid' vs everything else (page treats any non-'paid'
--     status, including NULL, as unpaid).
-- The page keeps zones (courier_fees) and the modal note lists client-side.
-- ----------------------------------------------------------------------------
create or replace function public.courier_roster_stats(p_business uuid)
returns table (
    courier_id uuid,
    total_orders bigint,
    delivered bigint,
    in_transit bigint,
    returned bigint,
    fees_sum numeric,
    notes_paid_sum numeric,
    notes_unpaid_sum numeric,
    notes_count bigint
)
language sql
stable
security invoker
set search_path to ''
as $$
    with order_stats as (
        select
            o.courier_id as c_id,
            count(*)::bigint as total_orders,
            (count(*) filter (where ps.is_delivered is true))::bigint as delivered,
            (count(*) filter (
                where ps.is_delivered is not true
                  and ps.is_shipped is true
            ))::bigint as in_transit,
            (count(*) filter (
                where ps.is_delivered is not true
                  and ps.is_shipped is not true
                  and ps.is_returned is true
            ))::bigint as returned,
            coalesce(sum(
                case
                    when ps.is_delivered is true then
                        case
                            when o.include_delivery_in_total is true
                                then coalesce(o.shipping_cost, 0)
                            else coalesce(cf.fee, 0)
                        end
                    else 0
                end
            ), 0)::numeric as fees_sum
        from public.orders o
        left join public.package_statuses ps
            on ps.id = o.package_status_id
        left join lateral (
            select f.fee
            from public.courier_fees f
            where f.courier_id = o.courier_id
              and f.master_city_id = o.master_city_id
              and f."DigiCom Business" = p_business
            order by f.updated_at desc nulls last
            limit 1
        ) cf on true
        where o."DigiCom Business" = p_business
          and o.courier_id is not null
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
        group by o.courier_id
    ),
    note_stats as (
        select
            n.courier_id as c_id,
            coalesce(
                sum(coalesce(n.total_shipping_fees, 0)) filter (where n.status = 'paid'),
            0)::numeric as notes_paid_sum,
            coalesce(
                sum(coalesce(n.total_shipping_fees, 0)) filter (where n.status is distinct from 'paid'),
            0)::numeric as notes_unpaid_sum,
            count(*)::bigint as notes_count
        from public.courier_payment_notes n
        where n."DigiCom Business" = p_business
        group by n.courier_id
    )
    select
        coalesce(os.c_id, ns.c_id) as courier_id,
        coalesce(os.total_orders, 0) as total_orders,
        coalesce(os.delivered, 0) as delivered,
        coalesce(os.in_transit, 0) as in_transit,
        coalesce(os.returned, 0) as returned,
        coalesce(os.fees_sum, 0) as fees_sum,
        coalesce(ns.notes_paid_sum, 0) as notes_paid_sum,
        coalesce(ns.notes_unpaid_sum, 0) as notes_unpaid_sum,
        coalesce(ns.notes_count, 0) as notes_count
    from order_stats os
    full outer join note_stats ns on ns.c_id = os.c_id;
$$;

revoke all on function public.courier_roster_stats(uuid) from public, anon;
grant execute on function public.courier_roster_stats(uuid) to authenticated;
alter function public.courier_roster_stats(uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- courier_self_stats: KPI aggregate for the courier's own dashboard.
-- Universe = the page's parcel query: courier_parcels of this courier+business
-- whose delivery note is finalized AND whose order row is visible (inner join,
-- matching the client's `p?.note && p?.order` filter).
--   * active_count    = parcels neither delivered nor terminal (NULL status →
--                       active, matching the client's !!flag coercion).
--   * delivered_count = parcels whose package status is_delivered.
--   * pending_earnings = GREATEST(0, SUM(orders.shipping_cost over delivered
--                       parcels) − SUM(paid courier_payment_notes.total_shipping_fees)).
-- ----------------------------------------------------------------------------
create or replace function public.courier_self_stats(p_courier uuid, p_business uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    with parcels as (
        select
            coalesce(ps.is_delivered, false) as is_delivered,
            coalesce(ps.is_terminal, false) as is_terminal,
            coalesce(o.shipping_cost, 0) as order_shipping
        from public.courier_parcels cp
        join public.courier_delivery_notes n
            on n.id = cp.courier_delivery_note_id
           and n.is_finalized is true
        join public.orders o
            on o.id = cp.order_id
        left join public.package_statuses ps
            on ps.id = cp.status_id
        where cp.courier_id = p_courier
          and cp."DigiCom Business" = p_business
    ),
    agg as (
        select
            (count(*) filter (where not is_delivered and not is_terminal))::bigint as active_count,
            (count(*) filter (where is_delivered))::bigint as delivered_count,
            coalesce(sum(order_shipping) filter (where is_delivered), 0)::numeric as pending_gross
        from parcels
    ),
    paid as (
        select coalesce(sum(coalesce(pn.total_shipping_fees, 0)), 0)::numeric as paid_sum
        from public.courier_payment_notes pn
        where pn.courier_id = p_courier
          and pn."DigiCom Business" = p_business
          and pn.status = 'paid'
    )
    select jsonb_build_object(
        'active_count', agg.active_count,
        'delivered_count', agg.delivered_count,
        'pending_earnings', greatest(0, agg.pending_gross - paid.paid_sum)
    )
    from agg, paid;
$$;

revoke all on function public.courier_self_stats(uuid, uuid) from public, anon;
grant execute on function public.courier_self_stats(uuid, uuid) to authenticated;
alter function public.courier_self_stats(uuid, uuid) owner to postgres;

-- ----------------------------------------------------------------------------
-- courier_parcel_counts: per-tab counts for courier/Orders.tsx. Same universe
-- as courier_self_stats (finalized note + visible order). Tab predicates are a
-- 1:1 port of the page's TABS matchers over package_statuses flags; a parcel
-- with no status row only counts in 'all'.
-- ----------------------------------------------------------------------------
create or replace function public.courier_parcel_counts(p_courier uuid, p_business uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    select jsonb_build_object(
        'all',      count(*),
        'nouveau',  count(*) filter (where coalesce(ps.is_new, false)),
        'suivi',    count(*) filter (
                        where coalesce(ps.recheck, false)
                          and not coalesce(ps.is_postponed, false)
                          and not coalesce(ps.is_delivered, false)
                    ),
        'reported', count(*) filter (where coalesce(ps.is_postponed, false)),
        'livre',    count(*) filter (where coalesce(ps.is_delivered, false)),
        'retour',   count(*) filter (where coalesce(ps.is_returned, false))
    )
    from public.courier_parcels cp
    join public.courier_delivery_notes n
        on n.id = cp.courier_delivery_note_id
       and n.is_finalized is true
    join public.orders o
        on o.id = cp.order_id
    left join public.package_statuses ps
        on ps.id = cp.status_id
    where cp.courier_id = p_courier
      and cp."DigiCom Business" = p_business;
$$;

revoke all on function public.courier_parcel_counts(uuid, uuid) from public, anon;
grant execute on function public.courier_parcel_counts(uuid, uuid) to authenticated;
alter function public.courier_parcel_counts(uuid, uuid) owner to postgres;

-- ════════ mediabuyer ════════
-- ─────────────────────────────────────────────────────────────────────────────
-- D4 · Media buyer — server-side attribution base
-- Consumer page: src/pages/mediabuyer/Orders.tsx (query key 'mb-orders-entries')
--
-- mb_entry_days: distinct (entry_date, platform) pairs across the media buyer's
-- LIFETIME campaign_daily_entries in one business. Replaces a bare PostgREST
-- select of every entry row (silently capped at 1000 → attribution days lost →
-- attributed orders/revenue understated). The page only derives day×platform
-- pairs from the rows, so DISTINCT server-side is the exact need.
--
-- MB-facing data rule: this function deliberately exposes NO spend/leads/money
-- columns — only entry_date and platform.
--
-- created_by is the attribution key (denormalized on the entry, survives
-- campaign deletion). Both entry_date and platform are NOT NULL on the table.
-- SECURITY INVOKER: RLS (tenant policy on "DigiCom Business") still scopes
-- rows; the explicit p_business filter is defense in depth + index use.
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns ONE jsonb array (not SETOF): a set-returning RPC is itself subject
-- to the PostgREST max-rows=1000 response cap — the exact defect class this
-- wave kills — while a single jsonb value is immune (distinct_clients pattern).
create or replace function public.mb_entry_days(
    p_business uuid,
    p_created_by uuid
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    select coalesce(
        jsonb_agg(jsonb_build_object('entry_date', d.entry_date, 'platform', d.platform)),
        '[]'::jsonb
    )
    from (
        select distinct e.entry_date, e.platform
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.created_by = p_created_by
    ) d;
$$;

revoke all on function public.mb_entry_days(uuid, uuid) from public, anon;
grant execute on function public.mb_entry_days(uuid, uuid) to authenticated;
alter function public.mb_entry_days(uuid, uuid) owner to postgres;

-- ════════ tools-registers ════════
-- ============================================================================
-- D4 scale rebuild — tools document registers (server-side aggregates)
--
-- Consumers:
--   src/pages/admin/tools/bonCommande/BonCommandePage.tsx
--   src/pages/admin/tools/bonLivraison/BonLivraisonPage.tsx
--   src/pages/admin/tools/devis/DevisPage.tsx
--   src/pages/admin/tools/facture/FacturePage.tsx
--
-- public.distinct_clients:
--   Replaces the unbounded fetchAllRows('orders', name/phone/address/city)
--   download each of the four pages ran on mount just to build the wizard's
--   client dropdown. One row per DISTINCT normalized phone (digits only),
--   most-recent order wins per phone. Returns a SINGLE jsonb array — not a
--   set — so the payload is immune to the PostgREST max-rows=1000 response
--   cap (the largest business already has 1709 distinct client phones).
--   p_search / p_limit enable future server-side typeahead once the shared
--   ClientSearchSelect component accepts a search callback.
--
-- public.register_totals:
--   Replaces the client-side reduce() KPI math the pages ran over bare
--   select('*') register lists (wrong money once a register exceeds 1000
--   rows). One jsonb object per register, shape matched to each page's
--   KPI strip.
-- ============================================================================

create or replace function public.distinct_clients(
    p_business uuid,
    p_search text default null,
    p_limit integer default null
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'name', c.name,
                'phone', c.phone,
                'address', c.address,
                'city', c.city
            )
            order by c.name, c.phone
        ),
        '[]'::jsonb
    )
    from (
        select d.name, d.phone, d.address, d.city
        from (
            select distinct on (regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g'))
                coalesce(nullif(o.name, ''), 'Client') as name,
                regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') as phone,
                coalesce(o.address, '') as address,
                coalesce(mc.name, '') as city
            from public.orders o
            left join public.master_cities mc on mc.id = o.master_city_id
            where o."DigiCom Business" = p_business
              and o.date_deleted is null
              and o.source_review_status is distinct from 'pending'
              and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') <> ''
              and (
                  p_search is null
                  or btrim(p_search) = ''
                  or o.name ilike '%' || p_search || '%'
                  or o.phone ilike '%' || p_search || '%'
                  or o.address ilike '%' || p_search || '%'
              )
            order by
                regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g'),
                o.created_at desc
        ) d
        order by d.name, d.phone
        limit p_limit
    ) c;
$$;

revoke all on function public.distinct_clients(uuid, text, integer) from public, anon;
grant execute on function public.distinct_clients(uuid, text, integer) to authenticated;
alter function public.distinct_clients(uuid, text, integer) owner to postgres;

create or replace function public.register_totals(
    p_business uuid,
    p_register text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_month_start timestamptz := date_trunc('month', now());
    v_result jsonb;
begin
    if p_register = 'bons_commande' then
        select jsonb_build_object(
            'count', count(*),
            'purchase_count', count(*) filter (where b.direction = 'purchase'),
            'sales_count', count(*) filter (where b.direction = 'sales'),
            'total_ttc', coalesce(sum(b.total_ttc), 0),
            'this_month', count(*) filter (where b.issued_at >= v_month_start)
        )
        into v_result
        from public.bons_commande b
        where b.business_id = p_business;
    elsif p_register = 'bons_livraison' then
        select jsonb_build_object(
            'count', count(*),
            'manual_count', count(*) filter (where b.snapshot_json ->> 'source' = 'manual'),
            'order_count', count(*) filter (where b.snapshot_json ->> 'source' = 'order'),
            'note_count', count(*) filter (where b.snapshot_json ->> 'source' = 'company_delivery_note'),
            'parcel_count', coalesce(sum(
                case
                    when jsonb_typeof(b.snapshot_json -> 'parcels') = 'array'
                        then jsonb_array_length(b.snapshot_json -> 'parcels')
                    else 0
                end
            ), 0),
            'this_month', count(*) filter (where b.issued_at >= v_month_start)
        )
        into v_result
        from public.bons_livraison b
        where b.business_id = p_business;
    elsif p_register = 'devis' then
        select jsonb_build_object(
            'count', count(*),
            'total_ttc', coalesce(sum(d.total_ttc), 0),
            'avg_ttc', coalesce(avg(d.total_ttc), 0),
            'with_vat', count(*) filter (where coalesce(d.tva_rate, 0) > 0),
            'this_month', count(*) filter (where d.issued_at >= v_month_start)
        )
        into v_result
        from public.devis d
        where d.business_id = p_business;
    elsif p_register = 'factures' then
        select jsonb_build_object(
            'count', count(*),
            'total_ttc', coalesce(sum(f.total_ttc), 0),
            'avg_ttc', coalesce(avg(f.total_ttc), 0),
            'this_month', count(*) filter (where f.issued_at >= v_month_start),
            'overdue', count(*) filter (where f.due_date is not null and f.due_date::date < current_date)
        )
        into v_result
        from public.factures f
        where f.business_id = p_business;
    else
        raise exception 'register_totals: unknown register %', p_register;
    end if;

    return v_result;
end;
$$;

revoke all on function public.register_totals(uuid, text) from public, anon;
grant execute on function public.register_totals(uuid, text) to authenticated;
alter function public.register_totals(uuid, text) owner to postgres;

commit;
