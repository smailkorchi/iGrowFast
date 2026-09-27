# 11. Security, Privacy, and Access Control

> Classification: **Confidential — investor diligence material.** This chapter describes control surfaces and residual risk. It is not a certification, penetration-test attestation, or guarantee of security.

## Investor significance

iGrowFast handles tenant-scoped operational, commercial, identity, financial, and communications data. The central diligence question is therefore not whether the product has a login screen, but whether authorization is enforced below the interface and whether privileged paths are narrow enough to review.

The evidence shows a materially developed control model: row-level security (RLS), database-backed role checks, tenant-bound policies and functions, restricted operational endpoints, private Realtime channels, storage path controls, and a history of adversarial remediation. It also shows a large privileged SQL surface, residual service-schema grants to the anonymous role, and unresolved production dependency advisories that require continuing review. No compliance certification is claimed.

## What exists

- **Live-verified, 2026-08-24:** RLS was enabled on 131 of 157 non-system relations. No RLS-disabled table was found in the `public`, `whatsapp`, or `storage` schemas. The live database exposed 280 policies.
- **Live-verified:** the database held 109 `public` and 133 `whatsapp` `SECURITY DEFINER` functions: **242 privileged functions in total**. This is meaningful capability and a meaningful review burden.
- **Live-verified, 2026-08-24:** the anonymous role holds **zero table privileges in the `public` and `whatsapp` application schemas**. Every application table is therefore unreachable by an unauthenticated database role regardless of policy, which is the outcome the 2026-07-03 remediation programme set out to achieve.
- **Live-verified:** the anonymous role's remaining **46 explicit table-privilege rows across 14 tables** are confined to Supabase service schemas: five rows across three `realtime` tables, 27 rows across nine `storage` tables, and 14 rows across two `supabase_functions` tables. The figure of 27 cited in earlier internal notes was the `storage` subset only. A grant row does not prove effective row exposure, and effective access was not exhaustively tested.
- **Live-verified:** the legacy Realtime publication contained zero tables; the broadcast publication contained seven. This reduces dependence on broad table-change publication for the captured configuration.
- **Repository-verified:** authorization migrations revoke anonymous and public execution from privileged functions, bind administrative RPCs to the caller's tenant, protect payout operations, and add storage role/path constraints.
- **Repository-verified:** the user lifecycle uses checked hard deletion for unreferenced identities and an archive path for identities with operational history. Archived identities are terminally inactive at the database layer, and destructive helpers are service-role-only.
- **Repository-verified:** storage policies constrain new writes by role, user, and tenant path; upload limits and MIME allow-lists are recorded in migrations. Scheduled storage janitors use quarantine before delayed purge.
- **Historical:** the July 2026 security audit found serious authorization defects, including unauthenticated privileged functions, column-blind self-updates, tenant-unbound RPCs, and money-ledger write paths. The remediation record, subsequent migrations, and ledger show that these findings drove concrete controls. Historical findings are not presented as current defects unless the live capture corroborates them.
- **Repository verification, 2026-08-23:** the root production dependency audit reported one high and two moderate advisories. The high advisory affects direct `pdfjs-dist` versions `>=5.6.83 <6.2.108` and permits arbitrary JavaScript execution when a malicious PDF is opened; the reported direct fix is 6.2.108, a semver-major update. Moderate React Router/React Router DOM open-redirect, XSS, and related advisories have fixes available.
- **Repository verification, 2026-08-23:** the `site/` production dependency audit reported four high, one moderate, and one low advisory. Direct Astro advisories include XSS and SSRF; transitive high advisories affect `js-yaml`, `nanoid`, and `sharp`. Astro 7.2.4 is reported as an available semver-major fix.

## Controls and operating model

### Identity and authorization

- Roles and tenant membership are read from database records keyed to the authenticated subject, rather than trusted from user-editable profile metadata.
- RLS is the primary row-isolation layer. Privileged RPCs add explicit role and tenant checks because `SECURITY DEFINER` code can bypass ordinary RLS behavior.
- Sensitive operational functions revoke execution from `PUBLIC` and `anon`; internal cron and service flows retain only their required execution path.
- Administrative user management validates the caller and enforces tenant scope in server-side code. Repository and historical evidence support this control; this chapter does not claim a fresh endpoint penetration test on 2026-08-24.
- Backup operations are separately gated: the repository requires an active backup administrator, and state-changing triggers require an AAL2 session. The agent records an audit trail and constrains browser origin access.

### Tenant and financial integrity

- Repository migrations bind reporting, imports, payout, deletion, and business-management functions to the caller's business.
- Financial and attribution fields are protected through a combination of role-specific policies, column restrictions, function guards, and triggers.
- A dedicated database role exists for media-buyer access. This narrows the data surface below the frontend role model.
- User deletion is reference-aware and atomic. Operationally load-bearing identities are archived, preserving ledgers and historical attribution instead of relying on cascading deletion.

### Privacy and storage

- Tenant-scoped storage paths and `USING` plus `WITH CHECK` policy pairs protect both the old and new names of update operations.
- Image buckets have recorded server-side size and type constraints; frontend compression is a delivery optimization, not treated as the security boundary.
- Garbage collection defaults to report/quarantine behavior and refuses to purge unresolved references. This reflects a preservation-first model for customer and legal-document assets.
- The dossier contains no customer rows, credentials, secret values, infrastructure addresses, or private host identifiers.

## Current evidence status

| Claim | Status | Meaning |
|---|---|---|
| RLS coverage and policy count | Live-verified | Observed from the production database during the accepted read-only capture. |
| 242 `SECURITY DEFINER` functions | Live-verified | Current privileged surface count; function-by-function safety was not re-audited in this dossier. |
| Zero anonymous privileges on `public` and `whatsapp` tables | Live-verified | Application schemas fully revoked for the anonymous role. |
| 46 anonymous table-privilege rows across 14 service-schema tables | Live-verified | Five `realtime`, 27 `storage`, and 14 `supabase_functions` grant rows; effective row access was not exhaustively tested. |
| Production dependency advisories | Repository verification, 2026-08-23 | Root: one high and two moderate; `site/`: four high, one moderate, and one low. No remediation or exploited compromise is claimed. |
| Tenant-bound RPC and storage controls | Repository-verified; historically exercised | Implemented in migrations and recorded in prior negative batteries. Current live body parity was not exhaustively diffed here. |
| User archive and checked deletion | Repository-verified; historically live-verified | Migration and ledger record atomic negative tests. No fresh destructive test was run for this dossier. |
| Cloud edge rate limits and Access rules | Unverified | Dashboard-side policy state was not inspected in the live capture. |
| Secret rotation posture | Unverified | No credential stores or secret values were accessed. |

## Risks and limitations

1. **Privileged-function review burden.** The 242 `SECURITY DEFINER` functions are the largest concentrated authorization surface. Ownership, `search_path`, grants, null-caller behavior, tenant binding, and call graph should be continuously inventoried and regression-tested.
2. **Residual service-schema grants.** The 46 anonymous table-privilege rows across 14 `realtime`, `storage`, and `supabase_functions` tables require a justified allow-list. Grant rows do not establish effective row exposure, which was not exhaustively tested, but unnecessary privileges weaken defense in depth.
3. **Historical remediation is not a current penetration test.** The repository shows the fixes and the live capture shows broad RLS coverage; neither substitutes for recurring adversarial testing of every endpoint and function.
4. **Dependency and automated-test gap.** Both production dependency audits retain high-severity advisories, and `npm test` exits 1 because no test files are present. These are unresolved risks, not evidence of an exploited compromise. Historical negative batteries provide evidence for specific changes, but they are not a durable automated regression suite.
5. **Policy state outside the database.** Edge DNS, tunnel, and Access state were verified directly on 2026-08-24, including a live enforcement check against an administrative hostname. Two items remain: zone-level firewall and rate-limiting rules were not separately enumerated, and several edge hardening defaults sit below the architecture's intent — minimum TLS 1.0, origin validation not full-strict, Always Use HTTPS off, and no HSTS header.
6. **No certification claim.** The evidence supports engineering controls, not ISO 27001, SOC 2, PCI DSS, GDPR compliance, or any other certification or legal conclusion.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Security review and remediation history: `docs/MASTER_TODO.md`, `.foreman/ledger.md`
- Core remediation migrations: `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql`, `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql`
- Privileged-function hardening examples: `supabase/migrations/20260629140000_secure_delete_business_owner_guard.sql` through `20260629230000_revoke_anon_remaining_secdef_rpcs.sql`
- User lifecycle control: `supabase/migrations/20260730100000_user_archive.sql`
- Storage hardening: `supabase/migrations/20260804100000_storage_policy_hardening.sql` through `20260804130000_storage_update_policies.sql`
- Historical implementation and negative-test record: `.foreman/ledger.md`
