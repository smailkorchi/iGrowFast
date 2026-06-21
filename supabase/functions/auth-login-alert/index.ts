// @ts-nocheck
// Sends the `new_login` ("Nouvelle connexion détectée") security email after a new auth session.
// Invoked by the auth.sessions AFTER INSERT trigger via public.wa_invoke_edge (service-role bearer),
// which passes { user_id, ip, user_agent, created_at }. Resolves the user, formats device/location/
// time, and delivers through the shared send-email machine. Best-effort: any failure is swallowed
// by the trigger so it can never block authentication.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

function decodeJwtRole(jwt: string): string | null {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}

function deviceFromUA(ua: string): string {
  if (!ua) return "Appareil inconnu";
  const browser = /Edg/.test(ua) ? "Edge"
    : /OPR|Opera/.test(ua) ? "Opera"
    : /Chrome/.test(ua) && !/Chromium/.test(ua) ? "Chrome"
    : /Firefox/.test(ua) ? "Firefox"
    : /Safari/.test(ua) ? "Safari" : "Navigateur";
  const os = /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} sur ${os}` : browser;
}

async function geo(ip: string): Promise<string> {
  if (!ip) return "Localisation inconnue";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: ac.signal });
    if (!r.ok) return "Localisation inconnue";
    const j = await r.json();
    const parts = [j.city, j.country_name].filter(Boolean);
    return parts.length ? parts.join(", ") : "Localisation inconnue";
  } catch { return "Localisation inconnue"; } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Only the trigger (service-role bearer) may call this.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    if (jwt !== SERVICE && decodeJwtRole(jwt) !== "service_role") return json({ ok: false, reason: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "");
    if (!userId) return json({ ok: false, reason: "missing_user" }, 400);
    const ip = String(body?.ip ?? "").trim();
    const ua = String(body?.user_agent ?? "");
    const createdAt = body?.created_at ? String(body.created_at) : new Date().toISOString();

    // Resolve the recipient; skip silently if the user has no email.
    const { data: u } = await service.from("users").select("name, email").eq("id", userId).maybeSingle();
    if (!u?.email) return json({ ok: true, skipped: "no_email" }, 200);

    const origin = (Deno.env.get("SITE_URL") || "https://igrowfast.com").replace(/\/$/, "");
    let loginTime = createdAt;
    try { loginTime = new Date(createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); } catch { /* keep iso */ }

    const resp = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
      body: JSON.stringify({
        key: "new_login", to: u.email, user_id: userId,
        vars: {
          user_name: u.name || "",
          device: deviceFromUA(ua),
          location: await geo(ip),
          ip_address: ip || "Inconnue",
          login_time: loginTime,
          secure_url: `${origin}/auth`,
        },
      }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok || !out?.ok) return json({ ok: false, reason: "send_failed", detail: out?.detail || out?.error || `status ${resp.status}` }, 502);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
