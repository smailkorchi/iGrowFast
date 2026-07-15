# D7 recon — remaining P1/P2 data pages

**Method**: every §6 sweep claim re-verified against current code + the live box. Row counts measured, not assumed. Verdict tags: `STALE` (already fixed), `PARTLY STALE`, `CONFIRMED`.

**Headline**: only **2 of 7** items carry real value (Customers, DeliveryNoteWizard). Four are already fixed or have empirically unreachable caps. One is a correctness bug, not a perf bug. D7 is smaller than §6 implies.

---

## 0. Blast-radius measurements (live box, 2026-07-15)

| Metric | Value | Consequence |
|---|---|---|
| `orders` (not deleted) | 2 104 | Customers downloads all of them |
| confirmed orders w/ `company_id` | 1 484 | DNW downloads these **twice** |
| max `campaign_daily_entries` / campaign | **85** | 1000-cap unreachable ≈ 2.7 yr |
| max `seller_daily_earnings` / seller | **61** | 1000-cap unreachable ≈ 2.7 yr |
| `mediabuyer_payments` (whole DB) | **4** | 1000-cap unreachable ≈ decades |
| max `seller_ledger` / seller | **4** | fine |
| `courier_payment_notes` / `return_notes` / `parcels` | 12 / 1 / 20 | fine |
| max orders per (business, source) | 1 593 (`whatsapp`) | campaign worst case |
| `customers` table rows | 2 264 | trigger-maintained, already exists |
| orders with `replace = true` | 9 | parity lever |

---

## 1. `src/pages/admin/Customers.tsx` — **CONFIRMED P1. The one item that matters.**

### Current state
`useQuery(['customers-derived'])` (L230-L330) calls `fetchAllRows('orders', …)` pulling **every non-deleted, non-pending order** for the business with `master_cities`, `order_statuses`, `package_statuses` embeds, then builds the entire customer set client-side in a `Map` keyed by phone. Filtering, search, sort, pagination (`PAGE_SIZE = 12`) and the KPI strip all run over that in-memory array. `handleExport` (L385+) is **separate and already correct** — it pages the real `customers` table at 1000/batch.

### Exact defects
1. **Unbounded download.** 2 104 orders × ~8 columns + 3 embeds on every page mount, to render 12 rows. Grows linearly with order history forever. No cap bug (`fetchAllRows` pages correctly) — a **volume** bug.
2. **Client-side everything.** Search/sort/filter/paginate over the full array; `filteredData` recomputes on every keystroke.
3. **Two sources of truth in one file.** The list derives from `orders`; the export reads the `customers` table. They can disagree (see §1.3).

### 1.1 Reuse candidate A — `admin_analytics_stats` `'customers'` section (mig 20260715010000 L1239-L1390): **REJECT**
Returns *statistics only* — `total_customers`, `repeat_rate`, `new_customers`, `avg_customer_value`, top-8 cities, per-day trend. It is **windowed** (`p_from`/`p_to`), whereas the page's KPIs are all-time. It emits **no per-customer rows**, so it cannot back a list with search/pagination/drill-down. Not the right tool.

### 1.2 Reuse candidate B — the `customers` table: **ACCEPT for identity/sort/search, REJECT for aggregates**
The table already exists and is **trigger-maintained** (`trg_sync_customer_on_order_insupd` / `_delete` → `trg_sync_customer_from_orders` → `refresh_customer_from_orders`, both SECURITY DEFINER). RLS on (`customers_tenant_all`, tenant-scoped). Indexes already present and exactly right:
```
customers_business_phone_uniq  ("DigiCom Business", phone_normalized)  UNIQUE
idx_customers_last_order_at    (last_order_at DESC NULLS LAST)
idx_customers_business, idx_customers_phone_normalized, idx_customers_master_city_id
```
Carries `name, phone, phone_normalized, city_name, address, total_orders, total_spent, first_order_at, last_order_at, tags, notes, source`.

**Covers**: sort `recency` (`last_order_at` — indexed), `value` (`total_spent`), `frequency` (`total_orders`); search on name/phone/city.
**Does NOT cover**: `order_status_id` / `package_status_id` filters, `interactionScore` (needs confirmed ∧ delivered per order), the drill-down dialog's per-order list + chart. Those still need `orders`.

### 1.3 Parity analysis — two divergences, both quantified

**(a) Grouping key — divergent in theory, IDENTICAL in this data.**
- Page (L266): `order.phone?.replace(/[^0-9]/g, '')` — raw digits, **no** `0→212` conversion.
- Canonical `normalize_phone_for_customer` (live) and `analyticsDefinitions.normalizePhone` (L548-553) both map 10-digit `0XXXXXXXXX → 212XXXXXXXXX`.
- `admin/Customers.tsx` is the **only** consumer using the raw-digit key. `CustomersSection.tsx`, `ImportOrders`, `ImportCustomers`, WhatsApp contacts all use the canonical one. The D3 migration's "byte-identical to the client normalizePhone" comment refers to `analyticsDefinitions`, **not** this page.
- Measured: raw-digit keys **1720** vs canonical **1719** on the largest business. Gap fully explained — exactly **1** order has a phone that digit-strips to `''`; `count(DISTINCT)` counts `''` but ignores canonical `NULL`, **and the page already skips it** (`if (!phone) return;`). Canonical keys collapsing >1 raw variant: **0**.
- **Verdict: switching to the canonical key is a no-op on current data** and converges this page with every other consumer. Still a *semantic* change (future `06…`/`212…` mixing would merge where it used to split) → **flag to owner, but risk is empirically zero.**

**(b) `replace = true` legs — REAL divergence. This one bites.**
- Page **excludes** them (L262: `orders?.filter((o: any) => o.replace !== true)`).
- `refresh_customer_from_orders` has **no** `replace` filter → `customers.total_orders` / `total_spent` **include** swap legs.
- Measured: **8 customer rows** contaminated (9 replace orders DB-wide).
- **Consequence: you cannot reuse `customers.total_orders` / `total_spent` as-is** — 8 rows would silently change value. Either (i) add `and o.replace is distinct from true` to `refresh_customer_from_orders` + one-shot backfill (fixes the export path too, which today already shows the contaminated numbers), or (ii) recompute the two aggregates in the RPC from `orders`. **(i) is correct and cheap** — but it *changes the existing export's* numbers → owner call.

### 1.4 Proposed fix — D1-style keyset, two new RPCs
```
customers_list_page(p_business uuid, p_search text, p_sort text,
                    p_status_ids uuid[], p_package_ids uuid[],
                    p_cursor_* , p_limit int) -> setof
customers_kpis(p_business uuid, p_search text, …)  -- total / revenue / avgValue
customer_orders(p_business uuid, p_phone_normalized text) -> jsonb  -- drill-down
```
- SECURITY **INVOKER** + `current_user_is_business_admin()` gate (business-wide money aggregate → standing rule).
- Base = `customers`; status filters via `EXISTS (select 1 from orders …)` correlated on `(business, normalize_phone_for_customer(phone))` — **replicate the page's `.some()` OR-semantics** (a customer passes if *any* order matches).
- `interactionScore` = `successful×10 + totalOrders×2` — needs a confirmed∧delivered count; add as a column in the list RPC.
- **Index needed**: `orders (("DigiCom Business"), normalize_phone_for_customer(phone))` — expression index, does not exist yet. Required or the EXISTS subqueries seq-scan.
- Keyset cursor: `(last_order_at DESC, id)` for recency (index-backed); `value`/`frequency` sorts need `(total_spent DESC, id)` / `(total_orders DESC, id)` indexes added.
- Preserve the `package_statuses.label` fallback match (L347-352) — a genuine client quirk (matches by label when `package_status_id` is null).

**Effort: L** (~1 migration, 3 RPCs, 3 indexes, page rewrite ~200 LOC). **Value: HIGH** — largest remaining unbounded download, only page still shipping the whole order table to the browser, and it retires the page's second source of truth.

---

## 2. `useCampaignMetrics` (→ `CampaignManage.tsx`, `CampaignPreview.tsx`) — **PARTLY STALE. P2.**

### Sweep claim vs reality
| §6 claim | Verdict |
|---|---|
| "`campaign_daily_entries` bare select 1000-cap" | **CONFIRMED but inert.** L104-113 is `.select('*')` with no `.range()`. Max entries/campaign = **85**. Cap needs ~2.7 yr of daily entries on one campaign. Not a live defect. |
| "full-range raw-orders fetch" | **CONFIRMED.** L152-176. |
| "1000-cap on orders" | **STALE.** Already `fetchAllRows` — pages correctly, comment on L158 says so explicitly. |
| "client aggregation" | **CONFIRMED.** L179-260. |

### Exact remaining defect
Downloads every order matching `(business, source ILIKE, date ±1d)` **with `order_items` embedded**, to produce ~85 daily buckets of `{confirmed, delivered, adminGrossRevenue}`. Worst case measured: **1 593** orders (`whatsapp` source). A Meta campaign hits ~302. Cost scales with *source volume*, not campaign size — a 7-day campaign on a hot source still pulls the source's whole date-window history.

### Proposed fix
New `campaign_metrics(p_campaign uuid) -> jsonb` returning per-day `{date, spend, leads, confirmed, delivered, admin_gross_revenue, mb_commission_revenue}` + totals.
- **`mb_dashboard_stats` (mig 20260714230000 L1623) is the exact precedent** — same `(Casablanca day, lower(source_name))` bucketing, same `pendingIds`/`is_delivered` semantics. Port its CTEs.
- **Role gating is mandatory and non-obvious**: the hook computes *both* revenue bases and picks by URL prefix (`basePath.startsWith('/mediabuyer')`). A server RPC must **not** return `admin_gross_revenue` to a media buyer — MB-facing data rule. Follow `mb_dashboard_stats`'s choice: return **counts only**, let the client derive commission from its own `commission_price`, and gate `admin_gross_revenue` behind `current_user_is_business_admin()`.
- Quirks to replicate: `replace === true` skip (L189); `statusMapsReady` empty-set guard (L185 — if `pendingIds` is empty, **nothing** is confirmed); ±1-day widening + client re-bucketing (L163-168); `source_name ILIKE` (not `=`).

**Effort: M** (1 RPC, mostly ported from `mb_dashboard_stats`; 2 pages unchanged — hook-internal). **Value: MEDIUM** — real but bounded; two low-traffic pages.
**Cheap alternative (effort XS)**: add `.range(0, 999)`-style bounding to the entries select purely as cap insurance. Not worth a migration on its own.

---

## 3. `src/pages/mediabuyer/Statistics.tsx` — **MOSTLY STALE. P3.**

### Sweep claim vs reality
"'Tout' preset = 2000-01-01 → full order history via `useMediaBuyerStats`" — **STALE on the client side.** D2 already converted `useMediaBuyerStats` to a single `mb_dashboard_stats` RPC (hook L118-133; its docstring documents the conversion). `Statistics.tsx` itself contains **zero** `.from()` / `.rpc()` / `fetchAllRows` calls — it is pure presentation.

### Residual defect (real, but relocated)
`computePreset('all')` still returns `{ from: '2000-01-01', to: today }` (L90). The download is gone; what remains is a **server-side full-history scan** inside `mb_dashboard_stats` — the RPC scans `campaign_daily_entries` + `orders` from 2000-01-01. Cost is now one bounded jsonb response, so it's a DB-CPU issue, not a payload issue.

### Proposed fix — pure reuse, no new SQL
**`mb_entry_days(p_business uuid, p_created_by uuid)` already exists** (mig 20260714210000 L707, live-verified). Call it to get the MB's real first entry day and clamp `from` to it instead of `2000-01-01`. Falls back to `2000-01-01` if it returns nothing.

**Effort: XS** (one hook call + one `Math.max`-style clamp, no migration). **Value: LOW-MEDIUM** — removes a pointless 25-year scan for a preset users do click. Best effort/value ratio in the tail; do it if `mb_entry_days`'s shape fits (verify it returns a min date, not just a count).

---

## 4. `src/pages/courier/Payments.tsx` — **CONFIRMED but tiny. P3.**

### Current state
Three unbounded fetches, all courier-self-scoped under RLS:
- L109-127 `earnedThisMonth`: `courier_parcels` (month-windowed on `delivered_at`) + **all** `courier_fees` for the courier → client fee-map join.
- L149-163 `notes`: **all** `status='paid'` `courier_payment_notes` + nested `line_items` — lifetime, no window.
- L170-184 `returnNotes`: **all** `status='received'` `courier_return_notes` + nested `line_items` — lifetime.
- L186-218 `stats`: every KPI (lifetime + this-month) reduced client-side. L221-238: client-side search over notes **and their line items**.

### Exact defect
Lifetime note history + all line items downloaded to render KPIs and a searchable list. Measured blast radius: **12 payment notes, 1 return note, 20 parcels DB-wide.** Correct in principle, ~free in practice.

### Reuse assessment — **both D4/D5 courier RPCs are unusable here**
- **`courier_notes_detail` (D5, mig 20260715030000 L335): BLOCKED by design.** It raises `42501` unless `current_user_is_business_admin()`. Its own docstring states: *"The courier-facing note surfaces (courier/Payments.tsx) read their own rows directly under RLS and are **untouched**."* D5 deliberately excluded this page. It also omits `line_items`, which the page needs.
- **`courier_self_stats` (D4, mig 20260714210000 L594): different semantics.** It requires `courier_delivery_notes.is_finalized = true` (the page doesn't) and returns *lifetime* `pending_earnings = delivered_gross − paid_sum`. The page wants *this-month earned* from `delivered_at` + a `courier_fees` fallback (`include_delivery_in_total ? shipping_cost : fee[city]`). Not a drop-in; already correctly used by `courier/Dashboard.tsx` L211 for its own KPIs.

### Proposed fix
New `courier_self_payments(p_courier, p_business) -> jsonb` — courier-self (NO admin gate; RLS-invoker, `p_courier = auth.uid()` assertion), returning the KPI block + windowed note pages. **Effort: M** (new RPC + page rewrite; no existing RPC to lean on). **Value: LOW.**
**Recommendation: DEFER.** 13 notes total. Revisit when note volume passes ~500. Only cheap win: replicate the `include_delivery_in_total ? shipping_cost : fee` rule server-side if it ever drifts from `courier_self_stats`'s `order_shipping` — a real semantic fork worth a code comment now.

---

## 5. `src/pages/seller/Wallet.tsx` + `src/pages/seller/Payments.tsx` — **Wallet inert, Payments already fine. P3.**

### `Wallet.tsx` — CONFIRMED but unreachable
L57-61: `seller_daily_earnings.select('*').eq('seller_id', …).order('date', desc)` — no `.range()`, so the **1000-row PostgREST cap applies**. Also: no `"DigiCom Business"` filter (relies on RLS/seller scope), month stats reduced client-side (L67-88), client search + `itemsPerPage = 8` pagination (L110-116).
Measured: max **61** rows per seller. One row/day → cap reached in **~2.7 years**. Real but not live.
Note a genuine quirk to preserve: `salary: 0` is hardcoded in the month reducer (L74) — `salary_earned` is deliberately dropped. Don't "fix" it.

**Proposed fix**: bound the fetch — `.gte('date', <earliest rendered>)` or `.range(0, 999)` as cap insurance; optionally push month stats into the existing seller dashboard RPC family. **Effort: XS** (bound) / **M** (RPC). **Value: LOW.** Take the XS bound; skip the RPC.

### `Payments.tsx` — effectively **already fixed**, no action
- L113-118 `seller_ledger`: monthly ticket rows, max **4** per seller. Bare select is fine.
- L141-145 `seller_payment_txns`: `.in('seller_payment_id', ids)` — bounded by ticket count.
- L184 drill-down already goes through the **`seller_month_orders` RPC**.
The §6 grouping of this file with Wallet is misleading — it carries no meaningful defect. **Recommend: drop from D7.**

---

## 6. `src/pages/admin/Salaries.tsx` — **cap claim inert; the N+1 is a CORRECTNESS bug. P2.**

### 6a. MB tab bare select — CONFIRMED but unreachable
L632-641: `mediabuyer_payments.select('*, mediabuyer:users!fk(…)')` with an error-fallback re-query on a different embed alias, no `.range()`. Then client filter + `PER_PAGE` slice + client `stats` reduce (L737+).
Measured: **4 rows in the entire DB.** Rows accrue at ~1/MB/month → cap is decades away.
**Value: NEGLIGIBLE.** Recommend **drop**. (`mb_roster_earnings(p_business, p_month, p_mb)` from D5 exists and already backs the earnings side.)

### 6b. Bulk `pay_seller` N+1 loop — **CONFIRMED, and it's the real find here**
L1137-1149:
```ts
for (const t of targets) {
    const { error } = await (supabase as any).rpc('pay_seller', {…});
    if (error) throw error;   // ← aborts mid-loop
}
```
**This is not a perf problem — it's an atomicity problem.** If `pay_seller` fails on target *k*, targets `0..k-1` are **already committed** and `k..n` never run. The mutation throws, the toast says "Error", and the operator has no indication that a partial payout landed. Re-running the flow **double-pays** the sellers that already succeeded. Money-touching, matches the "ALWAYS pay via `pay_seller`" ledger rule but violates all-or-nothing.

Note the asymmetry: the **MB branch of the same mutation** (L1167-1174) is a single `.upsert(payload)` — atomic. Only the seller branch loops.

**Proposed fix**: `pay_sellers_bulk(p_business uuid, p_targets jsonb, p_paid_at timestamptz, p_note text)` — one transaction looping `pay_seller` server-side; whole batch commits or rolls back. SECURITY INVOKER + admin gate. **Effort: S** (thin wrapper over the existing `pay_seller`; no new payout logic — the ledger rule is preserved because it still calls `pay_seller`). **Value: MEDIUM-HIGH** — low-probability, high-severity, money-correctness. **This is the highest value-per-effort item in D7.**

---

## 7. `src/components/delivery/DeliveryNoteWizard.tsx` — **CONFIRMED P1. Two distinct defects.**

### 7a. Provider step downloads 1 484 orders to compute a count map
L528-547 (`availableProviders`): `fetchAllRows('orders', 'id, company_id, master_city_id, seller_id, items:order_items(product_id), company:providers(…)')` over **all** confirmed orders with `company_id not null`. The entire result is consumed by L557-570 — a `Map<providerId, number>` plus one provider object each. **1 484 rows + their `order_items` + a providers embed, to render a per-provider badge count.**
The `order_items` embed exists only for `orderMatchesSellerProducts` in the `sellerScope` branch — **it is fetched unconditionally even for admins who never use it.**

**Fix**: new `wizard_provider_counts(p_business, p_status uuid, p_seller uuid, p_product_ids uuid[]) -> jsonb` — `group by company_id` + provider join, returns ~5 rows. **Effort: S.** **Value: HIGH** (~1 484 rows + embeds → ~5 rows, on every wizard open).

### 7b. Select-orders step fetches ALL providers then filters client-side
L594-616 (`ordersGrouped`): `fetchAllRows('orders', '*, city, company:providers(…), items:order_items(*, product:products(name, code))')` with the **same** filters as 7a — i.e. **all** confirmed orders for **every** provider — and only then, at **L634**, discards the ones that don't match:
```ts
if (selectedProviderId !== 'all' && providerId !== selectedProviderId) return acc;
if (lockProviderId && providerId !== lockProviderId) return acc;
```
`selectedProviderId` is **known before the query** (it's in the queryKey at L592). Pushing it into the filter list is a one-line change.

Two separable fixes:
1. **Server-side provider filter (effort XS, value HIGH)** — add `{ column: 'company_id', op: 'eq', value: selectedProviderId }` when `selectedProviderId !== 'all'` (and honour `lockProviderId`). Cuts the fetch by the provider ratio with zero semantic risk. **Do this regardless.**
2. **Full row payload** — `select('*')` + nested items + products is **justified**: these rows feed carrier parcel-creation payloads (`createParcelsMutation`, and `refetchOrderForRetry` at L879 re-pulls the identical shape). Do **not** trim the projection. The `'all'` case legitimately needs every provider's orders.

**Combined effort: S.** **Value: HIGH** — 1 484 rows downloaded twice per wizard open, and the batch-parcel path (200-parcel Coliaty runs are live) makes this the hottest of the two.

---

## 8. Recommended D7 scope — ranked by value ÷ effort

| # | Item | Effort | Value | Call |
|---|---|---|---|---|
| 1 | **DNW 7b.1** — push `company_id` into the filter | XS | HIGH | **DO** — one line, zero risk |
| 2 | **Salaries 6b** — `pay_sellers_bulk` atomic wrapper | S | MED-HIGH | **DO** — money correctness |
| 3 | **DNW 7a** — `wizard_provider_counts` RPC | S | HIGH | **DO** |
| 4 | **MB Statistics §3** — clamp `'all'` via existing `mb_entry_days` | XS | LOW-MED | **DO** — pure reuse, no migration |
| 5 | **Customers §1** — `customers_list_page` + `customers_kpis` + `customer_orders` + 3 indexes | L | HIGH | **DO** — the flagship; needs 2 owner rulings first |
| 6 | **useCampaignMetrics §2** — `campaign_metrics` RPC | M | MED | **OPTIONAL** — port of `mb_dashboard_stats`; defer if D7 is tight |
| 7 | **Wallet §5** — bound the fetch | XS | LOW | **OPTIONAL** — cap insurance only |
| 8 | courier/Payments §4 | M | LOW | **DEFER** — 13 notes; no reusable RPC |
| 9 | Salaries 6a (MB bare select) | S | NEGLIGIBLE | **DROP** — 4 rows |
| 10 | seller/Payments §5 | — | NONE | **DROP** — already correct |

### Owner rulings required before item 5 lands
1. **Grouping key**: adopt canonical `normalize_phone_for_customer` (0→212) on Customers.tsx? Converges it with Analytics/imports/WhatsApp. **Measured impact on current data: zero** (0 keys collapse >1 variant; the 1720/1719 gap is the single empty-phone order the page already skips).
2. **`replace` legs in `customers`**: `refresh_customer_from_orders` lacks a `replace` filter, so `total_orders`/`total_spent` include swap legs on **8 rows** — and today's **CSV export already ships those contaminated numbers**. Fix the trigger + backfill (changes export output), or recompute both aggregates from `orders` in the RPC (leaves the export wrong)?

### Corrections to `docs/MASTER_TODO.md` §6
- `useCampaignMetrics` "orders 1000-cap" → **STALE**, already `fetchAllRows`.
- `useCampaignMetrics` / `Wallet` / `Salaries` "1000-cap" → **inert**: measured maxima 85 / 61 / 4. Years from biting.
- `mediabuyer/Statistics` "full order history via useMediaBuyerStats" → **STALE** client-side (D2 converted it); residual is a server-side scan only.
- `seller/Payments.tsx` → **no defect**; already on `seller_month_orders`.
- `courier/Payments.tsx` → **not reachable via `courier_notes_detail`** (admin-gated by design; D5 explicitly excluded this page).
- Salaries "bulk pay_seller N+1" is filed under perf — it is a **partial-payout atomicity bug**, and should be reclassified.

### Files (absolute)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Customers.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useCampaignMetrics.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useMediaBuyerStats.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/mediabuyer/Statistics.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/courier/Payments.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Wallet.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Payments.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Salaries.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/delivery/DeliveryNoteWizard.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/analyticsDefinitions.ts` (L548 canonical `normalizePhone`)
- Migrations: `supabase/migrations/20260714210000_d4_money_aggregates.sql`, `…20260714220000_d1_orders_list.sql`, `…20260714230000_d2_dashboard_stats.sql`, `…20260715010000_d3_analytics_stats.sql`, `…20260715030000_d5_leaderboards.sql`