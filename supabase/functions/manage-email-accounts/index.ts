// @ts-nocheck
// Owner-gated management of platform email accounts (SMTP / IMAP / POP3).
// Secrets (SMTP passwords) live in Vault — they are written via SECURITY DEFINER
// RPCs (create_email_account / update_email_account) and only ever decrypted
// server-side (get_email_account_secret) for the test/send path. The plaintext
// password is accepted here once on create/rotate and never returned to clients.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// Map the payload's account object onto the RPC's positional args.
function accountArgs(a: any) {
  const toInt = (v: any) => (v === null || v === undefined || v === "" ? null : parseInt(String(v), 10));
  return {
    p_name: String(a?.name ?? "").trim(),
    p_from_name: a?.from_name ? String(a.from_name).trim() : null,
    p_email_address: String(a?.email_address ?? "").trim(),
    p_username: String(a?.username ?? "").trim(),
    p_smtp_host: a?.smtp_host ? String(a.smtp_host).trim() : null,
    p_smtp_port: toInt(a?.smtp_port),
    p_smtp_security: a?.smtp_security ? String(a.smtp_security) : "ssl",
    p_imap_host: a?.imap_host ? String(a.imap_host).trim() : null,
    p_imap_port: toInt(a?.imap_port),
    p_imap_security: a?.imap_security ? String(a.imap_security) : null,
    p_pop3_host: a?.pop3_host ? String(a.pop3_host).trim() : null,
    p_pop3_port: toInt(a?.pop3_port),
    p_pop3_security: a?.pop3_security ? String(a.pop3_security) : null,
    p_is_active: a?.is_active === undefined ? true : !!a.is_active,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Authn/Authz: caller must be a signed-in OWNER ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const { data: me, error: meErr } = await service
      .from("users").select("role, active").eq("id", user.id).single();
    if (meErr || !me) return json({ error: "Profile not found" }, 403);
    if (me.active === false) return json({ error: "Account disabled" }, 403);
    if (String(me.role) !== "owner") return json({ error: "Only the platform owner can manage email accounts" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // ── create ──
    if (action === "create") {
      const a = body?.account ?? {};
      const password = String(a?.password ?? "");
      if (!a?.name || !a?.email_address || !a?.username) return json({ error: "Name, email address and username are required" }, 400);
      if (!password) return json({ error: "Password is required" }, 400);
      const { data, error } = await service.rpc("create_email_account", {
        ...accountArgs(a),
        p_password: password,
        p_created_by: user.id,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, id: data }, 200);
    }

    // ── update (password optional — blank keeps current) ──
    if (action === "update") {
      const id = String(body?.id ?? "");
      const a = body?.account ?? {};
      if (!id) return json({ error: "Missing account id" }, 400);
      if (!a?.name || !a?.email_address || !a?.username) return json({ error: "Name, email address and username are required" }, 400);
      const { error } = await service.rpc("update_email_account", {
        p_id: id,
        ...accountArgs(a),
        p_password: a?.password ? String(a.password) : null,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true }, 200);
    }

    // ── toggle active ──
    if (action === "toggle") {
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "Missing account id" }, 400);
      const { error } = await service.from("email_accounts").update({ is_active: !!body?.is_active }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true }, 200);
    }

    // ── delete (AFTER DELETE trigger purges the vault secret) ──
    if (action === "delete") {
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "Missing account id" }, 400);
      const { error } = await service.from("email_accounts").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true }, 200);
    }

    // ── test: actually send through the SMTP server, record the outcome ──
    if (action === "test") {
      const id = String(body?.id ?? "");
      if (!id) return json({ error: "Missing account id" }, 400);

      const { data: acc, error: accErr } = await service
        .from("email_accounts")
        .select("name, from_name, email_address, username, smtp_host, smtp_port, smtp_security")
        .eq("id", id).single();
      if (accErr || !acc) return json({ error: "Email account not found" }, 404);
      if (!acc.smtp_host || !acc.smtp_port) return json({ error: "This account has no SMTP host/port configured" }, 400);

      const to = String(body?.to ?? "").trim() || acc.email_address;

      let ok = false;
      let errMsg: string | null = null;
      try {
        const { data: pw, error: pwErr } = await service.rpc("get_email_account_secret", { p_id: id });
        if (pwErr || !pw) throw new Error(pwErr?.message || "Could not read the stored password");

        const client = new SMTPClient({
          connection: {
            hostname: acc.smtp_host,
            port: acc.smtp_port,
            tls: acc.smtp_security === "ssl" || acc.smtp_security === "tls", // implicit TLS (465); starttls/none use opportunistic STARTTLS (587)
            auth: { username: acc.username, password: String(pw) },
          },
        });

        await client.send({
          from: acc.from_name ? `${acc.from_name} <${acc.email_address}>` : acc.email_address,
          to,
          subject: "iGrowFast · SMTP test",
          content: "This is a test email confirming your SMTP settings work. — iGrowFast",
          html: `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#141413">
            <p>This is a <strong>test email</strong> from iGrowFast confirming that the SMTP
            settings for <strong>${acc.name}</strong> are working.</p>
            <p style="color:#8a8a85;font-size:12px">Sent to ${to}</p></div>`,
        });
        await client.close();
        ok = true;
      } catch (e) {
        errMsg = (e as Error)?.message || "SMTP connection failed";
      }

      await service.from("email_accounts").update({
        last_test_at: new Date().toISOString(),
        last_test_ok: ok,
        last_test_error: ok ? null : errMsg,
      }).eq("id", id);

      if (!ok) return json({ ok: false, error: errMsg }, 200);
      return json({ ok: true, to }, 200);
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
