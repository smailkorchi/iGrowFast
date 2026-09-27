# Users, roles, and governance

## Investor significance

Commerce operations become difficult to scale when every employee sees the same data and performs the same actions. iGrowFast's role model turns one platform into separate working environments for platform governance, tenant management, sales, delivery, and acquisition. This is material product value: it lets a business add collaborators without giving each collaborator unrestricted access to customers, money, integrations, or other businesses.

The stronger engineering point is that role separation is not limited to different menus. The repository implements route gates, page entitlements, invitation-time resource scopes, tenant-bound database policies, and guarded server operations. This layered model supports operational delegation while keeping platform-owner authority distinct from each business's internal authority.

## What exists

| Role boundary | Primary workspace | Concrete authority represented in source |
| --- | --- | --- |
| Platform owner | `/owner/*` | Businesses, plans, platform payments, users, service status, geography, configuration, email templates, backups, and profile |
| Business owner | Business administration | Full management inside the assigned business, including peer business-owner management subject to database safeguards |
| Super admin | Business administration | Broad tenant administration across operations, collaborators, finance, analytics, and integrations |
| Admin | Business administration | Administratively useful subset controlled by an explicit page-permission map |
| Commercial | `/seller/*` | Own sales workflow, orders, products, notes, wallet, payouts, requests, statistics, and assignment-scoped WhatsApp |
| Courier | `/courier/*` | Assigned delivery work, payment visibility, and profile |
| Media buyer | `/mediabuyer/*` | Campaigns, attributed orders, advertising records, payouts, requests, statistics, and assigned analytics/ad accounts |

The user-administration surface includes invitations, expiry and revocation states, direct role selection, admin page entitlements, WhatsApp-number access, and media-buyer access to selected Google Analytics properties and Meta ad accounts.

## How it works

Authentication establishes the user session. `ProtectedRoute` then loads the current profile, blocks inactive accounts, and checks that the role matches the requested route tree. A business guard resolves the active business context and blocks access when that business is not active.

For the `admin` role, a shared page registry drives the invitation editor, user-permission editor, sidebar, and route gate. Explicit denial hides the page and blocks direct URL access; the registry also maps legacy aliases so an older path cannot bypass a newer permission. If every registered page is denied, the user receives a terminal no-access screen instead of a redirect loop. Super admins and business owners are intentionally outside this page-level filter.

Invitation consumption is a server-side workflow. It verifies the invitation and registration challenge, atomically claims the single-use invitation, creates the account and business-bound profile, then applies role-specific resource scopes. Commercial access can be all WhatsApp numbers or an explicit set. Media-buyer access can be all or selected analytics properties and ad accounts. The business identity comes from the invitation rather than a client-supplied tenant choice.

At the database layer, policies and helper functions bind reads and writes to the authenticated user's business and role. A dedicated media-buyer database role uses deny-by-default grants and scoped policies. Business-owner protections allow multiple owners in one business but serialize changes that could remove the last business owner. Platform owner remains a separate authority rather than a more powerful tenant user.

## Controls/reliability

The control model has four layers:

1. **Account state:** inactive users are signed out and local business context is cleared.
2. **Workspace boundary:** route trees admit only their named roles; platform-owner routes and tenant-admin routes are separate.
3. **Entitlement boundary:** admin page permissions and invitation-time integration scopes limit what a collaborator can reach.
4. **Data boundary:** RLS, column grants, triggers, and guarded functions restrict tenant and privileged operations even if a user bypasses the visible navigation.

The live read-only audit found 280 policies and no RLS-disabled tables in the public, WhatsApp, or storage schemas. Current migrations also protect privileged user fields, tenant-bound administrative operations, and business-owner continuity. These controls reduce accidental or malicious cross-role actions, but they still require ongoing review because the backend contains many privileged functions.

## Current evidence status

- **Live verified on 2026-08-24:** RLS coverage and policy inventory were inspected directly; authentication services were healthy at capture time.
- **Repository verified:** role route trees, inactive-account handling, admin page gates, the shared page registry, invitation states, single-use consumption, WhatsApp-number scoping, analytics-property scoping, ad-account scoping, dedicated media-buyer grants, and business-owner safeguards exist in current source or migrations.
- **Historical record:** prior remediation records describe caller authorization, privileged-column protection, tenant-bound RPCs, archived-user rejection, and cross-tenant negative checks. They are supporting history, not a substitute for a fresh control test.
- **Unverified:** this audit did not create test identities or run a live role-by-role authorization battery. It did not establish enterprise SSO, formal access-review certification, or an independent compliance attestation.

## Risks/limitations

Frontend gates improve usability but are not security boundaries; the database and server functions must remain authoritative. The current permission map applies to the `admin` role only, so changing which roles should receive granular page controls would require an explicit product decision and control update.

The live audit counted 109 public and 133 WhatsApp `SECURITY DEFINER` functions, a large privileged surface. It also found 46 anonymous table-privilege rows across 14 tables, all in service schemas: five rows across three `realtime` tables, 27 across nine `storage` tables, and 14 across two `supabase_functions` tables. The earlier 27 count was storage-only. Grant rows do not establish effective row exposure, and effective access was not exhaustively tested. Invitation and role workflows are implemented, but no automated repository test suite was found, and this dossier does not claim that every role/route combination was re-exercised live.

## Evidence trail

- Role-specific route trees and business guard: [src/App.tsx](../../src/App.tsx)
- Account, role, and page gate: [src/components/auth/ProtectedRoute.tsx](../../src/components/auth/ProtectedRoute.tsx)
- Permission resolution and alias handling: [src/lib/permissions.ts](../../src/lib/permissions.ts)
- Invitation model and page registry: [src/lib/invitations.ts](../../src/lib/invitations.ts)
- Invitation administration: [src/components/users/InvitationsPanel.tsx](../../src/components/users/InvitationsPanel.tsx)
- Server-side invitation consumption and scoped access: [supabase/functions/consume-invitation/index.ts](../../supabase/functions/consume-invitation/index.ts)
- Dedicated media-buyer database role: [supabase/migrations/20260717110000_mediabuyer_role.sql](../../supabase/migrations/20260717110000_mediabuyer_role.sql)
- Business-owner continuity safeguards: [supabase/migrations/20260729180000_business_owner_multiplicity.sql](../../supabase/migrations/20260729180000_business_owner_multiplicity.sql)
- Current control inventory: [docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md](17-current-evidence-snapshot-2026-08-24.md)
