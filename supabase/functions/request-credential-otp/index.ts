// @ts-nocheck
// Public: issues a 6-digit OTP to the user's CURRENT email (otp_code template),
// proving control of the existing account before any credential change is applied.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });
const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;
const sha256Hex = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

async function sendEmail(payload: Record<string, unknown>) {
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
    body: JSON.stringify(payload),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid" }, 400);

    const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tokenHash = await sha256Hex(token);
    const { data: row } = await service.from("credential_change_requests")
      .select("id, user_id").eq("token_hash", `\\x${tokenHash}`).is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!row) return json({ ok: false, reason: "invalid_or_used" }, 400);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256Hex(otp);
    const { error: upErr } = await service.from("credential_change_requests")
      .update({ otp_hash: `\\x${otpHash}`, otp_expires_at: new Date(Date.now() + 10 * 60000).toISOString(), otp_attempts: 0 })
      .eq("id", row.id);
    if (upErr) return json({ ok: false, reason: "error", detail: upErr.message }, 500);

    const { data: u } = await service.from("users").select("email, name").eq("id", row.user_id).single();
    if (!u?.email) return json({ ok: false, reason: "no_email" }, 400);

    await sendEmail({
      key: "otp_code", to: u.email, user_id: row.user_id,
      vars: { otp_code: otp, otp_ttl: "10 minutes", purpose: "Modification de vos identifiants", user_name: u.name || "", request_ip: clientIp(req) },
    });
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
