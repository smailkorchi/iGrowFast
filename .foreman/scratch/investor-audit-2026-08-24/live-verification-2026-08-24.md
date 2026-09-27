# Live Verification — 2026-08-24 (gap-closure pass)

Internal capture record. Read-only. No writes, deploys, restarts, DDL, or secret values.
Capture window: 2026-08-24 ~18:55–20:05 UTC. Repository HEAD unchanged from the 2026-08-23 baseline: `790f84e`.

Purpose: close the three "Unverified areas" the 2026-08-23 live map left open, and re-measure volatile figures so the dossier carries one consistent capture date.

## Gap 1 — WhatsApp node runtime (was: SSH alias resolution blocked)

CLOSED. `ssh igf-whatsapp` resolved and responded.

- Host: 12 vCPU, 47 GiB RAM, 242 GiB disk at 6% used, uptime 51 days 1 hour.
- Containers, all up: `igf-wa-worker` (healthy, started 2026-07-29), `igf-wa-evolution` 2.3.7-igf3 (healthy, started 2026-07-10), `igf-wa-postgres` postgres:17-alpine (healthy), `igf-wa-redis` redis:7-alpine (healthy), `docker-socket-proxy`.
- Exposure: UFW active; only 22/tcp public and it is `LIMIT` (rate-limited), stricter than the box's plain ALLOW. All else restricted to `tailscale0`.
- Port publishing: Evolution binds `127.0.0.1:8080` only; postgres/redis publish no host port. Service reachable across the mesh at the Tailscale address only.
- Redis requires auth (`NOAUTH` on unauthenticated probe).
- fail2ban active. Tailscale up, direct peer link to the primary box.
- Not obtained: Evolution instance counts (its Postgres role is not `postgres`; not pursued — same figures are available from the main DB).

## Gap 2 — Cloudflare dashboard state (was: never queried)

CLOSED via API token `cf-igrowfast-api` (Keychain; never placed on a server). Token verified by real account-scoped GET, not the verify endpoint.

- Account: 1. Zones: 3 active (`igrowfast.com` plus two unrelated).
- `igrowfast.com` DNS: 19 records / 15 hostnames — 1 A, 10 CNAME, 1 MX, 7 TXT. 10 proxied. **9 of 10 CNAMEs target `cfargotunnel`** — origin is not publicly addressable for web traffic.
- Mail auth records present: DMARC, BIMI, two DKIM selectors (ed25519 + RSA, dated 20260718).
- Tunnels: 5 exist on the account, all `healthy`, 4 connections each. **Ingress configurations read directly** (`/cfd_tunnel/{id}/configurations`) — only **3 carry igrowfast.com hostnames**:
  - `igf-frontend` → app, apex, www, webmail, jmap, mailadmin
  - `igrowfast-box` → api, studio
  - `igf-backup-agent` → backup-api
  The remaining two carry only the carved-out project's hostnames (or are locally managed) and are **excluded from the investor count**. Initial inference of "four serve iGrowFast" was wrong — the tools host's iGrowFast hostnames ride the `igf-frontend` tunnel, not the carved-out one.
- Access apps: 3 self-hosted, 24h sessions — Studio, mailadmin, webmail admin.
- R2 buckets: 6 total; 5 are iGrowFast (see Gap 3). One unrelated bucket excluded from all reporting per owner carve-out.

### Zone hardening findings (INTERNAL — not investor-pack material beyond the risk framing)

| Setting | Value | Note |
|---|---|---|
| `ssl` | `full` | not `full (strict)` — origin cert not validated |
| `min_tls_version` | **1.0** | floor should be raised to 1.2 |
| `always_use_https` | `off` | mitigated by `automatic_https_rewrites=on` and tunnel-only origin |
| `tls_1_3` | on | good |
| `security_level` | medium | default |

Response headers on `app.igrowfast.com`: `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`. **No HSTS header.**

## Gap 3 — Off-site backup object existence (was: never enumerated)

CLOSED. Listed read-only with per-bucket RO credentials.

| Bucket | Objects | Size |
|---|---:|---:|
| `igf-db-backups` | 34,052 | 2.678 GiB |
| `igf-config-backups` | 538 | 2.343 GiB |
| `igf-storage` (**live app store**, mirrored into db-backups) | 262 | 116.8 MiB |
| `whatsapp-media` (**live primary store, no backup**) | 4,946 | 2.60 GiB |
| `igf-logs` | 0 | 0 — **bucket is empty/unused** |

`igf-db-backups` prefixes: `pgbackrest/` 33,525 obj / 1.791 GiB · `logical/` 122 obj / 390.8 MiB · `logical-toolbox/` 120 obj / 388.8 MiB · `storage-mirror/` 274 obj / 128.7 MiB · `heartbeat/` 12.
`igf-config-backups` prefixes: `restic/` 317 obj / 2.342 GiB · `escrow/` 212 obj / 842.9 KiB · `heartbeat/` 9.

Objects written on the capture date confirm the pipelines are live, not historical.

### Backup heartbeat freshness — 21/21 lanes within declared budget, 3 hosts

Every lane publishes `{host, job, ts, iso, max_age_sec}`; `max_age_sec` is a declared staleness SLO, so freshness is machine-checkable rather than asserted.

Primary box (12): archive-monitor 0.0h/0.3h · escrow 16.7/30 · pgbackrest-full 40.1/216 · pgbackrest-incr 16.3/36 · pgbackrest-verify 60.4/192 · pgdump 16.9/26 · restic 14.4/26 · restic-maint 61.5/192 · restore-drill 562.7/960 · storage-mirror 15.5/30 · watchdog-tools 0.5/1.5 · watchdog-wa 0.5/1.5.
Tools host (5): db-pull 35.7/192 · restic 14.2/26 · restic-maint 61.3/192 · toolbox-dbdump 4.9/30 · watchdog-box 0.0/1.5.
WhatsApp node (4): restic 14.0/26 · restic-maint 61.0/192 · wa-dbdump 17.0/30 · wa-session 2.0/9.

Cross-host watchdogs are bidirectional: box watches tools + WA; tools watches box.

`restore-drill` last executed **2026-08-01** (562.7h ago, budget 960h). The 2026-08-23 dossier called restore proof "stale"; it is in fact within its own declared budget. No drill was run today.

Box systemd timers: 13 igf-* units covering pgdump, escrow, pgbackrest incr/full/verify, storage-mirror, restic + maint + deep, archive-monitor, watchdog, restore-drill.
WAL archiver: 1,862 archived, **0 failed**, last archive 2026-08-24 18:00 UTC.

### Still-open finding — WhatsApp media remains single-copy (CONFIRMED CURRENT)

The 2026-08-05 ledger finding is **not** closed. `whatsapp-media` holds 4,946 objects / 2.60 GiB and there is **no** corresponding mirror prefix in either backup bucket (`storage-mirror/` covers `igf-storage` only: 274 vs 262 objects, sizes align). Customer chat media has one copy. Recent commits (`2ab7c49`, `790f84e`) added an R2 media *janitor* — cleanup, not redundancy.

## Gap 4 (bonus) — Application mail delivery (was: unverified)

CLOSED from the database. `email_log`: 837 rows since 2026-06-20, latest 2026-08-23; 248 in the last 30 days.
Outcomes: sent 713 · **delivered 115** · error 6 · **bounced 3**. Delivered/bounced states prove the Stalwart webhook → `email_log` feedback loop works end to end.

## Re-measured live figures (supersede 2026-08-23 where they differ)

Primary box: uptime 4d 23h; disk 242 GiB at 7%; 13 containers all healthy/running.
Tools host: uptime 51d 3h; disk **79% used** (unchanged — capacity item stands). iGrowFast containers: frontend nginx + cloudflared, Stalwart mail + webmail, `igf-svc`, `igf-reacher`, docker-socket-proxy.

Database (`db.sh`, read-only):

| Metric | Value | vs 2026-08-23 |
|---|---:|---|
| PostgreSQL | 17.6 | same |
| Database size | 719 MB | 718 MB |
| Schemas (real, non-system) | **14** | dossier says 17 — **correct to 14** |
| Tables public / whatsapp | 77 / 25 | same |
| Functions public / whatsapp | 263 / 148 | same |
| SECURITY DEFINER public / whatsapp | 109 / 133 | same |
| Triggers public / whatsapp | 84 / 35 | same |
| RLS policies | 280 | same |
| RLS-enabled relations | 131 | same |
| RLS-disabled tables in public/whatsapp/storage | **0** | same |
| pg_cron jobs (all active) | 30 | same |
| Extensions | 12 | same |
| Indexes (public) | 361 | new |
| Views (public) / matviews | 2 / 0 | new |
| Login roles | 10 | new |

### Material correction — `anon` grants

2026-08-23 chapter 11 says the anonymous role "retains 27 table grants" needing review. Measured today:

- `anon` grants in `public`: **0**. In `whatsapp`: **0**.
- All 46 remaining grants are in Supabase platform schemas only: `storage` (9 tables), `realtime` (3), `supabase_functions` (2).

The application surface is fully revoked for `anon`. The dossier understates the posture and must be corrected.

Publications: `supabase_realtime` = 0 tables (legacy CDC path retired) · `supabase_realtime_messages_publication` = 7 (broadcast path live). Confirms the postgres_changes → broadcast migration.

## Repository figures (HEAD `790f84e`, unchanged — 2026-08-23 counts re-verified as reproducible)

456 tracked `src` files (193,198 lines) · 94 pages · 191 components · 106 declared route elements · 341 migrations (30,892 lines) · 38 non-shared edge functions (13,971 lines across 40 files) · 279 tracked `ops` files (36,347 lines) · WhatsApp worker 43 tracked TS files (15,198 lines) · 74 tracked docs · 856 commits · 5 contributors · first commit 2025-01-01, last 2026-08-05.

Counting method (matches 2026-08-23): `git ls-files` per directory; routes = `path=` occurrences in `src/App.tsx`.

## Public endpoint smoke (read-only GET/HEAD)

`app.igrowfast.com` 200 · `igrowfast.com` 200 · `www` 200 · `studio` 302 (Cloudflare Access redirect — gating confirmed live) · `email` 200 · `api.igrowfast.com/auth/v1/health` **401 "No API key found"** — gateway rejects unauthenticated calls as designed. All served through Cloudflare; TLS verified on every request.

## Remaining unverified after this pass

- Fresh restore execution (last drill 2026-08-01; running one is a state-changing action outside this read-only scope).
- Secret rotation status.
- Independent external uptime monitoring / measured availability history.
- Evolution session-level send/receive success (would require touching customer conversations).

## Owner carve-outs applied

- Hermes agents on the tools host: excluded from all investor material. Already absent from the 2026-08-23 dossier — verified, nothing to strip.
- `aphrodite-media` R2 bucket: excluded (owner: "only the aphrodite dossier on R2 not the whole R2"). iGrowFast's own R2 buckets remain in scope.
- Cross-project tunnel names ("hermes", "olympus-toolbox") not quoted verbatim in investor material.

## Post-verification corrections (same session)

Two errors were caught by review after the first draft and fixed before delivery:

1. **Off-site headline conflated bucket sets.** A draft figure of "roughly 5.8 GB across 39,000+ objects in five buckets" mixed the two backup stores' size with an object count that only reached 39,000 by including `whatsapp-media` — the very store the P1 says has no backup. Counting a single-copy primary store as recovery material also contradicted the risk register two chapters later. Corrected everywhere to **34,590 objects / 5.02 GiB across the two dedicated backup stores** (`igf-db-backups` 34,052 / 2.678 GiB + `igf-config-backups` 538 / 2.343 GiB), with `whatsapp-media` and `igf-storage` described as primary stores.
2. **Tunnel count was the account total.** Corrected from 5 to **3** after reading each tunnel's ingress hostnames; see above.
