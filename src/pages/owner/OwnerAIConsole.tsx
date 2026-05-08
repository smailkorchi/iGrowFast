import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
  Building2,
  Cpu,
  KeyRound,
  Loader2,
  Mic,
  Pencil,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
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
          <p className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">iGrowFast AI · platform</p>
          <h1 className="font-display text-[22px] font-semibold text-ant-ink leading-tight tracking-[-0.015em]">AI Platform</h1>
          <p className="font-serif-display italic text-[12.5px] text-ant-mid mt-0.5">
            Provider keys, models, skills, safety — applied across every tenant.
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════════════════════════════
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

  // 14-day platform-wide decision counts.
  const { data: trend } = useQuery<{ counts: number[]; total: number }>({
    queryKey: ['owner-ai-trend-14d'],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('ai_decisions')
        .select('created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(20000);
      const buckets = new Array(14).fill(0);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      for (const r of (data || []) as { created_at: string }[]) {
        const d = new Date(r.created_at);
        const idx = 13 - Math.floor((todayStart.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
        if (idx >= 0 && idx < 14) buckets[idx]++;
      }
      return { counts: buckets, total: (data || []).length };
    },
    refetchInterval: 60_000,
  });

  if (!keys || !businesses) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const totalCap   = keys.reduce((s, k) => s + Number(k.monthly_cap_usd || 0), 0);
  const totalSpent = keys.reduce((s, k) => s + Number(k.spent_this_month_usd || 0), 0);
  const platOk     = keys.every((k) => k.status === 'active');
  const platBad    = keys.filter((k) => k.status !== 'active').length;
  const liveBiz    = businesses.filter((b) => b.default_mode && b.default_mode !== 'off').length;
  const escalating = businesses.filter((b) => (b.error_rate_7d ?? 0) > 0.1).length;
  const totalPending = businesses.reduce((s, b) => s + (b.pending_reviews || 0), 0);
  const sparkData = (trend?.counts || new Array(14).fill(0)).map((v, i) => ({ i, v }));
  const platPct = pct(totalSpent, totalCap);

  return (
    <div className="space-y-4">
      {/* HERO */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-0">
          <div className="px-6 md:px-7 py-6 md:py-7">
            <div className="flex items-center gap-2.5">
              <StatusPulse ok={platOk} />
              <span className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${platOk ? 'text-ant-green' : 'text-ant-rose'}`}>
                {platOk ? 'All keys active' : `${platBad} key${platBad === 1 ? '' : 's'} need attention`}
              </span>
              <span className="text-[10px] text-ant-muted">·</span>
              <span className="text-[10px] text-ant-mid tabular-nums">{businesses.length} tenants</span>
            </div>

            <div className="mt-5 flex items-baseline gap-2.5 flex-wrap">
              <span className="font-display text-[44px] md:text-[52px] font-semibold text-ant-ink leading-[0.95] tabular-nums tracking-[-0.03em]">
                {fmtUsd(totalSpent)}
              </span>
              <span className="font-serif-display italic text-[14px] text-ant-muted">spent of {fmtUsd(totalCap)} cap this month</span>
            </div>

            <div className="mt-3.5 max-w-md">
              <div className="h-[3px] rounded-full overflow-hidden bg-ant-line/70">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, platPct)}%`,
                    backgroundColor: platPct >= 90 ? '#c96356' : platPct >= 70 ? '#d49b5a' : '#788c5d',
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-ant-muted">
                {platPct}% of platform cap used · {100 - platPct}% remaining
              </p>
            </div>

            <div className="mt-5 flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-ant-mid">
                <span className="tabular-nums font-semibold text-ant-ink">{trend?.total ?? 0}</span> decisions in 14d
              </span>
              <span className="text-ant-muted">·</span>
              <span className="text-ant-mid">
                <span className="tabular-nums font-semibold text-ant-ink">{liveBiz}</span> tenants active
              </span>
              {totalPending > 0 && (
                <>
                  <span className="text-ant-muted">·</span>
                  <span className="inline-flex items-center gap-1 text-ant-orange font-medium">
                    {totalPending} pending reviews across tenants
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 14-day spark */}
          <div className="px-6 md:px-7 py-6 md:py-7 border-t md:border-t-0 md:border-l border-ant-line bg-ant-line-soft/30 flex flex-col">
            <div className="flex items-center justify-between">
              <Kicker>Decisions, 14 days</Kicker>
              <span className="text-[10px] text-ant-muted tabular-nums">
                {sparkData.reduce((s, p) => s + p.v, 0)}
              </span>
            </div>
            <div className="flex-1 mt-2 -mx-1 min-h-[80px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={80}>
                <AreaChart data={sparkData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ownerSparkFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c98654" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#c98654" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="#c98654"
                    strokeWidth={1.5}
                    fill="url(#ownerSparkFill)"
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* THREE TILES */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile
          label="Active tenants"
          value={liveBiz}
          hint={`${businesses.length - liveBiz} configured but off`}
          accent="neutral"
        />
        <StatTile
          label="Tenants with errors (7d)"
          value={escalating}
          hint={escalating === 0 ? 'No tenant exceeded 10% error rate.' : 'Error rate above 10% — investigate.'}
          accent={escalating > 0 ? 'red' : 'green'}
        />
        <StatTile
          label="Provider keys"
          value={`${keys.length - platBad} / ${keys.length}`}
          hint={platOk ? 'All providers responding.' : 'A key is paused, exhausted, or invalid.'}
          accent={platOk ? 'green' : 'red'}
        />
      </section>

      {/* PER-BUSINESS STREAM */}
      <section className="rounded-xl border border-ant-line bg-ant-paper">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <Kicker>Per-tenant state</Kicker>
          <span className="text-[10.5px] text-ant-muted tabular-nums">{businesses.length} tenants · live refresh every 30s</span>
        </div>
        {businesses.length === 0 ? (
          <p className="font-serif-display italic text-[12px] text-ant-muted px-5 py-8 text-center">
            No tenants configured yet.
          </p>
        ) : (
          <ul className="divide-y divide-ant-line">
            {businesses
              .slice()
              .sort((a, b) => (a.default_mode === 'off' ? 1 : 0) - (b.default_mode === 'off' ? 1 : 0))
              .map((b) => {
                const errPct = Math.round((b.error_rate_7d ?? 0) * 100);
                const isOff = !b.default_mode || b.default_mode === 'off';
                const dot = isOff ? '#a8a299' : errPct > 10 ? '#c96356' : '#788c5d';
                return (
                  <li key={b.business_id} className="px-5 py-3 flex items-start gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-ant-ink truncate">{b.business_name}</p>
                        <ModeBadge mode={(b.default_mode as any) ?? 'off'} />
                        {b.pending_reviews > 0 && (
                          <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold px-1.5 py-0.5 rounded bg-ant-orange/10 text-ant-orange">
                            {b.pending_reviews} pending
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
                        {fmtUsd(b.business_spent_this_month_usd)} of {fmtUsd(b.business_monthly_cap_usd)} · {b.live_skills_count} skills live · last reply {timeAgo(b.last_decision_at)}
                      </p>
                    </div>
                    <span className={`text-[10.5px] tabular-nums shrink-0 pt-0.5 ${errPct > 10 ? 'text-ant-rose' : 'text-ant-mid'}`}>
                      {errPct}% err
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PROVIDERS — keys, status, rotation
// ════════════════════════════════════════════════════════════════════
function ProvidersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editingCap, setEditingCap] = useState<{ provider_id: string; current: number; slug: string } | null>(null);
  const [rotating, setRotating]     = useState<{ provider_id: string; provider_slug: string } | null>(null);

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

  if (isLoading) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  return (
    <div className="space-y-5">
      <header>
        <Kicker>Provider keys</Kicker>
        <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
          The credentials behind every brain.
        </h2>
        <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
          Platform-level keys, encrypted in Supabase Vault. Rotation runs through the SQL Editor — plaintext keys never travel through this UI.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3">
        {(rows || []).map((p) => (
          <ProviderCard
            key={p.id}
            row={p}
            onEditCap={() => p.key && setEditingCap({ provider_id: p.id, current: Number(p.key.monthly_cap_usd), slug: p.slug })}
            onPause={()  => setStatus.mutate({ provider_id: p.id, status: 'paused' })}
            onResume={() => setStatus.mutate({ provider_id: p.id, status: 'active' })}
            onRotate={() => setRotating({ provider_id: p.id, provider_slug: p.slug })}
          />
        ))}
      </div>

      {editingCap && (
        <CapDialog
          providerSlug={editingCap.slug}
          current={editingCap.current}
          onClose={() => setEditingCap(null)}
          onSubmit={(cap) => setCap.mutate({ provider_id: editingCap.provider_id, cap })}
          saving={setCap.isPending}
        />
      )}
      {rotating && (
        <RotateKeyDialog
          providerSlug={rotating.provider_slug}
          onClose={() => setRotating(null)}
        />
      )}
    </div>
  );
}

function ProviderCard({
  row, onEditCap, onPause, onResume, onRotate,
}: {
  row: ProviderRow;
  onEditCap: () => void;
  onPause: () => void;
  onResume: () => void;
  onRotate: () => void;
}) {
  const k = row.key;
  const status = k?.status ?? 'invalid';
  const usagePct = k ? pct(k.spent_this_month_usd, k.monthly_cap_usd) : 0;
  const accentColor = status === 'active'
    ? (usagePct >= 90 ? '#c96356' : usagePct >= 70 ? '#d49b5a' : '#788c5d')
    : status === 'paused' ? '#d49b5a' : '#c96356';

  const statusMap: Record<string, { cls: string; Icon: any; label: string }> = {
    active:    { cls: 'bg-ant-green/10 text-ant-green ring-ant-green/20',     Icon: ShieldCheck, label: 'Active' },
    paused:    { cls: 'bg-ant-orange/10 text-ant-orange ring-ant-orange/20', Icon: ShieldOff,   label: 'Paused' },
    exhausted: { cls: 'bg-ant-rose/10 text-ant-rose ring-ant-rose/20',       Icon: ShieldAlert, label: 'Exhausted' },
    invalid:   { cls: 'bg-ant-rose/10 text-ant-rose ring-ant-rose/20',       Icon: ShieldAlert, label: 'Invalid' },
  };
  const meta = statusMap[status] || statusMap.invalid;
  const StatusIcon = meta.Icon;

  return (
    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
      <div className="px-5 py-4 flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-ant-orange/10 ring-1 ring-ant-orange/20 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-ant-orange" strokeWidth={1.6} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-[16px] font-semibold text-ant-ink leading-tight tracking-[-0.01em]">{row.display_name}</h3>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] uppercase tracking-[0.18em] font-semibold ring-1 ${meta.cls}`}>
                  <StatusIcon className="w-3 h-3" /> {meta.label}
                </span>
                <span className="text-[10px] text-ant-muted font-mono">{row.slug}</span>
              </div>
              <p className="font-serif-display italic text-[12px] text-ant-muted mt-1">
                {k
                  ? `Last reset ${k.last_reset_at ? new Date(k.last_reset_at).toLocaleDateString() : '—'} · last probe ${k.last_probe_at ? timeAgo(k.last_probe_at) : 'never'}`
                  : 'No key configured. Rotate to add the first one.'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {k && (status === 'paused' || status === 'exhausted') && (
                <Button size="sm" variant="ghost" onClick={onResume}
                  className="rounded-full h-8 text-[11.5px] text-ant-green hover:text-ant-green hover:bg-ant-green/10 px-3">
                  <Play className="w-3.5 h-3.5 mr-1" /> Resume
                </Button>
              )}
              {k && status === 'active' && (
                <Button size="sm" variant="ghost" onClick={onPause}
                  className="rounded-full h-8 text-[11.5px] text-ant-orange hover:text-ant-orange hover:bg-ant-orange/10 px-3">
                  <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!k} onClick={onEditCap}
                className="rounded-full h-8 text-[11.5px] text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft px-3">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit cap
              </Button>
              <Button size="sm" onClick={onRotate}
                className="rounded-full h-8 text-[11.5px] bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-3.5">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Rotate
              </Button>
            </div>
          </div>

          {/* Spend stats */}
          {k && (
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[24px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none">
                  {fmtUsd(k.spent_this_month_usd)}
                </span>
                <span className="text-[11px] text-ant-muted">of {fmtUsd(k.monthly_cap_usd)} cap · {usagePct}% used</span>
              </div>
              <div className="mt-2 h-[3px] rounded-full overflow-hidden bg-ant-line/70">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, usagePct)}%`, backgroundColor: accentColor }}
                />
              </div>
            </div>
          )}

          {/* Probe error */}
          {k?.last_probe_error && (
            <div className="mt-3 rounded-lg border border-ant-rose/25 bg-ant-rose/[0.04] px-3 py-2">
              <p className="text-[9.5px] uppercase tracking-[0.18em] font-semibold text-ant-rose flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Last probe error
              </p>
              <p className="text-[11.5px] text-ant-ink mt-0.5 font-mono break-all leading-snug">
                {k.last_probe_error}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CapDialog({ providerSlug, current, onClose, onSubmit, saving }: { providerSlug: string; current: number; onClose: () => void; onSubmit: (cap: number) => void; saving: boolean }) {
  const [val, setVal] = useState<number>(current);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] tracking-[-0.01em]">Monthly cap · {providerSlug}</DialogTitle>
          <DialogDescription className="font-serif-display italic text-[12.5px] text-ant-muted">
            Hard ceiling for this provider across every tenant. When crossed, the provider auto-pauses until next month.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-ant-line bg-ant-light/40 px-3.5 py-3 mt-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-ant-mid font-semibold">Cap</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <Input
              type="number" step="0.50" min={0} value={val}
              onChange={(e) => setVal(Number(e.target.value))}
              className="font-display text-[26px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] bg-transparent border-0 outline-none focus-visible:ring-0 p-0 w-[8ch]"
            />
            <span className="text-[11px] text-ant-mid font-medium">USD / month</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="rounded-full h-9">Cancel</Button>
          <Button onClick={() => onSubmit(val)} disabled={saving || val < 0} className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save cap'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RotateKeyDialog({ providerSlug, onClose }: { providerSlug: string; onClose: () => void }) {
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
          <DialogTitle className="font-display text-[18px] tracking-[-0.01em] flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-ant-orange" /> Rotate {providerSlug} key
          </DialogTitle>
          <DialogDescription className="font-serif-display italic text-[12.5px] text-ant-muted">
            Plaintext keys never pass through this UI. Copy the SQL, paste it in the Supabase SQL Editor, replace the placeholder with the rotated key, and run it.
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-ant-line-soft border border-ant-line rounded-lg p-3 text-[10.5px] overflow-x-auto whitespace-pre-wrap font-mono text-ant-ink leading-relaxed">{sql}</pre>
        <div className="flex items-center justify-between pt-1">
          <a
            href="https://supabase.com/dashboard/project/zjkqprrfbibjoslvlmxf/sql/new"
            target="_blank" rel="noreferrer"
            className="text-[11.5px] text-ant-orange hover:underline"
          >
            Open SQL Editor ↗
          </a>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="rounded-full h-9">Close</Button>
            <Button onClick={copy} className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90">Copy SQL</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════
// MODELS
// ════════════════════════════════════════════════════════════════════
const ROLE_META: Record<string, { label: string; tint: string; ring: string; iconText: string; Icon: any }> = {
  brain:     { label: 'Brain',     tint: 'bg-ant-orange/10', ring: 'ring-ant-orange/20', iconText: 'text-ant-orange', Icon: BrainCircuit },
  tongue:    { label: 'Tongue',    tint: 'bg-ant-blue/10',   ring: 'ring-ant-blue/20',   iconText: 'text-ant-blue',   Icon: Sparkles },
  stt:       { label: 'STT',       tint: 'bg-ant-green/10',  ring: 'ring-ant-green/20',  iconText: 'text-ant-green',  Icon: Mic },
  embedding: { label: 'Embedding', tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-mid',    Icon: Cpu },
};
const ROLE_ORDER = ['brain', 'tongue', 'stt', 'embedding'];

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-ai-models'] }),
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (isLoading) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const grouped: Record<string, ModelRow[]> = {};
  (rows || []).forEach((m) => { (grouped[m.role] ||= []).push(m); });
  const groupOrder = ROLE_ORDER.filter((r) => grouped[r]?.length).concat(
    Object.keys(grouped).filter((r) => !ROLE_ORDER.includes(r)),
  );

  const totalActive = (rows || []).filter((m) => m.is_active).length;

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Model catalog</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            Every model the platform can route through.
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            Each role has a primary model the brain uses. Inactive entries stay in the catalog but never get called.
          </p>
        </div>
        <span className="text-[11px] text-ant-mid tabular-nums">
          <span className="font-semibold text-ant-ink">{totalActive}</span> active · {rows?.length ?? 0} total
        </span>
      </header>

      {groupOrder.map((role) => {
        const meta = ROLE_META[role] || ROLE_META.embedding;
        const items = grouped[role]!;
        return (
          <section key={role}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-1.5 h-1.5 rounded-full ${meta.iconText.replace('text-', 'bg-')}`} />
              <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid">{meta.label}</p>
              <span className="text-[10px] text-ant-muted tabular-nums">·</span>
              <span className="text-[10px] text-ant-muted tabular-nums">{items.length}</span>
              <div className="flex-1 h-px bg-ant-line ml-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((m) => (
                <ModelCard
                  key={m.id}
                  row={m}
                  busy={setActive.isPending}
                  onToggle={(v) => setActive.mutate({ id: m.id, is_active: v })}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ModelCard({ row, busy, onToggle }: { row: ModelRow; busy: boolean; onToggle: (v: boolean) => void }) {
  const meta = ROLE_META[row.role] || ROLE_META.embedding;
  const Icon = meta.Icon;
  const isActive = row.is_active;
  return (
    <div className={`rounded-2xl border bg-ant-paper p-4 transition-all relative ${
      isActive
        ? 'border-ant-line shadow-[0_1px_0_rgba(0,0,0,0.02)]'
        : 'border-ant-line opacity-65 hover:opacity-100'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${meta.tint} ${meta.ring}`}>
          <Icon className={`w-[18px] h-[18px] ${meta.iconText}`} strokeWidth={1.6} />
        </div>
        <span className={`text-[9.5px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded-full ring-1 ${
          isActive ? 'text-ant-green bg-ant-green/10 ring-ant-green/20' : 'text-ant-mid bg-ant-line-soft ring-ant-line'
        }`}>
          {isActive ? 'Live' : 'Off'}
        </span>
      </div>
      <h4 className="mt-3 font-display text-[14.5px] font-semibold text-ant-ink leading-tight tracking-[-0.01em]">
        {row.display_name}
      </h4>
      <p className="text-[10.5px] text-ant-muted font-mono mt-0.5 truncate" title={row.model_id}>{row.model_id}</p>

      <div className="mt-3 grid grid-cols-2 gap-y-2">
        {row.input_cost_per_1m != null && (
          <CostFact label="Input"  value={`$${row.input_cost_per_1m}`} unit="/ 1M" />
        )}
        {row.output_cost_per_1m != null && (
          <CostFact label="Output" value={`$${row.output_cost_per_1m}`} unit="/ 1M" />
        )}
        {row.audio_cost_per_minute != null && (
          <CostFact label="Audio"  value={`$${row.audio_cost_per_minute}`} unit="/ min" />
        )}
        {row.context_window != null && (
          <CostFact label="Context" value={`${(row.context_window / 1000).toFixed(0)}K`} unit="tokens" />
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-ant-line flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold text-ant-mid">{meta.label}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <Switch checked={isActive} disabled={busy} onCheckedChange={onToggle} />
        </span>
      </div>
    </div>
  );
}

function CostFact({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.18em] font-semibold text-ant-mid">{label}</p>
      <p className="text-[12px] font-medium text-ant-ink tabular-nums leading-tight mt-0.5">
        {value} <span className="text-[10px] text-ant-mid font-normal">{unit}</span>
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SKILLS — global catalog + deprecate toggle
// ════════════════════════════════════════════════════════════════════
const CATEGORY_META: Record<string, { label: string; accent: string; tint: string; ring: string; iconText: string }> = {
  messaging:  { label: 'Messaging',  accent: 'bg-ant-blue',   tint: 'bg-ant-blue/10',   ring: 'ring-ant-blue/20',   iconText: 'text-ant-blue' },
  sales:      { label: 'Sales',      accent: 'bg-ant-orange', tint: 'bg-ant-orange/10', ring: 'ring-ant-orange/20', iconText: 'text-ant-orange' },
  orders:     { label: 'Orders',     accent: 'bg-ant-green',  tint: 'bg-ant-green/10',  ring: 'ring-ant-green/20',  iconText: 'text-ant-green' },
  support:    { label: 'Support',    accent: 'bg-ant-rose',   tint: 'bg-ant-rose/10',   ring: 'ring-ant-rose/20',   iconText: 'text-ant-rose' },
  analytics:  { label: 'Analytics',  accent: 'bg-ant-mid',    tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-ink' },
  moderation: { label: 'Moderation', accent: 'bg-ant-mid',    tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-ink' },
};
const CATEGORY_ORDER = ['messaging', 'sales', 'orders', 'support', 'analytics', 'moderation'];

function SkillsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'all' | 'live' | 'deprecated'>('all');

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

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  const total      = rows?.length ?? 0;
  const liveCount  = (rows || []).filter((s) => !s.deprecated).length;
  const deprecCount = total - liveCount;

  const visible = (rows || []).filter((s) => {
    if (filter === 'live')        return !s.deprecated;
    if (filter === 'deprecated')  return s.deprecated;
    return true;
  });

  const grouped: Record<string, SkillRow[]> = {};
  visible.forEach((s) => { (grouped[s.category] ||= []).push(s); });
  const groupOrder = CATEGORY_ORDER.filter((c) => grouped[c]?.length).concat(
    Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  );

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Skill catalog</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            Every capability the platform exposes.
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            Tenants enable individual skills inside their AI Brain. Deprecated entries disappear from those toggles.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <CountPill label="Live"       value={liveCount}  color="text-ant-green" dotCls="bg-ant-green" />
          <CountPill label="Deprecated" value={deprecCount} color="text-ant-rose"  dotCls="bg-ant-rose" />
        </div>
      </header>

      <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
        {([
          { v: 'all',        label: `All ${total}` },
          { v: 'live',       label: `Live ${liveCount}` },
          { v: 'deprecated', label: `Deprecated ${deprecCount}` },
        ] as const).map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3.5 py-1.5 rounded-full text-[11.5px] font-medium transition-colors tabular-nums ${
              filter === f.v
                ? 'bg-ant-ink text-ant-paper'
                : 'text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-8 py-12 text-center">
          <p className="font-serif-display italic text-[13px] text-ant-muted">
            {filter === 'live' ? 'No live skills.' : filter === 'deprecated' ? 'Nothing deprecated.' : 'No skills.'}
          </p>
        </div>
      ) : (
        groupOrder.map((cat) => {
          const meta = CATEGORY_META[cat] || CATEGORY_META.messaging;
          const items = grouped[cat]!;
          return (
            <section key={cat}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`w-1.5 h-1.5 rounded-full ${meta.accent}`} />
                <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid">{meta.label}</p>
                <span className="text-[10px] text-ant-muted tabular-nums">·</span>
                <span className="text-[10px] text-ant-muted tabular-nums">{items.length}</span>
                <div className="flex-1 h-px bg-ant-line ml-1" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((s) => (
                  <CatalogSkillCard
                    key={s.id}
                    skill={s}
                    busy={setDeprecated.isPending}
                    onToggleDeprecated={(v) => setDeprecated.mutate({ id: s.id, deprecated: v })}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function CatalogSkillCard({
  skill, busy, onToggleDeprecated,
}: {
  skill: SkillRow;
  busy: boolean;
  onToggleDeprecated: (v: boolean) => void;
}) {
  const meta = CATEGORY_META[skill.category] || CATEGORY_META.messaging;
  const isLive = !skill.deprecated;
  const tier = skill.default_safety_tier;
  const tierLabel = tier === 'safe_by_default' ? 'Safe by default' : tier === 'sandbox_required' ? 'Sandbox required' : 'Opt-in';

  return (
    <div className={`rounded-2xl border bg-ant-paper p-4 transition-all relative ${
      isLive ? 'border-ant-line' : 'border-ant-line opacity-65 hover:opacity-100'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${meta.tint} ${meta.ring}`}>
          <Sparkles className={`w-[18px] h-[18px] ${meta.iconText}`} strokeWidth={1.6} />
        </div>
        <span className={`text-[9.5px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded-full ring-1 ${
          isLive
            ? 'text-ant-green bg-ant-green/10 ring-ant-green/20'
            : 'text-ant-rose bg-ant-rose/10 ring-ant-rose/20'
        }`}>
          {isLive ? 'Live' : 'Deprecated'}
        </span>
      </div>

      <h4 className="mt-3 font-display text-[14.5px] font-semibold text-ant-ink leading-tight tracking-[-0.01em]">
        {skill.name}
      </h4>
      <p className="text-[10.5px] text-ant-muted font-mono mt-0.5 truncate">{skill.slug}</p>
      <p className="text-[11.5px] text-ant-muted leading-relaxed mt-2 line-clamp-3 min-h-[44px]">
        {skill.description}
      </p>

      <div className="mt-3 pt-3 border-t border-ant-line flex items-center justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold text-ant-mid flex items-center gap-1.5 truncate">
          {skill.requires_write_db && <ShieldCheck className="w-3 h-3 text-ant-orange" />}
          {tierLabel} · {skill.requires_write_db ? 'write' : 'read'}
        </span>
        <Button
          size="sm" variant="ghost"
          disabled={busy}
          onClick={() => onToggleDeprecated(!skill.deprecated)}
          className={`rounded-full h-7 text-[11px] px-3 ${
            isLive ? 'text-ant-rose hover:text-ant-rose hover:bg-ant-rose/10' : 'text-ant-green hover:text-ant-green hover:bg-ant-green/10'
          }`}
        >
          {isLive ? 'Deprecate' : 'Restore'}
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SAFETY — jailbreak signals + global redaction rules
// ════════════════════════════════════════════════════════════════════
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

  const jbActive = (jb || []).filter((r) => r.is_active).length;
  const rdActive = (rd || []).filter((r) => r.is_active).length;

  return (
    <div className="space-y-5 pb-6">
      <header>
        <Kicker>Safety</Kicker>
        <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
          The platform's first line of defense.
        </h2>
        <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
          Patterns checked on every inbound message. Jailbreak signals short-circuit the brain. Redaction rules swap PII for placeholders before the brain sees it.
        </p>
      </header>

      {/* Jailbreak */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-ant-line flex items-center justify-between">
          <div>
            <Kicker>Jailbreak signals</Kicker>
            <p className="font-serif-display italic text-[11.5px] text-ant-muted mt-0.5">
              Pre-flight regex matches — <span className="not-italic font-mono">block</span> short-circuits the pipeline,{' '}
              <span className="not-italic font-mono">escalate</span> tags &amp; continues.
            </p>
          </div>
          <span className="text-[11px] text-ant-mid tabular-nums shrink-0">
            <span className="font-semibold text-ant-ink">{jbActive}</span> on · {(jb || []).length} total
          </span>
        </div>
        {(jb || []).length === 0 ? (
          <p className="font-serif-display italic text-[12px] text-ant-muted py-6 text-center">No signals configured.</p>
        ) : (
          <ul className="divide-y divide-ant-line">
            {(jb || []).map((r) => (
              <li key={r.id} className={`px-5 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-start ${r.is_active ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <code className="text-[11px] text-ant-ink font-mono break-all">{r.pattern}</code>
                  {r.description && <p className="text-[10.5px] text-ant-muted mt-0.5 italic">{r.description}</p>}
                </div>
                <SeverityBadge severity={r.severity} />
                <ActionBadge action={r.action} />
                <Switch checked={r.is_active} onCheckedChange={(v) => toggleJB.mutate({ id: r.id, is_active: v })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Redaction */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-ant-line flex items-center justify-between">
          <div>
            <Kicker>Global redaction rules</Kicker>
            <p className="font-serif-display italic text-[11.5px] text-ant-muted mt-0.5">
              Replace matched text with a placeholder before it reaches the model. Restored on the way back. Per-tenant overrides live in each Brain Setup.
            </p>
          </div>
          <span className="text-[11px] text-ant-mid tabular-nums shrink-0">
            <span className="font-semibold text-ant-ink">{rdActive}</span> on · {(rd || []).length} total
          </span>
        </div>
        {(rd || []).length === 0 ? (
          <p className="font-serif-display italic text-[12px] text-ant-muted py-6 text-center">No redaction rules configured.</p>
        ) : (
          <ul className="divide-y divide-ant-line">
            {(rd || []).map((r) => (
              <li key={r.id} className={`px-5 py-3 grid grid-cols-1 md:grid-cols-[1fr_140px_80px_auto] gap-3 items-center ${r.is_active ? '' : 'opacity-60'}`}>
                <code className="text-[11px] text-ant-ink font-mono break-all">{r.pattern}</code>
                <span className="text-[9.5px] uppercase tracking-[0.18em] font-semibold text-ant-mid">[{r.placeholder_kind}]</span>
                <span className="text-[10.5px] text-ant-muted tabular-nums">priority {r.priority}</span>
                <Switch checked={r.is_active} onCheckedChange={(v) => toggleRD.mutate({ id: r.id, is_active: v })} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// BUSINESSES — per-tenant cards + admin overrides
// ════════════════════════════════════════════════════════════════════
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
    refetchInterval: 30_000,
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
      toast({ title: 'Spend reset', description: 'Tenant cap reset to 0.' });
    },
    onError: (e: any) => toast({ title: 'Reset failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (!rows) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const total = rows.length;
  const liveCount = rows.filter((b) => b.default_mode && b.default_mode !== 'off').length;
  const errorCount = rows.filter((b) => (b.error_rate_7d ?? 0) > 0.1).length;

  return (
    <div className="space-y-5 pb-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Tenants</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            Cross-tenant view of the brain.
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            Force-pause a tenant or reset its monthly cap from here. Changes take effect on the next inbound message.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <CountPill label="Live"   value={liveCount}                   color="text-ant-green"  dotCls="bg-ant-green" />
          <CountPill label="Off"    value={total - liveCount}           color="text-ant-mid"    dotCls="bg-ant-mid/40" />
          <CountPill label="Error"  value={errorCount}                  color="text-ant-rose"   dotCls="bg-ant-rose" />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-8 py-12 text-center">
          <p className="font-serif-display italic text-[13px] text-ant-muted">No tenants configured.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows
            .slice()
            .sort((a, b) => (a.default_mode === 'off' ? 1 : 0) - (b.default_mode === 'off' ? 1 : 0))
            .map((b) => (
              <BusinessCard
                key={b.business_id}
                row={b}
                onForcePause={() => forcePause.mutate(b.business_id)}
                onResetSpend={() => resetSpend.mutate(b.business_id)}
                pausing={forcePause.isPending}
                resetting={resetSpend.isPending}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function BusinessCard({
  row, onForcePause, onResetSpend, pausing, resetting,
}: {
  row: BusinessHealth;
  onForcePause: () => void;
  onResetSpend: () => void;
  pausing: boolean;
  resetting: boolean;
}) {
  const isOff   = !row.default_mode || row.default_mode === 'off';
  const errPct  = Math.round((row.error_rate_7d ?? 0) * 100);
  const usagePct = pct(row.business_spent_this_month_usd, row.business_monthly_cap_usd);
  const accent   = errPct > 10 ? '#c96356' : usagePct >= 90 ? '#c96356' : usagePct >= 70 ? '#d49b5a' : '#788c5d';

  return (
    <section className={`rounded-2xl border border-ant-line bg-ant-paper overflow-hidden ${isOff ? 'opacity-75' : ''}`}>
      <div className="px-5 py-4">
        {/* Top */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-ant-line-soft ring-1 ring-ant-line flex items-center justify-center">
            <Building2 className="w-5 h-5 text-ant-mid" strokeWidth={1.6} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-display text-[16px] font-semibold text-ant-ink truncate tracking-[-0.01em]">{row.business_name}</h3>
              <ModeBadge mode={(row.default_mode as any) ?? 'off'} />
            </div>
            <p className="font-serif-display italic text-[11.5px] text-ant-muted mt-1">
              Last reply {timeAgo(row.last_decision_at)}{row.pending_reviews > 0 && <> · <span className="not-italic text-ant-orange font-medium">{row.pending_reviews} pending</span></>}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-3 gap-y-2 gap-x-3">
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Spend</p>
            <p className="text-[12.5px] font-medium text-ant-ink tabular-nums leading-tight mt-0.5">
              {fmtUsd(row.business_spent_this_month_usd)}
              <span className="text-[10.5px] text-ant-muted"> / {fmtUsd(row.business_monthly_cap_usd)}</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Skills live</p>
            <p className="text-[12.5px] font-medium text-ant-ink tabular-nums leading-tight mt-0.5">{row.live_skills_count}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Errors 7d</p>
            <p className={`text-[12.5px] font-medium tabular-nums leading-tight mt-0.5 ${errPct > 10 ? 'text-ant-rose' : 'text-ant-ink'}`}>
              {errPct}%
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-3">
          <div className="h-[3px] rounded-full overflow-hidden bg-ant-line/70">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, usagePct)}%`, backgroundColor: accent }}
            />
          </div>
          <p className="text-[10.5px] text-ant-muted tabular-nums mt-1.5">{usagePct}% of cap</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-ant-line bg-ant-line-soft/30 flex items-center justify-end gap-2">
        <Button
          size="sm" variant="ghost" onClick={onResetSpend} disabled={resetting}
          className="rounded-full h-7 text-[11px] text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft px-3"
        >
          {resetting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : 'Reset spend'}
        </Button>
        <Button
          size="sm" variant="ghost"
          disabled={isOff || pausing}
          onClick={onForcePause}
          className="rounded-full h-7 text-[11px] text-ant-rose hover:text-ant-rose hover:bg-ant-rose/10 px-3"
        >
          {pausing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : 'Force pause'}
        </Button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────
function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-[9.5px] uppercase tracking-[0.22em] text-ant-mid font-semibold">{children}</p>;
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

function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const map = {
    low:    'text-ant-blue bg-ant-blue/10 ring-ant-blue/20',
    medium: 'text-ant-orange bg-ant-orange/10 ring-ant-orange/20',
    high:   'text-ant-rose bg-ant-rose/10 ring-ant-rose/20',
  };
  return <span className={`text-[9.5px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded font-semibold ring-1 ${map[severity]}`}>{severity}</span>;
}

function ActionBadge({ action }: { action: 'log' | 'escalate' | 'block' }) {
  const map = {
    log:      'text-ant-mid bg-ant-line-soft ring-ant-line',
    escalate: 'text-ant-orange bg-ant-orange/10 ring-ant-orange/20',
    block:    'text-ant-rose bg-ant-rose/10 ring-ant-rose/20',
  };
  return <span className={`text-[9.5px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded font-semibold ring-1 ${map[action]}`}>{action}</span>;
}

function StatusPulse({ ok }: { ok: boolean }) {
  const color = ok ? '#788c5d' : '#c96356';
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className="absolute w-3 h-3 rounded-full opacity-50 animate-ping" style={{ backgroundColor: color }} />
      <span className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function StatTile({
  label, value, hint, accent = 'neutral',
}: {
  label: string;
  value: number | string;
  hint: string;
  accent?: 'neutral' | 'green' | 'red';
}) {
  const accentTextCls =
    accent === 'green'  ? 'text-ant-green' :
    accent === 'red'    ? 'text-ant-rose' :
                          'text-ant-ink';
  return (
    <div className="rounded-xl border border-ant-line bg-ant-paper px-4 py-3.5">
      <Kicker>{label}</Kicker>
      <p className={`mt-2 font-display text-[34px] font-semibold tabular-nums tracking-[-0.025em] leading-[1] ${accentTextCls}`}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-ant-muted leading-snug">{hint}</p>
    </div>
  );
}

function CountPill({ label, value, color, dotCls }: { label: string; value: number; color: string; dotCls: string }) {
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      <span className={`font-semibold ${color}`}>{value}</span>
      <span className="text-ant-muted">{label}</span>
    </span>
  );
}
