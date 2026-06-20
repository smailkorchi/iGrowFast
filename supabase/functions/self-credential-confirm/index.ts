// @ts-nocheck
// Authenticated: verifies the latest OTP issued to the logged-in user, then:
//  - with new_email/new_password → applies the change (GoTrue admin) + confirmation emails;
//  - with neither → just verifies (email-2FA login gate).
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
const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
const nowFR = () => { try { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); } catch { return new Date().toISOString(); } };

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
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: uErr } = await service.auth.getUser(jwt);
    if (uErr || !user) return json({ ok: false, reason: "unauthenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const otp = String(body?.otp ?? "").trim();
    const newEmail = body?.new_email ? String(body.new_email).trim().toLowerCase() : null;
    const newPassword = body?.new_password ? String(body.new_password) : null;
    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") ?? "");

    if (newEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return json({ ok: false, reason: "invalid_email" }, 400);
    if (newPassword && newPassword.length < 6) return json({ ok: false, reason: "weak_password" }, 400);

    // Latest OTP issued to this user.
    const { data: row } = await service.from("credential_change_requests")
      .select("*").eq("user_id", user.id).is("consumed_at", null).not("otp_hash", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || !row.otp_expires_at || new Date(row.otp_expires_at) < new Date())
      return json({ ok: false, reason: "otp_expired" }, 400);
    if ((row.otp_attempts ?? 0) >= 5) return json({ ok: false, reason: "too_many_attempts" }, 429);
    if (await sha256Hex(otp) !== String(row.otp_hash).replace(/^\\x/, "")) {
      await service.from("credential_change_requests").update({ otp_attempts: (row.otp_attempts ?? 0) + 1 }).eq("id", row.id);
      return json({ ok: false, reason: "otp_invalid" }, 400);
    }

    const { data: me } = await service.from("users").select("email, name").eq("id", user.id).single();
    const oldEmail = me?.email ?? user.email ?? null;
    const name = me?.name || "";

    // Apply credential change if requested.
    if (newEmail || newPassword) {
      const updates: Record<string, unknown> = {};
      if (newEmail) { updates.email = newEmail; updates.email_confirm = true; }
      if (newPassword) { updates.password = newPassword; }
      const { error: authErr } = await service.auth.admin.updateUserById(user.id, updates);
      if (authErr) {
        const dup = /registered|exist|duplicate/i.test(JSON.stringify(authErr));
        return json({ ok: false, reason: dup ? "email_taken" : "apply_failed", detail: authErr.message }, dup ? 409 : 400);
      }
      if (newEmail) await service.from("users").update({ email: newEmail }).eq("id", user.id);
    }

    await service.from("credential_change_requests").update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id).is("consumed_at", null);

    const ip = clientIp(req); const changed_at = nowFR();
    if (newPassword && oldEmail) {
      await sendEmail({ key: "password_changed", to: oldEmail, user_id: user.id,
        vars: { user_name: name, changed_at, secure_url: origin ? `${origin}/auth` : "/auth", request_ip: ip } });
    }
    if (newEmail) {
      const ev = { user_name: name, old_email: oldEmail ?? "", new_email: newEmail, changed_at, request_ip: ip };
      await sendEmail({ key: "email_changed", to: newEmail, user_id: user.id, vars: ev });
      if (oldEmail && oldEmail.toLowerCase() !== newEmail) {
        await sendEmail({ key: "email_changed", to: oldEmail, user_id: user.id, vars: ev });
      }
    }

    return json({ ok: true, verified: true, email_changed: !!newEmail, password_changed: !!newPassword }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
