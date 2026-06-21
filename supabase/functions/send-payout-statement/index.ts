// @ts-nocheck
// Sends a collaborator PAYOUT statement (seller / media buyer / courier) the moment an
// admin records the payment. The caller (admin client) builds the branded PDF and the
// summary vars, then posts them here. This function:
//   1. Authorizes the caller (owner, or admin/super-admin of the SAME business).
//   2. Resolves the recipient's email + the business's super-admin emails (CC, for traceability).
//   3. Picks the role-specific template and calls `send-email` with the PDF attached + CC.
// Best-effort: a mail failure never undoes the payment (the client already committed it).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

const TEMPLATE_BY_ROLE: Record<string, string> = {
  seller: "seller_payout_statement",
  mediabuyer: "mediabuyer_payout_statement",
  courier: "courier_payment_note",        // delivery settlement (Payments page)
  courier_return: "courier_return_note",  // return note (Return Notes page)
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const service = createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    // ── Authorize caller: owner, or admin/super-admin of the target business ──
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: uErr } = await service.auth.getUser(jwt);
    if (uErr || !user) return json({ ok: false, reason: "not_authenticated" }, 401);
    const { data: me } = await service.from("users")
      .select('role, active, "DigiCom Business"').eq("id", user.id).single();
    if (!me || me.active === false) return json({ ok: false, reason: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const role = String(body?.role ?? "");
    const businessId = String(body?.business_id ?? "");
    const recipientUserId = String(body?.recipient_user_id ?? "");
    const vars = (body?.vars && typeof body.vars === "object") ? body.vars : {};
    const pdfBase64 = typeof body?.pdf_base64 === "string" ? body.pdf_base64 : null;
    const pdfFilename = body?.pdf_filename ? String(body.pdf_filename) : "releve-versement.pdf";

    const tplKey = TEMPLATE_BY_ROLE[role];
    if (!tplKey) return json({ ok: false, reason: "bad_role" }, 400);
    if (!businessId) return json({ ok: false, reason: "missing_business" }, 400);
    if (!recipientUserId) return json({ ok: false, reason: "missing_recipient" }, 400);

    const isOwner = String(me.role) === "owner";
    const isBizAdmin = ["admin", "super admin"].includes(String(me.role)) &&
      String(me["DigiCom Business"]) === businessId;
    if (!isOwner && !isBizAdmin) return json({ ok: false, reason: "forbidden" }, 403);

    // ── Resolve recipient (must belong to the business) ──
    const { data: recipient } = await service.from("users")
      .select('id, name, email, "DigiCom Business"').eq("id", recipientUserId).maybeSingle();
    if (!recipient || !recipient.email) return json({ ok: false, reason: "recipient_no_email" }, 404);
    if (String(recipient["DigiCom Business"]) !== businessId) {
      return json({ ok: false, reason: "recipient_business_mismatch" }, 403);
    }

    // ── Super admins of the business → CC (dedupe + exclude the recipient) ──
    const { data: admins } = await service.from("users")
      .select("email").eq("DigiCom Business", businessId).eq("role", "super admin").eq("active", true);
    const cc = Array.from(new Set(
      (admins ?? [])
        .map((a: { email: string | null }) => (a.email ?? "").trim())
        .filter((e: string) => e && e.toLowerCase() !== String(recipient.email).toLowerCase()),
    ));

    // ── Send via the shared mailer (service-role bearer) ──
    const payload: Record<string, unknown> = {
      key: tplKey,
      to: recipient.email,
      user_id: recipient.id,
      vars,
      cc,
    };
    if (pdfBase64) {
      payload.attachments = [{ filename: pdfFilename, content: pdfBase64, contentType: "application/pdf" }];
    }

    const resp = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
      body: JSON.stringify(payload),
    });
    const out = await resp.json().catch(() => ({}));
    if (resp.ok && out?.ok === true) {
      return json({ ok: true, to: recipient.email, cc_count: cc.length, attached: !!pdfBase64 }, 200);
    }
    return json({ ok: false, reason: "send_failed", detail: out?.error || out?.detail || resp.status }, 502);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
