# D7 Recon — App-wide levers (1) global QueryClient defaults, (2) `useTrackedOrders`

Every claim below was verified against **current** code (post-D1..D5) and the **live box**. MASTER_TODO §6 rows are marked STALE / STILL-TRUE explicitly.

---

## 0. Executive summary — the two levers are NOT what the brief assumed

| Lever | Brief's premise | Verified reality | Verdict |
|---|---|---|---|
| (1) App.tsx QueryClient | "a refocus now re-fires those [heavy] RPCs" | **FALSE.** Every D1–D5 heavy RPC already sets `staleTime: 60_000` inline. `refetchOnWindowFocus: true` only refetches **when stale** → a refocus inside 60s is a no-op. The heavy pages are already protected. | Premise wrong; **but a different, worse bug found** (§1.4 — cache is never cleared on sign-out). Real remaining win = `retry: 3` and the ~295 unprotected satellite queries. |
| (2) `useTrackedOrders` | "several pages had their tracked-set moved server-side" | **CONFIRMED, and further than assumed.** Blast radius collapsed from ~6 dashboards to **exactly ONE consumer**: `src/components/CustomerInsights.tsx:58`. | **Cannot be deleted** (that one consumer is real) but the hook is 100% wrong for its only caller. **Delete the hook, inline a scoped query.** ~30 LOC, exact parity, no migration. |

**The single highest-value D7 item is not on the brief's list**: the global QueryClient is never `.clear()`-ed on `SIGNED_OUT`, and logout/login are pure client-side `navigate()` — the SPA never reloads. This is a live cross-account data-leak window today, and it is the **hard precondition** for any global `staleTime` increase.

---

## 1. LEVER 1 — `src/App.tsx:180` global QueryClient

### 1.1 The literal fact

```ts
// src/App.tsx:180
const queryClient = new QueryClient();
```

No `defaultOptions`. Effective defaults (v5.83.0, `package.json:50`):
`staleTime: 0` · `gcTime: 5min` · `refetchOnMount: true` · `refetchOnWindowFocus: true` · `refetchOnReconnect: true` · `retry: 3` (exponential backoff, capped 30s).

### 1.2 Scope — smaller than it looks

The app runs **two** QueryClients:

| Client | File | Wraps | Defaults |
|---|---|---|---|
| Global (bare) | `src/App.tsx:180` → `:183` `QueryClientProvider` | Everything **except** WhatsApp | none |
| `waQueryClient` | `src/whatsapp/lib/queryClient.ts:29` | WA subtree via `WaShell.tsx:17` **and** `waChannels.tsx:138,200` (layout-level, outside WaShell) | `staleTime: 15s`, `gcTime: 5min`, `refetchOnWindowFocus/Reconnect/Mount: true`, `retry: 1`, `mutations.retry: 0` + a `MutationCache.onError` toast |

**Consequence:** a global-default change touches **355 of 395** `useQuery` call-sites (40 are WA and already insulated). `src/whatsapp/lib/queryClient.ts:1-27` is a fully-written, battle-tested policy **and its header comment explicitly says why it was scoped rather than made global**: *"the rest of the admin app assumes the bare defaults"*. That comment is the counter-argument to this whole lever and must be answered, not ignored.

### 1.3 Quantified — what the defaults mean NOW

Measured by AST-ish scan of all `useQuery({...})` blocks:

```
TOTAL useQuery blocks: 395  |  WA (insulated): 40  |  ECOM (global client): 355
ECOM with NO staleTime:  295   (83%)
ECOM with    staleTime:   60   (17%)
ECOM with explicit retry:  2   (owner/Backups.tsx:51,52 → retry: 1)
ECOM with gcTime:          0
```

**The 60 that DO set staleTime are exactly the ones that matter.** Full list of the D-wave money/heavy RPCs — all already covered:

| Query | File:line | staleTime |
|---|---|---|
| `['dash-stats','admin',…]` `admin_dashboard_stats` | `pages/admin/Dashboard.tsx:58` | 60_000 |
| `['dash-stats','seller',…]` | `pages/seller/Dashboard.tsx:129` | 60_000 |
| `['dash-stats',…]` courier | `pages/courier/Dashboard.tsx:121` | 60_000 |
| `['analytics-stats',…]` `admin_analytics_stats` | `pages/admin/Analytics.tsx:94` | 60_000 |
| seller Statistics | `pages/seller/Statistics.tsx:121` | 60_000 |
| MB stats | `hooks/useMediaBuyerStats.ts:134` | 60_000 |
| `['orders-page']` / `['orders-kpis']` admin | `pages/admin/Orders.tsx:760,779` | 60_000 |
| `['orders-page']` seller (+4 more) | `pages/seller/Orders.tsx:1462,1507,1529,1598,2266` | 60_000 |
| SalesComparatifChart / SellerSelfPerformance | `…:93` / `…:81` | 60_000 |
| seller commission totals | `hooks/useSellerCommissionTotals.ts:56` | 60_000 |
| status masters / package resolver | `useStatusCategories.ts:127,140`, `usePackageStatusResolver.ts:41,55` | 5min |
| order-view / history / parcel-tracking dialogs | `OrderViewDialog.tsx:152,183,196,219`, `SellerOrderViewDialog.tsx:134,164,176`, `ParcelTrackingDialog.tsx:58`, `OrderStatusHistoryDialog.tsx:63,89` | 30s / 5min |
| Meta/GA external APIs | `useMetaAds.ts` ×11, `useGoogleAnalytics.ts:184,207,334` | 2–60min |
| `useCurrentUserId` | `hooks/useCurrentUserId.ts:15` | **Infinity** |

**→ A global `staleTime: 30s` would change nothing for any of these.** It only affects the 295 satellites: dropdown/reference queries (`cities-dropdown`, `couriers-dropdown`, `company-fees-all`, `zones`, `master-cities`, `provider-cities-all`, `products-dropdown`…), the D2 metadata leftovers, and the not-yet-swept pages (Payments, Expenses, Transactions, DeliveryNote, ReturnNote, Users, Salaries, tools/*).

**Real per-focus cost today** (admin lands on Orders, alt-tabs away 2min, alt-tabs back): the ~25 `*-dropdown` / `*-all` reference queries in `pages/admin/Orders.tsx:803-1011` all refire. That is the actual refocus storm — **not** the RPCs. Same shape on `seller/Orders.tsx:786-984` and duplicated again inside `AdminChatCartOrderDialog.tsx:378-523` / `SellerChatCartOrderDialog.tsx:376-550` (same keys → deduped by the cache, so no extra network).

### 1.4 🔴 BLOCKER — the global cache is never cleared on sign-out

**Verified chain:**

- `components/layout/Sidebar.tsx:271-273` — `await supabase.auth.signOut(); localStorage.removeItem('activeBusinessId'); navigate('/auth');`
- `components/layout/SellerSidebar.tsx:90-91` — `await supabase.auth.signOut(); navigate('/auth');` — **does not even remove `activeBusinessId`** (adjacent finding).
- `components/auth/ProtectedRoute.tsx:74-75` — on `SIGNED_OUT` → `navigate('/auth')`. Nothing else.
- `pages/Auth.tsx:84-88` — post-login → `navigate('/seller/dashboard')` etc.
- `grep -rn "location.reload" src/ | grep -v whatsapp` → **zero hits.**
- `grep -rn "queryClient.clear" src/ | grep -v whatsapp` → **zero hits.**

So: **logout → login as a different user never unmounts the SPA and never clears the global cache.** Compare `src/whatsapp/lib/queryClient.ts:59-60`, which does exactly this for the WA client and documents why.

**Today this is masked, not fixed.** `staleTime: 0` makes every entry instantly stale, so on remount RQ refetches — but RQ is *stale-while-revalidate*: it renders **user A's cached rows first**, then swaps. So there is already a ~1-paint cross-tenant flash.

Worse, for the query keys that **do not include `businessId`**, user A's data is served and (if A and B share nothing to invalidate it) can persist:

```
'current-profile'         Sidebar.tsx:251, OwnerSidebar.tsx:62, CourierSidebar.tsx:45, admin/Profile.tsx:30
'profile-self'            ProfileScaffold.tsx:26
'seller-profile'          SellerSidebar.tsx:72
'mediabuyer-profile'      MediaBuyerSidebar.tsx:115
'products'                admin/ImportOrders.tsx:90        ← no businessId in key
'company-zones-all'       admin/ImportOrders.tsx:144       ← no businessId in key
'zones'                   owner/Zones.tsx:108, owner/Cities.tsx:587, DeliveryServices.tsx:1776,2042
'plans' / 'plans-active'  owner/Plans.tsx:78, AddEditBusinessModal.tsx:61
'businesses'              owner/Businesses.tsx:149
'owner-users'             owner/Users.tsx:86
'master-cities'           admin/ImportOrders.tsx:82, admin/ImportCustomers.tsx:73, owner/Cities.tsx:599
'provider-cities-all'     admin/Orders.tsx:882, seller/Orders.tsx:869, both ChatCartOrderDialogs
'user-role'/'currentUserRole'/'current-user-role'  owner/Cities.tsx:543, owner/Status.tsx:143, owner/Zones.tsx:92
'email-accounts'          owner/EmailTemplates.tsx:42, EmailTemplateModal.tsx:54
'behaviors','statuses'    owner/Status.tsx:143,159,1448,1460
'platform-settings-bank'  SuspensionOverlay.tsx:73, owner/Payments.tsx:129
```

**`ImportOrders.tsx:90` (`['products']`, no biz) and `ImportOrders.tsx:144` (`['company-zones-all']`, no biz) additionally collide across businesses within one session** — an independent live bug, unrelated to staleTime.

**⚠️ Setting a global `staleTime > 0` converts a one-paint flash into N seconds of confidently-rendered wrong-tenant data with no refetch at all. `queryClient.clear()` on `SIGNED_OUT` is a HARD PRECONDITION, not a nice-to-have.**

### 1.5 What genuinely depends on the aggressive defaults

Answering the brief's exact question — enumerated, not guessed:

**(a) Auth / session — NOT react-query at all. No risk.**
`App.tsx:114-160` `BusinessGuard` and `ProtectedRoute.tsx` both use raw `useEffect` + `supabase.auth.getUser()` + direct `.from('users')` / `.from('businesses')` selects. The suspension gate (`App.tsx:167` `isSuspended`) is `useState`, not cached. **The entire auth/permission path is immune to a QueryClient default change.** The only react-query auth-adjacent entries are `useCurrentUserId` (already `Infinity`) and the `current-profile` family (§1.4).

**(b) Realtime-adjacent — immune by construction.**
`invalidateQueries()` marks stale **and** refetches active observers **regardless of `staleTime`**. So `src/components/realtime/EcomBizRealtime.tsx:65-99` is unaffected by any staleTime change. It covers, debounced 500ms on `order`/`parcel` broadcast:
`['orders-page']`, `['orders-kpis']`, `['dash-stats']`, `['analytics-stats']`, `['couriers-roster-stats']`, `['sellers-roster-stats']`, `['mb-roster-earnings']`; and on `stock` (150ms): `['products-dropdown']`/`['accessories-dropdown-orders']` (admin) or `['products-dropdown-seller']`/`['accessories']` (seller).

**But note the negative space** — `EcomBizRealtime` is mounted **only** in AppLayout (admin) and SellerLayout (seller). **Courier, MediaBuyer and Owner have no realtime at all**, and these pages have no realtime coverage even for admin/seller:
Payments, Expenses(Details/Types), Transactions, Products, Accessories, Users, DeliveryNote, ReturnNote, Salaries, RecurringCharges, SalesChannels, Webhooks, Trash, Customers, tools/{bonCommande,bonLivraison,devis,facture}.
→ For all of these, **`refetchOnMount` + `refetchOnWindowFocus` ARE the entire freshness mechanism.** This is the population a global staleTime actually degrades.

**(c) Write-then-read — overwhelmingly invalidation-driven. Low risk.**
```
invalidateQueries call-sites (ecom, non-WA):  328
files containing useMutation (ecom):           47
manual .refetch() call-sites (ecom):            6   ← all user-facing "Retry"/"Réessayer" buttons:
    owner/OwnerPlatformDashboard.tsx:204, admin/Dashboard.tsx:85, admin/Analytics.tsx:192,
    owner/Backups.tsx:93, admin/collaborators/MediaBuyers.tsx:842, analytics/GoogleAnalytics.tsx:1051
```
328 invalidations across 47 mutation files ≈ every mutation explicitly invalidates. `refetch()` is never used as a freshness mechanism — only as an error-retry affordance, which is `staleTime`-independent. **This de-risks the lever substantially and is the strongest argument FOR it.**

**(d) Queries that opt OUT of caching on purpose — all explicit, all survive a global default:**
| File:line | Setting | Why |
|---|---|---|
| `hooks/useSellerLedger.ts:87` | `staleTime: 0` + `refetchOnMount:'always'` | payout ledger — money |
| `hooks/useTrackedOrders.ts:30,43` | `staleTime: 0` + `refetchOnMount:'always'` | lever 2 |
| `admin/Orders.tsx:765,780` · `seller/Orders.tsx:1467` | `refetchOnMount:'always'` | see §1.6 |
| `useWebhookHealth.ts:44,60` · `useGoogleAnalytics.ts:333` · `Webhooks.tsx:137` · `CampaignForm.tsx:158` · `Backups.tsx:51,52` | `refetchInterval` | polling — staleTime-independent |

Per-query options always beat `defaultOptions`, so **none of these need touching.**

### 1.6 🟠 NEW DEFECT — `refetchOnWindowFocus: true` does not do what D1's comment says

`src/pages/admin/Orders.tsx:760-766`:
```ts
staleTime: 60 * 1000,
// … so always refetch when we land here or refocus the tab —
// otherwise the 60s-stale cache shows the pre-change state until a hard refresh.
refetchOnMount: 'always',
refetchOnWindowFocus: true,     // ← does NOT honour the stated intent
```
v5 semantics: `refetchOnWindowFocus: true` refetches **only if the query is stale**; `'always'` refetches unconditionally. With `staleTime: 60_000`, **a refocus within 60s of the last fetch does not refetch** — exactly the scenario the comment says it is guarding. `refetchOnMount: 'always'` *does* work as intended (mount path is fine).

Same at `admin/Orders.tsx:779-781` (`orders-kpis`) and `seller/Orders.tsx:1462-1468` (`orders-page`).

**Impact:** deleting a delivery note on another page, then alt-tabbing back to Orders within 60s → pre-change state. This is a **shipped D1 intent/behaviour mismatch**, exactly the class D7 exists to close.
**Fix:** `refetchOnWindowFocus: 'always'` at those 3 sites (5 lines). **Parity note:** this is a *behaviour change* that makes the code match its comment — flag it for owner ruling rather than silently flipping, per the D7 convention.

### 1.7 Risk-ranked recommendation

**Do NOT ship a global `staleTime` as the first move.** The heavy pages are already covered; the marginal win is ~25 reference queries per focus; the blast radius is 355 call-sites across 5 roles; and `waQueryClient`'s own header says the ecom app assumes bare defaults. Effort/value is poor **until §1.4 is fixed**.

Ordered by value/effort:

| # | Change | Effort | Value | Risk | Ship? |
|---|---|---|---|---|---|
| **1** | **`queryClient.clear()` on `SIGNED_OUT`** in `App.tsx` (mirror `whatsapp/lib/queryClient.ts:59-60` verbatim) | ~5 LOC | **Closes a live cross-account leak.** | ~0 — clearing on logout can only over-fetch | **YES — ship alone, first** |
| **2** | `retry: 1` in global `defaultOptions.queries` + `mutations.retry: 0` | ~4 LOC | Kills 3× retry-with-backoff on every RLS 42501 / PostgREST 400. Today an admin-gated RPC hit by a non-admin (`admin_dashboard_stats`, `admin_analytics_stats` — gated by mig 20260715020000) burns 4 round-trips + ~7s of backoff before showing the error. **Matches `waQueryClient` exactly.** | Low. Only genuinely-transient network blips lose 2 retries. Explicit `retry:1` at `Backups.tsx:51,52` unaffected. | **YES** |
| **3** | `refetchOnWindowFocus: 'always'` at `admin/Orders.tsx:766,781` + `seller/Orders.tsx:1468` (§1.6) | 3 LOC | Makes shipped D1 code do what its comment promises | Behaviour change → **flag for owner ruling** | **Flag, don't silently fix** |
| **4** | `staleTime: 30_000` global default | 3 LOC | Removes ~25 redundant reference-query refetches per focus | **Medium.** Requires #1 shipped. Degrades freshness for every realtime-uncovered page (§1.5b) from "fresh on focus" to "≤30s stale on focus". | **Only after #1, and only with owner sign-off on the 30s window** |
| **5** | `refetchOnWindowFocus: false` global | 1 LOC | — | **HIGH — do not.** Courier/MB/Owner have zero realtime; Payments/Expenses/Transactions/DeliveryNote/ReturnNote/Salaries have zero realtime even for admin/seller. Turning focus-refetch off makes those pages stale until a manual reload. `waQueryClient.ts:14-19` documents this exact trap: *"the ONLY reliable cure for 'I had to refresh the page to see the data'"*. | **NO** |
| **6** | `gcTime` change | — | — | Leave at 5min default (matches WA). | **NO** |

**Concrete recommended patch (steps 1+2 only):**
```ts
// src/App.tsx — replace line 180
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },   // staleTime deliberately left at 0 — see D7 §1.7 #4
    mutations: { retry: 0 },
  },
});
// PRECONDITION for any future staleTime raise — and a live-leak fix on its own:
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') queryClient.clear();
});
```
**Per-query overrides needed to preserve today's behaviour: ZERO.** Every query that depends on aggressive refetching already states it explicitly (§1.5d), and per-query options beat `defaultOptions`. `retry: 3 → 1` needs no exemptions (the only latency-sensitive polls set `refetchInterval`, which is orthogonal).

If step 4 is later approved, still zero overrides required — but re-audit `SuspensionOverlay.tsx:54,73,87` (`suspension-business-info`, `platform-settings-bank`, `payment-submission`) first: a suspended business's overlay would resolve up to 30s late. Currently harmless because the *gate* (`App.tsx:167`) is `useState`, not react-query — only the overlay's inner content is cached. Confirm that stays true.

**MASTER_TODO §6 row 286 (`src/App.tsx`, P2, Q): STILL TRUE as written, but the P2 priority is right and the framing is wrong** — the win is `retry`, not `staleTime`, and the row misses the sign-out leak entirely.

---

## 2. LEVER 2 — `src/hooks/useTrackedOrders.ts`

### 2.1 What it does

```ts
// src/hooks/useTrackedOrders.ts:20-60
export function useTrackedOrders(businessId) {
  useQuery({ queryKey: ['tracked-orders-company-parcels', businessId],
    queryFn: () => fetchAllRows<ParcelRow>('company_parcels', 'order_id, tracking_code',
      { filters: [{ column: 'DigiCom Business', op: 'eq', value: businessId }] }),
    enabled: !!businessId, staleTime: 0, refetchOnMount: 'always' });     // ← ENTIRE business, all time
  useQuery({ queryKey: ['tracked-orders-courier-parcels', businessId], /* same shape */ });
  // → Set<order_id> where tracking_code is non-blank
}
```
Returns `{ trackedOrderIds: Set<string>, isReady }`.

### 2.2 EVERY current consumer (exhaustive grep)

```
src/components/CustomerInsights.tsx:4     import { useTrackedOrders } …
src/components/CustomerInsights.tsx:58    const { trackedOrderIds } = useTrackedOrders(activeBusinessId);   ← THE ONLY CALL SITE
src/hooks/useTrackedOrders.ts:20          (definition)
src/lib/analyticsDefinitions.ts:145,243   comment only — "Usually provided by useTrackedOrders"
src/pages/admin/collaborators/Sellers.tsx:102  comment only — documents that D5 REMOVED this dependency
```

**Exactly one live consumer.** `Sellers.tsx:95-110` is the receipt that D5 already killed the other path — its header explicitly lists *"and — transitively via useTrackedOrders — company_parcels + courier_parcels"* among the downloads `seller_roster_stats` (mig `20260715030000`) replaced.

**Per-consumer post-D1..D5 verdict:**

| Consumer | Still needs the hook? | Evidence |
|---|---|---|
| `CustomerInsights.tsx:58` | **Needs the *concept*, NOT the hook.** | It intersects `trackedOrderIds` with **one phone's orders only** (`:159`) — typically 1–20 rows. It fetches the whole business's 1,726 parcels to answer a question about ~5 of them. |
| admin/seller Dashboards, Analytics, Sellers/Couriers/MB leaderboards | **NO — already server-side.** | `admin_dashboard_stats` (mig `20260714230000`), `admin_analytics_stats` (mig `20260715010000`), `seller_roster_stats`/`courier_roster_stats` (mig `20260715030000`). Zero imports remain. |

### 2.3 How `trackedOrderIds` is actually used

`src/components/CustomerInsights.tsx:149-167` — the Coliaty delivery-rate denominator:
```ts
const tracked   = orders.filter((o) => !!o.id && trackedOrderIds.has(o.id));
const pullback  = tracked.filter((o) => isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds));
const deliveryDenom = tracked.length - pullback.length;
const deliveryRate  = deliveryDenom > 0 ? Math.round((delivered / deliveryDenom) * 100) : 0;
```
`orders` comes from a **phone-scoped** `fetchAllRows('orders', …, filters:[DigiCom Business eq, phone ilike %cleaned%, date_deleted is null, source_review_status neq pending])` (`:70-89`), then `.filter(o => o.replace !== true)` (`:107`).
→ **The needed input is `Set<order_id>` restricted to those order ids.** Nothing more.

### 2.4 Measured cost (live box, today)

```
company_parcels total: 1715   |  courier_parcels total: 20   |  orders total: 2109
company_parcels by business:  77f59ea5…=1710,  88ec398a…=5
courier_parcels by business:  77f59ea5…=16,    c88e9cd0…=3,  88ec398a…=1
```
`fetchAllRows` pages at `PAGE_SIZE = 1000` (`src/lib/supabase.ts:26`) and loops until a short page.
**Per mount, for the real business:** company_parcels 1710 rows → **2 requests**; courier_parcels 16 rows → **1 request**. **= 3 HTTP round-trips, ~1,726 rows** — to intersect against ~5 order ids.

With `staleTime: 0` + `refetchOnMount: 'always'`, this re-fires on **every** mount and (being permanently stale) **every window focus while mounted**.

### 2.5 When it mounts — verified, not assumed

Six render sites of `<CustomerInsights>`:

| Site | Mount gate | Verdict |
|---|---|---|
| `components/orders/OrderViewDialog.tsx:546` | inside `<DialogContent>` → `{selectedOrder && (…)}` (`:441-442`) | **fires on every admin order-preview open** |
| `components/orders/SellerOrderViewDialog.tsx:509` | same shape | **fires on every seller order-preview open** |
| `pages/admin/Orders.tsx:3832` | inside Radix `<PopoverContent>` (`:3812` `Popover open={showCustomerInsights}`) | fires on insights-button click only |
| `pages/seller/Orders.tsx:3694` | same | click only |
| `components/orders/AdminChatCartOrderDialog.tsx:1822` | same | click only |
| `components/orders/SellerChatCartOrderDialog.tsx:1478` | same | click only |

**Not the kept-mounted trap** (memory: *"extracted view dialogs MUST gate queries on open"*). `OrderViewDialog` is rendered unconditionally by its host (`admin/Orders.tsx:4787`, `open={isViewModalOpen}`), which is why its own queries carry `enabled: open && !!orderId` (`:151,182,195,218`). But `CustomerInsights` sits **inside** `<DialogContent>`, which Radix unmounts when closed (no `forceMount`) — so its hooks don't run while closed. **Verified safe.**

**Real-world profile:** an admin triaging 20 orders opens 20 previews → **60 requests / ~34,500 rows** transferred to compute 20 little delivery-rate percentages. Plus every alt-tab-back while a preview is open.

### 2.6 🟠 Secondary defect — it fires even with no phone

`CustomerInsights.tsx:229` bails out for short phones:
```ts
const cleaned = phone?.replace(/[^0-9+]/g, '') || '';
if (cleaned.length < 6) return null;
```
…but that early return is **after** all hooks, and `useTrackedOrders(activeBusinessId)` (`:58`) is gated on `enabled: !!businessId` — **not on `phone`**. So mounting `CustomerInsights` with an empty/short phone still pulls 1,726 parcel rows and renders `null`. Hits the ChatCart popovers (`field.value` starts empty on a new order) and any preview of a phone-less order.

### 2.7 Can it be DELETED outright?

**Yes — as a hook. No — as a capability.** The one consumer is real and its math is load-bearing. The correct D7 move is: **delete `src/hooks/useTrackedOrders.ts` and inline a phone-scoped equivalent into `CustomerInsights.tsx`.** Zero other files touched (the 3 remaining references are comments — update `analyticsDefinitions.ts:145,243` and `Sellers.tsx:102`).

### 2.8 Recommended minimal fix

**Why not a mirror column:** verified on the box — `orders` has **no** `tracking_code` column (`information_schema` shows only `company_id`, `courier_id`, `shipping_cost`, `*_old_tracking`). The tracked-set genuinely requires reading the parcel tables. `*_old_tracking` is exchange-leg data (memory: exchange order model), **not** a tracked-set signal — do not use it.

**Option A — scoped client query (RECOMMENDED).** Replace the hook with a query keyed on the order-id list, inside `CustomerInsights`:
```ts
// order ids come from the phone-scoped `orders` fetch already in the component
const orderIds = useMemo(() => orders.map(o => o.id).sort(), [orders]);
const { data: trackedRows } = useQuery({
  queryKey: ['ci-tracked', activeBusinessId, orderIds.join(',')],
  queryFn: async () => {
    if (!orderIds.length) return [];
    const [c, k] = await Promise.all([
      fetchAllRows<ParcelRow>('company_parcels', 'order_id, tracking_code',
        { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                    { column: 'order_id', op: 'in', value: orderIds }] }),
      fetchAllRows<ParcelRow>('courier_parcels', 'order_id, tracking_code',
        { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                    { column: 'order_id', op: 'in', value: orderIds }] }),
    ]);
    return [...c, ...k];
  },
  enabled: !!activeBusinessId && orderIds.length > 0,   // ← also fixes §2.6
  staleTime: 30 * 1000,                                  // ← matches the OrderViewDialog convention
});
const trackedOrderIds = useMemo(() => new Set(
  (trackedRows ?? []).filter(p => p.order_id && String(p.tracking_code ?? '').trim().length > 0)
                     .map(p => p.order_id!)), [trackedRows]);
```
- **Effort:** ~30 LOC, one file, delete one file, fix 2 comments. **No migration. No RLS surface change.**
- **Parity:** EXACT — same non-blank-`tracking_code` predicate, same `DigiCom Business` filter, same `Set` semantics, same `isAdminPullback` denominator. Intersecting a superset with `orderIds` ≡ filtering by `orderIds` server-side.
- **Cost:** 3 requests / 1,726 rows → **2 requests / ~N rows** (N = the customer's parcels, typically 1–5). Per-preview payload drops ~99.7%.
- **⚠️ `IN`-list URL cap.** Kong caps request URLs at 8k (memory: *notes filter+search*, cap 150 uuids → 300 uuids = 414). A customer's order count is realistically < 50, but **guard it**: if `orderIds.length > 150`, fall back to the unscoped business-wide fetch (i.e. today's behaviour) rather than 414-ing. Or use `orFilter` chunking as `OrdersExportWizard` does (`IN_LIST_MAX`, memory: *orders export wizard*).

**Option B — SECURITY INVOKER RPC `customer_insights_tracked(p_business uuid, p_order_ids uuid[])`.** Cleaner (1 call, no URL cap, array param), but adds a migration for one popover. **Not worth it in D7.** Note: this is **not** a business-wide money aggregate — it is scoped to one customer's own orders and returns no money — so the D2/D3 admin-gate convention (`admin_dashboard_stats`, `admin_analytics_stats`, mig `20260715020000`) does **not** apply. Plain SECURITY INVOKER + RLS would suffice. Both admin and seller render this component; an admin gate would **break the seller path** (`SellerOrderViewDialog.tsx:509`, `seller/Orders.tsx:3694`, `SellerChatCartOrderDialog.tsx:1478`).

**Option C — delete the delivery-rate tile from CustomerInsights.** Removes the dependency entirely. Product decision, not an engineering one. Mention to owner only if A is rejected.

**→ Take Option A.**

**MASTER_TODO §6 row 283 (`useTrackedOrders`, P1, F): STILL TRUE verbatim, but the P1 is now over-stated** — it described a hook feeding multiple dashboards. Post-D5 it feeds one popover. **Re-rank P2.** Still worth doing: the fix is ~30 LOC, and the cost is O(business lifetime parcels) — it grows forever and today's 1,715 rows is only the current floor.

---

## 3. MASTER_TODO §6 verification (rows touching these levers)

| Row | Claim | Status |
|---|---|---|
| **244** `DashboardSellersPerformance.tsx` — P1/AF — *"Full all-time orders fetch WITH order_items join (widest select on the page), and staleTime:0 + refetchOnMount:'always' forces the entire download…"* | **🟢 STALE — FIXED BY D2.** Current code (`:79-90`) is a metadata-only select: `users(id, name, avatar_url, avatar_config, active)` filtered `role='commercial'` + business. **No `order_items`. No orders. No `staleTime: 0`. No `refetchOnMount:'always'`.** Comment at `:78` reads *"Names/avatars only — every aggregate rides the RPC section."* **Close this row.** |
| **283** `useTrackedOrders.ts` — P1/F | **🟡 STILL TRUE**, blast radius collapsed 6 pages → 1 popover. **Re-rank P1 → P2.** Fix = §2.8 Option A. |
| **286** `src/App.tsx` — P2/Q | **🟡 STILL TRUE** as written, but mis-framed. The `staleTime` half is largely moot (§1.3: every D-wave RPC already sets 60s). The live wins are `retry: 3 → 1` and the **unlisted** sign-out leak (§1.4). **Rewrite the row.** |

**Same-shape D2 leftovers worth folding into the D7 tail** (all metadata-only, no staleTime, refetch every mount+focus — cheap `staleTime` candidates, ~1 line each):
`DashboardProductsPerformance.tsx:88` `['dashboard-products']` · `DashboardSellersPerformance.tsx:79` `['dashboard-sellers']` · `ShippingPipeline.tsx:57,71` `['dashboard-providers']`/`['dashboard-couriers']` · `analytics/{CouriersSection.tsx:59, MediaBuyersSection.tsx:66, SellersSection.tsx:73, ShippingSection.tsx:74,84}`.

---

## 4. Effort vs value — D7 ship order

| Order | Item | Effort | Value | Blocked by |
|---|---|---|---|---|
| **1** | `queryClient.clear()` on `SIGNED_OUT` (`App.tsx`) — §1.4 | 5 LOC | **Live cross-account leak.** Highest value in this recon. | — |
| **2** | `retry: 1` / `mutations.retry: 0` global — §1.7 #2 | 4 LOC | Kills 4× round-trips + ~7s backoff on every 42501/400 | — |
| **3** | `useTrackedOrders` → scoped inline (Option A) — §2.8 | ~30 LOC, 1 file + 1 delete | 3 req/1,726 rows → 2 req/~5 rows per preview; also fixes §2.6 | — |
| **4** | `refetchOnWindowFocus: 'always'` ×3 — §1.6 | 3 LOC | Makes shipped D1 match its own comment | **Owner ruling** (behaviour change) |
| **5** | `['products']`/`['company-zones-all']` missing `businessId` (`ImportOrders.tsx:90,144`) — §1.4 | 2 LOC | Cross-business cache collision in one session | — |
| **6** | `SellerSidebar.tsx:90-91` doesn't `removeItem('activeBusinessId')` (admin `Sidebar.tsx:272` does) — §1.4 | 1 LOC | Consistency; matters more once #1 lands | — |
| **7** | `staleTime: 30_000` global — §1.7 #4 | 3 LOC | ~25 fewer reference refetches per focus | **#1 shipped + owner sign-off on the 30s window** |
| **8** | `staleTime` on the 9 D2/D3 metadata leftovers — §3 | 9 LOC | Same win as #7, scoped, no global blast radius. **Strictly safer alternative to #7.** | — |
| — | `refetchOnWindowFocus: false` global | — | **DO NOT.** §1.7 #5. | — |

**Gold-plating to avoid:** an RPC for `CustomerInsights` (§2.8 Option B); a global `staleTime` before the sign-out clear; touching `waQueryClient`; adding `gcTime`.

---

## 5. Key file paths

- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/App.tsx` (:180 queryClient, :114-177 BusinessGuard)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/whatsapp/lib/queryClient.ts` (the written precedent — read :1-27 and :59-60 before writing any global default)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/hooks/useTrackedOrders.ts` (delete candidate)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/CustomerInsights.tsx` (:58 only consumer, :149-167 the math, :229 the late bail-out)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/realtime/EcomBizRealtime.tsx` (:65-99 the invalidation register — defines what a staleTime raise does *not* touch)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/layout/Sidebar.tsx` (:271-273) · `SellerSidebar.tsx` (:90-91) · `src/components/auth/ProtectedRoute.tsx` (:74-75) · `src/pages/Auth.tsx` (:84-88) — the sign-out/sign-in chain proving no reload, no clear
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Orders.tsx` (:760-766, :779-781) · `src/pages/seller/Orders.tsx` (:1462-1468) — §1.6
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/supabase.ts` (:26 `PAGE_SIZE = 1000`, :30 `fetchAllRows`)
- Migrations (existing RPC inventory): `supabase/migrations/{20260714210000_d4_money_aggregates, 20260714220000_d1_orders_list, 20260714230000_d2_dashboard_stats, 20260715010000_d3_analytics_stats, 20260715020000_d2_admin_dashboard_gate, 20260715030000_d5_leaderboards}.sql`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/MASTER_TODO.md` (:244 STALE, :283 stands/re-rank, :286 rewrite)
