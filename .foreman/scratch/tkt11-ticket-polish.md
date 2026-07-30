# TICKET P2 — Users-page modal design unification (visual only, ZERO logic changes)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), unify every Users-page dialog on the house anatomy. The exemplar is `src/components/orders/OrdersExportWizard.tsx:500-560`; `InviteUserWizard` already matches it — treat those two as the reference pair and touch NEITHER's anatomy. Full deviation audit (read it): the section below. Every change is presentational; behavior, payloads, handlers, validation stay byte-identical.

## THE STANDARD (apply to every subject)
- DialogContent: `p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col` (+ each dialog's existing max-w).
- 3px gradient hairline at top: `bg-gradient-to-r from-<hue> via-<hue>/60 to-transparent` — hue = ant-orange by default; DESTRUCTIVE/contextual dialogs keep their semantic hue (delete → ant-rose; suspend → ant-rose, reactivate → ant-green) as a GRADIENT, never a solid bar.
- Header: `w-11 h-11 rounded-2xl bg-ant-ink text-white` icon tile (pick a fitting lucide icon per dialog: edit → PencilLine, direct-create → UserPlus, change-role → ShieldCheck, set-password → KeyRound, chooser → UserPlus, delete → Trash2 on a bg-ant-rose tile, suspend → Ban/CircleCheck contextual tile, email-prompt → Mail). UserModal: keep the UserAvatar (it is meaningful identity context) but bring every other header element to standard.
- Kicker: `text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid` + 1.5 dot in the dialog's hue. Title: `font-display text-[20px] leading-tight tracking-tight text-ant-ink`. Description: `font-serif italic text-[12.5px] text-ant-mid`.
- Body: `ant-scroll flex-1 min-h-0 overflow-y-auto` where content can grow.
- Footer: bordered, pill buttons (existing button styles are fine — align paddings/heights with the exemplar's h-10 rounded-full pattern where they deviate).
- Add-flow chooser option cards → the house radio-card pattern (`role="radio"`, selected `border-ant-ink bg-ant-ink/5`, focus-visible ring) with keyboard selection then Continue, OR keep click-to-go buttons but with the exemplar card styling + focus rings — pick the simpler that preserves current one-click UX (justify in report).
- FRENCH everywhere: ChangeRoleDialog, SetPasswordDialog, Delete, Suspend titles/copy currently English → French; UserModal tab labels → French (« Accès aux pages », « Performance », « Paiement », « Intégrations », « Livraison » for courier). Match existing French tone (sentence case, « » quotes).

## SUBJECTS (from the audit)
1. UserModal (Users.tsx ~:1350) — hairline missing, radius/shadow drift, description size.
2. DirectCreateUserDialog — hairline + icon tile missing, radius/shadow.
3. ChangeRoleDialog + 4. SetPasswordDialog — hairline/tile/flex-col/max-h missing, English copy.
5. Add-flow chooser (Users.tsx ~:908) — hairline/tile/structure, option-card styling.
6. Delete confirmation (Users.tsx ~:819) — structure + rose GRADIENT hairline + rose tile.
7. Suspend/Reactivate (Users.tsx ~:853) — solid hairline → contextual gradient, tile, structure.
8. InvitationsPanel EmailPromptDialog — solid hairline → gradient, title 18→20px, tile, structure, kicker tracking 0.24→0.28em.

## VERIFY BEFORE REPORTING
- `npx tsc -b` exit 0 (restore tsconfig.app.tsbuildinfo).
- Explicitly confirm ZERO logic diffs: for each file, state that handlers/payloads/conditions are untouched (the diff should be className/JSX-structure/copy only — any non-visual line must be called out and justified).
- `git status --porcelain -- src/` = write set only.

## MUST NOT
Touch behavior, InviteUserWizard's anatomy, OrdersExportWizard, supabase/**. Spawn subagents.

## WRITE SET
`src/pages/admin/Users.tsx`, `src/components/users/DirectCreateUserDialog.tsx`, `src/components/users/ChangeRoleDialog.tsx`, `src/components/users/SetPasswordDialog.tsx`, `src/components/users/InvitationsPanel.tsx`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-dialog changes; the zero-logic-diff attestation per file; tsc tail.
