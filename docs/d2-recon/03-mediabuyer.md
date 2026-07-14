# D2 Recon — MEDIA-BUYER Dashboard + Statistics: complete per-widget inventory

Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast`

## 0. Files and consumers

| File | Role |
|---|---|
| `src/pages/mediabuyer/Dashboard.tsx` | MB dashboard page (route `/mediabuyer/dashboard`) |
| `src/pages/mediabuyer/Statistics.tsx` | MB statistics page (route `/mediabuyer/statistics`) — EXISTS, fully mapped below |
| `src/hooks/useMediaBuyerStats.ts` | The shared stats engine (post-D4: entries AND orders both via `fetchAllRows`) |
| `src/hooks/useMediaBuyerEarnings.ts` | Monthly earnings engine (Dashboard "Vos gains" card via `selfMbId`; also admin Salaries / admin MediaBuyers / MB Payments) |
| Support | `src/lib/dateBuckets.ts` (Casablanca TZ), `src/lib/campaignConstants.tsx` (PLATFORM_SOURCE_MAP, CampaignDailyEntry type), `src/hooks/useStatusCategories.ts` (flag-driven status sets), `src/lib/supabase.ts:30` (`fetchAllRows`, PAGE_SIZE 1000, ordered by `id`), `src/hooks/useCurrentUserId.ts` |

`useMediaBuyerStats` consumers: ONLY `pages/mediabuyer/Dashboard.tsx` and `pages/mediabuyer/Statistics.tsx`.
`useMediaBuyerEarnings` consumers: MB `Dashboard.tsx` (selfMbId=self), MB `Payments.tsx`, admin `Salaries.tsx`, admin `collaborators/MediaBuyers.tsx` (admin surfaces are D2-adjacent; same engine).

## 1. Role visibility

- Route gate: `App.tsx:218-219` — `/mediabuyer/*` wrapped in `ProtectedRoute allowedRoles={['mediabuyer']}`. Index redirects to `dashboard`.
- Both pages render for the `mediabuyer` role only. No admin/seller reuse of these pages.

## 2. Queries fired today (exact)

`useMediaBuyerStats(range)` fires 4 queries + `useStatusCategories` fires 2. **Dashboard instantiates the hook TWICE** (filter range + a second all-time instance for the sparkline), so range-keyed queries (entries, orders) run twice with different windows; `mb-stats-campaigns` / `mb-stats-profile` keys are range-independent and dedupe across instances.

### Q1 `['mb-stats-entries', biz, uid, from, to]` (useMediaBuyerStats.ts:96-113)
- `fetchAllRows('campaign_daily_entries', '*')` — paginated 1000/page ordered by `id` asc.
- Filters (server-side): `"DigiCom Business" eq activeBusinessId` (from `localStorage.activeBusinessId`), `created_by eq currentUserId`, `entry_date gte range.from`, `entry_date lte range.to`.
- `enabled: !!activeBusinessId && !!currentUserId`.
- `entry_date` is a plain `YYYY-MM-DD` business-local day string; `platform` and `created_by` are denormalized onto the entry by trigger (survives campaign deletion — `campaign_id` nullable).

### Q2 `['mb-stats-campaigns', biz, uid]` (:117-130)
- `campaigns` `select('*')`, `eq('DigiCom Business', biz)`, `eq('created_by', currentUserId)`. Single request, no pagination.

### Q3 `['mb-stats-orders', biz, from, to, sourceList.join(',')]` (:143-170) — **THE per-widget private full-orders download D2 replaces**
- `fetchAllRows('orders', 'id, date, source_name, order_status_id, package_status_id, replace')`.
- Server filters: `"DigiCom Business" eq biz`, `date gte shiftYmd(from,-1)`, `date lte shiftYmd(to,1)+'T23:59:59.999Z'` (window widened ±1 calendar day because `orders.date` is timestamptz vs business-local day strings), `date_deleted is null`, `source_review_status neq 'pending'`.
- **Source filtering is CLIENT-side only**: server returns EVERY business order in the window (all sources, all sellers); client then keeps `o.replace !== true && lower(source_name) ∈ srcLower` where `srcLower` = distinct `getPlatformSource(entry.platform)` over Q1 results (case-insensitive).
- `enabled` only when `sourceList.length > 0` (no entries → no orders fetch).
- On Dashboard preset `'all'` (default!) `from='2020-01-01'` → downloads the entire business order history. The second (sparkline) hook instance is ALWAYS all-time → the full download happens on every Dashboard visit regardless of preset.

### Q4 `['mb-stats-profile', uid]` (:173-190)
- `users` `select('id, payment_type, commission_price, salary_amount')` `.eq('id', currentUserId).single()`.

### useStatusCategories (useStatusCategories.ts:117-141)
- `order_statuses` + `package_statuses` full flag projections, `staleTime: 5*60*1000`. Sets used here: `deliveredPkgIds` = ids where `is_delivered`; `pendingIds` = ids where `pending_confirmation` (NEW + REPORTER + RAPPEL retry queue).

### Dashboard-only extra queries (Dashboard.tsx)
- `['mb-dash-profile', uid]` (:86-98): `users` select `id, name, avatar_url, payment_type, commission_price, salary_amount` eq self single. (Greeting + name only.)
- `['mb-dash-today-entries', uid, todayKey]` (:100-113): `campaign_daily_entries` select `campaign_id` eq `created_by=self` eq `entry_date=todayBusinessYmd()` → Set of campaign_ids with a today entry.
- `useMediaBuyerEarnings(currentMonth, { selfMbId: currentUserId })` → 4 more queries (below).

### useMediaBuyerEarnings(month, {selfMbId}) queries (useMediaBuyerEarnings.ts)
1. `['mb-earnings-users', biz, selfMbId]` (:144-159): `users` select `id, name, email, avatar_url, avatar_config, phone, role, payment_type, commission_price, salary_amount, bank_name, bank_account_holder, bank_rib, cin_number, address, created_at, active` eq biz eq `role='mediabuyer'` (+ `eq id=selfMbId` when set — MB path fetches only own row, keeping peers' PII off the wire).
2. `['mb-earnings-entries', biz, month, mbIds]` (:163-178): `campaign_daily_entries` select `id, campaign_id, created_by, entry_date, platform, spend, leads`, eq biz, `in created_by [self]`, `entry_date` gte/lte month bounds. NOT paginated (plain select — 1000-row cap applies here; month-scoped so low risk, but note it).
3. `['mb-earnings-orders', biz, month, sources]` (:195-218): `fetchAllRows('orders', 'id, date, source_name, package_status_id, replace')`, same widened ±1d window over the month, same `date_deleted is null` + `source_review_status neq 'pending'`, same client-side `replace !== true` + source filter. **Second full business-orders month download on the same Dashboard mount.**
4. `['mb-earnings-prior', biz, month]` (:221-234): `mediabuyer_payments` select `id, mediabuyer_id, payout_month, total_amount, paid_amount, status, paid_at` eq biz eq `payout_month=month` — NO mediabuyer_id filter in code; RLS (`mediabuyer_payments_select_scoped`: `mediabuyer_id = auth.uid() OR admin`) is what confines an MB to own rows at runtime.

## 3. Client-side math (useMediaBuyerStats.ts:193-402)

Timezone: `toBusinessDate(iso)` = `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' })` → orders bucketed by **business-local calendar day**; entries already business-local day strings; `todayBusinessYmd()` same TZ.

Order classification (per order row):
- `confirmed` = `statusMapsReady && order_status_id != null && !pendingIds.has(order_status_id)` — i.e. NOT in `pending_confirmation` flag set. Guard: while `pendingIds` is empty (statuses not loaded), NOTHING counts as confirmed (prevents first-paint inflation).
- `delivered` = `package_status_id ∈ deliveredPkgIds` (`ps.is_delivered` flag), regardless of PAID/UNPAID cash state.

Attribution + dedupe:
- Orders bucketed by key `(toBusinessDate(o.date), lower(o.source_name))` → `{confirmed, delivered}` counts.
- Entries map platform→source via `PLATFORM_SOURCE_MAP` (campaignConstants.tsx:38-55; 12 platforms, e.g. `'facebook ads'→'facebook'`; unknown → `''`).
- **Daily rollup**: per `entry_date`, sum entry `spend`/`leads`; collect the set of sources seen that day; add each (day,source) bucket ONCE → two campaigns on the same platform+day do NOT double count in daily/platform/grand totals.
- **Platform rollup**: per `platform`, sum spend/leads, collect entry-date set, sum buckets for (day, platform-source) once per day.
- **Per-campaign rollup**: same, keyed by `campaign_id`; entries whose campaign is deleted/missing group under synthetic `__deleted__<platform>` row named `"(Deleted) <platform>"`, status `'deleted'`, currency `'MAD'`. **Per-campaign rows RE-COUNT the same (day,source) bucket for each campaign** — two same-platform campaigns each claim the full day's orders (documented, matches CampaignPreview behavior).
- **Grand totals** = Σ over daily rows (inherits dedupe), then `finalize`.

Derived (`finalize`, :63-72): `costPerLead = spend/leads`, `costPerConfirmed = spend/confirmed`, `costPerDelivered = spend/delivered`, `confirmRate = confirmed/leads`, `deliveryRate = delivered/confirmed`, `roas = revenue/spend`, `profit = revenue − spend`; each `null` when denominator is 0 (profit always computed).

Revenue: `delivered × users.commission_price` iff `payment_type === 'commission'`, else 0 (salary MBs see 0 revenue here).

Sorts: `perPlatform` by spend desc; `perCampaign` by **profit desc**. Currency = modal `campaigns.currency` else `'MAD'`.

### useMediaBuyerEarnings math (:237-336)
- Delivered-only buckets: `(businessDate, lower(source))` → count where `package_status_id ∈ deliveredPkgIds` (no confirmed dimension).
- Per MB: `total_spend = Σ entries.spend`; `daySourceSet = {(entry_date, source)}`; `delivered = Σ buckets over daySourceSet`; `campaigns_count = |{campaign_id ?? '__orphan__'+platform}|`.
- `salary_earned = salary_amount` if `payment_type='salary'` else 0; `commission_earned = delivered × commission_price` if `'commission'` else 0; `total_amount = salary + commission`; `prior_paid_amount = Σ mediabuyer_payments.total_amount` for (mb, month); `remaining_amount = max(0, total_amount − prior_paid)`.
- Quirk: header comment says salary users get `delivered_orders=0 / total_spend=0 / campaigns_count=0`, but the code computes real values for all three regardless of payment_type (server `mb_month_earned` returns delivered=0 for salary). Divergence to resolve in D2.

## 4. Widget-by-widget render inventory

### Dashboard (`/mediabuyer/dashboard`) — preset default `'all'`
Presets (Dashboard.tsx:52-77): `all` → from `'2020-01-01'`; `mtd` → month-01..today; `lastmonth` → full previous month; `30d` → today−29..today; `7d` → today−6..today. All ends business-TZ today.

| # | Widget | Data | Renders exactly |
|---|---|---|---|
| W1 | KPI strip (4 tiles) | `totals` of filter-range hook | `Dépenses`=fmtCur(totals.spend), `Revenus`=fmtCur(totals.revenue), `Livrées`=fmtNum(totals.delivered), `Confirmées`=fmtNum(totals.confirmed) |
| W2 | 14-day sparkline | `daily` from the SECOND (all-time) hook instance, client-filtered `date >= today−13` | Per day: `Livré`=delivered, `Revenu`=revenue.toFixed(2); date label `dd MMM` |
| W3 | Top campagnes (5) | `perCampaign.filter(spend>0).slice(0,5)` — profit-sorted (header text claims "Triées par revenu"; actual sort key is profit) | name, platform icon/color, `delivered` count, `ROAS` (`roas.toFixed(2)+'x'` or `—`), `revenue`, `spend` |
| W4 | À compléter | `campaigns.filter(status==='active')` minus `todayEntryCampaignIds` | Up to 5 campaign names + platform chip; count of extras |
| W5 | Actions rapides | static | nav buttons |
| W6 | Ce mois · Vos gains | `useMediaBuyerEarnings(currentMonth,{selfMbId}).rows.find(self)` | `remaining_amount` (fmtCur), `delivered_orders`, `campaigns_count`; hidden when no row |
| — | Header | profile + campaigns | greeting + firstName; active campaign count |

### Statistics (`/mediabuyer/statistics`) — preset default `'30d'`, plus custom range
Presets identical except `'all'` → from `'2000-01-01'` (**Dashboard uses 2020-01-01 — divergence**). Custom range: two-click single calendar; picked `Date`s formatted with browser-local `format(d,'yyyy-MM-dd')` (NOT business TZ — minor tz edge for users outside Casablanca).

| # | Widget | Data | Renders exactly |
|---|---|---|---|
| S1 | Hero KPIs (4) | `totals`, `campaigns`, `mediabuyer` | spend (+sub `daily.length` days of data), revenue (+sub `commission_price / livrée` when commission), campagnes actives = `campaigns.filter(active).length` (+`campaigns.length` total — range-independent), delivered (+sub deliveryRate %) |
| S2 | Secondary KPIs (7) | `totals` | leads, confirmed (+confirmRate), CPL, CPC, CPD (each `—` when null), confirmRate, deliveryRate |
| S3 | Chart (4 tabs) on `daily[]` | per-day: `Dépense`(2dp), `Revenu`(2dp), `Leads`, `Confirmées`, `Livrées`, `CPL/CPC/CPD`(2dp or null), `ConfRate/DelivRate`(%·2dp or null) | finance: areas Livrées+Revenu; volume: bars Leads/Confirmées/Livrées; cost: lines CPL/CPC/CPD; rates: areas % |
| S4 | Dépenses par plateforme | `perPlatform.slice(0,6)` | share `p.spend/totals.spend %`, `spend` and `revenue` per platform |
| S5 | Best/Worst day | `daily` sorted by revenue desc/asc | full date, `revenue`, `delivered`, `spend` (fmtCurFull) |
| S6 | Platform leaderboard | `perPlatform` (all) | spend, delivered, **column headed "CPL" but renders `p.costPerDelivered`** (Statistics.tsx:624 vs :644 — label/value mismatch to preserve or fix consciously in D2), revenue |
| S7 | Campaign leaderboard | `perCampaign.slice(0,10)` — profit-sorted (header claims "Top 10 par revenus") | name, status pill (`active`→Active, anything else incl. `'deleted'` → "Brouillon"), spend, delivered, revenue |
| S8 | Détail quotidien table | full `daily[]` + `totals` footer | per day: spend, leads, confirmed, delivered, CPL, CPC, CPD, %C, %L, revenue |

## 5. Refetch / staleTime

- `App.tsx:180`: `new QueryClient()` with NO defaultOptions → **staleTime 0, refetchOnWindowFocus true, refetchOnMount true**, default retries. Every MB stats/orders/entries/earnings query refires on each mount and window focus — the full-orders download repeats constantly.
- Exceptions: `useStatusCategories` staleTime 5 min; `useCurrentUserId` staleTime Infinity. No `refetchInterval` anywhere in these files.

## 6. MB-facing data rule — exact figure enumeration (RPC must expose NOTHING more)

Figures the MB receives today (all SELF-scoped):
1. **Own ad spend** (self-entered `campaign_daily_entries.spend`) — totals, per-day, per-platform, per-campaign.
2. **Own leads** (self-entered).
3. **Confirmed count** (business orders on own day+source buckets, NOT pending_confirmation).
4. **Livré count** (same buckets, `is_delivered`).
5. **Own commission revenue** = delivered × own `users.commission_price` (0 for salary MBs).
6. Derived from 1–5 only: CPL, CPC, CPD, confirmRate, deliveryRate, **commission-ROAS** (= own commission / own spend — NOT business ROAS), commission-profit (sort key only, never displayed).
7. Own monthly earnings: `remaining_amount`, `delivered_orders`, `campaigns_count` (+ own payments rows, own bank/PII on Payments page).
8. Own campaign metadata (name/platform/status/currency) and own profile (`payment_type`, `commission_price`, `salary_amount`).

NOT fetched / NOT displayed (must stay out of the RPC): order `price`/`raw_price`/any money column (orders projection is `id, date, source_name, order_status_id, package_status_id, replace` only), business gross/revenue, business ROAS/profit, other MBs' spend/entries/campaigns, seller identities, per-order rows of any kind. Rule references: MB-facing data rule + campaign-report-role-semantics ("MB only own commission"). The "spend/ROAS" shown here is the MB's OWN spend and OWN-commission ROAS — permitted per campaign-report semantics; D2 must keep exactly that semantic and never substitute business figures.

**Current leakage the RPC fixes**: Q3/earnings-orders ship EVERY business order (metadata) in the window to the MB client — source filtering is client-side — exposing whole-business order volume/timing incl. non-ad channels. Also `campaign_daily_entries` and `campaigns` RLS are tenant-wide `FOR ALL` (`*_tenant_all`, verified on box) → an MB can read PEERS' spend/entries via raw PostgREST today; only app code scopes by `created_by`. Per D2 convention, the RPC predicate MUST be `created_by = auth.uid()` (validated server-side), business passed as explicit `p_business` and checked against the caller's tenant.

## 7. Attribution key + join (for the RPC)

- **Attribution key**: `campaign_daily_entries.created_by` (denormalized from `campaigns.created_by` by trigger; `platform` denormalized likewise). Orphan-safe: entries with `campaign_id IS NULL` still attribute via `created_by`+`platform`.
- **Join**: business-TZ day of `orders.date` = `entry_date` AND `lower(orders.source_name)` = platform-source (`mb_source_norm`), scoped to business.
- **Server-side canonical already on the box** (reuse for D2): `public.mb_month_earned(p_mb, p_business_id, p_month)` — SECURITY DEFINER (note: D4 convention wants SECURITY INVOKER for the new aggregates), `(o.date AT TIME ZONE 'Africa/Casablanca')::date = e.entry_date`, `ps.is_delivered` flag join, `date_deleted IS NULL`, `source_review_status IS DISTINCT FROM 'pending'`, `coalesce(o.swap_only,false)=false`, `count(distinct o.id)`. Helpers: `mb_entry_days(p_business, p_created_by)` (jsonb of distinct entry (date,platform)), `mb_source_norm(p)` (IMMUTABLE platform→source CASE).

### Client vs server divergences to resolve in D2 (parity checklist)
1. **Exchange guard**: client filters `replace !== true`; server `mb_month_earned` filters `swap_only=false`. Currently coincident on the box (9 rows each, verified), but semantically different (exchange-order-model: `replace`=swap+optional-sale leg, `swap_only` gates commission). Payout truth = `swap_only`; pick one semantic explicitly.
2. **`source_review_status`**: client PostgREST `neq 'pending'` (SQL `<>`, drops NULLs) vs server `IS DISTINCT FROM` — moot in practice: column is NOT NULL default `'approved'` (0 NULLs, verified).
3. **Per-campaign bucket re-count** (client) vs `count(distinct o.id)` — RPC must reproduce the re-count for per-campaign rows AND the dedupe for daily/platform/grand totals, or consciously change and document.
4. **Salary users**: server delivered=0; client earnings hook computes real delivered/spend/campaigns for salary MBs.
5. **'all' preset epoch**: Dashboard `2020-01-01` vs Statistics `2000-01-01`.
6. **Confirmed guard**: client counts confirmed only after status flags load (`pendingIds.size>0`); server-side this is simply `NOT os.pending_confirmation` — flag-column semantics per D4 convention.
7. **S6 label bug**: "CPL" column renders costPerDelivered.

### RPC shape hint (what one windowed call must return to keep both pages pixel-identical)
Per (p_business, auth.uid()-validated MB, p_from, p_to), jsonb with: `totals` {spend, leads, confirmed, delivered, revenue}, `daily[]` {date, spend, leads, confirmed, delivered}, `per_platform[]` {platform, spend, leads, confirmed, delivered}, `per_campaign[]` {campaign_id|synthetic-deleted-key, name, platform, status, currency, spend, leads, confirmed, delivered}, plus `campaigns_meta` (id, name, platform, status for active/needs-attention), `today_entry_campaign_ids`, and a month-earnings object {remaining_amount, delivered_orders, campaigns_count}. All ratios/revenue/ROAS derivable client-side from own `commission_price` — or returned server-side; either way nothing beyond §6 items 1–8.

## 8. Query count today (Dashboard mount, default preset)
2× entries (all-time + filter window) + 2× full-orders downloads (all-time + filter; dedup when preset='all') + campaigns + profile ×2 keys + today-entries + earnings×4 (incl. a third orders month download) + status categories ×2 ≈ **13–14 requests**, three of which are paginated full-orders scans of the business. Statistics mount: entries + orders + campaigns + profile + statuses ≈ 6 (orders scan window = selected range).