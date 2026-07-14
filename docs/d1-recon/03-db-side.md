# D1 DB-side recon — orders list/KPI/keyset foundation (live box, 2026-07-14)

All facts verified on the live box via `~/.igrowfast/db.sh` (pg_attribute/pg_constraint/pg_indexes/pg_policies/pg_proc/information_schema + exact counts). Precedent files read: `supabase/migrations/20260714120000_notes_search_filter.sql`, `supabase/migrations/20260714210000_d4_money_aggregates.sql`, `ops/box/whatsapp-schema/migrations/whatsapp_024_assignment_roster_rpc.sql`.

---

## 1. LIVE SCHEMA

Tenant column on every tenant table is `"DigiCom Business"` uuid (space in name — must be double-quoted in all SQL).

### 1.1 public.orders (49 columns)

| column | type | null | default |
|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() |
| order_status_id | uuid | null | — |
| source_id | uuid | null | — |
| name | text | null | — |
| phone | text | null | — |
| address | text | null | — |
| date | timestamptz | null | — (0 NULL rows today) |
| note | text | null | — |
| delivery_note | text | null | — |
| price | numeric | null | 0 |
| shipping_cost | numeric | null | 0 |
| courier_id | uuid | null | — |
| company_id | uuid | null | — |
| payment_delivery_id | uuid | null | — |
| date_livraison | timestamptz | null | — |
| raw_price | numeric | null | 0 |
| delivered | boolean | null | false |
| payed | boolean | null | false |
| confirmed_by_id | uuid | null | — |
| stock_changed | boolean | null | false |
| confirmation_date | timestamptz | null | — |
| annulation_date | timestamptz | null | — |
| source_name | text | null | — |
| processing | boolean | null | false |
| current_delivery_note_id | uuid | null | — |
| current_return_note_id | uuid | null | — |
| assignment_date | timestamptz | null | — |
| reported_date | timestamptz | null | — |
| published | boolean | null | true |
| date_deleted | timestamptz | null | — (soft delete; 5 rows deleted) |
| replace | boolean | null | false (exchange leg; 9 rows) |
| created_at | timestamptz | null | now() |
| updated_at | timestamptz | null | now() |
| "DigiCom Business" | uuid | null | — |
| master_city_id | uuid | null | — |
| seller_id | uuid | null | — |
| package_status_id | uuid | null | — |
| canceled_by_id | uuid | null | — |
| include_delivery_in_total | boolean | NOT NULL | true |
| coliaty_old_tracking | text | null | — |
| ameex_old_tracking | text | null | — |
| current_courier_return_note_id | uuid | null | — |
| current_courier_payment_note_id | uuid | null | — |
| quicklivraison_old_tracking | text | null | — |
| forcelog_old_tracking | text | null | — |
| sendit_old_tracking | text | null | — |
| delvoexpress_old_tracking | text | null | — |
| deleted_by_id | uuid | null | — |
| source_review_status | text | NOT NULL | 'approved' (0 'pending' rows today) |
| external_source_key | text | null | — |
| external_row_id | text | null | — |
| exchange_of_order_id | uuid | null | — |
| swap_only | boolean | NOT NULL | false |

**orders FKs:** "DigiCom Business"→businesses(id) CASCADE · order_status_id→order_statuses(id) · package_status_id→package_statuses(id) ON DELETE RESTRICT · source_id→sales_channels(id) SET NULL · master_city_id→master_cities(id) SET NULL · company_id→providers(id) SET NULL · seller_id→users(id) · confirmed_by_id→users(id) · courier_id→users(id) SET NULL · deleted_by_id→users(id) SET NULL · **canceled_by_id→auth.users(id)** (NOT public.users — join to public.users only by id-equality convention) · payment_delivery_id→company_payment_notes SET NULL · current_return_note_id→company_return_notes SET NULL · current_courier_return_note_id→courier_return_notes SET NULL · current_courier_payment_note_id→courier_payment_notes SET NULL · exchange_of_order_id→orders(id) SET NULL (self-FK).
**ANOMALY: `current_delivery_note_id` has NO FK constraint and NO index** — every sibling current_* pointer has both. Filtering/joining on it = seq scan today.
Unique partial: `orders_external_row_idem_uidx (external_source_key, external_row_id) WHERE both NOT NULL AND date_deleted IS NULL`.

### 1.2 Joined tables

**order_items** (1:N, ~2.75 rows/order): id, order_id uuid NOT NULL→orders CASCADE, product_id uuid NOT NULL→products, quantity int NOT NULL df 1, unit_price numeric NOT NULL df 0, total_price numeric df (quantity*unit_price), accessory_id→accessories, accessory_quantity int df 0, accessory_unit_price numeric df 0, product_unit_cost_snapshot numeric, "DigiCom Business"→businesses CASCADE, created_at/updated_at. **Join hazard: row multiplication — must jsonb_agg or lazy-load.**

**company_parcels** (0..N per order; 1693 rows vs 2100 orders, order_id nullable, NO unique on order_id): id, provider_id→providers CASCADE, order_id→orders CASCADE, status_id→package_statuses SET NULL, company_delivery_note_id→company_delivery_notes SET NULL, external_id text, provider_response jsonb (wide — 731 B/row avg), tracking_code text, "DigiCom Business"→businesses CASCADE, created_at/updated_at. **Multiplication hazard: multiple parcels per order possible — lateral LIMIT 1 (latest) or aggregate.**

**courier_parcels** (20 rows): id, courier_id→users CASCADE, order_id→orders CASCADE, status_id→package_statuses SET NULL, courier_delivery_note_id→courier_delivery_notes SET NULL, tracking_code text, is_fragile/is_open/is_try_on bool df false, delivered_at timestamptz, "DigiCom Business"→businesses CASCADE, created_at/updated_at. Same no-unique-on-order_id hazard.

**order_statuses** (31 rows, global/cross-tenant reference): id, code text NN, label text NN, ranking numeric, color, icon, recheck, active, show_in_order/show_in_quick_status/show_in_seller_confirmation/show_in_seller_suivi bool NN, perf_breakdown + perf_breakdown_phase, and the flag columns (all boolean NOT NULL df false): pending_confirmation, is_confirmed, is_cancelled, excluded_from_delivery_rate, is_new, is_paid, is_unpaid, is_callback, is_return, is_relaunch, is_postponed, deducts_stock, is_fake, is_double, is_blacklisted.

**package_statuses** (33 rows, global reference): id, code NN, label NN, delivery_service_statuses jsonb df '[]', ranking, color, icon, recheck, active, show_in_courier/show_in_seller_suivi/show_in_seller_confirmation, perf_breakdown(+phase), flow_rank smallint, and flags (boolean NOT NULL df false): is_delivered, is_returned, is_shipped, excluded_from_delivery_rate, is_new, is_cancelled, is_postponed, is_terminal, is_refused, is_recheck, is_awaiting_pickup (added mig 20260714011751).

**master_cities** (1131 rows, global): id, name text NN, zone_id→zones SET NULL, created_at/updated_at.

**users** (23 rows): id, name NN, username NN, email NN (globally unique), role user_role NN, active, permissions jsonb, "DigiCom Business"→businesses SET NULL, commission_price, phone, avatar_url, avatar_config, commission_basis NN df 'per_order', bank/cin/address fields, courier_parcel_* flags, payment_type, salary_amount, backup_admin/backup_root bool NN. Unique: email global; (COALESCE(biz, zero-uuid), lower(username)).

**providers** (4 rows): id, name NN (unique per business), logo_url, color, provider_type, active NN df true, api_* credential columns, per-carrier option flags (coliaty/ameex/ozon/quicklivraison/vitex/forcelog/sendit/digylog/delvoexpress), session_cache jsonb, "DigiCom Business"→businesses CASCADE.

**sales_channels** (1 row): id, type NN, name NN, spreadsheet_id/name, start_row, is_active NN df true, sync_cadence NN df 'manual', column_map jsonb, last_synced_at, sync_status, sync_error, has_header NN, "DigiCom Business"→businesses CASCADE.

**products** (via order_items.product_id): id, name, code, label, description, cost_price numeric(10,2), selling_price numeric(10,2), image_url, active, stock, "DigiCom Business". **accessories** (via order_items.accessory_id): id, name, code, image_url, cost_price, stock, active, "DigiCom Business".

---

## 2. EXISTING INDEXES

### 2.1 orders (22 indexes)
- `orders_pkey` (id)
- `idx_orders_digicom_business` btree ("DigiCom Business") — single col
- `idx_orders_created_at` btree (created_at DESC) — GLOBAL, not per-business
- **Search (from mig 20260714120000, all partial `WHERE date_deleted IS NULL`):**
  - `idx_orders_biz_name_fold_trgm` GIN ("DigiCom Business", fold_text(name) gin_trgm_ops)
  - `idx_orders_biz_phonenorm_trgm` GIN ("DigiCom Business", normalize_phone_for_customer(phone) gin_trgm_ops)
  - `idx_orders_business_phonenorm_live` btree ("DigiCom Business", normalize_phone_for_customer(phone))
- `idx_orders_phone` btree (phone) — legacy, raw column
- FK single-col btrees: order_status_id, package_status_id, source_id, master_city_id, seller_id, courier_id, company_id, confirmed_by_id, canceled_by_id, payment_delivery_id, exchange_of_order_id, current_courier_payment_note_id; partial: current_return_note (WHERE NOT NULL), current_courier_return_note (WHERE NOT NULL), deleted_by_id (WHERE date_deleted IS NOT NULL)
- `orders_external_row_idem_uidx` partial unique (see §1.1)

### 2.2 GAPS for D1 (facts, not design)
- **NO index on orders.date at all** (any direction, any composite). Business+date keyset `("DigiCom Business", date DESC, id DESC)` has ZERO support — would filter idx_orders_digicom_business then sort.
- No (biz, order_status_id) / (biz, package_status_id) composites — status filters at scale would intersect single-col indexes.
- No composite for seller keyset (seller_id single-col only).
- The six `*_old_tracking` columns on orders: NO indexes. Tracking search support exists only on parcels tables: `idx_cparcels_biz_track_trgm` / `idx_courparcels_biz_track_trgm` GIN ("DigiCom Business", tracking_code gin_trgm_ops).
- orders trigram indexes are PARTIAL on `date_deleted IS NULL` — any query wanting them must carry that predicate.
- `current_delivery_note_id`: no index (see §1.1 anomaly).

### 2.3 Joined-table index support
- order_items: order_id, product_id, accessory_id, biz (all single btree) — order_id lookup fine.
- company_parcels: order_id, provider_id, status_id, delivery_note_id, biz btrees + biz+tracking trgm GIN.
- courier_parcels: same shape + (courier_id, delivered_at DESC) partial.
- master_cities: name btree, zone_id.
- Extensions: **pg_trgm** and **unaccent** live in schema `extensions`; **btree_gin** installed (enables the (uuid, text-expr) composite GINs — reuse this for any new search axis).

---

## 3. ROW COUNTS + WIDTH (exact counts; reltuples matches)

| table | exact rows | heap | total (w/ idx+toast) | avg B/row |
|---|---|---|---|---|
| orders | **2100** (2095 live, 5 soft-deleted) | 720 kB | 2600 kB | ~352 |
| order_items | 5770 | 1008 kB | 1792 kB | ~187 |
| company_parcels | 1693 | 1208 kB | 2040 kB | ~731 (provider_response jsonb) |
| courier_parcels | 20 | 40 kB | 240 kB | — |
| master_cities | 1131 | 96 kB | 272 kB | ~87 |
| users | 23 | 16 kB | 168 kB | — |
| package_statuses | 33 | 16 kB | 96 kB | — |
| order_statuses | 31 | 8 kB | 64 kB | — |
| providers | 4 | 8 kB | 80 kB | — |
| sales_channels | 1 | 8 kB | 48 kB | — |

Distribution: 3 businesses — 1788 / 302 ('test env') / 10. orders.date range 2026-03-29→2026-07-14, **0 NULL dates** (column nullable — keyset must still define NULL ordering or coalesce). replace=true: 9. source_review_status='pending': 0. seller_id set: 2078. courier_id set: 19. company_id set: 1775. Volume is small today; index design must assume growth.

---

## 4. EXISTING RPC PATTERNS (the conventions D1 must follow)

### 4.1 search_*_note_ids family (mig 20260714120000, live-verified: 6 fns, all INVOKER/STABLE, `search_path=public, pg_catalog`)
Exact pattern per fn (`search_company_delivery_note_ids(p_term text) returns setof uuid`):
- CTE `q`: `biz = public.current_user_digicom_business_id()`, `fq = public.fold_text(p_term)`, `pq = regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','')`, `raw = btrim(coalesce(p_term,''))`.
- Body: outer select of header ids gated by `h."DigiCom Business" = q.biz` **and re-gated by the header's own RLS** (INVOKER), with `h.id IN (UNION of one index-driven branch per search axis)`.
- Length guards collapse branches: fold ≥2 chars, phone ≥3 digits, raw tracking ≥2 chars.
- `ORDER BY h.created_at DESC LIMIT 150` — **id-cap = 150** because Kong's 8k URL limit 414s at ~300 uuids in a PostgREST `.in()`.
- `revoke all ... from public, anon; grant execute ... to authenticated;`
- Keyset index convention from same mig: btree `("DigiCom Business", created_at DESC, id DESC)` per listed table.
- Helper fns: `fold_text(text)` IMMUTABLE PARALLEL SAFE sql, `search_path=pg_catalog` (lower+translate accent fold — deliberately not unaccent(), which is STABLE); `normalize_phone_for_customer(text)` IMMUTABLE plpgsql (digits-only; 10-digit leading-0 → '212'+rest). **Functional-index match requires calling them with identical expressions.**

### 4.2 D4 aggregate conventions (mig 20260714210000, applied)
- `SECURITY INVOKER`, `STABLE`, **`SET search_path TO ''`** (all refs schema-qualified, `"DigiCom Business"` quoted) — note this differs from the search family's `public, pg_catalog`; D4 is the newer convention.
- **Explicit `p_business uuid` first param** — defense-in-depth AND the index driver; RLS remains the security gate.
- Optional filters as null-tolerant params: `(p_x is null or col op p_x)`; to-date exclusive: `created_at < p_date_to + 1`.
- **KPI RPCs return ONE jsonb** (jsonb_build_object / jsonb_agg), never SETOF — SETOF responses are themselves subject to PGRST_DB_MAX_ROWS=1000 (documented defect class). SETOF-table allowed only for known-small cardinality (courier_roster_stats).
- Optional id-set intersection param `p_ids uuid[] default null` with `(p_ids is null or n.id = any(p_ids))` — the composition seam with the search RPC.
- Status semantics via governable flag columns, not text: delivered=`ps.is_delivered`; cancelled=`NOT delivered AND os.is_cancelled AND NOT(is_fake OR is_double)`; fake=`... AND (is_fake OR is_double)`; tracked=non-empty `tracking_code` in company_parcels UNION courier_parcels; pullback=tracked AND `excluded_from_delivery_rate` on either status; exchange legs excluded via `replace IS DISTINCT FROM true`; pool excludes `date_deleted IS NOT NULL` and (admin pages) `source_review_status <> 'pending'`.
- Date-boundary convention for calendar filters: `o.date >= (d::timestamp AT TIME ZONE 'Africa/Casablanca')` / `< ((d+1)::timestamp AT TIME ZONE 'Africa/Casablanca')`.
- Footer per fn: `revoke all ... from public, anon; grant execute ... to authenticated; alter function ... owner to postgres;`
- courier_fees has no unique (courier_id, master_city_id) → LATERAL `ORDER BY updated_at DESC LIMIT 1` to keep 1:1 (reusable anti-multiplication pattern).

### 4.3 WA Assignment precedent (ops/box/whatsapp-schema/migrations/whatsapp_024_assignment_roster_rpc.sql)
Not actually keyset — it is the id-fan-out killer + hardening precedent: uuid[] params capped at 1000 (`too_many_ids`/ERRCODE 22023), p_limit clamped, non-vacuous admin precheck before array checks, full-id-resolution requirement, one server-side join replaces N chunked `.in()` calls (kills PGRST 1000-cap + Kong/nginx 8k-URL law in one move).

---

## 5. RLS ON orders + JOINED TABLES (what INVOKER inherits)

RLS **enabled** on all 10 tables; **NOT forced** (relforcerowsecurity=f). Grants: `authenticated` holds full table-level DML grants everywhere (RLS is the row gate); `anon` has ZERO grants on all of these (post-sweep); users table lacks table-level UPDATE for authenticated (column-grant model) but SELECT is table-level — name lookups fine.

### orders policies (roles={authenticated}, all PERMISSIVE, quals initplan-wrapped `( SELECT fn() )`)
- **SELECT `orders_tenant_select`: `"DigiCom Business" = current_user_digicom_business_id()` — BUSINESS-WIDE ONLY. There is NO seller/courier row restriction on reads.** Every authenticated member of a business (seller, commercial, courier, media buyer) can read ALL of that business's orders through RLS.
- INSERT: biz match AND (admin OR seller_id=auth.uid()).
- UPDATE: biz match AND (admin OR seller_id=uid OR courier_id=uid), same WITH CHECK.
- DELETE: biz match AND admin.

### Joined tables
- order_items / company_parcels / courier_parcels / sales_channels / products / accessories: single `*_tenant_all` ALL policy, `biz = current_user_digicom_business_id()`.
- order_statuses / package_statuses / master_cities: SELECT open to all authenticated (`auth.role()='authenticated'`) — global reference tables; writes owner-only.
- providers: SELECT/UPDATE/DELETE = `is_owner() OR EXISTS(users me WHERE me.id=auth.uid() AND me.biz=providers.biz)` (per-row EXISTS subplan; harmless at 4 rows).
- users: SELECT = self OR same-business OR owner.

### Helper functions (all safe inside INVOKER RPCs)
- `current_user_digicom_business_id()` — sql STABLE **SECURITY DEFINER** search_path=public; `SELECT "DigiCom Business" FROM users WHERE id=auth.uid()`.
- `current_user_is_business_admin()` — sql STABLE SECDEF; role IN ('super admin','admin').
- `is_owner()` — sql STABLE SECDEF; role='owner'.

### Things that would break / bite under INVOKER keyset queries
1. **Seller scoping is NOT in RLS.** A seller-page list/KPI RPC MUST add `seller_id = auth.uid()` (or explicit p_seller validated against auth.uid()) as its own predicate — RLS will happily return the whole business. This is the single biggest leak risk in D1.
2. **Owner gets zero rows**: owner users have biz=NULL (owner confinement trigger) → `current_user_digicom_business_id()` returns NULL → `biz = NULL` is never true. Consistent with the standing "no is_owner() bypass in per-business RPCs" rule — do not add one.
3. **Partial-index dependency**: the biz+name/phone trgm indexes require `date_deleted IS NULL` in the query; search expressions must be byte-identical calls to `public.fold_text(...)` / `public.normalize_phone_for_customer(...)`.
4. **PGRST_DB_MAX_ROWS=1000** applies to SETOF RPC responses too — page size must stay well under 1000 (fine); KPI aggregate must return single jsonb per D4.
5. **Kong 8k URL / ~300-uuid 414** — any id-list handed back for client `.in()` must stay ≤150 (search family convention); better: intersect ids inside the list RPC via `p_ids uuid[]`.
6. **Row multiplication**: order_items (2.75/order) and parcels (no unique on order_id) multiply rows if inner-joined into the list page — aggregate (jsonb_agg) or LATERAL LIMIT 1 or lazy per-row detail.
7. **canceled_by_id points at auth.users** — an INVOKER join to auth.users would fail (no grants); resolve via public.users by id-equality instead.
8. **No keyset index exists** — a new `("DigiCom Business", date DESC, id DESC)` btree (likely partial `WHERE date_deleted IS NULL`) is a prerequisite; plus composites for the hot filter combos if pushed down (status/seller variants).
9. RLS quals are initplan-hoisted (`(SELECT fn())`) — evaluated once per statement; the biz qual is subsumed by an index prefix on `"DigiCom Business"`, so keyset scans stay index-driven. No per-row SECDEF-call blowup.
10. `orders.date` is nullable (0 NULLs today) — keyset ORDER BY needs deliberate NULLS placement (or NOT NULL backstop) to avoid rows vanishing between pages; tiebreak on `id DESC` per the notes-mig convention.
11. `current_delivery_note_id` filter (delivery-note-membership style filters) = unindexed, no FK — needs an index if D1 pushes that filter down.
12. Old-tracking search (`coliaty_old_tracking` + 5 siblings) has zero index support; indexed tracking search must route through company_parcels/courier_parcels trgm GINs.

Migration files referenced: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260714120000_notes_search_filter.sql`, `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260714210000_d4_money_aggregates.sql`, `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/ops/box/whatsapp-schema/migrations/whatsapp_024_assignment_roster_rpc.sql`.