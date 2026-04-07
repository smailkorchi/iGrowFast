// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

      if (authError) throw authError;

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
        await supabaseClient.auth.admin.deleteUser(authData.user.id);
        throw profileError;
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

      const authUpdates: Record<string, string> = {};
      if (email) authUpdates.email = email;
      if (password) authUpdates.password = password;

      if (Object.keys(authUpdates).length > 0) {
        const { error: authError } = await supabaseClient.auth.admin.updateUserById(
          userId,
          authUpdates,
        );
        if (authError) throw authError;
      }

      const { data: profileData, error: profileError } = await supabaseClient
        .from("users")
        .update(rest)
        .eq("id", userId)
        .select()
        .single();

      if (profileError) throw profileError;

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
