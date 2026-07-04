#!/usr/bin/env python3
"""igf-backup-agent — Tier A backup control agent (read + trigger + presigned download).

Runs as the unprivileged `igf-agent` user, bound to 127.0.0.1:8787, exposed only
through a dedicated host-level cloudflared tunnel (backup-api.igrowfast.com).

Auth model (every /api/* request):
  1. Bearer JWT verified locally: ES256 ONLY (alg allowlist), kid matched against
     the GoTrue JWKS (disk-cached at /etc/igf-backup-agent/jwks.json by a root
     ExecStartPre so auth still works when the Supabase stack is down), signature
     verified via openssl, exp/iss/aud checked.
  2. `sub` must be an ACTIVE user with users.backup_admin = true — checked live
     in the DB via the root helper (sudo, exact-command), cached 60s.
  3. POST endpoints additionally require the `aal` claim to be `aal2` (TOTP).
Privilege boundary: this process holds no docker/DB credentials. Root-side reads
run through /usr/local/bin/igf-agent-helper (argv whitelist) via sudoers; job
triggers are `systemctl start <unit>` for a fixed unit map, also via sudoers.
R2 credentials here are the READ-ONLY igf-db-backups token (presign/list only).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIND = os.environ.get("IGF_AGENT_BIND", "127.0.0.1")
PORT = int(os.environ.get("IGF_AGENT_PORT", "8787"))
ISSUER = os.environ.get("IGF_JWT_ISS", "https://api.igrowfast.com/auth/v1")
JWKS_FILE = os.environ.get("IGF_JWKS_FILE", "/etc/igf-backup-agent/jwks.json")
JWKS_URL = os.environ.get("IGF_JWKS_URL", ISSUER + "/.well-known/jwks.json")
# Comma-separated allowlist. The response echoes back the caller's Origin only if
# it is in this set (else the first entry — which won't match, so the browser
# blocks it). localhost entries let the owner test from the Vite dev server.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "IGF_ALLOWED_ORIGINS", "https://app.igrowfast.com").split(",") if o.strip()]
R2_ENDPOINT = os.environ["IGF_R2_ENDPOINT"]  # host only, no scheme
R2_BUCKET = os.environ.get("IGF_R2_BUCKET", "igf-db-backups")
R2_AK = os.environ["IGF_R2_RO_ACCESS_KEY"]
R2_SK = os.environ["IGF_R2_RO_SECRET_KEY"]
AUDIT = os.environ.get("IGF_AGENT_AUDIT", "/var/log/igf-backup/agent-audit.log")
HELPER = "/usr/local/bin/igf-agent-helper"

TRIGGER_UNITS = {
    "pgdump": "igf-pgdump.service",
    "pitr-incr": "igf-pgbackrest-incr.service",
    "pitr-full": "igf-pgbackrest-full.service",
    "pitr-verify": "igf-pgbackrest-verify.service",
    "restic": "igf-restic.service",
    "storage-mirror": "igf-storage-mirror.service",
    "restore-drill": "igf-restore-drill.service",
}
DOWNLOAD_KEY_RE = re.compile(
    r"^logical/(RESTORE_RUNBOOK\.md|[0-9]{4}/[0-9]{2}/[0-9]{8}T[0-9]{6}Z/[A-Za-z0-9._-]+)$"
)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

_admin_cache: dict[str, tuple[float, bool]] = {}
_rate: dict[str, list[float]] = {}
_lock = threading.Lock()


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


_jwks_cache: dict[str, bytes] = {}  # kid -> SPKI PEM
_jwks_ts = 0.0


def _jwk_to_pem(jwk: dict) -> bytes:
    """P-256 JWK -> SubjectPublicKeyInfo PEM (pure ASN.1 framing, no curve math)."""
    x = b64url_decode(jwk["x"]).rjust(32, b"\x00")
    y = b64url_decode(jwk["y"]).rjust(32, b"\x00")
    spki = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200") + b"\x04" + x + y
    b64 = base64.b64encode(spki).decode()
    lines = "\n".join(b64[i:i + 64] for i in range(0, len(b64), 64))
    return f"-----BEGIN PUBLIC KEY-----\n{lines}\n-----END PUBLIC KEY-----\n".encode()


def _load_jwks(force_remote: bool = False):
    global _jwks_ts
    docs = []
    if force_remote:
        try:
            with urllib.request.urlopen(JWKS_URL, timeout=10) as r:
                docs.append(json.loads(r.read()))
        except Exception:
            pass
    try:
        with open(JWKS_FILE) as f:
            docs.append(json.load(f))
    except OSError:
        pass
    with _lock:
        for doc in docs:
            for k in doc.get("keys", []):
                if k.get("kty") == "EC" and k.get("crv") == "P-256" and k.get("kid"):
                    _jwks_cache[k["kid"]] = _jwk_to_pem(k)
        _jwks_ts = time.time()


def _pubkey_for(kid: str):
    with _lock:
        pem = _jwks_cache.get(kid)
    if pem is None and time.time() - _jwks_ts > 60:  # unknown kid: refresh (rate-limited)
        _load_jwks(force_remote=True)
        with _lock:
            pem = _jwks_cache.get(kid)
    return pem


def _sig_raw_to_der(sig: bytes) -> bytes:
    def enc_int(b: bytes) -> bytes:
        b = b.lstrip(b"\x00") or b"\x00"
        if b[0] & 0x80:
            b = b"\x00" + b
        return b"\x02" + bytes([len(b)]) + b
    body = enc_int(sig[:32]) + enc_int(sig[32:])
    return b"\x30" + bytes([len(body)]) + body


def verify_jwt(token: str):
    """Return verified claims dict, or None. ES256-only, JWKS kid match."""
    import tempfile
    try:
        h_b64, p_b64, s_b64 = token.split(".")
        header = json.loads(b64url_decode(h_b64))
        if header.get("alg") != "ES256" or not header.get("kid"):
            return None
        pem = _pubkey_for(header["kid"])
        if pem is None:
            return None
        sig = b64url_decode(s_b64)
        if len(sig) != 64:
            return None
        with tempfile.TemporaryDirectory() as td:
            pub, der, dat = f"{td}/pub.pem", f"{td}/sig.der", f"{td}/data"
            open(pub, "wb").write(pem)
            open(der, "wb").write(_sig_raw_to_der(sig))
            open(dat, "wb").write(f"{h_b64}.{p_b64}".encode())
            r = subprocess.run(["openssl", "dgst", "-sha256", "-verify", pub,
                                "-signature", der, dat],
                               capture_output=True, timeout=10)
            if r.returncode != 0:
                return None
        claims = json.loads(b64url_decode(p_b64))
        if claims.get("exp", 0) < time.time():
            return None
        if claims.get("iss") != ISSUER:
            return None
        aud = claims.get("aud")
        if not (aud == "authenticated" or (isinstance(aud, list) and "authenticated" in aud)):
            return None
        sub = claims.get("sub", "")
        if not UUID_RE.match(sub):
            return None
        return claims
    except Exception:
        return None


def is_backup_admin(sub: str) -> bool:
    now = time.time()
    with _lock:
        hit = _admin_cache.get(sub)
        if hit and now - hit[0] < 60:
            return hit[1]
    try:
        out = subprocess.run(
            ["sudo", "-n", HELPER, "check-admin", sub],
            capture_output=True, text=True, timeout=15,
        )
        ok = out.returncode == 0 and out.stdout.strip() == "true"
    except Exception:
        ok = False
    with _lock:
        _admin_cache[sub] = (now, ok)
    return ok


def rate_ok(key: str, limit: int = 60, window: int = 60) -> bool:
    now = time.time()
    with _lock:
        hits = [t for t in _rate.get(key, []) if now - t < window]
        hits.append(now)
        _rate[key] = hits
        return len(hits) <= limit


def audit(entry: dict):
    entry["ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        with open(AUDIT, "a") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except OSError:
        pass


# ---- SigV4 presigned GET (R2) -------------------------------------------------
def presign_get(key: str, expires: int = 600) -> str:
    t = datetime.now(timezone.utc)
    amz_date = t.strftime("%Y%m%dT%H%M%SZ")
    datestamp = t.strftime("%Y%m%d")
    region = "auto"
    scope = f"{datestamp}/{region}/s3/aws4_request"
    path = f"/{R2_BUCKET}/" + urllib.parse.quote(key, safe="/-_.~")
    params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{R2_AK}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    qs = "&".join(f"{k}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(params.items()))
    creq = f"GET\n{path}\n{qs}\nhost:{R2_ENDPOINT}\n\nhost\nUNSIGNED-PAYLOAD"
    sts = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"

    def hkey(key_b: bytes, msg: str) -> bytes:
        return hmac.new(key_b, msg.encode(), hashlib.sha256).digest()

    k = hkey(hkey(hkey(hkey(b"AWS4" + R2_SK.encode(), datestamp), region), "s3"), "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    return f"https://{R2_ENDPOINT}{path}?{qs}&X-Amz-Signature={sig}"


def s3_list(prefix: str, max_keys: int = 400) -> list[dict]:
    """Signed ListObjectsV2 with the RO token; returns [{key,size,modified}]."""
    t = datetime.now(timezone.utc)
    amz_date = t.strftime("%Y%m%dT%H%M%SZ")
    datestamp = t.strftime("%Y%m%d")
    scope = f"{datestamp}/auto/s3/aws4_request"
    q = {"list-type": "2", "max-keys": str(max_keys), "prefix": prefix}
    qs = "&".join(f"{k}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(q.items()))
    path = f"/{R2_BUCKET}"
    payload_hash = hashlib.sha256(b"").hexdigest()
    headers = {"host": R2_ENDPOINT, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    signed = ";".join(sorted(headers))
    canon_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    creq = f"GET\n{path}\n{qs}\n{canon_headers}\n{signed}\n{payload_hash}"
    sts = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"

    def hkey(key_b: bytes, msg: str) -> bytes:
        return hmac.new(key_b, msg.encode(), hashlib.sha256).digest()

    k = hkey(hkey(hkey(hkey(b"AWS4" + R2_SK.encode(), datestamp), "auto"), "s3"), "aws4_request")
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    auth = (f"AWS4-HMAC-SHA256 Credential={R2_AK}/{scope},"
            f"SignedHeaders={signed},Signature={sig}")
    req = urllib.request.Request(
        f"https://{R2_ENDPOINT}{path}?{qs}",
        headers={"Authorization": auth, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
    import xml.etree.ElementTree as ET
    root = ET.fromstring(body)
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    out = []
    for c in root.iter(f"{ns}Contents"):
        out.append({
            "key": c.findtext(f"{ns}Key"),
            "modified": c.findtext(f"{ns}LastModified"),
            "size": int(c.findtext(f"{ns}Size") or 0),
        })
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "igf-backup-agent"
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # silence default stderr access log; audit log covers it
        pass

    def _cors(self):
        origin = self.headers.get("Origin", "")
        allow = origin if origin in ALLOWED_ORIGINS else ALLOWED_ORIGINS[0]
        self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, code: int, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _client(self) -> str:
        return self.headers.get("CF-Connecting-IP", self.client_address[0])

    def _auth(self, need_aal2: bool = False):
        """Returns claims or None (response already sent)."""
        if not rate_ok(self._client()):
            self._json(429, {"error": "rate_limited"})
            return None
        tok = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        claims = verify_jwt(tok) if tok else None
        if not claims:
            self._json(401, {"error": "unauthorized"})
            return None
        if not is_backup_admin(claims["sub"]):
            audit({"sub": claims["sub"], "path": self.path, "denied": "not_backup_admin"})
            self._json(403, {"error": "forbidden"})
            return None
        if need_aal2 and claims.get("aal") != "aal2":
            audit({"sub": claims["sub"], "path": self.path, "denied": "aal2_required"})
            self._json(403, {"error": "aal2_required",
                             "detail": "two-factor (TOTP) session required for this action"})
            return None
        return claims

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/health":
            return self._json(200, {"ok": True})
        if url.path == "/api/status":
            claims = self._auth()
            if not claims:
                return
            try:
                out = subprocess.run(["sudo", "-n", HELPER, "status-json"],
                                     capture_output=True, text=True, timeout=60)
                data = json.loads(out.stdout) if out.returncode == 0 else {"error": "helper_failed"}
            except Exception as e:
                data = {"error": f"status_failed: {e.__class__.__name__}"}
            audit({"sub": claims["sub"], "path": url.path, "ok": "error" not in data})
            return self._json(200 if "error" not in data else 502, data)
        if url.path == "/api/backups":
            claims = self._auth()
            if not claims:
                return
            try:
                objs = s3_list("logical/")
                sets: dict[str, dict] = {}
                for o in objs:
                    m = re.match(r"logical/(\d{4}/\d{2}/(\d{8}T\d{6}Z))/(.+)$", o["key"])
                    if not m:
                        continue
                    s = sets.setdefault(m.group(2), {"stamp": m.group(2), "files": [], "bytes": 0})
                    s["files"].append({"name": m.group(3), "size": o["size"], "key": o["key"]})
                    s["bytes"] += o["size"]
                data = {"sets": sorted(sets.values(), key=lambda s: s["stamp"], reverse=True)}
                audit({"sub": claims["sub"], "path": url.path, "sets": len(sets)})
                return self._json(200, data)
            except Exception as e:
                return self._json(502, {"error": f"list_failed: {e.__class__.__name__}"})
        if url.path == "/api/download":
            claims = self._auth()
            if not claims:
                return
            key = (urllib.parse.parse_qs(url.query).get("key") or [""])[0]
            if not DOWNLOAD_KEY_RE.match(key):
                return self._json(400, {"error": "invalid_key"})
            audit({"sub": claims["sub"], "path": url.path, "key": key})
            return self._json(200, {"url": presign_get(key), "expires_sec": 600})
        return self._json(404, {"error": "not_found"})

    def _body(self, limit=4096):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > limit:
                return {}
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)

        # --- restore: dry-run plan (read-only, aal2) ---
        if url.path == "/api/restore/plan":
            claims = self._auth(need_aal2=True)
            if not claims:
                return
            body = self._body()
            target = body.get("target_iso") or ""
            if target and not re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}", str(target)):
                return self._json(400, {"error": "bad_target"})
            arg = str(target).replace("T", " ").replace("Z", "+00")[:25] if target else ""
            try:
                out = subprocess.run(
                    ["sudo", "-n", HELPER, "restore-plan", arg or "-"],
                    capture_output=True, text=True, timeout=60)
                data = json.loads(out.stdout) if out.returncode == 0 else {"error": "plan_failed"}
            except Exception as e:
                data = {"error": f"plan_failed: {e.__class__.__name__}"}
            audit({"sub": claims["sub"], "path": url.path, "target": arg, "ok": "error" not in data})
            return self._json(200 if "error" not in data else 502, data)

        # --- restore: execute (destructive-capable, aal2, server re-validates every gate) ---
        if url.path == "/api/restore":
            claims = self._auth(need_aal2=True)
            if not claims:
                return
            body = self._body()
            target = str(body.get("target_iso") or "")
            confirm = str(body.get("confirm_timestamp") or "")
            if body.get("safety_backup") is not True:
                return self._json(400, {"error": "safety_backup_required"})
            if target and not re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}", target):
                return self._json(400, {"error": "bad_target"})
            arg = target.replace("T", " ").replace("Z", "+00")[:25] if target else "-"
            try:
                out = subprocess.run(
                    ["sudo", "-n", HELPER, "restore-start", arg, confirm or "-"],
                    capture_output=True, text=True, timeout=20)
                ok = out.returncode == 0
                resp = json.loads(out.stdout) if out.stdout.strip().startswith("{") else {}
            except Exception:
                ok, resp = False, {}
            audit({"sub": claims["sub"], "path": url.path, "target": arg,
                   "mode": resp.get("mode"), "started": ok})
            if ok:
                return self._json(202, {"started": True, "mode": resp.get("mode"),
                                        "note": resp.get("note", "restore runs async; watch /api/status")})
            return self._json(502, {"error": "restore_start_failed",
                                    "detail": (out.stderr or out.stdout or "")[:300]})

        m = re.match(r"^/api/trigger/([a-z-]+)$", url.path)
        if not m:
            return self._json(404, {"error": "not_found"})
        job = m.group(1)
        unit = TRIGGER_UNITS.get(job)
        if not unit:
            return self._json(400, {"error": "unknown_job", "jobs": sorted(TRIGGER_UNITS)})
        claims = self._auth(need_aal2=True)
        if not claims:
            return
        try:
            out = subprocess.run(["sudo", "-n", "/usr/bin/systemctl", "start", unit],
                                 capture_output=True, text=True, timeout=15)
            ok = out.returncode == 0
        except Exception:
            ok = False
        audit({"sub": claims["sub"], "path": url.path, "unit": unit, "started": ok})
        if ok:
            return self._json(202, {"started": unit,
                                    "note": "job runs async; watch /api/status"})
        return self._json(502, {"error": "start_failed", "detail": (out.stderr or "")[:300]})


if __name__ == "__main__":
    _load_jwks(force_remote=True)
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    srv.serve_forever()
