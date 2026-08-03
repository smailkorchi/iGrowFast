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
  Consider narrowing that token to Zone:DNS:Edit on igrowfast.com only.

Next scheduled rotation: **2026-10-16** (`nextTransitionAt` on the active signers).
That is the date this job earns its keep — check the log around then.

Verification: `dig +short TXT <selector>._domainkey.igrowfast.com`, or send yourself
mail and use Gmail's "Show original" (DKIM should PASS on the rsa selector). Google
Postmaster's Authentication tab is the external canary, roughly a day behind.
