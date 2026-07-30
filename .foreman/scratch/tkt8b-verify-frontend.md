# VERIFY F2 — demand timeline UI

Blind verifier. Assume broken until proven. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces). Subject: uncommitted changes to `src/components/orders/ParcelTrackingDialog.tsx` and `src/components/orders/ParcelChangeDemandDialog.tsx`, against `supabase/migrations/20260729100000_parcel_change_demands.sql` (read it for the schema).

## ORIGINAL TASK (owner's intent)
Show parcel-change demands in the tracking modal with a premium minimal design (better than Coliaty's red/green blocks): one card per demand interleaved in the timeline at created_at, monochrome old→new field diffs (old struck-through ant-mid, new ant-ink), status chip (En attente/Approuvée/Refusée/Mise à jour reçue), PCD ref, filed-by + dates, an « Infos modifiées » header chip when an APPROVED demand exists, and invalidation of the demands query when a new demand is filed from ParcelChangeDemandDialog.

## CRITERIA (cite file:line each)
1. Demands query exists, keyed `['parcel-change-demands', <tracking code>]`, `enabled` gated on the dialog's `open` (kept-mounted trap), reads `parcel_change_demands` by tracking_code with columns that exist in the migration; creator-name embed is defensive (UI renders when it's null).
2. Demand cards interleave with tracking events by date consistently with the existing ordering logic (verify the merge/sort actually positions by created_at relative to event dates — construct the comparison mentally from the code, cite it).
3. Diff rows render ONLY genuinely changed fields (equal / both-empty / undefined-new skipped — check the comparison); old value uses line-through + muted token, new value ink+semibold; NO red/green diff coloring; no side-stripe borders (`border-l-*` accent) anywhere in the new JSX.
4. Status chip covers all four statuses incl. UNKNOWN; ref rendered; footer has Par/date and conditional « Mis à jour ».
5. « Infos modifiées » chip appears only when ≥1 demand is APPROVED.
6. A failing/empty demands query leaves the timeline exactly as before (silent additive).
7. ParcelChangeDemandDialog invalidates `['parcel-change-demands', …]` with a key that MATCHES criterion 1's key shape (same tracking-code value source) on success.
8. `npx tsc -b` from repo root exits 0 (run it; paste tail). `tsconfig.app.tsbuildinfo` restored afterwards (`git status` clean of it).
9. Write set: only the two named files modified in `src/` for this ticket (`git status --porcelain -- src/` — the earlier TKT-8 feature files are already committed; anything else new is a violation).

## MUST NOT
Edit source; spawn subagents.

## OUTPUT FORMAT
First line PASS / FAIL / PASS_WITH_NOTES; numbered verdicts + evidence; tsc tail; defects with location+scenario.
