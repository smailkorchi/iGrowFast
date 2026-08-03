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

const ALLOWED_TARGET_ROLES = ["super admin", "business owner", "admin", "commercial", "courier", "mediabuyer"];
const BIZ_OWNER_PROTECTED_MSG = "Le propriétaire de l'entreprise ne peut être géré que par un propriétaire ou la plateforme.";
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
      headers: { "Content-Type": "application/json", "X-Svc-Token": token },
      body: JSON.stringify({ to_email: email }),
      signal: ac.signal,
    });
    if (!r.ok) { console.error("reacher status", r.status); return null; }
    const j = await r.json();
    return j?.is_reachable ?? null;
  } catch (e) { console.error("reacher error:", e); return null; } finally { clearTimeout(t); }
}
async function verifyDeliverable(email) {
  const verdict = await reacherClassify(email);
  if (verdict === "invalid") return { ok: false, reason: "undeliverable" };
  return { ok: true, email };
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
    if (!["super admin", "business owner", "admin"].includes(String(me.role))) {
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
    if (targetRole === "business owner" && me.role !== "business owner" && me.role !== "owner") {
      return json({ error: BIZ_OWNER_PROTECTED_MSG }, 403);
    }
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
