// @ts-nocheck
// Shared email machine. One function sends ANY template by stable `key`, renders
// {{vars}}, resolves the sender account, sends via SMTP (nodemailer), logs to email_log.
// Callers: other edge functions (pass the service-role key as bearer) or the platform owner.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// nodemailer (not denomailer): denomailer@1.6.0 — the latest — mis-folds long/accented
// Subject headers (it soft-breaks the encoded-word with `=\r\n` and no leading whitespace,
// so the receiver ends header parsing early and the whole MIME spills into the body).
// nodemailer emits RFC 2047-correct multi-word folded headers.
import nodemailer from "npm:nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s: number) =>
  new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: s });

const escHtml = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Plain contexts (subject, preheader, text body): substitute raw.
const renderText = (str: string, vars: Record<string, unknown>) =>
  (str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => String(vars?.[k] ?? ""));
// HTML body: escape values so they can't break markup.
const renderHtml = (str: string, vars: Record<string, unknown>) =>
  (str || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => escHtml(vars?.[k]));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(url, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // Authorize: internal service-role caller OR platform owner.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^bearer\s+/i, "").trim();
    let allowed = jwt.length > 0 && jwt === SERVICE_KEY;
    if (!allowed && jwt) {
      const { data: { user } } = await service.auth.getUser(jwt);
      if (user) {
        const { data: me } = await service.from("users").select("role").eq("id", user.id).single();
        allowed = me?.role === "owner";
      }
    }
    if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const key = body?.key ? String(body.key) : null;
    const templateId = body?.template_id ? String(body.template_id) : null;
    const to = body?.to ? String(body.to).trim() : "";
    const vars = (body?.vars && typeof body.vars === "object") ? body.vars : {};
    const toUserId = body?.user_id ? String(body.user_id) : null;

    // Optional CC list (e.g. super admins for traceability) — validated emails only.
    const cc = Array.isArray(body?.cc)
      ? body.cc.map((x: unknown) => String(x ?? "").trim())
          .filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
      : [];
    // Optional attachments: [{ filename, content(base64), contentType }]. Sent as base64.
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments
          .filter((a: Record<string, unknown>) => a && a.filename && a.content)
          .map((a: Record<string, unknown>) => ({
            filename: String(a.filename),
            content: String(a.content),
            encoding: "base64",
            contentType: a.contentType ? String(a.contentType) : "application/octet-stream",
          }))
      : [];

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ ok: false, error: "invalid recipient" }, 400);
    if (!key && !templateId) return json({ ok: false, error: "template key required" }, 400);

    // Load template by stable key (preferred) or id.
    const { data: tpl, error: tErr } = await (
      key ? service.from("email_templates").select("*").eq("key", key)
          : service.from("email_templates").select("*").eq("id", templateId)
    ).maybeSingle();
    if (tErr || !tpl) return json({ ok: false, error: "template not found" }, 404);
    if (tpl.is_active === false) return json({ ok: false, error: "template inactive" }, 400);

    // Resolve sender account: explicit → template's → first active.
    let accountId = body?.account_id || tpl.email_account_id || null;
    if (!accountId) {
      const { data: def } = await service.from("email_accounts")
        .select("id").eq("is_active", true).order("created_at").limit(1).maybeSingle();
      accountId = def?.id || null;
    }
    if (!accountId) return json({ ok: false, error: "no sender account configured" }, 400);
    const { data: acc, error: aErr } = await service.from("email_accounts").select("*").eq("id", accountId).single();
    if (aErr || !acc) return json({ ok: false, error: "sender account not found" }, 400);

    const { data: pw, error: pwErr } = await service.rpc("get_email_account_secret", { p_id: accountId });
    if (pwErr || !pw) return json({ ok: false, error: "sender password unavailable" }, 500);

    const subject = renderText(tpl.subject || "", vars);
    const html = renderHtml(tpl.html_body || "", vars);
    const text = renderText(tpl.text_body || "", vars);

    // Port 465 / "ssl" = implicit TLS (secure). 587 / "tls" = STARTTLS upgrade. 25 / "none" = plain.
    const secure = acc.smtp_security === "ssl" || acc.smtp_port === 465;
    const transporter = nodemailer.createTransport({
      host: acc.smtp_host,
      port: acc.smtp_port,
      secure,
      auth: { user: acc.username, pass: String(pw) },
      ...(secure ? {} : { requireTLS: acc.smtp_security === "tls" }),
    });
    try {
      await transporter.sendMail({
        from: acc.from_name ? `${acc.from_name} <${acc.email_address}>` : acc.email_address,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        text: text || " ",
        html,
        ...(attachments.length ? { attachments } : {}),
      });
      try { transporter.close(); } catch { /* ignore */ }
    } catch (sendErr) {
      try { transporter.close(); } catch { /* ignore */ }
      await service.from("email_log").insert({
        template_key: tpl.key, to_email: to, to_user_id: toUserId, account_id: accountId,
        status: "error", error: String((sendErr as Error)?.message ?? sendErr),
      });
      return json({ ok: false, error: "send failed", detail: String((sendErr as Error)?.message ?? sendErr) }, 502);
    }

    await service.from("email_log").insert({
      template_key: tpl.key, to_email: to, to_user_id: toUserId, account_id: accountId, status: "sent",
    });
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
