// @ts-nocheck
// Shared email-deliverability checks used by the invitation flow.
//  preValidate: cheap, free, no-network (syntax + common-typo + disposable-domain).
//  verifyDeliverable: mailbox-level via our self-hosted Reacher endpoint (SVC_BASE_URL/SVC_TOKEN);
//    only a hard "invalid" verdict blocks — "safe"/"risky"/"unknown"/HTTP error/timeout/unconfigured
//    all fail open. Reacher performs its own MX checks, so there is no separate DNS fallback layer.
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

// Mailbox-level verification via our self-hosted Reacher endpoint.
// Returns "safe"|"invalid"|"risky"|"unknown"|null (null = unconfigured/HTTP error/timeout).
async function reacherClassify(email) {
  const base = Deno.env.get("SVC_BASE_URL");
  const token = Deno.env.get("SVC_TOKEN");
  if (!base || !token) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(`${base}/verify/v0/check_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Svc-Token": token,
      },
      body: JSON.stringify({ to_email: email }),
      signal: ac.signal,
    });
    if (!r.ok) { console.error("reacher status", r.status); return null; }
    const j = await r.json();
    return j?.is_reachable ?? null;
  } catch (e) {
    console.error("reacher error:", e);
    return null;
  } finally { clearTimeout(t); }
}

// Full deliverability decision. Returns { ok:true, email } or { ok:false, reason }.
export async function verifyDeliverable(email) {
  const verdict = await reacherClassify(email);
  if (verdict === "invalid") return { ok: false, reason: "undeliverable" };
  return { ok: true, email };
}
