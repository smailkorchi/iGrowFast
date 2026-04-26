import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  Cpu,
  FileSignature,
  FileText,
  Hand,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  MapPinned,
  MessageCircle,
  MessageSquareQuote,
  Minus,
  Package,
  PackagePlus,
  Pencil,
  PhoneCall,
  Plus,
  Receipt,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Tag,
  ThumbsDown,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────
type ThreadMode = 'off' | 'static' | 'dynamic' | 'agent';
type Tone = 'warm' | 'professional' | 'playful' | 'formal';
type Language = 'darija' | 'french' | 'arabic' | 'english';
type SkillMode = 'sandbox' | 'live';
type SafetyTier = 'safe_by_default' | 'opt_in' | 'sandbox_required';

interface BrainConfig {
  business_id: string;
  default_mode: ThreadMode;
  language: Language;
  tone: Tone;
  persona_summary: string | null;
  fallback_text_when_paused: string | null;
  sandbox_globally: boolean;
  monthly_cap_usd: number;
  spent_this_month_usd: number;
  quota_status: string;
  human_takeover_pause_minutes: number;
  max_consecutive_ai_messages: number;
}

interface HealthRow {
  business_id: string;
  default_mode: ThreadMode | null;
  business_monthly_cap_usd: number;
  business_spent_this_month_usd: number;
  business_quota_status: string | null;
  platform_monthly_cap_usd: number;
  platform_spent_this_month_usd: number;
  platform_keys_all_active: boolean | null;
  pending_reviews: number;
  last_decision_at: string | null;
  error_rate_7d: number | null;
  live_skills_count: number;
  sandbox_skills_count: number;
}

interface FaqRow {
  id: string;
  source_label: string | null;
  metadata: { question?: string; answer?: string };
  active: boolean;
  updated_at: string | null;
}

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  default_safety_tier: SafetyTier;
  bs_id: string | null;
  enabled: boolean;
  mode: SkillMode;
}

interface DecisionRow {
  id: string;
  outcome: string;
  brain_intent: any;
  cost_usd: number;
  latency_ms: number | null;
  tongue_output: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────
function getActiveBusinessId(): string | null {
  return localStorage.getItem('activeBusinessId');
}

function fmtUsd(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

function fmtPct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────
export default function AIBrainConsole() {
  const businessId = getActiveBusinessId();
  if (!businessId) {
    return (
      <div className="ant-surface flex items-center justify-center h-64 text-ant-muted text-sm">
        No active business selected.
      </div>
    );
  }
  return (
    <div className="ant-surface space-y-5">
      <Header />
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="bg-ant-paper border border-ant-line rounded-xl p-1 h-auto inline-flex flex-wrap">
          {[
            { v: 'overview', label: 'Overview' },
            { v: 'review', label: 'Review Queue', badge: true },
            { v: 'brain', label: 'Brain Setup' },
            { v: 'rules', label: 'Rules' },
            { v: 'knowledge', label: 'FAQs' },
            { v: 'index', label: 'Knowledge Index' },
            { v: 'skills', label: 'Skills' },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-ant-mid data-[state=active]:bg-ant-ink data-[state=active]:text-ant-paper transition-colors flex items-center gap-1.5"
            >
              {t.label}
              {t.badge && <PendingBadge businessId={businessId} />}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><OverviewTab businessId={businessId} /></TabsContent>
        <TabsContent value="review"><ReviewQueueTab businessId={businessId} /></TabsContent>
        <TabsContent value="brain"><BrainSetupTab businessId={businessId} /></TabsContent>
        <TabsContent value="rules"><RulesTab businessId={businessId} /></TabsContent>
        <TabsContent value="index"><IndexTab businessId={businessId} /></TabsContent>
        <TabsContent value="knowledge"><KnowledgeTab businessId={businessId} /></TabsContent>
        <TabsContent value="skills"><SkillsTab businessId={businessId} /></TabsContent>
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
          <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid">DigiCom AI</p>
          <h1 className="font-display text-[20px] font-semibold text-ant-ink leading-tight">AI Brain</h1>
          <p className="font-serif-display italic text-[12px] text-ant-mid mt-0.5">
            Configure how your WhatsApp brain reads, thinks, and replies.
          </p>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// OVERVIEW TAB — editorial dashboard
//
// Layout (mobile = stacks):
//   1. HERO. Status pulse + headline spend number + 14-day spark + meta line.
//   2. THREE TILES. Approvals · Today's throughput vs yesterday · 7-day reliability.
//   3. CAPACITY STRIP. Quiet horizontal facts (your cap, platform cap, keys, skills).
//   4. ACTIVITY. Narrative stream of last 10 decisions.
// ──────────────────────────────────────────────────────────────────────
function OverviewTab({ businessId }: { businessId: string }) {
  const { data: health, isLoading: hl } = useQuery<HealthRow | null>({
    queryKey: ['ai-brain-health', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_business_health')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle();
      return data as HealthRow | null;
    },
    refetchInterval: 30_000,
  });

  const { data: decisions } = useQuery<DecisionRow[]>({
    queryKey: ['ai-brain-recent-decisions', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_decisions')
        .select('id, outcome, brain_intent, cost_usd, latency_ms, tongue_output, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data || []) as DecisionRow[];
    },
    refetchInterval: 30_000,
  });

  // 14-day decision counts for the hero sparkline + today/yesterday delta.
  // Pulled in one round-trip (max 14d window, capped at 5k rows for safety).
  const { data: trend } = useQuery<{ counts: number[]; today: number; yesterday: number }>({
    queryKey: ['ai-brain-trend-14d', businessId],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('ai_decisions')
        .select('created_at')
        .eq('business_id', businessId)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(5000);
      const buckets = new Array(14).fill(0);
      const todayKey = new Date().toISOString().slice(0, 10);
      const yKey = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let today = 0;
      let yesterday = 0;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      for (const r of (data || []) as { created_at: string }[]) {
        const d = new Date(r.created_at);
        const dayKey = r.created_at.slice(0, 10);
        if (dayKey === todayKey) today++;
        if (dayKey === yKey) yesterday++;
        const idx = 13 - Math.floor((todayStart.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
        if (idx >= 0 && idx < 14) buckets[idx]++;
      }
      return { counts: buckets, today, yesterday };
    },
    refetchInterval: 60_000,
  });

  if (hl || !health) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const bizPct = fmtPct(health.business_spent_this_month_usd, health.business_monthly_cap_usd);
  const platPct = fmtPct(health.platform_spent_this_month_usd, health.platform_monthly_cap_usd);
  const platOk = health.platform_keys_all_active ?? false;
  const errPct = Math.round((health.error_rate_7d ?? 0) * 100);
  const isLive = health.default_mode === 'agent';
  const isOff = !health.default_mode || health.default_mode === 'off';
  const sparkData = (trend?.counts || new Array(14).fill(0)).map((v, i) => ({ i, v }));
  const today = trend?.today ?? 0;
  const yesterday = trend?.yesterday ?? 0;
  const dayDelta = today - yesterday;

  return (
    <div className="space-y-4">
      {/* ─────────────  HERO  ───────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-0">
          {/* Left: status + spend headline */}
          <div className="px-6 md:px-7 py-6 md:py-7">
            <div className="flex items-center gap-2.5">
              <StatusPulse live={isLive} off={isOff} />
              <span className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${isLive ? 'text-ant-green' : isOff ? 'text-ant-mid' : 'text-ant-orange'}`}>
                {isLive ? 'Live' : isOff ? 'Off' : (health.default_mode || '').toUpperCase()}
              </span>
              <span className="text-[10px] text-ant-muted">·</span>
              <span className="text-[10px] text-ant-mid">last reply {timeAgo(health.last_decision_at)}</span>
            </div>

            <div className="mt-5 flex items-baseline gap-2.5 flex-wrap">
              <span className="font-display text-[44px] md:text-[52px] font-semibold text-ant-ink leading-[0.95] tabular-nums tracking-[-0.03em]">
                {fmtUsd(health.business_spent_this_month_usd)}
              </span>
              <span className="font-serif-display italic text-[14px] text-ant-muted">spent of {fmtUsd(health.business_monthly_cap_usd)} this month</span>
            </div>

            <div className="mt-3.5 max-w-md">
              <div className="h-[3px] rounded-full overflow-hidden bg-ant-line/70">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, bizPct)}%`,
                    backgroundColor: bizPct >= 90 ? '#c96356' : bizPct >= 70 ? '#d49b5a' : '#788c5d',
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-ant-muted">
                {health.business_quota_status === 'exhausted'
                  ? <span className="text-ant-rose">Cap reached. AI paused until next month.</span>
                  : `${100 - bizPct}% remaining · ${bizPct}% of monthly budget used`}
              </p>
            </div>

            <div className="mt-5 flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-ant-mid">
                <span className="tabular-nums font-semibold text-ant-ink">{today}</span> decisions today
              </span>
              <span className="text-ant-muted">·</span>
              <span className="inline-flex items-center gap-1 text-ant-mid">
                {dayDelta > 0 ? <ArrowUpRight className="w-3 h-3 text-ant-green" /> : dayDelta < 0 ? <ArrowDownRight className="w-3 h-3 text-ant-rose" /> : <Minus className="w-3 h-3 text-ant-muted" />}
                <span className="tabular-nums">{dayDelta >= 0 ? '+' : ''}{dayDelta}</span>
                <span className="text-ant-muted">vs yesterday</span>
              </span>
              {(health.pending_reviews ?? 0) > 0 && (
                <>
                  <span className="text-ant-muted">·</span>
                  <span className="inline-flex items-center gap-1 text-ant-orange font-medium">
                    {health.pending_reviews} awaiting review
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right: 14-day sparkline */}
          <div className="px-6 md:px-7 py-6 md:py-7 border-t md:border-t-0 md:border-l border-ant-line bg-ant-line-soft/30 flex flex-col">
            <div className="flex items-center justify-between">
              <Kicker>14-day activity</Kicker>
              <span className="text-[10px] text-ant-muted tabular-nums">
                {sparkData.reduce((s, p) => s + p.v, 0)} total
              </span>
            </div>
            <div className="flex-1 mt-2 -mx-1 min-h-[80px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={80}>
                <AreaChart data={sparkData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="brainSparkFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c98654" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#c98654" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="#c98654"
                    strokeWidth={1.5}
                    fill="url(#brainSparkFill)"
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────  THREE TILES  ───────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile
          label="Awaiting review"
          value={health.pending_reviews ?? 0}
          hint={(health.pending_reviews ?? 0) === 0 ? 'Nothing pending — you’re clear.' : 'Sandbox actions waiting your decision.'}
          accent={(health.pending_reviews ?? 0) > 0 ? 'orange' : 'neutral'}
          dim={(health.pending_reviews ?? 0) === 0}
        />
        <StatTile
          label="Today"
          value={today}
          hint={
            yesterday === 0 && today === 0 ? 'No replies in the last 48h.' :
            yesterday === 0 ? `First decisions of the cycle.` :
            `${dayDelta >= 0 ? '+' : ''}${dayDelta} vs yesterday (${yesterday})`
          }
          accent="neutral"
        />
        <StatTile
          label="Reliability (7d)"
          value={`${100 - errPct}%`}
          hint={errPct === 0 ? 'No failures, blocks, or quota hits.' : `${errPct}% failed / blocked / quota`}
          accent={errPct === 0 ? 'green' : errPct >= 10 ? 'red' : 'neutral'}
        />
      </section>

      {/* ─────────────  CAPACITY STRIP  ───────────── */}
      <section className="rounded-xl border border-ant-line bg-ant-paper px-5 py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-0">
          <CapacityFact
            label="Your spend"
            value={fmtUsd(health.business_spent_this_month_usd)}
            sub={`of ${fmtUsd(health.business_monthly_cap_usd)} cap · ${bizPct}%`}
            danger={bizPct >= 90}
          />
          <CapacityDivider />
          <CapacityFact
            label="Platform"
            value={fmtUsd(health.platform_spent_this_month_usd)}
            sub={`of ${fmtUsd(health.platform_monthly_cap_usd)} cap · ${platPct}%`}
            danger={platPct >= 90}
          />
          <CapacityDivider />
          <CapacityFact
            label="Provider keys"
            value={platOk ? 'Active' : 'Issue'}
            sub={platOk ? 'All platform keys healthy' : 'A key is paused or exhausted'}
            tone={platOk ? 'green' : 'red'}
            icon={platOk ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          />
          <CapacityDivider />
          <CapacityFact
            label="Skills"
            value={String(health.live_skills_count ?? 0)}
            sub={`${health.sandbox_skills_count ?? 0} more in sandbox`}
          />
        </div>
      </section>

      {/* ─────────────  ACTIVITY  ───────────── */}
      <section className="rounded-xl border border-ant-line bg-ant-paper">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <Kicker>Recent decisions</Kicker>
          <span className="text-[10.5px] text-ant-muted">
            {decisions?.length ?? 0} shown · live refresh every 30s
          </span>
        </div>
        {!decisions || decisions.length === 0 ? (
          <p className="font-serif-display italic text-[12px] text-ant-muted px-5 py-8 text-center">
            No AI replies yet — your brain has been quiet.
          </p>
        ) : (
          <ul className="divide-y divide-ant-line">
            {decisions.map((d) => (
              <DecisionRowView key={d.id} decision={d} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Editorial-style activity row.
function DecisionRowView({ decision: d }: { decision: DecisionRow }) {
  const intent = d.brain_intent?.intent || 'other';
  const conf = d.brain_intent?.confidence != null ? Math.round(Number(d.brain_intent.confidence) * 100) : null;
  const dotColor =
    d.outcome === 'sent'              ? '#788c5d' :
    d.outcome === 'sandbox_pending'   ? '#c98654' :
    d.outcome === 'escalated'         ? '#d49b5a' :
                                        '#c96356';
  const reply = d.tongue_output || '';
  return (
    <li className="px-5 py-3 flex items-start gap-3 hover:bg-ant-line-soft/40 transition-colors">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-[10.5px] text-ant-mid">
          <span className="uppercase tracking-[0.16em] font-semibold text-ant-ink">{intent}</span>
          {conf != null && <span className="tabular-nums text-ant-muted">{conf}%</span>}
          <span className="text-ant-muted">·</span>
          <span className="text-ant-muted">{timeAgo(d.created_at)}</span>
          <span className="text-ant-muted">·</span>
          <span className="uppercase tracking-[0.14em] text-[9px] font-semibold" style={{ color: dotColor }}>{d.outcome.replace('_', ' ')}</span>
        </div>
        <p className="mt-1 text-[12px] text-ant-ink leading-relaxed line-clamp-2">
          {reply ? (
            <span className="font-serif-display italic">“{reply}”</span>
          ) : (
            <span className="font-serif-display italic text-ant-muted">no reply produced</span>
          )}
        </p>
      </div>
      <div className="text-right shrink-0 text-[10.5px] tabular-nums leading-tight pt-0.5">
        <p className="text-ant-mid">{d.latency_ms != null ? `${d.latency_ms} ms` : '—'}</p>
        <p className="text-ant-muted mt-0.5">${(d.cost_usd ?? 0).toFixed(4)}</p>
      </div>
    </li>
  );
}

// ─── Overview helpers ─────────────────────────────────────────────────
function StatusPulse({ live, off }: { live: boolean; off: boolean }) {
  if (off) return <span className="w-2 h-2 rounded-full bg-ant-mid/40 ring-2 ring-ant-mid/10" />;
  const color = live ? '#788c5d' : '#c98654';
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className="absolute w-3 h-3 rounded-full opacity-50 animate-ping" style={{ backgroundColor: color }} />
      <span className="relative w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function StatTile({
  label,
  value,
  hint,
  accent = 'neutral',
  dim = false,
}: {
  label: string;
  value: number | string;
  hint: string;
  accent?: 'neutral' | 'orange' | 'green' | 'red';
  dim?: boolean;
}) {
  const accentTextCls =
    accent === 'orange' ? 'text-ant-orange' :
    accent === 'green'  ? 'text-ant-green' :
    accent === 'red'    ? 'text-ant-rose' :
                          'text-ant-ink';
  return (
    <div className="rounded-xl border border-ant-line bg-ant-paper px-4 py-3.5">
      <Kicker>{label}</Kicker>
      <p className={`mt-2 font-display text-[34px] font-semibold tabular-nums tracking-[-0.025em] leading-[1] ${dim ? 'text-ant-mid/70' : accentTextCls}`}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] text-ant-muted leading-snug">{hint}</p>
    </div>
  );
}

function CapacityFact({
  label,
  value,
  sub,
  danger = false,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  danger?: boolean;
  tone?: 'green' | 'red';
  icon?: React.ReactNode;
}) {
  const valueCls =
    tone === 'green' ? 'text-ant-green' :
    tone === 'red'   ? 'text-ant-rose' :
    danger           ? 'text-ant-rose' :
                       'text-ant-ink';
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.2em] text-ant-mid font-semibold">{label}</p>
      <p className={`mt-1 text-[15px] font-medium ${valueCls} tabular-nums flex items-center gap-1.5 leading-tight`}>
        {icon}
        {value}
      </p>
      <p className="mt-0.5 text-[10.5px] text-ant-muted truncate">{sub}</p>
    </div>
  );
}

function CapacityDivider() {
  return <div className="hidden md:block w-px h-9 bg-ant-line mx-5 self-center" />;
}

// ──────────────────────────────────────────────────────────────────────
// BRAIN SETUP TAB — editorial configuration page
//
// Vertical sections, generous whitespace, opinionated controls:
//   1. Master switch (LIVE / OFF) hero card.
//   2. Persona — manifesto-style textarea with character meter.
//   3. Voice — language and tone as visual chip selectors w/ sample phrases.
//   4. Pause fallback — single field, italic helper.
//   5. Guardrails — sandbox toggle + three labeled steppers.
//   6. Models — locked, dignified strip.
//   7. Sticky save bar that materializes only when the form is dirty.
// ──────────────────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS: { value: Language; label: string; sub: string; sample: string }[] = [
  { value: 'darija',  label: 'Darija',  sub: 'Latin chat-script',     sample: 'salam, kifash n9der n3awnek?' },
  { value: 'french',  label: 'Français', sub: 'France / Maghreb',     sample: 'Bonjour, comment puis-je vous aider ?' },
  { value: 'arabic',  label: 'العربية',  sub: 'Modern Standard',      sample: 'السلام عليكم، كيف يمكنني مساعدتك؟' },
  { value: 'english', label: 'English',  sub: 'International',         sample: 'Hi, how can I help you today?' },
];

const TONE_OPTIONS: { value: Tone; label: string; sub: string; sample: string }[] = [
  { value: 'warm',         label: 'Warm',         sub: 'Friendly, human',   sample: 'salam 👋 ahla bik!' },
  { value: 'professional', label: 'Professional', sub: 'Crisp, neutral',    sample: 'Bonjour, comment puis-je vous aider ?' },
  { value: 'playful',      label: 'Playful',      sub: 'Lively, expressive', sample: 'salam! bghiti chi haja zwina? 🎉' },
  { value: 'formal',       label: 'Formal',       sub: 'Reserved, deferent', sample: 'Bonjour, je suis à votre service.' },
];

function BrainSetupTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<BrainConfig | null>({
    queryKey: ['ai-brain-config', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_business_brain')
        .select('business_id, default_mode, language, tone, persona_summary, fallback_text_when_paused, sandbox_globally, monthly_cap_usd, spent_this_month_usd, quota_status, human_takeover_pause_minutes, max_consecutive_ai_messages')
        .eq('business_id', businessId)
        .maybeSingle();
      return data as BrainConfig | null;
    },
  });

  const [form, setForm] = useState<BrainConfig | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async (next: BrainConfig) => {
      const { error } = await supabase.from('ai_business_brain').update({
        default_mode: next.default_mode,
        language: next.language,
        tone: next.tone,
        persona_summary: next.persona_summary,
        fallback_text_when_paused: next.fallback_text_when_paused,
        sandbox_globally: next.sandbox_globally,
        monthly_cap_usd: next.monthly_cap_usd,
        human_takeover_pause_minutes: next.human_takeover_pause_minutes,
        max_consecutive_ai_messages: next.max_consecutive_ai_messages,
        updated_at: new Date().toISOString(),
      }).eq('business_id', businessId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: 'Brain settings updated.' });
      qc.invalidateQueries({ queryKey: ['ai-brain-config', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-brain-health', businessId] });
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message || 'Unknown error', variant: 'destructive' }),
  });

  // Cmd/Ctrl + S to save when dirty.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        if (form && JSON.stringify(form) !== JSON.stringify(data) && !save.isPending) {
          ev.preventDefault();
          save.mutate(form);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, data, save]);

  if (isLoading || !form) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const dirty = JSON.stringify(form) !== JSON.stringify(data);
  const isLive = form.default_mode === 'agent';
  const personaLen = (form.persona_summary || '').length;
  const personaCap = 600;

  return (
    <div className="space-y-5 pb-20">
      {/* ─── 1. MASTER SWITCH ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="mt-1 shrink-0">
              <StatusPulse live={isLive} off={!isLive} />
            </div>
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${isLive ? 'text-ant-green' : 'text-ant-mid'}`}>
                {isLive ? 'AI is live' : 'AI is off'}
              </p>
              <h3 className="font-display text-[22px] md:text-[24px] font-semibold text-ant-ink mt-0.5 leading-tight tracking-[-0.02em]">
                {isLive
                  ? 'New WhatsApp messages will be answered automatically.'
                  : 'WhatsApp messages will not get an AI reply.'}
              </h3>
              <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
                {isLive
                  ? 'You can pause anytime. Sandbox skills still hold writes for your approval.'
                  : 'Flip the switch when you want the brain to start replying. All other settings stay as-is.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className={`text-[10.5px] uppercase tracking-[0.18em] font-semibold ${isLive ? 'text-ant-mid' : 'text-ant-ink'}`}>Off</span>
            <Switch
              checked={isLive}
              onCheckedChange={(v) => setForm({ ...form, default_mode: v ? 'agent' : 'off' })}
              className="data-[state=checked]:bg-ant-green"
            />
            <span className={`text-[10.5px] uppercase tracking-[0.18em] font-semibold ${isLive ? 'text-ant-ink' : 'text-ant-mid'}`}>Live</span>
          </div>
        </div>
      </section>

      {/* ─── 2. PERSONA ────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <SectionHead
            kicker="Persona"
            title="Tell the brain who it is."
            subtitle="One paragraph. The opener you'd write yourself, the rules you'd never break, the manners of your boutique."
          />
          <div className="mt-4 relative">
            <Textarea
              rows={6}
              value={form.persona_summary ?? ''}
              onChange={(e) => setForm({ ...form, persona_summary: e.target.value.slice(0, personaCap) })}
              placeholder={'Friendly Moroccan boutique selling smartwatches.\nReply concisely. Always confirm city before quoting delivery.\nOffer 24-hour exchange on any defect.'}
              className="rounded-xl border-ant-line bg-ant-light/50 text-[13px] leading-relaxed focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-4 py-3"
            />
            <span className={`absolute bottom-3 right-4 text-[10px] tabular-nums ${personaLen > personaCap * 0.9 ? 'text-ant-orange' : 'text-ant-muted'}`}>
              {personaLen}/{personaCap}
            </span>
          </div>
        </div>
      </section>

      {/* ─── 3. VOICE (language + tone) ────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <SectionHead
            kicker="Voice"
            title="Pick how it sounds."
            subtitle="Language is the script the brain writes in. Tone is the mood underneath."
          />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-2.5">Language</p>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <ChipChoice
                    key={opt.value}
                    active={form.language === opt.value}
                    onClick={() => setForm({ ...form, language: opt.value })}
                    label={opt.label}
                    sub={opt.sub}
                    sample={opt.sample}
                    rtl={opt.value === 'arabic'}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-2.5">Tone</p>
              <div className="grid grid-cols-2 gap-2">
                {TONE_OPTIONS.map((opt) => (
                  <ChipChoice
                    key={opt.value}
                    active={form.tone === opt.value}
                    onClick={() => setForm({ ...form, tone: opt.value })}
                    label={opt.label}
                    sub={opt.sub}
                    sample={opt.sample}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 4. PAUSE FALLBACK ─────────────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <SectionHead
            kicker="Pause fallback"
            title="What to send when the AI cannot reply."
            subtitle="Sent verbatim — when the brain is paused, blocked, the cap is reached, or a human just stepped in."
          />
          <div className="mt-4">
            <Textarea
              rows={3}
              value={form.fallback_text_when_paused ?? ''}
              onChange={(e) => setForm({ ...form, fallback_text_when_paused: e.target.value })}
              placeholder="Thank you. A human team member will reply shortly."
              className="rounded-xl border-ant-line bg-ant-light/50 text-[13px] leading-relaxed focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-4 py-3"
            />
          </div>
        </div>
      </section>

      {/* ─── 5. GUARDRAILS ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <SectionHead
            kicker="Guardrails"
            title="Cost ceiling and human handoff."
            subtitle="Hard limits. The brain stops automatically when any of these triggers."
          />
          <div className="mt-4 grid grid-cols-1 gap-4">
            {/* sandbox toggle row */}
            <div className="rounded-xl border border-ant-line bg-ant-light/40 px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ant-ink">Sandbox new skills</p>
                <p className="text-[11px] text-ant-muted leading-snug mt-0.5">
                  Newly enabled skills always require your approval first — they only go live after you've approved a few sample replies.
                </p>
              </div>
              <Switch
                checked={form.sandbox_globally}
                onCheckedChange={(v) => setForm({ ...form, sandbox_globally: v })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StepperField
                label="Monthly cap"
                suffix="USD"
                value={form.monthly_cap_usd}
                step={1}
                min={0}
                onChange={(n) => setForm({ ...form, monthly_cap_usd: Math.max(0, n) })}
                hint="Hard ceiling on the brain's cost this month."
              />
              <StepperField
                label="Pause after human"
                suffix="min"
                value={form.human_takeover_pause_minutes}
                step={5}
                min={0}
                onChange={(n) => setForm({ ...form, human_takeover_pause_minutes: Math.max(0, n) })}
                hint="When you reply to a thread, the AI stays out for this long."
              />
              <StepperField
                label="Max replies in a row"
                suffix="msgs"
                value={form.max_consecutive_ai_messages}
                step={1}
                min={1}
                onChange={(n) => setForm({ ...form, max_consecutive_ai_messages: Math.max(1, n) })}
                hint="If the AI hits this in one thread it escalates to a human."
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── 6. MODELS (locked) ────────────────────────────────────── */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <SectionHead
            kicker="Models"
            title="The stack behind the brain."
            subtitle="Locked for now. We'll open this up once the platform stabilises."
          />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <ModelChip role="Brain"     name="Claude Sonnet 4.6"     price="$3 / $15 per 1M" />
            <ModelChip role="Tongue"    name="GPT-4o-mini"           price="$0.15 / $0.60 per 1M" />
            <ModelChip role="STT"       name="Whisper-1"             price="$0.006 per audio min" />
            <ModelChip role="Embedding" name="text-embedding-3-small" price="$0.02 per 1M" />
          </div>
        </div>
      </section>

      {/* ─── 7. STICKY SAVE BAR ────────────────────────────────────── */}
      {dirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 px-3 w-full max-w-[680px] pointer-events-none">
          <div className="pointer-events-auto rounded-full border border-ant-line bg-ant-ink text-ant-paper shadow-2xl shadow-ant-ink/20 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-ant-orange shrink-0" />
              <p className="text-[12px] font-medium truncate">You have unsaved changes</p>
              <span className="hidden sm:inline text-[10px] text-ant-paper/60">
                · <kbd className="font-mono text-[9.5px] tracking-wide font-semibold bg-ant-paper/10 border border-ant-paper/15 rounded px-1.5 py-0.5 leading-none">⌘ S</kbd> to save
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm" variant="ghost"
                onClick={() => data && setForm(data)}
                disabled={save.isPending}
                className="rounded-full h-8 text-[11.5px] text-ant-paper/80 hover:text-ant-paper hover:bg-ant-paper/10"
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate(form)}
                disabled={save.isPending}
                className="rounded-full h-8 text-[11.5px] bg-ant-paper text-ant-ink hover:bg-ant-paper/90"
              >
                {save.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <><Save className="w-3.5 h-3.5 mr-1" /> Save changes</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brain Setup helpers ──────────────────────────────────────────────
function SectionHead({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return (
    <div>
      <Kicker>{kicker}</Kicker>
      <h3 className="font-display text-[18px] md:text-[20px] font-semibold text-ant-ink mt-1 leading-tight tracking-[-0.015em]">
        {title}
      </h3>
      <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
        {subtitle}
      </p>
    </div>
  );
}

function ChipChoice({
  active, onClick, label, sub, sample, rtl,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  sample: string;
  rtl?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border px-3.5 py-3 transition-all ${
        active
          ? 'border-ant-ink bg-ant-ink/[0.04] ring-2 ring-ant-ink/10'
          : 'border-ant-line bg-ant-paper hover:bg-ant-line-soft/60'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ant-ink">{label}</p>
        {active && <Check className="w-3.5 h-3.5 text-ant-ink" strokeWidth={2.5} />}
      </div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-ant-mid font-medium mt-0.5">{sub}</p>
      <p
        className={`mt-2 font-serif-display italic text-[12px] text-ant-muted leading-snug line-clamp-2 ${rtl ? 'text-right' : ''}`}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        “{sample}”
      </p>
    </button>
  );
}

function StepperField({
  label, suffix, value, step, min, onChange, hint,
}: {
  label: string;
  suffix: string;
  value: number;
  step: number;
  min: number;
  onChange: (n: number) => void;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-ant-line bg-ant-light/40 px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-ant-mid font-semibold">{label}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="font-display text-[26px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] bg-transparent border-0 outline-none focus:ring-0 p-0 w-[5.5ch]"
        />
        <span className="text-[11px] text-ant-mid font-medium">{suffix}</span>
      </div>
      <p className="text-[10.5px] text-ant-muted mt-1.5 leading-snug">{hint}</p>
    </div>
  );
}

function ModelChip({ role, name, price }: { role: string; name: string; price: string }) {
  return (
    <div className="rounded-xl border border-ant-line bg-ant-light/40 px-3.5 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ant-mid font-semibold">{role}</p>
        <span className="text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold px-1.5 py-0.5 rounded bg-ant-line">
          locked
        </span>
      </div>
      <p className="text-[13px] text-ant-ink font-semibold mt-1.5 flex items-center gap-1.5 truncate">
        <Cpu className="w-3 h-3 text-ant-mid shrink-0" /> {name}
      </p>
      <p className="text-[10.5px] text-ant-muted mt-0.5 tabular-nums">{price}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KNOWLEDGE TAB (FAQ CRUD)
// ──────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────
// FAQ TAB — composer + searchable list
// ──────────────────────────────────────────────────────────────────────
function KnowledgeTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState({ question: '', answer: '' });
  const [editing, setEditing] = useState<Record<string, { question: string; answer: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState<FaqRow | null>(null);
  const [search, setSearch] = useState('');

  const { data: faqs, isLoading } = useQuery<FaqRow[]>({
    queryKey: ['ai-brain-faqs', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_knowledge_chunks')
        .select('id, source_label, metadata, active, updated_at')
        .eq('business_id', businessId)
        .eq('source_kind', 'faq')
        .order('updated_at', { ascending: false });
      return (data || []) as FaqRow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (faq: { id?: string; question: string; answer: string; active?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('ai-faq-ingest', {
        body: { business_id: businessId, faqs: [faq] },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'unknown');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-brain-faqs', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-brain-health', businessId] });
    },
    onError: (e: any) => toast({ title: 'Save failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('ai_knowledge_chunks')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('business_id', businessId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-brain-faqs', businessId] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ai_knowledge_chunks')
        .delete()
        .eq('id', id)
        .eq('business_id', businessId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-brain-faqs', businessId] });
      toast({ title: 'Deleted', description: 'FAQ removed.' });
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  const onAdd = async () => {
    if (draft.question.trim().length < 2 || draft.answer.trim().length < 2) {
      toast({ title: 'Both fields required', description: 'Add a question and an answer (≥ 2 chars).', variant: 'destructive' });
      return;
    }
    await upsert.mutateAsync({ question: draft.question.trim(), answer: draft.answer.trim(), active: true });
    setDraft({ question: '', answer: '' });
    toast({ title: 'Added', description: 'FAQ embedded and saved.' });
  };

  const onEditSave = async (faq: FaqRow) => {
    const e = editing[faq.id];
    if (!e) return;
    await upsert.mutateAsync({ id: faq.id, question: e.question.trim(), answer: e.answer.trim(), active: faq.active });
    setEditing((s) => { const n = { ...s }; delete n[faq.id]; return n; });
    toast({ title: 'Updated', description: 'FAQ re-embedded.' });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return faqs || [];
    return (faqs || []).filter((f) =>
      (f.metadata?.question || '').toLowerCase().includes(q) ||
      (f.metadata?.answer || '').toLowerCase().includes(q)
    );
  }, [faqs, search]);

  const total = faqs?.length ?? 0;
  const activeCount = (faqs || []).filter((f) => f.active).length;

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <header>
        <Kicker>FAQs</Kicker>
        <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
          Teach the brain answers it can fall back on.
        </h2>
        <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
          Each FAQ is embedded with{' '}
          <code className="font-mono text-[11px] text-ant-mid not-italic">text-embedding-3-small</code> and retrieved by{' '}
          <code className="font-mono text-[11px] text-ant-mid not-italic">answer_faq</code> when a customer asks something close in meaning — even with different wording.
        </p>
      </header>

      {/* Composer */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Kicker>New FAQ</Kicker>
              <p className="font-serif-display italic text-[12px] text-ant-muted mt-1">
                Write the question the way your customer would type it. Write the answer the way you'd say it back.
              </p>
            </div>
            <Sparkles className="w-4 h-4 text-ant-orange shrink-0 mt-0.5" />
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-1.5">Question</p>
              <Textarea
                rows={3}
                placeholder="ch7al kayswa toswila l Casa?"
                value={draft.question}
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                className="rounded-xl border-ant-line bg-ant-light/40 text-[13px] leading-relaxed focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-3.5 py-2.5"
              />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-1.5">Answer</p>
              <Textarea
                rows={3}
                placeholder="Toswila l Casa kat-wsel f 24-48 sa3a, b 25 dh."
                value={draft.answer}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
                className="rounded-xl border-ant-line bg-ant-light/40 text-[13px] leading-relaxed focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-3.5 py-2.5"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end">
            <Button
              onClick={onAdd}
              disabled={upsert.isPending || !draft.question.trim() || !draft.answer.trim()}
              className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-5 text-[12px]"
            >
              {upsert.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <><Plus className="w-3.5 h-3.5 mr-1" /> Embed &amp; save</>}
            </Button>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-ant-line flex items-center justify-between gap-3 flex-wrap">
          <div>
            <Kicker>Saved FAQs</Kicker>
            <p className="text-[11px] text-ant-muted mt-0.5 tabular-nums">
              {total === 0
                ? 'No entries yet'
                : <><span className="font-medium text-ant-ink">{activeCount}</span> active · {total} total</>}
            </p>
          </div>
          {total > 0 && (
            <div className="relative w-full sm:w-72">
              <Input
                placeholder="Search question or answer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-full border-ant-line bg-ant-light/50 text-[12px] h-8 pl-3 pr-8 focus-visible:ring-ant-orange focus-visible:ring-offset-0"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ant-muted hover:text-ant-ink"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : total === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ant-orange/10 ring-1 ring-ant-orange/25 mb-3">
              <Sparkles className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
            </div>
            <p className="font-display text-[18px] font-semibold text-ant-ink">No FAQs yet.</p>
            <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1.5 max-w-sm mx-auto">
              Add the first ones — pricing, delivery, exchange policy. The brain will use them as context for every customer message.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-serif-display italic text-[12px] text-ant-muted py-8 text-center">
            No FAQ matches “{search}”.
          </p>
        ) : (
          <ul className="divide-y divide-ant-line">
            {filtered.map((f) => {
              const e = editing[f.id];
              const isEditing = !!e;
              const q = isEditing ? e.question : (f.metadata?.question || f.source_label || '');
              const a = isEditing ? e.answer   : (f.metadata?.answer   || '');
              return (
                <li key={f.id} className={`px-5 py-3.5 ${f.active ? '' : 'opacity-60'}`}>
                  {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-1.5">Question</p>
                        <Textarea
                          rows={2}
                          value={q}
                          onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, question: ev.target.value } })}
                          className="rounded-lg border-ant-line bg-ant-light/40 text-[12.5px] focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-3 py-2"
                          autoFocus
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ant-mid mb-1.5">Answer</p>
                        <Textarea
                          rows={2}
                          value={a}
                          onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, answer: ev.target.value } })}
                          className="rounded-lg border-ant-line bg-ant-light/40 text-[12.5px] focus-visible:ring-ant-orange focus-visible:ring-offset-0 resize-none px-3 py-2"
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center justify-end gap-2">
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => setEditing((s) => { const n = { ...s }; delete n[f.id]; return n; })}
                          className="rounded-full h-8 text-[11.5px] text-ant-mid"
                        >
                          <X className="w-3.5 h-3.5 mr-1" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => onEditSave(f)}
                          disabled={upsert.isPending || !q.trim() || !a.trim()}
                          className="rounded-full h-8 text-[11.5px] bg-ant-ink text-ant-paper hover:bg-ant-ink/90"
                        >
                          {upsert.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <><Check className="w-3.5 h-3.5 mr-1" /> Save &amp; re-embed</>}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ant-orange shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-ant-ink leading-snug">
                          {q || <span className="text-ant-muted italic font-normal">(no question)</span>}
                        </p>
                        <p className="text-[12.5px] text-ant-muted leading-relaxed mt-1 font-serif-display italic">
                          {a || <span className="not-italic">(no answer)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        <Switch
                          checked={f.active}
                          onCheckedChange={(v) => toggleActive.mutate({ id: f.id, active: v })}
                        />
                        <button
                          onClick={() => setEditing({ ...editing, [f.id]: { question: f.metadata?.question || '', answer: f.metadata?.answer || '' } })}
                          className="text-ant-mid hover:text-ant-blue transition-colors p-1"
                          aria-label="Edit FAQ"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(f)}
                          className="text-ant-mid hover:text-ant-rose transition-colors p-1"
                          aria-label="Delete FAQ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}
        kicker="Delete FAQ"
        title="Delete this FAQ?"
        description="The brain will stop using it as context. This cannot be undone."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirmDelete) return;
          await del.mutateAsync(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SKILLS TAB
// ──────────────────────────────────────────────────────────────────────
// Per-skill icon registry — Lucide-only, picked to read at a glance.
const SKILL_ICONS: Record<string, any> = {
  answer_faq:               HelpCircle,
  search_products:          Search,
  lookup_order_by_phone:    PhoneCall,
  explain_order_status:     ScrollText,
  check_delivery_zone:      MapPin,
  validate_morocco_address: MapPinned,
  quote_shipping_cost:      Truck,
  create_order:             ShoppingCart,
  confirm_cod_order:        CheckCircle2,
  recover_abandoned_cart:   RotateCcw,
  send_payment_reminder:    Wallet,
  apply_discount:           Tag,
  handle_exchange:          Repeat2,
  summarize_today_sales:    BarChart3,
  analyze_ads_roi:          TrendingUp,
  get_business_info:        Building2,
  get_product_details:      Info,
  send_product_media:       ImageIcon,
  apply_pricing_rule:       Calculator,
  generate_devis:           FileText,
  generate_facture:         FileSignature,
  create_delivery_note:     PackagePlus,
};

// Per-category styling — accent dot, ring, icon tint.
const CATEGORY_META: Record<string, { label: string; accent: string; tint: string; ring: string; iconText: string }> = {
  messaging:  { label: 'Messaging',  accent: 'bg-ant-blue',   tint: 'bg-ant-blue/10',   ring: 'ring-ant-blue/20',   iconText: 'text-ant-blue' },
  sales:      { label: 'Sales',      accent: 'bg-ant-orange', tint: 'bg-ant-orange/10', ring: 'ring-ant-orange/20', iconText: 'text-ant-orange' },
  orders:     { label: 'Orders',     accent: 'bg-ant-green',  tint: 'bg-ant-green/10',  ring: 'ring-ant-green/20',  iconText: 'text-ant-green' },
  support:    { label: 'Support',    accent: 'bg-ant-rose',   tint: 'bg-ant-rose/10',   ring: 'ring-ant-rose/20',   iconText: 'text-ant-rose' },
  analytics:  { label: 'Analytics',  accent: 'bg-ant-mid',    tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-ink' },
  moderation: { label: 'Moderation', accent: 'bg-ant-mid',    tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-ink' },
};

const CATEGORY_ORDER = ['messaging', 'sales', 'orders', 'support', 'analytics', 'moderation'];

function SkillsTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');

  const { data: skills, isLoading } = useQuery<SkillRow[]>({
    queryKey: ['ai-brain-skills', businessId],
    queryFn: async () => {
      const { data: catalog } = await supabase
        .from('ai_skills')
        .select('id, slug, name, description, category, default_safety_tier, deprecated')
        .eq('deprecated', false)
        .order('category', { ascending: true })
        .order('name',     { ascending: true });
      const { data: bizs } = await supabase
        .from('ai_business_skills')
        .select('id, skill_id, enabled, mode')
        .eq('business_id', businessId);
      const map = new Map<string, any>();
      (bizs || []).forEach((b: any) => map.set(b.skill_id, b));
      return (catalog || []).map((s: any) => {
        const b = map.get(s.id);
        return {
          ...s,
          bs_id:    b?.id ?? null,
          enabled:  b?.enabled ?? false,
          mode:     (b?.mode ?? 'sandbox') as SkillMode,
        };
      });
    },
  });

  const setEnabled = useMutation({
    mutationFn: async ({ skill, enabled }: { skill: SkillRow; enabled: boolean }) => {
      const mode: SkillMode = skill.default_safety_tier === 'safe_by_default' ? 'live' : 'sandbox';
      if (skill.bs_id) {
        const { error } = await supabase
          .from('ai_business_skills')
          .update({ enabled, mode, updated_at: new Date().toISOString() })
          .eq('id', skill.bs_id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('ai_business_skills')
          .insert({ business_id: businessId, skill_id: skill.id, enabled, mode });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-brain-skills', businessId] }),
    onError: (e: any) => toast({ title: 'Toggle failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  // Wired skills only — others stay hidden until implementation lands.
  const WIRED = new Set([
    'answer_faq', 'search_products', 'lookup_order_by_phone', 'explain_order_status',
    'check_delivery_zone', 'validate_morocco_address', 'quote_shipping_cost',
    'create_order', 'confirm_cod_order', 'recover_abandoned_cart', 'send_payment_reminder',
    'apply_discount', 'handle_exchange',
    'summarize_today_sales', 'analyze_ads_roi',
    'get_business_info', 'get_product_details', 'send_product_media',
    'apply_pricing_rule',
    'generate_devis', 'generate_facture', 'create_delivery_note',
  ]);
  const wired = (skills || []).filter((s) => WIRED.has(s.slug));

  const total       = wired.length;
  const enabledList = wired.filter((s) => s.enabled);
  const enabledCount   = enabledList.length;
  const liveCount      = enabledList.filter((s) => s.mode === 'live').length;
  const sandboxCount   = enabledList.filter((s) => s.mode === 'sandbox').length;

  // Filter
  const visible = wired.filter((s) => {
    if (filter === 'on')  return s.enabled;
    if (filter === 'off') return !s.enabled;
    return true;
  });

  // Group by category in semantic order
  const grouped: Record<string, SkillRow[]> = {};
  visible.forEach((s) => { (grouped[s.category] ||= []).push(s); });
  const groupOrder = CATEGORY_ORDER.filter((c) => grouped[c]?.length);

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Skills</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            What the brain is allowed to do.
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            The brain only sees enabled skills mid-conversation.{' '}
            <span className="text-ant-green font-medium not-italic">Live</span> skills act immediately.{' '}
            <span className="text-ant-orange font-medium not-italic">Sandbox</span> skills wait for your approval.
          </p>
        </div>

        {/* Counts */}
        <div className="flex items-center gap-4 text-[11px]">
          <CountPill label="Live"     value={liveCount}    color="text-ant-green"  dotCls="bg-ant-green" />
          <CountPill label="Sandbox"  value={sandboxCount} color="text-ant-orange" dotCls="bg-ant-orange" />
          <CountPill label="Off"      value={total - enabledCount} color="text-ant-mid" dotCls="bg-ant-mid/40" />
        </div>
      </header>

      {/* Filter segments */}
      <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
        {([
          { v: 'all', label: `All ${total}` },
          { v: 'on',  label: `On ${enabledCount}` },
          { v: 'off', label: `Off ${total - enabledCount}` },
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

      {/* Empty state */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-8 py-12 text-center">
          <p className="font-serif-display italic text-[13px] text-ant-muted">
            {filter === 'on'
              ? 'No skills enabled yet — the brain has nothing to call.'
              : filter === 'off'
                ? 'Every skill is on. Beautiful.'
                : 'No skills available.'}
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
                  <SkillCard
                    key={s.id}
                    skill={s}
                    busy={setEnabled.isPending}
                    onToggle={(v) => setEnabled.mutate({ skill: s, enabled: v })}
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

// ─── Skill card — one tile per skill ─────────────────────────────────
function SkillCard({
  skill, busy, onToggle,
}: {
  skill: SkillRow;
  busy: boolean;
  onToggle: (v: boolean) => void;
}) {
  const meta = CATEGORY_META[skill.category] || CATEGORY_META.messaging;
  const Icon = SKILL_ICONS[skill.slug] || Sparkles;
  const isLive    = skill.enabled && skill.mode === 'live';
  const isSandbox = skill.enabled && skill.mode === 'sandbox';
  const isOff     = !skill.enabled;
  const lockedSandbox = skill.default_safety_tier === 'sandbox_required';

  const stateText  = isLive ? 'Live' : isSandbox ? 'Sandbox' : 'Off';
  const stateClass = isLive
    ? 'text-ant-green bg-ant-green/10 ring-ant-green/20'
    : isSandbox
      ? 'text-ant-orange bg-ant-orange/10 ring-ant-orange/20'
      : 'text-ant-mid bg-ant-line-soft ring-ant-line';

  return (
    <button
      type="button"
      onClick={() => !busy && onToggle(!skill.enabled)}
      disabled={busy}
      className={`group text-left rounded-2xl border bg-ant-paper p-4 transition-all relative
        ${isOff
          ? 'border-ant-line opacity-65 hover:opacity-100 hover:border-ant-line/80'
          : 'border-ant-line shadow-[0_1px_0_rgba(0,0,0,0.02)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]'}
        ${busy ? 'cursor-wait' : 'cursor-pointer'}
      `}
    >
      {/* Top row: icon + state pill */}
      <div className="flex items-start justify-between gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ring-1 ${meta.tint} ${meta.ring}`}>
          <Icon className={`w-[18px] h-[18px] ${meta.iconText}`} strokeWidth={1.6} />
        </div>
        <span className={`text-[9.5px] uppercase tracking-[0.18em] font-semibold px-2 py-0.5 rounded-full ring-1 ${stateClass}`}>
          {stateText}
        </span>
      </div>

      {/* Title + description */}
      <h4 className="mt-3 font-display text-[14.5px] font-semibold text-ant-ink leading-tight tracking-[-0.01em]">
        {skill.name}
      </h4>
      <p className="text-[11.5px] text-ant-muted leading-relaxed mt-1 line-clamp-3 min-h-[44px]">
        {skill.description}
      </p>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-ant-line flex items-center justify-between">
        <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold text-ant-mid flex items-center gap-1.5">
          {lockedSandbox && <ShieldCheck className="w-3 h-3 text-ant-orange" />}
          {lockedSandbox ? 'Sandbox required' : skill.default_safety_tier === 'safe_by_default' ? 'Safe by default' : 'Opt-in'}
        </span>
        {/* Switch acts as a visual indicator and a backup target. The whole card is clickable. */}
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <Switch
            checked={skill.enabled}
            disabled={busy}
            onCheckedChange={onToggle}
          />
        </span>
      </div>

      {/* Faint accent strip at bottom when active */}
      {!isOff && (
        <span
          className={`absolute left-3 right-3 bottom-0 h-[2px] rounded-t-full transition-opacity ${
            isLive ? 'bg-ant-green/30' : 'bg-ant-orange/30'
          }`}
        />
      )}
    </button>
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

// ──────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-ant-line bg-ant-paper p-4 ${className}`}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9.5px] uppercase tracking-[0.2em] text-ant-mid font-semibold">{children}</p>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] font-medium text-ant-ink">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] text-ant-muted mt-1 leading-snug">{hint}</p> : null}
    </div>
  );
}

function ProgressBar({ pct, accent }: { pct: number; accent: string }) {
  return (
    <div className="mt-2 h-[3px] rounded-full overflow-hidden bg-ant-line/70">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: accent }} />
    </div>
  );
}

function ModeBadge({ mode }: { mode: ThreadMode }) {
  const cfg: Record<ThreadMode, { label: string; cls: string }> = {
    off:     { label: 'OFF',     cls: 'bg-ant-line-soft text-ant-mid' },
    static:  { label: 'STATIC',  cls: 'bg-ant-blue/10 text-ant-blue ring-1 ring-ant-blue/20' },
    dynamic: { label: 'DYNAMIC', cls: 'bg-ant-orange/10 text-ant-orange ring-1 ring-ant-orange/20' },
    agent:   { label: 'AGENT',   cls: 'bg-ant-green/10 text-ant-green ring-1 ring-ant-green/20' },
  };
  const c = cfg[mode];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-[0.16em] ${c.cls}`}>
      {c.label}
    </span>
  );
}

function SafetyBadge({ tier }: { tier: SafetyTier }) {
  const map: Record<SafetyTier, { label: string; cls: string }> = {
    safe_by_default:  { label: 'safe',    cls: 'text-ant-green bg-ant-green/10' },
    opt_in:           { label: 'opt-in',  cls: 'text-ant-blue bg-ant-blue/10' },
    sandbox_required: { label: 'sandbox', cls: 'text-ant-orange bg-ant-orange/10' },
  };
  const m = map[tier];
  return <span className={`text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}

function PhaseBadge({ text }: { text: string }) {
  return <span className="text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-ant-line-soft text-ant-mid">{text}</span>;
}

// ──────────────────────────────────────────────────────────────────────
// KNOWLEDGE INDEX — what the AI sees, per source, with re-index controls
// ──────────────────────────────────────────────────────────────────────
interface IndexRow {
  business_id: string;
  kind: string;
  enabled: boolean;
  last_indexed_at: string | null;
  rows_indexed: number;
  rows_total: number;
  last_error: string | null;
  dirty_at: string;
  needs_reindex: boolean;
  chunks_in_index: number;
}

type SourceKind = 'product' | 'customer' | 'order' | 'business_profile' | 'faq';

const SOURCE_META: Record<SourceKind, { label: string; hint: string; Icon: any; tint: string; ring: string; iconText: string }> = {
  product:          { label: 'Products',         hint: 'Names, codes, prices, descriptions, stock levels.',     Icon: Package,    tint: 'bg-ant-orange/10', ring: 'ring-ant-orange/20', iconText: 'text-ant-orange' },
  customer:         { label: 'Customers',        hint: 'Phone-keyed contacts, total orders, lifetime spend.',   Icon: Users,      tint: 'bg-ant-blue/10',   ring: 'ring-ant-blue/20',   iconText: 'text-ant-blue' },
  order:            { label: 'Orders',           hint: 'Recent orders, tracking numbers, current status.',     Icon: Receipt,    tint: 'bg-ant-green/10',  ring: 'ring-ant-green/20',  iconText: 'text-ant-green' },
  business_profile: { label: 'Business profile', hint: 'Legal name, address, phone, email, ICE, RC.',           Icon: Building2,  tint: 'bg-ant-line-soft', ring: 'ring-ant-line',      iconText: 'text-ant-mid' },
  faq:              { label: 'FAQs',             hint: 'Curated question / answer pairs (managed in FAQs tab).', Icon: HelpCircle, tint: 'bg-ant-rose/10',   ring: 'ring-ant-rose/20',   iconText: 'text-ant-rose' },
};

function IndexTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const [globalRunning, setGlobalRunning] = useState(false);

  const { data: rows, isLoading } = useQuery<IndexRow[]>({
    queryKey: ['ai-index-dashboard', businessId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('ai_indexation_dashboard')
        .select('business_id, kind, enabled, last_indexed_at, rows_indexed, rows_total, last_error, dirty_at, needs_reindex, chunks_in_index')
        .eq('business_id', businessId);
      return (data || []) as IndexRow[];
    },
    refetchInterval: 20_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ kind, enabled }: { kind: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from('ai_indexable_sources')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('business_id', businessId).eq('kind', kind);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-index-dashboard', businessId] }),
    onError: (e: any) => toast({ title: 'Toggle failed', description: e?.message, variant: 'destructive' }),
  });

  const reindex = async (kind: string) => {
    setRunning(kind);
    try {
      const { data, error } = await supabase.functions.invoke('ai-indexer', {
        body: { business_id: businessId, kind, force: true },
      });
      if (error) throw new Error(error.message);
      const r = (data?.results || [])[0];
      toast({ title: `Re-indexed ${SOURCE_META[kind as SourceKind]?.label || kind}`, description: r ? `${r.embedded ?? 0} of ${r.total ?? 0} embedded` : 'done' });
      qc.invalidateQueries({ queryKey: ['ai-index-dashboard', businessId] });
    } catch (e: any) {
      toast({ title: 'Re-index failed', description: e?.message, variant: 'destructive' });
    } finally { setRunning(null); }
  };

  const reindexAll = async () => {
    setGlobalRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-indexer', {
        body: { business_id: businessId, force: true },
      });
      if (error) throw new Error(error.message);
      const totalEmbedded = (data?.results || []).reduce((s: number, r: any) => s + (r.embedded || 0), 0);
      toast({ title: 'Re-indexed everything', description: `${totalEmbedded} chunks refreshed across ${data?.results?.length ?? 0} sources.` });
      qc.invalidateQueries({ queryKey: ['ai-index-dashboard', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-brain-health', businessId] });
    } catch (e: any) {
      toast({ title: 'Re-index failed', description: e?.message, variant: 'destructive' });
    } finally { setGlobalRunning(false); }
  };

  if (isLoading) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  // Stable, semantic ordering — products first, faqs last.
  const ORDER: SourceKind[] = ['product', 'customer', 'order', 'business_profile', 'faq'];
  const list = (rows || []).slice().sort((a, b) =>
    ORDER.indexOf(a.kind as SourceKind) - ORDER.indexOf(b.kind as SourceKind),
  );

  const totalChunks = list.reduce((s, r) => s + (r.chunks_in_index || 0), 0);
  const staleCount  = list.filter((r) => r.enabled && r.needs_reindex).length;
  const errorCount  = list.filter((r) => r.last_error).length;
  const lastRun     = list
    .map((r) => r.last_indexed_at)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | null;

  return (
    <div className="space-y-5 pb-6">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Knowledge index</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            What the brain reads about your business.
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            Each source is embedded into the brain's vector store. The indexer runs every 30&nbsp;min and on every change. Toggle a source off to keep it out of context.
          </p>
        </div>
        <Button
          onClick={reindexAll}
          disabled={globalRunning}
          className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-4 text-[12px]"
        >
          {globalRunning
            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Re-indexing…</>
            : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reindex all</>}
        </Button>
      </header>

      {/* ── Summary strip ────────────────────────────────────────── */}
      <section className="rounded-xl border border-ant-line bg-ant-paper px-5 py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-0">
          <CapacityFact
            label="Chunks in index"
            value={totalChunks.toLocaleString()}
            sub="Embedded vectors the brain can retrieve"
          />
          <CapacityDivider />
          <CapacityFact
            label="Sources"
            value={`${list.filter((r) => r.enabled).length} on`}
            sub={`${list.length} total · ${list.filter((r) => !r.enabled).length} muted`}
          />
          <CapacityDivider />
          <CapacityFact
            label="Freshness"
            value={staleCount === 0 ? 'All fresh' : `${staleCount} stale`}
            sub={staleCount === 0 ? 'No source needs a re-index' : 'Click "Reindex all" or per-source.'}
            tone={staleCount === 0 ? 'green' : undefined}
          />
          <CapacityDivider />
          <CapacityFact
            label="Last run"
            value={lastRun ? timeAgo(lastRun) : '—'}
            sub={errorCount > 0 ? `${errorCount} source had an error` : 'Auto-runs every 30 min'}
            tone={errorCount > 0 ? 'red' : undefined}
            icon={errorCount > 0 ? <AlertCircle className="w-3.5 h-3.5" /> : undefined}
          />
        </div>
      </section>

      {/* ── Source cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3">
        {list.map((r) => (
          <SourceCard
            key={r.kind}
            row={r}
            running={running === r.kind}
            onToggle={(v) => toggle.mutate({ kind: r.kind, enabled: v })}
            onReindex={() => reindex(r.kind)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Source card — one row per indexed source ────────────────────────
function SourceCard({
  row, running, onToggle, onReindex,
}: {
  row: IndexRow;
  running: boolean;
  onToggle: (v: boolean) => void;
  onReindex: () => void;
}) {
  const meta = SOURCE_META[row.kind as SourceKind] || SOURCE_META.business_profile;
  const Icon = meta.Icon;
  const isFaq = row.kind === 'faq';
  const stale = row.enabled && row.needs_reindex;
  const hasError = !!row.last_error;
  const muted = !row.enabled;

  // Coverage % — guarded for divide-by-zero; capped at 100.
  const total = row.rows_total || 0;
  const indexed = Math.min(total, row.rows_indexed || 0);
  const pct = total > 0 ? Math.round((indexed / total) * 100) : (indexed > 0 ? 100 : 0);

  const accentColor =
    hasError ? '#c96356' :
    stale    ? '#c98654' :
    muted    ? '#8a8478' :
               '#788c5d';

  return (
    <section className={`rounded-2xl border border-ant-line bg-ant-paper overflow-hidden transition-opacity ${muted ? 'opacity-70' : ''}`}>
      <div className="px-5 py-4 flex items-start gap-4">
        {/* Icon disc */}
        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${meta.tint} ${meta.ring}`}>
          <Icon className={`w-5 h-5 ${meta.iconText}`} strokeWidth={1.6} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-[16px] font-semibold text-ant-ink leading-tight tracking-[-0.01em]">{meta.label}</h3>
                {hasError && (
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold px-1.5 py-0.5 rounded bg-ant-rose/10 text-ant-rose">
                    Error
                  </span>
                )}
                {!hasError && stale && (
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold px-1.5 py-0.5 rounded bg-ant-orange/10 text-ant-orange">
                    Stale
                  </span>
                )}
                {!hasError && !stale && row.enabled && (
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold px-1.5 py-0.5 rounded bg-ant-green/10 text-ant-green">
                    Fresh
                  </span>
                )}
                {muted && (
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold px-1.5 py-0.5 rounded bg-ant-line-soft text-ant-mid">
                    Muted
                  </span>
                )}
              </div>
              <p className="font-serif-display italic text-[12px] text-ant-muted mt-1">
                {meta.hint}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Switch checked={row.enabled} onCheckedChange={onToggle} />
              <Button
                size="sm" variant="ghost"
                disabled={isFaq || running || !row.enabled}
                onClick={onReindex}
                className="rounded-full h-8 text-[11.5px] text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft px-3"
                title={isFaq ? 'FAQs are managed and indexed from the FAQs tab.' : 'Re-embed and refresh now.'}
              >
                {running
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Indexing…</>
                  : <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Reindex</>}
              </Button>
            </div>
          </div>

          {/* Stats grid */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-5">
            <Stat label="Chunks"     value={String(row.chunks_in_index ?? 0)} />
            <Stat label="Coverage"   value={total > 0 ? `${indexed} / ${total}` : '—'} />
            <Stat label="Last run"   value={row.last_indexed_at ? timeAgo(row.last_indexed_at) : 'never'} />
            <Stat label="Last edit"  value={row.dirty_at ? timeAgo(row.dirty_at) : '—'} />
          </div>

          {/* Coverage bar */}
          {total > 0 && row.enabled && (
            <div className="mt-3">
              <div className="h-[3px] rounded-full overflow-hidden bg-ant-line/70">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: accentColor }}
                />
              </div>
              <p className="mt-1.5 text-[10.5px] text-ant-muted tabular-nums">
                {pct}% indexed
              </p>
            </div>
          )}

          {/* Error message */}
          {hasError && (
            <div className="mt-3 rounded-lg border border-ant-rose/25 bg-ant-rose/[0.04] px-3 py-2">
              <p className="text-[9.5px] uppercase tracking-[0.18em] font-semibold text-ant-rose flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Indexer error
              </p>
              <p className="text-[11.5px] text-ant-ink mt-0.5 font-mono break-all leading-snug">
                {row.last_error}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">{label}</p>
      <p className="text-[12.5px] font-medium text-ant-ink tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// RULES TAB — business rules (always/never/policy) + pricing rules
// ──────────────────────────────────────────────────────────────────────
interface BusinessRule { id: string; kind: 'always_do'|'never_do'|'policy'|'tone_example'|'greeting'; text: string; priority: number; is_active: boolean; }
interface PricingRule  { id: string; product_id: string | null; product_name?: string | null; quantity_min: number; quantity_max: number | null; discount_pct: number | null; fixed_unit_price: number | null; free_shipping: boolean; notes: string | null; is_active: boolean; }

// ──────────────────────────────────────────────────────────────────────
// RULES TAB — editorial, always-do / never-do / policy / pricing
// ──────────────────────────────────────────────────────────────────────
type RuleKind = BusinessRule['kind'];
const RULE_KINDS: { kind: RuleKind; label: string; placeholder: string; accent: string; tint: string; ring: string }[] = [
  { kind: 'always_do',    label: 'Always do',    placeholder: 'e.g. "Confirm the customer\'s city before quoting delivery"',  accent: 'text-ant-green',  tint: 'bg-ant-green/[0.06]',  ring: 'ring-ant-green/20' },
  { kind: 'never_do',     label: 'Never do',     placeholder: 'e.g. "Never quote a competitor\'s price"',                   accent: 'text-ant-rose',   tint: 'bg-ant-rose/[0.05]',   ring: 'ring-ant-rose/20' },
  { kind: 'policy',       label: 'Policies',     placeholder: 'e.g. "24-hour exchange on any defect"',                       accent: 'text-ant-blue',   tint: 'bg-ant-blue/[0.05]',   ring: 'ring-ant-blue/20' },
  { kind: 'tone_example', label: 'Tone',         placeholder: 'e.g. "salam khouya, ahla bik!"',                              accent: 'text-ant-orange', tint: 'bg-ant-orange/[0.05]', ring: 'ring-ant-orange/20' },
  { kind: 'greeting',     label: 'Greeting',     placeholder: 'e.g. "salam 👋 ahla bik f Golden Design Pub!"',                accent: 'text-ant-mid',    tint: 'bg-ant-line-soft/60',  ring: 'ring-ant-line' },
];

function RulesTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draftPrice, setDraftPrice] = useState<{ product_id: string; quantity_min: number; quantity_max: string; discount_pct: string; fixed_unit_price: string; free_shipping: boolean; notes: string }>({
    product_id: '', quantity_min: 2, quantity_max: '', discount_pct: '', fixed_unit_price: '', free_shipping: false, notes: '',
  });

  const { data: rules } = useQuery<BusinessRule[]>({
    queryKey: ['ai-business-rules', businessId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ai_business_rules')
        .select('id, kind, text, priority, is_active')
        .eq('business_id', businessId)
        .order('kind').order('priority', { ascending: false });
      return (data || []) as BusinessRule[];
    },
  });
  const { data: prods } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['products-list', businessId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('products')
        .select('id, name').eq('"DigiCom Business"', businessId).eq('active', true).order('name').limit(500);
      return (data || []) as { id: string; name: string }[];
    },
  });
  const { data: priceRules } = useQuery<PricingRule[]>({
    queryKey: ['ai-pricing-rules', businessId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ai_pricing_rules')
        .select('id, product_id, quantity_min, quantity_max, discount_pct, fixed_unit_price, free_shipping, notes, is_active')
        .eq('business_id', businessId)
        .order('priority', { ascending: false });
      const rows = (data || []) as PricingRule[];
      const productMap = new Map((prods || []).map((p) => [p.id, p.name]));
      return rows.map((r) => ({ ...r, product_name: r.product_id ? productMap.get(r.product_id) || '—' : 'All products' }));
    },
    enabled: !!prods,
  });

  const addRule = useMutation({
    mutationFn: async ({ kind, text }: { kind: RuleKind; text: string }) => {
      if (!text.trim()) throw new Error('text required');
      const { error } = await (supabase as any).from('ai_business_rules')
        .insert({ business_id: businessId, kind, text: text.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-business-rules', businessId] }); toast({ title: 'Rule added' }); },
    onError: (e: any) => toast({ title: 'Add failed', description: e?.message, variant: 'destructive' }),
  });
  const delRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('ai_business_rules').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-business-rules', businessId] }),
  });
  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any).from('ai_business_rules').update({ is_active }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-business-rules', businessId] }),
  });

  const addPrice = useMutation({
    mutationFn: async () => {
      const product_id = draftPrice.product_id || null;
      const qmin = Math.max(1, Number(draftPrice.quantity_min || 1));
      const qmax = draftPrice.quantity_max === '' ? null : Math.max(qmin, Number(draftPrice.quantity_max));
      const pct  = draftPrice.discount_pct === '' ? null : Number(draftPrice.discount_pct);
      const fix  = draftPrice.fixed_unit_price === '' ? null : Number(draftPrice.fixed_unit_price);
      if (pct == null && fix == null && !draftPrice.free_shipping) throw new Error('Set discount %, fixed price, or free shipping');
      if (pct != null && fix != null) throw new Error('Pick one: discount % OR fixed price (not both)');
      const { error } = await (supabase as any).from('ai_pricing_rules').insert({
        business_id: businessId, product_id, quantity_min: qmin, quantity_max: qmax,
        discount_pct: pct, fixed_unit_price: fix, free_shipping: draftPrice.free_shipping, notes: draftPrice.notes || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-pricing-rules', businessId] });
      setDraftPrice({ product_id: '', quantity_min: 2, quantity_max: '', discount_pct: '', fixed_unit_price: '', free_shipping: false, notes: '' });
      toast({ title: 'Pricing rule added' });
    },
    onError: (e: any) => toast({ title: 'Add failed', description: e?.message, variant: 'destructive' }),
  });
  const delPrice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('ai_pricing_rules').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-pricing-rules', businessId] }),
  });

  const grouped = useMemo(() => {
    const g: Record<RuleKind, BusinessRule[]> = { always_do: [], never_do: [], policy: [], tone_example: [], greeting: [] };
    for (const r of rules || []) g[r.kind].push(r);
    return g;
  }, [rules]);

  return (
    <div className="space-y-5 pb-6">
      <header>
        <Kicker>Rules of the brain</Kicker>
        <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
          Tell the brain what to do — and what never to do.
        </h2>
        <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
          Every rule below is injected into the system prompt of every conversation. Be specific, short, and unambiguous.
        </p>
      </header>

      {/* Rule sections — one block per kind, top three shown by default */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {RULE_KINDS.slice(0, 3).map((cfg) => (
          <RuleGroup
            key={cfg.kind}
            cfg={cfg}
            rows={grouped[cfg.kind]}
            onAdd={(text) => addRule.mutateAsync({ kind: cfg.kind, text })}
            onToggle={(id, v) => toggleRule.mutate({ id, is_active: v })}
            onDelete={(id) => delRule.mutate(id)}
          />
        ))}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {RULE_KINDS.slice(3).map((cfg) => (
            <RuleGroup
              key={cfg.kind}
              cfg={cfg}
              rows={grouped[cfg.kind]}
              onAdd={(text) => addRule.mutateAsync({ kind: cfg.kind, text })}
              onToggle={(id, v) => toggleRule.mutate({ id, is_active: v })}
              onDelete={(id) => delRule.mutate(id)}
            />
          ))}
        </div>
      </div>

      {/* Pricing rules */}
      <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="px-6 md:px-7 py-5">
          <Kicker>Pricing rules</Kicker>
          <h3 className="font-display text-[18px] md:text-[20px] font-semibold text-ant-ink leading-tight mt-0.5 tracking-[-0.015em]">
            Quantity-tier discounts the brain applies automatically.
          </h3>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1 max-w-2xl">
            Per-product rules override the catch-all. The brain calls these via <code className="font-mono text-[11px] text-ant-mid">apply_pricing_rule</code> before quoting any multi-unit price.
          </p>

          {/* Composer */}
          <div className="mt-4 rounded-xl border border-ant-line bg-ant-light/40 p-3 space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-2">
              <Select value={draftPrice.product_id || '__all'} onValueChange={(v) => setDraftPrice({ ...draftPrice, product_id: v === '__all' ? '' : v })}>
                <SelectTrigger className="rounded-lg border-ant-line text-[12px] h-9 bg-ant-paper"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All products</SelectItem>
                  {(prods || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 rounded-lg border border-ant-line bg-ant-paper px-2 h-9">
                <span className="text-[10px] uppercase tracking-[0.14em] text-ant-mid font-semibold">qty ≥</span>
                <Input
                  type="number" min={1} value={draftPrice.quantity_min}
                  onChange={(e) => setDraftPrice({ ...draftPrice, quantity_min: Number(e.target.value) })}
                  className="border-0 bg-transparent text-[13px] tabular-nums h-7 px-1 focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-ant-line bg-ant-paper px-2 h-9">
                <span className="text-[10px] uppercase tracking-[0.14em] text-ant-mid font-semibold">qty ≤</span>
                <Input
                  type="number" value={draftPrice.quantity_max}
                  onChange={(e) => setDraftPrice({ ...draftPrice, quantity_max: e.target.value })}
                  placeholder="∞"
                  className="border-0 bg-transparent text-[13px] tabular-nums h-7 px-1 focus-visible:ring-0"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-2 items-stretch">
              <div className="flex items-center gap-1 rounded-lg border border-ant-line bg-ant-paper px-2 h-9">
                <span className="text-[10px] uppercase tracking-[0.14em] text-ant-mid font-semibold">discount</span>
                <Input
                  type="number" step="0.5" value={draftPrice.discount_pct}
                  onChange={(e) => setDraftPrice({ ...draftPrice, discount_pct: e.target.value })}
                  placeholder="0"
                  className="border-0 bg-transparent text-[13px] tabular-nums h-7 px-1 focus-visible:ring-0"
                />
                <span className="text-[10px] text-ant-mid">%</span>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-ant-line bg-ant-paper px-2 h-9">
                <span className="text-[10px] uppercase tracking-[0.14em] text-ant-mid font-semibold">fixed</span>
                <Input
                  type="number" step="0.5" value={draftPrice.fixed_unit_price}
                  onChange={(e) => setDraftPrice({ ...draftPrice, fixed_unit_price: e.target.value })}
                  placeholder="0.00"
                  className="border-0 bg-transparent text-[13px] tabular-nums h-7 px-1 focus-visible:ring-0"
                />
                <span className="text-[10px] text-ant-mid">dh</span>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-ant-line bg-ant-paper px-3 h-9 text-[11px] text-ant-mid cursor-pointer select-none">
                <input
                  type="checkbox" checked={draftPrice.free_shipping}
                  onChange={(e) => setDraftPrice({ ...draftPrice, free_shipping: e.target.checked })}
                  className="accent-ant-ink"
                />
                Free shipping
              </label>
              <Button
                onClick={() => addPrice.mutate()} disabled={addPrice.isPending}
                className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-5 text-[12px]"
              >
                {addPrice.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add rule</>}
              </Button>
            </div>
          </div>

          {/* List */}
          {(priceRules || []).length === 0 ? (
            <p className="font-serif-display italic text-[12px] text-ant-muted py-6 text-center mt-3">
              No pricing rules yet — the brain will quote the catalog price.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-ant-line">
              {(priceRules || []).map((r) => (
                <li key={r.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 py-2.5 items-center text-[12px] ${r.is_active ? '' : 'opacity-50'}`}>
                  <div className="min-w-0">
                    <p className="text-ant-ink font-medium truncate">{r.product_name}</p>
                    <p className="text-[10.5px] text-ant-mid tabular-nums mt-0.5">
                      qty {r.quantity_min}{r.quantity_max ? `–${r.quantity_max}` : '+'}
                    </p>
                  </div>
                  <span className="tabular-nums text-ant-ink font-medium text-right">
                    {r.discount_pct != null && <span className="text-ant-green">−{Number(r.discount_pct).toFixed(0)}%</span>}
                    {r.fixed_unit_price != null && <span>{Number(r.fixed_unit_price).toFixed(2)} dh</span>}
                    {r.free_shipping && (
                      <span className={`${r.discount_pct != null || r.fixed_unit_price != null ? 'ml-2' : ''} text-ant-blue text-[10px] uppercase tracking-[0.14em] font-semibold`}>
                        free ship
                      </span>
                    )}
                  </span>
                  <span className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold ${r.is_active ? 'text-ant-green' : 'text-ant-mid'}`}>
                    {r.is_active ? 'on' : 'off'}
                  </span>
                  <button
                    onClick={() => delPrice.mutate(r.id)}
                    className="text-ant-muted hover:text-ant-rose transition-colors p-1"
                    aria-label="Delete pricing rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Rule group: one editorial card per rule kind ─────────────────────
function RuleGroup({
  cfg, rows, onAdd, onToggle, onDelete,
}: {
  cfg: { kind: RuleKind; label: string; placeholder: string; accent: string; tint: string; ring: string };
  rows: BusinessRule[];
  onAdd: (text: string) => Promise<unknown>;
  onToggle: (id: string, v: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const v = draft.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onAdd(v);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`rounded-2xl border border-ant-line bg-ant-paper overflow-hidden`}>
      <div className={`px-5 pt-4 pb-3 border-b border-ant-line ${cfg.tint}`}>
        <div className="flex items-center justify-between">
          <p className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${cfg.accent}`}>{cfg.label}</p>
          <span className="text-[10.5px] text-ant-muted tabular-nums">
            {rows.length} {rows.length === 1 ? 'rule' : 'rules'}
          </span>
        </div>
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-b border-ant-line">
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={cfg.placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && draft.trim()) { e.preventDefault(); submit(); } }}
            className="rounded-lg border-ant-line bg-ant-paper text-[12.5px] h-9 focus-visible:ring-ant-orange focus-visible:ring-offset-0 flex-1"
          />
          <Button
            onClick={submit}
            disabled={busy || !draft.trim()}
            className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-3.5 text-[11.5px]"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
          </Button>
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <p className="font-serif-display italic text-[12px] text-ant-muted py-6 px-5 text-center">
          No {cfg.label.toLowerCase()} rules yet.
        </p>
      ) : (
        <ul className="divide-y divide-ant-line">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2.5 flex items-start gap-3 group">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.accent.replace('text-', 'bg-')}`} />
              <p className={`flex-1 text-[12.5px] leading-relaxed ${r.is_active ? 'text-ant-ink' : 'text-ant-muted line-through'}`}>
                {r.text}
              </p>
              <Switch checked={r.is_active} onCheckedChange={(v) => onToggle(r.id, v)} />
              <button
                onClick={() => onDelete(r.id)}
                className="text-ant-muted hover:text-ant-rose transition-colors p-1 -mr-1"
                aria-label="Delete rule"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingActionDetail({ action }: { action: PendingActionRow }) {
  const p = action.payload || {};
  if (action.kind === 'create_order') {
    const item = Array.isArray(p.items) ? p.items[0] : null;
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">Create order — COD</p>
        <p className="text-ant-mid">
          {item ? `${item.quantity} × ${item.product_name}` : '—'}
          {p.city?.name ? ` to ${p.city.name}` : ''}
          {p.shipping_provider ? ` via ${p.shipping_provider}` : ''}
        </p>
        <p className="tabular-nums text-ant-mid">
          Items {Number(p.items_total ?? 0).toFixed(2)} + shipping {Number(p.shipping_fee ?? 0).toFixed(2)} ={' '}
          <span className="font-semibold text-ant-ink">{Number(p.total ?? 0).toFixed(2)} MAD</span>
        </p>
      </div>
    );
  }
  if (action.kind === 'apply_discount') {
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">Apply discount on order #{String(p.order_id || '').slice(0, 8)}</p>
        <p className="text-ant-mid tabular-nums">
          {Number(p.discount_pct ?? 0).toFixed(0)}% off · {Number(p.old_price ?? 0).toFixed(2)} →{' '}
          <span className="font-semibold text-ant-ink">{Number(p.new_price ?? 0).toFixed(2)} MAD</span>
          <span className="text-ant-rose"> (−{Number(p.savings ?? 0).toFixed(2)})</span>
        </p>
        <p className="text-ant-muted italic">Reason: {p.reason || '—'}</p>
      </div>
    );
  }
  if (action.kind === 'handle_exchange') {
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">Exchange/return on order #{String(p.order_id || '').slice(0, 8)}</p>
        <p className="text-ant-mid tabular-nums">{Number(p.price ?? 0).toFixed(2)} MAD · {p.delivered ? 'delivered' : 'not yet delivered'}</p>
        <p className="text-ant-muted italic">Reason: {p.reason || '—'}</p>
      </div>
    );
  }
  if (action.kind === 'send_product_media') {
    const products = Array.isArray(p.products) ? p.products : [];
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">Send {products.length} product image{products.length === 1 ? '' : 's'}</p>
        <p className="text-ant-mid">{products.map((pp: any) => pp.name).filter(Boolean).join(', ') || '—'}</p>
        {p.caption ? <p className="text-ant-muted italic">Caption: {p.caption}</p> : null}
      </div>
    );
  }
  if (action.kind === 'generate_devis') {
    const lineCount = Array.isArray(p?.snapshot?.lines?.items) ? p.snapshot.lines.items.length : 0;
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">Generate devis for order #{String(p.order_id || '').slice(0, 8)}</p>
        <p className="text-ant-mid tabular-nums">
          {lineCount} line{lineCount === 1 ? '' : 's'} · HT {Number(p.subtotal_ht ?? 0).toFixed(2)} · TVA {Number(p.tva_rate ?? 0).toFixed(0)}% ={' '}
          <span className="font-semibold text-ant-ink">{Number(p.total_ttc ?? 0).toFixed(2)} MAD TTC</span>
        </p>
        {p.valid_until ? <p className="text-ant-muted italic">Valid until {new Date(p.valid_until).toLocaleDateString()}</p> : null}
      </div>
    );
  }
  if (action.kind === 'generate_facture') {
    const lineCount = Array.isArray(p?.snapshot?.lines?.items) ? p.snapshot.lines.items.length : 0;
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">
          Generate facture for order #{String(p.order_id || '').slice(0, 8)}
          {p.devis_reference ? <> · linked to {p.devis_reference}</> : null}
        </p>
        <p className="text-ant-mid tabular-nums">
          {lineCount} line{lineCount === 1 ? '' : 's'} · HT {Number(p.subtotal_ht ?? 0).toFixed(2)} · TVA {Number(p.tva_rate ?? 0).toFixed(0)}% ={' '}
          <span className="font-semibold text-ant-ink">{Number(p.total_ttc ?? 0).toFixed(2)} MAD TTC</span>
        </p>
        {p.due_date ? <p className="text-ant-muted italic">Due {new Date(p.due_date).toLocaleDateString()}{p.payment_terms ? ` · ${p.payment_terms}` : ''}</p> : null}
      </div>
    );
  }
  if (action.kind === 'create_delivery_note') {
    return (
      <div className="text-[11px] text-ant-ink space-y-0.5">
        <p className="font-medium">
          Push order #{String(p.order_id || '').slice(0, 8)} to {p.provider_name || 'carrier'}
          {p.is_replace ? ' (exchange)' : ''}
        </p>
        <p className="text-ant-mid tabular-nums">
          COD <span className="font-semibold text-ant-ink">{Number(p.cod_amount ?? 0).toFixed(2)} MAD</span>
          {p.parcel_data?.city_name ? ` · ${p.parcel_data.city_name}` : ''}
        </p>
        {p.parcel_data?.product_info ? <p className="text-ant-muted italic">{p.parcel_data.product_info}</p> : null}
      </div>
    );
  }
  return (
    <p className="text-[11px] text-ant-ink">
      <span className="font-medium">{action.kind}</span> · payload preview unavailable
    </p>
  );
}

// ──────────────────────────────────────────────────────────────────────
// REVIEW QUEUE — sandbox approval workflow
// ──────────────────────────────────────────────────────────────────────
interface PendingActionRow {
  id: string;
  kind: string;
  skill_slug: string;
  payload: any;
  status: string;
}

interface PendingReviewRow {
  decision_id: string;
  business_id: string;
  thread_id: string | null;
  inbound_message_id: string | null;
  brain_intent: any;
  tool_calls: any[];
  tongue_output: string | null;
  cost_usd: number;
  latency_ms: number | null;
  outcome_reason: string | null;
  created_at: string;
  deadline_at: string | null;
  inbound_text: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  pending_actions: PendingActionRow[];
}

function PendingBadge({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  // Realtime subscription so the badge count updates instantly (no 15s poll).
  useEffect(() => {
    const ch = supabase
      .channel(`ai-review-badge-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_review_queue', filter: `business_id=eq.${businessId}` },
        () => qc.invalidateQueries({ queryKey: ['ai-review-pending-count', businessId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId, qc]);
  const { data: count } = useQuery<number>({
    queryKey: ['ai-review-pending-count', businessId],
    queryFn: async () => {
      const { count: c } = await supabase
        .from('ai_review_queue')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'pending');
      return c ?? 0;
    },
    refetchInterval: 60_000,
  });
  if (!count) return null;
  return <span className="text-[9.5px] font-bold rounded-full bg-ant-orange text-ant-paper px-1.5 py-0.5 min-w-[18px] text-center tabular-nums leading-none">{count}</span>;
}

function ReviewQueueTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Realtime: instant updates when a sandboxed decision queues, an owner
  // approves elsewhere, or a pending action flips state.
  useEffect(() => {
    const ch = supabase
      .channel(`ai-review-queue-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_review_queue', filter: `business_id=eq.${businessId}` },
        () => { qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] }); qc.invalidateQueries({ queryKey: ['ai-review-pending-count', businessId] }); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ai_decisions', filter: `business_id=eq.${businessId}` },
        () => qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_pending_actions', filter: `business_id=eq.${businessId}` },
        () => qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId, qc]);

  const { data: rows, isLoading } = useQuery<PendingReviewRow[]>({
    queryKey: ['ai-review-queue', businessId],
    queryFn: async () => {
      const { data: queue } = await supabase
        .from('ai_review_queue')
        .select('id, decision_id, business_id, status, deadline_at, created_at, ai_decisions(thread_id, inbound_message_id, brain_intent, tool_calls, tongue_output, cost_usd, latency_ms, outcome_reason, created_at)')
        .eq('business_id', businessId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);
      const list = (queue || []) as any[];
      // Resolve inbound message text + contact info per row.
      const inboundIds = list.map((r) => r.ai_decisions?.inbound_message_id).filter(Boolean);
      const threadIds  = list.map((r) => r.ai_decisions?.thread_id).filter(Boolean);
      const [{ data: msgs }, { data: threads }] = await Promise.all([
        inboundIds.length
          ? supabase.from('wa_messages').select('id, text_content').in('id', inboundIds)
          : Promise.resolve({ data: [] }),
        threadIds.length
          ? supabase.from('wa_threads').select('id, contact_id').in('id', threadIds)
          : Promise.resolve({ data: [] }),
      ]);
      const msgMap = new Map((msgs || []).map((m: any) => [m.id, m.text_content as string | null]));
      const contactIds = (threads || []).map((t: any) => t.contact_id).filter(Boolean);
      const { data: contacts } = contactIds.length
        ? await supabase.from('wa_contacts').select('id, custom_name, whatsapp_name, phone_e164').in('id', contactIds)
        : { data: [] };
      const cMap = new Map((contacts || []).map((c: any) => [c.id, c]));
      const tMap = new Map((threads || []).map((t: any) => [t.id, t]));
      // Pending actions per decision (Phase 4 deferred writes)
      const decIds = list.map((r) => r.decision_id);
      const { data: pendingActs } = decIds.length
        ? await ((supabase as any)
            .from('ai_pending_actions')
            .select('id, decision_id, kind, skill_slug, payload, status')
            .in('decision_id', decIds)
            .eq('status', 'pending'))
        : { data: [] };
      const paMap = new Map<string, PendingActionRow[]>();
      (pendingActs || []).forEach((a: any) => {
        const arr = paMap.get(a.decision_id) || [];
        arr.push({ id: a.id, kind: a.kind, skill_slug: a.skill_slug, payload: a.payload, status: a.status });
        paMap.set(a.decision_id, arr);
      });
      return list.map((r): PendingReviewRow => {
        const d = r.ai_decisions || {};
        const t = tMap.get(d.thread_id);
        const c = t ? cMap.get(t.contact_id) : null;
        return {
          decision_id: r.decision_id,
          business_id: r.business_id,
          thread_id: d.thread_id ?? null,
          inbound_message_id: d.inbound_message_id ?? null,
          brain_intent: d.brain_intent ?? null,
          tool_calls: Array.isArray(d.tool_calls) ? d.tool_calls : [],
          tongue_output: d.tongue_output ?? null,
          cost_usd: Number(d.cost_usd ?? 0),
          latency_ms: d.latency_ms ?? null,
          outcome_reason: d.outcome_reason ?? null,
          created_at: r.created_at,
          deadline_at: r.deadline_at,
          inbound_text: d.inbound_message_id ? (msgMap.get(d.inbound_message_id) ?? null) : null,
          contact_name: c ? (c.custom_name || c.whatsapp_name || c.phone_e164 || null) : null,
          contact_phone: c?.phone_e164 ?? null,
          pending_actions: paMap.get(r.decision_id) || [],
        };
      });
    },
    // realtime drives invalidations; keep a 60s safety net
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: async ({ decisionId, action, override_text }: { decisionId: string; action: 'approve' | 'reject' | 'edit'; override_text?: string }) => {
      const { data, error } = await supabase.functions.invoke('ai-review-act', {
        body: { decision_id: decisionId, action, override_text },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok && action !== 'reject') throw new Error(data?.error || 'unknown');
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['ai-review-queue', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-review-pending-count', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-brain-health', businessId] });
      qc.invalidateQueries({ queryKey: ['ai-brain-recent-decisions', businessId] });
      const labels: any = { approve: 'Approved & sent', edit: 'Edited & sent', reject: 'Rejected' };
      toast({ title: labels[vars.action] || 'Done', description: data?.outcome ? `Outcome: ${data.outcome}` : undefined });
      setEditing((s) => { const n = { ...s }; delete n[vars.decisionId]; return n; });
    },
    onError: (e: any) => toast({ title: 'Action failed', description: e?.message || 'unknown', variant: 'destructive' }),
  });

  // Auto-select first row, and re-select when the current selection is
  // resolved (approved/edited/rejected) so the panel never dead-ends.
  useEffect(() => {
    if (!rows) return;
    if (rows.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !rows.find((r) => r.decision_id === selectedId)) {
      setSelectedId(rows[0].decision_id);
    }
  }, [rows, selectedId]);

  const selected = useMemo(
    () => rows?.find((r) => r.decision_id === selectedId) ?? null,
    [rows, selectedId],
  );
  const isEditingSelected = !!selected && editing[selected.decision_id] !== undefined;

  // Keyboard shortcuts. Skipped while typing in form fields so editing
  // a draft doesn't navigate away when you hit "j".
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (!rows || rows.length === 0) return;
      const tag = (ev.target as HTMLElement | null)?.tagName || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (ev.target as HTMLElement | null)?.isContentEditable) return;
      const idx = rows.findIndex((r) => r.decision_id === selectedId);
      if (ev.key === 'j' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        const n = rows[Math.min(rows.length - 1, idx + 1)];
        if (n) setSelectedId(n.decision_id);
      } else if (ev.key === 'k' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const p = rows[Math.max(0, idx - 1)];
        if (p) setSelectedId(p.decision_id);
      } else if (ev.key === 'a' && selected && !isEditingSelected) {
        if (selected.tongue_output && !act.isPending) {
          ev.preventDefault();
          act.mutate({ decisionId: selected.decision_id, action: 'approve' });
        }
      } else if (ev.key === 'r' && selected && !isEditingSelected && !act.isPending) {
        ev.preventDefault();
        act.mutate({ decisionId: selected.decision_id, action: 'reject' });
      } else if (ev.key === 'e' && selected && !isEditingSelected) {
        ev.preventDefault();
        setEditing((s) => ({ ...s, [selected.decision_id]: selected.tongue_output ?? '' }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selectedId, selected, isEditingSelected, act]);

  if (isLoading) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const total = rows?.length ?? 0;
  const writes = (rows || []).filter((r) => r.pending_actions.length > 0).length;

  return (
    <div className="space-y-4">
      {/* Editorial header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Kicker>Sandbox queue</Kicker>
          <h2 className="font-display text-[24px] md:text-[26px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] mt-0.5">
            {total === 0
              ? 'No replies waiting.'
              : <><span className="tabular-nums">{total}</span> {total === 1 ? 'reply' : 'replies'} awaiting your approval</>}
          </h2>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1">
            {total === 0
              ? 'When the AI is in sandbox mode, every drafted reply lands here first.'
              : <>{writes > 0 && <><span className="tabular-nums">{writes}</span> will write to your database on approve. </>}Approve, edit, or reject below.</>}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-1.5 text-[10px] text-ant-muted">
          <KbdHint k="J K" hint="navigate" />
          <KbdHint k="A"   hint="approve" />
          <KbdHint k="E"   hint="edit" />
          <KbdHint k="R"   hint="reject" />
        </div>
      </header>

      {total === 0 ? (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-8 py-14 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ant-green/10 ring-1 ring-ant-green/25 mb-3">
            <Check className="w-5 h-5 text-ant-green" strokeWidth={1.5} />
          </div>
          <p className="font-display text-[18px] font-semibold text-ant-ink">All clear.</p>
          <p className="font-serif-display italic text-[12.5px] text-ant-muted mt-1.5 max-w-sm mx-auto">
            Nothing to review. New sandbox decisions will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3">
          {/* Left rail: list */}
          <aside className="rounded-xl border border-ant-line bg-ant-paper overflow-hidden self-start max-h-[calc(100vh-220px)] overflow-y-auto">
            <ul className="divide-y divide-ant-line">
              {(rows || []).map((r) => (
                <ReviewListItem
                  key={r.decision_id}
                  row={r}
                  active={r.decision_id === selectedId}
                  onClick={() => setSelectedId(r.decision_id)}
                />
              ))}
            </ul>
          </aside>

          {/* Right detail */}
          <section>
            {selected && (
              <ReviewDetailPanel
                row={selected}
                isEditing={isEditingSelected}
                draft={isEditingSelected ? editing[selected.decision_id] : (selected.tongue_output ?? '')}
                onDraftChange={(v) => setEditing({ ...editing, [selected.decision_id]: v })}
                onStartEdit={() => setEditing({ ...editing, [selected.decision_id]: selected.tongue_output ?? '' })}
                onCancelEdit={() => setEditing((s) => { const n = { ...s }; delete n[selected.decision_id]; return n; })}
                onApprove={() => act.mutate({ decisionId: selected.decision_id, action: 'approve' })}
                onReject={() => act.mutate({ decisionId: selected.decision_id, action: 'reject' })}
                onSendEdit={() => act.mutate({ decisionId: selected.decision_id, action: 'edit', override_text: editing[selected.decision_id] })}
                pending={act.isPending}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Review queue helpers ────────────────────────────────────────────
function ReviewListItem({
  row, active, onClick,
}: {
  row: PendingReviewRow;
  active: boolean;
  onClick: () => void;
}) {
  const intent = row.brain_intent?.intent || 'other';
  const initials = (row.contact_name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
  const hasWrite = row.pending_actions.length > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-3.5 py-3 transition-colors relative flex items-start gap-3 ${
          active ? 'bg-ant-orange/[0.05]' : 'hover:bg-ant-line-soft/60'
        }`}
      >
        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-ant-orange" />}
        <span className="shrink-0 w-8 h-8 rounded-full bg-ant-line-soft text-ant-mid text-[10.5px] font-semibold tracking-wide flex items-center justify-center mt-0.5">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-ant-ink truncate">
              {row.contact_name || 'Unknown contact'}
            </p>
            <span className="text-[10px] text-ant-muted shrink-0 tabular-nums">{timeAgo(row.created_at)}</span>
          </div>
          <p className="text-[11px] text-ant-mid truncate font-serif-display italic mt-0.5">
            {row.inbound_text || '(no transcript)'}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">{intent}</span>
            {hasWrite && (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-ant-orange font-semibold px-1.5 py-px rounded bg-ant-orange/10">
                <AlertCircle className="w-2.5 h-2.5" /> writes
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function ReviewDetailPanel({
  row, isEditing, draft, pending,
  onDraftChange, onStartEdit, onCancelEdit, onApprove, onReject, onSendEdit,
}: {
  row: PendingReviewRow;
  isEditing: boolean;
  draft: string;
  pending: boolean;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSendEdit: () => void;
}) {
  const intent = row.brain_intent?.intent || '—';
  const conf = row.brain_intent?.confidence != null ? Math.round(Number(row.brain_intent.confidence) * 100) : null;

  return (
    <div className="rounded-xl border border-ant-line bg-ant-paper overflow-hidden">
      {/* Top meta bar */}
      <div className="px-5 py-3 border-b border-ant-line flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ant-ink truncate">{row.contact_name || 'Unknown contact'}</p>
          <p className="text-[10.5px] text-ant-muted tabular-nums">
            {row.contact_phone || '—'} · {timeAgo(row.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-ant-muted tabular-nums">
          <span className="uppercase tracking-[0.16em] font-semibold text-ant-ink">{intent}</span>
          {conf != null && <span>· {conf}%</span>}
          <span>· ${row.cost_usd.toFixed(4)}</span>
          <span>· {row.latency_ms != null ? `${row.latency_ms} ms` : '—'}</span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Customer */}
        <div>
          <Kicker>Customer said</Kicker>
          <div className="mt-1.5 rounded-lg bg-ant-line-soft border border-ant-line p-3.5">
            <p className="text-[13px] text-ant-ink leading-relaxed font-serif-display italic whitespace-pre-wrap">
              {row.inbound_text
                ? `“${row.inbound_text}”`
                : <span className="text-ant-muted">message text unavailable</span>}
            </p>
          </div>
        </div>

        {/* AI draft / editor */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Kicker>AI will reply</Kicker>
            {!isEditing && row.tongue_output && (
              <span className="text-[10px] text-ant-muted">{row.tongue_output.length} chars</span>
            )}
          </div>
          <div className={`rounded-lg p-3.5 border transition-colors ${isEditing ? 'border-ant-ink bg-ant-paper ring-2 ring-ant-ink/10' : 'border-ant-orange/25 bg-ant-orange/[0.04]'}`}>
            {isEditing ? (
              <Textarea
                rows={5}
                value={draft}
                onChange={(ev) => onDraftChange(ev.target.value)}
                className="w-full bg-transparent border-0 text-[13px] text-ant-ink leading-relaxed focus-visible:ring-0 focus-visible:outline-none resize-none p-0"
                placeholder="Write the message you want to send the customer…"
                autoFocus
              />
            ) : (
              <p className="text-[13px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                {row.tongue_output || <span className="font-serif-display italic text-ant-muted">no draft produced</span>}
              </p>
            )}
          </div>
          {row.outcome_reason && !isEditing && (
            <p className="text-[10.5px] text-ant-muted mt-1.5 italic">Note: {row.outcome_reason}</p>
          )}
        </div>

        {/* DB write panel */}
        {row.pending_actions.length > 0 && (
          <div className="rounded-lg border border-ant-orange/30 bg-ant-orange/[0.04] overflow-hidden">
            <div className="px-3.5 py-2 border-b border-ant-orange/20 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 text-ant-orange" />
              <span className="text-[9.5px] uppercase tracking-[0.18em] font-semibold text-ant-orange">
                Approving will also do this
              </span>
            </div>
            <div className="px-3.5 py-2.5 space-y-2 divide-y divide-ant-orange/15 [&>*+*]:pt-2.5">
              {row.pending_actions.map((a) => (
                <PendingActionDetail key={a.id} action={a} />
              ))}
            </div>
          </div>
        )}

        {/* Tools used (only when present) */}
        {row.tool_calls.length > 0 && (
          <div>
            <Kicker>Tools the brain called</Kicker>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {row.tool_calls.map((c: any, i: number) => (
                <span
                  key={i}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    c.ok ? 'bg-ant-blue/10 text-ant-blue' : 'bg-ant-rose/10 text-ant-rose'
                  }`}
                >
                  {c.skill_slug}{c.ok ? '' : ' ✗'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="px-5 py-3 border-t border-ant-line bg-ant-line-soft/40 flex items-center justify-end gap-2">
        {isEditing ? (
          <>
            <Button
              size="sm" variant="ghost" onClick={onCancelEdit}
              className="rounded-full h-8 text-[11.5px] text-ant-mid hover:bg-ant-line-soft"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
            <Button
              size="sm" disabled={pending || !draft.trim()} onClick={onSendEdit}
              className="rounded-full h-8 text-[11.5px] bg-ant-ink text-ant-paper hover:bg-ant-ink/90"
            >
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5 mr-1" /> Send edit</>}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm" variant="ghost" disabled={pending} onClick={onReject}
              className="rounded-full h-8 text-[11.5px] text-ant-rose hover:text-ant-rose hover:bg-ant-rose/10"
            >
              <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
            </Button>
            <Button
              size="sm" variant="ghost" disabled={pending} onClick={onStartEdit}
              className="rounded-full h-8 text-[11.5px] text-ant-blue hover:text-ant-blue hover:bg-ant-blue/10"
            >
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <Button
              size="sm" disabled={pending || !row.tongue_output} onClick={onApprove}
              className="rounded-full h-8 text-[11.5px] bg-ant-green text-ant-paper hover:bg-ant-green/90"
            >
              {pending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <><MessageSquareQuote className="w-3.5 h-3.5 mr-1" /> Approve &amp; send</>}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function KbdHint({ k, hint }: { k: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="font-mono text-[9.5px] tracking-wide font-semibold text-ant-ink bg-ant-paper border border-ant-line rounded px-1.5 py-0.5 leading-none">
        {k}
      </kbd>
      <span>{hint}</span>
    </span>
  );
}
