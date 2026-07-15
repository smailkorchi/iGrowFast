# D5 RECON — collaborator leaderboards (admin Sellers + MediaBuyers)

READ-ONLY. graphify query run first. All DB facts live-verified on the box via `~/.igrowfast/db.sh` (SELECT/catalog only). Shared helper semantics (`pureRevenueForOrder`, Coliaty delivery rate, `isRateConfirmed`, tracked set, `commissionAccruedForDeliveredOrder`, `computeUnpaidCommission`, `normalizeCommissionBasis`) are **referenced** from `docs/d2-recon/01-admin-dashboard.md` §0.2 — only DEVIATIONS are spelled out below.

Files:
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/collaborators/Sellers.tsx` (1133 L)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/collaborators/MediaBuyers.tsx` (894 L)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useMediaBuyerEarnings.ts` (342 L)
- Precedents: `src/pages/admin/collaborators/Couriers.tsx` (1069 L, already on `courier_roster_stats`)

---

## 0. Live-verified facts (the load-bearing ones)

| Fact | Verification |
|---|---|
| `mb_month_earned(p_mb uuid, p_business_id uuid, p_month date)` **EXISTS live** | `pg_proc`: `SECURITY DEFINER`, `STABLE`, `search_path='public'` (**not `''`**), returns `TABLE(earned numeric, delivered integer, spend numeric, campaigns integer)` |
| `mb_month_earned` is **NOT callable by the frontend** | `proacl = {postgres=X, service_role=X}` — **no `authenticated`**. Revoked by `supabase/migrations/20260629160000_revoke_cron_only_money_fn_grants.sql` because it has *no guard at all* → "anon cross-tenant financial read". |
| `mb_month_earned` **is the payout authority** | Only callers: `close_mediabuyer_month`, `refresh_open_mediabuyer_ticket` (both SECDEF/cron). ⇒ `useMediaBuyerEarnings` is a **second, drifting implementation of payroll**. |
| `payout_month` is TEXT storing **`'YYYY-MM-01'`** | `select distinct length(payout_month)` → `10` on BOTH `seller_payments` and `mediabuyer_payments`. `where payout_month='2026-07'` → **0 rows**; `='2026-07-01'` → 1 row. |
| `current_user_is_business_admin()` = `role IN ('super admin','admin')` | SECDEF, `search_path='public'`, granted to anon+authenticated. **Exactly matches** the route guard → the D5 admin gate regresses no legitimate caller. |
| `courier_roster_stats(p_business)` = LIFETIME per-courier, `TABLE(...)` return, SECURITY **INVOKER**, `search_path=''`, **NO admin gate** | `pg_get_functiondef` |
| Data scale | orders (live, not deleted): 2104 total / **1792 in the main business** (>1000 cap). campaigns=3, campaign_daily_entries=126, seller_daily_earnings=135, seller_presences=160. Roster: **5 commercial, 3 mediabuyer**. |
| `replace` vs `swap_only` | `replace is true`=9, `swap_only`=9, `replace AND NOT swap_only`=**0** ⇒ the client (`replace!==true`) and `mb_month_earned` (`swap_only=false`) predicates **coincide on today's data**; the divergence is **latent, not materialized**. |

---

## 1. Shell contract (Sellers.tsx is the TEMPLATE — per project rule)

All three collaborator pages (`Sellers`, `MediaBuyers`, `Couriers`) render the **same shell**. D5 must preserve it verbatim; only the data seam changes.

**Structural contract (identical component names + literal class strings across pages):**
1. `KPI_ACCENTS` token map `{ink, orange, green, rose}` → `{dot, tile}`.
2. `<SellerKpi|MbKpi>` — KPI-strip tile: `label / value / suffix / accent / icon`.
3. `MiniTile` — `label / value / sub? / tone?`.
4. `InfoRow` — `icon / label / value / mono?` (Sellers declares it at module tail L1116; MediaBuyers at L110).
5. A **tier function** returning `{stripe, text, bg, border, dot, label}`:
   - Sellers `deliveryTier(rate)`: ≥70 green "Strong" · ≥40 orange "Steady" · else rose "At risk".
   - MediaBuyers `paymentTier(total, remaining)`: `remaining<=0` green "Settled" · `paid>0` blue "Partial" · else orange "Pays due".
6. **Header** (eyebrow `Collaborators · X` + `font-display` h1 + serif-italic dek + right-side pill).
7. **KPI strip** — `grid gap-px bg-ant-line rounded-2xl border` (Sellers md:grid-cols-4, MB md:grid-cols-5).
8. **Podium section "01"** — top-3 by the PRIMARY metric, `md:grid-cols-4` with rank-1 spanning 2 cols; `PodiumCard rank={1|2|3}` with `rankMeta` (Crown/Medal, "Top seller|buyer · 01" / "Runner up · 02" / "Third place · 03").
9. **Roster section "02"** — search `Input` (rounded-full, h-10, w-[340px]) + 4-button segmented sort pill; `grid sm:grid-cols-2 lg:grid-cols-3 gap-3` of `RosterCard rank={n}`; loading = 6 `animate-pulse` skeletons (`h-52` Sellers / `h-60` MB); empty state = dashed border + icon + two copy variants (search-miss vs no-rows).
10. **Detail modal** — fixed overlay, `max-w-4xl max-h-[92vh]`, sticky header w/ `UserAvatar`+contact, sections in order: **contract config → performance → ink financial panel → 2-col (activity/account + products/campaigns) → payout history table → personal & banking**. Rendered inside `<AnimatePresence>` and conditionally mounted (`{selected && …}`) ⇒ **not** the kept-mounted trap.
11. **Rank map** = full-roster sort by primary metric → `Map<id, index+1>`; `podium` = same sort filtered to `primary > 0`, sliced 3.
12. **Cards are declared INSIDE the page component** (closures over `setSelected*`) ⇒ redefined every render; D5 must not regress this into remounts when the data seam changes.

**Primary metric per page:** Sellers = `deliveredOrders` (LIFETIME). MediaBuyers = `delivered_orders` (**CURRENT MONTH**). Couriers = `delivered` (LIFETIME).

**Data-seam contract (what D5 changes):** `Couriers.tsx` is the already-migrated reference — `useQuery` → `.rpc('courier_roster_stats', { p_business })` → `rosterStats` array joined to the roster rows client-side by id. Sellers/MediaBuyers must adopt the same shape.

---

## 2. `src/pages/admin/collaborators/Sellers.tsx`

### 2a. Exact queries (all inside one `fetchSellers()` on `useEffect`)

| # | L | Table | Select | Filters | Mode | Cap risk |
|---|---|---|---|---|---|---|
| 1 | 186-191 | `users` | `id, name, email, avatar_url, avatar_config, products, commission_price, commission_basis, created_at, bank_account_holder, bank_name, bank_rib, cin_number, address, phone` | `role='commercial'`, `"DigiCom Business"=activeBusinessId`, order `created_at` asc | bare | none (5 rows) |
| 2 | 205-215 | **`orders`** | `id, seller_id, order_status_id, package_status_id, price, created_at, date_livraison, master_city_id, replace, status:order_statuses(code,label), city:master_cities(name), package_statuses(label), order_items(product_id, quantity)` | `seller_id in sellerIds`, `date_deleted is null`, `source_review_status neq 'pending'` | **fetchAllRows** | **UNBOUNDED LIFETIME + `order_items` embed. ~1792 rows/biz.** |
| 3 | 221-223 | `seller_daily_earnings` | **`'*'`** | `"DigiCom Business"=biz` | fetchAllRows | unbounded (135 rows) |
| 4 | 225-227 | `seller_presences` | **`'*'`** | `"DigiCom Business"=biz` | fetchAllRows | unbounded (160 rows) |
| 5 | 229-233 | `seller_payments` | **`'*'`** | `"DigiCom Business"=biz`, order `payout_month` desc | **BARE** | **1000-cap → wrong money** on `totalPaid`/`totalUnpaid`/`liveCommission` (feeds `alreadyPaidAmount`) |
| 6 | 243-247 | `products` | `id, name, image_url` | `active=true`, `id in allProductIds` | bare | bounded by roster `users.products`; IN-list risk only |

**Plus, transitively via hooks mounted by the page:**
- `useTrackedOrders(activeBusinessId)` → **2 more unbounded `fetchAllRows` dumps**: `company_parcels(order_id, tracking_code)` and `courier_parcels(order_id, tracking_code)`, each `staleTime: 0, refetchOnMount:'always'`.
- `useStatusCategories()` → `order_statuses` + `package_statuses` full selects, `staleTime: 5min` (cheap, cached).

⇒ **One mount = 5 unbounded lifetime downloads** (orders+items, sde, presences, company_parcels, courier_parcels) + 2 bare selects.

### 2b. Exact client math (enrichment loop L256-414)

**Partitioning per seller** (L257-260): `orders.filter(seller_id===id)`, `earnings.filter(...)`, `presences.filter(...)`, `payments.filter(...)` — **O(sellers × rows) client scans**.

**Pre-filter (L219):** `ordersRaw.filter(o => o.replace !== true)` — exchange swap/return legs excluded.

**Status bucket chain (L271-290) — ORDER IS LOAD-BEARING, first match wins:**
```
1 isDeliveredForCommission(o, deliveredPkgIds)          → delivered   // pkg.is_delivered
2 isOrderCategory(sid,'processed')                      → shipped     // os.is_confirmed AND NOT deducts_stock AND NOT is_paid AND NOT is_unpaid
3 confirmedIds.has(sid)                                 → confirmed   // os.is_confirmed
4 isOrderCategory(sid,'cancelled')                      → cancelled   // os.is_cancelled AND NOT is_fake AND NOT is_double AND NOT is_blacklisted
5 isOrderInCategories(sid,['fake','double'])            → fake        // os.is_fake OR os.is_double
6 pendingIds.has(sid) → pending ; else → pending                      // NULL/unknown status_id collapses to pending
```
(Flag predicates from `src/hooks/useStatusCategories.ts` `ORDER_CAT_PRED`/`PKG_CAT_PRED`.)

**Money + rate formulas:**
```
statusMapsReady   = pendingIds.size > 0                                    // §0.2 isRateConfirmed empty-set guard
rateConfirmedCount= |{ o : trackedOrderIds.has(o.id)
                        OR (statusMapsReady AND o.order_status_id AND !pendingIds.has(o.order_status_id)) }|
confirmRate       = total>0 ? rateConfirmedCount/total*100 : 0             // UNCLAMPED
sellerTracked     = own orders with trackedOrderIds.has(id)                // §0.2 tracked set
sellerPullback    = sellerTracked ∩ isAdminPullback(o,true,pbOrderIds,pbPkgIds)
deliveryDenom     = |sellerTracked| − |sellerPullback|                     // §0.2 Coliaty
deliveryRate      = denom>0 ? delivered/denom*100 : 0                      // UNCLAMPED; numerator = ALL own delivered (NOT tracked-gated) — same deviation D3 documents in its sellers section
cancellationRate  = total>0 ? (cancelled+fake)/total*100 : 0
alreadyPaidAmount = Σ seller_payments.paid_amount            (ALL rows, lifetime)   [L318-319]
liveCommission    = computeUnpaidCommission({basis, commissionPrice, orders: sellerOrders,
                        isDelivered, sellerProductIds, paidAmount: alreadyPaidAmount}).unpaidCommission
                  = max(0, accruedTotal × price − alreadyPaidAmount)
                    where accruedTotal = per_order ? |delivered|
                                                   : Σ sumAssignedProductUnits(o, sellerProductIds)
                    and sumAssignedProductUnits returns 0 when sellerProductIds is EMPTY  [§0.2]
totalRevenue      = Σ Number(o.price) over delivered                       [L333-335]
totalCommissionEarned = Σ sde.commission_earned            (lifetime)      [L337]
totalEarnings     = Σ sde.total_earned                     (lifetime)      [L338]
totalPaid         = Σ seller_payments.paid_amount          (lifetime, all rows)     [L344-347]
totalUnpaid       = Σ max(0, total_amount − paid_amount) WHERE period_state='open'  [L348-353]
daysPresent       = |sellerPresences|
avgDailyDelivered = daysPresent>0 ? delivered/daysPresent : 0
lastActive        = max(presences.date)  (sort desc, take [0])
topCity           = argmax over delivered orders of (o.city.name || 'Unknown')
monthlyPayments[] = per-seller rows {month: payout_month, total_amount, paid_amount, delivered_orders, status, period_state||'closed'}
```
**Globals (L418-426):** `totalSellers=|roster|`, `totalDelivered=Σ`, `totalRevenue=Σ`, `totalPaid=Σ`, `avgDeliveryRate = Σdelivered / ΣdeliveryDenom × 100`.

**DEVIATIONS from §0.2 / from the D3 sellers section — MUST be replicated, not "corrected" silently:**
- **D5-DEV-S1 `totalRevenue` is NOT `pureRevenueForOrder`.** It is raw `Σ price` over delivered, **not paid-gated**. D3's `sellers.revenue` = FULL pureRevenue chain over **paid+delivered**. **Different numbers. Not interchangeable.**
- **D5-DEV-S2 `liveCommission` re-derives commission from `orders`**, contradicting the standing rule "seller_daily_earnings is the money source; never sum orders client-side". The page renders BOTH: "Unpaid commission" (order-derived) next to "Commission earned" (sde-derived) — a live drift surface.
- **D5-DEV-S3 `deliveryRate` numerator is un-gated** by tracking (all own delivered ÷ tracked−pullback) → can exceed 100%; **unclamped**.
- **D5-DEV-S4 `totalSellers` has no `active` filter** yet the header pill renders `{totalSellers} active` (L969-970). D3 returns `total_sellers` AND `active_sellers`.
- **D5-DEV-S5 `pending` absorbs unknown/NULL `order_status_id`** (branch 6 double-`pending`).
- **D5-DEV-S6 no timezone anywhere** — all Sellers math is count/sum-based (no day bucketing) except `lastActive`/`isOnline` (`new Date(x).toDateString() === new Date().toDateString()` → **browser-local**, L473/552/635).

### 2c. Rendered output
- **KPI strip (L975-980):** Total sellers · Total delivered · Total revenue (`Math.round().toLocaleString()` MAD) · Avg delivery rate (1dp %).
- **Podium card:** avatar+online dot, name, email, 3-col {Delivered, Delivery %, Revenue MAD}, footer {Unpaid commission = `liveCommission`, "View ↗"}.
- **Roster card:** avatar+online dot, name, `#rank`, email, delivery progress bar `min(100, deliveryRate)`, 3-col {Orders, Delivered, Comm. = `commission_price`/`u|o`}, footer {tier pill, Unpaid = `liveCommission`}.
- **Detail modal:** contract config (Commission `DH/unit|DH/order`, Products count, Days since join — **grid declares 4 cols but only 3 tiles render**, L702-706) → order performance (stacked distribution bar over 6 buckets with hardcoded hexes `#2D7A3E/#8B4A9B/#D97706/#8B8680/#B54040/#A8A29E`, + 4 MiniTiles: Confirm rate, Delivery rate, Loss rate, Avg per day) → **ink financial panel** (Revenue generated / Unpaid commission / Total earnings; footer 3: Commission earned, Total paid, Unpaid draft) → Activity (Days present, Last active, Top city) + Attributed products (image+name list) → Payout history table (Month, Delivered, Total, Paid w/ partial progress bar when `period_state==='open' && status==='partial'`, Status pill) → Personal & banking (CIN, Address, Bank, RIB mono, Phone).
- `confirmedOrders` rendered in the distribution = **`rateConfirmedCount`**, NOT the `confirmed` bucket (L391 comment: "one-true-definition"). ⇒ the distribution bar **double-counts**: delivered/shipped/cancelled orders are also inside `rateConfirmedCount`. Replicate.

### 2d. Refetch / deps
```
L179-181: useEffect(() => { fetchSellers(); }, [confirmedIds, cancelledIds, deliveredPkgIds,
          pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds,
          isOrderCategory, isOrderInCategories])   // 9 deps
```
- All 6 status Sets + both fns come from **one `useMemo` object** in `useStatusCategories` (returns a fresh object whenever `orderStatuses`/`packageStatuses` change identity) ⇒ **all 8 flip identity together**.
- `trackedOrderIds` is `useMemo([companyParcels, courierParcels])` inside `useTrackedOrders`, whose queries are `staleTime: 0, refetchOnMount: 'always'` (+ default `refetchOnWindowFocus`) ⇒ **every mount and every window focus produces new parcel arrays → new Set identity → the effect re-runs → the full 5-download storm repeats.**
- No react-query cache, no `enabled` guard, no abort. Component-state only (`useState` + manual `setLoading`). `activeBusinessId` read from `localStorage` at render (not a dep) — business switch relies on remount.
- **No refetch on order mutation** — the leaderboard is stale until remount/focus.

### 2e. Role visibility
`src/App.tsx` L283-343: the entire admin block is wrapped in `<ProtectedRoute allowedRoles={['super admin','admin']}>` → `<BusinessGuard>` → `<AppLayout>`. Routes: `/collaborators/sellers` (L331) and back-compat `/sellers` (L335). **Admin-only. `current_user_is_business_admin()` is an exact match → the D5 gate is free.** (Per memory: `'admin'` is a real page-permission-gated role — do not strip it from the pair.)

---

## 3. `src/pages/admin/collaborators/MediaBuyers.tsx` + `src/hooks/useMediaBuyerEarnings.ts`

### 3a. Exact queries

**Page-level (`MediaBuyers.tsx`):**

| # | L | Table | Select | Filters | Mode | Cap risk |
|---|---|---|---|---|---|---|
| A | 161-174 | `mediabuyer_payments` | `id, mediabuyer_id, payout_month, total_amount, paid_amount, delivered_orders, status, paid_at, created_at` | `"DigiCom Business"=biz`, order `payout_month` desc | **BARE** | 1000-cap (lifetime, all MBs) |
| B | 176-188 | `campaigns` | `id, created_by, name, platform, status` | `"DigiCom Business"=biz` | **BARE** | 1000-cap (live: 3 rows) |

**Hook (`useMediaBuyerEarnings(month, {selfMbId?})`)** — 4 `useQuery`, a **3-deep waterfall** (`users → mbIds → entries → sourceList → orders`), + `priorPayments` in parallel:

| # | L | Table | Select | Filters | Mode | Cap risk |
|---|---|---|---|---|---|---|
| 1 | 144-159 | `users` | `id, name, email, avatar_url, avatar_config, phone, role, payment_type, commission_price, salary_amount, bank_name, bank_account_holder, bank_rib, cin_number, address, created_at, active` | `"DigiCom Business"=biz`, `role='mediabuyer'`, `+ id=selfMbId` when set | bare | none |
| 2 | 163-178 | `campaign_daily_entries` | `id, campaign_id, created_by, entry_date, platform, spend, leads` | `"DigiCom Business"=biz`, `created_by in mbIds`, `entry_date gte from`, `lte to` | **BARE** | 1000-cap (month-scoped; live 126 total) |
| 3 | 195-218 | **`orders`** | `id, date, source_name, package_status_id, replace` | `"DigiCom Business"=biz`, `date gte shiftYmd(from,-1)`, `date lte shiftYmd(to,1)+'T23:59:59.999Z'`, `date_deleted is null`, `source_review_status neq 'pending'` | **fetchAllRows** | month-scoped ±1d; then **client-filtered** by `replace!==true && srcLower.has(lower(source_name))` |
| 4 | 221-234 | `mediabuyer_payments` | `id, mediabuyer_id, payout_month, total_amount, paid_amount, status, paid_at` | `"DigiCom Business"=biz`, **`payout_month = month`** (`'yyyy-MM'`) | bare | **DEAD PREDICATE — always 0 rows (proven)** |

`useStatusCategories()` mounted for `deliveredPkgIds` (used only in the compute memo, **not** a query key).

### 3b. Exact client math (hook L237-336)

```
month     = format(new Date(),'yyyy-MM')                       [MediaBuyers.tsx L155, useMemo([]) — stable]
{from,to} = monthBounds(month) = {`${month}-01`, `${month}-${lastDay}`}
distinctSources = { getPlatformSource(e.platform) : e ∈ entries, ≠ '' }    // STRICT 12-entry map, unmapped ⇒ '' ⇒ DROPPED

// order bucketing (L239-248)
deliveredBy[`${toBusinessDate(o.date)}|${lower(o.source_name)}`] += 1
   for o with date && source_name && package_status_id && deliveredPkgIds.has(package_status_id)
   // toBusinessDate = Intl 'en-CA' @ Africa/Casablanca  (src/lib/dateBuckets.ts)

// per-MB (L267-334)
totalSpend    = Σ Number(e.spend)                       over mbEntries
daySourceSet  = { `${e.entry_date}|${getPlatformSource(e.platform)}` : src ≠ '' }
campaignSet   = { e.campaign_id || `__orphan__${e.platform}` }   → campaigns_count = |campaignSet|
delivered     = Σ_{k ∈ daySourceSet} deliveredBy[k] || 0        // computed for salary MBs TOO
salary_earned      = payment_type==='salary'     ? salary_amount : 0
commission_earned  = payment_type==='commission' ? delivered × commission_price : 0
total_amount       = salary_earned + commission_earned
prior_paid_amount  = Σ mbPayments.TOTAL_AMOUNT                  // ← reduces total_amount, NOT paid_amount  [L296]
remaining_amount   = max(0, total_amount − prior_paid_amount)
existing_payout    = mbPayments[0] || null                      // arbitrary when >1 row/month
```
**Page-level derived:**
```
ownedCampaignCount[created_by] = |campaigns|                     // from query B, NOT the hook's campaigns_count (L226-236 comment)
totals = Σ over earnings {total_spend, delivered_orders, total_amount, remaining_amount, active:+1}
paid   = max(0, total_amount − remaining_amount)                 // RosterCard L341
pct    = total_amount>0 ? min(100, paid/total_amount×100) : (remaining<=0 ? 100 : 0)
cpd    = delivered>0 ? total_spend/delivered : 0                 // modal, "Cost / deliv"
totalPaid(modal) = max(0, total_amount − remaining_amount)       // L439
lastPaid = payouts.find(p => p.paid_at)?.paid_at                 // first in payout_month-desc order
```

**DEVIATIONS — hook vs the live payout authority `mb_month_earned` (both windows = the same month):**

| # | Hook | `mb_month_earned` (LIVE) | Materialized? |
|---|---|---|---|
| **D5-DEV-M1** | `delivered` computed **unconditionally**, incl. salaried MBs → **drives podium + rank + sort** | `if v_pt='salary' → return delivered = 0` | **YES if any salaried MB has attributed deliveries. A faithful reuse of `mb_month_earned` would ZERO them off the podium.** |
| **D5-DEV-M2** | exchange filter `o.replace !== true` | `coalesce(o.swap_only,false)=false` | latent (0 rows differ today) |
| **D5-DEV-M3** | `Σ_{buckets} count` via `daySourceSet` | `count(distinct o.id)` over the join | equivalent (Set dedupe ≡ distinct) |
| **D5-DEV-M4** | Casablanca day via `Intl` after a ±1-day server widening | `(o.date at time zone 'Africa/Casablanca')::date` | equivalent ✓ |
| **D5-DEV-M5** | delivered via `deliveredPkgIds` (client flag Set) | `join package_statuses ps … ps.is_delivered` | equivalent ✓ |
| **D5-DEV-M6** | platform map = `getPlatformSource` (STRICT: unmapped → `''` → dropped) | identical inline 12-entry CASE → `''` | equivalent ✓ — and **deliberately different from `normalize_ad_source`** (D3), which lowercase-passes-through unmapped. **`mb_month_earned`'s map, NOT `normalize_ad_source`, is the byte-exact match.** |
| **D5-DEV-M7** | **no 1/N split** when N MBs claim the same (day, source) | **no 1/N split** | ✓ agree — and both **deliberately differ from D3's `mediabuyers` section**, which DOES split 1/N. Structurally moot: `campaign_source_locks` = one ad source ↔ one MB per business. |
| **D5-DEV-M8** | `campaigns_count` = `|{campaign_id ?? '__orphan__'+platform}|` | `count(distinct coalesce(campaign_id::text,'__orphan__'||platform))` | equivalent ✓ (and overridden by `ownedCampaignCount` on the page anyway) |
| **D5-DEV-M9** | `prior_paid_amount` / `remaining_amount` / `existing_payout` | **not modeled at all** (the fn returns accrual only) | hook-only surface |

### 3c. Rendered output
- **Header pill:** `MMM dd – MMM dd` of the current month + "scope".
- **KPI strip (5):** Media buyers (`earnings.length`) · Spend · month · Delivered · month · Payroll · month · **Unpaid** (`Σ remaining_amount`).
- **Podium card:** avatar, name, email, payment pill (Commission/Salary/N/A), 3-col {Delivered, Spend, Payroll}, footer {Unpaid, "View ↗"}.
- **Roster card:** avatar, name, `#rank`, email; payment pill + inline rate (`X MAD/deliv` | `X MAD/mo`) + `# campaigns` (from `ownedCampaignCount`); **"Paid %" progress bar**; 4-col {Spend, Deliv, Payroll, Unpaid}; footer {tier pill, Remaining}.
- **Detail modal:** contract config (Payment=`rateLabel`, Campaigns created, Delivered, Days since join) → Performance · month (Spend, Delivered, Payroll, Cost/deliv) → **ink panel** (Spend / Payroll / Unpaid; footer: Commission rate, Total paid, Remaining) → Account (Payment type, Member since, Last paid, Campaigns) + Campaigns list (platform icon, name, status pill) → Payout history table (handles `payout_month.length===7 ? +'-01' : as-is` → works with the real `'YYYY-MM-01'`) → Personal & banking.

### 3d. Refetch / deps
- No `useEffect` fetch — all react-query. Query keys: `['mb-earnings-users', biz, selfMbId??'all']`, `['mb-earnings-entries', biz, month, mbIds.sort().join(',')]`, `['mb-earnings-orders', biz, month, sourceList.join(',')]`, `['mb-earnings-prior', biz, month]`, `['mb-all-payouts', biz]`, `['mb-all-campaigns', biz]`.
- **No `staleTime`** on any of them ⇒ default 0 ⇒ **refetch on every mount + window focus**; the 3-deep waterfall re-runs serially each time.
- `mbIds.sort()` **mutates the memoized array in place** (L164) — benign here, latent.
- `deliveredPkgIds` is a compute-memo dep only → recompute, no refetch. `currentMonth` = `useMemo([])` → stable (**does not roll over at midnight**; needs remount).
- Shared cache with `Salaries.tsx` (`useMediaBuyerEarnings(monthKey)`) and `mediabuyer/Payments.tsx` (`{selfMbId}`) — **different keys** (`selfMbId ?? 'all'`), so the admin page and the MB page do not share the users query.

### 3e. Role visibility
`/collaborators/mediabuyers` (App.tsx L333) — inside the same `allowedRoles={['super admin','admin']}` block. **Admin-only.**
⚠ The hook itself is **role-agnostic** and is also mounted by `src/pages/mediabuyer/Payments.tsx` with `{selfMbId: currentUserId}` (which is why the `selfMbId` PII-narrowing exists) and by `src/pages/admin/Salaries.tsx` (admin). **Any D5 RPC replacing this hook must therefore be split into an admin-gated roster fn and keep the MB-self path on the already-gated `mb_dashboard_stats` (D2) — a single gated fn cannot serve both callers.**

---

## 4. CRITICAL REUSE ANALYSIS (verdict per existing RPC)

### 4.1 `courier_roster_stats(p_business)` — **NOT reusable. Precedent only.**
Different collaborator class (couriers). It is the **shape template**: lifetime, per-collaborator, `p_business`-only, INVOKER, `search_path=''`, joined client-side to the roster by id (`Couriers.tsx` L212-222).
⚠ **Follow-up finding (outside the D5 MAP, same class):** it returns business-wide per-collaborator money (`fees_sum`, `notes_paid_sum`, `notes_unpaid_sum`) with **NO admin gate** and `p_business` free. Under the post-D3-review rule it needs the same `current_user_is_business_admin()` gate. Track it; do not silently widen D5's scope.

### 4.2 `seller_dashboard_stats(p_business, p_seller, p_from, p_to)` [D2, has `self_perf`] — **NOT reusable.**
- **Windowed**, **single-seller** → the leaderboard is **lifetime × whole roster**; reuse = 5 round trips today, N tomorrow.
- Carries a `p_seller` guard (`p_seller ≠ auth.uid()` AND not admin → 42501, mig L1119-1120), i.e. it is designed as a *self/one-seller* surface.
- Missing every leaderboard column: `liveCommission`, per-seller `totalPaid`/`totalUnpaid`, `monthlyPayments[]`, `daysPresent`/`lastActive`, `topCity`, the 6-bucket status split, `productNames`.
→ **NEW FUNCTION.**

### 4.3 `admin_analytics_stats(p_business, p_from, p_to)` [D3] — **NOT reusable as-is; do NOT extend.**
Its `sellers` section (mig L1391-1543) returns per-seller `{seller_id, orders, delivered, delivered_paid, tracked, pullback, revenue, presences, commission}` and its `mediabuyers` section (L1643-1832) returns `{mb_id, spend, orders, delivered, revenue, cogs, shipping, seller_commission, mb_cost, net_profit}`. Close-looking, **semantically different**:

| Leaderboard needs | D3 gives | Verdict |
|---|---|---|
| `totalRevenue` = Σ `price` over **delivered** | `revenue` = FULL pureRevenue chain over **paid+delivered** | ✗ different number (D5-DEV-S1) |
| lifetime | STRICT window (`p_from=p_to=null` ⇒ all-time **but still drops NULL `date`** and upper-bounds at `now()`) | ✗ |
| `liveCommission`, `totalPaid`/`totalUnpaid` **per seller** | commission (sde, windowed) only; `paid`/`pending` are **business totals**, not per-seller | ✗ |
| 6-bucket status split, `topCity`, `lastActive`, `monthlyPayments[]`, `productNames` | absent | ✗ |
| MB payroll = `delivered × rate` (no split) | `mb_cost` with **1/N attribution split** + salary pro-rated `× window_days/30` | ✗ (D5-DEV-M7) |
| MB source map = strict 12-entry (unmapped ⇒ drop) | `normalize_ad_source` (unmapped ⇒ passthrough) | ✗ (D5-DEV-M6) |

Extending `admin_analytics_stats` would force lifetime+windowed semantics into one payload and couple the Analytics page's parity contract to the leaderboards'. **Reject.** Reuse only its **patterns**: admin gate (L177-179), `tracked` CTE, `pullback_flag`, presences/payments CTEs, the grants footer.

### 4.4 `mb_month_earned(p_mb, p_business_id, p_month)` — **EXISTS, is the payout authority, and is NOT frontend-callable.**
This is the single most consequential finding.
- **The "server-side guard exists" premise is confirmed** — but it is **deliberately service_role/cron-only** (`proacl` has no `authenticated`; revoked 2026-06-29 because "no guard at all: anon cross-tenant financial read"). `p_business_id` is a free parameter on a SECDEF function.
- **`useMediaBuyerEarnings` is a second implementation of the payroll formula** that both the MediaBuyers leaderboard and the **Salaries bulk-payout generator** read. Any drift = a money-display/payout mismatch. Today the accrual halves agree except **D5-DEV-M1 (salary ⇒ delivered=0)** and the latent **D5-DEV-M2**.

**Reuse routes (pick one — this is the D5 design decision):**

| Route | Shape | Cost |
|---|---|---|
| **A (recommended)** — invert the ownership. Add `mb_month_earned_rows(p_business uuid, p_month date)` = **SECURITY INVOKER**, `search_path=''`, **admin gate**, returning the WHOLE roster (`mb_id, payment_type, earned, delivered, delivered_raw, spend, campaigns`). Rewrite `mb_month_earned(p_mb,p_business_id,p_month)` (SECDEF, cron) as a **thin wrapper** selecting one row from it. | ONE formula for ledger + leaderboard; no drift possible; the cron path keeps its RLS bypass (SECDEF calling INVOKER runs the inner as `postgres`). `delivered_raw` (un-zeroed) satisfies D5-DEV-M1 without touching `earned`. | Touches the payout authority ⇒ needs owner confirmation + a `close_mediabuyer_month`/`refresh_open_mediabuyer_ticket` parity check. |
| **B** — new `mediabuyer_roster_stats` as **SECURITY DEFINER** + admin gate + membership check, calling `mb_month_earned` in a `LATERAL`. | No change to the authority. | **Breaks the D5 SECURITY-INVOKER convention**; a SECURITY-INVOKER wrapper **cannot** do this (the caller lacks EXECUTE on `mb_month_earned` → permission denied). |
| **C** — inline the formula in a new INVOKER fn. | Convention-clean. | **Duplicates the existing aggregate** — explicitly forbidden by the D5 brief; guarantees future drift. **Reject.** |

**Note:** `mb_month_earned`'s body reads only `users`, `campaign_daily_entries`, `orders`, `package_statuses` — all readable by an admin under RLS today (the client already does exactly this). So SECURITY INVOKER is *sufficient* for the leaderboard; SECDEF is needed only for the cron path. Route A is the end-state that satisfies both.
Also: `mb_month_earned` currently has `search_path='public'` (not `''`) — Route A is the natural moment to bring it to convention.

### 4.5 `mb_entry_days(p_business, p_created_by)` — granted to `authenticated`, INVOKER, `search_path=''`, returns lifetime distinct `(entry_date, platform)` for one MB. Not needed by the leaderboard (entries are already aggregated into spend/campaign counts). No reuse.

---

## 5. Defect register (live-verified; each needs an explicit replicate-or-fix ruling)

| ID | Sev | Where | Defect | Evidence |
|---|---|---|---|---|
| **D5-BUG-1** | **P0** | `useMediaBuyerEarnings.ts` L229 | `.eq('payout_month', month)` with `month='yyyy-MM'`; stored rows are **`'yyyy-MM-01'`** ⇒ **matches 0 rows, always** ⇒ `prior_paid_amount ≡ 0`, `existing_payout ≡ null`, `remaining_amount ≡ total_amount`. **On MediaBuyers.tsx**: "Unpaid" KPI = full payroll; `paid` = 0 ⇒ progress bar **always 0%**; `paymentTier` **always "Pays due"**; `sortBy='unpaid'` ≡ `sortBy='payroll'`; modal "Total paid" always 0. **On `Salaries.tsx` L1151-1159**: the generated payout `total_amount = r.remaining_amount` = the FULL month, ignoring prior payments ⇒ **double-pay hazard**. **On `mediabuyer/Payments.tsx` L249**: the "déjà versés" banner never renders. | `select distinct length(payout_month) from mediabuyer_payments` → `10`; `where payout_month='2026-07'` → **0**; `='2026-07-01'` → **1**. **Already known**: D2 mig `20260714230000` header L51-54 documents it and **deliberately replicated it** in `mb_dashboard_stats.prior_paid` (mig L1810) — "latent client bug kept for parity; fix is a separate owner decision". D5 makes it a **third** surface + reaches the payout generator ⇒ **escalate the decision now.** |
| **D5-BUG-2** | **P1** | `useMediaBuyerEarnings.ts` L296 | `prior_paid_amount = Σ mbPayments.total_amount` — sums **`total_amount`, not `paid_amount`**. Even after BUG-1 is fixed, "already paid" would equal the ticket's *invoiced* amount, not disbursed cash ⇒ `remaining` collapses to ~0 on any open ticket and partials are invisible. Contrast `Sellers.tsx` L318-319/L344, which correctly uses `paid_amount`. | source + `mediabuyer_payments` has both columns (`total_amount`, `paid_amount`, `period_state`, `carried_in/out`). |
| **D5-BUG-3** | **P1** | `Sellers.tsx` L229-233 | `seller_payments` fetched with a **BARE** `.select('*')` ⇒ silent 1000-row cap ⇒ under-counts `alreadyPaidAmount` ⇒ **`liveCommission` over-states unpaid** (max(0, accrued − paid)); also caps `totalPaid`/`totalUnpaid`/`monthlyPayments`. Same wrong-money class as D4. | source; the sibling fetches on the same page were already converted to `fetchAllRows` for exactly this reason (L202-204 comment). |
| **D5-BUG-4** | P2 | `MediaBuyers.tsx` L161-188 | `mediabuyer_payments` + `campaigns` bare selects (1000-cap). Small today (1 / 3 rows) but unbounded. | source |
| **D5-BUG-5** | P2 | `useMediaBuyerEarnings.ts` L167-176 | `campaign_daily_entries` bare select (1000-cap). Month-scoped; 126 rows total today. | source |
| **D5-BUG-6** | P2 | `Sellers.tsx` L969 / L976 | Header + KPI render `{totalSellers} active` but no `active` filter is applied. | source (D5-DEV-S4) |
| **D5-BUG-7** | P3 | `Sellers.tsx` L702-706 | Contract-config grid declares `md:grid-cols-4`, renders 3 tiles. | source |
| **D5-BUG-8** | P3 | `useMediaBuyerEarnings.ts` L298 | `existing_payout = mbPayments[0]` — arbitrary when a month has both an `open` and a `closed` row (live: `seller_payments` 2026-06-01 has **closed×3 AND open×1**). Latent for MB once BUG-1 is fixed. | `select payout_month, period_state, count(*) …` |
| **D5-BUG-9** | P3 | `MediaBuyers.tsx` L155 | `currentMonth = useMemo(..., [])` — never rolls over at midnight/month boundary without a remount. | source |

---

## 6. Proposed D5 surface (both fns: SECURITY INVOKER · STABLE · `set search_path to ''` · jsonb · explicit `p_business` · **admin gate** · D4 grants footer)

Gate (verbatim, both fns):
```sql
if not (select public.current_user_is_business_admin()) then
    raise exception '<fn>: admin only' using errcode = '42501';
end if;
```
Grants footer (verbatim, both fns):
```sql
revoke all on function public.<fn>(<sig>) from public, anon;
grant execute on function public.<fn>(<sig>) to authenticated;
alter function public.<fn>(<sig>) owner to postgres;
```

### 6.1 `public.seller_roster_stats(p_business uuid) returns jsonb` — **NEW** (no windowing; lifetime)
```
{
  totals: { total_sellers, active_sellers, total_delivered, total_revenue,
            total_paid, delivery_denom_sum },      -- avg rate derived client-side: total_delivered/delivery_denom_sum*100
  sellers: [ {
    seller_id,
    orders, delivered, shipped, confirmed_bucket, cancelled, fake, pending,   -- 6-bucket chain, first-match order §2b
    rate_confirmed,                        -- the "confirmedOrders" the UI actually renders
    tracked, pullback,                     -- delivery_denom = tracked − pullback (client derives)
    revenue,                               -- Σ price over delivered   [D5-DEV-S1: NOT pureRevenue]
    live_commission,                       -- max(0, accrued_cash − paid_amount)  [§0.2 computeUnpaidCommission]
    accrued_total,                         -- per_order ⇒ count(delivered); per_unit ⇒ Σ assigned units (empty products ⇒ 0)
    commission_earned, total_earned,       -- Σ seller_daily_earnings (lifetime)
    total_paid, total_unpaid,              -- Σ paid_amount (all rows) ; Σ max(0,total−paid) where period_state='open'
    days_present, last_active, top_city,
    payouts: [ {month, total_amount, paid_amount, delivered_orders, status, period_state} ]  -- desc
  } ]  -- whole roster; client sorts/podiums/ranks
}
```
Pool (§0.3 + page): `"DigiCom Business"=p_business AND date_deleted is null AND source_review_status <> 'pending' AND replace is distinct from true AND seller_id in roster`. Tracked = D3's `tracked` CTE (company_parcels ∪ courier_parcels, non-blank `tracking_code`) — **this deletes `useTrackedOrders` from the page (2 unbounded dumps)**. Statuses via `left join order_statuses/package_statuses` flag columns (NULL/unmatched → `pending`). `rate_confirmed` needs the empty-set guard as `exists(select 1 from public.order_statuses where pending_confirmation)`. Rates stay **client-side and UNCLAMPED**.
Keep client-side: `productNames` (bounded `products` select), `isOnline`/`daysActive` (browser-local, presentational).
**Kills:** the 9-dep `useEffect`, 5 unbounded downloads + 2 bare selects, the O(sellers×rows) partition loops, D5-BUG-3.

### 6.2 MediaBuyers — **REUSE via Route A (§4.4), do not duplicate**
1. `public.mb_month_earned_rows(p_business uuid, p_month date) returns jsonb` — INVOKER + admin gate + `search_path=''`; the **relocated body** of `mb_month_earned`, roster-wide: `[{mb_id, payment_type, commission_price, salary_amount, earned, delivered, delivered_raw, spend, campaigns}]`. `delivered_raw` = un-zeroed for salaried MBs → satisfies **D5-DEV-M1** (podium/rank/sort) while `earned`/`delivered` keep the ledger's semantics.
2. `public.mb_month_earned(p_mb, p_business_id, p_month)` → thin SECDEF wrapper over (1), one row. Cron/ledger callers unchanged. Bring `search_path` to `''`.
3. `public.mediabuyer_roster_stats(p_business uuid, p_month date) returns jsonb` — INVOKER + admin gate; wraps (1) and adds the page's payout surface:
```
{ mediabuyers: [ { …mb_month_earned_rows fields…,
                   campaigns_owned,                       -- count(campaigns.created_by = mb)
                   prior_paid_amount, remaining_amount,   -- ← see Decision O-1 below
                   existing_payout: {id,status,total_amount,paid_amount,paid_at} | null,
                   payouts: [ {payout_month, total_amount, paid_amount, delivered_orders, status, paid_at} ] } ] }
```
**Kills:** queries A, B and the hook's 3-deep waterfall + 4 bare/paginated fetches; D5-BUG-4/5/8.
**Do NOT collapse the MB-self path into this fn** — `mediabuyer/Payments.tsx` uses the same hook with `{selfMbId}` and is NOT admin. Either keep that path on `mb_dashboard_stats` (D2, already `p_mb`-guarded) or give it its own self-scoped fn. §3e.

---

## 7. Decisions required before implementation (owner)

- **O-1 (blocking, money).** `payout_month` `'yyyy-MM'` vs stored `'yyyy-MM-01'` (**D5-BUG-1**) + `prior_paid` summing `total_amount` instead of `paid_amount` (**D5-BUG-2**). D2 chose **replicate-for-parity** and deferred the fix. D5 now puts the same broken numbers on an **admin leaderboard's "Unpaid" KPI/sort/tier** and behind the **Salaries payout generator**. Ruling needed: replicate (parity, keep the double-pay hazard) **or** fix (`payout_month = to_char(p_month,'YYYY-MM-01')` + `Σ paid_amount`) — and if fix, `mb_dashboard_stats.prior_paid` (D2 mig L1810) must move in the same commit or the MB dashboard and the admin leaderboard will disagree.
- **O-2 (blocking, architecture).** Route A vs B for `mb_month_earned` (§4.4). A touches the payout authority; B breaks the INVOKER convention; C is forbidden.
- **O-3.** **D5-DEV-M1** — do salaried MBs keep `delivered` on the podium (current UI) or go to 0 (ledger)? `delivered_raw` implements "keep"; confirm.
- **O-4.** **D5-DEV-S1/S2** — Sellers' `totalRevenue` (Σ `price` over delivered, not paid-gated, not pureRevenue) and `liveCommission` (order-derived, contradicting the sde-is-money-source rule) — replicate byte-exact (recommended for D5; parity-first) or converge with D3's definitions (visible number change on a leaderboard)?
- **O-5.** **D5-DEV-S4 / D5-BUG-6** — `total_sellers` vs `active_sellers` in the "active" pill.
- **O-6 (out of D5 scope, same class).** `courier_roster_stats` has no admin gate (§4.1). Track separately.
