// @ts-nocheck
// Public, self-service "forgot password" from the login page. Resolves the account by
// email or username, mints a credential-change link and emails it (password_reset).
// Always returns a generic success — never reveals whether an account exists.
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
  // Generic response used for every outcome (anti-enumeration).
  const ok = () => json({ ok: true }, 200);
  try {
    const body = await req.json().catch(() => ({}));
    const identifier = String(body?.identifier ?? "").trim();
    if (identifier.length < 3) return ok();

    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") ?? "");

    const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve by email (has @) or username. maybeSingle → ambiguous/none silently no-ops.
    const col = identifier.includes("@") ? "email" : "username";
    const { data: user } = await service.from("users")
      .select("id, email, name, active").ilike(col, identifier).limit(2);
    const target = Array.isArray(user) && user.length === 1 ? user[0] : null;
    if (!target || target.active === false || !target.email) return ok();

    // Soft anti-spam: skip if an unconsumed request was minted for this user in the last 60s.
    const { data: recent } = await service.from("credential_change_requests")
      .select("id").eq("user_id", target.id).is("consumed_at", null)
      .gt("created_at", new Date(Date.now() - 60000).toISOString()).limit(1);
    if (recent && recent.length > 0) return ok();

    const token = genToken();
    const tokenHash = await sha256Hex(token);
    await service.from("credential_change_requests").insert({
      user_id: target.id, requested_by: null, token_hash: `\\x${tokenHash}`,
    });

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

    return ok();
  } catch {
    return json({ ok: true }, 200); // never leak failure detail to an unauthenticated caller
  }
});
