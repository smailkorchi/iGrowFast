import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Smartphone, Phone, Loader2, QrCode, CheckCircle2, MessageSquare, ArrowRight, Users, MessageCircle, Database, AlertTriangle, Sparkles, ListChecks, ArrowLeft } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';

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

type ImportMode = 'fresh' | 'essentials' | 'full';

interface InstanceSyncState {
  step: ModalStep;
  progress: SyncProgress;
  ownerProfile: { pic: string | null; phone: string; name: string };
  qrCode: string | null;
  background: boolean;
  jobId?: string | null;
  importMode?: ImportMode;
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Add-instance pre-QR steps (modal-local UI state) ────────────────
  const [preQrStep, setPreQrStep] = useState<'name' | 'mode' | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [pendingMode, setPendingMode] = useState<ImportMode | null>(null);
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
      const { data: jobs } = await db
        .from('whatsapp_sync_jobs')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['pending', 'running', 'paused', 'completed', 'failed'])
        .order('created_at', { ascending: false });

      if (jobs) {
        const states: Record<string, InstanceSyncState> = {};
        for (const job of jobs as any[]) {
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
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (modalStep === 'scanning' && modalInstanceName) {
      // ── Poll connection status every 2s ──
      pollRef.current = setInterval(async () => {
        // Pause polling while tab is hidden to save resources/quotas
        if (typeof document !== 'undefined' && document.hidden) return;
        const { data } = await supabase
          .from('whatsapp_instances')
          .select('status')
          .eq('instance_name', modalInstanceName)
          .single();
        if (data?.status === 'open') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
          handleInstanceConnected(modalInstanceName);
          fetchInstances();
        }
      }, 2000);

      // ── Refresh QR every 18s (WhatsApp pairing codes expire ~20s) ──
      qrRefreshRef.current = setInterval(async () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        try {
          const qrRes = await whatsappService.getQrCode(modalInstanceName);
          const fresh = qrRes?.qrcode?.base64 || qrRes?.base64 || null;
          if (fresh) updateSyncState(modalInstanceName, { qrCode: fresh });
        } catch { /* ignore */ }
      }, 18000);

      // ── On tab visibility regain: instant connection check + QR refresh ──
      const onVisible = async () => {
        if (typeof document === 'undefined' || document.hidden) return;
        try {
          const { data } = await supabase
            .from('whatsapp_instances')
            .select('status')
            .eq('instance_name', modalInstanceName)
            .single();
          if (data?.status === 'open') {
            if (pollRef.current) clearInterval(pollRef.current);
            if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
            handleInstanceConnected(modalInstanceName);
            fetchInstances();
            return;
          }
          const qrRes = await whatsappService.getQrCode(modalInstanceName);
          const fresh = qrRes?.qrcode?.base64 || qrRes?.base64 || null;
          if (fresh) updateSyncState(modalInstanceName, { qrCode: fresh });
        } catch { /* ignore */ }
      };
      document.addEventListener('visibilitychange', onVisible);

      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
        document.removeEventListener('visibilitychange', onVisible);
      };
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

  // ── Open the add-instance modal at the name step ──────────────────
  const openAddInstanceModal = () => {
    setPendingName('');
    setPendingMode(null);
    setPreQrStep('name');
    setModalInstanceName('');
    setModalOpen(true);
  };

  // ── Confirm add-instance: create on Evolution + open scanning step ─
  const handleConfirmAddInstance = async (rawName: string, mode: ImportMode) => {
    const name = rawName.trim();
    if (!name) return;
    try {
      setActionLoading('create');
      let createRes;
      try {
        createRes = await whatsappService.createInstance(name);
      } catch (firstErr: any) {
        // If instance already exists on Evolution API (e.g. orphaned from previous delete), clean up and retry
        if (firstErr.message?.toLowerCase().includes('forbidden') || firstErr.message?.toLowerCase().includes('already')) {
          try { await whatsappService.deleteInstance(name); } catch { /* ignore */ }
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

      // Transition modal: pre-QR steps → scanning
      setModalInstanceName(name);
      updateSyncState(name, {
        step: 'scanning',
        progress: { ...defaultProgress },
        ownerProfile: { pic: null, phone: '', name: '' },
        qrCode: createRes?.qrcode?.base64 || null,
        background: false,
        importMode: mode,
      });
      setPreQrStep(null);

      // If no QR in create response, fetch it
      if (!createRes?.qrcode?.base64) {
        setTimeout(async () => {
          try {
            const qrRes = await whatsappService.getQrCode(name);
            updateSyncState(name, { qrCode: qrRes?.qrcode?.base64 || qrRes?.base64 || null });
          } catch { /* ignore */ }
        }, 3000);
      }
    } catch (e) {
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
    } catch (err) {
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
          } catch { /* ignore */ }
        }

        updateSyncState(instanceName, { ownerProfile: { pic: picBase64, phone, name } });

        await supabase.from('whatsapp_instances')
          .update({ phone_number: phone, profile_pic: inst.profilePicUrl || null })
          .eq('instance_name', instanceName);
      }
    } catch { /* ignore */ }

    // Read the user-chosen import mode (set during handleConfirmAddInstance)
    const chosenMode = getSyncState(instanceName).importMode;

    // Fresh mode: skip server-side sync entirely. Webhook handles everything from now on.
    if (chosenMode === 'fresh') {
      setTimeout(() => {
        updateSyncState(instanceName, {
          step: 'complete',
          progress: { ...defaultProgress, status: 'Ready. New messages will appear automatically.' },
        });
      }, 1200);
      return;
    }

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
        // Pass the import mode if it's a user-selectable one (essentials/full).
        // 'fresh' is handled above; reconnects pass undefined and the edge function forces delta.
        const modeArg: 'full' | 'essentials' | undefined =
          chosenMode === 'essentials' || chosenMode === 'full' ? chosenMode : undefined;
        await whatsappService.startSync(instData.id, instanceName, businessId, modeArg);
        updateSyncState(instanceName, { step: 'syncing' });
      } catch (e) {
        console.error('Failed to start sync:', e);
        toast({ title: 'Sync Error', description: e.message, variant: 'destructive' });
      }
    }, 1500);
  }, [syncStates]);
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
      const { data: activeJob } = await db.from('whatsapp_sync_jobs')
        .select('id').eq('instance_id', id).in('status', ['pending', 'running', 'paused']).maybeSingle();
      if (activeJob) {
        await whatsappService.cancelSync((activeJob as any).id);
      }

      // Delete instance row (cascades: sync_jobs via FK)
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      // Clear sync state for this instance
      setSyncStates(prev => { const next = { ...prev }; delete next[instanceName]; return next; });
      toast({ title: "Deleted", description: "Instance and all data removed." });
      fetchInstances();
    } catch (err) {
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

      {/* Instance Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {/* "+" Add Device tile — always first */}
        <button
          type="button"
          onClick={openAddInstanceModal}
          className="group relative h-full min-h-[220px] rounded-3xl border-2 border-dashed border-gray-200 bg-white/40 hover:bg-white hover:border-primary/40 hover:shadow-md transition-all flex flex-col items-center justify-center gap-3 cursor-pointer"
        >
          <div className="w-14 h-14 rounded-2xl bg-primary/5 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
            <Plus className="w-7 h-7 text-primary/70" strokeWidth={1.5} />
          </div>
          <div className="text-center px-4">
            <p className="text-sm font-medium text-gray-900">Add Device</p>
            <p className="text-[11px] text-gray-400 font-light mt-0.5">Connect a new WhatsApp account</p>
          </div>
        </button>

        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse border-0 shadow-sm rounded-3xl bg-white">
              <CardContent className="h-[200px]" />
            </Card>
          ))
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
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (preQrStep) {
              // Pre-QR steps: nothing to clean up on Evolution side
              setPreQrStep(null);
              setPendingName('');
              setPendingMode(null);
              setModalOpen(false);
              return;
            }
            if (modalStep === 'syncing') handleSyncInBackground();
            else handleCloseModal();
          }
        }}
      >
        <DialogContent className={cn(
          "p-0 overflow-hidden bg-white/95 backdrop-blur-md shadow-2xl rounded-3xl border-0",
          preQrStep === 'mode' ? "sm:max-w-3xl" : (!preQrStep && modalStep === 'scanning' ? "sm:max-w-2xl" : "sm:max-w-md")
        )}>

          {/* ── Pre-QR Step A: Name ─────────────────────────────────────── */}
          {preQrStep === 'name' && (
            <>
              <div className="bg-gradient-to-r from-primary/5 to-transparent p-8 text-center border-b border-gray-100">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-extralight text-gray-900 text-center tracking-tight">Add WhatsApp Device</DialogTitle>
                  <DialogDescription className="text-center pt-3 font-light text-gray-500">
                    Choose a unique label to identify this device in your inbox.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Device Name</label>
                  <Input
                    autoFocus
                    placeholder="e.g. Sales-Number-1"
                    value={pendingName}
                    onChange={(e) => setPendingName(e.target.value.replace(/\s+/g, '-'))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && pendingName.trim()) setPreQrStep('mode'); }}
                    className="h-12 text-base rounded-2xl bg-gray-50/50 border-gray-100 focus-visible:ring-primary/20"
                  />
                </div>
                <Button
                  onClick={() => setPreQrStep('mode')}
                  disabled={!pendingName.trim()}
                  className="w-full rounded-2xl h-12 font-medium shadow-sm"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* ── Pre-QR Step B: Import Mode ──────────────────────────────── */}
          {preQrStep === 'mode' && (
            <>
              <div className="bg-gradient-to-r from-primary/5 to-transparent p-8 text-center border-b border-gray-100 relative">
                <button
                  onClick={() => setPreQrStep('name')}
                  className="absolute left-5 top-5 w-8 h-8 rounded-full bg-white/80 hover:bg-white border border-gray-100 flex items-center justify-center transition-colors"
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4 text-gray-500" />
                </button>
                <DialogHeader>
                  <DialogTitle className="text-2xl font-extralight text-gray-900 text-center tracking-tight">Import Strategy</DialogTitle>
                  <DialogDescription className="text-center pt-3 font-light text-gray-500">
                    Pick how much WhatsApp history to bring into <span className="font-medium text-gray-700">{pendingName}</span>.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    key: 'fresh' as ImportMode,
                    icon: Sparkles,
                    title: 'Fresh Start',
                    subtitle: 'Begin with an empty inbox',
                    bullets: [
                      'No historical data imported',
                      'Conversations appear as new messages arrive',
                      'Fastest setup, zero rate-limit risk',
                    ],
                  },
                  {
                    key: 'essentials' as ImportMode,
                    icon: ListChecks,
                    title: 'Essentials Only',
                    subtitle: 'Import the basics, skip history',
                    bullets: [
                      'Contacts, chats, groups, labels',
                      'Conversation list ready to use',
                      'Skips message history & profile pictures',
                    ],
                  },
                  {
                    key: 'full' as ImportMode,
                    icon: Database,
                    title: 'Full Import',
                    subtitle: 'Bring everything from WhatsApp',
                    bullets: [
                      'All contacts, chats, groups, labels',
                      'Complete message history',
                      'Profile pictures cached locally',
                    ],
                    warning: 'May contain temporary mismatches with WhatsApp servers; resolved in future updates.',
                  },
                ].map((opt) => {
                  const selected = pendingMode === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPendingMode(opt.key)}
                      className={cn(
                        "relative h-full text-left rounded-3xl border bg-gradient-to-br from-white to-gray-50/40 p-5 transition-all hover:shadow-md active:scale-[0.98] flex flex-col",
                        selected
                          ? "border-primary/60 ring-2 ring-primary/20 shadow-md"
                          : "border-gray-100 shadow-sm hover:border-gray-200"
                      )}
                    >
                      {selected && (
                        <CheckCircle2 className="absolute top-3 right-3 w-4 h-4 text-primary" />
                      )}
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors mb-4",
                        selected ? "bg-primary/10" : "bg-gray-50"
                      )}>
                        <Icon className={cn("w-5 h-5", selected ? "text-primary" : "text-gray-400")} strokeWidth={1.5} />
                      </div>
                      <h4 className="text-sm font-medium text-gray-900">{opt.title}</h4>
                      <p className="text-xs text-gray-500 font-light mt-0.5">{opt.subtitle}</p>
                      <ul className="mt-3 space-y-1 flex-1">
                        {opt.bullets.map((b, i) => (
                          <li key={i} className="text-[11px] text-gray-500 font-light flex items-start gap-1.5">
                            <span className="text-gray-300 mt-0.5">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                      {opt.warning && (
                        <div className="mt-3 flex items-start gap-1.5 text-[10px] text-amber-700/80 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="font-light leading-snug">{opt.warning}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="p-6 pt-2 border-t border-gray-50 bg-white/40">
                <Button
                  onClick={() => pendingMode && handleConfirmAddInstance(pendingName, pendingMode)}
                  disabled={!pendingMode || actionLoading === 'create'}
                  className="w-full rounded-2xl h-12 font-medium shadow-sm"
                >
                  {actionLoading === 'create' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating QR...</>
                  ) : (
                    <>Continue<ArrowRight className="w-4 h-4 ml-2" /></>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* ── Step 1: Scanning QR ─────────────────────────────────────── */}
          {!preQrStep && modalStep === 'scanning' && (
            <div className="relative overflow-hidden">
              {/* Ambient gradient backdrop */}
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 pointer-events-none" />
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-200/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-teal-200/20 rounded-full blur-3xl pointer-events-none" />

              <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-0">
                {/* ── Left: instructions ──────────────────────────────── */}
                <div className="p-8 sm:pr-4 flex flex-col justify-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 self-start mb-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Waiting for scan</span>
                  </div>

                  <h3 className="text-2xl font-extralight text-gray-900 tracking-tight leading-tight">
                    Pair your<br />WhatsApp device
                  </h3>
                  <p className="text-xs text-gray-500 font-light mt-2 mb-6 max-w-[260px]">
                    Scan the code with your phone to securely link this device.
                  </p>

                  <ol className="space-y-3">
                    {[
                      'Open WhatsApp on your phone',
                      'Tap Settings, then Linked Devices',
                      'Tap "Link a Device" and scan the code',
                    ].map((txt, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className="shrink-0 w-6 h-6 rounded-full bg-white border border-emerald-100 shadow-sm flex items-center justify-center">
                          <span className="text-[10px] font-bold text-emerald-600">{i + 1}</span>
                        </div>
                        <span className="text-xs text-gray-600 font-light leading-relaxed pt-0.5">{txt}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* ── Right: QR card ──────────────────────────────────── */}
                <div className="p-8 sm:pl-4 flex items-center justify-center">
                  <div className="relative">
                    {/* Animated gradient ring */}
                    <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500 opacity-60 blur-md" />
                    <div className="relative bg-white p-4 rounded-[1.75rem] shadow-2xl border border-white">
                      {/* Corner brackets */}
                      <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-emerald-500 rounded-tl-xl" />
                      <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-emerald-500 rounded-tr-xl" />
                      <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-emerald-500 rounded-bl-xl" />
                      <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-emerald-500 rounded-br-xl" />

                      {qrCode ? (
                        <div className="relative">
                          <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 rounded-2xl" />
                          {/* WhatsApp logo center overlay */}
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-12 h-12 rounded-2xl bg-white shadow-lg border border-gray-100 flex items-center justify-center">
                              <FaWhatsapp className="w-7 h-7 text-[#25D366]" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-56 h-56 flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-white rounded-2xl">
                          <div className="relative">
                            <Loader2 className="h-10 w-10 animate-spin text-emerald-500 mb-3" />
                          </div>
                          <p className="text-gray-400 font-light text-xs uppercase tracking-widest mt-2">Generating</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Connected (brief transition) ───────────────────── */}
          {!preQrStep && modalStep === 'connected' && (
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
          {!preQrStep && modalStep === 'syncing' && (() => {
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
          {!preQrStep && modalStep === 'complete' && (
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
          {!preQrStep && modalStep === 'failed' && (
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
