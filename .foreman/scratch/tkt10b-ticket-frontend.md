# TICKET F4 — business-owner management powers, UI

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), give business-owner viewers their management UI in the admin Users page. House design: ant tokens, dialog anatomy like the existing modals in this page, French copy, states complete (loading/error/success/disabled), no side-stripe borders, 150-250ms transitions, reduced-motion safe.

LOCKED DECISIONS: multiple BOs per business; BO manages ANY user in his business incl. other BOs; direct creation = full identity + password typed by the BO, account pre-confirmed (backend `manage-users` action 'create' ALREADY supports this — password + email_confirm:true — it just has no UI); invitation flow stays as the alternate path and gains a 'business owner' tile for BO viewers; direct password set via NEW manage-users action `set_password` (payload {user_id, new_password}); role changes via manage-users 'update' with {role}. Server enforces the last-BO rule — surface its French error verbatim.

## EXPECTED OUTCOME (all in `src/pages/admin/Users.tsx` + `src/components/users/`)
1. **Viewer role**: Users.tsx learns the viewer's role (small `useQuery` on own `users.role` by auth uid, staleTime long). `const isBO = viewerRole === 'business owner'`.
2. **Add-user flow**: for BO viewers the Add button opens a two-option chooser (house option-card pattern): « Créer directement » → new `DirectCreateUserDialog`; « Envoyer une invitation » → the existing InviteUserWizard. Non-BO viewers: unchanged (wizard directly).
3. **NEW `src/components/users/DirectCreateUserDialog.tsx`**: fields Nom, Nom d'utilisateur, Email, Mot de passe (with a « Générer » button producing a strong random password + copy affordance, and a show/hide toggle), Rôle (Select over ALL six roles INCLUDING 'business owner' — labels from the page's ROLE_META). Validation: all required, email format, password ≥8. Submit → manage-users `action:'create'` with `{ email, password, name, username, role }` (business is server-scoped). Success → toast « Utilisateur créé — identifiants actifs immédiatement », invalidate the page's users query. Error → server message verbatim (destructive toast or inline panel). Note under the password field: « Aucun email de confirmation ne sera envoyé — transmettez les identifiants vous-même. »
4. **Row actions (BO viewers only, on every user row)**: two new DropdownMenuItems styled like siblings:
   - « Changer le rôle » → new `ChangeRoleDialog`: shows the user's current role badge, a Select of all six roles, confirm button; submits manage-users `action:'update'` with `{ role }` (plus whatever minimal payload shape the update action requires — read the existing edit mutation to match). Handles the last-BO French error verbatim.
   - « Définir le mot de passe » → new `SetPasswordDialog`: new password + confirmation fields (≥8, match), « Générer » + show/hide like the create dialog; submits manage-users `action:'set_password'` `{ user_id, new_password }`. Success toast « Mot de passe mis à jour ».
   Non-BO viewers see neither item. Existing items (Edit/Disable/Send link/Delete) unchanged in rendering — server now authorizes BO on protected targets.
5. **InviteUserWizard**: accepts a new optional prop (e.g. `allowBusinessOwner`) — when true, a 6th tile 'business owner' (label `Business owner`, desc `Contrôle total de l'entreprise — gère tous les utilisateurs.`, Gem icon, styling consistent with the tile system; `buildPayload` treats it like 'super admin': `return base`). Users.tsx passes `allowBusinessOwner={isBO}`.
6. All new queries/mutations follow the page's react-query + useToast patterns; dialogs gated so no query fires while closed.

## VERIFY BEFORE REPORTING
- `npx tsc -b` exit 0; then `git restore tsconfig.app.tsbuildinfo`.
- `git status --porcelain -- src/` — only your files.

## MUST NOT
Touch supabase/** (sibling worker). No new dependencies (use existing crypto for password gen — `crypto.getRandomValues`). Spawn subagents.

## WRITE SET
`src/pages/admin/Users.tsx`, `src/components/users/DirectCreateUserDialog.tsx` (new), `src/components/users/ChangeRoleDialog.tsx` (new), `src/components/users/SetPasswordDialog.tsx` (new), `src/components/users/InviteUserWizard.tsx`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-file changes; tsc tail; deviations with justification.
