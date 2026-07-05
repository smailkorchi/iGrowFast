# WA Mancer Recon — 09: The Live VPS (production box, read-only)

Recon date: 2026-07-05. Source: **live** SSH into the production box `wa-mancer` (`wamadmin@158.220.108.12`, hostname `wa-mancer-prod-01`), plus baseline probes of the two iGrowFast merge-target boxes `igf-whatsapp` (213.199.54.67) and `igf-tools` (37.60.250.211). All commands read-only; no state changed on any box. Secret values were never printed — names/paths/shapes only.

This chapter is the *deployed reality* behind `01-design-docs.md`'s ACCESS.md and `08-infra-deployment.md`'s infra-as-code. Where the docs describe intent and the box shows something else, the box wins and the delta is called out.

**Operational warning up front:** this box rate-limits SSH hard — `sshd MaxStartups 10:30:100` **and** UFW `22/tcp LIMIT`. Rapid parallel SSH connects get `Connection refused` (tripped twice during recon, self-recovered). Any automation against it must serialize/throttle connections.

---

## 0. One-screen state

- **5 Docker containers, one compose stack** (`name: wa-mancer`), all healthy: `caddy` (only public one), `evolution-api`, `postgres` (Evolution's own), `redis`, `worker`. Managed by `docker compose`, **not** a systemd wrapper.
- **Alive but idle.** Uptime 18 days. Evolution + worker last did real work 2026-07-03 ~23:00 (the single "kk" instance churned to `disconnected/close` and never reconnected — matches the DB dormancy verdict in `02`). Host load idle, RAM 1 GB/11 GB used, disk 12%.
- **Everything persists as host bind-mounts under `/opt/wa-mancer/`** — no named Docker volumes. Evolution sessions, Postgres data, Redis AOF, Caddy certs, the static SPA, and plaintext secrets all live on `/dev/sda1`.
- **Two off-Docker systemd sidecars** ship logs/metrics into Supabase (`wa-log-shipper`, `wa-metrics-collector`).
- **Three real security/ops gaps** (details below): the UFW "Cloudflare-only 80/443" rule is bypassed by Docker port-publishing; there is **no offsite backup** (restic installed but unconfigured; only a 2-table local Evolution-creds dump runs); and the documented CF-UFW auto-refresh script does not exist.

---

## 1. Containers & images

| Container | Image:tag | State | Started | Restarts | Host ports |
|---|---|---|---|---|---|
| wa-mancer-caddy | `wa-mancer/caddy:2.10.0-cf` | Up 2 wk (healthy) | — | — | 0.0.0.0:80, 0.0.0.0:443 tcp+udp (HTTP/3); 2019 internal |
| wa-mancer-evolution | `wa-mancer/evolution-api:2.3.7` | Up 2 wk (healthy) | 2026-06-16 | 0 | 8080 internal only |
| wa-mancer-worker | `wa-mancer/worker:latest` | Up 9 d (healthy) | 2026-06-25 | **77** | 8090 internal only |
| wa-mancer-postgres | `postgres:17-alpine` | Up 2 wk (healthy) | — | — | 5432 internal only |
| wa-mancer-redis | `redis:7-alpine` | Up 2 wk (healthy) | — | — | 6379 internal only |

- **Worker RestartCount 77** despite 9 days stable now — heavy crash-looping earlier in the build cycle, settled 2026-06-25. Evolution RestartCount 0.
- 6 images, 6.3 GB total. `wa-mancer/*` (worker 266 MB, evolution 1.84 GB, caddy 128 MB) are **built on-box, no registry** — the `wa-mancer/*` namespace exists only on this host. `postgres:17-alpine`/`redis:7-alpine` are official bases. One unused `hello-world` leftover.
- Only Caddy publishes host ports; every other service port is Docker-network-internal.

## 2. Networks & volumes

- **No named volumes.** All state is bind-mounted from `/opt/wa-mancer/` (see §8).
- Two app bridges: **`wa-mancer-edge`** (10.30.1.0/24, only caddy) and **`wa-mancer-internal`** (10.30.0.0/24, all five). Internal DNS is by container name (`wa-mancer-evolution:8080`, `wa-mancer-worker:8090`, etc.). `internal: false` — the internal net is **not** egress-isolated (compose comment: flip to true "once outbound allowlist enforced" — not done).
- **Docker Swarm is active (1 node, 0 services)** — vestigial. It contributes nothing but the `ingress`/`docker_gwbridge` networks and the exposed 2377/7946 listeners (UFW-blocked at host level). The stack is entirely compose-managed.

## 3. Compose (deployed vs repo)

- Deployed: `/opt/wa-mancer/stack/docker-compose.yml` (273 lines, mtime 2026-06-08, 3 `.bak` copies alongside). Matches `infra/stack/docker-compose.yml` in the WA Mancer checkout **functionally**. Only real drift:
  1. **`CONFIG_SESSION_PHONE_CLIENT`: deployed `"macOS"` vs repo `""`** (the label shown in the phone's Linked-Devices list).
  2. A stale inline comment on `CACHE_REDIS_SAVE_INSTANCES` (value identical `false` in both — comment-only drift).
- Everything else matches: services, image tags, ports, healthchecks, `cap_drop:[ALL]`, `no-new-privileges`, read-only rootfs (caddy/worker), depends_on health-gating, journald logging, file-based `secrets:`.

## 4. Evolution API

- **v2.3.7, built from source** (`evolution-foundation/evolution-api.git#2.3.7`, source clone kept at `/opt/wa-mancer/stack/evolution-src`). **Node 24.16.0.** Healthy, RestartCount 0, up since 2026-06-16. Healthcheck `wget 127.0.0.1:8080/`.
- Port 8080 internal only; reached via Caddy `api.welcomdeal.ma` and internal DNS. Manager UI at `/manager` (behind Cloudflare + global API key; no Caddy path block).
- Runtime config (secrets masked): `SERVER_URL=https://api.welcomdeal.ma`, `DATABASE_PROVIDER=postgresql` → internal postgres, global `AUTHENTICATION_API_KEY` set, **`CACHE_REDIS_ENABLED=false` + `CACHE_LOCAL_ENABLED=true`** (Redis instance-cache deliberately off — the Baileys 440 double-socket war; in-process LRU instead), `CACHE_REDIS_SAVE_INSTANCES=false`, all 9 `DATABASE_SAVE_DATA_*=true`, `DEL_INSTANCE=false`, `DEL_TEMP_INSTANCES=true`, `CONFIG_SESSION_PHONE_CLIENT=macOS`, `LOG_LEVEL=ERROR`, `TELEMETRY=false`, `TZ=America/Sao_Paulo` (image default, unchanged).
- **Session store on disk:** `/opt/wa-mancer/data/evolution` = 112 KB, **5 Baileys instance dirs but only 1 `Instance` row in Postgres** → 4 stale/orphaned pairings never reaped (`DEL_INSTANCE=false`).
- Recent logs: last errors 2026-07-03 ~19:53–22:59 — Prisma `P2025` "no record for update" on `instance.update()` and a `WAMonitoringService` delete-from-memory TypeError during QR-limit/warming churn; **quiet since Jul 3**.

## 5. Evolution's Postgres (separate from Supabase)

- **PostgreSQL 17.10** (`postgres:17-alpine`), port 5432 internal. DB `evolution` (owner `evolution`, 31 MB) in schema **`evolution_api`** (37 Prisma tables), `PGDATA=/var/lib/postgresql/data/pgdata`, on-disk 246 MB incl. WAL.
- Live rows: `Message` 887 (14 MB), `Contact` 347, `IsOnWhatsapp` 296, `Chat` 188, `MessageUpdate` 62; `Instance`/`Session`/`Setting`/`Webhook` = 1 each. **Every integration table = 0** (Typebot, OpenaiBot, Chatwoot, Dify, N8n, Flowise, Evoai, Rabbitmq, Sqs, Nats, Kafka, Pusher, Websocket, Proxy, Label, Media, Template) — no chatbot/queue integrations configured.
- This is Evolution's own Baileys/creds/history store — the "no re-scan after reboot" backing. **It is not the app database and does not merge into iGrowFast Supabase.**

## 6. Redis

- **Redis 7.4.9** (`redis:7-alpine`), 6379 internal. `--requirepass … --maxmemory-policy noeviction --save 60 1 --appendonly yes --appendfsync everysec`. AOF + RDB both OK.
- **Keyspace EMPTY (DBSIZE 0), 1 MB used.** Because Evolution's Redis cache is disabled and nothing else uses it, Redis is **effectively vestigial** in the current config. On-disk 13 MB (AOF baseline).

## 7. Worker deployment

- **Container** (`wa-mancer/worker:latest`, built from `./worker` via `docker compose build` — source rsynced to `/opt/wa-mancer/stack/worker/`, manual, no registry). `@wa-mancer/worker` **v0.1.0**, **Node 22.22.3** (note: different major from Evolution's Node 24). Hardened: read-only rootfs, cap_drop ALL, no-new-privileges, tmpfs /tmp, restart unless-stopped, `wget 127.0.0.1:8090/healthz`. Fully stateless (no mounts).
- Connections (masked): **Supabase** `xlhlezgpgrypdijynmqr.supabase.co` + service-role key; **pooler** `DATABASE_URL=…@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` — **session mode confirmed** (port 5432), the LISTEN/NOTIFY-critical setting; **Evolution** `http://wa-mancer-evolution:8080` + global key; **R2** endpoint + bucket `wamancer-media` + access-key-id present (secret masked). `WORKER_ID=wa-mancer-worker-1`, `HEARTBEAT_INTERVAL_MS=5000`, `WEBHOOK_PORT=8090`.
- Recent logs: last activity 2026-07-03 ~22:55–23:00 reconciling instance `f3be9c2c…` (`kk-o5k36wmn`) through connecting/warming/qrcode churn → `reconciled … to:disconnected evo_state:close` at 22:59:59, then quiet.

## 8. Ports, firewall & the exposure gap

Host listeners (`ss -tlnp`): `0.0.0.0:80/443` (+443/udp) → Caddy; `0.0.0.0:22` → sshd; `127.0.0.1:9323` dockerd metrics; `127.0.0.1:25` postfix; resolved on loopback; **`*:2377` + `*:7946`** Docker Swarm (all-interfaces, UFW-blocked). Service ports 8080/8090/5432/6379/2019 are Docker-internal only.

UFW active (deny incoming / allow outgoing / deny routed):
- `22/tcp` ALLOW from `41.143.83.106` (admin) + `LIMIT` from anywhere.
- `80,443/tcp` ALLOW from 15 Cloudflare v4 CIDRs + 6 v6 ranges (the 7th v6 `2c0f:f248::/32` is **missing**).

**CRITICAL — UFW does not actually filter 80/443.** Caddy publishes 80/443 via Docker; Docker's DNAT rules run before UFW's INPUT chain and `/etc/ufw/after.rules` has **zero** DOCKER-integration lines (`DOCKER-USER` chain empty). So the "Cloudflare-only" allow-rules are bypassed at the network layer — **proven**: a non-CF scanner (`20.65.144.90`, Azure zgrab) reached Caddy directly on the raw IP and got a 308. The only working origin protection is app-layer: the Caddyfile `@no_cf_header → 421` guard, and it exists **only on `api.welcomdeal.ma`** — not on `wa.welcomdeal.ma` and not on the raw-IP/default handler. SSH (host-bound) *does* honor UFW.

**CF-UFW auto-refresh is a myth:** `/usr/local/sbin/refresh-cloudflare-ufw.sh` and `/etc/cron.d/refresh-cloudflare-ufw` **do not exist**. The CF ranges are static/hand-applied and will silently drift.

## 9. fail2ban / auditd / SSH hardening

- **fail2ban** active, `sshd` jail, banaction nftables: 9,563 total failures, 220 total bans, 2 currently banned. `ignoreip` whitelists the admin ISP block `41.143.0.0/16`. Working.
- **auditd** active, custom `99-wa-mancer.rules` watching identity files, sudoers, sshd config, auth/audit logs, kernel-module tools, and privileged exec (auid≥1000). Solid.
- **sshd** (effective): key-only, root login off, `AllowUsers wamadmin`, MaxAuthTries 3, MaxStartups 10:30:100, LoginGraceTime 30. Single authorized key (`wa-mancer-bootstrap-20260517`, ed25519).
- **`wamadmin ALL=(ALL) NOPASSWD:ALL`** — the documented "reverts once stable" is **not done**; still NOPASSWD.

## 10. systemd, cron & backups

- App systemd services (host, not containers): **`wa-log-shipper.service`** (`log-shipper/shipper.mjs`, journald → Supabase `ingest_system_logs`, env `log-shipper.env`, MemoryMax 64M, hardened) and **`wa-metrics-collector.service`** (`monitor-collector/collector.mjs`, host metrics → Supabase, MemoryMax 80M). Both `Restart=always`, enabled. No systemd unit wraps the container stack.
- Timers: 17, all stock Ubuntu. **No backup timer, no metrics timer, no CF-refresh timer.**
- Cron: one app entry — `/etc/cron.d/wa-evolution-session-backup`: `0 */6 * * *` → `backup-evolution-session.sh`.
- **Backups — actual truth:** restic 0.18.1 is installed but **wired to nothing** (no repo, no `RESTIC_REPOSITORY`, no timer/cron, no R2 target). The only backup running is the 6-hourly `backup-evolution-session.sh`, which `pg_dump`s exactly two tables (`evolution_api."Session"` + `"Instance"`, i.e. Baileys creds + metadata), gzips **local-only** to `/opt/wa-mancer/backups/`, rotates to 60 files (~15 days), ~1.9 KB each. **Nowhere-backed-up:** the full Evolution Postgres, the Evolution session volume, Redis, Caddy certs, and the plaintext secrets. Posture = "session-creds survival only, on the same disk."
- Unattended-upgrades enabled, but **automatic-reboot disabled** → the box is a kernel behind (`-124` vs `-134` on the target boxes); patches land, reboots are manual.

## 11. Caddy / TLS

- Caddyfile (bind-mount RO): global `email admin@welcomdeal.ma`, h1/h2/h3. Sites: `api.welcomdeal.ma` → `reverse_proxy evolution-api:8080` (600 s timeouts, `CF-Connecting-IP`-gated → 421 otherwise, sets X-Real-IP/X-Forwarded-For); `wa.welcomdeal.ma` → static SPA `/srv/wa-mancer` (bind mount `data/frontend`, SPA fallback, immutable asset caching, **no CF guard**). `media.welcomdeal.ma` appears only in the SPA CSP (served via CF/R2, not this Caddy).
- TLS: **Let's Encrypt E8 (ECDSA)** certs obtained by **Cloudflare DNS-01** (CA is LE, not CF), TLS 1.3 only, stored under `data/caddy/data`. Live certs for `wa.`/`api.welcomdeal.ma`, both `notAfter Aug 15 2026` (~41 d), auto-renewed.
- Security headers: HSTS 180d, X-Frame-Options DENY, CSP frame-ancestors none, nosniff, no-referrer, COOP/CORP same-origin, strict Permissions-Policy, Server/X-Powered-By stripped; the SPA adds a full app CSP referencing `media.welcomdeal.ma` + `*.supabase.co`. **The product runs under `welcomdeal.ma`, not igrowfast.com.**

## 12. Secrets at rest

- `/opt/wa-mancer/secrets/` (0700 root), all files **0600 root:root, plaintext**: `cloudflare_api_token`, `cloudflare.env`, `evolution_api_key`, `evolution_database_uri`, `evolution.env`, `evolution_redis_uri`, `log-shipper.env`, `postgres_password`, `redis_password`, `worker.env` (+ a `worker.env.bak-speedtest` leftover). Values not read.
- **No sops/age store on the box** — despite `sops` installed, no `*.sops.*`/`*.age`/age key found under `/opt`, `/root`, `/etc`. Encryption is source-side (git repo) only; the host holds decrypted plaintext.

## 13. Merge-target boxes — current baseline

### igf-whatsapp (213.199.54.67) — planned Evolution host
- Ubuntu 24.04.4, kernel `6.8.0-134`, RAM **47 GB** (758 MB used), disk 242 GB (**1% used**), TZ Europe/Berlin, uptime ~9.5 h. Hostname `vmi3418398`.
- **Docker NOT installed.** No containers, no Evolution, nothing app-facing. Only listeners: sshd + resolved.
- **UFW active** but only `22/tcp ALLOW Anywhere` — **SSH open to the whole internet** (no admin-IP restriction, no CF gate). **fail2ban present + running** (sshd jail, 7 total bans). sshd key-only root, password auth off, single key `root@igrowfast-whatsapp`. Unattended-upgrades on.
- **Corrects the memory note** (`ufw/fail2ban/Evolution/backups NOT yet done`): UFW + fail2ban **are** configured now; Docker + Evolution are **still absent** (Docker not even installed). Starting point = hardened-but-empty host, zero container runtime.

### igf-tools (37.60.250.211) — toolbox (Redis/support tools)
- Ubuntu 24.04.4, kernel `6.8.0-134`, RAM 47 GB, disk 242 GB (2% used), TZ Europe/Berlin, uptime ~11.7 h. Hostname `vmi3414204`.
- **Docker installed** (docker-ce 29.6.1, compose 5.3.0). Exactly **one container: `docker-socket-proxy`** (`tecnativa/docker-socket-proxy:latest`, bound `127.0.0.1:2375`). Its compose file wasn't found under `/opt`/`/root`/`/srv` (started elsewhere or via `docker run`).
- **Redis NOT installed** (no package, no container) — the planned Redis is not deployed yet.
- **UFW active**, only `22/tcp ALLOW Anywhere` — SSH open to internet. **fail2ban present + running** (8 total bans). sshd key-only root, single key `root@igrowfast-toolbox`.
- Matches memory ("Docker+socket-proxy, no app services yet"). Starting point = Docker host with only the socket-proxy, no Redis/app services.

---

## 14. Surprises / merge hazards (VPS layer)

1. **The whole runtime assumes one box + a private Docker network.** Every hop (`worker → evolution:8080`, `evolution → worker:8090`, `worker → postgres:5432`, `evolution → postgres/redis`) is container-name DNS on `wa-mancer-internal`. Splitting Evolution → `igf-whatsapp`, worker → main box, Redis → `igf-tools` breaks all of it. **Recommendation: co-locate Evolution + its Postgres + the worker together on `igf-whatsapp`** so the sensitive worker↔Evolution and worker↔Evolution-Postgres hops stay on one box; only worker → iGrowFast Supabase (HTTPS + session-mode pooler) and the inbound webhook cross the network. Otherwise the plaintext per-instance-token and message hops go over the wire (Evolution 2.3.7 has no TLS and no webhook HMAC — only the static `x-wa-mancer-secret` header).
2. **Evolution's Postgres is a second, separate database that must travel intact.** It holds Baileys creds/sessions + WA message history in schema `evolution_api` (37 Prisma tables). It does **not** merge into iGrowFast Supabase — only the *app* inbox schema does (that's chapters 02/07). Moving Evolution means moving this Postgres + the `/opt/wa-mancer/data/evolution` session volume, or re-pairing every number from scratch.
3. **Redis is currently dead weight.** It's disabled in Evolution (the 440-war fix) and holds 0 keys. Standing up Redis on `igf-tools` for this stack buys nothing unless a component actually needs it — don't provision it just because the compose file lists it. (Re-enabling Evolution's Redis cache is the known ban-risk foot-gun.)
4. **The UFW/Docker exposure bug will port if the pattern ports.** On any box that publishes container ports (Caddy/Evolution), Docker bypasses UFW. On the new WhatsApp box, Evolution's port must **not** be published to `0.0.0.0`; keep it internal and front it, and add real `DOCKER-USER` rules or bind published ports to specific interfaces. Today `igf-whatsapp` has SSH open to the whole internet — tighten to admin-IP + LIMIT like wa-mancer before exposing anything.
5. **There is effectively no backup today.** restic is installed but unconfigured; only a 2-table, local-only, 15-day Evolution-creds dump runs. The merge must define real backups (Evolution Postgres + session volume offsite; iGrowFast Supabase already has its own backup program per the box's DR runbook). Do not inherit "session-creds survival only."
6. **Deploy is manual and registry-less** (rsync source + `docker compose build` on-box; SPA rsynced; secrets decrypted source-side to plaintext `0600` files). This works for one box but is fragile across three. Decide a deploy model (build-and-ship images to a registry, or keep on-box builds) before wiring three hosts.
7. **welcomdeal.ma is the live product domain** (api/wa/media). Every cert, Caddy vhost, `SERVER_URL`, and SPA CSP references it. The merge re-homes the UI into igrowfast.com and Evolution behind an iGrowFast host — every domain reference changes, and the Cloudflare-DNS-01 TLS model conflicts with iGrowFast's CF-Tunnel posture (the WhatsApp box's "no Cloudflare for WhatsApp" decision means DNS-01 + the `@no_cf_header` gate + `rotate-cf-token.sh` all become obsolete; TLS/ingress must be re-decided).
8. **Two host systemd sidecars ship logs/metrics into Supabase via service_role** and the worker's platform-log pull hits the Supabase **cloud** Management API. iGrowFast runs **self-hosted** Supabase — the Management-API path silently fails, and the whole telemetry pipeline (which is 97% of the WA Mancer DB, per `02`) should be dropped or redesigned against iGrowFast's own monitoring, not ported.
9. **wa-mancer is a kernel behind with NOPASSWD sudo and no auto-reboot.** Not a merge blocker, but when the box is decommissioned/repurposed, don't carry these forward: enforce auto-reboot or a patch cadence, and drop `NOPASSWD:ALL` on the merged hosts.
10. **Docker Swarm is active-but-vestigial on wa-mancer.** If the box is reused, `docker swarm leave --force` removes the pointless 2377/7946 exposure. Don't replicate swarm on the new hosts — the stack is pure compose.
