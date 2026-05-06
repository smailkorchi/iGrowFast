import { useState, useEffect, useRef, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Smartphone, Phone, Loader2, QrCode, CheckCircle2, MessageSquare, ArrowRight, Users, MessageCircle, Database, AlertTriangle, Sparkles, ListChecks, ArrowLeft, type LucideIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';

// Untyped supabase client for whatsapp_* tables not yet in generated types.
// Column shapes used below are verified via MCP against the live schema.
const db = supabase as unknown as SupabaseClient;

// ── whatsapp_instances row (MCP-verified) ───────────────────────────────
type WaInstanceRow = {
  id: string;
  business_id: string;
  instance_name: string;
  status: string;
  phone_number: string | null;
  profile_pic: string | null;
  created_at: string;
  updated_at: string;
};

// ── Sync job phase/metadata shape (driven by the edge function contract) ──
type SyncPhaseProgress = {
  total?: number;
  processed?: number;
  detail?: string;
};

type SyncPhase = {
  status?: 'pending' | 'running' | 'completed' | 'failed' | string;
  progress?: SyncPhaseProgress;
};

type SyncMetadata = {
  messages_synced?: number;
  [k: string]: unknown;
};

// ── whatsapp_sync_jobs row (MCP-verified) ───────────────────────────────
type WaSyncJobRow = {
  id: string;
  business_id: string;
  instance_id: string;
  instance_name: string;
  status: string;
  current_phase: number;
  phases: SyncPhase[];
  phase_cursors: Record<string, unknown>;
  sync_metadata: SyncMetadata;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

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
  _phases?: SyncPhase[];
}

const defaultProgress: SyncProgress = { contacts: { total: 0, synced: 0 }, chats: { total: 0, synced: 0 }, messages: 0, jidMappings: 0, status: 'Preparing...' };

// ── Derive SyncProgress from server job phases + metadata ────────────────
function deriveSyncProgress(phases: SyncPhase[] | null | undefined, syncMetadata?: SyncMetadata | null): SyncProgress {
  if (!phases || phases.length === 0) return { ...defaultProgress };
  const contactsPhase = phases[0]; // contacts
  const chatsPhase = phases[1]; // chats_jid
  const messagesPhase = phases[6]; // messages
  const jidPhase = phases[1]; // chats_jid (includes mappings)

  // Find the currently running phase for status text
  const running = phases.find((p) => p.status === 'running');
  const lastCompleted = [...phases].reverse().find((p) => p.status === 'completed');
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
  const [instances, setInstances] = useState<WaInstanceRow[]>([]);
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
  // Ref latest syncStates so stable callbacks can read the current value
  // without recreating whenever syncStates changes.
  const syncStatesRef = useRef(syncStates);
  useEffect(() => { syncStatesRef.current = syncStates; }, [syncStates]);
  // Forward-ref for handleInstanceConnected so the poll effect (declared before the
  // callback) can invoke the latest version without creating a TDZ reference.
  const handleInstanceConnectedRef = useRef<((instanceName: string) => void) | null>(null);

  // ── Modal state (which instance is currently shown in the modal) ────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInstanceName, setModalInstanceName] = useState('');

  // Helpers to read/write per-instance sync state.
  // getSyncState reads current state (for render); updateSyncState is stable and uses
  // the functional setter so it never needs to re-run dependent callbacks.
  const getSyncState = (name: string): InstanceSyncState => syncStates[name] || {
    step: 'scanning', progress: { ...defaultProgress }, ownerProfile: { pic: null, phone: '', name: '' }, qrCode: null, background: false, jobId: null,
  };
  const defaultSyncState: InstanceSyncState = {
    step: 'scanning', progress: { ...defaultProgress }, ownerProfile: { pic: null, phone: '', name: '' }, qrCode: null, background: false, jobId: null,
  };
  const updateSyncState = useCallback((name: string, patch: Partial<InstanceSyncState>) => {
    setSyncStates(prev => ({ ...prev, [name]: { ...defaultSyncState, ...prev[name], ...patch } }));
    // defaultSyncState is a stable literal recreated each render but only read inside the
    // setter — it never causes stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        for (const job of jobs as WaSyncJobRow[]) {
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
          };
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
        table: 'wa_sync_jobs',
        filter: `business_id=eq.${businessId}`,
      }, (payload) => {
        const job = payload.new as WaSyncJobRow | undefined;
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
          },
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
          handleInstanceConnectedRef.current?.(modalInstanceName);
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
            handleInstanceConnectedRef.current?.(modalInstanceName);
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
  }, [modalStep, modalInstanceName, updateSyncState]);

  const fetchInstances = async () => {
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    const { data } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (data) {
      const rows = data as WaInstanceRow[];
      setInstances(rows);
      // Auto-heal webhooks on open instances
      for (const inst of rows) {
        if (inst.status === 'open') {
          whatsappService.findWebhook(inst.instance_name).then((wh: { enabled?: boolean } | null) => {
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
      let createRes: { qrcode?: { base64?: string | null } | null } | null = null;
      try {
        createRes = await whatsappService.createInstance(name);
      } catch (firstErr) {
        // If instance already exists on Evolution API (e.g. orphaned from previous delete), clean up and retry
        const msg = (firstErr instanceof Error ? firstErr.message : String(firstErr)).toLowerCase();
        if (msg.includes('forbidden') || msg.includes('already')) {
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
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
      toast({ title: "Connection Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
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
    const chosenMode = syncStatesRef.current[instanceName]?.importMode;

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
        toast({ title: 'Sync Error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      }
    }, 1500);
  }, [toast, updateSyncState]);
  useEffect(() => { handleInstanceConnectedRef.current = handleInstanceConnected; }, [handleInstanceConnected]);
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
      } catch (evoErr) {
        console.warn('Evolution delete attempt 1 failed:', evoErr instanceof Error ? evoErr.message : evoErr);
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
        await whatsappService.cancelSync((activeJob as { id: string }).id);
      }

      // Delete instance row (cascades: sync_jobs via FK)
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      // Clear sync state for this instance
      setSyncStates(prev => { const next = { ...prev }; delete next[instanceName]; return next; });
      toast({ title: "Deleted", description: "Instance and all data removed." });
      fetchInstances();
    } catch (err) {
      toast({ title: "Delete Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
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
        <div className="flex justify-between text-[11px]">
          <span className="text-ant-ink font-medium">{label}</span>
          <span className="text-ant-mid tabular-nums">{value}/{max}</span>
        </div>
        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
          <div
            className="h-full bg-ant-orange rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  // Derived summary counts for the editorial header strip
  const connectedCount = instances.filter((i) => i.status === 'open').length;
  const syncingCount = Object.values(syncStates).filter(
    (s) => s.background && (s.step === 'syncing' || s.step === 'connected'),
  ).length;
  const pendingCount = instances.length - connectedCount;

  return (
    <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
      {/* Editorial header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
            <span className="w-1 h-1 rounded-full bg-ant-orange" />
            Messaging · Devices
          </span>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ant-green/10 ring-1 ring-ant-green/25 shrink-0">
              <FaWhatsapp className="w-5 h-5 text-ant-green" />
            </span>
            <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
              WhatsApp devices
            </h1>
          </div>
          <p className="font-serif-display text-[13px] text-ant-muted italic">
            Paired phones feeding the inbox and automation layer.
          </p>
        </div>

        <Button
          onClick={openAddInstanceModal}
          className="rounded-full h-10 px-5 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add device
        </Button>
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
        <SummaryTile label="Total" value={instances.length} tone="ink" />
        <SummaryTile label="Connected" value={connectedCount} tone="green" />
        <SummaryTile
          label={syncingCount > 0 ? 'Syncing' : 'Pending'}
          value={syncingCount > 0 ? syncingCount : pendingCount}
          tone={syncingCount > 0 ? 'blue' : 'orange'}
        />
      </div>

      {/* Instance list — editorial row cards */}
      <div className="rounded-xl border border-ant-line bg-ant-paper overflow-hidden">
        {loading ? (
          <div className="divide-y divide-ant-line">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[72px] animate-pulse bg-ant-line-soft/40" />
            ))}
          </div>
        ) : instances.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-green/10 ring-1 ring-ant-green/20 mb-3">
              <FaWhatsapp className="w-5 h-5 text-ant-green" />
            </div>
            <p className="font-display text-[16px] font-semibold text-ant-ink tracking-tight">No devices yet</p>
            <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5">
              Link your first phone to start receiving messages here.
            </p>
            <Button
              onClick={openAddInstanceModal}
              className="rounded-full h-9 px-4 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add the first device
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-ant-line">
            {instances.map((inst) => {
              const isOpen = inst.status === 'open';
              const instSync = syncStates[inst.instance_name];
              const isSyncing = instSync?.background && (instSync.step === 'syncing' || instSync.step === 'connected');
              const syncPct = isSyncing && instSync
                ? Math.round(
                      ((instSync.progress.contacts.synced + instSync.progress.chats.synced) /
                          Math.max(instSync.progress.contacts.total + instSync.progress.chats.total, 1)) *
                          100,
                  )
                : 0;

              return (
                <li
                  key={inst.id}
                  className={cn(
                      'group grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-4 md:px-5 py-3.5 transition-colors hover:bg-ant-line-soft',
                      isSyncing && 'cursor-pointer',
                  )}
                  onClick={isSyncing ? () => handleReopenSyncModal(inst.instance_name) : undefined}
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-11 w-11 border border-ant-line">
                      <AvatarImage src={inst.profile_pic} />
                      <AvatarFallback className="bg-ant-line-soft text-ant-ink text-[11px] font-semibold">
                        {inst.instance_name.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      aria-hidden
                      className={cn(
                          'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-ant-paper',
                          isSyncing ? 'bg-ant-blue' : isOpen ? 'bg-ant-green' : 'bg-ant-orange',
                      )}
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-[14px] font-semibold text-ant-ink leading-tight truncate tracking-tight">
                        {inst.instance_name}
                      </h3>
                      <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full text-[9.5px] font-medium uppercase tracking-[0.18em] px-2 py-0.5',
                            isSyncing
                              ? 'bg-ant-blue/10 text-ant-blue'
                              : isOpen
                                ? 'bg-ant-green/10 text-ant-green'
                                : 'bg-ant-orange/10 text-ant-orange',
                        )}
                      >
                        {isSyncing ? (
                          <>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            Syncing {syncPct}%
                          </>
                        ) : isOpen ? (
                          <>
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Connected
                          </>
                        ) : (
                          <>
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            Pending
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-ant-muted">
                      {inst.phone_number ? (
                        <span className="flex items-center gap-1 tabular-nums">
                          <Phone className="w-2.5 h-2.5 text-ant-mid" />+{inst.phone_number}
                        </span>
                      ) : (
                        <span className="font-serif-display italic text-ant-mid">Unpaired · needs scan</span>
                      )}
                    </div>
                    {isSyncing && instSync && (
                      <div className="mt-2 max-w-md">
                        <div className="h-[3px] bg-ant-line rounded-full overflow-hidden">
                          <div
                            className="h-full bg-ant-blue rounded-full transition-all duration-700"
                            style={{ width: `${syncPct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-ant-blue truncate mt-1">{instSync.progress.status}</p>
                      </div>
                    )}
                  </div>

                  <div className="hidden md:block text-right shrink-0">
                    <div className="font-display text-[12px] font-semibold text-ant-ink tabular-nums leading-none tracking-tight">
                      {new Date(inst.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                      })}
                    </div>
                    <div className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid mt-1">
                      Paired
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isOpen && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-3 rounded-full border-ant-line text-ant-ink bg-ant-paper hover:bg-ant-line-soft text-[11px] font-medium"
                        disabled={actionLoading !== null}
                        onClick={() => fetchAndShowQR(inst.instance_name)}
                      >
                        {actionLoading === `qr-${inst.instance_name}` ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <QrCode className="w-3.5 h-3.5 mr-1.5 text-ant-orange" />
                        )}
                        Scan QR
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 rounded-full text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10"
                      disabled={actionLoading !== null}
                      onClick={() => confirmDeleteInstance(inst.id, inst.instance_name)}
                      title="Remove device"
                    >
                      {actionLoading === `delete-${inst.instance_name}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
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
          "ant-surface p-0 overflow-hidden bg-ant-paper border-ant-line rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]",
          preQrStep === 'mode' ? "sm:max-w-3xl" : (!preQrStep && modalStep === 'scanning' ? "sm:max-w-2xl" : "sm:max-w-md")
        )}>

          {/* ── Pre-QR Step A: Name ─────────────────────────────────────── */}
          {preQrStep === 'name' && (
            <>
              <div className="p-8 text-center border-b border-ant-line">
                <DialogHeader>
                  <div className="mx-auto inline-flex items-center justify-center w-11 h-11 rounded-xl bg-ant-green/10 ring-1 ring-ant-green/25 mb-4">
                    <FaWhatsapp className="w-5 h-5 text-ant-green" />
                  </div>
                  <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink text-center tracking-tight">
                    Add a WhatsApp device
                  </DialogTitle>
                  <DialogDescription className="font-serif-display text-center pt-2 text-[13px] text-ant-muted italic">
                    Choose a unique label to identify this device in your inbox.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="p-7 space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Device name</label>
                  <Input
                    autoFocus
                    placeholder="e.g. Sales-Number-1"
                    value={pendingName}
                    onChange={(e) => setPendingName(e.target.value.replace(/\s+/g, '-'))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && pendingName.trim()) setPreQrStep('mode'); }}
                    className="h-11 text-[13px] rounded-xl bg-ant-paper border-ant-line text-ant-ink focus-visible:ring-ant-orange focus-visible:ring-offset-0"
                  />
                </div>
                <Button
                  onClick={() => setPreQrStep('mode')}
                  disabled={!pendingName.trim()}
                  className="w-full rounded-full h-11 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
                >
                  Continue
                  <ArrowRight className="w-3.5 h-3.5 ml-2" />
                </Button>
              </div>
            </>
          )}

          {/* ── Pre-QR Step B: Import Mode ──────────────────────────────── */}
          {preQrStep === 'mode' && (
            <>
              <div className="p-8 text-center border-b border-ant-line relative">
                <button
                  onClick={() => setPreQrStep('name')}
                  className="absolute left-5 top-5 w-9 h-9 rounded-full bg-ant-paper hover:bg-ant-line-soft border border-ant-line flex items-center justify-center transition-colors"
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4 text-ant-ink" />
                </button>
                <DialogHeader>
                  <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink text-center tracking-tight">
                    Import strategy
                  </DialogTitle>
                  <DialogDescription className="font-serif-display text-center pt-2 text-[13px] text-ant-muted italic">
                    Pick how much WhatsApp history to bring into <span className="not-italic font-medium text-ant-ink">{pendingName}</span>.
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
                        "relative h-full text-left rounded-2xl border p-5 transition-all active:scale-[0.98] flex flex-col",
                        selected
                          ? "border-ant-orange/50 ring-2 ring-ant-orange/20 bg-ant-orange/[0.03]"
                          : "border-ant-line bg-ant-paper hover:border-ant-ink/20"
                      )}
                    >
                      {selected && (
                        <CheckCircle2 className="absolute top-3 right-3 w-4 h-4 text-ant-orange" />
                      )}
                      <div className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center transition-colors mb-3",
                        selected ? "bg-ant-orange/15" : "bg-ant-line-soft"
                      )}>
                        <Icon className={cn("w-5 h-5", selected ? "text-ant-orange" : "text-ant-mid")} strokeWidth={1.5} />
                      </div>
                      <h4 className="font-display text-[14px] font-semibold text-ant-ink tracking-tight">{opt.title}</h4>
                      <p className="font-serif-display text-[11.5px] text-ant-muted italic mt-0.5">{opt.subtitle}</p>
                      <ul className="mt-3 space-y-1.5 flex-1">
                        {opt.bullets.map((b, i) => (
                          <li key={i} className="text-[11px] text-ant-muted flex items-start gap-1.5">
                            <span className="text-ant-orange mt-0.5">·</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                      {opt.warning && (
                        <div className="mt-3 flex items-start gap-1.5 text-[10px] text-ant-orange bg-ant-orange/10 border border-ant-orange/25 rounded-lg px-2.5 py-1.5">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="leading-snug">{opt.warning}</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="p-6 pt-2 border-t border-ant-line">
                <Button
                  onClick={() => pendingMode && handleConfirmAddInstance(pendingName, pendingMode)}
                  disabled={!pendingMode || actionLoading === 'create'}
                  className="w-full rounded-full h-11 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
                >
                  {actionLoading === 'create' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating QR…</>
                  ) : (
                    <>Continue<ArrowRight className="w-3.5 h-3.5 ml-2" /></>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* ── Step 1: Scanning QR ─────────────────────────────────────── */}
          {!preQrStep && modalStep === 'scanning' && (
            <div className="relative overflow-hidden bg-ant-paper">
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ant-orange/40 to-transparent"
              />

              <div className="relative grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-0">
                {/* ── Left: instructions ──────────────────────────────── */}
                <div className="p-8 sm:pr-4 flex flex-col justify-center">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ant-green/10 border border-ant-green/25 self-start mb-4">
                    <span className="relative inline-flex">
                      <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
                      <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-ant-green animate-ping" />
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-green">Waiting for scan</span>
                  </div>

                  <h3 className="font-display text-[26px] md:text-[30px] font-semibold text-ant-ink tracking-[-0.02em] leading-[1.05]">
                    Pair your<br />WhatsApp device.
                  </h3>
                  <p className="font-serif-display text-[13px] text-ant-muted italic mt-2 mb-6 max-w-[280px]">
                    Scan the code with your phone to securely link this device.
                  </p>

                  <ol className="space-y-3">
                    {[
                      'Open WhatsApp on your phone',
                      'Tap Settings, then Linked Devices',
                      'Tap "Link a Device" and scan the code',
                    ].map((txt, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className="shrink-0 w-7 h-7 rounded-full bg-ant-paper border border-ant-line flex items-center justify-center">
                          <span className="font-display text-[11px] font-semibold text-ant-orange tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                        </div>
                        <span className="text-[12px] text-ant-ink leading-relaxed pt-1">{txt}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* ── Right: QR card ──────────────────────────────────── */}
                <div className="p-8 sm:pl-4 flex items-center justify-center">
                  <div className="relative bg-ant-paper p-4 rounded-2xl border border-ant-line shadow-[0_12px_40px_-20px_rgba(20,20,19,0.3)]">
                    {/* Corner brackets */}
                    <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-ant-orange rounded-tl-xl" />
                    <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-ant-orange rounded-tr-xl" />
                    <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-ant-orange rounded-bl-xl" />
                    <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-ant-orange rounded-br-xl" />

                    {qrCode ? (
                      <div className="relative">
                        <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 rounded-xl" />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 rounded-xl bg-ant-paper shadow-md border border-ant-line flex items-center justify-center">
                            <FaWhatsapp className="w-7 h-7 text-ant-green" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="w-56 h-56 flex flex-col items-center justify-center bg-ant-light rounded-xl">
                        <Loader2 className="h-9 w-9 animate-spin text-ant-orange mb-3" />
                        <p className="text-ant-mid text-[10px] font-medium uppercase tracking-[0.22em] mt-2">Generating</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Connected (brief transition) ───────────────────── */}
          {!preQrStep && modalStep === 'connected' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="relative mb-5">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-ant-green/20" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-ant-green/10 flex items-center justify-center ring-4 ring-ant-green/20">
                    <CheckCircle2 className="w-10 h-10 text-ant-green" strokeWidth={1.5} />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-ant-green rounded-full flex items-center justify-center ring-4 ring-ant-paper">
                  <CheckCircle2 className="w-4 h-4 text-white" strokeWidth={2.5} />
                </div>
              </div>
              <h3 className="font-display text-[22px] font-semibold text-ant-ink tracking-tight mb-1">Connected</h3>
              {ownerProfile.phone && (
                <p className="text-[12px] text-ant-muted tabular-nums">+{ownerProfile.phone}</p>
              )}
              <p className="font-serif-display text-[12px] text-ant-muted italic mt-4">Starting data sync…</p>
              <Loader2 className="w-4 h-4 text-ant-orange animate-spin mt-2" />
            </div>
          )}

          {/* ── Step 3: Syncing ────────────────────────────────────────── */}
          {!preQrStep && modalStep === 'syncing' && (() => {
            // Extract phase data from the sync job for detailed display
            const jobState = syncStates[modalInstanceName];
            const phases: SyncPhase[] = jobState?._phases || [];
            const phaseLabels = ['Contacts', 'Chats & JID', 'Groups', 'Labels', 'Conversations', 'Profile Pics', 'Messages', 'Name Backfill'];
            const completedCount = phases.filter((p) => p?.status === 'completed').length;
            const overallPct = phases.length > 0 ? Math.round((completedCount / phases.length) * 100) : 0;

            return (
            <div className="p-7 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-5">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-ant-line" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-ant-green/10 flex items-center justify-center ring-2 ring-ant-green/20">
                    <Database className="w-5 h-5 text-ant-green" strokeWidth={1.75} />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-display text-[16px] font-semibold text-ant-ink tracking-tight truncate">{ownerProfile.name || modalInstanceName}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Loader2 className="w-3 h-3 text-ant-orange animate-spin" />
                    <span className="text-[11px] text-ant-orange font-medium truncate">{syncProgress.status}</span>
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
                    <div key={i} className="flex items-center gap-3 text-[11.5px]">
                      {status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-ant-green shrink-0" strokeWidth={2} />
                      ) : status === 'running' ? (
                        <Loader2 className="w-4 h-4 text-ant-orange animate-spin shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-ant-line shrink-0" />
                      )}
                      <span className={cn("font-medium", status === 'completed' ? 'text-ant-muted' : status === 'running' ? 'text-ant-ink' : 'text-ant-mid')}>
                        {label}
                      </span>
                      {status !== 'pending' && detail && (
                        <span className="text-ant-mid ml-auto tabular-nums truncate max-w-[140px]">{detail}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Overall progress bar */}
              <div className="pt-3 border-t border-ant-line">
                <div className="flex justify-between text-[10px] text-ant-mid mb-1.5 uppercase tracking-[0.18em] font-medium">
                  <span className="tabular-nums">{completedCount}/{phases.length || 8} phases</span>
                  <span className="tabular-nums">{overallPct}%</span>
                </div>
                <div className="h-2 bg-ant-line rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ant-orange rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
              </div>

              <Button
                variant="outline"
                onClick={handleSyncInBackground}
                className="w-full mt-4 rounded-full h-10 text-ant-ink bg-ant-paper border-ant-line hover:bg-ant-line-soft text-[11.5px] font-medium"
              >
                Continue in background
              </Button>
            </div>
            );
          })()}

          {/* ── Step 4: Complete ───────────────────────────────────────── */}
          {!preQrStep && modalStep === 'complete' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="relative mb-5">
                {ownerProfile.pic ? (
                  <img src={ownerProfile.pic} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-ant-green/20" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-ant-green/10 flex items-center justify-center ring-4 ring-ant-green/20">
                    <CheckCircle2 className="w-10 h-10 text-ant-green" strokeWidth={1.5} />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-ant-green rounded-full flex items-center justify-center ring-4 ring-ant-paper">
                  <CheckCircle2 className="w-4 h-4 text-white" strokeWidth={2.5} />
                </div>
              </div>

              <h3 className="font-display text-[22px] font-semibold text-ant-ink tracking-tight mb-1">All set</h3>
              {ownerProfile.phone && (
                <p className="text-[12px] text-ant-muted tabular-nums mb-6">+{ownerProfile.phone}</p>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-px w-full mb-6 bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <CompleteStat icon={Users} label="Contacts" value={syncProgress.contacts.synced} />
                <CompleteStat icon={MessageCircle} label="Chats" value={syncProgress.chats.synced} />
                <CompleteStat icon={Database} label="Messages" value={syncProgress.messages} />
              </div>

              <Button
                onClick={() => { handleCloseModal(); navigate('/business/whatsapp/inbox'); }}
                className="w-full rounded-full h-11 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
              >
                Open inbox
                <ArrowRight className="w-3.5 h-3.5 ml-2" />
              </Button>
            </div>
          )}

          {/* ── Step 5: Failed ────────────────────────────────────────── */}
          {!preQrStep && modalStep === 'failed' && (
            <div className="p-10 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
              <div className="w-16 h-16 rounded-full bg-ant-rose/10 flex items-center justify-center mb-4 ring-4 ring-ant-rose/15">
                <AlertTriangle className="w-7 h-7 text-ant-rose" strokeWidth={1.75} />
              </div>
              <h3 className="font-display text-[22px] font-semibold text-ant-ink tracking-tight mb-1">Sync failed</h3>
              <p className="font-serif-display text-[12px] text-ant-muted italic mb-4 text-center">{syncProgress.status}</p>

              {/* Partial stats */}
              <div className="grid grid-cols-3 gap-px w-full mb-6 bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <CompleteStat icon={Users} label="Contacts" value={syncProgress.contacts.synced} muted />
                <CompleteStat icon={MessageCircle} label="Chats" value={syncProgress.chats.synced} muted />
                <CompleteStat icon={Database} label="Messages" value={syncProgress.messages} muted />
              </div>

              <Button
                onClick={async () => {
                  const jobId = currentSync.jobId;
                  if (jobId) {
                    await whatsappService.retrySync(jobId);
                    updateSyncState(modalInstanceName, { step: 'syncing' });
                  }
                }}
                className="w-full rounded-full h-11 bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium"
              >
                Retry sync
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ─────────────────────────────────── */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="ant-surface sm:max-w-[420px] p-0 overflow-hidden bg-ant-paper border-ant-line rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]">
          <div className="p-7 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-ant-rose/10 ring-1 ring-ant-rose/20 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5 text-ant-rose" strokeWidth={1.75} />
            </div>
            <DialogHeader>
              <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-tight text-center">Remove {deleteConfirm?.name}?</DialogTitle>
              <DialogDescription className="font-serif-display text-center pt-2 text-ant-muted italic text-[12.5px]">
                This will permanently delete the device and all associated data. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {deleteConfirm?.loading ? (
              <div className="flex items-center gap-2 mt-5">
                <Loader2 className="w-4 h-4 animate-spin text-ant-orange" />
                <span className="text-[12px] text-ant-muted font-serif-display italic">Calculating data…</span>
              </div>
            ) : deleteConfirm?.counts && (
              <div className="w-full mt-5 rounded-xl border border-ant-line bg-ant-light px-4 py-3 space-y-1.5">
                <p className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1">Data that will be lost</p>
                {[
                  { label: 'Contacts', count: deleteConfirm.counts.contacts, icon: Users },
                  { label: 'Messages', count: deleteConfirm.counts.messages, icon: MessageCircle },
                  { label: 'Conversations', count: deleteConfirm.counts.conversations, icon: MessageSquare },
                  { label: 'Groups', count: deleteConfirm.counts.groups, icon: Users },
                  { label: 'Labels', count: deleteConfirm.counts.labels, icon: Database },
                ].filter(i => i.count > 0).map(item => (
                  <div key={item.label} className="flex items-center justify-between text-[11.5px]">
                    <span className="flex items-center gap-2 text-ant-muted">
                      <item.icon className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                      {item.label}
                    </span>
                    <span className="font-display font-semibold text-ant-ink tabular-nums">{item.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 w-full mt-5">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-full h-10 border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-line-soft font-medium text-[11.5px]"
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
                className="flex-1 rounded-full h-10 font-medium text-[11.5px] bg-ant-rose hover:bg-ant-rose/90"
              >
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                Delete permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Completion/failure screen stat cell. Matches the summary-strip styling so
// the three mini-stats (contacts, chats, messages) feel like a single row.
function CompleteStat({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="bg-ant-paper px-3 py-3 text-center">
      <Icon className={cn('w-3.5 h-3.5 mx-auto mb-1', muted ? 'text-ant-mid' : 'text-ant-green')} strokeWidth={1.75} />
      <p className="font-display text-[17px] font-semibold text-ant-ink tabular-nums leading-none tracking-[-0.02em]">
        {value.toLocaleString('en-US')}
      </p>
      <p className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.2em] mt-1.5">{label}</p>
    </div>
  );
}

// Compact summary cell used in the editorial stats strip above the device list.
function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ink' | 'green' | 'orange' | 'blue';
}) {
  const accent =
    tone === 'green' ? 'bg-ant-green' :
    tone === 'orange' ? 'bg-ant-orange' :
    tone === 'blue' ? 'bg-ant-blue' :
    'bg-ant-ink';
  return (
    <div className="bg-ant-paper px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={cn('w-1 h-1 rounded-full', accent)} aria-hidden />
        <span className="text-[9.5px] uppercase tracking-[0.22em] font-medium text-ant-mid">{label}</span>
      </div>
      <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] mt-1 leading-none">
        {value.toLocaleString('en-US')}
      </div>
    </div>
  );
}
