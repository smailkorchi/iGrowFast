# D5 RECON — Collaborator Leaderboards (Couriers / Sellers / MediaBuyers)

> **HEADLINE CORRECTION — the sweep findings in the task brief are STALE for Couriers.tsx.**
> Every "known finding" for that page describes pre-D4 code. D4 (mig `20260714210000`) already landed the RPC **and wired the page**. The real D5 surface for Couriers is much smaller than briefed, and it is **not** what was listed. Details in §1.
>
> **SECOND CORRECTION — "the leaderboards are LIFETIME" is false for MediaBuyers.** That page is **month-scoped** (`currentMonth`), driven by a *shared* hook with 3 other consumers. See §3.

---

## §0. Scope, evidence base, verification

| Item | Value |
|---|---|
| Files mapped | `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/collaborators/Couriers.tsx` (1069 L), `.../Sellers.tsx` (1133 L), `.../MediaBuyers.tsx` (894 L) |
| Shared hook | `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useMediaBuyerEarnings.ts` |
| Migrations read | `supabase/migrations/20260714210000_d4_money_aggregates.sql`, `20260714230000_d2_dashboard_stats.sql`, `20260715010000_d3_analytics_stats.sql`, `20260715020000_d2_admin_dashboard_gate.sql` |
| DB verified live | box via `~/.igrowfast/db.sh` (read-only): `pg_proc`, `information_schema.columns`, `pg_indexes`, row counts |
| Shared helper semantics | Per instruction, taken as given from `docs/d2-recon/01-admin-dashboard.md §0.2`. **Deviations only** are called out (§2.3, §5.2). |

### 0.1 Live RPC inventory (verified on box, `prosecdef` = SECURITY DEFINER flag)

```
admin_analytics_stats      (p_business uuid, p_from date, p_to date)   secdef=f
admin_dashboard_stats      (p_business uuid, p_from date, p_to date)   secdef=f
courier_roster_stats       (p_business uuid)                           secdef=f
courier_self_stats         (p_courier uuid, p_business uuid)           secdef=f
mb_dashboard_stats         (p_business uuid, p_mb uuid, p_from, p_to)  secdef=f
mb_entry_days              (p_business uuid, p_created_by uuid)        secdef=f
mb_month_earned            (p_mb uuid, p_business_id uuid, p_month date) secdef=t
seller_dashboard_stats     (p_business uuid, p_seller uuid, p_from, p_to) secdef=f
current_user_is_business_admin()                                       secdef=t
```

`current_user_is_business_admin()` (live definition): `SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('super admin','admin'))` — SECURITY DEFINER, STABLE, `search_path='public'`. **Business-agnostic** — it does not check `p_business`; tenant scoping still relies on RLS + explicit `p_business`. Same primitive D3 uses.

### 0.2 Role visibility — all three pages (`src/App.tsx`)

All three routes sit inside **one** `<ProtectedRoute allowedRoles={['super admin', 'admin']}>` block (L283–343):

```
L331  /collaborators/sellers      → AdminSellers
L332  /collaborators/couriers     → AdminCouriers
L333  /collaborators/mediabuyers  → AdminMediaBuyers
L335  /sellers                    → AdminSellers      (back-compat alias)
```

**Consequence:** every figure on all three pages is admin-only *by route*. The D3-review rule therefore applies with full force — each of these RPCs returns business-wide money and per-collaborator performance, so **each needs the `42501` admin gate**. There is no legitimate non-admin caller to regress for the roster RPCs. The one exception is the MB hook, which has a genuine self-serve consumer (§3.4).

---

## §1. COURIERS — `src/pages/admin/collaborators/Couriers.tsx`

### 1.1 Sweep-finding verification (brief vs. CURRENT code)

| Briefed finding | Status | Reality |
|---|---|---|
| unbounded all-time `fetchAllRows` of every courier-assigned order (L~213-233) | **GONE** | L212–222 is now a `.rpc('courier_roster_stats', { p_business })` `useQuery`. No `fetchAllRows` import remains in the file. |
| `courier_payment_notes` bare select (L~278-292) **feeding totalPaid/totalUnpaid** (sums L~355-362) | **HALF-TRUE** | The bare select **still exists** at **L259–273**. But it **no longer feeds totalPaid/totalUnpaid** — those come from `rosterStats.notes_paid_sum` / `notes_unpaid_sum` (L316–317). The select now only feeds the **detail-modal note table** (L549, L786–833). |
| `courier_return_notes` bare select for the detail modal (L~294-308) | **TRUE** | L275–289. Detail-modal-only (L550, L836–883). |
| per-courier stats client-side (L~320-364) | **GONE** | L301–321 is now a pure **overlay** of the server rows onto a zero-initialised Map. The only client math left is `zones` (from `courier_fees`) and derived ratios. |
| "whether the page currently calls it (grep)" | **YES — IT DOES** | `Couriers.tsx:217` — the only `courier_roster_stats` call site in the repo. |

### 1.2 Exact queries (current)

| # | L | Table / RPC | Select | Filters | Bare vs paginated | Enabled |
|---|---|---|---|---|---|---|
| 1 | 192–206 | `users` | `id, name, email, phone, avatar_url, avatar_config, address, active, created_at, bank_account_holder, bank_name, bank_rib, cin_number` | `"DigiCom Business"=biz`, `role='courier'`, `order('name')` | **bare** | `!!biz` |
| 2 | 212–222 | **RPC `courier_roster_stats`** | — | `p_business` | RPC | `!!biz` |
| 3 | 224–236 | `courier_fees` | `courier_id, master_city_id, fee` | `.in('courier_id', courierIds)` — **NO business filter** | **bare** | `!!biz && ids>0` |
| 4 | 240–252 | `master_cities` | `id, name` | `.in('id', cityIds)` | **bare** | `cityIds>0` |
| 5 | 259–273 | `courier_payment_notes` | `id, courier_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at` | `"DigiCom Business"=biz`, `.in('courier_id', ids)`, `order created_at desc` | **bare** | `!!biz && ids>0` |
| 6 | 275–289 | `courier_return_notes` | `id, courier_id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, received_at, created_at` | `"DigiCom Business"=biz`, `.in('courier_id', ids)`, `order created_at desc` | **bare** | `!!biz && ids>0` |

**Note on #3:** `courier_fees` is fetched with **no `"DigiCom Business"` filter** — only `.in('courier_id', courierIds)`. RLS is the sole tenant gate. `courier_fees` has 446 rows and a **unique index** `courier_fees_courier_master_city_biz_uniq (courier_id, master_city_id, "DigiCom Business") WHERE master_city_id IS NOT NULL` — note D4's `courier_roster_stats` header comment claims *"courier_fees has no unique key on (courier_id, master_city_id)"* and therefore uses `LATERAL … ORDER BY updated_at DESC LIMIT 1`. **That comment is stale/imprecise**: a partial unique index on the *3*-tuple exists. The LATERAL is still correct (it is a 3-tuple key, and the index is partial on `master_city_id IS NOT NULL`), so this is a **documentation defect, not a correctness defect**. Flag for the D5 migration header.

### 1.3 Exact client math (current)

```
stats (L301–321)  zero-init per courier { totalOrders, inTransit, delivered, returned,
                  totalShippingFees, totalPaid, totalUnpaid, notesCount,
                  zones: zonesByCourier.get(c.id)?.size || 0 }
                  ← overlay rosterStats rows (Number(...) || 0 on every numeric)

zonesByCourier (L292–299)  Map<courier_id, Set<master_city_id>>  ← courier_fees   [CLIENT-ONLY]
successRate (L324–328)     delivered / (delivered + returned) * 100 ; 0 when denom=0
deliveryTier (L160–164)    >=70 Strong / >=40 Steady / else At risk
rankMap (L331–336)         sort by delivered desc → 1-based rank
podium (L338–343)          delivered>0, sort delivered desc, slice(0,3)
filtered (L345–364)        search name|email|phone (lowercase includes)
                           sort: delivered | orders(totalOrders) | unpaid(totalUnpaid)
totals (L366–378)          Σ over stats: totalOrders, totalDelivered, totalReturned, totalUnpaid
```

Modal-only derived (L547–579):
```
daysActive   = differenceInDays(now, created_at) + 1
avgPerDay    = delivered / daysActive                        (0 when daysActive<=0)
returnRate   = returned / (delivered+returned) * 100
avgFee/order = totalFees / delivered                         (L725, '0' when delivered=0)
statusDistribution = [Delivered, In-transit, Returned].filter(count>0)
zoneRows     = courierFees.filter(courier_id).map({city: cityNameMap|'Unknown', delivery: fee}).sort(city)
notes              = paymentNotes.filter(courier_id === c.id)         [CLIENT-SIDE FILTER of a biz-wide dump]
courierReturnNotes = returnNotes.filter(courier_id === c.id)          [same]
```

### 1.4 Rendered output

- **KPI strip** (L934–939): Couriers count · Delivered (`totals.totalDelivered`) · Returns (`totals.totalReturned`) · Unpaid fees (`totals.totalUnpaid`).
- **Podium** (L959–973): top-3 by delivered — per card: delivered, success %, fees_sum, unpaid.
- **Roster cards** (L1049–1053): rank, success-rate bar, 4-col {Orders, Deliv, Return, Fees}, tier pill, unpaid.
- **Detail modal** (L547–905): Zones/Fee model/Days-since-join/Handled · delivery-performance bar + 4 MiniTiles · **ink financial panel** {Fees earned, Paid out, Unpaid} + {Delivered, Payment notes count, Avg fee/order} · Activity list · **Zones & fees list** · **Payment-notes table** · **Return-notes table** · Personal & banking.

### 1.5 Refetch / deps

Pure react-query, **no `useEffect` fetch-everything**. Keys: `['couriers',biz]`, `['couriers-roster-stats',biz]`, `['couriers-fees',biz,idsJoined]`, `['couriers-cities',cityIdsJoined]`, `['couriers-payment-notes',biz,idsJoined]`, `['couriers-return-notes',biz,idsJoined]`. Chained enablement: users → ids → fees → cityIds → cities. No `staleTime`/`refetchOnMount` overrides → library defaults.

### 1.6 What `courier_roster_stats` covers vs. does NOT

| Page figure | Covered? |
|---|---|
| `totalOrders` / `delivered` / `inTransit` / `returned` | ✅ `total_orders`/`delivered`/`in_transit`/`returned` |
| `totalShippingFees` | ✅ `fees_sum` |
| `totalPaid` / `totalUnpaid` | ✅ `notes_paid_sum` / `notes_unpaid_sum` |
| `notesCount` | ✅ `notes_count` (payment notes only) |
| **`zones`** (distinct cities w/ fee) | ❌ **client-side** from `courier_fees` |
| **Zones & fees list** (city name + fee) | ❌ needs `courier_fees` + `master_cities` |
| **Payment-notes list** (modal table) | ❌ only the *sums* are covered, not the rows |
| **Return notes — sums AND list** | ❌ **entirely absent from the RPC.** `courier_return_notes` (1 row live) is not touched by D4 at all. |
| `successRate`/`returnRate`/`avgPerDay`/`avgFee/order`/`daysActive` | n/a — client-derived from covered columns (correct; keep) |

**Security gap:** `courier_roster_stats` is `language sql` / `security invoker` / **no admin gate**. Under the new D3-review rule it returns *business-wide money + per-collaborator performance* → **must be gated**. `language sql` cannot `raise`; the gate requires converting to `plpgsql` (or wrapping). This is a **D5 blocker item**, not optional.

---

## §2. SELLERS — `src/pages/admin/collaborators/Sellers.tsx`

**Not migrated. This is the heaviest page of the three and the core of D5.**

### 2.1 The `useEffect` fetch-everything pattern

```
L179–181  useEffect(() => { fetchSellers(); },
            [confirmedIds, cancelledIds, deliveredPkgIds, pendingIds,
             adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds,
             isOrderCategory, isOrderInCategories])
```
**8 deps, all from `useStatusCategories()` + `useTrackedOrders()`.** Every identity change re-runs the *entire* 5-query cascade (`fetchSellers` is not memoised; `isOrderCategory`/`isOrderInCategories` are function identities). Manual `useState` + `setLoading` — **no react-query**, so no dedupe, no cache, no key.

Additionally `useTrackedOrders(biz)` (L165) itself does **two** `fetchAllRows` dumps (`company_parcels`, `courier_parcels`, whole business) with `staleTime: 0, refetchOnMount: 'always'` — a third and fourth full download on every mount, purely to build the `trackedOrderIds` set client-side.

### 2.2 Exact queries

| # | L | Table | Select | Filters | Mode |
|---|---|---|---|---|---|
| 1 | 186–191 | `users` | `id, name, email, avatar_url, avatar_config, products, commission_price, commission_basis, created_at, bank_account_holder, bank_name, bank_rib, cin_number, address, phone` | `role='commercial'`, `"DigiCom Business"=biz`, `order created_at asc` | **bare** |
| 2 | 205–215 | `orders` | `id, seller_id, order_status_id, package_status_id, price, created_at, date_livraison, master_city_id, replace, status:order_statuses(code,label), city:master_cities(name), package_statuses(label), order_items(product_id, quantity)` | `seller_id in sellerIds`, `date_deleted is null`, `source_review_status neq 'pending'` | **fetchAllRows** — **LIFETIME, ALL SELLERS, + 4 embedded joins** |
| 3 | 221–223 | `seller_daily_earnings` | `*` | `"DigiCom Business"=biz` | **fetchAllRows** |
| 4 | 225–227 | `seller_presences` | `*` | `"DigiCom Business"=biz` | **fetchAllRows** |
| 5 | 229–233 | `seller_payments` | `*` | `"DigiCom Business"=biz`, `order payout_month desc` | **bare** ← *will silently cap at 1000* |
| 6 | 243–247 | `products` | `id, name, image_url` | `active=true`, `.in('id', allProductIds)` | **bare** |

Post-fetch client filter L219: `orders = ordersRaw.filter(o => o.replace !== true)` — exchange-leg exclusion done **after** downloading them.

### 2.3 Exact client math (per seller, L256–414)

```
sellerOrders   = orders.filter(o.seller_id === seller.id)      [O(N_orders) per seller → O(N·M)]
sellerEarnings = earnings.filter(...)   sellerPresences = presences.filter(...)
sellerPayments = payments.filter(...)

total = sellerOrders.length

── status if/else chain (L271–290), FIRST MATCH WINS, order is load-bearing ──
  isDeliveredForCommission(o, deliveredPkgIds)          → delivered++
  else isOrderCategory(sid,'processed')                 → shipped++
  else confirmedIds.has(o.order_status_id)              → confirmed++
  else isOrderCategory(sid,'cancelled')                 → cancelled++
  else isOrderInCategories(sid,['fake','double'])       → fake++
  else pendingIds.has(o.order_status_id)                → pending++
  else                                                  → pending++   (catch-all)

── rates ──
statusMapsReady     = pendingIds.size > 0
rateConfirmedCount  = |{o : trackedOrderIds.has(o.id)
                          OR (statusMapsReady AND o.order_status_id AND !pendingIds.has(sid))}|
confirmRate         = rateConfirmedCount / total * 100                     (0 when total=0)
sellerTracked       = sellerOrders.filter(trackedOrderIds.has(o.id))
sellerPullback      = sellerTracked.filter(isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds))
sellerDeliveryDenom = sellerTracked.length - sellerPullback.length
deliveryRate        = delivered / sellerDeliveryDenom * 100               (0 when denom<=0) [UNCLAMPED]
cancellationRate    = (cancelled + fake) / total * 100

── MONEY ──
alreadyPaidAmount = Σ sellerPayments.paid_amount                                   (L318–319)
basis             = normalizeCommissionBasis(seller.commission_basis)
{unpaidCommission: liveCommission} = computeUnpaidCommission({                      (L324–331)
    basis, commissionPrice: Number(seller.commission_price)||0,
    orders: sellerOrders, isDelivered: o=>isDeliveredForCommission(o, deliveredPkgIds),
    sellerProductIds, paidAmount: alreadyPaidAmount })
totalRevenue          = Σ_{delivered} Number(o.price)||0                            (L333–335)
totalCommissionEarned = Σ sellerEarnings.commission_earned                          (L337)
totalEarnings         = Σ sellerEarnings.total_earned                               (L338)
totalPaid             = Σ sellerPayments.paid_amount                                (L344–347)
totalUnpaid           = Σ (period_state==='open'
                           ? max(0, total_amount - paid_amount) : 0)                (L348–353)
                        ── rolling-ledger carry: closed months' unpaid already
                           rolled into the open ticket; summing all rows would
                           double-count. THIS IS THE MODEL, PRESERVE EXACTLY.

── activity ──
daysPresent      = sellerPresences.length
avgDailyDelivered= delivered / daysPresent                                (0 when 0)
lastActive       = max(sellerPresences.date)  [sort desc, [0]]
topCity          = argmax over delivered orders of (o.city?.name || 'Unknown')      (L365–372)
productNames     = sellerProductIds.map(productsMap).filter(exists)
monthlyPayments  = sellerPayments.map({month: payout_month, total_amount, paid_amount,
                                       delivered_orders, status||'pending',
                                       period_state||'closed'})
```

Globals (L418–426): `totalSellers`, `totalDelivered=Σ delivered`, `totalRevenue=Σ`, `totalPaid=Σ`, **`avgDeliveryRate = Σdelivered / Σ deliveryDenom * 100`** (pooled ratio, **not** a mean of rates — must be reproduced as a pooled ratio server-side).

**DEVIATIONS from `docs/d2-recon/01 §0.2` to record:**
1. **`totalRevenue` uses raw `o.price`, NOT `pureRevenueForOrder`.** The leaderboard's "Revenue" is the order price of delivered orders — no delivery-cost stripping. Deliberate per the seller-listing-total memo (`order.price` = seller TOTAL incl. delivery when toggled). **Do not silently swap in `pureRevenueForOrder` in the RPC** — it would change every number on this page.
2. **`deliveryRate` is UNCLAMPED here** (L309). D2 clamps ≤100 only on admin KPI cards. Preserve raw.
3. **`confirmedOrders` is set to `rateConfirmedCount`** (L391), *not* the `confirmed++` counter from the if/else chain — the chain's `confirmed` variable is computed and **discarded**. (Dead-ish, but the chain ordering still routes rows into `pending`, so the chain must be reproduced faithfully.)
4. **Sellers' order pool DOES exclude `source_review_status='pending'`** (L212), unlike the seller-facing pages (D2 §0 note: "seller pools do NOT exclude…"). This is the *admin* view → matches the admin pool. Confirm alignment when writing the RPC.

### 2.4 Rendered output

- **KPI strip** (L975–979): Total sellers · Total delivered · Total revenue · **Avg delivery rate** (pooled).
- **Podium** (L470–546): delivered, deliveryRate %, revenue, **unpaid commission (`liveCommission`)**.
- **Roster cards** (L549+): rank, tier, delivered/rate/revenue/commission.
- **Detail modal** (L~630–960): Commission rate + basis suffix (`DH/unit` vs `DH/order` via `normalizeCommissionBasis`) · Products count · Days since join · performance MiniTiles {Confirm rate, Delivery rate, Loss rate, Avg per day} · ink financial panel · Activity {Days present, Last active, Top city} · Products list · **monthly-payments table** · banking.
- **Search** (L449–458) matches name | email | **topCity** ← a *derived* field. If `topCity` moves server-side it must still be present per row for search to keep working.
- **Sorts** (L459–465): delivered | revenue | rate | commission.

### 2.5 Reuse analysis — decisive

| Candidate | Verdict | Why |
|---|---|---|
| `seller_dashboard_stats(p_business, p_seller, p_from, p_to)` | ❌ **UNUSABLE** | **Self-scoped by construction**: L36–38 of the D2 migration raises `42501` when `p_seller is distinct from auth.uid()` (business-admin override aside). It is **one seller per call** → a roster of N sellers = **N round-trips (N+1)**, strictly worse than today's 5. It is also **windowed**; the leaderboard is lifetime. Its `self_perf` slice is a *different* widget's contract. |
| `admin_analytics_stats(p_business,p_from,p_to)` → `sellers[]` | ❌ **UNUSABLE as-is** | Right shape (`seller_id, orders, delivered, delivered_paid, tracked, pullback, revenue, presences, commission`), **wrong window** (STRICT windowed; leaderboard is lifetime) and **missing** `liveCommission`, `totalPaid`, `totalUnpaid`, `monthlyPayments`, `topCity`, `lastActive`, `productNames`, `confirmRate`, `cancellationRate`, `shipped/fake` counts. Its `revenue` is the analytics chain, **not** raw `o.price`. Calling it with `p_from='2020-01-01'` would return *different numbers* than the page shows. **Do not conflate.** |

**⇒ NEW FUNCTION.** `seller_roster_stats(p_business uuid)`.

---

## §3. MEDIABUYERS — `src/pages/admin/collaborators/MediaBuyers.tsx`

### 3.1 The month-scope correction

L155–156: `const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []); const { rows: earnings } = useMediaBuyerEarnings(currentMonth);`

The podium, rank, sorts, KPI strip and the modal's "Performance · month" are **all current-month**. `campaigns` and `payouts` in the modal are **lifetime**. So the page is a **hybrid**, and the brief's "leaderboards are LIFETIME" does not hold here.

### 3.2 Exact queries

**Page-level (2):**

| # | L | Table | Select | Filters | Mode |
|---|---|---|---|---|---|
| 1 | 161–174 | `mediabuyer_payments` | `id, mediabuyer_id, payout_month, total_amount, paid_amount, delivered_orders, status, paid_at, created_at` | `"DigiCom Business"=biz`, `order payout_month desc` | **bare** (lifetime) |
| 2 | 176–188 | `campaigns` | `id, created_by, name, platform, status` | `"DigiCom Business"=biz` | **bare** (lifetime) |

**Inside `useMediaBuyerEarnings(month)` (4 more):**

| # | Table | Select | Filters | Mode |
|---|---|---|---|---|
| 3 | `users` | `id,name,email,avatar_url,avatar_config,phone,role,payment_type,commission_price,salary_amount,bank_name,bank_account_holder,bank_rib,cin_number,address,created_at,active` | `biz`, `role='mediabuyer'` (+`id=selfMbId` when set) | bare |
| 4 | `campaign_daily_entries` | `id,campaign_id,created_by,entry_date,platform,spend,leads` | `biz`, `.in('created_by',mbIds)`, `entry_date` between `from`/`to` | bare |
| 5 | `orders` | `id, date, source_name, package_status_id, replace` | `biz`, `date >= shiftYmd(from,-1)`, `date <= shiftYmd(to,1)+T23:59:59.999Z`, `date_deleted is null`, `source_review_status neq 'pending'` | **fetchAllRows** |
| 6 | `mediabuyer_payments` | `id,mediabuyer_id,payout_month,total_amount,paid_amount,status,paid_at` | `biz`, `payout_month=month` | bare |

**⇒ 6 queries total for this page.** Note **`mediabuyer_payments` is fetched twice** (page-level lifetime + hook-level month-scoped) with overlapping columns.

### 3.3 Exact client math

Hook (`useMediaBuyerEarnings.ts`):
```
monthBounds(month)  → { from: 'YYYY-MM-01', to: 'YYYY-MM-<lastday>' }
distinctSources     = { getPlatformSource(e.platform) } over entries          [drives query #5's enablement]
orders post-filter  = o.replace !== true AND source_name.toLowerCase() ∈ srcLower

deliveredBy: Map<'businessDate|source_lower', count>
  for o in orders: skip !date|!source_name|!package_status_id
                   skip !deliveredPkgIds.has(package_status_id)
                   key = `${toBusinessDate(o.date)}|${o.source_name.toLowerCase()}`

per MB:
  totalSpend    = Σ Number(e.spend||0)
  daySourceSet  = { `${e.entry_date}|${getPlatformSource(e.platform)}` }
  campaignSet   = { e.campaign_id || `__orphan__${e.platform}` }
  delivered     = Σ_{k ∈ daySourceSet} deliveredBy.get(k) || 0        ← day+source DEDUPE
  salary_earned      = payment_type==='salary'     ? salary_amount : 0
  commission_earned  = payment_type==='commission' ? delivered * commission_price : 0
  total_amount       = salary_earned + commission_earned
  prior_paid_amount  = Σ mbPayments.total_amount        ← ⚠ SEE DEVIATION BELOW
  remaining_amount   = max(0, total_amount - prior_paid_amount)
  campaigns_count    = campaignSet.size
```

**⚠ DEVIATION / LATENT DEFECT (report, do not fix in recon):** `prior_paid_amount` sums **`total_amount`**, not `paid_amount` (hook, "6. Compute" block). Every *sibling* surface (Sellers L318/L344, MB `paymentTier`) treats `paid_amount` as the disbursement truth, and the `mediabuyer_payments` table **has** a `paid_amount` column (verified live). With a `partial` payout row, `prior_paid_amount` over-counts → `remaining_amount` under-reports. Live blast radius is currently 4 `mediabuyer_payments` rows. **This must be an explicit decision in the D5 design (preserve bug-for-bug vs. fix), not an accident of translation.** It propagates to `Salaries.tsx` and `mediabuyer/Payments.tsx`.

Page-level (L191–252):
```
filtered  = search name|email|phone → sort delivered|spend|payroll(total_amount)|unpaid(remaining_amount)
podium    = delivered_orders>0, sort desc, slice(0,3)
rankMap   = sort delivered desc → 1-based
ownedCampaignCount = Map<created_by, count> over allCampaigns    ← LIFETIME, deliberately NOT the
                     hook's month-scoped campaigns_count (comment L226–229 explains why)
totals    = Σ {total_spend, delivered_orders, total_amount, remaining_amount}, active = count
paymentTier(total, remaining): remaining<=0→Settled | paid>0→Partial | →Pays due
```
Modal (L~435–640): `cpd = total_spend / delivered_orders` (0-guard) · `daysActive` · `campaigns = allCampaigns.filter(created_by)` · `payouts = allPayouts.filter(mediabuyer_id)` · `lastPaid = payouts.find(p.paid_at)?.paid_at` (relies on the `payout_month desc` order, **not** on `paid_at` order — a "latest paid" that is really "first row with a paid_at in month-desc order").

### 3.4 Blast radius — the hook is SHARED (this is the constraint that shapes the verdict)

```
src/pages/admin/Salaries.tsx:1060            useMediaBuyerEarnings(monthKey)                       [admin]
src/pages/mediabuyer/Payments.tsx:132        useMediaBuyerEarnings(currentMonth, {selfMbId: uid})  [MB — SELF]
src/pages/admin/collaborators/MediaBuyers.tsx:156  useMediaBuyerEarnings(currentMonth)             [admin]
src/pages/mediabuyer/Dashboard.tsx:79        (comment only — already migrated off to mb_dashboard_stats)
```

**⇒ A blanket admin gate on the hook's RPC would break `mediabuyer/Payments.tsx`.** The `selfMbId` path exists precisely so an MB sees only their own row (and the hook's own comment says it keeps peers' banking/salary PII out of the projection). The gate must be **`admin OR p_mb = auth.uid()`** — exactly the shape `seller_dashboard_stats` already uses (D2 L36–38) and consistent with the MB-facing data rule.

### 3.5 Reuse analysis

| Candidate | Verdict | Why |
|---|---|---|
| `admin_analytics_stats` → `mediabuyers[]` | ❌ | Windowed, and a **completely different economic model**: it returns `spend, orders, delivered, revenue, cogs, shipping, seller_commission, mb_cost, net_profit` with **1/N bucket splitting** across MBs claiming the same (day, platform). The leaderboard does **no** N-split and needs **payroll/paid/remaining**, which analytics has none of. |
| `mb_dashboard_stats(p_business,p_mb,p_from,p_to)` | ❌ | Single-MB, windowed, self-scoped. N+1 for a roster. |
| `mb_month_earned(p_mb, p_business_id, p_month)` | ⚠ **PARTIAL — but only per-MB** | SECURITY **DEFINER**, already the server-side truth the hook's own comment defers to ("*Matches the server-side `mb_month_earned` guard (swap_only=false)*"). It is the **canonical month-earned formula**. But it is **one MB per call** → N+1 for a roster. **Reuse its SQL body as the definition source** for the new set-returning fn; **do not call it per-row**. |
| `mb_entry_days(p_business, p_created_by)` | ⚠ per-MB | same N+1 shape. |

**⇒ NEW FUNCTION.** `mb_roster_earnings(p_business uuid, p_month text/date, p_mb uuid default null)`.

---

## §4. DB SURFACE (verified live on box)

### 4.1 Schemas

```
courier_fees          id uuid, courier_id uuid, fee numeric, created_at tstz, updated_at tstz,
                      "DigiCom Business" uuid, master_city_id uuid, return_fee numeric
courier_payment_notes id, courier_id, reference text, status text, total_amount numeric,
                      total_shipping_fees numeric, net_amount numeric, order_count int,
                      paid_at tstz, created_by uuid, created_at tstz, updated_at tstz, "DigiCom Business"
courier_return_notes  id, courier_id, reference text, created_at, updated_at, "DigiCom Business",
                      status text, total_amount, total_shipping_fees, net_amount, order_count int,
                      received_at tstz, created_by uuid
seller_presences      id uuid, seller_id uuid, date date, created_at tstz, "DigiCom Business" uuid
seller_payments       id, seller_id, payout_month text, total_amount, delivered_orders int,
                      status text, paid_at tstz, created_at, "DigiCom Business", paid_amount numeric,
                      period_state text, carried_in, month_earned, carried_out, closed_at, earned_frozen bool
mediabuyer_payments   id, mediabuyer_id, "DigiCom Business", payout_month text, payment_type text,
                      salary_earned, commission_earned, total_amount, delivered_orders int,
                      total_spend, campaigns_count int, bank_snapshot jsonb, status text, paid_at,
                      created_at, updated_at, paid_amount numeric, carried_in, carried_out,
                      month_earned, period_state text, earned_frozen bool, closed_at
seller_daily_earnings VIEW → id, seller_id, date, salary_earned, commission_earned,
                      delivered_count, total_earned, created_at, "DigiCom Business"
```
`seller_daily_earnings` is a **VIEW** (`security_invoker=on` per the perf memo; LATERAL rewrite, matview blocked because it can't carry RLS). An RPC selecting from it inherits the invoker's RLS — consistent with SECURITY INVOKER D5 fns. **Do not** wrap it in a SECURITY DEFINER fn without re-adding the tenant predicate.

### 4.2 Indexes (D5-relevant)

```
seller_presences       idx_spres_business_id ("DigiCom Business")
                       seller_presences_seller_id_date_key UNIQUE (seller_id, date)     ← no biz in key
seller_payments        idx_sp_business_id ("DigiCom Business") ; idx_sp_seller_id (seller_id)
                       seller_payments_uq_seller_month_biz UNIQUE (seller_id, payout_month, "DigiCom Business")
mediabuyer_payments    mediabuyer_payments_business_idx ; _mb_idx (mediabuyer_id) ; _month_idx (payout_month)
                       _status_idx ; _mb_month_biz_key UNIQUE (mediabuyer_id, payout_month, "DigiCom Business")
courier_payment_notes  idx_..._business ; idx_..._courier ; idx_..._created_by
                       idx_courpn_biz_keyset ("DigiCom Business", created_at DESC, id DESC)   ← D1 keyset
                       idx_courpn_biz_ref_trgm GIN ("DigiCom Business", fold_text(reference))  ← notes-search
courier_return_notes   idx_..._digicom_business ; idx_courier_rn_courier_id ; idx_..._created_by
                       idx_courrn_biz_keyset ("DigiCom Business", created_at DESC, id DESC)
                       idx_courrn_biz_ref_trgm GIN (...)
courier_fees           courier_fees_courier_master_city_biz_uniq UNIQUE (courier_id, master_city_id,
                                                    "DigiCom Business") WHERE master_city_id IS NOT NULL
                       idx_courier_fees_digicom_business ; idx_courier_fees_master_city
campaigns              campaigns_business_idx ; campaigns_created_by_idx ; campaigns_status_idx
campaign_daily_entries campaign_daily_entries_business_idx ; _created_by_idx ; _date_idx ; _campaign_idx
                       _platform_idx ; _campaign_id_entry_date_key UNIQUE (campaign_id, entry_date)
```

**Index verdict:** every D5 aggregate's driving predicate (`"DigiCom Business" = p_business`, grouped by `seller_id`/`courier_id`/`mediabuyer_id`/`created_by`) has a supporting index. **No new indexes are required for D5.** The `courpn/courrn` keyset + trgm indexes already exist from the notes-search work and cover the modal-list RPCs. Two soft notes: (a) `seller_presences` has no composite `(biz, seller_id)` — at 160 rows the biz index + filter is fine, revisit only if presences grow into the 10⁵; (b) `campaign_daily_entries` has no `(biz, created_by, entry_date)` composite — the three single-column indexes will BitmapAnd adequately at current volume.

### 4.3 Row counts (live — calibrates urgency)

```
orders 2109 | courier_fees 446 | seller_presences 160 | seller_daily_earnings 135
courier_payment_notes 12 | seller_payments 12 | mediabuyer_payments 4 | courier_return_notes 1
```

**Reading:** only `orders` (2109) is past the 1000 cap today — and both remaining order dumps (Sellers #2, MB hook #5) use `fetchAllRows`, so they are **correct-but-heavy**, not wrong-money. The **bare** selects (`seller_payments`, `mediabuyer_payments`, `campaigns`, both courier note tables) are **latent** wrong-money: correct today, silently truncating the day they cross 1000. D5's value here is **(a) download-volume collapse, (b) closing the latent cap, (c) the missing admin gates** — *not* an active wrong-money fire like D4's. State this honestly in the migration header rather than inheriting D4's "wrong money" framing.

---

## §5. PER-PAGE VERDICT TABLE

| Page | Existing RPC | Verdict | Function(s) for D5 |
|---|---|---|---|
| **Couriers** | `courier_roster_stats(p_business)` — **LIVE + WIRED** | **EXTEND + 1 NEW** | ① `courier_roster_stats` → add admin gate (`sql`→`plpgsql`), add `zones`, `return_notes_count`, `return_fees_sum`. ② NEW `courier_notes_detail(p_business, p_courier)` for the two modal tables + zone rows, gated on modal open. |
| **Sellers** | none | **NEW** | `seller_roster_stats(p_business)` — lifetime, jsonb `{ globals, sellers[] }`, admin-gated. |
| **MediaBuyers** | `mb_month_earned` (per-MB, SECDEF) | **NEW (body reuses `mb_month_earned`'s formula)** | `mb_roster_earnings(p_business, p_month, p_mb default null)` — replaces `useMediaBuyerEarnings`' internals, gate = `admin OR p_mb = auth.uid()`. |

**Nothing is duplicated.** `admin_analytics_stats`'s sellers/couriers/mediabuyers sections stay untouched — they are windowed analytics with different economics (1/N MB splitting, full-chain revenue, COGS). The leaderboards are lifetime/month roster views with payroll semantics. Different contracts, deliberately.

### 5.1 Recommended D5 migration shape — `supabase/migrations/2026071<N>_d5_collaborator_rosters.sql`

Conventions (identical to D2/D3/D4): `SECURITY INVOKER`, `STABLE`, `set search_path to ''`, jsonb single return, explicit `p_business`, Casablanca windows from `yyyy-MM-dd`, flag-column status semantics, D4 grants footer (`revoke all … from public, anon; grant execute … to authenticated; alter function … owner to postgres;`).

```sql
-- ① EXTEND (sql → plpgsql for the gate)
create or replace function public.courier_roster_stats(p_business uuid)
returns jsonb language plpgsql stable security invoker set search_path to '' as $$
begin
  if not (select public.current_user_is_business_admin()) then
    raise exception 'courier_roster_stats: admin only' using errcode = '42501';
  end if;
  -- existing order_stats + note_stats CTEs verbatim, PLUS:
  --   zone_stats:   count(distinct master_city_id) from courier_fees
  --                 where "DigiCom Business" = p_business group by courier_id
  --   ret_stats:    count(*), sum(total_shipping_fees) from courier_return_notes
  --                 where "DigiCom Business" = p_business group by courier_id
  -- FULL OUTER JOIN all four on courier_id → jsonb_agg
end $$;
```
> **Return-type change (`setof record` → `jsonb`) is a breaking change with exactly one call site** (`Couriers.tsx:217`). Either flip both in the same commit, or keep `returns table(...)` + add the columns and gate — the table form is `sql`-only-by-habit, not by requirement; `plpgsql` can `return query` a table just as well. **Prefer keeping `returns table` + `plpgsql` + gate + new columns** — smallest diff, no client type churn beyond adding fields to `RosterStatRow`. Adopting jsonb here buys nothing since the page already overlays row-wise.

```sql
-- ② NEW — modal detail, one courier, lazy (gate query on `!!selected`)
create or replace function public.courier_notes_detail(p_business uuid, p_courier uuid)
returns jsonb ...  -- { payment_notes: [...], return_notes: [...], zones: [{city, fee}] }
-- kills queries #3/#4/#5/#6 from the roster path entirely; the zone COUNT
-- moves into ①, the zone LIST lives here. Precedent: chat-orders-history —
-- extracted view dialogs MUST gate queries on open (kept-mounted trap).

-- ③ NEW
create or replace function public.seller_roster_stats(p_business uuid)
returns jsonb ...
-- gate: current_user_is_business_admin() → 42501
-- { globals: { total_sellers, total_delivered, total_revenue, total_paid,
--              delivered_sum, denom_sum },        ← ship the two sums, let the
--                                                    client divide → pooled
--                                                    avg_delivery_rate parity
--   sellers: [{ seller_id, total_orders, pending, confirmed(=rate_confirmed),
--               delivered, cancelled, fake, shipped, tracked, pullback,
--               delivery_denom, confirm_rate, delivery_rate, cancellation_rate,
--               live_commission, total_revenue, total_earnings,
--               total_commission_earned, total_paid, total_unpaid,
--               days_present, last_active, top_city, product_ids,
--               monthly_payments: [...] }] }
-- ⚠ total_revenue = Σ raw o.price over delivered  (NOT pureRevenueForOrder)
-- ⚠ delivery_rate UNCLAMPED
-- ⚠ total_unpaid = open-period-only (rolling-ledger carry)
-- ⚠ tracked set = company_parcels ∪ courier_parcels w/ non-blank tracking_code
--   → reuse D2's hashed-set CTE; NEVER a per-row subplan
-- ⚠ top_city must ship per row — the page's search matches on it (L456)

-- ④ NEW
create or replace function public.mb_roster_earnings(
    p_business uuid, p_month text, p_mb uuid default null)
returns jsonb ...
-- gate: if not admin and (p_mb is null or p_mb is distinct from auth.uid())
--         then raise 42501  -- mirrors seller_dashboard_stats L36–38
-- month math = mb_month_earned's body, set-returning (NOT called per row)
-- { mediabuyers: [{ mediabuyer_id, delivered_orders, total_spend,
--                   campaigns_count, salary_earned, commission_earned,
--                   total_amount, prior_paid_amount, remaining_amount,
--                   owned_campaign_count,          ← lifetime; folds page query #2
--                   existing_payout: {...} }],
--   payouts: [...] }                               ← lifetime; folds page query #1
-- ⚠ DECIDE prior_paid_amount: total_amount (bug-for-bug) vs paid_amount (fix).
--   Whichever — write it in the header. Affects Salaries.tsx + mb/Payments.tsx.
-- ⚠ MB PII: when p_mb is set (self path) the projection must NOT include peers'
--   bank_*/cin/salary — the hook's selfMbId narrowing exists for this.
```

### 5.2 Sequencing / risk

1. **Couriers first** — smallest diff (extend + one lazy detail fn), and it closes the ungated-money hole in already-shipped D4 code. Ship the gate even if nothing else lands.
2. **Sellers second** — biggest win (5 queries + 2 parcel dumps + O(N·M) client math → 1 RPC), self-contained (no shared hook), admin-only route ⇒ gate is free.
3. **MediaBuyers last** — the hook is shared 3 ways; it needs a conditional gate and a deliberate ruling on the `prior_paid_amount` deviation. Do **not** bundle it with 1–2.

**Deliberately out of scope for D5, log to the register:**
- `useTrackedOrders`' two `staleTime:0 / refetchOnMount:'always'` full parcel dumps — consumed by many surfaces; killing it is its own task. Once `seller_roster_stats` computes `tracked`/`pullback` server-side, Sellers.tsx stops *needing* it, but the hook stays alive for other callers.
- D4's stale header comment re: `courier_fees` having "no unique key" (§1.2) — correct the wording in the D5 header.
- `courier_fees` fetched with no `"DigiCom Business"` filter (Couriers L231) — moot once ①/② absorb it, but note it as the RLS-only-gate instance it is.
