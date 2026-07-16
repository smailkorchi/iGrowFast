# Per-Page Audit — Findings Register

Running register for the request/resource/scalability audit ([[dashboard-pages-audit-ledger]]). Denominators: `docs/AUDIT_TRACK0_BASELINE.md`. Severity = impact at the thousands-concurrent target, not current (tiny) scale. Status: PROPOSED (audit-only) → APPLIED (on approval) → VERIFIED.

---

## Task #1 — AppLayout shell (admin)  [A1-1 APPLIED + tsc-b VERIFIED 2026-07-16; A1-2 deferred→#2]

**APPLIED (A1-1):** new `src/hooks/useCurrentProfile.ts` (union select, staleTime 5min, getSession); adopted by Sidebar/OwnerSidebar/CourierSidebar/Profile.tsx (5 files). `npx tsc -b` = 0 errors. Blast radius fully traced; no consumer stranded.

Shell = `AppLayout.tsx` → 4 persistent children, mounted once per session (SPA never unmounts on admin nav). Per-admin-session request cost:

| Source | On mount | On window focus | Realtime | Verdict |
|---|---|---|---|---|
| `Sidebar` `['current-profile']` | `auth.getUser()` (**network→GoTrue**) + `users.select('*')` | **refetches every focus** (global client staleTime 0 + refetchOnWindowFocus default true) | — | **FINDING A1-1** |
| `EcomBizRealtime` | `getSession()` (local) | — | 1 private `ecom:biz:<biz>` broadcast, debounced 500/150ms, self-heal | optimized |
| `OrderStatusNotifications` | `getSession()` (local) | — | pure `ecomBus` consumer, **zero follow-up queries** | optimized |
| `AdminWaRealtime` | `useInstances()` (INSTANCE_COLS allow-list, qr_code revoked) | refetch on focus >15s (waClient) | 1 private `wa:biz:<biz>` if instances exist, else no-op | mostly optimized (A1-4) |

### A1-1 [HIGH at scale] Sidebar profile query — focus-refetch storm + network getUser + select(*)
- `queryKey:['current-profile']` on the **global** QueryClient (staleTime 0, refetchOnWindowFocus default TRUE) → refetches on **every tab refocus**, for a query that is always-observed (persistent shell).
- Each refetch = `supabase.auth.getUser()` = **network round-trip to GoTrue `/auth/v1/user`** (not local) + `users.select('*')` (wide row; only `name/role/avatar_url/avatar_config` are rendered).
- Concurrency math: profile is near-static, yet the (single, deduped) query refetches on every focus → wasted getUser+select on GoTrue + the ~10-conn PostgREST pool, scaling linearly with user count.
- **BLAST RADIUS (verified):** `['current-profile']` is a SHARED key across 4 files — `Sidebar.tsx:252`, `OwnerSidebar.tsx:63`, `CourierSidebar.tsx:46`, `Profile.tsx:31` (reader + invalidator `:105`,`:340`). RQ caches by key → they already dedupe to ONE fetch (not 4×); the risk is 4 hand-copied queryFns (drift) + select(*) + no staleTime + network getUser. A single-file narrow would STRAND Profile.tsx (needs username/email/phone) and OwnerSidebar (needs backup_admin).
- **Verified column union** (every access traced, incl. cast-form `(profile as any)?.X`): `id, name, role, avatar_url, avatar_config, username, email, phone, backup_admin`.
- **ROOT FIX (proposed, 5 files):** new `src/hooks/useCurrentProfile.ts` (one queryFn, `select(union)`, `staleTime 5min`, `getSession` not `getUser`); replace the inline `useQuery` in all 4 consumers with it. Profile.tsx invalidations keep working (same key); its mutation-path `getUser` calls stay untouched (write auth). No consumer stranded; `tsc -b` gates.
- Resource tags: GoTrue, DB/PostgREST pool, CF egress.

### A1-2 [MED, cross-cutting → task #2] Duplicate identity resolution per session
- Initial admin load fires **two** `getUser()` network calls (Sidebar + BusinessGuard) + independent `getSession()` in EcomBiz/OrderStatus + `useAuth` in WA. BusinessGuard also does its own `users.select` (role + DigiCom Business). Consolidate Sidebar + BusinessGuard onto one shared `['current-profile']` source → saves 1 getUser + 1 users select per session load. Resolve in task #2.

### A1-4 [LOW] `useInstances()` runs for every admin, incl. 0-WA businesses
- AdminWaRealtime fires `listInstances` for all admins (focus-refetch >15s), even businesses with no WA instances (returns empty, opens no channel). Minor per-focus PostgREST call. Low priority; the general lever is A1-1's focus-refetch discipline.

### A1-3 [POSITIVE] Realtime shell is the optimized end-state — no change
Unified single private broadcast channels (`ecom:biz`, `wa:biz`), debounced, self-healing, local `getSession`; OrderStatusNotifications is a zero-query bus consumer; instances select is an allow-list with secrets revoked. Confirms W7 / Phase-2b. **Do not touch.**

### Cross-cutting (elevates F0-2)
Global admin QueryClient = staleTime 0 + refetchOnWindowFocus default true → **every mounted query in the app refetches on every focus** (deliberate correctness net for un-swept pages, per App.tsx). This is the systemic thundering-herd source behind F0-2 (no Kong rate-limit). Per-page fix = add `staleTime` to near-static queries + finish sweeping pages onto realtime; infra fix = F0-2.

---

## Task #2 — Route guards (ProtectedRoute + BusinessGuard)  [A2-2 APPLIED + tsc-b VERIFIED 2026-07-16]

Both guards mount once per session (wrap persistent route tree). `AnnouncementGate` (rendered by ProtectedRoute) = sessionStorage + compile-time constant, **zero network**.

- **A2-2 [APPLIED]** `BusinessGuard.resolve()` (`App.tsx`) used network `getUser()` only to get `user.id`; ProtectedRoute already validated the session upstream (and uses `getSession`). Swapped to `getSession()` (local) — RLS still enforces on the selects. `tsc -b` = 0.
- **A2-1 [WON'T DO — deliberate design]** ProtectedRoute's `active` check + BusinessGuard's `businesses.status` check are intentional FRESH reads enforcing disabled-account / suspension gates. Merging them into the 5-min-cached `useCurrentProfile` would open a security-staleness window (just-suspended user/business passes a fresh mount for ≤5min via cache). The 2 extra single-row PK selects are the correct price for security freshness. Corrects the earlier A1-2 consolidation idea.
- **A2-3 [LOW/open]** ProtectedRoute effect dep `allowedRoles` is a fresh array literal → re-fires the (correct, fresh) auth check if the tree re-renders. App ~static today; leave unless observed firing.

---

## Task #3 — admin Dashboard  [D3-2 + D3-3 APPLIED + tsc-b VERIFIED + box-verified 2026-07-16; D3-1/D3-4 deferred]

Architecture strong: one `admin_dashboard_stats` RPC (8-section jsonb, replaced 8 downloads), sargable scan (`o.date >= v_start AND o.date < v_end_excl`, tz math on params → uses `idx_orders_biz_date`), STABLE, RLS (not SECDEF), `staleTime 60s`.

- **D3-2 [APPLIED — was correctness@scale bug]** `DashboardProductsPerformance` fetched ALL products (`.eq(business)`, no limit) to resolve top-N metadata → **1000-row-cap silent truncation** at >1000 products → blank name/image for top products beyond 1000. ROOT FIX: denormalized `name/image_url/active/stock/selling_price/cost_price` into the RPC's `products_performance` rows (from `public.products p`, already joined — additive, backward-compatible), dropped the products fetch + `productMetaById`, widget reads `row.*`. Migration `supabase/migrations/20260716120000_d3_dashboard_products_denormalize.sql` (CREATE OR REPLACE, BEGIN/COMMIT) applied to box + runtime-verified via impersonated-admin call (name/image_url present, aggregates intact). Also dropped dead `businessId` prop (+ Dashboard.tsx call site).
- **D3-3 [APPLIED]** `staleTime: 60_000` added to the 3 remaining widget lookups (ShippingPipeline providers+couriers, SellersPerformance sellers) → no more focus-refetch storm. (Products lookup deleted entirely by D3-2.)
- **D3-1 [DEFERRED]** SalesComparatifChart calls the full 8-section RPC a 2nd time for the comparison window (uses 1/8). Gated on comparison mode + cached 60s. Fix = lightweight sales-series RPC or p_sections param — separate change, not bundled.
- **D3-4 [DEFERRED / verify@scale]** RPC boundary `(v_start is null OR o.date >= v_start)` + CASE upper bound may not fully range-scan under a generic plan; business-equality prefix limits blast. EXPLAIN at scale before acting.

NOT deployed (working tree + box RPC only; frontend deploy is push→GH Actions).
