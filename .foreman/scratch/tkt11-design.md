# TKT-11 — Page-permission system + Users-page modal unification (design, LEAD, 2026-07-29)

## Verified ground truth
- `users.permissions = { pages: Record<path,boolean> }` — written at admin invite only, read NOWHERE (Sidebar static array; ProtectedRoute role-only; useCurrentProfile omits the column). ZERO role='admin' users live today → enforcement ships with no lockout risk.
- USER_PAGES (34) is missing 9 real admin pages: /whatsapp/{conversations,numbers,assignment,contacts}, /google-analytics, /meta-ads, /sheet-review, /recurring-charges, /trash. /profile must stay always-accessible (never gated).

## Permission model (v1 = this build; shape = ground for the company epic)
```
permissions = {
  pages: { [routePath]: boolean },   // v1, enforced
  // caps: { [capability]: boolean } // RESERVED — company-role entitlements land here;
}                                     // company template ∩ user map = effective rights.
```
- **Semantics:** absent map OR absent key = ALLOWED; explicit `false` = DENIED. Rationale: new pages shipped later appear for existing admins automatically (ops continuity); explicit denial always wins; with zero live admins there is no migration risk either way, so the choice is purely forward-looking.
- **Scope v1:** enforced for role `admin` ONLY. super admin / business owner / owner are structurally exempt (never filtered). Per-role matrix beyond admin (optional SA page-restriction, seller/courier/MB portal toggles) = designed extension points, deliberately NOT built until asked.
- **Honest boundary:** page-gating controls the APP SURFACE (sidebar + navigation). The DATA boundary is and remains RLS (tenant+role scoped, already hardened). No claim of API-level enforcement from page flags.

## Enforcement architecture (3 pieces, one data source)
1. `useCurrentProfile` gains the `permissions` column — single cached profile query feeds everything; zero new queries.
2. **Sidebar**: filter items for role==='admin' by `pages[path] !== false` (longest-prefix match for sub-paths); section groups with zero visible children disappear; /profile and logout always visible.
3. **Route gate**: `PagePermissionGate` (new, wraps the admin layout's Outlet or each admin route via a single wrapper in App.tsx): role==='admin' && denied(path) → <Navigate> to the first allowed page; ZERO allowed pages → dedicated French screen « Aucune page autorisée — contactez votre administrateur. ». Non-admin roles: pass-through, zero cost.
4. Route matching contract: registry keys are route base paths; match = exact OR longest registry key that prefix-matches the current pathname (so /campaigns/xyz inherits /campaigns).

## Page registry (single source of truth)
- USER_PAGES (src/lib/invitations.ts) regenerated to cover ALL 43 admin pages (34 + 9 missing), grouped for the UI (the grids group by section like the sidebar). Every consumer (InviteUserWizard grid, DirectCreateUserDialog grid, UserModal permissions tab, Sidebar filter, PagePermissionGate) reads THIS list. /profile intentionally excluded from the registry (always allowed).
- Creation/edit defaults flip to ALL-CHECKED + « au moins une page » validation (all-unchecked + enforcement = bricked admin trap).

## Modal design unification
Await scout 2's deviation table; polish worker unifies all Users-page dialogs on the house anatomy (OrdersExportWizard shell: hairline, icon tile, kicker, font-display/serif header, ant tokens, pill buttons, rounded-xl option cards, complete states, French copy) — separate ticket, zero logic changes.

## Company-epic landing contract (documented, not built)
- Company account restriction template = same `{pages, caps}` shape at company level; effective user rights = company template ∩ user permissions (false wins). Entitlement engine (epic pass 3) evaluates the intersection; v1's gate/filter code reads one resolved map — refactor cost near zero.
