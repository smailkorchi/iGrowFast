// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const EVOLUTION_API_URL = "http://76.13.155.93:8083";
const EVOLUTION_API_KEY = "mata123";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();

    let endpoint = "";
    let method = "POST";
    let body = JSON.stringify(payload);

    switch (action) {
      case 'create-instance':
        endpoint = `/instance/create`;
        break;
      case 'get-qr':
        endpoint = `/instance/connect/${payload.instanceName}`;
        method = "GET";
        body = null as any;
        break;
      case 'send-text':
        endpoint = `/message/sendText/${payload.instanceName}`;
        break;
      case 'send-media':
        endpoint = `/message/sendMedia/${payload.instanceName}`;
        break;
      case 'delete-instance':
        endpoint = `/instance/delete/${payload.instanceName}`;
        method = "DELETE";
        body = null as any;
        break;
      default:
        throw new Error('Invalid action');
    }

    const apiUrl = `${EVOLUTION_API_URL}${endpoint}`;
    const response = await fetch(apiUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : { success: response.ok };
    } catch (e) {
      data = { message: responseText };
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: response.status
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
