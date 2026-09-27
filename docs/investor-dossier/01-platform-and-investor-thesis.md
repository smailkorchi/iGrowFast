# Platform and investor thesis

## Investor significance

iGrowFast is implemented as an operating system for commerce businesses, not as a single-purpose order dashboard. One product surface connects customer acquisition, order capture, fulfillment, staff workflows, payouts, business reporting, and customer conversations. That breadth matters because the difficult part of commerce software is not rendering each screen; it is preserving one business context, one order history, and one set of role boundaries across the entire operating cycle.

The investable engineering asset is therefore the connected workflow layer. A media buyer can work from campaigns and acquisition data, a commercial agent can confirm an order in the same system that holds the customer conversation, a courier or delivery provider can advance fulfillment, and management can read the financial and operational result without exporting every stage into a different tool. The repository also contains the backend functions, database history, worker code, and operations tooling needed to support that product, reducing dependence on a thin frontend assembled over third-party dashboards.

This dossier does not claim revenue, customer count, market share, service-level commitments, or regulatory certifications. None were established by the technical audit.

## What exists

The repository contains distinct workspaces for six operating boundaries:

- A platform owner manages businesses, plans, platform billing, users, service status, geography, configuration, email templates, and backup visibility.
- Business owners and administrators run orders, imports, products, customers, delivery and return notes, carriers, payments, expenses, transactions, salaries, analytics, sales channels, commercial documents, collaborators, and business billing.
- Commercial agents manage their catalog-facing work, orders, delivery and return notes, wallet, payouts, requests, statistics, WhatsApp inbox, and help.
- Couriers work from assigned orders, operational status, and payment views.
- Media buyers manage campaigns, product advertising records, attributed orders, requests, payouts, statistics, Google Analytics, and Meta advertising data.
- Customer-communications teams work through a multi-number WhatsApp layer with assignments, contacts, messages, media, tags, quick replies, schedules, and order context.

The route map declares 106 route elements. The audit inventory found 456 application source files, 341 database migrations, 38 non-shared edge-function directories, and a dedicated WhatsApp worker. These counts indicate implementation breadth, not adoption or commercial traction.

## How it works

The frontend is a React and TypeScript application with role-specific route trees. It calls a self-hosted Supabase stack built around PostgreSQL, authentication, object storage, Realtime, and edge functions. PostgreSQL is not used only as a record store: the migration history contains tenant policies, guarded business operations, server-side aggregates, workflow triggers, scheduled jobs, and broadcast producers.

The main operational loop is connected:

1. Orders enter through administrative entry, imports, sales-channel review, or conversation-linked creation.
2. Commercial and administrative users confirm, annotate, assign, and advance them within their allowed scope.
3. Courier and carrier workflows create parcels, tracking activity, delivery notes, and return notes.
4. Order and package outcomes feed payout ledgers, expenses, profitability, channel reporting, and collaborator statistics.
5. WhatsApp conversations can surface customer order history, while assignments and private realtime updates keep teams working from a shared operational record.

An Astro project under `site/` provides a separate marketing and legal surface. Operations source under `ops/` covers backup, restore, monitoring, and worker deployment concerns. Two repository workflows build and release the application and marketing site.

## Controls/reliability

The application separates navigation controls from data controls. Role gates and page permissions determine the workspace a user sees; tenant-scoped database policies and guarded functions enforce the data boundary. The live read-only capture found no RLS-disabled tables in the public, WhatsApp, or storage schemas.

Reliability mechanisms are present at several levels: guarded database mutations, status-history triggers, server-side pagination and aggregates, private broadcast channels with reconnect reconciliation, durable WhatsApp queues, worker leases, health reporting, backup schedules, WAL archiving, logical backups, and restore tooling. The live capture confirmed healthy core database, authentication, Realtime, API-gateway, and tunnel services, plus a recent full backup and an error-free archive counter during the capture window.

The repository also shows deliberate scaling work: analytics calculations were moved from unbounded browser fetches into database aggregates; key operational lists gained server-side search and pagination; and legacy table-change subscriptions were replaced by targeted private broadcasts.

## Current evidence status

- **Live verified on 2026-08-24:** core platform services were running; PostgreSQL reported 77 public tables, 25 WhatsApp tables, 263 public functions, 148 WhatsApp functions, 119 triggers across those two application schemas, 30 scheduled jobs, and 280 row-level security policies. Backup and archive signals were healthy at capture time.
- **Repository verified:** the role workspaces, product routes, edge functions, database migrations, communications worker, integrations, release workflows, and operational scripts exist in source.
- **Historical record:** security remediation, performance work, disaster-recovery development, WhatsApp scaling, and lifecycle hardening are documented in repository records. Historical statements are not treated as proof of current deployment unless the live capture corroborates them.
- **Unverified:** active customer usage, transaction throughput, user counts, commercial conversion, end-to-end provider flows, external monitoring, off-site backup objects, a restore performed during this audit, and the separate WhatsApp worker's runtime health.

## Risks/limitations

Product breadth creates maintenance cost: order semantics, carrier adapters, financial calculations, role rules, and realtime behavior must evolve together. The audit found no `*.test.*` or `*.spec.*` files despite configured test tooling, so automated regression coverage is not evidenced by the repository inventory.

The live database contains a large privileged function surface. The anonymous role also has 46 explicit table-privilege rows across 14 tables, all in the `realtime`, `storage`, and `supabase_functions` service schemas; the previously cited 27 was the `storage` subset only. A grant row does not establish effective row exposure, which was not exhaustively tested. Both surfaces require continuous review. The audit did not verify a full observability stack, external uptime monitoring, secret-rotation status, or a restore exercise. The communications worker runs separately and could not be directly inspected during the live capture. These are diligence items, not proof of failure.

## Evidence trail

- Product route and role inventory: [src/App.tsx](../../src/App.tsx)
- Application and dependency architecture: [package.json](../../package.json)
- Backend implementation: [supabase/functions](../../supabase/functions) and [supabase/migrations](../../supabase/migrations)
- WhatsApp worker: [ops/whatsapp-node/worker/src](../../ops/whatsapp-node/worker/src)
- Operations and recovery: [ops](../../ops) and [docs/DR_RUNBOOK.md](../DR_RUNBOOK.md)
- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
