# Self-Hosted Mail Server — Rebuild Blueprint (SERVER SIDE)

> Executable roadmap to stand up a self-hosted **Stalwart** mail server that sends fully-authenticated mail
> (SPF+DKIM+DMARC pass, mail-tester 9–10/10) on a cheap VPS, without re-hitting any of the traps we hit.
> Follow it **top to bottom**. Every step has: **goal → exact commands → the trap → verify**.
> Client side (Bulwark webmail) is a **separate file** — build the server first, prove sending, then do the client.
>
> **This deployment (fill these in per project):**
> - `DOMAIN` = igrowfast.com · `MAIL_HOST` = mail.igrowfast.com · `BOX_IP` = 37.60.250.211
> - Box: Contabo VPS, Ubuntu 24.04, `ssh igf-tools`, already runs a docker `nginx+cloudflared` frontend + restic→R2 backups
> - DNS: Cloudflare (zone id `98723fd0a91e2fe3784eee554f780182`, account `8897211ce4bdb3eff028770e3dc584be`)
> - Stalwart `v0.16.13`, image `stalwartlabs/stalwart:v0.16`; `stalwart-cli` `v1.0.10` (repo `stalwartlabs/cli`)
> - Everything lives in `/opt/igf-mail/` on the box. Secrets in macOS Keychain (`security add-generic-password`).

---

## 0. THE TRAPS THAT COST THE MOST TIME (read first, internalize)

1. **The box's local DNS resolver (`systemd-resolved`, 127.0.0.53) returns NXDOMAIN for *freshly-created* DNS records.** This single bug silently broke: (a) native ACME DNS-01, (b) DKIM key rotation, (c) any lego propagation self-check. **Fix once, up front:** point every DNS-01 tool at a public resolver (`1.1.1.1`) and set Stalwart's `DnsResolver` to the `Cloudflare` variant. If you skip this, you will chase ghosts for hours.
2. **Stalwart's native ACME never obtains a cert** (no order attempt, even with correct wiring + good resolver). **Do not use it. Use `lego` + a manual `Certificate` object.**
3. **Stalwart v0.16 is JSON + a DB-backed registry (117 typed objects), NOT the old TOML.** Config = `stalwart-cli apply`/`create`/`update` against the management API. Docs that show `[section] key=…` TOML are for ≤v0.12 — ignore them.
4. **The management `/api` is reserved to the RECOVERY/fallback admin over basic-auth.** A normal account — even with a Custom role holding ALL 415 `sys*` permissions — gets **HTTP 403** in every mode. So all admin (and cert re-import automation) runs through a **recovery-mode cycle**. Accept this; don't burn time trying to grant normal-mode API access.
5. **The DB must be first-initialized IN recovery mode** or `STALWART_RECOVERY_ADMIN` never activates → 401 forever. If you booted normal first, **wipe `data/lib` and re-boot recovery**.
6. **Gmail does not verify Ed25519 DKIM** — it reports `dkim=neutral (no key)` even when the record is perfect. You **must dual-sign RSA+Ed25519**; Gmail validates the RSA one. (mail-tester/Proton do verify Ed25519.)
7. **lego v5 has no `renew` subcommand** — it's `run` (get-or-renew), and **all flags go AFTER `run`** (globals are only `--log*`/`--config`). And it needs `--dns.resolvers 1.1.1.1:53` (see trap #1).
8. **The built-in `User` role cannot send mail** (`550 5.7.1 not authorized`). Only a role with `authenticate`+`emailSend` can submit. Give the app a dedicated least-priv `app@` submission account.
9. **NEVER send a test to a Gmail you care about until SPF+DKIM+DMARC ALL pass and the server is fully healthy.** Gmail's spam model is **cross-account, sticky, and reputation-poisoning** — a few early spam-folds train it against your domain+IP *globally* ("similar to messages identified as spam in the past") and are slow to reverse, even after the config is perfect. We poisoned a real Gmail with early junky test blasts. **Validate config against non-punishing endpoints first** (see §7 testing discipline); bring Gmail in LAST, once green, with "Report not spam" ready. (ProtonMail is lenient and DANE-validates — a safe early target.)

---

## 1. PREREQUISITES & DECISIONS (do before touching the box)

**You need:**
- Root SSH to the VPS. A domain on **Cloudflare** (or any API-scriptable DNS). Contabo (or provider) API creds for PTR.
- A **Cloudflare API token** scoped to **DNS:Edit + Zone:Read on the ONE zone** (for lego DNS-01). Mint it at the **account** endpoint (see §3), not the dashboard, if scripting.

**Decisions (write them down — they change the plan):**
- **MX cutover vs send-only.** If the domain already receives mail (it did — Hostinger MX), full replacement is a **real MX cutover** (imapsync existing mailboxes), not greenfield. **Recommended: send-only first**, prove reputation, cut MX later. (We built send-capable; MX stays on the old host, gated.)
- **Mailbox inventory.** Enumerate every address the app **sends as** (query the app's sender config) AND every address the **legal/website pages** reference — both must exist. Plus RFC (`postmaster@`, `abuse@`) and monitoring (`dmarc-reports@`, `tlsrpt@`) aliases. (We found 5 senders in `email_accounts` + `privacy@` in legal pages.)
- **Admin model.** Normal-mode API admin is impossible (trap #4) → you administer via recovery-mode cycles. Plan a dedicated `sysadmin@` principal anyway (harmless, and for the future when the build allows it).

---

## 2. PHASE 1 — Verify the box can actually do mail (before building anything)

**Goal:** kill the two classic showstoppers *first* — you do NOT want to discover them after a full build.

### 2a. Outbound port 25 (can we send at all?)
```bash
ssh igf-tools 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25 && head -c 200 <&3; echo EXIT:$?'
```
**Verify:** you get a real `220 mx.google.com ESMTP … gsmtp` banner. Read the banner only — send nothing (no EHLO/MAIL FROM). Contabo unblocks 25 per-account; confirm in writing via ticket if unsure.

### 2b. Inbound reachability (can the world reach our ports?)
Outbound-open ≠ inbound-open. Prove inbound with throwaway listeners + probe from **two** vantage points (your machine may have ISP-blocked 25):
```bash
# open firewall (additive; never touch existing rules — SSH stays on 22)
ssh igf-tools 'ufw allow in 25/tcp; ufw allow in 465/tcp; ufw allow in 587/tcp; ufw allow in 993/tcp'
# box: python listener on all 4 ports for ~90s, logs which got hit
ssh igf-tools 'python3 -c "import socket,select,time
ss=[socket.socket() for _ in range(4)]
for s,p in zip(ss,[25,465,587,993]): s.setsockopt(1,2,1); s.bind((\"0.0.0.0\",p)); s.listen(4)
end=time.time()+90
while time.time()<end:
 r,_,_=select.select(ss,[],[],2)
 for s in r: c,a=s.accept(); print(\"HIT\",s.getsockname()[1],a[0],flush=True); c.close()" &'
# probe from your Mac AND from a datacenter box:
for P in 25 465 587 993; do nc -vz -G6 BOX_IP $P; done
```
**Verify:** all 4 ports connect from an off-box vantage. If 25 inbound is filtered → open a Contabo ticket before proceeding.

---

## 3. PHASE 2 — DNS + PTR foundation (Cloudflare + Contabo)

**Goal:** FCrDNS (forward+reverse both resolve to the box), DMARC reporting, and a DNS-only mail A record. **SMTP/IMAP cannot ride a Cloudflare tunnel/proxy** — `MAIL_HOST` must be a **grey-cloud (DNS-only) A record** straight to the IP.

### 3a. Cloudflare records (via API — token = a full-access zone token in Keychain `cf-igrowfast-api`)
```bash
TOKEN=$(security find-generic-password -s cf-igrowfast-api -w); ZONE=<zone-id>; CF=https://api.cloudflare.com/client/v4
# mail A (DNS-ONLY / proxied:false — critical)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$CF/zones/$ZONE/dns_records" \
  --data '{"type":"A","name":"mail","content":"BOX_IP","ttl":300,"proxied":false}'
# DMARC: if already p=reject, DO NOT drop to p=none on a live domain — just ADD rua reporting
curl -s -X PATCH ... "$CF/zones/$ZONE/dns_records/<dmarc-rec-id>" \
  --data '{"content":"v=DMARC1; p=reject; rua=mailto:dmarc-reports@DOMAIN"}'
```
**Trap:** the auto-mode classifier may **block** compound commands that mix a credential-read with a production write; also blocked reading the CF token + writing. If blocked, split into atomic steps and/or get the user to authorize. Never route around a denial.

### 3b. Reverse DNS (PTR) via Contabo API — **the cntb CLI CANNOT do PTR**
Creds from `my.contabo.com/api/details` (ClientId, ClientSecret, API User, API **password** = separate field). Store in Keychain `contabo-igf-*`.
```bash
CID=$(security find-generic-password -s contabo-igf-client-id -w); CSEC=…; AUSER=…; APASS=…
TOKEN=$(curl -s -d "client_id=$CID" -d "client_secret=$CSEC" --data-urlencode "username=$AUSER" \
  --data-urlencode "password=$APASS" -d grant_type=password \
  'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
# PTR for an existing IPv4 address = PUT (POST is IPv6-only per the spec!). x-request-id header is REQUIRED.
curl -s -X PUT "https://api.contabo.com/v1/dns/ptrs/BOX_IP" -H "Authorization: Bearer $TOKEN" \
  -H "x-request-id: $(uuidgen)" -H 'Content-Type: application/json' --data '{"ptr":"MAIL_HOST"}'   # returns 204
```
**Verify FCrDNS both ways:** `dig +short A MAIL_HOST @1.1.1.1` == BOX_IP **and** `dig +short -x BOX_IP @1.1.1.1` == `MAIL_HOST.`

### 3c. (Optional) mint a scoped DNS-01 token for lego
The zone token can't mint at `/user/tokens` (needs user-level auth → error 9109). Use the **account** endpoint:
```bash
# permission group ids: DNS Write=4755a26eedb94da69e1066d98aa820be, Zone Read=c8fed203ed3043cba015a93ad1616f1f
curl -s -X POST -H "Authorization: Bearer $FULL_TOKEN" "$CF/accounts/$ACCT/tokens" --data '{
 "name":"mail-acme-dns01",
 "policies":[{"effect":"allow","resources":{"com.cloudflare.api.account.zone.<ZONE>":"*"},
   "permission_groups":[{"id":"4755a26eedb94da69e1066d98aa820be"},{"id":"c8fed203ed3043cba015a93ad1616f1f"}]}]}'
# verify scope: token should see exactly 1 zone. Store result in Keychain, never print it.
```

---

## 4. PHASE 3 — Deploy Stalwart (bootstrap in RECOVERY mode)

**Goal:** container running, `stalwart-cli` authenticated. **Boot recovery FROM THE FIRST BOOT** (trap #5).

```bash
ssh igf-tools 'mkdir -p /opt/igf-mail/data/etc /opt/igf-mail/data/lib && chmod 700 /opt/igf-mail'
# config.json = ONE datastore object (NOT toml)
echo '{"@type":"RocksDb","path":"/var/lib/stalwart"}' | ssh igf-tools 'cat > /opt/igf-mail/data/etc/config.json'
# container runs as UID 2000 → bind-mounts MUST be chowned or RocksDB "Permission denied"
ssh igf-tools 'chown -R 2000:2000 /opt/igf-mail/data'
```
`/opt/igf-mail/docker-compose.yml`:
```yaml
name: igf-mail
services:
  stalwart:
    image: stalwartlabs/stalwart:v0.16
    restart: unless-stopped
    hostname: mail.igrowfast.com
    ports: ["25:25","465:465","587:587","993:993","127.0.0.1:8080:8080"]  # 8080 loopback = admin/JMAP; NO public 80/443
    volumes: ["./data/etc:/etc/stalwart","./data/lib:/var/lib/stalwart"]
    env_file: .env
    security_opt: ["no-new-privileges:true"]
    networks: [mail]
networks: {mail: {driver: bridge}}
```
`/opt/igf-mail/.env` (mode 600) — **generate an ALPHANUMERIC recovery password** (special chars caused encoding pain):
```
STALWART_RECOVERY_MODE=1
STALWART_RECOVERY_ADMIN=admin:<32-char alnum, in Keychain stalwart-recovery-admin>
STALWART_HEALTHCHECK_URL=http://127.0.0.1:8080/healthz/live
```
> **Traps:** default healthcheck hits `:443` (which we don't run) → container flaps; override to `:8080` as above. Recovery mode serves the mgmt API as **plain HTTP on :8080** (normal mode = HTTPS on :443, self-signed). If you ever get 401 with the recovery admin, the DB was init'd in normal mode → `docker compose down && rm -rf data/lib/* && chown -R 2000:2000 data && up`.

```bash
ssh igf-tools 'cd /opt/igf-mail && docker compose up -d && sleep 8'
# install stalwart-cli on the box (separate binary; NOT in the server image)
ssh igf-tools 'cd /tmp && curl -sL https://github.com/stalwartlabs/cli/releases/download/v1.0.10/stalwart-cli-x86_64-unknown-linux-gnu.tar.xz -o s.txz && tar xf s.txz && install -m755 */stalwart-cli /usr/local/bin/'
# auth test — base64 MUST be -w0 (trailing newline corrupts the header)
PW=$(security find-generic-password -s stalwart-recovery-admin -w)
ssh igf-tools "STALWART_URL=http://127.0.0.1:8080 STALWART_USER=admin STALWART_PASSWORD='$PW' stalwart-cli describe" | head
```
**Verify:** `describe` lists ~117 object types. The full schema is cached at `/root/.cache/stalwart-cli/*/schema-*.json` — grep it for exact field/variant names when the CLI's `describe` isn't enough.

---

## 5. PHASE 4 — Configure via one `apply` plan (NDJSON)

**Goal:** domain, DKIM, listeners, CORS, throttle, accounts — one idempotent plan.

**Apply-op envelope (verified):** NDJSON, one op/line. Ops: `create|update|upsert|destroy`. `upsert` = `{"@type":"upsert","object":"<Type>","matchOn":["<key>"],"value":{"<clientId>":{...}}}`; `#<clientId>` back-references resolve across later lines (and inside set keys). Singletons use `update` (no matchOn/clientId). **`map<>` fields REPLACE wholesale on patch** — never touch `SystemSettings.services` (wipes the other 7 entries). Durations are integer **milliseconds**.

**Tagged-union shapes you WILL need (hard-won):**
- Secret/token value: `{"@type":"Value","secret":"<token>"}` (variant name `Value`)
- Cert PEM: `certificate:{"@type":"Text","value":"<pem>"}`, key: `privateKey:{"@type":"Text","secret":"<pem>"}`
- `DnsServer` Cloudflare: `{"@type":"Cloudflare","secret":{"@type":"Value","secret":"<cf-token>"},…}`
- `AcmeProvider`: `challengeType:"Dns01"`, `contact:{"mailto:postmaster@DOMAIN":true}`, `renewBefore:"R23"`
- `Domain`: `certificateManagement:{"@type":"Automatic","acmeProviderId":"#..","subjectAlternativeNames":{"MAIL_HOST":true}}`, `dkimManagement:{"@type":"Automatic","algorithms":{"Dkim1Ed25519Sha256":true,"Dkim1RsaSha256":true}}`, `dnsManagement:{"@type":"Automatic","dnsServerId":"#..","publishRecords":{"dkim":true}}`
- `NetworkListener`: `bind:{"0.0.0.0:25":true,"[::]:25":true}`, `protocol` ∈ `smtp|imap|http|…`, `useTls`/`tlsImplicit` booleans
- `Http` singleton CORS: only knob is `usePermissiveCors:true` (no allow-list; scope at the CF edge if needed)
- `MtaOutboundThrottle`: `{"key":{},"rate":{"count":20,"period":60000}}` (empty key = one global bucket)
- Account: `{"@type":"User","name":"app","domainId":"#dom","roles":{"@type":"Custom","roleIds":{"#role":true}},"credentials":{"0":{"@type":"Password","secret":"<pw>"}},"aliases":{"0":{"name":"postmaster","domainId":"#dom"}}}`
- Role (least-priv sender): `{"enabledPermissions":{"authenticate":true,"emailSend":true}}`

> **DNS-publish safety (VERIFY THIS):** `publishRecords:{"dkim":true}` makes Stalwart write **only** the 2 DKIM TXT (+ transient `_acme-challenge`) to CF — **never SPF/MX/DMARC**. `publishRecords` is a `set<DnsRecordType>` (`dkim,tlsa,spf,mx,dmarc,mtaSts,tlsRpt,caa,…`); empty set is rejected. Diff CF before/after first boot to CONFIRM only DKIM was added — this is what protects a live domain's MX/SPF during the build.
>
> **Account/password gotchas:** passwords pass a **zxcvbn strength check** (weak = rejected); use 24-char random. Aliases with hyphens are fine (`dmarc-reports`); principal *names* — keep them hyphen-free (`noreply`, not `no-reply`) to be safe.
>
> **NetworkListeners:** in normal boot Stalwart inserts default listeners; make the plan authoritative with a leading `{"@type":"destroy","object":"NetworkListener"}` then create exactly: smtp:25, submission:587 (STARTTLS), submissions:465 (implicit TLS), imaps:993 (implicit TLS), http:8080. No 143/pop3/public-443.

Build `plan.ndjson` with placeholders `__CF_TOKEN__`/`__PW_*__`, then apply substituting real secrets **via stdin** (never in argv):
```bash
ssh igf-tools 'cat /opt/igf-mail/plan.ndjson' | sed -e "s#__CF_TOKEN__#$CF#" -e "s#__PW_APP__#$PA#" … \
  | ssh igf-tools "STALWART_URL=… STALWART_USER=admin STALWART_PASSWORD='$PW' stalwart-cli apply --stdin"
```
**Verify:** `Done: N created (0 failed)`. If an alias `primaryKeyViolation` on rerun (stale state from a prior partial apply) → wipe `data/lib`, reboot recovery, apply once clean.

---

## 6. PHASE 5 — Resolver fix + cert (lego) + DKIM dual-sign

### 6a. Fix the resolver FIRST (trap #1) — before anything DNS-dependent
```bash
stalwart-cli update DnsResolver --json '{"@type":"Cloudflare","attempts":2,"concurrency":2,"enableEdns":true,"tcpOnError":true,"timeout":5000,"preserveIntermediates":true}'
```

### 6b. Cert via lego (native ACME is dead — trap #2)
```bash
# install lego v5
ssh igf-tools 'cd /tmp && curl -sL https://github.com/go-acme/lego/releases/download/v5.2.2/lego_v5.2.2_linux_amd64.tar.gz | tar xz lego && install -m755 lego /usr/local/bin/'
# ALL flags after `run`; MUST override resolvers to public (box resolver NXDOMAINs the self-check)
CF_DNS_API_TOKEN="$CF" lego run --path /opt/igf-mail/lego --dns cloudflare \
  --dns.resolvers 1.1.1.1:53 --dns.resolvers 8.8.8.8:53 --accept-tos \
  --email postmaster@DOMAIN --domains MAIL_HOST --key-type EC256
```
Install the cert into Stalwart (recovery mode) + set default:
```bash
python3 -c "import json;print(json.dumps({'certificate':{'@type':'Text','value':open('…/MAIL_HOST.crt').read()},'privateKey':{'@type':'Text','secret':open('…/MAIL_HOST.key').read()}}))" \
  | stalwart-cli create Certificate --stdin      # note the returned id
stalwart-cli update SystemSettings --field defaultCertificateId=<cert-id>
```
**Verify (normal mode):** `echo | openssl s_client -connect MAIL_HOST:465 -servername MAIL_HOST 2>/dev/null | openssl x509 -noout -issuer -subject` → `issuer=…Let's Encrypt`, `subject=CN=MAIL_HOST`.

### 6c. DKIM dual-sign (trap #6)
After first NORMAL boot, Stalwart publishes 2 DKIM TXT but the **RSA key gets stuck `stage:pending`** (couldn't confirm publication — the resolver bug, now fixed) so it signs **Ed25519 only** → Gmail `dkim=neutral (no key)`. Force RSA active:
```bash
stalwart-cli query DkimSignature          # find the Dkim1RsaSha256 row's id
stalwart-cli update DkimSignature <rsa-id> --field stage=active   # DkimRotationStage: active|pending|retiring|retired
# verify BOTH show "published in DNS and used for signing"
```
**Verify at Gmail** (send a real test): headers show `dkim=pass … s=v1-rsa-…` (Ed25519 may still be `neutral` — fine, any pass = DKIM pass).

---

## 7. PHASE 6 — Boot NORMAL, prove it end-to-end

Remove `STALWART_RECOVERY_MODE=1` from `.env`, `docker compose up -d --force-recreate`. Then:
```bash
# listeners bound?
ssh igf-tools 'ss -tlnp | grep -E ":25|:465|:587|:993"'          # 4 public + 127.0.0.1:8080
ssh igf-tools 'exec 3<>/dev/tcp/127.0.0.1/25 && head -1 <&3'      # 220 MAIL_HOST Stalwart ESMTP
# send a REAL rendered template as app@ (SMTP_SSL 465) to Gmail + Proton + a mail-tester address
# check Gmail "Show original": spf=pass, dkim=pass (rsa), dmarc=pass
# mail-tester → aim 9-10/10 (the only likely -1 = missing List-Unsubscribe; transactional-exempt)
```
**Trap — logging is invisible by default:** the default `Log`-type tracer writes to a *file*, not stdout, and the `Log` store is empty. To see ACME/TLS activity, create a **Stdout tracer**: `stalwart-cli create Tracer --json '{"@type":"Stdout","enable":true,"level":"debug"}'` then read `docker logs`.

**TESTING DISCIPLINE (do NOT skip — protects Gmail reputation, trap #9).** Validate in this ORDER, and do not advance until the current step is green:
1. **mail-tester.com** — send to its throwaway address, aim 9–10/10. It scores auth + content + blacklists and trains **nothing** you care about. This is your primary gate.
2. **ProtonMail** — lenient, DANE-validating; a safe "does a real MUA accept it" check. Landing here clean ≠ Gmail will (Gmail is stricter), but it confirms the message itself is fine.
3. **Your own IMAP mailbox on the new server** — round-trip send/receive once webmail/IMAP is up.
4. **Gmail — LAST, and only once 1–3 are all green.** Send ONE, sparingly, and immediately "Report not spam" if it lands in spam. Each early spam-fold to Gmail is a lasting reputation hit on the domain+IP (cross-account). Never loop-send tests to Gmail hoping for a different result — resending does not change reputation; it reinforces the bad pattern.

**Deliverability truth:** perfect auth ≠ inbox. A brand-new IP still starts in **spam** (reputation). It warms up via: consistent low volume, real engaged recipients, "Report not spam", Google Postmaster + MS SNDS. Don't blast; don't send to unverified addresses.

---

## 8. OPERATIONS

### 8a. Admin access — recovery ADMIN (not a recovery cycle)
> **CORRECTION 2026-07-19:** the recovery cycle is NOT needed. The `STALWART_RECOVERY_ADMIN=admin:<pw>`
> credential is honored over `/api` in **normal mode** (verified: `get/query/create/update/delete` all
> work with it against `127.0.0.1:8080` while running normally). Administer with those creds directly —
> no `.env` flip, no recreate, no downtime. What still 403s is a *normal principal* with an Admin role;
> the recovery admin is the working path. (Original text kept below for context, now superseded.)

~~Normal-mode `/api` always 403s (even full 415-perm role). To administer: flip `.env` to recovery, `up --force-recreate`, run `stalwart-cli`, flip back. Mail listeners are down during recovery (~90s).~~

### 8b. Cert auto-renewal (PROVEN — now ZERO-DOWNTIME)
> **CORRECTION 2026-07-19:** renewal no longer uses a recovery cycle. Since the recovery admin works in
> normal mode (§8a), the script re-imports the cert live: `lego run` → `stalwart-cli update Certificate <id>`
> → `stalwart-cli create Action/ReloadTlsCertificates` (hot reload). No recovery mode, no container
> recreate, no mail blip. If webmail shares the compose (see `SELFHOST_WEBMAIL_BLUEPRINT.md`), any
> `docker compose` action MUST be scoped to the `stalwart` service so it never bounces webmail.

`lego run` self-skips when >30d remain (no rate-limit waste). A weekly systemd timer runs a script that: checks expiry (openssl) → `lego run` → **if the cert file changed**, re-imports live + hot-reloads TLS. Test by forcing: `rm` the cert files, `lego run` (fresh issue), re-import, verify the new `notBefore` is served. See `/opt/igf-mail/renew-cert.sh` (+ `.bak-recoverycycle-*` for the old design) + `igf-mail-cert-renew.timer`.

### 8c. Backups
Config under `/opt` is auto-covered by the existing restic→R2 chain. **Mail DATA (RocksDB) is NOT consistency-safe by file copy** — add a pre-restic `stalwart --export` (or snapshot) step and do a restore drill before go-live.

---

## 9. CUTOVER — PROVEN (executed 2026-07-19; Hostinger fully retired from the mail path)

Only after the server is proven (mail-tester ≥9, Gmail/Proton pass). Two independent halves — inbound (MX) and outbound (app senders) — cut over separately.

### 9a. INBOUND — flip MX to a SINGLE record
- `MX` → **`10 MAIL_HOST`** only. **Use a SINGLE MX, not a backup.** A backup MX at the old provider would `550`-bounce mail during any brief outage (the old mailboxes no longer exist there); a single MX makes senders **queue and retry** for days — strictly safer. Priority number is irrelevant with one MX.
- Verify with a REAL external delivery (from another box, over the internet, to the MX): a spoofed-sender test correctly lands in **Junk** (DNSBL/Pyzor) — that proves inbound + spam-filtering + local delivery all work. A properly-authenticated sender lands in Inbox.
- A banned sending IP returns TCP `EOF` → cloudflared reports **502** (not 403); origin answering `307` on a direct curl while the tunnel 502s is the ban signature.

### 9b. OUTBOUND — switch the app's senders (email_accounts + Vault)
- Passwords live in **Postgres Vault**, not the `email_accounts` row (`password_secret_id` → `vault.secrets`). Never write `email_accounts.password`/`vault.secrets` directly. Use the app's SECURITY DEFINER RPCs (service_role/postgres): **`update_email_account(...)`** (FULL-row overwrite — pass EVERY field or it nulls them; rotates the Vault password only when a non-empty password is passed) and **`create_email_account(...)`** (mints uuid + Vault secret atomically).
- Per sender: `smtp_host=MAIL_HOST, smtp_port=465, smtp_security='ssl'` (TEXT col, CHECK in ssl/tls/starttls/none — `ssl`=implicit TLS on 465), `username=<full email>` (Stalwart AUTH user = full address).
- **Rename trap:** if renaming a sender (e.g. `no-reply@`→`noreply@`), change `email_address` AND `username` **together** — nodemailer authenticates with `username`; change the address alone and SMTP AUTH fails silently. Safe because the app resolves the sender by **UUID id**, never by name/address (so the rename breaks zero code lookups + template bindings).
- **Revert safety (mandatory):** capture the old provider passwords (`get_email_account_secret(id)` → keychain) BEFORE rotating — Vault rotation is destructive. Revert = `update_email_account` back to the old host + saved password.
- **Reputation:** this moves customer mail to a COLD IP → expect Gmail spam-foldering until warmed. Flip a dormant/canary sender first, watch, then the rest. Verify each with a real SMTP AUTH+envelope test (235+250, `RSET` before DATA — no message sent) and `get_email_account_secret==keychain`.

### 9c. DNS hardening after cutover
- Delete the old provider's DKIM CNAMEs (`<provider>mail-*._domainkey`).
- Harden SPF to **`v=spf1 ip4:BOX_IP -all`** (drop the provider include; `-all` = reject anything not your IP; DMARC already `p=reject`). **KEEP the provider records only if you want a fast revert window; we cut clean.**
- **After a static-asset change served via Cloudflare, PURGE the CF cache** (`POST purge_cache {files:[url]}`) or the edge serves the stale copy.

### 9d. Still deferred (owner-gated)
- MTA-STS (policy at `https://mta-sts.DOMAIN/.well-known/mta-sts.txt` via tunnel, `testing`→`enforce`) + TLS-RPT.
- `imapsync` old mail off the retired host.
- List-Unsubscribe header for bulk templates (→ mail-tester 10/10).

---

## 11. OUTBOUND-IP & IPv6 (the Docker trap)

- **The box has an IPv6, but Dockerized Stalwart is IPv4-ONLY** — the Docker bridge network has no IPv6 egress, so Stalwart tries a remote's IPv6 MX, gets `connect-error`, and falls back to IPv4 every time. So `SPF ip4:… -all` (no `ip6:`) is CORRECT — do NOT add `ip6:` for an address it never sends from.
- **DO NOT pin `MtaConnectionStrategy.sourceIps` to the host's public IP.** The container's local address is a bridge IP (172.x); Docker NATs egress. Binding the outbound socket to the host public IP fails inside the container (`connect-error` on EVERY delivery) — it broke all outbound for ~2 min until reverted. Leave `sourceIps` empty; Docker NAT handles it. (If you ever want true dual-stack: AAAA for `mail`, IPv6 PTR at the provider, then `ip6:` in SPF — never send IPv6 without a PTR or receivers spam it harder than IPv4.)

## 12. BIMI (brand logo in the inbox)

- **Prereq met:** DMARC at enforcement (`p=quarantine`/`p=reject`) + aligned SPF/DKIM.
- **Logo = SVG Tiny Portable/Secure** (NOT plain SVG): root `version="1.2" baseProfile="tiny-ps"` + `xmlns`, **square** `viewBox`, exactly one `<title>` as first child, **solid opaque background** (no transparency), vector-only (no `<image>`/`<script>`/`<filter>`/`<mask>`/animation/external refs/fonts), text→paths, UTF-8/LF, ≤32 KB. **Size the logo to fit the AVATAR CIRCLE** (fit its diagonal to ~0.9× the circle), not the square — clients crop to a circle and clip corner content. Recipe used: PNG → 2-color masks (PIL) → `potrace -s` each → assemble with a solid bg rect + centered/scaled groups → validate → host over HTTPS.
- **Self-asserted record (FREE, do now):** `default._bimi.DOMAIN TXT "v=BIMI1; l=https://…/logo.svg;"` (no `a=`). Shows on **Yahoo/AOL/Fastmail** immediately.
- **Gmail + Apple need a mark certificate** referenced by `a=`. Buy a **CMC** (Common Mark Certificate, ~$650–1,100/yr, DigiCert/GlobalSign/SSL.com) — **no trademark**, just 12+ months of prior logo use. NOT a VMC unless the Gmail blue check is worth a 12–18-month trademark. (Entrust EXITED mark certs in 2025 — don't use it.) Then add `a=<cmc.pem url>`.
- **Display is reputation-gated** (Gmail/Yahoo suppress it on cold reputation even when valid) and **your own self-hosted webmail never shows BIMI** — Bulwark et al. show a **DuckDuckGo favicon** (`icons.duckduckgo.com/ip3/<domain>.ico`) or initials, which is NOT BIMI. Test BIMI only at Yahoo/Gmail/Apple.

---

## 10. ONE-LINE SYMPTOM → CAUSE → FIX INDEX

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied … /var/lib/stalwart/LOG` | bind-mount owned by root | `chown -R 2000:2000 data` |
| recovery admin → 401 | DB first-init'd in normal mode | wipe `data/lib`, reboot recovery |
| `/api` → 403 with full perms | mgmt reserved to recovery admin | use recovery-mode cycle |
| cert stays self-signed, no ACME logs | native ACME never orders | use lego |
| lego `flag not defined: -path` | v5: flags go AFTER `run`; no `renew` cmd | `lego run --path … ` |
| lego `dns01: NXDOMAIN _acme-challenge` | box resolver negative-caches new records | `--dns.resolvers 1.1.1.1:53` |
| Gmail `dkim=neutral (no key)` | Ed25519-only; Gmail won't verify it | force RSA key `stage=active` → dual-sign |
| RSA DKIM stuck `pending` | resolver couldn't confirm publication | fix `DnsResolver`→Cloudflare, then force active |
| `550 5.7.1 not authorized to use this service` | built-in `User` role can't send | dedicated role with `authenticate`+`emailSend` |
| CF token mint fails `9109` | `/user/tokens` needs user-level auth | mint at `/accounts/{acct}/tokens` |
| Contabo PTR POST fails | POST is IPv6-only | use `PUT /v1/dns/ptrs/{ip}` + `x-request-id` |
| docker logs empty in normal mode | default tracer is a file, not stdout | create `Stdout` tracer at `debug` |
| compound command blocked | classifier flags cred-write+prod-restart | split into atomic steps / get authorization |
| email logo broken image | URL points at apex (now a different site) | fix to the host that serves the asset (200); verify with curl |
| EVERY mailbox JMAP 403 / SMTP `550` | built-in `User` role → empty `Authentication.defaultRoles` → zero perms | build a `mail-user` Custom role (all user-facing perms) + assign to each mailbox |
| tunnel host 502, `EOF` in cloudflared, origin 307 on direct curl | Stalwart auto-banned the shared tunnel IP (scanBanPaths `*../*`, permanent) | allowlist the docker subnet (`AllowedIp <net>/16`) + `create Action/ReloadBlockedIps` |
| ban deleted but still 502 | in-memory blocklist not evicted | `create Action/ReloadBlockedIps` (deleting the row alone doesn't) |
| `services`/IMAP/SMTP autoconfig entries vanish after a patch | `map<>` fields REPLACE wholesale | re-send the FULL map, or use `--field a/b/c=…` JSON-pointer form |
| ALL outbound `connect-error` after pinning `sourceIps` | container can't bind the host's public IP (Docker NAT) | leave `sourceIps` empty |
| `useXForwarded=true` trusts a forged `X-Forwarded-For` | Stalwart reads leftmost XFF (client-controlled) | keep `false`, or overwrite XFF=`cf.connecting_ip` at the CF edge first, then verify |
| static asset still stale after origin update | Cloudflare cached it | `POST purge_cache {files:[url]}` |
| BIMI logo not in your own webmail | self-hosted webmail has no BIMI (shows favicon/initials) | test only at Gmail/Yahoo/Apple |

---
*Companion (client side): `SELFHOST_WEBMAIL_BLUEPRINT.md` — Bulwark on JMAP (browser talks JMAP DIRECT to Stalwart, needs `usePermissiveCors:true` + JMAP reachable via the tunnel). Deferred-hardening scripts: `docs/ops/webmail-hardening/`.*
