// @ts-nocheck
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

// ── Resolve BOTH JID formats (phone + LID) from webhook payload ─────────────
async function resolveJids(
  supabase: any, businessId: string, instanceId: string, remoteJid: string, remoteJidAlt: string | null
): Promise<{ phoneJid: string | null; lidJid: string | null }> {
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast')
    return { phoneJid: null, lidJid: null };

  let phoneJid: string | null = null;
  let lidJid: string | null = null;

  // Classify incoming JIDs
  if (remoteJid.includes('@lid')) lidJid = remoteJid;
  if (remoteJid.includes('@s.whatsapp.net')) phoneJid = remoteJid;
  if (remoteJidAlt?.includes('@s.whatsapp.net')) phoneJid = remoteJidAlt;
  if (remoteJidAlt?.includes('@lid')) lidJid = remoteJidAlt;

  // Store mapping if we have both
  if (lidJid && phoneJid) {
    await supabase.from('whatsapp_jid_mappings').upsert({
      business_id: businessId, instance_id: instanceId,
      lid_jid: lidJid, phone_jid: phoneJid,
    }, { onConflict: 'business_id, lid_jid' });
  }

  // If we only have one, try to resolve the other from mappings
  if (lidJid && !phoneJid) {
    const { data } = await supabase.from('whatsapp_jid_mappings')
      .select('phone_jid').eq('business_id', businessId).eq('lid_jid', lidJid).maybeSingle();
    if (data) phoneJid = data.phone_jid;
  }
  if (phoneJid && !lidJid) {
    const { data } = await supabase.from('whatsapp_jid_mappings')
      .select('lid_jid').eq('business_id', businessId).eq('phone_jid', phoneJid).maybeSingle();
    if (data) lidJid = data.lid_jid;
  }

  // Last resort: check conversations table for cross-JID references
  // If a conversation already has the other JID format stored, use it
  if (phoneJid && !lidJid) {
    const { data: conv } = await supabase.from('whatsapp_conversations')
      .select('lid_jid').eq('business_id', businessId).eq('instance_id', instanceId)
      .or(`phone_jid.eq.${phoneJid},jid.eq.${phoneJid}`)
      .not('lid_jid', 'is', null)
      .limit(1).maybeSingle();
    if (conv?.lid_jid) lidJid = conv.lid_jid;
  }
  if (lidJid && !phoneJid) {
    const { data: conv } = await supabase.from('whatsapp_conversations')
      .select('phone_jid').eq('business_id', businessId).eq('instance_id', instanceId)
      .or(`lid_jid.eq.${lidJid},jid.eq.${lidJid}`)
      .not('phone_jid', 'is', null)
      .limit(1).maybeSingle();
    if (conv?.phone_jid) phoneJid = conv.phone_jid;
  }

  // Store newly discovered mapping
  if (lidJid && phoneJid) {
    await supabase.from('whatsapp_jid_mappings').upsert({
      business_id: businessId, instance_id: instanceId,
      lid_jid: lidJid, phone_jid: phoneJid,
    }, { onConflict: 'business_id, lid_jid' });
  }

  return { phoneJid, lidJid };
}

// ── Find conversation by ANY JID format, or create new ──────────────────────
async function findOrCreateConversation(
  supabase: any,
  params: {
    businessId: string; instanceId: string; jid: string;
    phoneJid?: string | null; lidJid?: string | null;
    type: 'individual' | 'group' | 'broadcast';
    displayName?: string | null; profilePic?: string | null;
    contactId?: string | null; groupId?: string | null;
    lastMessageId?: string; lastMessageContent?: string | null;
    lastMessageType?: string; lastMessageDirection?: string;
    lastMessageTs?: string; lastMessageStatus?: string;
  }
) {
  const { businessId, instanceId, jid, phoneJid, lidJid } = params;

  // Build list of candidate JIDs to search by
  const candidates = [jid];
  if (phoneJid && phoneJid !== jid) candidates.push(phoneJid);
  if (lidJid && lidJid !== jid) candidates.push(lidJid);

  // COMPREHENSIVE search: find ALL conversations that could belong to this contact
  // Search by JID columns, contact_id, AND display_name in a SINGLE pass
  // This prevents duplicates by finding existing conversations regardless of JID format
  let orParts = candidates.map(c => `jid.eq.${c},phone_jid.eq.${c},lid_jid.eq.${c}`);
  // Also search by display_name for individual chats (catches LID↔phone split)
  if (params.displayName && params.type === 'individual') {
    orParts.push(`display_name.eq.${params.displayName}`);
  }
  const orFilters = orParts.join(',');

  let { data: matches } = await supabase
    .from('whatsapp_conversations')
    .select('id, jid, group_id, phone_jid, lid_jid, profile_pic')
    .eq('business_id', businessId)
    .eq('instance_id', instanceId)
    .or(orFilters)
    .limit(5);

  // Additional fallback: search by contact_id if nothing found
  if ((!matches || matches.length === 0) && params.contactId && params.type === 'individual') {
    const { data: contactMatch } = await supabase
      .from('whatsapp_conversations')
      .select('id, jid, group_id, phone_jid, lid_jid, profile_pic')
      .eq('business_id', businessId)
      .eq('instance_id', instanceId)
      .eq('contact_id', params.contactId)
      .limit(1)
      .maybeSingle();
    if (contactMatch) matches = [contactMatch];
  }

  // If multiple conversations match (duplicate due to JID split), merge them
  let existing = matches?.[0] || null;
  if (matches && matches.length > 1) {
    // Keep the oldest (first created = has more messages), merge others into it
    const primary = matches[0];
    for (let i = 1; i < matches.length; i++) {
      const dup = matches[i];
      // Move all messages from duplicate to primary
      await supabase.from('whatsapp_messages')
        .update({ conversation_id: primary.id, remote_jid: primary.jid })
        .eq('conversation_id', dup.id);
      // Move any orphaned messages that reference the dup's jid
      await supabase.from('whatsapp_messages')
        .update({ conversation_id: primary.id, remote_jid: primary.jid })
        .eq('remote_jid', dup.jid)
        .eq('business_id', businessId)
        .eq('instance_id', instanceId);
      // Delete duplicate conversation
      await supabase.from('whatsapp_conversations').delete().eq('id', dup.id);
    }
    // Fill cross-references on the primary
    if (phoneJid && !primary.phone_jid) {
      await supabase.from('whatsapp_conversations').update({ phone_jid: phoneJid }).eq('id', primary.id);
      primary.phone_jid = phoneJid;
    }
    if (lidJid && !primary.lid_jid) {
      await supabase.from('whatsapp_conversations').update({ lid_jid: lidJid }).eq('id', primary.id);
      primary.lid_jid = lidJid;
    }
    existing = primary;
  }

  if (existing) {
    // Update existing conversation with latest message + fill missing JID columns
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (phoneJid && !existing.phone_jid) update.phone_jid = phoneJid;
    if (lidJid && !existing.lid_jid) update.lid_jid = lidJid;
    if (params.displayName !== undefined) update.display_name = params.displayName;
    if (params.profilePic !== undefined) update.profile_pic = params.profilePic;
    if (params.contactId) update.contact_id = params.contactId;
    if (params.groupId) update.group_id = params.groupId;

    // Fill missing profile_pic from contact record if conversation has none
    if (!existing.profile_pic && !params.profilePic && params.contactId) {
      const { data: contactRow } = await supabase.from('whatsapp_contacts')
        .select('profile_pic').eq('id', params.contactId).maybeSingle();
      if (contactRow?.profile_pic) update.profile_pic = contactRow.profile_pic;
    }
    if (params.lastMessageId) {
      update.last_message_id = params.lastMessageId;
      update.last_message_content = params.lastMessageContent;
      update.last_message_type = params.lastMessageType;
      update.last_message_direction = params.lastMessageDirection;
      update.last_message_ts = params.lastMessageTs;
      update.last_message_status = params.lastMessageStatus;
    }
    // Increment unread for incoming — check if message already stored to prevent double-count
    if (params.lastMessageDirection === 'incoming' && params.lastMessageId) {
      const { data: existingMsg } = await supabase.from('whatsapp_messages')
        .select('id').eq('message_id', params.lastMessageId).maybeSingle();
      if (!existingMsg) {
        const { data: cur } = await supabase.from('whatsapp_conversations')
          .select('unread_count').eq('id', existing.id).single();
        update.unread_count = (cur?.unread_count || 0) + 1;
      }
    }

    // Single update — one realtime event with all fields including unread
    await supabase.from('whatsapp_conversations').update(update).eq('id', existing.id);
    return { id: existing.id, jid: existing.jid, group_id: existing.group_id };
  }

  // Create new conversation
  const { data: newConv } = await supabase
    .from('whatsapp_conversations')
    .insert({
      business_id: businessId,
      instance_id: instanceId,
      jid,
      phone_jid: phoneJid || null,
      lid_jid: lidJid || null,
      type: params.type,
      display_name: params.displayName || null,
      profile_pic: params.profilePic || null,
      contact_id: params.contactId || null,
      group_id: params.groupId || null,
      last_message_id: params.lastMessageId || null,
      last_message_content: params.lastMessageContent || null,
      last_message_type: params.lastMessageType || null,
      last_message_direction: params.lastMessageDirection || null,
      last_message_ts: params.lastMessageTs || null,
      last_message_status: params.lastMessageStatus || null,
      updated_at: new Date().toISOString(),
    })
    .select('id, jid, group_id')
    .single();

  return newConv;
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

        // Find or create conversation
        const convData = await findOrCreateConversation(supabase, {
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
      const { phoneJid, lidJid } = await resolveJids(
        supabase, instanceData.business_id, instanceData.id, remoteJid, remoteJidAlt
      );

      // Build list of candidate JIDs for contact lookup
      const contactJids = [remoteJid, phoneJid, lidJid].filter(Boolean) as string[];
      const uniqueContactJids = [...new Set(contactJids)];

      // Find existing contact by any JID format
      const { data: existingContact } = await supabase
        .from('whatsapp_contacts')
        .select('id, name')
        .eq('business_id', instanceData.business_id)
        .in('phone_number', uniqueContactJids)
        .limit(1)
        .maybeSingle();

      // Upsert contact with the raw remoteJid (preserves whatever format we received)
      const contactPayload: Record<string, unknown> = {
        business_id: instanceData.business_id,
        phone_number: remoteJid,
        instance_id: instanceData.id,
        updated_at: new Date().toISOString(),
      };
      if (!existingContact?.name && direction === 'incoming' && pushName && pushName !== remoteJid.split('@')[0]) {
        contactPayload.name = pushName;
      }

      const { data: contactData, error: contactError } = await supabase
        .from('whatsapp_contacts')
        .upsert(contactPayload, { onConflict: 'business_id, phone_number', ignoreDuplicates: false })
        .select('id')
        .single();

      // Keep alternate JID contact in sync
      const altJid = phoneJid && phoneJid !== remoteJid ? phoneJid : (lidJid && lidJid !== remoteJid ? lidJid : null);
      if (altJid) {
        const altPayload: Record<string, unknown> = {
          business_id: instanceData.business_id,
          phone_number: altJid,
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

      if (contactError) {
        console.error('Contact upsert error:', contactError);
        return ok({ success: false, error: contactError.message });
      }

      // Find or create conversation (searches by ALL JID columns)
      const displayName = existingContact?.name || (direction === 'incoming' ? pushName : null) || null;
      const contactId = existingContact?.id || contactData?.id || null;
      const convData = await findOrCreateConversation(supabase, {
        businessId: instanceData.business_id,
        instanceId: instanceData.id,
        jid: remoteJid,
        phoneJid,
        lidJid,
        type: 'individual',
        displayName,
        contactId,
        lastMessageId: msgId,
        lastMessageContent: content,
        lastMessageType: messageType,
        lastMessageDirection: direction,
        lastMessageTs: createdAt,
        lastMessageStatus: status,
      });

      // Store message — use conversation's own JID for remote_jid consistency
      const { error: msgError } = await supabase
        .from('whatsapp_messages')
        .upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          contact_id: contactId,
          conversation_id: convData?.id || null,
          remote_jid: convData?.jid || remoteJid,
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

        // Also find/create conversation for this group
        await findOrCreateConversation(supabase, {
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

      // Strip invisible Unicode characters from label name
      const cleanName = (data.name || '').replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '').trim();
      if (cleanName) {
        await supabase.from('whatsapp_labels').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          name: cleanName,
          color: data.color || '#00a884',
          whatsapp_label_id: data.id || null,
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
      const waLabelId = assoc.labelId;
      const type = assoc.type; // 'add' or 'remove'

      if (!chatJid || !waLabelId) return ok({ skipped: 'incomplete label association' });

      // Find our internal label by Evolution's whatsapp_label_id
      const { data: labelRow } = await supabase.from('whatsapp_labels')
        .select('id')
        .eq('business_id', instanceData.business_id)
        .eq('instance_id', instanceData.id)
        .eq('whatsapp_label_id', waLabelId)
        .maybeSingle();

      if (!labelRow) return ok({ skipped: 'label not found in DB' });

      if (type === 'add') {
        await supabase.from('whatsapp_chat_labels').upsert({
          business_id: instanceData.business_id,
          instance_id: instanceData.id,
          remote_jid: chatJid,
          label_id: labelRow.id,
        }, { onConflict: 'business_id, instance_id, remote_jid, label_id' });
      } else if (type === 'remove') {
        await supabase.from('whatsapp_chat_labels')
          .delete()
          .eq('business_id', instanceData.business_id)
          .eq('instance_id', instanceData.id)
          .eq('remote_jid', chatJid)
          .eq('label_id', labelRow.id);
      }
    }

    return ok();
  } catch (error) {
    console.error('Webhook error:', error);
    return ok({ error: (error as Error).message });
  }
});
