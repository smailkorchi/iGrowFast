import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Smartphone, Phone, Loader2, QrCode, CheckCircle2, MessageSquare, ArrowRight, Users, MessageCircle, Database } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const db = supabase as any;

// ── Connection modal step types ──────────────────────────────────────────
type ModalStep = 'scanning' | 'connected' | 'syncing' | 'complete';

interface SyncProgress {
  contacts: { total: number; synced: number };
  chats: { total: number; synced: number };
  messages: number;
  jidMappings: number;
  status: string;
}

interface InstanceSyncState {
  step: ModalStep;
  progress: SyncProgress;
  ownerProfile: { pic: string | null; phone: string; name: string };
  qrCode: string | null;
  background: boolean;
}

const defaultProgress: SyncProgress = { contacts: { total: 0, synced: 0 }, chats: { total: 0, synced: 0 }, messages: 0, jidMappings: 0, status: 'Preparing...' };

export default function WhatsAppManager() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── Per-instance sync state (supports multiple concurrent syncs) ────
  const [syncStates, setSyncStates] = useState<Record<string, InstanceSyncState>>({});
  const syncAbortRefs = useRef<Record<string, boolean>>({});

  // ── Modal state (which instance is currently shown in the modal) ────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInstanceName, setModalInstanceName] = useState('');

  // ── Persist sync states to localStorage ──────────────────────────────
  const SYNC_STORAGE_KEY = 'wa_sync_states';
  const persistSyncStates = (states: Record<string, InstanceSyncState>) => {
    try {
      // Only persist syncing/complete instances (not scanning which needs QR)
      const toPersist: Record<string, any> = {};
      for (const [k, v] of Object.entries(states)) {
        if (v.step === 'syncing' || v.step === 'complete') {
          toPersist[k] = { ...v, qrCode: null }; // don't persist base64 QR
        }
      }
      localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(toPersist));
    } catch {}
  };

  // Helpers to read/write per-instance sync state
  const getSyncState = (name: string): InstanceSyncState => syncStates[name] || {
    step: 'scanning', progress: { ...defaultProgress }, ownerProfile: { pic: null, phone: '', name: '' }, qrCode: null, background: false,
  };
  const updateSyncState = (name: string, patch: Partial<InstanceSyncState>) => {
    setSyncStates(prev => {
      const next = { ...prev, [name]: { ...getSyncState(name), ...prev[name], ...patch } };
      persistSyncStates(next);
      return next;
    });
  };
  const updateProgress = (name: string, fn: (p: SyncProgress) => SyncProgress) => {
    setSyncStates(prev => {
      const current = prev[name] || getSyncState(name);
      const next = { ...prev, [name]: { ...current, progress: fn(current.progress) } };
      persistSyncStates(next);
      return next;
    });
  };

  // Derived state for the currently viewed modal instance
  const currentSync = getSyncState(modalInstanceName);
  const modalStep = currentSync.step;
  const syncProgress = currentSync.progress;
  const ownerProfile = currentSync.ownerProfile;
  const qrCode = currentSync.qrCode;

  // ── Restore sync states from localStorage on mount ──────────────────
  // Track which syncs are actively running (survives re-renders but not unmounts)
  const activeSyncRuns = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SYNC_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const restored: Record<string, InstanceSyncState> = {};
        for (const [k, v] of Object.entries(parsed) as [string, any][]) {
          if (v.step === 'syncing') {
            if (activeSyncRuns.current.has(k)) {
              // Still actively running in this tab — keep as syncing
              restored[k] = { ...v, background: true };
            } else {
              // The async function died (page nav / reload) — mark complete
              // Data already written to DB is safe; user can resync if needed
              restored[k] = { ...v, step: 'complete' as ModalStep, background: false };
            }
          } else if (v.step === 'complete') {
            restored[k] = v;
          }
        }
        if (Object.keys(restored).length > 0) {
          setSyncStates(restored);
          persistSyncStates(restored);
        }
      }
    } catch {}
  }, []);

  // ── Load instances on mount ─────────────────────────────────────────
  useEffect(() => { fetchInstances(); }, []);

  // ── Warn before page reload if sync is active ─────────────────────
  useEffect(() => {
    const hasActiveSyncs = Object.values(syncStates).some(s => s.step === 'syncing');
    if (!hasActiveSyncs) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [syncStates]);

  // ── Poll for connection while QR modal is in scanning state ────────
  // Realtime subscriptions are unreliable for this — direct polling is deterministic.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (modalStep === 'scanning' && modalInstanceName) {
      // Poll every 3s: check if instance status changed to 'open'
      pollRef.current = setInterval(async () => {
        const { data } = await supabase
          .from('whatsapp_instances')
          .select('status')
          .eq('instance_name', modalInstanceName)
          .single();
        if (data?.status === 'open') {
          if (pollRef.current) clearInterval(pollRef.current);
          handleInstanceConnected(modalInstanceName);
          fetchInstances();
        }
      }, 3000);

      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [modalStep, modalInstanceName]);

  const fetchInstances = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    const { data } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (data) {
      setInstances(data);
      // Auto-heal webhooks on open instances
      for (const inst of data) {
        if (inst.status === 'open') {
          whatsappService.findWebhook(inst.instance_name).then((wh: any) => {
            if (!wh || !wh.enabled) whatsappService.setWebhook(inst.instance_name).catch(() => {});
          }).catch(() => {
            whatsappService.setWebhook(inst.instance_name).catch(() => {});
          });
        }
      }
    }
    setLoading(false);
  };

  // ── Create instance + open modal ──────────────────────────────────
  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;
    const name = newInstanceName.trim();
    try {
      setActionLoading('create');
      let createRes;
      try {
        createRes = await whatsappService.createInstance(name);
      } catch (firstErr: any) {
        // If instance already exists on Evolution API (e.g. orphaned from previous delete), clean up and retry
        if (firstErr.message?.toLowerCase().includes('forbidden') || firstErr.message?.toLowerCase().includes('already')) {
          try { await whatsappService.deleteInstance(name); } catch {}
          // Small delay then retry
          await new Promise(r => setTimeout(r, 1500));
          createRes = await whatsappService.createInstance(name);
        } else {
          throw firstErr;
        }
      }

      const businessId = localStorage.getItem('activeBusinessId');
      await supabase.from('whatsapp_instances').insert({
        business_id: businessId,
        instance_name: name,
        status: 'connecting',
      });

      // Open modal
      setModalInstanceName(name);
      syncAbortRefs.current[name] = false;
      updateSyncState(name, {
        step: 'scanning',
        progress: { ...defaultProgress },
        ownerProfile: { pic: null, phone: '', name: '' },
        qrCode: createRes?.qrcode?.base64 || null,
        background: false,
      });
      setModalOpen(true);

      // If no QR in create response, fetch it
      if (!createRes?.qrcode?.base64) {
        setTimeout(async () => {
          try {
            const qrRes = await whatsappService.getQrCode(name);
            updateSyncState(name, { qrCode: qrRes?.qrcode?.base64 || qrRes?.base64 || null });
          } catch {}
        }, 3000);
      }

      setNewInstanceName('');
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
      fetchInstances();
    }
  };

  // ── Show QR for existing unpaired instance ────────────────────────
  const fetchAndShowQR = async (instanceName: string) => {
    try {
      setActionLoading(`qr-${instanceName}`);
      const qr = await whatsappService.getQrCode(instanceName);
      const qrBase64 = qr?.base64 || qr?.qrcode?.base64 || null;

      if (qrBase64) {
        setModalInstanceName(instanceName);
        syncAbortRefs.current[instanceName] = false;
        updateSyncState(instanceName, {
          step: 'scanning',
          progress: { ...defaultProgress },
          ownerProfile: { pic: null, phone: '', name: '' },
          qrCode: qrBase64,
          background: false,
        });
        setModalOpen(true);
      } else if (qr?.error) {
        toast({ title: "Session Error", description: qr.error, variant: "destructive" });
      } else {
        toast({ title: "Status", description: "Device is already connected or QR unavailable." });
      }
    } catch (err: any) {
      toast({ title: "Connection Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Instance connected → fetch profile + start sync ───────────────
  const handleInstanceConnected = useCallback(async (instanceName: string) => {
    updateSyncState(instanceName, { step: 'connected', qrCode: null });

    // Fetch owner profile from Evolution API
    try {
      const evoInstances = await whatsappService.invokeClient('fetch-instances', { instanceName });
      const inst = Array.isArray(evoInstances) ? evoInstances[0] : evoInstances;
      if (inst) {
        const phone = inst.ownerJid?.split('@')[0] || '';
        const name = inst.profileName || instanceName;
        let picBase64: string | null = null;

        if (inst.profilePicUrl) {
          try {
            const picData = await whatsappService.invokeClient('proxy-image', { instanceName, url: inst.profilePicUrl });
            picBase64 = picData?.base64 || null;
          } catch {}
        }

        updateSyncState(instanceName, { ownerProfile: { pic: picBase64, phone, name } });

        await supabase.from('whatsapp_instances')
          .update({ phone_number: phone, profile_pic: inst.profilePicUrl || null })
          .eq('instance_name', instanceName);
      }
    } catch {}

    setTimeout(() => { startSync(instanceName); }, 1500);
  }, []);

  // ── Sync all data from Evolution API to Supabase ──────────────────
  // 8-phase pipeline: Contacts → Chats+JID → Groups → Labels → Conversations → ProfilePics → Messages → NameBackfill
  const startSync = async (instanceName: string) => {
    // Prevent duplicate runs
    if (activeSyncRuns.current.has(instanceName)) return;
    activeSyncRuns.current.add(instanceName);

    updateSyncState(instanceName, { step: 'syncing' });
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) { activeSyncRuns.current.delete(instanceName); return; }

    const { data: instData } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .single();
    if (!instData) return;
    const instanceId = instData.id;

    // Collect LID↔phone mappings across all phases
    const allMappings: { lid_jid: string; phone_jid: string }[] = [];

    // Will hold ALL chats (individual + group) from Phase 2
    let individualChats: any[] = [];
    let groupChats: any[] = [];

    // ═══════════════════════════════════════════════════════════════════
    // Phase 1: Contacts
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Waiting for contact sync from WhatsApp...' }));
    let contactsTotal = 0;

    try {
      await new Promise(r => setTimeout(r, 5000));

      let contacts = await whatsappService.syncContacts(instanceName);
      let contactCount = Array.isArray(contacts) ? contacts.filter((c: any) => {
        const jid = c.remoteJid || c.id;
        return jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast';
      }).length : 0;

      if (contactCount < 10) {
        updateProgress(instanceName, p => ({ ...p, status: `Got ${contactCount} contacts, waiting...` }));
        await new Promise(r => setTimeout(r, 10000));
        const retry = await whatsappService.syncContacts(instanceName);
        const retryCount = Array.isArray(retry) ? retry.filter((c: any) => {
          const jid = c.remoteJid || c.id;
          return jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast';
        }).length : 0;
        if (retryCount > contactCount) { contacts = retry; contactCount = retryCount; }
      }

      if (Array.isArray(contacts)) {
        const filtered = contacts.filter((c: any) => {
          const jid = c.remoteJid || c.id;
          return jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast';
        });
        contactsTotal = filtered.length;
        updateProgress(instanceName, p => ({ ...p, contacts: { total: contactsTotal, synced: 0 }, status: `Syncing ${contactsTotal} contacts...` }));

        // Extract LID↔phone mappings
        for (const c of filtered) {
          const jid = c.remoteJid || c.id;
          const lid = c.lid || (jid?.includes('@lid') ? jid : null);
          const phoneJid = (c.remoteJid?.includes('@s.whatsapp.net') ? c.remoteJid : null)
            || (c.id?.includes('@s.whatsapp.net') ? c.id : null);
          if (lid && phoneJid && lid !== phoneJid) {
            allMappings.push({ lid_jid: lid, phone_jid: phoneJid });
          }
        }

        // Batch upsert contacts (store under both JID formats)
        const contactBatch: any[] = [];
        for (const c of filtered) {
          const jid = c.remoteJid || c.id;
          const name = c.pushName || c.name || c.verifiedName || null;
          const pic = c.profilePictureUrl || c.imgUrl || null;

          contactBatch.push({ business_id: businessId, phone_number: jid, name, profile_pic: pic, instance_id: instanceId });

          const lid = c.lid;
          if (lid && jid.includes('@s.whatsapp.net')) {
            contactBatch.push({ business_id: businessId, phone_number: lid, name, profile_pic: pic, instance_id: instanceId });
          }
          if (jid.includes('@lid')) {
            const phoneFromMapping = allMappings.find(m => m.lid_jid === jid)?.phone_jid;
            if (phoneFromMapping) {
              contactBatch.push({ business_id: businessId, phone_number: phoneFromMapping, name, profile_pic: pic, instance_id: instanceId });
            }
          }
        }

        const batchSize = 25;
        for (let i = 0; i < contactBatch.length; i += batchSize) {
          if (syncAbortRefs.current[instanceName]) break;
          await db.from('whatsapp_contacts').upsert(contactBatch.slice(i, i + batchSize), {
            onConflict: 'business_id, phone_number', ignoreDuplicates: false,
          });
          updateProgress(instanceName, p => ({
            ...p,
            contacts: { total: contactsTotal, synced: Math.min(Math.floor((i + batchSize) / (contactBatch.length / contactsTotal)), contactsTotal) },
            status: `Contacts: ${Math.min(i + batchSize, contactBatch.length)} upserted`,
          }));
        }
      }
    } catch (e) { console.error('Contact sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 2: Chats + JID mappings (ALL chats — individual + group)
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Fetching conversations...' }));
    let chatsTotal = 0;

    try {
      const chatData = await whatsappService.syncChats(instanceName);
      if (Array.isArray(chatData)) {
        const allChats = chatData.filter((c: any) => c.remoteJid && c.remoteJid !== 'status@broadcast');
        individualChats = allChats.filter((c: any) => !c.remoteJid.endsWith('@g.us'));
        groupChats = allChats.filter((c: any) => c.remoteJid.endsWith('@g.us'));
        chatsTotal = allChats.length;
        updateProgress(instanceName, p => ({
          ...p,
          chats: { total: chatsTotal, synced: 0 },
          status: `Found ${individualChats.length} individual + ${groupChats.length} group chats`,
        }));

        // Extract JID mappings from individual chats
        const mappingBatch: any[] = [];
        for (const chat of individualChats) {
          if (chat.remoteJid?.includes('@lid')) {
            const alt = chat.lastMessage?.key?.remoteJidAlt
              || (chat.id?.includes('@s.whatsapp.net') ? chat.id : null)
              || (chat.contact?.id?.includes('@s.whatsapp.net') ? chat.contact.id : null)
              || (chat.participant?.includes('@s.whatsapp.net') ? chat.participant : null);
            if (alt?.includes('@s.whatsapp.net')) {
              allMappings.push({ lid_jid: chat.remoteJid, phone_jid: alt });
            }
          }
          if (chat.remoteJid?.includes('@s.whatsapp.net') && chat.lid) {
            allMappings.push({ lid_jid: chat.lid, phone_jid: chat.remoteJid });
          }
        }

        // Deduplicate and store all mappings
        const seen = new Set<string>();
        for (const m of allMappings) {
          if (!seen.has(m.lid_jid)) {
            seen.add(m.lid_jid);
            mappingBatch.push({ business_id: businessId, instance_id: instanceId, lid_jid: m.lid_jid, phone_jid: m.phone_jid });
          }
        }
        if (mappingBatch.length > 0) {
          await db.from('whatsapp_jid_mappings').upsert(mappingBatch, { onConflict: 'business_id, lid_jid' });
        }
        console.log(`[Sync] Stored ${mappingBatch.length} JID mappings`);

        updateProgress(instanceName, p => ({ ...p, chats: { total: chatsTotal, synced: chatsTotal }, jidMappings: mappingBatch.length }));
      }
    } catch (e) { console.error('Chat sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 3: Groups (fetch all groups with participants)
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Fetching groups...' }));
    try {
      const groupsData = await whatsappService.fetchAllGroups(instanceName);
      if (Array.isArray(groupsData)) {
        updateProgress(instanceName, p => ({ ...p, status: `Syncing ${groupsData.length} groups...` }));

        // Batch upsert groups
        const groupBatch = groupsData.map((g: any) => ({
          business_id: businessId,
          instance_id: instanceId,
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
          if (syncAbortRefs.current[instanceName]) break;
          await db.from('whatsapp_groups').upsert(groupBatch.slice(i, i + 25), {
            onConflict: 'business_id, instance_id, group_jid',
          });
        }

        // Upsert participants for each group
        for (const g of groupsData) {
          if (syncAbortRefs.current[instanceName]) break;
          if (!g.participants?.length) continue;

          const { data: groupRow } = await db.from('whatsapp_groups')
            .select('id')
            .eq('business_id', businessId)
            .eq('instance_id', instanceId)
            .eq('group_jid', g.id)
            .single();
          if (!groupRow) continue;

          const participantBatch = g.participants.map((p: any) => ({
            group_id: groupRow.id,
            business_id: businessId,
            participant_jid: p.id,
            role: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member',
            display_name: p.pushName || null,
          }));

          // Batch upsert participants
          for (let i = 0; i < participantBatch.length; i += 50) {
            await db.from('whatsapp_group_participants').upsert(
              participantBatch.slice(i, i + 50),
              { onConflict: 'group_id, participant_jid' }
            );
          }
        }
        console.log(`[Sync] Synced ${groupBatch.length} groups with participants`);
      }
    } catch (e) { console.error('Group sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 4: Labels (WhatsApp-native labels)
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Fetching labels...' }));
    try {
      const labelsData = await whatsappService.findLabels(instanceName);
      if (Array.isArray(labelsData)) {
        for (const label of labelsData) {
          await db.from('whatsapp_labels').upsert({
            business_id: businessId,
            instance_id: instanceId,
            name: label.name,
            color: label.color || '#00a884',
          }, { onConflict: 'business_id, instance_id, name' });
        }
        console.log(`[Sync] Synced ${labelsData.length} labels`);
      }
    } catch (e) { console.error('Labels sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 5: Build whatsapp_conversations from chats data
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Building conversations...' }));
    try {
      // Helper to extract content preview from lastMessage
      const extractPreview = (lastMsg: any): { content: string | null; type: string; direction: string; ts: string; status: string; msgId: string | null } => {
        if (!lastMsg) return { content: null, type: 'conversation', direction: 'incoming', ts: new Date().toISOString(), status: 'sent', msgId: null };
        const msg = lastMsg.message || {};
        const msgType = lastMsg.messageType || 'conversation';
        let content: string | null = null;
        if (msgType === 'conversation') content = msg.conversation || null;
        else if (msgType === 'extendedTextMessage') content = msg.extendedTextMessage?.text || null;
        else if (msgType === 'imageMessage') content = msg.imageMessage?.caption || '[Photo]';
        else if (msgType === 'videoMessage') content = msg.videoMessage?.caption || '[Video]';
        else if (msgType === 'audioMessage') content = '[Voice message]';
        else if (msgType === 'documentMessage') content = msg.documentMessage?.fileName || '[Document]';
        else if (msgType === 'stickerMessage') content = '[Sticker]';

        return {
          content,
          type: msgType,
          direction: lastMsg.key?.fromMe ? 'outgoing' : 'incoming',
          ts: lastMsg.messageTimestamp ? new Date(lastMsg.messageTimestamp * 1000).toISOString() : new Date().toISOString(),
          status: lastMsg.status || 'sent',
          msgId: lastMsg.key?.id || null,
        };
      };

      // Individual conversations
      for (const chat of individualChats) {
        if (syncAbortRefs.current[instanceName]) break;
        const jid = chat.remoteJid;
        const preview = extractPreview(chat.lastMessage);

        const { data: contact } = await db.from('whatsapp_contacts')
          .select('id, name, profile_pic')
          .eq('business_id', businessId)
          .eq('phone_number', jid)
          .maybeSingle();

        await db.from('whatsapp_conversations').upsert({
          business_id: businessId,
          instance_id: instanceId,
          jid,
          type: 'individual',
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
        }, { onConflict: 'business_id, instance_id, jid' });
      }

      // Group conversations
      for (const chat of groupChats) {
        if (syncAbortRefs.current[instanceName]) break;
        const jid = chat.remoteJid;
        const preview = extractPreview(chat.lastMessage);

        const { data: groupRow } = await db.from('whatsapp_groups')
          .select('id, subject, profile_pic')
          .eq('business_id', businessId)
          .eq('instance_id', instanceId)
          .eq('group_jid', jid)
          .maybeSingle();

        await db.from('whatsapp_conversations').upsert({
          business_id: businessId,
          instance_id: instanceId,
          jid,
          type: 'group',
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
        }, { onConflict: 'business_id, instance_id, jid' });
      }

      console.log(`[Sync] Built ${individualChats.length + groupChats.length} conversations`);
    } catch (e) { console.error('Conversations sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 6: Profile pictures
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Fetching profile pictures...' }));
    try {
      let allContacts: any[] = [];
      let contactPage = 0;
      const pageSize = 1000;
      while (true) {
        const { data: page } = await db.from('whatsapp_contacts')
          .select('phone_number, profile_pic')
          .eq('business_id', businessId)
          .eq('instance_id', instanceId)
          .range(contactPage * pageSize, (contactPage + 1) * pageSize - 1);
        if (!page || page.length === 0) break;
        allContacts = allContacts.concat(page);
        if (page.length < pageSize) break;
        contactPage++;
      }

      const needPic = allContacts
        .filter((c: any) => !c.profile_pic && !c.phone_number.endsWith('@g.us') && c.phone_number !== 'status@broadcast')
        .map((c: any) => ({ jid: c.phone_number, number: c.phone_number.includes('@lid') ? c.phone_number : c.phone_number.split('@')[0] }));

      let picsFetched = 0;
      for (let pi = 0; pi < needPic.length; pi += 5) {
        if (syncAbortRefs.current[instanceName]) break;
        updateProgress(instanceName, p => ({ ...p, status: `Profile pics: ${picsFetched} found (${Math.min(pi + 5, needPic.length)}/${needPic.length})` }));

        const batch = needPic.slice(pi, pi + 5);
        const results = await Promise.allSettled(
          batch.map(async ({ jid, number }: { jid: string; number: string }) => {
            const res = await whatsappService.invokeClient('fetch-profile-url', { instanceName, number });
            if (res?.profilePictureUrl) {
              await db.from('whatsapp_contacts').update({ profile_pic: res.profilePictureUrl }).eq('business_id', businessId).eq('phone_number', jid);
              return true;
            }
            return false;
          })
        );
        picsFetched += results.filter(r => r.status === 'fulfilled' && r.value).length;
      }
    } catch (e) { console.error('Profile pic sync error:', e); }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 7: Messages (individual + group)
    // ═══════════════════════════════════════════════════════════════════
    updateProgress(instanceName, p => ({ ...p, status: 'Syncing messages...' }));
    const ownerPhone = (await db.from('whatsapp_instances').select('phone_number').eq('id', instanceId).single()).data?.phone_number || '';

    let totalMessages = 0;
    const allConversationChats = [...individualChats, ...groupChats];

    for (let ci = 0; ci < allConversationChats.length; ci++) {
      if (syncAbortRefs.current[instanceName]) break;
      const chat = allConversationChats[ci];
      const jid = chat.remoteJid;
      const isGroup = jid.endsWith('@g.us');

      updateProgress(instanceName, p => ({ ...p, status: `Messages: chat ${ci + 1}/${allConversationChats.length}` }));

      // Resolve contact_id for individual chats
      let contactId: string | null = null;
      if (!isGroup) {
        const { data: contactRow } = await db.from('whatsapp_contacts')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('phone_number', jid)
          .maybeSingle();

        if (contactRow) {
          contactId = contactRow.id;
        } else {
          // Try alt JID
          const altJid = chat.lastMessage?.key?.remoteJidAlt;
          if (altJid?.includes('@s.whatsapp.net')) {
            const { data: alt } = await db.from('whatsapp_contacts')
              .select('id').eq('business_id', businessId).eq('phone_number', altJid).maybeSingle();
            if (alt) contactId = alt.id;
          }
          // Create if still missing
          if (!contactId) {
            const chatName = (chat.pushName && chat.pushName !== ownerPhone && chat.pushName !== instanceName) ? chat.pushName : null;
            const { data: newContact } = await db.from('whatsapp_contacts')
              .upsert({ business_id: businessId, phone_number: jid, name: chatName, instance_id: instanceId },
                { onConflict: 'business_id, phone_number' })
              .select('id').single();
            contactId = newContact?.id || null;
          }
        }

        // For LID contacts, try to resolve phone via fetchProfile
        if (jid.includes('@lid')) {
          try {
            const profile = await whatsappService.invokeClient('fetch-profile', { instanceName, number: jid });
            const phone = profile?.wuid || profile?.numberExists || profile?.jid;
            if (phone?.includes('@s.whatsapp.net')) {
              await db.from('whatsapp_jid_mappings').upsert([{
                business_id: businessId, instance_id: instanceId, lid_jid: jid, phone_jid: phone,
              }], { onConflict: 'business_id, lid_jid' });
            }
          } catch { /* skip */ }
        }
      }

      // Get conversation_id
      const { data: convRow } = await db.from('whatsapp_conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('instance_id', instanceId)
        .eq('jid', jid)
        .maybeSingle();
      const conversationId = convRow?.id || null;

      // Fetch messages (all pages, limit per group to avoid timeout)
      const maxPages = isGroup ? 3 : 999;
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= maxPages && !syncAbortRefs.current[instanceName]) {
        try {
          const msgData = await whatsappService.findMessages(instanceName, jid, 100, page);
          const records = msgData?.messages?.records || msgData?.records || [];
          const totalPages = msgData?.messages?.pages || 1;
          if (records.length === 0) { hasMore = false; break; }

          // Extract JID mappings from message keys
          if (!isGroup && jid.includes('@lid')) {
            for (const m of records) {
              const alt = m.key?.remoteJidAlt || m.key?.participant;
              if (alt?.includes('@s.whatsapp.net')) {
                await db.from('whatsapp_jid_mappings').upsert([{
                  business_id: businessId, instance_id: instanceId, lid_jid: jid, phone_jid: alt,
                }], { onConflict: 'business_id, lid_jid' });
                break;
              }
            }
          }

          const msgBatch = records
            .filter((m: any) => m.messageType !== 'protocolMessage')
            .map((m: any) => {
              const msgType = m.messageType || 'conversation';
              const msg = m.message || {};
              let content: string | null = null;
              let mediaUrl: string | null = null;

              if (msgType === 'conversation') content = msg.conversation || null;
              else if (msgType === 'extendedTextMessage') content = msg.extendedTextMessage?.text || null;
              else if (msgType === 'imageMessage') { content = msg.imageMessage?.caption || null; mediaUrl = msg.imageMessage?.url || null; }
              else if (msgType === 'videoMessage') { content = msg.videoMessage?.caption || null; mediaUrl = msg.videoMessage?.url || null; }
              else if (msgType === 'audioMessage') { content = `[Audio ${msg.audioMessage?.seconds || 0}s]`; mediaUrl = msg.audioMessage?.url || null; }
              else if (msgType === 'documentMessage') { content = msg.documentMessage?.fileName || '[Document]'; mediaUrl = msg.documentMessage?.url || null; }
              else if (msgType === 'stickerMessage') { content = '[Sticker]'; mediaUrl = msg.stickerMessage?.url || null; }
              else if (msgType === 'reactionMessage') {
                const rm = msg.reactionMessage || {};
                content = JSON.stringify({ targetMessageId: rm.key?.id || '', emoji: rm.text || '' });
              }

              return {
                business_id: businessId,
                instance_id: instanceId,
                contact_id: isGroup ? null : contactId,
                conversation_id: conversationId,
                remote_jid: jid,
                message_id: m.key?.id,
                type: msgType,
                content,
                media_url: mediaUrl,
                direction: m.key?.fromMe ? 'outgoing' : 'incoming',
                status: 'sent',
                sender_jid: isGroup ? (m.key?.participant || null) : null,
                created_at: m.messageTimestamp ? new Date(m.messageTimestamp * 1000).toISOString() : new Date().toISOString(),
                raw_key: m.key ? { id: m.key.id, fromMe: m.key.fromMe, remoteJid: m.key.remoteJid } : null,
              };
            })
            .filter((m: any) => m.message_id);

          if (msgBatch.length > 0) {
            await db.from('whatsapp_messages').upsert(msgBatch, { onConflict: 'message_id', ignoreDuplicates: true });
            totalMessages += msgBatch.length;
            updateProgress(instanceName, p => ({ ...p, messages: totalMessages, status: `Messages: ${totalMessages} synced (chat ${ci + 1}/${allConversationChats.length})` }));
          }

          hasMore = page < totalPages;
          page++;
        } catch (e) {
          console.error(`Message sync error for ${jid} page ${page}:`, e);
          hasMore = false;
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Phase 8: Name backfill for LID contacts
    // ═══════════════════════════════════════════════════════════════════
    try {
      updateProgress(instanceName, p => ({ ...p, status: 'Backfilling contact names...' }));
      const { data: namelessLid } = await db.from('whatsapp_contacts')
        .select('id, phone_number')
        .eq('business_id', businessId)
        .eq('instance_id', instanceId)
        .is('name', null)
        .like('phone_number', '%@lid');

      if (namelessLid?.length) {
        const { data: namedPhone } = await db.from('whatsapp_contacts')
          .select('phone_number, name, profile_pic')
          .eq('business_id', businessId)
          .not('name', 'is', null)
          .like('phone_number', '%@s.whatsapp.net');

        const { data: mappings } = await db.from('whatsapp_jid_mappings')
          .select('lid_jid, phone_jid')
          .eq('business_id', businessId);

        const lidToPhone: Record<string, string> = {};
        if (mappings) for (const m of mappings) lidToPhone[m.lid_jid] = m.phone_jid;

        if (namedPhone) {
          const phoneNameMap: Record<string, { name: string; pic: string | null }> = {};
          for (const c of namedPhone) phoneNameMap[c.phone_number] = { name: c.name, pic: c.profile_pic };

          for (const lid of namelessLid) {
            const phoneJid = lidToPhone[lid.phone_number];
            if (phoneJid && phoneNameMap[phoneJid]) {
              const info = phoneNameMap[phoneJid];
              await db.from('whatsapp_contacts')
                .update({ name: info.name, ...(info.pic ? { profile_pic: info.pic } : {}) })
                .eq('id', lid.id);
            }
          }
        }
      }
    } catch (e) { console.error('Name backfill error:', e); }

    // ── Done ─────────────────────────────────────────────────────────
    activeSyncRuns.current.delete(instanceName);
    updateProgress(instanceName, p => ({ ...p, status: 'Complete' }));
    updateSyncState(instanceName, { step: 'complete', background: false });
    fetchInstances();
  };

  // ── Delete instance ───────────────────────────────────────────────
  const handleDeleteInstance = async (id: string, instanceName: string) => {
    try {
      setActionLoading(`delete-${instanceName}`);
      const businessId = localStorage.getItem('activeBusinessId');

      // Delete from Evolution API — try multiple approaches to ensure cleanup
      try {
        await whatsappService.deleteInstance(instanceName);
      } catch (evoErr: any) {
        console.warn('Evolution delete attempt 1 failed:', evoErr.message);
        // Try logout first, then delete again
        try {
          await whatsappService.invokeClient('fetch-instances', { instanceName });
          await whatsappService.deleteInstance(instanceName);
        } catch {
          console.warn('Evolution delete attempt 2 failed — instance may not exist on Evolution API');
        }
      }

      if (businessId) {
        // Clean all instance-scoped data
        await Promise.all([
          db.from('whatsapp_contacts').delete().eq('instance_id', id),
          db.from('whatsapp_messages').delete().eq('instance_id', id),
          db.from('whatsapp_conversations').delete().eq('instance_id', id),
          db.from('whatsapp_groups').delete().eq('instance_id', id),
          db.from('whatsapp_jid_mappings').delete().eq('instance_id', id),
          db.from('whatsapp_chat_settings').delete().eq('instance_id', id),
          db.from('whatsapp_chat_labels').delete().eq('instance_id', id),
          db.from('whatsapp_labels').delete().eq('instance_id', id),
          db.from('whatsapp_pinned_messages').delete().eq('instance_id', id),
          db.from('whatsapp_starred_messages').delete().eq('instance_id', id),
        ]);
      }

      // Delete instance row (cascades: messages)
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      // Clear sync state for this instance
      setSyncStates(prev => { const next = { ...prev }; delete next[instanceName]; persistSyncStates(next); return next; });
      toast({ title: "Deleted", description: "Instance and all data removed." });
      fetchInstances();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Close modal ───────────────────────────────────────────────────
  const handleCloseModal = (abort = true) => {
    const name = modalInstanceName;
    if (abort) {
      syncAbortRefs.current[name] = true;
      updateSyncState(name, { step: 'scanning', background: false, qrCode: null });
    }
    setModalOpen(false);
  };

  // ── Continue sync in background ──────────────────────────────────
  const handleSyncInBackground = () => {
    updateSyncState(modalInstanceName, { background: true });
    setModalOpen(false);
  };

  // ── Reopen sync progress modal ───────────────────────────────────
  const handleReopenSyncModal = (instName: string) => {
    setModalInstanceName(instName);
    setModalOpen(true);
  };

  // ── Progress bar component ────────────────────────────────────────
  const ProgressBar = ({ value, max, label }: { value: number; max: number; label: string }) => {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-600 font-medium">{label}</span>
          <span className="text-gray-400 tabular-nums">{value}/{max}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Integrations</p>
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">WhatsApp Devices</h1>
            <p className="text-gray-500 font-light text-sm max-w-xl">
              Connect and manage physical devices to automate delivery notifications and customer messaging in real-time.
            </p>
          </div>
          <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
            <Smartphone className="w-7 h-7 text-primary/80" />
          </div>
        </div>
      </div>

      {/* Create Instance */}
      <Card className="border-0 shadow-sm rounded-3xl bg-white bg-gradient-to-br from-white to-gray-50/50">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-gray-900">Connect New Device</h3>
              <p className="text-sm font-light text-gray-500">Enter a unique label for your new connection to generate a pairing QR code.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <Input
                placeholder="e.g. Sales-Number-1"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value.replace(/\s+/g, '-'))}
                className="w-full sm:w-[250px] rounded-2xl bg-gray-50/50 border-gray-100 focus-visible:ring-primary/20"
                disabled={actionLoading === 'create'}
              />
              <Button
                onClick={handleCreateInstance}
                disabled={!newInstanceName || actionLoading === 'create'}
                className="rounded-2xl shadow-sm px-6 h-10"
              >
                {actionLoading === 'create' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Generate QR
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Instance Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse border-0 shadow-sm rounded-3xl bg-white">
              <CardContent className="h-[200px]" />
            </Card>
          ))
        ) : instances.length === 0 ? (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-dashed border-gray-200">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-light text-gray-900">No devices connected</h3>
            <p className="text-gray-500 font-light mt-2 max-w-sm">Generate a QR code above to link your first WhatsApp account to the platform.</p>
          </div>
        ) : (
          instances.map(inst => {
            const isOpen = inst.status === 'open';
            const instSync = syncStates[inst.instance_name];
            const isSyncing = instSync?.background && (instSync.step === 'syncing' || instSync.step === 'connected');
            return (
              <Card
                key={inst.id}
                className={cn("relative overflow-hidden border-0 shadow-sm rounded-3xl bg-white transition-all hover:shadow-md", isSyncing && "cursor-pointer ring-1 ring-emerald-200")}
                onClick={isSyncing ? () => handleReopenSyncModal(inst.instance_name) : undefined}
              >
                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors", isSyncing ? "bg-emerald-400/80 animate-pulse" : isOpen ? "bg-emerald-500/80" : "bg-amber-400/80")} />
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-6 mt-1">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12 border border-gray-100 shadow-sm">
                        <AvatarImage src={inst.profile_pic} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/5 text-primary text-sm font-medium">
                          {inst.instance_name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 truncate max-w-[150px]">{inst.instance_name}</h3>
                        {inst.phone_number ? (
                          <div className="flex items-center text-xs text-gray-500 font-light mt-1 gap-1.5">
                            <Phone className="w-3 h-3 text-gray-400" /> +{inst.phone_number}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 font-light mt-1">Unpaired device</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-4 border-t border-gray-50">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Status</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px] font-bold uppercase border px-3 py-1",
                        isSyncing ? "bg-blue-50 text-blue-800 border-blue-100"
                          : isOpen ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                          : "bg-amber-50 text-amber-800 border-amber-100"
                      )}
                    >
                      {isSyncing && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      {!isSyncing && isOpen && <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                      {!isSyncing && !isOpen && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      {isSyncing ? 'Syncing' : isOpen ? 'Connected' : 'Pending'}
                    </Badge>
                  </div>
                  {isSyncing && instSync && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-700 animate-pulse"
                          style={{
                            width: `${Math.round(
                              ((instSync.progress.contacts.synced + instSync.progress.chats.synced) /
                              Math.max(instSync.progress.contacts.total + instSync.progress.chats.total, 1)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-blue-600 font-medium truncate">{instSync.progress.status}</p>
                    </div>
                  )}
                </CardContent>
                <div className="px-3 pb-3 flex justify-end gap-2 bg-gray-50/50 pt-3 border-t border-gray-50">
                  {!isOpen && (
                    <Button
                      variant="outline" size="sm"
                      className="flex-1 rounded-xl bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium h-9 text-xs"
                      disabled={actionLoading !== null}
                      onClick={() => fetchAndShowQR(inst.instance_name)}
                    >
                      {actionLoading === `qr-${inst.instance_name}` ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <QrCode className="w-3.5 h-3.5 mr-2 text-primary/70" />}
                      Scan QR
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm"
                    className="flex-1 rounded-xl text-red-600/80 hover:text-red-700 hover:bg-red-50 font-medium h-9 text-xs"
                    disabled={actionLoading !== null}
                    onClick={() => handleDeleteInstance(inst.id, inst.instance_name)}
                  >
                    {actionLoading === `delete-${inst.instance_name}` ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-2" />}
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* ── Connection Modal (multi-step) ──────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) { if (modalStep === 'syncing') handleSyncInBackground(); else handleCloseModal(); } }}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white/95 backdrop-blur-md shadow-2xl rounded-3xl border-0">

          {/* ── Step 1: Scanning QR ─────────────────────────────────────── */}
          {modalStep === 'scanning' && (
            <>
              <div className="bg-gradient-to-r from-primary/5 to-transparent p-8 text-center border-b border-gray-100">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-extralight text-gray-900 text-center tracking-tight">Pair WhatsApp Device</DialogTitle>
                  <DialogDescription className="text-center pt-3 font-light text-gray-500">
                    Open WhatsApp {">"} Settings {">"} Linked Devices {">"} Link a Device
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="p-10 flex flex-col items-center justify-center bg-gray-50/50 relative">
                <div className="relative bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                  {qrCode ? (
                    <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64 mx-auto rounded-xl" />
                  ) : (
                    <div className="w-64 h-64 flex flex-col items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary/60 mb-4" />
                      <p className="text-gray-400 font-light text-sm">Generating secure code...</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Waiting for scan...</p>
                </div>
              </div>
            </>
          )}

          {/* ── Step 2: Connected (brief transition) ───────────────────── */}
          {modalStep === 'connected' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="relative mb-6">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-emerald-100 shadow-lg" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center border-4 border-emerald-100 shadow-lg">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
              </div>
              <h3 className="text-xl font-medium text-gray-900 mb-1">Connected</h3>
              {ownerProfile.phone && (
                <p className="text-sm text-gray-500 font-light">+{ownerProfile.phone}</p>
              )}
              <p className="text-xs text-gray-400 mt-4">Starting data sync...</p>
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin mt-3" />
            </div>
          )}

          {/* ── Step 3: Syncing ────────────────────────────────────────── */}
          {modalStep === 'syncing' && (
            <div className="p-8 animate-in fade-in duration-300">
              <div className="flex items-center gap-4 mb-8">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-emerald-100" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center border-2 border-emerald-100">
                    <Database className="w-6 h-6 text-emerald-500" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{ownerProfile.name || modalInstanceName}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />
                    <span className="text-xs text-emerald-600 font-medium">{syncProgress.status}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <ProgressBar
                  value={syncProgress.contacts.synced}
                  max={syncProgress.contacts.total}
                  label="Contacts"
                />
                <ProgressBar
                  value={syncProgress.chats.synced}
                  max={syncProgress.chats.total}
                  label="Conversations"
                />
                {syncProgress.messages > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 font-medium">Messages</span>
                    <span className="text-emerald-600 font-medium tabular-nums">{syncProgress.messages} synced</span>
                  </div>
                )}
              </div>

              {/* Overall progress */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${Math.round(
                        ((syncProgress.contacts.synced + syncProgress.chats.synced) /
                        Math.max(syncProgress.contacts.total + syncProgress.chats.total, 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <Button
                variant="outline"
                onClick={handleSyncInBackground}
                className="w-full mt-4 rounded-2xl h-10 text-gray-600 border-gray-200 hover:bg-gray-100 hover:text-gray-800 font-medium text-xs"
              >
                Continue in background
              </Button>
            </div>
          )}

          {/* ── Step 4: Complete ───────────────────────────────────────── */}
          {modalStep === 'complete' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="relative mb-6">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-emerald-100 shadow-lg" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center border-4 border-emerald-100 shadow-lg">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
              </div>

              <h3 className="text-xl font-medium text-gray-900 mb-1">All Set</h3>
              {ownerProfile.phone && (
                <p className="text-sm text-gray-500 font-light mb-6">+{ownerProfile.phone}</p>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 w-full mb-8">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <Users className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.contacts.synced}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Contacts</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <MessageCircle className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.chats.synced}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Chats</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <Database className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.messages}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Messages</p>
                </div>
              </div>

              <Button
                onClick={() => { handleCloseModal(); navigate('/business/whatsapp/inbox'); }}
                className="w-full rounded-2xl h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
              >
                Open Inbox
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
