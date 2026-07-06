# 11 — `whatsapp` Schema Build Plan

**Status:** LOCKED PLAN v3 — from the final live sweep of the WA Mancer managed DB (2026-07-05, project `xlhlezgpgrypdijynmqr`, PG 17.6), a 4-lens adversarial verification pass, and two owner rulings (execution target = box; **keep the logs/telemetry stack, drop only identity**). This is the DDL-level port map for the new `whatsapp` schema on the live box.

**Meta-rule:** WA Mancer is the exact spec, not inspiration. The port is **near-total 1:1**. Only THREE kinds of change are allowed:
1. **Schema rename** `public.*` → `whatsapp.*` (mechanical).
2. **Drop the IDENTITY layer only** — iGrowFast already owns auth/users/roles/invitations; keeping WA Mancer's is dead weight (§2.1).
3. **Add the two adaptation layers** (multi-tenant/roles/owner + e-commerce seam, §4) and apply **security-grant hardening** (§5 — closes grant holes, removes no feature).

**Everything else — including the ENTIRE logs / statistics / telemetry / audit stack — ports verbatim.** What to prune from that stack is a SEPARATE later editing pass, not a build-time decision. Do not drop it now.

---

## 0. Execution target — RESOLVED 2026-07-05 (owner ruling)

**Live prod = the self-hosted box `.102`. The managed Supabase projects are LEGACY — never touch them for this build.**

- **Live target:** Contabo box **207.180.232.102**, self-host Supabase (`supabase-db` on `igf/supabase-postgres:17.6.1.136-pgbackrest.1` + auth / edge / storage / realtime / meta / supavisor pooler / postgrest v14.12 / kong / cloudflared). Verified: `whatsapp` schema absent (clean), 17 live app crons, 5 e-comm anchor tables present.
- **LEGACY — never receive `whatsapp` DDL:** `mcp__supabase-igrowfast-prod` → `zjkqprrfbibjoslvlmxf` (AWS managed) and `mcp__supabase-igrowfast-dev` → `pcgvfwqkzyozzxktfogi`. The whatsappmancer MCP is read-only reference.
- **Reach the box (no MCP hits it):** `ssh igf` → `docker exec supabase-db psql -U postgres -d postgres`. Every wave and every fact check runs this way. The Supabase MCP `apply_migration`/`execute_sql` tools CANNOT be used.
- **Rehearsal gap (§7):** no live dev *mirror of the box* exists (legacy dev is a clone of old managed prod). Box-native substitute: rehearse each wave in a throwaway `whatsapp_rehearse` scratch schema (or `BEGIN … ROLLBACK`) on the box, run advisor-equivalent + impersonation checks, snapshot, then apply for real. Owner to confirm (F8).

## 1. Target and naming rules

- **Where:** the live box Postgres (§0), new schema **`whatsapp`**. WA Mancer's own DB is untouched (separate live product).
- **Object names:** IDENTICAL to WA Mancer — only the schema qualifier changes, so ported worker/edge/UI SQL diffs stay minimal. Enum types also live in `whatsapp`.
- **PostgREST exposure:** add `whatsapp` to **`PGRST_DB_SCHEMAS`** on the **`supabase-rest`** container (currently `public,storage,graphql_public`) + restart/reload. **Kong does NOT own the exposed-schema list.** Clients use `.schema('whatsapp')`.

## 2. Scope

### 2.1 The ONLY drop: WA Mancer's identity layer (iGrowFast owns it)
iGrowFast already has `public.users` (its `profiles` equivalent), a 6-value `public.user_role`, per-business role helpers, and its own invitation/onboarding lifecycle `[user-mgmt-uniqueness-model, invitation-email-send]`. Keeping WA Mancer's parallel identity would fork auth and create months of reconciliation. **Drop and rewire:**
- Tables: `profiles`, `invitations`.
- Enum: `user_role`.
- Functions: `is_admin()`, `has_role()`, `bootstrap_admin`, `admin_set_user_role`, `admin_set_user_active`, `invitation_claim/finalize/rollback/status`, `validate_avatar_config`, `_on_auth_user_created`, `_on_profile_role_changed`, `_on_invitation_inserted`, `_on_invitation_revoked`.
- Triggers: the 5 on `profiles`/`invitations`.
- **Rewire (L1, §4.1):** every RLS predicate + RPC guard that used `is_admin()`/`profiles` → iGrowFast per-business role helpers on `public.users`; `conversation_assignments.user_id` → iGrowFast `auth.users` (sellers). `_release_dms_on_profile_deactivation` re-hung on `public.users`. ~30 `is_admin()` call sites get rewritten — that IS the L1 work.

### 2.2 KEEP the entire logs / statistics / telemetry / audit stack — port 1:1, prune LATER
**Owner ruling 2026-07-05:** do NOT drop the observability stack at build time. Port it verbatim; a separate later editing pass decides what to keep vs prune. In scope to KEEP:
- Tables: `audit_log` (+ hash chain), `system_logs`, `metric_samples`, `host_metrics`, `db_metrics_history`, `worker_health_history`, `r2_metrics`, `app_cache`, `og_cache`, `_cron_ingest_state`, `dispatcher_snapshot`, `worker_health`.
- Functions: `audit()`, `_audit_log_hash`, `validate_audit_chain`, `admin_audit_chain_status`, `admin_query_logs`, `admin_log_facets`, all `stats_*`(+`_impl`), `monitor_*`, `db_metrics_*`, `ingest_host/prom/r2_metrics`, `ingest_system_logs`, `ingest_platform_logs`, `cache_get_or_compute`, `cache_warm/janitor/quantize`, `dashboard_overview`, `agent_dashboard_overview`, `agent_performance`, `dashboard_activity_impl`, `instance_stats`(+`_impl`), and the `private._compute_*` layer.
- Enums: `log_source` (14 values), `log_level`.
- Crons: all 16, incl. the 9 telemetry/metric/log/cache jobs.
- Realtime: all 14 published tables.

This keeps `audit()` (called by ~25 operational RPCs) and every stats/dashboard function intact → **no dangling dependencies**, and the admin Statistics/Dashboard + owner Log/Monitor pages keep their exact WA Mancer data sources. The `_cron_purge_metric_samples` PUBLIC-execute grant is the one thing normalized (safety, §5 W3), not dropped.

### 2.3 Inventory the sweep found (context)
35 tables, 3 `security_invoker` views, 13 enums, 174 public + 22 private functions, 32 triggers, 58 RLS policies, 16 pg_cron jobs, 14 realtime tables, 0 storage buckets (media on R2), 1 vault secret. Full detail: sweep artifacts + `02-database.md`.

## 3. Port disposition

### 3.1 Tables (35 source → 35 in the new schema)

**PORT 1:1 (31)** — identical columns/defaults/constraints/indexes; only schema changes (+ §4 seam columns where flagged):
- **Inbox core:** `whatsapp_instances` (+`business_id` NOT NULL, +`node_id`, +`key_id`), `conversations` (+`customer_id`, +`key_id`), `messages` (+`key_id`), `conversation_assignments` (+ same-business guard, §4.1), `outbound_queue`, `number_pacing_state`, `worker_instance_leases`, `worker_health`, `dispatcher_snapshot`, `media_fetch_jobs`.
- **Contact bible:** `contacts` (+`customer_id`), `contact_identifiers`, `jid_mapping`, `merge_decisions`, `merge_review`, `contact_profiles`, `group_participants`.
- **Collab:** `tags`, `conversation_tags`, `conversation_notes`, `scheduled_messages`.
- **Logs/telemetry (KEEP, §2.2):** `audit_log`, `system_logs`, `metric_samples`, `host_metrics`, `db_metrics_history`, `worker_health_history`, `r2_metrics`, `app_cache`, `og_cache`, `_cron_ingest_state` (RLS enabled — W4 fix).

**ADAPT (2):**
- `quick_replies` → per-business: `instance_id` becomes `business_id`; RLS + unique index re-keyed.
- `message_templates` → per-business: +`business_id`; `'global'` = business-wide; CHECKs/partial-unique on `(business_id,name)`.

**DROP (2, identity only, §2.1):** `profiles`, `invitations`.

**ADD (2, seams, deny-all posture §3.10):** `encryption_keys` (key rotation), `wa_nodes` (node registry).

Net new schema = 31 PORT + 2 ADAPT + 2 ADD = **35 tables** + 3 views.

### 3.2 Enums (PORT 12 of 13)
DROP `user_role` only. PORT 12 verbatim incl. `log_source`/`log_level` (needed by `system_logs`, kept).

### 3.3 Views (3, `security_invoker=on`)
`messages_decrypted`, `conversations_decrypted`, `worker_health_status`. Grant `SELECT` to `authenticated` only — no anon, no DML (W2 fix).

### 3.4 Functions
**PORT everything** (inbox core, contact bible, queue/worker, crypto chain, agent/admin RPCs, AND the whole stats/monitor/ingest/cache/audit family §2.2). Only two adjustments:
- Normalize the 4 `search_path=public` stragglers to `''` (W6), bodies fully qualified.
- Rewrite the ~30 internal `is_admin()`/`has_role()` calls to the iGrowFast per-business helper (L1, §4.1). `audit()` stays as-is (no change).
**DROP** only the identity functions listed in §2.1.
> `private` schema collapses into `whatsapp`; the `_compute_*`/`cache_*` twins port too. Name collisions (`is_admin`/`has_role`/`audit`/`set_instance_token` in both source schemas) resolve by dropping the identity twins (`is_admin`/`has_role`) and keeping the operational ones.

### 3.5 Triggers (PORT 27, DROP 5)
DROP the 5 on `profiles`/`invitations`. **PORT the other 27 verbatim** — incl. the `_on_*` audit-enrichment triggers and `_audit_log_hash` (audit machinery stays with the logs stack). ADD the same-business assignment guard (§4.1). `_release_dms_on_profile_deactivation` re-hung on `public.users`.

### 3.6 pg_cron (PORT all 16)
All jobs port, renamed `wa_*` to coexist. Verify `cron.job` collisions — box uses ids 1–16, 20; `wa_*` names collision-free.

### 3.7 Realtime (PORT all 14)
`ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp.…` for all 14 published tables. RLS authorizes per-row delivery. **Gate: F2 (self-host Realtime delivers from a non-`public` schema under RLS).**

### 3.8 Storage / media — REVISED (owner ruling 2026-07-06): direct R2, 1:1 WA Mancer
~~Private Supabase Storage bucket `whatsapp-media` backed by box Storage-on-R2, accessed via the Supabase Storage client + short-TTL signed URLs. Worker + `media-sign`/`media-upload` rewritten off `@aws-sdk`/aws4fetch (blueprint §8). R2 stays the physical store; direct-S3 is the rejected mechanic.~~

**SUPERSEDED.** The build shipped WA Mancer's direct-R2 mechanic verbatim (dedicated raw R2 bucket
`whatsapp-media` WEUR, scoped S3 token, worker `r2/client.ts`/`r2/avatar.ts`, edge `R2_MEDIA_*` env) and the
full pipeline is live and E2E-proven (media ingest, content-addressed avatar caching, instance-delete R2 sweep,
`r2_metrics` telemetry — which this plan had kept anyway, an inconsistency direct-R2 resolves). Owner ruled
2026-07-06: **keep direct R2; the Supabase-Storage rewrite is the rejected path** (re-derives a solved mechanic,
contra the 1:1 rule). Public exposure = Cloudflare custom domain `media.igrowfast.com` on the bucket (mirror of
WA Mancer's `media.welcomdeal.ma`). Follow-up: add `whatsapp-media` to the backup register (it is NOT covered
by the box Storage-on-R2 backup story).

### 3.9 Vault
New secret `igf_whatsapp_envelope_key` (fresh 32-byte random). Key lives ONLY in core Postgres; nodes/workers never hold it. Per-wave snapshot via manual `pg_dump` until box backup status confirmed (F7; image carries pgBackRest).

### 3.10 The two ADDed seam tables — deny-all posture
`encryption_keys` (key_id→Vault secret NAME) and `wa_nodes` (`base_url_ct` + topology): RLS ON, zero client policies, no anon/authenticated grants — read only by SECDEF crypto/node functions (service_role/postgres).

## 4. The two adaptation layers

### 4.1 L1 — Multi-tenant / roles / owner
- `whatsapp_instances.business_id uuid NOT NULL REFERENCES public.businesses(id)`; everything scopes transitively via `instance_id`.
- Role helpers replacing `is_admin()` (secdef, `search_path=''`, initplan-cached): `whatsapp.is_wa_admin(p_instance_id)` = super-admin/admin of that instance's business (no `is_owner()` bypass on per-business ops `[owner-not-in-per-business-rpcs]`). Agent path = `EXISTS(conversation_assignments …)`, assignments only for **sellers** of the same business; MB/couriers get nothing. `is_owner()` only on fleet surfaces (`worker_health`, `worker_instance_leases`, `dispatcher_snapshot`, and the kept telemetry/log tables the owner Log/Monitor pages read).
- **Same-business guard trigger:** `BEFORE INSERT/UPDATE` on `conversation_assignments` (SECURITY INVOKER, `search_path=''`) rejects rows where the assigned user's business ≠ the conversation's instance business. Boundary survives an RPC regression `[owner-confinement-model]`.
- **Auto-assign (decision #5, copy exactly):** keep per-instance `auto_assign_user_pool` + round-robin over the admin-chosen seller subset; only AND seller-role + business_id.
- Re-scope the 2 `qual=true` policies: `quick_replies` → business members; `number_pacing_state` → admins of the owning business.
- Pacing: owner floor + admin-within (decision #15) — owner floor as a guard inside `set_instance_settings`.

### 4.2 L2 — E-commerce seam (in the FIRST wave)
- `contacts.customer_id` + `conversations.customer_id` → `public.customers(id) ON DELETE SET NULL` (denormalized from contact at link time).
- Order-from-chat + auto-attribution (`seller_id`=assigned agent, `channel='whatsapp'` → `seller_daily_earnings` untouched `[whatsapp-seller-commission-inflation]`) = RPC/edge/UI on existing order paths; order history reads `public.orders` by `customer_id`.
- Inbox-only queue v1 (the `origin` enum already has slots for a future producer). Packaging/caps = data + guard fn later ("flip with a row").

## 5. Security posture (closes grant holes — removes NO feature)

**WA Mancer live defects excluded from the port:**
- **W1 — default-ACL grant-all trap** under TWO grantor roles: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres, supabase_admin IN SCHEMA whatsapp REVOKE …` (a single unqualified statement leaves the other grantor's defaults intact). Verify with a post-wave catalog check.
- **W2 — anon full DML on the 3 decrypted views:** anon gets NO `USAGE` on `whatsapp`; views SELECT→authenticated only.
- **W3 — `_cron_purge_metric_samples` PUBLIC-executable:** normalize to postgres-only (function KEPT, grant fixed). `_delivery_rank`/`identifier_trust` PUBLIC grants normalized.
- **W4 — `_cron_ingest_state` RLS disabled:** enable RLS (zero policies = deny; service_role bypasses).
- **W5 — grant-exceeds-policy is a GENERAL rule:** grant = exactly what a policy allows, for EVERY table; verify per-table in each wave's catalog diff.
- **W6 — 4 functions pin `search_path=public`:** all pin `''`, bodies fully qualified.

**iGrowFast standards:** S1 RLS everywhere + `(select auth.uid())`; S2 `security_invoker=on` verify-by-impersonation; S3 SECDEF-minimal + `search_path=''` + guard-first; S4 anon revoked from `whatsapp`; S5 covering index per FK; S6 catalog/advisor check every wave; S7 worker=service_role via pooler :5432, secrets in edge-env/Vault; S8 box-scratch rehearsal + snapshot per wave (§7).

## 6. Encryption (exact port + key_id seam)
1. `whatsapp.encryption_keys` (seeded `key_id=1 → 'igf_whatsapp_envelope_key'`, deny-all).
2. `_envelope_key(p_key_id smallint DEFAULT 1)` — SECDEF, Vault read via registry row; EXECUTE postgres+service_role.
3. `encrypt_text`/`decrypt_text(p_ct, p_key_id DEFAULT 1)` — pgp_sym; EXECUTE postgres+service_role.
4. `_decrypt_message_body`/`_decrypt_conv_preview` — SECDEF +authenticated; trusted-role bypass else `is_wa_admin`-or-assigned else NULL; reads the row's `key_id`.
5. `key_id smallint NOT NULL DEFAULT 1 REFERENCES encryption_keys` on `messages.body_ciphertext`, `conversations.last_message_preview_ct`, `whatsapp_instances.evolution_api_token_ct`+`webhook_secret_ct`.
Rotation later = INSERT key row + flip default + background re-encrypt.

## 7. Migration sequence — box-native, one verified wave at a time

**Protocol per wave (box is the only real env, §0):** author SQL → rehearse in `whatsapp_rehearse` scratch schema / `BEGIN…ROLLBACK` on the box → catalog checks (no anon USAGE/grants, no default-ACL leak, `search_path=''`, `security_invoker` views) → impersonation battery (`SET ROLE authenticated` + `request.jwt.claims` for seller/admin/MB/courier of a test business; MB+courier see nothing, cross-business sees nothing) → `pg_dump` snapshot → apply via `docker exec supabase-db psql -U postgres` → catalog diff vs plan → git-commit → next. All via `ssh igf`.

**Ordering rule:** `CREATE POLICY` resolves referenced relations at creation. Agent policies reference `conversation_assignments`(+`conversations`), so tables are created with RLS ON + admin/owner/service policies only, and **all agent-select policies go in a dedicated policy wave after `conversation_assignments`+`conversations` exist**.

| Wave | Migration | Contents |
|---|---|---|
| 0 | `whatsapp_000_bootstrap` | `CREATE SCHEMA`; `ALTER DEFAULT PRIVILEGES FOR ROLE postgres, supabase_admin REVOKE` (W1); `USAGE` to authenticated+service_role (not anon); add `whatsapp` to `PGRST_DB_SCHEMAS` on `supabase-rest` + reload; verify REST. |
| 1 | `whatsapp_001_enums` | 12 enums (incl. `log_source`/`log_level`). |
| 2 | `whatsapp_002_encryption` | Vault secret, `encryption_keys` (deny-all), `_envelope_key`, `encrypt/decrypt_text`. |
| 3 | `whatsapp_003_audit_core` | `audit_log` (+ hash chain + `_audit_log_hash`), `audit()`, `validate_audit_chain`, `admin_audit_chain_status`. Early — ~25 later RPCs/triggers call `audit()`. |
| 4 | `whatsapp_004_instances` | `wa_nodes` (deny-all), `whatsapp_instances` (+seams), `is_wa_admin`, indexes, updated_at + config-audit triggers, RLS admin/owner-only. |
| 5 | `whatsapp_005_contact_bible` | `contacts`(+customer_id), `contact_identifiers`, `jid_mapping`, `merge_*`, `contact_profiles`, `group_participants` + resolution fns + `_on_jid_mapping_resolved` + RLS admin-only. |
| 6 | `whatsapp_006_conversations_messages` | `conversations`(+customer_id,+key_id), `messages`(+key_id), operational + audit triggers, constraints, indexes, RLS admin-only. |
| 7 | `whatsapp_007_queue_pacing_leases_assign` | `outbound_queue` (+notify/dead triggers), `number_pacing_state` (+ensure trigger + backfill), `worker_instance_leases`, `dispatcher_snapshot`, `worker_health` + queue/pacing/lease/heartbeat RPCs + `dispatch_gate_check`; `conversation_assignments` (+singleton index, is_group + audit + same-business guard triggers), assign/unassign/claim + auto-assign fns + `messages_auto_assign_on_inbound` + `_release_dms_on_profile_deactivation` (on `public.users`). |
| 8 | `whatsapp_008_agent_policies` | **Policy-only wave:** every agent-select RLS policy (instances, conversations, messages, contact bible, outbound_queue, dispatcher_snapshot) now that assignments+conversations exist. Grants aligned to policies (W5). |
| 9 | `whatsapp_009_media` | `media_fetch_jobs` (RESTRICTIVE deny-all) + enqueue/complete/fail fns; Storage bucket `whatsapp-media` out-of-band. |
| 10 | `whatsapp_010_decrypted_views_send_rpcs` | `_decrypt_*` wrappers, 3 views, `ingest_message` overloads, `apply_reaction`, `append_group_system_event`, `upsert_contact_profile`, `send_*`/edit/delete/forward/cancel/force_dispatch, mark_read, status/pin/star/archive, `search_conversations`, `ensure_conversation`. |
| 11 | `whatsapp_011_collab` | `tags`, `conversation_tags`, `conversation_notes`, `quick_replies` (business), `message_templates` (business), `scheduled_messages` + RPCs + triggers + agent policies. |
| 12 | `whatsapp_012_logs_telemetry` | `system_logs`, `metric_samples`, `host_metrics`, `db_metrics_history`, `worker_health_history`, `r2_metrics`, `app_cache`, `og_cache`, `_cron_ingest_state` (RLS on) + `ingest_*`/`stats_*`/`monitor_*`/`db_metrics_*`/`cache_*`/`dashboard_*`/`agent_*`/`instance_stats`/`_compute_*`/`admin_query_logs`/`admin_log_facets`. |
| 13 | `whatsapp_013_admin_instance_rpcs` | `set_instance_settings` (owner-floor), `set/reveal_instance_token`, `set/reveal_instance_webhook_secret`, `admin_*` dead-letter/preflight/sync/auto-assign, `instance_capacity_status`, `admin_list_unassigned_conversations`. |
| 14 | `whatsapp_014_crons_realtime` | all 16 `wa_*` cron jobs (postgres-only fn ACLs) + `ALTER PUBLICATION supabase_realtime ADD` the 14 tables. Last: crons only fire once their functions exist. |

After wave 14 the schema is the near-total WA Mancer DB (minus identity). Pruning the logs/telemetry stack = separate later editing pass. Worker/edge/UI phases follow.

## 8. Pre-build fact checks (re-run against the BOX 2026-07-05)

- **F1 — RESOLVED:** target = box `.102` via `ssh igf` + `docker exec supabase-db psql`. Managed MCPs legacy. `whatsapp` absent (clean). ✓
- **F2 — pending:** confirm Realtime delivers changes from a non-`public` schema table under RLS (before wave 14).
- **F3 — DONE:** box `PGRST_DB_SCHEMAS=public,storage,graphql_public` on `supabase-rest`; wave 0 adds `whatsapp` there (not kong). ✓
- **F4 — DONE (box):** pgcrypto/pg_cron/pg_trgm/supabase_vault/uuid-ossp/pg_net present; **`citext` NOT installed** — WA Mancer `profiles`/`invitations` used it, both dropped, so no dependency; confirm no KEPT object needs citext. ✓
- **F5 — DONE (box):** cron ids 1–16, 20 in use; `wa_*` names collision-free (pg_cron auto-assigns jobid). ✓
- **F6 — SUPERSEDED by §3.8 revision (2026-07-06):** no box Storage bucket; media = dedicated raw R2 bucket `whatsapp-media` + `media.igrowfast.com` custom domain (WA Mancer 1:1).
- **F7:** confirm pgBackRest/PITR actually running; set real per-wave rollback (manual `pg_dump` is the floor).
- **F8:** confirm box-scratch/txn-rollback rehearsal is acceptable (no live dev mirror), or stand up a box clone.

## 9. DDL sourcing rule
Primary source = local WA Mancer repo migrations (`/Users/ismailelqorchi/Desktop/WhatsApp Mancer/supabase/migrations`, 219 files) consolidated to final shape. Authority on drift = the live catalog from this sweep (live DB wins over committed migrations). Every ported function body is diffed against `pg_get_functiondef` from the live DB before it lands in a migration.
