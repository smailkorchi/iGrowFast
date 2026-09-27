# iGrowFast Investor Technology Dossier — Index

> Classification: **Confidential — investor diligence material**
>
> Evidence date: **2026-08-24** · Repository head: `790f84e315614ccb065969b9004ce6dffbc8ad21`
>
> Live evidence was captured in two read-only passes, 2026-08-23 and 2026-08-24. The second closed the WhatsApp node runtime, edge policy state, off-site backup objects, and mail delivery — every area the first pass could not reach.

## Primary document

[iGrowFast Technology and Operations Dossier](../IGROWFAST_INVESTOR_TECHNOLOGY_DOSSIER.md) is the complete investor-facing narrative. It explains the product, architecture, operating model, infrastructure, controls, engineering history, evidence status, and principal diligence items in one file.

## Detailed chapters

| # | Chapter | Purpose |
| ---: | --- | --- |
| 01 | [Platform and investor thesis](01-platform-and-investor-thesis.md) | Why the connected operating-workflow layer is the core technical asset |
| 02 | [Users, roles, and governance](02-users-roles-and-governance.md) | Role workspaces, invitations, permissions, tenant boundaries, and business governance |
| 03 | [Orders, logistics, and fulfillment](03-orders-logistics-and-fulfillment.md) | Order intake through carrier execution, tracking, delivery, returns, and commercial consequences |
| 04 | [Finance, analytics, and commercial operations](04-finance-analytics-and-commercial-operations.md) | Operational finance, payouts, profitability, dashboards, and acquisition analytics |
| 05 | [Customer communications and WhatsApp](05-customer-communications-and-whatsapp.md) | Multi-number inbox, assignments, queues, media, worker architecture, and realtime behavior |
| 06 | [Integrations and external systems](06-integrations-and-external-systems.md) | Carriers, GA4, Meta, Google Sheets, mail, web push, R2, and provider interfaces |
| 07 | [Frontend architecture and delivery](07-frontend-architecture-and-delivery.md) | React/Vite application structure, role routing, data delivery, and release controls |
| 08 | [Backend, edge functions, and workers](08-backend-edge-functions-and-workers.md) | Edge-function estate, shared services, communications worker, queues, and leases |
| 09 | [Database and data platform](09-database-and-data-platform.md) | Live PostgreSQL inventory, business logic, policies, triggers, schedules, and data risks |
| 10 | [Realtime, automation, and scale](10-realtime-automation-and-scale.md) | Private broadcasts, durable work, scheduled automation, and measured scale engineering |
| 11 | [Security, privacy, and access control](11-security-privacy-and-access-control.md) | Identity, tenant controls, privileged surfaces, storage privacy, and assurance boundaries |
| 12 | [Infrastructure, Cloudflare, network, and mail](12-infrastructure-cloudflare-network-and-mail.md) | Self-hosted topology, edge path, host controls, mail estate, and current limitations |
| 13 | [Backups, disaster recovery, and observability](13-backups-disaster-recovery-and-observability.md) | Recovery layers, backup control plane, monitoring, and evidence gaps |
| 14 | [Engineering history and milestones](14-engineering-history-and-milestones.md) | What was built and hardened over time, with evidence-class boundaries |
| 15 | [Risk register and next stage](15-risk-register-and-next-stage.md) | Prioritized current gaps, historical/deferred items, and next-stage close conditions |
| 16 | [Audit methodology and evidence](16-audit-methodology-and-evidence.md) | How live, repository, historical, and unverified claims were separated |
| 17 | [Current evidence snapshot](17-current-evidence-snapshot-2026-08-24.md) | Sanitized live and repository inventory supporting the dossier, dated 2026-08-24 |
| 18 | [Complete application surface inventory](18-complete-application-surface-inventory.md) | Every role, route, screen, and module that has been built, enumerated exhaustively |
| 19 | [Backend service and data catalog](19-backend-service-and-data-catalog.md) | All 38 edge services, 30 scheduled jobs, and 102 tables, named individually |
| 20 | [Product roadmap and next build](20-product-roadmap-and-next-build.md) | Six owner-stated initiatives, explicitly labelled as planned and not yet built |

## Suggested reading paths

### Investor overview

Read the master dossier, then chapters 01, 18, 03, 05, 10, 13, 14, and 20.

### "What exactly was built?"

Chapters 18 and 19 are the exhaustive inventory — every screen, service, scheduled job, and table, named individually rather than summarized.

### Technical diligence

Read chapters 06 through 13, then 18 and 19, then the current evidence snapshot.

### Security and operational diligence

Read chapters 11, 13, 15, 16, and 17.

## Disclosure rules

- **Live-verified** means observed in a read-only capture window on 2026-08-23 or 2026-08-24; where the two differ, the later pass supersedes.
- **Repository-verified** means the implementation exists in the audited source; deployment is not implied.
- **Historical** means a dated event, decision, test, or prior state is recorded.
- **Unverified** means no operational conclusion is drawn.
- **Planned** means owner-stated direction with no implementation claimed; it appears only in chapter 20.
- The dossier excludes credentials, customer data, message contents, private addresses, secret values, revenue, customer counts, unsupported SLA claims, and certification claims.
