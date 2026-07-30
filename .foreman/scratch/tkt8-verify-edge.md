# VERIFY E — provider-integration edge actions for Coliaty parcel-change-demand

You are a blind verifier. Assume the work is broken until you personally reproduce evidence otherwise. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — spaces).

## ORIGINAL TASK
Add two Coliaty-only actions to `supabase/functions/provider-integration/index.ts`:
- `get_allowed_destination_cities` — data `{tracking_code}` → proxies `GET {base}/parcel/{code}/allowed-destination-cities`, normalizes to `{cities: [{id, name}]}` defensively (shape undocumented).
- `create_parcel_change_demand` — data `{tracking_code, request_type, package_phone, package_reciever, package_price, package_note, package_city?, package_address?}` → `POST {base}/parcel-change-demand/create` with `package_code` = tracking_code; request_type `CORRECT_INFORMATION` (city/address omitted) or `CHANGE_DESTINATION` (city+address required, pre-validated before calling Coliaty); returns the demand details (`ref` PCD-…, `status` PENDING, …); errors surface Coliaty's message + field errors + HTTP status code so the frontend can special-case 403 (API-key permission).

## ACCEPTANCE CRITERIA — verify by reading the code (cite lines)
1. Both actions exist in the dispatch switch and follow the file's existing `{action, provider_id, data}` contract and naming style.
2. Coliaty-only: a non-coliaty provider/adapter gets a clean 400-style error, consistent with how other adapter-specific actions handle unsupported providers in this file.
3. HTTP calls use the existing `ColiatyAdapter` base-URL + `getAuthHeader()` (`Bearer public:secret`) conventions; paths are relative to the stored base URL exactly like the existing `/parcel/normal` calls (no hardcoded absolute host).
4. Payload field is spelled `package_reciever` (Coliaty's misspelling). `package_code` carries the tracking code. City/address keys are omitted (not sent as null/empty) for CORRECT_INFORMATION.
5. Input validation before any network call: missing tracking_code → 400; CHANGE_DESTINATION without city or address → 400; invalid request_type → 400.
6. Allowed-cities normalization is genuinely defensive (handles object arrays with id/name-like keys, string arrays, `data`-wrapped payloads; unparseable → error including a truncated raw-body snippet).
7. Error propagation includes Coliaty's message, field `errors` when present, and the upstream HTTP status; the function's own response mirrors the existing error-response shape of this file.
8. **NO order-status flip in the edge function** — the design puts the RELAUNCH_NEW flip in the frontend under RLS. Any `orders` table write in these two actions is a FAIL.
9. Typecheck the edge function: run `deno check supabase/functions/provider-integration/index.ts` from the repo root. IMPORTANT: `deno check` rewrites `supabase/functions/deno.lock` — after the check, restore it with `git checkout -- supabase/functions/deno.lock` (or `git restore`). Confirm in your report that the lockfile was restored (`git status --porcelain | grep deno.lock` empty).
10. Write-set discipline: within `supabase/`, ONLY `functions/provider-integration/index.ts` is modified (`git status --porcelain` — ignore `src/**` and `.foreman/**`, owned by others; flag anything else).

## MUST NOT
- Edit any source file (the deno.lock restore in criterion 9 is the sole permitted git operation).
- Spawn subagents.

## OUTPUT FORMAT
First line: `PASS` / `FAIL` / `PASS_WITH_NOTES`. Then numbered verdicts with line evidence, the deno check output tail, lockfile-restored confirmation, and defects (location + why).
