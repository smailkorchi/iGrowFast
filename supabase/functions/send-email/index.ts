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

  // Hoisted above the try so the top-level catch can still mark the row it wrote — declared
  // here (not inside the try) purely for that scoping reason.
  let logId: string | null = null;
  // Every non-success branch below (including the top-level catch) updates the same row
  // instead of returning silently. Wrapped so a logging failure can never turn a delivered
  // email into an error response.
  const markError = async (message: string, extra?: Record<string, unknown>) => {
    if (!logId) return;
    try {
      await service.from("email_log").update({
        status: "error", failed_at: new Date().toISOString(), failure_reason: message,
        // `error` is the legacy column the 6 pre-existing failure rows use; keep writing it
        // so a reader of old and new rows doesn't have to know which era a row came from.
        error: message,
        updated_at: new Date().toISOString(), ...extra,
      }).eq("id", logId);
    } catch (e) {
      console.error("[send-email] markError update failed:", e);
    }
  };

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
    // Kept as a bare 403 with no row, deliberately: this runs before we know recipient or
    // template, and an unauthenticated caller must not be able to write email_log rows.
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

    // Write the outcome row FIRST — before ANY validation or lookup — so that no exit branch
    // below can vanish silently. Every subsequent exit (including the two validation failures
    // right after) UPDATEs this row instead of just returning. A logging failure here must
    // never abort the send (mail matters more than bookkeeping), so this insert is
    // best-effort and logId stays null on failure.
    try {
      const { data: logRow } = await service.from("email_log")
        .insert({ template_key: key ?? templateId ?? null, to_email: to ?? "", to_user_id: toUserId, status: "queued" })
        .select("id").single();
      logId = logRow?.id ?? null;
    } catch (logErr) {
      console.error("[send-email] initial email_log insert failed:", logErr);
    }

    if (!key && !templateId) {
      await markError("template key required");
      return json({ ok: false, error: "template key required" }, 400);
    }

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      await markError("invalid recipient");
      return json({ ok: false, error: "invalid recipient" }, 400);
    }

    // Load template by stable key (preferred) or id.
    const { data: tpl, error: tErr } = await (
      key ? service.from("email_templates").select("*").eq("key", key)
          : service.from("email_templates").select("*").eq("id", templateId)
    ).maybeSingle();
    if (tErr || !tpl) { await markError("template not found"); return json({ ok: false, error: "template not found" }, 404); }
    if (tpl.is_active === false) { await markError("template inactive"); return json({ ok: false, error: "template inactive" }, 400); }

    // Resolve sender account: explicit → template's → first active.
    let accountId = body?.account_id || tpl.email_account_id || null;
    if (!accountId) {
      const { data: def } = await service.from("email_accounts")
        .select("id").eq("is_active", true).order("created_at").limit(1).maybeSingle();
      accountId = def?.id || null;
    }
    if (!accountId) { await markError("no sender account configured"); return json({ ok: false, error: "no sender account configured" }, 400); }
    const { data: acc, error: aErr } = await service.from("email_accounts").select("*").eq("id", accountId).single();
    if (aErr || !acc) { await markError("sender account not found"); return json({ ok: false, error: "sender account not found" }, 400); }

    const { data: pw, error: pwErr } = await service.rpc("get_email_account_secret", { p_id: accountId });
    if (pwErr || !pw) { await markError("sender password unavailable"); return json({ ok: false, error: "sender password unavailable" }, 500); }

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
      // The router kills this isolate at 60s (main/index.ts). nodemailer's own defaults
      // (120s connect / 600s socket) would let a hung peer outlive the isolate and kill the
      // worker before the catch below runs. These are sized to leave real headroom: the
      // template/account/vault round-trips already consumed part of the budget before we got
      // here, and socketTimeout is an INACTIVITY timer (re-armed on every byte), not a total
      // cap — a peer dribbling one byte every 19s could still outlive the isolate. The
      // insert-first row above is the backstop for that residual case: the send is recorded
      // as 'queued' and never vanishes, even if this worker is killed mid-flight.
      connectionTimeout: 10000,
      greetingTimeout: 8000,
      socketTimeout: 20000,
    });
    let info: Awaited<ReturnType<typeof transporter.sendMail>>;
    try {
      info = await transporter.sendMail({
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
      const message = String((sendErr as Error)?.message ?? sendErr);
      // nodemailer puts the SMTP reply code on responseCode/response when the peer talked
      // back before failing (e.g. a rejected recipient) — capture it when present.
      const failureCode = (sendErr as { responseCode?: number; response?: string })?.responseCode
        ? String((sendErr as { responseCode?: number }).responseCode)
        : (sendErr as { response?: string })?.response ?? null;
      await markError(message, { account_id: accountId, ...(failureCode ? { failure_code: failureCode } : {}) });
      return json({ ok: false, error: "send failed", detail: message }, 502);
    }

    // Parse Stalwart's queue id out of the DATA acknowledgement. Its format string is
    // "Message queued with id {}.\r\n" — note the TRAILING PERIOD, which a naive \S+ capture
    // swallows, producing an id that can never equal the queueId in the webhook event. Match
    // only id-ish characters and strip trailing punctuation anyway (belt and braces, and it
    // keeps working if the wording or punctuation changes). A miss is non-fatal: the queue id
    // is the preferred join key, not a requirement.
    const ack = String(info?.response ?? "");
    const queueIdMatch = ack.match(/queued with id\s+([^\s.,;]+)/i) ?? ack.match(/queued as\s+([^\s.,;]+)/i);
    const queueId = queueIdMatch ? queueIdMatch[1].replace(/[.,;]+$/, "") : null;

    if (logId) {
      try {
        await service.from("email_log").update({
          status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          // The queued row keyed on whatever the caller passed; now that the template is
          // resolved, store its stable key so a template_id caller doesn't log a raw uuid.
          template_key: tpl.key, account_id: accountId,
          queue_id: queueId, message_id: info?.messageId ?? null,
        }).eq("id", logId);
      } catch (e) {
        console.error("[send-email] success email_log update failed:", e);
      }
    }
    return json({ ok: true }, 200);
  } catch (e) {
    // Top-level catch — mirrors every other error branch: mark the row (if one exists) rather
    // than let the send vanish untraced. Note this is NOT reached by the 403 auth refusal
    // above (that return happens before any row is written, and is a plain return, not a
    // throw) — an unauthenticated caller must not be able to write rows.
    const message = (e as Error).message;
    await markError(message);
    return json({ ok: false, error: message }, 500);
  }
});
