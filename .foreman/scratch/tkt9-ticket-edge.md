# TICKET E3 — persist rich tracking snapshots in provider-integration

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), make the `track_parcel` action persist the last successful provider history into `public.parcel_tracking_snapshots` (schema in `supabase/migrations/20260729120000_package_status_history.sql` — READ IT).

## EXPECTED OUTCOME
In `supabase/functions/provider-integration/index.ts`, dispatch case `track_parcel` (~line 4428): after `adapter.trackParcel(...)` returns successfully AND the result contains a non-empty `history` array:
1. Reverse-lookup the parcel once: `company_parcels` by `provider_id` + `tracking_code` → `order_id`, `"DigiCom Business"` (single indexed select, `maybeSingle`). If no row: skip persistence entirely (parcel unknown to us — nothing to scope the row to).
2. Upsert into `parcel_tracking_snapshots` with `{ onConflict: 'provider_id,tracking_code' }`: provider_id, tracking_code, "DigiCom Business", order_id, status (result.status ?? null), status_label (result.statusLabel ?? null), history (the result's normalized history array — NOT `_original` — and **sliced to the LAST 200 entries** with each entry's `_original` key stripped if present; the column has a CHECK jsonb_typeof='array'), fetched_at = now ISO.
3. **FAIL-OPEN**: own try/catch around ALL of it; `console.error` on failure; the track_parcel response to the client is byte-identical in success and failure of persistence.

## CONSTRAINTS
- Do NOT store `_original` (raw payload bloat) — only the normalized history array the adapter returns.
- Do NOT touch other actions or the adapters. Match file style. No deno check (verifier's job), no deno.lock changes.

## MUST DO
Report exact line ranges; confirm the response path is unchanged by tracing it in your report.

## MUST NOT
Touch any other file. Spawn subagents.

## WRITE SET
`supabase/functions/provider-integration/index.ts`.

## OUTPUT FORMAT
First line `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`; changes file:line; response-path trace; concerns.
