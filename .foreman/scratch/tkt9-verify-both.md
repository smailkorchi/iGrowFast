# VERIFY — TKT-9 snapshot upsert (edge) + tracking-modal offline fallback (frontend)

Blind verifier. Assume broken until proven. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces). Subjects: uncommitted diffs in `supabase/functions/provider-integration/index.ts` (track_parcel case) and `src/components/orders/ParcelTrackingDialog.tsx`, against schema `supabase/migrations/20260729120000_package_status_history.sql` (READ IT). IGNORE the unrelated dirty files under `ops/whatsapp-node/` (different workstream).

## ORIGINAL TASK
Package-status resilience: persist the last successful provider history per parcel (`parcel_tracking_snapshots`, upserted by track_parcel, fail-open) and, when the live provider fetch fails, have the tracking modal fall back to (1) that snapshot, else (2) the `package_status_history` transition log (self-describing denormalized labels), else (3) today's toast+close — with a quiet French banner naming the data's timestamp when offline data is shown.

## CRITERIA (cite file:line each)
1. EDGE: persistence only when result has a non-empty `history` array; reverse lookup on company_parcels by provider_id+tracking_code with skip-if-absent; upsert `{onConflict:'provider_id,tracking_code'}` matching the migration PK; history sliced to last 200 AND each entry's `_original` stripped; column names match the migration (`"DigiCom Business"` quoted); double fail-open (outer try/catch + non-throwing upsert error); `result` never mutated and the response path provably unchanged.
2. EDGE: `deno check supabase/functions/provider-integration/index.ts` exits 0; then `git restore deno.lock`; confirm porcelain clean of deno.lock.
3. FRONTEND: fallback only in the company-parcel path's catch; order = snapshot (maybeSingle, provider_id+tracking_code) → history (tracking_code+provider_id, source='company_parcel', ascending, limit 100) → re-throw to the pre-existing toast+close. Courier branch untouched.
4. FRONTEND: history rows mapped from DENORMALIZED columns (new_status_label/new_status_color — no master-list resolution), tombstones (`new_status_label` null) render « Statut retiré », baselines get the « Statut observé… » comment; the array ordering handed to `trackingHistory` matches what the existing render layer expects (verify against the newest-first convention in src/lib/orders/syncOrderTracking.ts and the dialog's own render `.reverse()` — trace it concretely; a double-reverse bug here would render the fallback timeline upside down).
5. FRONTEND: banner renders only when offline data is shown, with the correct timestamp source (snapshot→fetched_at, history→last row's created_at), and the offline state fully resets on close/reopen and at fetch start.
6. `npx tsc -b` from repo root exits 0 (run it; paste tail; restore tsconfig.app.tsbuildinfo after).
7. Write set: beyond `ops/whatsapp-node/**` and `.foreman/**`, the ONLY modified files are the two subjects + the untracked migration (`git status --porcelain`).

## MUST NOT
Edit source (deno.lock/tsbuildinfo restores excepted); spawn subagents.

## OUTPUT FORMAT
First line PASS / FAIL / PASS_WITH_NOTES; numbered verdicts with evidence; gate tails; defects with location + concrete failure scenario.
