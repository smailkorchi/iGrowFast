# TICKET E — provider-integration: two new Coliaty actions

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (path contains a space — quote it), add exactly two new actions to the provider-integration edge function (`supabase/functions/provider-integration/index.ts`, single file, ~4382 lines):

1. `get_allowed_destination_cities` — data: `{ tracking_code: string }`
2. `create_parcel_change_demand` — data: `{ tracking_code: string, request_type: 'CORRECT_INFORMATION' | 'CHANGE_DESTINATION', package_phone: string, package_reciever: string, package_price: number, package_note: string, package_city?: string | number, package_address?: string }`

## EXPECTED OUTCOME
- Both actions dispatch through the existing `switch` on `action` (~line 4239-4362), same `{action, provider_id, data}` request contract as existing actions (`create_parcel`, `list_provider_cities` naming style — follow it).
- Both are **Coliaty-only**: if the resolved adapter/provider is not `provider_type === 'coliaty'`, return a 400 JSON error with a clear message (match how other adapter-specific actions like `list_networks`/`list_stores` handle unsupported providers — inspect and mirror that pattern).
- `get_allowed_destination_cities` → new ColiatyAdapter method calling `GET ${baseUrl}/parcel/${tracking_code}/allowed-destination-cities` with the existing `getAuthHeader()` (line ~209, format `Bearer public:secret`). **The response shape is not documented** — normalize defensively: return `{ cities: Array<{ id: number | null, name: string }> }`, accepting any of: array of objects with id/name-like keys (`id`/`city_id`, `name`/`city_name`/`label`/`ville`), array of strings, or wrapped in a `data` key. If nothing parseable, throw with the raw body snippet in the message (truncate ~300 chars).
- `create_parcel_change_demand` → new ColiatyAdapter method calling `POST ${baseUrl}/parcel-change-demand/create` with JSON body: `{ package_code: tracking_code, request_type, package_phone, package_reciever, package_price, package_note, package_city?, package_address? }` (omit city/address keys entirely for CORRECT_INFORMATION). On success return the API's payload verbatim-ish: `{ success: true, demand: { id, ref, status, request_type, created_at }, package_code, package_id, message }` (pull from `data.details` / `data` of the Coliaty 200 response — see API spec below).
- Error handling mirrors the existing Coliaty pattern (~lines 336-359 createParcel): non-ok → parse text, attempt JSON, surface Coliaty's `message` and the field errors in `errors` when present, and **include the HTTP status code** in the thrown/returned error so the frontend can distinguish 403 (API-key permission) from 400 validation errors. Return the error to the caller as JSON `{ error: string, status_code: number, errors?: object }` with the appropriate HTTP status, matching how the function returns errors elsewhere.

## CONTEXT (verified facts)
- Adapter class: `ColiatyAdapter`, constructor ~line 202-206 reads `api_base_url` (default `https://customer-api-v1.coliaty.com`), `api_public_key`, `api_secret_key` from the `providers` row; `getAuthHeader()` at ~line 209. Existing endpoints are called as `${baseUrl}/parcel/normal` — the stored base URL already carries any `/api/client` prefix, so use the SAME relative-path convention: `/parcel/${code}/allowed-destination-cities` and `/parcel-change-demand/create`.
- Request handler starts ~line 4201; provider row fetched by `provider_id` ~line 4208 using service role.

### Coliaty API spec (from provider docs)
POST /parcel-change-demand/create. `request_type` values: `CORRECT_INFORMATION` (fix phone/receiver/price/note; city+address NOT required; validation only checks parcel status allows correction) and `CHANGE_DESTINATION` (requires `package_city` + `package_address`; city must be valid AND allowed for the parcel's hub flow; parcel must not be with a livreur). `package_city` accepts integer city ID or exact city-name string. Success 200:
```json
{"success":true,"code":200,"message":"Demande de modification de colis créée avec succès","data":{"package_code":"…","package_id":646970,"details":{"id":2307,"ref":"PCD-…","status":"PENDING","request_type":"CHANGE_DESTINATION","created_at":"…"}}}
```
Errors: 400 `{"title":"City Not Found","message":"Ville introuvable","errors":{"package_city":"…"}}`; 400 City Not Allowed; 400 "Parcel is with livreur - destination change not allowed"; 403 `{"message":"This API key does not have permission to create parcel change demands"}`; 404 "Colis non trouvé". Auth: `Authorization: Bearer {public}:{secret}`.
Companion: GET /parcel/{parcel_code}/allowed-destination-cities returns the allowed city list (shape undocumented — normalize defensively as specified above).

## CONSTRAINTS
- **The field name `package_reciever` is Coliaty's own misspelling — send it exactly as spelled.**
- Do NOT implement any order-status flip in this edge function. The frontend performs the RELAUNCH_NEW status update under the user's RLS — this is a deliberate design decision; the edge fn stays a pure Coliaty proxy.
- Do NOT run `deno check` (it rewrites `deno.lock`; the verifier handles that). Do not modify `deno.lock`.
- Match the file's existing code style exactly (indentation, error strings, comment density). No refactors of adjacent code.

## MUST DO
- Add the two adapter methods to `ColiatyAdapter` and the two `case` branches in the dispatch switch.
- Keep the actions' input validation explicit: missing `tracking_code` → 400; `create_parcel_change_demand` with `request_type === 'CHANGE_DESTINATION'` missing `package_city` or `package_address` → 400 before calling Coliaty; invalid `request_type` → 400.
- Report the exact line ranges you added/changed.

## MUST NOT
- Touch any file other than `supabase/functions/provider-integration/index.ts`.
- Spawn subagents or other workers.
- Reformat, re-order, or "improve" existing code.

## OUTPUT FORMAT
First line: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`. Then: files touched, line ranges, the exact request/response contract of both new actions (so the frontend can rely on it), and any concerns.
