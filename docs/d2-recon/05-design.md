# D2 DESIGN CONTRACT — per-role dashboard stats RPCs (binding)

Inputs: d2-recon/01 (admin, exhaustive), 02 (seller, Dashboard line-verified; implementer re-verifies Statistics/Profile deltas in-file), 03 (mediabuyer), 04 (db-side). Conventions: D4 + D1 (docs/d1-recon/04-design.md) — SECURITY INVOKER, `set search_path to ''`, single-jsonb returns, explicit `p_business`, Casablanca day boundaries from `yyyy-MM-dd` params, flag-column status semantics, grants footer, scope params validated vs auth.uid() raising 42501.

## Migration `20260715XXXXXX_d2_dashboard_stats.sql`

### RPC 1 — `public.admin_dashboard_stats(p_business uuid, p_from date default null, p_to date default null) returns jsonb`
Caller must be a business member (RLS scopes anyway); replaces ALL 8 admin-dashboard widget downloads. ONE pass over the windowed pool + parcels + order_items, returning one jsonb with a keyed section per widget (kpi_cards, confirmation_pipeline, shipping_pipeline, pending_breakdown, sales_chart, city_stats, sellers_performance, products_performance, invoices_tile). EXACT formula sources = d2-recon/01 per-widget math. Non-negotiables:
- Pool predicate: biz + `date_deleted is null` + `source_review_status <> 'pending'` — VERIFY the live NULL behavior of the old PostgREST `neq` first (01 §0.3) and replicate byte-exactly.
- Window: applied on the SAME per-widget date anchor the client used (placement `o.date` vs delivery `date_livraison??updated_at` vs assignment — per-widget per recon; do NOT unify silently). All-time when p_from/p_to null.
- tracked = EXISTS parcel (either table) with non-empty trimmed tracking_code; delivery rate = delivered ÷ (tracked − pullback) clamped ≤ 100 (Coliaty); confirmation per `isRateConfirmed` incl. its empty-pendingIds guard semantics.
- Revenue = `pureRevenueForOrder` chain EXACTLY (product lines → raw_price fallback → price−shipping fallback → + shipping when include_delivery_in_total).
- Sellers-performance commission: reuse `seller_daily_earnings` (windowed) — never re-derive.
- Invoices tile: company_payment_notes sums (window on created_at).
- Charts: day-bucketed arrays (Casablanca days), tiny payloads.

### RPC 2 — `public.seller_dashboard_stats(p_business uuid, p_seller uuid, p_from date default null, p_to date default null) returns jsonb`
- `p_seller` guard: `= auth.uid() OR current_user_is_business_admin()` else 42501 (D1 rule).
- Pool: seller_id = p_seller + date_deleted null (+ biz) + `replace is distinct from true` excluded first. NOTE: seller pools do NOT exclude source_review_status='pending' — keep parity per page.
- Returns sections: stat strip (today_orders, delivered_today, pending, confirmed, delivered, total, success_rate, confirm_rate), money (live_commission, unpaid_deliveries, already_paid — computeUnpaidCommission semantics: per_unit via the existing DB fn `sum_order_units_for_seller_products` equivalent; minus Σ seller_payments.paid_amount), recent_orders (top-10 slim), product_table (per-product total/tracked/pullback/delivered/revenue), plus windowed KPI variants for Statistics.
- Kills per page: the own-orders full scan for stats + the TWO business-wide parcel dumps (EXISTS in SQL) + the order_items reverse scan (Profile product stats section in the same RPC).
- Statistics keeps direct (windowed) fetches ONLY for real row lists (earnings history, payments table).

### RPC 3 — `public.mb_dashboard_stats(...)` per d2-recon/03
- HARD RULE: expose ONLY what the MB sees today — own commission, livré counts, own rates; NEVER business spend/per-order totals/ROAS beyond the recon-verified current surface. created_by attribution key preserved.

## Frontend
- Each widget/page swaps its private queries for a slice of the role RPC result (ONE useQuery per page keyed ['dash-stats', role, biz, scope?, window]; widgets select their section). Delete the per-widget copies + useTrackedOrders usages on these pages (check remaining useTrackedOrders consumers before deleting the hook itself).
- Window param: pages send yyyy-MM-dd from/to; boundaries resolved server-side (Casablanca). Client-side isWithinInterval filtering deleted.
- staleTime 60s per dash query; invalidation: EcomBizRealtime order/parcel events → ['dash-stats'] prefix debounce 500ms (add to the layout component).
- MB/courier dashboards: reuse existing D4 RPCs where they already cover a tile (courier_self_stats etc.); do not duplicate.

## Review gates (same machinery as D1)
- Formula parity per widget vs old client math on live business 77f59ea5 (sub-1000 window ⇒ old==truth), executed read-only.
- EXPLAIN: one pass over windowed orders (biz index), no per-row subplans on parcels (hashed EXISTS), no seq scan of orders.
- Leak: seller/MB scope guards; MB payload contains zero forbidden fields (grep the jsonb keys).
- tsc -b; dry-run BEGIN..ROLLBACK; deploy ordering DB-first.
