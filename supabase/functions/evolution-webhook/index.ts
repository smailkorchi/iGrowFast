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

// ── Extract text content and media URL from a message ────────────────────────
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
      return { content: JSON.stringify({ targetMessageId: rm.key?.id || '', emoji: rm.text || '' }), mediaUrl: null };
    }
    case 'contactMessage':
      return { content: '[Contact]', mediaUrl: null };
    case 'locationMessage':
      return { content: '[Location]', mediaUrl: null };
    case 'pollCreationMessage':
      return { content: '[Poll]', mediaUrl: null };
    case 'listMessage':
      return { content: '[List]', mediaUrl: null };
    default:
      return { content: null, mediaUrl: null };
  }
}

// ── Resolve instance from DB ─────────────────────────────────────────────────
async function resolveInstance(supabase: any, instanceName: string) {
  const { data } = await supabase
    .from('whatsapp_instances')
    .select('id, business_id')
    .eq('instance_name', instanceName)
    .single();
  return data;
}

// ── Resolve canonical JID via jid_mappings (phone-only, no name matching) ────
async function resolveCanonicalJid(
  supabase: any, businessId: string, instanceId: string, remoteJid: string, remoteJidAlt: string | null
): Promise<string> {
  // If it's a group or broadcast, the JID is canonical as-is
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return remoteJid;

  // Store LID→Phone mapping if both are available
  if (remoteJid.includes('@lid') && remoteJidAlt?.includes('@s.whatsapp.net')) {
    await supabase.from('whatsapp_jid_mappings').upsert({
      business_id: businessId,
      instance_id: instanceId,
      lid_jid: remoteJid,
      phone_jid: remoteJidAlt,
    }, { onConflict: 'business_id, lid_jid' });
  }

  // If message uses phone JID, check if a LID mapping exists → use LID as canonical
  if (remoteJid.includes('@s.whatsapp.net')) {
    const { data: mapping } = await supabase
      .from('whatsapp_jid_mappings')
      .select('lid_jid')
      .eq('business_id', businessId)
      .eq('phone_jid', remoteJid)
      .maybeSingle();
    if (mapping?.lid_jid) return mapping.lid_jid;
  }

  return remoteJid;
}

// ── Upsert conversation record (works for both individual + group) ───────────
async function upsertConversation(
  supabase: any,
  params: {
    businessId: string; instanceId: string; jid: string;
    type: 'individual' | 'group' | 'broadcast';
    displayName?: string | null; profilePic?: string | null;
    contactId?: string | null; groupId?: string | null;
    lastMessageId?: string; lastMessageContent?: string | null;
    lastMessageType?: string; lastMessageDirection?: string;
    lastMessageTs?: string; lastMessageStatus?: string;
  }
) {
  const payload: Record<string, unknown> = {
    business_id: params.businessId,
    instance_id: params.instanceId,
    jid: params.jid,
    type: params.type,
    updated_at: new Date().toISOString(),
  };
  if (params.displayName !== undefined) payload.display_name = params.displayName;
  if (params.profilePic !== undefined) payload.profile_pic = params.profilePic;
  if (params.contactId) payload.contact_id = params.contactId;
  if (params.groupId) payload.group_id = params.groupId;
  if (params.lastMessageId) {
    payload.last_message_id = params.lastMessageId;
    payload.last_message_content = params.lastMessageContent;
    payload.last_message_type = params.lastMessageType;
    payload.last_message_direction = params.lastMessageDirection;
    payload.last_message_ts = params.lastMessageTs;
    payload.last_message_status = params.lastMessageStatus;
  }

  const { data } = await supabase
    .from('whatsapp_conversations')
    .upsert(payload, { onConflict: 'business_id, instance_id, jid' })
    .select('id, group_id')
    .single();
  return data;
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

    // ══════════════════════════════════════════════════════════════════
    // messages.upsert — Individual + Group messages
    // ══════════════════════════════════════════════════════════════════
    if (event === 'messages.upsert') {
      const msg = payload.data;
      if (!msg?.key) return ok({ skipped: 'no key' });

      const remoteJid = msg.key.remoteJid || '';

      // Skip status broadcasts
      if (remoteJid === 'status@broadcast') return ok({ skipped: 'status' });

      // Skip protocol messages (reactions ARE stored)
      const messageType = msg.messageType || '';
      if (messageType === 'protocolMessage') return ok({ skipped: 'protocol' });

      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ success: false, error: 'instance not found' });

      const pushName = msg.pushName || '';
      const direction = msg.key.fromMe ? 'outgoing' : 'incoming';
      const msgId = msg.key.id;
      const { content, mediaUrl } = extractMessageContent(msg);
      const remoteJidAlt = msg.key.remoteJidAlt || null;

      const createdAt = msg.messageTimestamp
        ? new Date(msg.messageTimestamp * 1000).toISOString()
        : new Date().toISOString();

      // Map status
      let status = 'sent';
      const evoStatus = msg.status || '';
      if (evoStatus === 'READ') status = 'read';
      else if (evoStatus === 'DELIVERY_ACK') status = 'delivered';

      const rawKey = msg.key ? { id: msg.key.id, fromMe: msg.key.fromMe, remoteJid: msg.key.remoteJid } : null;

      const isGroup = remoteJid.endsWith('@g.us');

      // ── GROUP MESSAGE ─────────────────────────────────────────────
      if (isGroup) {
        const senderJid = msg.key.participant || '';

        // Ensure group exists in DB (minimal upsert — full metadata comes from sync/group events)
        await supabase.from('whatsapp_groups').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          group_jid: remoteJid,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'business_id, instance_id, group_jid' });

        // Get group_id
        const { data: groupRow } = await supabase
          .from('whatsapp_groups')
          .select('id, subject, profile_pic')
          .eq('business_id', instanceData.business_id)
          .eq('instance_id', instanceData.id)
          .eq('group_jid', remoteJid)
          .single();

        // Upsert conversation
        const convData = await upsertConversation(supabase, {
          businessId: instanceData.business_id,
          instanceId: instanceData.id,
          jid: remoteJid,
          type: 'group',
          displayName: groupRow?.subject || pushName || null,
          profilePic: groupRow?.profile_pic || null,
          groupId: groupRow?.id || null,
          lastMessageId: msgId,
          lastMessageContent: content,
          lastMessageType: messageType,
          lastMessageDirection: direction,
          lastMessageTs: createdAt,
          lastMessageStatus: status,
        });

        // Store message
        await supabase.from('whatsapp_messages').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          contact_id: null,
          conversation_id: convData?.id || null,
          remote_jid: remoteJid,
          message_id: msgId,
          type: messageType,
          content,
          media_url: mediaUrl,
          direction,
          status,
          sender_jid: senderJid,
          created_at: createdAt,
          raw_key: rawKey,
        }, { onConflict: 'message_id' });

        return ok();
      }

      // ── INDIVIDUAL MESSAGE ────────────────────────────────────────
      const canonicalJid = await resolveCanonicalJid(
        supabase, instanceData.business_id, instanceData.id, remoteJid, remoteJidAlt
      );

      // Upsert contact keyed to canonical JID
      const { data: existingContact } = await supabase
        .from('whatsapp_contacts')
        .select('id, name')
        .eq('business_id', instanceData.business_id)
        .eq('phone_number', canonicalJid)
        .maybeSingle();

      const contactPayload: Record<string, unknown> = {
        business_id: instanceData.business_id,
        phone_number: canonicalJid,
        instance_id: instanceData.id,
        updated_at: new Date().toISOString(),
      };
      // Only set name if contact has NO name yet
      if (!existingContact?.name && direction === 'incoming' && pushName && pushName !== remoteJid.split('@')[0]) {
        contactPayload.name = pushName;
      }

      const { data: contactData, error: contactError } = await supabase
        .from('whatsapp_contacts')
        .upsert(contactPayload, { onConflict: 'business_id, phone_number', ignoreDuplicates: false })
        .select('id')
        .single();

      // Keep phone JID contact in sync if canonical is LID
      if (canonicalJid !== remoteJid || remoteJidAlt?.includes('@s.whatsapp.net')) {
        const phoneJid = remoteJid.includes('@s.whatsapp.net') ? remoteJid : remoteJidAlt;
        if (phoneJid) {
          const altPayload: Record<string, unknown> = {
            business_id: instanceData.business_id,
            phone_number: phoneJid,
            instance_id: instanceData.id,
            updated_at: new Date().toISOString(),
          };
          if (direction === 'incoming' && pushName && pushName !== remoteJid.split('@')[0]) {
            altPayload.name = pushName;
          }
          await supabase
            .from('whatsapp_contacts')
            .upsert(altPayload, { onConflict: 'business_id, phone_number', ignoreDuplicates: false });
        }
      }

      if (contactError) {
        console.error('Contact upsert error:', contactError);
        return ok({ success: false, error: contactError.message });
      }

      // Upsert conversation
      const displayName = existingContact?.name || (direction === 'incoming' ? pushName : null) || null;
      const convData = await upsertConversation(supabase, {
        businessId: instanceData.business_id,
        instanceId: instanceData.id,
        jid: canonicalJid,
        type: 'individual',
        displayName,
        contactId: contactData?.id || null,
        lastMessageId: msgId,
        lastMessageContent: content,
        lastMessageType: messageType,
        lastMessageDirection: direction,
        lastMessageTs: createdAt,
        lastMessageStatus: status,
      });

      // Store message
      const { error: msgError } = await supabase
        .from('whatsapp_messages')
        .upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          contact_id: contactData?.id || null,
          conversation_id: convData?.id || null,
          remote_jid: canonicalJid,
          message_id: msgId,
          type: messageType,
          content,
          media_url: mediaUrl,
          direction,
          status,
          sender_jid: null,
          created_at: createdAt,
          raw_key: rawKey,
        }, { onConflict: 'message_id' });

      if (msgError) console.error('Message upsert error:', msgError);
    }

    // ══════════════════════════════════════════════════════════════════
    // messages.update — Read receipts / delivery status
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'messages.update') {
      const updates = payload.data;
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

    // ══════════════════════════════════════════════════════════════════
    // connection.update — Instance connection state
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'connection.update') {
      const state = payload.data?.state;
      if (!state) return ok();

      let mappedStatus = 'disconnected';
      if (state === 'open') mappedStatus = 'open';
      else if (state === 'connecting') mappedStatus = 'connecting';

      const updatePayload: Record<string, unknown> = {
        status: mappedStatus,
        updated_at: new Date().toISOString(),
      };

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

    // ══════════════════════════════════════════════════════════════════
    // contacts.upsert / contacts.update
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'contacts.upsert' || event === 'contacts.update') {
      const contacts = Array.isArray(payload.data) ? payload.data : [payload.data];
      if (!contacts.length) return ok();

      const instanceData = await resolveInstance(supabase, instanceName);
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

        // Extract LID↔Phone mapping from contact's lid field
        const lid = contact.lid;
        const phoneJid = jid.includes('@s.whatsapp.net') ? jid : null;
        if (lid && phoneJid) {
          await supabase.from('whatsapp_jid_mappings').upsert({
            business_id: instanceData.business_id,
            instance_id: instanceData.id,
            lid_jid: lid,
            phone_jid: phoneJid,
          }, { onConflict: 'business_id, lid_jid' });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // groups.upsert — Group created or metadata changed
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'groups.upsert') {
      const groups = Array.isArray(payload.data) ? payload.data : [payload.data];
      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ skipped: 'instance not found' });

      for (const group of groups) {
        if (!group?.id) continue;

        await supabase.from('whatsapp_groups').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          group_jid: group.id,
          subject: group.subject || null,
          description: group.desc || group.description || null,
          owner_jid: group.owner || null,
          profile_pic: group.profilePictureUrl || null,
          participant_count: group.participants?.length || 0,
          creation_ts: group.creation || null,
          is_announce: group.announce || false,
          is_restrict: group.restrict || false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'business_id, instance_id, group_jid' });

        // Also upsert conversation for this group
        await upsertConversation(supabase, {
          businessId: instanceData.business_id,
          instanceId: instanceData.id,
          jid: group.id,
          type: 'group',
          displayName: group.subject || null,
          profilePic: group.profilePictureUrl || null,
        });

        // Upsert participants if present
        if (group.participants?.length) {
          const { data: groupRow } = await supabase
            .from('whatsapp_groups')
            .select('id')
            .eq('business_id', instanceData.business_id)
            .eq('instance_id', instanceData.id)
            .eq('group_jid', group.id)
            .single();

          if (groupRow) {
            for (const p of group.participants) {
              if (!p.id) continue;
              await supabase.from('whatsapp_group_participants').upsert({
                group_id: groupRow.id,
                business_id: instanceData.business_id,
                participant_jid: p.id,
                role: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member',
                display_name: p.pushName || null,
              }, { onConflict: 'group_id, participant_jid' });
            }
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // group.update — Group settings/metadata changed
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'group.update') {
      const data = payload.data;
      if (!data?.id) return ok({ skipped: 'no group id' });

      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ skipped: 'instance not found' });

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.subject !== undefined) updatePayload.subject = data.subject;
      if (data.desc !== undefined || data.description !== undefined) updatePayload.description = data.desc || data.description;
      if (data.announce !== undefined) updatePayload.is_announce = data.announce;
      if (data.restrict !== undefined) updatePayload.is_restrict = data.restrict;
      if (data.profilePictureUrl !== undefined) updatePayload.profile_pic = data.profilePictureUrl;

      await supabase.from('whatsapp_groups')
        .update(updatePayload)
        .eq('business_id', instanceData.business_id)
        .eq('instance_id', instanceData.id)
        .eq('group_jid', data.id);

      // Update conversation display name if subject changed
      if (data.subject) {
        await supabase.from('whatsapp_conversations')
          .update({ display_name: data.subject, updated_at: new Date().toISOString() })
          .eq('business_id', instanceData.business_id)
          .eq('instance_id', instanceData.id)
          .eq('jid', data.id);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // group-participants.update — Participants added/removed/promoted/demoted
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'group-participants.update') {
      const data = payload.data;
      const groupJid = data?.id;
      const action = data?.action; // 'add' | 'remove' | 'promote' | 'demote'
      const participants = data?.participants || [];

      if (!groupJid || !action || !participants.length) return ok({ skipped: 'incomplete data' });

      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ skipped: 'instance not found' });

      const { data: groupRow } = await supabase
        .from('whatsapp_groups')
        .select('id')
        .eq('business_id', instanceData.business_id)
        .eq('instance_id', instanceData.id)
        .eq('group_jid', groupJid)
        .single();

      if (!groupRow) return ok({ skipped: 'group not found' });

      for (const participantJid of participants) {
        if (action === 'remove') {
          await supabase.from('whatsapp_group_participants')
            .delete()
            .eq('group_id', groupRow.id)
            .eq('participant_jid', participantJid);
        } else if (action === 'add') {
          await supabase.from('whatsapp_group_participants').upsert({
            group_id: groupRow.id,
            business_id: instanceData.business_id,
            participant_jid: participantJid,
            role: 'member',
          }, { onConflict: 'group_id, participant_jid' });
        } else if (action === 'promote') {
          await supabase.from('whatsapp_group_participants')
            .update({ role: 'admin' })
            .eq('group_id', groupRow.id)
            .eq('participant_jid', participantJid);
        } else if (action === 'demote') {
          await supabase.from('whatsapp_group_participants')
            .update({ role: 'member' })
            .eq('group_id', groupRow.id)
            .eq('participant_jid', participantJid);
        }
      }

      // Update participant count
      const { count } = await supabase
        .from('whatsapp_group_participants')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupRow.id);

      await supabase.from('whatsapp_groups')
        .update({ participant_count: count || 0, updated_at: new Date().toISOString() })
        .eq('id', groupRow.id);
    }

    // ══════════════════════════════════════════════════════════════════
    // labels.edit — WhatsApp-native label created/updated/deleted
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'labels.edit') {
      const data = payload.data;
      if (!data) return ok({ skipped: 'no data' });

      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ skipped: 'instance not found' });

      if (data.name) {
        await supabase.from('whatsapp_labels').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          name: data.name,
          color: data.color || '#00a884',
        }, { onConflict: 'business_id, instance_id, name' });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // labels.association — Label assigned/removed from chat
    // ══════════════════════════════════════════════════════════════════
    else if (event === 'labels.association') {
      const data = payload.data;
      if (!data?.association) return ok({ skipped: 'no association' });

      const instanceData = await resolveInstance(supabase, instanceName);
      if (!instanceData) return ok({ skipped: 'instance not found' });

      const assoc = data.association;
      const chatJid = assoc.chatId || assoc.remoteJid;
      const labelId = assoc.labelId;
      const type = assoc.type; // 'add' or 'remove'

      if (!chatJid || !labelId) return ok({ skipped: 'incomplete label association' });

      // Find our internal label by matching Evolution's label ID via name lookup
      // For now, store the association with the Evolution labelId as a reference
      if (type === 'remove') {
        await supabase.from('whatsapp_chat_labels')
          .delete()
          .eq('business_id', instanceData.business_id)
          .eq('instance_id', instanceData.id)
          .eq('remote_jid', chatJid);
      }
    }

    return ok();
  } catch (error) {
    console.error('Webhook error:', error);
    return ok({ error: (error as Error).message });
  }
});
