import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Smartphone, Phone, Loader2, QrCode, CheckCircle2, MessageSquare, ArrowRight, Users, MessageCircle, Database, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const db = supabase as any;

// ── Connection modal step types ──────────────────────────────────────────
type ModalStep = 'scanning' | 'connected' | 'syncing' | 'complete' | 'failed';

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
  jobId?: string | null;
}

const defaultProgress: SyncProgress = { contacts: { total: 0, synced: 0 }, chats: { total: 0, synced: 0 }, messages: 0, jidMappings: 0, status: 'Preparing...' };

// ── Derive SyncProgress from server job phases + metadata ────────────────
function deriveSyncProgress(phases: any[], syncMetadata?: any): SyncProgress {
  if (!phases || phases.length === 0) return { ...defaultProgress };
  const contactsPhase = phases[0]; // contacts
  const chatsPhase = phases[1]; // chats_jid
  const messagesPhase = phases[6]; // messages
  const jidPhase = phases[1]; // chats_jid (includes mappings)

  // Find the currently running phase for status text
  const running = phases.find((p: any) => p.status === 'running');
  const lastCompleted = [...phases].reverse().find((p: any) => p.status === 'completed');
  const status = running?.progress?.detail || lastCompleted?.progress?.detail || 'Preparing...';

  // Extract message count from detail string or sync_metadata
  let messageCount = syncMetadata?.messages_synced || 0;
  if (!messageCount && messagesPhase?.progress?.detail) {
    const match = messagesPhase.progress.detail.match(/(\d+)\s*messages?\s*synced/i);
    if (match) messageCount = parseInt(match[1], 10);
  }

  return {
    contacts: {
      total: contactsPhase?.progress?.total || 0,
      synced: contactsPhase?.progress?.processed || 0,
    },
    chats: {
      total: chatsPhase?.progress?.total || 0,
      synced: chatsPhase?.progress?.processed || 0,
    },
    messages: messageCount,
    jidMappings: jidPhase?.progress?.processed || 0,
    status,
  };
}

export default function WhatsAppManager() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string; name: string; loading: boolean;
    counts: { contacts: number; messages: number; conversations: number; groups: number; labels: number } | null;
  } | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── Per-instance sync state (supports multiple concurrent syncs) ────
  const [syncStates, setSyncStates] = useState<Record<string, InstanceSyncState>>({});

  // ── Modal state (which instance is currently shown in the modal) ────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInstanceName, setModalInstanceName] = useState('');

  // Helpers to read/write per-instance sync state
  const getSyncState = (name: string): InstanceSyncState => syncStates[name] || {
    step: 'scanning', progress: { ...defaultProgress }, ownerProfile: { pic: null, phone: '', name: '' }, qrCode: null, background: false, jobId: null,
  };
  const updateSyncState = (name: string, patch: Partial<InstanceSyncState>) => {
    setSyncStates(prev => {
      const next = { ...prev, [name]: { ...getSyncState(name), ...prev[name], ...patch } };
      return next;
    });
  };

  // Derived state for the currently viewed modal instance
  const currentSync = getSyncState(modalInstanceName);
  const modalStep = currentSync.step;
  const syncProgress = currentSync.progress;
  const ownerProfile = currentSync.ownerProfile;
  const qrCode = currentSync.qrCode;

  // ── Subscribe to Realtime sync job updates + load active jobs on mount ──
  useEffect(() => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    // Load any active/recent sync jobs
    const loadActiveJobs = async () => {
      const { data: jobs } = await supabase
        .from('whatsapp_sync_jobs')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['pending', 'running', 'paused', 'completed', 'failed'])
        .order('created_at', { ascending: false });

      if (jobs) {
        const states: Record<string, InstanceSyncState> = {};
        for (const job of jobs) {
          // Only show the most recent job per instance
          if (states[job.instance_name]) continue;
          const step: ModalStep = job.status === 'completed' ? 'complete'
            : job.status === 'failed' ? 'failed'
            : job.status === 'running' || job.status === 'pending' ? 'syncing'
            : 'syncing';
          states[job.instance_name] = {
            step,
            progress: deriveSyncProgress(job.phases, job.sync_metadata),
            ownerProfile: { pic: null, phone: '', name: '' },
            qrCode: null,
            background: true,
            jobId: job.id,
            _phases: job.phases,
          } as any;
        }
        setSyncStates(prev => ({ ...prev, ...states }));
      }
    };
    loadActiveJobs();

    // Realtime subscription for sync progress
    const channel = supabase
      .channel('sync-jobs-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_sync_jobs',
        filter: `business_id=eq.${businessId}`,
      }, (payload: any) => {
        const job = payload.new;
        if (!job) return;
        const step: ModalStep = job.status === 'completed' ? 'complete'
          : job.status === 'failed' ? 'failed'
          : job.status === 'running' || job.status === 'pending' ? 'syncing'
          : 'syncing';

        setSyncStates(prev => ({
          ...prev,
          [job.instance_name]: {
            ...prev[job.instance_name],
            step,
            progress: deriveSyncProgress(job.phases, job.sync_metadata),
            ownerProfile: prev[job.instance_name]?.ownerProfile || { pic: null, phone: '', name: '' },
            qrCode: prev[job.instance_name]?.qrCode || null,
            background: prev[job.instance_name]?.background ?? true,
            jobId: job.id,
            _phases: job.phases,
          } as any,
        }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

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

  // ── Instance connected → fetch profile + trigger server-side sync ──
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

    // Trigger server-side sync (runs in Supabase Edge Function, independent of browser)
    setTimeout(async () => {
      const businessId = localStorage.getItem('activeBusinessId');
      if (!businessId) return;

      const { data: instData } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', instanceName)
        .single();
      if (!instData) return;

      try {
        await whatsappService.startSync(instData.id, instanceName, businessId);
        updateSyncState(instanceName, { step: 'syncing' });
      } catch (e: any) {
        console.error('Failed to start sync:', e);
        toast({ title: 'Sync Error', description: e.message, variant: 'destructive' });
      }
    }, 1500);
  }, []);
  // ── Confirm delete — fetch data counts then show dialog ────────────
  const confirmDeleteInstance = async (id: string, instanceName: string) => {
    setDeleteConfirm({ id, name: instanceName, loading: true, counts: null });
    try {
      const [contacts, messages, conversations, groups, labels] = await Promise.all([
        db.from('whatsapp_contacts').select('id', { count: 'exact', head: true }).eq('instance_id', id),
        db.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('instance_id', id),
        db.from('whatsapp_conversations').select('id', { count: 'exact', head: true }).eq('instance_id', id),
        db.from('whatsapp_groups').select('id', { count: 'exact', head: true }).eq('instance_id', id),
        db.from('whatsapp_labels').select('id', { count: 'exact', head: true }).eq('instance_id', id),
      ]);
      setDeleteConfirm(prev => prev ? {
        ...prev, loading: false,
        counts: {
          contacts: contacts.count || 0, messages: messages.count || 0,
          conversations: conversations.count || 0, groups: groups.count || 0, labels: labels.count || 0,
        },
      } : null);
    } catch {
      setDeleteConfirm(prev => prev ? { ...prev, loading: false, counts: { contacts: 0, messages: 0, conversations: 0, groups: 0, labels: 0 } } : null);
    }
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

      // Cancel any active sync job for this instance
      const { data: activeJob } = await supabase.from('whatsapp_sync_jobs')
        .select('id').eq('instance_id', id).in('status', ['pending', 'running', 'paused']).maybeSingle();
      if (activeJob) {
        await whatsappService.cancelSync(activeJob.id);
      }

      // Delete instance row (cascades: sync_jobs via FK)
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      // Clear sync state for this instance
      setSyncStates(prev => { const next = { ...prev }; delete next[instanceName]; return next; });
      toast({ title: "Deleted", description: "Instance and all data removed." });
      fetchInstances();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Close modal ───────────────────────────────────────────────────
  const handleCloseModal = (abort = false) => {
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
                    onClick={() => confirmDeleteInstance(inst.id, inst.instance_name)}
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
          {modalStep === 'syncing' && (() => {
            // Extract phase data from the sync job for detailed display
            const jobState = syncStates[modalInstanceName];
            const phases = (jobState as any)?._phases || [];
            const phaseLabels = ['Contacts', 'Chats & JID', 'Groups', 'Labels', 'Conversations', 'Profile Pics', 'Messages', 'Name Backfill'];
            const completedCount = phases.filter((p: any) => p?.status === 'completed').length;
            const overallPct = phases.length > 0 ? Math.round((completedCount / phases.length) * 100) : 0;

            return (
            <div className="p-8 animate-in fade-in duration-300">
              <div className="flex items-center gap-4 mb-6">
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

              {/* Phase checklist */}
              <div className="space-y-2 mb-5">
                {phaseLabels.map((label, i) => {
                  const phase = phases[i];
                  const status = phase?.status || 'pending';
                  const detail = phase?.progress?.detail || '';
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      {status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : status === 'running' ? (
                        <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-gray-200 shrink-0" />
                      )}
                      <span className={cn("font-medium", status === 'completed' ? 'text-gray-500' : status === 'running' ? 'text-gray-900' : 'text-gray-400')}>
                        {label}
                      </span>
                      {status !== 'pending' && detail && (
                        <span className="text-gray-400 ml-auto tabular-nums truncate max-w-[140px]">{detail}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Overall progress bar */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex justify-between text-[10px] text-gray-400 mb-1.5">
                  <span>{completedCount}/{phases.length || 8} phases</span>
                  <span>{overallPct}%</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${overallPct}%` }}
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
            );
          })()}

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

          {/* ── Step 5: Failed ────────────────────────────────────────── */}
          {modalStep === 'failed' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4 border-4 border-red-100">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-medium text-gray-900 mb-1">Sync Failed</h3>
              <p className="text-sm text-gray-500 font-light mb-2 text-center">{syncProgress.status}</p>

              {/* Partial stats */}
              <div className="grid grid-cols-3 gap-4 w-full mb-6">
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <Users className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.contacts.synced}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Contacts</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <MessageCircle className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.chats.synced}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Chats</p>
                </div>
                <div className="bg-gray-50 rounded-2xl p-3 text-center">
                  <Database className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-lg font-semibold text-gray-900">{syncProgress.messages}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Messages</p>
                </div>
              </div>

              <Button
                onClick={async () => {
                  const jobId = currentSync.jobId;
                  if (jobId) {
                    await whatsappService.retrySync(jobId);
                    updateSyncState(modalInstanceName, { step: 'syncing' });
                  }
                }}
                className="w-full rounded-2xl h-12 bg-primary hover:bg-primary/90 text-white font-medium shadow-sm"
              >
                Retry Sync
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ─────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden bg-white shadow-2xl rounded-3xl border-0">
          <div className="p-8 flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-medium text-gray-900 text-center">Remove {deleteConfirm?.name}?</DialogTitle>
              <DialogDescription className="text-center pt-2 text-gray-500 font-light text-sm">
                This will permanently delete the device and all associated data. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {deleteConfirm?.loading ? (
              <div className="flex items-center gap-2 mt-6">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                <span className="text-sm text-gray-400">Calculating data...</span>
              </div>
            ) : deleteConfirm?.counts && (
              <div className="w-full mt-6 bg-gray-50 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Data that will be lost</p>
                {[
                  { label: 'Contacts', count: deleteConfirm.counts.contacts, icon: Users },
                  { label: 'Messages', count: deleteConfirm.counts.messages, icon: MessageCircle },
                  { label: 'Conversations', count: deleteConfirm.counts.conversations, icon: MessageSquare },
                  { label: 'Groups', count: deleteConfirm.counts.groups, icon: Users },
                  { label: 'Labels', count: deleteConfirm.counts.labels, icon: Database },
                ].filter(i => i.count > 0).map(item => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-600">
                      <item.icon className="w-3.5 h-3.5 text-gray-400" />
                      {item.label}
                    </span>
                    <span className="font-semibold text-gray-900 tabular-nums">{item.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 w-full mt-6">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-2xl h-10 font-medium text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirm?.loading || actionLoading !== null}
                onClick={async () => {
                  if (!deleteConfirm) return;
                  setDeleteConfirm(null);
                  await handleDeleteInstance(deleteConfirm.id, deleteConfirm.name);
                }}
                className="flex-1 rounded-2xl h-10 font-medium text-xs bg-red-600 hover:bg-red-700"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
