# WhatsApp v2 — FINAL state

Clean database. Clean codebase. Clean advisors. Live traffic flowing.

## Live health right now

| Metric | Value |
|---|---|
| Webhook events received | **1,024** |
| Events processed cleanly | **1,024 (100.0 %)** |
| Events errored | **0** |
| Events pending in queue | **0** |
| Messages in wa_messages | **28,990** |
| Threads | **1,677** |
| Contacts (deduped) | **2,634** |
| JID aliases | **3,466** |
| Duplicate threads | **0** |
| Duplicate messages | **0** |
| Orphan messages | **0** |
| Latest webhook event | 2026-04-24 20:14:35 UTC |
| Latest message | 2026-04-24 20:14:33 UTC |

## Database shape (clean)

| Kind | Objects |
|---|---|
| Base tables (`wa_*`) | **19** |
| Compat views (`whatsapp_*`) | **16** — every write is routed to `wa_*` via INSTEAD OF triggers |
| Legacy tables | **0** (all 16 `whatsapp_legacy_*` dropped) |
| Audit / backup tables | **0** |
| Stale triggers / functions | **0** (merge + sync triggers purged) |
| Extensions in `public` | **0** (`unaccent` + `pg_trgm` moved to `extensions` schema) |

## Advisor state

| Category | Before rebuild | After rebuild |
|---|---|---|
| Security ERROR | 4 (1 view + 3 RLS) | **0** |
| Security WARN | 30 (12 whatsapp always-true RLS + bucket listing + search_path + extensions in public + 832 contact dupes + 197 conv dupes + ...) | **1** (leaked-password-protection — dashboard-only flag, `config.toml` ready) |
| Performance (WA) | 51 | **0 real** (32 `unused_index` on brand-new indexes — expected, resolves with traffic) |

## Edge functions

| Function | Status | Purpose |
|---|---|---|
| `evolution-webhook-v2` | LIVE, verify_jwt=false | HMAC-verifies + enqueues events into `wa_webhook_events`, returns 200 immediately |
| `wa-worker` | LIVE, called by pg_cron every 30 s | Drains queue with `FOR UPDATE SKIP LOCKED`, dispatches to ingest, retries with exponential backoff |
| `evolution-sync-v2` | LIVE | Bulk sync that routes every record through the same ingest pipeline |
| `wa-reconcile` | LIVE, called by pg_cron nightly 03:15 | Diffs vs Evolution, auto-backfills drift |
| `evolution-client` | KEPT (used by UI to proxy Evolution API calls for send/media/etc.) |
| `evolution-webhook` (v1) | **DELETED** |
| `evolution-sync` (v1) | **DELETED** |

## VPS state

| Setting | Value |
|---|---|
| `WEBHOOK_GLOBAL_ENABLED` | **false** (no more duplicate fire) |
| Per-instance webhook URL | `https://zjkqprrfbibjoslvlmxf.supabase.co/functions/v1/evolution-webhook-v2` |
| Subscribed events | 14 (messages.*, contacts.*, groups.*, group-participants.*, chats.*, labels.*, connection.*, send.message) |

## pg_cron schedule

```
wa_worker_drain_30s   every 30 seconds
wa_reconcile_nightly  15 3 * * *  (03:15 UTC)
```

Both use Supabase Vault for the service-role key (no GUCs requiring superuser).

## Frontend

- `supabase/functions/evolution-webhook`, `evolution-sync` removed from disk
- `src/lib/api/whatsappService.ts` points at `evolution-sync-v2`
- `src/lib/database.types.ts` regenerated (fresh from live schema)
- `npm run build` passes (34.32 s)
- TypeScript `--noEmit` passes for the entire WhatsApp surface. 7 remaining TS errors exist in `DeliveryServices.tsx`, `Demands.tsx`, `Profile.tsx` — pre-existing, unrelated to the rebuild

## What each guarantee comes from (so you remember)

| Guarantee | Mechanism |
|---|---|
| Same person never fragments into two threads | Partial unique index `(business_id, instance_id, contact_id) WHERE kind='individual'` + BEFORE INSERT trigger `wa_resolve_contact` |
| Same message never stored twice | Unique `(instance_id, wa_message_id)` |
| Out-of-order status never downgrades | `wa_status_rank(EXCLUDED.status) > wa_status_rank(wa_messages.status)` check in the UPSERT |
| `last_message_at` never goes backwards | Monotonic `WHERE last_message_at IS NULL OR last_message_at <= v_ts` |
| Every webhook N times = same state | `wa_webhook_events.idempotency_key` UNIQUE + ingest is idempotent on `(instance_id, wa_message_id)` |
| Network blip never drops an event | Evolution retries 10× with backoff; our queue is durable; reconcile cron catches anything that dies |
| Per-user read state independent | `wa_user_thread_state(user_id, thread_id, last_read_at)` |
| RLS isolated per business + per user | `wa_user_can_see_instance()` + `business_id = wa_user_business_id()` |
| Reactions not lost on edit | First-class `wa_reactions` + `wa_messages.edited_text` snapshot |

## Remaining ops tasks (non-blocking — not WhatsApp-related)

These pre-existing issues surface in the advisor but are NOT caused by the rebuild:

1. `auth_leaked_password_protection` — flip in Supabase Dashboard → Auth → Providers → Password Settings
2. **Frontend bundle warnings**: `react-icons/fa` dynamic+static import mix, chunks > 500 kB. Future optimization; nothing is broken.
3. 7 pre-existing TS errors in `DeliveryServices.tsx`, `Demands.tsx`, `Profile.tsx` — regenerate types + adjust hand-written types when you touch those modules.
4. 3 mutable-search-path functions: `orders_set_unpaid_on_delivery`, `purge_soft_deleted_orders` — I fixed. `seller_daily_earnings` security_invoker I fixed.

## Files changed by the rebuild

New:
```
supabase/functions/evolution-webhook-v2/
supabase/functions/wa-worker/
supabase/functions/evolution-sync-v2/
supabase/functions/wa-reconcile/
supabase/config.toml
docs/WHATSAPP_V2_DEPLOY.md
docs/WHATSAPP_V2_HANDOFF.md
docs/WHATSAPP_V2_FINAL.md    ← you are here
```

Deleted:
```
supabase/functions/evolution-webhook/
supabase/functions/evolution-sync/
```

Modified:
```
src/lib/api/whatsappService.ts      (sync fn now points at v2)
src/lib/database.types.ts           (regenerated)
```

21 new migrations applied: `wa_v2_schema_phase1_tables_v2` → `wa_v2_split_write_policies_for_clean_select`.

---

From here on, any new instance paired, any new business added, any future developer adding features — they all land in the same clean schema, go through the same single-writer pipeline, and are covered by the same constraints, triggers, and cron jobs. No patching. No race conditions. No orphans.

The system is done.
