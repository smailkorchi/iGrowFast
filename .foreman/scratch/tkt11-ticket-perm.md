# TICKET P1 — admin page-permissions: complete registry + real enforcement

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), implement the page-permission system per `.foreman/scratch/tkt11-design.md` (READ IT FIRST — it is the contract). Security-sensitive: follow it exactly.

## PARTS
1. **Registry** (`src/lib/invitations.ts` USER_PAGES): regenerate to cover ALL 43 admin pages — the existing 34 plus: `/whatsapp/conversations` (WhatsApp — Inbox), `/whatsapp/numbers` (WhatsApp — Numéros), `/whatsapp/assignment` (WhatsApp — Assignation), `/whatsapp/contacts` (WhatsApp — Contacts), `/google-analytics` (Google Analytics), `/meta-ads` (Meta Ads), `/sheet-review` (Leads Review), `/recurring-charges` (Charges récurrentes), `/trash` (Corbeille). Add a `group` field to every entry mirroring the sidebar's section grouping (read src/components/layout/Sidebar.tsx:72-192 for the canonical grouping; ungrouped items get a sensible group). Do NOT add `/profile` (always accessible, never gated). Keep the export shape backward-compatible (existing consumers destructure label/path — additive field only).
2. **Shared helper** (`src/lib/permissions.ts`, new): `isPageAllowed(pathname: string, pages: Record<string, boolean> | null | undefined): boolean` — absent map/key ⇒ true; longest registry-key prefix match of pathname (exact wins; `/business/payments` must match its own key, not `/business`); explicit false ⇒ denied. Also `firstAllowedPath(pages)` (registry order). Unit-testable pure functions; include a compact set of inline test cases in a comment block.
3. **Profile fetch** (`src/hooks/useCurrentProfile.ts`): add `permissions` to the selected columns and the type.
4. **Sidebar** (`src/components/layout/Sidebar.tsx`): when `profile.role === 'admin'`, filter nav items via `isPageAllowed(item.path, profile.permissions?.pages)`; a section whose children are ALL hidden renders nothing (no empty headers); non-admin roles render exactly as today (zero-diff path). /profile + logout always visible.
5. **Route enforcement** (`src/components/auth/ProtectedRoute.tsx`): extend its existing profile fetch with `permissions`; when the resolved role is 'admin' AND `!isPageAllowed(location.pathname, permissions?.pages)` → `<Navigate to={firstAllowedPath(...)} replace />`; when the admin has ZERO allowed registry pages → render a minimal French screen (house tokens): « Aucune page autorisée » / « Contactez votre administrateur pour obtenir l'accès. » with the logout affordance the app already uses in its inactive-account state (mirror that pattern — read the file). Non-admin roles: logic untouched.
6. **Grid defaults** (InviteUserWizard admin step, DirectCreateUserDialog admin section, UserModal permissions tab): (a) all consume the regenerated registry INCLUDING rendering by `group` (grouped checkbox grid with per-group « Tout » toggle — mirror the grouping UX of OrdersExportWizard's field groups, src/components/orders/OrdersExportWizard.tsx:578-625); (b) NEW-user defaults flip to ALL-CHECKED; (c) submit validation: at least one page checked for role admin (French error). Existing users' stored maps load as-is (absent keys render CHECKED per the default-allow semantics — make the checkbox state `pages[path] !== false`).

## VERIFY BEFORE REPORTING
- `npx tsc -b` exit 0 (then restore tsconfig.app.tsbuildinfo).
- State the longest-prefix test results for: `/business/payments` with `{'/business': true, '/business/payments': false}` (→ denied), `/campaigns/abc` with `{'/campaigns': false}` (→ denied), `/orders` with `{}` (→ allowed), non-admin any (→ allowed).
- `git status --porcelain -- src/` lists only the write set.

## MUST NOT
Touch supabase/**. Change non-admin behavior anywhere. Gate /profile. Spawn subagents.

## WRITE SET
`src/lib/invitations.ts`, `src/lib/permissions.ts` (new), `src/hooks/useCurrentProfile.ts`, `src/components/layout/Sidebar.tsx`, `src/components/auth/ProtectedRoute.tsx`, `src/components/users/InviteUserWizard.tsx`, `src/components/users/DirectCreateUserDialog.tsx`, `src/pages/admin/Users.tsx` (permissions tab only — a later polish pass owns dialog visuals; keep your Users.tsx diff minimal).

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-part file:line; the four prefix-test results; tsc tail; deviations.
