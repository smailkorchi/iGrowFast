# igf-mail ops — DKIM DNS sync

Stalwart (toolbox `ssh igf-tools`, `/opt/igf-mail`) runs **automatic DKIM management**:
it generates signing keys and rotates them every 90 days. It cannot write to our
Cloudflare zone, so a rotation leaves it signing with a selector that does not exist
in DNS.

That is not hypothetical. The 2026-07-18 rotation did exactly this: the new RSA
selector was never published, and because **Google does not verify ed25519
signatures**, the RSA signature was the only one Gmail could check. Google Postmaster
recorded DKIM at 95.92% on 25 July and **0.00% from 26 July onward**, while DMARC
still read 100% because SPF alone kept it aligned — under `p=reject`, that left one
mechanism standing, so any forwarded mail would have been rejected outright. Nothing
on the server reported a problem; it believed the key was published.

`dkim-dns-sync.py` closes that loop. It reads Stalwart's signers over the JMAP admin
API, takes the ones whose `stage` is `active`, and upserts a matching TXT record per
selector into Cloudflare. Deployed to `/opt/igf-mail/dkim-dns-sync.py`, run daily by
`/etc/cron.d/igf-dkim-sync` (04:20), logging to `/var/log/igf-dkim-sync.log`.

- **Never deletes.** A retired key must keep verifying mail still in flight; an
  over-eager cleanup causes the outage it is meant to prevent. Stale records are
  reported and left alone.
- **Refuses to act on an empty read.** If Stalwart returns no signers, or none
  active, it exits non-zero rather than touching DNS.
- Credentials: Stalwart admin from `/opt/igf-mail/.env` (`STALWART_RECOVERY_ADMIN`,
  formatted `user:pass`), Cloudflare token from `/root/.cf-dns-token` (chmod 600).

## The Cloudflare token

**Never put a multi-zone or account-wide token on this host.** It is a mail server
exposed on 25/465/587/993; a token reaching every zone turns a mail compromise into
DNS control over every domain on the account. The owner's general token reaches three
zones plus account resources and must never live here.

Installed token: **`igf-toolbox-dkim-dns`** (id `077096877d8dadf898f437db6ac4e1b6`) —
DNS:Write + Zone:Read on igrowfast.com only, IP-conditioned to 37.60.250.211.
Verified confinement: sees 1 zone, 404 on other zones, 404 on token creation, and
403 when used from any other IP.

### Minting a scoped token from the API

Cloudflare's `/user/tokens/*` endpoints reject API tokens outright ("Valid user-level
authentication not found", code 9109) — that is not a permissions problem and no amount
of scope fixes it. **Account-owned tokens are created under `/accounts/{account_id}/tokens`,
and that works with the general token.**

```
ACC=$(curl -s -H "Authorization: Bearer $CF" \
      https://api.cloudflare.com/client/v4/accounts | jq -r .result[0].id)
# permission group ids (stable): DNS Write 4755a26eedb94da69e1066d98aa820be
#                                Zone Read c8fed203ed3043cba015a93ad1616f1f
curl -X POST -H "Authorization: Bearer $CF" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/tokens" -d '{
    "name": "igf-toolbox-dkim-dns",
    "policies": [{ "effect": "allow",
      "resources": { "com.cloudflare.api.account.zone.<ZONE_ID>": "*" },
      "permission_groups": [{"id":"4755a26eedb94da69e1066d98aa820be"},
                            {"id":"c8fed203ed3043cba015a93ad1616f1f"}] }],
    "condition": { "request.ip": { "in": ["37.60.250.211/32"] } } }'
```

The value is returned **once**, in `result.value`. Write it straight to the host:
`ssh igf-tools 'umask 077; cat > /root/.cf-dns-token'`.

### IPv6 trap

An IP-conditioned token fails with a bare **403** if the host reaches Cloudflare over
IPv6 — the toolbox prefers IPv6 (`2a02:c207:...`) and only matches the IPv4 condition
when forced. The script pins itself to IPv4 for this reason; keep that, rather than
widening the token to a /64. When debugging by hand, use `curl -4`.