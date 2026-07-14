# D2 RECON — ADMIN DASHBOARD WIDGET INVENTORY (exhaustive)

Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast`
Page: `src/pages/admin/Dashboard.tsx` (route `/` under admin catch-all, `src/App.tsx:282-287`)

## 0. Page-level facts

- **Role visibility**: `ProtectedRoute allowedRoles={['super admin','admin']}` + `BusinessGuard` (App.tsx:283). Owner confined to `/owner/*`; sellers/MB/couriers have separate dashboards. **No MB exposure on this page** — but see §9 (SellerSelfPerformanceSection, seller route) for a seller-facing leak that constrains RPC design.
- **businessId**: `localStorage.getItem('activeBusinessId')` (Dashboard.tsx:14). Every widget receives it as prop. All server queries filter `"DigiCom Business" = businessId` **client-supplied** — the D2 RPCs must take explicit `p_business` and re-validate (orders RLS SELECT is business-wide; seller scoping must be an RPC predicate vs `auth.uid()`).
- **Date-window selector**: ONE global `dateFilter` state (`{from?: Date, to?: Date, label}`), default `All Time` (`from/to = undefined`), rendered by `AnalyticsDateFilter` (variant `ant`) and passed identically to **all 8 widgets**. There are NO per-widget windows. Presets (`src/components/analytics/AnalyticsDateFilter.tsx:16-32`): All Time, Today, Yesterday, 7/30/90 Days (rolling, inclusive of today: `subDays(now, N-1)`), This Month (`startOfMonth..now`), Last Month, YTD, plus custom range picker (single-day on first click; second click commits; re-click same day clears to All Time; future dates disabled).
- **Window application**: purely CLIENT-side. Every widget downloads its orders copy **all-time** (no date predicate server-side) and filters in JS via `startOfDay(from)`/`endOfDay(to)` (`isWithinInterval`, inclusive). Sole exception: `useSellerCommissionTotals` pushes `date >= / <= format(d,'yyyy-MM-dd')` to `seller_daily_earnings`.
- **Timezone**: everything is **browser-local** date-fns math; DB timestamps parsed via `new Date(iso)`. No explicit Casablanca handling anywhere on this page. The D2 RPCs must implement the D4 Casablanca day-boundary convention; client will keep sending `from`/`to` — recommend sending plain `yyyy-MM-dd` and resolving boundaries server-side.
- **React Query defaults**: `new QueryClient()` with NO options (App.tsx:180) → `@tanstack/react-query ^5.83.0` defaults: `staleTime: 0`, `refetchOnMount: true`, `refetchOnWindowFocus: true`, `retry: 3`. So every dashboard visit AND every window focus re-downloads every full-orders copy unless overridden (overrides noted per widget).
- **fetchAllRows** (`src/lib/supabase.ts:30-86`): paginated `.range()` loop, page size 1000, ordered by `id` asc, loops until short page — bypasses the PostgREST 1000-row cap. Queries using bare `supabase.from(...).select(...)` are UNPAGINATED (silent 1000-row cap risk) — flagged per widget.

### 0.1 Shared hooks (mounted by multiple widgets)

**`useStatusCategories`** (`src/hooks/useStatusCategories.ts`) — 2 queries, `staleTime: 5min`:
- `['order_statuses_cat', biz]`: `order_statuses` select of id/code/label/color/ranking + ALL semantic flags, `.order('ranking')` (NOTE: **no business filter in the query itself** — statuses are global masters; businessId only keys the cache).
- `['package_statuses_cat', biz]`: same for `package_statuses`.
- Derived sets (flag-column semantics — these map 1:1 to the D4 convention):
  - `pendingIds` = `order_statuses.pending_confirmation = true` (NEW + RAPPELE 1–6 + REPORTER)
  - `confirmedIds` = `is_confirmed`; `cancelledIds` = `is_cancelled` (includes fake/double/blacklisted rows — "Failed" merged bucket); `paidOrderIds`=`is_paid`; `unpaidOrderIds`=`is_unpaid`
  - `adminPullbackOrderIds` = `order_statuses.excluded_from_delivery_rate`; `adminPullbackPackageIds` = `package_statuses.excluded_from_delivery_rate`
  - `deliveredPkgIds` = `ps.is_delivered`; `shippedPkgIds` = `ps.is_shipped`; `returnedPkgIds` = `ps.is_returned`; refused via `ps.is_refused`
  - `getPkgsByCategories(['in_transit','out_for_delivery','picked_up','pickup_pending'])` ≡ all `is_shipped` rows (all four map to `is_shipped`)
  - Colors: `status.color || '#6b7280'`.

**`useTrackedOrders(businessId)`** (`src/hooks/useTrackedOrders.ts`) — 2 FULL-TABLE copies, `staleTime: 0` + `refetchOnMount: 'always'`:
- `['tracked-orders-company-parcels', biz]`: `fetchAllRows('company_parcels','order_id, tracking_code', biz eq)`
- `['tracked-orders-courier-parcels', biz]`: same for `courier_parcels`
- `trackedOrderIds` = Set of `order_id` having non-empty trimmed `tracking_code` in either table. This is the "handed to courier" universe = delivery-rate denominator base. Shared queryKey → deduped across the 7 widgets that call it, but 'always' refetch triggers on each new mount.

**`useSellerCommissionTotals(biz, from, to)`** (`src/hooks/useSellerCommissionTotals.ts`) — `['seller-daily-earnings-totals', biz, fromKey, toKey]`, `staleTime: 60s`: `fetchAllRows('seller_daily_earnings','seller_id, date, commission_earned, delivered_count', biz eq [+ date gte/lte 'yyyy-MM-dd' local-formatted])` → Maps seller_id→Σcommission_earned, seller_id→Σdelivered_count. **Only server-side windowed query on the page.** View is the payout source of truth.

### 0.2 Shared definitions (`src/lib/analyticsDefinitions.ts`, `src/lib/commercialCommission.ts`)

- `placementTimestamp(o)` = `o.date` parsed; null/invalid → null.
- `deliveryTimestamp` / revenue anchor = `date_livraison ?? updated_at`.
- `assignmentTimestampForMetrics(o)` = `assignment_date || date` (cohort anchor).
- `isDelivered(o)` / `isDeliveredForCommission(o)` = `package_status_id ∈ deliveredPkgIds` (identical bodies; no label matching).
- `isRateConfirmed(o)` = tracked OR (`pendingIds.size>0` AND `order_status_id` non-null AND ∉ pendingIds). Empty-set guard: while statuses load, returns false (rate shows 0%, not 100%).
- `isAdminPullback(o, hasTracking, …)` = hasTracking AND (`order_status_id ∈ adminPullbackOrderIds` OR `package_status_id ∈ adminPullbackPackageIds`).
- Delivery rate (Coliaty formula), used everywhere: `delivered ÷ (tracked − adminPullback)`, clamped ≤100.
- `isFailed(o)` = `order_status_id ∈ cancelledIds`.
- `pureRevenueForOrder(o)`: Σ product lines (`total_price` if >0 else `unit_price×quantity`, only lines with `product_id` and qty>0; accessories NEVER revenue). Fallback when Σ=0: `raw_price` if >0, else (`include_delivery_in_total===false ? price : max(0, price − shipping_cost)`). Then **+ `shipping_cost` when `include_delivery_in_total === true`** (customer-collected delivery is revenue).
- `commissionAccruedForDeliveredOrder`: per_unit → `sumAssignedProductUnits × commission_price` where **empty `users.products` ⇒ 0** (matches DB `sum_order_units_for_seller_products`); per_order → flat `commission_price`.
- `normalizeCommissionBasis(v)` = `'per_unit'` iff exactly that string, else `'per_order'`.

### 0.3 Common server-side filters on every orders copy

`"DigiCom Business" eq businessId` AND `date_deleted is null` AND `source_review_status neq 'pending'`. (NOTE `neq` also excludes rows where `source_review_status IS NULL` in PostgREST? No — PostgREST `neq` on a NULL column yields NULL→row excluded. VERIFY on box: if `source_review_status` is nullable and null for normal orders, the widgets rely on it being non-null (e.g. 'approved'). The RPC must replicate the exact predicate: `source_review_status <> 'pending'` with identical NULL behavior — check live data before choosing `IS DISTINCT FROM`.)

---

## 1. DashboardKPICards (`src/components/dashboard/DashboardKPICards.tsx`)

**(a) Queries**
- `['kpi-cards-orders-v2', biz]`: `fetchAllRows('orders', 'id, date, order_status_id, package_status_id, package_statuses(label)', common filters)` — full all-time copy.
- `['dashboard-payment-notes', biz]`: `supabase.from('company_payment_notes').select('id, total_amount, net_amount, status, created_at').eq('DigiCom Business', biz)` — **UNPAGINATED** (1000 cap risk). No date_deleted/status filter.
- Shared: useStatusCategories, useTrackedOrders.

**(b) Math** — window `[startOfDay(from) | epoch, endOfDay(to) | now]`:
- `filtered` = orders with `inWindow(placementTimestamp)` — **null/invalid `date` ALWAYS excluded, even All Time** (differs from other widgets).
- `total` = filtered.length (replace legs INCLUDED).
- `rateConfirmed` = filtered where `isRateConfirmed` (tracked OR status ∉ pendingIds).
- `delivered` = filtered where pkg ∈ deliveredPkgIds.
- `tracked` = filtered ∩ trackedOrderIds; `adminPullback` = tracked where isAdminPullback; `deliveryDenom = tracked − pullback`.
- `confirmationRate = min(100, rateConfirmed/total×100)` (1dp); `deliveryRate = min(100, delivered/deliveryDenom×100)` (1dp).
- `pendingConfirmation` = filtered where NOT tracked AND status ∈ pendingIds.
- `enCoursLivraison` = filtered where pkg ∈ shippedPkgIds (the 4 shipped categories = `is_shipped`).
- `canceled` = filtered where status ∈ cancelledIds. `refused` = filtered where pkg is_refused.
- `pct(n) = (n/total×100)` 1dp, '0' when total=0.
- **Invoices tile**: `filteredNotes` = payment notes with `created_at` in window (**null created_at excluded; window applied even on All Time** with epoch..now). Value = `filteredNotes.length`; subtitle = `Σ Number(net_amount||0)` locale fr-MA + " MAD". **Money source = `company_payment_notes.net_amount`** (box columns: id, provider_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at, updated_at, "DigiCom Business"). `total_amount`/`status`/`paid_at` fetched but UNUSED in math.

**(c) Renders** — 10 cards in a 2/3/4/5-col grid: Total Orders (→`/orders`), Confirmed (count + %of total; click → Orders with `filterStatusIds = Array.from(confirmedIds)` — **count uses rate-confirmed definition, click filter uses is_confirmed set: intentional? count≠click-list drift exists here**), Confirmation Rate (%, progress bar), Delivered (count; subtitle `delivered/deliveryDenom %` "of shipped" if denom>0 else % of total; click filterPackageStatusIds=deliveredPkgIds), Delivery Rate (%, bar, subtitle `delivered/deliveryDenom shipped`), Pending Confirmation (count, %; click filterStatusIds=pendingIds), In Transit (count, %; click filterPackageStatusIds=shipped set), Canceled (count, %, rose when >0; click filterStatusIds=cancelledIds), Refused Packages (count, %; click filterPackageStatusIds=refused set), Invoices (count + Σnet_amount MAD; → `/payments`). Numbers `toLocaleString('fr-MA')`.

**(d) Refetch**: defaults (staleTime 0, refetch on mount/focus). No overrides.
**(e) Roles**: admin/super admin only.

**RPC return needed**: `{total, confirmed_count, confirmation_rate, delivered_count, delivery_denom, delivery_rate, pending_confirmation_count, in_transit_count, canceled_count, refused_count, invoices_count, invoices_net_total}` + the status-id arrays for click-through filters can stay client-side (from useStatusCategories).

---

## 2. SalesComparatifChart (`SalesComparatifChart.tsx`)

**(a) Query** — `['sales-comparatif-orders', biz]`: `fetchAllRows('orders','id, date, date_livraison, updated_at, price, shipping_cost, include_delivery_in_total, package_status_id, replace, package_statuses(label)', common filters)`.

**(b) Math**
- Range: explicit → `[startOfDay(from), endOfDay(to)]`; All Time → `from` = earliest of ALL orders' placement (`date`) AND delivery (`date_livraison ?? updated_at`) timestamps (fallback now−30d if none), `to` = endOfDay(now).
- Granularity: user choice or auto (`rangeDays ≤31 daily, ≤120 weekly (weeks start Monday), else monthly`); label formats `'EEE d'` (≤14d) / `'MMM d'` / `'MMM yy'`. Bucket bounds clamped to range (edge buckets don't leak).
- **Orders line**: placement-bucketed (`o.date`), ALL orders incl `replace=true` legs (operational volume, must equal KPI Total).
- **Revenue line**: delivery-bucketed (`date_livraison ?? updated_at`), only `replace !== true` AND `isDeliveredForCommission` orders; per-order value = `pureRevenueForOrder` (shared def §0.2). Delivery-date attribution ⇒ an order can be in the revenue window but not the placement window and vice-versa.
- Comparison ("vs Prev", default ON, only when explicit from+to and rangeDays≥1): previous window = current shifted back `rangeDays+1` days; per-bucket prev = same bucket bounds shifted by that offset; totals summed across buckets; growth% only when prev totals >0.

**(c) Renders**: headline Revenue (`Math.round`, fr-MA, MAD) + Orders with delta% and prev values; dual-axis Recharts AreaChart of rows `{label, orders, revenue, prevOrders, prevRevenue}` (prev dashed); tooltip with per-bucket values + deltas; granularity buttons (Auto/D/W/M) and vs-Prev toggle are pure client state (no refetch).

**(d) Refetch**: defaults. **(e)**: admin only.

**RPC shape**: series of `{bucket_label|bucket_start, orders, revenue}` for current (+prev when requested) at requested grain, plus totals — grain and comparison offset must be RPC params; All-Time earliest-date discovery must move server-side.

---

## 3. PendingOrdersBreakdown (`PendingOrdersBreakdown.tsx`)

**(a) Query** — `['pending-orders-breakdown-orders', biz]`: `fetchAllRows('orders','id, date, created_at, price, order_status_id', common filters)`.

**(b) Math**
- `pending` = NOT tracked AND `order_status_id ∈ pendingIds` AND date in window. **`isInRange(null) = true`** — null-date rows included in EVERY window (differs from KPI cards).
- Age buckets vs **NOW** (not window end): `age = differenceInDays(startOfDay(now), startOfDay(o.date || o.created_at))`; `≤0`→Today, `≤3`→1–3d, `≤7`→4–7d, else 7+d. Rows with neither date nor created_at count in `total` but appear in no bucket.
- `totalValue = Σ Number(price||0)` over pending; per bucket `count` and `value=Σprice`; `staleCount = count(4-7d)+count(7+d)`.

**(c) Renders**: header `total awaiting · round(totalValue) MAD`; stacked proportion bar of the 4 buckets; 4 cells (label, pct 0dp, count [rose when 7+d>0], value MAD); alert banner "`staleCount` orders pending 4+ days" when >0. Empty state when total=0.

**(d)** defaults. **(e)** admin only.

---

## 4. ConfirmationPipeline (`ConfirmationPipeline.tsx`)

**(a) Query** — `['confirmation-pipeline-orders', biz]`: `fetchAllRows('orders','id, date, order_status_id, order_statuses(code, label)', common filters)`.

**(b) Math**: `confirmationOrders` = NOT tracked AND status ∈ pendingIds AND date in window (**null date → included, all windows**). Group by `order_status_id` → `{label: order_statuses.label || code || 'Unknown', count}`, color `getOrderStatusColor(id)` (missing id key → '#9ca3af'), sorted count desc. `total` = group sums.

**(c) Renders**: header "`total` being confirmed"; StackedProportionBar over all status segments; top-3 legend (label + pct 0dp); scrollable full list rows: color chip, label, mini bar (pct of total), count, pct 1dp. No click-through.

**(d)** defaults. **(e)** admin only.

**RPC shape**: `total` + array `{order_status_id, label, color, count}`.

---

## 5. ShippingPipeline (`ShippingPipeline.tsx`)

**(a) Queries**
- `['shipping-pipeline-orders', biz]`: `fetchAllRows('orders','id, date, order_status_id, package_status_id, package_statuses(label), company_id, courier_id', common filters)`.
- `['dashboard-providers', biz]`: `providers.select('id, name, provider_type, logo_url').eq(biz)` — unpaginated.
- `['dashboard-couriers', biz]`: `users.select('id, name, avatar_url, avatar_config').eq('role','courier').eq(biz)` — unpaginated.

**(b) Math**
- Window: All Time → everything incl null dates; explicit → **null-date rows EXCLUDED**.
- `filtered` = in-window orders (full set — Coliaty denominator base); `shipped` = filtered where pkg ∈ (shippedPkgIds ∪ deliveredPkgIds ∪ returnedPkgIds).
- Header chips: `total = shipped.length`; `delivered` = shipped∩deliveredPkgIds; `returned` = shipped∩returnedPkgIds; `inTransit = total − delivered − returned`.
- Status distribution: shipped grouped by `package_status_id` (label from join, fallback id) with `getPkgStatusColor`; sorted count desc; pct of `shipped.length`.
- Fulfiller distribution over `shipped`: key `provider:<company_id>` if company_id else `courier:<courier_id>` (company precedence; neither → invisible in this section). Per fulfiller: `total`, `delivered`, `returned`, `inTransit = max(0, total−delivered−returned)`, `deliveryDenom` = tracked non-pullback rows of that fulfiller (within shipped subset), `deliveryRate = min(100, delivered/deliveryDenom×100)`. Names/logos from providers (via `resolveProviderLogo`) / users (avatar_url). Sorted total desc. `providerShipments`/`courierShipments` = Σ totals per kind.
- **Overall delivery rate**: denominator over the FULL `filtered` set (not lifecycle-only): `overallDeliveryDenom = |filtered ∩ tracked| − |pullbacks therein|`; rate = `min(100, delivered/overallDeliveryDenom×100)` — deliberately reconciles with KPI tile.

**(c) Renders**: 4 header chips; stacked bar in-transit/delivered/returned; overall rate (green ≥50, orange ≥25, else rose); "By status" scrollable list (color chip, label, bar, count, pct 1dp); "By fulfiller" cards (logo/avatar, name, PROVIDER/COURIER tag, rate% toned, 2px stacked bar, `N shipments`, `d del · r ret · i in transit`); header "X via providers · Y via couriers".

**(d)** defaults. **(e)** admin only.

---

## 6. DashboardSellersPerformance (`DashboardSellersPerformance.tsx`)

**(a) Queries**
- `['dashboard-sellers', biz]`: `users.select('id, name, avatar_url, avatar_config, active, commission_price, commission_basis, products').eq('role','commercial').eq(biz)` — unpaginated.
- `['dashboard-sellers-performance-orders', biz]`: `fetchAllRows('orders','id, date, assignment_date, confirmation_date, date_livraison, updated_at, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, seller_id, company_id, source_name, replace, order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot), order_statuses(code, label), package_statuses(label)', common filters)` then client-filter `replace !== true`. **Heaviest query on the page (orders × order_items join).** Explicit `staleTime: 0, refetchOnMount: 'always'`.
- `['dashboard-ads-history', biz]`: `ads_history.select('id, product_id, amount, start_date, end_date').eq(biz)` — unpaginated (shared key with §7).
- `['dashboard-products', biz]`: `products.select('id, name, image_url, stock, cost_price, selling_price, active').eq(biz)` — unpaginated (shared with §7).
- `['dashboard-accessories', biz]`: `accessories.select('id, cost_price').eq(biz)` — unpaginated (shared with §7).
- `useSellerCommissionTotals(biz, from, to)` (§0.1).

**(b) Math** (per seller; replace legs excluded everywhere here)
- `totalInWindow` = orders with `date` in window (placement; withinWindow(null)=false).
- **Cohort** = seller's orders (`seller_id = seller.id`) where `assignment_date || date` in window. `assignedCount`; `assignedPercent = assigned/totalInWindow×100`.
- **Confirmed** = cohort where tracked OR (`pendingIds.size>0` AND status non-null AND ∉ pendingIds). `confirmedPercent = confirmed/cohort×100` (full-cohort denominator).
- **Delivered** = cohort where pkg ∈ deliveredPkgIds. Delivery rate = Coliaty: `delivered ÷ (|cohort∩tracked| − pullbacks)`.
- **Sources**: per lowercased `source_name || 'other'` → counts of assigned/confirmed/delivered subsets.
- **Pre-conf pane**: cohort − confirmed, grouped by current `order_status_id` (null → 'Unset'), pill per status with color; Σ = assigned − confirmed. **Post-conf pane**: confirmed − delivered, grouped by `pkg:<package_status_id>` else `os:<order_status_id>` else 'unset'; Σ = confirmed − delivered.
- **Financials** (over delivered only): `revenue = Σ pureRevenueForOrder`; `shipping = Σ shipping_cost`; `cogs = Σ lines [(product_unit_cost_snapshot>0 ? snap : products.cost_price)×qty + (accessory_unit_price>0 ? snap : accessories.cost_price)×acc_qty]`.
- **adsShare**: ads with `start_date` **in window** (full amount, NO overlap pro-rating — differs from §7) summed per product; seller share = Σ over products `(sellerDeliveredQty[p]/globalDeliveredQty[p]) × ads[p]` where global qty = delivered units across ALL sellers' cohort-window orders.
- **Commission**: `commissionFromView` (seller_daily_earnings Σ in window per seller) ?? client calc `Σ commissionAccruedForDeliveredOrder(basis, commission_price, users.products)`; `commissionDrift` flag when both exist and differ >1.
- `netResult = revenue − cogs − shipping − adsShare − commission`. Sort sellers by deliveredCount desc.

**(c) Renders**: header "`N` sellers · `totalInWindow` orders"; per seller collapsed row: avatar, name, Inactive/Commercial tag, PerformanceFunnel (Assigned count + `%of all`, Confirmed count + rate%, Delivered count + rate%), Net (rounded MAD, green/rose) + `X comm`. Expanded: Funnel-dropoff header `(assigned−delivered)/assigned`, two StatusQueuePanes (entries above), FinancialsWaterfall(revenue, cogs, adsShare, commission, shipping, net), SourcePills (assigned/confirmed/delivered per source).

**(d)** orders query staleTime 0 + refetchOnMount 'always' (explicit); rest defaults; commission view 60s. **(e)** admin only. **MB rule: N/A here, but the per-seller `netResult/revenue/cogs/ads` are admin-only figures — the sibling seller-facing widget (§9) deliberately omits them; keep that split in the RPC design.**

---

## 7. DashboardProductsPerformance (`DashboardProductsPerformance.tsx`)

**(a) Queries**
- `['dashboard-products', biz]`, `['dashboard-accessories', biz]`, `['dashboard-ads-history', biz]` — shared keys with §6 (deduped).
- `['dashboard-order-items', biz]`: `fetchAllRows('order_items','id, order_id, product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot', [biz eq])` — **FULL all-time order_items copy, no date/deleted filter** (cohort gating done client-side via the orders set).
- `['dashboard-products-performance-orders', biz]`: `fetchAllRows('orders','id, date, shipping_cost, order_status_id, package_status_id, source_name, seller_id, replace, order_statuses(code,label), package_statuses(label)', common filters)`, client-filter `replace !== true`.
- `['dashboard-sellers-for-products', biz]`: `users.select('id, commission_price, commission_basis, products').eq(biz)` — **ALL roles**, unpaginated.

**(b) Math** (per product; replace legs excluded via order set)
- Cohort orders = in-window by `orders.date` (`inWindow(null)=false`); `cohortItems` = items whose `order_id` ∈ cohort.
- `orderProductQty[order]` = Σ product qty per order (for shipping/commission allocation).
- **Units funnel** over productLines (`product_id = p.id`, qty>0): `orderedUnits = Σq`; `rateConfirmedUnits` (+q when tracked OR status∉pending w/ ready-guard); denominator `rateTouchedUnits = orderedUnits`; `confirmedPercent = confirmed/touched×100`. `trackedUnits`/`pullbackUnits` → `deliveredPercent = deliveredUnits/(tracked−pullback)×100`. `deliveredUnits` where `isDeliveredForCommission`.
- **Revenue** (delivered lines only): `Σ productLineRevenue = total_price>0 ? total_price : unit_price×q` (accessories never revenue). `productCOGS = Σ (snapshot>0 ? product_unit_cost_snapshot : products.cost_price)×q`. `shippingAlloc = Σ order.shipping_cost × q / orderProductQty[order]`.
- **accessoryCOGS**: accessory lines (`product_id = p.id` AND accessory_id set AND acc qty>0) on delivered orders: `(accessory_unit_price snapshot > 0 ? snap : accessories.cost_price) × acc_qty`.
- **Ads**: pro-rated by inclusive-day window overlap — `adsOverlapFraction(start, end||start, wStart, wEnd)`, `amount × fraction` per product (**differs from §6's start_date-in-window rule — parity trap**).
- **Commission** per delivered order via `productCommissionOnOrder`: per_unit → `qty × commission_price` if product ∈ seller.products **OR seller.products is EMPTY (lenient fallback — CONTRADICTS §0.2/§6/§9 where empty ⇒ 0; existing inconsistency, replicate as-is or flag)**; per_order → `commission_price × qty/orderTotalQty`.
- `netProfit = revenue − productCOGS − accessoryCOGS − shippingAlloc − adsShare − commission`.
- **Orders-based dropoff panes** (same semantics as §6, over this product's distinct orders): totalOrders/confirmedOrdersCount/deliveredOrdersCount + pre/post pills. **Sources**: per distinct order — assigned always; confirmed when wide-confirmed; delivered ONLY counted within confirmed branch.
- **Per-unit economics** (÷ deliveredUnits): unitShipping, unitAdsShare, unitCommission, unitAccessoryCOGS, unitMargin = netProfit/deliveredUnits; plus `selling_price` and CURRENT `cost_price` shown raw.
- Filter `orderedUnits>0`; sort deliveredUnits desc, revenue desc, name asc; TOP_N=3 collapsed, expandable.

**(c) Renders**: header "Top 3 of N" / "N in period"; per product: image, name, stock (green>10/orange>0/rose), Inactive tag, units funnel (Ordered/Confirmed+rate/Delivered+rate), Net MAD, `X comm`. Expanded: orders dropoff panes, FinancialsWaterfall (with Product COGS + accessory COGS lines), Unit-economics 7 cells (2dp fr-MA), SourcePills.

**(d)** defaults. **(e)** admin only.

---

## 8. DashboardCityStats (`DashboardCityStats.tsx`)

**(a) Query** — `['dashboard-orders-cities', biz]`: `fetchAllRows('orders','id, date, price, shipping_cost, include_delivery_in_total, package_status_id, master_city_id, replace, master_cities(name), order_status_id, package_statuses(label)', common filters)`.

**(b) Math**
- Window: All Time → all rows incl null dates; explicit → null-date rows excluded (same as §5).
- Orders **without `master_cities.name` are skipped entirely** (excluded from all totals).
- Per city: `total` (all in-window orders, incl replace legs); `deliveryDenom` (tracked non-pullback); `delivered` (pkg ∈ deliveredPkgIds — replace legs COUNT as delivered); `revenue` = Σ `pureRevenueForOrder` over delivered AND `replace !== true`.
- Sort: delivered desc, then total desc. Concentration: separate volume sort, top-8 named segments (fixed palette) + "Others" rollup; `topVolumeShare` = top-8 volume / totalOrders.
- Problem cities: `deliveryDenom ≥ 3 AND delivered/deliveryDenom < 0.3`, top 3.
- Totals: totalOrders, totalDeliveryDenom, totalDelivered, totalRevenue; `overallRate = min(100, totalDelivered/totalDeliveryDenom×100)`.

**(c) Renders**: header "`N` cities · `M` orders"; 4 SummaryChips (Delivered, Delivery rate% toned 50/25, Revenue rounded MAD, Top-8 share%); concentration stacked bar + top-4 legend; problem-cities rose alert with per-city rate; city rows (rank, name, total, volume bar vs max city, rate pill 1dp toned, revenue rounded MAD) top-10 with "Show all" toggle.

**(d)** defaults. **(e)** admin only.

---

## 9. SellerSelfPerformanceSection (`SellerSelfPerformanceSection.tsx`) — NOT mounted on admin Dashboard

Mounted at `src/pages/seller/Dashboard.tsx` and `src/pages/seller/Statistics.tsx` (seller role route). Included per brief.

**(a) Queries**
- `['seller-self-performance-profile', sellerId]`: `users` single row select id, name, avatar_url, avatar_config, active, commission_price, commission_basis, products.
- `['seller-self-performance-orders', biz||'no-biz', sellerId]`: `fetchAllRows('orders','id, date, assignment_date, confirmation_date, date_livraison, updated_at, price, order_status_id, package_status_id, seller_id, source_name, replace, order_items(product_id, quantity), order_statuses(code,label), package_statuses(label)', filters)` where filter[0] = biz eq when businessId set, ELSE `seller_id eq sellerId`; + date_deleted null + source_review_status neq pending; client `replace !== true`. `staleTime: 0, refetchOnMount: 'always'`. **When businessId is set (the normal path) this downloads the ENTIRE business's orders — every seller's rows, with price — to a seller's browser.** The `seller_id` scoping happens only client-side (`sellerOrders = orders.filter(o.seller_id === sellerId)`); `totalInWindow` (whole-business placement count) IS rendered to the seller as "N commandes" and drives `assignedPercent`.
- `useSellerCommissionTotals(biz, from, to)` — fetches the WHOLE business's seller_daily_earnings rows (all sellers' commissions land in the seller's browser payload; only own seller_id displayed).
- Shared: useStatusCategories, useTrackedOrders(biz).

**(b) Math**: identical cohort/confirmed/delivered/Coliaty-rate/sources/pre-post-pane logic as §6 for ONE seller, minus all financials except **commission** (= view total ?? `commissionAccruedForDeliveredOrder` client sum; drift flag >1; empty `products` per_unit ⇒ 0 here — strict rule).

**(c) Renders** (French): avatar/name/Inactif-Commercial, funnel Attribuées(+% du total)/Confirmées(rate)/Livrées(rate), Commission MAD (green), dropoff panes, SourcePills, header `totalInWindow commandes · business`. **NO revenue/net/cogs/ads shown** (seller-facing rule). RPC replacement: seller variant must return ONLY own-cohort aggregates + business total COUNT (no money beyond own commission), with `seller_id = auth.uid()`-validated predicate.

**(d)** orders: staleTime 0 / 'always'; profile default; commission 60s. **(e)** seller ('commercial') routes.

---

## 10. Private full-copy downloads on ONE admin-dashboard mount (distinct queryKeys)

FULL `orders` copies (all-time, per business) — **8 distinct copies, no shared cache**:
1. `kpi-cards-orders-v2` (5 cols + pkg label join)
2. `sales-comparatif-orders` (10 cols)
3. `pending-orders-breakdown-orders` (5 cols)
4. `confirmation-pipeline-orders` (4 cols + order-status join)
5. `shipping-pipeline-orders` (7 cols + pkg join)
6. `dashboard-sellers-performance-orders` (16 cols + **order_items join** + 2 status joins) ← heaviest
7. `dashboard-products-performance-orders` (8 cols + 2 status joins)
8. `dashboard-orders-cities` (10 cols + city + pkg joins)

FULL `order_items` copy: `dashboard-order-items` (all-time, no filters beyond biz) + the embedded copy inside #6.
FULL parcels copies: `tracked-orders-company-parcels`, `tracked-orders-courier-parcels` (shared across widgets, but staleTime 0 + 'always').
Support (unpaginated, 1000-cap risk): `dashboard-payment-notes`, `dashboard-providers`, `dashboard-couriers`, `dashboard-sellers`, `dashboard-sellers-for-products`, `dashboard-products`, `dashboard-accessories`, `dashboard-ads-history`. Cached 5min: `order_statuses_cat`, `package_statuses_cat`. Server-windowed: `seller-daily-earnings-totals`.
With default staleTime 0 the 8 orders copies re-download on every mount AND browser-tab focus.

## 11. Cross-widget parity traps the RPCs must preserve (or consciously fix)

1. **Null-date row handling differs per widget**: KPI + Comparatif orders-line + Sellers + Products exclude null `date` always; ConfirmationPipeline + PendingOrdersBreakdown include null dates in EVERY window; ShippingPipeline + CityStats include them only on All Time.
2. **Exchange legs (`replace=true`)**: counted in KPI totals, Comparatif orders line, Shipping, Confirmation, Pending, City total/delivered; excluded from ALL revenue; excluded entirely (counts too) in Sellers/Products/SelfPerf.
3. **Cohort anchor differs**: KPI/Comparatif/Pipeline/City = placement `date`; Sellers/SelfPerf cohort = `assignment_date || date` (but their `totalInWindow` = placement); Products = placement. Comparatif revenue = `date_livraison ?? updated_at`.
4. **Ads attribution differs**: Sellers widget = full `amount` when `start_date` in window; Products widget = inclusive-day overlap pro-rating.
5. **per_unit commission empty-products**: 0 in shared lib/Sellers/SelfPerf/DB; lenient "all products" in Products widget's local fn.
6. **Confirmed** has two meanings: rate-confirmed (`tracked OR ∉ pendingIds`) drives every count/rate; `confirmedIds` (`is_confirmed`) only drives the KPI Confirmed card's click-through filter.
7. Delivery rate everywhere = Coliaty `delivered ÷ (tracked − excluded_from_delivery_rate pullbacks)`, tracked = parcel-table tracking codes (never `orders.tracking_number`, which is always null).
8. All rates clamped ≤100; divide-by-zero → 0.
9. Pending-age buckets measured against NOW, not window end.
10. `source_review_status neq 'pending'` NULL semantics must be verified on the box before writing the RPC predicate.

Key files (absolute):
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Dashboard.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/dashboard/{DashboardKPICards,SalesComparatifChart,PendingOrdersBreakdown,ConfirmationPipeline,ShippingPipeline,DashboardSellersPerformance,DashboardProductsPerformance,DashboardCityStats,SellerSelfPerformanceSection}.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/{useStatusCategories,useTrackedOrders,useSellerCommissionTotals}.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/{analyticsDefinitions,commercialCommission,supabase}.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/AnalyticsDateFilter.tsx`
- Render-only subcomponents (no queries): `src/components/dashboard/performance/{StackedProportionBar,PerformanceFunnel,StatusQueuePane,SourcePills,FinancialsWaterfall}.tsx`