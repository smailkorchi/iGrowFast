# MASTER TODO — Whole-App Scale Architecture (W7 / task #19)

> **THE tracker.** Every page of every role dashboard, audited 2026-07-14 by an 11-auditor sweep + completeness critic + live-DB audit (workflow `wf_beed2d09-835`, 12 agents, 0 errors). Full per-finding evidence (file:line, exact fix per finding): `docs/W7_SWEEP_FINDINGS.json`. WhatsApp (`src/whatsapp/**`) is DONE — fully on broadcast — and is out of scope here.
>
> Status marks: `[ ]` todo · `[~]` in progress · `[x]` done+verified / no work needed · `[-]` wontfix (owner-ruled).
> Update this file in the same commit as the work it tracks.

## 0. The mission, measured

- `realtime.list_changes` (wal2json postgres_changes poller) = **61.4% of ALL DB time** (5,114s / 7d window, 594k calls).
- **Decode cost is driven by TOTAL WAL, not by the published tables**: whatsapp schema writes 1.28M tuples vs ~15k for all 9 published e-commerce tables combined (~85×). The poller decodes/skips it all every 100 ms.
- Therefore the win is **all-or-nothing**: port all 8 postgres_changes consumers → drop the 9 tables from the publication → **stop the poller itself** (R2). Partial ports reclaim ~0%.
- Second epidemic (independent of realtime): **private full-table copies** — admin Dashboard fires 8 and admin Analytics ~10 separate full downloads of the all-time `orders` table per page view, one per widget; 30+ more pages fetch unbounded tables or hand-sum money over silently-1000-capped selects. This is what actually breaks at thousands of users, and several money figures are ALREADY wrong past 1000 rows.
- Sweep verdicts: **77 files need work**, 22 polish-only, 30 clean, 30 static — 68 P1 / 103 P2 / 65 P3 findings.

## 1. Phase R1 — port the 8 postgres_changes consumers → `ecom:biz` broadcast seam

Pattern is FROZEN (proven in mig `20260711160000` + `src/whatsapp/lib/queries/ecomChannels.ts`): exception-safe SECDEF AFTER trigger, WHEN column guards, tiny payload, private topic `ecom:biz:<business_id>`, FE = ONE channel per client mounted in the role layout, events → targeted react-query invalidation, reconnect self-heal. Per-consumer order: trigger (additive) → FE consumer alongside → verify parity live → delete pg_changes binding → drop table from publication. One batch at a time, owner "go" per prod apply.

- [x] **R1a — Orders family** — COMPLETE 2026-07-14 (mig 20260714150000 port + mig 20260714160000 publication drop; live emission verified; adversarially reviewed, 0 WA regressions; drop applied at verified zero live postgres_changes subscriptions).
  - [x] Extend `broadcast_order_change` payload/WHEN as consumers need (⚠ current WHEN covers only order_status_id/package_status_id/date_deleted/phone/price — verify each ported consumer's trigger-column expectations; carry package-status toast fields: order_id, name, package_status_id, seller_id, tracking_code+provider, so `OrderStatusNotifications` needs ZERO follow-up queries).
  - [x] New WHEN-guarded triggers: `company_parcels`, `courier_parcels`, `products` (stock cols only), `accessories` (stock cols only) → events on `ecom:biz`.
  - [x] Port `src/pages/admin/Orders.tsx` (7 bindings, L697-743) — order/parcel events → `['orders-aggregate',biz]` (keep 500ms debounce); product/accessory → dropdown keys (keep 150ms).
  - [x] Port `src/pages/seller/Orders.tsx` (7 bindings, L799-845) — same mapping, seller keys.
  - [x] Port `src/components/orders/OrderStatusNotifications.tsx` (unfiltered orders UPDATE; mounted app-wide in AppLayout + SellerLayout — the widest slot-keeper). Topic-per-biz kills its client-side biz filter; keep dedupe map.
  - [x] Port `src/pages/admin/SheetReview.tsx` (orders INSERT, `source_review_status='pending'` → payload flag or dedicated event).
  - [x] Drop `orders`, `company_parcels`, `courier_parcels`, `products`, `accessories` from publication — DONE (publication now = the 4 R1b/R1c tables only).
- [~] **R1b — Logistics/health singles** — PORT SHIPPED 2026-07-14 (mig 20260714170000 applied; reviewed, 0 findings). Tail drop 20260714180000 gated on FE deploy + zero subscribers.
  - [x] `tracking_sync_runs` — bindings DELETED as dead code (RLS is owner-only → WALRUS starved every admin/seller; stronger: SyncTrackingStatus is mounted NOWHERE at HEAD). Product decision logged below.
  - [x] `webhook_logs` → 'webhook' pulse event on ecom:biz (INSERT-only trigger); useWebhookHealth rides the ecomBus + shared-channel status.
  - [x] `courier_notifications` → NEW `ecom:user:<uid>` topic family (strict auth.uid() policy, live-tested offsets); full-row payload, courier hook swapped to private broadcast.
  - [x] Drop the 3 tables from publication — DONE (mig 20260714180000 applied; publication verified EMPTY: 0 tables).
  - [x] Tracking-sync pill — MOOT: the component + hook were verified mounted NOWHERE and DELETED as dead code in D7b. If the pill is ever wanted, it is a fresh product ask.
- [x] **R1c — `campaign_source_locks`** — COMPLETE 2026-07-14 (realtime retired → 30s poll + source_taken guard; mig 20260714190000 applied — PUBLICATION EMPTY).

## 2. Phase R2 — retire the poller (the 61.4% kill)

**⚠ CORRECTED 2026-07-14 after a live incident: the `postgres_cdc_rls` extensions row is LOAD-BEARING on Realtime v2.102.3 — it carries the tenant's encrypted DB connection settings (db_host/db_user/db_password…). `Realtime.PostgresCdc.filter_settings/2` hard-crashes on `[]` during EVERY tenant connect → deleting the row kills ALL realtime (wa:* + ecom:*), not just the poller. NEVER delete it on this version.**
- Incident: row deleted + `SEED_SELF_HOST=false` + recreate at 15:17 UTC → all channel joins CHANNEL_ERROR → rolled back (row re-inserted) 15:28 UTC. ~9 min realtime-down during business hours; zero write impact; pages self-healed. The morning's earlier "success" was the seed silently restoring the row 6s after deletion.
- `SEED_SELF_HOST` stays **false** (it clobbers the Phase 1c tenant caps back to 200/100 defaults on every boot — proven). CONSEQUENCE: after any DB wipe/re-init, the tenant + extensions row must be restored manually (rollback SQL: box `/root/` + `~/.igrowfast/backups/`; the corrupt first version is superseded by the clean one).
- **The actual poller lever = `settings.poll_interval_ms` inside the row** (100ms today). With the publication EMPTY and zero subscribers (R1 complete), the residual is already ~92% down (≈2.5s/hour vs ≈30s/hour pre-R1). Raising poll_interval_ms 100→60000 + tenant reload bounds it to ~seconds/day.
- **Do NOT touch** the pgoutput side: `supabase_realtime_messages_replication_slot_` + `supabase_realtime_messages_publication` — ALL broadcast (wa:* + ecom:*) rides it.
- [x] Pre-check: zero live subscriptions verified at each drop; publication emptied 2026-07-14.
- [x] Row-deletion approach EXECUTED then ROLLED BACK (see correction above). Current live state: row present (100ms), SEED_SELF_HOST=false, caps 5000/1000/2000/500/1MB, publication EMPTY, smoke PASS.
- [x] poll_interval_ms 100→60000 staged + activating restart EXECUTED 2026-07-14 ~20:20 UTC (owner go, zero live subs): container healthy, SMOKE_PASS, seed off, caps intact.
- [x] **R2 VERDICT — COMPLETE.** 6.6h fresh window incl. business-hours traffic: `realtime.list_changes` ABSENT (0 calls; was 61.4% / 594k calls/wk). Causal model confirmed: zero postgres_changes subscribers → the CDC extension loads (tenant conn config) but never polls; 60s interval = dormant backstop. New top consumer = dispatch_prep at 9.1% (16.6s/6.6h); flat single-digit distribution, nothing replaced the poller. The 61.4% is reclaimed.
- [x] Rollback path saved: ~/.igrowfast/backups/r2_extensions_row_rollback_2026-07-14.sql (+ box /root/) — re-insert + restart = poller returns.

## 3. Phase D — data-layer rebuild (the "thousands of users" half)

Fix ARCHITECTURE, not instances (owner rule 2026-07-09: end-state optimizations only). The epidemic = each widget owns a private unbounded `orders` fetch. End-state = **server-side aggregates + windowed/keyset queries**, one source of truth per surface. Precedents to reuse: orders keyset+search RPCs, `search_*_note_ids` (mig 20260714120000), `seller_daily_earnings`, `conversation_filter_counts`.

- [x] **D1 — orders-aggregate teardown** — COMPLETE 2026-07-14 (mig 20260714220000: 2 keyset indexes + orders_list_page/orders_kpis/orders_bulk_guarded/like_escape; both Orders pages rebuilt to O(page); recon+contract in docs/d1-recon/; 3-lens adversarial review → 4 defects fixed pre-apply: phantom bulk history [in-RPC per-row insert], LIKE metachar escaping, off-page shortage resolution, deploy ordering; SQL author T1-T10 live parity + EXPLAIN keyset gates + 42501 seller-leak test; functional re-tests rolled back clean). Follow-ups D7: seller faceted-counts RPC (8-call badge fan-out), seller fetchOrderById dedup, ClientSearchSelect typeahead.
- [x] **D2 — dashboard aggregate service** — COMPLETE 2026-07-15 (mig 20260714230000: admin_dashboard_stats + seller_dashboard_stats + mb_dashboard_stats + idx_orders_biz_date; 20 FE files; recon+contract in docs/d2-recon/; parity transcript EXACT incl. impersonated seller/MB + 42501 guards + MB forbidden-field grep; 3-lens review → 3 defects fixed pre-apply: self_perf wiring [closed the peers-orders-to-seller-browsers exposure], MB dash-stats invalidation on own mutations ×5 sites, All-Time pend-pool cap). Admin dashboard 8×+5 fetches → 1 RPC; seller pages 3-4 scans each → 1 RPC; MB business-orders download → 1 RPC.
- [x] **D3 — analytics sections** — COMPLETE 2026-07-15 (migs 20260715010000 admin_analytics_stats [12 sections, one call] + 20260715020000 admin-gate retrofit; 13 FE files; recon+contract docs/d3-recon/; parity EXACT all 12 sections incl. anchors-not-unified proof; 3-lens review → 3 defects fixed pre-apply: customers-trend distinct-count inflation [server now owns the grain, MATCH proven], permanent-skeleton-on-error [error+retry on Analytics AND live Dashboard], admin-gate over-claim). SECURITY: admin_analytics_stats + admin_dashboard_stats now GATED (admin OK / non-admin 42501) — closed a live aggregate-payload exposure. Analytics: 10 full-orders downloads + order_items + 2 parcel dumps + ~20 satellite selects per mount/focus → ONE 380ms call.
- [x] **D5 — leaderboards/collaborators** — COMPLETE 2026-07-15 (mig 20260715030000: courier_roster_stats GATE RETROFIT [byte-identical body] + courier_notes_detail + seller_roster_stats + mb_roster_earnings, all gated; recon+contract docs/d5-recon/). Sellers: 5 unbounded lifetime downloads + 2 whole-business parcel dumps + the bare seller_payments 1000-cap WRONG-MONEY select + O(sellers x orders) client loops -> ONE 242ms RPC (281->164 lines). Parity 7/7 seller figures + globals 5/5 + 12/12 vs mb_month_earned (payout authority) across 3 months. PAYROLL DRIFT RETIRED: useMediaBuyerEarnings no longer recomputes payroll independently of the authority. Review: 2 defects fixed (lazy-modal false-empty flash, seller KPI/grid count divergence) + 2 orphaned mb-earnings-prior invalidations repointed.

### OWNER RULINGS PENDING (logged by D5/D2 — money semantics, deliberately NOT changed mid-refactor)
- [ ] **O-1 `prior_paid_amount`**: replicated BUG-FOR-BUG from the client. Correct semantics = paid_amount (not total_amount) / stored payout_month is 'YYYY-MM-01' so an exact 'YYYY-MM' match finds 0 rows. Affects Salaries.tsx + mediabuyer/Payments.tsx. Decide, then fix in one deliberate change.
- [ ] **O-2 MB commission branch**: mb_roster_earnings follows the AUTHORITY (payment_type='salary' => 0 commission, else delivered x price); the client used (payment_type==='commission' => else 0). Differ only when payment_type is neither — no live row. Decide the canonical rule.
- [ ] **O-3 mb_month_earned delivered=0-for-salary**: display zero no payroll consumer reads; D5 ships delivered_orders as the RAW count for podium/rank parity.

- [x] **D6 — tools/document pages** — ALREADY COMPLETE (absorbed by D4 wave 1, verified 2026-07-15): all 4 pages call `distinct_clients` (killing the 4 copy-pasted unbounded orders downloads) + `register_totals` (killing the 1000-capped money KPIs); register lists are fetchAllRows (no silent cap). REMAINING (logged to D7, low value): register `select('*')` still drags snapshot_json per row (the card reads client name from it — needs a JSON-path select or a projected column); ClientSearchSelect true-typeahead (wizards); BonLivraison order picker 400-cap.

- [x] **D7 — cleanups** — COMPLETE 2026-07-15 (recon docs/d7-recon/). **D7a** (commit a5820d4): queryClient.clear() on SIGNED_OUT — closed a LIVE cross-account cache leak (SPA never reloads on logout; keys without a biz id served the previous user's rows); SellerSidebar clears activeBusinessId; global retry 3->1; useTrackedOrders DELETED (its last consumer downloaded every parcel row in the business for one popover). **D7b**: customers_list_page/customers_kpis/customer_orders (keyset; killed the last full-table derive; FULL-SET 200-customer parity sweep, 0 mismatches), idx_webhook_logs_biz_created (a 5290-row scan firing 12x/min per admin), delivery_fees_bulk_apply (**896 sequential round-trips -> ONE atomic statement**; the optimistic UI no longer lies about partial writes), honest imports (silent partial import fixed), fetchAllRows truncation made IMPOSSIBLE (advance by batch.length + terminate on exact count — decoupled from PGRST_DB_MAX_ROWS), 4 dead files deleted.
  - **DEFERRED WITH JUSTIFICATION (recon-binding, do NOT revisit without new data): 13 of 15 P3 pages** — live row counts give 125x–200,000x headroom (owner/Businesses 7 rows = 82yr to cap; owner/Payments 0 rows; mediabuyer/Campaigns 2KB total). Touching them is negative-value.
  - **[ ] PARKED — needs owner attention before it ships: `pay_sellers_bulk`** (`docs/parked/PARKED_pay_sellers_bulk.sql`, NOT applied; Salaries.tsx reverted to HEAD). Fixes the bulk-payout N+1 + partial-commit, BUT the D7b review found its error toast asserts "No seller was paid — safe to retry" on ANY error incl. transport failures where the server outcome is UNKNOWN. pay_sellers_bulk is NOT idempotent -> a lost response after COMMIT + an operator retry = EVERY seller in the batch paid twice. Before shipping: (a) scope the rollback claim to real server SQLSTATEs (postgrest sets code=''/status=0 on transport errors — a clean discriminator), and/or (b) give it an idempotency key (client uuid + unique index on seller_payment_txns) so a retry is provably safe. Also decide the two flagged deviations (single p_paid_at per batch; duplicate-seller raise).

- [x] **D8 — audit gap** — AUDITED CLEAN 2026-07-15: the EmailAccounts tree (lib/emailAccounts.ts + owner/config/EmailAccount{sSection,Card,Modal}) is well-built — writes go through the `manage-email-accounts` edge fn (password never leaves Vault), ONE useQuery + proper invalidation, no polling, no client money math. Sole nit: bare `select('*')` on `email_accounts` = 5 live rows under owner-only RLS (~200x headroom) → DEFER.

## 4. Phase H — horizontal Realtime (W5-D) — CONTINGENT, LAST

Only if measured load ever proves >5–10k concurrent tabs on one Realtime container (libcluster spike first). Not built on speculation. Gate stands: pgoutput walsender must stay bounded as ecom:* topics land (watch during R1 batches).

## 5. Standing gates (unchanged)

- Every prod migration / worker / FE deploy = explicit owner "go", one at a time; dry-run migrations in BEGIN..ROLLBACK.
- Per-section working protocol: blast radius → edit → test → confirm → next. Never batch sections.
- MB-facing data rule, owner confinement, payout-via-RPC rules all still bind Phase D work.
- After code changes: `npx tsc -b` (root `tsc --noEmit` is vacuous) + `graphify update .`.

## 6. Full page registry — every file, every verdict

### Admin — Commerce (7 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | FR | `src/pages/admin/Accessories.tsx` | accessories query is a bare select('*') with no .range/.limit -> silent 1000-row PostgREST cap. catalogTotals.inventoryValue SUMs stock*cost_price ove… |
| [x] | P1 | AFS | `src/pages/admin/Customers.tsx` | The 'customers-derived' query fetches EVERY non-deleted order of the business via fetchAllRows (joins: master_cities, order_statuses, package_statuses… |
| [x] | P1 | AFRS | `src/pages/admin/Orders.tsx` | 7 postgres_changes bindings on one channel `orders-cache-invalidate-<biz>` keep the wal2json slot alive. Exact map: orders UPDATE (L698-702), orders I… |
| [x] | P1 | FRS | `src/pages/admin/Products.tsx` | products query is a bare select('*') with no .range/.limit -> PostgREST silently caps at 1000 rows. catalogTotals then SUMs stock*cost_price and stock… |
| [x] | P1 | QR | `src/pages/admin/SheetReview.tsx` | Live postgres_changes subscription on orders INSERT (filter DigiCom Business=eq.<biz>) keeps the wal2json slot decoding for this page; violates the 20… |
| [ ] | P2 | FRS | `src/pages/admin/Demands.tsx` | fetchDemands runs a bare select('*, collaborator:users(...)') with no .range/.limit -> silent 1000-row cap on a ticket ledger that only grows. KPI sta… |
| [ ] | P3 | F | `src/pages/admin/Trash.tsx` | fetchAllRows over ALL soft-deleted orders (business filter + orFilter date_deleted.not.is.null) with two joins on page load, then client-side sort/sea… |

### Admin — Money (9 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | FS | `src/pages/admin/ExpensesDetails.tsx` | All expenses rows are fetched with a bare select (no .range) — capped at 1000 — and the KPI strip computes 'All time' and 'This month' money totals by… |
| [x] | P1 | AFQR | `src/pages/admin/Payments.tsx` | The 'Pending amount' KPI is a client-side reduce over a bare select of net_amount for all unpaid filtered notes — no .range/.limit, so PostgREST silen… |
| [x] | P1 | FQS | `src/pages/admin/Transactions.tsx` | The entire transactions table is fetched with a bare select (no .range/.limit) — silently capped at 1000 rows — and the KPI strip sums total_price/pai… |
| [ ] | P2 | A | `src/pages/admin/RecurringCharges.tsx` | 'Posted this month' money KPI is a client-side reduce over a bare (uncapped) select of this month's auto-posted expenses rows. The window is month-bou… |
| [x] | P2 | FQ | `src/pages/admin/Salaries.tsx` | The media-buyer tab fetches ALL mediabuyer_payments rows with a bare select (no .range) and derives Total paid / Total pending KPIs plus per-buyer lif… |
| [x] | — | — | `src/pages/admin/Calculator.tsx` |  |
| [x] | — | — | `src/pages/admin/ExpensesTypes.tsx` |  |
| [x] | — | — | `src/pages/admin/business/Overview.tsx` |  |
| [x] | — | — | `src/pages/admin/business/Payments.tsx` |  |

### Admin — Logistics (4 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | AFQR | `src/pages/admin/ReturnNote.tsx` | The 'retourne-orders' pool is a bare select('*' + 5 nested joins: items->products, company_parcels->providers, courier_parcels, courier, company) on t… |
| [x] | P2 | Q | `src/pages/admin/DeliveryServices.tsx` | Bulk fee apply ('Auto Fill All') is a sequential per-city N+1: for each city it calls saveFeeRowByMasterCity, which itself is 2 round trips (SELECT id… |
| [ ] | P2 | PQ | `src/pages/admin/Webhooks.tsx` | Standing 5s poll on webhook_logs (refetchInterval: 5000) whenever the page is mounted — it runs even while the 'Gateways' tab is displayed (the query … |
| [x] | P3 | FQRS | `src/pages/admin/DeliveryNote.tsx` | Liveness candidate: no realtime at all. Note lists, parcel_count, is_finalized, and the preview's per-parcel package statuses (updated by provider web… |

### Admin — People & Dash (8 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | Q | `src/pages/admin/Analytics.tsx` | One page view triggers ~10 independent full downloads of the entire all-time orders table (one per section, distinct queryKeys: analytics-orders-profi… |
| [x] | P1 | QR | `src/pages/admin/Dashboard.tsx` | One page view triggers 8 independent full downloads of the entire all-time orders table — each child widget owns its own fetchAllRows('orders', …) und… |
| [x] | P1 | AF | `src/pages/admin/collaborators/Couriers.tsx` | Unbounded all-time fetch of every courier-assigned order for the business on page load (no date window) purely to compute lifetime counters and fee su… |
| [x] | P1 | AFQ | `src/pages/admin/collaborators/Sellers.tsx` | Unbounded all-time fetch of every seller's orders (= effectively the whole business orders table) WITH order_items join on page load, no date window, … |
| [x] | P2 | AF | `src/pages/admin/collaborators/MediaBuyers.tsx` | Monthly payroll/earnings tiles are recomputed client-side by useMediaBuyerEarnings (bucket orders by day+source, multiply by commission_price) even th… |
| [ ] | P3 | Q | `src/pages/admin/Users.tsx` | select('*') on users pulls every column (permissions JSON, banking fields, avatar_config) for the whole roster when the list only renders ~10 fields; … |
| [x] | — | — | `src/pages/admin/Profile.tsx` |  |
| [x] | — | — | `src/pages/admin/SalesChannels.tsx` |  |

### Admin — Tools & Imports (21 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | FQ | `src/pages/admin/ImportOrders.tsx` | courier_fees is fetched with a bare select — silently capped at 1000 rows (per-courier × per-city fee matrix easily exceeds 1000: 5 couriers × 300 cit… |
| [x] | P1 | FQ | `src/pages/admin/tools/bonCommande/BonCommandePage.tsx` | Unbounded full fetch of the orders table on every page mount just to derive a distinct-client dropdown: fetchAllRows('orders', 'name, phone, address, … |
| [x] | P1 | FQS | `src/pages/admin/tools/bonLivraison/BonLivraisonPage.tsx` | Same copy-pasted unbounded orders fetch as the other three document pages: fetchAllRows('orders', name/phone/address/city) on page mount to build the … |
| [x] | P1 | FQ | `src/pages/admin/tools/devis/DevisPage.tsx` | Copy-pasted unbounded orders fetch on page mount for the distinct-client dropdown (this copy doesn't even exclude source_review_status='pending', unli… |
| [x] | P1 | FQ | `src/pages/admin/tools/facture/FacturePage.tsx` | Copy-pasted unbounded orders fetch on page mount for the distinct-client dropdown (fourth copy of the same pattern; also missing the source_review_sta… |
| [x] | P2 | FQ | `src/pages/admin/ImportAccessories.tsx` | One-row-at-a-time N+1 write loop: one awaited accessories insert OR update per row, errors only console.error'd (silent partial import). Direct contra… |
| [x] | P2 | FQ | `src/pages/admin/ImportProducts.tsx` | One-row-at-a-time N+1 write loop: per valid row — awaited products update-or-insert, awaited product_accessories delete, awaited product_accessories i… |
| [x] | — | — | `src/pages/admin/ImportCustomers.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/BonDeCommande.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/BonDeLivraison.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/Devis.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/Facture.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/ToolDocumentPage.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/bonCommande/BonCommandePdfDocument.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/bonCommande/BonCommandeWizard.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/bonLivraison/BonLivraisonPdfDocument.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/bonLivraison/BonLivraisonWizard.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/devis/DevisPdfDocument.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/devis/DevisWizard.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/facture/FacturePdfDocument.tsx` |  |
| [x] | — | — | `src/pages/admin/tools/facture/FactureWizard.tsx` |  |

### Seller (12 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | AFR | `src/pages/seller/Dashboard.tsx` | Every dashboard mount performs three full-table paginated scans: all seller orders with order_items+products joins, plus BUSINESS-WIDE company_parcels… |
| [x] | P1 | AFQRS | `src/pages/seller/Orders.tsx` | 7 postgres_changes bindings on one channel keep the wal2json slot alive across 5 of the 9 published e-commerce tables. Every event debounce-invalidate… |
| [x] | P1 | AFQ | `src/pages/seller/Profile.tsx` | A profile page triggers FOUR full-table paginated scans on mount (and again whenever statusCats maps change): all seller orders, business-wide company… |
| [x] | P1 | FQS | `src/pages/seller/ReturnNote.tsx` | The returned-orders pool is a bare select('*' + items/parcels joins) with no .range — silently capped at 1000 rows. It feeds the wizard's money totals… |
| [x] | P1 | AFQ | `src/pages/seller/Statistics.tsx` | Same triple full scan as Dashboard on every mount: all seller orders with items/products/cities joins plus business-wide company_parcels AND courier_p… |
| [ ] | P2 | FS | `src/pages/seller/Wallet.tsx` | seller_daily_earnings select('*') with no pagination — PostgREST caps at 1000 rows (~2.7 years of daily rows). Because rows are date-desc the current-… |
| [ ] | P3 | R | `src/pages/seller/Accessories.tsx` | Same liveness candidate as Products.tsx: stock badges/low-stock banner with no realtime, stale until reload. Two-step fetch (product_accessories then … |
| [x] | P3 | QRS | `src/pages/seller/DeliveryNote.tsx` | 'Charger plus' grows the window from offset 0: .range(0, page*50-1) refetches every previously loaded row on each click (O(page²) cumulative transfer)… |
| [ ] | P3 | FR | `src/pages/seller/Demands.tsx` | seller_demands select('*') unpaginated; per-seller volume is small so the 1000-cap is remote, but the list and KPI counts would silently truncate at s… |
| [ ] | P3 | F | `src/pages/seller/Payments.tsx` | All ledger tickets bare-selected without .range; lifetime sum ('Gains à vie') reduces them client-side. Population is ~1 row/seller/month so the 1000-… |
| [ ] | P3 | R | `src/pages/seller/Products.tsx` | Liveness candidate: stock badges and the low-stock banner drive order-taking decisions but the page has no realtime — stock is stale until reload (the… |
| [x] | — | — | `src/pages/seller/Help.tsx` |  |

### Courier (4 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | AF | `src/pages/courier/Dashboard.tsx` | Lifetime courier_parcels fetch has no .range/.limit — PostgREST silently caps at 1000 rows — and the result feeds a money figure: pendingEarningsGross… |
| [x] | P1 | FS | `src/pages/courier/Orders.tsx` | Unbounded lifetime fetch of courier_parcels with heavy joins (orders + order_items + products + city + status) on page load; silent 1000-row cap means… |
| [ ] | P2 | AFS | `src/pages/courier/Payments.tsx` | Both note fetches (payment + return, each with full line_items join) are unbounded bare selects; stats reduce them into lifetime money KPIs (deliveryE… |
| [x] | — | — | `src/pages/courier/Profile.tsx` |  |

### Media buyer (10 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | R | `src/pages/mediabuyer/CampaignForm.tsx` | postgres_changes subscription on campaign_source_locks with event:'*' and NO server-side filter — every lock change in every business is decoded throu… |
| [x] | P1 | F | `src/pages/mediabuyer/Dashboard.tsx` | Page load triggers a FULL business order-history download: default preset is 'all' (from '2020-01-01'), and a second useMediaBuyerStats instance is al… |
| [x] | P1 | FS | `src/pages/mediabuyer/Orders.tsx` | The attribution base — ALL of the MB's campaign_daily_entries lifetime — is a bare select with NO date filter and no limit: first query in this group … |
| [x] | P2 | AF | `src/pages/mediabuyer/CampaignManage.tsx` | campaign_daily_entries fetched with a bare select('*') and no limit (via useCampaignMetrics) — silent 1000-row cap. One row per day means an ongoing c… |
| [ ] | P2 | AF | `src/pages/mediabuyer/CampaignPreview.tsx` | Same campaign_daily_entries bare-select 1000-cap as CampaignManage (shared useCampaignMetrics) — truncated entries silently understate the money total… |
| [ ] | P2 | A | `src/pages/mediabuyer/Payments.tsx` | The 'Ce mois' live earnings card is computed client-side by useMediaBuyerEarnings: fetch the month's entries plus ALL business orders for the month (f… |
| [ ] | P2 | F | `src/pages/mediabuyer/Statistics.tsx` | 'Tout' preset spans from '2000-01-01' → useMediaBuyerStats fetchAllRows downloads the business's complete order history and aggregates client-side. De… |
| [x] | P3 | F | `src/pages/mediabuyer/Campaigns.tsx` | campaigns select('*') (wide row incl. media jsonb, audience jsonb, primary_text) unbounded per business, then filtered/searched client-side. Correct a… |
| [ ] | P3 | FR | `src/pages/mediabuyer/Demands.tsx` | mediabuyer_demands select('*') per MB with no limit — per-user table, small in practice; caps silently at 1000 and rows carry media jsonb. |
| [x] | — | — | `src/pages/mediabuyer/Profile.tsx` |  |

### Owner (12 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P2 | AFRS | `src/pages/owner/Payments.tsx` | Entire business_payments history fetched unbounded with 3 joins on page load; the table grows monotonically (every tenant pays every month), so it wil… |
| [ ] | P3 | P | `src/pages/owner/Backups.tsx` | KNOWN POLLS — CLASSIFIED ACCEPTABLE: status poll refetchInterval 5s-while-active/10s-idle (L51) and backup-sets poll 60s (L52) hit the backup agent's … |
| [ ] | P3 | FS | `src/pages/owner/Businesses.tsx` | Unbounded select('*' + creator/plan joins) on businesses with no .range/.limit — list and header stats silently clip at the 1000-row cap as tenant cou… |
| [ ] | P3 | QS | `src/pages/owner/Cities.tsx` | syncProviderMappings issues up to 9 sequential await round-trips (one upsert-or-delete per provider) on every city save. |
| [ ] | P3 | AF | `src/pages/owner/OwnerDashboard.tsx` | Unbounded select on businesses relies on the silent 1000-row PostgREST cap; every KPI (total/active/suspended/deactivated, plan chart, 30d created ser… |
| [ ] | P3 | QS | `src/pages/owner/Zones.tsx` | zones query selects '*, master_cities(id)' — every linked city row is fetched solely to derive a per-zone city COUNT (zoneCityCount = array length). P… |
| [x] | — | — | `src/pages/owner/Config.tsx` |  |
| [x] | — | — | `src/pages/owner/EmailTemplates.tsx` |  |
| [x] | — | — | `src/pages/owner/Plans.tsx` |  |
| [x] | — | — | `src/pages/owner/Profile.tsx` |  |
| [x] | — | — | `src/pages/owner/Status.tsx` |  |
| [x] | — | — | `src/pages/owner/Users.tsx` |  |

### Top-level pages (7 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | AFS | `src/pages/AdsHistory.tsx` | Full-business orders history fetched on every page load: fetchAllRows('orders', ...) with order_items + status joins and only business/date_deleted fi… |
| [ ] | P3 | P | `src/pages/Register.tsx` | OTP-cooldown setInterval is acceptable; single-row queries only |
| [ ] | P3 | P | `src/pages/analytics/GoogleAnalytics.tsx` | KNOWN POLL — CLASSIFIED ACCEPTABLE: the 'Live right now' realtime pill polls every 30s, but the target is the GA4 Realtime API through an edge functio… |
| [x] | — | — | `src/pages/Auth.tsx` | data-bearing login flow (RPC + single-row selects), no scale defect |
| [x] | — | — | `src/pages/ChangeCredentials.tsx` |  |
| [x] | — | — | `src/pages/NotFound.tsx` |  |
| [x] | — | — | `src/pages/analytics/MetaAds.tsx` |  |

### Shared components (48 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | FQ | `src/components/analytics/AdsSection.tsx` | campaign_daily_entries fetched bare (silent 1000-row cap) and summed into spendGlobalAds/totalSpend → ROAS, cost-per-order, per-platform spend all sil… |
| [x] | P1 | AF | `src/components/analytics/BusinessHealthSection.tsx` | Full all-time orders fetch with order_items join (its own copy) for rate/velocity math done client-side. |
| [x] | P1 | AF | `src/components/analytics/CouriersSection.tsx` | Full all-time courier-order fetch (own copy) for per-courier stats computed client-side. |
| [x] | P1 | AF | `src/components/analytics/CustomersSection.tsx` | Full all-time orders fetch (own copy incl phone/name of every order ever) solely to deduplicate customers by normalized phone client-side — the heavie… |
| [x] | P1 | AFQ | `src/components/analytics/InventorySection.tsx` | transactions fetched with a bare select (silent 1000-row cap) and reduced into totalTransactionValue/unpaidAmount money tiles — growth table, silently… |
| [x] | P1 | AFQ | `src/components/analytics/MediaBuyersSection.tsx` | Full all-time orders fetch with order_items join (own copy) as the MB attribution universe, while entries are correctly window-bounded — orders should… |
| [x] | P1 | AF | `src/components/analytics/OrdersSection.tsx` | Full all-time orders fetch (own copy, with master_cities + order_items joins) for counts/funnel/top-cities all computed client-side. |
| [x] | P1 | AF | `src/components/analytics/ProfitabilitySection.tsx` | campaign_daily_entries fetched with a bare select (silent 1000-row cap) and summed into spendGlobalAds → total expenses → netProfit; entries grow dail… |
| [x] | P1 | AF | `src/components/analytics/SalesChannelsSection.tsx` | Full all-time orders fetch with order_items join (own copy) for channel grouping done client-side. |
| [x] | P1 | AF | `src/components/analytics/SellersSection.tsx` | Full all-time orders fetch with order_items join (own copy) for per-seller table computed client-side. |
| [x] | P1 | AF | `src/components/analytics/ShippingSection.tsx` | Full all-time orders fetch (own copy) for shipping metrics computed client-side. |
| [x] | P1 | AF | `src/components/dashboard/ConfirmationPipeline.tsx` | Fetches ALL orders all-time (another private copy with order_statuses join) to render a per-status count distribution that is a textbook server GROUP … |
| [x] | P1 | AF | `src/components/dashboard/DashboardCityStats.tsx` | Full all-time orders fetch (another private copy, with master_cities join) to group by city client-side. |
| [x] | P1 | AF | `src/components/dashboard/DashboardKPICards.tsx` | fetchAllRows over the entire all-time orders table (id/date/status columns + package_statuses join) on every dashboard load just to count statuses cli… |
| [x] | P1 | AFQ | `src/components/dashboard/DashboardProductsPerformance.tsx` | Downloads the ENTIRE order_items table for the business (fetchAllRows, no window) plus its own full orders copy on every dashboard load. |
| [x] | P1 | AF | `src/components/dashboard/DashboardSellersPerformance.tsx` | Full all-time orders fetch WITH order_items join (widest select on the page), and staleTime:0 + refetchOnMount:'always' forces the entire download to … |
| [x] | P1 | AF | `src/components/dashboard/PendingOrdersBreakdown.tsx` | Fetches ALL orders all-time (another private copy) even though the card only needs pending-status rows; pending filter and age-bucketing happen client… |
| [x] | P1 | AF | `src/components/dashboard/SalesComparatifChart.tsx` | Full all-time orders fetch (its own copy, distinct queryKey from the KPI cards) to build a time-bucketed chart client-side. |
| [x] | P1 | FQ | `src/components/dashboard/SellerSelfPerformanceSection.tsx` | When businessId is present the filter ternary applies ONLY the business filter (no seller_id filter) — a single seller's self-performance section fetc… |
| [x] | P1 | AF | `src/components/dashboard/ShippingPipeline.tsx` | Fetches ALL orders all-time (another private copy) to compute lifecycle counts and per-fulfiller delivery rates client-side. |
| [x] | P1 | QR | `src/components/orders/OrderStatusNotifications.tsx` | One postgres_changes binding: event UPDATE, schema public, table orders, NO server-side filter — the comment (L81-84) explains the `DigiCom Business` … |
| [x] | P2 | S | `src/components/CustomerInsights.tsx` | Phone search uses leading-wildcard ilike '%<digits>%' on orders.phone — unindexable without trigram; every search is a sequential scan of the orders t… |
| [x] | P2 | AQ | `src/components/delivery/DeliveryNoteWizard.tsx` | Provider step fetches EVERY confirmed order (fetchAllRows, with items:order_items(product_id) join) just to count orders per provider client-side. Com… |
| [x] | P2 | Q | `src/components/orders/OrderViewDialog.tsx` | Every dialog open auto-fires the provider-integration edge fn (track_parcel, plus get_parcel_info fallback = up to 2 external carrier API calls), then… |
| [x] | P2 | Q | `src/components/orders/SellerOrderViewDialog.tsx` | Same per-open provider-call pattern as OrderViewDialog: dialog open auto-runs handleTrackParcel (up to 2 provider-integration edge fn calls), matchPac… |
| [x] | P3 | F | `src/components/analytics/UsersSection.tsx` | 30-day campaign_daily_entries activity probe uses a bare select (1000 cap); only feeds the activity Set (not money) and the orders side already uses f… |
| [ ] | P3 | Q | `src/components/orders/OrderStatusHistoryDialog.tsx` | The order_statuses icon query has no enabled: open gate — hosts keep dialogs mounted after close (Radix exit animation), so this query window-focus-re… |
| [ ] | P3 | Q | `src/components/orders/ParcelTrackingDialog.tsx` | pkgStatuses query is ungated while the dialog is permanently mounted inside both order view dialogs (rendered unconditionally at OrderViewDialog L998-… |
| [ ] | P3 | P | `src/components/owner/backups/RestoreWizard.tsx` | KNOWN POLL — CLASSIFIED ACCEPTABLE: the only setInterval is a 3-second abort countdown before firing the restore (cleared at 0 or on cancel); wizard-s… |
| [x] | — | — | `src/components/analytics/AnalyticsDateFilter.tsx` |  |
| [x] | — | — | `src/components/analytics/SectionStory.tsx` |  |
| [x] | — | — | `src/components/analytics/SectionWrapper.tsx` |  |
| [x] | — | — | `src/components/analytics/StatCard.tsx` |  |
| [x] | — | — | `src/components/analytics/index.ts` |  |
| [x] | — | — | `src/components/dashboard/performance/FinancialsWaterfall.tsx` |  |
| [x] | — | — | `src/components/dashboard/performance/PerformanceFunnel.tsx` |  |
| [x] | — | — | `src/components/dashboard/performance/SourcePills.tsx` |  |
| [x] | — | — | `src/components/dashboard/performance/StackedProportionBar.tsx` |  |
| [x] | — | — | `src/components/dashboard/performance/StatusQueuePane.tsx` |  |
| [x] | — | — | `src/components/delivery/CourierDeliveryNoteWizard.tsx` |  |
| [x] | — | — | `src/components/meta/CreateCampaignWizard.tsx` |  |
| [x] | — | — | `src/components/meta/manager/CampaignsTable.tsx` |  |
| [x] | — | — | `src/components/orders/AdminChatCartOrderDialog.tsx` |  |
| [x] | — | — | `src/components/orders/OrdersExportWizard.tsx` |  |
| [x] | — | — | `src/components/orders/SellerChatCartOrderDialog.tsx` |  |
| [x] | — | — | `src/components/orders/SyncTrackingStatus.tsx` |  |
| [x] | — | — | `src/components/profile/BankDetailsCard.tsx` |  |
| [x] | — | — | `src/components/profile/ProfileScaffold.tsx` |  |

### Hooks & data layer (17 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [x] | P1 | R | `src/hooks/useCourierNotifications.ts` | Standing postgres_changes subscription (INSERT on courier_notifications, filter courier_id=eq.<uid>) mounted once per courier at CourierLayout.tsx:48 … |
| [x] | P1 | F | `src/hooks/useTrackedOrders.ts` | Fetches the ENTIRE business's company_parcels AND courier_parcels (all-time, grows with every shipped order) on every mount, with staleTime 0 + refetc… |
| [x] | P1 | R | `src/hooks/useTrackingSyncStatus.ts` | Two postgres_changes bindings (INSERT + UPDATE on public.tracking_sync_runs) — tracking_sync_runs is in the supabase_realtime publication, so every mo… |
| [x] | P1 | APR | `src/hooks/useWebhookHealth.ts` | postgres_changes INSERT binding on public.webhook_logs — a publication table — keeping the wal2json slot hot for as long as the indicator is mounted (… |
| [x] | P2 | Q | `src/App.tsx` | QueryClient created with ALL react-query defaults (staleTime 0, refetchOnWindowFocus true, refetchOnMount true, retry 3). Every tab refocus/route remo… |
| [x] | P2 | F | `src/hooks/useSellerCommissionTotals.ts` | When from/to are undefined the fetch is ALL-TIME over seller_daily_earnings (grows daily × sellers) and the money SUM happens client-side. |
| [ ] | P2 | A | `src/hooks/useSellerLiveOwed.ts` | Fetches every all-time daily row for the seller set (3 cols) and SUMs client-side; rows grow daily per seller. The view is the right source but the SU… |
| [x] | P2 | FQ | `src/lib/supabase.ts` | fetchAllRows paginates with offset-style .range(from, from+999) in a serial await loop: a 50k-row orders fetch = 50 sequential round-trips, each with … |
| [ ] | P3 | P | `src/hooks/useGoogleAnalytics.ts` | useGARealtime is a standing 30s refetchInterval poll while a GA analytics page is mounted. Classification: acceptable — it polls the GA4 realtime Data… |
| [x] | — | — | `src/hooks/useCampaignMetrics.ts` |  |
| [x] | — | — | `src/hooks/useCurrentUserId.ts` |  |
| [x] | — | — | `src/hooks/useMediaBuyerEarnings.ts` |  |
| [x] | — | — | `src/hooks/useMediaBuyerStats.ts` |  |
| [x] | — | — | `src/hooks/useMetaAds.ts` |  |
| [x] | — | — | `src/hooks/usePackageStatusResolver.ts` |  |
| [x] | — | — | `src/hooks/useSellerLedger.ts` |  |
| [x] | — | — | `src/hooks/useStatusCategories.ts` |  |

### Registry follow-ups
- [x] D8 audit gap: EmailAccountsSection tree — AUDITED CLEAN (see §3 D8).
- 4 `*PdfDocument.tsx` files marked static by nature (pure @react-pdf render components, not deep-read).


---

## 7. FINAL STATE (2026-07-15) — registry closed

**Every P1 is done: 0 of the original 68 remain open.**

Registry: 112 rows done · 28 rows open — **all P2/P3, all DEFERRED with measured justification** (D7 recon quantified live row counts: 125x–200,000x headroom to any cap). Re-open one only when a table's real growth invalidates its measurement, not on principle:
- **owner/*** (Businesses 7 rows, Payments 0 rows, OwnerDashboard, Cities, Zones, Backups) — decades of headroom.
- **admin** Trash (5 rows), Users (max 8/biz), Demands (5), RecurringCharges (13), Webhooks (index shipped; the FE row is payload-only).
- **seller** Demands (5), Payments (12 — already on the seller_ledger view + RPC), Wallet (inert), Products/Accessories.
- **mediabuyer** Demands (0), Campaigns (2KB total), CampaignPreview/Manage (entries are per-campaign: ~42 rows, cap ≈ 3 years of daily entries on ONE campaign; its orders fetch is already date-windowed), Payments, Statistics.
- **hooks/dialogs**: useSellerLiveOwed (135 view rows), useGoogleAnalytics/GoogleAnalytics/Register/RestoreWizard (bounded polls), OrderStatusHistoryDialog/ParcelTrackingDialog (ungated dialog queries, small).

### PAYOUT FINDINGS — logged, not fixed (surfaced by the payout recon + 3 review rounds)
- [x] **P-1 OVERPAY GUARD — DONE 2026-07-15 (mig 20260715060000, applied).** Both `pay_seller` + `pay_mediabuyer` now reject `p_amount > remaining + 0.005` with ERRCODE 23514. Hard block, no advances, per owner ruling. Tolerance MEASURED not guessed (all money cols are `numeric` = exact; 0 live tickets carry a remaining beyond 2dp; the only dust is the client's float->toFixed(2), max half a centime). Proven LIVE: settle-in-full 242 ALLOWED, overpay 342-on-242 BLOCKED 23514, 1-on-0-remaining BLOCKED. Bodies = live pg_get_functiondef + declare/guard only. No data touched (overpaid_tickets = 0). ORIGINAL FINDING:  (recon-proven; `refresh_*_balance` uses `>=` and labels an overpayment `'paid'`). `paid_amount > total_amount` is representable, reachable and silent → negative `carried_out` → negative next-month `carried_in` = the −280 incident shape. **OWNER RULED 2026-07-15: NO advances → hard block, no `p_allow_advance` param.** NEXT ACTION: build it, with the rounding tolerance measured against live tickets (a hard block that misfires on a centime blocks a legitimate settle-in-full). Data is clean today (`overpaid_tickets = 0`) — no backfill.
- [ ] **P-2 month-rollover display/ticket divergence (PRE-EXISTING, BOTH halves, design-wide — not introduced by any wave).** Both RPCs select the ticket by `date_trunc('month', now())`, while the UI pays from a clicked/open row. In the window between 00:00 on the 1st and the close cron (`5 0 1 * *`, jobs 8/13), paying a row labelled "mois en cours" writes to the NEW month's ticket; the displayed row's balance never moves. Narrow (~5 min/month) and it does not overpay — but the operator sees an unchanged balance after a successful payment. Decide: gate the Pay button during rollover, or resolve the ticket the RPC will actually write and show that.
- [x] **P-3 the bulk payout UI is DEAD CODE** — `BulkGenerateDialog` is never rendered; both `settleMutation` declarations are never invoked (`noUnusedLocals: false` hid it). ~200 lines of unreachable payout logic = a trap for whoever wires it next. `docs/parked/PARKED_pay_sellers_bulk.sql` targeted this dead path. RECOMMEND: delete the dead UI + the parked draft. Owner decision (delete vs wire).

### THE ONLY WORK GATED ON THE OWNER
1. **`pay_sellers_bulk` — VERDICT: DO NOT APPLY. Recon-killed, superseded.** Four blockers: (B1) false retry-safety; (B2) **deadlock class vs `close_seller_month`** (N advisory locks held to COMMIT vs its unordered N-lock txn — today's per-seller loop makes this structurally impossible); (B3) its admin gate ignores `p_business`; (B4) **it fixes no money bug** while making the only failure that happens WORSE (a lost response double-pays all N instead of at most 1). And the perf case is empty: **21 txns / 4 sellers / ~15 months; a multi-seller bulk settle has NEVER occurred** — and it targeted dead code (P-3). Atomicity is also the WRONG semantic: no constraint, trigger or ticket spans two sellers, so payouts have no cross-seller invariant to protect. Delete it with the dead UI.
2. **O-1 / O-2 / O-3** + the 2 Customers parity divergences (canonical phone key; replace-leg recompute) — all money semantics, all replicated bug-for-bug on purpose, all measured no-ops on today's data.

### Phase H (horizontal Realtime) — NOT NEEDED
Contingent on >5-10k concurrent tabs. The poller is dead and every heavy page is one RPC; revisit only if load proves it.
