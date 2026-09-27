# 06 — Integrations and External Systems

## Investor significance

iGrowFast is not a single-purpose storefront. Its integration layer joins commerce operations, delivery providers, advertising analytics, spreadsheets, business messaging, email, push notifications, and object storage into one tenant-aware operating system. This is strategically valuable because the difficult work is not merely calling third-party APIs; it is translating inconsistent external models into stable internal workflows for orders, parcels, campaigns, messages, and customer records.

The resulting asset is an integration fabric that can absorb provider differences behind internal contracts. A business can change a delivery provider or add a marketing connection without replacing the order, customer, or reporting domains. This lowers product fragmentation and gives iGrowFast a practical path to expand its partner network while keeping the core data model under its control.

## Architecture/capabilities

The repository implements several integration families:

- **Delivery and fulfilment.** `supabase/functions/provider-integration/index.ts` contains adapters for parcel creation, parcel batches, tracking, labels, delivery or pickup notes, provider city and network discovery, parcel changes, and webhook registration. The accepted repository audit identifies named support for Ozon, Coliaty, Ameex, Quick Livraison, Vitex, Sendit, and Delvo. Provider-specific fields and response shapes are translated into common tracking and parcel results.
- **Advertising and analytics.** `google-analytics-fetch` proxies authenticated GA4 reporting, including report batches and realtime queries. `meta-ads-oauth` handles connection establishment, while `meta-ads-fetch` covers account discovery, insights, campaign/ad-set/ad operations, budget and status changes, pixel views, and audience/page discovery.
- **Spreadsheet ingestion.** `sheets-sync` reads connected Google Sheets and hands rows to a database ingestion RPC that maps, resolves, deduplicates, and creates pending draft orders. This preserves review and order-domain rules rather than treating a spreadsheet as a direct database write path.
- **Messaging and customer communications.** The WhatsApp subsystem connects Evolution API events, a typed Node worker, private realtime channels, an outbound queue, media storage, assignments, presence, and customer/order lookup. SMTP sending and delivery-event ingestion provide a separate email path, while Web Push/VAPID supports courier notifications.
- **Storage.** Cloudflare R2 is used for media and backup-oriented object workflows. Repository janitors provide report, quarantine, and purge modes with reference validation before destructive work.

These integrations converge on the platform's own business, order, campaign, provider, customer, and communications records. External services remain replaceable endpoints; the internal data model remains the operational source of truth.

## Operating model

Browser code invokes tenant-facing edge functions or database RPCs. Edge functions authenticate the caller, resolve the business-scoped connection or provider configuration, call the external API, and normalize the result before returning it or persisting it. Background paths use scheduled database jobs, provider webhooks, or the communications worker rather than relying on an open browser tab.

Credentials are not intended to travel through the frontend. Analytics and advertising functions resolve protected connection material server-side. Google Sheets and GA4 use server-side service credentials with read-only external scopes where the source shows that boundary. Meta connections are represented by per-business records and accessed through tenant checks. Provider configuration is retrieved by the backend after caller authentication.

Inbound integrations follow separate trust paths. Delivery-provider callbacks enter the provider webhook surface; mail delivery events use a shared-secret or signature check; communications webhooks are verified against the target instance before processing. Scheduled pollers exist for providers that need reconciliation in addition to callbacks.

## Controls/reliability

- Authentication and tenant checks exist at the edge boundary, with Row Level Security and scoped RPCs providing a second enforcement layer in the database.
- OAuth state is signed and expiry-checked in the Meta flow. Connection access is rechecked against the caller's tenant-visible rows.
- Webhook receivers validate a provider- or instance-specific trust signal before applying events. Mail-event comparisons use constant-time checks.
- Spreadsheet ingestion relies on staging/deduplication and an order idempotency index. It creates pending drafts rather than silently converting every external row into an active order.
- Delivery adapters handle provider-specific validation, city mapping, batching, partial outcomes, and reconciliation. Provider failures are surfaced rather than collapsed into a generic success.
- Media janitors first enumerate references and abort on unresolved objects. Orphans are moved to quarantine before a later purge, making cleanup staged and recoverable.
- Email sending renders stable templates, escapes values in HTML contexts, selects a configured sender account, and records delivery attempts. A separate event receiver reconciles later delivery truth.

These controls are implementation evidence, not a certification claim. They reduce common integration risks but still require continuous operational review as providers change their APIs and policies.

## Current evidence status

- **Live verified on 2026-08-24:** the self-hosted application platform, edge runtime, authentication service, tunnel path, and mail containers were healthy during the read-only capture. Mail ports required for delivery were listening. This does not prove that every external provider call succeeded during the capture window.
- **Repository verified:** concrete source exists for delivery providers, GA4, Meta Marketing, Google Sheets, Evolution API/WhatsApp, R2, SMTP delivery events, Web Push/VAPID, and provider webhooks/pollers. The repository audit counted 38 non-shared edge-function directories.
- **Historical evidence:** project records describe integration hardening, response-envelope fixes, webhook reconciliation, storage cleanup, and mail-delivery truth work. Historical completion records are secondary to current source and live evidence.
- **Not verified live:** individual third-party account permissions, current token validity, webhook delivery from every provider, R2 object presence, application-level email delivery, and the communications worker runtime on its separate node.

## Risks/limitations

- Third-party API stability, rate limits, account policy, and commercial terms remain outside iGrowFast's control. Adapters reduce switching cost but do not eliminate partner dependency.
- Provider breadth creates ongoing regression and contract-testing work. The repository audit found no conventional `*.test.*` or `*.spec.*` files despite test scripts being configured.
- Some provider adapter paths log request or response payloads for diagnostics. Because those payloads can contain operational or customer fields, log redaction and retention require explicit review.
- The spreadsheet sync path currently reads the full configured tab on each sync; source comments identify modified-time and cursor optimization as future work.
- The audit did not verify credential rotation status or every external dashboard permission. No security certification is claimed.
- The communications node was network-visible but direct runtime inspection was blocked. Worker, Evolution, and Redis health are therefore not presented as current live facts.

## Evidence trail

- Current repository, historical, and live evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
- `supabase/functions/provider-integration/index.ts` — provider adapter contracts and action routing.
- `supabase/functions/provider-webhook/index.ts` — inbound delivery-provider event path.
- `supabase/functions/google-analytics-fetch/index.ts` — GA4 reporting proxy and authorization model.
- `supabase/functions/meta-ads-oauth/index.ts` and `supabase/functions/meta-ads-fetch/index.ts` — Meta connection and operating surface.
- `supabase/functions/sheets-sync/index.ts` — spreadsheet ingestion, authorization, and deduplication handoff.
- `supabase/functions/send-email/index.ts` and `supabase/functions/mail-events/index.ts` — SMTP send and delivery-event reconciliation.
- `supabase/functions/r2-media-janitor/index.ts` and `supabase/functions/storage-janitor/index.ts` — reference-safe storage cleanup.
- `ops/whatsapp-node/worker/src/` — communications webhook, dispatch, media, heartbeat, and reconciliation implementation.
