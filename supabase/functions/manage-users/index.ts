// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map raw Postgres / GoTrue errors to messages a human can act on.
// supabase-js AuthApiError can surface an opaque body whose .message is "{}"
// with no usable .code, so regex-parsing alone is unreliable — the caller passes
// a `context` so we can give an actionable message even when the error is opaque.
function friendlyError(err: any, context?: "email" | "password" | "create"): Error {
  let serialized = "";
  try { serialized = JSON.stringify(err); } catch { /* ignore */ }

  // Safe shape log (no PII values) to aid ops debugging.
  try {
    console.error("manage-users error shape:", JSON.stringify({
      context,
      status: err?.status ?? err?.statusCode,
      code: err?.code,
      name: err?.name,
      msgType: typeof err?.message,
      msgLen: typeof err?.message === "string" ? err.message.length : null,
      keys: err && typeof err === "object" ? Object.keys(err) : null,
    }));
  } catch { /* ignore */ }

  const hay = [
    err?.message, err?.code, err?.error_description, err?.msg,
    err?.details, err?.hint, err?.name, serialized,
  ].filter((p) => p !== undefined && p !== null && p !== "")
   .map(String).join(" | ").toLowerCase();

  if (/users_username/.test(hay)) {
    return new Error("That username is already taken in this business. Choose a different one.");
  }
  if (/users_email_key|email_exists|already.*registered|registered.*another|email.*already.*(use|exist)|duplicate.*email/.test(hay)) {
    return new Error("That email is already used by another account on the platform. Emails are unique platform-wide.");
  }
  if (/email_address_invalid|invalid.*email|email.*invalid|invalid format/.test(hay)) {
    return new Error("That email address is not valid.");
  }
  if (/weak.*password|password.*at least|password should be|password.*short|password.*requirement/.test(hay)) {
    return new Error("Password doesn't meet the requirements: at least 6 characters, including an uppercase letter, a lowercase letter, and a number.");
  }
  if (/duplicate key/.test(hay)) {
    return new Error("A unique field (email or username) is already in use.");
  }

  // Context-aware fallback when the provider returns an opaque error.
  if (context === "email" || context === "create") {
    return new Error("That email can't be used — it's already registered to another account or is not a valid address.");
  }
  if (context === "password") {
    return new Error("Password doesn't meet the requirements: at least 6 characters, including an uppercase letter, a lowercase letter, and a number.");
  }
  const raw = (typeof err?.message === "string" && err.message.trim() && err.message.trim() !== "{}")
    ? err.message.trim() : "";
  return new Error(raw || "Operation failed. Please review the fields and try again.");
}

// ── WhatsApp instance assignment helper ────────────────────────────────────
// access shape: { mode: 'none'|'all'|'specific', instance_ids?: string[], business_id?: string }
async function applyWhatsappAccess(supabase: any, userId: string, access: any) {
  if (!access || !access.mode) return;
  // Wipe existing assignments first — this function is the source of truth
  await supabase.from("whatsapp_user_instances").delete().eq("user_id", userId);

  if (access.mode === "none") return;

  const businessId = access.business_id;
  if (!businessId) {
    throw new Error("whatsapp_access.business_id is required when mode is not 'none'");
  }

  if (access.mode === "all") {
    await supabase.from("whatsapp_user_instances").insert({
      user_id: userId,
      business_id: businessId,
      instance_id: null,
      scope: "all",
    });
    return;
  }

  if (access.mode === "specific") {
    const ids: string[] = Array.isArray(access.instance_ids) ? access.instance_ids : [];
    if (ids.length === 0) return;
    const rows = ids.map((iid) => ({
      user_id: userId,
      business_id: businessId,
      instance_id: iid,
      scope: "explicit",
    }));
    const { error } = await supabase.from("whatsapp_user_instances").insert(rows);
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { action, userData, userId } = await req.json();

    if (action === "create") {
      const { email, password, name, username, role, whatsapp_access, ...rest } = userData;

      const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, username, role },
      });

      if (authError) throw friendlyError(authError, "create");

      const { data: profileData, error: profileError } = await supabaseClient
        .from("users")
        .insert([{
          id: authData.user.id,
          email,
          name,
          username,
          role,
          ...rest,
        }])
        .select()
        .single();

      if (profileError) {
        // Compensate: roll back the auth user so we don't leave an orphan that
        // blocks future creates with the same email.
        const { error: delErr } = await supabaseClient.auth.admin.deleteUser(authData.user.id);
        if (delErr) {
          console.error("create rollback failed — orphan auth user:", authData.user.id, delErr);
        }
        throw friendlyError(profileError);
      }

      // Apply WhatsApp instance assignments (sellers only — caller decides)
      try {
        await applyWhatsappAccess(supabaseClient, authData.user.id, whatsapp_access);
      } catch (waErr) {
        console.error("applyWhatsappAccess (create) failed:", waErr);
      }

      return new Response(JSON.stringify(profileData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "update") {
      const { email, password, whatsapp_access, ...rest } = userData;

      // Read the current auth login email so we only touch GoTrue when something
      // actually changed. Forwarding an unchanged email made GoTrue treat every
      // edit (even password-only) as an email change and reject it with 422.
      let currentAuthEmail: string | null = null;
      {
        const { data: cur, error: curErr } = await supabaseClient.auth.admin.getUserById(userId);
        if (curErr) throw friendlyError(curErr);
        currentAuthEmail = cur?.user?.email ?? null;
      }

      const submittedEmail = typeof email === "string" ? email.trim() : "";
      const emailChanged = submittedEmail.length > 0 &&
        submittedEmail.toLowerCase() !== (currentAuthEmail ?? "").toLowerCase();

      const authUpdates: Record<string, unknown> = {};
      if (emailChanged) {
        authUpdates.email = submittedEmail;
        authUpdates.email_confirm = true; // admin-initiated change, no confirmation round-trip
      }
      if (password) authUpdates.password = password;

      if (Object.keys(authUpdates).length > 0) {
        const { error: authError } = await supabaseClient.auth.admin.updateUserById(
          userId,
          authUpdates,
        );
        if (authError) throw friendlyError(authError, emailChanged ? "email" : "password");
      }

      // auth.users is the source of truth for the login email; the profile email
      // always mirrors it. This both prevents and self-heals drift on every edit.
      const canonicalEmail = emailChanged ? submittedEmail : currentAuthEmail;
      const profilePatch: Record<string, unknown> = { ...rest };
      if (canonicalEmail) profilePatch.email = canonicalEmail;

      const { data: profileData, error: profileError } = await supabaseClient
        .from("users")
        .update(profilePatch)
        .eq("id", userId)
        .select()
        .single();

      if (profileError) throw friendlyError(profileError);

      try {
        await applyWhatsappAccess(supabaseClient, userId, whatsapp_access);
      } catch (waErr) {
        console.error("applyWhatsappAccess (update) failed:", waErr);
      }

      return new Response(JSON.stringify(profileData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "delete") {
      const { error: authError } = await supabaseClient.auth.admin.deleteUser(userId);
      if (authError) throw authError;

      const { error: profileError } = await supabaseClient
        .from("users")
        .delete()
        .eq("id", userId);

      if (profileError) throw profileError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
