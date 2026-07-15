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
  - [ ] Drop the 3 tables from publication (tail mig 20260714180000 — apply at verified zero subscribers post-deploy).
  - [ ] OWNER DECISION: make the tracking-sync pill live for admins? (needs an ops topic or RLS ruling; pill component currently unmounted dead code — also a deletion candidate, D7).
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
- [ ] **D5 — leaderboards/collaborators** (Sellers/MediaBuyers/Couriers pages): lifetime stats → server aggregates (Sellers.tsx is the shared shell — fix once).
- [ ] **D6 — tools/document pages**: 4 copy-pasted unbounded orders fetches for a client dropdown → one shared server-side distinct-client search (typeahead RPC); registers → keyset + server KPI.
- [ ] **D7 — remaining Q/S cleanups** per registry (N+1s, `select *` trims, client-side search → RPCs, offset→keyset), including `useTrackedOrders` full parcels fetch and `Customers.tsx` derive-from-all-orders.
- [ ] **D8 — audit gap**: `EmailAccountsSection` children (owner Config) were never deep-read; audit + fix or mark clean.

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
| [ ] | P1 | FR | `src/pages/admin/Accessories.tsx` | accessories query is a bare select('*') with no .range/.limit -> silent 1000-row PostgREST cap. catalogTotals.inventoryValue SUMs stock*cost_price ove… |
| [ ] | P1 | AFS | `src/pages/admin/Customers.tsx` | The 'customers-derived' query fetches EVERY non-deleted order of the business via fetchAllRows (joins: master_cities, order_statuses, package_statuses… |
| [ ] | P1 | AFRS | `src/pages/admin/Orders.tsx` | 7 postgres_changes bindings on one channel `orders-cache-invalidate-<biz>` keep the wal2json slot alive. Exact map: orders UPDATE (L698-702), orders I… |
| [ ] | P1 | FRS | `src/pages/admin/Products.tsx` | products query is a bare select('*') with no .range/.limit -> PostgREST silently caps at 1000 rows. catalogTotals then SUMs stock*cost_price and stock… |
| [ ] | P1 | QR | `src/pages/admin/SheetReview.tsx` | Live postgres_changes subscription on orders INSERT (filter DigiCom Business=eq.<biz>) keeps the wal2json slot decoding for this page; violates the 20… |
| [ ] | P2 | FRS | `src/pages/admin/Demands.tsx` | fetchDemands runs a bare select('*, collaborator:users(...)') with no .range/.limit -> silent 1000-row cap on a ticket ledger that only grows. KPI sta… |
| [ ] | P3 | F | `src/pages/admin/Trash.tsx` | fetchAllRows over ALL soft-deleted orders (business filter + orFilter date_deleted.not.is.null) with two joins on page load, then client-side sort/sea… |

### Admin — Money (9 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | FS | `src/pages/admin/ExpensesDetails.tsx` | All expenses rows are fetched with a bare select (no .range) — capped at 1000 — and the KPI strip computes 'All time' and 'This month' money totals by… |
| [ ] | P1 | AFQR | `src/pages/admin/Payments.tsx` | The 'Pending amount' KPI is a client-side reduce over a bare select of net_amount for all unpaid filtered notes — no .range/.limit, so PostgREST silen… |
| [ ] | P1 | FQS | `src/pages/admin/Transactions.tsx` | The entire transactions table is fetched with a bare select (no .range/.limit) — silently capped at 1000 rows — and the KPI strip sums total_price/pai… |
| [ ] | P2 | A | `src/pages/admin/RecurringCharges.tsx` | 'Posted this month' money KPI is a client-side reduce over a bare (uncapped) select of this month's auto-posted expenses rows. The window is month-bou… |
| [ ] | P2 | FQ | `src/pages/admin/Salaries.tsx` | The media-buyer tab fetches ALL mediabuyer_payments rows with a bare select (no .range) and derives Total paid / Total pending KPIs plus per-buyer lif… |
| [x] | — | — | `src/pages/admin/Calculator.tsx` |  |
| [x] | — | — | `src/pages/admin/ExpensesTypes.tsx` |  |
| [x] | — | — | `src/pages/admin/business/Overview.tsx` |  |
| [x] | — | — | `src/pages/admin/business/Payments.tsx` |  |

### Admin — Logistics (4 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | AFQR | `src/pages/admin/ReturnNote.tsx` | The 'retourne-orders' pool is a bare select('*' + 5 nested joins: items->products, company_parcels->providers, courier_parcels, courier, company) on t… |
| [ ] | P2 | Q | `src/pages/admin/DeliveryServices.tsx` | Bulk fee apply ('Auto Fill All') is a sequential per-city N+1: for each city it calls saveFeeRowByMasterCity, which itself is 2 round trips (SELECT id… |
| [ ] | P2 | PQ | `src/pages/admin/Webhooks.tsx` | Standing 5s poll on webhook_logs (refetchInterval: 5000) whenever the page is mounted — it runs even while the 'Gateways' tab is displayed (the query … |
| [ ] | P3 | FQRS | `src/pages/admin/DeliveryNote.tsx` | Liveness candidate: no realtime at all. Note lists, parcel_count, is_finalized, and the preview's per-parcel package statuses (updated by provider web… |

### Admin — People & Dash (8 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | Q | `src/pages/admin/Analytics.tsx` | One page view triggers ~10 independent full downloads of the entire all-time orders table (one per section, distinct queryKeys: analytics-orders-profi… |
| [ ] | P1 | QR | `src/pages/admin/Dashboard.tsx` | One page view triggers 8 independent full downloads of the entire all-time orders table — each child widget owns its own fetchAllRows('orders', …) und… |
| [ ] | P1 | AF | `src/pages/admin/collaborators/Couriers.tsx` | Unbounded all-time fetch of every courier-assigned order for the business on page load (no date window) purely to compute lifetime counters and fee su… |
| [ ] | P1 | AFQ | `src/pages/admin/collaborators/Sellers.tsx` | Unbounded all-time fetch of every seller's orders (= effectively the whole business orders table) WITH order_items join on page load, no date window, … |
| [ ] | P2 | AF | `src/pages/admin/collaborators/MediaBuyers.tsx` | Monthly payroll/earnings tiles are recomputed client-side by useMediaBuyerEarnings (bucket orders by day+source, multiply by commission_price) even th… |
| [ ] | P3 | Q | `src/pages/admin/Users.tsx` | select('*') on users pulls every column (permissions JSON, banking fields, avatar_config) for the whole roster when the list only renders ~10 fields; … |
| [x] | — | — | `src/pages/admin/Profile.tsx` |  |
| [x] | — | — | `src/pages/admin/SalesChannels.tsx` |  |

### Admin — Tools & Imports (21 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | FQ | `src/pages/admin/ImportOrders.tsx` | courier_fees is fetched with a bare select — silently capped at 1000 rows (per-courier × per-city fee matrix easily exceeds 1000: 5 couriers × 300 cit… |
| [ ] | P1 | FQ | `src/pages/admin/tools/bonCommande/BonCommandePage.tsx` | Unbounded full fetch of the orders table on every page mount just to derive a distinct-client dropdown: fetchAllRows('orders', 'name, phone, address, … |
| [ ] | P1 | FQS | `src/pages/admin/tools/bonLivraison/BonLivraisonPage.tsx` | Same copy-pasted unbounded orders fetch as the other three document pages: fetchAllRows('orders', name/phone/address/city) on page mount to build the … |
| [ ] | P1 | FQ | `src/pages/admin/tools/devis/DevisPage.tsx` | Copy-pasted unbounded orders fetch on page mount for the distinct-client dropdown (this copy doesn't even exclude source_review_status='pending', unli… |
| [ ] | P1 | FQ | `src/pages/admin/tools/facture/FacturePage.tsx` | Copy-pasted unbounded orders fetch on page mount for the distinct-client dropdown (fourth copy of the same pattern; also missing the source_review_sta… |
| [ ] | P2 | FQ | `src/pages/admin/ImportAccessories.tsx` | One-row-at-a-time N+1 write loop: one awaited accessories insert OR update per row, errors only console.error'd (silent partial import). Direct contra… |
| [ ] | P2 | FQ | `src/pages/admin/ImportProducts.tsx` | One-row-at-a-time N+1 write loop: per valid row — awaited products update-or-insert, awaited product_accessories delete, awaited product_accessories i… |
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
| [ ] | P1 | AFR | `src/pages/seller/Dashboard.tsx` | Every dashboard mount performs three full-table paginated scans: all seller orders with order_items+products joins, plus BUSINESS-WIDE company_parcels… |
| [ ] | P1 | AFQRS | `src/pages/seller/Orders.tsx` | 7 postgres_changes bindings on one channel keep the wal2json slot alive across 5 of the 9 published e-commerce tables. Every event debounce-invalidate… |
| [ ] | P1 | AFQ | `src/pages/seller/Profile.tsx` | A profile page triggers FOUR full-table paginated scans on mount (and again whenever statusCats maps change): all seller orders, business-wide company… |
| [ ] | P1 | FQS | `src/pages/seller/ReturnNote.tsx` | The returned-orders pool is a bare select('*' + items/parcels joins) with no .range — silently capped at 1000 rows. It feeds the wizard's money totals… |
| [ ] | P1 | AFQ | `src/pages/seller/Statistics.tsx` | Same triple full scan as Dashboard on every mount: all seller orders with items/products/cities joins plus business-wide company_parcels AND courier_p… |
| [ ] | P2 | FS | `src/pages/seller/Wallet.tsx` | seller_daily_earnings select('*') with no pagination — PostgREST caps at 1000 rows (~2.7 years of daily rows). Because rows are date-desc the current-… |
| [ ] | P3 | R | `src/pages/seller/Accessories.tsx` | Same liveness candidate as Products.tsx: stock badges/low-stock banner with no realtime, stale until reload. Two-step fetch (product_accessories then … |
| [ ] | P3 | QRS | `src/pages/seller/DeliveryNote.tsx` | 'Charger plus' grows the window from offset 0: .range(0, page*50-1) refetches every previously loaded row on each click (O(page²) cumulative transfer)… |
| [ ] | P3 | FR | `src/pages/seller/Demands.tsx` | seller_demands select('*') unpaginated; per-seller volume is small so the 1000-cap is remote, but the list and KPI counts would silently truncate at s… |
| [ ] | P3 | F | `src/pages/seller/Payments.tsx` | All ledger tickets bare-selected without .range; lifetime sum ('Gains à vie') reduces them client-side. Population is ~1 row/seller/month so the 1000-… |
| [ ] | P3 | R | `src/pages/seller/Products.tsx` | Liveness candidate: stock badges and the low-stock banner drive order-taking decisions but the page has no realtime — stock is stale until reload (the… |
| [x] | — | — | `src/pages/seller/Help.tsx` |  |

### Courier (4 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | AF | `src/pages/courier/Dashboard.tsx` | Lifetime courier_parcels fetch has no .range/.limit — PostgREST silently caps at 1000 rows — and the result feeds a money figure: pendingEarningsGross… |
| [ ] | P1 | FS | `src/pages/courier/Orders.tsx` | Unbounded lifetime fetch of courier_parcels with heavy joins (orders + order_items + products + city + status) on page load; silent 1000-row cap means… |
| [ ] | P2 | AFS | `src/pages/courier/Payments.tsx` | Both note fetches (payment + return, each with full line_items join) are unbounded bare selects; stats reduce them into lifetime money KPIs (deliveryE… |
| [x] | — | — | `src/pages/courier/Profile.tsx` |  |

### Media buyer (10 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | R | `src/pages/mediabuyer/CampaignForm.tsx` | postgres_changes subscription on campaign_source_locks with event:'*' and NO server-side filter — every lock change in every business is decoded throu… |
| [ ] | P1 | F | `src/pages/mediabuyer/Dashboard.tsx` | Page load triggers a FULL business order-history download: default preset is 'all' (from '2020-01-01'), and a second useMediaBuyerStats instance is al… |
| [ ] | P1 | FS | `src/pages/mediabuyer/Orders.tsx` | The attribution base — ALL of the MB's campaign_daily_entries lifetime — is a bare select with NO date filter and no limit: first query in this group … |
| [ ] | P2 | AF | `src/pages/mediabuyer/CampaignManage.tsx` | campaign_daily_entries fetched with a bare select('*') and no limit (via useCampaignMetrics) — silent 1000-row cap. One row per day means an ongoing c… |
| [ ] | P2 | AF | `src/pages/mediabuyer/CampaignPreview.tsx` | Same campaign_daily_entries bare-select 1000-cap as CampaignManage (shared useCampaignMetrics) — truncated entries silently understate the money total… |
| [ ] | P2 | A | `src/pages/mediabuyer/Payments.tsx` | The 'Ce mois' live earnings card is computed client-side by useMediaBuyerEarnings: fetch the month's entries plus ALL business orders for the month (f… |
| [ ] | P2 | F | `src/pages/mediabuyer/Statistics.tsx` | 'Tout' preset spans from '2000-01-01' → useMediaBuyerStats fetchAllRows downloads the business's complete order history and aggregates client-side. De… |
| [ ] | P3 | F | `src/pages/mediabuyer/Campaigns.tsx` | campaigns select('*') (wide row incl. media jsonb, audience jsonb, primary_text) unbounded per business, then filtered/searched client-side. Correct a… |
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
| [ ] | P1 | AFS | `src/pages/AdsHistory.tsx` | Full-business orders history fetched on every page load: fetchAllRows('orders', ...) with order_items + status joins and only business/date_deleted fi… |
| [ ] | P3 | P | `src/pages/Register.tsx` | OTP-cooldown setInterval is acceptable; single-row queries only |
| [ ] | P3 | P | `src/pages/analytics/GoogleAnalytics.tsx` | KNOWN POLL — CLASSIFIED ACCEPTABLE: the 'Live right now' realtime pill polls every 30s, but the target is the GA4 Realtime API through an edge functio… |
| [x] | — | — | `src/pages/Auth.tsx` | data-bearing login flow (RPC + single-row selects), no scale defect |
| [x] | — | — | `src/pages/ChangeCredentials.tsx` |  |
| [x] | — | — | `src/pages/NotFound.tsx` |  |
| [x] | — | — | `src/pages/analytics/MetaAds.tsx` |  |

### Shared components (48 files)

| St | Pri | Dims | File | Top finding |
|----|-----|------|------|-------------|
| [ ] | P1 | FQ | `src/components/analytics/AdsSection.tsx` | campaign_daily_entries fetched bare (silent 1000-row cap) and summed into spendGlobalAds/totalSpend → ROAS, cost-per-order, per-platform spend all sil… |
| [ ] | P1 | AF | `src/components/analytics/BusinessHealthSection.tsx` | Full all-time orders fetch with order_items join (its own copy) for rate/velocity math done client-side. |
| [ ] | P1 | AF | `src/components/analytics/CouriersSection.tsx` | Full all-time courier-order fetch (own copy) for per-courier stats computed client-side. |
| [ ] | P1 | AF | `src/components/analytics/CustomersSection.tsx` | Full all-time orders fetch (own copy incl phone/name of every order ever) solely to deduplicate customers by normalized phone client-side — the heavie… |
| [ ] | P1 | AFQ | `src/components/analytics/InventorySection.tsx` | transactions fetched with a bare select (silent 1000-row cap) and reduced into totalTransactionValue/unpaidAmount money tiles — growth table, silently… |
| [ ] | P1 | AFQ | `src/components/analytics/MediaBuyersSection.tsx` | Full all-time orders fetch with order_items join (own copy) as the MB attribution universe, while entries are correctly window-bounded — orders should… |
| [ ] | P1 | AF | `src/components/analytics/OrdersSection.tsx` | Full all-time orders fetch (own copy, with master_cities + order_items joins) for counts/funnel/top-cities all computed client-side. |
| [ ] | P1 | AF | `src/components/analytics/ProfitabilitySection.tsx` | campaign_daily_entries fetched with a bare select (silent 1000-row cap) and summed into spendGlobalAds → total expenses → netProfit; entries grow dail… |
| [ ] | P1 | AF | `src/components/analytics/SalesChannelsSection.tsx` | Full all-time orders fetch with order_items join (own copy) for channel grouping done client-side. |
| [ ] | P1 | AF | `src/components/analytics/SellersSection.tsx` | Full all-time orders fetch with order_items join (own copy) for per-seller table computed client-side. |
| [ ] | P1 | AF | `src/components/analytics/ShippingSection.tsx` | Full all-time orders fetch (own copy) for shipping metrics computed client-side. |
| [ ] | P1 | AF | `src/components/dashboard/ConfirmationPipeline.tsx` | Fetches ALL orders all-time (another private copy with order_statuses join) to render a per-status count distribution that is a textbook server GROUP … |
| [ ] | P1 | AF | `src/components/dashboard/DashboardCityStats.tsx` | Full all-time orders fetch (another private copy, with master_cities join) to group by city client-side. |
| [ ] | P1 | AF | `src/components/dashboard/DashboardKPICards.tsx` | fetchAllRows over the entire all-time orders table (id/date/status columns + package_statuses join) on every dashboard load just to count statuses cli… |
| [ ] | P1 | AFQ | `src/components/dashboard/DashboardProductsPerformance.tsx` | Downloads the ENTIRE order_items table for the business (fetchAllRows, no window) plus its own full orders copy on every dashboard load. |
| [ ] | P1 | AF | `src/components/dashboard/DashboardSellersPerformance.tsx` | Full all-time orders fetch WITH order_items join (widest select on the page), and staleTime:0 + refetchOnMount:'always' forces the entire download to … |
| [ ] | P1 | AF | `src/components/dashboard/PendingOrdersBreakdown.tsx` | Fetches ALL orders all-time (another private copy) even though the card only needs pending-status rows; pending filter and age-bucketing happen client… |
| [ ] | P1 | AF | `src/components/dashboard/SalesComparatifChart.tsx` | Full all-time orders fetch (its own copy, distinct queryKey from the KPI cards) to build a time-bucketed chart client-side. |
| [ ] | P1 | FQ | `src/components/dashboard/SellerSelfPerformanceSection.tsx` | When businessId is present the filter ternary applies ONLY the business filter (no seller_id filter) — a single seller's self-performance section fetc… |
| [ ] | P1 | AF | `src/components/dashboard/ShippingPipeline.tsx` | Fetches ALL orders all-time (another private copy) to compute lifecycle counts and per-fulfiller delivery rates client-side. |
| [x] | P1 | QR | `src/components/orders/OrderStatusNotifications.tsx` | One postgres_changes binding: event UPDATE, schema public, table orders, NO server-side filter — the comment (L81-84) explains the `DigiCom Business` … |
| [ ] | P2 | S | `src/components/CustomerInsights.tsx` | Phone search uses leading-wildcard ilike '%<digits>%' on orders.phone — unindexable without trigram; every search is a sequential scan of the orders t… |
| [ ] | P2 | AQ | `src/components/delivery/DeliveryNoteWizard.tsx` | Provider step fetches EVERY confirmed order (fetchAllRows, with items:order_items(product_id) join) just to count orders per provider client-side. Com… |
| [ ] | P2 | Q | `src/components/orders/OrderViewDialog.tsx` | Every dialog open auto-fires the provider-integration edge fn (track_parcel, plus get_parcel_info fallback = up to 2 external carrier API calls), then… |
| [ ] | P2 | Q | `src/components/orders/SellerOrderViewDialog.tsx` | Same per-open provider-call pattern as OrderViewDialog: dialog open auto-runs handleTrackParcel (up to 2 provider-integration edge fn calls), matchPac… |
| [ ] | P3 | F | `src/components/analytics/UsersSection.tsx` | 30-day campaign_daily_entries activity probe uses a bare select (1000 cap); only feeds the activity Set (not money) and the orders side already uses f… |
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
| [ ] | P1 | R | `src/hooks/useCourierNotifications.ts` | Standing postgres_changes subscription (INSERT on courier_notifications, filter courier_id=eq.<uid>) mounted once per courier at CourierLayout.tsx:48 … |
| [ ] | P1 | F | `src/hooks/useTrackedOrders.ts` | Fetches the ENTIRE business's company_parcels AND courier_parcels (all-time, grows with every shipped order) on every mount, with staleTime 0 + refetc… |
| [ ] | P1 | R | `src/hooks/useTrackingSyncStatus.ts` | Two postgres_changes bindings (INSERT + UPDATE on public.tracking_sync_runs) — tracking_sync_runs is in the supabase_realtime publication, so every mo… |
| [ ] | P1 | APR | `src/hooks/useWebhookHealth.ts` | postgres_changes INSERT binding on public.webhook_logs — a publication table — keeping the wal2json slot hot for as long as the indicator is mounted (… |
| [ ] | P2 | Q | `src/App.tsx` | QueryClient created with ALL react-query defaults (staleTime 0, refetchOnWindowFocus true, refetchOnMount true, retry 3). Every tab refocus/route remo… |
| [ ] | P2 | F | `src/hooks/useSellerCommissionTotals.ts` | When from/to are undefined the fetch is ALL-TIME over seller_daily_earnings (grows daily × sellers) and the money SUM happens client-side. |
| [ ] | P2 | A | `src/hooks/useSellerLiveOwed.ts` | Fetches every all-time daily row for the seller set (3 cols) and SUMs client-side; rows grow daily per seller. The view is the right source but the SU… |
| [ ] | P2 | FQ | `src/lib/supabase.ts` | fetchAllRows paginates with offset-style .range(from, from+999) in a serial await loop: a 50k-row orders fetch = 50 sequential round-trips, each with … |
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
- [ ] D8 audit gap: `src/components/` EmailAccountsSection tree (owner Config children) — never deep-read.
- 4 `*PdfDocument.tsx` files marked static by nature (pure @react-pdf render components, not deep-read).
