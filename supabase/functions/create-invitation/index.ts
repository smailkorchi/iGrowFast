// @ts-nocheck
// Admin-gated: mints a single-use invitation for self-registration.
// The caller must be a super admin / admin; the invite is scoped to THEIR business.
// The raw token is returned ONCE (in the link); only its sha256 is stored.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TARGET_ROLES = ["super admin", "admin", "commercial", "courier", "mediabuyer"];

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(s: string): Promise<string> {
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

    // Identify the caller from their session JWT (sent as the bearer token).
    // getUser() must be given the token explicitly — with no stored session it
    // would otherwise resolve to no user even when a valid header is present.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    // Authorize: only super admins / admins may invite, and the invite is bound to their business.
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
    const targetRole = String(body?.target_role ?? "");
    if (!ALLOWED_TARGET_ROLES.includes(targetRole)) return json({ error: "Invalid target role" }, 400);
    if (me.role === "admin" && targetRole === "super admin") {
      return json({ error: "Admins cannot invite super admins" }, 403);
    }

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
      created_by: user.id,
      expires_at: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
    }).select("id, target_role, expires_at").single();
    if (insErr) return json({ error: insErr.message }, 400);

    return json({
      ok: true,
      id: inv.id,
      target_role: inv.target_role,
      expires_at: inv.expires_at,
      token,
      link: origin ? `${origin}/register/${token}` : `/register/${token}`,
    }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
