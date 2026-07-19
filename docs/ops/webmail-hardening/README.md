# Webmail hardening — deferred, optional (defense-in-depth)

Current state is already secure: the shared-tunnel-IP self-DoS is fixed (subnet allowlist),
XFF spoofing is closed (`useXForwarded=false`), and all 11 mailboxes have 32-char random
passwords (spray infeasible). These scripts add per-attacker IP banning on the public JMAP
surface. Full rationale in `../../SELFHOST_WEBMAIL_BLUEPRINT.md` §4d.

**Do NOT enable `useXForwarded=true` without step 1 first** — alone it is spoofable (a client
can forge `X-Forwarded-For` and Stalwart trusts the leftmost value).

## 1. Make the CF edge authoritative (run from the Mac; reads token from Keychain `cf-igrowfast-api`)
```bash
zsh docs/ops/webmail-hardening/cf-apply-xff.sh
```
Creates a Cloudflare Transform Rule on `jmap.igrowfast.com` that overwrites `X-Forwarded-For`
with `cf.connecting_ip` (the unspoofable client IP CF sees).

## 2. Turn on real-IP banning in Stalwart (on the box)
```bash
ssh igf-tools 'cd /opt/igf-mail; export STALWART_USER=admin \
  STALWART_PASSWORD=$(grep "^STALWART_RECOVERY_ADMIN=" .env | sed "s/.*admin://") \
  STALWART_URL=http://127.0.0.1:8080; \
  stalwart-cli update Http --json "{\"useXForwarded\":true}"; \
  stalwart-cli create Action/ReloadSettings'
```

## 3. VERIFY spoof-resistance (mandatory — do not skip)
```bash
PW=$(security find-generic-password -s stalwart-pw-ismailelqorchi -w)
curl -s --resolve jmap.igrowfast.com:443:104.21.33.135 -H "X-Forwarded-For: 203.0.113.66" \
  -u "ismailelqorchi@igrowfast.com:$PW" https://jmap.igrowfast.com/jmap/session -o /dev/null
ssh igf-tools 'docker logs igf-mail-stalwart-1 --since 30s 2>&1 | grep request-url | tail -1'
```
The logged request-level `remoteIp` MUST be your real IP, NOT `203.0.113.66`.
If it shows the forged value, REVERT immediately:
```bash
ssh igf-tools 'cd /opt/igf-mail; export STALWART_USER=admin \
  STALWART_PASSWORD=$(grep "^STALWART_RECOVERY_ADMIN=" .env | sed "s/.*admin://") \
  STALWART_URL=http://127.0.0.1:8080; \
  stalwart-cli update Http --json "{\"useXForwarded\":false}"; \
  stalwart-cli create Action/ReloadSettings'
```

## Also (low priority): tighten the JMAP ingress path
Change the tunnel ingress `jmap.igrowfast.com` path rules from `^/jmap` / `^/dav` to
`^/jmap($|/)` / `^/dav($|/)` so `/jmapfoo` can't prefix-bleed to Stalwart's router.
Cosmetic — the audit confirmed no data is reachable through it.
