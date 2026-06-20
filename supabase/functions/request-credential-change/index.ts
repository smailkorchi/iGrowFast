// @ts-nocheck
// Admin-gated: mints a single-use credential-change link and emails it to the
// target user's CURRENT inbox (password_reset template). Admin never sees/sets creds.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });
const genToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
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
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);

    const { data: me } = await service.from("users").select('role, "DigiCom Business", active').eq("id", user.id).single();
    if (!me) return json({ error: "Profile not found" }, 403);
    if (me.active === false) return json({ error: "Account disabled" }, 403);
    if (!["super admin", "admin"].includes(String(me.role))) return json({ error: "Only admins can do this" }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "");
    if (!userId) return json({ error: "user_id required" }, 400);

    const { data: target } = await service.from("users").select('id, email, name, role, "DigiCom Business"').eq("id", userId).single();
    if (!target) return json({ error: "User not found" }, 404);
    if (String(target.role) === "owner") return json({ error: "Owners are not managed here" }, 403);
    if (target["DigiCom Business"] !== me["DigiCom Business"]) return json({ error: "User is not in your business" }, 403);
    if (!target.email) return json({ error: "User has no email on file" }, 400);

    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") ?? "");

    const token = genToken();
    const tokenHash = await sha256Hex(token);
    const { error: insErr } = await service.from("credential_change_requests").insert({
      user_id: target.id, requested_by: user.id, token_hash: `\\x${tokenHash}`,
    });
    if (insErr) return json({ error: insErr.message }, 400);

    await sendEmail({
      key: "password_reset", to: target.email, user_id: target.id,
      vars: {
        user_name: target.name || "",
        reset_url: origin ? `${origin}/account/change/${token}` : `/account/change/${token}`,
        expires_in: "2 heures",
        request_time: nowFR(),
        request_ip: clientIp(req),
      },
    });

    return json({ ok: true, email: target.email }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
