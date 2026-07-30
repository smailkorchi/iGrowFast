# VERIFY E2 — demand persistence + webhook reconciliation

Blind verifier. Assume broken until proven. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces). Subject: uncommitted changes to `supabase/functions/provider-integration/index.ts` and `supabase/functions/provider-webhook/index.ts`, against the new table in `supabase/migrations/20260729100000_parcel_change_demands.sql` (read it first).

## ORIGINAL TASK
(1) provider-integration `create_parcel_change_demand`: after Coliaty success, insert a `parcel_change_demands` row (business/order/provider/tracking_code/ref/request_type/old_values snapshot from the orders row/new_values from the submission/raw/created_by) — FAIL-OPEN (insert failure must not fail the API response); retry-safe on duplicate ref. (2) provider-webhook: tolerant branch after event-name extraction — find `PCD-…` refs anywhere in the payload; update matching demand rows scoped to the webhook's business (verdict scan: approuv/approved/accept → APPROVED, refus/reject → REJECTED, else UNKNOWN only-if-PENDING; always provider_status_raw + resolved_at + webhook_log_id); FAIL-OPEN; if the payload has no status candidates for the normal pipeline, mark log processed and return early (`demand_reconciled`) so status-less demand webhooks don't pollute the unmatched-status queue; with candidates present, normal flow must be untouched.

## CRITERIA (cite file:line each)
1. Insert fires only on adapter success, carries every column listed above with names matching the migration exactly (`"DigiCom Business"` quoted), and is wrapped so its failure cannot alter the success response (trace the return path).
2. Duplicate-ref retry cannot 500 (upsert on ref, or unique-violation caught).
3. `assertParcelChangeAccess` still performs the same 401/403 checks; its extension only ADDS returned data.
4. Webhook branch: regex actually matches `PCD-1780429520-8131`-style refs; updates are scoped `.eq('"DigiCom Business"', …)` or equivalent; the no-verdict update is conditioned on current status PENDING (cannot downgrade APPROVED); resolved_at/webhook_log_id/provider_status_raw set on every reconciliation.
5. Early-return happens ONLY when (refs-or-demand-event detected) AND (zero status candidates by the same extraction the normal pipeline uses); payloads with candidates fall through to an UNCHANGED status pipeline (diff the surrounding code paths).
6. A payload with no PCD ref and no DEMAND event name takes a byte-identical path to before (read the diff hunks: nothing else touched).
7. No writes to `orders` in the new code.
8. `deno check` both files from repo root; then `git restore deno.lock`; confirm `git status --porcelain | grep deno.lock` empty.
9. Write set: within `supabase/`, only the two named files + the migration file changed (`git status --porcelain -- supabase/`).

## MUST NOT
Edit source (deno.lock restore excepted); spawn subagents.

## OUTPUT FORMAT
First line PASS / FAIL / PASS_WITH_NOTES; numbered verdicts + evidence; deno tails; defects with location+scenario.
