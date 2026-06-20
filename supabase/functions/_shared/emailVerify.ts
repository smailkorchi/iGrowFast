// @ts-nocheck
// Shared email-deliverability checks used by the invitation flow.
//  preValidate: cheap, free, no-network (syntax + common-typo + disposable-domain).
//  verifyDeliverable: mailbox-level via Verifalia when VERIFALIA_USERNAME/PASSWORD are set
//    (only a hard "Undeliverable" blocks; Deliverable/Risky/Unknown pass), else falls back to
//    a DNS-over-HTTPS MX/A/AAAA domain check (fail-open on inconclusive DNS).
// Used by signup-email (registrant OTP gate) and create-invitation (admin-typed invitee email),
// so both flows share one source of truth.

// Known disposable / throwaway domains — blocked outright.
const DISPOSABLE = new Set([
  "mailinator.com", "10minutemail.com", "10minutemail.net", "guerrillamail.com", "guerrillamail.info", "grr.la",
  "yopmail.com", "yopmail.fr", "temp-mail.org", "tempmail.com", "tempmailo.com", "throwawaymail.com",
  "getnada.com", "nada.email", "dispostable.com", "trashmail.com", "trashmail.de", "sharklasers.com",
  "guerrillamailblock.com", "spam4.me", "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com",
  "fakeinbox.com", "tempinbox.com", "emailondeck.com", "mailcatch.com", "33mail.com", "tempr.email",
  "discard.email", "spambog.com", "mytemp.email", "mailtemp.net", "burnermail.io", "moakt.com",
  "tmail.ws", "tmpmail.org", "luxusmail.org", "inboxkitten.com", "anonbox.net", "minuteinbox.com",
  "mailpoof.com", "1secmail.com", "1secmail.org", "1secmail.net", "vmani.com", "emltmp.com",
  "tempmailaddress.com", "spamgourmet.com", "jetable.org", "wegwerfmail.de",
]);

// Common domain typos -> canonical. Drives the "Did you mean …?" hint.
const TYPO_FIX = {
  "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com",
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmaill.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.comm": "gmail.com", "gmail.ckm": "gmail.com", "gmal.com": "gmail.com",
  "hotmail.con": "hotmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.cm": "hotmail.com", "homail.com": "hotmail.com",
  "outlook.con": "outlook.com", "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com",
  "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "yhaoo.com": "yahoo.com", "icloud.con": "icloud.com", "iclod.com": "icloud.com", "live.con": "live.com",
};

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Cheap, free, no-network pre-checks. Returns { ok, email } or { ok:false, reason, suggestion? }.
export function preValidate(emailRaw) {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid_email" };
  const domain = email.split("@")[1];
  if (TYPO_FIX[domain]) return { ok: false, reason: "typo", suggestion: `${email.split("@")[0]}@${TYPO_FIX[domain]}` };
  if (DISPOSABLE.has(domain)) return { ok: false, reason: "disposable" };
  return { ok: true, email };
}

const DNS_TYPE = { MX: 15, A: 1, AAAA: 28 };
async function dohHas(domain, type) {
  // true = records exist, false = authoritatively absent, null = inconclusive.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: ac.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.Status === 3) return false;       // NXDOMAIN
    if (j.Status !== 0) return null;         // SERVFAIL/REFUSED/etc — inconclusive
    return Array.isArray(j.Answer) && j.Answer.some((a) => a.type === DNS_TYPE[type]);
  } catch { return null; } finally { clearTimeout(t); }
}

// Mailbox-level verification via Verifalia. Returns "Deliverable"|"Risky"|"Undeliverable"|"Unknown"|null.
async function verifaliaClassify(email) {
  const u = Deno.env.get("VERIFALIA_USERNAME");
  const p = Deno.env.get("VERIFALIA_PASSWORD");
  if (!u || !p) return null;
  const quality = Deno.env.get("VERIFALIA_QUALITY") || "Standard";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch("https://api.verifalia.com/v2.7/email-validations?waitTime=15000", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${u}:${p}`),
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ entries: [{ inputData: email }], quality }),
      signal: ac.signal,
    });
    if (r.status !== 200) { if (r.status !== 202) console.error("verifalia status", r.status); return "Unknown"; }
    const j = await r.json();
    const arr = Array.isArray(j?.entries) ? j.entries : (j?.entries?.data ?? []);
    return arr[0]?.classification || "Unknown";
  } catch (e) {
    console.error("verifalia error:", e);
    return "Unknown";
  } finally { clearTimeout(t); }
}

// Full deliverability decision. Returns { ok:true, email } or { ok:false, reason }.
export async function verifyDeliverable(email) {
  const cls = await verifaliaClassify(email);
  if (cls !== null) {
    if (cls === "Undeliverable") return { ok: false, reason: "undeliverable" };
    return { ok: true, email };
  }
  const domain = email.split("@")[1];
  const mx = await dohHas(domain, "MX");
  if (mx === true || mx === null) return { ok: true, email };
  const a = await dohHas(domain, "A");
  if (a === true || a === null) return { ok: true, email };
  const aaaa = await dohHas(domain, "AAAA");
  if (aaaa === true || aaaa === null) return { ok: true, email };
  return { ok: false, reason: "no_mx" };
}
