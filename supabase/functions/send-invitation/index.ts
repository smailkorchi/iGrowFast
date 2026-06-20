// @ts-nocheck
// Invitation lifecycle messaging + state. One function, dispatched by `action`:
//   ADMIN (caller = super admin / admin via session JWT, scoped to their business):
//     send    {token}            → email the `invitation` template (initial send from the modal).
//     remind  {invitation_id}    → ROTATE the token (only the sha256 is stored, so a fresh link
//                                   must be minted) + email `invitation_reminder`, set reminder_sent_at.
//     revoke  {invitation_id}    → set revoked_at + email `invitation_revoked`.
//     delete  {invitation_id}    → hard-delete the invitation row (no email).
//   CRON (caller = service-role bearer from wa_invoke_edge):
//     cron {mode:'reminder'}     → for invites with ≤24h left, rotate + remind once (reminder_sent_at null).
//     cron {mode:'revoke'}       → for invites past expiry, auto-revoke + email the revoked notice.
// Delivery goes through the shared send-email machine with the service-role bearer.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SITE_FALLBACK = "https://igrowfast.com";

const ROLE_FR: Record<string, { label: string; desc: string }> = {
  "super admin": { label: "Super administrateur", desc: "Vous disposez d'un accès complet à l'espace de l'entreprise." },
  "admin": { label: "Administrateur", desc: "Vous gérez les opérations selon les accès qui vous sont attribués." },
  "commercial": { label: "Commercial", desc: "Vous vendez, échangez avec les clients et percevez vos commissions." },
  "courier": { label: "Livreur", desc: "Vous livrez les colis aux clients." },
  "mediabuyer": { label: "Media buyer", desc: "Vous pilotez les campagnes publicitaires sur toutes les plateformes." },
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeJwtRole(jwt: string): string | null {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4)))?.role ?? null;
  } catch { return null; }
}
function daysLeftLabel(expiresAt: string): string {
  const d = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
  return d <= 1 ? "1 jour" : `${d} jours`;
}
function frDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return iso; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const siteOrigin = (Deno.env.get("SITE_URL") || SITE_FALLBACK).replace(/\/$/, "");

  // Email any template through the shared machine (service-role bearer).
  const sendEmail = async (key: string, to: string, vars: Record<string, unknown>) => {
    const resp = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
      body: JSON.stringify({ key, to, vars }),
    });
    const out = await resp.json().catch(() => ({}));
    return { ok: resp.ok && out?.ok === true, detail: out?.detail || out?.error || `status ${resp.status}` };
  };

  // Resolve inviter name + business name for an invite row.
  const contextFor = async (inv: any) => {
    let inviterName = "Un administrateur";
    if (inv.created_by) {
      const { data: u } = await service.from("users").select("name").eq("id", inv.created_by).maybeSingle();
      if (u?.name) inviterName = u.name;
    }
    const { data: biz } = await service.from("businesses").select("name").eq("id", inv.business_id).maybeSingle();
    return { inviterName, businessName: biz?.name || "votre entreprise", roleFr: ROLE_FR[inv.target_role] || { label: String(inv.target_role), desc: "" } };
  };

  // Rotate the token (new raw token + hash), return the fresh registration link.
  const rotateLink = async (invId: string, origin: string, extra: Record<string, unknown> = {}) => {
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    await service.from("user_invitations").update({ token_hash: `\\x${tokenHash}`, ...extra }).eq("id", invId);
    return `${origin}/register/${token}`;
  };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^bearer\s+/i, "").trim();
    const isService = jwt === SERVICE || decodeJwtRole(jwt) === "service_role";

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "send");

    // ────────────────────────── CRON (service-role) ──────────────────────────
    if (action === "cron") {
      if (!isService) return json({ ok: false, reason: "forbidden" }, 403);
      const mode = String(body?.mode ?? "");
      const nowIso = new Date().toISOString();

      if (mode === "reminder") {
        const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const { data: rows } = await service.from("user_invitations")
          .select("id, target_role, business_id, created_by, email, expires_at")
          .is("consumed_at", null).is("revoked_at", null).is("reminder_sent_at", null)
          .not("email", "is", null).gt("expires_at", nowIso).lte("expires_at", soon).limit(200);
        let sent = 0;
        for (const inv of rows ?? []) {
          const link = await rotateLink(inv.id, siteOrigin, { reminder_sent_at: nowIso });
          const ctx = await contextFor(inv);
          const r = await sendEmail("invitation_reminder", inv.email, {
            inviter_name: ctx.inviterName, business_name: ctx.businessName, role_label: ctx.roleFr.label,
            invite_url: link, expires_at: frDate(inv.expires_at), days_left_label: daysLeftLabel(inv.expires_at),
          });
          if (r.ok) sent++; else console.error("reminder send failed", inv.id, r.detail);
        }
        return json({ ok: true, mode, considered: (rows ?? []).length, sent }, 200);
      }

      if (mode === "revoke") {
        const { data: rows } = await service.from("user_invitations")
          .select("id, target_role, business_id, created_by, email, expires_at")
          .is("consumed_at", null).is("revoked_at", null).lte("expires_at", nowIso).limit(200);
        let notified = 0;
        for (const inv of rows ?? []) {
          await service.from("user_invitations").update({ revoked_at: nowIso }).eq("id", inv.id);
          if (!inv.email) continue;
          const ctx = await contextFor(inv);
          const r = await sendEmail("invitation_revoked", inv.email, {
            inviter_name: ctx.inviterName, business_name: ctx.businessName, role_label: ctx.roleFr.label,
          });
          if (r.ok) notified++; else console.error("revoked send failed", inv.id, r.detail);
        }
        return json({ ok: true, mode, processed: (rows ?? []).length, notified }, 200);
      }

      return json({ ok: false, reason: "bad_mode" }, 400);
    }

    // ────────────────────────── ADMIN (session JWT) ──────────────────────────
    if (isService) return json({ ok: false, reason: "forbidden" }, 403); // service key only for cron
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ ok: false, reason: "not_authenticated" }, 401);
    const { data: me } = await service.from("users").select('role, "DigiCom Business", active').eq("id", user.id).single();
    if (!me) return json({ ok: false, reason: "profile_not_found" }, 403);
    if (me.active === false) return json({ ok: false, reason: "account_disabled" }, 403);
    if (!["super admin", "admin"].includes(String(me.role))) return json({ ok: false, reason: "forbidden" }, 403);
    const businessId = me["DigiCom Business"];
    if (!businessId) return json({ ok: false, reason: "no_business" }, 400);

    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : siteOrigin;

    // send: initial invitation email, identified by the raw token the modal holds.
    if (action === "send") {
      const token = String(body?.token ?? "");
      if (!TOKEN_RE.test(token)) return json({ ok: false, reason: "invalid_token" }, 400);
      const tokenHash = await sha256Hex(token);
      const { data: inv } = await service.from("user_invitations")
        .select("id, target_role, business_id, created_by, email, expires_at, consumed_at, revoked_at")
        .eq("token_hash", `\\x${tokenHash}`).maybeSingle();
      if (!inv) return json({ ok: false, reason: "not_found" }, 404);
      if (inv.business_id !== businessId) return json({ ok: false, reason: "forbidden" }, 403);
      if (inv.consumed_at) return json({ ok: false, reason: "consumed" }, 400);
      if (inv.revoked_at) return json({ ok: false, reason: "revoked" }, 400);
      if (new Date(inv.expires_at).getTime() < Date.now()) return json({ ok: false, reason: "expired" }, 400);
      const to = inv.email || String(body?.email ?? "").trim().toLowerCase();
      if (!to) return json({ ok: false, reason: "no_email" }, 400);
      const ctx = await contextFor(inv);
      const r = await sendEmail("invitation", to, {
        inviter_name: ctx.inviterName, business_name: ctx.businessName, role_label: ctx.roleFr.label,
        role_description: ctx.roleFr.desc, invite_url: `${origin}/register/${token}`, expires_in: daysLeftLabel(inv.expires_at),
      });
      if (!r.ok) return json({ ok: false, reason: "send_failed", detail: r.detail }, 502);
      await service.from("user_invitations").update({ email: to }).eq("id", inv.id);
      return json({ ok: true, to }, 200);
    }

    // Remaining admin actions operate by invitation id.
    const invId = String(body?.invitation_id ?? "");
    if (!invId) return json({ ok: false, reason: "missing_id" }, 400);
    const { data: inv } = await service.from("user_invitations")
      .select("id, target_role, business_id, created_by, email, expires_at, consumed_at, revoked_at")
      .eq("id", invId).maybeSingle();
    if (!inv) return json({ ok: false, reason: "not_found" }, 404);
    if (inv.business_id !== businessId) return json({ ok: false, reason: "forbidden" }, 403);

    if (action === "delete") {
      const { error } = await service.from("user_invitations").delete().eq("id", inv.id);
      if (error) return json({ ok: false, reason: "error", detail: error.message }, 400);
      return json({ ok: true }, 200);
    }

    // Recipient = the invite's stored email, else a valid one supplied now (e.g. from the prompt modal).
    const provided = String(body?.email ?? "").trim().toLowerCase();
    const validProvided = EMAIL_RE.test(provided) ? provided : "";
    const recipient = inv.email || validProvided;
    const storeEmail = !inv.email && !!validProvided; // persist a freshly-supplied address onto the invite

    if (action === "remind") {
      if (inv.consumed_at) return json({ ok: false, reason: "consumed" }, 400);
      if (inv.revoked_at) return json({ ok: false, reason: "revoked" }, 400);
      if (new Date(inv.expires_at).getTime() < Date.now()) return json({ ok: false, reason: "expired" }, 400);
      if (!recipient) return json({ ok: false, reason: "no_email" }, 400); // card opens the email-prompt modal
      const link = await rotateLink(inv.id, origin, {
        reminder_sent_at: new Date().toISOString(), ...(storeEmail ? { email: recipient } : {}),
      });
      const ctx = await contextFor(inv);
      const r = await sendEmail("invitation_reminder", recipient, {
        inviter_name: ctx.inviterName, business_name: ctx.businessName, role_label: ctx.roleFr.label,
        invite_url: link, expires_at: frDate(inv.expires_at), days_left_label: daysLeftLabel(inv.expires_at),
      });
      if (!r.ok) return json({ ok: false, reason: "send_failed", detail: r.detail }, 502);
      return json({ ok: true }, 200);
    }

    if (action === "revoke") {
      if (inv.consumed_at) return json({ ok: false, reason: "consumed" }, 400);
      if (inv.revoked_at) return json({ ok: false, reason: "already_revoked" }, 400);
      // Revoke ALWAYS succeeds (kills the link). The cancellation email is best-effort.
      await service.from("user_invitations").update({
        revoked_at: new Date().toISOString(), revoked_by: user.id, ...(storeEmail ? { email: recipient } : {}),
      }).eq("id", inv.id);
      if (recipient) {
        const ctx = await contextFor(inv);
        const r = await sendEmail("invitation_revoked", recipient, {
          inviter_name: ctx.inviterName, business_name: ctx.businessName, role_label: ctx.roleFr.label,
        });
        if (!r.ok) return json({ ok: true, email_warning: r.detail }, 200);
        return json({ ok: true, notified: true }, 200);
      }
      return json({ ok: true, notified: false }, 200); // revoked without an email to notify
    }

    return json({ ok: false, reason: "bad_action" }, 400);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
