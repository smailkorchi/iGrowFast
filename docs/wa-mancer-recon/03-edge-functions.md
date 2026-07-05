# WA Mancer Recon — 03: Edge Functions

Recon date: 2026-07-05. Source: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/supabase/functions/` (read-only).
26 functions + 9 `_shared/` helpers. Deno edge runtime, `Deno.serve`, supabase-js `2.45.4` via esm.sh, `aws4fetch@1.0.20` for R2.

---

## 0. Global architecture facts

- **Every function is POST-only + OPTIONS preflight.** CORS is wide-open (`Access-Control-Allow-Origin: *`) — safe because auth is Bearer JWT or body token, never cookies (`_shared/cors.ts` comment).
- **JWT verification config** (`supabase/config.toml`, project `xlhlezgpgrypdijynmqr`): default `verify_jwt = true` for all functions; ONLY `check-invitation` and `consume-invitation` are pinned `verify_jwt = false` (pre-auth onboarding, invitation token in body is the bearer of authority). Comment warns: a blanket `supabase functions deploy` without these pins resets the flag and breaks onboarding (regression seen 2026-06-05).
- **Edge functions never send messages.** They orchestrate instance LIFECYCLE, groups, invitations, media URL minting, logs, cleanup. Messaging goes exclusively through the outbound_queue + Node worker path.
- **Evolution auth:** all edge-fn Evolution calls use the GLOBAL api key (`EVOLUTION_GLOBAL_API_KEY`). The per-instance token minted at create-time is stored encrypted in DB and used only by the worker.

### 0.1 WEBHOOK INGESTION — NOT AN EDGE FUNCTION (critical)

There is **no Evolution webhook receiver among the 26 edge functions**. Evolution events are delivered to the **Node worker**, not Supabase:

- URL registered at Evolution: `${WORKER_WEBHOOK_URL_BASE}/<instance_uuid>` — default `http://wa-mancer-worker:8090/webhook/<id>` (docker-internal DNS; Evolution and worker share a private docker network, port 8090 never published to host/Caddy).
- Receiver: `worker/src/webhook/server.ts` — Node `http.createServer`, routes `POST /webhook/:instanceId` (+ `GET /healthz`), 5 MB body cap.
- Auth: custom header `x-wa-mancer-secret` (Evolution v2.3.7 has no HMAC signing; static header configured per instance at create/resync time). `worker/src/webhook/verify.ts` fetches the secret via direct pg `SELECT public.reveal_instance_webhook_secret($1)`, caches 30 s, constant-time compare.
- Handlers: `worker/src/webhook/handlers.ts` — writes to DB through a direct **pg pool** (NOT PostgREST) calling SQL functions:
  `public.ingest_message`, `public.upsert_jid_mapping`, `public.resolve_identity`, `public.consolidate_lid`, `public.apply_reaction`, `public.upsert_contact_profile`, `public.enqueue_media_fetch`, `public.append_group_system_event`.
- Two edge functions configure this subscription: `instance-create` (initial) and `instance-webhook-resync` (repair). Their event lists MUST stay identical (`DEFAULT_EVENTS` in `_shared/evolution.ts` mirrors `CANONICAL_EVENTS` in instance-webhook-resync).

Event list (15): `MESSAGES_UPSERT, MESSAGES_UPDATE, MESSAGES_DELETE, MESSAGES_SET, CONNECTION_UPDATE, QRCODE_UPDATED, SEND_MESSAGE, CONTACTS_UPSERT, CONTACTS_UPDATE, CHATS_UPSERT, CHATS_UPDATE, PRESENCE_UPDATE, GROUPS_UPSERT, GROUP_UPDATE, GROUP_PARTICIPANTS_UPDATE`.
NB: Evolution v2.3.7 subscription enum requires `GROUP_UPDATE` singular — `GROUPS_UPDATE` is rejected with 400; the delivered envelope is still `groups.update` / `group-participants.update`.

### 0.2 Env vars (edge-fn side, values are secrets — names only)

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | admin.ts, admin-platform-logs | injected by platform |
| `SUPABASE_ANON_KEY` | admin.ts | injected |
| `SUPABASE_SERVICE_ROLE_KEY` | admin.ts, admin-platform-logs | injected |
| `EVOLUTION_API_URL` | evolution.ts (all Evolution callers) | prod comment says `https://api.welcomdeal.ma` |
| `EVOLUTION_GLOBAL_API_KEY` | evolution.ts | global admin key, **** |
| `WORKER_WEBHOOK_URL_BASE` | instance-create, instance-webhook-resync | default `http://wa-mancer-worker:8090/webhook` |
| `SITE_URL` | create-invitations | default `http://localhost:5173`; builds onboarding links |
| `MGMT_PAT` | admin-platform-logs | Supabase **Management API** PAT (cloud-only), **** |
| `R2_MEDIA_ENDPOINT` | conversation-cleanup, instance-delete, media-upload | S3 endpoint |
| `R2_MEDIA_ACCESS_KEY_ID` / `R2_MEDIA_SECRET_ACCESS_KEY` | same 3 fns | **** |
| `R2_MEDIA_BUCKET` | same 3 fns | default `wamancer-media` |
| `R2_MEDIA_PUBLIC_DOMAIN` | media-sign | default `media.welcomdeal.ma` (CF custom domain on R2) |

---

## 1. `_shared/` helpers

### `admin.ts`
Exports:
- `admin: SupabaseClient` — service-role client (bypasses RLS, can call `auth.admin.*`). Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `anon: SupabaseClient` — anon client, no session.
- `asCaller(jwt): SupabaseClient` — anon client with `Authorization: Bearer <jwt>` header; RLS-aware, `auth.uid()` context.
- `requireAdmin(req)` → `{ uid, client } | null` — parses Bearer JWT, `caller.auth.getUser()`, then `caller.rpc('is_admin')`; null on any failure.
- `requireUser(req)` → `{ uid, client } | null` — same without the `is_admin` check (any valid authenticated user; used so agents can manage groups).

### `cors.ts`
Exports: `CORS` (headers: origin `*`, methods `POST, OPTIONS`, allow-headers `authorization, x-client-info, apikey, content-type`, max-age 86400), `preflight(req)` (204 on OPTIONS), `json(body, init)` (JSON response + CORS + `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`).

### `evolution.ts`
Minimal Evolution API client for lifecycle only. 30 s AbortController timeout per call; returns `EvolutionResult { ok, status, body }` (never throws; network error → `status: 0`). Global key auth, optional per-instance `apiKeyOverride` on `fetchInstanceDetail`.
Exports (Evolution endpoint each hits):
- `createInstance(input)` → `POST /instance/create` (integration `WHATSAPP-BAILEYS`, `qrcode:false`, webhook enabled with `x-wa-mancer-secret` header, `syncFullHistory:true`, events = `DEFAULT_EVENTS`)
- `connectInstance(name)` → `GET /instance/connect/:name`
- `connectionState(name)` → `GET /instance/connectionState/:name`
- `restartInstance(name)` → `POST /instance/restart/:name`
- `logoutInstance(name)` → `DELETE /instance/logout/:name`
- `deleteInstance(name)` → `DELETE /instance/delete/:name`
- `fetchInstanceDetail(name, key?)` → `GET /instance/fetchInstances?instanceName=`
- `checkWhatsApp(name, numbers)` → `POST /chat/whatsappNumbers/:name`
- `setOwnPresence(name, ownerJid, presence)` → `POST /chat/sendPresence/:name`
- `setInstanceBehavior(name, settings)` → `POST /settings/set/:name`
- `updateWaProfileName/Status/Picture(name, …)` → `POST /chat/updateProfileName|updateProfileStatus|updateProfilePicture/:name`
- `setInstanceWebhook(name, cfg)` → `POST /webhook/set/:name`
- `createGroup(name, subject, participants)` → `POST /group/create/:name`
- `updateGroupPicture(name, groupJid, base64)` → `POST /group/updateGroupPicture/:name`
- `updateGroupSubject(name, groupJid, subject)` → `POST /group/updateGroupSubject/:name?groupJid=`
- `leaveGroup(name, groupJid)` → `DELETE /group/leaveGroup/:name?groupJid=`
- `updateGroupParticipants(name, groupJid, action, participants)` → `POST /group/updateParticipant/:name?groupJid=`
Also exports types `CreateInstanceInput`, `EvolutionResult`, `InstanceBehaviorSettings`, `WebhookConfig`, and `DEFAULT_EVENTS`.

### `groupEvents.ts`
Export: `appendOwnGroupEvent(instanceId, groupJid, event, participants, newSubject?)` — writes an **optimistic French system-event pill** ("Vous avez ajouté X" etc.) immediately after a dashboard group action, via service-role RPC `append_group_system_event(p_instance_id, p_remote_jid, p_body, p_media_meta)`. Deterministic dedup vs the worker's later webhook echo (same event/actor/targets key + 5-min existence guard on the worker side). Reads `whatsapp_instances.wa_owner_jid`, `contacts` (phone_jid, push_name, book_name), `group_participants` (participant_jid, phone_jid, push_name) to resolve display names. Entirely best-effort: all failures swallowed (worker stub-ingest is the backstop). Event union: `create|add|remove|promote|demote|leave|subject|icon|icon_remove`.

### `instance.ts`
Export: `withInstance(req, handler, opts?)` — the shared wrapper for the 13 instance-scoped functions. Steps: preflight → method check → `requireAdmin` (or `requireUser` when `opts.allowUsers`) → parse body → validate `instance_id` (UUID regex) → **service-role** lookup of `whatsapp_instances (id, evolution_instance_name)` → run handler with `InstanceCtx { instanceId, evolutionInstanceName, callerUid, callerClient, body }`. Errors: 405 method, 403 forbidden, 400 invalid_input/invalid_instance_id, 500 lookup_failed, 404 not_found; handler exceptions → `logError(fn,…)` + 500 handler_threw.
**Load-bearing quirk:** the request stream is consumed here; handlers MUST read extra fields from `ctx.body` — `req.json()` again (even via clone) yields empty (was the 400 bug on presence toggle and group-create).
**Authorization note:** the instance lookup runs as service-role and there is NO check that the caller has any relationship to that instance — for `allowUsers` functions, any authenticated user can act on any `instance_id`.

### `logError.ts`
Export: `logError(fn, err, opts)` — fire-and-forget exception logging into `system_logs` (`source='edge'`, `event='edge.<fn>.exception'`) via service-role RPC `ingest_system_logs({ p_entries })`. Scrubs message/stack via sanitizeLog; never throws, never changes the HTTP response.

### `random.ts`
Exports: `randomToken(chars=48)` — base32 crypto-random (~240 bits); `slugify(input)` — NFKD-normalized lowercase slug capped at 40 chars, fallback `'instance'`. Used for `evolution_instance_name`, per-instance token, webhook secret.

### `sanitizeLog.ts`
Deno port of `worker/src/logSink.ts`. Exports:
- `sanitizePayload(extra)` — key-based redaction (SENSITIVE_KEYS: jid/phone/body/text/message/token/secret/apikey/password/qr/pairingcode/etc.), depth ≤ 2, arrays capped 20, 4000-char cap.
- `capPayload(p)` — regex JID (`\d{6,}@…`) + long-number scrub + size caps, NO key redaction (so `message`/`stack` survive).
- `scrubStr(s)` — bare string scrub, 600-char cap.
Rationale documented: `system_logs` is all-admin visible, 14-day retained, CSV/JSON-exportable → producers must redact before writing.

### `validate.ts`
Exports: `isPlainObject`, `validateAvatar` (react-nice-avatar config whitelist: keys AVATAR_KEYS, enums AVATAR_ENUMS, hex colors), `validateEmail` (≤254, regex), `validateFullName` (1–80, control chars stripped), `validatePassword` (12–128, ≥3 char classes), `validateToken` (`[A-Za-z0-9_-]{20,80}`), `validateRole` (`'admin'|'user'`), `sha256Hex(s)` (hex for Postgres bytea `\x` literal), `generateToken()` (32 bytes base64url ≈ 43 chars).

---

## 2. Functions — one by one

Legend: auth models = **admin** (`requireAdmin`), **user** (`requireUser`/`asCaller`), **public** (verify_jwt=false), **service** (service-role bearer). All are `POST` + OPTIONS unless noted.

### 2.1 admin-delete-user
- **Body:** `{ user_id: uuid }`. **Response:** `{ ok: true }` / `{ ok:false, reason }`.
- **Auth:** admin. Self-delete rejected (`cannot_delete_self`, 400).
- **DB:** RPC `audit('admin_user_delete_requested', 'user', user_id, {by})` FIRST (audit even if delete fails); then `admin.auth.admin.deleteUser(userId)` (GoTrue admin API). Profile wiped by ON DELETE CASCADE.
- **Errors:** FK violation (from `conversation_assignments.assigned_by` / `whatsapp_instances.created_by`, both ON DELETE RESTRICT) → 409 `has_dependencies`; not-found → 404; else 500. Outer try/catch guarantees CORS headers on uncaught exceptions.
- **Evolution:** none. **Env:** base three.

### 2.2 admin-platform-logs
- **Two modes in one fn:**
  - **READ** (admin JWT): `{ service: 'api'|'postgres'|'auth'|'storage'|'realtime'|'edge', minutes≤1440, limit≤200 }` → `{ ok, service, rows:[{id,timestamp,level,event}] }`. Live tail of ONE platform log source.
  - **PERSIST** (`mode:'persist'`, service-role bearer): sweeps ALL six sources over a 10-min window (limit 200 each), redacts, and writes into `system_logs` via RPC `ingest_platform_logs({p_entries})` (dedup on source+platform_id). Called by the worker every 60 s.
- **Upstream:** Supabase **Management API** `GET https://api.supabase.com/v1/projects/<ref>/analytics/endpoints/logs.all?sql=…` with `Authorization: Bearer <MGMT_PAT>`. `PROJECT_REF` derived from `SUPABASE_URL`. Sources map: edge_logs, postgres_logs, auth_logs, storage_logs, realtime_logs, function_edge_logs. Self-loop guard excludes its own calls; postgres floor = warn.
- **Auth details:** `bearerIsServiceRole()` accepts either an exact constant-time match of `SUPABASE_SERVICE_ROLE_KEY` OR any JWT whose decoded (NOT locally signature-verified) `role` claim is `service_role` — relies on the gateway having verified the signature.
- **Redaction:** `redact()` strips JWTs, emails, JIDs, phone numbers; 4096-char cap. `deriveLevel()` keyword heuristic.
- **Errors:** 503 not_configured if `MGMT_PAT`/ref missing; 403; 400; 502 persist_failed; 500 exception.
- **Env:** `MGMT_PAT`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. **CLOUD-ONLY: no Management API on self-host.**

### 2.3 check-invitation  (verify_jwt = false)
- **Body:** `{ token }` (validateToken). **Response:** 200 with the `invitation_status` RPC result regardless of ok/!ok (client routes on `reason`).
- **Auth:** public; token is only looked up, never claimed.
- **DB:** RPC `invitation_status({ p_token_hash: '\x'+sha256Hex(token) })` via service-role.
- **Errors:** 405/400/500 with `reason`.

### 2.4 check-whatsapp
- **Body:** `{ instance_id, numbers: string[] }`. **Response:** `{ ok, result: <raw Evolution body> }`.
- **Auth:** admin (withInstance default).
- **Evolution:** `POST /chat/whatsappNumbers/:name`. **DB:** whatsapp_instances lookup only.
- **Errors:** 400 invalid_numbers; 502 evolution_check_failed.

### 2.5 client-log
- **Body:** `{ kind: 'error'|'unhandledrejection'|'react'|'ratelimited', message, stack_top?, route?, ua? }`. **Response:** always benign `{ ok:true }` (or 401/400/405/500).
- **Auth:** user (any authenticated). `actor_uid` from verified token ONLY.
- **DB:** fire-and-forget RPC `ingest_system_logs` with `source='client'`, `event='client.<kind>'`, payload scrubbed by `capPayload`/`scrubStr`.

### 2.6 consume-invitation  (verify_jwt = false)
- **Body:** `{ token, email, password, full_name, avatar_config }` (all validated via validate.ts). **Response:** `{ ok:true, target_role }` — client then signs itself in with the password.
- **Auth:** public; invitation token = bearer of authority.
- **Flow / DB:** RPC `invitation_claim(p_token_hash, p_submitted_email)` (atomic claim) → `admin.auth.admin.createUser({email, password, email_confirm:true, user_metadata:{full_name}})` → UPDATE `profiles` SET role/full_name/avatar_config (auto-provisioning trigger created the row) → RPC `invitation_finalize(p_invite_id, p_new_user)`.
- **Rollback:** createUser failure → `invitation_rollback(p_invite_id)`; profile-update failure → deleteUser + rollback; finalize failure → logged and tolerated (claim already blocks reuse but invite not strictly final).
- **Errors:** 400 invalid_input/invalid_or_used, 409 email_taken, 500 create_failed/profile_write_failed.

### 2.7 conversation-cleanup
- **Body:** `{ conversation_id, mode: 'clear'|'delete' }`. **Response:** `{ ok, mode, summary:{ counts, r2_objects_deleted, r2_errors, db_result } }`.
- **Auth:** admin.
- **Flow:** (0) service-role snapshot of `conversations (instance_id, remote_jid)`; (1) caller-scoped RPC `admin_conversation_purge_preflight(p_conversation_id)` → counts + `r2_keys`; (2) R2 S3 `DeleteObjects` batches of 1000 (aws4fetch signed XML POST, best-effort); (3) mode clear → caller RPC `admin_conversation_clear`; mode delete → service-role `DELETE FROM conversations` (CASCADE wipes messages/assignments/notes/tags/outbound_queue; media_fetch_jobs cascade from messages); (4) on delete: Supabase **Realtime broadcast** on channel `wa-typing:<instance_id>`, event `purge_peer`, payload `{remote_jid}` — tells the worker to drop its Baileys peer-typing subscription cache (3 s subscribe timeout, best-effort).
- **Errors:** 400s, 404 conversation_not_found, 500 preflight/db failures with `partial` R2 progress, 500 handler_threw.
- **Env:** R2_MEDIA_ENDPOINT / ACCESS_KEY_ID / SECRET_ACCESS_KEY / BUCKET.

### 2.8 create-invitations
- **Body:** `{ invites: [{ email?, full_name?, target_role:'admin'|'user', expires_in_days? (1–30, default 7) }] }`, max 50; whole batch rejected on any malformed entry. **Response:** `{ ok, invitations:[{id, link, email, full_name, target_role, expires_at}] }` — raw token returned ONCE inside `link` = `${SITE_URL}/onboard/<token>`.
- **Auth:** admin.
- **DB:** bulk INSERT `invitations` (token_hash = `\x`+sha256, created_by = caller.uid) as service-role.
- **Env:** `SITE_URL`. **Errors:** 403/400/500 insert_failed.

### 2.9 group-create  (`allowUsers: true`)
- **Body:** `{ instance_id, subject, participants: string[], image? (base64) }`. **Response:** `{ ok, result, conversation_id, picture_error? }`.
- **Auth:** admin OR any authenticated agent.
- **Evolution:** `POST /group/create/:name`; optional `POST /group/updateGroupPicture/:name`.
- **DB:** `appendOwnGroupEvent(…,'create')`; service-role SELECT/INSERT `conversations` (materialize row: is_group, peer_display_name=subject, status open — idempotent vs worker webhook race, re-select on insert conflict); service-role UPSERT `conversation_assignments` (assign creator, onConflict conversation_id,user_id). Service-role deliberately bypasses the `is_admin` gate on `ensure_conversation` that would 403 agents.
- **Errors:** 400 invalid_subject/participants, 502 evolution_group_create_failed; conversation materialization best-effort.

### 2.10 group-leave  (`allowUsers: true`)
- **Body:** `{ instance_id, group_jid (@g.us) }`. **Response:** `{ ok, result }`.
- **Evolution:** `DELETE /group/leaveGroup/:name?groupJid=`.
- **DB:** UPDATE `conversations` SET left_at=now (UI swaps composer for "no longer a member"); SELECT `whatsapp_instances.wa_owner_jid`; DELETE own row from `group_participants` (match owner digits in phone_jid/participant_jid); `appendOwnGroupEvent('leave')`.
- **Errors:** 400 invalid_group_jid, 502 evolution_leave_failed.

### 2.11 group-update-participants  (`allowUsers: true`)
- **Body:** `{ instance_id, group_jid, action: 'add'|'remove'|'promote'|'demote', participants: string[] }` (participants normalized to bare digits). **Response:** `{ ok, result }`.
- **Evolution:** `POST /group/updateParticipant/:name?groupJid=`. **DB:** `appendOwnGroupEvent(action, participants)`.
- **Errors:** 400 invalid_group_jid/action/participants, 502 evolution_update_participant_failed.

### 2.12 group-update-picture  (`allowUsers: true`)
- **Body:** `{ instance_id, group_jid, image? }` — image present = change (data-URL prefix stripped), empty/omitted = attempted removal (Evolution v2.3.7 has no removeGroupPicture; failure surfaced as `evolution_remove_picture_unsupported`).
- **Evolution:** `POST /group/updateGroupPicture/:name`. **DB:** `appendOwnGroupEvent('icon'|'icon_remove')`.

### 2.13 group-update-subject  (`allowUsers: true`)
- **Body:** `{ instance_id, group_jid, subject (1–100 chars) }`.
- **Evolution:** `POST /group/updateGroupSubject/:name?groupJid=`. **DB:** `appendOwnGroupEvent('subject', [], subject)`.
- **Errors:** 400 invalid_group_jid/invalid_subject, 502.

### 2.14 instance-create
- **Body:** `{ display_name (1–80, no control chars) }`. **Response:** 201 `{ ok, instance:{ id, display_name, evolution_instance_name, status:'pending' } }`.
- **Auth:** admin.
- **Flow:** (1) generate `evolution_instance_name` = `slugify(name)-<8 random>`, per-instance token (48), webhook secret (48); (2) service-role INSERT `whatsapp_instances` (status pending, lifecycle_state 'warming', created_by) — trigger auto-creates `number_pacing_state` row; (3) caller-JWT RPCs `set_instance_token` + `set_instance_webhook_secret` (DEFINER helpers self-check is_admin; encrypted storage); (4) Evolution `POST /instance/create` with webhook `= ${WORKER_WEBHOOK_URL_BASE}/<uuid>` + `x-wa-mancer-secret`, events = DEFAULT_EVENTS, `syncFullHistory:true`; (5) on Evolution failure → best-effort Evolution delete + DB row delete (no orphans/name leak).
- **Errors:** 400 invalid_display_name, 500 db_insert_failed/secret_store_failed, 502 evolution_create_failed.
- **Env:** `WORKER_WEBHOOK_URL_BASE`, Evolution pair.

### 2.15 instance-delete
- **Body:** `{ instance_id }`. **Response:** `{ ok, summary:{ counts, r2_objects_deleted, r2_errors, evolution_status: 'deleted'|'already_gone'|'failed', evolution_error } }`.
- **Auth:** admin (withInstance).
- **Flow:** (1) caller RPC `admin_instance_delete_preflight(p_instance_id)` → counts + r2_keys; (2) R2 wipe = preflight keys ∪ live `ListObjectsV2` sweeps of prefixes `<instanceId>/` and `avatars/<instanceId>/` (catches derived `*.preview.jpg` thumbnails + cached avatars the DB key list misses), DeleteObjects in 1000-key batches, best-effort; (3) Evolution `DELETE /instance/delete/:name`, 404 tolerated, transient failure retried ×3 with backoff (0.8 s/1.6 s), persistent failure recorded but does NOT block (worker's orphan reaper sweeps Evolution leftovers — the `h-x3n7fobv` stranding incident drove this); (4) service-role DELETE `whatsapp_instances` — FK CASCADEs wipe conversations, messages, conversation_assignments, conversation_notes, conversation_tags, outbound_queue, jid_mapping, contact_profiles, tags, quick_replies, media_fetch_jobs, group_participants, number_pacing_state; `contacts` orphan via ON DELETE SET NULL (book_name survives for re-link); (5) worker stops the dispatcher itself via its realtime subscription on whatsapp_instances DELETE.
- **Errors:** 500 preflight_failed / db_delete_failed (with `partial`).
- **Env:** R2 quartet + Evolution pair.

### 2.16 instance-disconnect
- **Body:** `{ instance_id }`. **Auth:** admin. **Evolution:** `DELETE /instance/logout/:name` (404 = already gone = success). DB row untouched; status transitions later via connection.update webhook; worker stops dispatching automatically. **Errors:** 502 evolution_logout_failed.

### 2.17 instance-pair
- **Body:** `{ instance_id }`. **Response:** `{ ok, connected:true }` | `{ ok, qr_pending:true, qr:{} }` | `{ ok, qr:<evolution body> }`.
- **Auth:** admin.
- **Evolution:** `GET /instance/connectionState` (guard: state 'open' → never restart a live session), `POST /instance/restart` (forces fresh Baileys QR loop — bare connect on a lapsed loop is a no-op; restart failure tolerated), `GET /instance/connect` (first QR code). Missing code right after restart → `qr_pending` (real code arrives via qrcode.updated webhook → DB → Realtime in ~1–2 s).
- **Errors:** 502 evolution_connect_failed.

### 2.18 instance-presence
- **Body:** `{ instance_id, state: 'auto'|'online'|'offline' }`. **Response:** `{ ok, state, evolution_status?, note? }`.
- **Auth:** admin.
- **DB:** caller-JWT RPC `set_instance_settings(p_instance_id, p_patch:{manual_presence})` (canonical settings mutation path, is_admin fires under caller); service-role SELECT `whatsapp_instances.wa_owner_jid`.
- **Evolution:** `POST /chat/sendPresence` (`available`/`unavailable` broadcast) — only when state ≠ 'auto'; best-effort (DB intent persisted, `ok:true` with `note:'evolution_call_failed'` — the worker dispatcher reprojects next tick). No owner JID yet → `note:'no_owner_jid_yet'`.
- **Errors:** 400 invalid_state, 500 persist_failed/owner_lookup_failed.

### 2.19 instance-restart
- **Body:** `{ instance_id }`. **Auth:** admin. **Evolution:** `POST /instance/restart/:name` (recovers stuck-but-authenticated session; no unpair). **Errors:** 502 evolution_restart_failed.

### 2.20 instance-status
- **Body:** `{ instance_id }`. **Response:** `{ ok, connection_state, detail }` (raw Evolution bodies). **Auth:** admin. **Evolution:** parallel `GET /instance/connectionState` + `GET /instance/fetchInstances?instanceName=`. Note: v2.3.7 exposes no linked-devices endpoint.

### 2.21 instance-wa-profile
- **Body:** `{ instance_id, fields?: ('name'|'status'|'picture')[] }` (default all). **Response:** `{ ok, results:{ name|status|picture: 'ok'|'failed'|'skipped' } }`.
- **Auth:** admin. **DB:** service-role SELECT `whatsapp_instances (wa_profile_name, wa_profile_status, profile_pic_url)`.
- **Evolution:** `POST /chat/updateProfileName`, `/chat/updateProfileStatus`, `/chat/updateProfilePicture` — pushed only for non-empty DB values; per-field failure tolerated.

### 2.22 instance-wa-settings
- **Body:** `{ instance_id }` — values are NOT accepted in the body; DB is single source of truth (UI writes flags via `set_instance_settings` RPC first, then calls this to push).
- **Auth:** admin. **DB:** service-role SELECT `whatsapp_instances` flags: `wa_reject_calls, wa_call_reply_text, wa_always_online, wa_auto_read_inbound, wa_read_status, wa_ignore_groups, wa_sync_full_history`.
- **Evolution:** `POST /settings/set/:name` mapping to `rejectCall, msgCall, alwaysOnline, readMessages, readStatus, groupsIgnore, syncFullHistory`.
- **Errors:** 500 lookup_failed, 404, 502 evolution_set_failed.

### 2.23 instance-webhook-resync
- **Body:** `{ instance_id }`. **Response:** `{ ok, events: CANONICAL_EVENTS, evolution_status }`.
- **Auth:** admin.
- **DB:** service-role RPC `reveal_instance_webhook_secret(p_instance_id)` (decrypts secret for the header).
- **Evolution:** `POST /webhook/set/:name` pushing `CANONICAL_EVENTS` (must mirror evolution.ts DEFAULT_EVENTS) + `x-wa-mancer-secret`, url `${WORKER_WEBHOOK_URL_BASE}/<instance_id>`. Operational rescue for stale subscriptions (CONTACTS_UPSERT rollout incident).
- **Errors:** 500 secret_lookup_failed/no_webhook_secret, 502 evolution_webhook_set_failed.
- **Env:** `WORKER_WEBHOOK_URL_BASE`.

### 2.24 media-sign
- **Body:** `{ message_id }`. **Response:** `{ ok, url, expires_at, mime, size_bytes, filename }` | reasons `invalid_input|forbidden|not_found|pending(425)|no_media`.
- **Auth:** user (asCaller + getUser). **Authorization = RLS:** caller-scoped read of `messages_decrypted` (security_invoker view) — if RLS hides the row, 404.
- **Mechanism:** builds a **public, never-expiring capability URL** `https://<R2_MEDIA_PUBLIC_DOMAIN>/<key>` (CF-edge cached; path contains 3 UUIDs ≈ 366 bits entropy; no bucket LIST exposed). `expires_at` (+30 min) is only a client-side re-check hint (TanStack staleTime).
- **DB:** caller RPC `audit('media_access','message',id,{key,domain})` fire-and-forget.
- **Errors:** 425 pending (worker hasn't re-hosted yet), 500 signing_failed + `logError`.
- **Env:** `R2_MEDIA_PUBLIC_DOMAIN`.

### 2.25 media-upload
- **Body (4 shapes):** conversation `{ conversation_id, mime, size_bytes }`; quick reply `{ instance_id, purpose:'quick_reply', … }`; scheduled `{ conversation_id, purpose:'scheduled_message', … }`; doc preview `{ message_id, purpose:'doc_preview', mime:'image/jpeg' only }`.
- **Response:** `{ ok, bucket, key, url (presigned PUT), expires_at, max_bytes }` | reasons `invalid_input|forbidden|too_large(413)|unsupported_mime(415)|signing_failed`.
- **Auth:** user. **Authorization = RLS reads** via caller client: `conversations`, `whatsapp_instances`, `messages_decrypted` respectively.
- **Mechanism:** aws4fetch query-signed PUT URL, TTL 15 min, cap 100 MB (WA Business). MIME allow-list → extension; unknown MIME falls back to `.bin` (extension cosmetic; real filename/mime ride in media_meta); `text/html`/`application/xhtml+xml` rejected up-front (Baileys drops them silently). Key shapes: `<instance>/<conv>/<uuid>.<ext>`, `<instance>/qr/<uuid>.<ext>`, `<instance>/<conv>/sm/<uuid>.<ext>`, `<media_storage_key>.preview.jpg`.
- **DB:** caller RPC `audit('media_upload_url_issued', …)` fire-and-forget. Orphaned PUTs swept by a separately-configured 24 h R2 lifecycle rule.
- **Env:** R2 quartet.

### 2.26 og-fetch
- **Body:** `{ url (≤2048) }`. **Response:** `{ ok, preview:{ url, canonical, title, description, image, site_name, domain } }` | reasons `invalid_input|forbidden|unfetchable|timeout|too_large|not_html` (fetch soft-failures return HTTP 200 with ok:false).
- **Auth:** user (any authenticated; no admin gate).
- **SSRF hardening:** http/https only; string-level private-host blocklist (localhost, RFC1918, 169.254/16 incl. metadata, fc00::/7, `.local`); then **DNS-resolution validation** via `Deno.resolveDns` A+AAAA (defeats rebinding + non-canonical literals; unrecognizable literal → refuse); re-checked on post-redirect final URL. 6 s timeout, 1.5 MB body cap, charset sniffing, regex OG/Twitter/canonical extraction (no HTML parser).
- **DB:** `og_cache` — service-role read-probe by `url_hash` (sha256 of href, 24 h TTL) before fetch; upsert write-back under final hash + requested hash on success. Content-addressed, shared across all callers, best-effort.
- **Errors:** 500 server_error + `logError`. UA string: `…WhatsAppMancer/1.0; +https://wa.welcomdeal.ma…`.

---

## 3. Cross-reference tables

### DB objects touched by edge functions
| Object | Kind | Functions |
|---|---|---|
| whatsapp_instances | table | withInstance (all 13 users), instance-create, instance-delete, instance-wa-settings, instance-wa-profile, instance-presence, group-leave, groupEvents, media-upload (RLS) |
| conversations | table | group-create, group-leave, conversation-cleanup, media-upload (RLS) |
| conversation_assignments | table | group-create (upsert) |
| group_participants | table | group-leave (delete), groupEvents (read) |
| contacts | table | groupEvents (read) |
| invitations | table | create-invitations (insert) |
| profiles | table | consume-invitation (update) |
| messages_decrypted | security_invoker view | media-sign, media-upload doc_preview |
| og_cache | table | og-fetch |
| system_logs | table (via RPC) | logError, client-log, admin-platform-logs |
| is_admin | RPC | requireAdmin |
| append_group_system_event | RPC | groupEvents (+ worker) |
| ingest_system_logs | RPC | logError, client-log |
| ingest_platform_logs | RPC | admin-platform-logs |
| invitation_status / invitation_claim / invitation_rollback / invitation_finalize | RPC | check-invitation, consume-invitation |
| audit | RPC (hash-chained log) | admin-delete-user, media-sign, media-upload |
| set_instance_settings | RPC | instance-presence |
| set_instance_token / set_instance_webhook_secret | RPC (DEFINER, encrypted) | instance-create |
| reveal_instance_webhook_secret | RPC | instance-webhook-resync (+ worker verify.ts) |
| admin_conversation_purge_preflight / admin_conversation_clear | RPC | conversation-cleanup |
| admin_instance_delete_preflight | RPC | instance-delete |
| auth.admin.createUser / deleteUser | GoTrue admin API | consume-invitation, admin-delete-user |
| Realtime channel `wa-typing:<instance_id>` | broadcast | conversation-cleanup (`purge_peer`) |

### Auth model per function
- **Admin JWT:** admin-delete-user, admin-platform-logs (read mode), check-whatsapp, conversation-cleanup, create-invitations, instance-create, instance-delete, instance-disconnect, instance-pair, instance-presence, instance-restart, instance-status, instance-wa-profile, instance-wa-settings, instance-webhook-resync.
- **Any authenticated user:** client-log, group-create, group-leave, group-update-participants, group-update-picture, group-update-subject, media-sign, media-upload, og-fetch.
- **Service-role bearer:** admin-platform-logs (persist mode).
- **Public (verify_jwt=false):** check-invitation, consume-invitation.

---

## 4. Surprises / merge hazards

1. **No webhook edge function.** Evolution → Node worker `POST :8090/webhook/:instanceId` over docker-internal DNS (`wa-mancer-worker`). Relocating Evolution to the WhatsApp VPS (213.199.54.67) breaks the same-network assumption: `WORKER_WEBHOOK_URL_BASE` must become a URL reachable FROM the new VPS (public/tunnel), and the `x-wa-mancer-secret` header becomes the only auth on a now-network-exposed endpoint (no HMAC in Evolution 2.3.7).
2. **admin-platform-logs is Supabase-cloud-only** — it calls `api.supabase.com` Management API with `MGMT_PAT` and derives PROJECT_REF from SUPABASE_URL. On iGrowFast's self-hosted box there is no Management API/logs.all; the function (and the worker's 60 s persist pull that feeds `system_logs` platform_* rows) must be redesigned or dropped.
3. **`verify_jwt=false` pins** for check-invitation/consume-invitation live in config.toml; a blanket deploy without them breaks onboarding (already happened 2026-06-05). Self-host Kong/edge-runtime equivalent config must replicate this.
4. **Authorization gap in `withInstance` + `allowUsers`:** instance lookup is service-role with NO caller↔instance relationship check. The five group functions accept ANY authenticated user acting on ANY `instance_id`. Comments still say "Admin-only" (drift). In multi-tenant iGrowFast this becomes a cross-business hole unless per-business scoping is added.
5. **Everything is `public` schema, unqualified** — tables, RPCs, and worker SQL (`public.ingest_message` etc.). The planned `whatsapp` schema move requires touching every RPC call site in 26 functions + worker handlers.
6. **Name collisions with iGrowFast core:** `is_admin()` RPC (WA Mancer's flat admin/user model vs iGrowFast's 6-role enum + per-business roles), `profiles` table, `audit` RPC + hash-chained audit log (iGrowFast RIPPED OUT its audit-log feature 2026-06-22 — reintroduction is a decision, not a port), invitation system overlaps iGrowFast's `user_invitations` + send-invitation flow.
7. **media-sign URLs are permanent public capability tokens** on `media.welcomdeal.ma` — no expiry, no revocation short of deleting the object; RLS only gates who LEARNS the URL. Fine for the standalone app; evaluate against iGrowFast's stricter posture and its existing R2 topology (4 WEUR buckets, scoped Keychain tokens).
8. **Hardcoded welcomdeal.ma branding/domains:** `media.welcomdeal.ma` (media-sign default), `api.welcomdeal.ma` (Evolution, comment), `wa.welcomdeal.ma` (og-fetch UA), bucket `wamancer-media`, `SITE_URL` default localhost.
9. **Body-consumed-once trap:** `withInstance` parses the request; handlers reading `req.json()` again get `{}` — historical 400 bugs (presence toggle, group-create). Any refactor must preserve `ctx.body` plumbing.
10. **Optimistic-pill dedup contract:** `appendOwnGroupEvent` and the worker's stub-ingest compute the SAME dedup key (event/actor/targets + 5-min guard). Porting one side without the other yields duplicate or missing system pills.
11. **Event-list twins:** `DEFAULT_EVENTS` (evolution.ts) and `CANONICAL_EVENTS` (instance-webhook-resync) must stay identical; `GROUP_UPDATE` singular is load-bearing (GROUPS_UPDATE → Evolution 400).
12. **bearerIsServiceRole decodes JWT claims without local signature verification** (admin-platform-logs persist mode) — safe only while the platform gateway verifies signatures; self-host gateway config changes could make it forgeable.
13. **esm.sh imports** (supabase-js, aws4fetch) need internet at bundle/boot on the self-hosted edge runtime.
14. **og-fetch uses `Deno.resolveDns`** — verify the self-hosted edge-runtime version permits it (some builds restrict net/dns ops).
15. **Duplicated R2 code:** `r2DeleteBatch`/`escapeXml` copy-pasted in conversation-cleanup and instance-delete (instance-delete adds `r2ListPrefix`); consolidate on port.
16. **consume-invitation is not transactional end-to-end:** finalize failure leaves a claimed-but-unconsumed invite (logged, tolerated); createUser/profile failures have best-effort rollbacks.
17. **conversation-cleanup signals the worker via a Realtime broadcast** (`wa-typing:<instance_id>` / `purge_peer`) — the merge target must run Supabase Realtime with broadcast enabled and the worker subscribed, or peer-typing resubscription silently degrades (20-min warmup loop is the fallback).
