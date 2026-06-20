// @ts-nocheck
// Authenticated: sends a 6-digit OTP to the logged-in user's CURRENT email.
// Used for in-profile email/password change AND email-2FA at login. No link.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });
const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const randHex = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
};
const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

async function sendEmail(payload: Record<string, unknown>) {
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
    body: JSON.stringify(payload),
  }).catch((e) => console.error("send-email call failed:", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: uErr } = await service.auth.getUser(jwt);
    if (uErr || !user) return json({ ok: false, reason: "unauthenticated" }, 401);

    const { data: me } = await service.from("users").select("email, name").eq("id", user.id).single();
    const email = me?.email || user.email;
    if (!email) return json({ ok: false, reason: "no_email" }, 400);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256Hex(otp);
    const { error: insErr } = await service.from("credential_change_requests").insert({
      user_id: user.id, requested_by: user.id, token_hash: `\\x${randHex()}`,
      otp_hash: `\\x${otpHash}`, otp_expires_at: new Date(Date.now() + 10 * 60000).toISOString(), otp_attempts: 0,
    });
    if (insErr) return json({ ok: false, reason: "error", detail: insErr.message }, 500);

    await sendEmail({
      key: "otp_code", to: email, user_id: user.id,
      vars: { otp_code: otp, otp_ttl: "10 minutes", purpose: "Sécurité du compte", user_name: me?.name || "", request_ip: clientIp(req) },
    });
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
