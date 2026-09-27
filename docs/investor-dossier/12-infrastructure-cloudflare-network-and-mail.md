# 12. Infrastructure, Cloudflare, Network, and Mail

> Classification: **Confidential — investor diligence material.** Infrastructure is described by role, not by address, credential, private hostname, or secret-bearing configuration.

## Investor significance

iGrowFast owns and operates a self-hosted application stack rather than outsourcing the entire control plane to a managed database vendor. This provides architectural control and predictable component boundaries, but it also transfers patching, capacity, availability, mail reputation, edge policy, and recovery obligations to the company.

The 2026-08-24 capture shows a healthy, segmented estate with a **private origin**: the application's public hostnames resolve to Cloudflare and are served through outbound-only tunnels, so the origin servers are not addressable from the internet for web traffic. Edge policy state, previously undocumented, has now been read directly and is consistent with the designed architecture.

The remaining diligence limits are elevated disk utilization on the communications/tools host and a set of edge-hardening defaults that should be tightened.

## What exists

### Primary application estate

- **Live-verified, 2026-08-24:** the primary host had 12 vCPU, 47 GiB RAM, a 242 GiB disk at 7% utilization, and 4 days 23 hours uptime.
- **Live-verified:** 13 Supabase, PostgreSQL, API gateway, tunnel, connection-pooler, and proxy containers were healthy or running at capture time.
- **Live-verified:** observed component versions included PostgreSQL 17.6, Realtime 2.102.3, Auth 2.192.0, and PostgREST 14.12.
- **Live-verified:** the production database was approximately 719 MB, with 14 non-system schemas, 102 application tables across `public` and `whatsapp`, 411 functions across those schemas, 119 triggers, 361 indexes in `public`, and 30 active scheduled jobs.
- **Repository-verified:** application and edge-function source, database migrations, operational scripts, and two GitHub build/release workflows are maintained together, giving reviewers a traceable deployment model.

### Network and edge

- **Live-verified, 2026-08-24:** the primary domain carries 19 DNS records across 15 hostnames. Ten records are proxied through Cloudflare, and **nine of the ten CNAME records resolve to Cloudflare Tunnel endpoints**. Application traffic therefore reaches origin services only through an outbound-established tunnel.
- **Live-verified:** **three tunnels serve the platform, all healthy, each holding four concurrent connections.** Their ingress definitions were read directly: one carries the application, marketing, and mail hostnames; one carries the API and the administrative studio; one carries the backup control plane. Four connections per tunnel provides redundancy across edge locations rather than a single path.
- **Live-verified:** **three identity-aware Access applications** protect the administrative surfaces — the database studio, the mail administration console, and the webmail administration path — each with a 24-hour session. A live request to the studio hostname returned an Access redirect rather than the application, confirming enforcement at the edge.
- **Live-verified:** host firewalling was active on every host, fail2ban was active with an SSH jail, and the private overlay network was active. On the primary host the API gateway bound only to loopback-facing ports; the database and pooler were reachable only on the private overlay address, not on a public interface.
- **Live-verified:** unauthenticated calls to the public API health path were rejected by the gateway with an API-key error, and the application, marketing, and webmail hostnames served successfully over verified TLS.
- **Live-verified:** the application responds with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a strict-origin referrer policy.
- **Live-verified hardening opportunities:** the zone's minimum TLS version is set to 1.0 rather than 1.2, origin certificate validation is set to full rather than full-strict, `Always Use HTTPS` is off (partially mitigated by automatic HTTPS rewrites and the tunnel-only origin), and no HSTS header is emitted. These are configuration defaults to tighten, not active compromises.

### Communications and mail estate

- **Live-verified, 2026-08-24:** the communications/tools host had 12 vCPU and 47 GiB RAM, with 51 days uptime. Its disk was **79% utilized**, which requires near-term capacity and retention attention.
- **Live-verified:** the iGrowFast services on this host were healthy — the mail server and webmail, the frontend web server and its tunnel, and the hardened service wrapper that fronts email verification and geolocation lookups.
- **Live-verified:** standard SMTP submission/delivery and secure IMAP ports were listening publicly as required for mail operation, and were the only publicly permitted ports besides SSH. This is intentional exposure and needs continued patch, abuse, and reputation monitoring.
- **Live-verified:** the domain publishes DMARC, BIMI, and **two DKIM selectors covering both Ed25519 and RSA signing**, dated to a 2026-07-18 rotation. Dual-algorithm signing improves acceptance across receivers that support only one.
- **Live-verified:** application mail delivery is now evidenced end to end. The delivery log holds 837 messages since 2026-06-20, 248 of them in the trailing 30 days, and records terminal outcomes — delivered, bounced, and error — rather than send attempts alone. Bounces and errors together represent roughly one percent of logged mail.
- **Repository-verified:** the mail subsystem includes event ingestion, delivery-status recording, a DNS synchronization utility for rotating signing keys, and operational documentation.
- **Historical:** the engineering ledger records remediation of a DKIM rotation mismatch, delivery-truth tracking, DMARC report reception, and replacement of an over-scoped edge credential with a constrained one.

### Separate WhatsApp node

- **Live-verified, 2026-08-24:** the node was reached directly and every component was healthy — the communications worker, the WhatsApp provider API, its dedicated PostgreSQL 17 instance, and Redis. The worker and provider containers had been running continuously for approximately four and six weeks respectively.
- **Live-verified:** this node carries the **tightest exposure profile in the estate**. Its only publicly reachable port is SSH, and that port is rate-limited rather than merely permitted. The provider API binds to loopback and is reachable only across the private overlay; the database and Redis publish no host port at all; Redis rejects unauthenticated commands.
- **Repository-verified:** worker code implements webhooks, outbound dispatch, media ingestion, instance reconciliation, heartbeat/logging, private presence, and queue self-healing.
- **Unverified:** session-level send and receive success was not exercised, because doing so would touch live customer conversations.

## Controls and operating model

- Public application ingress is separated from origin services through outbound-only tunnels and an API gateway. No web origin is directly addressable.
- Administrative surfaces sit behind an identity-aware proxy, so studio, mail administration, and webmail administration require authentication before the application is reached.
- Host firewall, intrusion throttling, and private overlay networking protect the administrative plane, with the most sensitive node held to the strictest rules.
- Connection pooling and database timeouts bound resource use at the data layer; scheduled jobs centralize recurring maintenance.
- Infrastructure configuration is maintained under `ops/`, including systemd schedules, backup agents, watchdogs, mail automation, and container definitions.
- Mail signing-key publication is automated and designed to fail closed on an empty source read. The repository keeps the implementation without storing credential values.
- The communications worker uses durable database queues and self-healing/reconciliation logic rather than treating process memory as the source of truth.
- Deployment and host changes are operationally distinct from repository edits. This dossier does not infer deployment merely because source exists.

## Current evidence status

| Area | Status | Diligence conclusion |
|---|---|---|
| Primary compute and core containers | Live-verified | Healthy at the capture window; not an uptime guarantee. |
| Origin bindings, firewall, fail2ban, private overlay | Live-verified | Defense-in-depth controls active on all three hosts. |
| Cloudflare tunnels | Live-verified | Three platform tunnels healthy with four connections each; ingress hostnames read directly. |
| Cloudflare DNS and Access policy | Live-verified | Tunnel-routed hostnames and three Access-protected admin surfaces confirmed, including a live enforcement check. |
| Cloudflare TLS posture | Live-verified | Functioning, with specific hardening defaults identified above. |
| WAF and rate-limiting rules | Not separately enumerated | Origin-side rate limiting exists at the service wrapper; zone-level rule review remains open. |
| Mail containers, listeners, DNS authentication records | Live-verified | Runtime healthy; DMARC, BIMI, and dual DKIM selectors published. |
| Application mail delivery | Live-verified | Terminal delivery outcomes recorded in the delivery log. |
| WhatsApp node runtime | Live-verified | Worker, provider, database, and cache all healthy; exposure minimal. |
| WhatsApp session send/receive success | Unverified | Deliberately not exercised against live customer conversations. |

## Risks and limitations

1. **Communications/tools disk at 79%.** This is the clearest current capacity warning. Define alert thresholds, identify growth sources, verify retention jobs, and preserve headroom before adding communications volume.
2. **Edge hardening defaults.** Raise the minimum TLS version to 1.2, move origin validation to full-strict, enable Always Use HTTPS, and add an HSTS header. Each is a low-effort change; together they close the gap between the architecture's intent and its configured floor.
3. **Zone-level rule review outstanding.** Tunnel and Access state are now confirmed, but WAF and zone rate-limiting rules were not separately enumerated. Origin-side limits exist and are effective because all traffic arrives through the tunnel, so this is a completeness item rather than an exposure.
4. **Public mail ports are a necessary attack surface.** Patch cadence, authentication controls, abuse signals, queue depth, reputation, and delivery probes need operational monitoring.
5. **Self-hosting concentrates responsibility.** The company controls the stack but must sustain kernel, container, database, tunnel, pooler, mail, and worker maintenance without relying on a managed-provider SLA.
6. **No external uptime proof.** The capture did not verify an independent synthetic monitor or calculate historical availability. Endpoint checks confirm the estate was serving during the window; they are not an availability record.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Operational source: `ops/README.md`, `ops/igf-services/`, `ops/whatsapp-node/`, `ops/systemd/`
- Mail source and operating notes: `ops/igf-mail/README.md`, `ops/igf-mail/dkim-dns-sync.py`
- Edge-function source: `supabase/functions/`
- CI/release definitions: `.github/workflows/deploy-frontend.yml`, `.github/workflows/deploy-site.yml`
- Historical infrastructure and mail record: `.foreman/ledger.md`, git history for 2026-07-17 through 2026-08-03
