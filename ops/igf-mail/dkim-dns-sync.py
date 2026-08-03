#!/usr/bin/env python3
"""Publish Stalwart's ACTIVE DKIM public keys into Cloudflare DNS.

Why this exists: Stalwart runs "automatic DKIM management" — it generates and
rotates signing keys on its own (every 90 days) — but it cannot write to our
Cloudflare zone. On 2026-07-18 it rotated, published nothing, and kept signing
with an RSA selector that did not exist in DNS. Google cannot verify ed25519
signatures, so the RSA one is the only signature Gmail can check: DKIM went to
0% for eight days and DMARC survived on SPF alone under a p=reject policy.
Nothing on the server noticed, because from its point of view everything was fine.

This closes the loop: whatever Stalwart is currently signing with is what ends up
in DNS. It runs daily, so a rotation is corrected within a day rather than
discovered weeks later in someone else's dashboard.

Deliberately never DELETES a record. A retired key must keep verifying for mail
still in flight, and an over-eager cleanup is how you cause the outage you were
trying to prevent. Stale records are reported, not removed.

Exit codes: 0 = in sync (with or without changes), 1 = something failed.
Cron: /etc/cron.d/igf-dkim-sync
"""
import json
import subprocess
import sys
import urllib.request

STALWART_URL = "http://127.0.0.1:8080"
ENV_FILE = "/opt/igf-mail/.env"
CF_TOKEN_FILE = "/root/.cf-dns-token"
CF_API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "d333333"  # Stalwart's admin pseudo-account for config objects

K_BY_TYPE = {"Dkim1RsaSha256": "rsa", "Dkim1Ed25519Sha256": "ed25519"}


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def read_secret(path, prefix=None):
    try:
        with open(path) as fh:
            body = fh.read()
    except OSError as exc:
        if path == CF_TOKEN_FILE:
            fail(
                f"cannot read {path}: {exc}\n"
                "  This host must hold a Cloudflare token scoped to DNS:Edit on igrowfast.com\n"
                "  ONLY (never a multi-zone or account-wide token — this is a mail server).\n"
                "  Create it at Cloudflare > My Profile > API Tokens > Create Token >\n"
                "  Edit zone DNS, Zone Resources = Include > Specific zone > igrowfast.com,\n"
                "  Client IP Address Filtering = Is in > 37.60.250.211, then:\n"
                "    ssh igf-tools 'umask 077; cat > /root/.cf-dns-token'   # paste, then Ctrl-D\n"
                "  Until then DKIM DNS is NOT being kept in sync with key rotation."
            )
        fail(f"cannot read {path}: {exc}")
    if prefix is None:
        return body.strip()
    for line in body.splitlines():
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    fail(f"{prefix} not found in {path}")


def jmap(admin, calls):
    req = urllib.request.Request(
        f"{STALWART_URL}/jmap/",
        data=json.dumps({"using": ["urn:stalwart:jmap"], "methodCalls": calls}).encode(),
        headers={"Content-Type": "application/json"},
    )
    import base64
    req.add_header("Authorization", "Basic " + base64.b64encode(admin.encode()).decode())
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def cf(token, method, path, payload=None):
    req = urllib.request.Request(
        f"{CF_API}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.load(resp)
    if not body.get("success"):
        fail(f"cloudflare {method} {path}: {body.get('errors')}")
    return body


def main():
    admin = read_secret(ENV_FILE, "STALWART_RECOVERY_ADMIN=")
    token = read_secret(CF_TOKEN_FILE)

    # 1. Every DKIM signer Stalwart knows about, plus the domains they belong to.
    resp = jmap(admin, [
        ["x:DkimSignature/query", {"accountId": ACCOUNT_ID}, "0"],
        ["x:DkimSignature/get", {"accountId": ACCOUNT_ID,
                                 "#ids": {"resultOf": "0", "name": "x:DkimSignature/query", "path": "/ids"}}, "1"],
        ["x:Domain/query", {"accountId": ACCOUNT_ID}, "2"],
        ["x:Domain/get", {"accountId": ACCOUNT_ID,
                          "#ids": {"resultOf": "2", "name": "x:Domain/query", "path": "/ids"}}, "3"],
    ])
    signers, domains = [], {}
    for call in resp.get("methodResponses", []):
        if call[0] == "x:DkimSignature/get":
            signers = call[1].get("list", [])
        elif call[0] == "x:Domain/get":
            for d in call[1].get("list", []):
                domains[d["id"]] = d.get("name") or d.get("domain")
    if not signers:
        fail("Stalwart returned no DKIM signers — refusing to touch DNS")

    # 2. Only what is actually signing mail right now. A 'retired' signer keeps its
    #    existing DNS record (see module docstring) but must never overwrite an active one.
    active = [s for s in signers if s.get("stage") == "active"]
    if not active:
        fail("no ACTIVE DKIM signer found — refusing to touch DNS")

    zone_cache = {}
    changes = 0
    for s in active:
        domain = domains.get(s.get("domainId"))
        k = K_BY_TYPE.get(s.get("@type"))
        if not domain or not k or not s.get("publicKey") or not s.get("selector"):
            print(f"SKIP: incomplete signer {s.get('id')} (domain={domain} type={s.get('@type')})")
            continue

        name = f"{s['selector']}._domainkey.{domain}"
        content = f"v=DKIM1; k={k}; h=sha256; p={s['publicKey']}"

        if domain not in zone_cache:
            zones = cf(token, "GET", f"/zones?name={domain}")["result"]
            if not zones:
                print(f"SKIP: {domain} is not a zone on this Cloudflare account")
                continue
            zone_cache[domain] = zones[0]["id"]
        zone = zone_cache[domain]

        existing = cf(token, "GET", f"/zones/{zone}/dns_records?type=TXT&name={name}")["result"]
        payload = {"type": "TXT", "name": name, "content": content, "ttl": 3600,
                   "comment": f"Stalwart DKIM {k} (auto-synced; rotates {s.get('nextTransitionAt')})"}

        if not existing:
            cf(token, "POST", f"/zones/{zone}/dns_records", payload)
            print(f"CREATED {name} ({k})")
            changes += 1
        else:
            # Cloudflare returns TXT content quoted; compare on the unquoted value.
            current = existing[0]["content"].strip('"')
            if current != content:
                cf(token, "PUT", f"/zones/{zone}/dns_records/{existing[0]['id']}", payload)
                print(f"UPDATED {name} ({k}) — key had changed")
                changes += 1
            else:
                print(f"ok {name} ({k})")
            for extra in existing[1:]:
                print(f"NOTE: duplicate TXT at {name} (id {extra['id']}) — left in place, review manually")

    # 3. Report retired selectors that still resolve. Informational only.
    for s in signers:
        if s.get("stage") != "active":
            domain = domains.get(s.get("domainId"), "?")
            print(f"note: retired signer {s.get('selector')} ({domain}) — its DNS record is left alone on purpose")

    print(f"done: {len(active)} active signer(s), {changes} DNS change(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
