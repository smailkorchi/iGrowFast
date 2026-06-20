// @ts-nocheck
// Public: validates a credential-change link token for the page. Returns only a masked email.
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
const maskEmail = (e: string) => {
  const [u, d] = String(e).split("@");
  if (!d) return "***";
  const head = u.length <= 2 ? u[0] : u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - head.length))}@${d}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid" }, 200);

    const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tokenHash = await sha256Hex(token);
    const { data: row } = await service.from("credential_change_requests")
      .select("id, user_id, consumed_at, expires_at").eq("token_hash", `\\x${tokenHash}`).maybeSingle();
    if (!row) return json({ ok: false, reason: "invalid" }, 200);
    if (row.consumed_at) return json({ ok: false, reason: "used" }, 200);
    if (new Date(row.expires_at) < new Date()) return json({ ok: false, reason: "expired" }, 200);

    const { data: u } = await service.from("users").select("email, name").eq("id", row.user_id).single();
    return json({ ok: true, email: u?.email ? maskEmail(u.email) : null, name: u?.name ?? null }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
