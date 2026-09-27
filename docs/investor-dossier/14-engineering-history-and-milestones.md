# 14. Engineering History and Milestones

> Classification: **Confidential — investor diligence material.** This is a source-backed engineering history, not a claim about revenue, customers, market adoption, or contractual service levels.

## Investor significance

The repository shows more than feature accumulation. It records repeated transitions from client-heavy behavior to server-owned data contracts, from broad database access to role- and tenant-bound controls, from polling to broadcast, and from ad hoc recovery to a scheduled continuity system. The strongest indicator of maturity is the correction record: proposals were rejected when measurements contradicted them, regressions were documented, and destructive cleanup was delayed behind quarantine.

History is still secondary evidence. A commit proves that code entered the repository; it does not by itself prove that the same version remains deployed or healthy.

## What exists

### Milestone timeline

| Period | Milestone | Evidence status | Significance |
|---|---|---|---|
| 2026-07-03 | Cutover to the self-hosted Supabase stack and formal security audit | Historical, with current architecture corroboration | Established infrastructure ownership and exposed inherited authorization debt for remediation. |
| 2026-07-04 to 07-05 | Layered backup, PITR, logical dumps, object mirror, escrow, watchdog, and restore-drill work | Repository-verified; historical drill evidence; partial live corroboration | Moved continuity from a single backup job to a multi-layer operating system. |
| 2026-07-05 to 07-13 | WhatsApp inbox, media, dispatch, notifications, assignment, search, worker, and reliability development | Repository-verified; current separate-node runtime unverified | Built a substantial communications subsystem with durable queues and server-side reconciliation. |
| 2026-07-14 | E-commerce Realtime consumers migrated from `postgres_changes` toward private broadcast; legacy publication emptied | Repository and history; current empty legacy publication live-verified | Reduced database change-decoding load and centralized authorization-aware event delivery. |
| 2026-07-14 to 07-17 | Keyset lists, server-side search/filter/counts, dashboard aggregates, money calculations, and role-specific scale work | Repository and historical performance records | Replaced full-table/client computation patterns that fail as data and users grow. |
| 2026-07-15 to 07-17 | Payout guards, role isolation, cache-leak repair, private typing channels, and database grant hardening | Repository and historical negative batteries | Strengthened money integrity and role separation across application and database layers. |
| 2026-07-17 to 07-26 | WhatsApp backup integration, session-backup correction, backup sentinel correction, status/provider workflow hardening | Repository and historical operations record | Demonstrated follow-through on silent-failure modes rather than relying on green scheduler state alone. |
| 2026-07-29 to 07-30 | Business-owner role model, end-to-end page permissions, atomic checked user deletion, and archival identity lifecycle | Repository and historical live batteries | Protected operational history while supporting controlled collaborator lifecycle. |
| 2026-08-03 | Self-hosted email operations, delivery-truth events, DKIM rotation automation, scoped edge credential, and monthly/demand messaging | Repository and historical live evidence | Added owned mail infrastructure with feedback and correction loops. |
| 2026-08-04 to 08-05 | Storage policy hardening, upload constraints, tenant paths, image delivery optimization, safe janitors, and scheduled quarantine/purge | Repository and historical live evidence | Reduced cross-tenant object risk and made cleanup reversible before deletion. |

### Current scale of the codebase

- **Repository-verified, 2026-08-23:** 456 files under `src/`, including 94 page files and 191 component files.
- **Repository-verified:** 88 WhatsApp source files, 61 library files, 16 hooks, 341 SQL migrations, 38 non-shared edge-function directories, 279 tracked operations files including four tracked dotfiles, and two CI/release workflows.
- **Repository-verified:** 106 route elements cover platform owner, business administration, seller, courier, media buyer, catalog, orders, finance, logistics, documents, analytics, configuration, communications, and help surfaces.
- **Live-verified:** the deployed database shape was substantial: 102 application tables across the two primary application schemas, 411 functions, 119 triggers, and 30 scheduled jobs.

## Controls and operating model

The history shows six recurring engineering practices:

1. **Measure before redesign.** Performance work used query timing and call-volume evidence, and several proposed optimizations were explicitly rejected when they regressed the measured path.
2. **Move authority server-side.** Lists, counts, money calculations, tenant checks, deletion decisions, and delivery events increasingly reside in database or edge contracts rather than browser state.
3. **Use negative batteries for authorization.** Historical work records same-tenant positive cases alongside cross-tenant, archived-user, wrong-role, and direct-RPC denial cases.
4. **Preserve reversibility.** Migrations include rollback notes; storage cleanup uses report, quarantine, age, then purge; recovery changes retain independent paths.
5. **Record corrections.** The ledger preserves false starts, false assumptions, rollback events, and post-verification fixes. That record is more credible than a uniformly positive changelog.
6. **Separate source from live state.** Project rules require live schema inspection before database work and distinguish a repository deploy artifact from an activated runtime.

## Current evidence status

| Evidence class | What it supports | What it does not support |
|---|---|---|
| Live capture | Service health, versions, database inventory, selected security and backup state at one time | Historical uptime, SLA, every endpoint, every worker, or every edge policy |
| Repository | Implemented application, migration, edge, and operations design | Current deployment or successful execution |
| Git history | Sequence and reviewability of engineering change | Production adoption or business impact |
| Foreman ledger | Detailed implementation decisions, tests, incidents, and corrections | Independent third-party assurance; current state unless rechecked |
| Planning documents | Deliberate scale and risk reasoning | Completed work unless marked shipped and corroborated |

## Risks and limitations

1. **Test automation has not kept pace with implementation depth.** No automated test files were found, so much historical verification is preserved in work logs rather than executable regression suites.
2. **Operational knowledge concentration.** The breadth of custom database, backup, mail, and communications operations creates key-person and runbook-maintenance risk.
3. **History can become stale.** Managed-service-era claims and pre-remediation findings must not be carried forward without current verification.
4. **Some stage-gated scale work remains deliberately conditional.** Horizontal Realtime scaling and several WhatsApp load assumptions were left pending measurement rather than presented as shipped.
5. **Commit velocity is not product traction.** The evidence supports engineering throughput and control depth only; it does not prove customer count, revenue, retention, or market fit.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Scale and architecture record: `docs/MASTER_TODO.md`, `docs/WA_ENTERPRISE_SCALE_PLAN.md`
- Security and recovery history: `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql`, `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql`, `docs/DR_RUNBOOK.md`
- Detailed work record: `.foreman/ledger.md`
- Change history: `git log` through repository head `790f84e315614ccb065969b9004ce6dffbc8ad21`
- Representative milestones: commits `c1bfc42`, `689dafc`, `2128253`, `73a09b1`, `34e20a1`, `accde48`, `56cbd59`, `7387303`, `1d3746f`, `2ab7c49`, `790f84e`
