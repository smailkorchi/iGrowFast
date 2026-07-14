# D2 RECON — SELLER SURFACES (inline recon; Dashboard verified at line level, Statistics/Profile deltas to be re-verified in-file by the implementer)

Pages: `src/pages/seller/Dashboard.tsx` (734 L), `Statistics.tsx` (681 L), `Profile.tsx` (1168 L). All three share ONE fetch skeleton and the SAME shared helpers as admin (`analyticsDefinitions.ts`, `commercialCommission.ts`, `useStatusCategories` flag sets — see d2-recon/01 §0.1-0.2).

## Shared fetch skeleton (per page, every mount)
1. `users` self row → commission_price, commission_basis (`normalizeCommissionBasis`: 'per_unit' iff exact string else 'per_order'), attributed `products` array, `"DigiCom Business"`.
2. **Own-orders full scan**: `fetchAllRows('orders', 'id, price, created_at, updated_at, date_livraison, name, order_status_id, package_status_id, replace, order_statuses(code), package_statuses(label), order_items(product_id, quantity, products(name, image_url))', seller_id=uid + date_deleted null [+ biz eq])` — all-time, no window. NOTE: does NOT exclude `source_review_status='pending'` (unlike admin pools — parity point to verify per page).
3. **TWO business-wide parcel dumps** (`company_parcels` + `courier_parcels`, `order_id, tracking_code`, biz eq) → `trackedSet` = order_ids with non-empty trimmed tracking_code. This is the biggest waste: whole-business parcels fetched to test the seller's own orders' membership.
4. `seller_payments` (seller_id=uid) → `alreadyPaidAmount = Σ paid_amount` over ALL rows (pending+partial+paid; bare select — sub-1000 today; trigger keeps paid_amount in lockstep).
5. Statistics adds: `fetchAllRows('seller_daily_earnings','*', seller-scoped)` (payout money source of truth) + `seller_presences` + more `seller_payments` detail. Profile adds: reverse scan `fetchAllRows('order_items','order_id, product_id, orders!inner(id, seller_id, order_status_id, package_status_id, order_statuses(code), package_statuses(label))', …)` for attributed-product performance + `products` fetch.

## Dashboard stat math (Dashboard.tsx:150-320, line-verified)
- Pool: own orders, `replace !== true` filtered out FIRST (exchange legs never count).
- `isDelivered` = `isDeliveredForCommission` = pkg ∈ deliveredPkgIds (flag `is_delivered`).
- `isPending(o)` = NOT tracked AND order_status ∈ pendingIds (tracking overrides status).
- `todayOrders` = created_at >= local startOfDay; `deliveredToday` via `isDeliveredOnLocalDay` (browser-local day on date_livraison??updated_at anchor — implementer verify helper body).
- Delivery rate (Coliaty): delivered ÷ (tracked − adminPullback), pullback = tracked AND (order_status ∈ adminPullbackOrderIds OR pkg ∈ adminPullbackPackageIds).
- Confirmation rate: `isRateConfirmed` numerator (tracked OR non-pending) ÷ ALL own orders.
- Money: `computeUnpaidCommission({basis, commissionPrice, orders, isDelivered, sellerProductIds, paidAmount})` → liveCommission (unpaid) + unpaidAccrued. per_unit: Σ assigned-product units × rate (empty products ⇒ 0); per_order: flat rate per delivered. MINUS alreadyPaidAmount. **RULE: display money must reconcile with seller_daily_earnings / payout ledger — never a new client formula.**
- recentOrders top-10 by created_at desc (id-ordered fetch re-sorted client-side); per-product table (first order_item only!): total/tracked/pullback/delivered/revenue (revenue = Σ price of delivered… implementer verify exact line).

## Statistics deltas (to verify in-file)
Same skeleton + windowed KPI variants; earnings history from seller_daily_earnings rows; payments table from seller_payments; presence stats from seller_presences. Its date window applies CLIENT-side over the all-time fetch (like admin dashboard).

## Profile deltas (to verify in-file)
4 full scans on mount (sweep P1): own orders + 2 parcel dumps + order_items reverse scan. Renders attributed-product performance cards + profile stat strip. Re-runs when statusCats maps change.

## D2 implications
- ONE `seller_dashboard_stats(p_business, p_seller, p_from, p_to)` jsonb RPC can feed all three pages' stat blocks (window null = all-time). p_seller MUST be validated = auth.uid() (or business admin) — same D1 42501 guard; orders RLS is business-wide.
- trackedSet membership moves into SQL (EXISTS on parcels by order_id — kills the 2 business-wide dumps per page per mount).
- Commission money: reuse seller_daily_earnings + seller_payments in SQL (`unpaid = accrued − Σ paid_amount`) replicating computeUnpaidCommission semantics exactly; per_unit basis needs the DB `sum_order_units_for_seller_products` equivalent (fn exists — see d2-recon/04).
- recentOrders + per-product table: small jsonb arrays in the same RPC (top-10 + per-product aggregates).
- Statistics earnings-history + payments lists stay as (windowed) direct fetches — they are real row lists, not stats.
- source_review_status: seller pools do NOT exclude 'pending' today — replicate per page (do NOT copy the admin predicate blindly).
