# D7 RECON — the low-value tail + dead-code sweep

**Method:** graphify query → targeted greps → live box (`~/.igrowfast/db.sh`, read-only) → `EXPLAIN ANALYZE` → git archaeology. Every MASTER_TODO §6 claim in scope was re-verified against current code. **9 of the 17 claims I checked are STALE.**

**Headline:** the P3 1000-cap tail is *entirely* unreachable — every single P3 page has 2–3 orders of magnitude of headroom, and I recommend DEFER on all of them. But the sweep surfaced **three real defects that are not tail at all**, one of which (`DeliveryServices` "Auto Fill All") is the worst thing I found in the whole registry and is mis-classified as P2.

---

## 0. VERDICT SUMMARY

| # | Item | Verdict | Effort | Why |
|---|------|---------|--------|-----|
| **1** | `admin/DeliveryServices` "Auto Fill All" | **FIX — ESCALATE to P1** | ~3h | **896 sequential round-trips** (~90s frozen button), partial write, no rollback, optimistic UI lies. Money table. |
| **2** | `webhook_logs` composite index | **FIX** | **~10 min** | `EXPLAIN` proves 5290-row index scan + top-N sort, fired **12×/min per mounted admin**. One-line index. Best value/effort in the tail. |
| **3** | `ImportProducts` / `ImportAccessories` silent partial import | **FIX** | ~3h | Errors `console.error`-only; toast says "Import finished — Processed N rows" regardless. Real defect class. |
| **4** | `fetchAllRows` PAGE_SIZE ↔ `PGRST_DB_MAX_ROWS` coupling | **FIX** | ~30 min | Undocumented cross-repo invariant. Lowering the box env silently truncates **every caller** → wrong money. |
| **5** | Dead code: 4 files, ~32 dead exports | **FIX** | ~45 min | `SyncTrackingStatus.tsx`, `useTrackingSyncStatus.ts`, `useSellerCommissionTotals.ts`, `orderSearch.ts` — all verified zero-consumer. |
| **6** | `useTrackedOrders` / `CustomerInsights` | **ESCALATE — not D7** | — | Every order-dialog open re-downloads all business parcels (`staleTime:0`). Biggest surviving unbounded caller. Registry has it P1 already. |
| **7** | **All 15 P3 owner/reference pages** | **DEFER** | — | Cap unreachable. See §2 table — headroom is 125×–200,000×. |
| **8** | `owner/Cities` `syncProviderMappings` 9 round-trips | **DEFER** | — | 9 RTTs on one interactive save. Bounded at 9 forever (9 providers). Gold-plating. |
| **9** | `useSellerLiveOwed` client-side SUM | **DEFER** | — | 135 view rows. Real but not yet costly; `mb_roster_earnings` precedent exists if it ever matters. |

---

## 1. STALE CLAIMS — already fixed by D1..D5 (do NOT re-do)

I verified each against current code. **MASTER_TODO §6 must be corrected on these:**

| MASTER_TODO claim | Reality | Evidence |
|---|---|---|
| **ALL "R" (realtime) findings** — CampaignForm, useTrackingSyncStatus, useWebhookHealth, admin/Orders 7 bindings, seller/Orders 7 bindings, SheetReview | **ZERO `postgres_changes` remain outside `src/whatsapp/`.** R1a/b/c fully complete. | `grep -rn "postgres_changes" src/ \| grep -v src/whatsapp/` → only retirement comments |
| 4 tool pages (`BonCommandePage`/`BonLivraisonPage`/`DevisPage`/`FacturePage`) — **P1** "unbounded full fetch of the orders table for the distinct-client dropdown" | **FIXED.** All four now call `.rpc('distinct_clients', …)`. `fetchAllRows` there now hits `bons_commande`(0) / `bons_livraison`(0) / `devis`(3) / `factures`(0). | `BonCommandePage.tsx:175`, `FacturePage.tsx:172`, `DevisPage.tsx:168`, `BonLivraisonPage.tsx:219` |
| `collaborators/MediaBuyers` — **P2** "recomputed client-side by useMediaBuyerEarnings" | **FIXED by D5.** Hook now calls `mb_roster_earnings` RPC. | `src/hooks/useMediaBuyerEarnings.ts:208` |
| `collaborators/Sellers` — **P1** unbounded all-time seller orders | **FIXED by D5.** Now `.rpc('seller_roster_stats')`. | `src/pages/admin/collaborators/Sellers.tsx:276` |
| All 11 `components/analytics/*` + all 9 `components/dashboard/*` **P1 AF** findings | **FIXED by D2/D3.** **Zero** `fetchAllRows` remain in either tree. | `grep -rn "fetchAllRows" src/components/dashboard/ src/components/analytics/` → empty |
| `admin/DeliveryServices` — implied 1000-cap on cities/fees | **Already paginated** via `POSTGREST_MAX_ROWS` `.range()` loops. Only the N+1 survives. | `DeliveryServices.tsx:136-166` |
| `owner/Cities` — implied cap on master_cities (1132 rows) | **Already paginated** (`fetchAllMasterCities`). | `owner/Cities.tsx:186-202` |
| `admin/Webhooks` — "Standing 5s poll… runs even while the Gateways tab is displayed" | **Correct, but the proposed fix is wrong.** The `logs` query feeds the **tab badge count** (L263) and the KPI counters (L209-210). Gating on tab breaks the badge. See §3.3. | `Webhooks.tsx:124-137, 209-210, 263` |
| `useTrackingSyncStatus` — **P1** "two postgres_changes bindings… keeping the wal2json slot hot" | **Already removed by R1b** (was dead code — owner-only RLS). The whole file is now dead anyway. | `useTrackingSyncStatus.ts:66-70` |

---

## 2. THE P3 OWNER/REFERENCE PAGES — live row counts + cap reachability

**Every count below is from the live box, today.** Reference growth data: busiest business = **1797 orders in 107 days** (~1027/30d → ~12k/yr).

| Page | Table(s) queried | **Live rows** | Cap reachable? | Verdict |
|---|---|---|---|---|
| `owner/Businesses.tsx:149` | `businesses` + creator/plan joins | **7** | **No — 143× headroom.** At 1 new tenant/mo → **82 years**. | **DEFER** |
| `owner/OwnerDashboard` → `components/owner/OwnerPlatformDashboard.tsx:62` | `businesses`, `business_payments` (90d), `plans`, `users` (head-count only) | **7** / **0** / — | **No.** Same 7 rows. Payments already 90d-windowed; user counts already `head:true`+`count:exact` (correct). | **DEFER** |
| `owner/Payments.tsx:109` | `business_payments` + 3 joins | **0** *(zero rows platform-wide)* | **No.** 7 tenants × 12/yr = 84/yr → **~12 years**. | **DEFER** |
| `owner/Cities.tsx:186` | `master_cities` + `zones` + `provider_cities` | **1132** / 14 / **4279** | **N/A — already paginated.** Real finding = `syncProviderMappings` 9 sequential RTTs per save. | **DEFER** (see §4.2) |
| `owner/Zones.tsx:108,716` | `zones` `select('*, master_cities(id)')`; `fetchAllRows('master_cities','*')` | **14** / **1132** | **No.** Embedded arrays aren't subject to `db-max-rows`; `fetchAllRows` paginates. Payload-only (1132 city ids pulled to derive 14 counts). | **DEFER** |
| `admin/Trash.tsx:60` | `orders` where `date_deleted not null` | **5 total, max 5/business** | **No — ~17/yr → ~59 years.** | **DEFER** |
| `admin/Users.tsx:384` | `users select('*')` per business | **max 8 per business** (23 global) | **No — 125× headroom.** Real issue = `select('*')` pulls permissions JSON + banking + avatar_config (**avg 1292 B/row**) → ~10 KB total. Trivial. | **DEFER** |
| `admin/Webhooks.tsx:124` | `webhook_logs` `.limit(50)` | **5332** (max 5290/biz), **+137/day** | **No cap — `.limit(50)` is present.** But the query plan is the problem → **FIX the index**, §3.2. | **FIX (index only)** |
| `admin/Demands.tsx:187` | `seller_demands` / `mediabuyer_demands` | **5** / **0** | **No.** | **DEFER** |
| `admin/DeliveryServices.tsx` | `master_cities`, `company_fees`, `courier_fees` | 1132 / **538** / **446** | **No — already `.range()`-paginated.** Real finding = the N+1 → **FIX**, §3.1. | **FIX (N+1 only)** |
| `admin/RecurringCharges.tsx:156,191` | `recurring_charges`; `expenses` (month-bounded, `recurring_id not null`) | **13** / **121** (max 111/biz, ~13/mo) | **No.** The "Posted this month" reduce is over ~13 rows. | **DEFER** |
| `seller/Demands.tsx:139` | `seller_demands select('*')` | **5** | **No.** | **DEFER** |
| `seller/Payments.tsx:113` | `seller_ledger` view, `seller_payment_txns` | **12** / **21** | **No — ~1 row/seller/month → centuries.** *Registry says "all ledger tickets bare-selected" — accurate, but the page already uses the `seller_ledger` view + `seller_month_orders` RPC for the drilldown.* | **DEFER** |
| `mediabuyer/Campaigns.tsx:503` | `campaigns select('*')` (incl. media/audience jsonb) | **3** (max 2/biz), **avg 648 B/row** | **No — 500× headroom.** Whole table = ~2 KB. | **DEFER** |
| `mediabuyer/Demands.tsx:156` | `mediabuyer_demands select('*')` | **0** | **No.** | **DEFER** |

**Ruling: 13 of 15 P3 pages are pure DEFER.** Touching them is negative-value — it burns review budget and risks parity regressions on pages whose worst case is 2 KB of JSON. The two exceptions (`Webhooks`, `DeliveryServices`) are *not* cap problems; they're a query-plan problem and an N+1 problem respectively.

---

## 3. THE THINGS ACTUALLY WORTH DOING

### 3.1 `admin/DeliveryServices` "Auto Fill All" — **FIX, escalate P2 → P1**

Registry undersells this badly. Measured facts:

```
DeliveryServices.tsx:1934-1946   (courier variant; identical copy at :2822-2834 for companies)
    for (const city of cities) {
        await saveFeeRowByMasterCity(COURIER_FEES_TABLE, 'courier_id', courier.id,
                                     city.id, activeBusinessId, numericPrice, feeColumn);
    }
```
`saveFeeRowByMasterCity` (`:88-126`) = **2 sequential round-trips** (`select id … maybeSingle()` then `update` **or** `insert`).

Live box:
- `max_cities_per_courier` = **448**, `max_cities_per_company` = **436**
- → **448 × 2 = 896 sequential HTTP round-trips**
- Measured warm RTT to `api.igrowfast.com` (PostgREST via CF Tunnel): **~170–210 ms**
- → **~90–180 seconds** of a frozen button, best case ~27 s at 30 ms RTT.

Three compounding defects:
1. **Partial write, no rollback.** The `catch` (`:1948`) aborts mid-loop on first error → an arbitrary prefix of the 448 fee rows is committed.
2. **Optimistic UI lies.** `setFees(newFees)` (`:1929-1932`) paints **all 448 cities** at the new price *before* the loop; on partial failure the UI still shows every city updated. This is a **money table**.
3. Same silent-partial-write class as the import pages (§3.3) — worth fixing in the same wave for a shared pattern.

**Fix (convention-compliant):** replace the loop with a single bulk `upsert` on `(courier_id, master_city_id, "DigiCom Business")` — 1 round-trip, atomic. Requires the matching unique index (verify: `provider_cities` already has `idx_provider_cities_unique` on `(master_city_id, provider_type)` as precedent; `company_fees`/`courier_fees` need the equivalent checked/added). **Parity note:** the insert branch seeds the *other* fee column to 0 (`:120-122`) — the upsert must replicate this exactly, and must NOT clobber the sibling column on the update path. Flag, don't silently fix.

**Effort ~3h. Value: high — kills a 90-second freeze and a money-partial-write.**

### 3.2 `webhook_logs` composite index — **FIX (best value/effort in the tail, ~10 min)**

`EXPLAIN (ANALYZE, BUFFERS)` on the live box for `Webhooks.tsx:124-137`:
```
Limit (actual time=3.650..3.659 rows=50)  Buffers: shared hit=243
  -> Sort  Sort Key: created_at DESC   Sort Method: top-N heapsort  Memory: 45kB
       -> Index Scan using idx_webhook_logs_digicom_business  (actual rows=5290)   <-- ALL rows
Execution Time: 3.763 ms
```
The `.limit(50)` does **not** bound the work: Postgres reads **all 5290 business rows** then top-N sorts. Indexes present: `("DigiCom Business")`, `(provider_id)`, `(tracking_code)`, pkey. **No `(DigiCom Business, created_at DESC)`.**

Growth: **962 logs / 7 days** → ~50k/yr per busy business. Fired at `refetchInterval: 5000` = **12×/min per mounted admin**. At 50k rows: ~35 ms + ~2300 buffers, 12×/min, per admin — and it grows linearly forever.

**Fix:** `CREATE INDEX CONCURRENTLY idx_webhook_logs_biz_created ON public.webhook_logs ("DigiCom Business", created_at DESC);` → Index Scan Backward + Limit 50, **O(50)** forever, no sort. One migration line, zero frontend change, zero parity risk.

**Do NOT do what the registry suggests** (gate the poll on the active tab): the `logs` result feeds the **tab badge count** (`:263`) and the `processedLogs`/`failedLogs` KPI counters (`:209-210`), which render on the *Endpoints* tab. Gating breaks them.
> **Parity quirk to flag, not fix:** those counters/badge are computed over the `.limit(50)` window, so they already mean "of the last 50", not "total". Pre-existing. Leave it; log it.

### 3.3 Import pages — **FIX (real defect class, confirmed)**

`ImportAccessories.tsx:139-172` and `ImportProducts.tsx:183-255`. Registry claim **CONFIRMED**:

```
ImportAccessories.tsx:164   if (error) console.error('Accessory update failed', r.code, error);
ImportAccessories.tsx:167   if (error) console.error('Accessory insert failed', r.code, error);
ImportProducts.tsx:215      console.error('Product update failed', r.code, error);  … continue;
ImportProducts.tsx:228      console.error('Product insert failed', r.code, error);  … continue;
ImportProducts.tsx:250      if (paError) console.error('product_accessories insert', productId, paError);
```
Then unconditionally:
```
onSuccess: toast({ title: 'Import finished',
                   description: `Processed ${data.filter(d => d.status==='valid').length} product rows.` })
```
**The mutation never rejects.** Every row can fail and the user is told "Import finished — Processed 500 product rows." Silent partial import on catalog + cost_price (money).

Per-row cost: Accessories **1 RTT/row**; Products **up to 4 sequential RTTs/row** (upsert + `product_accessories` delete + `product_accessories` insert). At ~190 ms RTT a 500-row product import = **~6 minutes**.

**Also latent (flag, don't fix now):** the code-resolution queries are **bare selects with no `.range()`** — `ImportProducts.tsx:154-157` (`products`, live **162**) and `:167-170` (`accessories`, live **12**). Cap unreachable today, but if `products` ever exceeds 1000 the `existing_product_id` lookup silently misses → **the import INSERTS duplicate products instead of updating them**. Cheap to harden while you're in the file (`fetchAllRows`, or better: resolve server-side).

**Minimum viable fix (parity-safe):** collect failures into an array, keep the loop's `continue` semantics (parity), and surface `{ succeeded, failed[] }` in the toast + a failure table. **Do not** switch to a transaction — the current semantics are explicitly best-effort-per-row and changing that is a behavior change, not a bug fix. Batching (chunked upsert) is a separate, optional perf step.

### 3.4 `fetchAllRows` PAGE_SIZE coupling — **FIX (~30 min, latent wrong-money landmine)**

`src/lib/supabase.ts:26` — `const PAGE_SIZE = 1000;`
Loop termination (`:81`): `if (batch.length < PAGE_SIZE) break;`

Verified on the box:
```
supabase-rest env:               PGRST_DB_MAX_ROWS=1000
/opt/supabase-project/.env:      PGRST_DB_MAX_ROWS=1000
docker-compose.yml:              PGRST_DB_MAX_ROWS: ${PGRST_DB_MAX_ROWS:-1000}
```
**The invariant holds today.** But it is an *undocumented, unasserted coupling across two repos.* If anyone ever sets `PGRST_DB_MAX_ROWS=500` (a natural DB-protection move), PostgREST caps each page at 500, `batch.length (500) < PAGE_SIZE (1000)` → **the loop breaks after page 1** and **every `fetchAllRows` caller silently returns the first 500 rows** — including the money paths D4 was built to protect. Silent, no error, wrong totals.

**Fix:** derive the page size from the first response's `Content-Range` header, or terminate on `batch.length === 0` instead of `< PAGE_SIZE` (costs one extra empty round-trip, removes the coupling entirely). Add a comment naming the box `.env` key. ~5 lines.

Secondary (known, lower priority): offset-style `.range(from, from+999)` is serial — 50k rows = 50 sequential RTTs at ~190 ms = ~9.5 s. Post-D1..D5 no *hot* path hits that scale anymore (see §5), so **do not** rewrite to keyset now.

---

## 4. DEAD CODE — verified, safe to delete

### 4.1 Whole files (zero consumers — grep-verified)

| File | Evidence | Verdict |
|---|---|---|
| `src/components/orders/SyncTrackingStatus.tsx` | Only self-references. **git archaeology:** mounted in `336e6c7`, **unmounted in `e7ff57e`** — the commit that added `WebhookHealthIndicator`, its deliberate replacement. Dead long before D1. **D1b's finding CONFIRMED.** | **DELETE** |
| `src/hooks/useTrackingSyncStatus.ts` | Sole consumer is `SyncTrackingStatus.tsx` (dead) → transitively dead. `postgres_changes` already stripped by R1b; it's now just a fetch hook nobody calls. | **DELETE** |
| `src/hooks/useSellerCommissionTotals.ts` | **0 consumers.** Orphaned by **D2** (`git log -S` → commit `30def45`); `collaborators/Sellers.tsx:276` now uses `.rpc('seller_roster_stats')`. | **DELETE** |
| `src/lib/orderSearch.ts` | `orderMatchesTopSearch` has **0 real references** — the only grep hits are a *local variable* named `orderSearch` in the delivery wizards, plus a tombstone comment at `seller/Orders.tsx:2206`. Orphaned by D1 (server-side `search_*` RPCs). | **DELETE** |

**Server-side impact of deleting the tracking pill: NONE — verified.** The `sync-tracking-statuses` edge fn and both crons stay live and untouched:
```
jobid 2  | */15 * * * * | tracking-sync-every-15min      (active=true, last 5 runs succeeded)
jobid 15 | 0 3 * * 0    | tracking-sync-runs-retention-weekly
net._http_response: {"success":true,"run_id":null,"logged":false,"total":0,"changed":0}
```
> I chased a false alarm here and am recording the resolution so nobody re-chases it: `tracking_sync_runs.max(started_at)` = **2026-06-28** (17 days stale) looks like a broken cron. **It is not.** The edge fn only writes a run row when `total > 0` (`logged:false` when there's nothing to poll), and the retention job prunes >30d. Cron is healthy. **No ops issue. Do not file one.**

### 4.2 Dead *exports* in live files (~32 symbols)

Orphaned by D3/D5 moving the math server-side. `src/lib/analyticsDefinitions.ts` — **25 dead exports**:
`PENDING_STALE_DAYS`, `ACTIVE_USER_WINDOW_DAYS`, `PAID_ORDER_CAT`, `UNPAID_ORDER_CAT`, `SEMANTIC_TONES`, `AnalyticsOrder`, `isRevenueOrder`, `hasTrackingCode`, `isInDeliveryDenominator`, `isRateTouched`, `isReturned`, `isProvisional`, `deliveredRevenueForOrder`, `cogsForOrder`, `shippingCostForDelivered`, `returnFeeForOrder`, `deliveryTimestamp`, `placementTimestamp`, `returnTimestamp`, `overlapFraction`, `adSpendInWindow`, `payoutMonthOverlap`, `normalizeSource`, `ChartGrain`, `pickChartGrain`.
*(Still live: `isAdminPullback`, `pureRevenueForOrder`, `SHIPPING_STUCK_DAYS`, `LOW_STOCK_THRESHOLD`, `normalizePhone`, `isDelivered`, `isPaid`, `isConfirmed`, `isRateConfirmed`, `isFailed`, `inWindow`, `AnalyticsOrderItem`, `PLATFORM_SOURCE_MAP`.)*

`src/lib/commercialCommission.ts` — **7 dead exports**: `assignmentTimestampForMetrics`, `confirmationTimestampForMetrics`, `sumAssignedProductUnits`, `deliveryTimestampForMetrics`, `isDeliveredOnLocalDay`, `commissionAccruedForDeliveredOrder`, `totalAccruedForCommission`.
Also: `payoutOrderAttribution.sortOrdersFifo`, `dateBuckets.{BUSINESS_TZ, dateToBusinessYmd}`.

> **⚠️ RECOMMEND: DEFER these — do not delete.** These functions are the **parity reference implementation** that `admin_analytics_stats` / `seller_roster_stats` / `mb_roster_earnings` were ported *from*. Deleting them destroys the only readable spec for the SQL, and D-wave convention is *parity is the bar*. Deleting 32 symbols saves ~0 bytes at runtime (tree-shaken by Vite) and costs the ability to diff SQL against source. **Better: add a `@deprecated — server-side parity reference for <rpc>, not called at runtime` header to each file.** ~15 min, keeps the spec, marks the intent.

`src/hooks/useMetaAds.ts` has 11 dead exported hooks (`useVerifyMetaToken`, `useListMetaAdAccounts`, `useMetaCreateCampaign`, …). **Out of D7 scope** — these are built-ahead Meta API surface, never orphaned by D1..D5. Don't touch.

---

## 5. `fetchAllRows` — remaining callers, bounded vs unbounded

**D2/D3 are clean: zero `fetchAllRows` in `src/components/dashboard/` or `src/components/analytics/`.** The full-table-copy epidemic is dead.

### STILL UNBOUNDED (business-wide, all-time, heavy)

| Caller | Table | Live rows | Assessment |
|---|---|---|---|
| **`src/hooks/useTrackedOrders.ts:25,38`** | `company_parcels`, `courier_parcels` | **1715** / 20 | **WORST REMAINING — ESCALATE.** `staleTime: 0, refetchOnMount: 'always'`. Sole consumer `CustomerInsights.tsx:58` calls it **unconditionally at top level** — *before* the phone-length guard. `CustomerInsights` renders unconditionally inside `OrderViewDialog.tsx:546` + `SellerOrderViewDialog.tsx:509` (kept-mounted dialogs). → **Every order-view open re-downloads all business parcels.** At 50k parcels = 50 serial RTTs ≈ 9.5 s, per dialog open. Registry has it P1 in the hooks table. **Not D7 tail — needs its own slice.** |
| `src/components/CustomerInsights.tsx:73` | `orders` | 1797/biz | Phone-scoped (`ilike '%digits%'`) + debounced + ≥6-char gate. Leading-wildcard `ilike` is unindexable → seq scan of orders per search. Registry P2 (S). Real but bounded by user intent. |
| `src/pages/admin/Customers.tsx:235` | `orders` | 1797/biz | Full non-deleted business orders on page load. Registry P1. Not tail. |
| `src/pages/AdsHistory.tsx:413` | `ads_history` | **0** | Registry claims "full-business orders history" — **STALE**, it reads `ads_history` (empty). **DEFER.** |
| `src/hooks/useCampaignMetrics.ts:161` | `orders` + `order_items` | 1797/biz | Campaign-window filtered. Registry marks the hook `[x]`. |
| `src/pages/mediabuyer/Orders.tsx:131` | `orders` | 1797/biz | Registry P1. Not tail. |
| `src/pages/courier/{Dashboard:133, Orders:148}` | `courier_parcels` | **20** | Lifetime, no window — but 20 rows. **DEFER.** |
| `src/pages/{admin,seller}/ReturnNote.tsx:145,143` | `orders` `select('*'` + 5 joins) | 1797/biz | Registry P1. Not tail. |
| `src/components/delivery/{DeliveryNoteWizard:528,594, CourierDeliveryNoteWizard:164,242}` | `orders` | 1797/biz | Registry P2/`[x]`. Not tail. |

### NOW BOUNDED / SMALL (no action)

| Caller | Table | Live rows |
|---|---|---|
| `admin/Orders.tsx:807,870,878,885`, `seller/Orders.tsx:790,853,863,872`, both ChatCart dialogs, `OrdersExportWizard:284,329`, `ImportOrders:86,161,169`, `ImportCustomers:76`, `SheetReview:85` | `master_cities` / `courier_fees` / `company_fees` / `provider_cities` / `users` | 1132 / 446 / 538 / 4279 / 23 — **reference tables, correctly paginated.** D1 left the *list* on keyset RPCs; these are just dropdown feeds. |
| `useWebhookHealth.ts:52` | `webhook_logs` | **1-hour window** → ~6 rows. Bounded by design. |
| `useSellerLedger.ts:65,79` | `users`, `seller_ledger` | 23 / **12** |
| `useSellerLiveOwed.ts:102` | `seller_daily_earnings` | **135** |
| `seller/Statistics.tsx:140` | `seller_daily_earnings` | **135** |
| `admin/Trash.tsx:60` | `orders` (deleted) | **5** |
| `admin/Transactions.tsx:228` | `transactions` | **30** |
| `admin/ExpensesDetails.tsx:138` | `expenses` | **121** |
| `admin/Products.tsx:194` / `Accessories.tsx:208,237` | `products` / `accessories` | **162** / **12** |
| `owner/Zones.tsx:716` | `master_cities` | 1132 (2 pages) |
| `{BonCommande,BonLivraison,Devis,Facture}Page` | `bons_commande`/`bons_livraison`/`devis`/`factures` | **0 / 0 / 3 / 0** |
| `admin/Payments.tsx:124,142`, `SheetReview.tsx:76` | `orders` (filtered) | Registry P1/P2 — not tail. |

---

## 6. RECOMMENDED D7 SCOPE

**DO (≈7h total):**
1. `webhook_logs` composite index — **10 min**, one migration line. *Start here.*
2. `fetchAllRows` PAGE_SIZE decoupling + comment naming `PGRST_DB_MAX_ROWS` — **30 min**.
3. Delete 4 dead files; add `@deprecated` headers to `analyticsDefinitions.ts` + `commercialCommission.ts` — **45 min**.
4. `DeliveryServices` "Auto Fill All" → bulk upsert ×2 call sites, replicating the seed-sibling-to-0 quirk — **~3h**.
5. Import pages → surface `{succeeded, failed[]}`; harden the code-resolution selects — **~3h**.

**DON'T (explicitly out — negative value):**
- All 13 pure-DEFER P3 pages. Worst case is 2 KB of JSON and 82 years of headroom.
- `owner/Cities` `syncProviderMappings` 9 RTTs — bounded at 9 forever.
- Deleting the 32 dead exports — they're the server-side parity spec.
- `fetchAllRows` keyset rewrite — no hot path reaches that scale post-D1..D5.
- `useMetaAds` dead hooks — not a D-wave orphan.
- `useSellerLiveOwed` server-side SUM — 135 rows.

**ESCALATE out of D7:** `useTrackedOrders` / `CustomerInsights` (§5 row 1) — every order-dialog open re-downloads all business parcels with `staleTime:0`. Registry already has it P1. Needs its own slice, not the cleanup tail.

**Correct MASTER_TODO §6:** mark the 9 stale claims in §1 as `[x]`. Roughly a third of the remaining registry is already done.

---

### Key file paths
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/DeliveryServices.tsx` (`:88-126`, `:1925-1950`, `:2790-2836`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Webhooks.tsx` (`:124-137`, `:209-210`, `:263`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ImportProducts.tsx` (`:154-174`, `:183-262`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/ImportAccessories.tsx` (`:119-188`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/supabase.ts` (`:26`, `:81`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useTrackedOrders.ts` (`:20-46`)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/CustomerInsights.tsx` (`:58`, `:73`)
- Delete: `src/components/orders/SyncTrackingStatus.tsx`, `src/hooks/useTrackingSyncStatus.ts`, `src/hooks/useSellerCommissionTotals.ts`, `src/lib/orderSearch.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/MASTER_TODO.md` §6 (needs the §1 corrections)