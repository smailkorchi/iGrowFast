import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const EVOLUTION_API_URL = "http://76.13.155.93:8083";
const EVOLUTION_API_KEY = "mata123";
const WEBHOOK_URL = "https://zjkqprrfbibjoslvlmxf.supabase.co/functions/v1/evolution-webhook";

const WEBHOOK_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "CONTACTS_UPDATE",
  "CONTACTS_UPSERT",
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();

    let endpoint = "";
    let method = "POST";
    let body: string | null = JSON.stringify(payload);

    switch (action) {
      case 'create-instance': {
        endpoint = `/instance/create`;
        // Always inject webhook config into instance creation
        const createPayload = {
          ...payload,
          qrcode: payload.qrcode !== false,
          integration: payload.integration || 'WHATSAPP-BAILEYS',
          webhook: {
            url: WEBHOOK_URL,
            byEvents: false,
            base64: false,
            events: WEBHOOK_EVENTS,
          },
        };
        body = JSON.stringify(createPayload);
        break;
      }

      case 'get-qr':
        endpoint = `/instance/connect/${payload.instanceName}`;
        method = "GET";
        body = null;
        break;

      case 'send-text':
        endpoint = `/message/sendText/${payload.instanceName}`;
        break;

      case 'send-media':
        endpoint = `/message/sendMedia/${payload.instanceName}`;
        body = JSON.stringify({
          number: payload.number,
          mediatype: payload.mediaMessage?.mediatype || payload.mediatype || 'document',
          caption: payload.mediaMessage?.caption || payload.caption || '',
          media: payload.mediaMessage?.media || payload.media || '',
        });
        break;

      case 'send-audio':
        endpoint = `/message/sendWhatsAppAudio/${payload.instanceName}`;
        body = JSON.stringify({
          number: payload.number,
          audio: payload.audio,
          encoding: true,
        });
        break;

      case 'delete-instance':
        endpoint = `/instance/delete/${payload.instanceName}`;
        method = "DELETE";
        body = null;
        break;

      case 'fetch-instances':
        endpoint = `/instance/fetchInstances`;
        if (payload?.instanceName) endpoint += `?instanceName=${payload.instanceName}`;
        method = "GET";
        body = null;
        break;

      case 'mark-chat-read':
        endpoint = `/chat/markMessageAsRead/${payload.instanceName}`;
        body = JSON.stringify({
          readMessages: Array.isArray(payload.readMessages)
            ? payload.readMessages
            : [payload.lastMessageKey],
        });
        break;

      case 'send-reaction':
        endpoint = `/message/sendReaction/${payload.instanceName}`;
        body = JSON.stringify({
          key: payload.key,
          reaction: payload.reaction,
        });
        break;

      case 'delete-message':
        endpoint = `/chat/deleteMessageForEveryone/${payload.instanceName}`;
        method = "DELETE";
        body = JSON.stringify({
          id: payload.messageId,
          fromMe: payload.fromMe,
          remoteJid: payload.remoteJid,
        });
        break;

      case 'get-media':
        endpoint = `/chat/getBase64FromMediaMessage/${payload.instanceName}`;
        body = JSON.stringify({
          message: { key: payload.key },
          convertToMp4: false,
        });
        break;

      // ── Webhook management ──────────────────────────────────────────
      case 'set-webhook':
        endpoint = `/webhook/set/${payload.instanceName}`;
        body = JSON.stringify({
          webhook: {
            enabled: true,
            url: WEBHOOK_URL,
            byEvents: false,
            base64: false,
            events: WEBHOOK_EVENTS,
          },
        });
        break;

      case 'find-webhook':
        endpoint = `/webhook/find/${payload.instanceName}`;
        method = "GET";
        body = null;
        break;

      // ── Contact sync (backfill) ─────────────────────────────────────
      case 'sync-contacts':
        endpoint = `/chat/findContacts/${payload.instanceName}`;
        body = JSON.stringify({});
        break;

      case 'sync-chats':
        endpoint = `/chat/findChats/${payload.instanceName}`;
        body = JSON.stringify({});
        break;

      case 'find-messages':
        endpoint = `/chat/findMessages/${payload.instanceName}`;
        body = JSON.stringify({
          where: payload.where || {},
          limit: payload.limit || 50,
          ...(payload.page ? { page: payload.page } : {}),
        });
        break;

      // ── Profile / avatar proxy ──────────────────────────────────────
      case 'get-profile-pic':
      case 'proxy-image': {
        let imageUrl = payload.url || null;
        if (!imageUrl && payload.number && payload.instanceName) {
          try {
            const picRes = await fetch(`${EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${payload.instanceName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
              body: JSON.stringify({ number: payload.number }),
            });
            const picData = await picRes.json();
            imageUrl = picData?.profilePictureUrl || null;
          } catch { /* ignore */ }
        }
        if (!imageUrl) {
          return new Response(JSON.stringify({ base64: null }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
          });
        }
        try {
          const imgRes = await fetch(imageUrl);
          if (!imgRes.ok) throw new Error('fetch failed');
          const imgBuf = await imgRes.arrayBuffer();
          const u8 = new Uint8Array(imgBuf);
          let bin = '';
          for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
          const ct = imgRes.headers.get('content-type') || 'image/jpeg';
          return new Response(JSON.stringify({ base64: `data:${ct};base64,${btoa(bin)}` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
          });
        } catch {
          return new Response(JSON.stringify({ base64: null }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
          });
        }
      }

      default:
        throw new Error(`Invalid action: ${action}`);
    }

    const apiUrl = `${EVOLUTION_API_URL}${endpoint}`;
    const response = await fetch(apiUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY,
      },
      body,
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : { success: response.ok };
    } catch (_e) {
      data = { message: responseText };
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: response.status,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
