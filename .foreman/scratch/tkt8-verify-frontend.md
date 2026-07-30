# VERIFY F — frontend of the Coliaty parcel-change-demand feature

You are a blind verifier. Assume the work is broken until you personally reproduce evidence otherwise. You were NOT shown the implementer's reasoning — only the original task and acceptance criteria. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — it contains spaces).

## ORIGINAL TASK (owner's words, verbatim)
"okay, now we need to properly design the front end in the seller and admin dashboard to properly call this, it must be perfect man, using or design paterns in the app and follosing the /impecable skill principles so that we creat a perfet journey, the buttons appears when this endpoint is callable, shoiwng the modal that asks what request type, and folowing the procedure for both paths, ( shoiwng the available cities leting the user select it and continue on the echange, ( and if request type is change destination after success the order status flips to relancer nouveu client )"
Context: "this" = Coliaty `POST /parcel-change-demand/create` with request_type `CORRECT_INFORMATION` (fix phone/receiver/price/note; no city/address) or `CHANGE_DESTINATION` (requires city+address; city must come from `GET /parcel/{code}/allowed-destination-cities`). The feature was implemented as a shared dialog wired into `src/pages/admin/Orders.tsx` and `src/pages/seller/Orders.tsx`, calling the `provider-integration` edge function with actions `get_allowed_destination_cities` and `create_parcel_change_demand`.

## ACCEPTANCE CRITERIA — verify each by reading the actual code (cite file:line)
1. A per-order row action exists in BOTH admin and seller Orders menus; rendered only when the order's latest trackable company parcel is provider_type `coliaty` (matched on `provider_type`, never on provider name); disabled when the parcel's status is terminal (master flags `is_terminal` OR `is_returned`).
2. The dialog asks the request type first (two options), then per path: CORRECT_INFORMATION shows phone/receiver/price/note only (no city/address); CHANGE_DESTINATION additionally fetches allowed cities through the edge action `get_allowed_destination_cities` and requires a selected city + non-empty address before submit.
3. Every react-query hook inside the dialog is gated on the dialog being open (`enabled: open…`) — the kept-mounted-dialog trap.
4. On CHANGE_DESTINATION success the order's `order_status_id` is set to the `order_statuses` row with code `RELAUNCH_NEW`, resolved by code at runtime (grep for hardcoded status UUIDs — any hardcoded UUID for this is a FAIL). A failed flip after a successful demand shows an explicit partial-success warning, not silent success.
5. The orders list the user is looking at gets invalidated/refreshed after success.
6. Error paths surfaced: Coliaty 400 messages shown to the user; HTTP 403 gets a dedicated French explanation about API-key permission.
7. `package_reciever` (Coliaty's misspelling) is the field name sent in the payload.
8. French copy inside the dialog; state coverage: loading, error+retry, success, disabled submit until valid.
9. Run the REAL typecheck from the repo root: `npx tsc -b` (a bare `tsc --noEmit` is vacuous in this repo). It must exit 0. Paste the tail of its output.
10. Write-set discipline: `git status --porcelain` — modified files must be within: `src/components/orders/ParcelChangeDemandDialog.tsx`, `src/pages/admin/Orders.tsx`, `src/pages/seller/Orders.tsx`, `src/lib/orders/fetchOrderById.ts`, plus at most one page-level query-definition file and `supabase/functions/provider-integration/index.ts` (owned by a parallel worker — ignore it, but flag ANY other modified file, especially `deno.lock`).

## MUST NOT
- Edit any source file. You may run builds/checks only.
- Spawn subagents.

## OUTPUT FORMAT
First line: `PASS` / `FAIL` / `PASS_WITH_NOTES`. Then a numbered verdict per criterion with file:line evidence, the tsc output tail, and any defects found (exact location + why it fails the criterion).
