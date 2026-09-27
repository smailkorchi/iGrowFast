# 16. Audit Methodology and Evidence

> Classification: **Confidential — investor diligence material.** This chapter explains how claims were classified. It is not an independent audit opinion or a certification report.

## Investor significance

Technology diligence becomes misleading when source code, work logs, and live state are blended into one narrative. This dossier uses an explicit evidence hierarchy so an investor can distinguish what was observed in the running estate, what exists in source, what was recorded historically, and what remains unverified.

The method favors reproducible evidence and candid boundaries over completeness theater. Counts are disclosed with their scope, historical defects are not hidden, and missing verification is kept open rather than inferred from design documents.

## What exists

### Evidence classes

| Label | Definition | Permitted claim |
|---|---|---|
| **Live-verified** | Observed in an accepted read-only systems capture — 2026-08-23, or the 2026-08-24 gap-closure pass, which supersedes where the two differ | The fact was true during the capture window, within the query's scope. |
| **Repository-verified** | Confirmed in tracked source, migrations, workflows, or operations files | The implementation or declared configuration exists in the repository. Deployment is not implied. |
| **Historical** | Supported by git history, dated audits, runbooks, planning records, or the append-only engineering ledger | The event, decision, test, or prior state was recorded. Current state is not implied. |
| **Unverified** | Relevant but not directly observed, or evidence was intentionally excluded | No positive or negative operational conclusion is drawn. |
| **Planned** | Scope stated by the platform owner on a recorded date, with no implementation claimed | Direction is committed; the capability does not exist yet. Used only in chapter 20. |

### Evidence set used

- A repository map counted routes, source trees, migrations, edge functions, operations files, workflows, and test-file patterns. Repository head was unchanged between the two live passes, so these counts remain current.
- A second live pass on 2026-08-24 closed the three areas the first pass could not reach, using direct access to the WhatsApp node, the edge provider's management API, and read-only object-store credentials. It also re-measured every volatile live figure so one capture date covers the live evidence set.
- A historical map synthesized dated audits, scale work, backup/DR work, migrations, git history, and the engineering ledger.
- A live map captured compute, containers, database inventory, RLS/policies/grants, Realtime publications, network controls, mail services, backup state, and explicit blind spots.
- Primary documents were checked for security design, remediation, recovery, scale, deferred work, and operational procedures.
- Representative migration and operations files were inspected to confirm that summarized controls exist in source.
- Git history was reviewed through the audited repository head to anchor chronology.
- Isolated repository verification recorded production dependency audits, lint, test discovery, TypeScript compilation, and application/site build results without treating a passing build as proof that lint, tests, or dependency risk were clear.

## Controls and operating model

### Claim construction rules

1. **Live state outranks history.** A current live observation supersedes a stale managed-service statement or earlier configuration record.
2. **Repository is implementation evidence, not deployment evidence.** “Implemented” means source exists; “running” requires live observation.
3. **Historical tests retain their date.** A recorded negative battery can support engineering discipline and prior closure, but not an undated current assurance claim.
4. **Unverified is a first-class result.** Dashboard policy, off-site object, restore, worker, and delivery claims remain open when not directly observed.
5. **Counts carry scope.** For example, the function total refers to `public` plus `whatsapp`, the RLS statement distinguishes all non-system relations from the application schemas where zero disabled tables were found, and the 46 anonymous table-privilege rows are limited to 14 tables in the `realtime`, `storage`, and `supabase_functions` service schemas.
6. **Absence is narrowly stated.** “No automated test files were discovered” means no matching repository files were found; it does not mean no manual, CI, or historical verification occurred.
7. **No secret inspection.** Credentials, tokens, environment values, customer rows, private addresses, and private hostnames are excluded from the dossier.
8. **No exploit reproduction for this dossier.** Detailed historical findings are summarized at control level without unnecessary exploit instructions.
9. **No invented assurance.** The dossier makes no certification, penetration-test, customer, SLA, revenue, RPO, RTO, or compliance claim beyond available evidence.

### Audit safety boundary

The accepted live capture was read-only and recorded that it performed no writes, restarts, deploys, scans, secret reads, customer-row reads, or configuration dumps. Authoring of the master dossier and the 17-chapter detailed dossier used only local repository and accepted audit artifacts; it executed no network or production commands.

### Review and repeatability

Each detailed chapter uses the same six-part structure:

- Investor significance;
- What exists;
- Controls and operating model;
- Current evidence status;
- Risks and limitations;
- Evidence trail.

This makes unsupported claim escalation visible. A future refresh can update the live map, rerun static inventories, compare the audited repository head, and change labels only when stronger evidence exists.

## Current evidence status

### High-confidence current observations

- Core application and database containers were healthy or running in the capture window.
- Database size, schema objects, RLS coverage, policy counts, `SECURITY DEFINER` counts, the 46 anonymous table-privilege rows across 14 `realtime`/`storage`/`supabase_functions` tables, scheduled jobs, and Realtime publications were directly inventoried.
- Host firewall, fail2ban, private overlay, tunnel process, mail containers, backup completion, archive counters, and timers were observed.

### High-confidence repository observations

- Application, communications, integration, migration, operations, recovery, storage, mail, and CI source are present.
- `npx tsc -b`, the root production build, Astro check, and Astro build passed in isolated verification on 2026-08-23.
- `npm run lint` failed with 1,562 errors and 100 warnings, including a Rules of Hooks violation at `src/whatsapp/routes/admin/conversations/parts.tsx:5944-5952`; current release workflows do not run lint.
- `npm test` exited 1 because it found no test files.
- The root production dependency audit reported one high and two moderate advisories; the `site/` production audit reported four high, one moderate, and one low. These were not remediated during dossier authoring.
- Restore and monitoring tools exist, including scripts and service/timer definitions.

### Explicitly not established

- A restore executed or independently witnessed during either audit pass, and the decryptability or logical completeness of backup contents.
- Zone-level firewall and rate-limiting rule enumeration.
- WhatsApp session-level send and receive success, phone-number connectivity, message throughput, or queue depth; these were deliberately not exercised against live customer conversations.
- Independent external uptime monitoring or a measured availability history.
- Secret rotation status.
- Effective anonymous-role access for every one of the 46 service-schema table-privilege rows.
- Independent third-party security or compliance assurance.

Four items listed as not established in the 2026-08-23 pass have since been closed and are reported as live-verified: WhatsApp node runtime health; edge DNS, tunnel, and Access policy state; off-site backup-object existence; and application-level mail delivery.

## Risks and limitations

1. **Point-in-time capture.** Health and configuration can change after the recorded window.
2. **Selective live scope.** The capture prioritized high-value system facts and deliberately avoided customer data, secrets, destructive validation, and offensive scanning.
3. **No full function audit.** Counting 242 privileged functions does not establish that every body, grant, and caller is safe.
4. **No exhaustive endpoint matrix.** Route and function inventories show breadth, not end-to-end behavior for every role and tenant.
5. **Historical evidence is internally produced.** The ledger is detailed and candid, but it is not independent third-party attestation.
6. **Quality gates are not green.** Lint fails with 1,562 errors and 100 warnings, including a Rules of Hooks violation; the release workflows omit lint, and the test command exits 1 because no test files are present. Passing typechecks and builds do not close these gaps.
7. **Production dependency advisories are unresolved.** Root and marketing-site audits include high-severity findings. This is current supply-chain risk, not evidence of an exploited compromise.
8. **Documentation drift.** Runbooks and planning files can lag live systems; live evidence must continue to outrank them.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Project operating constraints and source-of-truth rules: `AGENTS.md`, `CLAUDE.md`
- Security sources: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`, `docs/MASTER_TODO.md`, `.foreman/ledger.md`, `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql`, `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql`
- Recovery and operations sources: `docs/DR_RUNBOOK.md`, `ops/README.md`, `ops/`
- Scale and deferral sources: `docs/MASTER_TODO.md`, `docs/WA_ENTERPRISE_SCALE_PLAN.md`
- Historical implementation record: `.foreman/ledger.md`, `git log`
- Audited repository head: `790f84e315614ccb065969b9004ce6dffbc8ad21`
