-- D5 — collaborator leaderboards (contract: docs/d5-recon/03-design.md).
-- Recon: docs/d5-recon/01-sellers-mb.md, 02-couriers-db.md (live-verified 2026-07-15).
--
-- Four items, in the contract's sequencing order:
--   ① courier_roster_stats  — GATE RETROFIT (it is LIVE, WIRED and UNGATED)
--   ② courier_notes_detail  — NEW, lazy per-courier modal detail, gated
--   ③ seller_roster_stats   — NEW, lifetime roster aggregate, gated
--   ④ mb_roster_earnings    — NEW, month roster payroll, self-or-admin gated
--
-- D2/D3/D4 conventions: SECURITY INVOKER (RLS is the row gate; explicit
-- p_business = defense in depth + index driver), STABLE, `set search_path
-- to ''`, single jsonb return (except ①, which keeps its live `returns table`
-- signature — see below), explicit p_business, flag-column status semantics,
-- Casablanca day boundaries, grants footer.
--
-- HONEST FRAMING (recon 02 §4.3): unlike D4 this is NOT an active wrong-money
-- fire. Only `orders` (2,109 rows) is past the 1000 cap today, and both order
-- dumps already use fetchAllRows. The value here is (a) download-volume
-- collapse, (b) closing the LATENT cap on the bare selects
-- (seller_payments / mediabuyer_payments / campaigns / both courier note
-- tables — correct today, silently truncating the day they cross 1000), and
-- (c) the missing admin gates. D5-BUG-3 (`seller_payments` bare select) is the
-- one that is wrong-money *by class*, not yet by data.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- STANDING RULE 2 — PARITY IS THE BAR. Every figure below replicates the
-- client math byte-for-byte, INCLUDING known client bugs. Each replicated bug
-- is named here and needs a separate OWNER RULING; none is silently "fixed".
-- ═══════════════════════════════════════════════════════════════════════════
--
-- REPLICATED CLIENT BUGS (owner ruling required — log to MASTER_TODO):
--
--   * D5-BUG-1 + D5-BUG-2 (④, `prior_paid_amount`) — THE CONTRACT'S LOCKED
--     DECISION (03-design.md §④): replicate the client bug-for-bug.
--     What the client does (useMediaBuyerEarnings.ts L221-234 + L296):
--        .eq('payout_month', month)  with month = 'YYYY-MM'
--        prior_paid_amount = Σ rows.total_amount
--     `payout_month` is TEXT storing 'YYYY-MM-01' (live-verified: `select
--     distinct length(payout_month)` → 10 on both seller_payments and
--     mediabuyer_payments; `= '2026-07'` → 0 rows, `= '2026-07-01'` → 1 row).
--     ⇒ the predicate matches 0 rows ALWAYS ⇒ prior_paid_amount ≡ 0,
--       existing_payout ≡ null, remaining_amount ≡ total_amount.
--     This RPC therefore does `mp.payout_month = p_month` VERBATIM (p_month is
--     the client's 'YYYY-MM' string, NOT normalized) and sums `total_amount`.
--     Same stance D2 already took in mb_dashboard_stats.prior_paid (mig
--     20260714230000 L1810, `v_month := to_char(..., 'YYYY-MM')`).
--     CORRECT SEMANTICS (for the ruling, NOT implemented here):
--        where mp.payout_month = to_char(v_month_start, 'YYYY-MM-DD')
--        prior_paid_amount = Σ coalesce(mp.paid_amount, 0)
--     BLAST RADIUS of keeping it: MediaBuyers "Unpaid" KPI = full payroll;
--     progress bar always 0%; paymentTier always "Pays due"; sortBy='unpaid'
--     ≡ sortBy='payroll'; modal "Total paid" always 0; mediabuyer/Payments.tsx
--     "déjà versés" banner never renders; and — the real hazard —
--     Salaries.tsx L1151-1159 generates a payout with total_amount =
--     remaining_amount = the FULL month, ignoring prior payments ⇒ DOUBLE-PAY.
--     If the owner rules "fix", mb_dashboard_stats.prior_paid (D2 mig L1810)
--     MUST move in the same commit or the MB dashboard and this leaderboard
--     will disagree. This is recon 01 §7 O-1 and it is now a THIRD surface.
--
--   * D5-BUG-8 (④, `existing_payout`) — client takes mbPayments[0] from an
--     unordered PostgREST result (arbitrary when a month has both an `open`
--     and a `closed` row; live: seller_payments 2026-06-01 has closed×3 AND
--     open×1). Made DETERMINISTIC here (`order by created_at, id`). Moot in
--     practice: the D5-BUG-1 predicate makes it null unconditionally.
--
--   * D5-DEV-S1 (③, `total_revenue`) — Σ RAW `o.price` over delivered, NOT
--     pureRevenueForOrder, NOT paid-gated. Deliberate per the seller-listing-
--     total memo (`order.price` = seller TOTAL incl. delivery when toggled).
--     This is a DIFFERENT NUMBER from D3's `admin_analytics_stats.sellers[]
--     .revenue` (full pureRevenue chain over paid+delivered). NOT
--     interchangeable — do not "converge" them without an owner ruling (O-4).
--
--   * D5-DEV-S2 (③, `live_commission`) — re-derives commission from `orders`,
--     contradicting the standing rule "seller_daily_earnings is the money
--     source; never sum orders client-side". The page renders BOTH
--     "Unpaid commission" (order-derived) next to "Commission earned"
--     (sde-derived) — a live drift surface. Replicated as-is (O-4).
--
--   * D5-DEV-S3 (③, `delivery_rate`) — numerator is ALL of the seller's own
--     delivered orders, NOT tracked-gated; denominator is tracked − pullback.
--     ⇒ can exceed 100%. Shipped UNCLAMPED (the page renders the raw ratio;
--     it clamps only the progress-bar width via min(100, rate)).
--
--   * D5-DEV-S4 / D5-BUG-6 (③, `total_sellers`) — the header pill renders
--     "{totalSellers} active" but the client applies NO `active` filter.
--     `total_sellers` here = the whole roster, unfiltered (parity). Per the
--     contract's "shape EXACTLY per recon §5.1 ③", `active_sellers` is NOT
--     added (recon 01 §6.1 lists it; recon 02 §5.1 does not — §5.1 wins).
--     Owner ruling O-5.
--
--   * D5-DEV-S5 (③, `pending`) — the status chain's branch 6 is a double
--     `pending`: NULL/unknown `order_status_id` collapses into pending.
--     Replicated via the `else 'pending'` arm.
--
--   * ③ `confirmed` = `rate_confirmed`, NOT the chain's `confirmed++` counter.
--     Sellers.tsx L391 sets `confirmedOrders: rateConfirmedCount`
--     ("one-true-definition"); the chain's `confirmed` variable is computed
--     and DISCARDED. ⇒ the modal's distribution bar DOUBLE-COUNTS (delivered /
--     shipped / cancelled orders are also inside rate_confirmed). Replicated:
--     the chain is still reproduced faithfully (its ordering routes rows into
--     `pending`), but only `rate_confirmed` is projected, under the key
--     `confirmed`, exactly per recon 02 §5.1 ③.
--
--   * D5-DEV-M1 (④, salaried MBs' `delivered_orders`) — the client computes
--     `delivered` UNCONDITIONALLY (incl. salaried MBs) and it drives the
--     podium + rank + sort; `mb_month_earned` returns delivered = 0 for
--     salaried MBs. RESOLUTION (both bars met, no visible change):
--       - `delivered_orders` = the RAW count → client parity (podium/rank/sort)
--       - `salary_earned`/`commission_earned`/`total_amount` = the AUTHORITY's
--         branch (salary ⇒ commission 0 regardless of delivered)
--     ⇒ the MONEY is byte-identical to mb_month_earned.earned, and the
--     DISPLAY count is byte-identical to the client. mb_month_earned's
--     delivered=0-for-salary is a display zero no payroll consumer reads
--     (earned = salary either way). Owner ruling O-3 (does the ledger want
--     delivered_orders zeroed for salaried MBs on the leaderboard too?).
--     Live: 0 salaried MBs in the main business ⇒ NOT materialized today.
--
--   * D5-DEV-M2 (④, exchange filter) — client uses `o.replace !== true`; the
--     authority uses `coalesce(o.swap_only,false) = false`. The AUTHORITY's
--     form is used (contract §④: "do NOT re-derive payroll"). LATENT: live
--     `replace is true` = 9, `swap_only` = 9, `replace AND NOT swap_only` = 0
--     ⇒ the two predicates coincide on today's data.
--
-- DELIBERATE DEVIATIONS FROM THE CLIENT (accepted, results-identical live):
--
--   * ③ order pool adds `o."DigiCom Business" = p_business`. The client filters
--     ONLY by `seller_id in (roster)` (Sellers.tsx L210) and relies on sellers
--     belonging to exactly one business. Live-verified identical: orders of
--     the roster's sellers with a different "DigiCom Business" → 0 rows. Same
--     stance D2 took for seller_payments (mig header). Index driver.
--   * ② `courier_fees` gains the `"DigiCom Business" = p_business` filter the
--     client omits (Couriers.tsx L231 uses `.in('courier_id', ids)` only —
--     RLS is its sole tenant gate; recon 02 §5.2 logs it as the RLS-only-gate
--     instance). Live-verified identical: 0 divergent rows.
--   * ④ platform→source map: the STRICT 12-entry map, unmapped ⇒ '' ⇒ the
--     (day, source) pair is DROPPED (client + D2's mb_dashboard_stats stance).
--     `mb_month_earned`'s inline CASE has the same 12 entries but `else ''`
--     falls THROUGH into `lower(o.source_name) = ''`, so an order with an
--     EMPTY (not NULL) source_name would be attributed. Live-verified: 0 such
--     orders, and every live platform value maps ('Whatsapp ads'). Latent.
--     NOTE this map is deliberately NOT `normalize_ad_source` (D3), which
--     lowercase-passes-through unmapped values (D5-DEV-M6).
--   * ④ no 1/N split when N MBs claim the same (day, source) — client AND
--     authority agree; both deliberately differ from D3's `mediabuyers`
--     section, which DOES split 1/N (D5-DEV-M7). Structurally moot:
--     campaign_source_locks = one ad source ↔ one MB per business.
--   * Tie-breaks made DETERMINISTIC (same stance as D2's "first order_item"):
--     ③ `top_city` (client: Object.entries insertion order → arbitrary on a
--     tie) → `order by count desc, city_name`; ③ roster order → `created_at,
--     id` (client: users `.order('created_at')`); ④ roster order →
--     `created_at, id` (client: no `.order()` at all → unspecified);
--     ② `zones` sorted by city name in the DB collation (client:
--     `String.localeCompare`) — cosmetic ordering only.
--   * ③ `last_active` = `max(seller_presences.date)`; the client sorts by
--     `new Date(date)` desc and takes [0] — identical for a `date` column.
--   * ①/②/③/④ Casablanca day boundaries where day math exists (only ④ buckets
--     by day). ③ is entirely count/sum-based — no day bucketing at all — so
--     the client's browser-local `isOnline`/`daysActive` stay client-side and
--     presentational (D5-DEV-S6).
--
-- OUT OF SCOPE (contract §"Out of scope" → MASTER_TODO/D7):
--   * `useTrackedOrders`' two `staleTime:0 / refetchOnMount:'always'` full
--     parcel dumps. ③ computes tracked/pullback server-side so Sellers.tsx
--     stops NEEDING it, but the hook stays alive for its other consumers.
--   * D4's stale header comment claiming `courier_fees` has "no unique key on
--     (courier_id, master_city_id)". CORRECTION (recon 02 §1.2): a PARTIAL
--     UNIQUE INDEX on the 3-tuple exists —
--     `courier_fees_courier_master_city_biz_uniq (courier_id, master_city_id,
--     "DigiCom Business") WHERE master_city_id IS NOT NULL`. D4's LATERAL …
--     ORDER BY updated_at DESC LIMIT 1 is still CORRECT (3-tuple key, index is
--     partial), so this is a DOCUMENTATION defect, not a correctness defect.
--     ① keeps the LATERAL byte-identical.
--
-- INDEXES: none added. Every driving predicate ("DigiCom Business" =
-- p_business, grouped by seller_id/courier_id/mediabuyer_id/created_by) has a
-- supporting index (recon 02 §4.2), and D2 already added idx_orders_biz_date.
--
-- Reversible:
--   ① re-apply mig 20260714210000's courier_roster_stats block (restores
--      `language sql`, ungated).
--   ②③④ drop function public.courier_notes_detail(uuid, uuid),
--       public.seller_roster_stats(uuid),
--       public.mb_roster_earnings(uuid, text, uuid).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- ① courier_roster_stats — GATE RETROFIT
-- ═══════════════════════════════════════════════════════════════════════════
-- Same recipe as mig 20260715020000 (admin_dashboard_stats): the body below is
-- the LIVE `pg_get_functiondef` output with ONLY the admin gate prepended —
-- byte-identical otherwise (every CTE, join, filter and the courier_fees
-- LATERAL are untouched).
--
-- WHY IT NEEDS THE GATE: it returns business-wide per-collaborator money
-- (fees_sum, notes_paid_sum, notes_unpaid_sum) with `p_business` a free
-- parameter, SECURITY INVOKER and NO gate. RLS blocks privilege escalation,
-- but `orders` carries TENANT-WIDE RLS, so any authenticated business member
-- could call this RPC straight through PostgREST and receive a pre-aggregated
-- business-wide money payload — exactly what the MB-facing data rule forbids
-- the UI to show them. This closes a hole in already-shipped D4 code.
--
-- CALLER VERIFICATION (contract §① "VERIFY FIRST"): `grep -rn
-- courier_roster_stats src/` → exactly ONE call site,
-- `src/pages/admin/collaborators/Couriers.tsx:217`, inside App.tsx's
-- `<ProtectedRoute allowedRoles={['super admin','admin']}>` block (L283-343).
-- `current_user_is_business_admin()` = `role IN ('super admin','admin')` — an
-- EXACT match for the route guard ⇒ the plain admin gate regresses no
-- legitimate caller; the self-or-admin shape is NOT needed. The courier-facing
-- surface is `courier_self_stats` (courier/Dashboard.tsx:211) and stays as-is.
--
-- SIGNATURE UNCHANGED (`returns table(...)`, 9 columns, same types/order) —
-- no client type churn. `language sql` CANNOT `raise`, so the gate forces
-- `sql` → `plpgsql`; the original SELECT is returned verbatim via
-- `return query`. Every identifier in it is already qualified or an output
-- alias, so no OUT-parameter/column ambiguity arises.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.courier_roster_stats(p_business uuid)
 RETURNS TABLE(courier_id uuid, total_orders bigint, delivered bigint, in_transit bigint, returned bigint, fees_sum numeric, notes_paid_sum numeric, notes_unpaid_sum numeric, notes_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
    -- ADMIN GATE (D5 ①, D3-review standing rule 1): business-wide
    -- per-collaborator money. Consumer route is admin-only — no legitimate
    -- caller regresses. See the header for the caller grep.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'courier_roster_stats: admin only' using errcode = '42501';
    end if;

    return query
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
end
$function$;

revoke all on function public.courier_roster_stats(uuid) from public, anon;
grant execute on function public.courier_roster_stats(uuid) to authenticated;
alter function public.courier_roster_stats(uuid) owner to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- ② courier_notes_detail(p_business, p_courier) — NEW, lazy modal detail
-- ═══════════════════════════════════════════════════════════════════════════
-- Kills the page's two roster-path bare selects (Couriers.tsx L259-273
-- `courier_payment_notes`, L275-289 `courier_return_notes` — both dump the
-- whole business's notes for EVERY courier and are then filtered CLIENT-side
-- per courier, purely to feed the detail modal's two tables) and folds the
-- modal's zone LIST (courier_fees ⋈ master_cities, L573-579).
--
-- Both note selects are BARE ⇒ latent 1000-cap (live: 12 payment notes, 1
-- return note). `courier_return_notes` is entirely absent from D4's
-- courier_roster_stats.
--
-- LAZY: the caller MUST gate this query on modal open (`enabled: !!selected`)
-- — the kept-mounted trap, precedent [[chat-orders-history]]: extracted view
-- dialogs must gate queries on open.
--
-- The zone COUNT stays on the roster card, client-side from the page's
-- `courier_fees` query — the contract's ① is a GATE-ONLY retrofit
-- (byte-identical body), so recon 02 §5.1's "add zones/return_notes_count to
-- ①" is deliberately NOT done. The zone LIST lives here.
--
-- Shape per recon 02 §5.1 ②: { payment_notes: [...], return_notes: [...],
-- zones: [{city, delivery}] }. Column projections are byte-identical to the
-- client's selects; `zones` mirrors zoneRows (city name or 'Unknown', fee).
-- ---------------------------------------------------------------------------
create or replace function public.courier_notes_detail(p_business uuid, p_courier uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
    v_out jsonb;
begin
    -- ADMIN GATE (standing rule 1): per-collaborator money detail. The only
    -- consumer is the admin Couriers modal. The courier-facing note surfaces
    -- (courier/Payments.tsx) read their own rows directly under RLS and are
    -- untouched.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'courier_notes_detail: admin only' using errcode = '42501';
    end if;

    select jsonb_build_object(
        -- Couriers.tsx L264-272 projection + `order created_at desc`.
        'payment_notes', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', n.id,
                'courier_id', n.courier_id,
                'reference', n.reference,
                'status', n.status,
                'total_amount', n.total_amount,
                'total_shipping_fees', n.total_shipping_fees,
                'net_amount', n.net_amount,
                'order_count', n.order_count,
                'paid_at', n.paid_at,
                'created_at', n.created_at
            ) order by n.created_at desc, n.id desc)
            from public.courier_payment_notes n
            where n."DigiCom Business" = p_business
              and n.courier_id = p_courier
        ), '[]'::jsonb),
        -- Couriers.tsx L280-288 projection (received_at, not paid_at).
        'return_notes', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', n.id,
                'courier_id', n.courier_id,
                'reference', n.reference,
                'status', n.status,
                'total_amount', n.total_amount,
                'total_shipping_fees', n.total_shipping_fees,
                'net_amount', n.net_amount,
                'order_count', n.order_count,
                'received_at', n.received_at,
                'created_at', n.created_at
            ) order by n.created_at desc, n.id desc)
            from public.courier_return_notes n
            where n."DigiCom Business" = p_business
              and n.courier_id = p_courier
        ), '[]'::jsonb),
        -- Couriers.tsx L573-579 zoneRows. Adds the biz filter the client omits
        -- (header deviation; live-verified identical).
        'zones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'city', coalesce(mc.name, 'Unknown'),
                'delivery', coalesce(f.fee, 0)
            ) order by coalesce(mc.name, 'Unknown'), f.id)
            from public.courier_fees f
            left join public.master_cities mc on mc.id = f.master_city_id
            where f."DigiCom Business" = p_business
              and f.courier_id = p_courier
        ), '[]'::jsonb)
    )
    into v_out;

    return v_out;
end
$function$;

revoke all on function public.courier_notes_detail(uuid, uuid) from public, anon;
grant execute on function public.courier_notes_detail(uuid, uuid) to authenticated;
alter function public.courier_notes_detail(uuid, uuid) owner to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- ③ seller_roster_stats(p_business) — NEW, LIFETIME roster aggregate
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces Sellers.tsx's ENTIRE data layer: the 9-dep `useEffect` fetch-
-- everything (L179-181), 5 unbounded lifetime downloads (orders + 4 embedded
-- joins incl. order_items, seller_daily_earnings '*', seller_presences '*',
-- and — transitively via useTrackedOrders — company_parcels + courier_parcels),
-- 2 bare selects (seller_payments ⇐ D5-BUG-3, products), and the
-- O(sellers × rows) client partition loops (L257-260).
--
-- NOT reusable, verified (recon 01 §4.2/§4.3, recon 02 §2.5):
--   * seller_dashboard_stats — windowed + single-seller (N+1) + p_seller-guarded.
--   * admin_analytics_stats.sellers[] — STRICT window (leaderboard is
--     lifetime), and its `revenue` is the full pureRevenue chain over
--     paid+delivered, NOT Σ raw price over delivered (D5-DEV-S1). Different
--     numbers. Do NOT extend it — that would couple the Analytics parity
--     contract to the leaderboard's.
--
-- Pool: "DigiCom Business" = p_business AND date_deleted IS NULL AND
-- source_review_status <> 'pending' AND replace IS DISTINCT FROM true AND
-- seller_id ∈ roster. (`<>` ≡ PostgREST `neq` here: the column is NOT NULL
-- with 0 NULLs live — D2 verified this before choosing the form. The ADMIN
-- pool DOES exclude source_review_status='pending', unlike the seller-facing
-- pages — recon 02 §2.3 note 4.)
--
-- Tracked = the D2 hashed-set CTE (company_parcels ∪ courier_parcels with a
-- non-blank tracking_code, biz-scoped) joined ONCE — never a per-row subplan.
-- Pullback = tracked AND excluded_from_delivery_rate on the order status OR
-- the package status (= useStatusCategories' adminPullbackOrderIds /
-- adminPullbackPackageIds, L162-163 — verified identical).
--
-- Status chain (Sellers.tsx L271-290) — FIRST MATCH WINS, ORDER IS
-- LOAD-BEARING; flag predicates from useStatusCategories' ORDER_CAT_PRED /
-- PKG_CAT_PRED. Unknown/NULL order_status_id resolves to false on every arm
-- (client: `orderIdMap.get(sid)` → undefined → false; server: LEFT JOIN → NULL
-- → coalesce false) and lands in `pending` (D5-DEV-S5).
--
-- Rates stay UNCLAMPED and are shipped computed; `delivered_sum` + `denom_sum`
-- ship SEPARATELY so the client divides → pooled-ratio parity for
-- avgDeliveryRate (Σdelivered / ΣdeliveryDenom × 100 — a POOLED RATIO, not a
-- mean of rates). `top_city` ships PER ROW — the page's search matches on it
-- (Sellers.tsx L456).
--
-- Kept client-side (unchanged): productNames (bounded `products` select),
-- isOnline / daysActive (browser-local, presentational).
-- ---------------------------------------------------------------------------
create or replace function public.seller_roster_stats(p_business uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
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
$function$;

revoke all on function public.seller_roster_stats(uuid) from public, anon;
grant execute on function public.seller_roster_stats(uuid) to authenticated;
alter function public.seller_roster_stats(uuid) owner to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- ④ mb_roster_earnings(p_business, p_month, p_mb) — NEW, MONTH roster payroll
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces useMediaBuyerEarnings' internals (a 3-deep waterfall: users → mbIds
-- → entries → sourceList → orders, + priorPayments in parallel; NO staleTime
-- on any of the 4 queries ⇒ the whole waterfall re-runs serially on every
-- mount AND every window focus) and folds MediaBuyers.tsx's two page-level
-- bare selects (mediabuyer_payments L161-174, campaigns L176-188).
-- Kills D5-BUG-4 (both bare selects, 1000-cap) and D5-BUG-5
-- (campaign_daily_entries bare select, 1000-cap).
--
-- MONTH MATH = `mb_month_earned`'s BODY, MADE SET-RETURNING — never called
-- per row (that would be N+1). mb_month_earned IS the payout authority (its
-- only callers are close_mediabuyer_month and refresh_open_mediabuyer_ticket,
-- both SECDEF/cron) and `useMediaBuyerEarnings` is a SECOND, DRIFTING
-- implementation of payroll that also backs the Salaries bulk-payout
-- generator. This fn retires that drift. The payroll formula is NOT
-- re-derived — the authority's own predicates are used verbatim:
--   * entries month = date_trunc('month', entry_date) = date_trunc('month', month)
--   * spend    = coalesce(sum(cde.spend), 0)
--   * campaigns= count(distinct coalesce(campaign_id::text, '__orphan__'||platform))
--   * delivered= count(distinct o.id) over
--                  (o.date at time zone 'Africa/Casablanca')::date = e.entry_date
--                  AND lower(o.source_name) = <the inline 12-entry CASE>
--                  AND ps.is_delivered AND o.date_deleted is null
--                  AND o.source_review_status is distinct from 'pending'
--                  AND coalesce(o.swap_only, false) = false        [D5-DEV-M2]
--   * earned   = salary ⇒ salary_amount ; else ⇒ delivered × commission_price
-- `mb_month_earned` itself is NOT touched (recon 01 §4.4 Route A is deferred:
-- it rewrites the payout authority and needs an owner confirmation + a
-- close_mediabuyer_month / refresh_open_mediabuyer_ticket parity check).
-- Route B (SECDEF wrapper) breaks the INVOKER convention; Route C (inline
-- duplicate) is forbidden. This fn is INVOKER and re-expresses the authority's
-- body set-wise — mb_month_earned reads only users / campaign_daily_entries /
-- orders / package_statuses, ALL readable by an admin under RLS today (the
-- client already does exactly this), so INVOKER is sufficient here; SECDEF is
-- needed only for the cron path, which keeps its own fn. When Route A lands,
-- collapse the two.
--
-- SET-WISE ≡ PER-ROW proof: the authority joins campaign_daily_entries → orders
-- and kills duplicate (entry_date, platform) rows with count(distinct o.id);
-- this fn de-duplicates the (day, source) pairs FIRST and then still counts
-- distinct o.id ⇒ the same distinct order set, one pass, no N+1 (D5-DEV-M3:
-- the client's Set-dedupe ≡ distinct, same result).
--
-- `total_amount` ≡ mb_month_earned.earned EXACTLY:
--    salary_earned     = payment_type='salary' ? salary_amount : 0
--    commission_earned = payment_type='salary' ? 0 : delivered × commission_price
--    total_amount      = salary_earned + commission_earned
-- ⚠ LATENT DIVERGENCE FROM THE CLIENT: the client gates commission on
-- `payment_type === 'commission'` (⇒ 0 for any OTHER value); the authority
-- gates on `payment_type = 'salary'` (⇒ delivered × price for any other
-- value). They differ ONLY when payment_type ∉ {'salary','commission'}.
-- The AUTHORITY's form wins (contract §④: "do NOT re-derive payroll").
-- Live: the main business's only mediabuyer is 'commission' ⇒ not materialized.
--
-- GATE = self-or-admin (`admin OR p_mb = auth.uid()`), the seller_dashboard_
-- stats shape. A BLANKET admin gate would break mediabuyer/Payments.tsx, which
-- mounts the same hook with {selfMbId: uid} and is NOT admin. The other two
-- consumers (admin Salaries.tsx, admin MediaBuyers.tsx) pass p_mb = null and
-- take the admin path.
--
-- MB PII: satisfied BY CONSTRUCTION. This fn projects NO user PII at all — no
-- name/email/avatar/phone/bank_*/cin/address. The FE adopts the already-
-- migrated Couriers.tsx seam (a separate `users` query joined client-side by
-- id), so peers' banking/salary/PII can never enter a self-caller's payload.
-- Belt and braces: when p_mb is set, the roster AND the lifetime `payouts`
-- list are both narrowed to that MB.
-- ---------------------------------------------------------------------------
create or replace function public.mb_roster_earnings(p_business uuid, p_month text, p_mb uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
    v_out         jsonb;
    v_month_start date;
begin
    -- SELF-OR-ADMIN GATE (recon 02 §5.1 ④; mirrors seller_dashboard_stats).
    if not coalesce(public.current_user_is_business_admin(), false)
       and (p_mb is null or p_mb is distinct from (select auth.uid())) then
        raise exception 'mb_roster_earnings: p_mb not permitted' using errcode = '42501';
    end if;

    -- Accrual month anchor. The client passes 'YYYY-MM' (MediaBuyers.tsx L155
    -- `format(new Date(),'yyyy-MM')`); 'YYYY-MM-DD' is accepted too. NOTE this
    -- normalization is used ONLY for the accrual math — `prior_paid` /
    -- `existing_payout` deliberately use p_month RAW (D5-BUG-1, see header).
    v_month_start := date_trunc('month',
        (case when p_month ~ '^\d{4}-\d{2}$' then p_month || '-01' else p_month end)::date)::date;

    with roster as (
        select u.id,
               u.created_at,
               u.payment_type,
               coalesce(u.commission_price, 0)::numeric as commission_price,
               coalesce(u.salary_amount, 0)::numeric as salary_amount
        from public.users u
        where u."DigiCom Business" = p_business
          and u.role = 'mediabuyer'
          and (p_mb is null or u.id = p_mb)
    ),
    entries_m as (
        -- mb_month_earned's entries predicate + its inline 12-entry platform
        -- CASE, verbatim. Byte-identical to the client's getPlatformSource
        -- (src/lib/campaignConstants.tsx PLATFORM_SOURCE_MAP) — verified
        -- entry-by-entry. Deliberately NOT normalize_ad_source (D5-DEV-M6).
        select e.campaign_id,
               e.created_by,
               e.entry_date,
               e.platform,
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
                    else '' end as src
        from public.campaign_daily_entries e
        join roster r on r.id = e.created_by
        where e."DigiCom Business" = p_business
          and date_trunc('month', e.entry_date)::date = v_month_start
    ),
    spend_agg as (
        -- Computed for salaried MBs TOO (the authority computes v_spend/v_camps
        -- BEFORE its salary branch; the client also computes them
        -- unconditionally). D5-DEV-M8: campaigns_count is overridden on the
        -- roster card by owned_campaign_count anyway.
        select em.created_by as mb_id,
               coalesce(sum(em.spend), 0)::numeric as total_spend,
               count(distinct coalesce(em.campaign_id::text, '__orphan__' || em.platform))::int as campaigns_count
        from entries_m em
        group by 1
    ),
    pairs as (
        -- src = '' ⇒ DROPPED (client: `if (s) daySourceSet.add(...)`; D2's
        -- mb_dashboard_stats month_pairs takes the same stance). The authority's
        -- `else ''` would instead fall through to lower(source_name) = '' —
        -- live-verified 0 such orders. See the header.
        select distinct em.created_by as mb_id, em.entry_date as d, em.src
        from entries_m em
        where em.src <> ''
    ),
    del as (
        select pr.mb_id,
               count(distinct o.id)::int as delivered
        from pairs pr
        join public.orders o
          on (o.date at time zone 'Africa/Casablanca')::date = pr.d
         and lower(o.source_name) = pr.src
        join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and ps.is_delivered
          and o.date_deleted is null
          and o.source_review_status is distinct from 'pending'
          and coalesce(o.swap_only, false) = false
        group by 1
    ),
    earn as (
        select r.id as mb_id,
               coalesce(d.delivered, 0) as delivered_orders,
               case when r.payment_type = 'salary' then r.salary_amount else 0 end::numeric as salary_earned,
               case when r.payment_type = 'salary' then 0
                    else coalesce(d.delivered, 0) * r.commission_price end::numeric as commission_earned
        from roster r
        left join del d on d.mb_id = r.id
    ),
    priors as (
        -- ⚠ D5-BUG-1 + D5-BUG-2, REPLICATED BUG-FOR-BUG (contract's locked
        -- decision). `p_month` is used RAW ('YYYY-MM'); stored payout_month is
        -- 'YYYY-MM-01' ⇒ 0 rows, ALWAYS ⇒ prior_paid_amount ≡ 0. And it sums
        -- total_amount (invoiced), not paid_amount (disbursed). Header has the
        -- correct semantics + the double-pay blast radius. DO NOT "fix" here.
        select mp.mediabuyer_id as mb_id,
               coalesce(sum(coalesce(mp.total_amount, 0)), 0)::numeric as prior_paid_amount
        from public.mediabuyer_payments mp
        join roster r on r.id = mp.mediabuyer_id
        where mp."DigiCom Business" = p_business
          and mp.payout_month = p_month
        group by 1
    ),
    existing as (
        -- ⚠ Same dead predicate ⇒ ≡ null. D5-BUG-8: the client's mbPayments[0]
        -- is arbitrary; made deterministic here.
        select distinct on (mp.mediabuyer_id)
               mp.mediabuyer_id as mb_id,
               jsonb_build_object(
                   'id', mp.id,
                   'status', mp.status,
                   'total_amount', coalesce(mp.total_amount, 0),
                   'paid_amount', coalesce(mp.paid_amount, 0),
                   'paid_at', mp.paid_at
               ) as payout
        from public.mediabuyer_payments mp
        join roster r on r.id = mp.mediabuyer_id
        where mp."DigiCom Business" = p_business
          and mp.payout_month = p_month
        order by mp.mediabuyer_id, mp.created_at, mp.id
    ),
    owned as (
        -- ownedCampaignCount (MediaBuyers.tsx L226-236): LIFETIME campaigns the
        -- buyer OWNS (created_by) — deliberately NOT the month-scoped
        -- campaigns_count, which is 0 in a month with no spend rows and
        -- contradicts the campaigns actually listed under the buyer.
        select c.created_by as mb_id,
               count(*)::int as owned_campaign_count
        from public.campaigns c
        join roster r on r.id = c.created_by
        where c."DigiCom Business" = p_business
        group by 1
    )
    select jsonb_build_object(
        'mediabuyers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'mediabuyer_id', r.id,
                -- D5-DEV-M1: RAW count (client parity — drives podium/rank/sort).
                'delivered_orders', e.delivered_orders,
                'total_spend', coalesce(s.total_spend, 0),
                'campaigns_count', coalesce(s.campaigns_count, 0),
                'salary_earned', e.salary_earned,
                'commission_earned', e.commission_earned,
                'total_amount', e.salary_earned + e.commission_earned,
                'prior_paid_amount', coalesce(pp.prior_paid_amount, 0),
                'remaining_amount', greatest(0, (e.salary_earned + e.commission_earned)
                                                - coalesce(pp.prior_paid_amount, 0)),
                'owned_campaign_count', coalesce(oc.owned_campaign_count, 0),
                'existing_payout', ex.payout
            ) order by r.created_at, r.id)
            from roster r
            join earn e          on e.mb_id = r.id
            left join spend_agg s on s.mb_id = r.id
            left join priors pp   on pp.mb_id = r.id
            left join existing ex on ex.mb_id = r.id
            left join owned oc    on oc.mb_id = r.id
        ), '[]'::jsonb),
        -- LIFETIME payouts, biz-wide (folds MediaBuyers.tsx query #1). The page
        -- filters per MB client-side. Narrowed to p_mb on the self path.
        'payouts', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', mp.id,
                'mediabuyer_id', mp.mediabuyer_id,
                'payout_month', mp.payout_month,
                'total_amount', coalesce(mp.total_amount, 0),
                'paid_amount', coalesce(mp.paid_amount, 0),
                'delivered_orders', coalesce(mp.delivered_orders, 0),
                'status', mp.status,
                'paid_at', mp.paid_at,
                'created_at', mp.created_at
            ) order by mp.payout_month desc, mp.id)
            from public.mediabuyer_payments mp
            where mp."DigiCom Business" = p_business
              and (p_mb is null or mp.mediabuyer_id = p_mb)
        ), '[]'::jsonb)
    )
    into v_out;

    return v_out;
end
$function$;

revoke all on function public.mb_roster_earnings(uuid, text, uuid) from public, anon;
grant execute on function public.mb_roster_earnings(uuid, text, uuid) to authenticated;
alter function public.mb_roster_earnings(uuid, text, uuid) owner to postgres;

commit;
