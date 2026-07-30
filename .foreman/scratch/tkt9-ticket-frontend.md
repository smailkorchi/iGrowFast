# TICKET F3 — tracking modal offline fallback (snapshot → transition log → today's behavior)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), give `src/components/orders/ParcelTrackingDialog.tsx` a resilient fallback when the live provider fetch fails. Schemas: `supabase/migrations/20260729120000_package_status_history.sql` (READ IT — tables `parcel_tracking_snapshots` + `package_status_history`).

## CONTEXT — current failure path
`trackParcelWithFallback` (src/lib/orders/syncOrderTracking.ts:123-187) throws when both track_parcel and get_parcel_info fail; the dialog catches (~line 255-259), shows a destructive toast « Tracking Error » and CLOSES. That's the path to replace for company parcels (courier-parcel branch stays as is).

## EXPECTED OUTCOME
On catch (company-parcel path only):
1. Query `parcel_tracking_snapshots` by `provider_id` + `tracking_code` (`(supabase as any)`, `.maybeSingle()`, RLS scopes tenant — precedent: the demands query in this same file). If found and `history` is a non-empty array: feed the SAME normalized `trackingHistory` state the live path sets (status/statusLabel from the row, history array as-is), so ALL downstream rendering — including the TKT-8b demand cards — works unchanged. Set a new state flag `offlineSource: 'snapshot'` with the row's `fetched_at`.
2. Else query `package_status_history` by `tracking_code` AND `provider_id` (company parcels carry it; rows store it denormalized) with `.eq('source','company_parcel')`, `order('created_at', ascending)`, limit 100. The rows are SELF-DESCRIBING — `new_status_label` + `new_status_color` are denormalized at write time; NO master resolution needed. Map each row: `{ status: new_status_label ?? 'Statut retiré', statusLabel: same, date: created_at, comment: row.is_baseline ? 'Statut observé à cette date' : '', color: new_status_color }`. Rows with `new_status_id`/`new_status_label` null are TOMBSTONES (status was cleared) — render label « Statut retiré » muted. Set `offlineSource: 'history'`.
3. Else: today's behavior exactly (toast + close).
4. **Banner**: when `offlineSource` is set, render ONE quiet banner above the timeline: `rounded-xl border border-ant-orange/30 bg-ant-orange/10 px-3 py-2.5`, text `text-[11.5px] font-semibold text-ant-ink` with an `AlertCircle w-3.5 h-3.5 text-ant-orange` icon: « Historique fournisseur indisponible — données enregistrées le {dd/MM/yyyy HH:mm} » (snapshot: fetched_at; history: the LAST row's created_at). No red, no shouting; reduced motion respected (no entrance animation).
5. Reset `offlineSource` on dialog close/reopen (the existing reset effect).

## CONSTRAINTS
- Every new query gated on `open` (OR-11 kept-mounted trap — see existing comments in the file). These are one-shot fetches inside the existing async `run()` flow, not new useQuery hooks — keep them inline in the catch (they only run on failure).
- The snapshot query needs `provider_id`: the dialog already selects it on the parcel (`provider:providers(id, …)` / `provider_id` — line ~82). Use the parcel's `provider_id`.
- No new dependencies, no refactor of the happy path. `npx tsc -b` exit 0 (then `git restore tsconfig.app.tsbuildinfo`).

## MUST NOT
Touch other files. Spawn subagents.

## WRITE SET
`src/components/orders/ParcelTrackingDialog.tsx`.

## OUTPUT FORMAT
First line `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`; changes file:line; tsc tail; deviations with justification.
