# D3-7c — Money Pre-Aggregation Proposal (frozen closed-day + live hot-edge)

**Status: PROPOSAL, owner decision required. No schema touched.** Design workflow wf_471a93da-091 (recon complete + measured; design/adversary phases cut by usage limit, synthesized here from the recon by the D3-7 author).

## Problem
The three heavy money aggregates re-scan **all-time** order history every call:
- `admin_analytics_stats` — **737-807ms measured** (the app's slowest interactive call; 12 sections, no single killable node — 4 surgical fixes tested + rejected 2026-07-17).
- `admin_dashboard_stats` — 141ms post-D3-7 (was 430ms) but still O(all-history); every-minute payout cron aggregate ~98ms same class.
- `seller_roster_stats` — 58ms→~470ms@10× (CB-2, measured linear).

All are O(business-history): fine now (~1,850 orders), **seconds at 20-50k orders/business.** This is the last scale bomb — a real one, not a false positive.

## The measurement that picks the design
A COD business-day's MONEY settles fast and boundedly (measured on the box, biz 77f59ea5):
| stream | p50 | p95/p99 | max observed |
|---|---|---|---|
| delivery lag (livraison−date) | 2d | p99 15d | 61d |
| return lag | 17d | p95 34d | 56d |
| cancels | — | — | ≤20d |

- **Zero money-state changes ever observed beyond 61 days.** Backdated inserts effectively nonexistent (1 order, +17d). Closed payout months are never rewritten.
- ⇒ after **N=60 days** a business-day's money is immutable. Freezing days older than 60d has a measured error of **1 order / 140 MAD = 0.13%**, and even that is caught by dirty-day invalidation (below).

## Recommended architecture: FROZEN CLOSED-DAY ROLLUP + LIVE HOT-EDGE
The standard "closed accounting period" pattern. **Chosen over** (a) full incremental triggers — rejected: the retroactive-day-move problem (delivery anchor is unstable — `update_orders_updated_at` bumps `updated_at` so NULL-`date_livraison` rows migrate day-cells on every touch; `order_items` has no anchor of its own; `order_statuses` flag flips are epoch-invalidators) makes exact per-write maintenance fragile on the hot orders/items write path; and (b) periodic full rebuild — rejected: rebuilding all-time every N minutes is the same seq scan, just relocated.

### 1. Rollup table (a real TABLE, never a matview)
Matviews can't carry RLS and all app roles share the `authenticated` Postgres role ([[mb-rls-role-ceiling]]), so it must be an RLS'd table.
```
whatsapp... no — public.business_day_money (
  business_id uuid, day date, anchor text,   -- anchor ∈ {placement, delivery, return, cohort}
  -- COMPONENTS not ratios (ratios don't sum across days):
  orders_n int, delivered_n int, tracked_n int, pullback_n int, confirmed_n int,
  revenue numeric, cogs numeric, shipping numeric, return_fees numeric, provisional numeric,
  -- per-dimension roll-ups live in sibling tables keyed (business_id, day, anchor, dim_id):
  --   business_day_seller, business_day_source, business_day_city, business_day_product
  frozen_at timestamptz,                     -- non-null ⇒ immutable closed day
  primary key (business_id, day, anchor)
);
-- RLS: business_id = current_user_digicom_business_id()  (SELECT for authenticated; writes SECDEF only)
```
Grain note: **per-stream anchor-day columns** are mandatory — one order contributes to *different* day cells per stream (placement vs delivery vs return vs cohort), verified from live defs. Payout stream is UTC-day (box TZ=UTC, sacred md5-id); analytics streams are Casablanca-day half-open windows. The rollup stores each stream separately; a consumer sums only the anchors it uses.

### 2. Maintenance — freeze the past, recompute the tail
- **Nightly cron** (`freeze_aged_money`): for each business, compute+insert rollup rows for any day that just crossed `today − 60d` (and isn't frozen), using **the same money functions/CTEs** the live RPCs use → byte-parity by construction. Set `frozen_at`. This is O(1 day/business/night).
- **Dirty-day invalidation** off the EXISTING `trg_broadcast_orders_stmt_{ins,upd,del}` seam (AFTER STATEMENT + transition tables, already built for OR-13): when a write touches a row whose OLD-anchor-day or NEW-anchor-day is already frozen (the rare backdated/re-opened case), enqueue that (business, day, anchor) for re-freeze. Catches the 0.13% tail exactly. **Add a matching statement trigger to `order_items`** (it has none today) + the two parcel tables (they have the seam already).
- **Epoch invalidators** (`order_statuses`/`package_statuses` flag flips — a single flip reclassifies all history, all businesses; frequency ≈ zero, owner config page): mark ALL frozen rows dirty → lazy re-freeze. A trigger on those tables sets a global `rollup_epoch` bump.

### 3. Read path — each consumer becomes O(60 days)
Each of the 3 RPCs keeps its EXACT per-stream logic but only live-computes the **hot window** (`day > today−60d`, unfrozen) and **adds the frozen prefix sum** from the rollup:
```
frozen_part := sum(components) from business_day_money where business_id=p AND day <= today-60 [AND day in window];
live_part   := <the existing CTE chain, but WHERE the anchor date > today-60d>;
result      := combine(frozen_part, live_part);   -- ratios (rates/ROAS/margin) recomputed from summed components
```
Windowed queries (from/to): frozen prefix is filtered by day; the hot part is unchanged. All-time: frozen prefix = all days ≤ today−60.

### NON-rollup-able (stays live, honestly flagged)
- **Analytics customers section** — distinct-phone + full-history "seen-before" scan, NON-ADDITIVE across day cells. Can't be served by day rollups. Keep it live OR give it its own dedicated customer-summary table (separate mini-project). It's ~18ms today though — not the bottleneck.
- **Analytics users section** — rolling `updated_at >= now()-30d`, window-independent — keep live (cheap).

## Correctness / parity model (money code — non-negotiable)
- Frozen rows are produced by the **same functions** → identical by construction. Prove with the D3-7 recipe: rolled-back txn, `EXCEPT` both directions between (rollup+live) and (pure-live) across 3 businesses × 4 windows × 3 RLS levels (postgres/admin/seller). 0 diff or no ship.
- **Components, never ratios**, in the table (a stored ROAS/margin can't be re-summed). Ratios computed at read time from summed components — same as the functions do today.
- `seller_daily_earnings` md5-id and the payout ticket ledger are **untouched** — they remain the authority; the rollup is a read-accelerator layered beside them, not a replacement.

## Phased plan
1. **P1 (low risk):** build the table + RLS + the nightly freeze cron + backfill all closed days. Add a `business_day_money_check()` that asserts rollup+live == pure-live for a sampled business daily (drift alarm). NO reads switched yet — pure shadow. Ship, watch the drift alarm for a week.
2. **P2:** switch `admin_analytics_stats` read path to frozen+hot. Parity-gated. This is the 750ms→~O(60d) win.
3. **P3:** switch `admin_dashboard_stats` + `seller_roster_stats` + the every-minute payout cron aggregate to the same rollup.
4. **P4 (optional):** dedicated customer-summary table for the non-additive analytics customers section.

## Honest weaknesses / open decisions
- The 0.13% freeze-miss is caught by dirty-day invalidation IF the `order_items` statement trigger + backdated-reopen path are built correctly — that's the one net-new trigger and the main test surface.
- Epoch-invalidator flag flips force a lazy full re-freeze — acceptable given ~zero frequency, but it IS a full recompute when it happens.
- Effort: P1+P2 ≈ the size of the D3-7 migration + a cron + a backfill + a big parity harness. Real work, but it's the only thing that makes the money surfaces constant-time at scale.
- Alternative if you want to defer: do nothing until a business crosses ~20k orders (analytics ~2-3s) — the pages are admin-only + staleTime-cached, so it's a cold-load cost, not per-user. This proposal is what you build WHEN that threshold nears (or now, if "ready for scale before we sell" wins).
