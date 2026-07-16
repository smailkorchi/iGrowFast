# Track 0 — Stack-Capacity Baseline (measured 2026-07-16, live box, read-only)

Foundation for the request/resource/scalability audit. Every per-page verdict is scored against these **denominators**. Source of truth = live box (`ssh igf`, `~/.igrowfast/db.sh`), not repo config.

## Box
- Contabo, **12 vCPU / 47 GB RAM**. At measure time: load ~1.0 (~8% CPU), 38 GB free, swap 0, 12d uptime. Massive headroom **at current (tiny) scale**.
- Everything is ONE box, ONE node per service (no horizontal replicas). No read-replica.

## Service topology (all Docker on the box)
| Service | Image | Role / scale note |
|---|---|---|
| supabase-db | PG **17.6.1** (igf build, pgbackrest) | single primary |
| supabase-pooler | **supavisor 2.9.5** | transaction mode; **non-PostgREST clients only** |
| supabase-rest | postgrest v14.12 | **connects DIRECT to db:5432**, own pool |
| realtime | v2.102.3 | broadcast-only; 1 pgoutput slot |
| supabase-kong | kong 3.9.1, DB-less | gateway; **no rate-limit plugin** |
| supabase-auth | gotrue v2.192.0 | |
| supabase-edge-functions | edge-runtime v1.74.0 | single `main` router, JWT verify global |
| supabase-storage + imgproxy v3.30 | | **imgproxy present → thumbnails available** |
| cloudflared | | single tunnel → kong (egress path) |

## Postgres ceilings (the denominators)
| Param | Value | Note |
|---|---|---|
| max_connections | **200** (~197 usable, 3 reserved) | currently **43 used** — huge headroom |
| shared_buffers | **12 GB** | 186 MB DB fits entirely → **100% cache hit** |
| effective_cache_size | ~35 GB | |
| work_mem | 32 MB | per sort/hash node |
| maintenance_work_mem | 2 GB | |
| max_parallel_workers | 12 (per_gather 4) | |
| statement_timeout (global) | 0 | but role-scoped below |
| **anon** role | statement_timeout **3s**, idle_in_tx 60s | |
| **authenticated** role | statement_timeout **8s**, idle_in_tx 60s | app queries hard-capped 8s |
| jit | on | |

## Connection model (CRITICAL for concurrency)
- **App REST traffic path:** browser → CF tunnel → Kong → **PostgREST → direct db:5432**, pool = `PGRST_DB_POOL` **unset → default ≈10** (confirmed: 11 idle `authenticator` conns). Acquisition timeout default 10s.
  - **This ~10-connection pool is the throughput governor for ALL dashboard REST calls.** Math: ceiling ≈ `pool / mean_query_seconds`. At 5 ms → ~2000 q/s. At 50 ms (see conversations_decrypted) → **~200 q/s for the whole tier**. One heavy query pattern throttles everyone.
- **Supavisor** (transaction mode, default_pool_size 20, **max_client_conn 100**) serves only direct-Postgres clients (WA worker, migrations) — NOT PostgREST. Its 100-client cap is invisible to dashboard traffic.
- **Realtime:** direct db:5432; `RLIMIT_NOFILE=10000` → **~10k concurrent websockets ceiling, single node**. 2000 users × ~2 channels ≈ 4k FDs (OK); tight beyond ~4–5k users, no horizontal scale.
- **PGRST_DB_MAX_ROWS = 1000** (server-global). **Every unpaginated list/RPC silently truncates at 1000 rows.** Confirms the money-cap bug class at the server level → `fetchAllRows()`/keyset mandatory on any correctness-sensitive list.

## Realtime posture (positive)
- `supabase_realtime` publication = **0 tables** → **no postgres_changes CDC fanout** (the expensive path is retired; app uses Broadcast). Only `supabase_realtime_messages_publication` (7 tables) active via 1 healthy pgoutput slot (290 kB lag).
- `_realtime.extensions` has a `postgres_cdc_rls` row (kill-switch present) but drives 0 tables.
- `realtime.messages` archive ≈ **21k rows/day**, self-partitioned daily (4 live partitions). Confirm retention holds at scale.

## Kong / edge
- Kong DB-less, plugins: request-transformer, cors, key-auth, acl, basic-auth, request-termination, ip-restriction, post-function. **No rate-limiting / request-size-limiting** → thundering-herd + abusive-client exposure.
- Edge: single `main` service router; JWT verify is global (self-host).

## Real DB load profile (pg_stat_statements, ~7 days)
Dominated by **WhatsApp subsystem + per-minute crons**; e-commerce dashboard barely registers.
- Hottest by total time: `whatsapp.dispatch_prep` (40k calls, 3ms, 10%), **`whatsapp.conversations_decrypted` SELECT (33–50 ms mean — the most expensive user-facing pattern)**, WA cron reclaim/drain, `resolve_identity` (47k calls), `refresh_all_open_seller_tickets` (26 ms), `refresh_open_mediabuyer_ticket`.
- **Two unidentified RPC outliers: 472 ms ×91 and 548 ms ×31** — likely analytics/stats RPCs; identify during Analytics audit (#17).
- Hottest by frequency: accent-`translate()` (388k, ~0ms), search_path set_config (66k), WA worker polling (`media_fetch_jobs` 48k, `outbound_queue` depth COUNT 36k, `worker_heartbeat` 36k) — worker-driven fixed cost, not per-user.
- 23 active pg_cron jobs (retention jobs exist for webhook_logs / order_status_history / tracking / outbound_queue). **`cron.job_run_details` has no purge job** (41k rows/wk, grows unbounded).

## Data scale today (why timings mislead)
2,155 orders · 2,281 WA conversations · 186 MB DB. **Everything is fast because the working set fits in RAM.** A 3 ms query on 2k orders can become 300 ms on 2M orders without correct indexes. **Per-page audits must verify index coverage + EXPLAIN plans assuming 100–1000× growth, not current latency.** hypopg + index_advisor extensions are installed — use them.

## Track 0 findings (infra-level, gated on approval)
| ID | Sev | Finding | Direction |
|---|---|---|---|
| F0-1 | HIGH | PostgREST pool ≈10 (default, unraised) = REST concurrency governor | raise `PGRST_DB_POOL` ~20–30 + tune acquisition timeout; DB has 200-conn / 12-core room |
| F0-2 | HIGH | No Kong rate-limiting → focus-refetch storm / abusive client can exhaust the pool | add rate-limiting + request-size plugin (per-key/IP); + client refetch discipline |
| F0-3 | HIGH | `PGRST_DB_MAX_ROWS=1000` truncates unpaginated queries (money-correctness) | per-page lens: enforce `fetchAllRows()`/keyset on correctness-sensitive lists |
| F0-4 | MED | `conversations_decrypted` 33–50 ms = heaviest user-facing query | WA Conversations (#32): paginate + decrypted-projection strategy |
| F0-5 | MED | Two RPC outliers 472/548 ms unidentified | identify during Analytics (#17) |
| F0-6 | LOW | `cron.job_run_details` unbounded; confirm `realtime.messages` retention | add purge cron |
| F0-7 | GOOD | Realtime is broadcast-only (no CDC fanout) | keep; never reintroduce postgres_changes |
