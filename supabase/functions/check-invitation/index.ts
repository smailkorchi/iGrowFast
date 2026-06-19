// @ts-nocheck
// Public (anon-key) read-only check of an invitation token, used by the
// registration page before showing the form. Returns only non-sensitive state.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid" }, 200);

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const tokenHash = await sha256Hex(token);
    const { data, error } = await service.rpc("invitation_status", { p_token_hash: `\\x${tokenHash}` });
    if (error) return json({ ok: false, reason: "error", detail: error.message }, 500);

    return json(data, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
