# 19. Backend Service and Data Catalog

> Classification: **Confidential — investor diligence material.** This chapter names services, jobs, and tables. It contains no credentials, endpoints, customer records, tenant names, or configured data values.

## Investor significance

The frontend is the visible half. This chapter enumerates the half that does the work: 38 deployed edge services, 30 scheduled jobs running unattended, 102 application tables, and 411 database functions carrying business logic that would otherwise live in fragile client code.

The pattern worth noting throughout is that **business rules live in the database and in server-side functions rather than in the browser.** That is why role permissions, money calculations, and tenant boundaries hold even when a client is out of date or hostile.

## Edge service catalog — all 38 non-shared functions

### Identity, invitations, and account lifecycle (14)

| Service | Purpose |
| --- | --- |
| `create-invitation` | Admin-gated minting of a single-use self-registration invitation |
| `check-invitation` | Public read-only validation of an invitation token |
| `consume-invitation` | Public self-registration where the invitee supplies their own identity |
| `send-invitation` | Invitation lifecycle messaging and state — send, remind with token rotation, revoke, delete |
| `signup-email` | Pre-account email verification gate before registration |
| `manage-users` | Administrative user management with caller validation and tenant scope |
| `account-status-change` | Admin-gated activate/deactivate with reason capture and notification |
| `request-credential-change` | Admin-gated credential-change link, emailed to the user |
| `check-credential-token` | Public token validation returning only a masked email |
| `confirm-credential-change` | OTP verification, then applies new email and/or password |
| `request-credential-otp` | Issues a six-digit OTP to the user's current email |
| `self-credential-otp` | Authenticated self-service OTP issuance |
| `self-credential-confirm` | Authenticated OTP verification and credential application |
| `request-password-reset` | Public self-service password reset from the login page |

### Business and platform governance (3)

| Service | Purpose |
| --- | --- |
| `delete-business` | Owner-gated business deletion, wiping the business and its non-owner users |
| `business-status-notify` | Notifies affected parties after a business is suspended or reactivated |
| `manage-email-accounts` | Owner-gated management of platform SMTP/IMAP/POP3 accounts |

### Logistics and provider reconciliation (7)

| Service | Purpose |
| --- | --- |
| `provider-integration` | Carrier adapter surface — parcel creation, batch creation, labels, city and network discovery |
| `provider-webhook` | Inbound carrier status events, classified against semantic status flags |
| `ozon-poll-webhook` | Polling adapter for a carrier without native webhooks |
| `quicklivraison-poll-webhook` | Polling adapter mirroring the same contract |
| `vitex-poll-webhook` | Polling adapter mirroring the same contract |
| `sync-tracking-statuses` | Scheduled reconciliation of parcel tracking state |
| `reopen-delivery-note` | Carrier-specific delivery-note reopening |

### Communications and notification (7)

| Service | Purpose |
| --- | --- |
| `send-email` | Shared email engine rendering any managed template by stable key |
| `mail-events` | Receiver for mail-server delivery-event webhooks, producing true delivered/bounced state |
| `auth-login-alert` | Security email on a new authenticated session |
| `send-courier-push` | Web Push delivery to courier devices |
| `send-payout-statement` | Collaborator payout statement with generated PDF |
| `monthly-digest` | Monthly performance digest to business administrators and media buyers |
| `demand-notify` | Demand received and resolved notifications |

### Acquisition and data integration (4)

| Service | Purpose |
| --- | --- |
| `google-analytics-fetch` | Authenticated proxy for the GA4 Data API |
| `meta-ads-fetch` | Authenticated proxy for the Meta Marketing Graph API |
| `meta-ads-oauth` | OAuth authorization flow for Meta advertising accounts |
| `sheets-sync` | Pulls connected spreadsheet rows into a guarded ingestion function |

### Storage lifecycle and platform (3)

| Service | Purpose |
| --- | --- |
| `storage-janitor` | Reference-aware reclamation of unreferenced application storage, deliberately narrow |
| `r2-media-janitor` | Equivalent reclamation for the communications media store |
| `main` | Router and token-verification boundary for the edge runtime |

## Scheduled automation — all 30 jobs

Every job runs unattended in the database scheduler. Cadence shown; no job requires an operator.

### Every minute (5)

`mediabuyer_open_ticket_refresh` · `seller_open_ticket_refresh` — rolling payout ledger refresh
`outbound_queue_reclaim_dispatching_minute` — reclaims stalled outbound message work
`scheduled_messages_drain_minute` — dispatches due scheduled messages
`unpin_expired_messages_minute` — expires pinned conversation messages

### Every 5–15 minutes (7)

`consolidate_split_conversations` (5m) · `wa-cache-janitor` (5m) — conversation hygiene
`tracking-sync-every-15min` · `ozon-poll-webhook` (15m) · `quicklivraison-poll-webhook` (15m) · `vitex-poll-webhook` (15m) — carrier reconciliation
`sheets-sync-poll` (15m, offset) — spreadsheet ingestion

### Hourly (2)

`check-expired-licenses` · `invitations-auto-revoke`

### Daily and six-hourly (5)

`generate-recurring-charges` (00:05) · `cron_history_purge` (03:20) · `purge-soft-deleted-orders` (03:00) · `outbound_queue_cleanup_daily` (03:30) · `invitations-auto-reminder` (every 6h)

### Weekly (7)

`order-status-history-retention-weekly` · `tracking-sync-runs-retention-weekly` · `webhook-logs-retention-weekly` — retention
`storage-janitor-quarantine` · `storage-janitor-purge` · `r2-media-janitor-quarantine` · `r2-media-janitor-purge` — two-stage storage reclamation with a delay between quarantine and purge

### Monthly (4)

`seller_month_close` · `mediabuyer_month_close` (1st, 00:05) — ledger period close
`monthly-digest-business` · `monthly-digest-mediabuyer` (1st, morning) — performance digests

## Data model — all 102 application tables

### Tenancy, identity, and governance (11)

`businesses` · `users` · `plans` · `platform_settings` · `business_payments` · `user_invitations` · `credential_change_requests` · `push_subscriptions` · `email_accounts` · `email_templates` · `email_log`

### Orders and catalogue (14)

`orders` · `order_items` · `order_statuses` · `order_status_history` · `products` · `accessories` · `product_accessories` · `customers` · `sales_channels` · `channel_aliases` · `sheet_ingest_rows` · `transactions` · `trns_payment` · `trns_purchase`

### Logistics — carrier lane (11)

`providers` · `provider_cities` · `provider_webhooks` · `company_parcels` · `company_zones` · `company_fees` · `company_delivery_notes` · `company_return_notes` · `company_payment_notes` · `company_payment_note_orders` · `company_return_note_orders`

### Logistics — internal courier lane (9)

`courier_parcels` · `courier_zones` · `courier_fees` · `courier_delivery_notes` · `courier_return_notes` · `courier_payment_notes` · `courier_payment_note_orders` · `courier_return_note_orders` · `courier_notifications`

The two lanes are deliberately symmetrical, so an order fulfilled by an internal courier and one fulfilled by a carrier produce the same downstream financial and reporting shapes.

### Parcel status and reconciliation (7)

`package_statuses` · `package_status_history` · `parcel_tracking_snapshots` · `parcel_change_demands` · `tracking_sync_runs` · `unmatched_provider_statuses` · `webhook_logs`

`unmatched_provider_statuses` is the exception queue: a carrier status that matches no known mapping is captured for human review rather than silently dropped.

### Geography (2)

`master_cities` · `zones` — the carrier and courier zone tables above bind to these

### Finance and payouts (10)

`seller_payments` · `seller_payment_txns` · `seller_demands` · `mediabuyer_payments` · `mediabuyer_payment_txns` · `mediabuyer_demands` · `expenses` · `expense_types` · `recurring_charges` · `seller_presences`

### Acquisition and analytics (8)

`campaigns` · `campaign_daily_entries` · `campaign_source_locks` · `ads_history` · `google_analytics_connections` · `meta_ads_connections` · `mediabuyer_ga_access` · `mediabuyer_meta_access`

`mediabuyer_ga_access` and `mediabuyer_meta_access` are per-media-buyer allow-lists: a collaborator sees only the analytics properties and advertising accounts explicitly granted at invitation time.

### Commercial documents (4)

`devis` · `factures` · `bons_commande` · `bons_livraison`

### Mail delivery (1)

`email_delivery_events` — which, together with the delivery log listed under governance above, carries terminal delivery truth

The ten groups above account for all 77 tables in the public schema.

### Communications — 25 tables

**Conversations and messages:** `conversations` · `messages` · `conversation_assignments` · `conversation_notes` · `conversation_tags` · `tags` · `agent_assign_cursor`

**Contacts and identity resolution:** `contacts` · `contact_profiles` · `contact_identifiers` · `jid_mapping` · `group_participants` · `merge_decisions` · `merge_review`

**Sending and automation:** `outbound_queue` · `scheduled_messages` · `quick_replies` · `number_pacing_state`

**Infrastructure:** `whatsapp_instances` · `wa_nodes` · `worker_health` · `worker_instance_leases` · `media_fetch_jobs` · `encryption_keys` · `og_cache`

The contact-identity cluster exists because one human may appear under several identifiers; the merge tables let the system propose and record identity decisions rather than guessing.

## Database logic surface

| Dimension | Count |
| --- | ---: |
| Public schema functions | 263 |
| Communications schema functions | 148 |
| `SECURITY DEFINER` functions (privileged, guarded) | 242 |
| Triggers | 119 |
| Row-level security policies | 280 |
| Indexes in `public` | 361 |
| Views | 2 |
| Extensions | 12 |

## Integration surface

| Category | Integrations |
| --- | --- |
| Carriers | Five adapters — Coliaty, AMEEX, OzonExpress, Vitex, Quick Livraison — covering parcel creation, batch creation, labels, tracking, delivery and return notes, city/network discovery, changes, and webhooks or polling |
| Advertising and analytics | Google Analytics 4, Meta Marketing Graph API with OAuth |
| Data ingestion | Google Sheets, with a review queue before commitment |
| Messaging | WhatsApp via the provider API, with a dedicated worker node |
| Mail | Self-hosted mail server with delivery-event webhooks, DMARC, BIMI, and dual DKIM signing |
| Notification | Web Push / VAPID |
| Storage | Object storage for application uploads and communications media, with reference-aware lifecycle tooling |
| Verification | Self-hosted email-reachability and geolocation services behind a hardened wrapper |

## Evidence status

- **Repository-verified:** all 38 edge-service directories and their stated purposes, drawn from the source headers.
- **Live-verified, 2026-08-24:** the 30 scheduled jobs, 102 tables, 411 functions, 242 privileged functions, 119 triggers, 280 policies, 361 indexes, and 12 extensions were counted directly in the production database. The five carrier adapters exist in source; three carriers were present as configured provider records.
- **Not established:** per-function deployment revision parity, successful execution of every service during the window, and effective-access testing of every privileged function.

## Evidence trail

- Edge services: `supabase/functions/`
- Schema and logic history: `supabase/migrations/`
- Communications worker: `ops/whatsapp-node/worker/src/`
- Current evidence snapshot: `docs/investor-dossier/17-current-evidence-snapshot-2026-08-24.md`
