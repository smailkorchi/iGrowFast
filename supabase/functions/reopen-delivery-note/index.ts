// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Ameex: Reopen Delivery Note via API Keys ────────────────────────────────
async function reopenAmeexDeliveryNote(
  provider: any,
  reference: string
): Promise<{ success: boolean; message: string }> {
  const baseUrl = provider.api_base_url || "https://api.ameex.app";
  const apiId = provider.business_id || provider.api_public_key || "";
  const apiKey = provider.api_key || provider.api_secret_key || "";

  if (!apiId || !apiKey) {
    throw new Error(
      "Ameex API credentials (business_id / api_key) not configured"
    );
  }

  const openUrl = `${baseUrl}/customer/Delivery/DeliveryNotes/Action/Type/Open?Ref=${encodeURIComponent(reference)}`;
  console.log("[AMEEX REOPEN] Calling:", openUrl);

  const response = await fetch(openUrl, {
    method: "POST",
    headers: {
      "C-Api-Id": apiId,
      "C-Api-Key": apiKey,
    },
  });

  const responseText = await response.text();
  console.log("[AMEEX REOPEN] Response:", responseText);

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Ameex returned non-JSON: ${responseText.slice(0, 200)}`);
  }

  if (data.login === "error") {
    throw new Error("Ameex login failed: Invalid API credentials (C-Api-Id / C-Api-Key)");
  }

  if (data.api?.type === "error") {
    throw new Error(`Ameex reopen failed: ${data.api.msg || "Unknown error"}`);
  }

  return {
    success: true,
    message: `Delivery note ${reference} reopened successfully on Ameex`,
  };
}

// ─── Main Handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { provider_id, reference, delivery_note_id } = body;

    if (!provider_id || !reference) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: provider_id, reference",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .eq("id", provider_id)
      .single();

    if (providerError || !provider) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Provider not found: ${providerError?.message || "Unknown"}`,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const providerType = (provider.provider_type || "").toLowerCase();
    console.log(
      `[REOPEN] Provider: ${providerType}, Ref: ${reference}, NoteID: ${delivery_note_id}`
    );

    let result: { success: boolean; message: string };

    switch (providerType) {
      case "ameex":
        result = await reopenAmeexDeliveryNote(provider, reference);
        break;
      case "ozon":
      default:
        // Ozon has no public API for reopening — DB-only update (same as Coliaty)
        result = {
          success: true,
          message: `Delivery note ${reference} reopened (database only)`,
        };
        break;
    }

    // Update database — mark as not finalized
    if (delivery_note_id) {
      const { error: updateError } = await supabase
        .from("company_delivery_notes")
        .update({
          is_finalized: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery_note_id);

      if (updateError) {
        console.error(
          "[REOPEN] DB update failed:",
          updateError.message
        );
      }
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[REOPEN] Error:", error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
