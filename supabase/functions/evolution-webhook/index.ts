import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const EVOLUTION_API_URL = "http://76.13.155.93:8083";
const EVOLUTION_API_KEY = "mata123";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(data: Record<string, unknown> = { success: true }) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

// Extract text content and media URL from a message based on its type
function extractMessageContent(msg: any): { content: string | null; mediaUrl: string | null } {
  const messageType = msg.messageType || '';
  const message = msg.message || {};

  switch (messageType) {
    case 'conversation':
      return { content: message.conversation || null, mediaUrl: null };
    case 'extendedTextMessage':
      return { content: message.extendedTextMessage?.text || null, mediaUrl: null };
    case 'imageMessage':
      return { content: message.imageMessage?.caption || null, mediaUrl: message.imageMessage?.url || null };
    case 'videoMessage':
      return { content: message.videoMessage?.caption || null, mediaUrl: message.videoMessage?.url || null };
    case 'audioMessage':
      return { content: `[Audio ${message.audioMessage?.seconds || 0}s]`, mediaUrl: message.audioMessage?.url || null };
    case 'documentMessage':
      return { content: message.documentMessage?.fileName || '[Document]', mediaUrl: message.documentMessage?.url || null };
    case 'stickerMessage':
      return { content: '[Sticker]', mediaUrl: message.stickerMessage?.url || null };
    case 'reactionMessage': {
      const rm = message.reactionMessage || {};
      const targetId = rm.key?.id || '';
      const emoji = rm.text || '';
      return { content: JSON.stringify({ targetMessageId: targetId, emoji }), mediaUrl: null };
    }
    case 'contactMessage':
      return { content: '[Contact]', mediaUrl: null };
    case 'locationMessage':
      return { content: '[Location]', mediaUrl: null };
    default:
      return { content: null, mediaUrl: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();
    const event = payload.event || '';
    const instanceName = payload.instance || '';

    // ── messages.upsert ─────────────────────────────────────────────────
    if (event === 'messages.upsert') {
      const msg = payload.data;
      if (!msg?.key) return ok({ skipped: 'no key' });

      const remoteJid = msg.key.remoteJid || '';

      // Skip group messages and status broadcasts
      if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        return ok({ skipped: 'group or status' });
      }

      // Skip protocol messages (reactions ARE stored)
      const messageType = msg.messageType || '';
      if (messageType === 'protocolMessage') return ok({ skipped: 'protocol' });

      const pushName = msg.pushName || '';
      const direction = msg.key.fromMe ? 'outgoing' : 'incoming';
      const msgId = msg.key.id;
      const { content, mediaUrl } = extractMessageContent(msg);
      const remoteJidAlt = msg.key.remoteJidAlt || null;

      // Timestamp
      const createdAt = msg.messageTimestamp
        ? new Date(msg.messageTimestamp * 1000).toISOString()
        : new Date().toISOString();

      // Find the instance
      const { data: instanceData } = await supabase
        .from('whatsapp_instances')
        .select('id, business_id')
        .eq('instance_name', instanceName)
        .single();

      if (!instanceData) {
        console.error(`Instance not found: ${instanceName}`);
        return ok({ success: false, error: 'instance not found' });
      }

      // ── LID→Phone mapping ──────────────────────────────────────────
      if (remoteJid.includes('@lid') && remoteJidAlt?.includes('@s.whatsapp.net')) {
        await supabase
          .from('whatsapp_jid_mappings')
          .upsert(
            {
              business_id: instanceData.business_id,
              instance_id: instanceData.id,
              lid_jid: remoteJid,
              phone_jid: remoteJidAlt,
            },
            { onConflict: 'business_id, lid_jid' }
          );
      }

      // ── Upsert contact ────────────────────────────────────────────
      // Determine the phone-format JID for contact storage
      const contactJid = remoteJidAlt || remoteJid;

      // Build contact payload - only include name for incoming with valid pushName
      const contactPayload: Record<string, unknown> = {
        business_id: instanceData.business_id,
        phone_number: contactJid,
        instance_id: instanceData.id,
        updated_at: new Date().toISOString(),
      };
      // Only set name when: incoming message, pushName exists, and pushName isn't just a raw number/JID
      if (direction === 'incoming' && pushName && pushName !== remoteJid.split('@')[0]) {
        contactPayload.name = pushName;
      }

      const { data: contactData, error: contactError } = await supabase
        .from('whatsapp_contacts')
        .upsert(contactPayload, { onConflict: 'business_id, phone_number', ignoreDuplicates: false })
        .select('id')
        .single();

      if (contactError) {
        console.error('Contact upsert error:', contactError);
        return ok({ success: false, error: contactError.message });
      }

      // ── Map status ────────────────────────────────────────────────
      let status = 'sent';
      const evoStatus = msg.status || '';
      if (evoStatus === 'READ') status = 'read';
      else if (evoStatus === 'DELIVERY_ACK') status = 'delivered';
      else if (evoStatus === 'SERVER_ACK') status = 'sent';

      // ── Store raw key for media retrieval ─────────────────────────
      const rawKey = msg.key ? {
        id: msg.key.id,
        fromMe: msg.key.fromMe,
        remoteJid: msg.key.remoteJid,
      } : null;

      // ── Upsert message ────────────────────────────────────────────
      // Use the LID jid if present (canonical), otherwise use phone jid
      const messageRemoteJid = remoteJid;

      const { error: msgError } = await supabase
        .from('whatsapp_messages')
        .upsert(
          {
            business_id: instanceData.business_id,
            instance_id: instanceData.id,
            contact_id: contactData.id,
            remote_jid: messageRemoteJid,
            message_id: msgId,
            type: messageType,
            content,
            media_url: mediaUrl,
            direction,
            status,
            created_at: createdAt,
            raw_key: rawKey,
          },
          { onConflict: 'message_id' }
        );

      if (msgError) console.error('Message upsert error:', msgError);
    }

    // ── messages.update (read receipts / delivery status) ────────────────
    else if (event === 'messages.update') {
      const updates = payload.data;
      // Can be a single object or array
      const items = Array.isArray(updates) ? updates : [updates];

      for (const data of items) {
        const keyId = data?.keyId || data?.key?.id;
        const rawStatus = data?.status;
        if (!keyId || !rawStatus) continue;

        let mappedStatus = 'sent';
        if (rawStatus === 'READ' || rawStatus === 5) mappedStatus = 'read';
        else if (rawStatus === 'DELIVERY_ACK' || rawStatus === 3) mappedStatus = 'delivered';
        else if (rawStatus === 'SERVER_ACK' || rawStatus === 2) mappedStatus = 'sent';

        await supabase
          .from('whatsapp_messages')
          .update({ status: mappedStatus })
          .eq('message_id', keyId);
      }
    }

    // ── connection.update ────────────────────────────────────────────────
    else if (event === 'connection.update') {
      const state = payload.data?.state;
      if (!state) return ok();

      let mappedStatus = 'disconnected';
      if (state === 'open') mappedStatus = 'open';
      else if (state === 'connecting') mappedStatus = 'connecting';
      else if (state === 'close') mappedStatus = 'disconnected';

      const updatePayload: Record<string, unknown> = {
        status: mappedStatus,
        updated_at: new Date().toISOString(),
      };

      // When connection opens, fetch instance details for phone number and profile pic
      if (state === 'open') {
        try {
          const res = await fetch(
            `${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`,
            { headers: { 'apikey': EVOLUTION_API_KEY } }
          );
          if (res.ok) {
            const instances = await res.json();
            const inst = Array.isArray(instances) ? instances[0] : instances;
            if (inst) {
              const ownerPhone = inst.ownerJid?.split('@')[0];
              if (ownerPhone) updatePayload.phone_number = ownerPhone;
              if (inst.profilePicUrl) updatePayload.profile_pic = inst.profilePicUrl;
            }
          }
        } catch (e) {
          console.error('Failed to fetch instance details on connect:', e);
        }
      }

      await supabase
        .from('whatsapp_instances')
        .update(updatePayload)
        .eq('instance_name', instanceName);
    }

    // ── contacts.upsert / contacts.update ───────────────────────────────
    else if (event === 'contacts.upsert' || event === 'contacts.update') {
      const contacts = Array.isArray(payload.data) ? payload.data : [payload.data];
      if (!contacts.length) return ok();

      // Find instance
      const { data: instanceData } = await supabase
        .from('whatsapp_instances')
        .select('id, business_id')
        .eq('instance_name', instanceName)
        .single();

      if (!instanceData) return ok({ skipped: 'instance not found' });

      for (const contact of contacts) {
        if (!contact?.id && !contact?.remoteJid) continue;
        const jid = contact.remoteJid || contact.id;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

        const contactPayload: Record<string, unknown> = {
          business_id: instanceData.business_id,
          phone_number: jid,
          instance_id: instanceData.id,
          updated_at: new Date().toISOString(),
        };

        if (contact.pushName) contactPayload.name = contact.pushName;
        if (contact.profilePictureUrl) contactPayload.profile_pic = contact.profilePictureUrl;

        await supabase
          .from('whatsapp_contacts')
          .upsert(contactPayload, { onConflict: 'business_id, phone_number', ignoreDuplicates: false });
      }
    }

    return ok();
  } catch (error) {
    console.error('Webhook error:', error);
    return ok({ error: (error as Error).message });
  }
});
