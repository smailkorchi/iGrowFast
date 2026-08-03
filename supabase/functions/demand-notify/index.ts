// @ts-nocheck
// Sends the demand_received / demand_resolved emails (T23-D). Invoked by the
// seller_demands / mediabuyer_demands AFTER INSERT/UPDATE triggers via
// public.app_invoke_edge (service-role bearer), which passes
// { table, demand_id, event }. Re-reads the row itself — never trusts values passed in —
// resolves recipients and variables, and calls send-email per recipient. Best-effort: any
// failure here is swallowed by the trigger so it can never block the demand write.
// Internal-only: not in main/index.ts's PUBLIC_FUNCTIONS, so the router's global VERIFY_JWT
// already blocks anonymous callers; the check below narrows further to service-role only,
// mirroring auth-login-alert's gate.
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

// Mirrors account-status-change's ROLE_FR map — same wording, not re-invented.
const ROLE_FR: Record<string, string> = {
  "super admin": "Super administrateur", "business owner": "Propriétaire d'entreprise", "admin": "Administrateur", "commercial": "Commercial",
  "courier": "Livreur", "mediabuyer": "Media buyer", "owner": "Propriétaire",
};

const REQUESTER_COL: Record<string, string> = { seller_demands: "seller_id", mediabuyer_demands: "mediabuyer_id" };
// Requester's own demands page, keyed by the table they filed into (routes verified in src/App.tsx).
const REQUESTER_PATH: Record<string, string> = { seller_demands: "/seller/demands", mediabuyer_demands: "/mediabuyer/demands" };
const ADMIN_DEMAND_PATH = "/demands";
const ADMIN_ROLES = ["super admin", "business owner", "admin"];

const excerpt = (text: unknown, max = 200): string => {
  const collapsed = String(text ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max).trimEnd()}…`;
};

const frDate = (iso: string | null | undefined): string => {
  const d = iso ? new Date(iso) : new Date();
  try { return d.toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); }
  catch { return d.toISOString(); }
};

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
    const table = String(body?.table ?? "");
    const demandId = String(body?.demand_id ?? "");
    const event = String(body?.event ?? "");
    if (!REQUESTER_COL[table]) return json({ ok: false, reason: "bad_table" }, 400);
    if (!demandId) return json({ ok: false, reason: "missing_demand" }, 400);
    if (event !== "received" && event !== "resolved") return json({ ok: false, reason: "bad_event" }, 400);

    // Never trust the caller's payload beyond routing — re-read the row itself.
    const { data: demand } = await service.from(table).select("*").eq("id", demandId).maybeSingle();
    if (!demand) return json({ ok: true, skipped: "not_found" }, 200);

    const businessId = demand["DigiCom Business"];
    const { data: biz } = businessId
      ? await service.from("businesses").select("name").eq("id", businessId).maybeSingle()
      : { data: null };
    const businessName = biz?.name || "votre entreprise";

    // App origin. SITE_URL (box functions.env) points at the marketing site, not the app —
    // a demand link built from it would 404. APP_URL is the dedicated app-origin var; falls
    // back to the known production app host if unset.
    const origin = (Deno.env.get("APP_URL") || "https://app.igrowfast.com").replace(/\/$/, "");

    const requesterCol = REQUESTER_COL[table];
    const requesterId = demand[requesterCol];
    if (!requesterId) return json({ ok: true, skipped: "no_requester" }, 200);

    let sent = 0;
    const failures: string[] = [];
    const sendOne = async (key: string, to: string, vars: Record<string, unknown>, userId?: string | null) => {
      try {
        const resp = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
          body: JSON.stringify({ key, to, ...(userId ? { user_id: userId } : {}), vars }),
        });
        const out = await resp.json().catch(() => ({}));
        if (resp.ok && out?.ok === true) sent++;
        else failures.push(`${to}: ${out?.detail || out?.error || resp.status}`);
      } catch (e) {
        failures.push(`${to}: ${(e as Error).message}`);
      }
    };

    if (event === "received") {
      const { data: requester } = await service.from("users").select("name, role").eq("id", requesterId).maybeSingle();

      // Default recipients: everyone in the business who can actually answer a demand
      // (super admin / business owner / admin). Stands until a per-business settings page
      // lets the business owner choose recipients.
      const { data: admins } = businessId
        ? await service.from("users")
            .select("id, name, email")
            .eq("DigiCom Business", businessId)
            .in("role", ADMIN_ROLES)
            .eq("active", true)
            .is("archived_at", null)
            .not("email", "is", null)
        : { data: [] };

      const demandUrl = `${origin}${ADMIN_DEMAND_PATH}?id=${demandId}`;
      const recipients = (admins ?? []).filter((a: any) => a.email);
      for (const a of recipients) {
        await sendOne("demand_received", a.email, {
          admin_name: a.name || "",
          business_name: businessName,
          created_at: frDate(demand.created_at),
          demand_category: demand.category || "",
          demand_excerpt: excerpt(demand.content),
          demand_priority: demand.priority || "",
          demand_subject: demand.subject || "",
          demand_url: demandUrl,
          requester_name: requester?.name || "",
          requester_role_label: ROLE_FR[requester?.role] || String(requester?.role || ""),
        }, a.id);
      }
      return json({ ok: true, recipients: recipients.length, sent, failures }, 200);
    }

    // event === "resolved" — the requester only.
    const { data: requester } = await service.from("users").select("name, email").eq("id", requesterId).maybeSingle();
    if (!requester?.email) return json({ ok: true, skipped: "no_email" }, 200);

    const demandUrl = `${origin}${REQUESTER_PATH[table]}?id=${demandId}`;
    await sendOne("demand_resolved", requester.email, {
      admin_response: demand.admin_response || "",
      business_name: businessName,
      demand_category: demand.category || "",
      demand_subject: demand.subject || "",
      demand_url: demandUrl,
      responded_at: frDate(demand.responded_at),
      user_name: requester.name || "",
    }, requesterId);
    return json({ ok: true, recipients: 1, sent, failures }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
