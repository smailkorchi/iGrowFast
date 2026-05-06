# WhatsApp v2 — Deploy & Cutover Runbook

This is the operator's playbook to take the new schema + ingest pipeline from "applied to the database" to "running in production". Every step is reversible up to the cutover.

## What is built (already in the database)

| Phase | Status | What it is |
|---|---|---|
| **I**   schema | ✅ applied | 19 new `wa_*` tables, all RLS-on, FK-tight, unique-constrained, indexed |
| **II**  ingest | ✅ applied | 12 SQL functions: `wa_ingest_message`, `wa_ingest_status`, `wa_ingest_reaction`, `wa_ingest_contact`, `wa_ingest_group`, `wa_ingest_group_participant`, `wa_ingest_chat`, `wa_ingest_label`, `wa_ingest_label_assoc`, `wa_ingest_connection`, `wa_ingest_message_delete`, `wa_ingest_message_edit`, plus `wa_dispatch_event` router. Single-writer, idempotent, monotonic, race-safe. Test coverage: 60+ assertions all pass. |
| **III** webhook | 📁 file written, not deployed | `supabase/functions/evolution-webhook-v2/index.ts` (HMAC verify + enqueue) and `supabase/functions/wa-worker/index.ts` (drain queue) |
| **IV**  sync | 📁 file written, not deployed | `supabase/functions/evolution-sync-v2/index.ts` (calls ingest funcs only) and `supabase/functions/wa-reconcile/index.ts` (nightly diff vs Evolution) |
| **V**   compat | ✅ applied | Views `wa_v_legacy_conversations/messages/contacts/instances` that project the new schema in the OLD UI's expected shape |
| **VI**  data migration | 📁 file written, **not run** | `supabase/migrations/_PHASE_VI_DATA_MIGRATION.sql` (manual one-shot) |
| **VII** ops | ✅ pg_cron scheduled | `wa_worker_drain_30s` every 30 s, `wa_reconcile_nightly` daily |

## Pre-deploy required GUCs

Run once in the Supabase SQL editor:

```sql
ALTER DATABASE postgres SET app.settings.supabase_url      = 'https://zjkqprrfbibjoslvlmxf.supabase.co';
ALTER DATABASE postgres SET app.settings.service_role_key  = '<service-role-key>';
```

Without these, the pg_cron jobs will silently fail.

## Step-by-step cutover

### Step 1 — Deploy the four new edge functions

```bash
cd supabase
supabase functions deploy evolution-webhook-v2
supabase functions deploy wa-worker
supabase functions deploy evolution-sync-v2
supabase functions deploy wa-reconcile
```

Set their environment variables:

```bash
supabase secrets set EVO_API_URL='http://76.13.155.93:8083'
supabase secrets set EVO_API_KEY='<rotated>'
supabase secrets set WA_WEBHOOK_FALLBACK_SECRET='<random 32 bytes>'
supabase secrets set WA_WEBHOOK_ENFORCE_HMAC='false'  # flip to true after Evolution is signing
```

### Step 2 — Provision the new wa_instances row for the existing live instance

```sql
INSERT INTO wa_instances (business_id, evo_instance_id, name, evo_token, owner_phone_e164, status)
SELECT business_id,
       'b45de1a8-2a93-4686-9ebe-c9b07e5e69d0' AS evo_instance_id,
       instance_name, '<rotated-evo-token>',
       phone_number, status
FROM whatsapp_instances WHERE instance_name = 'royal-prestige-maroc';
```

The new row's `webhook_secret` column auto-populates with a random 32-byte hex.

### Step 3 — Switch Evolution's webhook to the v2 endpoint (per-instance)

```bash
INSTANCE=royal-prestige-maroc
SECRET=$(curl -s "https://zjkqprrfbibjoslvlmxf.supabase.co/rest/v1/wa_instances?name=eq.$INSTANCE&select=webhook_secret" \
         -H "apikey: <service-key>" -H "Authorization: Bearer <service-key>" | jq -r '.[0].webhook_secret')

curl -X POST "http://76.13.155.93:8083/webhook/set/$INSTANCE" \
  -H "apikey: mata123" \
  -H "Content-Type: application/json" \
  -d "{
    \"webhook\": {
      \"enabled\": true,
      \"url\": \"https://zjkqprrfbibjoslvlmxf.supabase.co/functions/v1/evolution-webhook-v2\",
      \"headers\": { \"x-wa-signature\": \"\${WA_HMAC_SHA256}\" },
      \"events\": [
        \"MESSAGES_UPSERT\",\"MESSAGES_UPDATE\",\"MESSAGES_DELETE\",
        \"CONNECTION_UPDATE\",\"CONTACTS_UPSERT\",\"CONTACTS_UPDATE\",
        \"GROUPS_UPSERT\",\"GROUP_UPDATE\",\"GROUP_PARTICIPANTS_UPDATE\",
        \"CHATS_UPSERT\",\"CHATS_UPDATE\",\"LABELS_EDIT\",\"LABELS_ASSOCIATION\"
      ]
    }
  }"
```

Note: Evolution v2.3.7 doesn't natively compute HMAC headers. Until we either patch Evolution or proxy through nginx (Phase VII.b), keep `WA_WEBHOOK_ENFORCE_HMAC=false` and rely on the URL being secret + RLS as defense.

### Step 4 — Disable the duplicate global webhook on the VPS

Edit `/root/docker-compose.yml`, set `WEBHOOK_GLOBAL_ENABLED=false`, then:

```bash
ssh root@76.13.155.93 'cd /root && docker compose up -d evolution_api'
```

This stops the duplicate-fire that doubles every event.

### Step 5 — Shadow mode validation (24 h)

Both v1 webhook (whatsapp_*) and v2 webhook are receiving the same events. After 24 h, run:

```sql
-- Per-instance message count comparison
SELECT
  i.instance_name,
  (SELECT COUNT(*) FROM whatsapp_messages WHERE instance_id=i.id) AS legacy,
  (SELECT COUNT(*) FROM wa_messages WHERE instance_id IN (SELECT id FROM wa_instances WHERE name=i.instance_name)) AS v2,
  (SELECT MAX(created_at) FROM whatsapp_messages WHERE instance_id=i.id) AS legacy_latest,
  (SELECT MAX(wa_timestamp) FROM wa_messages WHERE instance_id IN (SELECT id FROM wa_instances WHERE name=i.instance_name)) AS v2_latest
FROM whatsapp_instances i;
```

Acceptance: `v2 >= legacy` AND latest timestamps within 1 minute. If divergence > 1%, find the gap with `wa_webhook_events WHERE processing_error IS NOT NULL` before proceeding.

### Step 6 — Run the data migration

When confident:

```bash
psql $DATABASE_URL -f supabase/migrations/_PHASE_VI_DATA_MIGRATION.sql
```

This is wrapped in BEGIN/COMMIT. If the assertion at step 9 fails, the entire migration rolls back.

### Step 7 — Update the frontend (optional, mostly automatic)

The compat views `whatsapp_conversations`, `whatsapp_messages`, etc. are **view names with the same column shapes** as the old tables. The frontend `db.from('whatsapp_messages').select(...)` will Just Work. **Writes** still go to the legacy tables (which are now renamed `whatsapp_legacy_*`), so any direct write from the UI fails. To fix:

1. Replace direct `db.from('whatsapp_messages').upsert(...)` calls with `db.rpc('wa_ingest_message', { p_instance_id, p_payload })` calls.
2. Replace `db.from('whatsapp_conversations').update({ unread_count: 0 })` with `db.rpc('wa_mark_thread_read', { p_thread_id })`.
3. Replace `db.from('whatsapp_chat_settings').upsert(...)` with `db.rpc('wa_set_thread_pref', {...})`.

Search-and-replace effort is roughly 20-30 call sites in `WhatsAppInbox.tsx`.

### Step 8 — Drop the legacy tables (after 30 days of stable operation)

```sql
DROP TABLE whatsapp_legacy_messages CASCADE;
DROP TABLE whatsapp_legacy_conversations CASCADE;
DROP TABLE whatsapp_legacy_contacts CASCADE;
DROP TABLE whatsapp_legacy_groups CASCADE;
DROP TABLE whatsapp_legacy_group_participants CASCADE;
DROP TABLE whatsapp_legacy_jid_mappings CASCADE;
DROP TABLE whatsapp_legacy_labels CASCADE;
DROP TABLE whatsapp_legacy_chat_labels CASCADE;
DROP TABLE whatsapp_legacy_chat_settings CASCADE;
DROP TABLE whatsapp_legacy_pinned_messages CASCADE;
DROP TABLE whatsapp_legacy_starred_messages CASCADE;
DROP TABLE whatsapp_legacy_auto_replies CASCADE;
DROP TABLE whatsapp_legacy_fast_replies CASCADE;
DROP TABLE whatsapp_legacy_sync_jobs CASCADE;
DROP TABLE whatsapp_legacy_user_instances CASCADE;
DROP TABLE whatsapp_legacy_instances CASCADE;
DROP TABLE _audit_step1_conv_backup;
DROP TABLE _audit_step1_msg_link_backup;
```

## Rollback procedure (within first 30 days)

If anything is wrong post-cutover:

```sql
-- Drop the compat views
DROP VIEW whatsapp_conversations, whatsapp_messages, whatsapp_contacts, whatsapp_instances CASCADE;

-- Rename legacy tables back
ALTER TABLE whatsapp_legacy_messages       RENAME TO whatsapp_messages;
ALTER TABLE whatsapp_legacy_conversations  RENAME TO whatsapp_conversations;
ALTER TABLE whatsapp_legacy_contacts       RENAME TO whatsapp_contacts;
ALTER TABLE whatsapp_legacy_instances      RENAME TO whatsapp_instances;
-- ...etc for the rest

-- Repoint Evolution back to the legacy webhook URL
```

## Hardening backlog (Phase VII.b)

These are NOT required to ship the new pipeline but should be done in the next sprint:

1. **Caddy/nginx in front of Evolution API** — terminate TLS, rotate `mata123` to a 32-byte token, move secrets out of `infrastructure-secrets.md`.
2. **Patch Evolution to send `x-wa-signature` HMAC** — once done, set `WA_WEBHOOK_ENFORCE_HMAC=true`.
3. **Storage bucket `wa-media`** — create with private access, signed-URL reads. Background worker downloads each new media's `evo_direct_path` → uploads to bucket → fills `wa_media.storage_path`.
4. **Frontend per-message read-receipts on scroll** — IntersectionObserver fires `wa_mark_thread_read` per message as it enters viewport.
5. **Sound + Notification API + tab-title badge** — wired into `WhatsAppNotificationsProvider`.
6. **Service-Worker push** — for closed tabs. Reuse `push_subscriptions` table from couriers.
7. **Mobile long-press** — pointer-events handler in `MessageBubble`.
8. **Virtualize message list** — `react-window` over `messages` state.
9. **In-chat full-text search** — `pg_trgm` index on `wa_messages.text_content`.
10. **Drafts** — `wa_set_thread_pref(p_draft := text)` from composer onChange.

## Operational dashboards

Keep an eye on:

```sql
-- Webhook queue depth (should be 0 most of the time)
SELECT COUNT(*) FROM wa_webhook_events WHERE processed_at IS NULL;

-- Dead-lettered events (retry exhausted)
SELECT event_type, COUNT(*) FROM wa_webhook_events
 WHERE processed_at IS NULL AND retry_count >= max_retries
 GROUP BY event_type;

-- Per-instance liveness
SELECT name, status, last_event_at, now() - last_event_at AS lag
  FROM wa_instances ORDER BY last_event_at NULLS FIRST;

-- Active sync jobs
SELECT * FROM wa_sync_jobs WHERE status IN ('running','pending','paused');
```

## Test coverage summary

| Function | Tests | Status |
|---|---|---|
| utility helpers (jid_kind, normalize_phone, classify_*, status_rank, message_preview) | 37 | ✅ all pass |
| wa_resolve_contact + wa_resolve_thread | 16 | ✅ all pass |
| wa_ingest_message (insert, idempotent, monotonic status, OOO timestamp, group, reply, broadcast skip, protocol skip) | 25 | ✅ all pass |
| wa_ingest_reaction (add, update emoji, remove, unknown target, fromMe) | 8 | ✅ all pass |
| wa_ingest_contact + wa_ingest_group + wa_ingest_group_participant | 13 | ✅ all pass |
| wa_dispatch_event router (connection, upsert, update, delete, edit, contacts single + array, groups, participants, labels + assoc, unknown event) | 14 | ✅ all pass |

Total: **113 assertions across 80+ scenarios.**
