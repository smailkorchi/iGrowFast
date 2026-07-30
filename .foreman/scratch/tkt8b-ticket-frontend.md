# TICKET F2 — demand lifecycle in the tracking timeline (premium, minimal)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote the path — spaces), surface `public.parcel_change_demands` rows (migration `supabase/migrations/20260729100000_parcel_change_demands.sql` — READ IT for columns) inside the parcel tracking modal, with a design that beats Coliaty's noisy red/green diff blocks through restraint: ink-on-paper, monochrome diffs, one card per demand.

## CONTEXT — design bar
The app's register: calm, precise, dense-with-hierarchy (see the timeline rows already in `src/components/orders/ParcelTrackingDialog.tsx:268-410` — status pill `text-[10px] font-black uppercase`, dates `dd/MM/yyyy HH:mm`, italic comments). Coliaty's reference UI shows per-field strikethrough diffs in red/green with orange side-bars — we do the OPPOSITE of that noise: monochrome old→new (old = `line-through text-ant-mid` exactly like the exemplar `src/pages/owner/Plans.tsx:401`; new = `text-ant-ink font-semibold`), one accent only via the status chip. No side-stripe borders (absolute ban), no red/green pairs.

## EXPECTED OUTCOME
### 1. Demands query (ParcelTrackingDialog)
- New react-query: key `['parcel-change-demands', trackingCode]`, `enabled: open && !!trackingCode`, `staleTime` ~60s. Select from `parcel_change_demands`: all needed columns + creator name embed `created_by_user:users!parcel_change_demands_created_by_fkey(name)` (defensive — render without the name if the embed returns null). Filter `.eq('tracking_code', trackingCode)` (RLS scopes the business), order `created_at` ascending.
- KEPT-MOUNTED TRAP: gate on `open` (see the OR-11 comment at line 58-60 of this same file).

### 2. Timeline merge
- Each demand renders as ONE card placed in the existing timeline flow at its `created_at` position (match the current event ordering — inspect how events are sorted/rendered and interleave by date; demands carry their own node on the timeline rail with a distinct icon: `PencilLine` for CORRECT_INFORMATION, `MapPin` for CHANGE_DESTINATION).
- Card (rounded-xl border border-ant-line bg-ant-paper, compact padding — NOT nested cards):
  - Header row: type label French (`Correction d'informations` / `Changement de destination`, `text-[12px] font-semibold text-ant-ink`), status chip (PENDING → `En attente` border-ant-line text-ant-mid; APPROVED → `Approuvée` bg-ant-green/10 text-ant-green; REJECTED → `Refusée` bg-ant-rose/10 text-ant-rose; UNKNOWN → `Mise à jour reçue` bg-ant-ink/5 text-ant-mid), and the ref right-aligned (`text-[10px] tabular-nums text-ant-mid`, e.g. PCD-1780429520-8131).
  - Diff rows — ONLY fields that actually changed (compare `old_values` vs `new_values` per key; skip when equal, both empty, or the new value is undefined). French labels: Téléphone, Destinataire, Prix, Note, Ville, Adresse. Row layout: label (`text-[10.5px] text-ant-mid w-24 shrink-0`) then old value struck through, a thin `→`, new value. Long values wrap, never overflow.
  - Footer line (`text-[10.5px] text-ant-mid`): `Par {name} · {dd/MM/yyyy HH:mm}` from created_by_user/created_at; when `resolved_at` non-null append ` · Mis à jour {dd/MM/yyyy HH:mm}`.
- Empty/failed demands query: render the timeline exactly as today (feature is additive; no error banner for this query — silent).

### 3. « Infos modifiées » signal
When ≥1 demand has `status='APPROVED'`, show a quiet chip next to the tracking code in the dialog header area: `Infos modifiées` (`text-[10px] font-semibold bg-ant-ink/5 text-ant-ink rounded-md px-2 py-0.5`). Nothing louder.

### 4. Invalidation seam (ParcelChangeDemandDialog)
In `src/components/orders/ParcelChangeDemandDialog.tsx`, on successful demand creation also invalidate `['parcel-change-demands', order.trackingCode]` (add `useQueryClient`). Keep everything else untouched.

## MUST DO
- `npx tsc -b` from repo root exits 0 (run before reporting; then `git restore tsconfig.app.tsbuildinfo`).
- Respect reduced motion: no entrance animations; existing transition classes only.
- Report files + line ranges + any deviation with one-line justification.

## MUST NOT
- Touch files outside the write set. No new dependencies. No refactor of existing timeline rendering beyond the interleave. Do not spawn subagents.

## WRITE SET
`src/components/orders/ParcelTrackingDialog.tsx`, `src/components/orders/ParcelChangeDemandDialog.tsx`.

## OUTPUT FORMAT
First line `DONE`/`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`; changes with file:line; tsc tail; deviations.
