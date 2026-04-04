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

export default function WhatsAppManager() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── Modal state ─────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>('scanning');
  const [modalInstanceName, setModalInstanceName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<{ pic: string | null; phone: string; name: string }>({ pic: null, phone: '', name: '' });
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    contacts: { total: 0, synced: 0 },
    chats: { total: 0, synced: 0 },
    jidMappings: 0,
    status: 'Preparing...',
  });
  const syncAbortRef = useRef(false);

  // ── Load instances on mount ─────────────────────────────────────────
  useEffect(() => { fetchInstances(); }, []);

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
      const createRes = await whatsappService.createInstance(name);

      const businessId = localStorage.getItem('activeBusinessId');
      await supabase.from('whatsapp_instances').insert({
        business_id: businessId,
        instance_name: name,
        status: 'connecting',
      });

      // Open modal
      setModalInstanceName(name);
      setModalStep('scanning');
      setOwnerProfile({ pic: null, phone: '', name: '' });
      setSyncProgress({ contacts: { total: 0, synced: 0 }, chats: { total: 0, synced: 0 }, messages: 0, jidMappings: 0, status: 'Preparing...' });
      syncAbortRef.current = false;

      const qr = createRes?.qrcode?.base64 || null;
      setQrCode(qr);
      setModalOpen(true);

      // If no QR in create response, fetch it
      if (!qr) {
        setTimeout(async () => {
          try {
            const qrRes = await whatsappService.getQrCode(name);
            setQrCode(qrRes?.qrcode?.base64 || qrRes?.base64 || null);
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
        setModalStep('scanning');
        setOwnerProfile({ pic: null, phone: '', name: '' });
        setSyncProgress({ contacts: { total: 0, synced: 0 }, chats: { total: 0, synced: 0 }, messages: 0, jidMappings: 0, status: 'Preparing...' });
        syncAbortRef.current = false;
        setQrCode(qrBase64);
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
    setModalStep('connected');
    setQrCode(null);

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

        setOwnerProfile({ pic: picBase64, phone, name });

        // Update instance in Supabase
        await supabase.from('whatsapp_instances')
          .update({ phone_number: phone, profile_pic: inst.profilePicUrl || null })
          .eq('instance_name', instanceName);
      }
    } catch {}

    // Brief pause to show connected state, then start sync
    setTimeout(() => {
      startSync(instanceName);
    }, 1500);
  }, []);

  // ── Sync all data from Evolution API to Supabase ──────────────────
  const startSync = async (instanceName: string) => {
    setModalStep('syncing');
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    // Get instance ID
    const { data: instData } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_name', instanceName)
      .single();
    if (!instData) return;
    const instanceId = instData.id;

    // ── Phase 1: Sync contacts ─────────────────────────────────────
    setSyncProgress(p => ({ ...p, status: 'Fetching contacts...' }));
    let contactsTotal = 0;
    let contactsSynced = 0;

    try {
      const contacts = await whatsappService.syncContacts(instanceName);
      if (Array.isArray(contacts)) {
        contactsTotal = contacts.filter((c: any) => c.remoteJid && !c.remoteJid.endsWith('@g.us') && c.remoteJid !== 'status@broadcast').length;
        setSyncProgress(p => ({ ...p, contacts: { total: contactsTotal, synced: 0 }, status: `Syncing ${contactsTotal} contacts...` }));

        // Batch upsert contacts
        const batchSize = 25;
        const filtered = contacts.filter((c: any) => c.remoteJid && !c.remoteJid.endsWith('@g.us') && c.remoteJid !== 'status@broadcast');

        for (let i = 0; i < filtered.length; i += batchSize) {
          if (syncAbortRef.current) break;
          const batch = filtered.slice(i, i + batchSize).map((c: any) => ({
            business_id: businessId,
            phone_number: c.remoteJid,
            name: c.pushName || null,
            profile_pic: c.profilePictureUrl || null,
            instance_id: instanceId,
          }));

          await db.from('whatsapp_contacts').upsert(batch, {
            onConflict: 'business_id, phone_number',
            ignoreDuplicates: false,
          });

          contactsSynced = Math.min(i + batchSize, filtered.length);
          setSyncProgress(p => ({ ...p, contacts: { total: contactsTotal, synced: contactsSynced }, status: `Contacts: ${contactsSynced}/${contactsTotal}` }));
        }
      }
    } catch (e) {
      console.error('Contact sync error:', e);
    }

    // ── Phase 2: Sync chats + JID mappings ─────────────────────────
    setSyncProgress(p => ({ ...p, status: 'Fetching conversations...' }));
    let chatsTotal = 0;
    let chatsSynced = 0;
    let jidMappings = 0;

    try {
      const chatData = await whatsappService.syncChats(instanceName);
      if (Array.isArray(chatData)) {
        const individualChats = chatData.filter((c: any) => c.remoteJid && !c.remoteJid.endsWith('@g.us') && c.remoteJid !== 'status@broadcast');
        chatsTotal = individualChats.length;
        setSyncProgress(p => ({ ...p, chats: { total: chatsTotal, synced: 0 }, status: `Syncing ${chatsTotal} conversations...` }));

        // Extract JID mappings + update contact profile pics from chat data
        const mappingBatch: any[] = [];
        const picUpdates: any[] = [];
        for (const chat of individualChats) {
          if (chat.remoteJid?.includes('@lid')) {
            const alt = chat.lastMessage?.key?.remoteJidAlt;
            if (alt?.includes('@s.whatsapp.net')) {
              mappingBatch.push({
                business_id: businessId,
                instance_id: instanceId,
                lid_jid: chat.remoteJid,
                phone_jid: alt,
              });
              // Update contact profile pic if available (using alt phone JID)
              if (chat.profilePicUrl) {
                picUpdates.push({ jid: alt, pic: chat.profilePicUrl, name: chat.pushName });
              }
            }
          } else if (chat.profilePicUrl) {
            picUpdates.push({ jid: chat.remoteJid, pic: chat.profilePicUrl, name: chat.pushName });
          }
        }

        if (mappingBatch.length > 0) {
          await db.from('whatsapp_jid_mappings').upsert(mappingBatch, {
            onConflict: 'business_id, lid_jid',
          });
          jidMappings = mappingBatch.length;
        }

        chatsSynced = chatsTotal;
        setSyncProgress(p => ({
          ...p,
          chats: { total: chatsTotal, synced: chatsSynced },
          jidMappings,
          status: 'Fetching profile pictures...',
        }));

        // ── Phase 3: Fetch profile pictures for ALL synced contacts ────
        // Use the contacts we already synced (they have @s.whatsapp.net JIDs)
        const { data: allContacts } = await db.from('whatsapp_contacts')
          .select('phone_number, profile_pic')
          .eq('business_id', businessId)
          .eq('instance_id', instanceId);

        const contactsNeedingPic = (allContacts || [])
          .filter((c: any) => c.phone_number.includes('@s.whatsapp.net') && !c.profile_pic)
          .map((c: any) => ({ jid: c.phone_number, number: c.phone_number.split('@')[0] }));

        let picsFetched = 0;
        const totalPics = contactsNeedingPic.length;
        // Fetch 5 at a time
        for (let pi = 0; pi < totalPics; pi += 5) {
          if (syncAbortRef.current) break;
          setSyncProgress(p => ({ ...p, status: `Profile pics: ${picsFetched} found (${Math.min(pi + 5, totalPics)}/${totalPics})` }));

          const batch = contactsNeedingPic.slice(pi, pi + 5);
          const results = await Promise.allSettled(
            batch.map(async ({ jid, number }: { jid: string; number: string }) => {
              const res = await whatsappService.invokeClient('fetch-profile-url', { instanceName, number });
              const url = res?.profilePictureUrl;
              if (url) {
                await db.from('whatsapp_contacts')
                  .update({ profile_pic: url })
                  .eq('business_id', businessId)
                  .eq('phone_number', jid);
                return true;
              }
              return false;
            })
          );
          picsFetched += results.filter(r => r.status === 'fulfilled' && r.value).length;
        }

        setSyncProgress(p => ({ ...p, status: `Syncing messages... (${picsFetched} profile pics found)` }));

        // ── Phase 4: Sync messages per chat ─────────────────────────
        let totalMessages = 0;
        for (let ci = 0; ci < individualChats.length; ci++) {
          if (syncAbortRef.current) break;
          const chat = individualChats[ci];
          const jid = chat.remoteJid;

          setSyncProgress(p => ({ ...p, status: `Messages: chat ${ci + 1}/${chatsTotal}` }));

          // Find the contact for this chat
          const contactJid = chat.lastMessage?.key?.remoteJidAlt || jid;
          const { data: contactRow } = await db.from('whatsapp_contacts')
            .select('id')
            .eq('business_id', businessId)
            .eq('phone_number', contactJid)
            .maybeSingle();

          // If no contact found with alt JID, try direct JID
          let contactId = contactRow?.id;
          if (!contactId) {
            const { data: directContact } = await db.from('whatsapp_contacts')
              .select('id')
              .eq('business_id', businessId)
              .eq('phone_number', jid)
              .maybeSingle();
            contactId = directContact?.id;
          }

          // Create contact if missing
          if (!contactId) {
            const { data: newContact } = await db.from('whatsapp_contacts')
              .upsert({
                business_id: businessId,
                phone_number: contactJid,
                name: chat.pushName || null,
                instance_id: instanceId,
              }, { onConflict: 'business_id, phone_number' })
              .select('id')
              .single();
            contactId = newContact?.id;
          }

          if (!contactId) continue;

          // Fetch messages for this chat (all pages)
          let page = 1;
          let hasMore = true;
          while (hasMore && !syncAbortRef.current) {
            try {
              const msgData = await whatsappService.findMessages(instanceName, jid, 100, page);
              const records = msgData?.messages?.records || msgData?.records || [];
              const totalPages = msgData?.messages?.pages || 1;

              if (records.length === 0) { hasMore = false; break; }

              // Extract JID mappings from message keys
              if (jid.includes('@lid')) {
                const newMappings: any[] = [];
                for (const m of records) {
                  const alt = m.key?.remoteJidAlt;
                  if (alt?.includes('@s.whatsapp.net') && !newMappings.some((x: any) => x.lid_jid === jid)) {
                    newMappings.push({
                      business_id: businessId,
                      instance_id: instanceId,
                      lid_jid: jid,
                      phone_jid: alt,
                    });
                  }
                }
                if (newMappings.length > 0) {
                  await db.from('whatsapp_jid_mappings').upsert(newMappings, { onConflict: 'business_id, lid_jid' });
                }
              }

              // Build message batch
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

                  const ts = m.messageTimestamp ? new Date(m.messageTimestamp * 1000).toISOString() : new Date().toISOString();

                  return {
                    business_id: businessId,
                    instance_id: instanceId,
                    contact_id: contactId,
                    remote_jid: jid,
                    message_id: m.key?.id,
                    type: msgType,
                    content,
                    media_url: mediaUrl,
                    direction: m.key?.fromMe ? 'outgoing' : 'incoming',
                    status: 'sent',
                    created_at: ts,
                    raw_key: m.key ? { id: m.key.id, fromMe: m.key.fromMe, remoteJid: m.key.remoteJid } : null,
                  };
                })
                .filter((m: any) => m.message_id);

              if (msgBatch.length > 0) {
                await db.from('whatsapp_messages').upsert(msgBatch, {
                  onConflict: 'message_id',
                  ignoreDuplicates: true,
                });
                totalMessages += msgBatch.length;
                setSyncProgress(p => ({ ...p, messages: totalMessages, status: `Messages: ${totalMessages} synced (chat ${ci + 1}/${chatsTotal})` }));
              }

              hasMore = page < totalPages;
              page++;
            } catch (e) {
              console.error(`Message sync error for ${jid} page ${page}:`, e);
              hasMore = false;
            }
          }
        }

        setSyncProgress(p => ({
          ...p,
          chats: { total: chatsTotal, synced: chatsSynced },
          jidMappings,
          status: `Synced ${totalMessages} messages`,
        }));
      }
    } catch (e) {
      console.error('Chat sync error:', e);
    }

    // ── Done ─────────────────────────────────────────────────────────
    setSyncProgress(p => ({ ...p, status: 'Complete' }));
    setModalStep('complete');
    fetchInstances();
  };

  // ── Delete instance ───────────────────────────────────────────────
  const handleDeleteInstance = async (id: string, instanceName: string) => {
    try {
      setActionLoading(`delete-${instanceName}`);
      const businessId = localStorage.getItem('activeBusinessId');

      try { await whatsappService.deleteInstance(instanceName); } catch {}

      if (businessId) {
        // Get all remote_jids from this instance's messages for cleanup
        const { data: jids } = await db.from('whatsapp_messages')
          .select('remote_jid')
          .eq('instance_id', id);
        const remoteJids = [...new Set((jids || []).map((r: any) => r.remote_jid))];

        // Clean contacts tied to this instance
        await db.from('whatsapp_contacts').delete().eq('instance_id', id);

        // Clean chat metadata for these conversations
        if (remoteJids.length > 0) {
          await Promise.all([
            db.from('whatsapp_chat_settings').delete().eq('business_id', businessId).in('remote_jid', remoteJids),
            db.from('whatsapp_chat_labels').delete().eq('business_id', businessId).in('remote_jid', remoteJids),
            db.from('whatsapp_pinned_messages').delete().eq('business_id', businessId).in('remote_jid', remoteJids),
            db.from('whatsapp_starred_messages').delete().eq('business_id', businessId).in('remote_jid', remoteJids),
          ]);
        }
      }

      // Delete instance row (cascades: messages, jid_mappings, auto_replies)
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      toast({ title: "Deleted", description: "Instance and all data removed." });
      fetchInstances();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Close modal ───────────────────────────────────────────────────
  const handleCloseModal = () => {
    syncAbortRef.current = true;
    setModalOpen(false);
    setQrCode(null);
    setModalStep('scanning');
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
            return (
              <Card key={inst.id} className="relative overflow-hidden border-0 shadow-sm rounded-3xl bg-white transition-all hover:shadow-md">
                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors", isOpen ? "bg-emerald-500/80" : "bg-amber-400/80")} />
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
                        isOpen ? "bg-emerald-50 text-emerald-800 border-emerald-100" : "bg-amber-50 text-amber-800 border-amber-100"
                      )}
                    >
                      {isOpen && <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                      {!isOpen && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      {isOpen ? 'Connected' : 'Pending'}
                    </Badge>
                  </div>
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
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) handleCloseModal(); }}>
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
