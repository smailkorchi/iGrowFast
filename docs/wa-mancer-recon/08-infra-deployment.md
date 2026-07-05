# WA Mancer Recon — 08: Infrastructure, Deployment & Secrets

Recon date: 2026-07-05. Source: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/` (read-only). Files read in full: `infra/stack/docker-compose.yml`, `infra/stack/caddy/{Caddyfile,Dockerfile}`, `infra/stack/worker.env.example`, `infra/stack/README.md`, `infra/log-shipper/{shipper.mjs,wa-log-shipper.service}`, `infra/monitor-collector/{collector.mjs,wa-metrics-collector.service}`, `secrets/README.md`, `.sops.yaml`, the 7 sealed `secrets/*.sops[.env]` (metadata only — never decrypted), `scripts/{rotate-cf-token.sh,gen-emoji.mjs}`, `ci/cache-gate.test.ts`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `.env.example`, `.gitignore`, `worker/{Dockerfile,package.json}`, and `worker/src/{config.ts,r2MetricsPull.ts,index.ts}` for the R2 surface.

One line: WA Mancer ships as a single-box Docker Compose stack (Caddy + Evolution v2.3.7 built-from-source + Evolution's OWN Postgres 17 + Redis 7 + Node worker) behind Cloudflare DNS-01 TLS on `*.welcomdeal.ma`, with sops+age single-recipient secrets streamed to `/opt/wa-mancer/secrets/`, media on Cloudflare R2, and two host-side systemd `.mjs` collectors pushing logs+metrics back into Supabase RPCs — every one of these axes has to be re-homed for the iGrowFast merge.

Convention: **FACT** = literal from the file. **DRIFT** = file-vs-file contradiction (trust compose/code over README). **GAP** = required-but-undocumented. **UNVERIFIED** = not determinable from the repo.

---

## 0. Source-box context (from sibling `01`/`ACCESS.md`, for orientation)

- **Single host.** The entire stack runs on one Contabo VPS `158.220.108.12` (hostname `wa-mancer-prod-01`, Ubuntu 24.04, 6 vCPU / 11 GiB). Everything below is co-located on that one box and glued by two local Docker bridge networks. The iGrowFast merge fans this single box across three boxes (WhatsApp `213.199.54.67`, toolbox `37.60.250.211`, main `207.180.232.102`) — the shared-docker-network assumption dies at that boundary (§8).
- **Repo→host layout.** Repo `infra/stack/` rsyncs to `/opt/wa-mancer/stack/`; runtime data lives under `/opt/wa-mancer/data/`; runtime secrets under `/opt/wa-mancer/secrets/`; the two systemd collectors live at `/opt/wa-mancer/{log-shipper,monitor-collector}/`.

---

## 1. Full service topology (`infra/stack/docker-compose.yml`, dissected)

Compose project **`name: wa-mancer`**. Five services (the header comment + README list only four — they omit `worker`; DRIFT). All use `restart: unless-stopped`, `security_opt: no-new-privileges:true`, `cap_drop: [ALL]`, and `logging.driver: journald` tagged `{{.Name}}`.

### 1.1 `caddy` — TLS reverse proxy (the only public service)

- **Image.** Local build `wa-mancer/caddy:2.10.0-cf` from `./caddy` (build arg `CADDY_VERSION=2.10.0`). Not a registry pull — built on the box.
- **Ports (published to host).** `80:80`, `443:443`, `443:443/udp` (HTTP/3). The ONLY container that binds host ports.
- **Hardening.** `read_only: true` + `tmpfs: /tmp size=16m`; `cap_drop: [ALL]` then `cap_add: [NET_BIND_SERVICE]` (so it can bind :80/:443 unprivileged).
- **Secret handoff.** `environment.CLOUDFLARE_API_TOKEN_FILE=/run/secrets/cloudflare_api_token`, but Caddy reads env vars not file paths, so the `entrypoint` is a shim: `export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`.
- **Volumes.** `./caddy/Caddyfile:/etc/caddy/Caddyfile:ro`; `/opt/wa-mancer/data/caddy/data:/data` (ACME certs/keys — persistent); `/opt/wa-mancer/data/caddy/config:/config`; `/opt/wa-mancer/data/frontend:/srv/wa-mancer:ro` (the SPA static root, bind-mounted read-only).
- **Networks.** `edge` + `internal` (needs `internal` to reach `evolution-api`).
- **Ordering.** `depends_on: evolution-api: condition: service_healthy`.
- **Healthcheck.** `wget -qO- http://127.0.0.1:2019/config/` (Caddy admin API); 30s/5s/3.

### 1.2 `evolution-api` — WhatsApp gateway (Baileys)

- **Image.** Local build `wa-mancer/evolution-api:2.3.7` from **remote git context** `https://github.com/evolution-foundation/evolution-api.git#2.3.7`. FACT: built from source at tag `2.3.7` (comment: Docker Hub stopped publishing post-2.2.3 after the org migrated to `evolution-foundation/`; 2.3.7 carries the 2.3.3 path-traversal CVE patch). **DRIFT:** `README.md` claims image `atendai/evolution-api:v2.3.7` — trust compose (source build).
- **Config split.** `env_file: /opt/wa-mancer/secrets/evolution.env` (combined 0600 file — Evolution does NOT honor the `*_FILE` convention, so its secrets ride in an env_file, NOT compose `secrets:`). Inline `environment:` block sets everything non-secret:
  - `SERVER_URL: https://api.welcomdeal.ma`, `DATABASE_PROVIDER: postgresql`.
  - **Persistence (belt-and-suspenders).** All `DATABASE_SAVE_DATA_*: true` — `INSTANCE` (Baileys creds→Postgres), `NEW_MESSAGE`, `MESSAGE_UPDATE`, `CONTACTS`, `CHATS`, `LABELS`, `HISTORIC`, `IS_ON_WHATSAPP` (+ `_DAYS: 7`).
  - **Redis cache DISABLED.** `CACHE_REDIS_ENABLED: false`, `CACHE_REDIS_SAVE_INSTANCES: false` (load-bearing — see §2); `CACHE_LOCAL_ENABLED: true` (in-process LRU replaces it). `CACHE_REDIS_PREFIX_KEY: wamancer`, `TTL: 604800`.
  - **Lifecycle.** `DEL_INSTANCE: false` (never auto-delete on disconnect), `DEL_TEMP_INSTANCES: true` (sweep never-paired only).
  - **Cosmetic/session.** `CONFIG_SESSION_PHONE_CLIENT: ""`, `CONFIG_SESSION_PHONE_NAME: Chrome` (global for every number — v2.x has no per-instance override), `QRCODE_LIMIT: 30`, `QRCODE_COLOR: #141413`, `LANGUAGE: en`.
  - **Quiet/secure.** `WEBHOOK_GLOBAL_ENABLED: false`, `LOG_LEVEL: ERROR`, `LOG_BAILEYS: error`, `TELEMETRY: false`, `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: false`.
- **Volume.** `/opt/wa-mancer/data/evolution:/evolution/instances` (Baileys session files on disk — losing this = re-pair every number).
- **Network.** `internal` only (NOT published; reached via Caddy reverse-proxy or the worker's internal DNS name).
- **Ordering.** `depends_on: postgres: healthy` + `redis: healthy`.
- **Healthcheck.** `wget -qO- http://127.0.0.1:8080/`; 30s/5s/5, `start_period: 30s`.

### 1.3 `postgres` — Evolution's private store (NOT Supabase)

- **Image.** `postgres:17-alpine`.
- **Env.** `POSTGRES_USER: evolution`, `POSTGRES_DB: evolution`, `POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password`, `PGDATA: /var/lib/postgresql/data/pgdata`.
- **Caps.** `cap_drop: [ALL]` then `cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID]` (the minimum initdb needs).
- **Secret.** compose `secrets: [postgres_password]`.
- **Volume.** `/opt/wa-mancer/data/postgres:/var/lib/postgresql/data`.
- **Network.** `internal` only. **Healthcheck.** `pg_isready -U evolution -d evolution`.

### 1.4 `worker` — outbound dispatcher + Evolution webhook receiver

- **Image.** Local build `wa-mancer/worker:latest` from `./worker` (rsynced into `/opt/wa-mancer/stack/worker/`; §4.2).
- **Hardening.** `read_only: true` + `tmpfs: /tmp size=16m`.
- **Config split.** `env_file: /opt/wa-mancer/secrets/worker.env` (0600) for secrets; inline `environment:` for topology: `EVOLUTION_API_URL: http://wa-mancer-evolution:8080` (internal DNS, never public), `WEBHOOK_PORT: 8090`, `HOSTNAME: wa-mancer-worker`.
- **Webhook port 8090 is NOT published** to host or Caddy — Evolution POSTs webhooks to the worker over the internal bridge only.
- **Network.** `internal` only. **Ordering.** `depends_on: evolution-api: healthy`.
- **Healthcheck.** `wget -qO- http://127.0.0.1:8090/healthz`; 15s/5s/3, `start_period: 10s`. (The worker's own Dockerfile ships NO `HEALTHCHECK` — the compose one is authoritative; a comment there says the real liveness signal is the `worker_health` heartbeat table.)

### 1.5 `redis` — Evolution cache (AOF-persisted, but instance-cache off)

- **Image.** `redis:7-alpine`.
- **Command (single-line, deliberate).** `sh -c 'REDIS_PASSWORD="$(cat /run/secrets/redis_password)"; exec redis-server --requirepass "$REDIS_PASSWORD" --maxmemory-policy noeviction --save 60 1 --appendonly yes --appendfsync everysec'`. Comment warns a prior folded `command: >` block newline-terminated `exec redis-server` before its flags, silently starting Redis with defaults (no password/unlimited) — hence the one-liner.
- **Secret.** compose `secrets: [redis_password]`. **Volume.** `/opt/wa-mancer/data/redis:/data` (AOF).
- **Network.** `internal`. **Healthcheck.** `redis-cli -a "$(cat /run/secrets/redis_password)" ping | grep -q PONG`.

### 1.6 Networks, secrets block, DNS, persistence — summary

```yaml
networks:
  edge:      { name: wa-mancer-edge,     driver: bridge }
  internal:  { name: wa-mancer-internal, driver: bridge, internal: false }  # "true once outbound allowlist enforced"

secrets:   # file-based; mounted /run/secrets/<name> (0400 in-container)
  cloudflare_api_token: { file: /opt/wa-mancer/secrets/cloudflare_api_token }
  postgres_password:    { file: /opt/wa-mancer/secrets/postgres_password }
  redis_password:       { file: /opt/wa-mancer/secrets/redis_password }
```

- **Inter-service DNS (docker bridge).** `evolution-api` / `wa-mancer-evolution` :8080 (reached by Caddy + worker), `postgres` :5432, `redis` :6379 (reached by Evolution via its env_file URIs). Container names are aliases on the same network.
- **Health/boot order.** `postgres` + `redis` healthy → `evolution-api` healthy → `caddy` and `worker` start. Single dependency chain rooted at the two datastores.
- **Persistence map (all under `/opt/wa-mancer/data/`).** `postgres/` (Evolution SQL), `redis/` (AOF), `evolution/` (Baileys sessions), `caddy/{data,config}` (ACME material), `frontend/` (rsynced SPA `dist`).
- **Two secret mechanisms in one file.** Compose `secrets:` (file→`/run/secrets`, 0400) for caddy/postgres/redis; `env_file` combined 0600 files for evolution + worker (because neither honors `*_FILE`). Merge must preserve this split.

---

## 2. Evolution's own datastores (confirmed: separate from Supabase)

- **FACT — two independent Postgres.** Evolution's `postgres` service (db `evolution`) is its private operational store; the app's data lives in the Supabase project (`xlhlezgpgrypdijynmqr.supabase.co`, per `index.html` + worker `worker.env`). The compose header comment states it outright: *"postgres — backing store for Evolution (NOT for the app — that's Supabase)."* Evolution's Postgres holds Baileys session creds + messages/contacts/chats/labels/history (all `DATABASE_SAVE_*: true`).
- **FACT — Evolution's Redis runs but is deliberately inert for instance state.** `CACHE_REDIS_ENABLED: false` + `CACHE_REDIS_SAVE_INSTANCES: false`. The inline comment (dated 2026-06-05) documents *why*: when Redis auth started working (commit `f50ca9f` gave it `requirepass`), Evolution's Redis instance-cache activated and double-managed each instance's socket alongside Postgres → a second socket per instance → Baileys `conflict/replaced` (440) reconnect war on every instance = **ban risk**. Postgres (`DATABASE_SAVE_DATA_INSTANCE`) is the single source of instance truth; Redis stays out of instance management. Redis still runs (AOF `save 60 1` + `appendonly`) and serves the generic cache, but `CACHE_LOCAL_ENABLED: true` (in-process LRU) is what Evolution actually uses.
- **Connection wiring.** Evolution reaches its stores via the combined `evolution.env` (not in repo), whose values match the sealed templates: `evolution_database_uri = postgresql://evolution:<pw>@postgres:5432/evolution` and `evolution_redis_uri = redis://default:<pw>@redis:6379` (from `secrets/README.md`). The worker reaches Evolution via `http://wa-mancer-evolution:8080` (internal), and reaches **Supabase** (not Evolution's Postgres) via `worker.env` `DATABASE_URL`.

---

## 3. TLS / ingress (`caddy/Caddyfile` + `caddy/Dockerfile`)

- **Custom Caddy build.** `Dockerfile`: `caddy:2.10.0-builder` → `xcaddy build --with github.com/caddy-dns/cloudflare` → copy binary into `caddy:2.10.0-alpine`; a build-time `caddy list-modules | grep dns.providers.cloudflare` asserts the plugin is present.
- **Global options.** `email admin@welcomdeal.ma`; `servers { protocols h1 h2 h3 }` (HTTP/1.1 + 2 + 3).
- **Two public sites, both DNS-01 + TLS 1.3-only.** DNS-01 is *required*, not chosen: the origin is UFW-firewalled to Cloudflare IP ranges, so HTTP-01 (port-80 reachback) is unreachable.

```caddy
api.welcomdeal.ma {                         # Evolution API gateway
    tls { dns cloudflare {env.CLOUDFLARE_API_TOKEN}; resolvers 1.1.1.1 1.0.0.1; protocols tls1.3 }
    import security_headers
    @no_cf_header not header CF-Connecting-IP *
    respond @no_cf_header 421 { body "Misrouted request."; close }   # reject non-Cloudflare hits
    request_header X-Real-IP {http.request.header.CF-Connecting-IP}
    reverse_proxy evolution-api:8080 {
        header_up Host {host}; header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
        transport http { versions h1; read_timeout 600s; write_timeout 600s }
    }
}

wa.welcomdeal.ma {                          # frontend SPA (static)
    tls { dns cloudflare {env.CLOUDFLARE_API_TOKEN}; resolvers 1.1.1.1 1.0.0.1; protocols tls1.3 }
    import security_headers
    header { Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...
             connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.welcomdeal.ma; ..." }
    root * /srv/wa-mancer
    encode zstd gzip
    try_files {path} {path}/ /index.html    # SPA client-routing fallback
    file_server
}
```

- **Upstreams.** `api.welcomdeal.ma` → `reverse_proxy evolution-api:8080` (600s r/w timeouts, forced HTTP/1.1 to Evolution). `wa.welcomdeal.ma` → static `file_server` from `/srv/wa-mancer` (= bind of `/opt/wa-mancer/data/frontend`, the rsynced SPA `dist`).
- **`media.welcomdeal.ma` is NOT in this Caddyfile.** It appears in `index.html` (preconnect/dns-prefetch), the SPA CSP `img-src`, and the worker's `MEDIA_PUBLIC_HOST` default — it is a Cloudflare custom domain fronting the R2 bucket **directly**, bypassing the box. Only `api.` + `wa.` traverse Caddy.
- **`security_headers` snippet (reused on both sites).** `Strict-Transport-Security: max-age=300; includeSubDomains` (short, no preload — "stage-temp domain", bump on final domain), `X-Frame-Options: DENY`, `CSP frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` + `Cross-Origin-Resource-Policy: same-origin`, a full deny-all `Permissions-Policy`, and `-Server` / `-X-Powered-By`.
- **Public port surface.** Only 80, 443, 443/udp (all on Caddy). Everything else is internal-bridge-only.
- **Post-deploy note (README).** After the first successful HTTPS roundtrip, flip the Cloudflare zone from **Full** to **Full (strict)** (strict would 526 until Caddy mints the LE cert). Caddy re-issues ~every 60 days.

---

## 4. Build & deploy model

### 4.1 SPA (frontend) — built locally, shipped as artifact (dist is NOT committed)

- **CORRECTION to the task premise.** `dist/` and `worker/dist/` exist on disk but are **gitignored** (`.gitignore` line 11 `dist`) and **0 files are git-tracked** (verified `git ls-files dist/` → 0, `worker/dist/` → 0). They are local build outputs, not committed artifacts. Deployment is **ship-built-artifacts via rsync**, not build-on-server for the SPA.
- **Build.** `package.json` `"build": "tsc -b && vite build"`. Vite (`vite.config.ts`): `target: esnext`, `sourcemap` off unless `VITE_SOURCEMAPS=true`, `cssCodeSplit`, manual vendor chunks (`router`/`query`/`supabase`/`motion`/`avatar`/`react`/`vendor`). TS: `tsconfig.app.json` `target es2023`, `moduleResolution: bundler`, `noEmit`. Stack: React 19 + Vite 8 + TS 6, Supabase-js, TanStack Query, framer-motion, react-router 7, recharts, maplibre, pdfjs.
- **Deploy (README §Frontend).** `npm run build` on the workstation → `rsync -av --delete dist/ wa-mancer:/opt/wa-mancer/data/frontend/`. Caddy serves it from `/srv/wa-mancer` immediately, no container restart.
- **Env surface (SPA).** `.env.example` = only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. Supabase project ref `xlhlezgpgrypdijynmqr` is hardcoded in `index.html` preconnects.

### 4.2 Worker & Caddy & Evolution images — built ON the box (compose build)

- **Worker.** `worker/Dockerfile` = multi-stage `node:22-alpine`: builder does `npm install` (comment: switch to `npm ci` once lockfile lands — but a `package-lock.json` DOES exist, DRIFT) → `npm run build` (`tsc`) → `npm prune --omit=dev`; runtime stage drops to `USER node`, copies `node_modules`+`dist`+`package.json`, `NODE_ENV=production`, `EXPOSE 8090`, `CMD ["node","dist/index.js"]`. Built by compose from `./worker` on the box.
- **Worker deps of note.** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2), `@supabase/supabase-js`, `pg`. Engines `node>=22`.
- **Caddy + Evolution.** Both `build:` on the box (Caddy from `./caddy`, Evolution from the GitHub tag). No registry.
- **Whole-stack deploy (README §Deploy).** From workstation: (1) `rsync -av --delete infra/stack/ wa-mancer:/opt/wa-mancer/stack/`; (2) stream sealed secrets (§5); (3) `ssh wa-mancer 'cd /opt/wa-mancer/stack && sudo docker compose build caddy && sudo docker compose up -d'`; (4) verify with `docker compose ps` + `curl -I https://api.welcomdeal.ma/`.
- **No CI/CD pipeline.** There is **no `.github/` directory** (verified absent). No registry push, no GitHub Actions, no compose-pull. Deploy is fully manual rsync + `docker compose build/up` over SSH. (iGrowFast's own frontend deploy is likewise currently manual/unknown — see MEMORY `deploy-pipeline`.)

---

## 5. Secrets topology (sops + age)

### 5.1 Key model

- **Single age recipient.** `.sops.yaml` seals anything matching `\.sops\.(yaml|yml|json|env)$` or `secrets/.+` to the one age public key `age1jfhthggy6zjer59qh9k8qdnlxwrep465c4ykg4r06pzy7q0np3aqw0wc7x`. Confirmed: every `secrets/*.sops[.env]` header carries exactly that single `recipient` (sops `3.13.1`). No per-env / multi-recipient split — **one master key**.
- **Master private key is workstation-only.** `rotate-cf-token.sh` reads it from `SOPS_AGE_KEY_FILE` default `$HOME/.ssh/wa-mancer/age-master.txt`. The box never holds the age private key — only sealed files + decrypted runtime plaintext.
- **Repo hygiene.** `.gitignore` blocks `secrets/*` except `.gitkeep`, `README.md`, and `*.sops[.env|.yaml|.yml|.json]` — only sealed files are trackable; plaintext can't be committed.

### 5.2 Sealed-secret inventory (names/purpose only — never decrypted)

| Sealed file | Shape | Holds (by name) |
|---|---|---|
| `cloudflare_api_token.sops` | binary | Raw Cloudflare API token (Zone:DNS:Edit for welcomdeal.ma) — the value Caddy DNS-01 uses |
| `cloudflare.sops.env` | dotenv | Metadata bundle: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_ZONE_NAME` + `CLOUDFLARE_ACCOUNT_NAME` |
| `evolution_api_key.sops` | binary | Evolution global admin key (`AUTHENTICATION_API_KEY`, 32+ random hex) |
| `evolution_database_uri.sops` | binary | `postgresql://evolution:<pw>@postgres:5432/evolution` |
| `evolution_redis_uri.sops` | binary | `redis://default:<pw>@redis:6379` |
| `postgres_password.sops` | binary | Evolution Postgres password (20+ alnum) |
| `redis_password.sops` | binary | Redis password (20+ alnum) |

### 5.3 Decrypt-at-deploy → runtime plaintext on host

- **Path.** `sops -d secrets/<name>.sops[.env] | ssh wa-mancer 'sudo install -m 0600 -o root -g root /dev/stdin /opt/wa-mancer/secrets/<name>'`. Files land at `/opt/wa-mancer/secrets/` as `0600 root:root`, with NO `.env` extension (to dodge accidental `.env` globs). (README's deploy loop uniformly writes `secrets/${s}.sops.env` even for the binary `.sops` files — minor DRIFT; the working form is per-file.)
- **Two runtime shapes on the box.** (a) individual files consumed by compose `secrets:` → `/run/secrets/{cloudflare_api_token,postgres_password,redis_password}` (0400 in-container); (b) combined `env_file`s `evolution.env` + `worker.env` (0600) — assembled from the sealed pieces, consumed directly by Evolution and the worker.
- **Worker env surface (`worker.env.example`).** Documented keys: `DATABASE_URL` (Supabase pooler **SESSION mode, :5432 not :6543** — required for LISTEN/NOTIFY + `pg_advisory_lock`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_GLOBAL_API_KEY` (= Evolution's `AUTHENTICATION_API_KEY`), `WORKER_ID`, `WORKER_VERSION`, `LOG_LEVEL`, `HEARTBEAT_INTERVAL_MS`.
- **GAP — R2 secrets undocumented.** `worker/src/config.ts` **hard-requires** `R2_MEDIA_ENDPOINT`, `R2_MEDIA_ACCESS_KEY_ID`, `R2_MEDIA_SECRET_ACCESS_KEY`, and optionally `R2_MEDIA_BUCKET` (default `wamancer-media`) + `MEDIA_PUBLIC_HOST` (default `media.welcomdeal.ma`). **None of these appear in `worker.env.example`.** They exist only in the live `worker.env`.
- **GAP — `log-shipper.env` not sealed in repo.** Both systemd collectors read `/opt/wa-mancer/secrets/log-shipper.env` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), but there is no `log-shipper*.sops` in `secrets/`. Provisioned out-of-band; UNVERIFIED how.
- **Three-store framing (for the iGrowFast merge).** This repo owns exactly one of the three secret stores: **(b) container/host runtime env** (sops→`/opt/wa-mancer/secrets`). It does NOT own **(a) Supabase edge-fn env** (Supabase CLI `secrets`) or **(c) Postgres Vault** (SQL-only) — those live on the Supabase side. iGrowFast already has (a) and (c); merge must fold WA Mancer's (b) into iGrowFast's chosen model.

### 5.4 Rotation (`scripts/rotate-cf-token.sh`)

- **Only the Cloudflare token has an automated rotation path.** Flow: read new token hidden (`read -rs`) → **verify against CF** `/user/tokens/verify` before sealing anything (aborts if `success != true`) → re-seal `cloudflare_api_token.sops` (binary) AND `cloudflare.sops.env` (dotenv, preserving zone_id/zone/account) → stream new plaintext to `/opt/wa-mancer/secrets/cloudflare_api_token` (0600) → `docker compose restart caddy` → probe `caddy list-certificates` → print a manual reminder to revoke the old token in the CF dashboard last. `unset`s all sensitive vars at the end.
- **No rotation script** for postgres/redis/evolution-api-key/Supabase service-role. Manual.

---

## 6. Log / metrics shippers (host systemd, NOT containers)

Both are root systemd `.mjs` units running on the host (not in the compose stack) because they need `journalctl` / `docker stats` access the worker can't have. Both reuse `/opt/wa-mancer/secrets/log-shipper.env` and POST to Supabase via PostgREST with the **service_role** key. Both are hardened (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `MemoryMax`, `Restart=always`).

### 6.1 `wa-log-shipper` (`shipper.mjs`) → `ingest_system_logs`

- **Source.** `journalctl -o json -f` for the **4 non-worker containers** (`CONTAINER_TAG` in `wa-mancer-evolution|caddy|postgres|redis`) with a persistent cursor `/var/lib/wa-log-shipper/journal.cursor` (StateDirectory). The worker is excluded — it ships its own logs to the DB via `worker/src/logSink.ts`.
- **Parse.** Per-source normalizers → `{source, level, event, ...}`: Evolution regex `[Evolution API] pid - ... LEVEL [module] msg`; Caddy JSON access logs (method/status/uri/duration); Postgres `LOG|ERROR|FATAL|...` prefixes; Redis `.-*#` level chars. Level maps per source.
- **PII redaction HOST-SIDE, before the row leaves the box.** `SENSITIVE` key set (`jid`, `phone`, `token`, `secret`, `apikey`, `authorization`, `password`, `qr`, `pairingcode`, `body`, `text`, `message`, `vcard`, `remote_ip`, …) → `[redacted]`; string scrubbers collapse JIDs (`\d{6,}@…` → `[jid]`) and phone-like digit runs → `[num]`; URIs stripped of query; string caps (600/300 chars); payloads capped at 4000.
- **Delivery.** Bounded ring buffer (`MAX_BUFFER 2000`, drop-oldest with a `logshipper.dropped` warn row), flush at 50 rows or every 4s, `fetch` POST to `${SUPABASE_URL}/rest/v1/rpc/ingest_system_logs` (`apikey`+`Bearer` = service_role), 8s abort, fire-and-forget. Flushes on SIGTERM.
- **Unit.** `MemoryMax=64M`, `ReadWritePaths=/var/lib/wa-log-shipper`, `After=network-online + systemd-journald`.

### 6.2 `wa-metrics-collector` (`collector.mjs`) → `ingest_host_metrics` + `ingest_prom_metrics`

- **Host tick (every 12s).** Pure `/proc` + cgroup + `docker` CLI ($0 cost): CPU% (delta `/proc/stat`), load1/5/15, mem/swap (`/proc/meminfo`), disk (`statfsSync('/')`), net rx/tx kbps (physical ifaces only), uptime, plus **per-container** cpu%/mem via `docker stats --no-stream` + `docker inspect` (running flag + restart count). POST to `${SUPABASE_URL}/rest/v1/rpc/ingest_host_metrics`.
- **Prometheus scrape (every 60s, independent).** Scrapes the **Supabase project's** privileged metrics endpoint `${SUPABASE_URL}/customer/v1/privileged/metrics` with HTTP Basic `service_role:<service_role_key>`. Parses expo text, keeps an **allowlist of ~130 series** (gotrue/pgbouncer/supavisor/pgrst/pg_stat/node_* families), pre-aggregates `node_cpu_seconds_total` by mode, drops noisy labels → POST `${SUPABASE_URL}/rest/v1/rpc/ingest_prom_metrics`. Single-inflight, 15s/10s aborts, never throws out of the loop.
- **Unit.** `MemoryMax=80M`, `After=network-online + docker.service`.
- **Destination confirmed.** Observability flows **into the same Supabase project** (the app DB) via service_role RPCs — `ingest_system_logs` / `ingest_host_metrics` / `ingest_prom_metrics` (feeding `system_logs` / `host_metrics` / metric-sample tables). NOT an external logging/metrics stack. Separately, the **worker** does `r2MetricsPull.ts` (ListObjectsV2 over the R2 media bucket every 10min → `ingest_r2_metrics`) and `platformLogPull.ts` — so R2 usage + platform logs also land in Supabase. The box therefore holds the Supabase service_role key in TWO places: `worker.env` (container) and `log-shipper.env` (host).

---

## 7. Scripts & CI

- **`scripts/gen-emoji.mjs`.** Dev-only codegen: reads `unicode-emoji-json` (devDependency) → writes `src/routes/admin/conversations/emoji-data.ts` (committed) so there's no runtime dep on the dataset. Infra-irrelevant except that it's a committed generated artifact.
- **`ci/cache-gate.test.ts`.** Pre-deploy guard (`npm run cache-gate` = `tsx ci/cache-gate.test.ts`). Greps **committed** `supabase/migrations/*.sql` for cache-layer invariants R0–R6 (no `SET ROLE cron_*`; no sub-minute `*/N seconds` cron; no session-level advisory locks — only `*_xact_lock`; cache fn must use `pg_try_advisory_xact_lock(CACHE_CLASSID, hashtext(key))` not the audit namespace; `cache_get_or_compute` only from an allowlist of ~10 stats wrappers; cached `_impl`/`_compute_*` must be identity-free and REVOKEd from PUBLIC/anon/authenticated/service_role). **Self-described as VACUOUS if migrations are applied via MCP only** (committed files are a precondition). No runner wires it — it's a manual/local gate, not a pipeline step (no `.github/`).

---

## 8. Surprises / merge hazards (for the iGrowFast merge)

1. **The stack is one indivisible box; the merge fans it across three.** Compose glues Caddy + Evolution + Evolution's Postgres + Redis + worker with two local Docker bridges and container-name DNS (`wa-mancer-evolution:8080`, `postgres:5432`, `redis:6379`). Moving Evolution to the dedicated WhatsApp VPS `213.199.54.67`, the worker toward the main box `207.180.232.102` (it needs the iGrowFast Supabase pooler), and Redis/support tools toward the toolbox `37.60.250.211` **destroys the shared internal network**. The worker↔Evolution hop (`http://wa-mancer-evolution:8080`, plaintext, unauthenticated-at-network, secured only by being on the internal bridge) becomes a cross-host link that now needs real transport + auth, or the worker co-locates with Evolution on the WhatsApp box.

2. **Two separate Postgres — do NOT conflate.** Evolution's `postgres` (db `evolution`) holds **Baileys session creds + message/contact/chat/label history** and is Evolution's private operational store; it does NOT merge into iGrowFast Supabase. Only the *inbox app schema* (Supabase side) ports into the new `whatsapp` schema. Evolution's Postgres + its volume `/opt/wa-mancer/data/postgres` must travel WITH Evolution to the WhatsApp box intact — losing it re-pairs every number. Provision a Postgres 17 + Redis 7 pair on the WhatsApp box for Evolution.

3. **Redis instance-cache must stay OFF — re-enabling is a ban vector.** `CACHE_REDIS_ENABLED=false` + `CACHE_REDIS_SAVE_INSTANCES=false` are load-bearing (double-socket → Baileys 440 `conflict/replaced` reconnect war). If the toolbox `37.60.250.211` Redis is shared with support tools, keep Evolution's instance management OUT of it; carry `CACHE_LOCAL_ENABLED=true` verbatim. Postgres is the single source of instance truth.

4. **R2→Supabase Storage is a code change, not just env.** The worker `config.ts` hard-requires `R2_MEDIA_*` (S3 client in `worker/src/r2/client.ts`, `r2/avatar.ts`, `r2MetricsPull.ts`, `dispatcher/media-ingest.ts`, `media-variation.ts`). Repointing media at Supabase Storage means swapping the AWS S3 SDK path for Supabase Storage, retiring `ingest_r2_metrics`/`r2MetricsPull`, and re-pointing `media.welcomdeal.ma` (a Cloudflare custom domain fronting R2 directly, referenced in `index.html` preconnect, SPA CSP `img-src`, and `MEDIA_PUBLIC_HOST`) to a Supabase Storage public URL.

5. **`welcomdeal.ma` is hardcoded in ~6 places.** `api./wa./media.welcomdeal.ma` in the Caddyfile; Evolution `SERVER_URL=https://api.welcomdeal.ma`; worker `MEDIA_PUBLIC_HOST` default; `index.html` preconnects; SPA CSP `connect-src https://api.welcomdeal.ma`; Cloudflare token scoped `Zone:DNS:Edit` for `welcomdeal.ma`. Every one must be rewritten to the iGrowFast domain, and the CF token re-scoped/replaced.

6. **Caddy-vs-nginx AND "no Cloudflare for WhatsApp" collide with the whole ingress design.** iGrowFast fronts app+Supabase via **Cloudflare Tunnel** (`api.igrowfast.com`, kong+pooler loopback — MEMORY). WA Mancer uses **Caddy with Cloudflare DNS-01** (origin firewalled to CF IPs) plus an app-layer `@no_cf_header → 421` reject of non-Cloudflare traffic. If the WhatsApp box is deliberately NOT behind Cloudflare, then: DNS-01 (which *requires* the CF API token) breaks → must switch to HTTP-01/self-managed TLS; the CF-header 421 gate must be dropped; and `rotate-cf-token.sh` + `cloudflare_api_token.sops` + `cloudflare.sops.env` become obsolete. Decide Caddy-on-WhatsApp-box vs. front Evolution some other way before touching TLS.

7. **Secrets re-topology: single workstation-held age key vs iGrowFast's stores.** WA Mancer = sops+age, ONE recipient, master private key workstation-only, plaintext streamed to `/opt/wa-mancer/secrets` (0600). iGrowFast = Supabase edge-fn env (CLI) + Postgres Vault (MEMORY `secrets-topology-two-stores`). Either adopt sops for the WhatsApp box's container runtime env (Evolution API key, Evolution Postgres/Redis passwords, worker's Supabase service_role + R2/Storage creds) or fold them into iGrowFast's model. Note the box will hold the iGrowFast Supabase **service_role** key in `worker.env` AND `log-shipper.env` — a high-value target on a WhatsApp-facing host.

8. **`dist/` is NOT committed and there is NO CI/CD.** Task premise corrected: SPA `dist` + `worker/dist` are gitignored build outputs (0 git-tracked). SPA ships by local `npm run build` + rsync; worker/caddy/Evolution images build on the box via `docker compose build`; no `.github/`, no registry, no pipeline — deploy is fully manual SSH+rsync. iGrowFast's frontend deploy is also manual/unknown (MEMORY `deploy-pipeline`). A deliberate pipeline decision is owed before merge.

9. **Observability RPCs + tables must pre-exist in iGrowFast Supabase.** The two host collectors POST to `ingest_system_logs`, `ingest_host_metrics`, `ingest_prom_metrics` (worker adds `ingest_r2_metrics`) writing `system_logs`/`host_metrics`/metric-sample tables. These functions+tables must be created in the target project (whatsapp or a monitoring schema) or the shippers silently 404/drop. The Prometheus scrape targets the **WA Mancer Supabase project's** `/customer/v1/privileged/metrics` — a different project means a different endpoint + Basic-auth service_role key; re-point or drop the scrape.

10. **Worker `DATABASE_URL` must remain Supabase pooler SESSION mode (:5432).** The dispatcher uses LISTEN/NOTIFY + `pg_advisory_lock`; transaction-mode pooling (:6543) breaks it. When repointed at iGrowFast Supabase, keep session-mode.

11. **Undocumented/ drifted config to reconcile on merge.** (a) `worker.env.example` omits the required `R2_MEDIA_*`/`MEDIA_PUBLIC_HOST` keys (§5.3) — will be missed if the example is treated as the surface. (b) `log-shipper.env` is not sealed in the repo — provision it explicitly. (c) README + compose header list only 4 services (omit `worker`) and README names image `atendai/evolution-api:v2.3.7` while compose builds from `evolution-foundation` source at `2.3.7` — trust compose. (d) worker Dockerfile still says "switch to `npm ci` when lockfile lands" though `worker/package-lock.json` already exists. (e) `ci/cache-gate.test.ts` is vacuous when migrations go through MCP (iGrowFast's model) — it needs re-homing or it passes trivially.
