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
  BrainCircuit,
  Check,
  Cpu,
  Loader2,
  MessageSquareQuote,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  Trash2,
  X,
} from 'lucide-react';
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
            { v: 'index', label: 'Knowledge Index' },
            { v: 'knowledge', label: 'FAQs' },
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
// OVERVIEW TAB
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

  if (hl || !health) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const bizPct = fmtPct(health.business_spent_this_month_usd, health.business_monthly_cap_usd);
  const platPct = fmtPct(health.platform_spent_this_month_usd, health.platform_monthly_cap_usd);
  const platOk = health.platform_keys_all_active ?? false;
  const errPct = Math.round((health.error_rate_7d ?? 0) * 100);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Mode card */}
      <Card className="md:col-span-1">
        <Kicker>Status</Kicker>
        <div className="mt-2">
          <ModeBadge mode={health.default_mode ?? 'off'} />
        </div>
        <p className="mt-2 text-[11px] text-ant-muted">
          {health.default_mode === 'off'
            ? 'AI is disabled for this business. Turn it on under Brain Setup.'
            : 'AI is active. New incoming messages will be processed.'}
        </p>
      </Card>

      {/* Business spend */}
      <Card>
        <Kicker>Your monthly cap</Kicker>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-display text-[28px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em]">
            {fmtUsd(health.business_spent_this_month_usd)}
          </span>
          <span className="text-[11px] text-ant-muted">of {fmtUsd(health.business_monthly_cap_usd)}</span>
        </div>
        <ProgressBar pct={bizPct} accent={bizPct >= 90 ? '#c96356' : '#788c5d'} />
        <p className="mt-2 text-[10.5px] text-ant-muted">
          {health.business_quota_status === 'exhausted' ? 'Cap reached. AI paused until next month.' : `${100 - bizPct}% remaining`}
        </p>
      </Card>

      {/* Platform spend */}
      <Card>
        <Kicker>Platform cap (shared)</Kicker>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-display text-[28px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em]">
            {fmtUsd(health.platform_spent_this_month_usd)}
          </span>
          <span className="text-[11px] text-ant-muted">of {fmtUsd(health.platform_monthly_cap_usd)}</span>
        </div>
        <ProgressBar pct={platPct} accent={platPct >= 90 ? '#c96356' : '#6a9bcc'} />
        <p className="mt-2 text-[10.5px] text-ant-muted flex items-center gap-1">
          {platOk ? (
            <><ShieldCheck className="w-3 h-3 text-ant-green" /> All platform keys active</>
          ) : (
            <><AlertCircle className="w-3 h-3 text-ant-rose" /> A platform key is paused / exhausted</>
          )}
        </p>
      </Card>

      {/* Stats triple */}
      <Card>
        <Kicker>Skills live</Kicker>
        <p className="font-display text-[28px] font-semibold text-ant-ink tabular-nums mt-1.5">{health.live_skills_count}</p>
        <p className="text-[10.5px] text-ant-muted">
          {health.sandbox_skills_count} additional in sandbox
        </p>
      </Card>
      <Card>
        <Kicker>Sandbox queue</Kicker>
        <p className="font-display text-[28px] font-semibold text-ant-ink tabular-nums mt-1.5">{health.pending_reviews}</p>
        <p className="text-[10.5px] text-ant-muted">Pending owner approvals</p>
      </Card>
      <Card>
        <Kicker>Error rate (7d)</Kicker>
        <p className="font-display text-[28px] font-semibold text-ant-ink tabular-nums mt-1.5">{errPct}%</p>
        <p className="text-[10.5px] text-ant-muted">Failed / blocked / quota</p>
      </Card>

      {/* Recent activity */}
      <Card className="md:col-span-3">
        <div className="flex items-center justify-between mb-2">
          <Kicker>Recent decisions</Kicker>
          <span className="text-[10.5px] text-ant-muted">{decisions?.length ?? 0} shown · last activity {timeAgo(health.last_decision_at)}</span>
        </div>
        {!decisions || decisions.length === 0 ? (
          <p className="font-serif-display italic text-[11px] text-ant-muted py-4">No AI replies yet.</p>
        ) : (
          <div className="divide-y divide-ant-line">
            {decisions.map((d) => (
              <DecisionRowView key={d.id} decision={d} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DecisionRowView({ decision: d }: { decision: DecisionRow }) {
  const intent = d.brain_intent?.intent || '—';
  const conf = d.brain_intent?.confidence != null ? Math.round(Number(d.brain_intent.confidence) * 100) : null;
  const tone =
    d.outcome === 'sent' ? 'text-ant-ink' :
    d.outcome === 'escalated' ? 'text-ant-orange' :
    'text-ant-rose';
  return (
    <div className="grid grid-cols-[80px_120px_1fr_80px_70px] gap-2 py-2.5 items-center text-[11.5px]">
      <span className={`uppercase tracking-[0.16em] text-[9.5px] font-semibold ${tone}`}>{d.outcome}</span>
      <span className="text-ant-mid">
        {intent}{conf != null ? <span className="text-ant-muted"> · {conf}%</span> : null}
      </span>
      <span className="text-ant-ink truncate">{d.tongue_output || <span className="font-serif-display italic text-ant-muted">no reply</span>}</span>
      <span className="tabular-nums text-ant-mid text-right">{d.latency_ms != null ? `${d.latency_ms}ms` : '—'}</span>
      <span className="tabular-nums text-ant-mid text-right">${(d.cost_usd ?? 0).toFixed(4)}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BRAIN SETUP TAB
// ──────────────────────────────────────────────────────────────────────
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

  if (isLoading || !form) return <Skeleton className="h-96 w-full rounded-xl" />;

  const dirty = JSON.stringify(form) !== JSON.stringify(data);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card className="md:col-span-2">
        <Kicker>Persona &amp; tone</Kicker>
        <div className="mt-3 space-y-3">
          <Field label="Persona summary" hint="One paragraph that describes how the brain should behave.">
            <Textarea
              rows={4}
              value={form.persona_summary ?? ''}
              onChange={(e) => setForm({ ...form, persona_summary: e.target.value })}
              placeholder="Friendly Moroccan boutique selling smart watches. Reply concisely. Always confirm city before quoting delivery."
              className="rounded-lg border-ant-line bg-ant-paper text-[12px] focus-visible:ring-ant-orange resize-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as Language })}>
                <SelectTrigger className="rounded-lg border-ant-line"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="darija">Darija (Latin)</SelectItem>
                  <SelectItem value="french">French</SelectItem>
                  <SelectItem value="arabic">Arabic (MSA)</SelectItem>
                  <SelectItem value="english">English</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tone">
              <Select value={form.tone} onValueChange={(v) => setForm({ ...form, tone: v as Tone })}>
                <SelectTrigger className="rounded-lg border-ant-line"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="playful">Playful</SelectItem>
                  <SelectItem value="formal">Formal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Fallback text when AI is paused" hint="Sent verbatim if AI is offline / quota reached / blocked.">
            <Textarea
              rows={2}
              value={form.fallback_text_when_paused ?? ''}
              onChange={(e) => setForm({ ...form, fallback_text_when_paused: e.target.value })}
              className="rounded-lg border-ant-line bg-ant-paper text-[12px] focus-visible:ring-ant-orange resize-none"
            />
          </Field>
        </div>
      </Card>

      <div className="space-y-3">
        <Card>
          <Kicker>Default mode</Kicker>
          <div className="mt-3 space-y-2">
            {(['off', 'agent'] as ThreadMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ ...form, default_mode: m })}
                className={`w-full text-left px-2.5 py-2 rounded-lg border text-[11.5px] transition-colors ${
                  form.default_mode === m
                    ? 'border-ant-ink bg-ant-line-soft text-ant-ink'
                    : 'border-ant-line bg-ant-paper text-ant-mid hover:bg-ant-line-soft'
                }`}
              >
                <span className="font-medium uppercase tracking-[0.16em] text-[9.5px]">{m}</span>
                <p className="mt-1 text-[10.5px] text-ant-muted leading-snug">
                  {m === 'off'   && 'AI never replies.'}
                  {m === 'agent' && 'Brain reads incoming messages, retrieves FAQ context, drafts in your tone, sends.'}
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <Kicker>Safety &amp; limits</Kicker>
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-ant-ink">Sandbox new skills</p>
                <p className="text-[10.5px] text-ant-muted">Require owner approval before promotion to live.</p>
              </div>
              <Switch checked={form.sandbox_globally} onCheckedChange={(v) => setForm({ ...form, sandbox_globally: v })} />
            </div>
            <Field label="Monthly cap (USD)" hint="Hard ceiling on AI cost for your business this month.">
              <Input
                type="number" step="0.50" min={0}
                value={form.monthly_cap_usd}
                onChange={(e) => setForm({ ...form, monthly_cap_usd: Number(e.target.value) })}
                className="rounded-lg border-ant-line bg-ant-paper text-[12px]"
              />
            </Field>
            <Field label="Pause AI for X min after a human reply">
              <Input
                type="number" min={0}
                value={form.human_takeover_pause_minutes}
                onChange={(e) => setForm({ ...form, human_takeover_pause_minutes: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                className="rounded-lg border-ant-line bg-ant-paper text-[12px]"
              />
            </Field>
            <Field label="Max consecutive AI messages per thread">
              <Input
                type="number" min={1}
                value={form.max_consecutive_ai_messages}
                onChange={(e) => setForm({ ...form, max_consecutive_ai_messages: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                className="rounded-lg border-ant-line bg-ant-paper text-[12px]"
              />
            </Field>
          </div>
        </Card>
      </div>

      <Card className="md:col-span-3">
        <Kicker>Models (locked at Phase 1)</Kicker>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-4 gap-2.5">
          <ModelChip label="Brain"     name="Claude Sonnet 4.6"     hint="$3 / $15 per 1M" />
          <ModelChip label="Tongue"    name="GPT-4o-mini"           hint="$0.15 / $0.60 per 1M" />
          <ModelChip label="STT"       name="Whisper-1"             hint="$0.006 / min audio" />
          <ModelChip label="Embedding" name="text-embedding-3-small" hint="$0.02 / 1M" />
        </div>
      </Card>

      <div className="md:col-span-3 flex items-center justify-end gap-2">
        <Button variant="outline" onClick={() => data && setForm(data)} disabled={!dirty || save.isPending} className="rounded-full h-9">
          Discard
        </Button>
        <Button
          onClick={() => form && save.mutate(form)}
          disabled={!dirty || save.isPending}
          className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90"
        >
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function ModelChip({ label, name, hint }: { label: string; name: string; hint: string }) {
  return (
    <div className="rounded-lg border border-ant-line px-3 py-2 bg-ant-line-soft/50">
      <p className="text-[9.5px] uppercase tracking-[0.18em] text-ant-mid font-medium">{label}</p>
      <p className="text-[12px] text-ant-ink font-medium mt-1 flex items-center gap-1.5">
        <Cpu className="w-3 h-3 text-ant-mid" /> {name}
      </p>
      <p className="text-[10px] text-ant-muted mt-0.5">{hint}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// KNOWLEDGE TAB (FAQ CRUD)
// ──────────────────────────────────────────────────────────────────────
function KnowledgeTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState({ question: '', answer: '' });
  const [editing, setEditing] = useState<Record<string, { question: string; answer: string }>>({});
  const [confirmDelete, setConfirmDelete] = useState<FaqRow | null>(null);

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

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <Kicker>Add FAQ</Kicker>
            <p className="text-[10.5px] text-ant-muted mt-0.5">Each FAQ is embedded with text-embedding-3-small for retrieval.</p>
          </div>
          <Sparkles className="w-4 h-4 text-ant-orange" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            placeholder="Question…"
            value={draft.question}
            onChange={(e) => setDraft({ ...draft, question: e.target.value })}
            className="rounded-lg border-ant-line bg-ant-paper text-[12px]"
          />
          <Input
            placeholder="Answer…"
            value={draft.answer}
            onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
            className="rounded-lg border-ant-line bg-ant-paper text-[12px]"
          />
          <Button onClick={onAdd} disabled={upsert.isPending} className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90 px-4">
            {upsert.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <Kicker>Saved FAQs</Kicker>
          <span className="text-[10.5px] text-ant-muted">{faqs?.length ?? 0} entries</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : !faqs || faqs.length === 0 ? (
          <p className="font-serif-display italic text-[11px] text-ant-muted py-6 text-center">No FAQs yet. Add a few — the brain will use them as context.</p>
        ) : (
          <div className="divide-y divide-ant-line">
            {faqs.map((f) => {
              const e = editing[f.id];
              const isEditing = !!e;
              const q = isEditing ? e.question : (f.metadata?.question || f.source_label || '');
              const a = isEditing ? e.answer   : (f.metadata?.answer   || '');
              return (
                <div key={f.id} className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-start">
                  <div>
                    <p className="text-[9.5px] uppercase tracking-[0.18em] text-ant-mid mb-1">Q</p>
                    {isEditing ? (
                      <Input value={q} onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, question: ev.target.value } })} className="rounded-lg border-ant-line bg-ant-paper text-[12px]" />
                    ) : (
                      <p className="text-[12.5px] text-ant-ink leading-snug">{q}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[9.5px] uppercase tracking-[0.18em] text-ant-mid mb-1">A</p>
                    {isEditing ? (
                      <Input value={a} onChange={(ev) => setEditing({ ...editing, [f.id]: { ...e, answer: ev.target.value } })} className="rounded-lg border-ant-line bg-ant-paper text-[12px]" />
                    ) : (
                      <p className="text-[12.5px] text-ant-mid leading-snug">{a}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-1.5">
                    {isEditing ? (
                      <>
                        <Button size="sm" onClick={() => onEditSave(f)} disabled={upsert.isPending} className="rounded-full h-7 bg-ant-ink text-ant-paper text-[11px] px-3">
                          {upsert.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3 mr-1" /> Save</>}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing((s) => { const n = { ...s }; delete n[f.id]; return n; })} className="rounded-full h-7 text-[11px] px-3">
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Switch
                          checked={f.active}
                          onCheckedChange={(v) => toggleActive.mutate({ id: f.id, active: v })}
                        />
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...editing, [f.id]: { question: f.metadata?.question || '', answer: f.metadata?.answer || '' } })} className="rounded-full h-7 text-[11px] px-3">
                          Edit
                        </Button>
                        <button
                          onClick={() => setConfirmDelete(f)}
                          className="text-ant-rose hover:text-ant-rose/80 transition-colors p-1"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

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
function SkillsTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
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

  const grouped = useMemo(() => {
    const m: Record<string, SkillRow[]> = {};
    (skills || []).forEach((s) => { (m[s.category] ||= []).push(s); });
    return m;
  }, [skills]);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  // Skills wired end-to-end. Each appears as a real toggle.
  const WIRED = new Set([
    // Phase 2 (read-only)
    'answer_faq',
    'search_products',
    'lookup_order_by_phone',
    'explain_order_status',
    'check_delivery_zone',
    'validate_morocco_address',
    'quote_shipping_cost',
    // Phase 4 (write + support)
    'create_order',
    'confirm_cod_order',
    'recover_abandoned_cart',
    'send_payment_reminder',
    // Phase 4.5 (write)
    'apply_discount',
    'handle_exchange',
    // Phase 6 (owner-only analytics)
    'summarize_today_sales',
    'analyze_ads_roi',
    // Phase 9 (context + media)
    'get_business_info',
    'get_product_details',
    'send_product_media',
    // Phase 11 (pricing)
    'apply_pricing_rule',
    // Phase 16 (documents + carrier)
    'generate_devis',
    'generate_facture',
    'create_delivery_note',
  ]);
  const wired   = (skills || []).filter((s) => WIRED.has(s.slug));
  const roadmap = (skills || []).filter((s) => !WIRED.has(s.slug));

  const wiredByCat: Record<string, SkillRow[]> = {};
  wired.forEach((s) => { (wiredByCat[s.category] ||= []).push(s); });

  return (
    <div className="space-y-3">
      <Card>
        <Kicker>Active skills</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Toggle each skill independently. The brain decides which to call mid-conversation — only enabled tools are exposed to it.
        </p>
      </Card>
      {Object.entries(wiredByCat).map(([cat, items]) => (
        <Card key={cat}>
          <p className="text-[9.5px] uppercase tracking-[0.2em] text-ant-mid font-semibold mb-2">{cat}</p>
          <div className="divide-y divide-ant-line">
            {items.map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto] gap-2 py-2.5 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ant-ink truncate">{s.name}</p>
                    <SafetyBadge tier={s.default_safety_tier} />
                  </div>
                  <p className="text-[10.5px] text-ant-muted leading-snug mt-0.5">{s.description}</p>
                </div>
                <span className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold ${
                  s.mode === 'live' ? 'text-ant-green' : 'text-ant-orange'
                }`}>
                  {s.enabled ? s.mode : 'off'}
                </span>
                <Switch
                  checked={s.enabled}
                  disabled={setEnabled.isPending}
                  onCheckedChange={(v) => setEnabled.mutate({ skill: s, enabled: v })}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
      {roadmap.length > 0 && (
        <Card>
          <Kicker>Roadmap ({roadmap.length} more skills)</Kicker>
          <p className="text-[10.5px] text-ant-muted mt-0.5">
            Coming next: COD order confirmation, slot-filling, product picker, voice notes, abandoned-cart recovery, owner-only analytics.
          </p>
        </Card>
      )}
    </div>
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

function IndexTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState<string | null>(null);

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
      toast({ title: `Re-indexed ${kind}`, description: r ? `${r.embedded ?? 0} of ${r.total ?? 0} embedded` : 'done' });
      qc.invalidateQueries({ queryKey: ['ai-index-dashboard', businessId] });
    } catch (e: any) {
      toast({ title: 'Re-index failed', description: e?.message, variant: 'destructive' });
    } finally { setRunning(null); }
  };

  const KIND_DESC: Record<string, { label: string; hint: string; icon: string }> = {
    product:           { label: 'Products',          hint: 'Names, codes, prices, descriptions, stock levels.', icon: '📦' },
    customer:          { label: 'Customers',         hint: 'Phone-based dedup, total orders, lifetime spend.', icon: '👤' },
    order:             { label: 'Orders',            hint: 'Recent orders + tracking + status.',              icon: '🧾' },
    business_profile:  { label: 'Business profile',  hint: 'Name, address, phone, email, ICE, RC.',           icon: '🏢' },
    faq:               { label: 'FAQs',              hint: 'Manually curated Q&A pairs (separate tab).',      icon: '❓' },
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  const list = (rows || []).slice().sort((a, b) => a.kind.localeCompare(b.kind));

  return (
    <div className="space-y-3">
      <Card>
        <Kicker>What the brain knows</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Each source is auto-embedded into the AI's vector index. The indexer runs every 30 minutes and on any data change. Toggle a source off to keep it out of the brain's context. Click <span className="font-medium">Re-index</span> to refresh now.
        </p>
      </Card>
      <Card>
        <div className="divide-y divide-ant-line">
          {list.map((r) => {
            const d = KIND_DESC[r.kind] || { label: r.kind, hint: '', icon: '•' };
            const stale = r.needs_reindex;
            return (
              <div key={r.kind} className="grid grid-cols-[28px_1fr_120px_120px_auto] gap-3 py-3 items-center">
                <span className="text-[18px]">{d.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ant-ink">{d.label}</p>
                    {stale && <span className="text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded bg-ant-orange/10 text-ant-orange">Stale</span>}
                    {r.last_error && <span className="text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded bg-ant-rose/10 text-ant-rose">Error</span>}
                  </div>
                  <p className="text-[10.5px] text-ant-muted mt-0.5">{d.hint}</p>
                  {r.last_error && <p className="text-[10px] text-ant-rose mt-0.5 italic">{r.last_error}</p>}
                </div>
                <div className="text-[11px] text-ant-mid tabular-nums">
                  <p><span className="font-semibold text-ant-ink">{r.chunks_in_index}</span> chunks</p>
                  <p className="text-[10px] text-ant-muted">
                    {r.last_indexed_at ? `indexed ${timeAgo(r.last_indexed_at)}` : 'never indexed'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.enabled} onCheckedChange={(v) => toggle.mutate({ kind: r.kind, enabled: v })} />
                  <span className="text-[10px] text-ant-muted">{r.enabled ? 'on' : 'off'}</span>
                </div>
                <Button size="sm" variant="ghost"
                  disabled={r.kind === 'faq' || running === r.kind}
                  onClick={() => reindex(r.kind)}
                  className="rounded-full h-7 text-[11px] hover:bg-ant-line-soft">
                  {running === r.kind ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Re-index'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// RULES TAB — business rules (always/never/policy) + pricing rules
// ──────────────────────────────────────────────────────────────────────
interface BusinessRule { id: string; kind: 'always_do'|'never_do'|'policy'|'tone_example'|'greeting'; text: string; priority: number; is_active: boolean; }
interface PricingRule  { id: string; product_id: string | null; product_name?: string | null; quantity_min: number; quantity_max: number | null; discount_pct: number | null; fixed_unit_price: number | null; free_shipping: boolean; notes: string | null; is_active: boolean; }

function RulesTab({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draftRule, setDraftRule] = useState<{ kind: BusinessRule['kind']; text: string }>({ kind: 'always_do', text: '' });
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
    mutationFn: async () => {
      if (!draftRule.text.trim()) throw new Error('text required');
      const { error } = await (supabase as any).from('ai_business_rules')
        .insert({ business_id: businessId, kind: draftRule.kind, text: draftRule.text.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-business-rules', businessId] }); setDraftRule({ kind: 'always_do', text: '' }); toast({ title: 'Rule added' }); },
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

  const KIND_LABEL: Record<string, { label: string; cls: string }> = {
    always_do:    { label: 'Always do',    cls: 'bg-ant-green/10 text-ant-green' },
    never_do:     { label: 'Never do',     cls: 'bg-ant-rose/10 text-ant-rose' },
    policy:       { label: 'Policy',       cls: 'bg-ant-blue/10 text-ant-blue' },
    tone_example: { label: 'Tone example', cls: 'bg-ant-orange/10 text-ant-orange' },
    greeting:     { label: 'Greeting',     cls: 'bg-ant-line-soft text-ant-mid' },
  };

  return (
    <div className="space-y-3">
      {/* Business rules */}
      <Card>
        <Kicker>Brain rules</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          What the brain must always do, never do, and which policies to apply. Injected into the system prompt every conversation.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 mt-3">
          <Select value={draftRule.kind} onValueChange={(v: any) => setDraftRule({ ...draftRule, kind: v })}>
            <SelectTrigger className="rounded-lg border-ant-line bg-ant-paper text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="always_do">Always do</SelectItem>
              <SelectItem value="never_do">Never do</SelectItem>
              <SelectItem value="policy">Policy</SelectItem>
              <SelectItem value="tone_example">Tone example</SelectItem>
              <SelectItem value="greeting">Greeting</SelectItem>
            </SelectContent>
          </Select>
          <Input value={draftRule.text} onChange={(e) => setDraftRule({ ...draftRule, text: e.target.value })}
            placeholder='e.g. "Never mention competitor prices"'
            className="rounded-lg border-ant-line bg-ant-paper text-[12px]" />
          <Button onClick={() => addRule.mutate()} disabled={addRule.isPending} className="rounded-full h-9 bg-ant-ink text-ant-paper hover:bg-ant-ink/90">
            {addRule.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Add</>}
          </Button>
        </div>
        {(rules || []).length > 0 && (
          <div className="divide-y divide-ant-line mt-3">
            {(rules || []).map((r) => (
              <div key={r.id} className="grid grid-cols-[120px_1fr_auto_auto] gap-2 py-2 items-center">
                <span className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold rounded px-1.5 py-0.5 ${KIND_LABEL[r.kind]?.cls || ''}`}>{KIND_LABEL[r.kind]?.label || r.kind}</span>
                <p className={`text-[12px] ${r.is_active ? 'text-ant-ink' : 'text-ant-muted line-through'}`}>{r.text}</p>
                <Switch checked={r.is_active} onCheckedChange={(v) => toggleRule.mutate({ id: r.id, is_active: v })} />
                <button onClick={() => delRule.mutate(r.id)} className="text-ant-rose hover:text-ant-rose/80 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Pricing rules */}
      <Card>
        <Kicker>Pricing rules</Kicker>
        <p className="text-[10.5px] text-ant-muted mt-0.5">
          Quantity-tier discounts the brain applies via <code>apply_pricing_rule</code>. Per-product rules override the catch-all.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_60px_60px_60px_60px_60px_auto] gap-2 mt-3">
          <Select value={draftPrice.product_id || '__all'} onValueChange={(v) => setDraftPrice({ ...draftPrice, product_id: v === '__all' ? '' : v })}>
            <SelectTrigger className="rounded-lg border-ant-line text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All products</SelectItem>
              {(prods || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" min={1} value={draftPrice.quantity_min} onChange={(e) => setDraftPrice({ ...draftPrice, quantity_min: Number(e.target.value) })} placeholder="qty≥" className="rounded-lg border-ant-line text-[11px]" />
          <Input type="number" value={draftPrice.quantity_max} onChange={(e) => setDraftPrice({ ...draftPrice, quantity_max: e.target.value })} placeholder="qty≤" className="rounded-lg border-ant-line text-[11px]" />
          <Input type="number" step="0.5" value={draftPrice.discount_pct} onChange={(e) => setDraftPrice({ ...draftPrice, discount_pct: e.target.value })} placeholder="-%" className="rounded-lg border-ant-line text-[11px]" />
          <Input type="number" step="0.5" value={draftPrice.fixed_unit_price} onChange={(e) => setDraftPrice({ ...draftPrice, fixed_unit_price: e.target.value })} placeholder="fixed" className="rounded-lg border-ant-line text-[11px]" />
          <label className="flex items-center gap-1.5 text-[10.5px] text-ant-mid">
            <input type="checkbox" checked={draftPrice.free_shipping} onChange={(e) => setDraftPrice({ ...draftPrice, free_shipping: e.target.checked })} /> free ship
          </label>
          <Button onClick={() => addPrice.mutate()} disabled={addPrice.isPending} className="rounded-full h-9 bg-ant-ink text-ant-paper">
            {addPrice.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          </Button>
        </div>
        {(priceRules || []).length > 0 && (
          <div className="divide-y divide-ant-line mt-3">
            {(priceRules || []).map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_70px_120px_60px_auto] gap-2 py-2 items-center text-[11.5px]">
                <p className="truncate">{r.product_name}</p>
                <span className="tabular-nums text-ant-mid">qty {r.quantity_min}{r.quantity_max ? `-${r.quantity_max}` : '+'}</span>
                <span className="tabular-nums text-ant-ink">
                  {r.discount_pct != null ? `-${Number(r.discount_pct).toFixed(0)}%` : ''}
                  {r.fixed_unit_price != null ? `${Number(r.fixed_unit_price).toFixed(2)} dh fix` : ''}
                  {r.free_shipping ? ' • free ship' : ''}
                </span>
                <span className={`text-[9.5px] uppercase tracking-[0.16em] font-semibold ${r.is_active ? 'text-ant-green' : 'text-ant-mid'}`}>
                  {r.is_active ? 'on' : 'off'}
                </span>
                <button onClick={() => delPrice.mutate(r.id)} className="text-ant-rose hover:text-ant-rose/80 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
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

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <Kicker>Pending owner review</Kicker>
            <p className="text-[10.5px] text-ant-muted mt-0.5">
              When the brain is in sandbox mode, every reply is held here. Approve to send as-is, edit to send a modified text, or reject to send the fallback message.
            </p>
          </div>
          <span className="font-display text-[28px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em]">
            {rows?.length ?? 0}
          </span>
        </div>
      </Card>
      {(!rows || rows.length === 0) ? (
        <Card>
          <p className="font-serif-display italic text-[11px] text-ant-muted py-8 text-center">All caught up — no pending reviews.</p>
        </Card>
      ) : (
        rows.map((r) => {
          const isEditing = editing[r.decision_id] !== undefined;
          const draft = isEditing ? editing[r.decision_id] : (r.tongue_output ?? '');
          const intent = r.brain_intent?.intent || '—';
          const conf = r.brain_intent?.confidence != null ? Math.round(Number(r.brain_intent.confidence) * 100) : null;
          return (
            <Card key={r.decision_id}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer side */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Kicker>Customer</Kicker>
                    <span className="text-[10px] text-ant-muted">{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="text-[11.5px] text-ant-ink font-medium mb-0.5">{r.contact_name || 'Unknown contact'}</p>
                  {r.contact_phone && <p className="text-[10px] text-ant-muted mb-2 tabular-nums">{r.contact_phone}</p>}
                  <div className="rounded-lg bg-ant-line-soft border border-ant-line p-3">
                    <p className="text-[12.5px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                      {r.inbound_text || <span className="font-serif-display italic text-ant-muted">(message text unavailable)</span>}
                    </p>
                  </div>
                  {r.tool_calls.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[9.5px] uppercase tracking-[0.18em] text-ant-mid font-semibold mb-1">Tools used</p>
                      <div className="flex flex-wrap gap-1.5">
                        {r.tool_calls.map((c: any, i: number) => (
                          <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full ${c.ok ? 'bg-ant-blue/10 text-ant-blue' : 'bg-ant-rose/10 text-ant-rose'}`}>
                            {c.skill_slug}{c.ok ? '' : ' ✗'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {r.pending_actions.length > 0 && (
                    <div className="mt-3 rounded-lg bg-ant-rose/[0.05] border border-ant-rose/30 p-2.5">
                      <p className="text-[9.5px] uppercase tracking-[0.18em] text-ant-rose font-semibold mb-1.5 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Will write to DB on approve
                      </p>
                      {r.pending_actions.map((a) => (
                        <PendingActionDetail key={a.id} action={a} />
                      ))}
                    </div>
                  )}
                </div>

                {/* AI draft side */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Kicker>AI draft</Kicker>
                    <span className="text-[10px] text-ant-muted tabular-nums">
                      {intent}{conf != null ? ` · ${conf}%` : ''} · ${r.cost_usd.toFixed(4)} · {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                    </span>
                  </div>
                  <div className="rounded-lg bg-ant-orange/[0.04] border border-ant-orange/20 p-3 min-h-[88px]">
                    {isEditing ? (
                      <Textarea
                        rows={4}
                        value={draft}
                        onChange={(ev) => setEditing({ ...editing, [r.decision_id]: ev.target.value })}
                        className="w-full bg-transparent border-0 text-[12.5px] text-ant-ink leading-relaxed focus-visible:ring-0 resize-none p-0"
                        autoFocus
                      />
                    ) : (
                      <p className="text-[12.5px] text-ant-ink leading-relaxed whitespace-pre-wrap">
                        {r.tongue_output || <span className="font-serif-display italic text-ant-muted">(no draft)</span>}
                      </p>
                    )}
                  </div>
                  {r.outcome_reason && (
                    <p className="text-[10px] text-ant-muted mt-1.5 italic">Reason: {r.outcome_reason}</p>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex items-center justify-end gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing((s) => { const n = { ...s }; delete n[r.decision_id]; return n; })} className="rounded-full h-8 text-[11.5px]">
                          <X className="w-3.5 h-3.5 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" disabled={act.isPending || !draft.trim()} onClick={() => act.mutate({ decisionId: r.decision_id, action: 'edit', override_text: draft })}
                          className="rounded-full h-8 text-[11.5px] bg-ant-ink text-ant-paper hover:bg-ant-ink/90">
                          {act.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5 mr-1" /> Send edit</>}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ decisionId: r.decision_id, action: 'reject' })}
                          className="rounded-full h-8 text-[11.5px] text-ant-rose hover:text-ant-rose/80 hover:bg-ant-rose/10">
                          <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => setEditing({ ...editing, [r.decision_id]: r.tongue_output ?? '' })}
                          className="rounded-full h-8 text-[11.5px] text-ant-blue hover:text-ant-blue/80 hover:bg-ant-blue/10">
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                        <Button size="sm" disabled={act.isPending || !r.tongue_output} onClick={() => act.mutate({ decisionId: r.decision_id, action: 'approve' })}
                          className="rounded-full h-8 text-[11.5px] bg-ant-green text-ant-paper hover:bg-ant-green/90">
                          {act.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><MessageSquareQuote className="w-3.5 h-3.5 mr-1" /> Approve &amp; send</>}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
