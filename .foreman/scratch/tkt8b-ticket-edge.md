# TICKET E2 — demand persistence (provider-integration) + tolerant webhook reconciliation (provider-webhook)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — spaces), wire the new `public.parcel_change_demands` table (migration `supabase/migrations/20260729100000_parcel_change_demands.sql` — READ IT FIRST for exact columns) into two edge functions.

## PART 1 — `supabase/functions/provider-integration/index.ts`: record the demand at creation
In the `create_parcel_change_demand` dispatch case, after the adapter call succeeds:
1. The existing `assertParcelChangeAccess(req, supabase, providerId, trackingCode)` helper (just above `Deno.serve`) already resolves the caller and the parcel. Extend it minimally to RETURN `{ userId, businessId, parcelOrderId }` — add `order_id` to its `company_parcels` select. Do not change its checks or error behavior.
2. After a successful `adapter.createParcelChangeDemand(...)`, INSERT one row into `parcel_change_demands` using the service-role client:
   - `"DigiCom Business"` = businessId, `order_id` = parcelOrderId, `provider_id`, `tracking_code`,
   - `ref` = the demand ref from the adapter result, `request_type` = data.request_type, `status` = 'PENDING' (default),
   - `old_values` = snapshot fetched server-side from the `orders` row (`phone`, `name` → key `receiver`, `price`, `city`, `address` — check the actual orders columns in `src/lib/database.types.ts` or an existing select in this file; use only columns that exist; `note: null`),
   - `new_values` = the submitted fields `{ phone, receiver (from package_reciever), price, note, city (only CHANGE_DESTINATION), address (only CHANGE_DESTINATION) }`,
   - `raw` = the adapter's returned demand object, `created_by` = userId.
   Use `.upsert(..., { onConflict: 'ref' })` semantics OR a plain insert with a caught unique-violation — a Coliaty retry must not 500 the response.
3. **FAIL-OPEN:** the insert lives in its own try/catch; on failure `console.error` and still return the normal success response (the demand exists at Coliaty regardless).

## PART 2 — `supabase/functions/provider-webhook/index.ts`: tolerant reconciliation branch
Coliaty documents NO demand webhook — we cannot know the payload shape. Add a defensive branch:
1. Slot: after the event-name extraction (`const eventName = String(payload.EVENT || '')...`, ~line 203-210) and BEFORE status-candidate assembly (~line 222). The webhook_logs insert (~133-139) and parcel/business resolution (~157-168) happen earlier — the branch can use `logEntry` and `businessId`.
2. Detection: stringify the payload once; collect all refs matching `/PCD-[0-9][0-9-]*/g` (case-insensitive). Also treat `eventName` containing `DEMAND` or `CHANGE_DEMAND` as a demand signal even without a ref (in that case just mark the log processed with a note — nothing to reconcile).
3. For each found ref, UPDATE `parcel_change_demands` WHERE `ref` = that ref AND `"DigiCom Business"` = businessId:
   - Verdict scan (payload string, lowercase): contains `approuv`/`approved`/`accept` → `status='APPROVED'`; contains `refus`/`reject`/`denied` → `status='REJECTED'`; otherwise set `status='UNKNOWN'` **only if the current status is 'PENDING'** (never downgrade a concluded status — use a conditional `.eq('status','PENDING')` on the no-verdict update).
   - Always set `provider_status_raw` = a short extracted status-ish string if one exists (payload.STATUS/STATUT/SITUATION/data.status — first non-empty) else the eventName, `resolved_at = now()`, `webhook_log_id = logEntry.id`.
4. **Flow control:** the whole branch is FAIL-OPEN (try/catch, log, continue). After reconciliation: if the payload yields NO status candidates for the normal pipeline (inspect how candidates are assembled ~222-234 — reuse the same extraction), mark the webhook log processed with message `Demand reconciliation only` and `return json({status:'demand_reconciled', refs:[...]})` — this prevents a status-less demand webhook from polluting the unmatched-status queue (TKT-6). If status candidates DO exist, fall through to the normal status pipeline unchanged.

## MUST DO
- Read the migration file first; column names are exact (`"DigiCom Business"` quoted).
- Keep both functions' existing behavior byte-identical for payloads with no PCD ref and no DEMAND event name.
- Report exact line ranges changed in both files.

## MUST NOT
- Touch any other file. No `deno check` (verifier runs it). No refactors. No writes to `orders` in either branch. Do not spawn subagents.

## WRITE SET
`supabase/functions/provider-integration/index.ts`, `supabase/functions/provider-webhook/index.ts`.

## OUTPUT FORMAT
First line `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`; per-part changes with file:line; concerns.
