# TICKET FX2 — TKT-8 fixes from Codex adversarial review

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — spaces), apply the four fixes below to the uncommitted Coliaty parcel-change-demand feature. Do NOT touch anything beyond them.

## FIXES
1. **Ownership check for the two NEW edge actions only** (`supabase/functions/provider-integration/index.ts`, cases `get_allowed_destination_cities` ~4452 and `create_parcel_change_demand` ~4473). Today the dispatcher validates only the platform JWT; any authenticated user with a provider UUID + tracking code could act on another business's parcel. Add, for these two cases ONLY (do not touch other actions):
   - Resolve the caller from the request's `Authorization` JWT (the header is already sent by the frontend). Use the service client's `auth.getUser(jwt)` (or a client constructed with the caller token) to get the user id. No valid user → 401.
   - Inspect the live schema to find the actual column names (do not guess): the `providers` table's business column and the `users`/membership table's business column. Then enforce: the target `company_parcels` row (matched by `tracking_code` + `provider_id` = the request's provider_id) exists AND belongs to the same business as the caller. Any mismatch → 403 `{ error: 'Accès refusé pour ce colis.' }`. Keep it to one cheap indexed query chain; place it before the adapter call, shared by both cases (small helper function next to the cases is fine).
2. **Never treat a 2xx without explicit success as success** — both sides:
   - Edge (`createParcelChangeDemand` adapter method ~869-890): after parsing a 2xx response, require `parsed.success === true` AND a non-empty `data.details.ref`; otherwise throw/return the error shape (`{ error, status_code, errors? }`) with the raw message.
   - Dialog (`src/components/orders/ParcelChangeDemandDialog.tsx` ~170-196): only proceed (and only enter the status-flip branch) when the unwrapped payload carries a non-empty `demand.ref`; otherwise throw an `EdgeError` so the UI shows the error panel. Remove the `'—'` fallback ref for the success path (it may remain only for display-hardening if ref is somehow non-string).
3. **Edge-side field validation** (case `create_parcel_change_demand`, before the adapter call): trimmed non-empty `package_phone` and `package_reciever`; `package_price` must be a finite number ≥ 0; for CHANGE_DESTINATION, trimmed non-empty `package_address` and non-empty `package_city`. Throw the same 400-style errors the case already uses for its existing validations.
4. **Dialog must not dismiss during submit** (`ParcelChangeDemandDialog.tsx`): while `submit.isPending`, ignore `onOpenChange(false)` (wrap the handler passed to `<Dialog>`), and block Escape/outside-click via `onEscapeKeyDown`/`onInteractOutside` `preventDefault()` on `DialogContent` when pending. Footer button behavior unchanged.

## VERIFY BEFORE REPORTING
- `npx tsc -b` from repo root exits 0, then `git restore tsconfig.app.tsbuildinfo`.
- `git status --porcelain`: only `supabase/functions/provider-integration/index.ts`, `src/components/orders/ParcelChangeDemandDialog.tsx` modified beyond the already-dirty feature set; `deno.lock` clean. Do NOT run `deno check`.
- For fix 1, report the exact business-column names you found and the query you use (cite schema evidence from the codebase — types file, other edge fns, or migrations — NOT guesses).

## MUST NOT
- Touch other dispatcher cases, other files, or refactor anything.
- Spawn subagents.

## WRITE SET
`supabase/functions/provider-integration/index.ts`, `src/components/orders/ParcelChangeDemandDialog.tsx`.

## OUTPUT FORMAT
First line `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`. Then per-fix file:line changes, the fix-1 schema evidence, tsc tail, git status tail.
