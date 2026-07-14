# D1 DESIGN CONTRACT — orders list server-side teardown (binding)

Inputs: 01-admin-orders.md, 02-seller-orders.md, 03-db-side.md (all live-verified 2026-07-14).
Conventions: D4 (mig 20260714210000) — SECURITY INVOKER, STABLE, `set search_path to ''`, explicit `p_business`, jsonb returns (never SETOF for unbounded sets), grants footer, Casablanca date boundaries, flag-column status semantics. Keyset per notes mig 20260714120000.

## Migration `20260714220000_d1_orders_list.sql`

### Indexes (prerequisites — no support exists today)
```sql
create index if not exists idx_orders_biz_created_keyset
  on public.orders ("DigiCom Business", created_at desc, id desc)
  where date_deleted is null;
create index if not exists idx_orders_biz_seller_created
  on public.orders ("DigiCom Business", seller_id, created_at desc, id desc)
  where date_deleted is null;
```
(date-field range filters ride these + filter; the 8 date columns are NOT individually indexed — documented tradeoff. `orders.date` nullable: sort key is `created_at` which has `default now()`; keyset still coalesces nulls: `order by created_at desc nulls last, id desc` and cursor predicate uses row comparison `(created_at, id) < (p_cursor_created, p_cursor_id)` — nulls-last rows unreachable by cursor are acceptable only if created_at is never null in practice (0 today); guard with `coalesce(created_at, 'epoch')` in BOTH order-by and cursor if needed — implementer decides ONE consistent form).

### RPC 1 — `public.orders_list_page(...) returns jsonb`
`{rows: [...], next_cursor: {created_at, id} | null, page_count: int}`

Params (all optional/null = no-op unless stated):
| param | type | predicate (EXACT parity source: recon 01 §1, 02 for seller) |
|---|---|---|
| p_business | uuid | required; `"DigiCom Business" = p_business` + `date_deleted is null` + `source_review_status <> 'pending'` (admin base pool; SELLER pool per recon 02 — implementer mirrors it) |
| p_seller_scope | uuid | seller-page scoping (assigned-OR-owned semantics per recon 02). **MUST be validated: `p_seller_scope is null or p_seller_scope = (select auth.uid()) or public.current_user_is_business_admin()` else raise.** RLS does NOT scope sellers (03 §5.1) — this predicate is the security boundary |
| p_search | text | server search axes: fold_text(name) trgm ILIKE, normalize_phone_for_customer(phone), tracking (parcels trgm + 6 old_tracking ILIKE), address/note/delivery_note ILIKE, product name/code via EXISTS order_items→products. Length guards per notes family (fold≥2, digits≥3, tracking≥2). DELTA (documented): raw-uuid/raw_price matching dropped |
| p_status | uuid | `order_status_id = p_status` |
| p_status_ids | uuid[] | applied only when p_status null: `order_status_id = any(p_status_ids)` |
| p_package / p_package_ids | uuid / uuid[] | same shape on package_status_id (orders column only — parity with today, gotcha 3) |
| p_city | uuid | master_city_id eq |
| p_source | text | `source_name = p_source` (case-sensitive parity) |
| p_provider | uuid | `(courier_id = p_provider or company_id = p_provider)` |
| p_date_field | text | whitelist: date, created_at, updated_at, assignment_date, confirmation_date, annulation_date, date_livraison, reported_date; else raise |
| p_date_from / p_date_to | date | Casablanca boundaries, inclusive: `col >= (from::timestamp at time zone 'Africa/Casablanca') and col < ((to+1)::timestamp at time zone 'Africa/Casablanca')`; NULL col never matches (parity) |
| p_customer_name | text | `name ilike '%'||p||'%'` case-insensitive (parity #11; fold_text NOT used — parity is plain lower substring) |
| p_phone | text | RAW substring parity #12: `phone like '%'||p||'%'` (case-sensitive, no normalization) |
| p_tracking | text | parity #13 EXACTLY: whitespace-stripped lowercase substring over the 6 old_tracking cols + company_parcels.tracking_code WHERE company_delivery_note_id IS NOT NULL + courier_parcels.tracking_code WHERE courier_delivery_note_id IS NOT NULL |
| p_product | uuid | EXISTS order_items(product_id = p_product) |
| p_confirmed_by / p_assigned_to | uuid | eq on confirmed_by_id / seller_id |
| p_exchange | text | 'yes': `replace is true`; 'no': `replace is distinct from true` |
| p_cursor_created / p_cursor_id | timestamptz / uuid | keyset: `(created_at, id) < (p_cursor_created, p_cursor_id)` row-comparison |
| p_limit | int | clamp 1..1000, default 100 |

Row shape (SLIM — recon 01 §6 rendered set ONLY; jsonb_agg subqueries to avoid multiplication, 03 §5.6):
`id, name, phone, created_at, price, replace, exchange_of_order_id, source_name, reported_date, stock_changed, order_status_id, package_status_id, city_name, channel:{name,type}, status:{id,label,color,icon,is_paid,is_unpaid}, package_status:{label,color,icon}, courier_pkg_fallback:{label,color} (latest courier_parcel status), courier:{id,name,avatar_url,avatar_config}, assignee:{id,name,avatar_url,avatar_config}, company:{id,name,provider_type,logo_url}, items:[{product_id,accessory_id,quantity,accessory_quantity,name,code,image_url}], latest_tracking_code, can_track:{parcel_id,tracking_code,external_id,provider_id}|null, is_duplicate_phone bool`
- `is_duplicate_phone`: server-computed per recon 01 §3 — normalized `regexp_replace(phone,'[\s-]','','g')` count > 1 over the FULL live business pool (unfiltered), matched back per row.
- Edit form does NOT ride the page row anymore → lazy by-id (see FE).

### RPC 2 — `public.orders_kpis(same filter params, no cursor/limit) returns jsonb`
`{active_count, total_sales, exchange_count, avg_order, total_count}` — money over `replace is distinct from true` subset (Σ Number(price)); counts include exchange legs; avg = round(sales/count) (parity recon 01 §3). total_count = filtered count (feeds counter pill + totalPages).

### RPC 3 — `public.orders_bulk_guarded(p_ids uuid[], p_action text, p_status uuid default null, p_seller uuid default null) returns jsonb`
Moves the client-side locked/biz guards server-side (selection persists across pages — recon 01 §5): caps array at 1000 (WA 024 precedent), skips ids that are locked (`status.is_paid or status.is_unpaid`), soft-deleted, or foreign-business (RLS also blocks); p_action in ('status','attribute'); performs the UPDATE; returns `{applied:[ids], skipped:[{id,reason}]}`. INVOKER — orders UPDATE RLS applies per row.

## Frontend restructure (both pages)

1. Kill `orders-aggregate`. New queries: `['orders-page', biz, filtersKey, cursor]` (keepPreviousData) + `['orders-kpis', biz, filtersKey]` (debounced with search).
2. Keyset pagination: cursor STACK in state (Prev pops, Next pushes next_cursor); page/totalPages from total_count. pageSize options unchanged.
3. DELETE the client filter/search machinery (orderMatchesAllFilters, orderMatchesTopSearch usage, orderMatchesTrackingFilter, duplicatePhones/short/locked full-set derivations). Short-flag: compute over PAGE rows (slim items vs stock maps). Locked: `row.status.is_paid||is_unpaid` per page row for UI; bulk ops call orders_bulk_guarded.
4. Edit/quick-status/history dialogs: page row where its fields suffice; **edit form → shared lazy `fetchOrderById` (extend the existing ?view fallback: full select + history)** — new small module `src/lib/orders/fetchOrderById.ts`, both pages use it.
5. Invalidation rewiring (CRITICAL, recon 01 gotcha 10): `EcomBizRealtime` invalidates `['orders-page']` + `['orders-kpis']` prefixes (replaces ['orders-aggregate']); all 5 admin mutations + seller mutations likewise.
6. Seller page: identical shell, scoping via p_seller_scope=uid, seller money display rule intact (price incl delivery — display comes from RPC row price, parity), seller-specific filters per recon 02.
7. Behavior deltas ACCEPTED (document in code comments): search axes trimmed (no uuid/raw-price matching); exchange-pair adjacency remains page-local (unchanged semantics, boundary split possible); refetchOnMount 'always' + focus refetch KEPT but now O(page).

## Review gates
- EXPLAIN (ANALYZE off) on orders_list_page base + hot filter combos: must show idx_orders_biz_created_keyset (no seq scan of orders).
- Parity: RPC row/KPI outputs vs old client math on the live business (sub-1000 so old==truth).
- Seller-scope leak test: seller JWT calling with foreign p_seller_scope must error; omitted scope on seller page impossible (page always passes uid).
