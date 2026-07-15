# D3 RECON — ADMIN ANALYTICS PAGE (exhaustive) + REUSE/DB MAP

Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast`
Page: `src/pages/admin/Analytics.tsx` (route `/analytics`, App.tsx:308, same admin catch-all block as Dashboard → `ProtectedRoute allowedRoles=['super admin','admin']` + BusinessGuard). Admin-only; nothing on this page mounts for seller/MB/courier.

## 0. Page-level facts

- **ONE global window — VERIFIED**: single `dateFilter` state (default All Time) rendered by `AnalyticsDateFilter` (variant `ant`, identical presets to d2-recon/01 §0), passed to 11 of 12 sections. **Exception**: `UsersSection` takes NO dateFilter (fixed 30-day activity window, window-independent). So ONE RPC call for the whole page is feasible; Users can ride the same payload.
- **businessId** = `localStorage.activeBusinessId` (Analytics.tsx:44), prop to every section.
- **Refetch config**: NO staleTime override in ANY analytics section → React Query defaults (staleTime 0, refetch on mount + window focus). `useTrackedOrders` = staleTime 0 + refetchOnMount 'always'. Every focus re-downloads everything.
- **Full private downloads per mount** (distinct queryKeys): **10 full all-time `orders` copies** — `analytics-orders-profit` (P&L, order_items join), `analytics-orders-health-v2` (items join), `analytics-orders-full-v2`, `analytics-orders-for-ads-v3` (items), `analytics-orders-shipping-v2`, `analytics-orders-channels-v2` (items), `analytics-orders-customers` (phones!), `analytics-orders-sellers-v3` (items), `analytics-courier-orders-v2` (courier-only via `orFilter: 'courier_id.not.is.null'`), `analytics-mb-orders` (items) — plus 1 windowed 30-day orders scan (Users), 1 full `order_items` copy (`analytics-order-items-inv-v2`, orders join), 2 parcels copies (useTrackedOrders, shared keys with Dashboard).
- **Shared helpers**: all per d2-recon/01 §0.2 (pureRevenueForOrder chain, Coliaty rate, isRateConfirmed w/ empty-pendingIds guard, tracked-set). NEW helpers beyond §0.2, all in `src/lib/analyticsDefinitions.ts`:
  - `isRevenueOrder` = isDelivered AND order_status ∈ `paidOrderIds` (**paid gate — the dashboard NEVER gates revenue on paid; this is THE defining D3 deviation**).
  - `isProvisional` = delivered AND status ∈ `unpaidOrderIds`.
  - `isReturned` = pkg ∈ `returnedPkgIds`.
  - `returnTimestamp` = `updated_at` only (proxy — no returned_at column).
  - `cogsForOrder(order, productCostMap, accessoryCostMap)` — per item: product part gated q>0, unit = `product_unit_cost_snapshot>0 ? snap : products.cost_price`; accessory part INDEPENDENT (no `continue` before it — differs from D2 sellers-fin replication which `continue`s), unit = `accessory_unit_price>0 ? snap : accessories.cost_price`.
  - `shippingCostForDelivered` = raw `shipping_cost`.
  - `returnFeeForOrder` — key `${courier_id|company_id}|${master_city_id}`; **courier_id takes precedence** over company_id; 0 when no city.
  - `overlapFraction(a1,a2,ws,we)` — inclusive-calendar-day overlap ratio; `adSpendInWindow` = amount × fraction.
  - `payoutMonthOverlap('YYYY-MM[...]')` — month-vs-window overlap fraction.
  - `normalizeSource` — PLATFORM_SOURCE_MAP ('facebook ads'→'facebook', 12 entries in `src/lib/campaignConstants.tsx:38`), else canonical passthrough, **else lowercased raw (NEVER empty for non-empty input — docstring lies; DEVIATES from D4 `ads_history_metrics` SQL which maps unmapped methods → '' no-match)**.
  - `normalizePhone` — strip non-digits; `0`+9 digits → `212`+9.
  - `deliveredRevenueForOrder` ≡ `pureRevenueForOrder` (alias).
  - Constants: `SHIPPING_STUCK_DAYS=5`, `LOW_STOCK_THRESHOLD=10`, `ACTIVE_USER_WINDOW_DAYS=30`.
- **Common orders filter** everywhere: biz eq + `date_deleted is null` + `source_review_status neq 'pending'` (same NULL semantics caveat as D2 — the applied D2 migration settled on `<> 'pending'`; replicate). Most sections then client-filter `replace !== true` at fetch (exceptions noted).
- **Trend engine** (repeated verbatim in P&L/Health/Ads/Shipping/Channels/Customers): grain = rangeDays ≤31 daily / ≤120 weekly (weeks start Monday) / else monthly; all-time rangeStart = earliest relevant timestamp (fallback now−6mo); bucket bounds clamped to range; labels `EEE d`(≤14d)/`MMM d`/`MMM yy`. **OrdersSection deviates: no weekly tier (≤31 daily, else monthly)**. RPC shape: return day-bucketed Casablanca arrays (D2 sales_chart pattern); client re-buckets.

## 1. ProfitabilitySection (`src/components/analytics/ProfitabilitySection.tsx`) — P&L

**(a) Queries (10)**
- `['analytics-orders-profit', biz]`: fetchAllRows orders — `id, price, shipping_cost, raw_price, include_delivery_in_total, date, date_livraison, updated_at, order_status_id, package_status_id, courier_id, company_id, master_city_id, replace, order_statuses(code), package_statuses(label), order_items(quantity, unit_price, total_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)` + common filters; client `replace !== true`.
- `['analytics-products', biz]` bare `products` (id, cost_price, name); `['analytics-accessories', biz]` bare `accessories` (id, cost_price).
- `['analytics-expenses', biz]` **fetchAllRows** `expenses` — id, amount, date, type_id, expense_types(name, recurrent) (D4-fixed; recurring occurrences can exceed 1000).
- `['analytics-seller-daily-earnings', biz]` **BARE** `seller_daily_earnings` (seller_id, date, salary_earned, commission_earned, total_earned) — **1000-cap leftover** (135 rows live today, latent).
- `['analytics-mediabuyer-payments', biz]` bare `mediabuyer_payments` (id, total_amount, payout_month).
- `['analytics-ads-history', biz]` bare `ads_history` (id, amount, start_date, end_date).
- `['analytics-campaign-entries-profit', biz]` **BARE** `campaign_daily_entries` (entry_date, spend) — **1000-cap leftover** (126 rows live, growing daily).
- `['analytics-courier-fees', biz]` bare `courier_fees` (courier_id, master_city_id, return_fee).
- `['analytics-company-fees', biz]` **fetchAllRows** `company_fees` (company_id, master_city_id, return_fee) (D4-fixed; ~1,556 rows one biz).

**(b) Math** (window epoch..now default; `inWindow` inclusive; null/invalid dates excluded)
- `placedInWindow` = placement in window — ONLY the conversion denominator.
- `revenueOrders` = `isRevenueOrder` (delivered AND **paid**) AND `deliveryTimestamp` (date_livraison??updated_at) in window. `provisionalOrders` = delivered AND unpaid, same anchor. `returnedOrders` = pkg returned, anchored `updated_at`.
- `totalRevenue` = Σ pureRevenueForOrder over revenueOrders (**FULL chain** — items+raw_price selected).
- `totalCOGS` + `totalShippingCost` over revenueOrders only (returns contribute zero COGS).
- `totalReturnFees` = Σ returnFeeForOrder over returnedOrders (courier→company precedence maps).
- `totalExpenses`: strict cash basis — `expenses.date` in window, `amount>0` only, grouped by `expense_types.name ?? 'Uncategorized'` (recurrent flag deliberately IGNORED — no pro-rating).
- `totalSellerSalaries` = Σ `total_earned` of view rows with `date` in window.
- `totalMediabuyerSalaries` = Σ `total_amount × payoutMonthOverlap(payout_month)`.
- `spendProductAds` = Σ `adSpendInWindow` (overlap pro-rated); `spendGlobalAds` = Σ `spend` where entry_date in window.
- `allExpenses` = COGS+shipping+returnFees+expenses+salaries+adSpend; `netProfit`; `profitMargin` = net/revenue×100; `roi` = net/allExpenses×100.
- `expenseBreakdown` = 7 fixed lines (Product COGS, Shipping, Return fees, Product ads, Campaign ads, Seller salaries, MB salaries) + per-expense-type; filter>0, sort desc.
- **Trend**: adaptive grain; all-time anchored to earliest placement OR delivery ts over ALL orders; per bucket re-computes every component with bucket-clamped bounds (delivery-anchored revenue/cogs/ship; updated_at-anchored return fees; day-anchored expenses/global ads/seller salaries; overlap-fraction product ads; month-overlap MB salaries); `provisional` per bucket = Σ (pure − cogs − ship) per provisional order by delivery ts.
- `convertedFromPlacedCohort` = placedInWindow ∩ isRevenueOrder (conversion numerator ⊆ denominator).

**(c) Renders**: hero net profit/loss (rounded MAD, tone); tiles Revenue(+count), Expenses, Margin%, ROI%, Conversion% (+n/d), Provisional (conditional); AreaChart {revenue, expenses, profit(unused in chart), provisional dashed} per bucket; expense-breakdown ranked bars (value MAD + % of total); insight text tiles (threshold rules only — client-side).
**(d)** defaults (staleTime 0). **(e)** admin.

**RPC section shape**: scalars above + `trend[]` as per-day component arrays `{d, revenue, cogs, shipping, return_fees, expenses, product_ads, global_ads, seller_salaries, mb_salaries, provisional}` (product-ads per-day pro-ration = amount/total_days for each day of the ad's range ∩ window — exact equivalent of overlapFraction on 1-day buckets; MB salary per-day = total_amount/days-in-month for each day of payout month) + `expense_by_type[]`.

## 2. BusinessHealthSection

**(a)** `['analytics-orders-health-v2', biz]` fetchAllRows orders (id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, replace, package_statuses(label), **confirmation_date**, order_items(full 8 cols)) + common filters; **replace NOT excluded at fetch** (rates keep exchange legs; revenue excludes inline). + useStatusCategories + useTrackedOrders.
**(b)** `filtered` by placement. `orderVelocity` = filtered/daySpan (explicit → window days; all-time → min..max placement span; ≥1). delivered = isDelivered; rateConfirmed = isRateConfirmed; `confirmRate` = confirmed/total. Coliaty delivery rate (tracked−pullback), UNCLAMPED. `totalRevenue` = replace!==true AND isRevenueOrder, Σ pureRevenue (FULL chain) — **windowed by PLACEMENT (deviates from P&L's delivery anchor)**. `avgConfirmTime` = mean max(0, confirmation_date − date) hours over filtered rows with both. `failedCount` = status ∈ cancelledIds. Trend: adaptive; per bucket revenue/confirmRate/deliveryRate on placement; `revenueGrowth` = last vs previous bucket.
**(c)**: hero delivery rate; tiles Confirm rate, Avg confirm speed, Orders, Delivered, Failed, Velocity/day, Revenue, Growth (vs prior day/week/month); dual-axis AreaChart.
**(d)** defaults. **(e)** admin.

## 3. OrdersSection

**(a)** `['analytics-orders-full-v2', biz]` fetchAllRows orders (id, price, date, order_status_id, package_status_id, master_city_id, source_name, shipping_cost, replace, master_cities(name), package_statuses(label), order_items(quantity, unit_price)) + common; replace excluded at fetch. NOTE: order_items selected but UNUSED in math.
**(b)** filtered by placement; `total`; `avgOrderValue` = Σ`price`/total (**raw order total incl delivery — not pureRevenue**). deliveredCount=isDelivered; failedCount=isFailed; rateConfirmedCount=isRateConfirmed; Coliaty denom → confirmRate/deliveryRate/failedRate (unclamped). `todayOrders`/`weekOrders` computed over **ALL orders, ignoring the window** (today = same local yyyy-MM-dd; week = last-7-days interval vs now). Trend: `diffDays ≤31 → daily else MONTHLY` (**no weekly tier**); all-time start = min placement of filtered. `topCities` count by `master_cities.name` (nulls skipped), top 10. `funnelData` = [total, rateConfirmed, delivered].
**(c)**: hero total; tiles Today, This week, Confirmed(+%), Delivered(+% tone 50/25), Failed(+%), AOV; orders AreaChart; funnel bars (% of previous stage); top-cities bars.
**(d)** defaults. **(e)** admin.

## 4. AdsSection

**(a) Queries**
- `['analytics-ads-full', biz]` bare `ads_history` (id, product_id, method, amount, start_date, end_date, products(name, image_url)).
- `['analytics-campaign-entries', biz]` **BARE** `campaign_daily_entries` (id, campaign_id, platform, entry_date, spend, leads) — 1000-cap leftover.
- `['analytics-campaigns-lookup', biz]` bare `campaigns` (id, platform, name) — fetched, `void`-ed, UNUSED.
- `['analytics-orders-for-ads-v3', biz]` fetchAllRows orders (id, date, source_name, price, shipping_cost, package_status_id, order_status_id, replace, order_items(product_id, unit_price, quantity)) + common; replace excluded.

**(b) Math**
- filteredProductAds = overlapFraction(start, end||start, window)>0; filteredEntries = entry_date in window.
- `spendProductAds` = Σ adSpendInWindow (pro-rated); `spendGlobalAds` = Σ spend. `campaignCount` = product-ad row count + distinct entry campaign_ids.
- classify: delivered = isDelivered; confirmed = tracking OR (pendingIds ready AND status non-null AND ∉ pending).
- **Product-ad matcher**: `normalizeSource(o.source_name) === normalizeSource(ad.method)` AND placement ∈ [max(ad.start, windowStart), min(ad.end@23:59:59.999, windowEnd)] (**attribution window = ad range ∩ filter window**) AND (ad.product_id ⇒ order has an item with that product_id; null product_id matches all).
- **Global-entry matcher**: source match AND `o.date.slice(0,10) === entry_date` (string compare; no product filter).
- Global dedupe `seenOrderIds` across BOTH sources → totalOrders/totalConfirmed/totalDelivered/totalGrossRevenue (revenue only on delivered = `deliveredRevenueForOrder` ≡ pureRevenue, **paid or not**).
- Platform buckets keyed by **RAW** `ad.method`/`entry.platform` string (not normalized); per bucket: spend (pro-rated / summed), deduped orderIds, delivered, revenue, productCount + globalCount (distinct campaigns), cpd, roas; sort spend desc; color from PLATFORM_COLORS map.
- `roas` = grossRevenue/totalSpend; `costPerOrder`; `costPerDelivered`.
- Trend: adaptive grain; per bucket spend (bucket-clamped pro-ration) + revenue (bucket-level dedupe, delivered only, ad-range ∩ bucket).

**(c)**: hero ROAS (tone 2/1); tiles Spend(+N campaigns), Delivered revenue, Orders, Confirmed, Delivered, Cost/delivery; spend-vs-revenue AreaChart; per-platform rows (icon, orders·delivered, spend bar, spend MAD, ROAS).
**(d)** defaults. **(e)** admin.
**D4 note**: `ads_history_metrics` (live on box) covers ONLY the ads_history side, per-campaign, using ad-range windows (no filter-window intersection), `lower(source_name)` exact map (unmapped ⇒ no match), gross_revenue = `o.price` — NOT pureRevenue, no campaign_daily_entries, no cross-source dedupe. **Not a drop-in**; its consumer is AdsHistory.tsx.

## 5. ShippingSection

**(a)** `['analytics-orders-shipping-v2', biz]` fetchAllRows orders (id, date, updated_at, shipping_cost, company_id, courier_id, order_status_id, package_status_id, date_livraison, master_city_id, master_cities(name), package_statuses(label)) + common; **replace NOT excluded** (exchange legs count as shipments/delivered here). `['analytics-providers', biz]` bare providers (id, name, provider_type, logo_url); `['analytics-shipping-couriers', biz]` bare users role=courier (id, name, avatar_url, avatar_config).
**(b)** filtered by placement. `shippedOrders` = filtered ∩ trackedOrderIds (**tracked set, NOT lifecycle statuses — deviates from dashboard ShippingPipeline's shipped = is_shipped∪delivered∪returned**). `deliveredCount`/`returnedCount` over **filtered** (not shipped). Coliaty rate = delivered/(shipped−pullback); `returnRate` = returned/shipped. `totalShippingCost` = Σ shipping_cost over delivered. `avgDeliveryDays` = mean differenceInDays(deliveryTs, placementTs) over delivered with both dates. `stuckCount` = shipped ∧ ¬delivered ∧ ¬returned ∧ now−placement > 5d (vs NOW). Fulfillers: over ALL filtered orders with company_id||courier_id (**company precedence**; not restricted to tracked): total/delivered/tracked/pullback → rate = delivered/(tracked−pullback); names/logos from providers (resolveProviderLogo) / courier users; sort total desc. Trend: adaptive; per bucket shipped (placement) / delivered subset / cost Σ over delivered.
**(c)**: hero delivery rate (tone 60/30); tiles Delivered, Returns(+%), Stuck>5d, Avg days, Shipping cost, Fulfillers count; shipped-vs-delivered chart; fulfiller rows (logo, kind tag, assigned·delivered, rate bar+%).
**(d)** defaults. **(e)** admin.

## 6. InventorySection

**(a)** bare `products` (id, name, code, cost_price, selling_price, stock, active, image_url); bare `accessories` (id, name, code, cost_price, stock, active); `['analytics-order-items-inv-v2', biz]` **fetchAllRows `order_items`** (id, product_id, quantity, unit_price, product_unit_cost_snapshot, accessory_id, accessory_quantity, order_id, **orders(date, order_status_id, package_status_id, replace)**) biz-only filter — full copy; `['analytics-transactions-inv', biz]` **BARE** `transactions` (id, total_price, paid_price, date, status) — 1000-cap leftover (30 rows live).
**(b)** `isInRange`: All-Time → EVERYTHING passes (nulls included); explicit → null excluded. Counts; low stock = `stock < 10 AND active` (**strict `<` — catalog_totals uses `<= 10`: off-by-one drift**). `stockValueAtCost` = Σ stock×cost_price (products + accessories); `stockValueAtSelling` products only. `productSales`: item rows where parent order.date in range ∧ replace!==true ∧ pkg delivered ∧ product_id set ∧ product found: `sold += qty`; `revenue += qty × unit_price` (**NOT total_price, NOT pureRevenue chain**); `cost += qty × (snapshot>0 ? snapshot : cost_price)`; accessory quantities NOT in sold/revenue. `margin` = (rev−cost)/rev. Transactions windowed by `date`: value=Σtotal_price, paid=Σpaid_price, `unpaidAmount` = value−paid (**aggregate diff, NOT per-row clamped — differs from D4 transactions_totals `greatest(total−paid,0)`**).
**(c)**: hero low-stock count OR stock-at-cost; tiles Products(+active), Accessories, Value at cost, Value at selling, Units sold, Unpaid; Top-products table (top 10 by sold: sold/revenue/cost/margin%); low-stock table (rows = per-item: name, kind, stock, unit cost, at-risk = stock×cost, sorted stock asc).
**(d)** defaults. **(e)** admin.
**D4 overlap**: `catalog_totals` covers all stock tiles (count/active/stock_sum/inventory_cost/inventory_value/low_stock_count) except the threshold drift and per-item low-stock ROWS; `transactions_totals` is all-time only + clamped outstanding — neither is drop-in for the windowed/aggregate-diff behavior.

## 7. SalesChannelsSection

**(a)** `['analytics-orders-channels-v2', biz]` fetchAllRows orders (id, source_name, source_id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, replace, package_statuses(label), order_items(7 cols)) + common; replace excluded. `['analytics-sales-channels', biz]` bare sales_channels (id, name, type).
**(b)** channel key = `normalizeSource(source_name || sales_channels[source_id].name || '')`, else raw lower, else `'direct'`. Per channel over placement-windowed pool: `orders` count; `converted` = isRevenueOrder (paid+delivered); `revenue` = Σ pureRevenue over converted (FULL chain — items selected); `conversionRate` = converted/orders; sort orders desc. Trend: adaptive; per bucket per top-5 channel order counts.
**(c)**: hero top-channel name; tiles Active channels, Top channel orders (+share% of all), Best conversion (gated ≥5 orders, low-sample flag), Total via channels; stacked channel-trend AreaChart (top 5); breakdown rows (icon/color by name substring, orders, revenue MAD, conv%).
**(d)** defaults. **(e)** admin.

## 8. CustomersSection

**(a)** `['analytics-orders-customers', biz]` fetchAllRows orders (id, **phone, name**, price, date, order_status_id, package_status_id, master_city_id, replace, master_cities(name)) + common; replace excluded. **Every customer phone lands in the browser — the privacy-worst download on the page.**
**(b)** key = normalizePhone (empty → skipped). `customersSeenBefore` = keys with placement < windowStart (needs FULL history — the reason this can't be windowed server-side naively). Per-key over windowed pool: orders count; revenue only on isRevenueOrder — **pureRevenue COLLAPSES to the price/shipping branch** (select has no order_items/raw_price → `include_delivery_in_total===false ? price : max(0, price−shipping) [+ shipping when ===true]` — same collapse as D2 sales_chart/city_stats; replicate collapsed, not full chain). totalCustomers, repeat (orders>1), repeatRate, avgOrdersPerCustomer, avgCustomerValue (=LTV), totalCustomerRevenue, `newCustomersInWindow` (∉ seenBefore), returning = total−new. Regions: master_cities.name trim || 'Unknown city', top 8. Trend: adaptive; forward walk with cumulative seen-set (seed = seenBefore) → per bucket new/returning distinct customers.
**(c)**: hero repeat rate (tone 30/15); tiles Customers, New, Returning, Orders/cust, Avg LTV, Revenue; stacked new-vs-returning chart; top-cities bars.
**(d)** defaults. **(e)** admin.
**DB reuse**: server fn `normalize_phone_for_customer(phone)` + `idx_orders_business_phonenorm_live` (btree biz+norm, WHERE date_deleted IS NULL) + trgm variant already exist — use it as the customer key (semantics: verify vs client normalizePhone before binding).

## 9. SellersSection

**(a)** bare users role=commercial (id, name, active, commission_price, commission_basis, products, role, avatar_url, avatar_config); `['analytics-orders-sellers-v3', biz]` fetchAllRows orders (id, seller_id, date, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, replace, package_statuses(label), order_items(8 cols)) + common; replace excluded; `['analytics-seller-daily-earnings-section', biz]` **fetchAllRows** seller_daily_earnings (seller_id, date, commission_earned, total_earned, delivered_count) (D4-fixed); `['analytics-seller-payments', biz]` **BARE** seller_payments (id, seller_id, total_amount, paid_amount, status, period_state); `['analytics-presences', biz]` bare seller_presences (id, seller_id, date).
**(b)** filtered by **placement** (⚠️ deviates from D2 sellers_performance assignment-cohort). `commissionBySeller` = Σ view commission_earned with view.date in window (delivery anchor — source of truth). `totalPaidToSellers` = Σ paid_amount over ALL rows (lifetime; includes partials). `totalPendingToSellers` = Σ max(0, total−paid) over **period_state='open' rows only** (rolling-ledger rule). Presences windowed by date; `workingDaysInWindow` = Mon–Sat day count (explicit window) else span from earliest presence→today; `attendanceRate` = presences/(activeSellers × workingDays). Per seller: sellerOrdersInRange (seller_id match), `revenueOrders` = isRevenueOrder (paid-gated), `deliveredAny` = isDelivered, `deliveredPaid` = revenueOrders.length, `revenue` = Σ pureRevenue FULL chain over revenueOrders, `successRate` = Coliaty deliveredAny/(tracked−pullback), presence count, commission from view. Sort delivered desc; render top 10. `totalLiveCommission` = Σ per-seller commission.
**(c)**: hero Commission·this window MAD; tiles Sellers(+active), Delivered·window, Paid (lifetime), Pending payouts, Attendance%; horizontal bar ranking by delivered; details table (orders, delivered, success% badge 40/20, revenue, presence days, commission). NO cogs/ads/net (differs from dashboard §6).
**(d)** defaults. **(e)** admin.

## 10. CouriersSection

**(a)** bare users role=courier; `['analytics-courier-orders-v2', biz]` fetchAllRows orders (id, date, courier_id, order_status_id, package_status_id, package_statuses(label)) + common + `orFilter: 'courier_id.not.is.null'` (**courier-assigned orders only; replace NOT excluded**); `['analytics-courier-payment-notes', biz]` **BARE** courier_payment_notes (courier_id, total_shipping_fees, status).
**(b)** windowed by placement. `pendingByCourier` = Σ total_shipping_fees where status !== 'paid' (**lifetime**, null=unpaid). Per courier: total, tracked/pullback → `confirmed`(=denom), delivered (isDelivered), returned (isReturned), rate = delivered/denom; sort delivered desc. Overall (courier-order universe): totalShipments = windowed.length; denom = windowed tracked − pullback; overallRate. bestRate gated ≥3 shipments (low-sample fallback flag).
**(c)**: hero overall rate (70/40); tiles Couriers(+active), Shipments, Delivered, Best rate, Pending payouts; leaderboard table (shipments, delivered, returns, rate 60/30, pending MAD).
**(d)** defaults. **(e)** admin.
**D4 overlap**: `courier_roster_stats(p_business)` returns per-courier lifetime `total_orders, delivered, in_transit, returned, fees_sum, notes_paid_sum, notes_unpaid_sum, notes_count`. `notes_unpaid_sum` == this section's pendingPayment exactly. But it is UNWINDOWED and its delivered/returned use the if/else chain, no Coliaty tracked/pullback denom → **not drop-in for the windowed leaderboard**; reusable only for the pending-payout column.

## 11. MediaBuyersSection (admin-facing — full money surface is legitimate here)

**(a)** bare users role=mediabuyer (id, name, avatars, active, **commission_price, payment_type, salary_amount**); `['analytics-mb-entries', biz, fromYmd, toYmd]` **fetchAllRows campaign_daily_entries, SERVER-windowed** entry_date gte/lte (all-time = '2020-01-01'..today) — the only server-windowed orders-adjacent query on the page; `['analytics-mb-orders', biz]` fetchAllRows orders (id, date, source_name, seller_id, price, raw_price, shipping_cost, include_delivery_in_total, package_status_id, replace, package_statuses(label), order_items(7 cols)) + common; replace excluded; bare users role=commercial (commission fields + products); `['dashboard-products', biz]` + `['dashboard-accessories', biz]` bare (id, cost_price) — **queryKeys shared with dashboard widgets** (cache dedupe).
**(b)**
- `windowDays` = explicit → calendar days; all-time → earliest entry/order → today (fallback 30).
- `orderBucket` keyed `${o.date yyyy-MM-dd}|${normalizeSource(source_name)}` over windowed orders (empty source skipped): leads+=1; if `isDeliveredForCommission` (≡isDelivered): delivered+=1, revenue += pureRevenue (FULL chain), **cogs += orderCogs — product part uses CURRENT products.cost_price ONLY (ignores product_unit_cost_snapshot — deviation vs P&L/Inventory); accessory part uses accessory_unit_price snapshot else current**; shipping += shipping_cost; sellerCommission += `commissionAccruedForDeliveredOrder` (strict empty-products⇒0, per_unit units × price / per_order flat).
- Per MB: own entries by **created_by** (attribution key preserved); spend Σ; seenKeys = {entry_date|src}; `claimantCount` per key across MBs → **share = 1/N** when N MBs ran same (day, platform); attributed metrics = Σ bucket × share (fractional orders/delivered allowed).
- `mbCost`: payment_type='commission' → attributedDelivered × commission_price; else salary_amount × windowDays/30.
- `netProfit` = revenue − cogs − shipping − sellerCommission − mbCost − spend; roas = revenue/spend; costPerDelivered. Team totals = Σ; sort net desc.
**(c)**: hero team net profit; tiles Spend, Revenue, COGS+shipping, Seller comm., Buyer cost (sub 'commission + pro-rated salary'), ROAS (2/1); leaderboard table (9 cols incl per-MB ROAS + net).
**(d)** defaults (entries key includes window → refetch on window change). **(e)** admin. `mb_dashboard_stats` is MB-self-scoped — NOT reusable; this admin surface may expose everything.

## 12. UsersSection (no dateFilter)

**(a)** bare users (id, name, role, active, created_at, email); `['analytics-users-recent-activity', biz]` = fetchAllRows orders (seller_id, courier_id, updated_at) with updated_at ≥ now−30d + source_review_status neq pending (**no date_deleted filter — minor deviation**) + bare campaign_daily_entries (created_by, entry_date) gte now−30d.
**(b)** `isTrulyActive` = active flag AND (role ∈ {owner, admin, super admin} exempt OR id ∈ recent-activity set (seller_id/courier_id on recent orders, created_by on recent entries)). totalUsers/active/inactive; roleCounts {total, active} per role.
**(c)**: hero active-of-total; tiles; role chips with active/inactive split.
**(d)** defaults. **(e)** admin.

## 13. Cross-section parity registry (deviations from §0.2 / D2 — the traps)

1. **Paid gate**: `isRevenueOrder` (delivered AND is_paid) drives revenue in P&L/Channels/Customers/Sellers — dashboard revenue is delivered-only. Ads/MB use delivered-only (`deliveredRevenueForOrder`). Health uses paid-gated but placement-windowed.
2. **Revenue window anchor differs**: P&L = delivery ts; Health/Channels/Customers/Sellers = placement; Ads = placement within ad∩window; MB = placement day-bucket.
3. **pureRevenue COLLAPSES in Customers** (no items/raw_price selected) — replicate collapsed branch; FULL chain everywhere else it's used (P&L, Health, Channels, Sellers, MB, Ads).
4. **Inventory revenue** = qty × unit_price only (no total_price preference, no fallbacks, no shipping add).
5. **MB COGS ignores product snapshot** (current cost_price only); P&L/Inventory prefer snapshot; accessory snapshot honored in both.
6. **replace legs**: excluded at fetch in Orders/Ads/Channels/Customers/Sellers/MB/P&L; **kept in Health (rates) and Shipping and Couriers**; Inventory excludes per-item.
7. **normalizeSource fallthrough** to lowercased raw (client) vs D4 SQL map→''; platform bucket keys in Ads are RAW strings.
8. **Ads attribution** = ad-range ∩ filter-window intersection + global cross-source order dedupe + per-bucket dedupe — none of this exists in ads_history_metrics.
9. **Null-date handling**: `inWindow(null)=false` in all placement-filtered sections; Inventory isInRange all-time passes nulls; Users no window.
10. Low-stock `< 10` (client) vs `<= 10` (catalog_totals).
11. Transactions unpaid = aggregate Σtotal−Σpaid (can net negative overpayments) vs transactions_totals per-row clamp.
12. Orders trend has NO weekly tier; today/week chips ignore the filter entirely.
13. Rates on this page are UNCLAMPED (no min(100,…) — dashboard KPI clamps; D2 seller RPC returns unclamped; keep per-page parity).
14. `returnTimestamp` = updated_at proxy (return-fee bucketing).
15. Sellers pending payouts = open-period rows only; paid = all rows lifetime.
16. Attendance: Mon–Sat working days; all-time span from earliest presence.
17. Shipping "shipped" = tracked set (≠ dashboard lifecycle set); delivered/returned counted over filtered, not shipped; fulfiller universe = assigned (company||courier), company precedence.
18. Customers "seen before" requires full-history phone scan — server-side it's one `EXISTS` per key with the phonenorm index.
19. MB 1/N share split on (day, platform) claims; fractional counts rendered rounded.
20. `expenses.date` is **timestamptz** on the box (client windows it browser-local) — Casablanca day boundaries must be applied server-side, D2-style.

## 14. D4 leftovers in CURRENT code (checked against working tree)

Already fixed (fetchAllRows or server window): all 10 orders copies, order_items (Inventory), expenses + company_fees (P&L), seller_daily_earnings (SellersSection), campaign_daily_entries (MB section, server-windowed).
**Still bare/unpaginated (1000-cap class)**: `seller_daily_earnings` in P&L; `campaign_daily_entries` in P&L + AdsSection + UsersSection; `mediabuyer_payments`; `ads_history` (P&L + Ads); `transactions` (Inventory); `seller_payments`; `seller_presences`; `courier_payment_notes`; `courier_fees`; plus small catalogs (products, accessories, providers, users, campaigns, sales_channels — low risk). **No analytics section calls any D4/D2 RPC today.**

## 15. Reuse surface — RPCs live on the box (verified via pg_proc)

- `admin_dashboard_stats(p_business, p_from, p_to) → jsonb` — top-level keys `kpi_cards, sales_chart, pending_breakdown, confirmation_pipeline, shipping_pipeline, city_stats, sellers_performance, products_performance` (mig 20260714230000; frontend already swapped in working tree: `pages/admin/Dashboard.tsx` fires ONE call, key `['dash-stats','admin',biz,fromKey,toKey]`, staleTime 60s, widgets consume slices).
  - kpi_cards: {total, rate_confirmed, confirmation_rate, delivered, tracked, pullback, delivery_denom, delivery_rate, pending_confirmation, in_transit, canceled, refused, invoices{count, net_total}}.
  - sales_chart: {orders_by_day[{d,orders}], revenue_by_day[{d,revenue}]} — Casablanca day buckets; revenue = delivered, replace-excluded, COLLAPSED formula, NOT paid-gated.
  - shipping_pipeline: {filtered_total, shipped_total, delivered, returned, in_transit, overall_denom, overall_rate, by_status[], by_fulfiller[{kind,id,total,delivered,returned,in_transit,denom,rate}], provider_shipments, courier_shipments}.
  - city_stats: {cities[{name,total,denom,delivered,revenue}], totals{orders,denom,delivered,revenue}}.
  - sellers_performance: {total_in_window, sellers[{seller_id, assigned, confirmed, delivered, tracked, pullback, sources, pre_conf, post_conf, revenue, cogs, shipping, ads_share, commission_view, commission_client, net}]}.
  - products_performance: {products[{product_id, ordered/confirmed/tracked/pullback/delivered_units, total/confirmed/delivered_orders, revenue, product_cogs, accessory_cogs, shipping_alloc, ads_share, commission, net, sources, pre_conf, post_conf}]}.
- D4 (mig 20260714210000): `ads_history_metrics(biz, created_by, from, to)` {total_spend, platform_totals[{platform,spend}], per_campaign[{ads_history_id, total/confirmed/delivered/cancelled/fake/tracked/pullback_orders, gross_revenue(=price), shipping_costs, cost_price}]}; `catalog_totals(biz)` {products{count,active_count,stock_sum,inventory_cost,inventory_value,low_stock_count(≤10)}, accessories{…}}; `expenses_totals(biz)` {all_time, this_month(UTC month), count}; `transactions_totals(biz)` {invoiced, paid, outstanding(clamped), count_all/paid/partial/unpaid}; `courier_roster_stats(biz)` table(courier_id, total_orders, delivered, in_transit, returned, fees_sum, notes_paid_sum, notes_unpaid_sum, notes_count); `courier_self_stats`, `courier_parcel_counts`, `mb_entry_days`, `distinct_clients`, `payment_notes_unpaid_total` — all live.

**Verdict per analytics section — reuse vs new**:
| Section | Existing coverage | Verdict |
|---|---|---|
| Profitability | none (sales_chart revenue lacks paid gate + all cost lines) | NEW section in analytics fn |
| Health | kpi_cards has confirm/delivery rates but replace/window/clamp semantics differ; needs confirmation_date avg + velocity + trend | NEW |
| Orders | kpi_cards ≈ counts but includes replace legs; city_stats includes replace | NEW (cheap — count-only) |
| Ads | ads_history_metrics NOT drop-in (see §4) | NEW (hardest matcher; port client attribution exactly) |
| Shipping | shipping_pipeline differs on shipped definition + adds days/stuck/cost | NEW |
| Inventory | catalog_totals reusable for stock tiles IF threshold drift accepted/fixed; low-stock rows + product-sales table need items pass | NEW section; optionally call catalog_totals for tiles |
| Channels | none | NEW |
| Customers | none; reuse normalize_phone_for_customer + phonenorm index | NEW |
| Sellers | sellers_performance blocks reusable as SQL patterns (counts CTE, comm_view) but cohort ≠; pending/paid payouts new | NEW |
| Couriers | courier_roster_stats notes_unpaid_sum matches pending; rest unwindowed | NEW (embed notes-pending subquery, same SQL as roster) |
| MediaBuyers | mb_dashboard_stats is self-scoped; none admin-side | NEW |
| Users | none | NEW (window-independent — computed with now()−30d inside the same fn) |

**RECOMMENDATION — one new fn, D2 pattern verbatim**: `public.admin_analytics_stats(p_business uuid, p_from date default null, p_to date default null) returns jsonb`, plpgsql, STABLE, **SECURITY INVOKER**, `set search_path to ''`, Casablanca boundaries from yyyy-MM-dd (v_start/v_end_excl exactly as admin_dashboard_stats lines 104-111), flag-column status semantics, explicit p_business, revoke public/anon + grant authenticated. One call serves the whole page (verified single shared window; Users section window-independent). No p_seller/p_mb scope guards needed — admin-only page, RLS + biz predicate suffice (same stance as admin_dashboard_stats). Sections keyed `profitability, health, orders, ads, shipping, inventory, channels, customers, sellers, couriers, mediabuyers, users`; day-bucketed Casablanca arrays for every trend (client re-buckets to grain, D2 sales_chart precedent). Internal structure: shared `tracked` + `pending_flag` CTEs (copy from D2), ONE base pool per replace-handling class (replace-kept: health/shipping/couriers; replace-excluded: the rest), order_items joined once for the sections needing the full revenue/COGS chain. Frontend: ONE useQuery `['analytics-stats', biz, fromKey, toKey]`, staleTime 60s, sections consume slices; delete the 10 orders copies + order_items copy + useTrackedOrders usages here; invalidate via EcomBizRealtime prefix like ['dash-stats']. Do NOT extend admin_dashboard_stats — pool semantics (replace, paid gate, window anchors) diverge widget-by-widget and its payload/review scope is already settled.

## 16. DB side — tables analytics touches beyond orders (schemas verified live on box)

- **expenses**: id, type_id→expense_types(name, recurrent, active), name, description, amount numeric, **date timestamptz**, recurring_id, occurrence_date date, biz. Idx: biz, date, type_id, (recurring_id, occurrence_date) uniq. 121 rows.
- **campaign_daily_entries**: id, campaign_id, biz, entry_date date, spend numeric, leads int, notes, platform text, created_by uuid. Idx: biz, entry_date, created_by, platform, campaign_id, (campaign_id, entry_date) uniq. 126 rows.
- **seller_daily_earnings**: VIEW (security_invoker) — id, seller_id, date date, salary_earned, commission_earned, delivered_count int, total_earned, created_at, biz. 135 rows. Payout source of truth; window on `date`.
- **transactions**: id, name, phone, address, note, email, date **date**, total_price, paid_price, status, biz. Idx: biz only (no date idx — fine at 30 rows).
- **ads_history**: id, product_id, method text, amount numeric, start_date/end_date **date**, created_by, biz. Idx: biz, product_id, created_by. 30 rows.
- **mediabuyer_payments**: mediabuyer_id, payout_month text, payment_type, salary_earned, commission_earned, total_amount, delivered_orders, total_spend, campaigns_count, status, paid_amount, carried_in/out, month_earned, period_state, earned_frozen, closed_at, biz. Idx: biz, mb, month, status, (mb, month, biz) uniq.
- **courier_fees / company_fees**: (courier|company)_id, fee, master_city_id, return_fee, biz. Uniq partial (entity, city, biz) WHERE city NOT NULL; idx biz, city. NOTE: courier_roster_stats uses LATERAL LIMIT 1 by updated_at for the non-unique legacy shape — the uniq index now exists, plain join is safe.
- **seller_presences**: seller_id, date date, biz. Uniq (seller_id, date); idx biz.
- **seller_payments**: seller_id, payout_month, total_amount, paid_amount, status, period_state, carried_in/out, month_earned, earned_frozen, closed_at, biz. Idx biz, seller, (seller, month, biz) uniq.
- **courier_payment_notes**: courier_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, biz. Idx biz, courier, keyset (biz, created_at desc, id desc), trgm.
- **sales_channels**: id, type, name, + sheet-sync cols; idx biz.
- **campaigns**: id, biz, created_by, name, status, platform, … (display lookup only — currently unused).
- **Customers derivation**: NO customers table involved — derived from orders.phone. Server assets: `normalize_phone_for_customer()` + `idx_orders_business_phonenorm_live` (biz, norm) WHERE date_deleted IS NULL + trgm gin.
- **orders windowed-scan indexes**: `idx_orders_biz_date (biz, date) WHERE date_deleted IS NULL` = the placement-window index (D2 uses it). **No (biz, date_livraison) index** — delivery-anchored windows (P&L revenue/provisional) scan the biz pool and filter, same accepted cost as D2 sales_chart. `idx_orders_biz_seller_created`, courier_id, company_id, master_city_id, package/order_status_id btrees all present.
- Row counts today are tiny (≤150 per satellite table) — every satellite aggregate is trivially cheap; the win is killing the 10× full-orders(+items) downloads per mount/focus.

## Key files (absolute)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Analytics.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/analytics/{ProfitabilitySection,BusinessHealthSection,OrdersSection,AdsSection,ShippingSection,InventorySection,SalesChannelsSection,CustomersSection,SellersSection,CouriersSection,MediaBuyersSection,UsersSection,AnalyticsDateFilter}.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/analyticsDefinitions.ts` (all D3-new helpers), `src/lib/campaignConstants.tsx` (PLATFORM_SOURCE_MAP), `src/lib/commercialCommission.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260714230000_d2_dashboard_stats.sql` (pattern to copy), `20260714210000_d4_money_aggregates.sql`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Dashboard.tsx` (the D2 one-call frontend precedent, working tree)