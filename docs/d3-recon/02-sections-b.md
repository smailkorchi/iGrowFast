# D3 RECON — ANALYTICS SECTIONS (admin /analytics) — private full-table downloads to replace

Scope = the six sections named in the task map. All facts from CURRENT code (post-D4 tree, 2026-07-15). Shared helper semantics (pureRevenueForOrder chain, Coliaty rate, isRateConfirmed, tracked-set) are per docs/d2-recon/01-admin-dashboard.md §0.2 — only DEVIATIONS are noted here.

## 0. Page-level facts (apply to ALL six sections)

- **Role visibility**: every section is imported ONLY by `src/pages/admin/Analytics.tsx` (verified: no other consumer in src/). That page mounts under `ProtectedRoute allowedRoles={['super admin','admin']}` + `BusinessGuard` (src/App.tsx:282-283, route `/analytics` at :308). **MediaBuyersSection is admin-only — the MB-facing rule does NOT constrain its rendered surface**, BUT it DOES constrain the RPC: a SECURITY-INVOKER `.../analytics` RPC is callable by ANY authenticated role via PostgREST, and the MediaBuyers payload contains business-wide spend, ROAS, per-MB net profit of OTHER MBs. D3 must gate the MB/ads/profitability aggregates behind an admin check raising 42501 (D2-contract rule), not rely on route gating.
- **businessId**: `localStorage.getItem('activeBusinessId')` (Analytics.tsx:44) passed as prop; every query filters `"DigiCom Business" eq businessId` client-supplied → RPCs take explicit `p_business` (D2 convention).
- **Window**: ONE global `dateFilter {from?: Date, to?: Date, label}` default All Time, from `AnalyticsDateFilter` (same presets as D2 recon 01 §0). Applied CLIENT-side in every section via `windowStart = from ? startOfDay(from) : new Date(0)`, `windowEnd = to ? endOfDay(to) : new Date()`, browser-local (no Casablanca). Sole server-windowed query: MediaBuyersSection `campaign_daily_entries` (entry_date gte/lte `format(d,'yyyy-MM-dd')`, All-Time fallback from='2020-01-01').
- **Refetch config**: `new QueryClient()` with NO options (App.tsx:180) and ZERO per-query overrides in all six sections → staleTime 0, refetchOnMount true, refetchOnWindowFocus true, retry 3. Every mount AND every window focus re-downloads every full copy. `useStatusCategories` = staleTime 5min; `useTrackedOrders` = staleTime 0 + refetchOnMount 'always' (2 full parcel-table copies: `company_parcels` + `courier_parcels`, `order_id, tracking_code`, biz eq, fetchAllRows).
- **Common orders predicate** (Profitability, Ads, Sellers, Couriers, MB): biz eq + `date_deleted is null` + `source_review_status neq 'pending'` + client-side `filter(o => o.replace !== true)`. Exception: InventorySection (see §2 — no date_deleted / source_review_status / no replace-leg exclusion... it DOES exclude replace client-side but NOT date_deleted).
- **No section calls any RPC today** (grep: zero `.rpc(` in src/components/analytics/ and Analytics.tsx). All six are pure full-table-download + client math.

---

## 1. ProfitabilitySection (`src/components/analytics/ProfitabilitySection.tsx`, 806 lines)

### (a) Queries (9)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-orders-profit',biz]` | orders | id, price, shipping_cost, raw_price, include_delivery_in_total, date, date_livraison, updated_at, order_status_id, package_status_id, courier_id, company_id, master_city_id, replace, order_statuses(code), package_statuses(label), order_items(quantity, unit_price, total_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot) | **fetchAllRows** | common predicate; client drops replace===true |
| `['analytics-products',biz]` | products | id, cost_price, name | bare | biz eq |
| `['analytics-accessories',biz]` | accessories | id, cost_price | bare | biz eq |
| `['analytics-expenses',biz]` | expenses | id, amount, date, type_id, expense_types(name, recurrent) | **fetchAllRows** (orderBy id) | biz eq |
| `['analytics-seller-daily-earnings',biz]` | seller_daily_earnings (view) | seller_id, date, salary_earned, commission_earned, total_earned | **bare — 1000-cap risk** | biz eq |
| `['analytics-mediabuyer-payments',biz]` | mediabuyer_payments | id, total_amount, payout_month | bare | biz eq |
| `['analytics-ads-history',biz]` | ads_history | id, amount, start_date, end_date | bare | biz eq |
| `['analytics-campaign-entries-profit',biz]` | campaign_daily_entries | entry_date, spend | **bare — 1000-cap risk (daily rows, real)** | biz eq |
| `['analytics-courier-fees',biz]` | courier_fees | courier_id, master_city_id, return_fee | bare | biz eq |
| `['analytics-company-fees',biz]` | company_fees | company_id, master_city_id, return_fee | **fetchAllRows** (D4-fixed: one biz has ~1,556) | biz eq |

Render gate: only `ordersLoading` gates the spinner; other queries race in (metrics recompute as they land).

### (b) Client math
Classification (two attribution rules, doc'd in-file):
- `placedInWindow` = placementTimestamp(o.date) in window — ONLY for the Conversion denominator.
- `revenueOrders` = `isRevenueOrder` (delivered flag AND paid flag) AND deliveryTimestamp (`date_livraison ?? updated_at`) in window.
- `provisionalOrders` = `isProvisional` (delivered AND unpaid category) AND deliveryTimestamp in window.
- `returnedOrders` = `isReturned` (pkg ∈ returnedPkgIds) AND `returnTimestamp` (= `updated_at`, proxy — no returned_at column) in window.

Money:
- `totalRevenue` = Σ pureRevenueForOrder over revenueOrders (§0.2 chain, incl. `+shipping_cost when include_delivery_in_total===true`).
- `totalCOGS` = Σ cogsForOrder(revenueOrders): per line, product `product_unit_cost_snapshot` if >0 else current products.cost_price map; accessory `accessory_unit_price` snapshot if >0 else accessories.cost_price map. Returned orders contribute ZERO COGS.
- `totalShippingCost` = Σ shipping_cost of revenueOrders (shippingCostForDelivered = raw shipping_cost).
- `totalReturnFees` = Σ returnFeeForOrder(returnedOrders): key `courier_id|master_city_id` in courier_fees map, ELSE `company_id|master_city_id` in company_fees map (courier takes precedence; 0 when no city).
- `totalExpenses` = Σ expenses.amount where amount>0 AND date in window — **strict cash basis; the old recurrent-flag monthly pro-rate was REMOVED** (in-file rationale: expense_types has no period metadata). Also grouped `expenseByType` by `expense_types.name || 'Uncategorized'`.
- `totalSellerSalaries` = Σ seller_daily_earnings.**total_earned** (salary+commission) where row.date in window (accrual, delivery-anchored view).
- `totalMediabuyerSalaries` = Σ mediabuyer_payments.total_amount × `payoutMonthOverlap(payout_month, window)` (inclusive-day fraction of that calendar month inside the window).
- `spendProductAds` = Σ ads_history.amount × `overlapFraction(start_date, end_date??start_date, window)` (inclusive-day pro-rate).
- `spendGlobalAds` = Σ campaign_daily_entries.spend where entry_date in window (no pro-rate — daily rows).
- `allExpenses` = COGS + shipping + returnFees + expenses + (sellerSalaries + mbSalaries) + (productAds + globalAds); `netProfit` = totalRevenue − allExpenses; `profitMargin` = netProfit/revenue×100 (0 if rev≤0); `roi` = netProfit/allExpenses×100 (0 if exp≤0).
- Provisional: per delivered-unpaid order `pure − cogs − shipping` (map by order id); `provisionalRevenue` = Σ pure; `provisionalProfit` = Σ map values.
- Conversion = `convertedFromPlacedCohort` (placedInWindow that are isRevenueOrder — cohort-bounded, ≤100%) / placedInWindow.length.
- `expenseBreakdown` = [COGS, Shipping, Return fees, Product ads, Campaign ads, Seller salaries, MB salaries, ...perExpenseType] filtered >0 sorted desc.

Trend: adaptive granularity from window length (≤31d daily / ≤120d weekly / else monthly — NOTE: local constants, NOT the shared `pickChartGrain` which uses <60/≤180). All-Time range anchor = earliest placement-or-delivery timestamp across ALL orders, else `subMonths(now,6)`. Buckets clamped to the window; per bucket the SAME formulas re-run (revenue/COGS/shipping by delivery date, return fees by updated_at, expenses cash-basis, product ads overlap-fraction per bucket, entries by entry_date, seller earnings by date, MB payments by payoutMonthOverlap per bucket). `provisional` per bucket = Σ per-order provision by delivery date.

### (c) Rendered output shape
`SectionStory` hero = net profit|net loss (MAD, rounded abs). Supporting tiles: Revenue (+ revenueOrderCount sub), Expenses, Margin % (tone ≥15 pos / ≥0 warn / neg), ROI %, Conversion % (x/y of placed cohort), Provisional (only if >0, + count). Narrative string. Charts: Revenue-vs-Expenses-vs-Provisional AreaChart from `trendData [{month,revenue,expenses,profit,provisional}]`; Expense-breakdown ranked bar list (name, value MAD, % of total); Insights list (rule-based tips off netProfit/adSpend ratio/margin/roi/conversion).

### (d/e) Window/refetch: global; all-time downloads; defaults (see §0). Admin-only.

### D4 leftovers / cap risks
- `seller_daily_earnings` bare (per-seller-per-day rows — >1000 realistic ⇒ salary undercount), `campaign_daily_entries` bare (spend undercount), `mediabuyer_payments`, `ads_history`, `courier_fees` bare. `expenses` and `company_fees` were fetchAllRows-FIXED (comments in-file). None of the netProfit inputs are server aggregates yet — **the entire P&L is client math**; D4's `expenses_totals` exists but is all-time/this-month only (different window semantics) and is NOT used here.

---

## 2. InventorySection (`InventorySection.tsx`, 349 lines)

### (a) Queries (4)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-products-inv',biz]` | products | id, name, code, cost_price, selling_price, stock, active, image_url | bare | biz eq |
| `['analytics-accessories-inv',biz]` | accessories | id, name, code, cost_price, stock, active | bare | biz eq |
| `['analytics-order-items-inv-v2',biz]` | order_items | id, product_id, quantity, unit_price, product_unit_cost_snapshot, accessory_id, accessory_quantity, order_id, orders(date, order_status_id, package_status_id, replace) | **fetchAllRows** | **biz eq ONLY — no date_deleted / source_review_status on parent orders** |
| `['analytics-transactions-inv',biz]` | transactions | id, total_price, paid_price, date, status | bare | biz eq |

### (b) Client math
- Window: `hasExplicitFilter`? then isWithinInterval(startOfDay(from)..endOfDay(to)), **null-date rows excluded**; All-Time passes everything (incl. null dates).
- Catalog: totalProducts, activeProducts, totalAccessories; lowStock = `stock < 10` (LOW_STOCK_THRESHOLD, strict <) AND `active` — products and accessories separately, ROW LISTS kept.
- `stockValueAtCost` = Σ products stock×cost_price + Σ accessories stock×cost_price; `stockValueAtSelling` = Σ products stock×selling_price only (accessories cost-only).
- "Sold": iterate order_items; skip if joined orders.date not in range; skip `orders.replace===true`; require `deliveredPkgIds.has(orders.package_status_id)` (category-strict); require product_id AND product still in products list (deleted products silently dropped). Per product accumulate: `sold += quantity`; `revenue += quantity × unit_price` (**DEVIATION from pureRevenueForOrder: line unit_price×qty only — ignores total_price snapshot preference and all order-level fallbacks/delivery add-back**); `cost += quantity × (product_unit_cost_snapshot>0 ? snapshot : products.cost_price)`. margin = (rev−cost)/rev×100.
- Window anchor for "sold" = **placement date (orders.date)** — deviates from P&L's delivery anchor for the same "delivered" universe.
- Transactions: filter by t.date in range; `totalTransactionValue` = Σ total_price; `totalPaid` = Σ paid_price; `unpaidAmount = totalValue − totalPaid` (**global difference, NO per-row clamp — can go negative on overpayment; D4 transactions_totals uses per-row greatest(total−paid,0) and is all-time — different on both counts, not reusable as-is**).

### (c) Rendered output
Hero: lowStockTotal count (negative tone) OR stockValueAtCost. Tiles: Products (+active sub), Accessories, Value at cost, Value at selling, Units sold (Σ sold), Unpaid (warning if >0). Top-products table (top 10 by sold): image, name, sold, revenue, cost, margin% (tone >30/>0/else). Low-stock table (all rows, sorted stock asc): item, kind (Product/Accessory), stock ("N left", tone), unit cost, at-risk = stock×cost.

### (d/e) Defaults; admin-only.

### D4 leftovers / notes
- `catalog_totals(p_business)` (D4) already computes count/active/stock sums/inventory cost+value/low_stock_count — but its low_stock is `<= 10` and ignores `active`, and Inventory needs the low-stock ROW LIST and per-product sold/revenue/cost table, so it does NOT cover this section. `transactions_totals` mismatch noted above.
- DEFECT to carry into D3 design: soft-deleted (`date_deleted`) and pending-review orders' items are currently COUNTED as sold (no parent filter). Decide replicate-vs-fix explicitly.

---

## 3. AdsSection (`AdsSection.tsx`, 634 lines)

### (a) Queries (4)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-ads-full',biz]` | ads_history | id, product_id, method, amount, start_date, end_date, products(name,image_url) | bare | biz eq |
| `['analytics-campaign-entries',biz]` | campaign_daily_entries | id, campaign_id, platform, entry_date, spend, leads | **bare — 1000-cap risk** | biz eq |
| `['analytics-campaigns-lookup',biz]` | campaigns | id, platform, name | bare | biz eq (fetched, currently UNUSED — `void campaignRows`) |
| `['analytics-orders-for-ads-v3',biz]` | orders | id, date, source_name, price, shipping_cost, package_status_id, order_status_id, replace, order_items(product_id, unit_price, quantity) | **fetchAllRows** | common predicate; client drops replace===true |

Plus hooks: useStatusCategories (deliveredPkgIds, pendingIds), useTrackedOrders.

### (b) Client math
Two spend sources: product ads (ads_history, overlap pro-rated) + global ads (campaign_daily_entries, daily).
- Window filter: product ads kept when overlapFraction(start,end??start,window)>0 (whole ad kept for attribution); entries by entry_date in window.
- `spendProductAds` = Σ adSpendInWindow(ad, window); `spendGlobalAds` = Σ entry.spend; `totalSpend` = sum. `campaignCount` = filtered product-ad row count + DISTINCT campaign_id count among filtered entries.
- `classify(o)`: isDelivered = flag helper; isConfirmed = trackedOrderIds.has(o.id) OR (pendingIds.size>0 AND order_status_id AND ∉pendingIds) — inline `isRateConfirmed` semantics incl. empty-set guard (no deviation).
- Attribution + dedupe: shared `seenOrderIds` Set — an order matching BOTH a product ad and a global entry counts ONCE toward totalOrders/totalConfirmed/totalDelivered/totalGrossRevenue. `totalGrossRevenue` += `deliveredRevenueForOrder(o)` for delivered (paid or not).
  - **DEVIATION (comment vs behavior)**: `deliveredRevenueForOrder` is an alias of `pureRevenueForOrder` — despite the "product-only (no shipping)" doc comment it DOES add collected delivery when include_delivery_in_total===true. D3 must lock to the BEHAVIOR.
- Product-ad matcher: normalizeSource(o.source_name) === normalizeSource(ad.method) AND placementTimestamp within **intersection of ad [start_date, end_date 23:59:59.999] AND user window** AND (ad.product_id ? order_items contains that product_id : any).
- Global-entry matcher: normalized source match AND `o.date.slice(0,10) === entry_date` (**raw ISO-string prefix = UTC day, not Casablanca/local — timezone deviation to resolve in D3**).
- Platform breakdown: bucket per raw platform string (ad.method / entry.platform); per bucket: spend (pro-rated / summed), per-bucket orderIds Set dedupe, delivered count, revenue (deliveredRevenueForOrder), productCount (ad rows), globalCount (distinct campaign_ids), cpd = spend/delivered, roas = revenue/spend. Cross-platform double counting IS possible per bucket (dedupe only within bucket; top-line uses the global Set).
- Top-line: `roas = totalGrossRevenue/totalSpend`; `costPerOrder = spend/orders`; `costPerDelivered = spend/delivered`.
- Trend: same adaptive granularity/clamp machinery as Profitability (≤31/≤120 thresholds); All-Time anchor = earliest of ad start_dates, entry_dates, order placements, else subMonths(now,6). Per bucket: spend = ads overlap-pro-rated to bucket + entries in bucket; revenue = deduped delivered revenue where attribution window = intersection of ad range with BUCKET bounds; roas per bucket.

### (c) Rendered output
Hero: ROAS `x.xx x` (tone ≥2/≥1/else). Tiles: Spend (+ campaigns sub), Delivered revenue, Orders, Confirmed, Delivered, Cost/delivery. Spend-vs-revenue AreaChart from trendData [{month,spend,revenue,roas}]. By-platform list: icon, platform, orders·delivered, spend bar (share of max), spend MAD, ROAS.

### (d/e) Defaults; admin-only.

### D4 overlap — ads_history_metrics does NOT cover this
`public.ads_history_metrics(p_business, p_created_by, p_from, p_to)` (mig 20260714210000:60) serves `src/pages/AdsHistory.tsx` ONLY. Semantics differ from AdsSection on five axes: (1) gross_revenue = Σ `o.price` on delivered — NOT the pureRevenue chain; (2) matcher REQUIRES the order to contain the ad's product always (client only when product_id set) and matches over the FULL ad range even when windowed (client intersects with window); (3) hardcoded method→source case list vs client PLATFORM_SOURCE_MAP + lowercase-passthrough; (4) no `source_review_status <> 'pending'` predicate; (5) no campaign_daily_entries side at all, no trend, no dedupe across sources. Reuse for D3 = NO; a new aggregate is required (or a conscious semantic merge).

---

## 4. SellersSection (`SellersSection.tsx`, 348 lines)

### (a) Queries (5)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-sellers-v2',biz]` | users | id, name, active, commission_price, commission_basis, products, role, avatar_url, avatar_config | bare | biz eq + role eq 'commercial' |
| `['analytics-orders-sellers-v3',biz]` | orders | id, seller_id, date, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, replace, package_statuses(label), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot) | **fetchAllRows** | common predicate; client drops replace===true |
| `['analytics-seller-daily-earnings-section',biz]` | seller_daily_earnings | seller_id, date, commission_earned, total_earned, delivered_count | **fetchAllRows** | biz eq |
| `['analytics-seller-payments',biz]` | seller_payments | id, seller_id, total_amount, paid_amount, status, period_state | bare | biz eq |
| `['analytics-presences',biz]` | seller_presences | id, seller_id, date | bare | biz eq |

Plus useTrackedOrders + useStatusCategories (delivered/paid/adminPullback sets).

### (b) Client math
- Volume window anchor = placement (`orders.date`). Commission window anchor = `seller_daily_earnings.date` (delivery-anchored view) — two anchors coexist, per-design.
- `commissionBySeller` = Σ commission_earned per seller for view-rows in window (view = source of truth; never re-derived — matches memory rule).
- `totalPaidToSellers` (LIFETIME) = Σ paid_amount over ALL seller_payments rows (explicitly NOT filtered status==='paid' — partial payouts counted; matches Salaries page).
- `totalPendingToSellers` = Σ max(0, total_amount − paid_amount) over rows with `period_state === 'open'` ONLY (rolling ledger: carried months live inside the open ticket; summing all rows double-counts).
- Attendance: totalPresences = presence rows in window; expected = activeSellers × working days Mon–Sat in window (Sundays excluded); All-Time span = earliest presence → today. attendanceRate = presences/expected×100.
- Per seller: ordersInRange (placement window, seller_id eq); `revenueOrders` = isRevenueOrder subset; `deliveredAny` = isDelivered count; `deliveredPaid` = revenueOrders count; `revenue` = Σ pureRevenueForOrder(revenueOrders); presences count; commission from view map; successRate = `deliveredAny ÷ (tracked − pullback)` ×100 where tracked = own orders in trackedOrderIds, pullback = isAdminPullback among tracked — **DEVIATION: numerator is deliveredAny over ALL own orders (not tracked-only) and there is NO ≤100 clamp** (§0.2 documents the clamped form).
- Sort by delivered desc; top-10 kept. `totalLiveCommission` = Σ per-seller commission (top-10 slice is applied AFTER the total — total is all sellers). `avgOrdersPerSeller` = filtered.length/activeSellers (computed, not rendered).

### (c) Rendered output
Hero: Commission this window (Σ commission_earned, MAD, warning tone). Tiles: Sellers (+active), Delivered·window (Σ over the TOP-10 slice — footgun: header sums sliced rows), Paid lifetime MAD, Pending payouts MAD, Attendance %. Horizontal BarChart ranking by delivered (top-10). Performance table (top-10): avatar+name(+Trophy for #1, Inactive badge, commission_price MAD/unit|order), Orders, Delivered, Success% badge (>40/>20 tones), Revenue MAD, Presence days, Commission MAD.

### (d/e) Defaults; admin-only. (Seller-facing analogues live on the seller dashboard, already covered by D2 RPC 2 — this section is the ADMIN view; no scope guard needed beyond admin gating.)

### D4 leftovers
`seller_payments` and `seller_presences` bare (cap risk moderate); orders + earnings fetchAllRows-fixed. No RPC reuse available (D4 has none for seller rosters; D2's admin_dashboard_stats sellers_performance block overlaps heavily — D3 should share its shape/CTEs, adding presences/payout-ledger/attendance).

---

## 5. CouriersSection (`CouriersSection.tsx`, 285 lines)

### (a) Queries (3)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-couriers',biz]` | users | id, name, avatar_url, avatar_config, active | bare | role eq 'courier' + biz eq |
| `['analytics-courier-orders-v2',biz]` | orders | id, date, courier_id, order_status_id, package_status_id, package_statuses(label) | **fetchAllRows** | common predicate + `orFilter: 'courier_id.not.is.null'` (single-condition or ⇒ courier_id IS NOT NULL) — NOTE: no replace exclusion here (no replace column selected/filtered) |
| `['analytics-courier-payment-notes',biz]` | courier_payment_notes | courier_id, total_shipping_fees, status | bare | biz eq |

Plus useTrackedOrders + useStatusCategories (delivered/returned/adminPullback sets).

### (b) Client math
- Window anchor = placement. `windowed` = orders in window.
- Pending payouts (LIFETIME, not windowed): per courier Σ `total_shipping_fees` where `status !== 'paid'` — **DEVIATION from D4 `payment_notes_unpaid_total`, which sums `net_amount` where `status = 'unpaid'`**: different column AND different predicate (`!== 'paid'` also catches any partial/other statuses). Not reusable without a semantics decision.
- Per courier: own = windowed where courier_id eq; total; tracked = own ∩ trackedOrderIds; pullback = isAdminPullback among tracked; confirmed = tracked − pullback; delivered = isDelivered over ALL own (not tracked-only); returned = isReturned count; rate = delivered/confirmed×100 — **no ≤100 clamp** (same deviation as Sellers).
- Top-line: totalShipments = windowed.length; totalConfirmed = window-level tracked − pullback; totalDelivered = window-level delivered; overallRate = delivered/confirmed×100; totalPending = Σ pending map.
- Best rate gated: qualifiers = couriers with total ≥ 3 (BEST_RATE_MIN_SHIPMENTS); bestRate = max rate among qualifiers, else raw max + `bestRateLowSample` flag.

### (c) Rendered output
Hero: overall delivery rate % (tone ≥70/≥40/else). Tiles: Couriers (+active where active !== false), Shipments, Delivered, Best rate (+low-sample sub), Pending payouts MAD (warning if >0). Leaderboard table (sorted delivered desc, ALL couriers): avatar+name (+· inactive), Shipments, Delivered, Returns, Rate % (tone ≥60/≥30), Pending MAD.

### (d/e) Defaults; admin-only.

### D4 leftovers
`courier_roster_stats(p_business)` and `courier_self_stats` exist (mig 20260714210000:491,594 — consumers are courier pages) — check their exact tile coverage before writing a new aggregate; the pending-notes semantics gap above must be resolved either way. `courier_payment_notes` bare select = cap risk on the money tile.

---

## 6. MediaBuyersSection (`MediaBuyersSection.tsx`, 531 lines)

### (a) Queries (6)
| key | table | select | fetch | filters |
|---|---|---|---|---|
| `['analytics-mediabuyers',biz]` | users | id, name, avatar_url, avatar_config, active, commission_price, payment_type, salary_amount | bare | role eq 'mediabuyer' + biz eq |
| `['analytics-mb-entries',biz,fromYmd,toYmd]` | campaign_daily_entries | entry_date, spend, leads, platform, created_by | **fetchAllRows, SERVER-WINDOWED** | biz eq + entry_date gte fromYmd + lte toYmd (All-Time: from='2020-01-01', to=now; `format(d,'yyyy-MM-dd')` local) |
| `['analytics-mb-orders',biz]` | orders | id, date, source_name, seller_id, price, raw_price, shipping_cost, include_delivery_in_total, package_status_id, replace, package_statuses(label), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price) | **fetchAllRows** (all-time) | common predicate; client drops replace===true. **NOTE: order_items select has NO product_unit_cost_snapshot** |
| `['analytics-mb-sellers',biz]` | users | id, commission_price, commission_basis, products | bare | role eq 'commercial' + biz eq |
| `['dashboard-products',biz]` | products | id, cost_price | bare | biz eq — **queryKey shared with dashboard components (cross-page cache)** |
| `['dashboard-accessories',biz]` | accessories | id, cost_price | bare | biz eq — same shared-key note |

### (b) Client math
- inWindow local closure = isWithinInterval(startOfDay(from)/new Date(0) .. endOfDay(to)/now).
- `windowDays` (for salary pro-rate): explicit window → calendar days inclusive; All-Time → earliest entry/order date → today; no data → 30.
- `orderCogs(o)` — **DEVIATION from cogsForOrder**: product cost = CURRENT products.cost_price map ONLY (no product_unit_cost_snapshot — the column isn't even selected); accessory = accessory_unit_price snapshot if finite>0 else accessories.cost_price map.
- `sellerCommissionForOrder(o)` = commissionAccruedForDeliveredOrder per §0.2 (per_unit: assigned-product units × rate, empty users.products ⇒ 0; per_order: flat), using the seller row of o.seller_id; 0 when rate ≤0 or seller missing.
- Attribution buckets: delivered classification via `isDeliveredForCommission` (identical body to isDelivered). Orders bucketed by key `yyyy-MM-dd(o.date, LOCAL format())|normalizeSource(o.source_name)` when in window; per bucket: leads (=order count), delivered, revenue (Σ pureRevenueForOrder — includes collected delivery), cogs, shipping (Σ shipping_cost of delivered), sellerCommission. Note the day key uses date-fns `format` (browser-local day) — different from AdsSection's UTC `.slice(0,10)`; a THIRD timezone convention in the same page.
- Per MB (attribution key = `campaign_daily_entries.created_by`, per the standing memory rule): own entries; spend = Σ spend; seenKeys = Set of `entry_date|normalizeSource(platform)`; `claimantCount` per key = number of MBs claiming that (day,platform); each MB receives share `1/claimantCount` of the bucket's leads/delivered/revenue/cogs/shipping/sellerCommission (proportional split kills the old double count).
- `mbCost`: payment_type==='commission' → attributedDelivered × commission_price; else salary_amount>0 → salary_amount × windowDays/30. (**DIFFERENT MB-cost model from ProfitabilitySection**, which uses mediabuyer_payments × payoutMonthOverlap — the two sections will not reconcile on the same window; flag for D3 unification decision.)
- Per MB: netProfit = revenue − cogs − shipping − sellerCommission − mbCost − spend; grossMargin = same without spend; roas = revenue/spend; costPerDelivered = spend/attributedDelivered.
- Totals = Σ over MBs (post-share, so no double counting); overallRoas = totalRevenue/totalSpend; sorted by netProfit desc.

### (c) Rendered output
Hero: net profit MAD (tone by sign). Tiles: Spend, Revenue, COGS+shipping, Seller comm., Buyer cost (+"commission + pro-rated salary" sub), ROAS (tone ≥2/≥1). Leaderboard table (ALL MBs, netProfit desc): avatar+name(+inactive), Spend, Delivered (rounded — fractional from shares), Revenue, COGS+ship, Seller comm., Buyer cost, ROAS, Net profit.

### (d/e) Defaults except the entries queryKey embeds fromYmd/toYmd (only query on the page that refetches on window change). **Admin-only surface (verified §0), so exposing spend/ROAS/net is fine to RENDER — but the D3 RPC must be admin-gated (42501) because it aggregates business-wide spend and other MBs' economics; MBs must not be able to call it directly.**

---

## 7. Cross-section facts D3 must handle

1. **Shared full-copy downloads on one Analytics mount** (distinct queryKeys ⇒ orders table downloaded 5× by these six sections alone: profit/ads/sellers/couriers/MB variants, plus the other six sections not in this task's map — OrdersSection, ShippingSection, CustomersSection, SalesChannelsSection, UsersSection, BusinessHealthSection — which exist on the same page and re-download orders again; D3 scope decision needed on whether they ride the same RPC).
2. **Timezone**: three conventions live on this page (browser-local date-fns, UTC string-slice in AdsSection global matcher, local `format()` day keys in MB). D2/D4 convention = Casablanca boundaries from `yyyy-MM-dd` params — parity testing must expect boundary diffs.
3. **Anchors are per-metric, not per-section**: placement (volumes, Inventory sold, Couriers, Sellers volume, Ads matching), delivery `date_livraison??updated_at` (revenue/COGS/shipping, commission view), updated_at (returns), expense.date / entry_date / payout_month / ad-range overlap (costs). Do NOT unify silently (D2 contract rule).
4. **No ≤100 clamp** on Sellers/Couriers rates in current code even though §0.2 documents the clamped Coliaty form; numerators use all-orders delivered, denominators tracked−pullback. Replicate-or-fix decision needed.
5. **RPC reuse map**: ads_history_metrics = NOT reusable (5 semantic gaps, §3); catalog_totals = partial concept overlap only (low-stock predicate + active differ, needs row lists); transactions_totals = all-time + per-row clamp vs windowed + unclamped; payment_notes_unpaid_total = wrong column/predicate for CouriersSection pending; courier_roster_stats/courier_self_stats = check before duplicating. seller_daily_earnings view = KEEP as commission source inside the new RPCs (never re-derive).
6. **Wrong-money-class bare selects still live** (D4 leftovers within these sections): Profitability seller_daily_earnings + campaign_daily_entries + mediabuyer_payments + ads_history + courier_fees; Ads campaign_daily_entries + ads_history; Inventory transactions + products + accessories; Couriers courier_payment_notes; MB sellers/products/accessories. All die naturally when D3 RPC-ifies the sections.
7. **InventorySection parent-order predicate gap** (date_deleted / source_review_status not applied to sold units) — decide replicate vs fix at design time; document either way.
8. Helper semantics beyond §0.2 confirmed from `src/lib/analyticsDefinitions.ts`: `isRevenueOrder` = delivered∧paid flags; `isProvisional` = delivered∧unpaid; `isReturned` = pkg ∈ is_returned set; `returnTimestamp` = updated_at; `inWindow` = inclusive isWithinInterval; `overlapFraction` = inclusive-day fraction (differenceInCalendarDays+1); `adSpendInWindow` = amount × fraction (end_date null → start_date); `payoutMonthOverlap` = calendar-month overlap fraction from 'YYYY-MM[-DD]'; `deliveredRevenueForOrder` ≡ pureRevenueForOrder (alias, stale comment); `cogsForOrder` = snapshot-preferred product+accessory; `shippingCostForDelivered` = raw shipping_cost; `returnFeeForOrder` = courier-first city-keyed fee lookup; `normalizeSource` = PLATFORM_SOURCE_MAP lookup → canonical-value passthrough → lowercase passthrough ('' for null); `LOW_STOCK_THRESHOLD` = 10 (strict <).

Files: src/components/analytics/{ProfitabilitySection,InventorySection,AdsSection,SellersSection,CouriersSection,MediaBuyersSection}.tsx · src/pages/admin/Analytics.tsx · src/lib/analyticsDefinitions.ts · src/hooks/useTrackedOrders.ts · src/lib/supabase.ts (fetchAllRows) · supabase/migrations/20260714210000_d4_money_aggregates.sql · docs/d2-recon/{01-admin-dashboard.md,05-design.md} · supabase/migrations/20260714230000_d2_dashboard_stats.sql.