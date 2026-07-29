// @ts-nocheck
// Owner-gated: after a business is suspended / reactivated in the owner dashboard, email the
// business_suspended / business_reactivated notice to ALL super admins of that business
// (one personalized email each). The DB status flip happens client-side; this only notifies.
// Best-effort — a mail failure never affects the status change.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    // Only the platform owner may notify business-level status changes.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ ok: false, reason: "not_authenticated" }, 401);
    const { data: me } = await service.from("users").select("role, active").eq("id", user.id).single();
    if (!me || me.active === false) return json({ ok: false, reason: "forbidden" }, 403);
    if (String(me.role) !== "owner") return json({ ok: false, reason: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body?.business_id ?? "");
    const action = String(body?.action ?? "");
    if (!businessId) return json({ ok: false, reason: "missing_business" }, 400);
    if (action !== "suspend" && action !== "reactivate") return json({ ok: false, reason: "bad_action" }, 400);

    const { data: biz } = await service.from("businesses").select("name").eq("id", businessId).maybeSingle();
    if (!biz) return json({ ok: false, reason: "business_not_found" }, 404);

    // All super admins of this business (personalized recipient list).
    const { data: admins } = await service.from("users")
      .select("name, email").eq("DigiCom Business", businessId).in("role", ["super admin", "business owner"]);

    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") || "https://igrowfast.com").replace(/\/$/, "");
    const nowFr = (() => {
      try { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); }
      catch { return new Date().toISOString(); }
    })();
    let reason = String(body?.reason ?? "").trim();
    if (!reason) reason = action === "suspend" ? "Non précisé." : "L'accès de votre entreprise a été rétabli.";

    const key = action === "suspend" ? "business_suspended" : "business_reactivated";
    const recipients = (admins ?? []).filter((a: any) => a.email);
    let sent = 0;
    const failures: string[] = [];

    for (const a of recipients) {
      const vars: Record<string, unknown> = {
        user_name: a.name || "",
        business_name: biz.name || "votre entreprise",
        reason,
      };
      if (action === "suspend") { vars.suspended_at = nowFr; vars.reactivate_url = `${origin}/auth`; }
      else { vars.reactivated_at = nowFr; vars.dashboard_url = `${origin}/`; }

      try {
        const resp = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
          body: JSON.stringify({ key, to: a.email, vars }),
        });
        const out = await resp.json().catch(() => ({}));
        if (resp.ok && out?.ok === true) sent++;
        else failures.push(`${a.email}: ${out?.detail || out?.error || resp.status}`);
      } catch (e) {
        failures.push(`${a.email}: ${(e as Error).message}`);
      }
    }

    return json({ ok: true, recipients: recipients.length, sent, failures }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
