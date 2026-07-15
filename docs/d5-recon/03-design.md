# D5 DESIGN CONTRACT — collaborator leaderboards (binding)

Inputs: d5-recon/01-sellers-mb.md, 02-couriers-db.md (live-verified 2026-07-15). The recon's §5.1 RPC shapes + §5.2 sequencing are ADOPTED as written. Conventions: D2/D3/D4 (SECURITY INVOKER, `set search_path to ''`, single jsonb, explicit p_business, Casablanca boundaries, flag-column semantics, grants footer).

## STANDING RULES (from the D3 review — non-negotiable)
1. **ADMIN GATE** on every RPC returning business-wide money or per-collaborator performance: `if not (select public.current_user_is_business_admin()) then raise exception '<fn>: admin only' using errcode = '42501'; end if;` placed FIRST in the body, before any data access. Exception: an RPC with a legitimate self-service caller takes the `seller_dashboard_stats` shape (`p_x = auth.uid() OR admin`, else 42501).
2. **Parity is the bar.** Replicate client semantics byte-for-byte, INCLUDING known client bugs — flag each in the migration header for a separate owner ruling. Never silently "fix" money semantics inside a refactor wave.
3. **No skeleton wall**: any page converted to a single RPC gets a visible error + retry state (never `loading = !stats` alone).

## Migration `20260715030000_d5_leaderboards.sql`

### ① `courier_roster_stats` — RETROFIT THE GATE (it is LIVE and UNGATED)
Same retrofit pattern as `20260715020000`: take the live `pg_get_functiondef` body, prepend the admin gate, re-apply byte-identical otherwise. **VERIFY FIRST** (grep src/) that no non-admin route calls it; if a courier-facing caller exists, use the self-or-admin shape instead. (`courier_self_stats` is the courier-facing one and stays as-is.)

### ② `courier_return_notes` detail (per recon §5.1) — lazy per-courier detail fn, gated; kills the page's bare `courier_return_notes` / `courier_payment_notes` selects. Detail queries MUST gate on modal open (kept-mounted trap, per [[chat-orders-history]]).

### ③ NEW `public.seller_roster_stats(p_business uuid) returns jsonb` — gate: admin → 42501.
Shape exactly per recon §5.1 ③, including: ship `delivered_sum` + `denom_sum` (client divides → pooled avg parity); `total_revenue = Σ raw o.price over delivered` (NOT pureRevenueForOrder — parity); delivery_rate UNCLAMPED; `total_unpaid` = open-period-only (rolling ledger); tracked set = the D2 hashed-set CTE (NEVER a per-row subplan); `top_city` per row (the page's search matches it).
Kills: the lifetime orders+order_items dump, `seller_daily_earnings '*'`, `seller_presences '*'`, the bare `seller_payments` select (**the 1000-cap wrong-money source**), and the page's need for `useTrackedOrders`.

### ④ NEW `public.mb_roster_earnings(p_business uuid, p_month text, p_mb uuid default null) returns jsonb` — gate: self-or-admin shape (recon §5.1 ④).
Month math = **`mb_month_earned`'s body, set-returning** (never per-row) — it is the payout authority; `useMediaBuyerEarnings` is a second drifting implementation and this fn retires that drift.
**DECISION (mine, locked): `prior_paid_amount` replicates the CLIENT bug-for-bug** (whatever the current client computes — verify in-file), because parity is the bar and this figure feeds Salaries.tsx + mb/Payments.tsx. Write the deviation in the migration header, name the correct semantics, and log it to MASTER_TODO as an OWNER RULING item. Do NOT change it in this wave.
**MB PII**: when `p_mb` is set (self path) the projection MUST NOT include peers' bank_*/cin/salary.

## Frontend
- `Sellers.tsx` + `MediaBuyers.tsx` adopt the **already-migrated `Couriers.tsx` seam verbatim**: `useQuery` → `.rpc(...)` → roster array joined to rows client-side by id. The shell contract (recon §1, items 1-12) is preserved byte-for-byte — same component names, class strings, tier fns, podium/roster/modal structure, cards-declared-inside-component. Kill the `useEffect` fetch-everything + its 9 reactive deps.
- Error+retry state on both (standing rule 3).
- Invalidation: EcomBizRealtime already invalidates `['dash-stats']`/`['analytics-stats']`; add the leaderboard keys to the same debounced order/parcel handler.

## Sequencing (recon §5.2, adopted): Couriers gate FIRST (closes a live ungated-money hole), Sellers second (biggest win), MediaBuyers last (shared hook + the ruling).

## Out of scope → log to MASTER_TODO/D7
`useTrackedOrders`' two staleTime:0 parcel dumps (many consumers — its own task); D4 header wording re courier_fees; `courier_fees` missing biz filter (RLS-only gate).

## Review gates
Parity per figure vs old client math on live biz 77f59ea5 (read-only); gate proof (admin OK / non-admin 42501) on EVERY new+retrofitted fn; EXPLAIN (hashed tracked-set, no per-row subplans); shell-contract diff check (no visual/structural regression); empty-roster shape.
