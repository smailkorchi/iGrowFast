# WhatsApp SaaS — Enterprise-Scale Rollout Plan

> Provenance: deep verify+plan workflow wf_4efb26d1-848 (6 workstream specs, each adversarially skeptic-verified, architect-synthesized), 2026-07-09. Supersedes the premature "blockers #2/#3 done" claims. Live-evidence grounded.


## 1. Honest headline — are we covered today?

**No. The system today is a ~2-node, ~200-tab, low-number-count deployment.** Three independent hard ceilings, none of which is the one the convergence hypothesis named:

| Axis | Hard ceiling today | Binding cause | Fixed by |
|------|-------------------|---------------|----------|
| **Worker nodes** | **~2 nodes** | Supavisor SESSION pool (tenant `pool_size=20`); each node pins `pg.Pool max=10` + 1 permanent `listenClient` ≈ 11 conns. Forced by worker LISTEN/NOTIFY. | **W2** → 15–40 nodes |
| **Concurrent inbox tabs** | **~200 platform-wide, ~93 instances/tab** | Single `realtime-dev` tenant `max_concurrent_users=200`, `max_channels_per_client=100`; admin tab opens 1 `wa:inst` channel per instance. | **W5** → thousands |
| **Numbers per node** | node degrades at hundreds | Uncapped reconcile HTTP fan-out every 45s; unbounded Evolution `Message` table (274 MB / 2 numbers / 5 mo). | **W6** → bounded |

**Correction to the brief's convergence hypothesis (load-bearing).** The hypothesis "retire wal2json slot → fixes DB decode cost AND unblocks transaction pooling" conflates two mechanically independent things:

1. **Transaction-mode pooling is NOT blocked by the frontend postgres_changes slot.** It is blocked by the worker's LISTEN/NOTIFY `listenClient` (a NOTIFY-queue session pin, independent of any logical slot). W2 unblocks it by re-homing wakes to broadcast — no slot drop required.
2. **The 60% `list_changes` decode cost is NOT eliminated by any workstream here.** wal2json decodes the *entire* WAL to advance its LSN; publication membership filters *output only*, not decode. The slot is shared with **22 live e-commerce postgres_changes subscriptions** (`src/pages/admin/Orders.tsx`, `seller/Orders.tsx`, `SheetReview.tsx`, `CampaignForm.tsx`, `OrderStatusNotifications.tsx`, `useTrackingSyncStatus.ts`, `useCourierNotifications.ts`, `useWebhookHealth.ts`). Until those are ported off postgres_changes, the slot cannot be dropped and the decode cost persists — **regardless of what WhatsApp does.** W4 confirms honestly: cutting the 311k conversation-bump UPDATEs does not reduce decode *bytes* (they are inherent to message volume).

**Therefore: the DB-decode win is out of scope for this fleet-scaling effort and must be owned separately (see §7 W7).** What this plan *does* deliver: node ceiling 2→40, tab ceiling 200→thousands, node health bounded, and removal of the fleet-global serializers (audit advisory lock, 6-round-trip send path).

---

## 2. The keystone move (single highest-leverage)

**Build one service-role `wa:node:<node_id>` broadcast feed and route the worker's entire server-push surface through it.** This single seam collapses three separate problems:

- Re-homes the worker's **control-plane** subscription (`instance-manager.ts` L569 postgres_changes on `whatsapp_instances` — the node_id sharding control plane from commit `ac32451`) → lets **W1** drop `whatsapp_instances` from the publication.
- Delivers **enqueue/media wakes** (replacing the 4 `pg_notify` producers) → lets **W2** drop `listenClient` and flip to transaction mode → **2 → 15–40 nodes.**
- Provides the **scheduled-wake interrupt** `waitForWakeOrTimeout` needs → lets **W3** replace the 5s blind poll with `min(not_before)` sleep.

One piece of infrastructure unlocks the entire fleet-scaling critical path. Everything else is either a parallel quick win or downstream of this.

---

## 3. Circular-dependency resolution

The naive `depends_on` graph is circular: **W1→W5→W1** and **W4→W5→W4**. The cycle is entirely about the shared `wa:biz` topic family and the bump-payload envelope. **Break it by extracting a Phase 0 foundation** that fixes the topic taxonomy and authorization *before* any producer/consumer is wired. Once `wa:biz` + `wa:node` authz exist as deny-by-default policies with zero emitters, W1/W4/W5 each depend only on that foundation, not on each other.

Topic taxonomy (final):
- `wa:conv:<id>`, `wa:inst:<id>`, `wa:user:<uid>` — exist (migs 035/036/040)
- `wa:biz:<business_id>` — NEW: W5 inbox collapse, W4 bump collapse, W1 `quick_replies`
- `wa:node:<node_id>` — NEW, **service-role only**: worker control plane + wakes

---

## 4. Phased rollout

### Phase 0 — Broadcast foundation (no behavior change)
**Ships:** authorization migrations only.
- `whatsapp.can_read_biz_topic(text)` (regex-gate `^wa:biz:<uuid>$`, `current_user_is_business_admin() AND ::uuid = current_user_digicom_business_id()`) + `realtime.messages` SELECT policy `wa_biz_broadcast_read` — mirrors existing `wa_inst_broadcast_read` exactly.
- `wa:node:<node_id>` authorization extending `whatsapp_035` — **readable by service_role only** (worker connects as service role; this is NOT a user-facing topic).
- Freeze the **shrunk bump-payload column envelope** (the exact `jsonb_build_object` key set W4/W5 both emit and `applyBump`/`cmpConversationRow`/`membershipSig` consume): `id, instance_id, last_message_at, last_message_preview_ct, last_message_kind, last_message_direction, last_message_sender_name, last_message_media_meta, unread_count, is_archived, is_pinned, status, snoozed_until, resolved_at, is_group, last_outbound_status, contact_id, peer_display_name, peer_profile_pic`.

**Why first:** dissolves the W1/W4/W5 cycle; additive DDL with no emitters, so nothing can break.
**Exit criteria:** `can_read_biz_topic('wa:biz:<foreign-uuid>')=false` and malformed → false; a foreign-business JWT gets `CHANNEL_ERROR` on join; `wa:node` join denied to `authenticated`, allowed to service_role.
**Risk posture:** near-zero. Pure additive authz.

---

### Phase 1 — Parallel quick wins (independent, ship immediately)
Four independent tracks, no cross-dependencies, each individually rollback-able.

**1a. W6 — bound the two Evolution fan-outs + cap the Message hoard (node-local).**
Apply with skeptic corrections:
- Reconcile fan-out: replace `Promise.allSettled` (`instance-manager.ts` L392) with `mapWithConcurrency(rows, config.reconcileConcurrency≤32, …)` mirroring `media-ingest.ts` L435-477. No new dependency.
- **Re-entrancy guard (skeptic correction — MUST land WITH the concurrency cap, not after):** `reconcileEvolutionStatuses` has NO `inflight` guard today; the 45s timer fires it unconditionally. Today it's harmless (parallel fan-out finishes fast), but capping concurrency to N serializes HTTP so a mass-disconnect cycle can exceed 45s → a SECOND concurrent pass starts, each with its own `budget` object (multiplying the restart drip) and both mutating the shared `wdState` map (double `s.attempts`, double restart POST, race). Add a coalescing `inflight` flag mirroring `media-ingest.ts` L428/462 in the SAME change that adds the cap.
- Restart budget: **NOT a flat 3/cycle** — the skeptic's arithmetic is correct (3/45s ≈ 240/hr leaves a full node dark for ~1 hr). Use a **proportional budget `ceil(instances/20)` with a floor**, tuned against ban-safety. Jitter at L349-352 only helps 2nd+ episodes (first mass-disconnect tick has `lastRestartAt=null`), so the budget carries first-burst de-sync.
- Evolution hoard: `DATABASE_SAVE_DATA_HISTORIC=false` (**canary one node first** — verify poll-vote/group-metadata/quoted-context survive fresh reconnect) + nightly LIMIT-batched retention DELETE **followed by VACUUM/reindex** (DELETE alone leaves 274 MB bloat).

**Exit:** peak in-flight `connectionState` GETs ≤ configured concurrency; `POST /instance/restart` ≤ budget/cycle under forced mass-disconnect with eventual full recovery; `Message` table bounded to rolling window, oldest advances, message-status ticks still correlate.
**Risk:** node-local, terminal at local Evolution. Container recreate for the env flag drops that node's sessions briefly → one node at a time, off-peak.

**1b. W4 Part A + Part B.1 — de-serialize audit + decrypt-from-NEW (W4-local, NOT gated on W5).**
The skeptic is right that `depends_on:[W5]` overstates coupling — only the `wa:biz` collapse (Part B.2) needs W5. Ship the rest now:
- **Partition `audit_log`** (RANGE `occurred_at`, PK `(occurred_at,id)`, UNIQUE `(occurred_at,this_hash)`), copy 11.8k rows, **build-attach-swap in a single txn or under brief writer quiesce** (avoid the interim-row-loss window; 8 MB now — cost never lower).
- **Skeptic correction (must-add to migration):** `audit_log` has RLS + policy `audit_log_admin_select` (`is_owner()`) + grants (authenticated SELECT, service_role DML). The migration MUST re-enable RLS, recreate the policy, and re-grant on the partitioned parent — else owner Log/Monitor breaks (empty) or the fleet audit surface leaks to every authenticated user.
- **Remove the hot-path `pg_advisory_xact_lock(hashtext('audit_log_chain'))`** from `_audit_log_hash` → async hourly Merkle checkpoint (`audit_checkpoints` + `_audit_checkpoint()` cron). Resolved open questions: all ~60 `audit()` sites use `PERFORM` and discard the RETURNING id (checkpoint model safe); enqueue RPCs (`010c:473/546/709/796`) contend the *same* lock (strengthens the finding).
- **Part B.1 decrypt-from-NEW:** rewrite `_broadcast_conversation_bump` to build payload from `NEW.*` + inline `decrypt_text(NEW.last_message_preview_ct, NEW.key_id)` — drops the `conversations_decrypted` PK self-lookup + second decrypt. Keep `wa:inst` + `wa:user` topics (collapse is Part B.2, Phase 2). Assert byte-identical JSON key set vs `conversations_decrypted` in a parity test.

**Why Phase 1:** the audit advisory lock serializes *every* audit-carrying RPC fleet-wide, dominated by per-send `queue_mark_sent`. Removing it is a prerequisite-of-nothing throughput win that also **eliminates W3's stated residual risk** (W3 leaves that lock in `queue_mark_sent`; shipping W4-A first means it's already gone by Phase 3).
**Exit:** advisory-lock waiters = 0 under concurrent synthetic dispatch; `_decrypt_conv_preview.calls` stops incrementing during pure ingest; checkpoint verify OK across a partition boundary; owner Monitor tolerates the un-checkpointed tail.
**Risk:** the swap is the only ACCESS-EXCLUSIVE moment — quiesce writers for the sub-second rename now while the table is 8 MB.

**1c. W5 Step B — raise the 4 tenant caps (ops SQL, no code).**
`UPDATE _realtime.tenants` for `realtime-dev`: `max_concurrent_users 200→5000`, `max_channels_per_client 100→1000`, `max_events_per_second 100→2000`, `max_joins_per_second 100→500` (raise **modestly** — thundering-herd join OOM risk on the single unbounded-MEM BEAM), `max_bytes_per_second 100000→1000000`. Hot-applied on tenant refresh.
**Exit:** 300 simulated tabs join with no `max_concurrent_users` rejection; BEAM memory + fd bounded, no container restart.
**Risk:** watch BEAM memory; keep joins/sec conservative.

**1d. W2 Step A — kill search_path reliance (behavior-neutral, session port).**
Schema-qualify **ALL NINE bare enum-cast sites** (skeptic correction — the spec's "6" missed three on the HOT inbound path, which would break with `type "identifier_source" does not exist` the moment `options` is dropped): `instance_status`×8 (`instance-manager.ts` L409/L425; `handlers.ts` L1914/L1917/L1934-1940) **plus** `handlers.ts:85 ::whatsapp.identifier_source` (resolve_identity on inbound), `handlers.ts:239 ::whatsapp.identifier_kind` (contacts.upsert), `handlers.ts:689 ::whatsapp.message_kind` (enqueue_media_fetch). **Then delete `db.ts` L42 `options:'-c search_path=…'` AND run the session-mode soak with it deleted** (else the soak proves nothing). Worker role search_path is `"$user",public,extensions` — no `whatsapp`.
**Exit:** 1h on session port, zero `type "<enum>" does not exist` for **all four** enum names (`instance_status`, `identifier_source`, `identifier_kind`, `message_kind`) — not just `instance_status`.
**Risk:** none (behavior-neutral).

---

### Phase 2 — Broadcast migration (coupled: W5 + W4-B2 + W1)
All consume Phase 0 authz. Two coordinated sub-tracks sharing the bump trigger and the `wa:node` seam.

**2a. Inbox collapse — W5 Step A/C + W4 Part B.2.**
- **Dual-publish window:** rewrite `_broadcast_conversation_bump`/`_delete` to emit BOTH `wa:inst:<id>` (existing) AND `wa:biz:<business_id>` (resolve via single `whatsapp_instances` lookup on `NEW.instance_id`; **denormalize `business_id` onto `conversations` in the same migration** to avoid the PK lookup in the #1 WAL-driver trigger — skeptic note).
- Frontend: `Conversations.tsx:136` → `bumpTopics = businessId ? [wa:biz:<businessId>] : []`; add `business_id` to instance select. `useConversationsBumpRealtime` is topic-agnostic; `applyBump` routes by `row.instance_id` (retained in payload) so business-wide topic still lands each bump in the right list.
- After frontend rollout confirmed: drop the `wa:inst` dual-publish, drop `wa_inst_broadcast_read` + `can_read_inst_topic`.
- Payload shrink (Step C): `to_jsonb(cd.*)` → `jsonb_build_object(<Phase-0 envelope>)` — ship **after** collapse verified.

**Exit:** `supabase.getChannels().length` = 1 bump channel regardless of instance count; bump parity (real message patches correct list in place, no full refetch); foreign-biz JWT → `CHANNEL_ERROR`; broadcast bytes/bump dropped.
**Risk (skeptic, must monitor):** collapsing N `wa:inst` into ONE `wa:biz` channel **concentrates the whole business bump firehose onto one per-client channel** governed by `max_events_per_second`. `wa:inst` naturally sharded this. At thousands of numbers in one business, aggregate bump rate may exceed the cap even raised → dropped events → reconcile-storms. The 250ms/300ms invalidate backstops (`conversations.ts:397-403/447-460`) degrade a missed bump to ≤300ms-stale, never a break — but **this is the standing residual after the plan ships** (see §6, unverified item 4).

**2b. WhatsApp postgres_changes retirement — W1 (split mig 043).**
Reuse mig 035/036 SECURITY-DEFINER-trigger + `realtime.send` pattern for the 6 low-churn tables (`conversation_assignments`, `conversation_tags`, `tags`, `quick_replies`, `scheduled_messages`, `whatsapp_instances`). Strict order per table: mig 042 triggers (additive) → frontend broadcast consumers alongside existing subs → verify parity live → delete the 10 postgres_changes bindings (incl. DEAD sync-metrics bindings `instances.ts` L323-337, keep the 2s poll) → mig 043 publication drop.

**Skeptic correction — SPLIT mig 043:**
- Drop the **5 no-worker-consumer tables freely.**
- **HOLD `whatsapp_instances`** until the worker control-plane feed (`instance-manager.ts` L569 postgres_changes → node_id sharding) is re-homed to the **service-role `wa:node:<node_id>` broadcast** (the keystone). The frontend `wa:inst`/`can_read_inst_topic` path is user-scoped and cannot serve the worker's "discover instances newly assigned to my node" need. Dropping `whatsapp_instances` before re-homing silently degrades the fleet to 45s backstop polling (`reconcileEvolutionStatuses` only reconciles *already-owned* instances) — directly undermining the sharding goal.
- `quick_replies` → `wa:biz` (uses Phase 0 authz, co-designed with 2a).

**Exit:** `pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='whatsapp'` = only `whatsapp_instances` (held) after the 5-table drop, then 0 after re-home; **add to verification: worker reacts to a `node_id` reassignment within seconds after the `whatsapp_instances` drop** (the spec's UI-rename test does not cover this).
**Risk:** dropping a table before its consumer is broadcast-ified = silent loss of live assignment/tag/instance updates (stale rosters, frozen chips); `realtime.send` failures are swallowed so a broken trigger can't block a write. De-assignment (`wa:user` DELETE) is security-relevant — keep the debounced backstop invalidate.

**Build in 2b: the `wa:node` worker broadcast** (control-plane re-home). This is the keystone and is shared with Phase 3.

---

### Phase 3 — Fleet scaling (W2 pooling → W3 send-path)
**3a. W2 Steps B–E — session → transaction pooling (THE node-ceiling breaker).**
- Step B: add `realtime.send` AFTER each of the 4 `pg_notify` producers (`whatsapp_007:195`, `009:49`, `010c:887`, `013b:562`), routed to `wa:node:<node_id>` via `whatsapp_instances` join. **Keep pg_notify** (dual-run). Uniform node_id-join routing is correct despite payload heterogeneity (010c emits `instance_id`, 007/013b emit `number_id`; `number_id==instance_id==whatsapp_instances.id`).
- Step C: worker subscribes `wa:node:<nodeId>` (broadcast) for wakes, **still session mode, dual with LISTEN.** **BLOCKING GATE:** canary with `pg_notify` disabled must prove sends fire via broadcast at unchanged p50 *before* Step D. If the `wa:node` authz didn't land, the subscribe silently receives nothing and the 5s poll masks it.
- Step D: provision a **dedicated `_supavisor.users` worker alias** (transaction mode, `pool_size=30`, `max_clients=300`) — **preferred over bumping the shared tenant** (an edge fn may share 6543). Flip `DATABASE_URL` 5432→6543; delete `db.ts` L64-142 `listenClient` + `index.ts` L5/L37/L42; `pg.Pool max 10→5`. Roll one node at a time; 5s poll backstop keeps a dropped wake ≤5s.
- Step E: post-multi-day-soak, drop the 4 `pg_notify` lines.

**Why after Phase 2:** needs the `wa:node` broadcast built in 2b. This lifts the ~2-node cap to 15–40 nodes — the fleet-scaling unblock.
**Exit:** run >2 nodes; `count(*) FROM pg_stat_activity WHERE application_name='Supavisor'` ≤ 30 regardless of node count; zero `prepared statement does not exist` / `instance_status does not exist` in 1h; no permanently-idle `listenClient` backend per node; every `node_id` leased with no checkout-timeout.
**Risk:** wake loss during cutover mitigated by dual-run + 5s backstop (worst case ≤5s latency, never a stuck send); per-node restart pauses in-flight sends, dispatcher self-heals (queue rows durable). Per-node instant rollback (revert URL to 5432, prior image still has `listenClient`) — valid until Step E.

**3b. W3 — collapse send path to 2 round-trips (`dispatch_prep` RPC) + scheduled wake.**
- New RPC `whatsapp.dispatch_prep(...)` folds gate-check + `queue_claim_next` + pacing ctx + `messages_decrypted` deref + `pacing_take_token` + quoted-prep into ONE call; `queue_mark_sent` stays as the 2nd round-trip. Content send 6→2, reply 7→2.
- Claim uses the canonical `UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` — fixes the current TOCTOU two-step (`queue_claim_next` has no SKIP LOCKED) and is multi-node safe under W2.
- Replace the 5s blind poll with `waitForWakeOrTimeout(clamp(next_wake_at−now, 250ms, SAFETY_CAP_MS))`, `SAFETY_CAP_MS` 15–30s; interrupt via the `wa:node` broadcast (Phase 3a) — not LISTEN.

**Skeptic corrections (must apply):**
- **Migration is `whatsapp_046_dispatch_prep.sql`** (not 038 — 038 exists; also renumber past W4/W1/W5 additions).
- **Presence heartbeat starvation:** `drivePresence` (`loop.ts:262`) carries a ~10s "online-while-attended" heartbeat today paced by the 5s poll. A `min(not_before)` sleep clamped to 15-30s starves it → lapsing online/typing indicators. **Add a presence timer decoupled from the dispatch sleep.**
- **markDead path:** `dispatch_prep` must return `claimed=true` with NULL msg cols when deref finds nothing, so `loop.ts:313-317` markDead fires instead of stranding a `dispatching` row.

**Why last:** depends on W2 (transaction mode + `wa:node` wake). By now W4-A has already removed the audit lock from `queue_mark_sent`, so W3+W4 together fully de-serialize send completion (W3's own residual risk is pre-cleared).
**Exit:** `dispatch_prep` call count ≈ prior `queue_claim_next`; the 5 folded RPCs drop toward zero; 2-worker test shows every claimed row transitions `queued→dispatching` exactly once (no dup `evolution_message_id`); zero rows stuck `dispatching` >2 min; scheduled send fires within 1s of `not_before`; presence still refreshes for idle-attended numbers.
**Risk:** `dispatch_prep` is on the critical path — env flag `DISPATCH_PREP=off` reverts to the 6-call path (old RPCs kept intact); canary one node; watch stuck `dispatching` + `PENDING`.

---

### Phase 4 — Horizontal Realtime (contingent, only if proven necessary)
W5 Step D. **Vertical-first:** single BEAM with raised caps + fd 10000 + a memory reservation serves several thousand WS. Only for >5–10k concurrent tabs consider 2+ Realtime containers (Phoenix PubSub cluster) or per-business tenant sharding. **Gate on a spike** (see §6). Do not build speculatively.

---

## 5. Dependency-ordered critical path (summary)

```
Phase 0 (topic authz)  ──┬─────────────────────────────────────────┐
                         │                                         │
Phase 1  W6 ∥ W4-A/B1 ∥ W5-capsB ∥ W2-A   (all parallel, no deps) │
                         │                                         │
Phase 2  [W5 collapse + W4-B2]  ∥  [W1 + build wa:node seam] ◄─────┘
                         │  (whatsapp_instances drop GATED on wa:node)
                         ▼
Phase 3  W2 pooling (needs wa:node) ──► W3 dispatch_prep (needs W2)
                         │
Phase 4  W5-D horizontal Realtime  (only if load proves it)
```

**Critical path to "thousands of numbers":** Phase 0 → `wa:node` seam (Phase 2b) → W2 pooling (Phase 3a). Everything on this line is what breaks the 2-node ceiling. W5 (tab ceiling) runs in parallel and is not on the number-scaling critical path.

---

## 6. UNVERIFIED — must prove before building the dependent phase

1. **pgoutput slot decode cost (blocks Phase 2/3 broadcast expansion).** Every workstream moves load onto `realtime.send` → `realtime.messages` INSERTs, which write WAL that the `supabase_realtime_messages` slot decodes. Does its walsender CPU stay bounded by broadcast *output volume* or creep with *total* WAL? Load-test at fleet enqueue rate **before W2 Step B/C.** If it scales with total WAL, broadcast partially re-loads the same class of bottleneck.
2. **E-commerce postgres_changes migration ownership (blocks the DB-decode headline).** The 22 subs on 9 `public.*` tables must be ported off postgres_changes to ever drop the wal2json slot. **Is this in scope for any workstream (call it W7)?** If not, the 60% decode cost lives indefinitely and no plan here touches it. Decide explicitly.
3. **Self-host Realtime clustering (blocks Phase 4).** Does the image support libcluster/Phoenix PubSub DNS discovery, or is per-business tenant sharding the only horizontal path? Spike before committing Step D.
4. **Intra-business `wa:biz` event-rate concentration (standing residual after Phase 2).** At thousands of numbers in ONE business, does the aggregate bump firehose on the single `wa:biz` channel exceed `max_events_per_second` even at 2000? Model/load-test; if it breaches, re-shard `wa:biz` per instance-group.
5. **`DATABASE_SAVE_DATA_HISTORIC=false` degradation (blocks W6 fleet flip).** Poll-vote / group-metadata / quoted-context on fresh reconnect — canary one node.
6. **`realtime.send` callable from the SECURITY-DEFINER context of the 4 producers** and **`node_id` non-null on every `whatsapp_instances` row** (blocks W2 Step B routing).

---

## 7. Out of scope but must be owned (W7)
Port the 22 e-commerce postgres_changes subscriptions to broadcast, then the gated `whatsapp_0XX_drop_wal2json_slot.sql`. **This — not any WhatsApp workstream — is what actually reclaims the 60% `list_changes` DB time.** Track it explicitly or the DB-cost narrative stays unresolved.

**Relevant source anchors:** worker `ops/whatsapp-node/worker/src/{db.ts,index.ts,config.ts,dispatcher/{loop.ts,instance-manager.ts,media-ingest.ts},webhook/handlers.ts}`; migrations `ops/box/whatsapp-schema/migrations/{003,006,007,009,010a,010c,013b,035,036,037,038}` + new `042/043` (W1), `044/045` (W4), biz-topic + caps (W5), `046_dispatch_prep` (W3); frontend `src/whatsapp/routes/admin/Conversations.tsx`, `src/whatsapp/lib/queries/conversations.ts`.
