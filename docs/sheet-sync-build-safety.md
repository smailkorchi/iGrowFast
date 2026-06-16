# Sheet Sales-Channel Sync — Build-Safety Dossier

> Source: 12-subsystem live-DB sweep + adversarial audit (project `zjkqprrfbibjoslvlmxf`), 2026-06-16.
> Status: pre-build reference. NOT yet implemented. Trust the LIVE DB over `supabase/migrations/*` (drift).
> Companion: memory `sheet-sales-channel-sync-design`, `secrets-topology-two-stores`, `orders-parcels-logistics-mirror`.

## 0. Goal & model (locked)

Connect any business's Google Sheet; transfer each row into `orders` immediately as a **pending draft**
(`orders.source_review_status='pending'`), even if incomplete. Pending = **inert**: excluded from every
operational view, computation, analytics, AI, notification, and parcel flow; rendered gray like the
duplicate-order highlight. A human ALWAYS approves. Approval flips to `'approved'`, validates, and is the
moment the full order machine engages — identically to an XLSX import. Engine runs as `service_role`.

## 1. System map (what the sync plugs into)

An order is born by INSERT into `orders` (manual form, XLSX `ImportOrders.tsx`, or the sheet engine). On INSERT:
- **BEFORE:** `trg_auto_attribute_order` (seller round-robin; mutates `seller_attribution_state`; stamps
  `seller_id/assign_id/assignment_date`; skips only `source_name='whatsapp'`), then
  `trg_update_order_package_status_id` (label↔id; no-op when label NULL).
- **AFTER:** `audit_orders` (→ `audit_logs`), `trg_ai_dirty_orders` (marks the business 'order' AI source dirty →
  30-min `ai-indexer` re-embeds), `trg_sync_customer_on_order_insupd` (recomputes `customers` LTV cache for the phone).
- **order_items INSERT:** `set_order_item_product_cost_snapshot` (BEFORE), `auto_assign_seller_from_products`
  (AFTER; backfills `orders.seller_id`), audit.
- XLSX import then calls **`sync_imported_orders(uuid)`** — business-wide: cheapest provider + recompute
  `shipping_cost`/`price` for every provider-less order with a city, and inserts default-accessory `order_items`.

Status lives in `order_status_id` (nullable, no FK/CHECK). **Stock moves ONLY on UPDATE into PROCESSED/RETURN/CONFIRMED**
via `handle_order_status_stock_update` (gated by `stock_changed`). Parcels are created later in delivery-note wizards;
their AFTER triggers mirror status onto `orders.package_status_*`; AFTER-DELETE `clear_order_logistics_when_no_parcels`
is the sole authority that NULLs logistics fields + reverses stock when the last parcel goes. `orders` is in the
`supabase_realtime` publication. **AI is conversation-driven (`wa_messages` inbound → `ai-router`), never
order-driven** — orders are a passive read source. No insert-time path messages/charges/notifies a customer (verified).

## 2. Invariants we must not break

1. **Seller round-robin fires exactly once, only at approval.** Attribution at draft insert burns a commercial's
   daily slot for an order that may be discarded — permanent fairness skew. (Two writers: see §4 M1.)
2. **`customers` cache counts only approved + live orders.** `refresh_customer_from_orders` filters only
   `date_deleted IS NULL` today; drafts would inflate `total_orders`/`total_spent`/LTV and light the duplicate badge.
3. **Stock mutates only on UPDATE into PROCESSED with `stock_changed=false`.** A pending draft must never reach
   PROCESSED nor carry `stock_changed=true`, or `clear_order_logistics_when_no_parcels` over-credits on discard.
4. **A parcel-less order has zero logistics state.** Drafts leave `tracking_number`, `package_status_*`,
   `current_*_note_id`, `courier_id`, `company_id` NULL and `stock_changed=false`. `orders.tracking_number` is a
   dead mirror (analytics count via `parcels.tracking_code`) — never populate it.
5. **`source_review_status='pending'` is DISTINCT from `pending_confirmation`/`pendingIds` (NEW+RAPPEL).** Conflating corrupts confirmation rate.
6. **Every engine read/insert as service_role must stamp `"DigiCom Business"`.** service_role bypasses RLS; for
   *authenticated* users a hard tenant guard exists (see §4 C1), but the engine has zero net under it.
7. **Approved sheet orders behave IDENTICALLY to XLSX imports.** Same trigger path (no `whatsapp` skip), same
   `sync_imported_orders`. Gating keys on `source_review_status` ONLY — never `source_name`/`source_id`.
8. **Idempotency on `(external_source_key, external_row_id)`.** Only `orders_pkey` exists today; a re-poll without the
   partial unique index inserts a duplicate draft and re-fires every trigger.
9. **`order_items.product_id` is NOT NULL.** No line item for an unresolved product; parent draft may be productless.
10. **Pending drafts invisible to AI** (lookup-by-phone, get-status, repeat-customer, summarize-sales, ads-roi, indexer).
11. **`refresh_customer_from_orders` recompute-from-scratch idempotency preserved** so approval/discard self-heal.
12. **SECURITY DEFINER + `search_path` headers preserved verbatim** on every `CREATE OR REPLACE`. (Per-function — see §4 C/7.)
13. **`source_id` FK references a same-business channel; `source_name` stays populated for approved orders** (analytics keys on free-text `source_name`, 1167/1167).
14. **AI pipeline entry boundary stays `wa_messages` inbound only.** No order-INSERT trigger may invoke `ai-router`/`ai-tool-runner`. (Verified: holds.)

## 3. Pending-draft containment contract (THE critical deliverable)

Exclude `source_review_status='pending'` at **every** location below. **Use `IS DISTINCT FROM 'pending'`
(or `<> 'pending'`), NEVER `= 'approved'`** — legacy/NULL rows must stay operational.

### A. DB functions (patch via `CREATE OR REPLACE`, headers verbatim per function)
1. `auto_attribute_order` — FIRST guard `IF NEW.source_review_status='pending' THEN RETURN NEW;` (mirror whatsapp early-return).
2. `auto_assign_seller_from_products` — fetch parent `source_review_status`; RETURN NEW when parent pending.
3. `refresh_customer_from_orders` — `AND source_review_status IS DISTINCT FROM 'pending'` on BOTH aggregate and latest-order SELECTs. **Highest leverage.**
4. `trg_sync_customer_from_orders` — short-circuit when pending; reference `NEW.*` ONLY inside the `TG_OP IN ('INSERT','UPDATE')` branch (NEW is NULL on DELETE; live fn already does this — keep the structure).
5. `ai_dirty_orders` — **NOTE (audit C2): not order-granular** — it dirties the whole business 'order' source on any write and references neither NEW nor OLD status. Gating "on transition" requires ADDING OLD/NEW comparison logic, not a one-line filter.
6. `sync_imported_orders(uuid)` — `AND source_review_status IS DISTINCT FROM 'pending'` on BOTH the order loop AND the order_items loop, OR fork an order-scoped variant for approval. **Shared with XLSX — stay backward compatible.**
7. `ai_indexer_fetch_payload` (`p_kind='order'`) — `AND o.source_review_status <> 'pending'`.
8. `ai_skill_lookup_orders_by_phone` — exclude (customer-facing WhatsApp lookup).
9. `ai_skill_get_order_status` — exclude (customer-facing).
10. `ai_skill_identify_repeat_customer` — exclude in orders aggregates.
11. **`reattribute_unassigned_orders(p_business_id, p_date)` — `AND source_review_status IS DISTINCT FROM 'pending'` in its loop. (AUDIT M1 — biggest miss; SECOND attribution writer, operator-invokable.)**
12. **`ai_skill_summarize_sales` — exclude. (AUDIT M2; leaks drafts into AI-reported sales.)**
13. **`ai_skill_ads_roi` — exclude (defense-in-depth). (AUDIT M3.)**

### B. Trigger metadata
14. **`trg_sync_customer_on_order_insupd` UPDATE OF list — ADD `source_review_status`.** Confirmed absent today
    (list = `phone, name, address, master_city_id, price, date, date_deleted, "DigiCom Business"`). Without it a pure
    pending→approved flip touching no listed column will NOT refresh the customer → approved customer invisible. **CRITICAL.**

### C. Client list / realtime (cache-bypassing — DB fix does NOT cover these; line numbers UNVERIFIED, confirm in Phase 2)
15. `admin/Orders.tsx` aggregate query + `duplicatePhones` memo (~2091–2110) + realtime INSERT subscriber + `orderMatchesAllFilters` + status memos.
16. `seller/Orders.tsx` aggregate + realtime + `duplicatePhones` memo (~2111–2124) + status memos.
17. `OrdersListView.tsx` / `SellerOrdersListView.tsx`.
18. `OrderStatusNotifications.tsx` UPDATE handler — skip `pending` rows alongside the existing `date_deleted` skip; approval UPDATE must not fire the operational delivery toast.

### D. Analytics / KPI (filter only `date_deleted` today — each needs the exclusion; client line refs UNVERIFIED — the dedicated analytics reader returned a stub, so confirm each during Phase 2)
19. `DashboardKPICards`, `ConfirmationPipeline`, `PendingOrdersBreakdown`, `DashboardSellersPerformance`, `SellerSelfPerformanceSection`, `DashboardProductsPerformance`.
20. `CustomerInsights`, `admin/Customers.tsx` list, `analytics/CustomersSection`.
21. `analyticsDefinitions.ts` + consumers: `AdsSection`, `OrdersSection`, `MediaBuyersSection`, `ProfitabilitySection`, `BusinessHealthSection`, `SalesChannelsSection`, `CouriersSection`.
22. `useCampaignMetrics`, `useMediaBuyerStats`, `useMediaBuyerEarnings`, `AdsHistory.tsx`, `mediabuyer/Orders.tsx`, `collaborators/Sellers.tsx`.
23. **DB view `seller_daily_earnings` (AUDIT M4)** — self-protecting (INNER JOIN delivered + `seller_id NOT NULL`; a true draft can't appear). No patch, but it proves analytics also live in DB views, not only `.tsx`.

### E. Status pipeline / history
24. `order_status_history` — only the pending→approved transition logs, as the first real status.

### F. Defensive (drafts must never reach these — guard anyway)
25. `provider-webhook` order lookups (by tracking_number / by id) — add `IS DISTINCT FROM 'pending'`.
26. `ai-tool-runner` mutation/quote skills (`recover_abandoned_cart`, `apply_discount`, `send_payment_reminder`, facture/devis, `create_delivery_note`, `edit_order`, `cancel_order`, `change_delivery_info`, `request_review_after_delivery`).

## 4. Audit corrections (live-DB verified — supersede the sweep where they conflict)

- **C1 — RLS:** `orders_tenant_insert` WITH CHECK = `"DigiCom Business" = current_user_digicom_business_id()`;
  `orders_tenant_update` has both USING and WITH CHECK. The null field is USING (INSERT has no USING). Authenticated
  users HAVE a hard tenant guard. **Real exposure is service_role bypass only** — do NOT justify the self-stamp with
  "null WITH CHECK accepts NULL". `sales_channels` and `customers` RLS are genuinely NOT tenant-scoped
  (`auth.role()='authenticated'` only) — cross-tenant readable/writable; tighten if sensitive.
- **C2 — `ai_dirty_orders`** is business-level, not order-granular; "gate on transition" needs new OLD/NEW logic.
- **C3 — trigger count:** 8 UPDATE/DELETE-only orders triggers (`trg_order_status_stock_update`,
  `trg_set_order_date_livraison`, `trigger_orders_set_unpaid_on_delivery`, `update_orders_updated_at`,
  `zzz_orders_keep_paid`, `trg_auto_log_order_status_history`, `trg_sync_attribution_manual`,
  `trg_sync_customer_on_order_delete`) + the INSERT/UPDATE-OF customer-sync trigger.
- **C4 — `trg_sync_customer_from_orders`** already isolates NEW inside INSERT/UPDATE branch; the "NEW on DELETE" risk
  is a coding-discipline note, not a live defect — keep the structure when patching.
- **M1 (CRITICAL)** — `reattribute_unassigned_orders` is a second attribution writer; patch its loop (see §3.A.11).
- **M2/M3** — `ai_skill_summarize_sales`, `ai_skill_ads_roi` leak drafts into AI sales/ROAS; patch (§3.A.12/13).
- **M4** — DB view `seller_daily_earnings` aggregates orders (self-protecting).
- **FK cascades from `orders`:** CASCADE → `order_items`, `order_status_history`, `company_parcels`,
  `courier_parcels`, `company_return_note_orders`, `courier_payment_note_orders`. SET NULL →
  `courier_return_note_orders`. **NO ACTION (blocks) → `company_payment_note_orders`.** For a true pending draft
  (no parcels/notes) a hard DELETE is non-destructive. Standard discard = `date_deleted` soft-delete; nightly
  `purge_soft_deleted_orders` (03:00) deletes payment-note rows first then the order (handles the RESTRICT FK).
- **`update_order_package_status_id` is NOT SECURITY DEFINER** (just `SET search_path`) — do not blanket-apply SECURITY DEFINER.

## 5. Blast radius of each schema change

- **`orders += source_review_status, external_source_key, external_row_id`** — `source_review_status`
  **NOT NULL DEFAULT 'approved'**, backfill all 1167 existing rows (all NULL today). A `='approved'` filter against
  NULL legacy rows would mass-hide 1158 real orders (CRITICAL). Adding the column forces `CREATE OR REPLACE` on §3.A
  functions (diff headers before/after). MUST be added to `trg_sync_customer_on_order_insupd` UPDATE OF list. New
  column rides every realtime payload (subscribers tolerate extra fields).
- **Partial unique index** — `WHERE external_source_key IS NOT NULL AND external_row_id IS NOT NULL AND
  date_deleted IS NULL`. The `date_deleted IS NULL` clause is REQUIRED (audit): a soft-discarded draft otherwise holds
  the key for 14 days and `ON CONFLICT DO NOTHING` silently drops re-ingest of a corrected/re-added sheet row.
- **`sales_channels += column_map jsonb, sync-state cols, is_active`** — all nullable/defaulted (`is_active` DEFAULT
  true) or the `SalesChannels.tsx` spread-upsert breaks. No edge function SELECTs `sales_channels` (0 hits). RLS is
  authenticated-only (not tenant-scoped) — new columns cross-tenant readable; tighten if sensitive.
- **New tables `sheet_ingest_rows`, `channel_aliases`** — enable RLS + a tenant column + tenant SELECT policy, or
  authenticated reads leak cross-tenant / return nothing. Pick `sheet_ingest_rows`→orders FK ondelete compatible with
  discard (CASCADE or SET NULL). Mirror `tracking_sync_runs`/`webhook_logs` for run audit.
- **Populating `orders.source_id`** (0/1158 today) — activates the dead `SalesChannelsSection` fallback. Add a CHECK
  that source_id's business = order's business. Extend `SALES_SOURCES`/`PLATFORM_SOURCE_MAP` for the sheet source.
- **Regenerate `database.types.ts`** — `orders` + `sales_channels` Rows go stale; `SalesChannels.tsx` masks drift with `select *` + `as any`.
- **Migration order:** (1) orders columns + backfill; (2) partial unique index; (3) sales_channels columns;
  (4) new tables + RLS; (5) `CREATE OR REPLACE` gated functions + extend UPDATE OF; (6) approval-gated trigger/RPC;
  (7) regen types. Run `get_advisors` (security + performance) after each DDL migration.

## 6. Reuse map

**REUSE (do not fork):** `sync_imported_orders(uuid)` (approval finalizer; filter loops or order-scope; call only at
approval); `ImportOrders.tsx` insert shape + the `Imported` status-history row; city/product resolvers (global
`master_cities`; products by code OR name); cron/vault/pg_net pattern (clone `invoke_vitex_poll` → `invoke_sheets_poll`,
reuse `tracking_sync_service_key`, offset schedule from `*/15` polls); SA-key JWT pattern (`google-analytics-fetch`:
jose RS256, token exchange, module-level caching; consume `GOOGLE_SHEETS_SA_KEY`); `provider-webhook` path-secret model
(future Drive-push receiver); service-role client pattern (env keys + manual tenant stamp); `refresh_customer_from_orders`.

**BUILD NEW:** approval-gated re-attribution path (`auto_attribute_order` is BEFORE INSERT only — won't re-enter on
UPDATE); a SEPARATE realtime subscriber/component for the "new order from sheet" toast (NOT `OrderStatusNotifications`,
NEVER `courier_notifications`/`send-courier-push`); `sheet_ingest_rows`, `channel_aliases`, sales_channels cursor cols,
`invoke_sheets_poll()` + cron row + poll edge function.

## 7. Risk register (critical → low, audit-corrected)

**CRITICAL**
1. `reattribute_unassigned_orders` re-attributes pending drafts (M1; unpatched path). → review filter on loop.
2. `sync_imported_orders` mutates drafts business-wide (price/provider/accessory). → filter both loops; call only at approval.
3. `auto_attribute_order` burns a slot at draft insert. → pending early-return; re-attribute at approval.
4. Approval flip won't fire customer refresh (`source_review_status` absent from UPDATE OF). → add to list or PERFORM in approval RPC.
5. Wrong default hides 1158 orders. → NOT NULL DEFAULT 'approved', backfill, filter `<> 'pending'`.
6. service_role omits/mis-sets tenant stamp (bypass = no net). → stamp from sales_channels; CHECK/trigger; unique index.
7. Admin/seller lists + ~14 analytics queries lack status filter → drafts inflate counts/revenue/badge/pipeline. → patch §3.C/D together.

**HIGH**
8. `auto_assign_seller_from_products` stamps seller_id from a draft item. → skip when parent pending.
9. Re-poll without partial unique index → duplicate draft, re-fired triggers. → index + `ON CONFLICT DO NOTHING` + cursor.
10. AI order-read RPCs return drafts to real customers over WhatsApp. → filter ai_skill_* + tool-runner reads.
11. Partial unique index without `date_deleted IS NULL` blocks re-ingest 14 days (purge window).
12. Engine sets a logistics field / `stock_changed=true` on a draft → over-credit on discard. → write only non-logistics columns.
13. Draft inserted/approved at `order_status_id=PROCESSED` deducts stock. → force entry status (new/confirmed), `stock_changed=false`.
14. `CREATE OR REPLACE` dropping headers — every hot-path fn is `SECURITY DEFINER SET search_path` EXCEPT
    `update_order_package_status_id`. Copy headers verbatim per-function; do not blanket-apply SECURITY DEFINER.
15. Forking insert/accessory shape drifts approved orders from XLSX. → reuse RPC + ImportOrders columns.

**MEDIUM** — SA-key source divergence (pin edge secret `GOOGLE_SHEETS_SA_KEY`); Drive-push needs custom-domain verification
(impossible on `*.supabase.co` → poll-first); set `verify_jwt:false` explicitly on deploy; `ai_dirty_orders` reindex churn;
realtime flashes drafts pre-filter; semantic collision with `pending_confirmation`.
**LOW** — audit_logs churn; latent RAG poisoning via indexer; bulk-insert refetch storms; `company_payment_note_orders`
RESTRICT (irrelevant for true drafts); stale types.

**DESTRUCTIVE-MOVE LANDMINES (explicit):**
- Editing `sync_imported_orders` in place affects the live XLSX path — must stay backward compatible (`IS DISTINCT FROM 'pending'`).
- `CREATE OR REPLACE` on SECURITY DEFINER hot-path fns without verbatim headers silently breaks privilege/search_path.
- A `= 'approved'` filter anywhere against NULL legacy rows mass-hides 1158 real orders.
- Referencing `NEW` on the DELETE branch of the customer-sync fn aborts every order deletion.
- A wrong/missing tenant stamp under service_role bypass silently cross-contaminates tenants with no DB guard.
- Forgetting `reattribute_unassigned_orders` (2nd attribution writer) leaves a live path that burns slots on drafts.

## 8. Safe build sequence

**Phase 0 — Schema (non-breaking, no engine).** Add orders 3 cols (NOT NULL DEFAULT 'approved', backfill). Partial
unique index (`...AND date_deleted IS NULL`). sales_channels cols (nullable/defaulted). `sheet_ingest_rows` +
`channel_aliases` + RLS + tenant policy. Regenerate types.
*Verify:* all 1167 orders read 'approved'; advisors clean; XLSX/manual create unchanged; SalesChannels upsert still works.

**Phase 1 — Gate DB functions (still no engine).** `CREATE OR REPLACE` (headers verbatim) the §3.A list **including
`reattribute_unassigned_orders`, `ai_skill_summarize_sales`, `ai_skill_ads_roi`**. Add `source_review_status` to the
customer-sync UPDATE OF list.
*Verify:* hand-insert a 'pending' row → `seller_attribution_state` unchanged, no customers row, seller_id NULL, AI source
not dirtied, `sync_imported_orders(business)` leaves it untouched, `reattribute_unassigned_orders` skips it; UPDATE to
'approved' → attribution runs once, customer cache populates, AI dirtied. Test an order DELETE. Diff fn defs before/after.

**Phase 2 — Client/analytics exclusion + approval path.** Add `<> 'pending'` at every §3.C/D/E location (verify each
line ref — analytics reader was a stub). Build approval RPC/trigger (re-attribution + scoped/filtered
`sync_imported_orders` + Imported-style history row; entry status from category new/confirmed, NEVER PROCESSED). Build
the separate sheet-arrival toast.
*Verify:* hand-inserted draft absent from every list/KPI/pipeline/badge/analytics section/AI lookup; gray only in review
surface; approval makes it appear everywhere identically to XLSX; OrderStatusNotifications silent on the flip.

**Phase 3 — Engine (poll-first).** `invoke_sheets_poll()` (clone invoke_vitex_poll, reuse tracking_sync_service_key),
cron row (offset), poll edge fn (verify_jwt:false, service-role client, GOOGLE_SHEETS_SA_KEY, manual tenant stamp,
`ON CONFLICT DO NOTHING`, drafts with courier/company NULL + no logistics + stock_changed=false). Metadata-gated
(modifiedTime) detection; fingerprinted high-water cursor on sales_channels.
*Verify:* each row → exactly one 'pending' draft, correct business; re-poll = zero duplicates; no logistics, no parcels,
no seller slot consumed; tenant isolation holds.

**Phase 4 — E2E + cleanup.** Approve a synthetic draft through the UI; confirm full-machine parity with XLSX. Re-run
`get_advisors`. Defer Drive-push until a custom domain is verified in Google Search Console.
