# TICKET F5 — role-based access config in direct-create + full BO edit modal

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), complete the BO management UI: (A) role-conditional access/config sections in `src/components/users/DirectCreateUserDialog.tsx`, (B) open and extend the edit modal (`UserModal` in `src/pages/admin/Users.tsx`) for business-owner viewers across ALL roles with identity + access editing. Backend needs NO changes — manage-users 'create' passes config keys through (`rest` → insert; ga/meta/whatsapp via helpers) and 'update' accepts identity via rest + email through its authUpdates path.

## GROUND FACTS (verified)
Per-role config contract (mirror the invite wizard's buildPayload EXACTLY — InviteUserWizard.tsx:160-178):
- super admin / business owner → none (show a quiet note « Accès illimité à l'entreprise. »)
- admin → `permissions: { pages: Record<path, boolean> }` — checkbox grid over `USER_PAGES` (src/lib/invitations.ts:206-241, 33 pages; match the wizard's default checked-state convention — read it)
- commercial → `commission_price, commission_basis, payment_type, salary_amount, products` (products multi-select with search — reuse the UserModal performance-tab patterns)
- courier → `phone, courier_parcel_fragile, courier_parcel_open, courier_parcel_try_on` (3 switches + phone input)
- mediabuyer → `payment_type (commission|salary), commission_price OR salary_amount, ga_access {mode, ids}, meta_access {mode, ids}` — reuse `IntegrationAccessField` (Users.tsx:148-226) + the exact conns queries (google_analytics_connections / meta_ads_connections — Users.tsx:1154, 1164), gated so they fire only when the dialog is open AND role === 'mediabuyer'.

## PART A — DirectCreateUserDialog
- Below the Rôle select, render the matching config section (switching live with role selection; state resets on role change where fields don't carry over). Submit payload = identity keys + password + role + the role's config keys at the top level of `userData` (same shape the wizard emits — e.g. `permissions`, `ga_access`, NOT nested further).
- Keep the dialog scrollable (`max-h`, ant-scroll) — with the admin grid it gets tall. French labels matching the wizard's copy. Validation: keep existing identity/password rules; commercial/mediabuyer numeric fields non-negative; no config = valid for the no-config roles.

## PART B — UserModal for BO viewers
- `canEdit` becomes `hasEditableConfig(user.role) || isBO` (UserCard gating — Users.tsx ~:1045 and wherever the menu item renders).
- UserModal receives `isBO` (and the viewer's ASSIGNABLE_ROLES). When isBO:
  1. **Identity section** (new, first): Nom, Nom d'utilisateur, Email — editable; submitted via userData (`name`, `username`, `email` — email flows the server's authUpdates path). Keep the existing « identity read-only » behavior for non-BO viewers (comment at ~:1295 — that rule now applies only to non-BO).
  2. **Role select**: for isBO offer all six tenant roles (ASSIGNABLE_ROLES); non-BO unchanged.
  3. **Tabs for all roles**: admin→permissions (existing), commercial→performance (existing), mediabuyer→payment+integrations (existing), courier→NEW courier tab (phone + 3 switches, keys as in Part A), super admin/business owner→identity only (no config tab; show the « Accès illimité » note).
  4. Mutation payload extends with the identity keys + courier keys when present. Preserve the existing ga/meta sanitize-to-none-if-not-mediabuyer logic.
- Do NOT add password editing here (SetPasswordDialog owns that).
- The dialog must handle a role CHANGE inside the modal for isBO (e.g. courier→commercial shows commercial config; on save both role and config submit together — server accepts). Guard rails: switching role resets the config section to that role's defaults.

## VERIFY BEFORE REPORTING
- `npx tsc -b` exit 0; `git restore tsconfig.app.tsbuildinfo`.
- `git status --porcelain -- src/` — only the two files (plus any import-only touches you must report).

## MUST NOT
Touch supabase/**. New deps. Spawn subagents. Break non-BO viewer behavior (their modal must render byte-identically to today).

## WRITE SET
`src/components/users/DirectCreateUserDialog.tsx`, `src/pages/admin/Users.tsx`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-file changes file:line; tsc tail; deviations with justification.
