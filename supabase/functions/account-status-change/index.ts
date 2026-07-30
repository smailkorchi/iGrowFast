// @ts-nocheck
// Admin-gated: activate / deactivate a user account, then email account_reactivated /
// account_suspended (with the admin-supplied reason). The status flip is the primary action;
// the email is best-effort (a mail failure won't undo the flip). Caller must be a super admin /
// admin in the SAME business as the target user.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

const ROLE_FR: Record<string, string> = {
  "super admin": "Super administrateur", "business owner": "Propriétaire d'entreprise", "admin": "Administrateur", "commercial": "Commercial",
  "courier": "Livreur", "mediabuyer": "Media buyer", "owner": "Propriétaire",
};
const BIZ_OWNER_PROTECTED_MSG = "Le propriétaire de l'entreprise ne peut être géré que par un propriétaire ou la plateforme.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ ok: false, reason: "not_authenticated" }, 401);

    const { data: me } = await service.from("users").select('role, "DigiCom Business", active, archived_at').eq("id", user.id).single();
    if (!me) return json({ ok: false, reason: "profile_not_found" }, 403);
    // Liveness gate: an archived/suspended admin's still-valid JWT must be
    // useless here — the DB row is the source of truth, re-checked every call.
    if (me.active !== true || me.archived_at) {
      return json({ ok: false, reason: "account_disabled", error: "Compte désactivé." }, 403);
    }
    if (!["super admin", "business owner", "admin"].includes(String(me.role))) return json({ ok: false, reason: "forbidden" }, 403);
    const businessId = me["DigiCom Business"];
    if (!businessId) return json({ ok: false, reason: "no_business" }, 400);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "");
    if (!userId) return json({ ok: false, reason: "missing_user" }, 400);
    const active = body?.active === true;
    let reason = String(body?.reason ?? "").trim();
    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") || "https://igrowfast.com").replace(/\/$/, "");

    // Target must belong to the caller's business.
    const { data: target } = await service.from("users")
      .select('id, name, email, role, "DigiCom Business", archived_at').eq("id", userId).maybeSingle();
    if (!target) return json({ ok: false, reason: "not_found" }, 404);
    if (target["DigiCom Business"] !== businessId) return json({ ok: false, reason: "forbidden" }, 403);
    if (userId === user.id) return json({ ok: false, reason: "cannot_change_self" }, 400);
    if (target.archived_at) {
      return json({ ok: false, reason: "archived", error: "Utilisateur archivé — aucune modification possible." }, 403);
    }
    // Target already verified same-business above. No last-BO check —
    // suspension is reversible.
    if (target.role === "business owner" && me.role !== "owner" && me.role !== "business owner") {
      return json({ ok: false, reason: "forbidden", error: BIZ_OWNER_PROTECTED_MSG }, 403);
    }

    // Primary action: flip the status (mirrors the previous direct update, now server-side).
    // .is('archived_at', null) + 0-row check: belt to the CHECK constraint's
    // braces — an archived row must never be silently no-op'd or reactivated
    // by a stale/racing request.
    const { data: updRows, error: updErr } = await service
      .from("users")
      .update({ active })
      .eq("id", userId)
      .is("archived_at", null)
      .select("id");
    if (updErr) return json({ ok: false, reason: "update_failed", detail: updErr.message }, 400);
    if (!updRows || updRows.length === 0) {
      return json({ ok: false, reason: "archived", error: "Utilisateur archivé — aucune modification possible." }, 409);
    }

    // Best-effort notification.
    let emailWarning: string | null = null;
    if (target.email) {
      const { data: biz } = await service.from("businesses").select("name").eq("id", businessId).maybeSingle();
      const nowFr = (() => {
        try { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); }
        catch { return new Date().toISOString(); }
      })();
      if (!reason) reason = active ? "Votre accès a été rétabli par l'administrateur." : "Non précisé.";
      const key = active ? "account_reactivated" : "account_suspended";
      const vars: Record<string, unknown> = {
        user_name: target.name || "",
        role_label: ROLE_FR[target.role] || String(target.role),
        business_name: biz?.name || "votre entreprise",
        reason,
      };
      if (active) { vars.reactivated_at = nowFr; vars.login_url = `${origin}/auth`; }
      else { vars.suspended_at = nowFr; }

      try {
        const resp = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
          body: JSON.stringify({ key, to: target.email, user_id: userId, vars }),
        });
        const out = await resp.json().catch(() => ({}));
        if (!resp.ok || !out?.ok) emailWarning = out?.detail || out?.error || `status ${resp.status}`;
      } catch (e) {
        emailWarning = (e as Error).message;
      }
    }

    return json({ ok: true, active, email_warning: emailWarning }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
