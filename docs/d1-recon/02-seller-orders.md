# seller/Orders.tsx — COMPLETE inventory (D1 recon)

File: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/seller/Orders.tsx` (4677 lines). Component `Orders()` at L618. Verified against live box schema + RLS via db.sh.

## 1. THE AGGREGATE QUERY (L789-833)

- queryKey: `['orders-aggregate', activeBusinessId, userId]` (admin key is 2-part: `['orders-aggregate', activeBusinessId]`).
- Fetch: `fetchAllRows('orders', SELECT, opts)` (`src/lib/supabase.ts` L30-86) — pages by `.range()` in 1000-row batches, `orderBy: 'id'` asc, then client re-sorts `created_at` DESC (L821-823). Downloads EVERY matching order.
- Server-side filters (the ONLY pushdown today):
  - `DigiCom Business eq activeBusinessId`
  - `date_deleted is null`
  - `source_review_status neq 'pending'`
  - `orFilter: 'seller_id.eq.${userId}'` → PostgREST `.or()` with a SINGLE arm = `seller_id = userId`.
- enabled: `!!activeBusinessId && !!userId`; staleTime 60s; `refetchOnMount:'always'`; `refetchOnWindowFocus:true`. `isLoading = aggregateLoading || !activeBusinessId || !userId` (L842).

### Select string (L798-810) — IDENTICAL to admin's (admin L696-708)
```
*,
status:order_statuses(*),
package_status:package_statuses(*),
city:master_cities(id, name),
courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
assignee:users!orders_seller_id_fkey(id, name, avatar_url, avatar_config),
company:providers(id, name, provider_type, logo_url),
channel:sales_channels!orders_source_id_fkey(id, name, type),
items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
parcels:company_parcels(id, tracking_code, external_id, provider_id, status_id, created_at, company_delivery_note_id, status:package_statuses(label, color), provider:providers(id, name, logo_url)),
courier_parcels(id, tracking_code, status_id, created_at, courier_delivery_note_id, status:package_statuses(label, color))
```
12 relations. `history` deliberately NOT joined (lazy in SellerOrderViewDialog).

### Seller scoping semantics — ground truth
- Comment at L785-786 says "(assigned OR owned)" — LEGACY WORDING. Git: the filter was `seller_id.eq.uid,assign_id.eq.uid` (commit cb24b4f); commit 6026a18 "collapse assign_id into seller_id" removed the second arm. Effective predicate today: **`orders.seller_id = auth.uid()`, nothing else**. Live `orders` has no `assign_id`/`created_by` column (verified column list on box).
- **RLS does NOT enforce seller scoping.** Live policies on `public.orders`: `orders_tenant_select` USING = `"DigiCom Business" = current_user_digicom_business_id()` only (business-wide read for any role). UPDATE additionally allows `seller_id = auth.uid()` OR `courier_id = auth.uid()` OR business admin. ⇒ The D1 seller list/KPI RPC MUST embed `seller_id = auth.uid()` itself (SECURITY INVOKER + RLS alone would leak the whole business to a seller-crafted call).

## 2. FILTER STATE INVENTORY (each must be pushed down in D1)

| # | State (line) | Default | Predicate in `orderMatchesAllFilters` (L1983-2009) | Server-column mapping |
|---|---|---|---|---|
| 1 | `searchQuery` L626 | '' | `orderMatchesTopSearch(o, q)` — see §3 | multi-column + joins |
| 2 | `filterStatus` L684 | 'all' | `o.order_status_id === filterStatus` | orders.order_status_id |
| 3 | `pillStatusIds: Set` L686 | empty=all | `pillStatusIds.has(o.order_status_id)` (ANDed with #2) | order_status_id IN (...) |
| 4 | `pillPackageStatusIds: Set` L687 | empty=all | `pillPackageStatusIds.has(o.package_status_id)` (ANDed with #12) | package_status_id IN (...) |
| 5 | `filterCity` L688 | 'all' | `o.master_city_id === filterCity` | orders.master_city_id |
| 6 | `filterSource` L689 | 'all' | `o.source_name === filterSource` (exact, from SALES_SOURCES list L324) | orders.source_name |
| 7 | `filterProvider` L690 | 'all' | `o.courier_id === v \|\| o.company_id === v` (one dropdown, both columns) | courier_id OR company_id |
| 8 | `filterDateField` L691 | 'date' | picks column via DATE_FIELD_MAP L426: date, created_at, updated_at, assignment_date, confirmation_date, annulation_date, date_livraison, reported_date | 8 switchable timestamp columns |
| 9 | `filterTimeRange` L692 + `filterCustomRange` L693 | 'all' | `getDateRange` L1274-1286: today/yesterday/last7/last30/thisMonth/lastMonth/custom; `isWithinInterval` startOfDay..endOfDay in BROWSER LOCAL TZ; row with NULL chosen field is EXCLUDED when a range is active | range on chosen column; D1 must fix a timezone convention |
| 10 | `filterCustomerName` L729 | '' | case-insensitive substring on `o.name` | orders.name ILIKE %v% |
| 11 | `filterPhone` L730 | '' | raw substring `o.phone?.includes(v)` — NO normalization | orders.phone LIKE %v% |
| 12f | `filterTracking` L731 | '' | `orderMatchesTrackingFilter` L445-462: needle lowercased + whitespace-stripped; matches 6 old-tracking columns (coliaty/ameex/quicklivraison/forcelog/sendit/delvoexpress_old_tracking) + `parcels[].tracking_code` **only if `company_delivery_note_id` set** + `courier_parcels[].tracking_code` **only if `courier_delivery_note_id` set** (note-attached parcels only — different from tab gating, §4) | orders cols + company_parcels/courier_parcels |
| 12 | `filterProduct` L732 | 'all' | `o.items?.some(item => item.product_id === v)` — matches product lines only, NOT accessory_id | EXISTS order_items(product_id) |
| 13 | `filterPackageStatus` L733 | 'all' | `o.package_status_id === v` | orders.package_status_id |
| 14 | `filterExchange` L734 | 'all' | yes → `o.replace` truthy; no → falsy | orders.replace |

- `activeFilterCount` L2017-2033 counts each of the above (pill sets count as 1 each). `clearAllFilters` L2035-2052 resets all + dateField→'date'.
- Page reset to 1 on ANY filter/tab/search change (L2057-2059); page clamped when totalPages shrinks (L2114-2116).

## 3. TOP SEARCH — `orderMatchesTopSearch` (`src/lib/orderSearch.ts`)

Single query string matched two ways (raw lowercase substring AND whitespace-normalized substring) against a bucket built from:
- Order scalars: id, name, phone, address, all 6 *_old_tracking, note, delivery_note, source_name, **raw_price, shipping_cost, total_price, discount** (last two undefined on this page — not selected/absent columns), seller_id, confirmed_by_id, courier_id, company_id, order_status_id, package_status_id, master_city_id (raw UUIDs are searchable).
- Joined names/labels: city.name, courier.name, assignee.name, company.name, status.label, package_status.label.
- Per item: product name (localized en/fr/ar object supported) + code; accessory name + code; item note.
- Per company parcel: parcel id, tracking_code, provider.name. Per courier parcel: id, tracking_code (NO note-id requirement here, unlike filter #12f).
- history[] comments/user/status — no-op on this page (history not loaded).

D1 note: seller search parity requires name/phone/address/notes/tracking/product/status-label/city coverage; numeric raw_price/shipping_cost matching and raw-UUID matching are incidental behaviors to decide on explicitly.

## 4. TABS (seller-only; admin has NONE)

`activeTab` L628, default **'new'**, initialized from URL `?tab=` (L635-649). Values: all | new | confirmed | delivered | returned | confirmation | suivi | reported (render order L2476-2484).

`isOrderInTab` (L1919-1978), all via `useStatusCategories` flag facade (`src/hooks/useStatusCategories.ts` — the legacy `category` column is GONE; predicates are boolean flags):
- helper `orderHasTrackingNumber` L465-473: any non-blank `parcels[].tracking_code` OR `courier_parcels[].tracking_code` (note-id NOT required; old-tracking columns NOT counted).
- **all**: true.
- **new**: `order_status_id === getOrderByCategory('new').id` (single id, `is_new` flag).
- **confirmed**: `isOrderCategory(order_status_id,'confirmed')` = `deducts_stock` flag.
- **confirmation**: NOT reported, NOT new, NO tracking number, AND `status.recheck===true && status.active!==false && status.show_in_seller_confirmation!==false && package_status.show_in_seller_confirmation!==false`.
- **suivi**: NOT reported, HAS tracking number, AND `package_status_id` set, `package_status.active!==false`, `status.show_in_seller_suivi!==false && package_status.show_in_seller_suivi!==false`, AND (`package_status.recheck===true` OR `isPkgCategory(id,'recheck')` i.e. `is_recheck`).
- **reported**: `order_status_id === REPORTED_STATUS_ID` (`is_postponed` single id).
- **delivered**: `isPkgCategory(package_status_id,'delivered')` = `is_delivered` flag.
- **returned**: `package_status_id ∈ statusCats.returnedPkgIds` = `is_returned` flag (comment says returned/returning/refused family, code = is_returned only).

`tabCounts` L2061-2092: counts over the FULL base-filtered aggregate (all 8 counts) + `reportedToday` / `reportedNow` booleans (any reported order with reported_date on today / in current hour — drives orange/pulsing-rose tab styling L2488-2502). D1 KPI RPC must return all 8 tab counts honoring filters, plus the two reported-date booleans.

## 5. RECHECK STATUS PILLS (seller-only ribbon, L2142-2225 + StatusPillsRibbon L477)

Shown only on confirmation/suivi tabs. Buckets = per-status counts computed over FULL aggregate applying `orderPassesNonStatusFilters` (L2120-2140 = all filters EXCEPT the pill's own dimension; confirmation pills still apply package-status filters, suivi pills still apply order-status filters) AND `isOrderInTab`. Seeds: confirmation ← order_statuses where `recheck===true && show_in_seller_confirmation!==false` (+ any encountered recheck status); suivi ← package_statuses where `recheck===true && show_in_seller_suivi!==false` plus `is_recheck` category members. Bucket fields: id/label/color/icon/ranking/count; sorted by ranking; only count>0 or currently-selected shown. Multi-select toggles feed pillStatusIds/pillPackageStatusIds (filters #3/#4). D1: needs a faceted per-status count aggregate with "all-filters-except-self" semantics.

## 6. KPI STRIP (seller-specific, L2453-2472; math L2250-2318)

Card 4 respects filters; cards 1-3 DO NOT (full unfiltered aggregate):
- Inputs: `aggregateOrders` (FULL, unfiltered), `sellerProfile` = users.products/commission_price/commission_basis (L993-1010), `sellerPaidAmount` = SUM(seller_payments.paid_amount) WHERE seller_id=userId — NOT business-scoped (L2229-2245), statusCats sets: deliveredPkgIds(is_delivered), pendingIds(pending_confirmation), adminPullbackOrderIds/PackageIds(excluded_from_delivery_rate on either table).
- Base set: `allOrders = aggregateOrders.filter(o => o.replace !== true)` — exchange legs excluded from ALL KPI math (list still shows them).
- **Taux de livraison** = delivered / (trackedCount − pullbackCount) ×100. delivered = `isDeliveredForCommission` (package_status_id ∈ deliveredPkgIds — `src/lib/commercialCommission.ts` L28). tracked = order has any non-blank tracking_code in parcels/courier_parcels. pullback = tracked AND `isAdminPullback` (`src/lib/analyticsDefinitions.ts` L225: order_status_id ∈ adminPullbackOrderIds OR package_status_id ∈ adminPullbackPackageIds). Sub-label: `totalDelivered` count.
- **Taux de confirmation** = rateConfirmed / allOrders ×100, rateConfirmed = hasTracking OR (pendingIds loaded AND order_status_id ∉ pendingIds).
- **Commission due** = `computeUnpaidCommission` (commercialCommission.ts L170): accrued = per_order ? deliveredCount×rate : Σ assigned-product units on delivered orders ×rate (`sumAssignedProductUnits`: empty users.products ⇒ 0 — matches DB fn `sum_order_units_for_seller_products`); unpaid = max(0, accruedCash − sellerPaidAmount). Commission orders additionally filtered `o.seller_id === userId` (L2298 — redundant today, load-bearing if scoping widens).
- **Mes commandes** = `filteredAggregateCount` (filters + active tab applied).
- D1: cards 1-3 = one seller-lifetime aggregate (filter-independent, cacheable); card 4 + tab counts + pill counts = filter-dependent aggregate.

## 7. PAGINATION (L735-738, L2100-2116, UI L2679-2719, L3322-3344)

Pure client slice of `filteredAggregate` (base filters + tab): `page` (1-based) × `pageSize` ∈ {100, 500, 1000}. Prev/Next buttons + "X of Y records" pill. No sort control anywhere — fixed created_at DESC. D1 keyset: (created_at DESC, id) is the only ordering to support.

## 8. EVERY CONSUMER OF THE AGGREGATE

1. `filteredOrders` page slice → grid cards (L3044-3299) and `SellerOrdersListView` (L3302-3316), both wrapped in `arrangeExchangePairs` (L165-211: groups replace-legs + additional-sale legs + original via `exchange_of_order_id` into one purple block; **degrades silently when partners fall on another page** — keyset design must accept or fix this).
2. `tabCounts` (§4) — full filtered aggregate.
3. `filteredAggregate`/`filteredAggregateCount` — KPI card 4, records pill, totalPages.
4. `sellerStats` (§6) — FULL unfiltered aggregate.
5. `recheckOrderStatusBuckets` / `recheckPackageStatusBuckets` (§5) — full aggregate.
6. `sellerFilterCities` L1289-1302 — city dropdown options derived FROM the aggregate (distinct master_city_id + embedded city.name).
7. `sellerFilterProviders` L1311-1337 — provider dropdown options derived FROM aggregate (distinct courier_id/company_id; avatars/logos from couriers/companies lookup queries).
8. `shortOrderIds` L1878-1896 — stock-shortage badge: per order with `stock_changed !== true`, any item line where quantity > stock from `productStockById`/`accessoryStockById`; **only evaluates products in the seller's assigned catalog** (`have !== undefined` guard — non-assigned products never flag).
9. `lockedOrderIds` L1898-1902 — `isOrderLocked` L214: `status.is_paid || status.is_unpaid` → blocks Edit + quick status.
10. `duplicatePhones` L1904-1917 — intersects aggregate phones (normalized: digits-only, 0XXXXXXXXX→212…, `normalizeClientPhone` L1841 mirroring DB `normalize_phone_for_customer`) with `businessDuplicatePhones` (customers table, total_orders>1, business-wide, L1852-1876).
11. `quickStatusMutation.onError` L1805-1812 — looks up the order row in the aggregate to build stock-shortage lines.
12. `handleEdit` L2320-2385 — full row prefill of the edit form (all scalar columns + grouped items with accessories).
13. Row-action consumers of full rows: QuickStatusChangeModal (order row), OrderStatusHistoryDialog (order row), StockShortageModal (computed), ParcelTrackingDialog (orderId only), grid/list per-row derived values (latest parcel tracking code by created_at, `getLatestTrackableCompanyParcel`, `getCourierPackageStatus` L604: latest courier_parcels row's embedded status label/color when orders.package_status_id absent, `usePackageStatusResolver.resolveById/resolve` for master badge label+color+icon).
14. NOT consumers: `SellerOrderViewDialog` (L4552, self-fetches by orderId — the existing lazy-detail precedent; RLS-only guard, closes if fetch fails) and CustomerInsights (own query).

## 9. SELLER-SPECIFIC VISIBILITY / COLUMN RULES

- **Displayed money = `order.price` ONLY** (grid footer L3257; SellerOrdersListView L321 "Amount" column) — per seller-listing-total-field rule: price includes delivery when `include_delivery_in_total`; `raw_price` is NEVER displayed on this page (analytics pages use raw_price). BUT `select *` ships raw_price/shipping_cost to the client and top search matches against them.
- **NO revenue KPIs**: seller strip has rates + commission + count. Admin's "Total sales" (Σ price, replace excluded) and "Avg order" MUST NOT appear in seller D1 payloads.
- **Product visibility**: products dropdown query L1018-1033 restricted to `users.products` (sellerProductIds) — filter options, order-form combobox, filterProduct chips all limited to assigned SKUs. Orders can still CONTAIN non-assigned products (items join is unrestricted); such products render in rows but cannot be filtered by.
- Per-unit commission counts ONLY assigned-product lines; empty assignment ⇒ 0.
- `businessDuplicatePhones` intentionally business-wide (honest double-client badge beyond seller's own orders).
- Order create stamps `seller_id: userId` (L1467); update/delete mutations double-guard `.eq('DigiCom Business', activeBusinessId)`.
- `deleteOrderMutation` L1815-1836 (soft delete) is DEAD CODE — no UI invokes it on the seller page (grid/list menus: View/Contact/Track/Edit/History only).

## 10. DIFFERENCES vs admin/Orders.tsx (complete)

| Dimension | Seller | Admin |
|---|---|---|
| queryKey | ['orders-aggregate', biz, uid] | ['orders-aggregate', biz] |
| Scoping | + `or(seller_id.eq.uid)`; enabled needs userId | business only |
| Select string | identical | identical |
| Tabs | 8 pipeline tabs, default 'new', ?tab= param, reportedToday/Now pulse | NONE |
| Recheck pills | pillStatusIds/pillPackageStatusIds multi-select ribbons | none |
| Status filter | single id + pill set | single id OR `filterStatusIds[]` category-array + label (from dashboard nav `location.state`) |
| Package filter | single id + pill set | single id OR `filterPackageStatusIds[]` + label (nav) |
| Extra admin filters | — | `filterConfirmedBy` (confirmed_by_id), `filterAssignedTo` (seller_id), both SearchableFilter over confirmers/sellers lists |
| Nav-state init | none (URL ?tab/?view/?addProductId instead) | filterStatus/City/Source/Provider/PackageStatus initialized from location.state |
| KPI strip | deliveryRate, confirmRate, commission due, filtered count — mostly filter-INDEPENDENT | Active orders, Total sales (Σ price, replace≠true), Exchanges, Avg order — all filter-DEPENDENT (admin L2519-2523) |
| Dropdown sources | cities/providers derived from own aggregate; products = assigned only | full `cities`, `allProviders`, full `products`, plus sellers/confirmers |
| Duplicate phones | customers cache table + normalizeClientPhone | in-aggregate phoneCounts (strip spaces/dashes only) |
| Bulk ops | none | multi-select rows, attribution modal (assign seller), bulk status modal |
| Export | none | Orders export wizard (ordersExport engine, same filter regime) |
| Delete | dead mutation, no UI | wired delete with confirm modal |
| View dialog | SellerOrderViewDialog (self-fetch) | OrderViewDialog (reads aggregate cache at L155, invalidates prefix) |
| List component | SellerOrdersListView (no seller/assignee column, no raw_price) | OrdersListView |
| Realtime | EcomBizRealtime in SellerLayout | same in AppLayout |
| isOrderInTab / tab-gating helpers, StatusPillsRibbon, sellerStats, sellerPaidAmount, sellerProfile queries | seller-only | absent |
| filter predicate | + pill sets, − confirmedBy/assignedTo | + statusIds/packageStatusIds arrays, + confirmedBy/assignedTo |

Shared verbatim: DATE_FIELD_MAP (8 fields), getDateRange presets, SALES_SOURCES, orderMatchesTrackingFilter, SearchableFilter, isOrderLocked, exchange old-tracking validation per provider, quick status / reported-date modal flows, page-size 100/500/1000 + slice pagination.

## 11. SUPPORT QUERIES MOUNTED BY THE PAGE (candidates to keep/trim in D1)

cities-dropdown (fetchAllRows master_cities id,name,zone_id — NOT business-filtered in queryFn body), couriers-dropdown (users role=courier active biz), companies-dropdown (providers active biz), courier-zones-all, company-zones-all, courier-fees-all, company-fees-all, provider-cities-all (global), order-statuses-dropdown (id,code,label,ranking,color,icon,show_in_order,show_in_quick_status,show_in_seller_confirmation,recheck; active, rank asc — NOTE: no biz filter, no show_in_seller_suivi in this select; suivi flag comes off the aggregate's embedded status row), package-statuses-dropdown (id,code,label,color,icon,ranking,recheck,show_in_seller_suivi; active), seller-user-products (users.products/commission_price/commission_basis), products-dropdown-seller (assigned only), product-accessories, accessories, business-duplicate-phones, seller-payments-paid-sum, plus useStatusCategories' two 5-min-stale master-status queries and usePackageStatusResolver.

## 12. INVALIDATION / REALTIME MAP

`['orders-aggregate']`-prefix invalidators that must keep working after D1 re-keying: EcomBizRealtime (broadcast bump, 500ms debounce, covers both admin+seller keys), seller/admin DeliveryNote (4 sites each), DeliveryNoteWizard (2), SellerChatCartOrderDialog (2, `['orders-aggregate', activeBusinessId]`), AdminChatCartOrderDialog (2), OrderViewDialog/SellerOrderViewDialog, and this page's 4 mutations (create/update/quickStatus/delete → `['orders-aggregate', activeBusinessId]` prefix — matches the 3-part seller key by prefix).

## 13. D1 DESIGN GOTCHAS SURFACED

1. RLS won't scope sellers — RPC must hard-code `seller_id = auth.uid()` (and D4 conventions: SECURITY INVOKER, `search_path ''`, explicit `p_business`; invoker RLS gives business isolation, the seller predicate gives role isolation).
2. Two different tracking predicates: tab gating counts ANY parcel tracking; the tracking FILTER requires note-attached parcels; top SEARCH also matches old-tracking columns and parcel UUIDs. Do not unify silently.
3. Date filtering is browser-local-midnight based over 8 switchable columns; NULL column excluded when range active. Server pushdown needs an agreed timezone (Africa/Casablanca) or client-supplied absolute bounds.
4. KPI split: sellerStats (cards 1-3) ignore filters/tab; card 4 + tabCounts + pill buckets are filter-scoped; pill buckets use all-filters-except-own-dimension. Three distinct aggregate shapes.
5. Exchange-pair grouping is page-local; keyset pages will split purple blocks unless the list RPC groups server-side or fetches partner rows.
6. Tab predicates depend on joined flag columns (recheck/active/show_in_seller_* on both status tables) + tracking existence — the list AND KPI RPCs need these joins/EXISTS, not just orders columns.
7. shortOrderIds/locked/duplicate badges need per-page-row data only (items+stock, status flags, phone) — cheap to keep client-side over the returned page.
8. `filterExchange='no'` uses falsy check (NULL replace matches 'no'); `replace !== true` is the KPI exclusion — preserve NULL semantics in SQL.
9. Seller payload hygiene for D1: list RPC should return `price` (display total), never expose admin money aggregates; raw_price exposure is a decision point (today it leaks via `select *` and is search-matchable).
10. `commission due` depends on seller_payments sum that is seller-global (not per business) — replicate exactly or flag.