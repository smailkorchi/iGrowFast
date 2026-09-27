# 15. Risk Register and Next Stage

> Classification: **Confidential — investor diligence material.** Priorities are engineering diligence judgments, not legal, regulatory, insurance, or investment advice.

## Investor significance

The current evidence does not identify a verified active compromise or a known P0 data-loss event. It does identify several assurance, capacity, and control-surface risks that matter before the platform carries materially higher volume. The register separates observed current gaps from historical or deferred work so remediation history is not misrepresented as current failure.

Priority definitions used here:

- **P0:** verified active compromise, corruption, or imminent unrecoverable loss. None was evidenced in the 2026-08-23 or 2026-08-24 captures.
- **P1:** close or instrument in the next operating cycle because failure would materially affect continuity, communications, or assurance.
- **P2:** close as the platform moves from founder-operated to repeatable engineering operations.
- **P3:** stage-gated work that should be triggered by measured scale or a product decision.

## What exists

### Verified current gaps and current exposure

| Priority | Risk | Evidence status | Existing control | Next-stage action; not yet claimed complete |
|---|---|---|---|---|
| P1 | Communications/tools host disk at **79%** | Live-verified | Timers, watchdogs, disk guards, backup maintenance | Attribute growth, set warning/critical alerts, confirm log and backup retention, and preserve expansion headroom. |
| P1 | No restore was executed or independently witnessed during this audit, and backup contents were not decrypted | Narrowed assurance gap | Off-site objects live-verified present and current; 21 of 21 backup lanes within declared budgets; scheduled drill last succeeded 2026-08-01 | Capture evidence from the next scheduled drill — recovery duration, integrity checks, operator sign-off — and sample remote objects for decryptability and logical completeness. |
| P1 | **WhatsApp customer media is single-copy — confirmed current on 2026-08-24** | Live-verified open gap | None for these bytes. The media store holds 4,946 objects / 2.60 GiB and no mirror exists; the upload mirror covers application storage only. Recent work added lifecycle cleanup, which is not redundancy. | Extend the existing mirror pattern to this one additional store, then sample a restore. This is the clearest single remediation item in the recovery system and is bounded and inexpensive to close. |
| P1 | Root production audit reports **one high and two moderate** advisories; `site/` reports **four high, one moderate, and one low** | Repository verification, 2026-08-23 | Lockfiles; isolated typecheck/build checks passed. Direct high-risk dependencies include `pdfjs-dist` and Astro; no exploited compromise is evidenced. | Upgrade and regression-test `pdfjs-dist`, React Router, Astro, and affected transitives; rerun production audits to zero or formally accept documented residuals. |
| P1 | Lint fails with **1,562 errors and 100 warnings**, including a Rules of Hooks violation at `src/whatsapp/routes/admin/conversations/parts.tsx:5944-5952`; release workflows omit lint | Repository verification, 2026-08-23 | TypeScript, root build, Astro check, and Astro build passed in isolated verification | Fix hook-rule violations first, establish a staged lint baseline, then enforce lint in release workflows. |
| P2 | **242 `SECURITY DEFINER` functions** | Live-verified | Revocation and tenant-guard migrations; RLS; historical adversarial reviews | Maintain a generated inventory of owner, grants, `search_path`, caller-null behavior, tenant binding, and consumers; regression-test high-impact functions. |
| P2 | Anonymous role retains **46 privilege rows across 14 service-schema tables**, though it holds **zero privileges on application tables** | Live-verified | Application schemas fully revoked; grant rows alone do not prove effective row exposure | Produce a justified allow-list for the residual `realtime`, `storage`, and `supabase_functions` privileges, exhaustively test effective access, and revoke what is unnecessary. |
| P2 | `npm test` exits 1 because no test files are present | Repository verification, 2026-08-23 | Typecheck/build workflows and historical targeted batteries | Establish durable tests around authentication, tenant isolation, money, archive/delete, queue claiming, and recovery-plan authorization. |
| P2 | Edge hardening defaults below the architecture's intent: minimum TLS 1.0, origin validation full rather than full-strict, Always Use HTTPS off, no HSTS header | Live-verified | Tunnel-only origin, TLS 1.3 enabled, automatic HTTPS rewrites on, three Access-protected admin surfaces | Raise the TLS floor to 1.2, move to full-strict, enable Always Use HTTPS, and add HSTS. Each is low-effort; together they align configuration with design. |
| P3 | Zone-level firewall and rate-limiting rules not separately enumerated | Completeness item | DNS, tunnel, and Access state live-verified; origin-side rate limiting exists and is effective because all traffic arrives through the tunnel | Export the rule set read-only; define a versioned baseline and drift check. |
| P2 | No Prometheus, Grafana, or Loki runtime and no external uptime monitor verified | No runtime observed; broader coverage unverified | Container health checks, database statistics, backup/archive monitors, SMTP alerts, watchdogs | Define service-level signals, queue-age and disk alerts, centralized retention, and independent synthetic checks. |
| P3 | No recurring external mail-delivery probe or alerting on queue age | Monitoring gap | Delivery outcomes are live-verified recorded end to end (837 messages logged, delivered and bounced states present); DMARC, BIMI, and dual DKIM selectors published | Run recurring external delivery probes and alert on queue age, authentication alignment, and provider rejection. |
| P2 | Secret rotation status not reviewed | Unverified by design | Secrets excluded from repository and diligence capture | Maintain a rotation register containing dates and owners, never values; verify scopes without exposing credentials. |

### Historical and deferred items — not asserted as current defects

| Item | Classification | Why it remains visible |
|---|---|---|
| July security audit findings | Historical remediation record | Serious findings drove migrations and negative batteries. A new adversarial review is required before calling every historical item live-verified closed. |
| Logical/object retention expansion proposal | Deferred owner decision | The ledger records a proposed longer retention model that was not approved. Current retention must be evaluated against business and legal needs. |
| Horizontal Realtime clustering | Conditional/deferred | The scale plan requires workload evidence before taking on clustering complexity. Current legacy publication was live-verified empty. |
| WhatsApp event-rate concentration and node assumptions | Unverified scale hypotheses | Load behavior at thousands of numbers in one business was explicitly left for modeling/canary testing. |
| Parked or removed bulk-payout path | Historical/deferred product path | The history records non-idempotency concerns and removal of unreachable UI. Do not reactivate without a new contract and test battery. |
| Lower-value page and polling cleanups | Deferred optimization | These are not security incidents; address only when measurements or product importance justify them. |

## Controls and operating model

Risk closure should follow one evidence contract:

1. name the risk and current evidence class;
2. define a measurable close condition before implementation;
3. preserve rollback or quarantine for destructive work;
4. test both allowed and denied paths;
5. verify the live state after deployment, including warm-worker activation where relevant;
6. record residual risk and the next trigger instead of marking conditional work complete.

Suggested ownership lanes are operational, not organizational claims:

- **Security lane:** privileged-function inventory, anonymous table privileges in `realtime`/`storage`/`supabase_functions`, edge policy baseline, secret-rotation register.
- **Reliability lane:** restore evidence, off-site parity, WhatsApp media redundancy, tools-host capacity.
- **Quality lane:** executable regression coverage for tenant, money, lifecycle, queue, and recovery contracts.
- **Observability lane:** service-level signals, external probes, queue age, disk, backup freshness, and alert escalation.
- **Scale lane:** only measured Realtime/WhatsApp bottlenecks; no speculative clustering.

## Current evidence status

- **Live-verified:** database/security inventory, host capacity, core services, firewall/fail2ban/private overlay, backup completion, archive counters, timers, and absence of a verified metrics/logging stack.
- **Repository-verified:** application, migrations, worker, backup, restore, mail, storage, monitoring scripts, and CI definitions.
- **Historical:** security remediation batteries, restore drills, mail correction, user lifecycle tests, storage quarantine, and performance milestones.
- **Unverified:** WhatsApp worker runtime, Cloudflare dashboard policies, current off-site objects, fresh restore execution, application mail delivery, external uptime monitoring, and secret rotation status.

## Risks and limitations

- This register is a point-in-time engineering view dated 2026-08-24. It does not replace continuous vulnerability, capacity, or compliance management.
- Priority reflects impact and evidence quality, not estimated probability from statistically meaningful incident data.
- A missing verification is not the same as a failed control. It remains open because investors cannot rely on a control that was not observed.
- Repository presence is not deployment proof. Historical live batteries are not silently promoted to current status.
- No customer-volume, revenue, incident-rate, uptime, RPO, RTO, or SLA claims were available for independent validation.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- Scale deferrals and unverified assumptions: `docs/MASTER_TODO.md`, `docs/WA_ENTERPRISE_SCALE_PLAN.md`
- Security baseline/remediation: `supabase/migrations/20260703000000_security_remediation_2026_07_03.sql`, `supabase/migrations/20260703000200_r7_revoke_anon_users_login_lookup.sql`
- Recovery design and gaps: `docs/DR_RUNBOOK.md`, `ops/README.md`
- Detailed correction and decision record: `.foreman/ledger.md`
- Current schema history: `supabase/migrations/`
