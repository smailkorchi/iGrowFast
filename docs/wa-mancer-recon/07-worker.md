# WA Mancer Recon — 07: Node Worker

Recon date: 2026-07-05. Source: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/worker/` (read-only).
22 TS source files. Node 22 ESM, TypeScript `5.7` (strict, `NodeNext`), deps `pg@8`, `@supabase/supabase-js@2.45`, `@aws-sdk/client-s3@3`. Docker `node:22-alpine`, CMD `node dist/index.js`. The worker is the outbound chokepoint (per-number serializer + humanized pacing) AND the Evolution webhook receiver; it talks to Supabase over a **direct pg pool** (LISTEN/NOTIFY + advisory locks) plus a service-role supabase-js client, and to Cloudflare R2 via the S3 SDK.

> Note on file list: the recon brief named `src/storage.ts`; no such file exists. The R2 storage layer is `src/r2/client.ts`. Everything else in the brief is present. There is also an unlisted one-shot CLI: `src/scripts/backfill-avatars.ts`.

---

## 0. One-screen facts

- **Two Supabase connection paths.** (1) `pg.Pool` against `DATABASE_URL` — MUST be the pooler in **session mode** (preserves `pg_advisory_lock`, LISTEN/NOTIFY, prepared statements); `max: 10`, `application_name: wa-mancer-worker/<version>`. (2) `@supabase/supabase-js` service-role client — used ONLY for Realtime (`whatsapp_instances` postgres_changes + `wa-typing:<id>` broadcast) and the `ingest_system_logs` RPC. Almost all DB work is raw SQL through the pool, not PostgREST.
- **Two Evolution auth identities, two code paths.** The dispatcher's `EvolutionClient` uses the **per-instance token** (`reveal_instance_token`) for all messaging. Instance status/lifecycle/group-info/profile-pic calls are **raw `fetch()`** with the **global** key (`EVOLUTION_GLOBAL_API_KEY`) scattered in `instance-manager.ts` and `handlers.ts` — they do NOT go through `EvolutionClient`.
- **Everything DB-side is `public.*`, unqualified.** ~25 distinct RPCs + direct writes to `whatsapp_instances`, `conversations`, `contacts`, `group_participants`, `messages`, `media_fetch_jobs`.
- **Webhook server is internal-only** (`0.0.0.0:8090`, not published in compose). Assumes Evolution shares the docker network. Auth = static `x-wa-mancer-secret` header (Evolution 2.3.7 has no HMAC).
- **No process-level `unhandledRejection` / `uncaughtException` handler.** Only `main().catch → exit(1)`. Every periodic loop self-wraps in try/catch.
- **Config is a fail-fast singleton** (`config.ts`) — EXCEPT `MEDIA_INGEST_CONCURRENCY`, which `media-ingest.ts` reads directly from `process.env`.

---

## 1. Bootstrap / lifecycle (`index.ts`)

- **Startup order in `main()`** — strictly sequential; each numbered step below is a real call in this order:
  1. `startLogSink()` — FIRST, so `worker.boot` itself is captured into `system_logs`.
  2. `log.info('worker.boot', …)`.
  3. `pool.query('SELECT version(), now()')` — fail-fast DB connectivity probe (`pg.connected`).
  4. `listenOn('outbound_enqueued', wakeLoop)` — NOTIFY plumbing that wakes per-number loops.
  5. `listenOn('media_fetch_ready', wakeMediaIngest)` + `startMediaIngest()`.
  6. `startHeartbeat()` — `worker_heartbeat` UPSERT every `HEARTBEAT_INTERVAL_MS` (default 5 s).
  7. `setInterval(refreshQueueDepth, 5_000)` (`unref`) — refreshes the queue-depth number the heartbeat carries.
  8. `startDispatcherSnapshot(3_000)` — grouped `dispatcher_snapshot` UPSERT every 3 s.
  9. `startPlatformLogPull()` — pulls Supabase platform logs into `system_logs` every 60 s.
  10. `startR2MetricsPull()` — samples R2 bucket size every 10 min.
  11. `await startInstanceManager()` — loads instances, claims leases, spawns dispatchers, subscribes Realtime.
  12. `startWebhookServer()` → stores `webhookCloser`.
  13. `startActivePeerWarmup()` — re-subscribes peer presence every 20 min.
  14. `startSelfPresenceLoop()` — independent 10 s online/offline driver.
  15. `log.info('worker.ready')`.

- **Concurrent moving parts once ready** (all in one process): the webhook HTTP server; **N per-number dispatcher loops** (one per owned, `connected`, non-`banned` instance); one media-ingest tick loop (fans out up to `MEDIA_INGEST_CONCURRENCY` sub-workers per tick); the dedicated LISTEN pg client; and timers for heartbeat (5 s), queue-depth (5 s), snapshot (3 s), platform-log pull (60 s), R2 metrics (10 min), lease renewal (20 s), status reconcile (45 s), orphan reaper (30 min), self-presence (10 s), active-peer warmup (20 min), logSink flush (4 s). Every timer is `unref`'d.

- **Graceful shutdown** (`SIGTERM`/`SIGINT` → `shutdown(signal)`), guarded by a `shuttingDown` flag, in order: `stopHeartbeat`, `stopMediaIngest`, `stopActivePeerWarmup`, `stopSelfPresenceLoop`, `stopDispatcherSnapshot`, `stopPlatformLogPull`, `stopR2MetricsPull`, `await webhookCloser()`, `await stopInstanceManager()` (**releases all leases** via `worker_release_instance_leases` so a peer/restart picks up without the 60 s wait, and removes the Realtime channel), `await stopLogSink()` (final flush), `await closeDb()` (release LISTEN client + `pool.end()`), then `process.exit(0)`.
  - **Not drained on shutdown:** individual dispatch loops are not individually `stopDispatcher`'d; in-flight sends are cut by `process.exit(0)`. There is no "finish the queue" grace. Lease release + `queue_claim_next`'s atomicity make an interrupted send safe to re-claim.

- **Fatal path:** `main().catch` logs `worker.fatal` (message + stack) and `process.exit(1)`. There is NO `process.on('unhandledRejection')`.

---

## 2. Dispatcher loop (`dispatcher/loop.ts`, `pacing.ts`, `instance-manager.ts`)

### 2.1 Loop mechanics

- **One async loop per number**, tracked in `const loops = new Map<numberId, RunningLoop>()`. `spawnDispatcher(instance)` constructs a per-instance `EvolutionClient` (per-instance token) and fires `runLoop(r)` without awaiting. `stopDispatcher` sets `shouldExit` and wakes the loop.
- **Wake strategy:** the global LISTEN handler for `outbound_enqueued` calls `wakeLoop(numberId)`, which resolves that number's pending `wake` promise. When the queue is empty the loop `await waitForWakeOrTimeout(r, 5_000)` — woken by NOTIFY or a 5 s timeout (also the heartbeat that catches `not_before` reaching due time).
- **One iteration** (`iterate` → `processAction`):
  1. **Content gates** (only for content sends): `withinDispatchWindow` (timezone-aware `business_hours` JSONB, quiet-hours override punch-through, 24/7 when `business_hours_enabled=false`) THEN `SELECT … FROM public.dispatch_gate_check($instance)` (hourly/daily hard caps → `resume_at`). Passive actions (`typing_start`/`typing_stop`/`mark_read`) BYPASS both gates.
  2. **Claim:** `SELECT * FROM public.queue_claim_next($instance, $contentAllowed)` — atomic `queued→dispatching`; when `contentAllowed=false` only passive rows are eligible. (Per the DB chapter this RPC is atomic **without** `SKIP LOCKED`.)
  3. **Pacing context:** reads `number_pacing_state.last_send_at`/`last_send_conversation_id` + `conversations.remote_jid`.
  4. Dereferences the `messages_decrypted` row for `send_*` (never trusts plaintext from the payload).
  5. Applies pacing waits (2.2), typing pre-roll (2.3), dispatches to Evolution (§3).
  6. Marks the queue row: `queue_mark_sent(id, evolutionMsgId ?? 'local:'+id)` (this RPC now ALSO folds the `messages` `SERVER_ACK` + `evolution_message_id` update — one WAN round-trip, not two), or `queue_mark_failed(id, err, retryInSeconds)`, or `queue_mark_dead(id, reason)`.
  7. `markDispatched()` + `recordDispatchCompleted()` feed the heartbeat drain-rate window.

- **Retry-before-dead lives in the worker**, not the DB:
  ```ts
  const MAX_ATTEMPTS = 4
  const BACKOFF_SECONDS = [2, 8, 30, 120]   // attempts 1→2, 2→3, 3→4, 4→dead
  ```
  `handleDispatchError`: `retryable = err instanceof EvolutionError ? err.isRetryable : true` (network errors retry). If `!retryable || attempts >= MAX_ATTEMPTS` → `queue_mark_dead`; else `queue_mark_failed(id, msg, BACKOFF_SECONDS[attempt-1])`. `row.attempts` is already incremented by `queue_claim_next`.

### 2.2 Pacing math (the humanization NOT in the DB)

Two layers, both zero under normal solo/single-contact use. Same-contact rapid-fire and idle-then-send always pass instantly.

- **Cross-contact micro-gap** (`pacing.ts`, pure function). The only ban bullet modeled: fast switching between DIFFERENT contacts on one number.
  ```ts
  const CONTENTION_WINDOW_MS = 8_000
  const CROSS_CONTACT_MIN_MS = 1_500
  const CROSS_CONTACT_MAX_MS = 4_000
  // …inside crossContactGap:
  const elapsed = now - numberLastSendAt
  if (elapsed >= CONTENTION_WINDOW_MS) return { waitMs: 0, reason: 'idle' }
  if (lastConvId === thisConvId)       return { waitMs: 0, reason: 'same_contact' }
  const target = CROSS_CONTACT_MIN_MS + Math.random() * (CROSS_CONTACT_MAX_MS - CROSS_CONTACT_MIN_MS)
  const waitMs = Math.max(0, Math.round(target) - elapsed)   // subtract time already spent
  ```
- **Token bucket** (DB RPC): only for content sends AND only when `!sameContact`:
  ```ts
  SELECT public.pacing_take_token($number_id, $sendRatePerMin, $minuteBurstCap) AS wait_ms
  ```
- **Canned multi-attachment human spacing** (loop.ts) — for `origin ∈ {quick_reply, scheduled}` `send_media` bursts to the same contact within `CANNED_BURST_WINDOW_MS = 60_000`:
  ```ts
  const CANNED_ITEM_MIN_MS = 2_000,     CANNED_ITEM_MAX_MS = 5_000       // same modality
  const CANNED_MODALITY_MIN_MS = 4_500, CANNED_MODALITY_MAX_MS = 9_000   // photo→video→voice→doc switch
  cannedBurstMs = Math.round(lo + Math.random() * (hi - lo))
  ```
- **Effective wait** = `Math.max(cross.waitMs, tokenWaitMs, cannedBurstMs)`, applied as a **hard sleep** (NOT wake-interruptible — a fresh NOTIFY must not cut a pacing wait short and leak the rate ceiling; `shouldExit` still aborts).

### 2.3 Typing / recording / read-to-reply simulation

- **Typing pre-roll fires ONLY for canned origins** (quick_reply/scheduled), because interactive typed sends already stream live `composing` from the composer, and forwards relay plain. Value must match the human action:
  - text → `composing`, scaled by `typingDurationForText`; media WITH caption → `composing`; captionless media → NO indicator, no sleep; voice note (`ptt`) → `recording`.
  ```ts
  // typingDurationForText (default cfg baseMs 2000, perCharMs 60, capMs 12000 — overridden per instance)
  const noise = Math.round(800 + randn() * 400)                        // Box-Muller gaussian
  const computed = Math.max(cfg.baseMs, text.length * cfg.perCharMs + noise)
  return Math.min(cfg.capMs, computed)
  ```
  - Recording pre-roll scales to the clip's `media_meta.seconds`, clamped `RECORDING_MIN_MS 2_500 … RECORDING_MAX_MS 15_000` (unknown duration → `3_000 + rand*4_000`).
- **Presence is fired DETACHED** (`void r.client.sendPresence(...)`) while the loop `await sleep(holdMs)` runs concurrently — Evolution holds the `sendPresence` HTTP open for `delay` ms and does NOT serialize a number's calls (verified in comments); awaiting it would double the stall on the single per-number loop.
- **Single typing slot per number** (`typingHolderConvId`/`typingHolderUntil`, `TYPING_SLOT_TTL_MS = 8_000`): a real number is one human in one chat, so at most ONE conversation broadcasts "typing…". `typing_start` from a second conversation is suppressed until the holder sends, stops, or the slot times out. Live `typing_start`/`typing_stop` are dispatched fire-and-forget; the queue row is marked sent immediately.
- **No explicit read-to-reply delay** beyond the above; blue-tick behavior is governed by `read_receipts_mode` (`off`/`on_open`/`on_dispatch`) and the `mark_read` action, which bypasses pacing.

### 2.4 Self-presence (ban-safety, independent timer)

- `startSelfPresenceLoop()` runs a **10 s** timer (`SELF_PRESENCE_TICK_MS`) decoupled from the dispatch loop so online→offline honors the attendance grace even mid-burst. `manual_presence`: `online`→force `available`, `offline`→force `unavailable`, `auto`→`available` only while the inbox is attended (viewer registry, §4-webhook), else `unavailable`. Re-affirms `available` at least every `SELF_PRESENCE_REAFFIRM_MS = 60_000` (survives Baileys reconnects). Owner JID from `whatsapp_instances.wa_owner_jid` (cached). First attend flips online in ~1 s via `setOnFirstAttend`.

### 2.5 Business-hours / quiet-hours / caps enforcement

- **Business hours + quiet-hours override:** enforced worker-side in `withinDispatchWindow` (Intl timezone rendering of `business_hours` JSONB; overnight windows handled; permissive on malformed tz).
- **Caps:** enforced via `dispatch_gate_check` RPC (DB owns hourly/daily counters); worker sleeps `min(resume_at-now, 5min)` when content-gated but stays NOTIFY-wakeable so passive actions still flow.

### 2.6 Instance manager & leases (`instance-manager.ts`)

- **Lease model:** `LEASE_DURATION_SEC = 60`, renewed every `LEASE_RENEW_INTERVAL_MS = 20_000`. Claim/renew/release via `worker_claim_instance_leases(workerId, ids[], 60)`, `worker_renew_instance_leases(workerId, 60)`, `worker_release_instance_leases(workerId)`. **First-come strategy** (every worker races to claim every instance; single-worker deployments claim everything). On renew it also tries to claim any unowned `connected` non-`banned` instance (peer-worker death takeover) and spawns their loops; instances whose lease it lost → `stopDispatcher`.
- **`shouldRun` = `status==='connected' && lifecycle!=='banned'`.** Realtime `postgres_changes` on `whatsapp_instances`: UPDATE → refresh cached `InstanceConfig` without bouncing the loop; DELETE → `stopDispatcher`.
- **Evolution status reconciler** (`STATUS_RECONCILE_INTERVAL_MS = 45_000`, also once at boot before load): raw `fetch GET /instance/connectionState/:name` with the GLOBAL key; heals rows stuck on a stale `status` (only `open→connected`, `close→disconnected`; `connecting` ignored). Runs BEFORE `loadAllAndReconcile` so a stuck `connecting` still gets a loop.
- **Auto-reconnect watchdog** (opt-in `auto_reconnect` column): backoff `[30s,60s,120s,300s]`, `WATCHDOG_MAX_ATTEMPTS = 6`, `STUCK_CONNECTING_MS = 180_000`. Terminal disconnect codes `{401,403,402,406}` → `status_detail='needs_repair:<code>'`, no restart. Restart = raw `POST /instance/restart/:name` (global key).
- **Orphan reaper** (`ORPHAN_REAP_INTERVAL_MS = 30min`, `ORPHAN_MIN_AGE_MS = 10min`): lists ALL Evolution instances (`GET /instance/fetchInstances`, global key) and `DELETE /instance/delete/:name` any with no `whatsapp_instances` row older than 10 min. **Hazard flag for a shared Evolution** (§9).

---

## 3. Evolution client (`evolution/client.ts`)

- **Base URL:** `config.evolutionApiUrl` (trailing slash stripped), or per-call `baseUrl` override. **Timeout:** 30 s default (media-ingest constructs one at 60 s). Request pattern: `fetch(`${baseUrl}${path}/${encodeURIComponent(instance)}`)` with headers `content-type: application/json` + `apikey: <per-instance token>`.
- **Auth:** the **per-instance** token fetched via `reveal_instance_token` when a loop spawns (cached for the loop's lifetime; the media/presence paths cache 5 min). This client NEVER uses the global key.
- **Endpoints hit** (each `POST` unless noted; instance appended to path):
  - `sendText` `/message/sendText` — supports `quoted`, `mentioned[]`, `mentionsEveryOne`.
  - `sendMedia` `/message/sendMedia` — base64 body, `mediatype`, `mimetype`, `fileName`, `caption`.
  - `sendWhatsAppAudio` `/message/sendWhatsAppAudio` — PTT voice notes (`encoding:true`).
  - `sendPoll` `/message/sendPoll`.
  - `sendReaction` `/message/sendReaction`.
  - `sendContact` `/message/sendContact` — 1 card = contactMessage, N = contactsArrayMessage.
  - `sendPresence` `/chat/sendPresence` — composing/recording/available/unavailable/paused, `delay` = display ms.
  - `findContacts` `/chat/findContacts` — full contact backfill.
  - `markMessageAsRead` `/chat/markMessageAsRead`.
  - `updateMessage` `/chat/updateMessage` — edit.
  - `deleteMessage` **`DELETE` `/chat/deleteMessageForEveryone`** — retract.
  - `getBase64FromMediaMessage` `/chat/getBase64FromMediaMessage` — returns `null` on 404 (message beyond Evolution's ~14-day cache).
- **NOT in this client** (raw `fetch`, GLOBAL key, elsewhere): `connectionState`, `restart`, `delete`, `fetchInstances` (instance-manager); `findGroupInfos`, `fetchProfilePictureUrl`, `fetchProfile`, `fetchInstances` (handlers). Instance create/connect/logout/group-create/etc. are EDGE-function concerns, not the worker.
- **Error handling:** `EvolutionError { status, body, endpoint }`; `status:0` = network/timeout (thrown on `fetch` reject/`AbortError`). `get isRetryable()` = `status===0 || status===429 || (500..599)`. HTTP errors logged as `evolution.http_error` with a 200-char body preview (full echoed body — which can contain recipient number + text — is never persisted; the log sink additionally scrubs). No internal retry loop; retries are driven by the dispatcher's `queue_mark_failed` + backoff.

---

## 4. Webhook receiver (`webhook/server.ts`, `verify.ts`, `handlers.ts`, `types.ts`)

### 4.1 Server & auth

- **Routes:** `POST /webhook/:instanceId` (path regex requires a 36-char UUID) and `GET /healthz` (no auth). Anything else → 404. Listens `0.0.0.0:8090` (`WEBHOOK_PORT`), internal docker network only.
- **Body cap:** `MAX_BODY_BYTES = 5 * 1024 * 1024` (5 MB) — stream aborted + 413 past it.
- **Secret verification** (`verify.ts`): header `x-wa-mancer-secret`. `verifyWebhook` fetches the expected secret via `SELECT public.reveal_instance_webhook_secret($instanceId)`, **caches 30 s** (`CACHE_TTL_MS`), and compares with `crypto.timingSafeEqual` after a length guard (constant-time). Returns `null` on success or a short reason string → 401. `invalidateSecretCache(id)` exists for rotation but is currently only referenced to keep the linter happy.
- **ACK-first:** replies `200 {ok:true}` immediately, then `setImmediate(() => handleEvent(...))`. Evolution retries on non-2xx, so processing failures are logged (`webhook.handle_threw`) but never re-raised — Evolution already got its 200.

### 4.2 Event → DB action map (`handlers.ts`, 2802 lines)

`handleEvent` switch:

- **`messages.upsert`** → `ingestMessage`. Rejects `status@broadcast`/`@broadcast`/`@newsletter`. Extracts kind/body/media_meta (`extractContent` handles conversation, extended text + link preview, image/video/audio/document/sticker, reaction, template — hydrated + interactiveMessageTemplate incl. nativeFlow buttons + header-image keys, album children, location, contact(s), protocol, placeholder, secretEncrypted). Then:
  - Captures LID↔phone Alt pairs both directions → `upsert_jid_mapping` + `resolve_identity('phone', … 'lid', …)` + `consolidate_lid` (deterministic, never fuses).
  - Reactions → `apply_reaction` (no separate row).
  - Group system stub → `writeGroupSystemEvent` → `append_group_system_event`.
  - Main insert: `ingest_message(p_instance_id, p_remote_jid, p_direction, p_kind, p_body, p_media_meta, p_evolution_message_id, p_sender_jid, p_reply_to, p_whatsapp_ts, p_delivery_status)`. **Returns the new message id only on INSERT, NULL on conflict** — that NULL/non-NULL is the dedup signal.
  - Media kinds (or template-with-header) AND a fresh INSERT → `enqueue_media_fetch(newMsgId, instanceId, evolutionMsgId, kind)`.
  - Peer display-name / profile-pic patches to `conversations`; group sender pushName → `upsert_contact_profile` + `group_participants`.
  - Inbound DM → `ensurePeerPresenceSubscribed` (fires `sendPresence` to make WhatsApp start pushing that peer's typing).
- **`messages.update`** → monotonic `delivery_status` advance on `messages` (guarded by `public._delivery_rank`; never regresses read→delivered; `ERROR/FAILED` always applied). Handles flat v2.3.7 shape + nested Baileys fallback.
- **`messages.delete`** / inbound REVOKE protocol → `handleInboundRevoke` sets `revoked_at/revoked_by='remote'` (tombstone, keeps the row).
- **`messages.set`** → `recordSyncProgress` (updates `sync_progress`/`history_synced_at`) then same path as upsert; sync completion triggers `backfillContactsFromEvolution` (`findContacts` → `upsertContactFromSync`).
- **`connection.update`** → `handleConnectionUpdate`: maps `open/close/connecting` → status enum; stamps `paired_at`, binds `phone_number` from `wuid`, resets sync markers, clears `qr_code` on terminal states. On `connected`: purges peer subscriptions (new socket), re-subscribes focused peer if attended, `refreshInstanceProfile` (fetchInstances/fetchProfilePictureUrl/fetchProfile → pic cached to R2 + `wa_owner_jid`/`wa_profile_name`), and a delayed contact backfill.
- **`qrcode.updated`** → writes `qr_code` + `status='connecting'`, guarded `WHERE status <> 'connected'` (a late QR must not downgrade a paired instance).
- **`contacts.upsert`/`contacts.update`** → `handleContactsUpsertOrUpdate`: caches avatar to R2, `upsert_contact_profile`, `resolve_identity` (single-writer for `contacts`+bible), DM conversation upsert; group `profilePicUrl` = icon change/removal signal → `append_group_system_event`.
- **`chats.upsert`/`chats.update`** → group subject / DM name, `looksLikeFallbackName` filter; group `chats.update` forces `maybeRefreshGroupInfo`.
- **`groups.update`/`groups.upsert`** → new-group "Vous avez créé ce groupe" pill + roster refresh.
- **`group-participants.update`** → the AUTHORITATIVE roster delta (the messages.upsert stub channel is DEAD in Evolution v2.3.7). Reclassifies self-remove→leave, awaits `maybeRefreshGroupInfo` (fills `group_participants`, resolves actor LID→phone), then `writeGroupSystemEvent` (`append_group_system_event` + owner `left_at` sync + `captureJidMapping`).
- **`presence.update`** → resolves @lid→phone JID (`jid_mapping` then `contact_identifiers` bible fallback, cross-instance, read-only) and broadcasts `{remote_jid, participant_jid, presence, at_ms}` on Realtime channel `wa-typing:<instance_id>`.

### 4.3 Dedup & presence-subscription plumbing

- **Message dedup:** by `evolution_message_id` inside `ingest_message` (INSERT-or-NULL). Delivery receipts deduped by monotonic rank. Group-event pills deduped inside `append_group_system_event` (event/actor/targets key + 5-min guard) — the SAME contract as the edge function's optimistic `appendOwnGroupEvent`.
- **Inbox attendance registry:** the `wa-typing:<id>` channel doubles as a frontend→worker bus. Frontend broadcasts `attend`/`leave` (per-tab viewer heartbeat, `VIEWER_TTL_MS = 35_000`), `open` (focused peer → force re-subscribe), and edge functions broadcast `purge_peer` (conversation deleted). `isInstanceAttended` drives the self-presence driver; `refreshActiveOpenPeer` keeps the focused peer's Baileys subscription warm.
- **Peer subscribe throttle:** `PEER_SUBSCRIBE_TTL_MS = 30min` per `(instance, peer)`; `force` bypasses it. Purged wholesale on reconnect (`purgePeerSubscriptionsForInstance`). Active-peer warmup re-subscribes every DM with inbound in the last 24 h, every 20 min, in batches of 25 with a 500 ms gap.

---

## 5. Media pipeline (`dispatcher/media-ingest.ts`, `media-variation.ts`, `r2/client.ts`, `r2/avatar.ts`)

### 5.1 Ingest drain loop

- **Claim** (`claimNextJob`): `WITH locked AS (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` ordered **newest-first** (`m.whatsapp_timestamp DESC`) — WhatsApp CDN URLs expire in hours, so the freshest job has the best download odds. Claim bumps `next_attempt_at = now() + interval '5 minutes'` as a lease (a crashed worker's job re-claims after the lease). This IS `SKIP LOCKED` (unlike `queue_claim_next` on the outbound side, which is not).
- **Fetch:** per-instance token (`getInstanceCreds`, 5-min cache). Normal path = `evo.getBase64FromMediaMessage`. Fallback = **direct WhatsApp CDN download** for template header images (`downloadWhatsAppMedia`): `GET https://mmg.whatsapp.net<directPath>`, then the standard WA media protocol — HKDF-SHA256 expand the `mediaKey` (accepts base64 OR object-shaped byte array) to 112 bytes → AES-256-CBC decrypt + HMAC-SHA256 verify.
- **Upload:** `putMedia` → R2 key `<instance_id>/<conversation_id>/<message_id>.<ext>` (content-addressed by message uuid), SHA-256 hashed, `CacheControl: public, max-age=31536000, immutable`, RFC 6266/5987 Content-Disposition for the original filename.
- **Commit:** `complete_media_fetch(message_id, bucket, key, sizeBytes, mimeType, sha256)` on success; `fail_media_fetch(job_id, error, terminal)` on failure. Terminal = CDN expiry (`isCdnExpiry` matches HTTP 400 "Failed to fetch stream"), 404, non-retryable Evolution error, empty bytes.
- **Concurrency:** `MEDIA_INGEST_CONCURRENCY` (default 8, clamp 1..32) sub-workers fan out per tick, self-coordinating via `SKIP LOCKED`. Wakes on NOTIFY `media_fetch_ready` + a 30 s sweep timer; ticks coalesce (`pending`/`inflight`).

### 5.2 Media variation (anti-ban image mangling)

- `varyMediaHash(buf, mime)` — for **canned** (quick_reply/scheduled) sends only, appends `PAD_MIN 9 … +PAD_SPAN 40` random bytes AFTER the format end-marker (EOI/IEND/GIF trailer/%%EOF) so each recipient gets a unique WhatsApp `fileSha256` (kills the media fingerprint at volume) while the image renders byte-identical. Scoped to `image/jpeg|jpg|png|gif` + `application/pdf`. **Not** applied to video (mp4 atoms), audio (ogg/opus, PTT re-encoded server-side), or webp (RIFF has an explicit size). No-op / never throws for unsupported mime.

### 5.3 Avatars (`r2/avatar.ts`)

- `cacheAvatar(instanceId, waUrl)` — downloads a WhatsApp/Facebook CDN profile pic (`whatsapp.net`/`fbcdn.net`/`cdninstagram.com`) once and stores it at R2 key `avatars/<instanceId>/<sha256(url.pathname)[:32]>.jpg`, returning the stable `https://<MEDIA_PUBLIC_HOST>/<key>`. Content-addressed by URL **path** (stable per photo version, signature query rotates), so an unchanged photo HEAD-hits and skips re-download; a changed photo → new key. `FETCH_TIMEOUT_MS = 8000`, `MAX_AVATAR_BYTES = 2MB`, image-mime only. Returns `null` on any failure (callers `COALESCE`, so null never overwrites). `backfill-avatars.ts` is the one-shot repair CLI (`node dist/scripts/backfill-avatars.js [instanceId]`) that re-fetches fresh signed URLs from Evolution for already-stale stored URLs.

---

## 6. Observability (`heartbeat.ts`, `logger.ts`, `logSink.ts`, `platformLogPull.ts`, `r2MetricsPull.ts`, `snapshot.ts`)

- **Heartbeat:** `worker_heartbeat(p_worker_id, p_hostname, p_version, p_active_numbers, p_queue_depth, p_dispatching_count, p_drain_rate_1m, p_last_dispatch_at, p_notes)` every `HEARTBEAT_INTERVAL_MS` (5 s). `drain_rate_1m` = count of completions in a sliding 60 s array. Fires immediately on boot. Stale-heartbeat alerting is a server-side pg_cron job, not the worker.
- **Logger:** dependency-free structured single-line JSON to stdout (info/debug) / stderr (warn/error), level-filtered from `LOG_LEVEL`. Registers an optional `hook` (the log sink) — logger.ts imports nothing from db (avoids a cycle).
- **Log sink → `system_logs`:** persists ALL warn/error plus an `INFO_ALLOWLIST` (boot/ready/shutdown, connection/qr, watchdog, instance lease/status, dispatcher spawned/stopped/dead, pg.connected…); `debug` never persisted. Batched (flush at 50 rows or every 4 s), `MAX_BUFFER = 1000` with **drop-on-backpressure** (emits a `logsink.dropped` count). **PII scrubbing is aggressive:** `SENSITIVE_KEYS` (jid/phone/lid/body/text/caption/token/secret/apikey/qr/…) → `[redacted]`, and every string value is regex-scrubbed of JIDs (`\d{6,}@…` → `[jid]`) and bare phone numbers (`\d{10,15}` → `[num]`), depth ≤2, size-capped. Flush via `supabase.rpc('ingest_system_logs', {p_entries})`; failures go to stderr only, never requeued.
- **Platform log pull:** every 60 s `POST <SUPABASE_URL>/functions/v1/admin-platform-logs {mode:'persist'}` with the service-role key as bearer. Fully fire-and-forget (non-OK → debug log). **Cloud-only dependency** (that edge fn uses the Supabase Management API + `MGMT_PAT`) — see §9.
- **R2 metrics pull:** every 10 min, paginated `ListObjectsV2` over the media bucket (worker's own R2 creds) → `POST <SUPABASE_URL>/rest/v1/rpc/ingest_r2_metrics` (PostgREST, service role). `storage_bytes` + `object_count` authoritative; class-A/B ops + egress left null.
- **Dispatcher snapshot:** every 3 s, one grouped UPSERT into `dispatcher_snapshot` (per-instance `sends_last_min`, `queue_queued`, `queue_dispatching`, `queue_dead_24h`, last-dispatch/complete/send). Decoupled + try/catch-isolated so a snapshot failure can never affect dispatch. Retires the frontend's old 2 s 3-read poll (Realtime-fanned).

---

## 7. Config surface (`config.ts`) — env var names only

**Required (fail-fast if missing/blank):**

| Var | Subsystem | Purpose |
|---|---|---|
| `DATABASE_URL` | pg pool | Supabase pooler **session mode** (LISTEN/NOTIFY + advisory locks). |
| `SUPABASE_URL` | supabase-js / log & metric pulls | project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | supabase-js | Realtime + RPC + edge-fn bearer for pulls. |
| `EVOLUTION_API_URL` | Evolution | base URL for the wrapped Evolution API. |
| `EVOLUTION_GLOBAL_API_KEY` | Evolution (raw fetch) | global admin key for status/lifecycle/group-info/profile-pic calls. |
| `R2_MEDIA_ENDPOINT` | R2 (S3) | jurisdiction endpoint. |
| `R2_MEDIA_ACCESS_KEY_ID` / `R2_MEDIA_SECRET_ACCESS_KEY` | R2 | bucket-scoped S3 creds. |

**Optional (defaults):** `WORKER_ID` (`wa-mancer-worker-1`), `WORKER_VERSION` (`dev`), `HOSTNAME` (`unknown`), `WEBHOOK_PORT` (`8090`), `R2_MEDIA_BUCKET` (`wamancer-media`), `MEDIA_PUBLIC_HOST` (`media.welcomdeal.ma`), `HEARTBEAT_INTERVAL_MS` (`5000`), `LOG_LEVEL` (`info`).

**Read OUTSIDE the config singleton:** `MEDIA_INGEST_CONCURRENCY` (default 8, `media-ingest.ts` reads `process.env` directly) — easy to miss on a config port. `NODE_ENV`, `NODE_OPTIONS=--enable-source-maps` are set by the Dockerfile. **`HOSTNAME` gotcha:** Docker auto-sets `HOSTNAME` to the container id, so the worker's reported hostname is the container hash unless overridden.

**Build/deploy:** multi-stage `node:22-alpine` (`npm install` → `tsc` → `npm prune --omit=dev`), runtime runs as the non-root `node` user, `EXPOSE 8090` (internal only), **no Docker HEALTHCHECK** (health is the `worker_health` heartbeat). `.dockerignore` excludes `.env*`. Dockerfile comment still says "switch to `npm ci` when lockfile lands" — a `package-lock.json` now exists but the build still uses `npm install`.

---

## 8. Concurrency & safety

- **One-worker-per-number** is enforced two ways: (a) DB leases (`worker_claim/renew/release_instance_leases`, 60 s expiry, first-come); (b) the client-side `loops` Map keyed by instance id — `spawnDispatcher` warns and no-ops if a loop already exists. The single async loop per number is the actual send serializer.
- **Lease loss** (peer took over / renewal failed): `renewLeases` diffs `ownedInstanceIds` vs still-owned and calls `stopDispatcher` on the lost ones (loop exits after the in-flight dispatch).
- **DB reconnect:** `pool.on('error')` logs `pg.pool.idle_error` and lets `pg.Pool` recycle. The dedicated LISTEN client's `on('error')` detaches, releases, and `reconnectListenClient()` after 1 s — re-issuing `LISTEN` for every registered channel. Channel names are whitelisted (`/^[a-z_][a-z0-9_]*$/i`) since LISTEN can't be parameterized.
- **Unhandled-rejection posture:** NONE at process level. Loops/timers each self-wrap; a rejection escaping those paths is unobserved. `main().catch → exit(1)` only covers bootstrap. **Gap to flag on merge.**
- **Webhook robustness:** ACK-first means a handler exception after the 200 is logged but lost (Evolution won't retry). The 45 s status reconciler + 20 min warmup + `messages.set` backfill are the backstops for missed events.

---

## 9. Surprises / merge hazards (for the iGrowFast port)

1. **Evolution relocating to the WhatsApp VPS (213.199.54.67) breaks the same-docker-network assumption in BOTH directions.**
   - Outbound: `EVOLUTION_API_URL` becomes something like `http://213.199.54.67:<port>`. The worker sends the **per-instance token + full recipient JID + message plaintext** in JSON over that connection on every send; **plain HTTP at an IP = cleartext creds + message bodies on the wire.** Needs TLS (CF tunnel / reverse proxy) or a private link.
   - Inbound: Evolution must reach the worker's `:8090` webhook. Today it's docker-internal + unpublished; on separate boxes it becomes a network-exposed endpoint whose ONLY auth is the static `x-wa-mancer-secret` header (Evolution 2.3.7 has no HMAC). The 5 MB body cap + constant-time compare are the only guards.
2. **`DATABASE_URL` MUST be a session-mode pooler.** The entire dispatcher depends on LISTEN/NOTIFY + `pg_advisory_lock`, which transaction-mode pooling (Supavisor/pgbouncer default) silently breaks. Verify iGrowFast's self-host box exposes a session-mode port before pointing the worker at it — this is the single most likely "works in dev, dead in prod" trap.
3. **R2→Supabase-Storage rewrite touches five files + config.** `r2/client.ts` (S3 SDK, `buildMediaKey`, immutable cache headers, SHA-256 checksum, RFC 5987 content-disposition), `r2/avatar.ts` (content-addressed avatar keys + `MEDIA_PUBLIC_HOST`), `r2MetricsPull.ts` (uses `ListObjectsV2` — no clean Supabase-Storage equivalent for bucket sizing), `media-ingest.ts` + `dispatcher/loop.ts` call sites, and the `R2_MEDIA_*` env block. Media-signing is NOT in the worker (edge fn `media-sign`) but the public-URL convention (`https://<host>/<key>`) is baked into avatar caching.
4. **`platformLogPull` is Supabase-cloud-only.** It calls `admin-platform-logs {mode:'persist'}`, which uses the Management API + `MGMT_PAT`. On the self-hosted box there is no Management API — the 60 s pull will silently 4xx (degrades to a debug log). Drop it or redesign the platform-log source.
5. **Global-key raw-fetch calls bypass `EvolutionClient`.** Status reconcile, watchdog restart, orphan reaper, `findGroupInfos`, `fetchProfilePictureUrl`, `fetchProfile`, `fetchInstances` all hardcode `config.evolutionGlobalApiKey` via bare `fetch`. Any Evolution move/rotation must update these too, and they inherit no timeout/retry uniformity from the client.
6. **Orphan reaper DELETEs Evolution instances with no `whatsapp_instances` row.** If iGrowFast ever points this worker at an Evolution server shared with another app, the reaper (30 min, 10 min age gate) will delete that app's instances. Must be scoped or disabled on a shared Evolution.
7. **Everything is `public.*`, unqualified.** ~25 RPCs (`ingest_message`, `resolve_identity`, `apply_reaction`, `consolidate_lid`, `queue_claim_next`, `queue_mark_*`, `pacing_take_token`, `dispatch_gate_check`, `worker_*_instance_leases`, `worker_heartbeat`, `enqueue/complete/fail_media_fetch`, `reveal_instance_token`, `reveal_instance_webhook_secret`, `upsert_jid_mapping`, `upsert_contact_profile`, `append_group_system_event`, `ingest_system_logs`, `ingest_r2_metrics`, `_delivery_rank`) plus direct writes to `whatsapp_instances`/`conversations`/`contacts`/`group_participants`/`messages`. A `whatsapp` schema move rewrites every one of these call sites in the worker.
8. **Name / identity collisions with iGrowFast core.** `system_logs` + `ingest_system_logs` (iGrowFast ripped out `audit_logs` 2026-06-22 — this is a different table, but the reintroduction of an all-admin-readable operational log is a decision, not a silent port); `worker_id` default `wa-mancer-worker-1`; `HOSTNAME` env (container id) as the heartbeat hostname; `dispatcher_snapshot`/`worker_health`/`r2_metrics` telemetry tables. The two-Supabase-connection model (pool + service-role js) also means the worker holds the service role key on the box.
9. **`MEDIA_INGEST_CONCURRENCY` lives outside the config singleton** — the one env var not centralised; a config-surface audit that only reads `config.ts` will miss it.
10. **No `unhandledRejection`/`uncaughtException` handler.** On a long-running always-on worker this is a real robustness gap; a stray promise rejection outside the wrapped loops is unobserved. Worth adding on merge.
11. **Hardcoded `welcomdeal.ma` branding/defaults:** `MEDIA_PUBLIC_HOST` default `media.welcomdeal.ma`, bucket `wamancer-media`, plus the WhatsApp CDN hosts (`mmg.whatsapp.net` direct download, `pps.whatsapp.net`/`fbcdn.net`/`cdninstagram.com` avatar sources) that are protocol-fixed, not brandable.
12. **`queue_claim_next` (outbound) is atomic WITHOUT `SKIP LOCKED`; `media_fetch_jobs` claim IS `SKIP LOCKED`.** Two different concurrency models in one worker — don't assume symmetry when reasoning about multi-worker scaling.
13. **Realtime `wa-typing:<instance_id>` is load-bearing as a bidirectional bus** (peer-presence broadcast + frontend attend/leave/open + edge `purge_peer`). The merge target must run Supabase Realtime with broadcast enabled and the worker subscribed, or online-while-attended presence + peer-typing resubscription silently degrade to the 20-min warmup fallback.
14. **Humanization is entirely worker-side and easy to lose.** The cross-contact gap, canned burst spacing, typing/recording pre-roll, single-typing-slot, self-presence online/offline, and `varyMediaHash` anti-fingerprint all live in `loop.ts`/`pacing.ts`/`media-variation.ts` — none of it is in the DB. A "port the DB + edge functions" migration that reimplements the worker loosely would drop the ban-safety layer.
