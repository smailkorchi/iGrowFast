# WA Mancer Recon — 02: Database (the territory)

Recon date: 2026-07-05. Source: **live** WA Mancer Supabase project `xlhlezgpgrypdijynmqr` (region `eu-west-1`, Postgres 17.6.1, status ACTIVE_HEALTHY, created 2026-05-16), read-only via the `supabase-whatsappmancer` MCP server. Method: 8 parallel read-only agents — physical layer, types/views/triggers, function inventory, function source deep-read, RLS/grants/roles, platform surface, live-data profile, advisors/health. Every fact is from a live catalog query or `pg_get_functiondef`; nothing inferred from the repo.

This is the file `01-design-docs.md` defers to: "treat 01 as the map of the *design*, and a separate code/DB recon as the map of the *territory*." Where the two disagree, the DB (this file) wins.

**Drift check:** the live DB has **247 applied migrations**, first `20260517202252_init_extensions`, last `20260608230000_fix_invitations_created_by_nullable` — byte-identical set to `supabase/migrations/` in the repo (247 files, same last name). **Zero schema drift between repo and production.** The repo is a faithful map of the live schema; the live *data* (below) is a month newer than the last commit (2026-06-08).

---

## 0. One-screen facts

- **Single-tenant, single-user, single-number today.** 1 `whatsapp_instances` row, 1 `auth.users` / 1 `profiles` (role `admin`, `houssamtouilee@gmail.com`), 1 worker. There is **NO tenant/business column anywhere** — isolation is entirely `conversation_assignments` + a flat `user_role(admin,user)`. This is the central fact for the iGrowFast port: every ported table needs `business_id` added and every agent RLS predicate must AND on it.
- **Encryption at rest is real and load-bearing.** Message bodies, conversation previews, and instance secrets are pgcrypto `pgp_sym_encrypt` ciphertext (`bytea`), keyed by a single Vault secret `wa_mancer_envelope_key`. Plaintext is never stored; it is exposed only through 3 `security_invoker` `*_decrypted` views and 2 authenticated-callable decrypt RPCs.
- **The DB is the source of truth; the worker is the only sender.** No `pg_net`, no `supabase_functions` hooks — the DB makes zero outbound HTTP. Outbound messaging = `outbound_queue` rows drained by the Node worker via `pg_notify('outbound_enqueued')`. The worker is connected right now (`LISTEN "media_fetch_ready"`, heartbeat &lt;1 s old, 46 days uptime).
- **~97% of the database is its own telemetry.** DB size 1.34 GB. `system_logs` 658 MB (714k rows) + `metric_samples` 490 MB (1.85M rows) + `host_metrics` 113 MB (100k rows) + db/worker/r2 history ≈ 1.26 GB. Actual chat data is tiny: **870 messages, 361 conversations, 361 contacts** — under 20 MB combined.
- **Infrastructure LIVE, messaging DORMANT.** The single test instance ("kk", `+212631390469`) paired 2026-07-03 22:34, history-synced 361 chats / 870 messages in minutes, ran ~14 min of live traffic, disconnected 22:56 with `auto_reconnect=false`, and never reconnected. 4 outbound items are stranded ~27 h. Telemetry keeps accumulating; chat is frozen.
- **35 base tables, 3 views, 174 public functions, 22 `private` functions, 39 triggers, 16 cron jobs, 26 edge functions, 13 app enums, 1 Vault secret, 8 extensions.** All in `public` except a custom `private` schema (functions only — no tables).

---

## 1. Schemas & scale

Non-system schemas: `public` (all app relations), **`private`** (CUSTOM — 22 functions, **no tables/views**; holds the SECURITY DEFINER trust-root implementations), `auth`/`storage`/`realtime`/`vault`/`cron`/`graphql`/`graphql_public`/`extensions`/`supabase_migrations` (all standard Supabase).

Exact row counts (2026-07-05), grouped by what they are:

| Business data | rows | | Telemetry / infra | rows |
|---|---|---|---|---|
| messages | 870 | | metric_samples | 1,851,402 |
| conversations | 361 | | system_logs | 714,447 |
| contacts | 361 | | host_metrics | 100,726 |
| contact_identifiers | 361 | | db_metrics_history | 42,409 |
| contact_profiles | 346 | | worker_health_history | 41,484 |
| media_fetch_jobs | 196 | | r2_metrics | 4,153 |
| merge_review | 191 | | audit_log | 3,121 |
| outbound_queue | 59 | | app_cache | 37 |
| invitations | 11 | | worker_health / worker_instance_leases / number_pacing_state / dispatcher_snapshot / _cron_ingest_state | 1 each |
| profiles / whatsapp_instances | 1 each | | | |

**Empty tables (0 rows):** `conversation_assignments`, `conversation_notes`, `conversation_tags`, `tags`, `quick_replies`, `message_templates`, `scheduled_messages`, `group_participants`, `jid_mapping`, `merge_decisions`, `og_cache`. The empties matter: the whole agent-isolation model rides on `conversation_assignments`, which has **never held a row** in production (single admin user, no delegation exercised).

Dropped-column ordinal gaps (schema evolved in place, not rebuilt): `messages` (#8), `profiles` (#9), `quick_replies` (#4,5), `scheduled_messages` (#5,6), `whatsapp_instances` (#49–52).

---

## 2. Tables, by domain

Full column catalogs live in the recon transcripts; below is the load-bearing structure — keys, encryption, FK on-delete behavior, and the non-obvious constraints. All FKs to `whatsapp_instances`, `conversations`, `contacts` are `ON DELETE CASCADE` unless noted; all FKs to `auth.users` are `ON DELETE SET NULL`.

### 2.1 Instance / numbers
- **`whatsapp_instances`** (56 live cols, PK `id`, UNIQUE `evolution_instance_name`). The behavior-config god-table: 8 pacing columns, typing-sim (base/per-char/cap), 3 send caps (`daily 1500 / hourly 250 / minute_burst 5`), `send_rate_per_min`, lifecycle (`warming/established/cooling/banned`), `business_hours` jsonb (default tz `Africa/Casablanca`, 09:00–19:00, gate off by default), auto-assign (`enabled/strategy round_robin/user_pool uuid[]`), ~15 `wa_*` presence/privacy toggles, `pacing_mode` (`conservative/balanced/aggressive/custom`; preset locks the 8 columns unless custom). **17 CHECK constraints** bound every numeric. **Encrypted:** `evolution_api_token_ct`, `webhook_secret_ct` (bytea, 114 B each).
- **`number_pacing_state`** (PK `number_id`→instance): token-bucket state — `tokens numeric`, `last_refill_at`, `last_send_at`, `last_send_conversation_id`. One row auto-seeded per instance by trigger.
- **`dispatcher_snapshot`** (PK `instance_id`): denormalized per-instance queue gauges for the UI (queued/dispatching/dead_24h/sends_last_min).

### 2.2 Conversations / contacts / identity
- **`conversations`** (27 cols, PK `id`, UNIQUE `(instance_id, remote_jid)`). `is_group` is a **GENERATED** column (`remote_jid ~~ '%@g.us'`). **Encrypted:** `last_message_preview_ct` bytea. Soft-merge via `merged_into` (self-FK SET NULL). CHECKs tie `resolved`⇒`resolved_at`, `snoozed`⇒`snoozed_until`. 12 indexes (heavily over-indexed for 361 rows — 6.5 MB index vs 168 kB heap).
- **`contacts`** (PK `id`, UNIQUE `(instance_id, lid)` and `(instance_id, phone_jid)`). `merged_into` self-FK SET NULL with CHECK `no_self_merge`. `phone_source identifier_source`, `is_resolved`.
- **`contact_identifiers`** (PK `id`, UNIQUE `(instance_id, identifier)`) — the dedupe/resolution key table mapping every raw identifier→contact with `kind` + `source`.
- **`contact_profiles`** (PK `(instance_id, jid)`) — push_name/profile_pic cache keyed by raw JID.
- **`jid_mapping`** (PK `(instance_id, lid)`, UNIQUE `(instance_id, phone_jid)`) — lid→phone resolution. **0 rows.** Its trigger is the one disabled trigger in the DB (see §6).
- **`group_participants`** (PK `(instance_id, group_jid, participant_jid)`). 0 rows.
- **`merge_review`** (191 rows, no FKs — soft refs) + **`merge_decisions`** (0 rows) — the identity-merge audit/decision queue. 191 unreviewed split/backfill candidates.

### 2.3 Messages / media
- **`messages`** (35 live cols, PK `id`, UNIQUE `(instance_id, evolution_message_id)`). **Encrypted:** `body_ciphertext` bytea (pgp; prefix `c30d…` OpenPGP symmetric packet). Media columns point at R2: `media_storage_bucket`, `media_storage_key` (format `<instance_id>/<conversation_id>/<message_id>.<ext>`), `media_pending/failed_at`, `media_sha256`. `reactions jsonb` array (reactions are NOT rows — see §5.5). `hidden_for_user_ids uuid[]` (per-user delete). `idempotency_key uuid` (UNIQUE partial) for outbound send dedupe. CHECKs: `evolution_message_id` required after dispatch; `sent_by_agent_id` only for outbound; `revoked_by IN ('us','remote')`.
- **`media_fetch_jobs`** (worker-only queue; comment: "service_role only, drained via FOR UPDATE SKIP LOCKED"). Partial UNIQUE `(message_id) WHERE completed_at IS NULL` = one active job per message. RESTRICTIVE deny-all RLS.

### 2.4 Outbound pipeline
- **`outbound_queue`** (PK `id`, `seq bigint` monotonic). `status outbound_action_status(queued/dispatching/sent/failed/dead/cancelled)`, `action_type` (10 kinds incl. typing/mark_read/react/edit/delete/poll/contact), `payload jsonb`, `origin`, `priority`, `not_before`. A monster CHECK `outbound_queue_status_lifecycle` enforces the exact (dispatched_at, completed_at, evolution_msg_id) null-shape per status — the state machine is DB-enforced. Dispatch index: `(number_id, not_before, priority, seq) WHERE status='queued'`.
- **`scheduled_messages`** (0 rows) — jsonb multi-step campaigns drained by cron.

### 2.5 Users / roles / access
- **`profiles`** (PK `id`→auth.users, UNIQUE `email citext`, `role user_role`, `is_active`, `avatar_config jsonb` with a `validate_avatar_config` CHECK). 1 row.
- **`conversation_assignments`** (PK `(conversation_id, user_id)`) — **the isolation linchpin.** Partial UNIQUE `(conversation_id) WHERE is_group=false` enforces DM-singleton. `is_group` denormalized by trigger. 0 rows.
- **`invitations`** (PK `id`, UNIQUE `token_hash bytea`). Lifecycle CHECK (`consumed` XOR `revoked`), `failed_attempts`, 7-day default expiry. 11 rows (10 consumed, 1 revoked) but only 1 surviving profile — repeated test/reset cycles.

### 2.6 Content config (all 0 rows)
`tags`, `conversation_tags`, `conversation_notes`, `quick_replies`, `message_templates` — standard inbox furniture, unused in this single-admin deployment.

### 2.7 Telemetry / cache (the 97%)
`system_logs` (unified log sink, `log_source` 14-value enum incl. `platform_*`, no FKs), `metric_samples` (**no PK** — BRIN + btree only, 1.85M rows), `host_metrics`, `db_metrics_history`, `worker_health` + `worker_health_history`, `r2_metrics`, `app_cache` (SWR stats cache), `og_cache`, `_cron_ingest_state` (singleton cron watermark, `{id:true, last_runid}`). These are the observability stack, not the product.

---

## 3. Enums (13 app enums)

`conversation_status`{open,pending,resolved,snoozed} · `identifier_kind`{phone,lid,group} · `identifier_source`{inferred,history_sync,contacts_upsert,same_envelope_alt,group_participants,phone_book,human} (trust-ordered — see §5.6) · `instance_lifecycle_state`{warming,established,cooling,banned} · `instance_status`{pending,connecting,connected,disconnected,error} · `log_level`{debug,info,warn,error} · `log_source`{worker,edge,cron,db,evolution,caddy,redis,client,platform_api,platform_postgres,platform_auth,platform_storage,platform_realtime,platform_edge} · `message_direction`{inbound,outbound} · `message_kind`{text,image,video,audio,document,sticker,location,contact,reaction,system,poll} · `outbound_action_status`{queued,dispatching,sent,failed,dead,cancelled} · `outbound_action_type`{send_text,send_media,mark_read,typing_start,typing_stop,react,edit_message,delete_message,send_poll,send_contact} · `outbound_origin`{interactive,forward,scheduled,batch,auto,quick_reply} · `user_role`{admin,user}.

One composite type: `invitation_claim_result(ok, reason, id, target_role, email, full_name)`. No domains, no materialized views.

---

## 4. Views — the decryption boundary

All 3 are `security_invoker=true`, owner `postgres`. This flag is load-bearing: it makes the view run with the *caller's* RLS, so base-table policies (assignment/admin) still apply. **If security_invoker is ever dropped, these become owner-privileged and bypass RLS** (see hazard §13.2).

- **`messages_decrypted`** — `messages` with `body` = `_decrypt_message_body(id)` in place of ciphertext; filters `NOT (auth.uid() = ANY(hidden_for_user_ids))`. Omits `hidden_for_user_ids`, `idempotency_key`, `media_sha256`.
- **`conversations_decrypted`** — `conversations` with `last_message_preview` = `_decrypt_conv_preview(id)`, joined to `contacts.book_name`; filters out `merged_into IS NOT NULL` and `@lid` JIDs.
- **`worker_health_status`** — `worker_health` + computed `seconds_since_heartbeat` and `health` (`healthy` <15 s, `stale` <60 s, else `dead`).

---

## 5. Functions & mechanics (174 public + 22 private)

Architecture pattern throughout: **public INVOKER wrapper → private SECURITY DEFINER core.** `public.is_admin()`/`has_role()`/`audit()`/`admin_set_user_role()`/`set_instance_token()` are one-line INVOKER shims delegating to `private.*` SECDEF implementations. Every function pins a `search_path` (170 → `''`, 4 → `public`; **zero unpinned SECDEF** — clean). All owned by `postgres`.

### 5.1 Queue claim (atomic, no SKIP LOCKED)
`queue_claim_next(number_id, content_allowed)` (service_role) refuses if instance `worker_paused` or `banned`, picks one candidate by a humanized ORDER BY, then claims via **compare-and-set**:
```sql
UPDATE outbound_queue SET status='dispatching', dispatched_at=now(), attempts=attempts+1
 WHERE id=v_id AND status='queued' RETURNING *;
```
No `FOR UPDATE SKIP LOCKED` in the queue path. Single-consumer safety comes from the **lease** (one worker per number) + the `AND status='queued'` recheck. Candidate ordering: content actions before passive (mark_read/typing); then conversations *not* touched in the last 30 s first; then `priority, seq`. `content_allowed=false` (quiet hours/caps) restricts to passive actions.

State transitions are all guarded (`WHERE … AND status=<expected>`, raise on 0 rows): `queue_mark_sent` (dispatching→sent, stamps message `SERVER_ACK`, updates pacing `last_send*`), `queue_mark_failed` (dispatching→queued with `not_before=now()+retry_secs`), `queue_mark_dead` (→dead, rolls back optimistic delete tombstone). **Retry-count-before-dead and send jitter are NOT in the DB — they live in the worker binary** (UNVERIFIED here by design).

### 5.2 Worker leases (fencing)
`worker_instance_leases` PK `(instance_id)` = at most one holder, structurally. `worker_claim_instance_leases` inserts missing rows `ON CONFLICT DO NOTHING`, then takes over **only expired** leases (`WHERE leased_until < now()`), bumping `lease_seq+1` as a fence token. `worker_renew_instance_leases` extends only rows still matching `worker_id` (a lost lease silently matches 0 rows). Crash recovery: an every-minute cron flips `dispatching` rows older than 5 min back to `queued`.

### 5.3 Pacing (token bucket with debt)
`pacing_take_token(number_id, rate, capacity)` serializes with `SELECT … FOR UPDATE`, then:
```sql
v_refill := LEAST(cap, tokens + elapsed_secs * rate / 60.0) - 1;
IF v_refill >= 0 THEN wait := 0;
ELSE wait := CEIL(-v_refill / (rate/60.0) * 1000); v_refill := GREATEST(v_refill, -1); END IF;
```
Returns wait in **ms**; the token is always spent (debt model), caller sleeps then sends. Hard caps are a separate read-only check: `dispatch_gate_check` counts `sent` content actions in rolling 1h/24h windows vs `hourly_send_cap`/`daily_send_cap` and returns the exact `resume_at`. Enforcement is worker-side; the DB only computes.

### 5.4 Encryption (Vault-read per call, plaintext never persisted)
`_envelope_key()` (SQL STABLE, EXECUTE postgres+service_role only) = `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='wa_mancer_envelope_key'`. **No app-level cache** — re-read every call (Vault unwraps the DEK internally). `encrypt_text`/`decrypt_text` are pgcrypto `pgp_sym_encrypt/decrypt` wrappers, service_role-only. The **only JWT-reachable** decrypt surface is `_decrypt_message_body`/`_decrypt_conv_preview` (authenticated+service_role): they decrypt unconditionally for postgres/service_role/supabase_admin, otherwise require `is_admin() OR assignment-exists`, and **return NULL (silent) on denial** rather than raising. Plaintext is only ever returned, never written — persisted ciphertext lives solely in `messages.body_ciphertext`, `conversations.last_message_preview_ct`, and the two instance-secret columns.

### 5.5 Ingest & dedupe (idempotent)
`ingest_message` (2 overloads, service_role — called by the worker over a direct pg pool, not PostgREST): canonicalize `@lid`→phone → resolve `contact_id` (`chase_merged_into`, 32-hop cap) → conversation upsert `ON CONFLICT (instance_id, remote_jid) DO UPDATE` → **message dedupe** `INSERT … ON CONFLICT (instance_id, evolution_message_id) DO NOTHING RETURNING id`. All preview/unread side effects are wrapped `IF v_msg_id IS NOT NULL`, so a duplicate delivery is a full no-op. Unread only increments for inbound messages `>= now()-2min` (history sync doesn't inflate unread). Reactions are jsonb on `messages.reactions` (per-sender dedupe by filtering same `senderJid`), not rows. Media dedupe: partial UNIQUE on `media_fetch_jobs(message_id) WHERE completed_at IS NULL`; `fail_media_fetch` backs off `least(60, 5*2^attempts)` min, terminal at 5 attempts → `messages.media_failed_at`.

### 5.6 Identity resolution
`resolve_identity` maps identifiers→contacts with **trust ranking** `identifier_trust(source)`: inferred 0 < history_sync 1 < contacts_upsert 2 < same_envelope_alt 3 < group_participants 4 < phone_book 5 < human 6. Phone fields only overwrite when new trust ≥ old AND no other contact owns that phone_jid. LID consolidation: the disabled `private._on_jid_mapping_resolved` trigger (superseded — see §6) and the every-minute `_cron_consolidate_split_conversations`→`merge_conversation` (soft-tombstone `merged_into` + rewrite queued payload JIDs). A second `private.merge_conversations` does hard-delete merges with **id-ordered `FOR UPDATE`** locking to avoid deadlock (the public `merge_conversation` locks survivor-then-loser unconditionally despite its "deterministic order" comment — a latent lock-ordering inconsistency).

### 5.7 Isolation & roles
`_assert_conversation_access(conv_id)` is called at the top of every user-facing content RPC (`send_message`, `send_typing`, `send_reaction`, `send_read_receipt`, `delete_message`, `edit_message`): raises `unauthenticated` if no `auth.uid()`, else `forbidden_not_assigned` unless `is_admin() OR EXISTS(conversation_assignments WHERE conversation_id=$1 AND user_id=auth.uid())`. Returns the conversation row to save a fetch. `private.is_admin()`/`has_role()` (SECDEF, STABLE, authenticated-executable) = `EXISTS(profiles WHERE id=auth.uid() AND role='admin' AND is_active)`. `bootstrap_admin` (service_role) refuses if any admin exists; role/active setters block self-demote/self-deactivate. Auto-assign trigger `_auto_assign_on_inbound` (round-robin on `last_auto_assigned_at` over the instance pool) skips history-sync (>2 min old), groups, unresolved `@lid`, disabled instances, already-assigned.

### 5.8 Anon-reachable functions (the only 3)
Exhaustive: `_delivery_rank(text)` and `identifier_trust(identifier_source)` (both INVOKER, immutable, pure — harmless) and **`_cron_purge_metric_samples()` — SECDEF, volatile, anon-EXECUTE** (proacl explicitly grants anon X). This is a real defect: an unauthenticated caller can invoke a SECURITY DEFINER metrics-purge over `/rest/v1/rpc/_cron_purge_metric_samples`. Corroborated by the security advisor (§12). No function has a NULL proacl, so there is no *silent* anon inheritance — every grant is explicit.

Other privileged surfaces (SECDEF, service_role-only unless noted): `reveal_instance_token`/`reveal_instance_webhook_secret` (return plaintext secrets — protected by grant only, no in-body check), `cache_get_or_compute` (SECDEF that dynamically executes a passed `regprocedure` as postgres — OWNER-only execute, not externally reachable), the whole `admin_*` family (authenticated-executable, gated entirely by in-body `is_admin()`).

---

## 6. Triggers (39; 1 disabled)

`_set_updated_at` on 9 tables. Audit-echo triggers (10) funnel row changes into `private.audit` → hash-chained `audit_log`. Load-bearing behavior triggers: `_touch_conversation_on_message`, `_sync_conv_last_outbound_status`, `_auto_assign_on_inbound` (WHEN inbound), `_ensure_number_pacing_state` (seeds pacing on instance insert), `_outbound_queue_notify` (2 triggers → `pg_notify('outbound_enqueued')` on queued INSERT / re-queue), `_audit_log_hash` (BEFORE INSERT: advisory-lock-serialized SHA-256 chain, genesis 32 zero bytes), `_set_assignment_is_group` (feeds the DM-singleton partial index), `_release_dms_on_profile_deactivation` (returns DMs to pool on deactivate).

One custom trigger on `auth.users`: `on_auth_user_created` → `public._on_auth_user_created` (profile bootstrap). **No custom trigger on `auth.sessions`** (unlike iGrowFast's login-alert trigger). No custom triggers on `storage.objects`.

**The single disabled trigger:** `jid_mapping_resolved` on `public.jid_mapping` → `private._on_jid_mapping_resolved` — the only reference into `private` from a table trigger, disabled by migration `20260601050031_phase0_disable_jid_mapping_resolved_trigger` (superseded by the cron-based consolidation path).

6 event triggers + the `pg_settings` rules are all Supabase-standard; no custom event triggers.

---

## 7. Authorization (RLS + grants + roles)

**Model:** flat `admin`/`user`. Every non-admin policy predicate is the same shape — `EXISTS(conversation_assignments ca JOIN conversations c … WHERE c.instance_id = <table>.instance_id AND ca.user_id = auth.uid())` — i.e. a user sees a row only if they're assigned to a conversation on that instance (or `is_admin()`). Policies call unqualified `is_admin()`, which resolves to `public.is_admin()` (INVOKER) via search_path.

RLS is enabled on all 34 policied tables. Notable exceptions and holes:
- **`_cron_ingest_state`: RLS DISABLED** (but service_role-only grant, so anon/authenticated still can't reach it — advisor flags it anyway).
- **6 RLS-enabled-no-policy tables** (deny-all): `app_cache`, `db_metrics_history`, `host_metrics`, `metric_samples`, `og_cache`, `r2_metrics` — service_role-only.
- **`media_fetch_jobs`: RESTRICTIVE deny-all** to anon+authenticated (`false`) — service_role only, deliberately.
- **Two `qual = true` unrestricted reads**: `number_pacing_state` and `quick_replies` let *any* authenticated user read *every* row. Pacing state leaks per-number throttle config; in a multi-tenant port this is a cross-business read hole.
- **Storage:** `storage.objects`/`storage.buckets` grant full 7-priv to anon+authenticated but have **zero RLS policies** — currently blocked only by RLS-enabled-no-policy, and there are no buckets (media is on R2). First careless policy unlocks the broad grants.

**The default-ACL trap (systemic):** `pg_default_acl` for `postgres` AND `supabase_admin` in `public` (and `postgres` in `storage`) grant **anon + authenticated full table privileges (`arwdDxtm`), EXECUTE on all functions, and `rwU` on all 9 sequences** for every newly created object. Live proof it already fired: `dispatcher_snapshot` and all three `*_decrypted` views carry unintended full anon/authenticated DML. The decrypted views are the sharp edge — anon holds INSERT/UPDATE/DELETE/**TRUNCATE**/SELECT on decrypted-content views, neutralized *today* only by `security_invoker=true` + anon having no base grants. This is the same "grant-all-to-anon" pattern flagged in the iGrowFast dev-branch clone incident. Sequences are also anon-writable (`setval` desync nuisance).

**Roles:** standard Supabase set + one non-standard **`cli_login_postgres`** (LOGIN-capable, no super/bypassrls — verify what it inherits and who holds its credentials). BYPASSRLS: postgres, service_role, supabase_admin, supabase_etl_admin, supabase_read_only_user (all expected). `vault` and `cron` schema USAGE correctly withheld from anon/authenticated.

---

## 8. Cron (16 jobs, all active)

Per-minute: `worker_health_alert` (2), `reclaim_stale_dispatching` (3, crash recovery), `scheduled_messages_drain` (5, the **only** `FOR UPDATE SKIP LOCKED` in the system), `unpin_expired_messages` (6), `snapshot_worker_health` (8), `ingest_cron_runs` (11), `snapshot_db_metrics` (13), `consolidate_split_conversations` (15). Every-30-seconds: `private.cache_warm` (9). `*/5`: `private.cache_janitor` (10). Daily 03:00–04:00: `outbound_queue_cleanup` (1, deletes sent/cancelled >7 d), `lifecycle_auto_promote` (4, warming→established after 30 d paired + 0 dead in 7 d), `prune_system_logs` (7), `prune_host_metrics` (12), `prune_r2_metrics` (14), `purge_metric_samples` (16). Run health: all green; a single clustered failure at 2026-07-01 01:26 (one restart event), no recurring failures. Per-minute jobs each have ~10,080 successes over the ~7-day retention window.

The DB's CPU budget is spent on this machinery + realtime WAL polling, not inbox load: pg_stat_statements top-3 by total time are the realtime wal2json poll (2.37M calls), `_cron_ingest_cron_runs` (555 ms mean), and `private.cache_warm`.

---

## 9. Extensions / Vault / Realtime / Storage / pg_net

- **Extensions (8, clean):** plpgsql, pg_cron 1.6.4, pgcrypto 1.3, uuid-ossp 1.1, pg_trgm 1.6, pg_stat_statements 1.11, citext 1.6, supabase_vault 0.3.1. **None in `public`.** Notably absent: pg_net, pgsodium (library preloaded, extension not created), pg_graphql, vector.
- **Vault:** exactly **1 secret** — `wa_mancer_envelope_key` ("application-layer envelope master key," created 2026-05-17, never rotated). This single key is the root of all message/secret encryption.
- **Realtime:** `supabase_realtime` publication broadcasts **14 tables** (audit_log, conversation_assignments, conversation_notes, conversation_tags, conversations, dispatcher_snapshot, message_templates, messages, quick_replies, scheduled_messages, system_logs, tags, whatsapp_instances, worker_health). `realtime.messages` has 0 rows and no RLS policies (broadcast/presence authorization unused). 2 active logical replication slots, no WAL buildup.
- **Storage:** **completely empty** — 0 buckets, 0 objects. Migration history shows `chat_media_storage_bucket` was superseded by R2 (`media_storage_r2`, `retire_chat_media_storage_policies`). Media lives in **Cloudflare R2 bucket `wamancer-media`**, keyed `{instance_uuid}/{message_uuid}`; `r2_metrics` tracks its bytes/ops/egress.
- **pg_net / webhooks:** not installed. No `net` schema, no `supabase_functions` hooks. **The DB makes no outbound HTTP** — all external I/O is via edge functions and the worker.
- **DB config:** Postgres 17.6, `wal_level=logical`, WAL-G archiving ≤120 s, `statement_timeout=120 s`, `row_security=on`, scram-sha-256. Small instance (60 conns, ~224 MB shared_buffers). All stock Supabase.

---

## 10. Migrations / edge functions / branches

- **247 migrations**, repo-identical (see header). The migration names read as a full build diary: init → roles/profiles/vault key → instances/conversations/messages → assignments → outbound_queue → pacing → worker leases → decrypted views (5 iterations hardening the decrypt ACL) → contacts/jid identity truth (P1–P3) → LID consolidation → stats/cache/monitoring layer (the last ~80 migrations are almost all telemetry).
- **26 edge functions**, all ACTIVE, all `verify_jwt=true` **except** `check-invitation` and `consume-invitation` (pre-auth onboarding). Detail is in `03-edge-functions.md`.
- **Branches:** `list_branches` errored ("Project reference is missing") — consistent with branching not enabled, but not definitively confirmed (UNVERIFIED).

---

## 11. Live data — what actually happened

One instance ("kk", `+212631390469`, evolution name `kk-o5k36wmn`) tells the whole story:
- **Paired** 2026-07-03 22:34:52 → **full-history sync** created 361 conversations + 870 messages between 22:34:53 and 22:48:57 (the `created_at` window is 14 min; `whatsapp_timestamp` spans 2026-02-04 → 2026-07-03, i.e. the imported backlog). **Disconnected** 22:56 (`status='disconnected'`, `status_detail='reconciled:close'`), `auto_reconnect=false`, never came back. `history_synced_at` is NULL, `sync_progress=0` — the sync was interrupted.
- **Messages:** 496 inbound / 374 outbound; kinds text 625, audio 101, image 83, system 46; delivery mostly DELIVERY_ACK/READ. **631 have encrypted bodies**; 198 reference media, **164 have `media_failed_at`** (WhatsApp CDN URLs expired before fetch — permanent). 192 of 361 conversations have zero messages (history-sync created chat shells with no importable content).
- **Outbound queue:** 55 sent, **4 queued and stranded ~27 h** (oldest enqueued 22:48:44) because the instance is offline. `number_pacing_state` shows tokens 3.95, last send 22:48:40.
- **Worker:** `wa-mancer-worker-1` on host `wa-mancer-worker`, v0.1.0, started 2026-05-19 (46 d uptime), heartbeat <1 s old, lease renewing every ~60 s, `active_numbers=0, queue_depth=4`. **Alive and idle.**
- **Contacts:** 361 — 48.5% phone-resolved, 51.5% lid-only; 95.6% have push_name, 78.1% profile_pic. 191 unreviewed merge candidates (161 split, 30 backfill-conflict).
- **Integrity:** all referential spot-checks clean (0 orphans across messages/conversations/instances/queue/media/contacts). Anomalies are operational, not structural: 4 stranded sends, 164 dead media fetches, 192 empty conversations, 191 pending merges.

**Verdict: infrastructure LIVE, messaging DORMANT for ~27 h.** A single interrupted test pairing, worker idling on telemetry.

---

## 12. Health / advisors

- **Security advisors (74):** 1× anon-executable SECDEF (`_cron_purge_metric_samples` — real, §5.8); 66× "authenticated can execute SECDEF" (the entire RPC API surface — by design, gated in-body; the two `_decrypt_*` and `set_instance_webhook_secret` warrant the closest source review); 6× RLS-enabled-no-policy (§7, benign deny-all); 1× leaked-password protection disabled (Auth setting).
- **Performance advisors:** 2 unindexed FKs (`contacts.merged_into`, `conversations.merged_into`); `metric_samples` has **no primary key** (and is the 2nd-largest table); 39 unused indexes; ~30 multiple-permissive-policy warnings (the `_admin_all` + `_agent_select` pairs on contact/merge tables). Overall the chat tables are 20–40× over-indexed for current volume — 175 indexes have never been scanned (43 MB).
- **Runtime:** 33 connections, none idle-in-transaction; worker `LISTEN`ing; autovacuum healthy (watch `metric_samples`: 234k dead tuples pending). No errors/FATAL in postgres logs; API traffic is 100% 2xx and almost entirely the monitoring ingest pipeline; zero auth events in 24 h.

---

## 13. Surprises / merge hazards (for the iGrowFast port)

1. **No tenant column, anywhere.** Isolation is 100% `conversation_assignments` + flat `admin/user`. Every ported table needs `business_id`; every RLS predicate (all shaped `EXISTS conversation_assignments … AND instance_id`) must additionally AND on `business_id`, or one business's admin sees another's chats. Map WA Mancer admin → iGrowFast per-business admin/owner; WA Mancer user → seller via assignments.
2. **`security_invoker=true` on the 3 decrypted views is the only thing standing between anon and decrypted message content.** The default-ACL trap already granted anon full DML (incl. TRUNCATE) on `messages_decrypted`/`conversations_decrypted`. On port: explicitly `REVOKE ALL` from anon/authenticated on all three views and pin `security_invoker`, and neutralize the `pg_default_acl` anon/authenticated grants in `public` + `storage` before creating any ported table (same class as the dev-branch clone credential-exfil trap).
3. **`_cron_purge_metric_samples()` is anon-executable SECDEF.** REVOKE anon EXECUTE (it's a cron internal; only pg_cron/service_role should call it). It's the one advisor finding that is a genuine defect, not a design choice.
4. **Two `qual=true` RLS policies** (`number_pacing_state`, `quick_replies`) become cross-business read holes the moment there's more than one tenant. Rewrite both to assignment/instance/business scope.
5. **Envelope encryption is a single un-rotated Vault key** (`wa_mancer_envelope_key`) read fresh on every encrypt/decrypt (no cache). iGrowFast already runs Vault (Google SA + cron key). Decide: reuse the pattern with a new per-deployment key, or namespace per business. Losing this key = all message bodies + instance tokens unreadable. Plan key rotation (re-encrypt path) — none exists today.
6. **The worker talks to the DB over a direct pg pool, not PostgREST**, calling `ingest_message`/`resolve_identity`/`apply_reaction`/`enqueue_media_fetch` etc. as service_role. LISTEN/NOTIFY (`outbound_enqueued`, `media_fetch_ready`) needs a session-mode (5432) pooler connection. Any managed-Postgres/pooler topology on the iGrowFast box must preserve session-mode LISTEN.
7. **Media is R2, storage is empty.** The keying convention `{instance}/{conversation}/{message}.<ext>` and bucket `wamancer-media` are hardcoded. iGrowFast's locked build decision is **Supabase Storage, not R2** — the worker/edge media code (`@aws-sdk`/aws4fetch → R2) and `messages.media_storage_*` semantics must be rewritten off S3/R2 (matches the hazard already noted in 03/06). 164 already-dead media fetches show the CDN-expiry failure mode is real.
8. **Name collisions with iGrowFast core:** `profiles`, `is_admin()`, `has_role()`, `audit()` + hash-chained `audit_log`, and an `invitations` system all collide with iGrowFast constructs. iGrowFast **ripped out its audit-log feature** 2026-06-22 — reintroducing WA Mancer's audit machinery (10 triggers + hash chain + advisory-lock-serialized inserts on every write) is a decision, not a free port. The invitation system overlaps iGrowFast's `user_invitations`/send-invitation.
9. **Retry/backoff-to-dead and send jitter are NOT in the DB — they're in the worker binary.** Porting the schema alone does not port the dispatch behavior; the worker is required and its retry policy is invisible to SQL.
10. **`cli_login_postgres`** is a non-standard LOGIN role of unknown membership. Audit before trusting the role model on the merged box.
11. **97% of the DB is telemetry** (`system_logs`, `metric_samples`, `host_metrics`) fed by the worker's monitoring pipeline + 16 crons, several of which (`ingest_host_metrics`, `ingest_prom_metrics`, R2 metrics, `admin-platform-logs` platform pull) assume the standalone VPS + Supabase-cloud Management API. On the self-hosted iGrowFast box this observability stack is mostly non-portable and should be dropped or redesigned — it is not the product and it dwarfs the product 50:1.
12. **The isolation model has never been exercised.** `conversation_assignments` has 0 rows in production; the single user is admin (who bypasses every predicate). The agent-scoping RLS is correct on paper (verified by reading all policies) but has zero live evidence of behaving under a non-admin user — test it explicitly under a seeded `user`-role account before trusting it multi-tenant.
13. **`metric_samples` has no primary key** and `merge_review`/`merge_decisions`/`system_logs` carry unconstrained soft-ref UUIDs. Fine standalone; if any of these port, add keys/FKs to fit iGrowFast's stricter integrity posture.
14. **Queue claim relies on the lease, not row locks.** There is no `FOR UPDATE SKIP LOCKED` on `queue_claim_next`; correctness assumes exactly one worker per number via `worker_instance_leases`. A multi-worker or multi-box deployment that breaks the one-lease-per-number invariant would double-send. Preserve the lease as the concurrency boundary.
