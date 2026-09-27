# 10 — Realtime, Automation, and Scale Engineering

## Investor significance

iGrowFast's operating model depends on timely coordination: new orders affect dashboards and inventory; parcel changes affect fulfilment; inbound messages affect shared inboxes; assignments change who may see or act on a conversation. The platform has therefore invested in database-originated events, private realtime topics, durable queues, server-side automation, and reconciliation after missed events.

This is an architectural asset because realtime is treated as an acceleration layer over authoritative database state, not as a separate source of truth. The application can update quickly when a broadcast arrives while still recovering by refetching durable state after a disconnect. That design is more resilient than assuming every websocket event is delivered exactly once.

## Architecture/capabilities

### Realtime event fabric

The current application uses private broadcast topic families scoped to a business, user, conversation, or worker node. Database triggers publish small domain events after writes. Frontend owners mount one business-level e-commerce channel and one consolidated WhatsApp business or user channel rather than opening a channel for every query hook. A single open conversation retains its own thread channel because its message stream is naturally narrower.

The e-commerce event family covers order, parcel, stock, and webhook changes. A layout-mounted channel republishes these events through a small in-app bus so multiple pages and the isolated WhatsApp query client can consume the same socket without duplicate topic joins.

The WhatsApp event family covers conversation bumps, messages, instances, quick replies, scheduled messages, assignments, and tags. Consumers patch high-value caches directly where the payload is sufficient and debounce broader invalidations for bursty operations. Message inserts and updates patch the open thread without a follow-up query; reconnect logic invalidates the thread and list roots to catch anything missed.

The accepted live capture found two publications: the legacy `supabase_realtime` publication contained zero tables, while the broadcast-messages publication contained seven. This confirms the current live platform is no longer relying on a broad table-change publication for the application surfaces represented by the migration history.

### Durable work and worker coordination

Outbound messages and media processing are backed by database queues. Workers claim jobs atomically, release database connections while waiting on external systems, and record terminal or retry state. `FOR UPDATE SKIP LOCKED` and leases permit parallel drainers without assigning the same row twice.

Communications instances are assigned to nodes. Worker processes claim renewable, node-scoped leases before starting dispatch loops. Control changes and queue wakes travel through a private node topic, removing the need for a permanently pinned database `LISTEN` connection. The current worker uses short transaction-compatible queries, a bounded reconciliation fan-out, a non-overlapping status pass, and a per-cycle restart budget.

### Scheduled automation and data scale

The live database contained 30 named `pg_cron` jobs. Repository automation includes provider polling, tracking synchronization, webhook and run-history retention, Google Sheets polling, demand notifications, monthly digests, storage quarantine/purge, and communications maintenance. Host-level timers separately cover backup, archiver monitoring, storage mirrors, restore drills, and watchdogs.

Scale work is also visible in the data access model: keyset lists, server-side counts, search RPCs, set-based updates, aggregate dashboards, bounded exports, hot-path indexes, private broadcast consolidation, and transaction-compatible workers. These choices remove client-side full-table downloads and fleet-global session dependencies from important paths. They demonstrate scale-oriented engineering, but they do not establish a tested maximum user or message capacity.

## Operating model

A transactional database write remains authoritative. When a trigger publishes an event, subscribed clients update or invalidate the relevant caches. Broadcast delivery is at-most-once, so subscribers mark channel errors and reconcile from PostgREST/RPC state after the socket returns. Window focus, page remount, and periodic backstops provide additional correction paths.

For worker operations, a private node feed carries instance-control and queue-wake events. Lease renewal periodically checks ownership, claims eligible work left by dead peers, stops loops after lease loss, and respawns an owned runnable instance if the loop disappeared. A periodic external-state reconciliation corrects missed messaging-engine connection updates and bounds simultaneous repair calls.

Automation is split by responsibility:

- database cron for data-local schedules, retention, and controlled edge-function invocation;
- edge functions for external protocols, notifications, reports, and storage maintenance;
- the communications worker for continuous dispatch, webhook ingest, media retrieval, presence, and instance reconciliation;
- host timers for infrastructure backup and watchdog duties.

This division keeps long-running communication tasks away from request-bound functions and keeps transactional enforcement in PostgreSQL.

## Controls/reliability

- Realtime topics are private and protected by topic-specific policies. Business and user feeds are scoped to permitted tenants or assignments; worker-node feeds are service-level only.
- Channel consolidation limits duplicate joins and repeated invalidations. Per-thread channels remain only where the narrower stream is operationally useful.
- Broadcast consumers explicitly treat events as at-most-once and refetch authoritative state after errors or timeouts.
- Bulk-event invalidations are debounced, and database triggers suppress or coalesce broadcasts for set-based operations where source migrations define that behavior.
- Queue claims use row locks, leases, retry scheduling, and terminal states. A worker crash does not permanently own a job.
- Worker leases are node-scoped and renewable. Loss of ownership stops the corresponding dispatcher; expired ownership can be claimed by another worker process on the assigned node.
- Reconciliation is concurrency-capped and protected from re-entry. A shared restart budget reduces the chance of a recovery storm against the messaging engine.
- Heartbeats carry active-number, queue-depth, dispatching, drain-rate, and last-dispatch signals into the database. Repository monitoring scripts can alert on stale worker state, although live freshness was not verified in this audit.
- Database and host automation have separate monitoring and backup paths, reducing reliance on a single scheduler.

## Current evidence status

- **Live verified on 2026-08-24:** Realtime was healthy; the legacy table-change publication was empty; the broadcast publication contained seven tables; queue tables existed; and 30 named database jobs were present and active. The communications node was inspected directly and its worker, provider API, database, and cache were all healthy.
- **Repository verified:** private business/user/conversation/node topics, database broadcast triggers, consolidated frontend channel owners, reconnect reconciliation, node sharding, queue wakes, transaction-compatible worker access, leases, bounded reconciliation, server-side search/count/list RPCs, and automation schedules.
- **Historical evidence:** the scale program records the transition from per-table/per-hook subscriptions and session-pinned worker coordination toward private broadcasts, consolidated channels, transaction pooling, node sharding, and server-side data operations. Current source confirms those design outcomes.
- **Not verified live:** current worker heartbeat freshness, queue depth or age, end-to-end message delivery, external uptime monitoring, and load behavior under a synthetic concurrency test.

## Risks/limitations

- Broadcast is at-most-once. Reconciliation limits stale state but cannot make a temporarily disconnected UI instantaneous.
- The realtime service was healthy during one capture window. No sustained load, reconnect storm, fan-out, or failover test was run for this dossier.
- The communications node is a separate operational dependency whose runtime could not be inspected. Repository self-healing logic is not evidence of current health.
- Thirty database jobs create scheduling and dependency complexity. Job ownership, duration, retries, and overlap need ongoing monitoring as data volume grows.
- Queue and worker designs enable horizontal participation, but no verified maximum node, tab, message, or order throughput is claimed.
- Historical plans contain old ceilings and future projections. Those numbers are deliberately excluded because this audit did not reproduce the tests and the implementation has since changed.
- No Grafana, Prometheus, or Loki runtime was verified. Existing database statistics, health checks, scripts, heartbeats, and alerts provide operational signals but not a unified observability platform.
- Search, aggregation, and keyset work cover important high-volume surfaces; the repository does not prove every page has been converted from legacy client-side patterns.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- `src/components/realtime/EcomBizRealtime.tsx` and `src/lib/ecomBus.ts` — single-channel e-commerce fan-out and reconnect semantics.
- `src/whatsapp/lib/queries/waChannels.tsx` — consolidated business/user channels and cache reconciliation.
- `src/whatsapp/lib/queries/messages.ts` — private conversation stream and reconnect refetch.
- `supabase/migrations/20260714150000_ecom_biz_r1a_orders_family.sql` — e-commerce broadcast triggers.
- `supabase/migrations/20260714190000_ecom_r1c_publication_empty.sql` — removal of the remaining application table from the legacy publication.
- `ops/box/whatsapp-schema/migrations/whatsapp_035_realtime_broadcast_authorization.sql` through `whatsapp_055_wa_node_wakes.sql` — communications broadcast authorization, migration, node sharding, and wake path.
- `ops/whatsapp-node/worker/src/db.ts` — transaction-compatible worker database access.
- `ops/whatsapp-node/worker/src/dispatcher/instance-manager.ts` — node leases, channel supervision, and bounded reconciliation.
- `ops/whatsapp-node/worker/src/dispatcher/loop.ts` and `media-ingest.ts` — durable queue drain paths.
- `supabase/migrations/20260714220000_d1_orders_list.sql` and `20260715040000_d7_customers_and_fixes.sql` — keyset pagination and server-side list contracts.
- `supabase/migrations/20260803150000_monthly_digest.sql`, `20260805100000_storage_janitor_schedule.sql`, and `20260805110000_r2_media_janitor_schedule.sql` — scheduled business and storage automation.
- `docs/DR_RUNBOOK.md` and `ops/systemd/` — infrastructure automation and recovery timers.
