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

### Wave 1 — worker code (.67 redeploy), needs owner go (deviates from donor 1:1)
| # | Action | Class |
|---|---|---|
| 1.1 | `r2MetricsPull.ts`: add `Content-Profile: whatsapp` header (or move to pg pool like heartbeat) — restores r2_metrics feed | bug fix |
| 1.2 | Age-gate `enqueue_media_fetch` for history-sync media older than ~13 d: mark `media_failed_at` directly, skip the guaranteed-fail Evolution round-trip | sanctioned deviation |
| 1.3 | Stop double-logging expired-CDN media: demote the `evolution.http_error` twin for `getBase64FromMediaMessage` (keep `media.ingest.fail`); demote `dispatcher.spawn.already_running` warn→debug | sanctioned deviation |

### Wave 2 — audit-noise policy (owner decisions, per item)
| # | Decision | Trade-off |
|---|---|---|
| 2.1 | `worker_heartbeat_stale` → system_logs instead of the chain | weekend outage = 2,880 permanent chain rows vs weaker attestation |
| 2.2 | `media_access` (1 row per attachment render) → system_logs | chain grows with normal inbox usage vs tamper-evident access log |
| 2.3 | Suppress per-row `conversation_assigned` during bulk backlog apply (summary event already exists) | 48 % of chain rows vs per-row audit |

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
