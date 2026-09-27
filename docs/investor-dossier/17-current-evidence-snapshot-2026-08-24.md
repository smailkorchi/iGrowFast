# 17. Current Evidence Snapshot — 2026-08-24

> Classification: **Confidential — investor diligence material.** This is a sanitized point-in-time record. It contains no credentials, customer rows, message contents, private addresses, or secret values.

## Capture boundary

Live evidence was captured read-only in two windows: an initial pass on 2026-08-23 from 12:02 to 12:03 UTC, and a gap-closure pass on 2026-08-24 from approximately 18:55 to 20:05 UTC. Both used the project's approved database, SSH, edge-provider API, and object-store read interfaces to inspect metadata, service health, resource state, security controls, edge policy, and backup evidence. Neither performed database writes, DDL, deployments, restarts, configuration changes, scans, secret reads, customer-row reads, or environment dumps.

The 2026-08-24 pass exists because the first pass recorded three areas it could not reach: the separate WhatsApp node's runtime, the edge provider's dashboard-side policy state, and the existence of off-site backup objects. **All three are now closed and are reported as live-verified below.** Where the two passes disagree, the 2026-08-24 figures supersede.

Repository and historical inventory were performed against repository head `790f84e315614ccb065969b9004ce6dffbc8ad21`, which was unchanged between the two passes. Repository-derived figures therefore carry their original 2026-08-23 verification date and remain current.

## Live-verified platform state

| Area | Point-in-time evidence (2026-08-24) |
| --- | --- |
| Primary compute | Linux 6.8; 12 vCPU; 47 GiB RAM; 242 GiB disk with 7% used; uptime 4 days 23 hours |
| Communications/tools compute | 12 vCPU; 47 GiB RAM; disk at 79% used; uptime 51 days |
| WhatsApp node compute | 12 vCPU; 47 GiB RAM; 242 GiB disk with 6% used; uptime 51 days |
| Application stack | 13 healthy/running containers covering the self-hosted Supabase stack, API gateway, tunnel, pooler, and proxy roles |
| Core versions | PostgreSQL 17.6; Realtime 2.102.3; Auth 2.192.0; PostgREST 14.12 |
| Database | Approximately 719 MB; 14 non-system schemas; 77 public tables; 25 WhatsApp tables; 2 views; 361 public indexes |
| Database programs | 263 public functions; 148 WhatsApp functions; 84 public triggers; 35 WhatsApp triggers; 30 named scheduled jobs, all active |
| Extensions | 12, including pg_cron, pg_net, pg_stat_statements, pgcrypto, and pg_trgm |
| Data security | RLS enabled on 131 of 157 non-system relations; zero RLS-disabled tables in public, WhatsApp, or storage; 280 policies |
| Privileged surface | 109 public and 133 WhatsApp `SECURITY DEFINER` functions. The anonymous role holds **zero table privileges in `public` and `whatsapp`**; its 46 remaining privilege rows across 14 tables are confined to service schemas — `realtime` 5 rows/3 tables, `storage` 27 rows/9 tables, `supabase_functions` 14 rows/2 tables. Effective access was not exhaustively tested. |
| Realtime | Service healthy; legacy table-change publication empty; targeted broadcast publication contains seven tables |
| Host perimeter | All three hosts: UFW active, fail2ban active with an SSH jail, private overlay active. Primary host gateway loopback-bound; database and pooler reachable only on the private overlay address. WhatsApp node exposes only rate-limited SSH publicly. |
| Edge topology | 19 DNS records across 15 hostnames on the primary domain; 10 proxied; **9 of 10 CNAMEs resolve to tunnel endpoints**, so no web origin is publicly addressable. Three platform tunnels healthy, four connections each, with ingress hostnames read directly. |
| Edge access control | Three identity-aware Access applications (database studio, mail administration, webmail administration), 24-hour sessions. A live request to the studio hostname returned an Access redirect, confirming enforcement. |
| Edge TLS posture | TLS 1.3 enabled and automatic HTTPS rewrites on; verified TLS on every probe. Hardening opportunities: minimum TLS version is 1.0, origin validation is full rather than full-strict, Always Use HTTPS is off, and no HSTS header is emitted. |
| Public endpoint response | Application, marketing, and webmail hostnames returned success; the administrative studio returned an Access redirect; an unauthenticated API health call was rejected by the gateway with an API-key error. Application responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a strict-origin referrer policy. |
| WhatsApp node runtime | Dispatch worker, WhatsApp provider API (2.3.7), dedicated PostgreSQL 17, and Redis **all healthy**. Provider API binds loopback and is reachable only across the private overlay; database and cache publish no host port; cache rejects unauthenticated commands. |
| Mail/authentication | Mail server and webmail healthy; required SMTP/IMAPS listeners present and the only public ports besides SSH; domain publishes DMARC, BIMI, and **two DKIM selectors (Ed25519 and RSA)** dated to a 2026-07-18 rotation; Auth healthy |
| Mail delivery evidence | Delivery log holds 837 messages since 2026-06-20 (248 in the trailing 30 days) recording terminal outcomes — 713 sent, 115 delivered, 6 error, 3 bounced. Delivered and bounced states confirm the provider-webhook feedback loop operates end to end. |
| Off-site recovery material | Two dedicated backup stores holding **34,590 objects totalling 5.02 GiB**. Database backups: 34,052 objects / 2.68 GiB — a point-in-time repository of 33,525 objects, two independent logical-dump sets produced by different hosts (390.8 MiB and 388.8 MiB), and the application-upload mirror (274 objects / 128.7 MiB against a live store of 262 objects / 116.8 MiB). Configuration backups: 538 objects / 2.34 GiB, including an escrow area of 212 objects. Objects were written on the capture date. |
| Primary media store (not backup material) | The WhatsApp media store holds 4,946 objects / 2.60 GiB. It is a live primary store with no second copy; see the open item below. |
| Backup freshness | **21 of 21 scheduled backup lanes across all three hosts were inside their own declared staleness budgets; zero stale.** Each lane publishes a manifest carrying its maximum acceptable age, making freshness mechanically checkable. |
| Continuous archiving | 1,862 archives, **zero failures**, most recent under two hours before capture |
| Restore exercise | Automated restore drill last succeeded 2026-08-01, 23 days before capture against a 40-day budget. No restore was executed during this audit. |
| Cross-host monitoring | Watchdogs bidirectional and current: the primary host monitors the tools host and the WhatsApp node on a 90-minute budget; the tools host monitors the primary host in return. Archive monitoring runs on a 20-minute budget. |
| Observability | Core Docker health checks, pg_stat_statements, backup/archive monitors, SMTP alerts, and watchdogs were present; no full Prometheus/Grafana/Loki runtime was verified |

## Open item confirmed current

| Item | Evidence |
| --- | --- |
| WhatsApp customer media is single-copy | The media store holds 4,946 objects / 2.60 GiB, and no mirror of it exists in either backup bucket — the upload mirror covers application storage only (262 source objects against 274 mirrored). Recorded as a concern on 2026-08-05 and **still open on 2026-08-24**. Recent engineering added lifecycle cleanup for this media, which is not redundancy. |

## Repository-verified implementation scale

| Area | Inventory |
| --- | ---: |
| Declared application route elements | 106 |
| Application source files | 456 |
| Page files | 94 |
| Component files | 191 |
| WhatsApp source files | 88 |
| Library files | 61 |
| Hooks | 16 |
| SQL migration files | 341 |
| Non-shared edge-function directories | 38 |
| Operations tracked files | 279, including 4 tracked dotfiles |
| Existing documentation files before this dossier | 74 |
| Marketing/legal-site tracked files | 41, including 1 tracked dotfile |
| CI/release workflows | 2 |
| Conventional `*.test.*` or `*.spec.*` files discovered | 0 |

## Repository quality and dependency verification

| Check | Point-in-time evidence |
| --- | --- |
| Root production dependencies | `npm audit --omit=dev`: one high and two moderate advisories. The high advisory affects direct `pdfjs-dist` versions `>=5.6.83 <6.2.108` and permits arbitrary JavaScript execution when a malicious PDF is opened; the reported direct fix is 6.2.108, a semver-major update. React Router/React Router DOM moderate advisories include open redirect, XSS, and related issues; fixes are available. |
| Marketing-site production dependencies | `site/` audit: four high, one moderate, and one low advisory. Direct Astro advisories include XSS and SSRF; transitive high advisories affect `js-yaml`, `nanoid`, and `sharp`. Astro 7.2.4 is reported as an available semver-major fix. |
| Lint | `npm run lint` exited non-zero with 1,562 errors and 100 warnings. One concrete Rules of Hooks violation is at `src/whatsapp/routes/admin/conversations/parts.tsx:5944-5952`. The current release workflows do not run lint. |
| Automated tests | `npm test` exited 1 because no test files were found. |
| Isolated structural checks | `npx tsc -b`, the root production build, Astro check, and Astro build passed. These passing checks do not clear the lint, test, or dependency findings. |

The dependency findings are current unresolved supply-chain risks. They are not evidence of an exploited compromise, and no remediation is claimed in this dossier.

## Repository-verified capability map

- Multi-tenant role workspaces for platform governance, business ownership, administration, commercial operations, couriers, media buyers, and customer communications.
- Order intake, imports, sheet review, confirmation, attribution, parcels, tracking, delivery/return notes, inventory effects, payment classification, and historical status controls.
- Operational finance, collaborator payouts, expenses, recurring charges, business payments, profitability, role dashboards, and advertising/channel analytics.
- Multi-number WhatsApp inbox, assignments, contacts, tags, quick replies, schedules, media, order context, durable outbound queues, worker leases, and private broadcasts.
- Carrier adapters covering parcel creation, batch creation, labels, tracking, delivery notes, network/city/store discovery, changes, and webhooks.
- GA4, Meta Marketing, Google Sheets, web push, SMTP/mail events, Evolution API, Cloudflare R2, and provider polling/webhooks.
- Backup, restore, WAL archive monitoring, restic, storage/config mirrors, watchdogs, escrow procedures, and backup health reporting.

## Historical engineering record

- Self-hosted cutover and formal security audit began in July 2026.
- Security remediation addressed caller authorization, privileged-column protection, tenant-bound RPCs, money/order attribution, anonymous access reduction, rate limiting, host hardening, grants, and retention.
- Scale work moved high-volume lists and analytics to server-side pagination/aggregates and replaced broad table-change subscriptions with targeted private broadcasts.
- Lifecycle work added checked deletion, account archive/soft-delete, archived-session rejection, cross-tenant denial, page permissions, and business-owner continuity safeguards.
- Storage and recovery work introduced reference-aware report/quarantine/purge workflows, layered backups, archiver monitoring, and restore tooling.

Historical evidence records that work occurred and was tested at its date. It is not silently promoted to current live assurance.

## Explicitly unverified

Closed since the first pass, and now reported as live-verified above: WhatsApp node runtime health; edge DNS, tunnel, and Access policy state; off-site backup-object existence; and application-level mail delivery.

The following remain outside the evidence set:

- A restore executed or independently witnessed during this audit. The scheduled drill's most recent success is dated 2026-08-01; backup contents were not decrypted or restored here.
- Backup decryptability and logical completeness. Object presence, structure, and size were verified; contents were not.
- Zone-level firewall and rate-limiting rule enumeration. Tunnel and Access state are confirmed and origin-side rate limiting exists, but the provider's rule set was not separately listed.
- WhatsApp session-level send and receive success, phone-number connectivity, message throughput, and queue depth. These were deliberately not exercised, because doing so would touch live customer conversations.
- Independent external uptime monitoring or a measured availability history. Endpoint checks confirm the estate was serving during the window; they are not an availability record.
- Secret rotation status.
- Effective row-level access testing against a live test identity across every route and function.
- Customer volumes, revenue, adoption, transaction throughput, SLA performance, or compliance certification.

## Primary source trail

- Application: `src/`, `src/App.tsx`, `src/whatsapp/`, `package.json`
- Backend and data: `supabase/functions/`, `supabase/migrations/`
- Worker and infrastructure: `ops/`, `ops/whatsapp-node/`
- Security: `docs/MASTER_TODO.md`, `.foreman/ledger.md`, `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql`, `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql`
- Recovery: `docs/DR_RUNBOOK.md`, `ops/README.md`
- Scale and remaining work: `docs/MASTER_TODO.md`, `docs/WA_ENTERPRISE_SCALE_PLAN.md`
- Detailed implementation record: `.foreman/ledger.md`, git history
