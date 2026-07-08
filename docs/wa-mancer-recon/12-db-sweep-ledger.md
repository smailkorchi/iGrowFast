# 12 — DB sweep ledger (the "prune-later" pass)

Status: **ACTIVE** — this is the separate editing pass that build-plan §2.2 deferred.
Measured 2026-07-08 on the live box. Companion recon: six-agent sweep (stats-cache,
media-pipeline, logs-audit, telemetry, docs-intent, wa-node), full evidence in the
session workflow journal.

## 0. Measured state

| Metric | Value |
|---|---|
| DB total | 81 MB |
| whatsapp schema | 34 MB |
| **WAL generated** | **1,011 MB in 4 days** (4,644 segments archived to R2, 0 failures) |
| messages | 969 live rows / 90,399 ins / 89,413 del — 12 MB index on 328 kB heap |
| conversations | 2,581 live / 302,686 upd — 4.8 MB index on 664 kB heap |
| app_cache | 52 live / **109,992 upd** (cache_warm every 30 s) |
| system_logs | 9,380 rows/2 d — 71 % is the media/evolution error pair |
| audit_log | 4,342 rows/2 d — hash-chained, **no retention possible by design** |
| cron.job_run_details | 31 k rows (7 d prune OK) — 2,880/day from cache_warm alone |

Message churn explained: **not a bug** — 10 instance pair→history-sync→delete test
cycles; FK CASCADE deleted 4,126 conversations + ~89 k messages + 6.7 k media jobs.
The residue is index bloat, not corruption.

## 1. Root causes found

1. **RLS per-row tax** (donor-latent): `conversations_decrypted` at 583 ms mean,
   10,584 s total CPU. Fix proven in rollback trial: 436 ms → 24.4 ms
   (migration `whatsapp_018_rls_admin_fastpath.sql`).
2. **cache_warm is 100 % dead weight**: donor itself de-cached the stats RPCs on
   2026-06-08 (migration `20260608180000_stats_realtime_exact_no_cache`); we ported
   the de-cached versions. ~28 of its ~30 warmed keys have **no possible reader in
   either codebase**. The one live cached RPC (`instance_stats`, NumberDetail) is
   not warmed by it. `cache_get_or_compute` is compute-on-miss self-healing
   (SWR + XFetch + advisory locks, 0–11 ms computes) — warming is never required.
3. **Media/evolution error storm = one root cause, environmental**: history sync
   backfills Feb–Jun media whose WhatsApp CDN URLs (~14 d lifetime) are expired;
   Evolution `getBase64FromMediaMessage` 400s each one; worker terminal-fails on
   attempt 1 (correct — bounded: terminal-on-400 + 5-attempt cap + 60 min backoff;
   243/243 failed jobs were >14 d old, zero reached attempt 2). Each failure writes
   TWO warn rows (`evolution.http_error` + `media.ingest.fail`) = ~6 k rows/day
   during syncs. R2 path proven working (19 uploads, zero R2 errors).
4. **SECURITY REGRESSION (live)**: `whatsapp._cron_purge_metric_samples` — SECURITY
   DEFINER purge — is EXECUTE-granted to **anon + authenticated** (callable via
   `/rest/v1/rpc`). Build-plan W3 ordered this normalized; `whatsapp_014b` ported
   the donor's bad grant 1:1.
5. **r2_metrics feeder silently 404s**: worker `r2MetricsPull.ts` POSTs
   `rpc/ingest_r2_metrics` with no `Content-Profile: whatsapp` header → PostgREST
   resolves against `public` → 404 every 10 min, logged only at debug. 0 rows ever.
6. **host_metrics + metric_samples never fed**: the donor's `wa-metrics-collector`
   systemd unit was never deployed on either box. Tables empty; their prune crons
   no-op. `metric_samples` also has **no PK** (donor defect, doc 02 §12).
7. `_cron_consolidate_split_conversations` burns ~78 ms **every minute** looping all
   unmerged @lid conversations even when idle. Core-adjacent (identity) — flagged,
   not touched in wave 0.

## 2. Laws (bind all future work)

- **audit_log is append-only forever.** SHA-256 hash chain from genesis;
  `validate_audit_chain` verifies from row 1 — any DELETE permanently breaks a live
  Log-page feature. Donor runs zero audit retention. If growth ever matters:
  archive-checkpoint redesign (R2 export + anchored hash), never a retention cron.
  Logic floors: `message.dead` 7 d (lifecycle promotion), `instance_status_changed`
  7 d (reconnects_7d), heartbeat dedupe 60 s.
- **Never touch**: `worker_instance_leases` (send-safety fence),
  `number_pacing_state` (ban safety), `worker_health` (liveness signal),
  `dispatcher_snapshot` (Realtime-fanned inbox feed), `wa_nodes` (provisioning),
  outbound_queue semantics (7 d cleanup + 24 h dead-count + 60 s rate windows are
  load-bearing).
- **system_logs is display-only** — zero logic readers; longest reader window 24 h;
  UI clamp 90 d. Retention is an ops preference, not a correctness question.
- **app_cache/og_cache/cache_get_or_compute must stay** (instance_stats live today;
  og-fetch live; future Dashboard port reads through them, unwarmed).

## 3. The ledger

### Wave 0 — DB only, tonight (`whatsapp_018` + `whatsapp_019` + one-time reindex)
| # | Action | Class |
|---|---|---|
| 0.1 | Apply 018 RLS fastpath (proven 436→24.4 ms) | proven |
| 0.2 | REVOKE anon/authenticated/public on ALL `whatsapp._cron_*` fns (W3 normalization; closes the live SECDEF hole) | safe |
| 0.3 | `cron.unschedule('wa-cache-warm')` — job 45. Janitor (46) stays: it prunes og_cache + job_run_details | safe |
| 0.4 | One-time `REINDEX TABLE CONCURRENTLY` + `VACUUM ANALYZE` over the churned tables (~20 MB reclaim) | safe |

Expected effect: kills the #1 CPU statement (RLS), the #4 statement + 86 k row
updates + 2,880 cron runs/day (cache_warm), and the bloat. WAL rate drops with it
(realtime's wal2json poll — #2 CPU — scales with WAL volume).

### Wave 0.5 — the amputation (`whatsapp_020`) — APPLIED 2026-07-08
**OWNER RULING 2026-07-08, supersedes the 2026-07-05 keep-verbatim ruling:** the
metrics/logs stack is dropped; the product surface is the 4 admin pages
(Numbers, Inbox, Assignment, Contacts) + seller inbox. Dashboard / Statistics /
Log / Monitor pages are CUT permanently, and their data layer went with them:

- **Dropped tables (7):** system_logs, db_metrics_history, worker_health_history,
  host_metrics, r2_metrics, metric_samples, _cron_ingest_state
- **Dropped functions (53):** monitor_*, db_metrics_*, admin_query_logs,
  admin_log_facets, dashboard_overview/activity, agent_performance, all
  stats_*(+impl) except instance_stats, all _compute_stats_* except
  _compute_instance_stats, cache_warm, cache_quantize, ingest_host/prom/
  platform/r2 feeds, the 7 observability cron fns
- **Unscheduled crons (7):** 43/44/47/48/49/50/52 — 8 remain, all operational
- **Dropped enums:** log_source, log_level
- **Stubbed:** `ingest_system_logs` → no-op returning 0 (live callers: worker
  logSink 4 s flush, edge logError, client-log — all fire-and-forget; wave 1
  removes the callers, then the stub can go)
- Schema: 36 → 29 tables, 16 MB → 10 MB. Worker verified healthy after.

KEPT despite the ruling's letter, because the 4 pages / core read them:
`audit_log` (NumberDetail timeline + realtime sub + reconnects_7d +
lifecycle_auto_promote reads message.dead 7 d + 25 RPC writers), `app_cache`
(instance_stats), `og_cache` (inbox link previews), `worker_health` (Numbers
tiles + stale alert), `dispatcher_snapshot` (live gauges).

Gray items (unused by the 4 pages, feature-class — owner call, not dropped):
`message_templates` (0 rows, 0 src refs, donor inbox feature never ported),
`merge_review` (143 rows, absorption pending per deferred registry).

### Wave 1 — the one-week sync rule + worker strip — APPLIED 2026-07-08
**OWNER RULING 2026-07-08 (the pairing rule):** history sync ingests ONLY the
last `SYNC_WINDOW_DAYS` (7, worker env) and ONLY displayable data. Supersedes
the donor's "1 contact/chat = 1 conversation, always create the row"
architecture. Live message flow is untouched. Gates (all in
`ops/whatsapp-node/worker/src/webhook/handlers.ts`):

1. **Message gate** — `messages.set` items older than the window are skipped;
   unresolvable @lid history is skipped (`ingestMessage(fromHistorySync)`).
   Side effect: every ingested media is inside WhatsApp's ~14 d CDN validity —
   the expired-media storm is structurally impossible.
2. **Contact gate** — `upsertContactFromSync` is ENRICH-ONLY (thread-ownership
   check via `holdsContactThread`); the conversation-creating INSERTs in the
   contacts and chats handlers became UPDATEs (DMs always; groups only during
   the dump — live group joins still INSERT so `append_group_system_event`
   has its row).
3. **Dump-bulk gate** — during sync phase (`history_synced_at IS NULL`, 15 s
   cache, fail-open), contact events for un-held jids skip BEFORE
   `cacheAvatar` (no R2 avatar floods); un-held dump groups skip
   `maybeRefreshGroupInfo` (no findGroupInfos hammering / roster churn).
4. **Backfill gate** — `backfillContactsFromEvolution` prefilters against held
   phones+lids before caching avatars (its donor comment claimed "does NOT
   create conversations"; its `upsertContactFromSync` call did — the main
   shell factory, now impossible).
5. **Evolution knob** — `instance-create` now provisions with
   `syncFullHistory: false` (was true): WhatsApp sends the small initial
   slice, gates trim the rest.

Strip (same redeploy): `logSink.ts` + `r2MetricsPull.ts` DELETED (worker logs
→ journald only), `client-log` edge fn undeployed + removed from repo.
REVISION vs plan: the `ingest_system_logs` no-op stub is KEPT permanently —
edge `_shared/logError.ts` calls it fire-and-forget from 6 functions; a
3-line no-op beats churning 6 edge fns.

Deployed: worker image rebuilt on .67 (healthy, 2 dispatchers, leases
claimed), edge runtime restarted with new `_shared/evolution.ts`.
REAL TEST = next number pairing: expect dozens of conversations, zero
`media.ingest.fail`, `contacts.backfill.done` logging `skipped_no_thread`.

### Wave 2 — audit-noise trim (`whatsapp_022`) — APPLIED 2026-07-08
audit_log is append-only forever, so what enters it must earn permanence:

| # | Applied | Mechanism |
|---|---|---|
| 2.1 | Stale-worker alerting LEFT the chain: pg_cron job 38 + `_cron_worker_health_alert` dropped | replaced by box-level `/etc/cron.d/igf-wa-worker-alert` → `/usr/local/bin/igf-wa-worker-alert.sh` → `igf-alert.sh` email, one STALE + one RECOVERED per outage (threshold 120 s, per-worker state in /run). **This also closes the alerting gap — worker death now emails the owner.** |
| 2.2 | `media_access` removed at the source (media-sign edge fn) | was one permanent chain row per attachment RENDER (560/2 d); `media_upload_url_issued` stays chained |
| 2.3 | Bulk assignment ops write ONE summary row, not one per conversation (was 48 % of the chain) | txn-local GUC `whatsapp.audit_assign_suppress` honored by the assignment trigger; `admin_apply_auto_assign_backlog` (summary existed), `admin_assign_conversations` / `admin_unassign_conversations` (new `conversations_(un)assigned_bulk` summaries). Single assign/unassign + `_auto_assign_on_inbound` still audit per row. Verified in rollback trials: suppressed = 0 rows, normal = 1. |

### Wave 3 — deferred to owner Log/Monitor port (PORT_PLAN item 8)
- host_metrics + metric_samples: port `collector.mjs` re-pointed at the box, or
  accept empty Monitor panels. If ported: add PK to metric_samples, trim the
  ~130-series allowlist, stretch scrape interval (donor scale warning: 1.85 M
  rows/490 MB at 7 d).
- system_logs retention 14 d → 30 d when the Log page ships (its default window).
- Optional: worker_health_history → hourly rollup (sole reader already averages to
  hour+ and has NO UI caller anywhere — donor removed the series);
  db_metrics_history → 48 h minute + hourly rollup.
- Platform-log path (`ingest_platform_logs`, 6 `platform_*` enum values) is dead on
  self-host (needs cloud Management API) — Log page "Plateforme" tab must re-target
  box journald or be cut.
- Drop-at-port-time cosmetics: `cache_warm()` fn + the 6 dead `_compute_stats_*`
  shims for de-cached RPCs.
- `_cron_consolidate_split_conversations` idle-bail optimization.
- Retention for terminal `media_fetch_jobs` rows (completed_at > 30 d) — dedup only
  depends on `completed_at IS NULL` rows.

### Doc reconciliation
Doc 10 §2.2/§8/§11-7 (drop telemetry, drop R2) is SUPERSEDED by doc 11 v3 + the
2026-07-06 media ruling. Marked here; doc 10 edits deferred.
