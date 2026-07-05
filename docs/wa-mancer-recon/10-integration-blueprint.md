# WA Mancer Recon — 10: Integration Blueprint (merge into iGrowFast)

Recon date: 2026-07-05. Synthesis of chapters 01–09 into the concrete plan to **replicate** WA Mancer's inbox engine inside iGrowFast. This chapter is opinionated: it states what ports where, what changes, what gets dropped, and the decisions. Every claim traces to a prior chapter; source-of-truth pointers are inline (e.g. `[02 §5.4]`).

**FRAME (do not misread this as a migration):** WA Mancer stays a **separate, live product** — project `xlhlezgpgrypdijynmqr` + VPS `158.220.108.12` remain untouched and running, to be sold standalone. The WhatsApp feature originally lived inside iGrowFast, was extracted + refined into standalone WA Mancer, and is now being **re-created inside iGrowFast** as a fresh parallel stack, informed by every gotcha learned building WA Mancer. We **replicate the functionality**, we do not migrate data or decommission anything. iGrowFast gets its OWN new Evolution/worker/schema; WA Mancer keeps its own.

**The shape of the merge.** WA Mancer is four moving parts: (1) an app database — inbox schema, RPCs, RLS, encryption — that ports into iGrowFast's Supabase as a new `whatsapp` schema; (2) Evolution API + its own Postgres — a self-contained WhatsApp-bridge that relocates to the WhatsApp box; (3) a Node worker — the outbound chokepoint + webhook receiver that mediates 1↔2; (4) a React inbox UI that copy-pastes into the iGrowFast SPA against iGrowFast identity. The telemetry/observability half of WA Mancer (97% of its DB, its systemd shippers, its cloud-Management-API pulls) does **not** port — iGrowFast has its own monitoring/backup posture.

---

## 1. Target topology

| Box | Role in the merge | Runs | Current baseline `[09 §13]` |
|---|---|---|---|
| **Main** `207.180.232.102` (`igf`) | The app | iGrowFast SPA + **self-hosted Supabase** (Postgres w/ the new `whatsapp` schema, Auth, self-hosted edge runtime, Storage-on-R2, Vault, pooler) | live prod |
| **WhatsApp** `213.199.54.67` (`igf-whatsapp`) | The WhatsApp bridge | **Evolution API 2.3.7 + its own Postgres 17** (+ **the worker**, recommended — see §5) | Ubuntu 24.04, 47 GB RAM, **Docker not installed**, UFW+fail2ban only |
| **Toolbox** `37.60.250.211` (`igf-tools`) | Supporting integrations | other-integration tools (email verification etc.); Redis only if something needs it | Docker + socket-proxy, no Redis, no app services |

**Data flow after merge:** iGrowFast SPA (React) → iGrowFast Supabase (REST + Realtime + Auth) → worker (on WhatsApp box) → Evolution (localhost on WhatsApp box) → WhatsApp. Inbound: Evolution → worker webhook (localhost) → iGrowFast Supabase over the wire (service role + **session-mode pooler**). Media → iGrowFast Supabase Storage (which persists to R2 behind the Storage API `[R2 architecture]`).

**Load-bearing placement decision (recommended):** put **Evolution + its Postgres + the worker together on the WhatsApp box** `[09 §14.1]`. Rationale: the worker↔Evolution hop carries the plaintext per-instance token and message bodies, and Evolution 2.3.7 has no TLS and no webhook HMAC — its only auth is the static `x-wa-mancer-secret` header. Keep that hop on `localhost`. Only two things then cross the network, both securable: worker → iGrowFast Supabase (HTTPS + pooler) and the SPA → Supabase. The toolbox stays for *other* integrations. Alternative (Evolution-only WhatsApp box, worker elsewhere) forces the sensitive hop over the wire — avoid unless there's a strong reason. **DECISION #1.**

---

## 2. Database port — the `whatsapp` schema

Port the *app* database from `[02]` into a new `whatsapp` schema in iGrowFast's Supabase. This is a rewrite pass, not a dump/restore, because five things change at once.

### 2.1 What ports
- **The inbox core** `[02 §2]`: `whatsapp_instances`, `conversations`, `messages`, `contacts`/`contact_identifiers`/`contact_profiles`, `conversation_assignments`, `outbound_queue`, `number_pacing_state`, `worker_instance_leases`, `worker_health`, `media_fetch_jobs`, `jid_mapping`, `group_participants`, `merge_review`/`merge_decisions`, `dispatcher_snapshot`, `tags`/`conversation_tags`/`conversation_notes`/`quick_replies`/`message_templates`/`scheduled_messages`, `invitations` (see §4 — likely dropped).
- **The 13 enums** `[02 §3]` → created in `whatsapp` schema (except `user_role` — see §2.4).
- **The load-bearing functions** `[02 §5]`: queue claim/mark, leases, `pacing_take_token`, `dispatch_gate_check`, encryption (`_envelope_key`/`encrypt_text`/`decrypt_text`/`_decrypt_*`), `ingest_message`, `resolve_identity`/identity chain, `_assert_conversation_access`, assignment RPCs, send/edit/delete/react RPCs, media RPCs, the trigger functions.
- **The 3 decrypted views** `[02 §4]` (`security_invoker=true` — keep it).
- **The 39 triggers** `[02 §6]` (minus audit machinery — see §2.4).

### 2.2 What does NOT port (drop)
- **The entire telemetry stack** `[02 §2.7, §12]`: `system_logs`, `metric_samples`, `host_metrics`, `db_metrics_history`, `worker_health_history`, `r2_metrics`, `app_cache`/`og_cache`, `_cron_ingest_state`, and the ~29 `stats_*`/`monitor_*`/`ingest_*`/`_cron_*metric*` functions + the private `_compute_*`/`cache_*` layer. This is 97% of WA Mancer's DB and duplicates iGrowFast's own monitoring/backup program `[BACKUP_PREFLIGHT]`. Keep only `worker_health`/`worker_instance_leases`/`dispatcher_snapshot` (operational, not telemetry).
- Of the 16 cron jobs `[02 §8]`, keep the operational ones (`reclaim_stale_dispatching`, `scheduled_messages_drain`, `unpin_expired_messages`, `consolidate_split_conversations`, `outbound_queue_cleanup`, `lifecycle_auto_promote`, `worker_health_alert`); drop every metric/log/cache cron. These become iGrowFast pg_cron jobs — mind job-number collisions with iGrowFast's existing crons.

### 2.3 Tenancy — add `business_id` everywhere `[02 §0, §13.1]`
WA Mancer has **no tenant column**. Every ported table gets `business_id uuid NOT NULL` (FK to iGrowFast `businesses`). Every RLS predicate — all currently shaped `EXISTS(conversation_assignments … AND instance_id …)` — must additionally AND on `business_id`, or one business's admin reads another's chats. `whatsapp_instances` is the natural tenancy root (a number belongs to a business); everything else inherits `business_id` from its instance/conversation. This is the single highest-risk part of the port; it must be verified by impersonation under a seeded non-admin user of each business `[02 §13.12]` — the isolation model has **never run** in production (0 assignment rows).

### 2.4 Name-collision resolution `[02 §13.8]`
iGrowFast already owns `profiles`-equivalent (`users`), a 6-value `public.user_role`, per-business role helpers, and it **deliberately ripped out its audit-log feature** `[audit-log-feature-removed]`. So:
- **Drop WA Mancer's `profiles` + `user_role(admin,user)` + `is_admin()`/`has_role()`.** Rewire every RLS predicate and `_assert_conversation_access` onto iGrowFast's identity: `conversation_assignments.user_id` → iGrowFast `auth.users`; "admin" → iGrowFast super-admin/admin/owner **of that business** (reuse iGrowFast's existing per-business role helpers, gated on `business_id`); "user/agent" → seller. Exact role→capability mapping is **DECISION #2**.
- **Do NOT port the hash-chained `audit_log` + 10 audit triggers** `[02 §6]` — reintroducing audit machinery iGrowFast intentionally removed is a product decision, not a free port. If any audit is wanted, scope it deliberately.
- Keep WA Mancer's `invitations` **out** — iGrowFast has its own invitation/onboarding `[invitation-email-send]` (see §4).
- All WA Mancer functions live in `whatsapp.*` (schema-qualified) to avoid clobbering iGrowFast's `public` helpers. The unqualified `public.*` calls in the worker and edge functions `[03, 07]` all get rewritten to `whatsapp.*` — this touches every RPC call site.
- Don't touch iGrowFast's existing `'whatsapp'` **sales-channel** `[whatsapp-mancer-integration]` — it's ad-attribution, unrelated to the inbox.

### 2.5 Security fixes to apply *during* the port (do not copy the holes) `[02 §13, 07, 09]`
- **Do not recreate the anon-executable `_cron_purge_metric_samples`** (it's dropped with telemetry anyway) — but audit that no ported function is anon-executable.
- **Neutralize the default-ACL trap** before creating any `whatsapp` table: the `pg_default_acl` grant-all-to-anon/authenticated pattern that already gave anon full DML on `dispatcher_snapshot` + the decrypted views `[02 §7]` is the same class as iGrowFast's dev-branch clone incident `[dev-branch-clone-grant-loss]`. REVOKE the default grants, then grant explicitly.
- **Fix the two `qual=true` policies** (`number_pacing_state`, `quick_replies`) — they become cross-business read holes `[02 §13.4]`. Scope to business + assignment.
- **Pin `security_invoker` on the 3 decrypted views** and REVOKE anon/authenticated DML on them `[02 §13.2]`.
- **Envelope key:** create a fresh `whatsapp` envelope key in iGrowFast **Vault** `[secrets-topology-two-stores]` (do not reuse `wa_mancer_envelope_key`); the decrypt RPCs gate on iGrowFast role + `business_id` + assignment. Plan a rotation/re-encrypt path — WA Mancer has none `[02 §13.5]`. Per-business keys are an option — **DECISION #3**.

---

## 3. Assignment model — the open question `[user: "some details will be discussed"]`

WA Mancer's model `[02 §5.7]`: flat — admins see all; a user sees a conversation only if a `conversation_assignments` row exists (DM = singleton via partial unique index; groups = multi-agent). Assignment happens via admin RPC, self-claim, or the round-robin auto-assign-on-inbound trigger (over an instance's `auto_assign_user_pool`).

For iGrowFast this must answer: **who is an "agent"?** (sellers only? per-business role subset?), **is auto-assign per-business or per-number?**, **do media buyers/couriers get inbox access at all?**, **does the owner see everything or is the owner confined** `[owner-confinement-model]` (WA Mancer "admin sees all" collides with iGrowFast's owner-confinement rule — the owner is stripped of cross-business visibility, so "admin bypass" must be super-admin/admin-**of-that-business**, never `is_owner()` `[owner-not-in-per-business-rpcs]`). **DECISION #4 — the assignment/role mapping is the main design conversation before coding the RLS.**

---

## 4. Edge functions port `[03]`

26 functions. iGrowFast runs self-hosted Supabase edge runtime.
- **Port:** `instance-create/pair/disconnect/restart/delete/status/presence/wa-settings/wa-profile/webhook-resync`, `group-*` (6), `media-sign/media-upload`, `conversation-cleanup`, `og-fetch`, `check-whatsapp`. Rewrite every `public.*` RPC call to `whatsapp.*`; add `business_id` scoping; **close the `withInstance` authorization gap** `[03 §4.4]` (today any authenticated user can act on any `instance_id` — in multi-tenant iGrowFast that's a cross-business hole; add caller↔business↔instance checks).
- **Drop (cloud-only or iGrowFast-owned):** `admin-platform-logs` (Supabase cloud Management API — doesn't exist self-hosted `[03 §4.2]`), `client-log` (telemetry), and the identity functions `create-invitations`/`check-invitation`/`consume-invitation`/`admin-delete-user` (iGrowFast owns identity/onboarding/user-management `[invitation-email-send, user-mgmt-uniqueness-model]`).
- **Replicate the `verify_jwt=false` config** for any kept pre-auth function via iGrowFast's edge config; a blanket deploy resets the flag `[03 §0]`.
- **Media functions rewrite** off R2/aws4fetch to Supabase Storage (see §6).
- **The webhook is NOT an edge function** `[03 §0.1]` — it's the worker's internal HTTP server. See §5.

---

## 5. Worker port `[07]`

The worker is the outbound chokepoint + webhook receiver. It ports as-is in structure, with these required changes:
- **Placement:** on the WhatsApp box, co-located with Evolution (§1). Container, Node 22, hardened as today `[09 §7]`.
- **`DATABASE_URL` must be session-mode** to iGrowFast Supabase, or the dispatcher dies silently — LISTEN/NOTIFY + advisory locks require it `[07 §merge, 09 §7]`. iGrowFast's self-hosted pooler (Supavisor) is currently **loopback-only** on the main box `[supabase-selfhost-install]`. The worker on the WhatsApp box needs a session-mode path to it: expose Supavisor's session port to the WhatsApp box over a private channel (Tailscale/WireGuard/CF-Tunnel), or connect direct to Postgres session. **DECISION #5 — how the worker reaches iGrowFast Postgres in session mode across boxes.** This is the single most likely thing to silently break the merge.
- **`EVOLUTION_API_URL`** → `http://localhost:8080` (co-located) instead of the internal Docker DNS name.
- **R2 → Supabase Storage rewrite** `[07 §merge, 08]`: `worker/src/r2/client.ts`, `r2/avatar.ts`, `media-ingest.ts`, `loop.ts`, `r2MetricsPull.ts` + config move off `@aws-sdk/client-s3` to the Supabase Storage client. Note `ListObjectsV2` has no clean Storage equivalent — the avatar/media enumeration paths need redesign. Keying convention `{instance}/{conversation}/{message}.<ext>` `[02 §2.3]` maps onto a Storage bucket.
- **Drop `platformLogPull`** (cloud Management API `[07 §merge]`) and the metric/log sinks (telemetry dropped).
- **Guard the orphan reaper** `[07 §merge]`: `instance-manager` deletes Evolution instances that have no DB row. On a shared/multi-business Evolution this could delete live instances — scope it to the business's own instances or disable.
- **Secrets:** service-role key (session pooler creds), Evolution global key, envelope key access — into iGrowFast's secret stores `[secrets-topology-two-stores]`, not plaintext `0600` files like the current box `[09 §12]`. Add the `unhandledRejection` handler the worker currently lacks `[07 §merge]`.

## 6. Evolution + datastores on the WhatsApp box `[08, 09 §4–6]`

- **Install Docker on `igf-whatsapp`** (currently absent `[09 §13]`). Stand up Evolution 2.3.7 (build-from-source, evolution-foundation, **not** the atendai image `[08]`) + **its own Postgres 17** (schema `evolution_api`). This Postgres is Evolution's Baileys/creds/history store and stays separate from iGrowFast Supabase.
- **Migrate Evolution's state**, or re-pair: move `/opt/wa-mancer/data/evolution` (session volume) + the `evolution` Postgres DB from the old box, OR re-scan QR on the new box. If moving, the 4 orphaned session dirs vs 1 live instance `[09 §4]` can be cleaned first.
- **Redis:** don't provision it — Evolution's Redis cache is deliberately off (ban-risk 440-war) and its Redis holds 0 keys `[09 §6]`. If the toolbox needs Redis for *other* integrations, that's separate.
- **Ingress/TLS re-decision** `[09 §11, §14.7]`: the current model is Caddy + Cloudflare DNS-01 + a `@no_cf_header→421` gate on `welcomdeal.ma`. iGrowFast's decision is **no Cloudflare for WhatsApp** `[whatsapp-mancer-integration]` — so DNS-01, the CF gate, `rotate-cf-token.sh`, and the CF-only UFW rules all become obsolete. Evolution should be reachable only by the worker (localhost) and, if the SPA/edge needs it, over a private channel — not publicly. **Do not publish Evolution's port to `0.0.0.0`** (the Docker-bypasses-UFW bug `[09 §8]`); keep it internal. **DECISION #6 — Evolution ingress/TLS on the WhatsApp box.**
- **Tighten `igf-whatsapp` SSH** (currently open to the whole internet `[09 §13]`) to admin-IP + LIMIT before exposing anything.
- **Real backups** `[09 §10, §14.5]`: Evolution Postgres + session volume, offsite — the old box backs up almost nothing.

## 7. Frontend / inbox UI port `[04, 05, 06]`

- **Copy the inbox near-verbatim** `[04]` (the crown jewel) into the iGrowFast SPA; adapt the Supabase client, Realtime subscriptions, and query layer to iGrowFast's app shell.
- **Admin/numbers UI** `[05]` ports for instance management (create/pair/settings/lifecycle) — gated to per-business **super-admin/admin**. The business admin provisions and pairs the client's numbers; the **owner never pairs a number**.
- **NEW — Owner WhatsApp fleet dashboard** (owner-gated route in the SPA): the platform **control plane** — node/worker-pool health, capacity, business→node placement, global guardrails, fleet scaling. Sees **no** conversation content (owner-confinement holds) and does **not** provision/pair numbers. Full detail in §13.6.
- **Do NOT port WA Mancer auth/login/onboarding/invitations** `[06]` — iGrowFast owns identity, routing guards, and the 6-role model. The inbox mounts inside iGrowFast's existing auth/route-guard/business-switch shell.
- **App topology (decided 2026-07-05):** ONE SPA at `app.igrowfast.com`, role-based **paths** + lazy-loaded per-role bundles (NOT per-role subdomains); flow `igrowfast.com` → `app.igrowfast.com/login` → role landing (`/seller`, `/admin`, …). The inbox is a **lazy-loaded route** (e.g. `/admin/whatsapp`, `/seller/whatsapp`), so non-inbox roles ship no inbox JS. **Hosting = Cloudflare Pages** (static build, CDN, auto-TLS, zero box load). See [[deploy-pipeline]].
- **Realtime:** iGrowFast Supabase must broadcast the 14 ported `whatsapp` tables `[02 §9]` (add them to the publication) and the SPA subscribes with `business_id`-scoped filters.
- **MB-facing data rule** `[mediabuyer-facing-data-rule]`: if media buyers get any inbox surface, apply the existing cost/spend-hiding rules — **DECISION #4** covers this.

## 8. What to drop entirely (do not port)

Telemetry DB stack + its crons `[02 §2.7]`; the two systemd shippers `wa-log-shipper`/`wa-metrics-collector` `[09 §10]`; `platformLogPull`/`r2MetricsPull` `[07]`; `admin-platform-logs`/`client-log` edge fns `[03]`; the hash-chained audit machinery `[02 §6]`; WA Mancer identity (`profiles`/`user_role`/`is_admin`/invitations) `[02 §2.5]`; Docker Swarm `[09 §2]`; direct R2/aws4fetch `[07]`; every `welcomdeal.ma`/`wamancer-media` hardcode `[09 §11]`; the un-configured restic + session-only local backup `[09 §10]`.

## 9. Secrets topology reconciliation `[08, 09 §12, secrets-topology-two-stores]`

WA Mancer uses sops+age (source-side) → plaintext `0600` runtime files. iGrowFast uses two stores: edge-fn env (Supabase CLI secrets) + Postgres Vault. Map: Evolution global key + worker service-role + envelope-key access → the appropriate iGrowFast store; the new `whatsapp` envelope key → Vault. Don't carry plaintext-on-disk secrets or the single-age-key model onto the merged hosts.

## 10. Phased execution plan

1. **Schema port (main box):** create `whatsapp` schema; port enums/tables with `business_id`; port functions/views schema-qualified; rewire RLS onto iGrowFast roles + `business_id`; apply the §2.5 security fixes; add operational crons; add the 14 tables to the realtime publication; new envelope key in Vault. Verify by impersonation per business.
2. **WhatsApp box:** install Docker; stand up Evolution 2.3.7 + its Postgres; migrate/re-pair sessions; keep Evolution internal (no public port); tighten SSH; wire backups.
3. **Worker:** rewrite R2→Storage + `public.*`→`whatsapp.*` + Evolution URL=localhost; establish the session-mode path to iGrowFast Postgres (DECISION #5); deploy co-located with Evolution; drop telemetry sinks; add unhandledRejection.
4. **Edge functions:** deploy the kept subset to iGrowFast edge runtime, schema-qualified + business-scoped + `withInstance` authz fix; replicate verify_jwt config.
5. **Frontend:** copy inbox + numbers/admin UI into the iGrowFast SPA against iGrowFast auth + business-scoped realtime; wire media to Storage.
6. **End-to-end:** pair a test number under a test business, verify inbound ingest + outbound send + media both ways + assignment isolation across two businesses.

## 11. Decisions — RESOLVED 2026-07-05 (planning; nothing executed yet)

Locked with the user this session. **Execution posture: replicate into iGrowFast, directly in live prod, one small verified step at a time — NO dev branch/clone (deliberate: no time to rebuild a dev env). Snapshot before each DDL, verify after. WA Mancer itself stays a separate live product, untouched.**

1. **Transport** `[§5]`: **Tailscale mesh** across the 3 boxes; worker → main-box Postgres `:5432` over the tailnet (session mode). Stand up Tailscale if absent.
2. **Agents** `[§3, §7]`: **sellers only**. Media buyers + couriers excluded from the inbox (MB data-hiding N/A).
3. **Inbox admin** `[§2.4, §3]`: **per-business super-admin + admin**. **Owner EXCLUDED** — owner-confinement preserved; no cross-business inbox.
4. **Tenancy** `[§2.3]`: a business owns **many** numbers; **each number isolated to exactly one business**. `business_id` root on `whatsapp_instances`; everything inherits from it.
5. **Assignment** `[§3]`: **all three paths** — auto round-robin over a per-number seller pool + admin manual (re)assignment + seller self-claim.
6. **Worker placement** `[§1, §5]`: **co-located with Evolution + Evolution's Postgres on the WhatsApp box `.67`**. Sensitive hop stays on localhost.
7. **Media** `[§6, §8]`: **Supabase Storage, new PRIVATE `whatsapp-media` bucket**; rewrite worker off `@aws-sdk`; SPA reads via **short-TTL Supabase signed URLs** (bucket stays private — media proxies via `api.igrowfast.com/storage` → R2). Chosen over a public R2 custom domain for security (private customer media; no permanent public-by-URL). Revisit a `media.igrowfast.com` R2 CDN offload only if media volume gets large — it's a later serving-layer swap, not a re-architecture. **No new DNS.**
8. **Build fresh** `[§6]`: build a new stack in iGrowFast, **fresh QR pairing**, no data/session migration. WA Mancer stays a separate live product — nothing migrated or torn down.
9. **Envelope key** `[§2.5]`: **single `whatsapp`-schema key in iGrowFast Vault**; per-business keys deferred.
10. **Scope order**: **schema + inbox UI first** (against iGrowFast identity), Evolution box + worker + Tailscale as the next session.
11. **SPA target** `[§7]`: **local dev only for now**; production SPA hosting (app.igrowfast.com) is a separate task.
12. **Seller pool** `[§3]`: **admin-chosen subset per number** (WA Mancer's `auto_assign_user_pool`); auto-assign round-robins only over that pool.
13. **Seller deactivated/leaves** `[§3]`: **release their DM assignments back to unassigned** (re-claimable/re-assignable); group assignments persist.
14. **Groups** `[§3]`: **multi-agent** — a group conversation can have multiple sellers; DMs stay single-owner (partial-unique singleton).
15. **Admin as agent** `[§3]`: admin **sees everything and can reply/type on any conversation** via the admin bypass (agent on the send path) but **NEVER claims** and never removes a conversation from the unassigned pool — no admin row in `conversation_assignments`. Exactly WA Mancer's `_assert_conversation_access` admin-bypass.
16. **Test environment**: **none — work directly in live prod**, carefully and incrementally, snapshot + verify each step.
17. **Evolution ingress on `.67`** `[§6]`: **tailnet-private, no public port**. Evolution bound to localhost + tailnet; worker hits it on localhost, self-hosted edge on `.102` hits it over the tailnet + global API key. No public endpoint, no cert. (WA Mancer was forced public only because it used Supabase *cloud* edge, which can't reach a private net — iGrowFast self-hosts edge, so that constraint is gone.)
18. **Evolution manager UI**: **tailnet-only** (`http://<evolution-tailscale-ip>:8080/manager`, laptop joins the tailnet). WA Mancer exposed it publicly at `api.welcomdeal.ma/manager` only because Evolution was already public there. Day-to-day instance ops run through the ported admin UI + edge functions; the manager is just a debug surface.
19. **Orchestration** `[§13.3]`: **NO Kubernetes.** `docker compose` per node now; Nomad/Swarm deferred and swappable (the lease system holds the distribution logic, not the orchestrator).
20. **Node model** `[§13.1]`: a WhatsApp node = Evolution + its Postgres + worker pool co-located; scale workers via `compose --scale`, capacity by adding whole nodes; `.67` = node 1.
21. **Worker built fleet-ready from day 1** `[§13.2]`: the 5 seams (node model / bounded data-driven claiming / business→node assignment-as-data / tailnet addressing / fleet-safe webhooks). Schema already supports it (`worker_instance_leases`), so it's worker-code + one assignment table, **not** a queue redesign. Queue is already per-number (never shared across businesses).
22. **Networking** `[§13.4]`: **Tailscale free tier + tailnet lock**; servers join as *tagged* nodes; worker **containers ride the host** so scaling them never consumes tailnet nodes; **Headscale** documented as the sovereignty/limit escape hatch.
23. **Toolbox `.211`** `[§13.5]`: **shared app-wide tools** (Reacher/email-check, IP-geo, Hermes AI) — **NOT** WhatsApp workers.
24. **Owner WhatsApp dashboard** `[§13.6]`: **fleet control plane ONLY** — nodes, worker pools, capacity, business→node placement, global guardrails, scaling. **No conversation access** (owner-confinement holds), **no number provisioning**.
25. **Number provisioning** `[§13.6]`: the **business admin** creates/pairs/settings numbers — never the owner.

### DNS / control-panel footprint of this merge
**Almost nothing new.** Evolution/worker/webhook take no public inbound (tailnet + localhost only). The `whatsapp` schema, edge functions, Auth, and Storage all ride the **existing `api.igrowfast.com` CF Tunnel** to the self-hosted Supabase — no new subdomain, no new tunnel, no cert. Media = private-bucket signed URLs on that same endpoint (no `media.` subdomain). The inbox is a route in the existing SPA (local dev for now). **Real "networking" work = Tailscale** (private overlay, `100.x`/MagicDNS — not public DNS) + an **R2 `whatsapp-media` bucket + scoped token** (CF R2 control panel, not DNS). Deferred/general: `app.igrowfast.com` when the SPA ships to prod. **To confirm:** `igrowfast.com` DNS is on Cloudflare; `api.igrowfast.com` is the CF-Tunnel'd self-hosted Supabase already routing `/storage` + `/functions`; prod SPA target.

## 12. Still open — settle at execution

- **Edge-function final subset** + the `withInstance` per-business authz fix scope `[§4]`. Proposed keep-set: `instance-*`, `group-*`, `media-sign`/`media-upload`, `conversation-cleanup`, `og-fetch`, `check-whatsapp`; drop `admin-platform-logs`, `client-log`, and the identity/invitation fns (iGrowFast owns identity). Confirm at build time.

## 13. Scaling & fleet architecture — DECIDED 2026-07-05

Built scale-ready from day 1 so adding capacity is additive, never a mid-flight rebuild. Product-scale knobs (capped vs unlimited, dedicated vs shared) are deferred but implemented as **data/policy**, not hardcoded, so they flip later with zero rearchitecture.

**13.1 Node model.** A **WhatsApp node** = Evolution + its own Postgres + a worker pool, co-located on one box. `.67` = node 1. Scale workers *within* a node via `docker compose up --scale worker=N`. Scale *capacity* by adding whole nodes (another box). `worker_instance_leases` distributes numbers across whatever workers exist. Worker↔Evolution stays on localhost within a node; cross-node traffic rides the encrypted tailnet.

**13.2 Worker fleet — the 5 seams (build NOW, even on one node).** The "build once, never reconstruct" work; the schema already supports it (`worker_instance_leases`), so it's worker-code + one small assignment table, NOT a queue redesign:
1. **Node model** — nothing assumes a single global instance.
2. **Bounded, data-driven claiming** — each worker claims only its *assigned shard* (by business), never "claim all"; unique `WORKER_ID`; rebalance on join/leave via lease expiry + `lease_seq` fencing. (Claim-all = can't add a worker without a rewrite; claim-bounded = adding a worker is just starting a container.)
3. **Business→node/worker assignment as DATA** — a mapping table the system reads; moving a business to another node / pinning a premium tenant to a dedicated node = a row change, not a redeploy. This is where the capped/dedicated policy lives.
4. **Tailnet addressing everywhere** — reach Evolution/Supabase by tailnet name; localhost only as a co-location optimization, never hardcoded.
5. **Fleet-safe webhooks** — inbound hits any worker (stateless + idempotent → shared per-node endpoint); outbound dispatch stays lease-partitioned.

The queue is **already per-number** (`outbound_queue.number_id`, per-number pacing, one dispatcher loop per number), so businesses never share a FIFO — that already scales and is NOT rebuilt. The only single-tenant thing was the single-worker *deployment*.

**13.3 Orchestration — NO Kubernetes.** Deploy = plain **`docker compose` per node**. k8s rejected: a heavy permanent ops tax, a bad fit for the *stateful* Evolution+Postgres core (StatefulSets/PVCs; a rescheduled Evolution losing its volume = re-pair every number), and it duplicates intelligence the lease system already provides. The orchestrator only "runs N containers"; the DB does the distribution — so it's a **swappable** choice. If node count ever makes per-node deploys painful, adopt **Nomad** (light, tailnet-friendly, handles stateful+stateless) or Swarm — later, cheaply, because the seams already exist.

**13.4 Networking — Tailscale (free) now; Headscale as escape hatch.** WireGuard mesh across all boxes. Start on the **free "Personal" tier** (unlimited user devices, up to 6 users, up to **50 tagged resources** = server boxes, 1,000 ephemeral mins). Enable **tailnet lock** — even a compromised Tailscale control plane can't inject a node without your signing key. **Servers join as *tagged* nodes**; **worker containers ride the host's tailnet identity, so scaling containers never consumes tailnet nodes** — only adding whole boxes does (you're at 3 of 50). Data-plane speed/security is identical to any WireGuard mesh; the control plane is the only difference. **Headscale** (self-hosted, unlimited, free) is the documented escape hatch if box count ever nears 50 or full sovereignty is wanted — migration = repoint clients, no lock-in.

**13.5 Box roles.** Main `.102` = app + self-host Supabase (whatsapp schema, edge, Storage, Vault, pooler). WhatsApp node(s) from `.67` = Evolution + its Postgres + worker pool. Toolbox `.211` = **shared app-wide tools** (Reacher/email-check, IP-geo, Hermes AI) — **NOT** WhatsApp workers (different concern/lifecycle; Hermes may be heavy).

**13.6 Owner WhatsApp control dashboard (NEW).** Owner-gated route in the single SPA. **Control plane ONLY** — governs the fleet: node/worker-pool health, capacity, **business→node placement**, global guardrails (default pacing presets/caps/lifecycle policy), fleet scaling. The owner **never reads conversation content** (owner-confinement holds `[§2.4]`) and **never provisions/pairs numbers** — number create/pair/settings is the **business admin's** job in the per-business admin UI `[05, §7]`. The split: **owner owns *where/how much*** (infrastructure placement + capacity); **admin owns *what*** (the business's own numbers + inbox).

**13.7 Deferred (data-policy knobs — no rearchitecture to flip).** Capped vs unlimited numbers per node/business; dedicated vs shared nodes per tenant; node count; orchestrator upgrade (compose → Nomad/Swarm). All become settings on the business→node assignment layer, decided when the product model is decided.

---

## Chapter index (this recon series)

- **01** — design docs (the *design*, with drift/gap flags)
- **02** — database (the *territory*: 35 tables, 174 fns, RLS, encryption, live data)
- **03** — edge functions (26 fns + webhook-is-the-worker)
- **04** — inbox/conversations UI (the crown jewel)
- **05** — admin UI (numbers/contacts/settings)
- **06** — app shell, auth, onboarding, user inbox
- **07** — Node worker (dispatcher, pacing, Evolution client, webhook, media)
- **08** — infrastructure, deployment & secrets (infra-as-code)
- **09** — the live VPS (deployed reality + target-box baselines)
- **10** — this integration blueprint
