// @ts-nocheck
// Pre-account email gate for invitation registration.
//  action "check": validate the email is real & working — syntax, common-typo
//    detection (gmail.con -> gmail.com), disposable-domain block, then a
//    MAILBOX-LEVEL check via our self-hosted Reacher endpoint (detects nonexistent
//    mailboxes like gibberish@gmail.com, not just bad domains). No OTP side effect.
//  action "send": same validation, then issue a 6-digit OTP, store its hash on
//    the invitation row (keyed by token_hash) and email it via the otp_code template.
// Both actions require a still-valid invitation token, so the public anon key can't
// burn verification credits. Reacher is fail-open (if it's down/unconfigured/timed out
// we allow and rely on the OTP) and only a hard "invalid" verdict blocks.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o, s) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });
const sha256Hex = async (s) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const clientIp = (req) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;

// Known disposable / throwaway domains — blocked outright (Reacher also flags these via is_disposable).
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

// Cheap, free, no-network pre-checks. Returns { ok, email } or { ok:false, reason, suggestion? }.
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
async function verifyDeliverable(email) {
  const verdict = await reacherClassify(email);
  if (verdict === "invalid") return { ok: false, reason: "undeliverable" };
  return { ok: true, email };
}

const MAX_OTP_SENDS = 6;            // hard cap of OTP emails per invite (anti-mailbomb + bounds guesses)
const RESEND_INTERVAL_MS = 30000;   // minimum gap between sends

async function sendOtpEmail(email, otp, ip) {
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
    body: JSON.stringify({
      key: "otp_code", to: email,
      vars: { otp_code: otp, otp_ttl: "10 minutes", purpose: "Confirmation de votre adresse e-mail", user_name: "", request_ip: ip },
    }),
  }).catch((e) => console.error("send-email call failed:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action === "send" ? "send" : "check";

    // 1) Cheap, free checks first (no credit, no DB hit).
    const pre = preValidate(body?.email);
    if (!pre.ok) return json(pre, 400);

    // 2) Both actions require a still-valid invitation, so the public anon key
    //    can't be used to burn verification capacity or spam OTP emails.
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid_token" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const tokenHash = await sha256Hex(token);
    const { data: st, error: stErr } = await service.rpc("invitation_status", { p_token_hash: `\\x${tokenHash}` });
    if (stErr) return json({ ok: false, reason: "error", detail: stErr.message }, 500);
    if (!st?.ok) return json({ ok: false, reason: st?.reason ?? "invalid_or_used" }, 400);

    // 3) Mailbox-level verification.
    const deep = await verifyDeliverable(pre.email);
    if (!deep.ok) return json(deep, 400);

    if (action === "check") return json({ ok: true, deliverable: true }, 200);

    // 4) action === "send": throttle, then issue + store + email the OTP.
    const { data: row } = await service.from("user_invitations")
      .select("id, signup_otp_sends, signup_otp_last_send_at")
      .eq("token_hash", `\\x${tokenHash}`).is("consumed_at", null).is("revoked_at", null).maybeSingle();
    if (!row) return json({ ok: false, reason: "invalid_or_used" }, 400);
    const sends = row.signup_otp_sends ?? 0;
    if (sends >= MAX_OTP_SENDS) return json({ ok: false, reason: "too_many_sends" }, 429);
    if (row.signup_otp_last_send_at &&
        Date.now() - new Date(row.signup_otp_last_send_at).getTime() < RESEND_INTERVAL_MS) {
      return json({ ok: false, reason: "resend_cooldown" }, 429);
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256Hex(otp);
    const { data: upd, error: upErr } = await service.from("user_invitations").update({
      signup_otp_hash: `\\x${otpHash}`,
      signup_otp_email: pre.email,
      signup_otp_expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      signup_otp_attempts: 0,
      signup_otp_sends: sends + 1,
      signup_otp_last_send_at: new Date().toISOString(),
    }).eq("id", row.id).is("consumed_at", null).is("revoked_at", null).select("id");
    if (upErr) return json({ ok: false, reason: "error", detail: upErr.message }, 500);
    if (!upd || upd.length !== 1) return json({ ok: false, reason: "invalid_or_used" }, 400);

    await sendOtpEmail(pre.email, otp, clientIp(req));
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: e.message }, 500);
  }
});
