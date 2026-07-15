-- D7b — Customers server-side teardown + the two tail fixes worth doing.
-- Contract: docs/d7-recon/02-pages.md §1 (Customers) and docs/d7-recon/03-tail-deadcode.md
-- §3.1 (DeliveryServices N+1, escalated P1) / §3.2 (webhook_logs index). Their
-- FIX/DEFER verdicts are binding; nothing marked DEFER is touched here.
--
-- Three items:
--
--   ① public.customers_list_page / customers_kpis / customer_orders
--        Kills the last unbounded full-order-table download in the app:
--        admin/Customers.tsx `useQuery(['customers-derived'])` fetchAllRows()'d
--        EVERY non-deleted, non-pending order of the business (2 104 rows + 3
--        embeds, measured) on every page mount to render 12 rows, then did the
--        grouping, filtering, search, sort, pagination and the KPI strip in a
--        client-side Map. Recon 02 §1.
--   ② idx_webhook_logs_biz_created
--        admin/Webhooks.tsx polls `webhook_logs … order(created_at desc).limit(50)`
--        every 5 s per mounted admin. No (business, created_at) index existed, so
--        the LIMIT bounded nothing: 5 290-row index scan + top-N heapsort, 12×/min,
--        growing linearly forever (~50k rows/yr/busy business). Recon 03 §3.2.
--   ③ public.delivery_fees_bulk_apply
--        admin/DeliveryServices.tsx "Auto Fill All" looped saveFeeRowByMasterCity
--        over up to 448 cities × 2 sequential round-trips = 896 RTTs ≈ 90-180 s of
--        frozen button, and — the real defect — on a mid-loop failure an arbitrary
--        PREFIX of the fee rows was already committed with no rollback, while the
--        optimistic UI painted all 448 cities at the new price. Money table.
--        Recon 03 §3.1. One call, one transaction, all-or-nothing.
--
-- Conventions (D1..D5): SECURITY INVOKER (RLS is the row gate; explicit p_business
-- = defense in depth + index driver), set search_path to '', single jsonb return,
-- flag-column status semantics, grants footer, D1-style keyset (mig
-- 20260714220000).
--
-- ADMIN GATE (D3/D5 standing rule) on all four functions. Verified by grep before
-- authoring: `/customers` is mounted ONLY at src/App.tsx:335, inside the admin
-- route tree (`<Route path="*">` → ProtectedRoute allowedRoles={['super admin',
-- 'admin']} → BusinessGuard). There is no seller/mediabuyer/courier customers
-- view (src/pages/{seller,mediabuyer}/ contain no Customers page), so the plain
-- admin gate applies — the self-or-admin shape has no legitimate caller here.
-- Same for /delivery-services (src/App.tsx:317) — admin tree, money table.
--
-- ===========================================================================
-- PARITY DIVERGENCES — each needs a separate owner ruling. NONE is silently fixed.
-- ===========================================================================
--
-- (A) GROUPING KEY: raw digits → canonical normalize_phone_for_customer (0→212).
--     admin/Customers.tsx:266 keys its Map on `order.phone?.replace(/[^0-9]/g,'')`
--     — raw digits, NO 0→212 conversion. It is the ONLY consumer using that key;
--     analyticsDefinitions.normalizePhone, ImportOrders, ImportCustomers,
--     CustomersSection and WhatsApp contacts all use the canonical rule, and the
--     `customers` table is UNIQUE on ("DigiCom Business", phone_normalized) —
--     i.e. canonically keyed. Reusing that table (recon §1.2 ACCEPT, binding)
--     forces the canonical key.
--     MEASURED on biz 77f59ea5 (the page's exact pool: not deleted, source_review_status
--     <> 'pending', replace is distinct from true — 1 783 orders):
--         canonical distinct keys ......................... 1 719
--         raw-digit distinct keys ......................... 1 719   (identical)
--         canonical keys collapsing >1 raw variant ........     0
--     => provably a NO-OP on current data. It is still a SEMANTIC change: if a
--     customer ever mixes `06…` and `212…` forms, the canonical key MERGES what
--     the page used to SPLIT (one customer instead of two, with summed spend).
--     Recon §1.3(a) reaches the same verdict. OWNER RULING REQUIRED.
--
-- (B) `replace = true` LEGS: customers.total_orders / total_spent are NOT reused.
--     The page EXCLUDES swap legs (:262 `orders?.filter(o => o.replace !== true)`),
--     but refresh_customer_from_orders (live, SECURITY DEFINER) has NO replace
--     filter, so the trigger-maintained aggregates INCLUDE them — 8 customer rows
--     contaminated (9 replace orders DB-wide). Recon §1.3(b) offers (i) fix the
--     trigger + backfill, or (ii) recompute in the RPC.
--     THIS MIGRATION TAKES (ii): total_orders / total_spent / first_order_at /
--     last_order_at are recomputed from `orders` with the page's replace filter.
--     Rationale: (i) changes the numbers the EXISTING CSV export already ships
--     (handleExport reads customers.* directly and is untouched here) — that is a
--     money-semantics change and the standing rule forbids making it silently.
--     CONSEQUENCE, stated plainly: the export keeps shipping the contaminated
--     numbers, so the list and the CSV disagree on those 8 rows — exactly as they
--     do TODAY. This migration does not widen the gap; it also does not close it.
--     OWNER RULING REQUIRED: fix the trigger + backfill (list and export converge,
--     export output changes), or keep (ii).
--
-- ===========================================================================
-- DOCUMENTED DEVIATIONS FROM THE RECON'S §1.4 SKETCH (parity outranks the sketch)
-- ===========================================================================
--
--   * customers_kpis takes p_business ONLY. §1.4 sketches
--     `customers_kpis(p_business, p_search, …)`, but the page's KPI strip is
--     provably UNFILTERED: stats (:370-380) reduces over `customers` — the raw
--     derived array — NOT over `filteredData`. Search/status filters do not move
--     those three counters today. Accepting filter params and applying them would
--     silently change three money-ish counters the moment a filter is set; accepting
--     and ignoring them would be a trap. Both params are therefore DROPPED.
--   * The row set is driven by the ORDERS aggregate, LEFT JOINed to `customers`
--     for identity — not `customers` INNER JOINed to the aggregate. Same rows
--     today, strictly safer both ways. MEASURED on biz 77f59ea5:
--         page-pool canonical keys with NO customers row ....   0  (inner join
--             would lose nothing today, but a trigger miss would silently DROP a
--             customer from the list; agg-driven degrades to name/city 'Unknown')
--         customers rows with NO page-pool order ............ 233  (imports,
--             replace-only, deleted/pending-only — the page shows none of them,
--             so `customers` may NOT drive the row set)
--     This satisfies §1.2 (ACCEPT customers for identity/sort/search, REJECT for
--     aggregates) exactly.
--   * NO new index on orders. §1.4 calls for
--     `orders (("DigiCom Business"), normalize_phone_for_customer(phone))` and says
--     it "does not exist yet" — STALE: idx_orders_business_phonenorm_live
--     (btree ("DigiCom Business", normalize_phone_for_customer(phone)) WHERE
--     date_deleted IS NULL) already exists.
--     MEASURED CAVEAT, stated because it contradicts the obvious reading: at this
--     size the planner does NOT choose it — for both the pool aggregate and the
--     customer_orders single-phone seek it takes idx_orders_digicom_business and
--     filters (EXPLAIN ANALYZE, biz 77f59ea5, 1 797 live orders):
--         pool aggregate  → Index Scan idx_orders_digicom_business + HashAggregate,
--                           1 782 rows, 99 buffers, 9.6 ms
--         customer_orders → Index Scan idx_orders_digicom_business, 1 793 rows
--                           removed by filter, 154 buffers, 5.7 ms
--     Both are cheap enough that this is not worth forcing, and adding a fourth
--     index would not change the chosen plan. Revisit only if a business's live
--     order count grows an order of magnitude, at which point the phonenorm index
--     should start winning the customer_orders seek on its own.
--   * NO customers (total_spent DESC, id) / (total_orders DESC, id) indexes.
--     §1.4 proposes them for the value/frequency keysets, but per divergence (B)
--     those two aggregates are recomputed from `orders`, so a customers-column
--     index could not back the sort without reintroducing the replace-leg
--     contamination. The keyset rides the aggregate; see the cost note below.
--   * COST, stated honestly — this trades a download for DB CPU, it does not make
--     the query O(page): every call re-aggregates the business's whole order pool
--     (1 783 rows → 1 719 groups on the largest business) rather than reading 12
--     rows off an index. MEASURED warm on biz 77f59ea5:
--         customers_list_page (recency, page 1) .... 22-28 ms
--         customers_list_page (value, page 1) ...... 17 ms
--         customers_kpis ........................... 10-12 ms
--         customer_orders (4 orders) ................ 7 ms
--     The win is the 2 104-row + 3-embed download → one ~12-row jsonb, plus
--     aggregates that are correct instead of client-derived. Cost grows linearly
--     with the business's order count, so this is NOT the end state: when it gets
--     hot the fix is a replace-aware materialization of `customers` (owner ruling
--     (B) option (i)), which makes the list a true index read. Another index will
--     not help — see the index caveat above.
--   * `first_order_at` / `last_order_at` use max/min of coalesce(date, created_at)
--     — the page sorts the customer's orders desc on `order.date || order.created_at`
--     and takes [0] / [len-1]. Identical. NULL rank is impossible today (measured:
--     0 orders with date IS NULL AND created_at IS NULL) but is coalesced to
--     '-infinity' so it can never become cursor-unreachable; the page's own
--     behavior there is undefined (new Date(undefined) → NaN comparator).
--   * TIE-BREAKS: the page's sorts are JS `.sort` (stable), so ties keep Map
--     insertion order = PostgREST physical order = undefined. Every sort here is
--     tie-broken by phone_normalized desc (keyset requires a total order) and the
--     last-status LATERAL by (odate desc, id desc). Deterministic where the page
--     was arbitrary.
--   * IDENTITY (name / city): taken from `customers.name` / `customers.city_name`
--     per §1.2's binding ACCEPT, coalesced to 'Unknown' to match the page's
--     `order.name || 'Unknown'` / `city?.name || 'Unknown'`. The trigger picks
--     them from the customer's LATEST order (COALESCE-kept, so they never revert
--     to null) over a pool that INCLUDES replace legs; the page picks "whichever
--     order came last in an undefined physical order". Neither is the other. Both
--     are "a recent order's name/city". Display and search are self-consistent
--     here (search matches the emitted value), which the page also guarantees.
--   * `status` tier ('High Value' >1000 / 'Mid Value' >500 / else 'Low Value') is
--     computed server-side for parity. The page's `'New'` tier is DEAD — it is the
--     Map-insert default and is unconditionally overwritten at :312-314 before any
--     render. Not reproduced. Flagged, not fixed.
--   * The package-status LABEL fallback (:347-352) is replicated bug-for-bug: an
--     order also matches when a SELECTED package status's raw label equals the
--     order's OWN package status's TRIMMED label. It is provably INERT today —
--     package_statuses is a GLOBAL table (no business column) with 0 duplicate
--     labels — so it can only ever re-match the order's own status, which the
--     id branch already covers. Kept for parity; flagged as dead weight.
--   * Numbered pagination (page N / totalPages, :824-855) cannot survive a keyset:
--     customers_list_page returns next_cursor (prev/next only), per D1 precedent.
--     customers_kpis.total still backs the "Total customers" KPI.
--   * Search stays a leading-wildcard ILIKE over name/city (unindexable, parity
--     with String.includes) + a literal substring over the digit-stripped phone.
--     1 952 customers → trivial. Phone search is case-sensitive over DIGITS ONLY,
--     exactly as today: searching "06 12" matches nothing (the space is not a
--     digit). Parity, and a genuine page quirk.
--
-- Reversible: drop the four functions and the one index.

begin;

-- ===========================================================================
-- ① CUSTOMERS
-- ===========================================================================
--
-- >>> D7 SHARED CUSTOMER POOL + AGG (byte-identical in customers_list_page,
--     customers_kpis and customer_orders — edit ALL THREE or the counters lie) <<<
--
--   pool = the page's exact order set (admin/Customers.tsx:235-262):
--          business, date_deleted is null, source_review_status <> 'pending',
--          replace is distinct from true, and a non-null canonical phone key
--          (the page's `if (!phone) return;` — measured: exactly 1 order in the
--          business digit-strips to '' and is skipped by both).
--          `source_review_status <> 'pending'` matches the client's PostgREST
--          `neq.pending` including its NULL semantics; the column is NOT NULL
--          with 0 nulls live, so there is no divergence to chase.
--   agg  = per canonical phone key. Rides idx_orders_business_phonenorm_live.
--
-- ---------------------------------------------------------------------------
-- RPC 1 — customers_list_page: one keyset page of the customer list.
-- Returns {rows: [...], next_cursor: {ts, num, key} | null, page_count: int}.
--
-- Row shape (the page's Customer type, minus `orders` — that is customer_orders):
--   customer_id phone_normalized phone name city totalOrders totalSpent
--   avgOrderValue lastOrderDate firstOrderDate status interactionScore
--   lastStatus{label,color}
--
-- TWO CALLER TRAPS — both cost me a failed verification round, so read them:
--
--  1. `phone` and `phone_normalized` ARE DIFFERENT STRINGS and are not
--     interchangeable. `phone` = raw digits ("0659334952") — the page's display
--     value and its search axis, kept for parity. `phone_normalized` = the
--     canonical key ("212659334952") and the ONLY valid p_phone_normalized for
--     customer_orders. Passing `phone` to customer_orders silently returns
--     {"orders": []} — an empty drill-down, not an error.
--  2. `next_cursor` is JSON null (not an absent key) when the page is the last
--     one. In JS `data.next_cursor` is falsy → correct; in SQL `-> 'next_cursor'`
--     yields jsonb 'null', NOT SQL NULL, so `IS NULL` never fires and a naive
--     server-side walk loops forever. Same shape as D1's orders_list_page.
--
-- Cursor: pass back next_cursor.{ts, num, key} as p_cursor_ts / p_cursor_num /
-- p_cursor_key. `key` arms the cursor; `ts` is populated for p_sort='recency',
-- `num` for 'value'/'frequency'. Verified: a full walk on every sort returns each
-- of the 1 719 customers exactly once, in 9 pages of 200, zero overlap.
-- ---------------------------------------------------------------------------
create or replace function public.customers_list_page(
    p_business uuid,
    p_search text default null,
    p_sort text default 'recency',
    p_status_ids uuid[] default null,
    p_package_ids uuid[] default null,
    p_cursor_ts timestamptz default null,
    p_cursor_num numeric default null,
    p_cursor_key text default null,
    p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_sort text;
    v_search text;
    v_status_ids uuid[];
    v_package_ids uuid[];
    v_limit integer;
    v_result jsonb;
begin
    -- ADMIN GATE FIRST (business-wide money aggregate — D3/D5 standing rule)
    if not (select public.current_user_is_business_admin()) then
        raise exception 'customers_list_page: admin only' using errcode = '42501';
    end if;
    if p_business is null then
        raise exception 'customers_list_page: p_business is required' using errcode = '22023';
    end if;
    v_sort := coalesce(p_sort, 'recency');
    if v_sort not in ('recency', 'value', 'frequency') then
        raise exception 'customers_list_page: invalid p_sort %', p_sort using errcode = '22023';
    end if;
    if coalesce(array_length(p_status_ids, 1), 0) > 1000
       or coalesce(array_length(p_package_ids, 1), 0) > 1000 then
        raise exception 'customers_list_page: too_many_ids (max 1000)' using errcode = '22023';
    end if;
    -- cursor coherence: the key is what arms the cursor; the rank must match p_sort
    if p_cursor_key is not null then
        if v_sort = 'recency' and p_cursor_ts is null then
            raise exception 'customers_list_page: recency cursor requires p_cursor_ts' using errcode = '22023';
        end if;
        if v_sort in ('value', 'frequency') and p_cursor_num is null then
            raise exception 'customers_list_page: %s cursor requires p_cursor_num', v_sort using errcode = '22023';
        end if;
    end if;
    v_limit := least(greatest(coalesce(p_limit, 12), 1), 200);
    -- empty array == no filter (client checks `.length === 0`)
    v_status_ids  := case when coalesce(array_length(p_status_ids, 1), 0) = 0 then null else p_status_ids end;
    v_package_ids := case when coalesce(array_length(p_package_ids, 1), 0) = 0 then null else p_package_ids end;
    -- NOT trimmed and NOT null-if-empty beyond '' : the page passes searchQuery raw
    -- ('' => no filter via includes('') === true on every row). like_escape LAST:
    -- %, _ and \ in the term are data, not wildcards (D1 review fix).
    v_search := public.like_escape(nullif(p_search, ''));

    with pool as (
        select
            public.normalize_phone_for_customer(o.phone)      as k,
            o.id                                              as order_id,
            coalesce(o.date, o.created_at)                    as odate,
            coalesce(o.price, 0)::numeric                     as price,
            o.order_status_id,
            o.package_status_id,
            regexp_replace(o.phone, '[^0-9]', '', 'g')        as pdigits,
            (os.is_confirmed is true)                         as is_conf,
            (ps.is_delivered is true)                         as is_deliv,
            -- #status filter: `orderSel.has(o.order_status_id)` (:341)
            (v_status_ids is not null and o.order_status_id = any (v_status_ids)) as status_match,
            -- #package filter (:343-352): id hit OR the label fallback
            (v_package_ids is not null and (
                (o.package_status_id is not null and o.package_status_id = any (v_package_ids))
                or (btrim(coalesce(ps.label, '')) <> '' and exists (
                        select 1 from public.package_statuses sel
                        where sel.id = any (v_package_ids)
                          and sel.label = btrim(ps.label)))
            ))                                                as pkg_match
        from public.orders o
        left join public.order_statuses os   on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and public.normalize_phone_for_customer(o.phone) is not null
    ),
    agg as (
        select
            p.k,
            count(*)::int                                             as total_orders,
            sum(p.price)::numeric                                     as total_spent,
            coalesce(max(p.odate), '-infinity'::timestamptz)          as last_order_at,
            coalesce(min(p.odate), '-infinity'::timestamptz)          as first_order_at,
            count(*) filter (where p.is_conf and p.is_deliv)::int     as successful_orders,
            min(p.pdigits)                                            as phone_digits,
            count(*) filter (where p.status_match)                    as n_status_match,
            count(*) filter (where p.pkg_match)                       as n_pkg_match
        from pool p
        group by p.k
    ),
    -- <<< END D7 SHARED CUSTOMER POOL + AGG >>>
    joined as (
        select
            a.*,
            cu.id                                    as customer_id,
            coalesce(cu.name, 'Unknown')             as name_disp,
            coalesce(cu.city_name, 'Unknown')        as city_disp,
            case
                when a.total_spent > 1000 then 'High Value'
                when a.total_spent > 500  then 'Mid Value'
                else 'Low Value'
            end                                      as tier,
            (a.successful_orders * 10 + a.total_orders * 2) as interaction_score,
            case v_sort when 'value' then a.total_spent
                        when 'frequency' then a.total_orders::numeric end as rank_num
        from agg a
        left join public.customers cu
               on cu."DigiCom Business" = p_business
              and cu.phone_normalized = a.k
    ),
    filtered as (
        select j.* from joined j
        where (v_status_ids is null  or j.n_status_match > 0)
          and (v_package_ids is null or j.n_pkg_match > 0)
          -- search: parity with :376-381 — name/city case-insensitive, phone
          -- case-sensitive over the digit string
          and (v_search is null
               or lower(j.name_disp) like '%' || lower(v_search) || '%'
               or j.phone_digits like '%' || v_search || '%'
               or lower(j.city_disp) like '%' || lower(v_search) || '%')
          -- keyset
          and (p_cursor_key is null
               or (v_sort = 'recency'  and (j.last_order_at, j.k) < (p_cursor_ts, p_cursor_key))
               or (v_sort <> 'recency' and (j.rank_num, j.k) < (p_cursor_num, p_cursor_key)))
    ),
    ranked as (
        select f.*, row_number() over (
            order by case when v_sort = 'recency' then f.last_order_at end desc,
                     case when v_sort <> 'recency' then f.rank_num end desc,
                     f.k desc
        ) as rn
        from filtered f
        order by case when v_sort = 'recency' then f.last_order_at end desc,
                 case when v_sort <> 'recency' then f.rank_num end desc,
                 f.k desc
        limit v_limit + 1
    ),
    kept as (
        select * from ranked where rn <= v_limit
    ),
    enriched as (
        select
            k.rn,
            jsonb_build_object(
                'customer_id',      k.customer_id,
                'phone_normalized', k.k,
                'phone',            k.phone_digits,
                'name',             k.name_disp,
                'city',             k.city_disp,
                'totalOrders',      k.total_orders,
                'totalSpent',       k.total_spent,
                'avgOrderValue',    (k.total_spent / nullif(k.total_orders, 0)),
                'lastOrderDate',    nullif(k.last_order_at, '-infinity'::timestamptz),
                'firstOrderDate',   nullif(k.first_order_at, '-infinity'::timestamptz),
                'status',           k.tier,
                'interactionScore', k.interaction_score,
                -- "Last status" column (:794-810) = the most recent order's status
                'lastStatus',       jsonb_build_object('label', lo.label, 'color', lo.color)
            ) as row_json
        from kept k
        left join lateral (
            select coalesce(os2.label, 'Unknown')   as label,
                   coalesce(os2.color, '#D97706')   as color
            from pool p2
            left join public.order_statuses os2 on os2.id = p2.order_status_id
            where p2.k = k.k
            order by p2.odate desc, p2.order_id desc
            limit 1
        ) lo on true
    )
    select jsonb_build_object(
        'rows', coalesce((select jsonb_agg(e.row_json order by e.rn) from enriched e), '[]'::jsonb),
        'page_count', (select count(*)::int from kept),
        'next_cursor', case
            when (select count(*) from ranked) > v_limit then
                (select jsonb_build_object(
                            'ts',  case when v_sort = 'recency'
                                        then nullif(k2.last_order_at, '-infinity'::timestamptz) end,
                            'num', k2.rank_num,
                            'key', k2.k)
                 from kept k2 where k2.rn = v_limit)
            end
    )
    into v_result;

    return v_result;
end;
$$;

revoke all on function public.customers_list_page(uuid, text, text, uuid[], uuid[], timestamptz, numeric, text, integer) from public, anon;
grant execute on function public.customers_list_page(uuid, text, text, uuid[], uuid[], timestamptz, numeric, text, integer) to authenticated;
alter function public.customers_list_page(uuid, text, text, uuid[], uuid[], timestamptz, numeric, text, integer) owner to postgres;

-- ---------------------------------------------------------------------------
-- RPC 2 — customers_kpis: the KPI strip. UNFILTERED — see the deviation note.
-- Returns {total, revenue, avgValue}.
-- ---------------------------------------------------------------------------
create or replace function public.customers_kpis(p_business uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_result jsonb;
begin
    if not (select public.current_user_is_business_admin()) then
        raise exception 'customers_kpis: admin only' using errcode = '42501';
    end if;
    if p_business is null then
        raise exception 'customers_kpis: p_business is required' using errcode = '22023';
    end if;

    with pool as (
        select
            public.normalize_phone_for_customer(o.phone) as k,
            coalesce(o.price, 0)::numeric                as price
        from public.orders o
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and public.normalize_phone_for_customer(o.phone) is not null
    ),
    agg as (
        select p.k, sum(p.price)::numeric as total_spent
        from pool p
        group by p.k
    )
    select jsonb_build_object(
        'total',    coalesce(count(*), 0)::int,
        'revenue',  coalesce(sum(a.total_spent), 0),
        -- parity with :377-379 — `total ? revenue / total : 0`
        'avgValue', coalesce(sum(a.total_spent) / nullif(count(*), 0), 0)
    )
    from agg a
    into v_result;

    return v_result;
end;
$$;

revoke all on function public.customers_kpis(uuid) from public, anon;
grant execute on function public.customers_kpis(uuid) to authenticated;
alter function public.customers_kpis(uuid) owner to postgres;

-- ---------------------------------------------------------------------------
-- RPC 3 — customer_orders: the drill-down dialog's per-order list + chart source.
-- Returns {orders: [...]} sorted date DESC (the page reverses it for the chart).
-- Unbounded by design: max orders per customer on the largest business = 4
-- (measured). The dialog renders every one of them (:958 `.orders.map`).
-- ---------------------------------------------------------------------------
create or replace function public.customer_orders(
    p_business uuid,
    p_phone_normalized text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_result jsonb;
begin
    if not (select public.current_user_is_business_admin()) then
        raise exception 'customer_orders: admin only' using errcode = '42501';
    end if;
    if p_business is null or nullif(btrim(coalesce(p_phone_normalized, '')), '') is null then
        raise exception 'customer_orders: p_business and p_phone_normalized are required' using errcode = '22023';
    end if;

    with pool as (
        select
            o.id,
            coalesce(o.date, o.created_at)                   as odate,
            coalesce(o.price, 0)::numeric                    as price,
            coalesce(o.shipping_cost, 0)::numeric            as shipping_cost,
            coalesce(o.order_status_id::text, '')            as order_status_id,
            o.package_status_id,
            coalesce(os.label, 'Unknown')                    as status_label,
            coalesce(os.color, '#D97706')                    as status_color,
            coalesce(mc.name, 'Unknown')                     as city_name
        from public.orders o
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.master_cities mc  on mc.id = o.master_city_id
        where o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          and o.replace is distinct from true
          and public.normalize_phone_for_customer(o.phone) = p_phone_normalized
    )
    select jsonb_build_object(
        'orders', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id',                p.id,
                       'date',              p.odate,
                       'price',             p.price,
                       'shipping_cost',     p.shipping_cost,
                       'order_status_id',   p.order_status_id,
                       'package_status_id', p.package_status_id,
                       'status',            jsonb_build_object('label', p.status_label, 'color', p.status_color),
                       'city_name',         p.city_name)
                   order by p.odate desc, p.id desc)
            from pool p), '[]'::jsonb)
    )
    into v_result;

    return v_result;
end;
$$;

revoke all on function public.customer_orders(uuid, text) from public, anon;
grant execute on function public.customer_orders(uuid, text) to authenticated;
alter function public.customer_orders(uuid, text) owner to postgres;

-- ===========================================================================
-- ② webhook_logs composite index (recon 03 §3.2)
-- ===========================================================================
-- admin/Webhooks.tsx:124-137 — `.eq('DigiCom Business', biz).order('created_at',
-- {ascending:false}).limit(50)` at refetchInterval 5000. PostgREST emits a plain
-- `ORDER BY created_at DESC` (NULLS FIRST, the btree DESC default), so this index
-- matches the sort exactly and turns the top-N heapsort over every business row
-- into an Index Scan + Limit 50.
--
-- Recon suggests CREATE INDEX CONCURRENTLY. Dropped deliberately: CONCURRENTLY
-- cannot run inside a transaction block and this file is one atomic migration.
-- webhook_logs is 5 332 rows — the plain build takes an ACCESS EXCLUSIVE lock for
-- single-digit milliseconds. Not worth splitting the migration.
--
-- Parity quirk flagged, NOT fixed (recon 03 §3.2): the Endpoints-tab KPI counters
-- (:209-210) and the tab badge (:263) are computed over this `.limit(50)` window,
-- so they already mean "of the last 50", not "total". Pre-existing; the index does
-- not change it.
create index if not exists idx_webhook_logs_biz_created
  on public.webhook_logs ("DigiCom Business", created_at desc);

-- ===========================================================================
-- ③ delivery_fees_bulk_apply — kills the "Auto Fill All" N+1 (recon 03 §3.1)
-- ===========================================================================
-- ONE call, ONE transaction, all-or-nothing. That IS the point: today a mid-loop
-- failure leaves an arbitrary committed prefix of up to 448 fee rows while the
-- optimistic UI shows all of them updated. Any bad row here (FK violation, RLS
-- rejection, bad uuid) aborts the whole statement and NOTHING is written.
--
-- PARITY with saveFeeRowByMasterCity (DeliveryServices.tsx:88-126), per-row:
--   match  = (entity_key, master_city_id, "DigiCom Business")
--   exists => UPDATE {feeColumn, updated_at} ONLY — the sibling fee column is NOT
--             touched (:110-114).
--   else   => INSERT {..match, fee, return_fee, updated_at} with the SIBLING SEEDED
--             TO 0 (:117-124 — "Seed the missing column so existing delivery/return
--             fees default sensibly"). Replicated exactly.
-- Both fee tables already carry the partial unique index the client comment says
-- PostgREST could not target — e.g.
--   courier_fees_courier_master_city_biz_uniq
--     (courier_id, master_city_id, "DigiCom Business") WHERE master_city_id IS NOT NULL
-- ON CONFLICT CAN target it by restating the predicate, which is why this collapses
-- to one statement. Verified: no triggers on company_fees / courier_fees, so the
-- no-op self-assign on the sibling column in DO UPDATE is unobservable.
--
-- Deviations, flagged not fixed:
--   * updated_at is now() (transaction-constant) instead of a fresh
--     `new Date().toISOString()` per row. 448 rows now share one timestamp.
--   * Duplicate master_city_id entries in p_rows are DEDUPED, last occurrence wins
--     — mirroring the sequential loop where the last write to a city survives — and
--     counted in `skipped`. The client's `cities` list is already distinct, so this
--     is defensive.
--   * A null master_city_id RAISES (22023) instead of being attempted. The client
--     would have hit `.maybeSingle()` against a partial index that excludes NULLs;
--     `cities` never carries a null id.
create or replace function public.delivery_fees_bulk_apply(
    p_business uuid,
    p_entity_kind text,          -- 'courier' | 'company'
    p_entity_id uuid,
    p_fee_column text,           -- 'fee' | 'return_fee'
    p_rows jsonb                 -- [{"master_city_id": uuid, "fee": numeric}, ...]
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path to ''
as $$
declare
    v_in_count   integer;
    v_null_cities integer;
    v_applied    integer := 0;
    v_inserted   integer := 0;
    v_updated    integer := 0;
    v_skipped    integer := 0;
    v_now        timestamptz := now();
begin
    -- ADMIN GATE FIRST (money table, business-wide write — D3/D5 standing rule)
    if not (select public.current_user_is_business_admin()) then
        raise exception 'delivery_fees_bulk_apply: admin only' using errcode = '42501';
    end if;
    if p_business is null or p_entity_id is null then
        raise exception 'delivery_fees_bulk_apply: p_business and p_entity_id are required' using errcode = '22023';
    end if;
    if coalesce(p_entity_kind, '') not in ('courier', 'company') then
        raise exception 'delivery_fees_bulk_apply: invalid p_entity_kind %', p_entity_kind using errcode = '22023';
    end if;
    if coalesce(p_fee_column, '') not in ('fee', 'return_fee') then
        raise exception 'delivery_fees_bulk_apply: invalid p_fee_column %', p_fee_column using errcode = '22023';
    end if;
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'delivery_fees_bulk_apply: p_rows must be a jsonb array' using errcode = '22023';
    end if;

    v_in_count := jsonb_array_length(p_rows);
    if v_in_count = 0 then
        return jsonb_build_object('applied', 0, 'skipped', 0, 'inserted', 0, 'updated', 0);
    end if;
    if v_in_count > 5000 then
        raise exception 'delivery_fees_bulk_apply: too_many_rows (max 5000, got %)', v_in_count using errcode = '22023';
    end if;

    -- A null master_city_id can never be upserted (the unique index excludes NULLs)
    -- and would silently no-op — refuse the whole batch instead.
    select count(*) into v_null_cities
    from jsonb_array_elements(p_rows) e
    where nullif(e->>'master_city_id', '') is null;
    if v_null_cities > 0 then
        raise exception 'delivery_fees_bulk_apply: % row(s) carry a null master_city_id', v_null_cities using errcode = '22023';
    end if;

    -- deduped target count (last occurrence per city wins — sequential-loop parity)
    select count(*)::int into v_applied
    from (select distinct (e->>'master_city_id')::uuid as city_id
          from jsonb_array_elements(p_rows) e) d;
    v_skipped := v_in_count - v_applied;

    if p_entity_kind = 'courier' then
        with input as (
            select distinct on (r.city_id) r.city_id, r.fee
            from (
                select (e->>'master_city_id')::uuid      as city_id,
                       coalesce((e->>'fee')::numeric, 0) as fee,
                       ord
                from jsonb_array_elements(p_rows) with ordinality t(e, ord)
            ) r
            order by r.city_id, r.ord desc
        ),
        up as (
            insert into public.courier_fees as cf
                (courier_id, master_city_id, "DigiCom Business", fee, return_fee, updated_at)
            select p_entity_id, i.city_id, p_business,
                   case when p_fee_column = 'fee'        then i.fee else 0 end,
                   case when p_fee_column = 'return_fee' then i.fee else 0 end,
                   v_now
            from input i
            on conflict (courier_id, master_city_id, "DigiCom Business")
                where master_city_id is not null
            do update set
                -- ONLY the target column moves; the sibling keeps its stored value
                fee        = case when p_fee_column = 'fee'        then excluded.fee        else cf.fee end,
                return_fee = case when p_fee_column = 'return_fee' then excluded.return_fee else cf.return_fee end,
                updated_at = excluded.updated_at
            returning (xmax = 0) as was_insert
        )
        select count(*) filter (where was_insert)::int,
               count(*) filter (where not was_insert)::int
        into v_inserted, v_updated
        from up;
    else
        with input as (
            select distinct on (r.city_id) r.city_id, r.fee
            from (
                select (e->>'master_city_id')::uuid      as city_id,
                       coalesce((e->>'fee')::numeric, 0) as fee,
                       ord
                from jsonb_array_elements(p_rows) with ordinality t(e, ord)
            ) r
            order by r.city_id, r.ord desc
        ),
        up as (
            insert into public.company_fees as cf
                (company_id, master_city_id, "DigiCom Business", fee, return_fee, updated_at)
            select p_entity_id, i.city_id, p_business,
                   case when p_fee_column = 'fee'        then i.fee else 0 end,
                   case when p_fee_column = 'return_fee' then i.fee else 0 end,
                   v_now
            from input i
            on conflict (company_id, master_city_id, "DigiCom Business")
                where master_city_id is not null
            do update set
                fee        = case when p_fee_column = 'fee'        then excluded.fee        else cf.fee end,
                return_fee = case when p_fee_column = 'return_fee' then excluded.return_fee else cf.return_fee end,
                updated_at = excluded.updated_at
            returning (xmax = 0) as was_insert
        )
        select count(*) filter (where was_insert)::int,
               count(*) filter (where not was_insert)::int
        into v_inserted, v_updated
        from up;
    end if;

    -- RLS (…_tenant_all: "DigiCom Business" = current_user_digicom_business_id())
    -- silently drops rows it rejects on INSERT..ON CONFLICT? No — it raises 42501
    -- on the WITH CHECK. This assertion catches any other row-count drift.
    if (v_inserted + v_updated) <> v_applied then
        raise exception 'delivery_fees_bulk_apply: wrote % of % rows — aborting',
              (v_inserted + v_updated), v_applied using errcode = '23514';
    end if;

    return jsonb_build_object(
        'applied',  v_applied,
        'skipped',  v_skipped,
        'inserted', v_inserted,
        'updated',  v_updated
    );
end;
$$;

revoke all on function public.delivery_fees_bulk_apply(uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.delivery_fees_bulk_apply(uuid, text, uuid, text, jsonb) to authenticated;
alter function public.delivery_fees_bulk_apply(uuid, text, uuid, text, jsonb) owner to postgres;

commit;
