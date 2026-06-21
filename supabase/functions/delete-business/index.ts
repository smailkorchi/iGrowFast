// @ts-nocheck
// Owner-gated business deletion. delete_business (RPC) wipes the business AND all its non-owner
// members (auth + public.users), so this captures the super admins' emails BEFORE the wipe, runs
// the deletion, then emails business_deleted to each captured super admin (best-effort).
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

    // Only the platform owner may delete a business.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user) return json({ ok: false, reason: "not_authenticated" }, 401);
    const { data: me } = await service.from("users").select("role, active").eq("id", user.id).single();
    if (!me || me.active === false || String(me.role) !== "owner") return json({ ok: false, reason: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body?.business_id ?? "");
    if (!businessId) return json({ ok: false, reason: "missing_business" }, 400);

    // Capture name + recipients BEFORE the wipe (the RPC deletes the members).
    const { data: biz } = await service.from("businesses").select("name").eq("id", businessId).maybeSingle();
    if (!biz) return json({ ok: false, reason: "business_not_found" }, 404);
    const businessName = biz.name || "votre entreprise";
    const { data: admins } = await service.from("users")
      .select("name, email").eq("DigiCom Business", businessId).eq("role", "super admin");
    const recipients = (admins ?? []).filter((a: any) => a.email).map((a: any) => ({ name: a.name, email: a.email }));

    // Capture EVERY storage object for the business BEFORE the DB wipe — the random-path files
    // (logo, avatars, product/provider images) are only discoverable via DB URL columns that the
    // wipe deletes. delete_business does NOT touch storage, so we remove the files ourselves after.
    const { data: storageObjs } = await service.rpc("business_storage_objects", { p_business_id: businessId });
    const filesByBucket: Record<string, string[]> = {};
    for (const o of (storageObjs ?? []) as Array<{ bucket: string; path: string }>) {
      if (o?.bucket && o?.path) (filesByBucket[o.bucket] ??= []).push(o.path);
    }

    // Primary action: wipe the business + its members. Run delete_business in the OWNER's auth
    // context (role=authenticated, auth.uid()=owner) — identical to the prior working client call —
    // rather than the contextless service role, which changed trigger/audit behaviour.
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const asOwner = createClient(url, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: delErr } = await asOwner.rpc("delete_business", { p_business_id: businessId });
    if (delErr) {
      console.error("delete_business failed:", JSON.stringify(delErr));
      return json({ ok: false, reason: "delete_failed", detail: delErr.message || JSON.stringify(delErr) }, 400);
    }

    // Purge the captured storage files via the storage API (deletes the actual objects, not just
    // DB rows). Best-effort — a storage hiccup never undoes the completed DB wipe.
    let storageRemoved = 0;
    const storageFailures: string[] = [];
    for (const [bucket, paths] of Object.entries(filesByBucket)) {
      for (let i = 0; i < paths.length; i += 1000) {
        const chunk = paths.slice(i, i + 1000);
        try {
          const { error } = await service.storage.from(bucket).remove(chunk);
          if (error) storageFailures.push(`${bucket}: ${error.message}`);
          else storageRemoved += chunk.length;
        } catch (e) {
          storageFailures.push(`${bucket}: ${(e as Error).message}`);
        }
      }
    }

    // Best-effort notice to the (now former) super admins.
    const origin = typeof body?.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "") : (Deno.env.get("SITE_URL") || "https://igrowfast.com").replace(/\/$/, "");
    void origin;
    const nowFr = (() => {
      try { return new Date().toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", timeStyle: "short" }); }
      catch { return new Date().toISOString(); }
    })();
    let sent = 0;
    const failures: string[] = [];
    for (const r of recipients) {
      try {
        const resp = await fetch(`${url}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE },
          body: JSON.stringify({
            key: "business_deleted", to: r.email,
            vars: { user_name: r.name || "", business_name: businessName, deleted_at: nowFr },
          }),
        });
        const out = await resp.json().catch(() => ({}));
        if (resp.ok && out?.ok === true) sent++;
        else failures.push(`${r.email}: ${out?.detail || out?.error || resp.status}`);
      } catch (e) {
        failures.push(`${r.email}: ${(e as Error).message}`);
      }
    }

    return json({ ok: true, deleted: true, recipients: recipients.length, sent, failures,
      storage_removed: storageRemoved, storage_failures: storageFailures }, 200);
  } catch (e) {
    return json({ ok: false, reason: "error", detail: (e as Error).message }, 500);
  }
});
