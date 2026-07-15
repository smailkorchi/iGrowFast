# D3 RECON — admin Analytics page: OrdersSection, BusinessHealthSection, ShippingSection, CustomersSection, SalesChannelsSection

Files (absolute):
- Shell: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Analytics.tsx`
- Sections: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/{OrdersSection,BusinessHealthSection,ShippingSection,CustomersSection,SalesChannelsSection}.tsx`
- Shared defs: `src/lib/analyticsDefinitions.ts` (semantics already documented in `docs/d2-recon/01-admin-dashboard.md` §0.2 — referenced below, not re-derived; only DEVIATIONS are noted)
- Infra: `src/lib/supabase.ts` (fetchAllRows), `src/hooks/useStatusCategories.ts`, `src/hooks/useTrackedOrders.ts`, `src/components/analytics/{AnalyticsDateFilter,SectionWrapper,SectionStory}.tsx`

## 0. PAGE SHELL — `src/pages/admin/Analytics.tsx` (212 lines)

- Route: `/analytics`, inside `ProtectedRoute allowedRoles={['super admin','admin']}` + `BusinessGuard` + `AppLayout` (`src/App.tsx:283/308`). **Role visibility for ALL five sections = admin + super admin only.** Owner confined to /owner/*, sellers/MB/couriers cannot reach it.
- `businessId = localStorage.getItem('activeBusinessId') || ''` — passed as prop to every section. D3 RPCs must take explicit `p_business` (D2 convention).
- One page-level state: `dateFilter: DateFilter = {from?: Date, to?: Date, label}`, default `{undefined, undefined, 'All Time'}`. NO page-level data queries — every section owns its own queries.
- Mounts ALL 12 sections unconditionally (Profitability, BusinessHealth, Orders, Ads, Shipping, Inventory, Channels, Customers, Sellers, Couriers, MediaBuyers, Users) → on page load every section's full-table download fires simultaneously. SectionWrapper collapse is render-only; queries run regardless.
- Scroll-spy IntersectionObserver + sticky nav; no data implications.

### 0.1 Window semantics (all five sections identical)
- `AnalyticsDateFilter` presets (identical to Orders page): All Time (`from/to = undefined`), Today, Yesterday, 7/30/90 Days (`subDays(now, N-1)` inclusive-of-today), This Month, Last Month, YTD, custom range picker (disabled after today). `from`/`to` are **browser-local `Date` objects**.
- Every section normalizes: `windowStart = dateFilter.from ? startOfDay(from) : new Date(0)`; `windowEnd = dateFilter.to ? endOfDay(to) : new Date()`. Membership = `inWindow(placementTimestamp(o), start, end)` (inclusive interval; null/invalid date → excluded, **even on All Time**).
- D3 mapping per D2 contract (`docs/d2-recon/05-design.md`, mig `20260714230000_d2_dashboard_stats.sql`): client sends `format(from,'yyyy-MM-dd')` / `format(to,'yyyy-MM-dd')` (null = all-time); server computes `p_from::timestamp AT TIME ZONE 'Africa/Casablanca'` .. `(p_to+1)::timestamp AT TIME ZONE 'Africa/Casablanca'` (half-open). Browser-local→Casablanca is the accepted documented delta (D4 convention).

### 0.2 Refetch config (all five sections identical unless noted)
- `queryClient = new QueryClient()` with NO defaultOptions (`src/App.tsx:180`) → react-query defaults: `staleTime: 0`, `refetchOnMount: true`, `refetchOnWindowFocus: true`, retry 3.
- **Orders queries are keyed by businessId ONLY — the date window is NOT in any queryKey.** All windowing happens client-side in `useMemo`. Changing the date filter never refetches; every mount/focus re-downloads the full table.
- `useTrackedOrders`: `staleTime: 0, refetchOnMount: 'always'` on both parcels queries. `useStatusCategories`: `staleTime: 5min`.

### 0.3 Shared queries consumed by sections (per D2 recon §0.1, unchanged)
- `useStatusCategories()` → flag-driven id-sets from `order_statuses`/`package_statuses` (full-table selects, ordered by ranking, NOT business-filtered — global tables; queryKey carries businessId anyway). Sets used here: `deliveredPkgIds (is_delivered)`, `returnedPkgIds (is_returned)`, `paidOrderIds (is_paid)`, `cancelledIds (is_cancelled)`, `pendingIds (pending_confirmation)`, `adminPullbackOrderIds/adminPullbackPackageIds (excluded_from_delivery_rate)`, `confirmedIds (is_confirmed — fetched in Health but UNUSED)`.
- `useTrackedOrders(businessId)` → `fetchAllRows('company_parcels','order_id, tracking_code', biz eq)` + same for `courier_parcels`; `trackedOrderIds` = Set of order_id with non-empty trimmed tracking_code in either. Delivery-rate denominator base.
- `fetchAllRows` (`src/lib/supabase.ts:30`): `.range()` pagination, PAGE_SIZE 1000, mandatory order (default `id` asc), loops until short page. **Not 1000-capped — but a full-table private download.**
- Common orders filters (every section): `"DigiCom Business" eq businessId` AND `date_deleted is null` AND `source_review_status neq 'pending'` (NULL-semantics caveat in D2 recon §0.3 — RPC must replicate the exact PostgREST `neq` NULL behavior; verify on box before choosing `IS DISTINCT FROM`).

### 0.4 Shared helper semantics — reference D2 recon §0.2
`placementTimestamp`, `deliveryTimestamp (date_livraison ?? updated_at)`, `isDelivered`, `isPaid`, `isRevenueOrder (delivered AND paid)`, `isRateConfirmed` (tracked OR status ∉ pendingIds, with empty-set loading guard), `isAdminPullback`, Coliaty delivery rate `delivered ÷ (tracked − pullback)`, `isFailed (∈ cancelledIds)`, `isReturned (∈ returnedPkgIds)`, `pureRevenueForOrder` (product lines → raw_price → price−shipping fallback; + shipping_cost when include_delivery_in_total===true) — all exactly as documented. **Server note:** the `isRateConfirmed` empty-set guard is a client loading artifact; an RPC computing in one statement doesn't need it.
**Global deviation vs D2 dashboard:** none of these five sections clamp delivery rate to ≤100 (D2 KPI cards use `min(100, …)`). Numerator = ALL delivered in window; denominator = tracked−pullback → can exceed 100%. Replicate unclamped or flag.

### 0.5 D4 leftovers check (CURRENT code)
`grep -rn "\.rpc(" src/components/analytics/` → **zero hits.** None of the five sections was D4-RPC-ified. All money sums are still client-side over `fetchAllRows` full-table copies (fetchAllRows already avoids the 1000-cap wrong-money class, so no cap bug here — the problem is purely the private full-table download + client math). Each of the 5 sections downloads its OWN full copy of `orders` with a different select string (5 distinct copies of the same table on page load, plus the other 7 sections' copies).

---

## 1. OrdersSection (`src/components/analytics/OrdersSection.tsx`, 328 lines)

**(a) Queries**
- `['analytics-orders-full-v2', biz]` (enabled `!!businessId`): `fetchAllRows('orders', 'id, price, date, order_status_id, package_status_id, master_city_id, source_name, shipping_cost, replace, master_cities(name), package_statuses(label), order_items(quantity, unit_price)', common filters)` — full all-time copy; then client-side `.filter(o => o.replace !== true)` (exchange legs excluded from EVERYTHING in this section).
- Fetched-but-UNUSED columns: `source_name`, `shipping_cost`, `package_statuses(label)`, entire `order_items` embed (dead weight in the select).
- Shared: `useStatusCategories` (cancelledIds, pendingIds, adminPullback×2, deliveredPkgIds), `useTrackedOrders`.

**(b) Client math** (all over `filtered` = window by placement, replace-legs pre-excluded)
- `total = filtered.length`.
- `avgOrderValue = Σ Number(o.price||0) / total` — **raw order total `price` (customer-paid incl. folded delivery), NOT pureRevenue** (comment: "volume metric"). MONEY FORMULA: plain mean of `orders.price`.
- `deliveredCount` = isDelivered; `failedCount` = isFailed(cancelledIds); `rateConfirmedCount` = isRateConfirmed.
- `confirmRate = rateConfirmed/total×100`; `deliveryRate = deliveredCount/(tracked−pullback)×100` (tracked = filtered ∩ trackedOrderIds; pullback via isAdminPullback; unclamped); `failedRate = failed/total×100`.
- **`todayOrders` / `weekOrders`: window-INDEPENDENT** — computed against ALL (replace-excluded) orders: placement local-date == today; placement within `[subDays(today,7), today]` (7-day lookback, note: 8 calendar days inclusive via isWithinInterval). RPC must return these regardless of p_from/p_to.
- Trend: rangeStart = `dateFilter.from` || (filtered.length ? min placement of filtered : subMonths(today,6)); rangeEnd = `dateFilter.to` || today. **DEVIATES from the other four sections' granularity ladder: only 2 tiers — `diffDays ≤ 31` → daily buckets (per local calendar day, label 'MMM d') else MONTHLY (`eachMonthOfInterval`, full calendar-month bounds, NOT clamped to range, label 'MMM yy'). No weekly tier, no bucket clamping.** Value per bucket = order count only.
- Geography: group `filtered` by `master_cities.name` (canonical master city); **orders with no city are SKIPPED (no 'Unknown' bucket — deviates from CustomersSection)**; top 10 by count desc.
- Funnel: `[Total=total, Confirmed=rateConfirmedCount, Delivered=deliveredCount]`.

**(c) Rendered output** (SectionWrapper id='orders' collapsible + SectionStory)
- Hero: `total` (fr-MA). Narrative sentence with total/confirmed/confirmRate/delivered/deliveryRate + conditional failed>20% or delivery≥60% comment.
- Supporting strip (6 tiles): Today, This week, Confirmed (sub confirmRate 1dp %), Delivered (sub deliveryRate 1dp %, tone ≥50 positive /≥25 warning /else negative), Failed (sub failedRate 1dp %, negative tone >15%), Avg order value (`Math.round`, fr-MA, MAD).
- Charts: AreaChart `{label, orders}[]` (orders over time); funnel bars scaled to max stage with step-conversion % of previous stage; Top Cities ranked bars scaled to city #1.

**(d) Window/refetch**: §0.1/§0.2 — key `['analytics-orders-full-v2', biz]`, staleTime 0, window client-side only.
**(e) Roles**: admin/super admin only (page-level).

**RPC return needed** (jsonb): `{ total, confirmed_count, delivered_count, failed_count, confirm_rate, delivery_rate, failed_rate, avg_order_value, today_orders, week_orders, trend: [{d, orders}] (day-bucketed Casablanca; client re-buckets to its grain — D2 precedent), top_cities: [{city, count}] top-10, funnel derivable client-side }`. Replace-leg exclusion (`replace IS NOT TRUE`) applies to the whole pool.

---

## 2. BusinessHealthSection (`BusinessHealthSection.tsx`, 314 lines)

**(a) Queries**
- `['analytics-orders-health-v2', biz]`: `fetchAllRows('orders', 'id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, replace, package_statuses(label), confirmation_date, order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)', common filters)` — full copy, **replace legs KEPT in the pool** (unlike §1).
- Fetched-but-unused: `package_statuses(label)`, accessory fields + `product_unit_cost_snapshot` (pureRevenue only reads product_id/quantity/unit_price/total_price), `confirmedIds` from the hook.
- Shared: useStatusCategories (confirmedIds unused, cancelledIds, deliveredPkgIds, paidOrderIds, pendingIds, adminPullback×2), useTrackedOrders.

**(b) Client math** (`filtered` = window by placement, replace legs INCLUDED in counts/rates)
- `orderVelocity = filtered.length / daySpan`; daySpan: explicit window → `differenceInDays(windowEnd,windowStart)+1` (min 1); All-Time → span from min→max placement of `filtered` (+1, min 1); no data → 1.
- `confirmRate = rateConfirmed/filtered.length×100`; `deliveryRate` Coliaty over filtered (unclamped).
- **Revenue (MONEY): `revenueOrders = filtered where replace !== true AND isRevenueOrder(delivered AND paid)`; `totalRevenue = Σ pureRevenueForOrder`** — replace-exclusion applied only to revenue, matching P&L. NOTE deviation vs D2 SalesComparatif: here revenue is **placement-bucketed** (filtered/buckets are by placementTimestamp), not delivery-bucketed.
- `avgConfirmTime` (hours) = mean of `max(0, (confirmation_date − date)/3600000)` over filtered orders having both `date` AND `confirmation_date`; `hasConfirmTimeData` = any such order.
- `failedCount` = `order_status_id ∈ cancelledIds` (inline; == isFailed).
- Trend: 3-tier granularity — `rangeDays ≤31` daily / `≤120` weekly (weeks start Monday) / else monthly; labels 'EEE d' (≤14d) / 'MMM d' / 'MMM yy'; **bucket bounds CLAMPED to [rangeStart, rangeEnd]**; All-Time rangeStart = earliest placement of the whole pool (fallback now−6mo). Per bucket: `{month: label, revenue (Σ pureRevenue over replace≠true ∧ isRevenueOrder, placement-bucketed), confirmRate, deliveryRate (Coliaty per bucket)}`.
- `revenueGrowth` = (last bucket revenue − previous bucket revenue)/previous ×100 (0 when <2 buckets or prev ≤0); `growthBucketLabel` = day|week|month by granularity.

**(c) Rendered output** (id='business-health')
- Hero: deliveryRate 1dp % (tone ≥70 positive / ≥40 warning / else negative — **different thresholds than OrdersSection's 50/25**). Narrative: delivered of confirmed + confirmRate + avgConfirmTime (or "no timestamps") + revenue up/down vs prior period.
- Supporting (8 tiles): Confirm rate %, Avg confirm speed (`Xh` or '—'), Orders, Delivered (positive), Failed (negative when >0), Velocity (`X.X/day`), Revenue (round fr-MA MAD), Growth (±X.X% sub "vs prior day|week|month", tone by sign).
- Chart: dual-axis AreaChart rows `{month, revenue, confirmRate, deliveryRate}` (revenue left axis with k-formatter, rates right axis domain [0,100]).

**(d)**: key `['analytics-orders-health-v2', biz]`, defaults, window client-side. **(e)**: admin/super admin.

**RPC return needed**: `{ total_orders, confirmed_count, delivered_count, failed_count, confirm_rate, delivery_rate, avg_confirm_hours (null when no data), velocity_day_span OR velocity, total_revenue, trend: [{d, revenue, confirmed, total, delivered, delivery_denom}] day-bucketed (client derives rates + regroups + computes growth), earliest_order_date (for All-Time client re-bucketing) }`.

---

## 3. ShippingSection (`ShippingSection.tsx`, 393 lines)

**(a) Queries**
- `['analytics-orders-shipping-v2', biz]`: `fetchAllRows('orders', 'id, date, updated_at, shipping_cost, company_id, courier_id, order_status_id, package_status_id, date_livraison, master_city_id, master_cities(name), package_statuses(label)', common filters)` — full copy; **NO replace-leg exclusion at all (deviates from §1/§4/§5 — real parcels, intentional per Health comment).**
- `['analytics-providers', biz]`: BARE `supabase.from('providers').select('id, name, provider_type, logo_url').eq('DigiCom Business', biz)` — unpaginated (fine, small); `provider_type` unused.
- `['analytics-shipping-couriers', biz]`: BARE `supabase.from('users').select('id, name, avatar_url, avatar_config').eq('role','courier').eq('DigiCom Business', biz)` — unpaginated; `avatar_config` unused.
- Fetched-but-unused on orders: `master_city_id`, `master_cities(name)`, `package_statuses(label)`, `order_status_id` (only used inside isAdminPullback).
- Shared: useStatusCategories (deliveredPkgIds, returnedPkgIds, adminPullback×2), useTrackedOrders.

**(b) Client math** (`filtered` = window by placement)
- `shippedOrders = filtered ∩ trackedOrderIds` (tracked-set is the shipped definition; `orders.tracking_number` dead — per comment); `totalShipments = shippedOrders.length`.
- `deliveredCount` / `returnedCount` = isDelivered / isReturned over **filtered (not just shipped)**.
- `deliveryRate = deliveredCount / (shipped − pullback) ×100` (pullback = isAdminPullback over shippedOrders; unclamped). `returnRate = returned/totalShipments×100`.
- **MONEY: `totalShippingCost = Σ Number(shipping_cost||0)` over `filtered where isDelivered`** (delivered orders only).
- `avgDeliveryDays` = mean `differenceInDays(deliveryTimestamp(o), placementTimestamp(o))` over delivered orders having `date` AND deliveryTimestamp (`date_livraison ?? updated_at`).
- `stuckCount` = shippedOrders where NOT delivered AND NOT returned AND `differenceInDays(NOW, placement) > SHIPPING_STUCK_DAYS(=5)` — **measured against NOW, not window end** (matches D2 aging convention).
- Fulfiller grouping: `assignedOrders = filtered where company_id || courier_id`; key `pid = company_id || courier_id` (company wins when both); per pid: `{total, delivered, tracked (∩trackedOrderIds), pullback (tracked ∧ isAdminPullback), name/logo/kind}` from merged providers+couriers map (courier logo = avatar_url; provider logo via `resolveProviderLogo`); `rate = delivered/(tracked−pullback)×100` else 0; sorted total desc, ALL shown (no top-N).
- Trend: same 3-tier clamped granularity machinery as §2, over **shippedOrders only**, per bucket `{month, shipped, delivered (isDelivered within shipped), cost = Σ shipping_cost of those delivered}` (cost computed but not charted).

**(c) Rendered output** (id='shipping', description states the Coliaty formula + 5-day stuck rule)
- Hero: deliveryRate 1dp % (tone ≥60/≥30 — third distinct threshold set). Narrative: delivered of confirmedCount(=deliveryDenom, labeled "shipped parcels") + avg days + returnRate>10% audit warning + stuck count + top fulfiller name/rate.
- Supporting (6): Delivered (positive), Returns (sub returnRate%, negative >10), `Stuck > 5d` (warning >0), Avg days (1dp), Shipping cost (round fr-MA MAD, tone negative), Fulfillers (count).
- Charts: AreaChart `{month, shipped, delivered}`; "By fulfiller" rows (logo, name, kind badge, `X assigned · Y delivered`, rate bar width=rate% (>100 overflows), rate 1dp).

**(d)**: keys above, defaults, window client-side. **(e)**: admin/super admin.

**RPC return needed**: `{ total_shipments, delivered_count, returned_count, delivery_denom, delivery_rate, return_rate, total_shipping_cost, avg_delivery_days, stuck_count, fulfillers: [{id, kind, total, delivered, tracked, pullback}] (names/logos joinable client-side from existing providers/couriers queries or returned), trend: [{d, shipped, delivered, cost}] day-bucketed, earliest_order_date }`. Pool = NO replace exclusion.

---

## 4. CustomersSection (`CustomersSection.tsx`, 338 lines)

**(a) Queries**
- `['analytics-orders-customers', biz]` (**no `-v2` suffix — only section without it**): `fetchAllRows('orders', 'id, phone, name, price, date, order_status_id, package_status_id, master_city_id, replace, master_cities(name)', common filters)` then client `.filter(replace !== true)`.
- **PRIVACY: downloads every customer phone + name to the browser — the worst offender of the five; `name` is fetched and entirely unused.**
- NOTE: select has NO raw_price/shipping_cost/include_delivery_in_total/order_items → `pureRevenueForOrder` falls through to the LAST fallback: `include_delivery_in_total === false ? price : max(0, price − shipping_cost)` where **`shipping_cost` is undefined → num()=0 → revenue = `price` effectively** (include_delivery_in_total also undefined → not `=== false` → branch `price − 0`). Revenue here ≈ raw `price` of paid+delivered orders — a real DEVIATION from the §0.2 pure-revenue chain caused by the thin select. D3 server-side should compute TRUE pureRevenue and document the value drift.
- Shared: useStatusCategories (deliveredPkgIds, paidOrderIds only) — no tracked-set (no delivery rate here).

**(b) Client math**
- Customer key = `normalizePhone(phone)` (digits only; 0XXXXXXXXX→212XXXXXXXXX); empty → order SKIPPED from all customer metrics.
- `customersSeenBefore` = keys of ALL orders (whole pool) with placement `< windowStart` — **requires all-time history; the new/returning split cannot be computed from a windowed slice. Key D3 design constraint.**
- `filtered` = window by placement. `customerMap[key] = {orders++, revenue += pureRevenueForOrder(o) only when isRevenueOrder}` (revenue caveat above).
- `totalCustomers` = distinct keys in window; `repeatCustomers` = keys with orders>1 **within the window**; `repeatRate = repeat/total×100`; `avgOrdersPerCustomer` = Σorders/total; `avgCustomerValue` (LTV tile) = Σrevenue/total; `totalCustomerRevenue` = Σrevenue.
- `newCustomersInWindow` = window keys ∉ customersSeenBefore; `returning = total − new`.
- Geography: group filtered (all orders, incl. phone-less) by trimmed `master_cities.name`, empty → **'Unknown city' bucket (deviates from §1 which skips)**; top 8.
- Trend: same 3-tier clamped machinery (§2); per bucket walk FORWARD carrying `seenInPriorBuckets` (seeded from customersSeenBefore): dedupe customers within bucket; first-seen → `new++` + add to seen; else `returning++`. Rows `{month, new, returning}`.

**(c) Rendered output** (id='customers', description "keyed by phone; New = first-ever order in this window")
- Hero: repeatRate 1dp % (tone ≥30/≥15). Narrative: repeat of total + avg spend (`avgCustomerValue.toFixed(0)` MAD) × avgOrders + retention comment.
- Supporting (6): Customers, New (positive), Returning, Orders/cust (1dp), Avg LTV (round fr-MA MAD), Revenue (round fr-MA MAD).
- Charts: stacked AreaChart `{month, new, returning}`; Top cities ranked bars vs max.

**(d)**: key `['analytics-orders-customers', biz]`, defaults, window client-side. **(e)**: admin/super admin.

**RPC return needed**: `{ total_customers, repeat_customers, repeat_rate, new_customers, returning_customers, avg_orders_per_customer, avg_customer_value, total_customer_revenue, top_cities: [{city, count}] top-8 incl Unknown, trend: [{d, new, returning}] day-bucketed with server-side prior-history seeding }`. Server must replicate `normalizePhone` (regexp_replace non-digits; `^0\d{9}$` → '212'+substr) and decide/flag the revenue formula (true pureRevenue vs current effective-`price`). Day-bucketed new/returning is safely re-groupable client-side because coarser buckets only merge consecutive days (first-seen day assignment is stable).

---

## 5. SalesChannelsSection (`SalesChannelsSection.tsx`, 339 lines)

**(a) Queries**
- `['analytics-orders-channels-v2', biz]`: `fetchAllRows('orders', 'id, source_name, source_id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, replace, package_statuses(label), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price)', common filters)` then `.filter(replace !== true)`. Full pureRevenue chain available (unlike §4). `package_statuses(label)` + accessory fields unused.
- `['analytics-sales-channels', biz]`: BARE `supabase.from('sales_channels').select('id, name, type').eq('DigiCom Business', biz)` — unpaginated; `type` unused. Used only as `source_id → name` lookup.
- Shared: useStatusCategories (deliveredPkgIds, paidOrderIds).

**(b) Client math** (`filtered` = window by placement, replace-excluded)
- Channel key: `raw = source_name || channelMap.get(source_id) || ''`; `normalizeSource(raw)` (PLATFORM_SOURCE_MAP in `src/lib/campaignConstants.tsx:38` — 12 entries: 'whatsapp ads'→'whatsapp', 'messenger ads'→'messenger', 'instagram ads'→'instagram', 'facebook ads'→'facebook', 'google ads'→'google', 'tiktok ads'→'tiktok', 'native ads'→'native', 'snapchat ads'→'snapchat', 'twitter ads'→'twitter', 'bing ads'→'bing', 'pinterest ads'→'pinterest', 'reddit ads'→'reddit'; unmapped → trimmed lowercase passthrough); empty raw → `'direct'`. **D3: either mirror this map in SQL or key by lower(trim(source_name/channel name)) server-side and normalize client-side; the map must not drift in two places.**
- Per key: `orders++`; when `isRevenueOrder`: `converted++`, `revenue += pureRevenueForOrder` (full chain — MONEY formula per §0.2 exactly).
- `channelData` = entries + `conversionRate = converted/orders×100`, sorted orders desc (ALL channels rendered). `topChannel` = first.
- Derived at render: `totalOrdersViaChannels = Σ orders` (== filtered.length since every order gets a key); `topShare = topChannel.orders/totalViaChannels×100`; `bestConv` = max conversionRate among channels with `orders ≥ 5` (BEST_CONV_MIN_ORDERS), fallback raw max + "low sample" flag when none qualify.
- Trend: same 3-tier clamped machinery (§2); top-5 channels by orders; per bucket `{month, [channelName]: count}` — order counts only, no money.

**(c) Rendered output** (id='channels', description "Sources normalized via the platform map. Revenue counts only paid+delivered orders.")
- Hero: top channel NAME (or 'N/A'). Narrative: top channel + orders + share% + active channel count + best conversion.
- Supporting (4): Active channels, Top channel orders (sub share%), Best conversion % (positive tone; sub low-sample flag), Total via channels.
- Charts: multi-series AreaChart of top-5 channel counts (brand colors via `getChannelColor`, legend top-4); Channel Breakdown rows (brand icon, name, `X orders`, revenue round fr-MA MAD, conversionRate 1dp) for ALL channels.

**(d)**: keys above, defaults, window client-side. **(e)**: admin/super admin.

**RPC return needed**: `{ channels: [{key, orders, converted, revenue}] all channels sorted, trend: [{d, key, orders}] or [{d, per-channel-counts}] day-bucketed for top-5 (or return per-channel-per-day and let client pick top-5 — top-5 is window-dependent so server should rank), total_orders }`. Best-conversion gating + share math stay client-side.

---

## 6. Cross-section deviation matrix (from §0.2 baseline — the D3 RPC per-section pool/window contract)

| Section | replace-leg exclusion | bucket anchor | granularity ladder | delivery-rate clamp | extra full-table queries |
|---|---|---|---|---|---|
| Orders | whole pool | placement | **2-tier (≤31 daily else monthly, UNclamped month bounds)** | none | — |
| Health | **revenue only** (rates/counts keep legs) | placement (revenue too — NOT delivery-date) | 3-tier clamped (31/120) | none | — |
| Shipping | **none** | placement | 3-tier clamped | none | providers, couriers(users) |
| Customers | whole pool | placement | 3-tier clamped | n/a | — (but needs ALL-TIME history for new/returning) |
| Channels | whole pool | placement | 3-tier clamped | n/a | sales_channels |

Other load-bearing quirks for the D3 design: Orders' Today/This-week chips are window-independent; Customers' effective revenue ≈ `price` due to thin select (decide: preserve bug or fix to pureRevenue — flag either way); Shipping stuck measured vs NOW; per-fulfiller key prefers company_id over courier_id; all five sections' orders queryKeys lack the window → after D3, put `p_from/p_to` in the queryKey (D2 precedent). D2 pattern anchors to copy: SECURITY INVOKER + explicit `p_business` + 42501 validation vs auth.uid(), jsonb return, Casablanca half-open windows from yyyy-MM-dd params, day-bucketed trend arrays that the client re-buckets to its grain (all present in `supabase/migrations/20260714230000_d2_dashboard_stats.sql`).