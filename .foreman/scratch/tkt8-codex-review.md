You are a senior reviewer doing an adversarial cross-review of an UNCOMMITTED feature in this repo (read-only sandbox; the working-tree diff vs HEAD is the review subject). Try to REFUTE the feature's correctness — find real defects, not style nits.

FEATURE: "Coliaty parcel-change demand" — lets admin/seller file a CORRECT_INFORMATION or CHANGE_DESTINATION request against Coliaty's API for an order's parcel, and on successful CHANGE_DESTINATION flips the order's status to the RELAUNCH_NEW order status.

SURFACES (run `git diff` and `git status` to see everything; the new untracked file is part of the feature):
1. supabase/functions/provider-integration/index.ts — new ColiatyAdapter methods (~lines 769-891) + two dispatcher cases (~4452-4499): `get_allowed_destination_cities` (GET {base}/parcel/{code}/allowed-destination-cities, defensive normalization to {cities:[{id,name}]}) and `create_parcel_change_demand` (POST {base}/parcel-change-demand/create, body {package_code, request_type, package_phone, package_reciever, package_price, package_note, package_city?, package_address?}).
2. src/components/orders/ParcelChangeDemandDialog.tsx (NEW, untracked — read it in full) — 3-step dialog; note the dispatcher wraps success as {success, data:{...}} and the dialog unwraps `json.data ?? json`; errors are returned UNwrapped {error, status_code, errors?}.
3. src/pages/admin/Orders.tsx + src/pages/seller/Orders.tsx — menu items + `getParcelChangeGate` helpers + dialog mounts; gating = latest COMPANY parcel is a Coliaty provider (matched via provider_type through the companies map) AND package status not terminal (is_terminal || is_returned master flags).
4. src/components/orders/OrdersListView.tsx + SellerOrdersListView.tsx — same menu item via onModifyParcel/getModifyParcelGate props.

KNOWN + ACCEPTED (do not re-report): local-validation errors use the generic {success:false, error} 400 envelope while Coliaty-passthrough errors use {error, status_code, errors?}; custom error responses omit success:false; allowed-cities response shape is undocumented upstream, normalization is best-effort; card menus + list views covered, other views out of scope; tsbuildinfo churn.

FOCUS YOUR ATTACK ON:
- The dialog↔edge contract: every read/write across the seam (cities array, demand.ref, error paths incl. 403 special-case, provider_id propagation).
- The status flip: resolves order_statuses by code RELAUNCH_NEW, updates orders.order_status_id with .select('id') zero-row detection. Can it fire when it shouldn't (CORRECT_INFORMATION path, failed demand), or fail silently?
- The seller gating: can a courier parcel's tracking code ever reach Coliaty? (gate reads order.can_track.provider_id / tracking_code with latest_tracking_code fallback).
- The edge validation: can a request reach Coliaty with missing/invalid fields? request_type whitelist, CHANGE_DESTINATION city+address requirement, CORRECT_INFORMATION omitting city keys.
- React correctness: state reset on open, stale citiesQuery data across orders (queryKey includes providerId+trackingCode?), mutation retry path, kept-mounted query gating.
- Any TypeScript/runtime hazard tsc would miss (unsafe casts, Number('') coercion, null flows).

OUTPUT FORMAT (mandatory): first line exactly one of PASS / FAIL / PASS_WITH_NOTES. Then findings ranked by severity, each with file:line, the concrete failure scenario, and a one-line suggested fix. If you cannot refute anything material, say so explicitly rather than inventing nits.
