// @ts-nocheck
// Admin-gated: mints a single-use invitation for self-registration.
// The caller must be a super admin / admin; the invite is scoped to THEIR business.
// The raw token is returned ONCE (in the link); only its sha256 is stored.
//
// Invitee email is OPTIONAL and NEVER blocks creation: if provided and well-formed it is
// stored (so the link/reminders/revocation can be emailed); if missing the invite is still
// created and the email can be supplied later from the remind/revoke flow.
// `action:'check_email'` is a side-effect-free deliverability probe for the modal (never 400s).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TARGET_ROLES = ["super admin", "admin", "commercial", "courier", "mediabuyer"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

function preValidate(emailRaw) {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "invalid_email" };
  const domain = email.split("@")[1];
  if (TYPO_FIX[domain]) return { ok: false, reason: "typo", suggestion: `${email.split("@")[0]}@${TYPO_FIX[domain]}` };
  if (DISPOSABLE.has(domain)) return { ok: false, reason: "disposable" };
  return { ok: true, email };
}

const DNS_TYPE = { MX: 15, A: 1, AAAA: 28 };
async function dohHas(domain, type) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: ac.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.Status === 3) return false;
    if (j.Status !== 0) return null;
    return Array.isArray(j.Answer) && j.Answer.some((a) => a.type === DNS_TYPE[type]);
  } catch { return null; } finally { clearTimeout(t); }
}
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
      headers: { "Authorization": "Basic " + btoa(`${u}:${p}`), "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ entries: [{ inputData: email }], quality }),
      signal: ac.signal,
    });
    if (r.status !== 200) { if (r.status !== 202) console.error("verifalia status", r.status); return "Unknown"; }
    const j = await r.json();
    const arr = Array.isArray(j?.entries) ? j.entries : (j?.entries?.data ?? []);
    return arr[0]?.classification || "Unknown";
  } catch (e) { console.error("verifalia error:", e); return "Unknown"; } finally { clearTimeout(t); }
}
async function verifyDeliverable(email) {
  const cls = await verifaliaClassify(email);
  if (cls !== null) return cls === "Undeliverable" ? { ok: false, reason: "undeliverable" } : { ok: true, email };
  const domain = email.split("@")[1];
  for (const type of ["MX", "A", "AAAA"]) {
    const has = await dohHas(domain, type);
    if (has === true || has === null) return { ok: true, email };
  }
  return { ok: false, reason: "no_mx" };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { data: me, error: meErr } = await service
      .from("users").select('role, "DigiCom Business", active').eq("id", user.id).single();
    if (meErr || !me) return json({ error: "Profile not found" }, 403);
    if (me.active === false) return json({ error: "Account disabled" }, 403);
    if (!["super admin", "admin"].includes(String(me.role))) {
      return json({ error: "Only admins can invite users" }, 403);
    }
    const businessId = me["DigiCom Business"];
    if (!businessId) return json({ error: "Your account is not attached to a business" }, 400);

    const body = await req.json().catch(() => ({}));

    // Side-effect-free deliverability probe for the modal. NEVER 400s — UX hint only.
    if (String(body?.action ?? "") === "check_email") {
      try {
        const pre = preValidate(body?.email);
        if (!pre.ok) return json({ ok: false, deliverable: false, reason: pre.reason, suggestion: pre.suggestion }, 200);
        const deep = await verifyDeliverable(pre.email);
        if (!deep.ok) return json({ ok: false, deliverable: false, reason: deep.reason }, 200);
        return json({ ok: true, deliverable: true }, 200);
      } catch (e) {
        return json({ ok: false, deliverable: false, reason: "error", detail: (e as Error).message }, 200);
      }
    }

    const targetRole = String(body?.target_role ?? "");
    if (!ALLOWED_TARGET_ROLES.includes(targetRole)) return json({ error: "Invalid target role" }, 400);
    if (me.role === "admin" && targetRole === "super admin") {
      return json({ error: "Admins cannot invite super admins" }, 403);
    }

    // Email is OPTIONAL — store it only if well-formed. Creation is NEVER blocked by the email.
    const raw = String(body?.email ?? "").trim().toLowerCase();
    let email = null;
    if (raw) { const pre = preValidate(raw); if (pre.ok) email = pre.email; }

    const profilePayload = body?.profile_payload && typeof body.profile_payload === "object"
      ? body.profile_payload : {};
    const expiresInDays = Math.min(Math.max(parseInt(String(body?.expires_in_days ?? 7), 10) || 7, 1), 30);
    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") ?? "");

    const token = generateToken();
    const tokenHash = await sha256Hex(token);

    const { data: inv, error: insErr } = await service.from("user_invitations").insert({
      token_hash: `\\x${tokenHash}`,
      target_role: targetRole,
      business_id: businessId,
      profile_payload: profilePayload,
      email,
      created_by: user.id,
      expires_at: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    }).select("id, target_role, expires_at, email").single();
    if (insErr) return json({ error: insErr.message }, 400);

    return json({
      ok: true,
      id: inv.id,
      target_role: inv.target_role,
      expires_at: inv.expires_at,
      email: inv.email,
      token,
      link: origin ? `${origin}/register/${token}` : `/register/${token}`,
    }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
