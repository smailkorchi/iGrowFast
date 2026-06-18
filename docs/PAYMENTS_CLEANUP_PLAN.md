# Payment Cleanup — Damage-Radius Matrix + Safe Execution Plan

Authoritative ground truth: live DB `zjkqprrfbibjoslvlmxf` + code, as verified in the adversarial critique. Where the original audits conflict with the critique, **the critique wins** and the conflict is called out. There is **no committed migration source** for the live function bodies (`pay_seller`, `refresh_open_seller_ticket`, `close_seller_month`, both `refresh_*_payment_balance`) or for the `seller_ledger` view — the only source of truth is the live catalog (`pg_get_functiondef`, `pg_get_viewdef`). Any migration that touches a column these reference without first `CREATE OR REPLACE`-ing them clobbers the live definition silently.

---

## GLOBAL DO-NOT-TOUCH

Do not read-modify-write, drop, or alter any of these unless the item explicitly scopes them:

- `trns_payment` — out of all scopes.
- Attribution triggers: `auto_attribute_order`, `sync_attribution_on_manual_assign`, `set_order_date_livraison_on_delivery`.
- `seller_attribution_state`.
- Live ledger function bodies (`pay_seller`, `refresh_open_seller_ticket`, `close_seller_month`) — read-only EXCEPT inside item **R3 STEP 3**, which is the one place authorized to rewrite them.
- `mediabuyer_payments` table data/columns — out of the seller-column retirement scope (item R3). Only touched by item W4 (constraint) and only at its unique key.
- `refresh_seller_payment_balance` / `refresh_mediabuyer_payment_balance` bodies — item G2 only revokes EXECUTE, never edits the body.
- Triggers `trg_seller_payment_txns_aiud` / `trg_mediabuyer_payment_txns_aiud` and their refresh chain — leave intact in all items.

---

## DAMAGE-RADIUS MATRIX

### M3 — Drop `old_seller_daily_earnings`
- **Action:** `DROP TABLE public.old_seller_daily_earnings CASCADE` + its 4 RLS policies; regenerate types.
- **RISK:** low
- **REVERSIBLE:** yes (recreate from backup; table is empty so functionally trivial).
- **Blast radius:** DB writers none. DB readers none. Code: `src/lib/database.types.ts` (type definition only).
- **What breaks if naive:** Only failure mode is forgetting to regenerate `database.types.ts` — stale `Database` type still references the dropped table; not a runtime break, but a type-drift smell. No runtime consumer exists.
- **Prerequisites:** Confirmed: 0 rows, 4 policies, 0 FKs into it, 0 code refs except the type. `to_regclass` resolves (it is a real TABLE, not a view).
- **SAFE procedure:**
  1. PITR checkpoint / note timestamp.
  2. Migration: `DROP POLICY IF EXISTS` (all 4) then `DROP TABLE IF EXISTS public.old_seller_daily_earnings CASCADE;`.
  3. Apply via MCP `apply_migration`.
  4. Regenerate types: `mcp__supabase-igrowfast__generate_typescript_types` → overwrite `src/lib/database.types.ts`.
  5. `npm run build`.
- **VERIFICATION:** `SELECT to_regclass('public.old_seller_daily_earnings')` → NULL. `SELECT count(*) FROM pg_policies WHERE tablename='old_seller_daily_earnings'` → 0. `grep old_seller_daily_earnings src/lib/database.types.ts` → no match. Build exit 0.
- **Reconcile Σpaid:** N/A — this table never participated in payment math. Σpaid seller=7648 / MB=4016 unaffected; spot-confirm unchanged after apply.

---

### M4 — Delete orphan `useSellerEarnings.ts`
- **Action:** `rm src/hooks/useSellerEarnings.ts`.
- **RISK:** low
- **REVERSIBLE:** yes (git revert).
- **Blast radius:** DB none. Code: the file itself; 0 importers (verified). It is the *sole* place `days_present` is computed (client-side) — reinforces H3 that the DB column has no live writer.
- **What breaks if naive:** Nothing, given 0 importers. Theoretical only: a dynamic/`React.lazy`/barrel re-export grep misses — verified none.
- **Prerequisites:** `grep -rn 'useSellerEarnings' src/` → only the definition. No `index.ts` barrel re-export. No test/story import.
- **SAFE procedure:**
  1. Final `grep -rn 'useSellerEarnings\|SellerEarnings' src/` excluding the file.
  2. `git rm src/hooks/useSellerEarnings.ts`.
  3. `npm run build`.
- **VERIFICATION:** post-delete grep empty; `git diff --stat` shows only that file; build exit 0.
- **Reconcile Σpaid:** N/A — client-only hook, never wrote/read payment totals authoritatively. No effect on 7648/4016.

---

### M5 — Reconcile two owe-hooks (`useSellerLiveOwed` vs `useSellerLedger`) — ANALYSIS ONLY
- **Action:** Document divergence; **make no code change now**. Optionally, later, repoint Salaries dialog activation to ledger.
- **RISK:** high if you "standardize" naively; **zero** if you leave as-is (recommended now).
- **REVERSIBLE:** yes.
- **Blast radius:** DB writers none. Readers: `seller_daily_earnings`, `seller_ledger`, `seller_payments`, `seller_payment_txns`, `users`, `orders`. Code: `Salaries.tsx`, `SellerLedgerDialogs.tsx`, seller `Payments/Dashboard/Orders/Statistics.tsx`, `collaborators/Sellers.tsx`, `SellersSection.tsx`.
- **What breaks if naive:**
  - Removing the `max(0, …)` floor in `useSellerLiveOwed.remaining` breaks the settle-button gate (enabled on `remaining > 0.005`) and would let a negative amount reach `pay_seller`.
  - Switching live pages to the ledger surfaces stale month-end frozen snapshots instead of the live `seller_daily_earnings` mirror.
  - Switching the KPI source is a non-op: `stats.totalOwed` (Salaries.tsx:295) already reads `ledger.all`. `liveOwed` is only used for dialog activation (lines 229, 313–314), not KPI display.
- **Prerequisites:** Accept that the −280 credit (seller in business `55449417`, open 2026-06 ticket `total_amount=-280, carried_out=-280`) is real and intentionally visible only in the ledger; `liveOwed` floors it to 0.
- **SAFE procedure (analysis):**
  1. In dev, log `liveOwed.byId(sid).remaining` vs `ledger.byId(sid).owe` for all sellers; confirm equal except sign on credit cases.
  2. Confirm seller-facing pages use `computeUnpaidCommission(orders, Σpaid)` independently — not either hook.
  3. Decision: keep both; document usage. Do not deprecate `liveOwed` unless you also add negative-owe handling to the settle gate.
- **VERIFICATION:** `liveOwed.byId('<credit-seller>').remaining === 0`; `ledger.byId('<credit-seller>').owe ≈ -280`. Settle flow refuses negative amount.
- **Reconcile Σpaid:** This is the canonical reconcile anchor. `useSellerLiveOwed` select (line ~120) reads only `total_amount, paid_amount`; `Σpaid_amount` across `seller_payment_txns` must total **7648 (seller)** / **4016 (MB)**. Run `SELECT sum(paid_amount) FROM seller_payments` and the txns-derived sum; both must equal 7648 / 4016 before and after any other item. Treat drift as a stop-the-line signal.

---

### G2 — Revoke EXECUTE on `refresh_seller_payment_balance` / `refresh_mediabuyer_payment_balance`
- **Action:** `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated;` on both functions.
- **RISK:** low (audit labels high; critique M1 downgrades — zero `.rpc()` callers, both are `SECURITY DEFINER`, triggers are event-driven not grant-gated).
- **REVERSIBLE:** yes (`GRANT EXECUTE` to restore).
- **Blast radius:** DB writers/readers: the two balance fns + their trigger callers (`trg_*_payment_txns_refresh`). Internal callers (`pay_seller`, `refresh_open_seller_ticket`, `close_seller_month`) invoke them under definer privilege — unaffected. Code: none (`Salaries.tsx`/`PayoutPaymentDialogs.tsx` call `pay_seller`, never the balance fns directly).
- **What breaks if naive:** Only a *direct* client `.rpc('refresh_seller_payment_balance')` — verified **zero** such calls (only type defs at `database.types.ts:10042/10046`).
- **Prerequisites:** Confirm `prosecdef=true` on both (verified). Confirm 0 `.rpc()` callers (verified).
- **SAFE procedure:**
  1. Migration: `REVOKE EXECUTE ON FUNCTION public.refresh_seller_payment_balance(uuid) FROM PUBLIC, anon, authenticated;` + same for MB. Keep `postgres`/`service_role`.
  2. Apply.
  3. Trigger a payment via Salaries UI (`pay_seller`) → confirm success.
  4. `get_advisors` (security) clean.
- **VERIFICATION:** `information_schema.role_routine_grants` no longer lists anon/authenticated for either fn. INSERT into `seller_payment_txns` still flips `paid_amount`/`status` (trigger fired). `pay_seller` from UI succeeds.
- **Reconcile Σpaid:** After revoke, re-run Σpaid → must still equal 7648 / 4016 (revoke changes privilege, not data; any change = bug).

---

### W4 — Widen `mediabuyer_payments` unique key to `(mediabuyer_id, payout_month, "DigiCom Business")`
- **Action:** Add 3-col unique constraint, repoint upsert, drop 2-col constraint.
- **RISK:** high
- **REVERSIBLE:** yes (re-add 2-col, revert onConflict).
- **Blast radius:** DB writer: `Salaries.tsx:1223` upsert (only writer). Readers: `useMediaBuyerEarnings.ts`, `ProfitabilitySection.tsx`, MB `Payments.tsx`, `Salaries.tsx`, `MediaBuyers.tsx`, `ActivityLogView.tsx`, `useCampaignMetrics.ts`, `useMediaBuyerStats.ts`. Indirect: `PayoutPaymentDialogs.tsx`, `MediaBuyerLedgerDialogs.tsx`.
- **What breaks if naive (corrected per H4):**
  - Constraint-before-code: existing same-MB/same-month rows across businesses violate on next upsert.
  - Code-before-constraint: `onConflict` naming nonexistent columns → `42P10` on every upsert; all MB payout writes blocked.
  - **Underspecified in audit (H4):** the surviving 2-col constraint still blocks a legitimate second-business row even after the 3-col is added. **Multi-business capability does NOT exist until the old 2-col constraint is dropped (Step 3).** Steps 1–2 give a false sense of completion.
  - `Salaries.tsx:1223` onConflict is a single string `'mediabuyer_id,payout_month'`; it MUST already be on the 3-col string before the 2-col drop, or upserts `42P10`. Tight window.
- **Prerequisites:** Live data verified safe today: 3 rows, 2 MBs, 2 businesses, 0 dupes on either key. Note asymmetry — `seller_payments` already has the 3-col key and `close_seller_month` already does `ON CONFLICT (seller_id,payout_month,"DigiCom Business")`; only MB lags.
- **SAFE procedure:**
  1. **Step 1 (migration):** `ALTER TABLE mediabuyer_payments ADD CONSTRAINT mb_payments_3col_uniq UNIQUE (mediabuyer_id, payout_month, "DigiCom Business");` (keep 2-col). Fails loudly if live dupes — desired signal.
  2. **Step 2 (code, deploy):** change `Salaries.tsx:1223` onConflict to `'mediabuyer_id,payout_month,"DigiCom Business"'`. Deploy. Upserts now resolve against the 3-col key; the 2-col still also enforced.
  3. **Step 3 (migration, after Step 2 live ≥1h, 0 errors):** `ALTER TABLE mediabuyer_payments DROP CONSTRAINT <old_2col_name>;`. Multi-business capability lands HERE, not earlier.
- **VERIFICATION:** Pre-Step-1: `SELECT mediabuyer_id, payout_month, "DigiCom Business", count(*) … HAVING count(*)>1` → 0 rows; `COUNT(DISTINCT (…3 cols)) = COUNT(*)`. Post-Step-3: same dup check on 3-col → 0; multi-business test (2 MBs, different business, same month) both upsert in one batch.
- **Reconcile Σpaid:** MB Σpaid must remain **4016** across all three steps. Constraint changes touch keys, not `paid_amount`. Re-check after Step 1 and Step 3.

---

### R3 — Retire 4 legacy `seller_payments` columns: `commission_earned`, `salary_earned`, `days_present`, `bank_snapshot`
- **Action:** Rewrite `seller_ledger` view → rewrite 3 functions to stop writing the cols → repoint code → drop columns.
- **RISK:** high (highest blast radius of the set).
- **REVERSIBLE:** yes, but only via PITR + recovering function/view bodies from the live catalog (no committed migration source).
- **Blast radius:**
  - **DB writers (corrected):** `close_seller_month` (INSERT + UPDATE, `commission_earned = v_earned = month_earned`), `refresh_open_seller_ticket` (UPDATE same), `pay_seller` (INSERTs skeleton row `commission_earned=0, salary_earned=0`). **`pay_seller` does NOT write `bank_snapshot`** (H1 — the audit's "bank_snapshot from params" claim is fabricated). No live writer to `seller_payments.bank_snapshot` exists (8/11 rows non-empty = historical/manual).
  - **DB readers:** `seller_ledger` view — **explicit 20-column list naming all 4 legacy columns** (C1; NOT `SELECT *`). `seller_daily_earnings` view hardcodes `0::numeric AS salary_earned` and is the authoritative `commission_earned` source (populated by triggers/views, not these 3 fns).
  - **Code:** `useSellerLedger.ts:34/81` (selects `bank_snapshot`, `commission_earned`, `salary_earned`, `days_present` via the view); `Sellers.tsx:378–381` (reads `commission_earned`, `days_present`) **and `Sellers.tsx:921`** (`<td>{p.days_present}</td>` visible render — H3, missed by audit); `Salaries.tsx` MB path (out of scope — that's `mediabuyer_payments`); seller `Wallet/Statistics`, analytics `SellersSection/ProfitabilitySection`, `useSellerCommissionTotals`, `useSellerLiveOwed`, `useSellerCommissionTotals` all read `commission_earned` from **`seller_daily_earnings`** (already correct source — do not touch). `database.types.ts` types.
- **What breaks if naive:**
  - **C1 (load-bearing):** `ALTER TABLE … DROP COLUMN commission_earned` while `seller_ledger` names that column → drop fails, or `CASCADE` silently drops the view, killing every ledger reader. View MUST be `CREATE OR REPLACE`d first.
  - **H2:** `commission_earned` is a live mirror (4/11 rows nonzero, each exactly `= month_earned`). Dropping before the 3 fns stop writing it → INSERT/UPDATE `column-not-found` → **silent death of commission accrual + month-close cron**. The audit's STEP-4 "if count=0, drop immediately" escape hatch is wrong (count is NOT 0) and contradicts its own breaksIfNaive.
  - **H3:** `salary_earned`/`days_present` are pure dead data (0 nonzero), but `days_present` is **live-rendered** at `Sellers.tsx:921`; dropping without editing the query+render breaks the admin seller roster.
  - **H1:** `bank_snapshot` has no seller-side writer to neutralize, but `useSellerLedger.ts:81` still selects it via the view → drop before code fix = query error.
- **Prerequisites:**
  - Re-pull exact bodies via `pg_get_functiondef` for all 3 fns and `pg_get_viewdef('seller_ledger')` (no committed source).
  - Full PITR backup of `seller_payments` + `seller_payment_txns`.
  - Confirm RLS policies on `seller_payments` (`20260602140000_rls_scope_parent_payments.sql`) do not inspect the 4 columns (they scope on tenant/owner, not these).
  - Export the 8 `bank_snapshot` + 4 `commission_earned` non-empty rows to CSV before drop (historical preservation).
- **SAFE procedure (reordered per critique C1/H2 — the audit's STEP-2 guard "if SELECT *" must be forced, not conditional):**
  1. **STEP 1 — Code PR (no DB change):** repoint `useSellerLedger.ts:34/81` to drop `bank_snapshot`/`commission_earned`/`salary_earned`/`days_present` from the view select (keep `month_earned`, `carried_in`, `total_amount`); edit `Sellers.tsx:378–381` to read `month_earned` instead of `commission_earned`, remove `days_present` from query AND remove the `:921` `<td>` render; update `database.types.ts`. Verify all `seller_daily_earnings`-sourced readers untouched. Deploy to staging; all pages load.
  2. **STEP 2 — `CREATE OR REPLACE VIEW seller_ledger` (MANDATORY, not conditional):** redefine the explicit 20-column list **omitting** `commission_earned`, `salary_earned`, `days_present`, `bank_snapshot`. This must land before any column drop or the drop fails/cascades.
  3. **STEP 3 — Rewrite the 3 functions (the ONE authorized edit of live ledger bodies):** `CREATE OR REPLACE` `close_seller_month`, `refresh_open_seller_ticket`, `pay_seller` to stop writing the 4 columns; preserve `month_earned`/`total_amount`/`carried_*` accrual logic exactly. Deploy to staging. Run `close_seller_month` for a past month; confirm `month_earned`/`total_amount` populate.
  4. **STEP 4 — Audit/backfill:** export non-NULL `commission_earned`/`bank_snapshot` rows to CSV.
  5. **STEP 5 — Drop columns:** single migration, `BEGIN; ALTER TABLE seller_payments DROP COLUMN IF EXISTS commission_earned, … salary_earned, … days_present, … bank_snapshot; COMMIT;` (view already clean from STEP 2, so no CASCADE collateral).
  6. **STEP 6/7 — Prod rollout:** code PR → view+function migration → (≥1 cron cycle confirmed clean) → column-drop migration.
- **VERIFICATION:** `information_schema.columns WHERE table_name='seller_payments' AND column_name IN (4 cols)` → 0 rows. `SELECT * FROM seller_ledger LIMIT 1` succeeds with no legacy cols. `close_seller_month` for a seller populates `month_earned`/`total_amount`. Admin Sellers roster + seller Payments load without missing-column errors. Code grep: no `commission_earned`/`salary_earned`/`days_present`/`bank_snapshot` read from `seller_payments` (only `seller_daily_earnings.commission_earned` remains, correct).
- **Reconcile Σpaid:** **Critical.** `paid_amount` is untouched by this item — Σpaid seller must remain **7648** at every step. Run `SELECT sum(paid_amount) FROM seller_payments` after STEP 3 (function rewrite) and STEP 5 (drop). The retirement removes *earning-mirror* columns, never the paid ledger. Any deviation from 7648 means a function rewrite altered txn/paid logic — roll back via PITR. Also confirm `month_earned` (now sole earning source) still equals the pre-migration `commission_earned` values for the 4 nonzero rows (they were defined equal).

---

## ITEMS WITH NO ACTION (premise false — do not execute)

### C2 — `retarget-txns-self-select` → **TAKE NO ACTION**
Self-read policies already exist and are correct: `seller_payment_txns_seller_select` (`EXISTS (SELECT 1 FROM seller_payments sp WHERE sp.id = seller_payment_id AND sp.seller_id = auth.uid())`) and `mediabuyer_payment_txns_self_select` (analogous), plus separate `*_tenant_select` admin/owner policies. The audit's Phase 2/3/5 "paradox" (sellers can't read own txns) is false. The self_select policies are granted to `{public}` not `{authenticated}`, but the qual requires `auth.uid()` match so anon reads nothing — **not a leak**. Any DROP/recreate is net-negative risk for zero gain.

### seller_presences RLS (P) — **DO NOT DEPLOY the audit's proposed policies**
C3: the audit's Policy 1–4 predicates `auth.role() = 'commercial'` / `'admin'` are **always FALSE** — `auth.role()` returns the JWT transport role (`authenticated` for every logged-in user), never the app role. App role lives in `users.role`. Deploying these would lock out everyone: sellers can't log presence (Dashboard upsert), can't self-read (Wallet/Statistics); admins can't read (Sellers/SellersSection) — self-inflicted total outage. If presence RLS is to be tightened later, rebuild on the proven pattern used by the txns tables: `seller_id = auth.uid()` for self, `check_user_role(auth.uid(), ARRAY['super admin','admin'])` for admin. Treat current presence RLS work as **redesign required, not execute**.

### add-audit-triggers-txns (A) — **CONDITIONAL; one genuine open risk (UNVERIFIED)**
M2: infra exists (`audit_logs` table present, `audit_row_change` fn present, `log_audit` present), resolving the audit's biggest stated unknown. Firing-order claim correct (`trg_*_audit_aiud` sorts before `trg_*_aiud`, audit fires first → safe). **UNVERIFIED and load-bearing:** whether `audit_row_change` is `SECURITY DEFINER` and whether `audit_logs` has its own RLS that blocks the write. Inspect `pg_get_functiondef('audit_row_change')` + `audit_logs` RLS **before** trusting the audit's STEP 7. Do not add the triggers until that single check passes. This is a value-add, not a cleanup — defer behind the cleanup items.

---

## SEQUENCED PLAN (lowest-risk / most-isolated first)

| # | Item | Risk | Isolation | Gate before proceeding |
|---|------|------|-----------|------------------------|
| 1 | **M3** drop `old_seller_daily_earnings` | low | total (0 readers/writers) | types regenerated, build green, Σpaid 7648/4016 unchanged |
| 2 | **M4** delete `useSellerEarnings.ts` | low | total (0 importers) | grep clean, build green |
| 3 | **M5** owe-hooks reconcile (analysis only) | low (if no change) | read-only | divergence documented; −280 credit confirmed; **no code change** |
| 4 | **G2** revoke EXECUTE on balance fns | low | high (0 rpc callers) | `pay_seller` UI works, advisors clean, Σpaid unchanged |
| 5 | **W4** widen MB unique key | high | medium (single writer) | 3-step ordering enforced; capability only at Step 3; MB Σpaid 4016 held |
| 6 | **R3** retire 4 seller_payments cols | high | low (view + 3 fns + 6 code sites) | view-rewrite → fn-rewrite → code → drop, in that order; Σpaid 7648 held at every step |
| — | **C2** txns retarget | n/a | **NO ACTION** | premise false |
| — | **P** seller_presences | n/a | **REDESIGN, NOT EXECUTE** | audit predicates inert |
| — | **A** audit triggers | med | deferred | verify `audit_row_change` SECDEF + `audit_logs` RLS first |

Hard ordering rules:
1. **R3 internal order is non-negotiable:** `seller_ledger` `CREATE OR REPLACE` (omit 4 cols) → rewrite `close_seller_month`/`refresh_open_seller_ticket`/`pay_seller` to stop writing → repoint `useSellerLedger.ts:34/81` + `Sellers.tsx:381/921` + types → THEN `DROP COLUMN`. The audit's conditional STEP-2 must be forced.
2. **W4 capability lands only at Step 3** (drop old 2-col), with `Salaries.tsx:1223` onConflict already on the 3-col string. Steps 1–2 alone do nothing functional.
3. R3 STEP 3 is the **only** authorized rewrite of live ledger fn bodies; recover exact source via `pg_get_functiondef` first (no committed migration exists).

---

## IF YOU ONLY DO 3 SAFE THINGS NOW

1. **M3** — drop `old_seller_daily_earnings` + regenerate types. Zero readers/writers, empty table, fully reversible.
2. **M4** — delete `useSellerEarnings.ts`. Zero importers, pure dead code, git-revertible.
3. **G2** — revoke EXECUTE on `refresh_seller_payment_balance` / `refresh_mediabuyer_payment_balance`. Zero `.rpc()` callers, definer-internal calls unaffected, real security tightening, one-line reversible.

Defer R3 and W4 (both high-risk, multi-step, require live-fn-body recovery / cross-deploy windows). Do **not** touch C2 (no-op), seller_presences (audit predicates inert), or audit triggers (one unverified SECDEF/RLS check outstanding).