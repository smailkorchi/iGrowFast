# 09 — Database and Data Platform

## Investor significance

The data platform is the system's central asset. It holds operational commerce, logistics, billing, workforce, communications, integration, and audit state in one PostgreSQL platform while enforcing tenant and role boundaries near the data. This is important to an investor because the product's workflow breadth is supported by a coherent transactional model rather than a collection of disconnected SaaS records.

The database also contains substantial accumulated domain logic: status transitions, money calculations, assignment, imports, reporting, delivery-provider reconciliation, customer aggregation, messaging queues, realtime publication, and scheduled automation. That logic creates defensibility and operating leverage, but it also creates a privileged code surface that must be governed as carefully as application code.

## Architecture/capabilities

The accepted live capture recorded PostgreSQL 17.6 with a database size of approximately 719 MB. It found 14 non-system schemas, including 77 public tables and 25 WhatsApp tables, 2 views, and 361 indexes in `public`. The application uses self-hosted Auth, PostgREST, Realtime, Storage, an API gateway, and a connection pooler around PostgreSQL; verified component versions included PostgREST 14.12, Realtime 2.102.3, and Auth 2.192.0.

The live database contained 263 public functions and 148 WhatsApp functions, plus 84 public triggers and 35 WhatsApp triggers. These objects implement more than CRUD. They provide tenant-aware lists, server aggregates, payment and payout rules, order/import workflows, delivery-note operations, provider reconciliation, messaging ingest and dispatch, realtime broadcasts, and scheduled maintenance.

The repository contains 341 SQL migration files under `supabase/migrations/`, plus the box-native WhatsApp schema history under `ops/box/whatsapp-schema/migrations/`. Together they record the evolution of:

- tenant-scoped RLS and privileged-column protections;
- role- and business-gated RPCs;
- order, parcel, payment, payout, catalog, campaign, customer, document, mail, and notification domains;
- keyset pagination, server-side reporting aggregates, search normalization, and hot-path indexes;
- cron schedules, retention, webhook and tracking history;
- private storage policies and reference-safe cleanup;
- WhatsApp encryption, queues, assignments, leases, private broadcasts, search, and node sharding.

The live capture found 12 installed extensions, including `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, and `pg_trgm`. These support scheduled jobs, controlled HTTP automation, query analysis, encryption, and indexed fuzzy search without moving those capabilities into separate services.

## Operating model

PostgreSQL is the authoritative state store. Browser clients use short-lived authenticated requests through PostgREST or call RPCs; edge functions use caller-scoped or service-role clients depending on the operation; the communications worker uses short, transaction-compatible SQL operations and realtime control channels.

Schema changes are expected to be repository migrations, not undocumented live DDL. Project rules require inspecting the live schema before database work, writing the change into the migration history, applying atomically, and confirming production writes or DDL before execution. Operations that require database-owner privileges use the designated administrative role rather than assuming the application database role can alter all objects.

Large list and reporting workloads have been moved toward database-native execution. Current migrations implement keyset order and customer pages, business-gated dashboard and analytics aggregates, server-side money totals, set-based refresh paths, search indexes, and precise pagination contracts. This keeps filtering and aggregation close to indexes and reduces the risk of browser row limits silently changing financial results.

Scheduled work is managed through database jobs and system-level timers. The live capture found 30 named `pg_cron` jobs. Repository schedules cover tracking and webhook retention, business notifications, digests, storage janitors, and communications maintenance. External calls triggered from the database are isolated behind narrowly granted helper functions and protected configuration.

## Controls/reliability

- The live capture found RLS enabled on 131 of 157 non-system relations and no RLS-disabled tables in the public, WhatsApp, or storage schemas. It recorded 280 policies.
- Tenant-scoping migrations bind orders, parcels, payment records, provider webhooks, users, and storage objects to the authenticated business or permitted role.
- Privileged RPC migrations add explicit caller gates, fixed or empty search paths, narrowly granted execution, and validation before service-level mutation.
- WhatsApp data uses a separate schema, encrypted message fields, key indirection, service-only secret reveal functions, security-invoker views, and topic authorization policies.
- Financial and workflow updates are performed in database functions where locking and atomicity can be enforced consistently across frontend and background callers.
- Search and large-list migrations add tenant-leading indexes, keyset cursors, and server-side counts rather than full-table client downloads.
- Backup operations include logical dumps, continuous archive/PITR tooling, restic configuration backups, storage mirrors, independent copies, health signals, and isolated restore-drill tooling.
- At the live capture, the latest full database backup had completed earlier that day and PostgreSQL reported 64 archive successes with zero failures.

## Current evidence status

- **Live verified on 2026-08-24:** database version and size, schema/table/function/trigger inventory, RLS and policy counts, extension inventory, named cron-job count, core service versions, recent full-backup completion, and archiver counters.
- **Repository verified:** 341 migration files, current schema and RPC definitions, tenant/storage hardening, keyset and aggregate migrations, WhatsApp schema waves, and backup/restore tooling.
- **Historical evidence:** the formal security remediation and disaster-recovery runbooks record the intent and rollout sequence behind current objects. They are supporting records, not substitutes for live catalogs.
- **Not verified live:** the audit did not read customer rows, execute a restore, inspect off-site backup objects, validate every function body, or correlate every migration with a migration ledger on the host.

## Risks/limitations

- The live database contains 109 public and 133 WhatsApp `SECURITY DEFINER` functions. This is a large privileged surface; each function's caller checks, grants, search path, and tenant behavior require continuous code-level review.
- The anonymous role has 46 explicit table-privilege rows across 14 tables, all in service schemas: five rows across three `realtime` tables, 27 across nine `storage` tables, and 14 across two `supabase_functions` tables. The prior 27 count was storage-only. Grant rows do not establish effective row exposure, and effective access was not exhaustively tested; retained privileges require explicit justification and periodic review.
- RLS coverage is strong in core application schemas but not universal across every non-system relation. Exceptions require inventory and ownership rather than an assumption that the headline percentage is sufficient.
- The schema history is extensive and split between the main migration tree and box-native WhatsApp migrations. Release records must keep those streams reconciled.
- No actual restore was executed during this audit, and off-site objects were not inspected. Backup configuration and recent success signals are not equivalent to recovery proof in this capture.
- The accepted repository inventory found no conventional test files. Database functions have historical verification records and migration assertions, but automated regression coverage is not demonstrated repository-wide.
- The audit does not claim regulatory certification, formal data-residency compliance, or a completed external penetration test.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- `AGENTS.md` — box-only data authority and migration operating rules.
- `supabase/migrations/` — primary application schema history.
- `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql` — tenant and privileged-operation remediation.
- `supabase/migrations/20260714210000_d4_money_aggregates.sql` — server-side financial aggregates.
- `supabase/migrations/20260714220000_d1_orders_list.sql` — tenant-leading order indexes and keyset RPCs.
- `supabase/migrations/20260715040000_d7_customers_and_fixes.sql` — customer list, aggregate, and keyset contract.
- `supabase/migrations/20260804100000_storage_policy_hardening.sql` and `20260804130000_storage_update_policies.sql` — private storage write boundaries.
- `ops/box/whatsapp-schema/README.md` and `ops/box/whatsapp-schema/migrations/` — communications schema provenance and migration history.
- `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql` and `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql` — tracked remediation implementation and access-control history.
- `docs/DR_RUNBOOK.md` and `ops/scripts/igf-restore-drill.sh` — backup topology and isolated restore procedure.
