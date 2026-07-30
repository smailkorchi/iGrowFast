# TICKET FX — TKT-8 batch fixes (post-verification findings)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — spaces), apply the six fixes below to the freshly built Coliaty parcel-change-demand feature. The feature: `src/components/orders/ParcelChangeDemandDialog.tsx` (new dialog) wired into `src/pages/admin/Orders.tsx` + `src/pages/seller/Orders.tsx` card menus, calling edge actions `get_allowed_destination_cities` / `create_parcel_change_demand` in `supabase/functions/provider-integration/index.ts`.

## FIXES (in severity order)
1. **HIGH — response envelope mismatch.** The edge dispatcher wraps every success as `{ success: true, data: {...} }` (provider-integration/index.ts:4539), but the dialog reads top-level: `json.cities ?? []` (ParcelChangeDemandDialog.tsx:138) and `json.demand ?? {}` (:167). Cities list is therefore always empty and the demand ref always blank. Fix in the dialog: unwrap defensively — `const payload = json?.data ?? json;` then read `payload.cities` / `payload.demand`. Error responses are NOT wrapped (`{ error, status_code, errors? }` returned directly) — keep error reads at top level.
2. **MEDIUM — seller may send a courier tracking code to Coliaty.** Seller's pre-existing `adaptRpcRow` (src/pages/seller/Orders.tsx:1410-1418) synthesizes the order's parcel with `tracking_code: r.latest_tracking_code || r.can_track.tracking_code`, where `latest_tracking_code` can be a COURIER parcel's code on mixed-parcel orders; the new feature currently rides that synthetic parcel via `getLatestTrackableCompanyParcel(order)`. Coliaty must only ever receive the COMPANY parcel's code. Fix at the FEATURE's call sites only (do NOT refactor `adaptRpcRow` — other consumers depend on it): inspect the seller RPC row (`can_track` lateral etc.) and derive the dialog's `tracking_code` + `provider_id` (and the menu gating) exclusively from the company-parcel source, mirroring admin's preference order at src/pages/admin/Orders.tsx:3230-3236.
3. **LOW — silent-success hole in the status flip.** ParcelChangeDemandDialog.tsx:183-187 updates `orders.order_status_id` without `.select()`; an RLS-filtered zero-row update reports success. Append `.select('id')` and treat an empty result array as flip-failure → route to the existing partial-success warning path.
4. **LOW — URL encoding.** provider-integration/index.ts:774 interpolates the tracking code into the URL path raw. Wrap with `encodeURIComponent(...)`. One-line change; touch nothing else in the file.
5. **CONSISTENCY — list views lack the action.** Both table views have per-row DropdownMenus with a Track item (src/components/orders/OrdersListView.tsx:~415 area, src/components/orders/SellerOrdersListView.tsx:369-375). Add the `Modify Parcel` item (lucide `PackageOpen`, identical sibling styling, placed after Track) to BOTH, with the same gating semantics as the card menus: rendered only when the order's latest COMPANY parcel is Coliaty's, disabled when the order's package status is terminal (`is_terminal || is_returned`). Follow each view's existing prop conventions (they receive callbacks like `onTrackParcel` and compute `canTrack` from row data): pass whatever minimal props are needed from the host pages (e.g. an `onModifyParcel(order)` callback plus gating data or a gating callback). Both hosts already compute the gating (admin Orders.tsx:3228-3236, seller Orders.tsx:3046-3053) — extract/reuse, don't duplicate divergent logic.
6. **HOUSEKEEPING.** After your final `npx tsc -b` run, restore the churned build artifact: `git restore tsconfig.app.tsbuildinfo` (it is tracked; cache churn must not be committed).

## VERIFY BEFORE REPORTING
- `npx tsc -b` from repo root exits 0 (then do fix 6).
- `git status --porcelain` shows only: the write-set files below modified + untracked `.foreman/` + the new dialog file; `deno.lock` and `tsconfig.app.tsbuildinfo` clean.

## MUST NOT
- Refactor or "improve" anything beyond the six fixes. Every changed line traces to one of them.
- Touch `adaptRpcRow`'s existing behavior for other consumers.
- Run `deno check` (rewrites deno.lock).
- Spawn subagents.

## WRITE SET
`src/components/orders/ParcelChangeDemandDialog.tsx`, `src/pages/admin/Orders.tsx`, `src/pages/seller/Orders.tsx`, `src/components/orders/OrdersListView.tsx`, `src/components/orders/SellerOrdersListView.tsx`, `supabase/functions/provider-integration/index.ts` (fix 4 only).

## OUTPUT FORMAT
First line `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`. Then per-fix: what changed, file:line. Then tsc result tail + git status tail.
