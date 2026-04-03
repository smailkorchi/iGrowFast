// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Admin client to bypass RLS for webhook writes
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();

    // Evolution API sends webhook payloads, often structured with event headers
    // For MESSAGES_UPSERT, CONNECTION_UPDATE etc.
    // E.g., payload = { event: "messages.upsert", instance: "my-instance", data: { ... } }

    const event = payload.event || "";
    const instanceName = payload.instance || "";

    if (event === "messages.upsert") {
      const messages = payload.data?.messages || [];
      for (const msg of messages) {
        // Simplified parsing for POC
        const remoteJid = msg.key?.remoteJid;
        const pushName = msg.pushName || remoteJid;
        const msgContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "[Media/Other]";
        const direction = msg.key?.fromMe ? 'outgoing' : 'incoming';
        const msgId = msg.key?.id;

        // Find the instance
        const { data: instanceData } = await supabaseClient
          .from('whatsapp_instances')
          .select('id, business_id')
          .eq('instance_name', instanceName)
          .single();

        if (instanceData) {
          // Upsert contact
          const { data: contactData } = await supabaseClient
            .from('whatsapp_contacts')
            .upsert({
              business_id: instanceData.business_id,
              phone_number: remoteJid,
              name: pushName
            }, { onConflict: 'business_id, phone_number' })
            .select()
            .single();

          if (contactData) {
            // Insert message
            await supabaseClient
              .from('whatsapp_messages')
              .upsert({
                business_id: instanceData.business_id,
                instance_id: instanceData.id,
                contact_id: contactData.id,
                remote_jid: remoteJid,
                message_id: msgId,
                type: 'conversation',
                content: msgContent,
                direction: direction,
                status: 'delivered'
              }, { onConflict: 'message_id' });
          }
        }
      }
    } else if (event === "connection.update") {
      const state = payload.data?.state;
      if (state) {
        let mappedStatus = 'disconnected';
        if (state === 'open') mappedStatus = 'open';
        else if (state === 'connecting') mappedStatus = 'connecting';

        await supabaseClient
          .from('whatsapp_instances')
          .update({ status: mappedStatus })
          .eq('instance_name', instanceName);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
