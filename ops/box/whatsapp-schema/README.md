# `whatsapp` schema build — box-native migrations

Execution of the LOCKED plan `docs/wa-mancer-recon/11-whatsapp-schema-build-plan.md` (near-total 1:1
port of the WA Mancer DB into a new `whatsapp` schema; drop identity only; add L1 multi-tenant + L2
e-commerce seams + W1–W6 hardening; keep the whole logs/telemetry stack).

## Execution target (do NOT get this wrong)
LIVE prod = the self-host **box `.102`** Postgres. Reach it ONLY via:

    ssh igf -> docker exec -i supabase-db psql -U postgres -d postgres

The managed Supabase projects are LEGACY and must NEVER receive this DDL:
`-prod` = `zjkqprrfbibjoslvlmxf`, `-dev` = `pcgvfwqkzyozzxktfogi`. No MCP reaches the box.
The WA Mancer managed project `xlhlezgpgrypdijynmqr` is the READ-ONLY source of truth for object shapes.

## Per-wave protocol (plan §7)
author SQL from live WA Mancer DDL -> rehearse on box in `whatsapp_rehearse` scratch schema or
`BEGIN…ROLLBACK` -> catalog checks (no anon USAGE/grants, no default-ACL leak, `search_path=''`,
`security_invoker` views, grant==policy) -> impersonation battery (seller/admin/MB/courier of a test
business; MB+courier see nothing, cross-business sees nothing) -> PITR anchor + `pg_dump` snapshot ->
apply -> catalog diff vs plan -> commit -> next wave.

## Box facts verified 2026-07-05 (pre-build)
- PG 17.6; extensions pgcrypto/pg_cron/pg_trgm/supabase_vault/uuid-ossp/pg_net present; citext absent.
- **F7 PITR GREEN**: pgBackRest stanza `igf` status ok, encrypted repo on Cloudflare R2
  (`igf-db-backups`), continuous WAL archive (0 failed), host systemd timers full/incr/pgdump/verify
  all exit-0. PITR window from ~2026-07-04.
- **F2 GREEN (high-confidence)**: Realtime v2.102.3, `wal2json` slot, `realtime.subscription.entity`
  is `regclass` + `apply_rls` per subscriber role => schema-agnostic. Final WS round-trip is the
  wave-14 gate.
- **F6 GREEN (feasible)**: box Storage (R2-backed) supports private buckets; `whatsapp-media` absent,
  provisioned out-of-band at wave 9.
- **F3 DONE**: `PGRST_DB_SCHEMAS` lives in `/opt/supabase-project/.env` and feeds both `rest` +
  `studio`; exposing a schema = edit `.env` + `docker compose up -d --no-deps rest studio`.

## Security-model finding (drives every function-creating wave)
Empirically on this box:
- No global/all-schema default privileges exist and none are scoped to `whatsapp` => the plan's W1
  "grant-all trap" is ABSENT; new whatsapp tables/sequences are owner-only by default.
- `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` does NOT take effect here
  (new funcs keep built-in PUBLIC=EXECUTE). Default-priv GRANT works, REVOKE-from-PUBLIC does not.
  => Function PUBLIC-execute is stripped DETERMINISTICALLY PER FUNCTION in each wave:
      REVOKE ALL ON FUNCTION whatsapp.fn(args) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION whatsapp.fn(args) TO <intended roles only>;
  anon is additionally hard-blocked by having NO schema USAGE.

## Waves
| Wave | File | Status |
|---|---|---|
| 0 | `migrations/whatsapp_000_bootstrap.sql` | APPLIED 2026-07-05 (PITR anchor LSN 6/11002C48) |
| 1 | `migrations/whatsapp_001_enums.sql` | APPLIED 2026-07-05 (PITR anchor LSN 6/230046A8) — 12 enums, dropped user_role |
| 2 | `migrations/whatsapp_002_encryption.sql` | APPLIED 2026-07-05 (PITR anchor LSN 6/2F00B238) — Vault key + encryption_keys + crypto chain |
| 3 | `migrations/whatsapp_003_audit_core.sql` | APPLIED 2026-07-05 (PITR anchor LSN 6/3C000060) — audit_log + hash chain + audit()/validate/status (owner-gated) |
| 4 | `migrations/whatsapp_004_instances.sql` | APPLIED 2026-07-05 (post-apply LSN 6/500003A8) — whatsapp_instances (+business_id/node_id/key_id) + wa_nodes + is_wa_admin + audit triggers + admin RLS |
| 5 | `migrations/whatsapp_005_contact_bible.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/5B000000) — 7 contact tables + L2 customer_id seam + admin RLS; resolution fns + jid trigger deferred |
| 6 | `migrations/whatsapp_006_conversations_messages.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/630E6B90) — conversations+messages (+customer_id/key_id seams) + 5 self-contained triggers + admin RLS |
| 7 | `migrations/whatsapp_007_queue_pacing_assign.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/6F000058) — 6 queue/pacing/lease/assignment tables + same-business guard + ensure_pacing/sync triggers + fleet/per-business RLS |
| 7b-1 | `migrations/whatsapp_007b_autoassign_release.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/75000180) — agent_assign_cursor + auto-assign (L1) + release-dms trigger on public.users |
| 7b-2 | `migrations/whatsapp_007c_worker_assign_rpcs.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/88043780) — 15 worker/assignment RPCs (ported via port+verify workflow) |
| 8 | `migrations/whatsapp_008_agent_policies.sql` | APPLIED 2026-07-05 (pre-apply LSN 6/900278A8) — agent-select branches + is_wa_admin_conv recursion fix |
| 9–14 | per plan §7 | pending |

## Wave 8 (agent policies + recursion fix)
Added agent-select RLS so an assigned seller sees only their assigned conversations/messages/instances/contacts
(verified: assigned seller sees 1 each, unassigned seller 0, admin all). `dispatcher_snapshot` stays owner-only
(§4.1); `outbound_queue` agent branch already shipped wave 7.
**Fixed a wave-7 latent recursion:** `ca_*` policies inline-read `conversations` (from the is_admin→is_wa_admin
rewrite); once `conversations_select` got an `EXISTS(conversation_assignments)` branch, the two tables' RLS
recursed. Wrapped the conversation→instance lookup in SECDEF `whatsapp.is_wa_admin_conv(uuid)` (runs as postgres,
`bypassrls`) and re-pointed `ca_admin_delete`/`ca_admin_insert`/`ca_select` at it. Another catch by the box rehearsal.

## Wave 7b-2 (15 RPCs, workflow-ported)
Ported via a port+adversarial-verify Workflow (30 agents), assembled from JSON, diffed + rehearsed on the box.
Worker (dispatch_gate_check, pacing_take_token, queue_claim_next/mark_sent/mark_failed/mark_dead,
worker_claim/renew/release_instance_leases, worker_heartbeat) = SECDEF, service_role-only.
Assignment (assign_conversation, unassign_conversation, claim_conversation, admin_assign/unassign_conversations)
= SECDEF, authenticated+service_role, is_wa_admin-gated.
**Box rehearsal caught a defect the workflow verify missed:** admin_assign/unassign were SECURITY INVOKER in
source; under INVOKER+RLS the `EXISTS(conversations WHERE NOT is_wa_admin)` gate is defeated (non-admin can't
see the rows) → raw INSERT permission error instead of clean forbidden. Fixed to SECURITY DEFINER (gate now
bypasses RLS to evaluate is_wa_admin correctly). Lesson: the box rehearsal is the real gate, not agent verify.

## Wave 7b-1 (decisions resolved)
- Auto-assign RR cursor = new `whatsapp.agent_assign_cursor` (deny-all). `_auto_assign_on_inbound` rewritten: pool members filtered to `role='commercial'` + `active` + same `business_id` + auth-backed (login-capable), ordered by cursor `last_auto_assigned_at` — pre-filtering guarantees the same-business guard never rejects an auto-assignment.
- `_release_dms_on_profile_deactivation` live on **`public.users`** (`AFTER UPDATE OF active`): deactivate a seller → their whatsapp DM assignments are deleted (groups persist). Integrates with the existing suspend/reactivate flow.

## Wave 7 facts + open decisions for 7b
- `conversation_assignments.user_id → auth.users(id)` is correct: agents must be login-capable. Verified 23/24 iGrowFast users are auth-backed; the 1 non-auth `commercial` simply can't be an agent. `public.users` has NO FK to `auth.users`.
- Same-business guard (`_guard_assignment_business`, SECURITY INVOKER): rejects cross-business AND non-seller (role<>'commercial'). Fleet surfaces (worker_health/leases/dispatcher) gate on `is_owner()`; per-business (assignments/pacing/queue) on `is_wa_admin(instance)`; agents see own (ca_select user_id, oq_select agent_id).
- **DEFERRED to 7b (need your calls):**
  1. `_auto_assign_on_inbound` round-robin cursor: source ordered the pool by `profiles.last_auto_assigned_at` (dropped). Options: (a) new `whatsapp.agent_assign_cursor(user_id, last_auto_assigned_at)` table (faithful time-based RR), or (b) derive least-recently from `conversation_assignments.assigned_at` (no new table, slightly different semantics).
  2. `_release_dms_on_profile_deactivation` re-hung on **`public.users`** (core table) `AFTER UPDATE OF active` → deletes that user's DM assignments when deactivated.
  3. Operational RPCs: queue enqueue/dequeue/mark, pacing, lease acquire/renew/release, heartbeat, assign/unassign/claim, dispatch_gate_check.

## Wave 6 deferral ledger (cross-wave trigger deps)
conversations/messages tables ship with the crypto `key_id` seam and only the 5 self-contained triggers.
DEFERRED until their dependencies exist (all plpgsql, so they only fail at runtime — no live data yet):
- **→ wave 7** (need `conversation_assignments`): trigger `messages_auto_assign_on_inbound` + `_auto_assign_on_inbound` (also needs L1 `profiles`→`public.users`, role `'user'`→`'commercial'` rewrite); trigger `conversations_sync_assignment_is_group` + `_sync_assignments_is_group`.
- **→ after wave 7** (need assignments/queue + wave-11 notes/tags): trigger `conversations_resolve_identity` + `_conversations_resolve_identity` + the whole contact-resolution fn graph (`resolve_identity`, `resolve_contact_from_mapping`, `upsert_jid_mapping`, `link_alt`, `consolidate_*`, `pick_survivor`, `chase_merged_into`, `_resolve_lid_to_phone`, `identifier_trust`, `pair_lid_to_contact`); `private.merge_conversations`; trigger `jid_mapping_resolved` + `_on_jid_mapping_resolved`.
- SELECT agent branches (conversations/messages) → wave 8.

## Wave 5 tenancy + deferrals
- Contact tables carry `instance_id NOT NULL → whatsapp_instances ON DELETE CASCADE`; contacts are PER-INSTANCE (unique per `(instance_id, phone_jid)`/`(instance_id, lid)`). Isolation is transitive via `is_wa_admin(instance_id)`. Only `contacts` gets `+customer_id → public.customers` (L2).
- DEFERRED to wave 6 (dependency): every contact-resolution function (resolve_identity, resolve_contact_from_mapping, upsert_jid_mapping, link_alt, consolidate_contact, pick_survivor, chase_merged_into, _resolve_lid_to_phone, identifier_trust, pair_lid_to_contact, upsert_contact_profile, ...) + the `jid_mapping_resolved` trigger — they interleave with `conversations`/`merge_conversations`. Agent-select policies → wave 8.
- W5: `contact_profiles`/`group_participants` authenticated grant tightened to SELECT (source shipped inert DML that RLS blocked).

## L1 keystone (wave 4)
- `whatsapp.is_wa_admin(p_instance_id)` = `current_user_is_business_admin()` AND instance's `business_id` = `current_user_digicom_business_id()`. Reuses iGrowFast helpers. Owner (`role='owner'`) excluded from per-business ops. Use this for every per-business operational surface in later waves.
- Deferred by ordering: `whatsapp_instances_ensure_pacing` trigger → wave 7 (needs `number_pacing_state`); `wi_select` agent branch (`OR conversation_assignments…`) → wave 8 (ALTER POLICY once assignments/conversations exist).

## Collision + L1 notes carried forward
- `audit()` — WA Mancer's `public.audit` wrapper + `private.audit` SECDEF impl merged into ONE
  `whatsapp.audit(text,text,text,jsonb)` (SECDEF, writes as `auth.uid()`); every RPC keeps the signature.
- `audit_log` is FLEET-WIDE (no business_id) → its SELECT policy uses `public.is_owner()` (owner Log/
  Monitor pages), not per-business admin. General rule (plan §4.1): fleet/telemetry surfaces = `is_owner()`;
  per-business operational surfaces = `is_wa_admin(instance)` (built wave 4).

## DR escrow — envelope key (wave 2)
The `igf_whatsapp_envelope_key` Vault secret (key_id=1, encrypts message bodies) is escrowed in THREE
places so a Vault/DB loss is recoverable: (1) box Vault, (2) macOS Keychain `igf-whatsapp-envelope-key`
(acct `igrowfast`), (3) offline file `/Users/ismailelqorchi/Desktop/IGROWFAST-DR-ESCROW.txt` (to be
moved off-machine). The committed migration mints a random key ONLY as a fallback if the secret is
absent; on the live box the secret was pre-provisioned with the escrowed value, so the guard skipped.
Recovery: re-create the Vault secret with the escrowed value, then `select whatsapp.decrypt_text(whatsapp.encrypt_text('probe'))='probe'`.
