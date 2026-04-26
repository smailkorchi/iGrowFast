import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertCircle,
  BrainCircuit,
  Cpu,
  KeyRound,
  Loader2,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────
interface ProviderKey {
  provider_id: string;
  status: 'active' | 'paused' | 'exhausted' | 'invalid';
  monthly_cap_usd: number;
  spent_this_month_usd: number;
  last_reset_at: string;
  last_probe_at: string | null;
  last_probe_ok: boolean | null;
  last_probe_error: string | null;
}

interface ProviderRow {
  id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
  key?: ProviderKey | null;
}

interface ModelRow {
  id: string;
  provider_id: string;
  role: string;
  model_id: string;
  display_name: string;
  context_window: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  audio_cost_per_minute: number | null;
  is_active: boolean;
  notes: string | null;
}

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  default_safety_tier: string;
  requires_write_db: boolean;
  deprecated: boolean;
}

interface BusinessHealth {
  business_id: string;
  business_name: string;
  default_mode: string | null;
  business_monthly_cap_usd: number;
  business_spent_this_month_usd: number;
  business_quota_status: string | null;
  pending_reviews: number;
  last_decision_at: string | null;
  error_rate_7d: number | null;
  live_skills_count: number;
}

interface JailbreakRow {
  id: string;
  pattern: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high';
  action: 'log' | 'escalate' | 'block';
  is_active: boolean;
}

interface RedactionRow {
  id: string;
  business_id: string | null;
  pattern: string;
  placeholder_kind: string;
  is_active: boolean;
  priority: number;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────
const fmtUsd = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;
const pct = (a: number, b: number) => (!b || b <= 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));
const timeAgo = (iso: string | null) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────
export default function OwnerAIConsole() {
  return (
    <div className="ant-surface space-y-5">
      <Header />
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="bg-ant-paper border border-ant-line rounded-xl p-1 h-auto inline-flex flex-wrap">
          {[
            { v: 'overview',   label: 'Overview' },
            { v: 'providers',  label: 'Providers' },
            { v: 'models',     label: 'Models' },
            { v: 'skills',     label: 'Skills' },
            { v: 'safety',     label: 'Safety' },
            { v: 'businesses', label: 'Businesses' },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-ant-mid data-[state=active]:bg-ant-ink data-[state=active]:text-ant-paper transition-colors"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="models"><ModelsTab /></TabsContent>
        <TabsContent value="skills"><SkillsTab /></TabsContent>
        <TabsContent value="safety"><SafetyTab /></TabsContent>
        <TabsContent value="businesses"><BusinessesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-ant-orange/10 ring-1 ring-ant-orange/20 flex items-center justify-center">
          <BrainCircuit className="w-5 h-5 text-ant-orange" />
        </div>
        <div>
          <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid">DigiCom AI · platform</p>
          <h1 className="font-display text-[20px] font-semibold text-ant-ink leading-tight">AI Platform</h1>
          <p className="font-serif-display italic text-[12px] text-ant-mid mt-0.5">
            Provider keys, model catalog, skill catalog, safety rules — applied across all businesses.
          </p>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// OVERVIEW
// ──────────────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data: keys } = useQuery<ProviderKey[]>({
    queryKey: ['owner-ai-platform-keys-summary'],
    queryFn: async () => {
      const { data } = await supabase.from('ai_platform_keys').select('*');
      return (data || []) as ProviderKey[];
    },
    refetchInterval: 30_000,
  });
  const { data: businesses } = useQuery<BusinessHealth[]>({
    queryKey: ['owner-ai-businesses-summary'],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('ai_business_health')
        .select('business_id, default_mode, business_monthly_cap_usd, business_spent_this_month_usd, business_quota_status, pending_reviews, last_decision_at, error_rate_7d, live_skills_count');
      const ids = (rows || []).map((r: any) => r.business_id);
      const { data: names } = await supabase.from('businesses').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const nameMap = new Map((names || []).map((n: any) => [n.id, n.name]));
      return (rows || []).map((r: any) => ({ ...r, business_name: nameMap.get(r.business_id) || '—' }));
    },
    refetchInterval: 30_000,
  });

  const totalCap = (keys || []).reduce((s, k) => s + Number(k.monthly_cap_usd || 0), 0);
  const totalSpent = (keys || []).reduce((s, k) => s + Number(k.spent_this_month_usd || 0), 0);
  const platOk = (keys || []).every((k) => k.status === 'active');
  const liveBiz = (businesses || []).filter((b) => b.default_mode && b.default_mode !== 'off').length;
  const totalDecisions = (businesses || []).reduce((s, b) => s + (b.last_decision_at ? 1 : 0), 0);
  const escalating = (businesses || []).filter((b) => (b.error_rate_7d ?? 0) > 0.1).length;

  if (!keys || !businesses) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card>
        <Kicker>Platform spend</Kicker>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-display text-[28px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em]">{fmtUsd(totalSpent)}</span>
          <span className="text-[11px] text-ant-muted">of {fmtUsd(totalCap)}</span>
        </div>
        <ProgressBar pct={pct(totalSpent, totalCap)} accent={pct(totalSpent, totalCap) >= 90 ? '#c96356' : '#6a9bcc'} />
        <p className="mt-2 text-[10.5px] text-ant-muted flex items-center gap-1">
          {platOk ? <><ShieldCheck className="w-3 h-3 text-ant-green" /> All keys active</> : <><AlertCircle className="w-3 h-3 text-ant-rose" /> One or more keys paused / exhausted</>}
        </p>
      </Card>
      <Card>
        <Kicker>Active businesses</Kicker>
        <p className="font-display text-[28px] font-semibold text-ant-ink tabular-nums mt-1.5">{liveBiz}</p>
        <p className="text-[10.5px] text-ant-muted">of {businesses.length} configured</p>
      </Card>
      <Card>
        <Kicker>Businesses with errors (7d)</Kicker>
        <p className={`font-display text-[28px] font-semibold tabular-nums mt-1.5 ${escalating > 0 ? 'text-ant-rose' : 'text-ant-ink'}`}>{escalating}</p>
        <p className="text-[10.5px] text-ant-muted">error rate &gt; 10%</p>
      </Card>

      <Card className="md:col-span-3">
        <div className="flex items-center justify-between mb-2">
          <Kicker>Per-business state</Kicker>
          <span className="text-[10.5px] text-ant-muted">{businesses.length} businesses</span>
        </div>
        {businesses.length === 0 ? (
          <p className="font-serif-display italic text-[11px] text-ant-muted py-4">No businesses configured yet.</p>
        ) : (
          <div className="divide-y divide-ant-line">
            {businesses.map((b) => (
              <div key={b.business_id} className="grid grid-cols-[1.5fr_60px_120px_80px_80px_60px] gap-2 py-2.5 items-center text-[11.5px]">
                <span className="font-medium text-ant-ink truncate">{b.business_name}</span>
                <ModeBadge mode={(b.default_mode as any) ?? 'off'} />
                <span className="text-ant-mid tabular-nums">
                  {fmtUsd(b.business_spent_this_month_usd)} / {fmtUsd(b.business_monthly_cap_usd)}
                </span>
                <span className={`tabular-nums ${(b.error_rate_7d ?? 0) > 0.1 ? 'text-ant-rose' : 'text-ant-mid'}`}>
                  {Math.round((b.error_rate_7d ?? 0) * 100)}% err
                </span>
                <span className="text-ant-muted">{b.live_skills_count} live</span>
                <span className="text-ant-muted text-right">{timeAgo(b.last_decision_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// PROVIDERS — keys / status / rotation flow
// ──────────────────────────────────────────────────────────────────────
function ProvidersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingCap, setEditingCap] = useState<{ provider_id: string; current: number } | null>(null);
  const [rotating, setRotating] = useState<{ provider_id: string; provider_slug: string } | null>(null);

  const { data: rows, isLoading } = useQuery<ProviderRow[]>({
    queryKey: ['owner-ai-providers'],
    queryFn: async () => {
      const { data: provs } = await supabase
        .from('ai_providers')
        .select('id, slug, display_name, is_active')
        .order('slug', { ascending: true });
      const { data: keys } = await supabase.from('ai_platform_keys').select('*');
      const km = new Map((keys || []).map((k: any) => [k.provider_id, k]));
      return (provs || []).map((p: any) => ({ ...p, key: km.get(p.id) ?? null })) as ProviderRow[];
    },
  });

  const setCap = useMutation({
    mutationFn: async ({ provider_id, cap }: { provider_id: string; cap: number }) => {
      const { error } = await supabase
        .from('ai_platform_keys')
        .update({ monthly_cap_usd: cap, updated_at: new Date().toISOString() })
        .eq('provider_id', provider_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-ai-providers'] });
      toast({ title: 'Updated', description: 'Monthly cap saved.' });
      setEditingCap(null);
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ provider_id, status }: { provider_id: string; status: ProviderKey['status'] }) => {
      const { error } = await supabase
        .from('ai_platform_keys')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('provider_id', provider_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-ai-providers'] });
      toast({ title: 'Status updated' });
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      <Card>
        <Kicker>Provider keys</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Platform-level credentials. Encrypted in Supabase Vault. Rotation happens via SQL Editor — keys never pass through this UI.
        </p>
      </Card>

      <Card>
        <div className="divide-y divide-ant-line">
          {(rows || []).map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_120px_140px_100px_180px] gap-3 py-3 items-center">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-ant-mid" />
                  <p className="text-[12.5px] font-medium text-ant-ink">{p.display_name}</p>
                  <span className="text-[10px] text-ant-muted">({p.slug})</span>
                </div>
                <p className="text-[10.5px] text-ant-muted mt-0.5">
                  {p.key ? (
                    <>last reset {p.key.last_reset_at ? new Date(p.key.last_reset_at).toLocaleDateString() : '—'}</>
                  ) : (
                    <span className="font-serif-display italic">no key configured — rotate to add</span>
                  )}
                </p>
              </div>
              <KeyStatusPill status={p.key?.status ?? 'invalid'} hasKey={!!p.key} />
              <span className="text-[11.5px] tabular-nums text-ant-mid">
                {p.key ? <>{fmtUsd(p.key.spent_this_month_usd)} / {fmtUsd(p.key.monthly_cap_usd)}</> : '—'}
              </span>
              <Button
                size="sm" variant="ghost"
                disabled={!p.key}
                onClick={() => p.key && setEditingCap({ provider_id: p.id, current: Number(p.key.monthly_cap_usd) })}
                className="text-[11px] h-7 rounded-full"
              >
                <Pencil className="w-3 h-3 mr-1" /> Edit cap
              </Button>
              <div className="flex items-center justify-end gap-1.5">
                {p.key?.status === 'paused' || p.key?.status === 'exhausted' ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ provider_id: p.id, status: 'active' })} className="text-[11px] h-7 rounded-full text-ant-green hover:text-ant-green/80">
                    Resume
                  </Button>
                ) : p.key?.status === 'active' ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ provider_id: p.id, status: 'paused' })} className="text-[11px] h-7 rounded-full text-ant-orange hover:text-ant-orange/80">
                    Pause
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => setRotating({ provider_id: p.id, provider_slug: p.slug })} className="text-[11px] h-7 rounded-full bg-ant-ink text-ant-paper hover:bg-ant-ink/90">
                  Rotate
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {editingCap && (
        <CapDialog
          providerId={editingCap.provider_id}
          current={editingCap.current}
          onClose={() => setEditingCap(null)}
          onSubmit={(cap) => setCap.mutate({ provider_id: editingCap.provider_id, cap })}
          saving={setCap.isPending}
        />
      )}
      {rotating && (
        <RotateKeyDialog
          providerId={rotating.provider_id}
          providerSlug={rotating.provider_slug}
          onClose={() => setRotating(null)}
        />
      )}
    </div>
  );
}

function KeyStatusPill({ status, hasKey }: { status: string; hasKey: boolean }) {
  if (!hasKey) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] uppercase tracking-[0.16em] font-semibold bg-ant-line-soft text-ant-mid"><ShieldOff className="w-3 h-3" /> none</span>;
  }
  const map: Record<string, { cls: string; icon: any }> = {
    active:    { cls: 'bg-ant-green/10 text-ant-green ring-1 ring-ant-green/20',    icon: ShieldCheck },
    paused:    { cls: 'bg-ant-orange/10 text-ant-orange ring-1 ring-ant-orange/20', icon: ShieldOff },
    exhausted: { cls: 'bg-ant-rose/10 text-ant-rose ring-1 ring-ant-rose/20',       icon: ShieldAlert },
    invalid:   { cls: 'bg-ant-rose/10 text-ant-rose ring-1 ring-ant-rose/20',       icon: ShieldAlert },
  };
  const m = map[status] || map.invalid;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] uppercase tracking-[0.16em] font-semibold ${m.cls}`}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

function CapDialog({ providerId, current, onClose, onSubmit, saving }: { providerId: string; current: number; onClose: () => void; onSubmit: (cap: number) => void; saving: boolean }) {
  const [val, setVal] = useState<number>(current);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[16px]">Set monthly cap</DialogTitle>
          <DialogDescription className="font-serif-display italic text-[12px] text-ant-mid">
            Hard ceiling for this provider's spend across all businesses. When crossed, the provider auto-pauses until next month.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-[11px] text-ant-mid">Cap (USD)</p>
          <Input type="number" step="0.50" min={0} value={val} onChange={(e) => setVal(Number(e.target.value))} />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="rounded-full h-9">Cancel</Button>
          <Button onClick={() => onSubmit(val)} disabled={saving || val < 0} className="rounded-full h-9 bg-ant-ink text-ant-paper">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RotateKeyDialog({ providerId: _providerId, providerSlug, onClose }: { providerId: string; providerSlug: string; onClose: () => void }) {
  const sql = `-- Run inside Supabase Dashboard → SQL Editor.
-- Replace PASTE_NEW_KEY_HERE, then Run. The plaintext key never leaves your browser.
DO $$
DECLARE
  v_provider_id uuid;
  v_secret_id   uuid;
  v_new_key     text := 'PASTE_NEW_KEY_HERE';
BEGIN
  SELECT id INTO v_provider_id FROM public.ai_providers WHERE slug = '${providerSlug}';
  v_secret_id := vault.create_secret(v_new_key, 'ai_platform_${providerSlug}_' || extract(epoch from now())::text);
  INSERT INTO public.ai_platform_keys (provider_id, secret_id, monthly_cap_usd, status)
  VALUES (v_provider_id, v_secret_id, 8.00, 'active')
  ON CONFLICT (provider_id) DO UPDATE
    SET secret_id = EXCLUDED.secret_id,
        status    = 'active',
        last_probe_at = NULL,
        last_probe_ok = NULL,
        last_probe_error = NULL,
        updated_at = now();
END $$;`;
  const copy = () => navigator.clipboard.writeText(sql);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[16px] flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-ant-orange" /> Rotate {providerSlug} key
          </DialogTitle>
          <DialogDescription className="font-serif-display italic text-[12px] text-ant-mid">
            For security, plaintext keys never pass through this UI. Copy the SQL below, paste it into Supabase SQL Editor in your browser, replace the placeholder with the rotated key, and run it.
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-ant-line-soft border border-ant-line rounded-lg p-3 text-[10.5px] overflow-x-auto whitespace-pre-wrap font-mono text-ant-ink">{sql}</pre>
        <div className="flex items-center justify-between pt-1">
          <a
            href="https://supabase.com/dashboard/project/zjkqprrfbibjoslvlmxf/sql/new"
            target="_blank" rel="noreferrer"
            className="text-[11px] text-ant-orange hover:underline"
          >
            Open SQL Editor ↗
          </a>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="rounded-full h-9">Close</Button>
            <Button onClick={copy} className="rounded-full h-9 bg-ant-ink text-ant-paper">Copy SQL</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────
// MODELS — read-only catalog viewer + per-row activate toggle
// ──────────────────────────────────────────────────────────────────────
function ModelsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows, isLoading } = useQuery<ModelRow[]>({
    queryKey: ['owner-ai-models'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_models')
        .select('*')
        .order('role', { ascending: true })
        .order('display_name', { ascending: true });
      return (data || []) as ModelRow[];
    },
  });

  const setActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('ai_models').update({ is_active, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-ai-models'] });
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <Kicker>Model catalog</Kicker>
        <span className="text-[10.5px] text-ant-muted">{rows?.length ?? 0} models</span>
      </div>
      <div className="divide-y divide-ant-line">
        {(rows || []).map((m) => (
          <div key={m.id} className="grid grid-cols-[80px_1fr_120px_120px_60px] gap-2 py-2.5 items-center text-[11.5px]">
            <span className="text-[9.5px] uppercase tracking-[0.16em] text-ant-mid font-semibold">{m.role}</span>
            <div>
              <p className="font-medium text-ant-ink flex items-center gap-1.5"><Cpu className="w-3 h-3 text-ant-mid" /> {m.display_name}</p>
              <p className="text-[10px] text-ant-muted">{m.model_id}</p>
            </div>
            <span className="text-ant-mid tabular-nums">
              {m.input_cost_per_1m != null ? `$${m.input_cost_per_1m}/M in` : '—'}
            </span>
            <span className="text-ant-mid tabular-nums">
              {m.output_cost_per_1m != null ? `$${m.output_cost_per_1m}/M out` : (m.audio_cost_per_minute != null ? `$${m.audio_cost_per_minute}/min` : '—')}
            </span>
            <button
              onClick={() => setActive.mutate({ id: m.id, is_active: !m.is_active })}
              className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                m.is_active ? 'bg-ant-green/10 text-ant-green ring-1 ring-ant-green/20' : 'bg-ant-line-soft text-ant-mid'
              }`}
            >
              {m.is_active ? 'live' : 'off'}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SKILLS — global catalog (read-only for now; deprecate toggle)
// ──────────────────────────────────────────────────────────────────────
function SkillsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows, isLoading } = useQuery<SkillRow[]>({
    queryKey: ['owner-ai-skills'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_skills')
        .select('id, slug, name, description, category, default_safety_tier, requires_write_db, deprecated')
        .order('category', { ascending: true })
        .order('name',     { ascending: true });
      return (data || []) as SkillRow[];
    },
  });

  const setDeprecated = useMutation({
    mutationFn: async ({ id, deprecated }: { id: string; deprecated: boolean }) => {
      const { error } = await supabase.from('ai_skills').update({ deprecated, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-ai-skills'] }),
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const grouped = useMemo(() => {
    const m: Record<string, SkillRow[]> = {};
    (rows || []).forEach((r) => { (m[r.category] ||= []).push(r); });
    return m;
  }, [rows]);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      <Card>
        <Kicker>Skill catalog</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Global capability list available to every business. Deprecated skills disappear from admin UIs.
        </p>
      </Card>
      {Object.entries(grouped).map(([cat, items]) => (
        <Card key={cat}>
          <p className="text-[9.5px] uppercase tracking-[0.2em] text-ant-mid font-semibold mb-2">{cat}</p>
          <div className="divide-y divide-ant-line">
            {items.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto_60px] gap-2 py-2.5 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ant-ink truncate">{s.name}</p>
                    <SafetyBadge tier={s.default_safety_tier} />
                  </div>
                  <p className="text-[10.5px] text-ant-muted leading-snug mt-0.5">{s.description}</p>
                </div>
                <span className="text-[10px] text-ant-muted">{s.slug}</span>
                <span className="text-[10px] text-ant-mid">{s.requires_write_db ? 'write' : 'read'}</span>
                <button
                  onClick={() => setDeprecated.mutate({ id: s.id, deprecated: !s.deprecated })}
                  className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                    s.deprecated ? 'bg-ant-rose/10 text-ant-rose' : 'bg-ant-green/10 text-ant-green'
                  }`}
                >
                  {s.deprecated ? 'deprecated' : 'live'}
                </button>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SAFETY — jailbreak signals + global redaction rules
// ──────────────────────────────────────────────────────────────────────
function SafetyTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: jb } = useQuery<JailbreakRow[]>({
    queryKey: ['owner-ai-jailbreak'],
    queryFn: async () => {
      const { data } = await supabase.from('ai_jailbreak_signals').select('*').order('severity', { ascending: false });
      return (data || []) as JailbreakRow[];
    },
  });
  const { data: rd } = useQuery<RedactionRow[]>({
    queryKey: ['owner-ai-redaction'],
    queryFn: async () => {
      const { data } = await supabase.from('ai_redaction_rules').select('*').is('business_id', null).order('priority', { ascending: true });
      return (data || []) as RedactionRow[];
    },
  });

  const toggleJB = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('ai_jailbreak_signals').update({ is_active }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-ai-jailbreak'] }),
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const toggleRD = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('ai_redaction_rules').update({ is_active }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-ai-redaction'] }),
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  return (
    <div className="space-y-3">
      <Card>
        <Kicker>Jailbreak signals</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Patterns matched against incoming customer messages before the brain runs. <code>block</code> short-circuits the pipeline; <code>escalate</code> flags + continues.
        </p>
        <div className="mt-2 divide-y divide-ant-line">
          {(jb || []).map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_70px_70px_50px] gap-2 py-2 items-center">
              <div>
                <code className="text-[10.5px] text-ant-ink font-mono">{r.pattern}</code>
                {r.description ? <p className="text-[10px] text-ant-muted mt-0.5">{r.description}</p> : null}
              </div>
              <SeverityBadge severity={r.severity} />
              <ActionBadge action={r.action} />
              <button
                onClick={() => toggleJB.mutate({ id: r.id, is_active: !r.is_active })}
                className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                  r.is_active ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-line-soft text-ant-mid'
                }`}
              >
                {r.is_active ? 'on' : 'off'}
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Kicker>Global redaction rules</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Replace matched text with a placeholder before sending to providers; restore on response. Per-business overrides live in each business's AI Brain settings.
        </p>
        <div className="mt-2 divide-y divide-ant-line">
          {(rd || []).map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_100px_60px_50px] gap-2 py-2 items-center">
              <code className="text-[10.5px] text-ant-ink font-mono">{r.pattern}</code>
              <span className="text-[10px] uppercase tracking-[0.16em] text-ant-mid font-semibold">{r.placeholder_kind}</span>
              <span className="text-[10px] text-ant-muted tabular-nums">priority {r.priority}</span>
              <button
                onClick={() => toggleRD.mutate({ id: r.id, is_active: !r.is_active })}
                className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                  r.is_active ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-line-soft text-ant-mid'
                }`}
              >
                {r.is_active ? 'on' : 'off'}
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BUSINESSES — per-business AI state + override hooks
// ──────────────────────────────────────────────────────────────────────
function BusinessesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows } = useQuery<BusinessHealth[]>({
    queryKey: ['owner-ai-businesses-detail'],
    queryFn: async () => {
      const { data: hs } = await supabase
        .from('ai_business_health')
        .select('business_id, default_mode, business_monthly_cap_usd, business_spent_this_month_usd, business_quota_status, pending_reviews, last_decision_at, error_rate_7d, live_skills_count');
      const ids = (hs || []).map((r: any) => r.business_id);
      const { data: names } = await supabase.from('businesses').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const nameMap = new Map((names || []).map((n: any) => [n.id, n.name]));
      return (hs || []).map((r: any) => ({ ...r, business_name: nameMap.get(r.business_id) || '—' }));
    },
  });

  const forcePause = useMutation({
    mutationFn: async (business_id: string) => {
      const { error } = await supabase
        .from('ai_business_brain')
        .update({ default_mode: 'off', updated_at: new Date().toISOString() })
        .eq('business_id', business_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-ai-businesses-detail'] });
      qc.invalidateQueries({ queryKey: ['owner-ai-businesses-summary'] });
      toast({ title: 'AI paused', description: 'Default mode set to off.' });
    },
    onError: (e: any) => toast({ title: 'Pause failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const resetSpend = useMutation({
    mutationFn: async (business_id: string) => {
      const { error } = await supabase
        .from('ai_business_brain')
        .update({ spent_this_month_usd: 0, quota_status: 'active', spend_last_reset_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('business_id', business_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-ai-businesses-detail'] });
      toast({ title: 'Spend reset', description: 'Business cap reset to 0.' });
    },
    onError: (e: any) => toast({ title: 'Reset failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  return (
    <Card>
      <Kicker>Businesses</Kicker>
      <p className="text-[10.5px] text-ant-muted mt-0.5">
        Cross-tenant view. Force-pause a business or reset its monthly cap from here.
      </p>
      <div className="divide-y divide-ant-line mt-2">
        {(rows || []).map((b) => (
          <div key={b.business_id} className="grid grid-cols-[1.5fr_60px_140px_80px_60px_180px] gap-2 py-2.5 items-center text-[11.5px]">
            <span className="font-medium text-ant-ink truncate">{b.business_name}</span>
            <ModeBadge mode={(b.default_mode as any) ?? 'off'} />
            <span className="text-ant-mid tabular-nums">
              {fmtUsd(b.business_spent_this_month_usd)} / {fmtUsd(b.business_monthly_cap_usd)}
            </span>
            <span className={`tabular-nums ${(b.error_rate_7d ?? 0) > 0.1 ? 'text-ant-rose' : 'text-ant-mid'}`}>
              {Math.round((b.error_rate_7d ?? 0) * 100)}% err
            </span>
            <span className="text-ant-muted">{b.live_skills_count} live</span>
            <div className="flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => resetSpend.mutate(b.business_id)} className="text-[11px] h-7 rounded-full">
                Reset spend
              </Button>
              <Button size="sm" variant="ghost" disabled={!b.default_mode || b.default_mode === 'off'} onClick={() => forcePause.mutate(b.business_id)} className="text-[11px] h-7 rounded-full text-ant-rose hover:text-ant-rose/80">
                Force pause
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-ant-line bg-ant-paper p-4 ${className}`}>{children}</div>;
}
function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-[9.5px] uppercase tracking-[0.2em] text-ant-mid font-semibold">{children}</p>;
}
function ProgressBar({ pct, accent }: { pct: number; accent: string }) {
  return (
    <div className="mt-2 h-[3px] rounded-full overflow-hidden bg-ant-line/70">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: accent }} />
    </div>
  );
}
function ModeBadge({ mode }: { mode: 'off' | 'static' | 'dynamic' | 'agent' }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    off:     { label: 'OFF',     cls: 'bg-ant-line-soft text-ant-mid' },
    static:  { label: 'STATIC',  cls: 'bg-ant-blue/10 text-ant-blue ring-1 ring-ant-blue/20' },
    dynamic: { label: 'DYNAMIC', cls: 'bg-ant-orange/10 text-ant-orange ring-1 ring-ant-orange/20' },
    agent:   { label: 'AGENT',   cls: 'bg-ant-green/10 text-ant-green ring-1 ring-ant-green/20' },
  };
  const c = cfg[mode] || cfg.off;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.16em] ${c.cls}`}>{c.label}</span>;
}
function SafetyBadge({ tier }: { tier: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    safe_by_default:  { label: 'safe',    cls: 'text-ant-green bg-ant-green/10' },
    opt_in:           { label: 'opt-in',  cls: 'text-ant-blue bg-ant-blue/10' },
    sandbox_required: { label: 'sandbox', cls: 'text-ant-orange bg-ant-orange/10' },
  };
  const m = map[tier] || map.opt_in;
  return <span className={`text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}
function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const map = { low: 'text-ant-blue bg-ant-blue/10', medium: 'text-ant-orange bg-ant-orange/10', high: 'text-ant-rose bg-ant-rose/10' };
  return <span className={`text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded font-semibold ${map[severity]}`}>{severity}</span>;
}
function ActionBadge({ action }: { action: 'log' | 'escalate' | 'block' }) {
  const map = { log: 'text-ant-mid bg-ant-line-soft', escalate: 'text-ant-orange bg-ant-orange/10', block: 'text-ant-rose bg-ant-rose/10' };
  return <span className={`text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded font-semibold ${map[action]}`}>{action}</span>;
}
