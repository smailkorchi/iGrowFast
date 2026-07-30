# TICKET FX3 — TKT-8b fixes from Codex adversarial review (6 findings, all accepted)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), apply the fixes below. The migration was already updated by the lead: the unique index is now COMPOSITE `(provider_id, ref)` (`parcel_change_demands_provider_ref_key` in `supabase/migrations/20260729100000_parcel_change_demands.sql` — read it).

## FIXES
1. **Upsert conflict target** (`supabase/functions/provider-integration/index.ts`, the `parcel_change_demands` upsert in `create_parcel_change_demand`): change `{ onConflict: 'ref' }` → `{ onConflict: 'provider_id,ref' }` to match the composite index.
2. **Move the demand-reconciliation branch earlier** (`supabase/functions/provider-webhook/index.ts`): today the branch (marked `── Demand reconciliation (TKT-8b)`) sits after the tracking-code extraction and the parcel/order-resolution early-exits (~line 150 "no tracking code", ~line 173 "Order not found") — a demand-only webhook with no recognized tracking field (or whose `ref` field carries the PCD ref and gets misread as a tracking code) EXITS before reconciliation ever runs. Relocate the entire branch to run immediately after the `webhook_logs` insert (logEntry creation) and the business resolution, BEFORE the no-tracking-code and order-not-found exits. `businessId` and `logEntry` are both available there — verify by reading the flow from the auth select downward. The branch's own logic (refs regex, verdict, updates, early return) stays intact; only its position and any variables it referenced that are now defined later (e.g. `forcelogData`, `dropPaid`, `skipSenditNA` helpers, `eventName`) must be accounted for — move helper definitions up if needed or inline equivalent reads; do NOT duplicate them.
3. **Verdict scan: negations first, bounded** (same branch): current order matches `/accept/` before rejection, so `NOT_ACCEPTED`/`NON_ACCEPTE`/`REJECTED_NOT_ACCEPTED` conclude APPROVED permanently. Rework: test the REJECT class first with negated-acceptance forms included — `/refus|reject|denied|not[_ ]?accept|non[_ ]?accept/` — then the approve class `/approuv|approved|accept/`. Keep the fields-first-then-whole-payload source logic as is.
4. **Explicit demand events never enter the status pipeline** (same branch): when `eventName` matches `/DEMAND/`, the payload's STATUS is the DEMAND verdict, not a parcel status — after reconciliation, mark the log processed and return `demand_reconciled` REGARDLESS of whether status candidates exist. The candidates-empty early-return remains for ref-only signals (non-demand event names keep falling through).
5. **providerStatusRaw**: include `payload.DEMAND_STATUS` first in the `providerStatusRaw` fallback chain.
6. **Frontend demand query scoped by order** (`src/components/orders/ParcelTrackingDialog.tsx`): tracking codes are carrier-scoped — same string on two carriers in one business would share cached cards. Add `.eq('order_id', orderId)` to the demands query and change its key to `['parcel-change-demands', orderId, trackingCode]` (orderId is a prop). In `src/components/orders/ParcelChangeDemandDialog.tsx` change the invalidation to `queryClient.invalidateQueries({ queryKey: ['parcel-change-demands', order.id] })` — a PREFIX of the new key, so it still matches.

## VERIFY BEFORE REPORTING
- `deno check supabase/functions/provider-webhook/index.ts supabase/functions/provider-integration/index.ts` exits 0, then `git restore deno.lock`.
- `npx tsc -b` exits 0, then `git restore tsconfig.app.tsbuildinfo`.
- Trace and state explicitly in your report: for a synthetic payload `{EVENT:'PARCEL_CHANGE_DEMAND_UPDATED', ref:'PCD-11-22', STATUS:'APPROVED'}` with no tracking field — which code path runs now (must be: log insert → demand reconciliation → APPROVED update → processed + `demand_reconciled` return, no "Order not found").
- `git status --porcelain` — write set only.

## MUST NOT
Refactor beyond the six fixes; touch other dispatcher cases; spawn subagents.

## WRITE SET
`supabase/functions/provider-integration/index.ts`, `supabase/functions/provider-webhook/index.ts`, `src/components/orders/ParcelTrackingDialog.tsx`, `src/components/orders/ParcelChangeDemandDialog.tsx`.

## OUTPUT FORMAT
First line `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`; per-fix file:line; the traced path for the synthetic payload; gate tails; git status tail.
