# igf-services — self-hosted email verification + GeoIP (T18, Notion Ref 12)

Replaces two paid APIs with services we run on the toolbox VPS (37.60.250.211, `ssh igf-tools`):

| Was | Now |
|---|---|
| Verifalia (`api.verifalia.com`, paid key) | **Reacher** — live SMTP mailbox verification |
| ipgeolocation.io (paid key in Vault) | **DB-IP City Lite** mmdb read by our own `igf-svc` |
| `dns.google` DoH MX fallback | gone — Reacher does its own MX resolution |

Google Fonts was retired in the same ticket, but that lives in the SPA (`@fontsource` + `public/fonts/`), not here.

## Shape

```
edge functions (.102 box)
      │  https://app.igrowfast.com/_svc/{geo,verify}/…   header X-Svc-Token
      ▼
cloudflared → nginx (igf-frontend)        ← token gate + rate limits live here
      ▼
   igf-svc  ──internal only──▶  igf-reacher
   (geo lookups + verify wrapper)
```

`igf-svc` is the only container on the web-facing docker network. Reacher's raw API is
never exposed: it accepts per-request `proxy` / `from_email` / `hello_name` / `smtp_port`
overrides, which would let a token holder aim its connections at arbitrary hosts or spoof
our mail identity. The wrapper forwards exactly one field (`to_email`), refuses domains whose
mail hosts resolve into private/loopback/CGNAT space (Reacher would otherwise be an internal
port scanner via attacker-controlled MX), caps in-flight probes, and trims the response.

## Files

- `docker-compose.yml` — both services; Reacher pinned by digest; no published ports.
- `svc/` — the Node service (`npm ci` from the committed lockfile).
- `update-geoip.sh` — monthly DB refresh; validates the candidate mmdb with a real lookup
  before it replaces the live file and rolls back if the service doesn't come back healthy.
- `nginx-svc.conf.snippet` — source of truth for the `/_svc/*` blocks in the frontend nginx conf.

## Deployed layout (box)

`/opt/igf-services/{docker-compose.yml,svc/,data/,update-geoip.sh,.env}` — `.env` holds
`SVC_TOKEN` (chmod 600), the same value in the nginx map and in the edge runtime's
`functions.env` on the .102 box. `/etc/cron.d/igf-geoip` runs the refresh on day 3, 04:00.
`data/` is re-downloadable — a backup-exclusion candidate.

## Licensing

- Reacher backend: AGPL-3.0 — internal self-host use, not resold or offered as a service.
- DB-IP City Lite: CC BY 4.0, attribution to db-ip.com required where results are displayed.
  Swapping to MaxMind GeoLite2 is a file swap (same `.mmdb` format) plus a URL change in
  `update-geoip.sh`; it needs a free MaxMind account and gives slightly better city precision.

## Known bounds

Reacher's SMTP probes leave from the same public IP as the production Stalwart mail server.
The rate limits above bound that volume deliberately. If verification volume ever grows
beyond signup traffic — or mail reputation drifts — move Reacher behind its own egress IP.
