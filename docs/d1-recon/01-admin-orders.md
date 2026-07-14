# Recon: `src/pages/admin/Orders.tsx` — 'orders-aggregate' full inventory (for D1 keyset/RPC redesign)

File: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Orders.tsx` (5180 lines). Companions read: `src/lib/orderSearch.ts`, `src/components/orders/OrdersListView.tsx`, `src/lib/supabase.ts` (fetchAllRows), `src/lib/orders/getLatestTrackableCompanyParcel.ts`. Live schema verified on box (`orders`, `order_statuses`, `package_statuses`).

## 0. The aggregate query (L683-729)

- Key: `['orders-aggregate', activeBusinessId]`; `enabled: !!activeBusinessId`; `staleTime` 60s; `refetchOnMount:'always'`; `refetchOnWindowFocus:true`. Cache invalidation ALSO rides the layout-mounted `EcomBizRealtime` (ecom:biz broadcast, W7 seam) plus every mutation in this file (`createOrderMutation` L1799, `updateOrderMutation` L1981, `deleteOrderMutation` L2005, `bulkStatusMutation` L2106, `bulkAttributeMutation` L2147) — all invalidate this exact key. Any replacement query keys must be re-pointed in EcomBizRealtime too.
- Mechanics: `fetchAllRows('orders', <select>, filters)` — pages 1000 rows at a time by `id ASC`, loops to exhaustion (EVERY order of the business), then client re-sorts `created_at DESC` (`new Date(b.created_at||0) - new Date(a.created_at||0)`; nulls → epoch → last, but created_at has default now()).
- Server-side base predicates (the ONLY pushed-down filters):
  1. `"DigiCom Business" eq activeBusinessId`
  2. `date_deleted is null`
  3. `source_review_status neq 'pending'` (live column: text NOT NULL default `'approved'` — neq is null-safe here)
- Misleading stale comment at L628-630 claims "Server-side pagination. The query fetches only the visible page" — false; L678 comment ("ONE query pulls every order") is the truth.

### Exact select string (L696-708)
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
`history` is deliberately NOT joined (OrderViewDialog lazy-fetches per order). The `?view=` fallback fetch (L1028-1046) mirrors this select PLUS `history:order_status_history(*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*))`, `.eq('id')`, `.is('date_deleted', null)`, `.maybeSingle()` — and seeds `['order-view', id]`.

## 1. EVERY filter — state → predicate in `orderMatchesAllFilters` (L2255-2290)

All predicates AND-combined. Single-select everywhere EXCEPT the two `*Ids` category arrays (nav-state only, no UI multi-select). Nav-state initializers (dashboard KPI cards, L561-624): `filterStatus`, `filterStatusIds`, `filterStatusLabel`, `filterCity`, `filterSource`, `filterProvider`, `filterPackageStatus`, `filterPackageStatusIds`, `filterPackageStatusLabel`. `*Label` states are display-only (chips/placeholder).

| # | UI name | State (default) | Predicate (exact) | Column(s) | Operator / null semantics | Multi? |
|---|---------|-----------------|-------------------|-----------|---------------------------|--------|
| 1 | Top search | `searchQuery` ('') | `orderMatchesTopSearch(o, searchQuery)` | see §2 | substring, match-all when empty | — |
| 2 | Status | `filterStatus` ('all') | `o.order_status_id === filterStatus` | orders.order_status_id | eq uuid; NULL never matches | single |
| 3 | Status category | `filterStatusIds` (null) | applies ONLY when filterStatus==='all': `!!o.order_status_id && filterStatusIds.includes(o.order_status_id)` | orders.order_status_id | IN list; NULL never matches; wiped when user picks a specific status (L2942) | multi (nav only) |
| 4 | Package | `filterPackageStatus` ('all') | `o.package_status_id === filterPackageStatus` | orders.package_status_id | eq uuid; NULL never matches. NOTE: filters ONLY the denormalized orders column — courier orders whose pkg status lives on courier_parcels (display fallback `getCourierPackageStatus`) are NOT matched | single |
| 5 | Package category | `filterPackageStatusIds` (null) | fallthrough like #3 | orders.package_status_id | IN list; NULL never matches | multi (nav only) |
| 6 | City | `filterCity` ('all') | `o.master_city_id === filterCity` | orders.master_city_id | eq uuid; NULL never matches | single |
| 7 | Source | `filterSource` ('all') | `o.source_name === filterSource` | orders.source_name | exact case-sensitive string eq against static 9-value list `SALES_SOURCES` = whatsapp, facebook, instagram, tiktok, "phone call", connaissance, reorder, website, other (L370); NULL never matches; sheet-channel orders match only via source_name, channel is NOT filterable | single |
| 8 | Delivery (provider) | `filterProvider` ('all') | `o.courier_id === filterProvider \|\| o.company_id === filterProvider` | orders.courier_id OR orders.company_id | eq uuid on EITHER FK (options = union of active couriers + active providers of the business) | single |
| 9 | Date field | `filterDateField` ('date') | selects which column the range applies to, via `DATE_FIELD_MAP` (L2190): date, created_at, updated_at, assignment_date, confirmation_date, annulation_date, date_livraison, reported_date | one of 8 timestamptz cols | — | single |
| 10 | Date range | `filterTimeRange` ('all') + `filterCustomRange` | when `getDateRange` non-null: `o[fieldKey]` NULL → **NO match**; else `isWithinInterval(new Date(val), {start:from, end:to})` — INCLUSIVE both ends, **browser-local** startOfDay/endOfDay | col from #9 | presets: today, yesterday, last7 (6 days back), last30 (29), last90 (89), ytd (startOfYear), thisMonth, lastMonth (full month), custom (from/to days) — L2174-2188 | single |
| 11 | Customer name | `filterCustomerName` ('') | `o.name?.toLowerCase().includes(q.toLowerCase())` | orders.name | case-insensitive substring; NULL name → no match | — |
| 12 | Phone | `filterPhone` ('') | `o.phone?.includes(filterPhone)` | orders.phone | **raw case-sensitive substring, NO normalization** (spaces/dashes in either side matter); NULL → no match | — |
| 13 | Tracking | `filterTracking` ('') | `orderMatchesTrackingFilter` (L351): needle = trim().toLowerCase().strip-whitespace; haystack = 6 cols `coliaty/ameex/quicklivraison/forcelog/sendit/delvoexpress_old_tracking` + `parcels[].tracking_code` **WHERE company_delivery_note_id IS NOT NULL** + `courier_parcels[].tracking_code` **WHERE courier_delivery_note_id IS NOT NULL**; match = whitespace-stripped lowercase substring on any code; empty → match-all | orders.*_old_tracking, company_parcels.tracking_code, courier_parcels.tracking_code | substring, note-gated for parcels | — |
| 14 | Product | `filterProduct` ('all') | `o.items?.some(item => item.product_id === filterProduct)` | order_items.product_id | EXISTS eq; accessory-only lines (product_id NULL) never match; accessory_id NOT searched | single |
| 15 | Confirmed By | `filterConfirmedBy` ('all') | `o.confirmed_by_id === filterConfirmedBy` | orders.confirmed_by_id | eq uuid (options: ALL active users of business, any role) | single |
| 16 | Assigned To | `filterAssignedTo` ('all') | `o.seller_id === filterAssignedTo` | orders.seller_id | eq uuid (options: active users role='commercial') | single |
| 17 | Exchange | `filterExchange` ('all') | 'yes': `o.replace` truthy; 'no': `!o.replace` (NULL and false both = 'no') | orders.replace | boolean tri-state | single |

`activeFilterCount` (L2305) counts each of the above once (status/statusIds count as one; same for package). `clearAllFilters` (L2325) resets everything incl. dateField→'date'. Page snaps to 1 on ANY change of the full dep list incl. searchQuery (L2350); page clamped to totalPages when the set shrinks (L2356).

## 2. Top search — `orderMatchesTopSearch` (`src/lib/orderSearch.ts`)

Normalization: query trimmed; per candidate string two passes — (a) lowercase substring, (b) whitespace-stripped lowercase substring (`qNorm`). No diacritic folding, no phone-digit normalization. Empty query = match-all. **Search is inside the filter predicate, so KPIs respect it.**

Fields matched (bucket), all stringified:
- Order scalars: `id` (uuid!), `name`, `phone`, `address`, all 6 `*_old_tracking`, `note`, `delivery_note`, `source_name`, `raw_price`, `shipping_cost`, `total_price` (**not a column — dead**), `discount` (**not a column — dead**), `seller_id`, `confirmed_by_id`, `courier_id`, `company_id`, `order_status_id`, `package_status_id`, `master_city_id` (all raw uuids searchable).
- Joins: `city.name`, `courier.name`, `assignee.name`, `company.name`, `status.label`, `package_status.label`.
- `items[]`: `product.name` (supports localized `{en,fr,ar}` object), `product.code`, `accessory.name`, `accessory.code`, `item.note`.
- `parcels[]`: `id`, `tracking_code`, `provider.name` — **NOT delivery-note-gated** (unlike filter #13).
- `courier_parcels[]`: `id`, `tracking_code`.
- `history[]`: comment/user.name/status.label — **dead on this page** (history not in the aggregate select).

Header placeholder: "Search by name, phone, tracking, item…" (L2550).

## 3. KPI strip + duplicatePhones + shortOrderIds + lockedOrderIds — exact math & input set

### KPI strip (L2519-2523, computed inline over **filteredAggregate** = FULL filtered set, all pages, search included; page-size independent)
- `salesAggregate` = filteredAggregate WHERE `o.replace !== true` (exchange return-legs excluded from MONEY).
- **Active orders** = `filteredAggregate.length` (INCLUDES exchange legs).
- **Total sales** = `Σ (Number(o.price) || 0)` over salesAggregate; `Math.round` at render. Uses `price` (delivery-inclusive when include_delivery_in_total).
- **Exchanges** = `filteredAggregate.filter(o => o.replace).length`.
- **Avg order** = salesAggregate.length > 0 ? `Math.round(totalRevenue / salesAggregate.length)` : 0.
- Counter pill (L2749-2753): `filteredOrders.length` (visible page) "of" `filteredAggregateCount` (full filtered count).

### duplicatePhones (L2231) — over the **UNFILTERED full business aggregate** (`aggregateOrders`), NOT the filtered set
- Normalize each phone: `phone.replace(/[\s-]/g,'')`; count per normalized key; result = Set of **RAW** phone strings whose normalized count > 1. Row check: `duplicatePhones.has(order.phone)` (raw exact). Business-wide flag, stable across filters/pages → genuinely needs a full-set (or server-side) computation; drives yellow row/card wash + name tint.

### shortOrderIds (L2205) — over the **UNFILTERED full aggregate**
- Skip when `o.stock_changed === true` (stock already reserved).
- Short if ANY item: (`product_id` && `Number(quantity) > 0` && stock map has the id && `quantity > productStockById.get(product_id)`) OR (`accessory_id` && `accessory_quantity > 0` && `accessory_quantity > accessoryStockById.get(accessory_id)`). Stock maps built from the products/accessories dropdown queries (**active-only** rows — items referencing inactive/deleted products have `have === undefined` → NOT short).
- Consumed only for rendered rows (red wash + AlertTriangle → `computeShortLines` L157 for the StockShortageModal) → per-visible-row computable; needs items(quantity, accessory_quantity, product_id, accessory_id) + current stock.

### lockedOrderIds (L2225) — over the full aggregate
- `isOrderLocked(o)` = `!!(o.status?.is_paid || o.status?.is_unpaid)` (master flags on joined order_statuses row, L226).
- Consumers: checkbox disable, edit/quick-status block (toast "Commande verrouillée"), `toggleSelectAll` exclusion, AND **bulk mutations filter**: `bulkStatusMutation`/`bulkAttributeMutation` drop locked ids from `rawOrderIds` client-side before writing (L2028/L2133). In a server-paginated design this guard should move server-side (selection can span pages, see §5).

## 4. Sort model + pagination

- Sort: fixed `created_at DESC`, client-side, no user control, no tiebreaker beyond array stability (fetch order id ASC underneath).
- Pagination state: `page` (1-based), `pageSize` ∈ {100, 500, 1000} literal union, default **100** (L631-632); pageSize dropdown sets page→1.
- Slice: `filteredOrders = filteredAggregate.slice((page-1)*pageSize, (page-1)*pageSize + pageSize)` (L2300); `totalPages = max(1, ceil(filteredAggregate.length / pageSize))`.
- Controls: Prev/Next buttons + "page / totalPages" only (L3529-3551). Page reset on filter/search change; clamp on shrink.
- **Exchange grouping** `arrangeExchangePairs` (L177) is applied to the VISIBLE PAGE ONLY at render (grid L3218, list L3509): groups replace-legs + additional-sale legs + original into one adjacent block via `exchange_of_order_id` **when both partners are present in the same filtered page** (reorders rows within the page; tags `_exchangeRole` ('exchange'|'sale'|'original'), `_exchangePartnerId`, `_exchangeFirst/_exchangeLast`). Already degrades to a normal row when the partner is filtered/paged out — so per-page grouping survives keyset pagination unchanged, but note a page boundary can split a pair that full-client pagination happened to keep together.

## 5. Every OTHER consumer of the aggregate data — full set vs visible page

| Consumer | Location | Data needed | Full set or page? |
|---|---|---|---|
| KPI strip | L2519-2523 | count / Σprice(replace≠true) / count(replace) / avg over the FILTERED set | **Full filtered set** → the KPI aggregate RPC |
| Counter pill total | L2752 | filtered count | **Full filtered set** (same RPC can return it) |
| duplicatePhones | L2231 | phones of ALL business orders | **Full unfiltered business set** → needs server-side derivation (e.g. per-row `is_duplicate_phone` flag or a phone-counts aggregate) |
| shortOrderIds | L2205 | items + stock of rendered rows | Page-level sufficient (flag per returned row) |
| lockedOrderIds | L2225 | status.is_paid/is_unpaid | Page-level for UI; bulk-mutation guard should move server-side because `selectedOrders` **persists across page/filter changes** (never cleared on filter/page change — only on bulk success/cancel), so selected ids may no longer be on the visible page when the bulk fires |
| Selection / toggleSelectAll | L2157-2171 | visible-page ids (list-view header checkbox passes `orders.map(o=>o.id)` of the page; grid view has NO select-all) | Page |
| Bulk status modal + Reported modal | L4888-5114 | selectedOrders ids, orderStatusesForModal | ids only |
| Bulk attribution modal | L4976-5043 | selectedOrders ids, sellers list | ids only |
| Bulk-confirm failure toast → StockShortageModal | L2117-2121 | `orders.find(id)` for failed ids → name + items for computeShortLines | Only selected rows; page/selection-scope |
| `?view=<orderId>` deep link | L1005-1058 | row by id | Cache hit is an optimization only; has a **by-id fallback fetch with identical joins + history** → lazy per-row detail already precedented here |
| `?addProductId` prefill | L1064 | products list only | n/a (not aggregate) |
| handleEdit → edit form | L2360-2425 | full row: all scalar cols + items (product_id, quantity, unit_price, accessory_id, accessory_quantity, accessory_unit_price) | Page row (or lazy by-id) |
| OrderViewDialog | L4851 | `orderId` only — fetches its own data | Independent (the lazy-detail precedent) |
| OrderStatusHistoryDialog | L5157 | the ROW object (header info); history fetched separately | Page row |
| QuickStatusChangeModal | L4866 | the ROW (quickStatusOrder) | Page row |
| ParcelTrackingDialog | L5148 | orderId only | Independent |
| Export wizard | L5167-5175 | **NOT seeded from aggregate** — receives only `activeBusinessId`, fetches its own chunked data | Independent |
| CustomerInsights (inside add/edit modal) | L3876/L3896 | phone from form; own fetchAllRows | Independent |
| WebhookHealthIndicator | L2544 | activeBusinessId only | Independent |
| Grid cards / OrdersListView | L3218 / L3509 | see §6 rendered columns | Page |

Row callbacks passed to OrdersListView: onView/onEdit/onDelete(id,name)/onTrackParcel(id)/onStatusHistory(row)/onQuickStatusChange(row)/onStockAlert(row) — all page-row based.

## 6. Column usage classification (rendered in list vs filter-only vs dialog/edit-only)

### Rendered in LIST view (default view, OrdersListView.tsx) per row
- items: first item having `product.image_url || accessory.image_url` → thumb + ImageHoverPreview(name, code); fallback name from any item.
- `name`, `phone`, `created_at` (formatted 'dd MMM · HH:mm').
- `city.name`; `channel.name` (sheet icon) ELSE `source_name` (SourceIcon) — **channel join is render-only, never filtered/searched**.
- Order status button: `status.label`, `status.color`, `status.icon`; postponed sub-line: `isOrderCategory(order_status_id,'postponed') && reported_date`.
- Package badge: `resolveById(package_status_id)` (master resolver) → fallback `package_status.label/color/icon` → fallback `getCourierPackageStatus(order)` = latest `courier_parcels` row (by created_at) with `status.label` (embedded package_statuses label/color) — courier orders keep pkg status on the parcel, not orders.package_status_id (L492).
- Delivery: `company.name` + `resolveProviderLogo(company)` (uses provider_type+logo_url) ELSE `courier` avatar (avatar_url, avatar_config, name); latest tracking code = max created_at over `[...parcels, ...courier_parcels].filter(tracking_code)` (NOT note-gated for display).
- Commercial: `assignee.name` + avatar.
- Amount: `price` (fr-FR formatted) + DH.
- Flags: `replace` badge, `_exchangeRole` tags, duplicate (yellow), short (red), locked (checkbox disabled), selected.
- canTrack: `getLatestTrackableCompanyParcel(order)` (parcels: needs tracking_code non-empty, latest by created_at, `provider_id || provider.id`; returns {id, tracking_code, external_id, provider_id}) OR any courier_parcel with non-empty tracking_code.

GRID view (L3218-3505) renders the same fields plus: status color top-stripe, reported_date recall block (date + HH:mm), tracking code strip, city/source/provider chips.

### Filter-only columns (never rendered in list)
`master_city_id`, `confirmed_by_id`, `seller_id` (rendered via assignee join, filtered via FK), `courier_id`/`company_id` (FKs), `order_status_id`/`package_status_id` (FKs), the 8 date columns other than created_at/reported_date (`date`, `updated_at`, `assignment_date`, `confirmation_date`, `annulation_date`, `date_livraison`), the 6 `*_old_tracking` (filter #13 + search + edit form), `items[].product_id` (filter #14), parcels/courier_parcels `company_delivery_note_id`/`courier_delivery_note_id` (tracking-filter gates), `stock_changed` (short-flag skip), `exchange_of_order_id` (page grouping only).

### Search-only
`address`, `note`, `delivery_note`, `raw_price`, `shipping_cost`, `item.note`, `parcels[].id`, `parcels[].provider.name`, raw uuid columns.

### Edit/dialog-only (via handleEdit / selectedOrder)
`address`, `shipping_cost`, `include_delivery_in_total`, `note`, `delivery_note`, all item money fields (unit_price, accessory_unit_price), the 6 old-tracking values. All reconstructable from a lazy by-id fetch.

### KPI/flag-only
`price` (Total sales), `replace` (KPI splits + filter), `status.is_paid`/`status.is_unpaid` (lock), items quantities vs stock (short).

### Selected but apparently unused on this page
`parcels[].status:package_statuses(label,color)` (company-parcel status join — only courier_parcels' status is read, via getCourierPackageStatus), `parcels[].status_id`, `parcels[].external_id` + `provider_id` (only for canTrack + the id handed to ParcelTrackingDialog — dialog refetches by orderId anyway), `channel.type`, most of `order_statuses(*)`/`package_statuses(*)` beyond label/color/icon/is_paid/is_unpaid, base `*` columns like `payed`, `delivered`, `processing`, `published`, `current_*_note_id`, `external_source_key/row_id`, `swap_only`, `payment_delivery_id`, `canceled_by_id`, `deleted_by_id`.

## 7. Design-relevant gotchas
1. Search matches raw UUIDs and joined text incl. parcel provider names — server search must decide which of these to keep (dead fields `total_price`/`discount`/`history` can be dropped without behavior change on this page).
2. Phone filter is raw substring with NO normalization while duplicatePhones normalizes `[\s-]` — two different phone semantics coexist.
3. Package filter vs package display asymmetry: filter hits only `orders.package_status_id`; courier orders show a parcel-derived status the filter can't select.
4. Tracking FILTER is delivery-note-gated; tracking DISPLAY and top-SEARCH are not.
5. Date presets computed in browser-local tz, inclusive interval; null date field under an active range = excluded.
6. `filterStatusIds`/`filterPackageStatusIds` (category-wide, arrays) arrive only via router nav-state from dashboard KPI cards; RPC must accept id-array params.
7. Sort is exactly `created_at DESC` — keyset cursor = (created_at, id).
8. KPI money excludes `replace=true`; counts include them; `Number(o.price)||0`.
9. `selectedOrders` survives filter/page changes → server-side locked/business guards needed for bulk ops.
10. Query-key invalidation contract: `['orders-aggregate', activeBusinessId]` is invalidated by EcomBizRealtime (layout) and 5 in-file mutations — replacement keys must be wired into both.