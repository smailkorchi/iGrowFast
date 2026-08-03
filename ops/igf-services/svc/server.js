// igf-svc — the ONLY web-facing half of the self-hosted services stack (T18).
//   GET  /healthz            liveness
//   GET  /lookup?ip=<ip>     GeoIP city lookup (DB-IP City Lite mmdb)
//   POST /v0/check_email     strict wrapper in front of Reacher
//
// Reacher itself is NOT reachable from nginx (compose keeps it on the internal
// `svc` network only). Everything Reacher accepts beyond `to_email` — proxy,
// from_email, hello_name, smtp_port — is an attack surface: a token holder could
// aim its SMTP/SOCKS connections at arbitrary hosts or spoof our mail identity.
// This wrapper accepts ONE field, builds the upstream request itself, refuses
// domains whose mail hosts resolve into private space, and caps concurrency so
// probe volume can never threaten the mail server that shares this VPS's IP.
const http = require('http');
const net = require('net');
const dns = require('dns').promises;
const maxmind = require('maxmind');

const REACHER_URL = process.env.REACHER_URL || 'http://igf-reacher:8080';
const REACHER_SECRET = process.env.SVC_TOKEN || '';
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT || 2);
const MAX_BODY = 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

let reader = null;
let inflight = 0;

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);   // CGNAT
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8')
      || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
  }
  return false;
}

// Resolve the domain's mail hosts and refuse if ANY lands in private space —
// an attacker-controlled MX pointing at loopback/container IPs would otherwise
// turn Reacher into an internal port scanner.
async function targetAllowed(domain) {
  let hosts = [];
  try {
    hosts = (await dns.resolveMx(domain)).map((m) => m.exchange);
  } catch { /* no MX — Reacher falls back to the domain's own A/AAAA */ }
  if (!hosts.length) hosts = [domain];
  for (const host of hosts) {
    let addrs = [];
    for (const fn of ['resolve4', 'resolve6']) {
      try { addrs = addrs.concat(await dns[fn](host)); } catch { /* ignore */ }
    }
    if (addrs.some(isBlockedIp)) return false;
  }
  return true;
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function checkEmail(req, res) {
  if (inflight >= MAX_INFLIGHT) return send(res, 429, { error: 'busy' });
  let raw = '';
  let tooBig = false;
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) { tooBig = true; break; }
  }
  if (tooBig) return send(res, 413, { error: 'body too large' });

  let email;
  try { email = JSON.parse(raw)?.to_email; } catch { return send(res, 400, { error: 'invalid json' }); }
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: 'invalid to_email' });
  }
  if (!(await targetAllowed(email.split('@')[1].toLowerCase()))) {
    return send(res, 400, { error: 'blocked_target' });
  }

  inflight++;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(`${REACHER_URL}/v0/check_email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-reacher-secret': REACHER_SECRET },
        body: JSON.stringify({ to_email: email }),   // identity comes from Reacher's own env
        signal: ac.signal,
      });
      if (!r.ok) return send(res, 502, { error: 'verifier unavailable' });
      const j = await r.json();
      // Only what callers need — SMTP internals stay inside.
      return send(res, 200, {
        input: j.input,
        is_reachable: j.is_reachable,
        misc: { is_disposable: j.misc?.is_disposable ?? null, is_role_account: j.misc?.is_role_account ?? null },
        mx: { accepts_mail: j.mx?.accepts_mail ?? null },
      });
    } finally { clearTimeout(t); }
  } catch {
    return send(res, 502, { error: 'verifier unavailable' });
  } finally { inflight--; }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }

  if (u.pathname === '/v0/check_email') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return void checkEmail(req, res);
  }

  if (u.pathname === '/lookup') {
    if (!reader) return send(res, 503, { error: 'db not loaded' });
    const ip = (u.searchParams.get('ip') || '').trim();
    if (!ip || net.isIP(ip) === 0) return send(res, 400, { error: 'invalid ip' });
    let r = null;
    try { r = reader.get(ip); } catch { /* fall through to empty result */ }
    // DB-IP lite city names carry verbose parentheticals
    // ("Casablanca (Préfecture d'Arrondissements d'Aïn Chock)") — strip for clean email strings.
    return send(res, 200, {
      city: (r?.city?.names?.en || '').replace(/\s*\(.*\)\s*$/, ''),
      region: r?.subdivisions?.[0]?.names?.en || '',
      country_name: r?.country?.names?.en || '',
      country_code: r?.country?.iso_code || '',
    });
  }

  send(res, 404, { error: 'not found' });
}).listen(8080);

maxmind.open('/data/dbip-city-lite.mmdb')
  .then((r) => { reader = r; console.log('igf-svc ready'); })
  .catch((e) => { console.error('mmdb load failed:', e.message); process.exit(1); });
