# Self-Hosted Webmail — Rebuild Blueprint (CLIENT SIDE)

Companion to `SELFHOST_MAIL_SERVER_BLUEPRINT.md`. That file gets Stalwart sending/receiving
mail with perfect auth. **This file puts a browser webmail (Bulwark) and an admin dashboard
in front of it**, exposed through the existing Cloudflare tunnel, without breaking the mail core.

Written as a template. Concrete values for THIS deployment:

| Placeholder | This deployment |
|---|---|
| `WEBMAIL_HOST` | `email.igrowfast.com` |
| `JMAP_HOST` | `jmap.igrowfast.com` |
| `MAILADMIN_HOST` | `mailadmin.igrowfast.com` |
| `MAIL_HOST` (SMTP/IMAP identity, DNS-only) | `mail.igrowfast.com` |
| Box | toolbox VPS `igf-tools` = 37.60.250.211 (Contabo), root |
| Mail stack | `/opt/igf-mail` (compose project `igf-mail`) |
| Tunnel | Cloudflare tunnel `igf-frontend` (id `5b1b4f8d-…`), container `igf-frontend-cloudflared-1` |
| Shared docker net | `igf-frontend_web` = `172.18.0.0/16` (cloudflared + nginx + stalwart + webmail) |
| Webmail image | `ghcr.io/bulwarkmail/webmail:1.7.7` (Next.js/JMAP, AGPL-3.0) |
| CF zone | `98723fd0…`; CF account `8897211c…`; full token in Keychain `cf-igrowfast-api` |

---

## 0. THE TRAPS THAT COST THE MOST TIME (read first, internalize)

1. **The webmail browser talks JMAP *directly, cross-origin* to the mail server** — it is NOT
   proxied through the Next.js server. So `JMAP_HOST` must be publicly reachable AND CORS must
   be permissive on Stalwart. (Bulwark `lib/jmap/client.ts` — the browser `fetch`es the JMAP
   origin with an `Authorization` header on every call.)

2. **Bulwark rewrites the JMAP session URLs to the configured origin** — it does NOT use the
   server-advertised `apiUrl` verbatim. `rewriteSessionUrl()` (client.ts:930) replaces the
   advertised origin with `JMAP_SERVER_URL`'s origin, keeping the path. So the app works even
   if Stalwart advertises the wrong host — but advertising an unreachable host is a handwave;
   fix it (trap #6). Consequence: **do NOT panic-change the mail server's hostname** thinking
   the app needs it.

3. **Shared-tunnel-IP auto-ban = one unauthenticated request DoSes the entire mail surface.**
   Cloudflared reaches Stalwart from ONE docker IP. With `Http.useXForwarded=false`, Stalwart
   attributes 100% of tunnelled traffic to that IP. A single `GET /jmap/../x` (matches Stalwart
   `Security.scanBanPaths` `*../*`, **permanent, no expiry**) bans the tunnel origin → JMAP +
   webmail + admin all go down together. **A security scan of your own new endpoint will trigger
   this.** Fix = allowlist the whole docker subnet (§4c). This is the single most important
   operational control.

4. **A banned IP returns TCP `EOF`, which cloudflared reports as `502`, NOT `403`.** Don't chase
   a routing bug — check `stalwart-cli query BlockedIp` first. The origin answering `307` on a
   direct `curl` while the tunnel gives `502` is the signature.

5. **Deleting a `BlockedIp` row does NOT evict the in-memory ban.** You must
   `stalwart-cli create Action/ReloadBlockedIps` (or `ReloadSettings`) for it to take effect on
   live connections. Same for AllowedIp changes.

6. **`useXForwarded=true` alone is spoofable and makes things WORSE.** Stalwart reads the
   *leftmost* `X-Forwarded-For` value, which the client controls. Enabling it lets an attacker
   (a) evade bans by rotating XFF and (b) ban a victim's real IP by forging it. Cloudflare
   *appends* to a client-supplied XFF, it does not strip it. To use `useXForwarded` safely you
   MUST first overwrite XFF at the CF edge with `cf.connecting_ip` (Transform Rule, §4d). Verify
   spoof-resistance by forging the header and reading Stalwart's `remoteIp` in `docker logs`
   before trusting it.

7. **`stalwart-cli update … --json '{"services":{"jmap":{…}}}'` REPLACES the whole `services`
   map**, silently wiping the other 7 protocol entries. `map<>` fields patch wholesale. Restore
   the full map (all 8 `ServiceProtocol` keys) in one payload, or use the JSON-pointer
   `--field 'services/jmap/hostname=…'` form for a targeted leaf-set. `cleartext` there only
   affects *advertisement*, not whether listeners accept cleartext (schema-confirmed) — so a
   wipe cannot break mail flow, only autoconfig scheme strings.

8. **`SystemSettings.proxyTrustedNetworks` is PROXY-protocol (TCP), NOT X-Forwarded-For trust.**
   The audit's "set proxyTrustedNetworks" advice is wrong for an HTTP tunnel. The only HTTP-XFF
   knob is `Http.useXForwarded` (boolean). Don't touch proxyTrustedNetworks for a webmail rollout.

9. **The recovery admin works over the management API in NORMAL mode** (not just recovery mode).
   `STALWART_RECOVERY_ADMIN=admin:<pw>` in the env is honored while running normally, so
   `stalwart-cli get/query/create/update/delete` all work with it against `127.0.0.1:8080` with
   no recovery cycle. This obsoletes the server blueprint's "admin = recovery cycle" and lets
   cert renewal be zero-downtime (§5, and the server blueprint's §8 is superseded).

10. **The built-in "User" role has ZERO permissions unless `Authentication.defaultRoles` is set.**
    Symptom is broader than webmail: JMAP 403 and SMTP `550 not authorized` on every non-`app@`
    mailbox. Fix = a real `mail-user` Custom role (all user-facing perms) assigned to each human
    mailbox (§2d). Discover this the moment ANY mailbox can't authenticate to JMAP/IMAP/submission.

---

## 1. PREREQUISITES & DECISIONS

- Mail server (server blueprint) already live: Stalwart on the box, HTTP/JMAP on `127.0.0.1:8080`,
  `usePermissiveCors=true` on the `Http` singleton (required — the browser is cross-origin).
- A Cloudflare tunnel already fronting other hosts on a shared docker network. The webmail and
  Stalwart HTTP both ride THIS tunnel (SMTP/IMAP cannot — they stay on published ports).
- Decisions locked for this deployment:
  - **Webmail open**, `/admin` gated by CF Access. Stalwart admin (`MAILADMIN_HOST`) fully gated.
  - `JMAP_SERVER_URL` **locked** via env (`allowCustomJmapEndpoint=false`) — users can't point
    the app at an arbitrary server.
  - Telemetry off. Settings-sync on (encrypted at rest, needs `SESSION_SECRET`).
  - Branding = iGrowFast logo/name.

---

## 2. DEPLOY BULWARK (add a service to the mail compose)

Put webmail in the SAME compose project as Stalwart so they share a lifecycle, but on the
tunnel's external network so cloudflared can reach it by service alias.

### 2a. Data dirs + secrets (never in the image)
```bash
cd /opt/igf-mail
mkdir -p webmail/{settings,admin,admin-state,telemetry}
chown -R 1001:1001 webmail            # Bulwark runs as uid 1001 (nextjs); else EACCES on /app/data
SS=$(openssl rand -base64 32)         # SESSION_SECRET — encrypts stored creds + settings
AP=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)   # one-time admin bootstrap password
```

### 2b. `.env.webmail` (chmod 600)
```
HOSTNAME=0.0.0.0
PORT=3000
JMAP_SERVER_URL=https://JMAP_HOST      # locks the login server field; browser rewrites session URLs to this origin
SESSION_SECRET=<SS>
ADMIN_PASSWORD=<AP>                     # hashed into data/admin/admin.json on first boot, then REMOVE this line
SETTINGS_SYNC_ENABLED=true
BULWARK_TELEMETRY=off
BULWARK_TELEMETRY_DISABLED=1
APP_NAME=iGrowFast Mail
LOGIN_COMPANY_NAME=iGrowFast
LOGIN_WEBSITE_URL=https://igrowfast.com
APP_LOGO_LIGHT_URL=https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png
APP_LOGO_DARK_URL=https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png
LOGIN_LOGO_LIGHT_URL=https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png
LOGIN_LOGO_DARK_URL=https://app.igrowfast.com/Logo/iGrowFast%20Icon%20Transparent.png
```
After first boot, Bulwark logs *"Admin password hashed and saved to admin.json. You may now
remove ADMIN_PASSWORD"* — do it, and stash `<AP>` in a password manager (Keychain `bulwark-admin`).
Stash `<SS>` too (`bulwark-session-secret`); losing it invalidates all sessions + encrypted settings.

### 2c. compose service (join the tunnel's EXTERNAL network)
```yaml
  webmail:
    image: ghcr.io/bulwarkmail/webmail:1.7.7
    restart: unless-stopped
    env_file: .env.webmail
    volumes:
      - ./webmail/settings:/app/data/settings
      - ./webmail/admin:/app/data/admin
      - ./webmail/admin-state:/app/data/admin-state
      - ./webmail/telemetry:/app/data/telemetry
    security_opt: [ "no-new-privileges:true" ]
    networks: [ web ]           # the tunnel's network
    healthcheck:
      test: ["CMD","wget","--no-verbose","--tries=1","--spider","http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
networks:
  mail: { driver: bridge }
  web:                          # cloudflared lives here (defined in the frontend compose)
    name: igf-frontend_web
    external: true
```
Also add `web` to the **stalwart** service's `networks:` so cloudflared can reach `stalwart:8080`
by alias. `docker compose up -d`. Both containers should report `(healthy)`.

### 2d. Fix the mailbox permission floor (trap #10) BEFORE testing login
```bash
# The abstract "User" role -> Authentication.defaultRoles (empty) -> ZERO perms. Build a real one.
# 201 user-facing perms = every permission EXCEPT sys*/action*/task*/live*/oAuth*/pop3* and the
# dangerous ones (impersonate, unlimited*, fetchAnyBlob, jmapPrincipalCreate/Update/Destroy).
stalwart-cli describe Permission | awk 'NF>=2 && $1 ~ /^[a-z]/ {print $1}' \
  | grep -vE '^(sys|action|task|live|oAuth|pop3)' \
  | grep -vE '^(impersonate|unlimitedRequests|unlimitedUploads|fetchAnyBlob|interactAi|jmapPrincipalCreate|jmapPrincipalUpdate|jmapPrincipalDestroy)$' > /tmp/p.txt
# enabledPermissions is a MAP<perm,bool>, not a list:
python3 -c 'import json;print(json.dumps({"description":"mail-user","enabledPermissions":{p:True for p in open("/tmp/p.txt").read().split()}}))' > /tmp/role.json
stalwart-cli create Role --file /tmp/role.json                       # note the new id, e.g. "d"
for A in <account-ids of every human/system mailbox>; do
  stalwart-cli update Account $A --field 'roles={"@type":"Custom","roleIds":{"d":true}}'; done
# app@ keeps its own submission-only role; sysadmin keeps Admin.
```
Verify: `curl -u <mbox>@DOMAIN:<pw> http://127.0.0.1:8080/jmap/session` returns a real
`username`+`accounts`, and SMTP `AUTH`+`MAIL FROM`+`RCPT TO` returns `250` (test with `RSET`,
never send).

---

## 3. EXPOSE VIA THE CLOUDFLARE TUNNEL

All three hostnames ride the existing tunnel. Edit the tunnel's ingress via the CF API
(`PUT …/cfd_tunnel/<id>/configurations`), keeping existing rules intact and the catch-all last.

```jsonc
// ingress (order matters; first match wins; last MUST be the 404)
{ "hostname": "WEBMAIL_HOST",   "service": "http://webmail:3000" },
{ "hostname": "JMAP_HOST", "path": "^/jmap($|/)",      "service": "http://stalwart:8080" },
{ "hostname": "JMAP_HOST", "path": "^/\\.well-known/", "service": "http://stalwart:8080" },
{ "hostname": "JMAP_HOST", "path": "^/dav($|/)",       "service": "http://stalwart:8080" },
{ "hostname": "JMAP_HOST", "service": "http_status:404" },     // deny everything else on the JMAP host
{ "hostname": "MAILADMIN_HOST", "service": "http://stalwart:8080" },
{ "service": "http_status:404" }
```
- **Path allowlist on `JMAP_HOST` is the security boundary.** It forwards ONLY `/jmap*`,
  `/.well-known/*`, `/dav*` and 404s the admin UI/API (`/api`, `/auth`, `/login`, `/webadmin`,
  `/metrics`). Anchor with `($|/)` so `/jmapfoo` doesn't prefix-bleed to the router (trap: `^/jmap`
  alone matches `/jmapfoo`). `..`-paths still pass the CF regex and reach Stalwart, but Stalwart
  404s them into `/api` — the only harm is a scan-ban trigger, handled by §4c.
- DNS: proxied `CNAME email/jmap/mailadmin -> <tunnel-id>.cfargotunnel.com`.
- **CF Access apps** (reuse the existing Owner allow-policy):
  - `MAILADMIN_HOST` — whole host gated.
  - `WEBMAIL_HOST/admin` — path-scoped app so only `/admin` is gated; webmail root stays open.

---

## 4. THE JMAP DATA PATH — make it work AND make it safe

### 4a. CORS (already correct if server blueprint followed)
`Http.usePermissiveCors=true` → Stalwart returns `Access-Control-Allow-Origin: *` with
`Authorization, Content-Type, Accept` allowed and `OPTIONS -> 204`. No `Allow-Credentials`
(safe: JMAP auth is header-based, not cookies). The webmail (`WEBMAIL_HOST`) and JMAP
(`JMAP_HOST`) are different origins, so this cross-origin CORS is REQUIRED. Verify with a real
preflight (`curl -X OPTIONS … -H 'Origin: https://WEBMAIL_HOST' -H 'Access-Control-Request-Method: POST'`).

### 4b. Browser data-path verification (do this instead of typing a password into the UI)
From the webmail origin's devtools/console (or a `javascript_tool` fetch), confirm the two shapes
the real app uses:
```js
await fetch("https://JMAP_HOST/jmap/session")                      // simple GET -> 200 + capabilities
await fetch("https://JMAP_HOST/jmap/session",                      // preflighted (Authorization) -> 401 reached server
  { headers: { Authorization: "Basic " + btoa("probe:invalid") } })// a CORS *block* would throw TypeError; 401 = preflight PASSED
```
Both succeeding proves the cross-origin + preflight path. Authenticated correctness is proven
separately with real creds over `curl` (returns `username`+`accounts`+15 capabilities).

### 4c. **Anti-DoS: allowlist the docker subnet (mandatory)**
```bash
stalwart-cli create AllowedIp --json '{"address":"172.18.0.0/16","reason":"tunnel+internal services; never auto-ban"}'
stalwart-cli create Action/ReloadBlockedIps
```
Use the **subnet**, not cloudflared's single IP — cloudflared runs `:latest` with
`restart:unless-stopped` and gets a new bridge IP on restart; a `/32` allowlist would let the
new IP be banned and the outage recurs. With `useXForwarded=false` all tunnel HTTP is attributed
to this subnet, so nothing on the tunnel can ever be banned. Direct SMTP/IMAP (real external IPs,
outside 172.18/16) keep normal per-IP banning.

If already banned: `stalwart-cli query BlockedIp` → `delete BlockedIp --ids <id>` →
`create Action/ReloadBlockedIps` (deleting the row alone does not evict the in-memory ban — trap #5).

### 4d. (Optional hardening) restore per-attacker IP banning on the HTTP surface
Strong random mailbox passwords (32-char) already make spray infeasible; this adds defense-in-depth.
`useXForwarded=true` is spoofable alone (trap #6), so FIRST make the edge authoritative:
1. CF Transform Rule (phase `http_request_late_transform`), scoped `http.host eq "JMAP_HOST"`,
   action rewrite: **set** request header `X-Forwarded-For` = expression `cf.connecting_ip`.
2. `stalwart-cli update Http --json '{"useXForwarded":true}'; stalwart-cli create Action/ReloadSettings`.
3. **Verify spoof-resistance**: `curl -H 'X-Forwarded-For: 203.0.113.66' …` through the tunnel,
   then `docker logs igf-mail-stalwart-1 | grep request-url` — the request-level `remoteIp` MUST be
   your real IP, NOT `203.0.113.66`. If it shows the forged value, the edge rewrite isn't winning —
   REVERT `useXForwarded=false` immediately (`+ ReloadSettings`) and stay on the allowlist-only posture.

### 4e. Fix the advertised URL (trap #7 — the safe way)
```bash
# Full-map replace with jmap override (all 8 ServiceProtocol keys; cleartext:false = advertise https):
stalwart-cli update SystemSettings --json '{"services":{"caldav":{"cleartext":false},"carddav":{"cleartext":false},"imap":{"cleartext":false},"jmap":{"hostname":"JMAP_HOST","cleartext":false},"managesieve":{"cleartext":false},"pop3":{"cleartext":false},"smtp":{"cleartext":false},"webdav":{"cleartext":false}}}'
stalwart-cli create Action/ReloadSettings     # SystemSettings is cached; session apiUrl won't change until reload
# verify: session apiUrl = https://JMAP_HOST/jmap/  AND  SMTP banner still MAIL_HOST (EHLO test)
```
Optional (leaves the app working either way, since the client rewrites URLs regardless).

---

## 5. ADMIN SURFACES

- **Create mailboxes / server config → `MAILADMIN_HOST`** (Stalwart WebUI, behind CF Access).
  Login = `admin` / `<STALWART_RECOVERY_ADMIN password>` (Keychain `stalwart-recovery-admin`).
  The recovery admin is honored in normal mode (trap #9), so the WebUI has full management rights.
  (A normal principal with an Admin role still 403s the mgmt API in this build — use the recovery
  admin for administration.)
- **Webmail app config (branding, plugins, themes) → `WEBMAIL_HOST/admin`** (behind CF Access),
  login = the Bulwark admin password (Keychain `bulwark-admin`). This is NOT for creating mail
  accounts — that's the mail server's job (above).
- The setup wizard is disabled whenever `JMAP_SERVER_URL` is set (env-managed state): `/setup`
  404s/redirects. Verify it is unreachable.

---

## 6. PROVE IT END-TO-END
1. `WEBMAIL_HOST/` → login page renders with your branding, **no server-URL field** (config locked). ✓
2. `WEBMAIL_HOST/api/config` → `jmapServerUrl=https://JMAP_HOST`, no secrets. ✓
3. Browser cross-origin fetch (§4b): simple 200 + preflighted 401. ✓
4. `curl -u <mbox> https://JMAP_HOST/jmap/session` → real session, 15 capabilities, `apiUrl` on `JMAP_HOST`. ✓
5. `WEBMAIL_HOST/admin`, `MAILADMIN_HOST` → 302 to CF Access. ✓
6. Log into the webmail (owner enters their own password) → inbox loads, send/receive works. ← human step
7. SMTP `220 MAIL_HOST` + IMAP `* OK` on direct ports still up (webmail work didn't touch mail). ✓

---

## 7. OPERATIONS
- **Cert renewal is zero-downtime** (supersedes server blueprint §8): lego renews →
  `stalwart-cli update Certificate <id>` in normal mode (recovery admin) →
  `create Action/ReloadTlsCertificates`. No recovery cycle, no container recreate. The renewal
  script must scope any `docker compose` action to the `stalwart` service only, so it never
  bounces the webmail container.
- **Ban recovery**: `query BlockedIp` → `delete BlockedIp --ids <id>` → `Action/ReloadBlockedIps`.
- **Upgrades**: bump the Bulwark image tag, `docker compose up -d webmail`. Data volumes persist
  admin config, settings, telemetry consent.
- **What persists where**: mail-user role / AllowedIp / services map / `useXForwarded` live in the
  Stalwart registry (survive restarts). Tunnel ingress + DNS + Access live in Cloudflare. Webmail
  admin/session state lives in the `webmail/` bind-mounts. Secrets live in the Mac Keychain.

---

## 8. ONE-LINE SYMPTOM → CAUSE → FIX INDEX
| Symptom | Cause | Fix |
|---|---|---|
| Webmail up but JMAP host `502` (`EOF` in cloudflared logs) | Tunnel IP auto-banned (shared-IP scan-ban) | `delete BlockedIp` + `Action/ReloadBlockedIps`; allowlist `172.18.0.0/16` |
| Ban deleted but still `502` | In-memory ban not evicted | `create Action/ReloadBlockedIps` |
| Every mailbox JMAP `403` / SMTP `550 not authorized` | "User" role → empty defaultRoles → zero perms | build `mail-user` Custom role, assign to mailboxes |
| `apiUrl` still shows wrong host after `update` | SystemSettings cached | `create Action/ReloadSettings` |
| IMAP/SMTP autoconfig entries vanished after a `services` patch | `map<>` fields replace wholesale | re-send the full 8-key `services` map, or use `--field services/jmap/hostname=…` |
| Forged `X-Forwarded-For` accepted as client IP | `useXForwarded=true` without edge XFF rewrite | revert to `false`, or set XFF=`cf.connecting_ip` at CF edge first, then re-verify |
| `/api` on JMAP host reachable | tunnel path allowlist missing/loose | ingress: forward only `^/jmap($|/)`,`^/\.well-known/`,`^/dav($|/)`; 404 the rest |
| Webmail bounced on every cert renewal | renewal recreates whole compose | scope compose action to `stalwart`; use zero-downtime cert re-import |
| Bulwark `EACCES` on `/app/data` | volumes not owned by uid 1001 | `chown -R 1001:1001 webmail/` |

---

*Built and verified 2026-07-19. Server side: `SELFHOST_MAIL_SERVER_BLUEPRINT.md`.*
