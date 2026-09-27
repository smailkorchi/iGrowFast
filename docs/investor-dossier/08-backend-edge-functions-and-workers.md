# 08 — Backend, Edge Functions, and Workers

## Investor significance

iGrowFast's backend is organized around a self-hosted Supabase platform, PostgreSQL business logic, Deno edge functions, and a dedicated Node/TypeScript communications worker. This separates synchronous application requests from long-running or event-driven work. The architecture is an asset because the platform can keep transactional rules close to the database while isolating external API and communications workloads behind purpose-built execution boundaries.

The accepted repository audit identified 38 non-shared edge-function directories. That breadth covers identity lifecycle, logistics, analytics, mail, notifications, scheduled business communications, provider reconciliation, and storage maintenance. The dedicated worker adds a separate operational plane for WhatsApp delivery and media processing without forcing that workload into the browser or request/response edge path.

## Architecture/capabilities

### Edge layer

The edge source of truth is `supabase/functions/`. A self-hosted router in `supabase/functions/main/index.ts` resolves the requested function, applies the platform's global JWT policy, creates an isolated runtime worker, and forwards the request. The router supports current asymmetric signing keys and the legacy token mode still represented in the deployment. A narrow public allowlist exists for flows that cannot present a user JWT, such as third-party callbacks and OAuth redirects; those functions perform their own authentication or business authorization.

The function set is grouped around operational domains:

- account invitations, credential changes, account status, user administration, and business deletion;
- delivery-provider operations, webhook ingestion, polling, and tracking reconciliation;
- GA4, Meta Ads, and Google Sheets connectivity;
- email templates and sending, delivery events, courier push, business events, demand notifications, and monthly digests;
- storage and R2 janitors;
- delivery-note reopening and payout-statement generation.

Business-heavy mutations are often delegated to PostgreSQL RPCs. This allows the database to enforce tenant membership, locking, invariants, and atomicity while the edge function concentrates on authentication, external protocols, and response mapping.

### Communications worker

`ops/whatsapp-node/worker/` is a separate Node/TypeScript service. Its entrypoint starts database connectivity, media ingest, heartbeats, queue-depth reporting, instance management, a verified webhook receiver, peer-presence warmup, and self-presence handling.

The worker uses two data paths. Short SQL work runs through a transaction-compatible connection pool with no permanent `LISTEN`, search-path state, or session advisory locks. Realtime control messages and table-shaped access use a service-role Supabase client. This split lets many worker processes share database capacity without pinning a database backend per process.

Outbound work is queue-based. Dispatchers claim work, apply pacing and preparation rules, call the messaging provider, and mark completion, retry, or terminal failure through scoped database functions. Media ingest claims jobs with row locking and leases, fetches or decrypts media, writes it to R2, and records completion. Instance ownership is protected by renewable, node-scoped leases so a peer process can take over after a worker stops renewing.

## Operating model

Frontend requests reach the edge router through the self-hosted API gateway. Protected functions require a valid platform session at the router and usually repeat caller or tenant authorization inside the function. Public callbacks bypass only the router JWT requirement; they remain responsible for their own signature, secret, state, or service-level checks.

Edge source is deployed from the repository function tree to the self-hosted runtime. Project operating rules record an important deployment characteristic: warm runtime workers may retain an older module after files are synchronized. The documented release procedure therefore includes an edge-runtime restart, health wait, and smoke test. This is an operational control, not proof that the repository revision and live runtime were matched during this audit.

The communications worker is expected to run beside its messaging engine on a separate node. It receives internal webhooks, acknowledges accepted events quickly, and performs heavier processing after the response. It publishes a heartbeat and queue measurements, reconciles instance status against the messaging engine, and maintains dispatcher loops only for leases it owns. Broadcast wakes reduce polling latency, while timers and lease renewal provide recovery paths when events are missed.

## Controls/reliability

- Router-level JWT validation establishes a default protected posture. Functions that must accept external callbacks are explicitly enumerated rather than making the whole edge surface public.
- High-privilege functions authenticate the caller again and check role and business membership before using service-role access.
- The communications webhook path validates the target identifier and instance-specific secret, caps request-body size, rejects malformed payloads, and is documented as internal-network only.
- Queue claims use database locking and leases to prevent parallel workers from processing the same job. Completion and failure paths are represented explicitly.
- Node-scoped worker leases prevent a worker from dispatching another node's instances and enable takeover after lease expiry.
- Reconciliation fan-out is concurrency-bounded and guarded against overlapping runs. Restart attempts use a shared per-cycle budget to avoid a mass-restart surge.
- An owned-but-loopless backstop re-applies runnable state if a dispatcher vanished while its lease remained active.
- The worker fails fast on database startup, handles graceful shutdown, records unhandled rejections, and separates lightweight heartbeat state from dispatch processing.
- Storage cleanup uses staged quarantine and reference assertions rather than direct bulk deletion.

## Current evidence status

- **Live verified on 2026-08-24:** the edge runtime was healthy as part of the primary self-hosted stack. The authentication service and gateway path were also healthy. This confirms platform availability at capture time, not per-function revision parity or successful execution of every function.
- **Repository verified:** current source implements the edge router, 38 non-shared function directories, the Node communications worker, transaction-compatible database access, node-scoped leases, broadcast wakes, bounded reconciliation, heartbeat reporting, webhook verification, dispatch, and media ingest.
- **Historical evidence:** project records describe the self-hosted cutover, security remediation, queue and realtime hardening, and movement away from session-pinned worker behavior. Current source confirms the resulting design.
- **Not verified live:** direct access to the separate communications node failed during the read-only capture. Evolution, Redis, worker process, active dispatcher loops, worker heartbeat freshness, and queue drain were not independently observed.

## Risks/limitations

- Edge authorization is layered but not uniform: some functions rely on router JWT checks, some self-authenticate, and public callbacks use function-specific mechanisms. The allowlist and every service-role path require continuous review.
- The live audit did not hash or otherwise match deployed edge modules to repository source. A healthy edge container is not proof that all functions run the documented revision.
- Warm-worker caching makes a partial deployment procedure unsafe; release discipline must include restart and smoke verification.
- The worker is operationally separate from the primary host. That isolates load but creates another deployment, backup, monitoring, and access boundary.
- The communications webhook acknowledges accepted events before asynchronous handling finishes. A process failure in that interval can lose an event unless provider replay or later reconciliation restores it.
- The worker includes sophisticated recovery paths, but its current runtime health was not verified. No queue throughput, latency, or availability claim is made.
- Some Deno functions suppress static checking with `@ts-nocheck`, and the repository has no conventional test-file inventory. Build or syntax checks do not replace contract and failure-path tests.
- Public webhook endpoints remain exposed to malformed and replayed external traffic even when authenticated; rate, replay, and retention controls need ongoing validation per integration.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- `AGENTS.md` — self-hosted edge source-of-truth and deployment/restart procedure.
- `supabase/functions/main/index.ts` — function routing and default JWT boundary.
- `supabase/functions/` — current edge-function implementation tree.
- `supabase/functions/manage-users/index.ts` and `supabase/functions/delete-business/index.ts` — privileged caller and tenant checks.
- `supabase/functions/provider-integration/index.ts` and `supabase/functions/provider-webhook/index.ts` — logistics command and event paths.
- `ops/whatsapp-node/worker/src/index.ts` — worker lifecycle and subsystem startup.
- `ops/whatsapp-node/worker/src/db.ts` — transaction-compatible SQL and realtime client split.
- `ops/whatsapp-node/worker/src/webhook/server.ts` and `ops/whatsapp-node/worker/src/webhook/verify.ts` — internal callback boundary.
- `ops/whatsapp-node/worker/src/dispatcher/loop.ts` — outbound dispatch lifecycle.
- `ops/whatsapp-node/worker/src/dispatcher/instance-manager.ts` — leases, reconciliation, and loop recovery.
- `ops/whatsapp-node/worker/src/dispatcher/media-ingest.ts` — leased media-job processing.
