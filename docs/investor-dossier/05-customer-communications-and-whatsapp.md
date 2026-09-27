# Customer communications and WhatsApp

## Investor significance

In conversation-led commerce, the customer message is part of the order workflow. iGrowFast embeds WhatsApp into the same tenant, role, customer, and order model as the rest of the platform. That reduces the operational gap between answering a question, confirming an order, assigning an agent, checking fulfillment, and following up with the customer.

The engineering asset is broader than an inbox UI. The repository contains a multi-number product, a dedicated worker, durable outbound and media queues, realtime cache synchronization, assignment controls, and media storage workflows. This gives the platform control over routing and operational context while keeping the external messaging provider behind a replaceable integration boundary.

## What exists

Administrators have pages for WhatsApp numbers, number detail, conversations, assignments, and contacts. Commercial agents have a separate seller inbox whose accessible conversations and actions are constrained by assignment and role.

The conversation product implements:

- Multi-number inboxes with unread state, search, filters, archive/pin behavior, and per-conversation details.
- Agent assignment and bulk routing, including handling of pending scheduled messages when an agent is removed.
- Contacts, contact import, tags, shared quick replies, scheduled message sequences, and creator attribution.
- Text and media messages, reply context, pinned messages, read state, agent typing, and peer presence.
- Customer order history in the conversation header, with seller-specific restrictions on which orders can be opened.
- Conversation-linked cart and order creation in the commercial workflow.
- Number connection, status, profile, and configuration surfaces.

The worker integrates with Evolution API for outbound actions and inbound webhooks. It ingests media into an R2-backed media store, reconciles messaging instances, publishes heartbeat information, and participates in private database-backed broadcast channels.

## How it works

For outbound content, the application records an action in a durable queue. The worker claims eligible work atomically, applies schedule and pacing context, resolves the message content, sends it through the provider client, and marks the queue row sent, failed, or dead. Quick replies and scheduled messages can contain ordered multi-step text and media sequences.

For inbound content, provider webhooks are normalized into conversations and messages. Media is claimed through a separate concurrency-safe ingestion path, fetched, stored, and linked back to the message record. Customer identity resolution and phone-based order lookup connect the communications record to e-commerce history without requiring the agent to leave the inbox.

Realtime is topic-based rather than a broad subscription to every table. Administrators use one private business channel for conversation bumps, instances, quick replies, schedules, assignments, and tags. Agents use a private user channel for assignment-scoped updates. An open thread uses a private conversation channel for messages. Typing and presence use narrower ephemeral channels. Because broadcast delivery is at-most-once, reconnect handlers invalidate the relevant caches and reconcile from the database.

The worker has its own private node channel for control changes and queue/media wakes. Lease renewal, periodic reconciliation, and owned-but-loopless checks are designed to recover work if a broadcast is missed or a loop exits.

## Controls/reliability

The user-facing controls combine business scope, number scope, assignment scope, and private realtime-topic authorization. Admin and seller inboxes are separate. Seller order links are further restricted to orders attributed to that seller. Database policies and functions remain the authority behind those UI distinctions.

Outbound queue claims use row locking with `SKIP LOCKED`, allowing concurrent workers to avoid claiming the same job. Queue rows retain retry and terminal states. Media ingestion uses the same concurrency pattern. Worker leases, heartbeats, status reconciliation, queue-depth reporting, and realtime self-probes provide recovery and operational signals.

Media lifecycle code treats the WhatsApp media store separately from general application storage. Its cleanup implementation identifies references from messages, quick replies, schedules, avatars, and derived previews; it refuses unrelated buckets and aborts when references cannot be resolved. This is repository evidence of a safety design, not proof that a cleanup ran during this audit.

## Current evidence status

- **Live verified on 2026-08-24:** Realtime was healthy; WhatsApp and network queues existed; the legacy table-change publication was empty; the broadcast publication contained seven tables. The separate communications node was inspected directly this time: the dispatch worker, the WhatsApp provider API, its dedicated PostgreSQL instance, and Redis were **all healthy**, with the worker and provider containers running continuously for approximately four and six weeks. The node's provider session material is backed up off-site on a nine-hour freshness budget and was current at capture.
- **Repository verified:** inboxes, assignments, contacts, tags, quick replies, schedules, customer-order lookup, media, private broadcast consumers, durable dispatch, media ingestion, instance reconciliation, heartbeat logic, and lifecycle cleanup exist in source.
- **Historical record:** repository records describe the migration from broad table-change subscriptions to private broadcasts, queue self-healing, worker sharding, transaction-mode dispatch, server-side inbox filtering, and R2 media handling. They support design intent and prior execution, not current runtime health.
- **Live verified:** the media store was enumerated off-site and holds 4,946 objects totalling roughly 2.6 GiB, so media object availability is established. Note that this store is single-copy; see chapter 13.
- **Unverified:** successful send/receive delivery, phone-number connectivity, message throughput, current queue latency, and provider-account policy status were not tested, because exercising them would touch live customer conversations.

## Risks/limitations

Messaging depends on an external provider and the policies of WhatsApp. Session invalidation, provider API changes, rate limits, account restrictions, and media-fetch failures remain external risks. The platform can queue, retry, reconcile, and surface state; it cannot guarantee provider acceptance or final handset delivery.

Private broadcast is intentionally at-most-once, so correctness depends on database state plus reconnect reconciliation rather than on every realtime event arriving. A single business channel concentrates events for that tenant; very large per-business deployments would require load evidence and may eventually require re-sharding. No conventional automated test suite was found in the repository inventory.

## Evidence trail

- Admin and commercial WhatsApp routes: [src/App.tsx](../../src/App.tsx)
- Main conversation workspace: [src/whatsapp/routes/admin/Conversations.tsx](../../src/whatsapp/routes/admin/Conversations.tsx)
- Assignment console: [src/whatsapp/routes/admin/Assignment.tsx](../../src/whatsapp/routes/admin/Assignment.tsx)
- Quick replies and schedules: [src/whatsapp/routes/admin/conversations/QuickRepliesPanel.tsx](../../src/whatsapp/routes/admin/conversations/QuickRepliesPanel.tsx) and [src/whatsapp/routes/admin/conversations/ScheduledMessagesPanel.tsx](../../src/whatsapp/routes/admin/conversations/ScheduledMessagesPanel.tsx)
- Customer-order context: [src/whatsapp/routes/admin/conversations/CustomerOrdersButton.tsx](../../src/whatsapp/routes/admin/conversations/CustomerOrdersButton.tsx)
- Private realtime channels and reconciliation: [src/whatsapp/lib/queries/waChannels.tsx](../../src/whatsapp/lib/queries/waChannels.tsx) and [src/whatsapp/lib/queries/messages.ts](../../src/whatsapp/lib/queries/messages.ts)
- Worker dispatch and recovery: [ops/whatsapp-node/worker/src/dispatcher/loop.ts](../../ops/whatsapp-node/worker/src/dispatcher/loop.ts) and [ops/whatsapp-node/worker/src/dispatcher/instance-manager.ts](../../ops/whatsapp-node/worker/src/dispatcher/instance-manager.ts)
- Media ingestion and lifecycle: [ops/whatsapp-node/worker/src/dispatcher/media-ingest.ts](../../ops/whatsapp-node/worker/src/dispatcher/media-ingest.ts) and [supabase/functions/r2-media-janitor/index.ts](../../supabase/functions/r2-media-janitor/index.ts)
- Current live boundary: [docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md](17-current-evidence-snapshot-2026-08-24.md)
