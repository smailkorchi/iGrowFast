// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const EVOLUTION_API_URL = "http://76.13.155.93:8083";
const EVOLUTION_API_KEY = "mata123";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function ok(data: Record<string, unknown> = { success: true }) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

// ── Time management ──────────────────────────────────────────────────────────
const INVOCATION_START = Date.now();
const TIME_LIMIT_MS = 120_000; // 120s, leaving 30s buffer
function shouldYield(): boolean {
  return Date.now() - INVOCATION_START > TIME_LIMIT_MS;
}

// ── Evolution API helper ─────────────────────────────────────────────────────
async function evoFetch(
  endpoint: string,
  method = "POST",
  body: unknown = null
): Promise<any> {
  const res = await fetch(`${EVOLUTION_API_URL}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { _raw: text };
  }
}

// ── Phase definitions ────────────────────────────────────────────────────────
const PHASE_NAMES = [
  "contacts",
  "chats_jid",
  "groups",
  "labels",
  "conversations",
  "profile_pics",
  "messages",
  "name_backfill",
];

function buildInitialPhases() {
  return PHASE_NAMES.map((name, i) => ({
    phase: i + 1,
    name,
    status: "pending",
    progress: { total: 0, processed: 0, detail: "" },
    started_at: null,
    completed_at: null,
    error: null,
  }));
}

// ── Progress update (batched to reduce realtime noise) ───────────────────────
async function updatePhase(
  supabase: any,
  jobId: string,
  phaseIndex: number,
  patch: Record<string, any>,
  jobPatch: Record<string, any> = {}
) {
  const { data: job } = await supabase
    .from("whatsapp_sync_jobs")
    .select("phases")
    .eq("id", jobId)
    .single();
  if (!job) return;

  const phases = job.phases;
  phases[phaseIndex] = { ...phases[phaseIndex], ...patch };

  await supabase
    .from("whatsapp_sync_jobs")
    .update({
      phases,
      updated_at: new Date().toISOString(),
      ...jobPatch,
    })
    .eq("id", jobId);
}

// ── Self-chain ───────────────────────────────────────────────────────────────
// Since runPhases already runs inside EdgeRuntime.waitUntil, the fetch here
// is protected. We await it to ensure the request is dispatched before
// the background task exits.
async function chainNext(jobId: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${url}/functions/v1/evolution-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ action: "continue", job_id: jobId }),
    });
    console.log(`Chain dispatched for ${jobId}: HTTP ${res.status}`);
  } catch (err) {
    console.error("Chain invocation failed:", err);
  }
}

// ── Check if job was cancelled ───────────────────────────────────────────────
async function isCancelled(supabase: any, jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from("whatsapp_sync_jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  return data?.status === "cancelled";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 1: Contacts
// ═════════════════════════════════════════════════════════════════════════════
async function syncContacts(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 0;

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: 0, detail: "Fetching contacts from WhatsApp..." },
  });

  // Wait for Evolution API to populate contacts (freshly connected instance)
  await new Promise((r) => setTimeout(r, 5000));

  let contacts = await evoFetch(
    `/chat/findContacts/${instance_name}`,
    "POST",
    {}
  );

  // Retry if too few contacts (instance still loading)
  let contactCount = Array.isArray(contacts)
    ? contacts.filter(
      (c: any) =>
        (c.remoteJid || c.id) &&
        !(c.remoteJid || c.id).endsWith("@g.us") &&
        (c.remoteJid || c.id) !== "status@broadcast"
    ).length
    : 0;

  if (contactCount < 10) {
    await updatePhase(supabase, job.id, pi, {
      progress: { total: 0, processed: 0, detail: `Got ${contactCount} contacts, retrying...` },
    });
    await new Promise((r) => setTimeout(r, 10000));
    const retry = await evoFetch(
      `/chat/findContacts/${instance_name}`,
      "POST",
      {}
    );
    const retryCount = Array.isArray(retry)
      ? retry.filter(
        (c: any) =>
          (c.remoteJid || c.id) &&
          !(c.remoteJid || c.id).endsWith("@g.us") &&
          (c.remoteJid || c.id) !== "status@broadcast"
      ).length
      : 0;
    if (retryCount > contactCount) {
      contacts = retry;
      contactCount = retryCount;
    }
  }

  if (!Array.isArray(contacts)) {
    await updatePhase(supabase, job.id, pi, {
      status: "completed",
      completed_at: new Date().toISOString(),
      progress: { total: 0, processed: 0, detail: "No contacts returned" },
    });
    return "done";
  }

  const filtered = contacts.filter((c: any) => {
    const jid = c.remoteJid || c.id;
    return (
      jid && !jid.endsWith("@g.us") && jid !== "status@broadcast"
    );
  });

  const allMappings: { lid_jid: string; phone_jid: string }[] = [];

  // Extract LID↔phone mappings
  for (const c of filtered) {
    const jid = c.remoteJid || c.id;
    const lid = c.lid || (jid?.includes("@lid") ? jid : null);
    const phoneJid =
      (c.remoteJid?.includes("@s.whatsapp.net") ? c.remoteJid : null) ||
      (c.id?.includes("@s.whatsapp.net") ? c.id : null);
    if (lid && phoneJid && lid !== phoneJid) {
      allMappings.push({ lid_jid: lid, phone_jid: phoneJid });
    }
  }

  // Build contact batch (store under both JID formats)
  const contactBatch: any[] = [];
  for (const c of filtered) {
    const jid = c.remoteJid || c.id;
    const name = c.pushName || c.name || c.verifiedName || null;
    const pic = c.profilePictureUrl || c.imgUrl || null;

    contactBatch.push({
      business_id,
      phone_number: jid,
      name,
      profile_pic: pic,
      instance_id,
    });

    const lid = c.lid;
    if (lid && jid.includes("@s.whatsapp.net")) {
      contactBatch.push({
        business_id,
        phone_number: lid,
        name,
        profile_pic: pic,
        instance_id,
      });
    }
    if (jid.includes("@lid")) {
      const phoneFromMapping = allMappings.find(
        (m) => m.lid_jid === jid
      )?.phone_jid;
      if (phoneFromMapping) {
        contactBatch.push({
          business_id,
          phone_number: phoneFromMapping,
          name,
          profile_pic: pic,
          instance_id,
        });
      }
    }
  }

  await updatePhase(supabase, job.id, pi, {
    progress: {
      total: filtered.length,
      processed: 0,
      detail: `Upserting ${contactBatch.length} contact records...`,
    },
  });

  const batchSize = 50;
  for (let i = 0; i < contactBatch.length; i += batchSize) {
    if (shouldYield()) return "yield";
    await supabase.from("whatsapp_contacts").upsert(
      contactBatch.slice(i, i + batchSize),
      { onConflict: "business_id, phone_number", ignoreDuplicates: false }
    );
  }

  // Build LID↔Phone mappings from profile picture URL matching
  // Contacts with same profilePicUrl but different JID formats are the same person
  const picToJids: Record<string, { lids: string[]; phones: string[] }> = {};
  for (const c of filtered) {
    const jid = c.remoteJid || c.id;
    const pic = c.profilePictureUrl || c.imgUrl;
    if (!pic || !jid) continue;
    if (!picToJids[pic]) picToJids[pic] = { lids: [], phones: [] };
    if (jid.includes("@lid")) picToJids[pic].lids.push(jid);
    else if (jid.includes("@s.whatsapp.net")) picToJids[pic].phones.push(jid);
  }
  for (const [_pic, { lids, phones }] of Object.entries(picToJids)) {
    if (lids.length > 0 && phones.length > 0) {
      // Match first LID to first phone
      const existing = allMappings.find(m => m.lid_jid === lids[0]);
      if (!existing) {
        allMappings.push({ lid_jid: lids[0], phone_jid: phones[0] });
      }
    }
  }

  // Store all discovered mappings to DB
  if (allMappings.length > 0) {
    const mappingBatch = allMappings.map(m => ({
      business_id, instance_id, lid_jid: m.lid_jid, phone_jid: m.phone_jid,
    }));
    for (let i = 0; i < mappingBatch.length; i += 50) {
      await supabase.from("whatsapp_jid_mappings").upsert(
        mappingBatch.slice(i, i + 50),
        { onConflict: "business_id, lid_jid" }
      );
    }
  }

  // Store mappings in sync_metadata for later phases
  await supabase
    .from("whatsapp_sync_jobs")
    .update({
      sync_metadata: {
        ...(job.sync_metadata || {}),
        jid_mappings: allMappings,
        contacts_count: filtered.length,
      },
    })
    .eq("id", job.id);

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: filtered.length,
      processed: filtered.length,
      detail: `${filtered.length} contacts synced`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 2: Chats + JID Mappings
// ═════════════════════════════════════════════════════════════════════════════
async function syncChatsAndJid(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 1;

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: 0, detail: "Fetching chats..." },
  });

  const chatData = await evoFetch(
    `/chat/findChats/${instance_name}`,
    "POST",
    {}
  );

  if (!Array.isArray(chatData)) {
    await updatePhase(supabase, job.id, pi, {
      status: "completed",
      completed_at: new Date().toISOString(),
      progress: { total: 0, processed: 0, detail: "No chats returned" },
    });
    return "done";
  }

  const allChats = chatData.filter(
    (c: any) => c.remoteJid && c.remoteJid !== "status@broadcast"
  );
  const individualChats = allChats.filter(
    (c: any) => !c.remoteJid.endsWith("@g.us")
  );
  const groupChats = allChats.filter((c: any) =>
    c.remoteJid.endsWith("@g.us")
  );

  // Get existing mappings from Phase 1
  const existingMappings: { lid_jid: string; phone_jid: string }[] =
    job.sync_metadata?.jid_mappings || [];
  const allMappings = [...existingMappings];

  // Extract JID mappings from individual chats
  for (const chat of individualChats) {
    if (chat.remoteJid?.includes("@lid")) {
      const alt =
        chat.lastMessage?.key?.remoteJidAlt ||
        (chat.id?.includes("@s.whatsapp.net") ? chat.id : null) ||
        (chat.contact?.id?.includes("@s.whatsapp.net")
          ? chat.contact.id
          : null) ||
        (chat.participant?.includes("@s.whatsapp.net")
          ? chat.participant
          : null);
      if (alt?.includes("@s.whatsapp.net")) {
        allMappings.push({ lid_jid: chat.remoteJid, phone_jid: alt });
      }
    }
    if (chat.remoteJid?.includes("@s.whatsapp.net") && chat.lid) {
      allMappings.push({ lid_jid: chat.lid, phone_jid: chat.remoteJid });
    }
  }

  // Deduplicate and store mappings
  const seen = new Set<string>();
  const mappingBatch: any[] = [];
  for (const m of allMappings) {
    if (!seen.has(m.lid_jid)) {
      seen.add(m.lid_jid);
      mappingBatch.push({
        business_id,
        instance_id,
        lid_jid: m.lid_jid,
        phone_jid: m.phone_jid,
      });
    }
  }
  if (mappingBatch.length > 0) {
    await supabase
      .from("whatsapp_jid_mappings")
      .upsert(mappingBatch, { onConflict: "business_id, lid_jid" });
  }

  // Store chat JIDs in sync_metadata for phases 5 and 7
  const chatJids = allChats.map((c: any) => ({
    jid: c.remoteJid,
    is_group: c.remoteJid.endsWith("@g.us"),
    pushName: c.pushName || null,
    unreadCount: c.unreadCount || 0,
    lastMessage: c.lastMessage || null,
    profilePicUrl: c.profilePicUrl || null,
  }));

  await supabase
    .from("whatsapp_sync_jobs")
    .update({
      sync_metadata: {
        ...(job.sync_metadata || {}),
        jid_mappings: allMappings,
        chat_jids: chatJids,
        individual_count: individualChats.length,
        group_count: groupChats.length,
        total_chats: allChats.length,
      },
    })
    .eq("id", job.id);

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: allChats.length,
      processed: allChats.length,
      detail: `${individualChats.length} individual + ${groupChats.length} group chats, ${mappingBatch.length} JID mappings`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 3: Groups
// ═════════════════════════════════════════════════════════════════════════════
async function syncGroups(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 2;
  const cursor = job.phase_cursors?.groups || { group_index: 0 };

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: cursor.group_index, detail: "Fetching groups..." },
  });

  const groupsData = await evoFetch(
    `/group/fetchAllGroups/${instance_name}?getParticipants=true`,
    "GET"
  );

  if (!Array.isArray(groupsData)) {
    await updatePhase(supabase, job.id, pi, {
      status: "completed",
      completed_at: new Date().toISOString(),
      progress: { total: 0, processed: 0, detail: "No groups" },
    });
    return "done";
  }

  await updatePhase(supabase, job.id, pi, {
    progress: {
      total: groupsData.length,
      processed: cursor.group_index,
      detail: `Syncing ${groupsData.length} groups...`,
    },
  });

  // Batch upsert groups
  const groupBatch = groupsData.map((g: any) => ({
    business_id,
    instance_id,
    group_jid: g.id,
    subject: g.subject || null,
    description: g.desc || g.description || null,
    owner_jid: g.owner || null,
    profile_pic: g.profilePictureUrl || null,
    participant_count: g.participants?.length || 0,
    creation_ts: g.creation || null,
    is_community: g.isCommunity || false,
    is_announce: g.announce || false,
    is_restrict: g.restrict || false,
  }));

  for (let i = 0; i < groupBatch.length; i += 25) {
    await supabase.from("whatsapp_groups").upsert(
      groupBatch.slice(i, i + 25),
      { onConflict: "business_id, instance_id, group_jid" }
    );
  }

  // Upsert participants for each group starting from cursor
  for (let gi = cursor.group_index; gi < groupsData.length; gi++) {
    if (shouldYield()) {
      await supabase
        .from("whatsapp_sync_jobs")
        .update({
          phase_cursors: { ...(job.phase_cursors || {}), groups: { group_index: gi } },
        })
        .eq("id", job.id);
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: groupsData.length,
          processed: gi,
          detail: `Groups: ${gi}/${groupsData.length} (yielding)`,
        },
      });
      return "yield";
    }

    const g = groupsData[gi];
    if (!g.participants?.length) continue;

    const { data: groupRow } = await supabase
      .from("whatsapp_groups")
      .select("id")
      .eq("business_id", business_id)
      .eq("instance_id", instance_id)
      .eq("group_jid", g.id)
      .single();
    if (!groupRow) continue;

    const participantBatch = g.participants.map((p: any) => ({
      group_id: groupRow.id,
      business_id,
      participant_jid: p.id,
      role:
        p.admin === "superadmin"
          ? "superadmin"
          : p.admin === "admin"
            ? "admin"
            : "member",
      display_name: p.pushName || null,
    }));

    for (let i = 0; i < participantBatch.length; i += 50) {
      await supabase
        .from("whatsapp_group_participants")
        .upsert(participantBatch.slice(i, i + 50), {
          onConflict: "group_id, participant_jid",
        });
    }

    if (gi % 25 === 0) {
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: groupsData.length,
          processed: gi,
          detail: `Groups: ${gi}/${groupsData.length}`,
        },
      });
    }
  }

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: groupsData.length,
      processed: groupsData.length,
      detail: `${groupsData.length} groups synced`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 4: Labels
// ═════════════════════════════════════════════════════════════════════════════
async function syncLabels(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 3;

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: 0, detail: "Fetching labels..." },
  });

  const labelsData = await evoFetch(
    `/label/findLabels/${instance_name}`,
    "GET"
  );

  if (Array.isArray(labelsData)) {
    for (const label of labelsData) {
      // Strip invisible Unicode characters (LRM, RLM, ZWNJ, ZWJ, etc.)
      const cleanName = (label.name || '').replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '').trim();
      if (!cleanName) continue;
      await supabase.from("whatsapp_labels").upsert(
        {
          business_id,
          instance_id,
          name: cleanName,
          color: label.color || "#00a884",
          whatsapp_label_id: label.id || null,
        },
        { onConflict: "business_id, instance_id, name" }
      );
    }
  }

  const count = Array.isArray(labelsData) ? labelsData.length : 0;
  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: { total: count, processed: count, detail: `${count} labels synced` },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 5: Build Conversations
// ═════════════════════════════════════════════════════════════════════════════
async function buildConversations(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { business_id, instance_id } = job;
  const pi = 4;
  const cursor = job.phase_cursors?.conversations || { chat_index: 0 };
  const chatJids: any[] = job.sync_metadata?.chat_jids || [];

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: {
      total: chatJids.length,
      processed: cursor.chat_index,
      detail: "Building conversations...",
    },
  });

  // Helper to extract content preview from lastMessage
  const extractPreview = (lastMsg: any) => {
    if (!lastMsg)
      return {
        content: null,
        type: "conversation",
        direction: "incoming",
        ts: new Date().toISOString(),
        status: "sent",
        msgId: null,
      };
    const msg = lastMsg.message || {};
    const msgType = lastMsg.messageType || "conversation";
    let content: string | null = null;
    if (msgType === "conversation") content = msg.conversation || null;
    else if (msgType === "extendedTextMessage")
      content = msg.extendedTextMessage?.text || null;
    else if (msgType === "imageMessage")
      content = msg.imageMessage?.caption || "[Photo]";
    else if (msgType === "videoMessage")
      content = msg.videoMessage?.caption || "[Video]";
    else if (msgType === "audioMessage") content = "[Voice message]";
    else if (msgType === "documentMessage")
      content = msg.documentMessage?.fileName || "[Document]";
    else if (msgType === "stickerMessage") content = "[Sticker]";

    return {
      content,
      type: msgType,
      direction: lastMsg.key?.fromMe ? "outgoing" : "incoming",
      ts: lastMsg.messageTimestamp
        ? new Date(lastMsg.messageTimestamp * 1000).toISOString()
        : new Date().toISOString(),
      status: lastMsg.status || "sent",
      msgId: lastMsg.key?.id || null,
    };
  };

  for (let ci = cursor.chat_index; ci < chatJids.length; ci++) {
    if (shouldYield()) {
      await supabase
        .from("whatsapp_sync_jobs")
        .update({
          phase_cursors: {
            ...(job.phase_cursors || {}),
            conversations: { chat_index: ci },
          },
        })
        .eq("id", job.id);
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: chatJids.length,
          processed: ci,
          detail: `Conversations: ${ci}/${chatJids.length} (yielding)`,
        },
      });
      return "yield";
    }

    const chat = chatJids[ci];
    const jid = chat.jid;
    const isGroup = chat.is_group;
    const preview = extractPreview(chat.lastMessage);

    // Resolve phone_jid and lid_jid from mappings
    const syncMappings: any[] = job.sync_metadata?.jid_mappings || [];
    let convPhoneJid: string | null = jid.includes("@s.whatsapp.net") ? jid : null;
    let convLidJid: string | null = jid.includes("@lid") ? jid : null;
    if (!convPhoneJid) {
      const m = syncMappings.find((mp: any) => mp.lid_jid === jid);
      if (m) convPhoneJid = m.phone_jid;
    }
    if (!convLidJid) {
      const m = syncMappings.find((mp: any) => mp.phone_jid === jid);
      if (m) convLidJid = m.lid_jid;
    }

    // If LID contact with no phone mapping, call fetchProfile to resolve
    if (convLidJid && !convPhoneJid && !isGroup) {
      try {
        const profile = await evoFetch(
          `/chat/fetchProfile/${instance_name}`, "POST", { number: convLidJid }
        );
        const phone = profile?.wuid || profile?.numberExists || profile?.jid;
        if (phone?.includes("@s.whatsapp.net")) {
          convPhoneJid = phone;
          // Store the mapping for future use
          await supabase.from("whatsapp_jid_mappings").upsert({
            business_id, instance_id, lid_jid: convLidJid, phone_jid: convPhoneJid,
          }, { onConflict: "business_id, lid_jid" });
          // Also add to in-memory mappings for this sync run
          syncMappings.push({ lid_jid: convLidJid, phone_jid: convPhoneJid });
        }
      } catch { /* fetchProfile may fail for some contacts */ }
    }

    if (isGroup) {
      const { data: groupRow } = await supabase
        .from("whatsapp_groups")
        .select("id, subject, profile_pic")
        .eq("business_id", business_id)
        .eq("instance_id", instance_id)
        .eq("group_jid", jid)
        .maybeSingle();

      await supabase.from("whatsapp_conversations").upsert(
        {
          business_id,
          instance_id,
          jid,
          type: "group",
          display_name: groupRow?.subject || chat.pushName || null,
          profile_pic: groupRow?.profile_pic || chat.profilePicUrl || null,
          group_id: groupRow?.id || null,
          last_message_id: preview.msgId,
          last_message_content: preview.content,
          last_message_type: preview.type,
          last_message_direction: preview.direction,
          last_message_ts: preview.ts,
          last_message_status: preview.status,
          unread_count: chat.unreadCount || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id, instance_id, jid" }
      );
    } else {
      // Look up contact by any JID format
      const lookupJids = [jid, convPhoneJid, convLidJid].filter(Boolean) as string[];
      const uniqueJids = [...new Set(lookupJids)];
      const { data: contact } = await supabase
        .from("whatsapp_contacts")
        .select("id, name, profile_pic")
        .eq("business_id", business_id)
        .in("phone_number", uniqueJids)
        .limit(1)
        .maybeSingle();

      // Check if a conversation already exists under ANY JID variant
      const orFilters = uniqueJids.map(j => `jid.eq.${j},phone_jid.eq.${j},lid_jid.eq.${j}`).join(",");
      const { data: existingConv } = await supabase
        .from("whatsapp_conversations")
        .select("id, jid")
        .eq("business_id", business_id)
        .eq("instance_id", instance_id)
        .or(orFilters)
        .limit(1)
        .maybeSingle();

      if (existingConv) {
        // Update existing conversation (don't create duplicate)
        await supabase.from("whatsapp_conversations").update({
          phone_jid: convPhoneJid || undefined,
          lid_jid: convLidJid || undefined,
          display_name: contact?.name || chat.pushName || null,
          profile_pic: contact?.profile_pic || chat.profilePicUrl || null,
          contact_id: contact?.id || null,
          last_message_id: preview.msgId,
          last_message_content: preview.content,
          last_message_type: preview.type,
          last_message_direction: preview.direction,
          last_message_ts: preview.ts,
          last_message_status: preview.status,
          unread_count: chat.unreadCount || 0,
          updated_at: new Date().toISOString(),
        }).eq("id", existingConv.id);
      } else {
        // Create new conversation
        await supabase.from("whatsapp_conversations").upsert(
          {
            business_id,
            instance_id,
            jid,
            phone_jid: convPhoneJid,
            lid_jid: convLidJid,
            type: "individual",
            display_name: contact?.name || chat.pushName || null,
            profile_pic: contact?.profile_pic || chat.profilePicUrl || null,
            contact_id: contact?.id || null,
            last_message_id: preview.msgId,
            last_message_content: preview.content,
            last_message_type: preview.type,
            last_message_direction: preview.direction,
            last_message_ts: preview.ts,
            last_message_status: preview.status,
            unread_count: chat.unreadCount || 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "business_id, instance_id, jid" }
        );
      }
    }

    if (ci % 50 === 0 && ci > 0) {
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: chatJids.length,
          processed: ci,
          detail: `Conversations: ${ci}/${chatJids.length}`,
        },
      });
    }
  }

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: chatJids.length,
      processed: chatJids.length,
      detail: `${chatJids.length} conversations built`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 6: Profile Pictures
// ═════════════════════════════════════════════════════════════════════════════
async function syncProfilePics(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 5;
  const cursor = job.phase_cursors?.profile_pics || { contact_index: 0 };

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: cursor.contact_index, detail: "Loading contacts needing pics..." },
  });

  // Get all contacts without profile pics
  let allContacts: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data: batch } = await supabase
      .from("whatsapp_contacts")
      .select("id, phone_number, profile_pic")
      .eq("business_id", business_id)
      .eq("instance_id", instance_id)
      .is("profile_pic", null)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (!batch || batch.length === 0) break;
    allContacts = allContacts.concat(batch);
    if (batch.length < pageSize) break;
    page++;
  }

  const needPic = allContacts.filter(
    (c: any) =>
      !c.phone_number.endsWith("@g.us") &&
      c.phone_number !== "status@broadcast"
  );

  await updatePhase(supabase, job.id, pi, {
    progress: {
      total: needPic.length,
      processed: cursor.contact_index,
      detail: `${needPic.length} contacts need profile pics`,
    },
  });

  let picsFetched = cursor.contact_index;
  for (let i = cursor.contact_index; i < needPic.length; i += 5) {
    if (shouldYield()) {
      await supabase
        .from("whatsapp_sync_jobs")
        .update({
          phase_cursors: {
            ...(job.phase_cursors || {}),
            profile_pics: { contact_index: i },
          },
        })
        .eq("id", job.id);
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: needPic.length,
          processed: i,
          detail: `Profile pics: ${picsFetched} found (${i}/${needPic.length}, yielding)`,
        },
      });
      return "yield";
    }

    const batch = needPic.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (c: any) => {
        const number = c.phone_number.includes("@lid")
          ? c.phone_number
          : c.phone_number.split("@")[0];
        const res = await evoFetch(
          `/chat/fetchProfilePictureUrl/${instance_name}`,
          "POST",
          { number }
        );
        if (res?.profilePictureUrl) {
          await supabase
            .from("whatsapp_contacts")
            .update({ profile_pic: res.profilePictureUrl })
            .eq("id", c.id);
          return true;
        }
        return false;
      })
    );
    picsFetched += results.filter(
      (r) => r.status === "fulfilled" && r.value
    ).length;

    if (i % 20 === 0) {
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: needPic.length,
          processed: i + 5,
          detail: `Profile pics: ${picsFetched} found (${Math.min(i + 5, needPic.length)}/${needPic.length})`,
        },
      });
    }
  }

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: needPic.length,
      processed: needPic.length,
      detail: `${picsFetched} profile pics fetched`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 7: Messages
// ═════════════════════════════════════════════════════════════════════════════
async function syncMessages(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { instance_name, business_id, instance_id } = job;
  const pi = 6;
  const cursor = job.phase_cursors?.messages || { chat_index: 0, page: 1 };
  const chatJids: any[] = job.sync_metadata?.chat_jids || [];

  const ownerRes = await supabase
    .from("whatsapp_instances")
    .select("phone_number")
    .eq("id", instance_id)
    .single();
  const ownerPhone = ownerRes.data?.phone_number || "";

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: {
      total: chatJids.length,
      processed: cursor.chat_index,
      detail: `Syncing messages from chat ${cursor.chat_index + 1}...`,
    },
  });

  let totalMessages = job.sync_metadata?.messages_synced || 0;

  for (let ci = cursor.chat_index; ci < chatJids.length; ci++) {
    const chat = chatJids[ci];
    const jid = chat.jid;
    const isGroup = chat.is_group;

    // Resolve contact_id for individual chats
    let contactId: string | null = null;
    if (!isGroup) {
      const { data: contactRow } = await supabase
        .from("whatsapp_contacts")
        .select("id")
        .eq("business_id", business_id)
        .eq("phone_number", jid)
        .maybeSingle();

      if (contactRow) {
        contactId = contactRow.id;
      } else {
        // Try alt JID
        const { data: mappingRow } = await supabase
          .from("whatsapp_jid_mappings")
          .select("phone_jid")
          .eq("business_id", business_id)
          .eq("lid_jid", jid)
          .maybeSingle();
        if (mappingRow?.phone_jid) {
          const { data: alt } = await supabase
            .from("whatsapp_contacts")
            .select("id")
            .eq("business_id", business_id)
            .eq("phone_number", mappingRow.phone_jid)
            .maybeSingle();
          if (alt) contactId = alt.id;
        }
        // Create if still missing
        if (!contactId) {
          const chatName =
            chat.pushName &&
              chat.pushName !== ownerPhone &&
              chat.pushName !== instance_name
              ? chat.pushName
              : null;
          const { data: newContact } = await supabase
            .from("whatsapp_contacts")
            .upsert(
              {
                business_id,
                phone_number: jid,
                name: chatName,
                instance_id,
              },
              { onConflict: "business_id, phone_number" }
            )
            .select("id")
            .single();
          contactId = newContact?.id || null;
        }
      }

      // LID resolution
      if (jid.includes("@lid")) {
        try {
          const profile = await evoFetch(
            `/chat/fetchProfile/${instance_name}`,
            "POST",
            { number: jid }
          );
          const phone =
            profile?.wuid || profile?.numberExists || profile?.jid;
          if (phone?.includes("@s.whatsapp.net")) {
            await supabase.from("whatsapp_jid_mappings").upsert(
              [
                {
                  business_id,
                  instance_id,
                  lid_jid: jid,
                  phone_jid: phone,
                },
              ],
              { onConflict: "business_id, lid_jid" }
            );
          }
        } catch {
          /* skip */
        }
      }
    }

    // Get conversation_id
    const { data: convRow } = await supabase
      .from("whatsapp_conversations")
      .select("id")
      .eq("business_id", business_id)
      .eq("instance_id", instance_id)
      .eq("jid", jid)
      .maybeSingle();
    const conversationId = convRow?.id || null;

    // Fetch messages with pagination
    const maxPages = isGroup ? 3 : 999;
    const startPage = ci === cursor.chat_index ? cursor.page : 1;
    let msgPage = startPage;
    let hasMore = true;

    while (hasMore && msgPage <= maxPages) {
      if (shouldYield()) {
        await supabase
          .from("whatsapp_sync_jobs")
          .update({
            phase_cursors: {
              ...(job.phase_cursors || {}),
              messages: { chat_index: ci, page: msgPage },
            },
            sync_metadata: {
              ...(job.sync_metadata || {}),
              messages_synced: totalMessages,
            },
          })
          .eq("id", job.id);
        await updatePhase(supabase, job.id, pi, {
          progress: {
            total: chatJids.length,
            processed: ci,
            detail: `Messages: ${totalMessages} synced (chat ${ci + 1}/${chatJids.length}, yielding)`,
          },
        });
        return "yield";
      }

      try {
        const msgData = await evoFetch(
          `/chat/findMessages/${instance_name}`,
          "POST",
          {
            where: { key: { remoteJid: jid } },
            limit: 100,
            page: msgPage,
          }
        );
        const records =
          msgData?.messages?.records || msgData?.records || [];
        const totalPages = msgData?.messages?.pages || 1;
        if (records.length === 0) {
          hasMore = false;
          break;
        }

        // Extract JID mappings from message keys
        if (!isGroup && jid.includes("@lid")) {
          for (const m of records) {
            const alt = m.key?.remoteJidAlt || m.key?.participant;
            if (alt?.includes("@s.whatsapp.net")) {
              await supabase.from("whatsapp_jid_mappings").upsert(
                [
                  {
                    business_id,
                    instance_id,
                    lid_jid: jid,
                    phone_jid: alt,
                  },
                ],
                { onConflict: "business_id, lid_jid" }
              );
              break;
            }
          }
        }

        const msgBatch = records
          .filter((m: any) => m.messageType !== "protocolMessage")
          .map((m: any) => {
            const msgType = m.messageType || "conversation";
            const msg = m.message || {};
            let content: string | null = null;
            let mediaUrl: string | null = null;

            if (msgType === "conversation")
              content = msg.conversation || null;
            else if (msgType === "extendedTextMessage")
              content = msg.extendedTextMessage?.text || null;
            else if (msgType === "imageMessage") {
              content = msg.imageMessage?.caption || null;
              mediaUrl = msg.imageMessage?.url || null;
            } else if (msgType === "videoMessage") {
              content = msg.videoMessage?.caption || null;
              mediaUrl = msg.videoMessage?.url || null;
            } else if (msgType === "audioMessage") {
              content = `[Audio ${msg.audioMessage?.seconds || 0}s]`;
              mediaUrl = msg.audioMessage?.url || null;
            } else if (msgType === "documentMessage") {
              content = msg.documentMessage?.fileName || "[Document]";
              mediaUrl = msg.documentMessage?.url || null;
            } else if (msgType === "stickerMessage") {
              content = "[Sticker]";
              mediaUrl = msg.stickerMessage?.url || null;
            } else if (msgType === "reactionMessage") {
              const rm = msg.reactionMessage || {};
              content = JSON.stringify({
                targetMessageId: rm.key?.id || "",
                emoji: rm.text || "",
              });
            }

            return {
              business_id,
              instance_id,
              contact_id: isGroup ? null : contactId,
              conversation_id: conversationId,
              remote_jid: jid,
              message_id: m.key?.id,
              type: msgType,
              content,
              media_url: mediaUrl,
              direction: m.key?.fromMe ? "outgoing" : "incoming",
              status: "sent",
              sender_jid: isGroup ? m.key?.participant || null : null,
              created_at: m.messageTimestamp
                ? new Date(m.messageTimestamp * 1000).toISOString()
                : new Date().toISOString(),
              raw_key: m.key
                ? {
                  id: m.key.id,
                  fromMe: m.key.fromMe,
                  remoteJid: m.key.remoteJid,
                }
                : null,
            };
          })
          .filter((m: any) => m.message_id);

        if (msgBatch.length > 0) {
          await supabase
            .from("whatsapp_messages")
            .upsert(msgBatch, {
              onConflict: "message_id",
              ignoreDuplicates: true,
            });
          totalMessages += msgBatch.length;
        }

        hasMore = msgPage < totalPages;
        msgPage++;
      } catch (e) {
        console.error(`Message sync error for ${jid} page ${msgPage}:`, e);
        hasMore = false;
      }
    }

    // Update progress every 5 chats
    if (ci % 5 === 0) {
      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: chatJids.length,
          processed: ci + 1,
          detail: `Messages: ${totalMessages} synced (chat ${ci + 1}/${chatJids.length})`,
        },
      });
    }
  }

  // Save final message count
  await supabase
    .from("whatsapp_sync_jobs")
    .update({
      sync_metadata: {
        ...(job.sync_metadata || {}),
        messages_synced: totalMessages,
      },
    })
    .eq("id", job.id);

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: chatJids.length,
      processed: chatJids.length,
      detail: `${totalMessages} messages synced`,
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase 8: Name Backfill for LID Contacts
// ═════════════════════════════════════════════════════════════════════════════
async function nameBackfill(
  supabase: any,
  job: any
): Promise<"done" | "yield"> {
  const { business_id, instance_id } = job;
  const pi = 7;

  await updatePhase(supabase, job.id, pi, {
    status: "running",
    started_at: new Date().toISOString(),
    progress: { total: 0, processed: 0, detail: "Backfilling contact names..." },
  });

  const { data: namelessLid } = await supabase
    .from("whatsapp_contacts")
    .select("id, phone_number")
    .eq("business_id", business_id)
    .eq("instance_id", instance_id)
    .is("name", null)
    .like("phone_number", "%@lid");

  if (namelessLid?.length) {
    const { data: namedPhone } = await supabase
      .from("whatsapp_contacts")
      .select("phone_number, name, profile_pic")
      .eq("business_id", business_id)
      .not("name", "is", null)
      .like("phone_number", "%@s.whatsapp.net");

    const { data: mappings } = await supabase
      .from("whatsapp_jid_mappings")
      .select("lid_jid, phone_jid")
      .eq("business_id", business_id);

    const lidToPhone: Record<string, string> = {};
    if (mappings) for (const m of mappings) lidToPhone[m.lid_jid] = m.phone_jid;

    if (namedPhone) {
      const phoneNameMap: Record<string, { name: string; pic: string | null }> =
        {};
      for (const c of namedPhone)
        phoneNameMap[c.phone_number] = {
          name: c.name,
          pic: c.profile_pic,
        };

      let backfilled = 0;
      for (const lid of namelessLid) {
        const phoneJid = lidToPhone[lid.phone_number];
        if (phoneJid && phoneNameMap[phoneJid]) {
          const info = phoneNameMap[phoneJid];
          await supabase
            .from("whatsapp_contacts")
            .update({
              name: info.name,
              ...(info.pic ? { profile_pic: info.pic } : {}),
            })
            .eq("id", lid.id);
          backfilled++;
        }
      }

      await updatePhase(supabase, job.id, pi, {
        progress: {
          total: namelessLid.length,
          processed: namelessLid.length,
          detail: `${backfilled} LID contacts backfilled`,
        },
      });
    }
  }

  await updatePhase(supabase, job.id, pi, {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: {
      total: namelessLid?.length || 0,
      processed: namelessLid?.length || 0,
      detail: "Name backfill complete",
    },
  });

  return "done";
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase handlers array
// ═════════════════════════════════════════════════════════════════════════════
const PHASE_HANDLERS = [
  syncContacts,
  syncChatsAndJid,
  syncGroups,
  syncLabels,
  buildConversations,
  syncProfilePics,
  syncMessages,
  nameBackfill,
];

// ═════════════════════════════════════════════════════════════════════════════
// Main entry point
// ═════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json();
    const action = body.action || "start";

    // ── Cancel ───────────────────────────────────────────────────────
    if (action === "cancel") {
      const { job_id } = body;
      await supabase
        .from("whatsapp_sync_jobs")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      return ok({ cancelled: true });
    }

    // ── Retry ────────────────────────────────────────────────────────
    if (action === "retry") {
      const { job_id } = body;
      const { data: job } = await supabase
        .from("whatsapp_sync_jobs")
        .select("*")
        .eq("id", job_id)
        .single();
      if (!job) return ok({ error: "Job not found" });

      // Reset the failed phase to pending
      const phases = job.phases;
      for (const p of phases) {
        if (p.status === "failed") {
          p.status = "pending";
          p.error = null;
        }
      }

      await supabase
        .from("whatsapp_sync_jobs")
        .update({
          status: "running",
          phases,
          retry_count: 0,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      // Continue execution in background
      const retryPromise = chainNext(job_id);
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(retryPromise);
      return ok({ retried: true });
    }

    // ── Start ────────────────────────────────────────────────────────
    if (action === "start") {
      const { instance_id, instance_name, business_id } = body;

      // Check for existing active sync
      const { data: existing } = await supabase
        .from("whatsapp_sync_jobs")
        .select("id, status")
        .eq("instance_id", instance_id)
        .in("status", ["pending", "running", "paused"])
        .maybeSingle();

      if (existing) {
        // Resume existing job in background
        const resumePromise = chainNext(existing.id);
        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(resumePromise);
        return ok({ job_id: existing.id, resumed: true });
      }

      // Create new job
      const { data: newJob, error: insertErr } = await supabase
        .from("whatsapp_sync_jobs")
        .insert({
          business_id,
          instance_id,
          instance_name,
          status: "running",
          current_phase: 0,
          phases: buildInitialPhases(),
          started_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (insertErr) {
        return ok({ error: insertErr.message });
      }

      // Run phases in background — return response immediately so the runtime
      // doesn't get killed waiting for the response to send
      const job = newJob;
      const runPromise = runPhases(supabase, job).catch(e => console.error("Phase execution error:", e));
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(runPromise);

      return ok({ job_id: job.id, started: true });
    }

    // ── Continue ─────────────────────────────────────────────────────
    if (action === "continue") {
      const { job_id } = body;
      const { data: job } = await supabase
        .from("whatsapp_sync_jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (!job) return ok({ error: "Job not found" });
      if (job.status === "cancelled" || job.status === "completed") {
        return ok({ status: job.status });
      }

      // Ensure status is running
      if (job.status !== "running") {
        await supabase
          .from("whatsapp_sync_jobs")
          .update({ status: "running", updated_at: new Date().toISOString() })
          .eq("id", job_id);
      }

      // Run phases in background — return response immediately
      // This prevents the chained invocation from blocking the caller
      const runPromise = runPhases(supabase, job).catch(e => console.error("Phase execution error:", e));
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(runPromise);

      return ok({ continued: true });
    }

    return ok({ error: `Unknown action: ${action}` });
  } catch (error) {
    console.error("evolution-sync error:", error);
    return ok({ error: (error as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase runner — executes phases sequentially, handles yields and errors
// ═════════════════════════════════════════════════════════════════════════════
async function runPhases(supabase: any, job: any) {
  // Re-read job to get latest state
  const { data: freshJob } = await supabase
    .from("whatsapp_sync_jobs")
    .select("*")
    .eq("id", job.id)
    .single();
  if (!freshJob) return;
  job = freshJob;

  const phases = job.phases || [];
  let currentPhase = job.current_phase || 0;

  for (let pi = currentPhase; pi < PHASE_HANDLERS.length; pi++) {
    // Check cancellation
    if (await isCancelled(supabase, job.id)) return;

    const phaseInfo = phases[pi];
    if (phaseInfo?.status === "completed") continue; // Skip completed phases

    // Update current phase
    await supabase
      .from("whatsapp_sync_jobs")
      .update({
        current_phase: pi,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    // Re-read job for latest cursors/metadata
    const { data: latestJob } = await supabase
      .from("whatsapp_sync_jobs")
      .select("*")
      .eq("id", job.id)
      .single();
    if (!latestJob) return;

    // Add convenience fields
    latestJob.instance_id = latestJob.instance_id;
    latestJob.instance_name = latestJob.instance_name;
    latestJob.business_id = latestJob.business_id;

    try {
      const result = await PHASE_HANDLERS[pi](supabase, latestJob);

      if (result === "yield") {
        // Time limit approaching — self-chain and exit
        await chainNext(job.id);
        return;
      }
      // Phase completed — continue to next
    } catch (e: any) {
      console.error(`Phase ${PHASE_NAMES[pi]} error:`, e);

      // Record error
      await updatePhase(supabase, job.id, pi, {
        status: "failed",
        error: e.message || String(e),
      });

      // Check retry
      const { data: retryJob } = await supabase
        .from("whatsapp_sync_jobs")
        .select("retry_count, max_retries")
        .eq("id", job.id)
        .single();

      if (retryJob && retryJob.retry_count < retryJob.max_retries) {
        // Retry: increment counter, reset phase, self-chain
        await supabase
          .from("whatsapp_sync_jobs")
          .update({
            retry_count: retryJob.retry_count + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await updatePhase(supabase, job.id, pi, {
          status: "pending",
          error: `Retrying (${retryJob.retry_count + 1}/${retryJob.max_retries}): ${e.message}`,
        });

        await chainNext(job.id);
        return;
      } else {
        // Max retries exceeded — fail the job
        await supabase
          .from("whatsapp_sync_jobs")
          .update({
            status: "failed",
            error_message: `Phase ${PHASE_NAMES[pi]} failed: ${e.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        return;
      }
    }
  }

  // All phases completed
  await supabase
    .from("whatsapp_sync_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
