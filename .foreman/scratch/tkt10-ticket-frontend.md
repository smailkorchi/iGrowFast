# TICKET FE — business owner role: frontend parity + badge + assignment

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), implement the frontend side of the `business owner` role. READ `.foreman/scratch/tkt10-inventory.md` FIRST — decisions + the FRONTEND site list. Verify each site by reading the file (line numbers approximate).

## RULES
1. **Types**: hand-patch `src/lib/database.types.ts` — add `"business owner"` to the `user_role` union (~:5134) AND the Constants export array (~:5268). (The enum exists in a migration; types regen later will match.)
2. **Guards parity**: every privilege check involving `'super admin'` also passes for `'business owner'` — App.tsx `allowedRoles` arrays (route guards; sweep the whole file), plus any conditional rendering/permission helpers your sweep finds (`grep -rn "'super admin'" src/`). Judgment rule: privilege/visibility checks → extend; role-ASSIGNMENT option lists → do NOT extend.
3. **Badge**: `src/pages/admin/Users.tsx` ROLE_META (~:304-367) gains a `'business owner'` entry — label `Business owner`, plural `Business owners`, a Crown-family lucide icon visually distinct from super admin's (e.g. `Gem` or `ShieldCheck` — pick what reads premium next to the existing set), pill colors distinct but in the page's existing palette system. The badge must render wherever ROLE_META drives display.
4. **Not assignable**: Users.tsx form z.enum (~:113) UNCHANGED (business owner cannot be chosen in add/edit); `hasEditableConfig`/EDITABLE_ROLES — business owner behaves like super admin (no editable page-config). If the edit dialog can open on a business-owner user, role field must be locked/hidden for non-owner viewers — follow the page's existing permission patterns; simplest compliant behavior is acceptable (e.g. role select disabled with a hint « Rôle protégé »).
5. **Assignment at creation**: `src/pages/owner/Businesses.tsx` createAdminMutation (~:340-361) — the first admin's role becomes `'business owner'` (line ~345). Update any adjacent copy that says the first user is a "super admin".
6. **InviteUserWizard** ROLES array + `src/lib/invitations.ts` InviteRole: UNCHANGED (not invitable).
7. Owner dashboard user lists (if any render role labels outside ROLE_META) — sweep and cover.

## VERIFY BEFORE REPORTING
- `npx tsc -b` from repo root exits 0; then `git restore tsconfig.app.tsbuildinfo`.
- `grep -rn "'super admin'" src/` — list every remaining site you did NOT edit with a one-line reason.
- `git status --porcelain -- src/` shows only your files.

## MUST NOT
Touch supabase/** (siblings own it). Spawn subagents. No refactors beyond the rules.

## WRITE SET
`src/**` files named above + any additional role-check sites your sweep finds (report each).

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-file edits; unedited-sites list with reasons; tsc tail; concerns.
