import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    format,
    parseISO,
} from 'date-fns';
import {
    TrendingUp,
    TrendingDown,
    Wallet,
    DollarSign,
    PackageCheck,
    Target,
    ArrowRight,
    Plus,
    BarChart3,
    ListChecks,
    AlertTriangle,
    Megaphone,
    CheckCircle2,
    Clock,
    ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    ResponsiveContainer,
    CartesianGrid,
    Tooltip,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useMediaBuyerStats } from '@/hooks/useMediaBuyerStats';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { todayBusinessYmd, shiftYmd } from '@/lib/dateBuckets';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { getPlatformColor, getPlatformIcon } from '@/lib/campaignConstants';

type Profile = {
    id: string;
    name: string;
    avatar_url: string | null;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
};

// ─────── Time-of-day greeting ────────
const greetForHour = (h: number): { greeting: string; emoji: string } => {
    if (h < 5) return { greeting: 'Burning the midnight oil', emoji: '🌙' };
    if (h < 12) return { greeting: 'Good morning', emoji: '☀️' };
    if (h < 17) return { greeting: 'Good afternoon', emoji: '👋' };
    if (h < 21) return { greeting: 'Good evening', emoji: '🌆' };
    return { greeting: 'Still going strong', emoji: '🌙' };
};

// ─────── Delta helper ────────
type Delta = { value: number; pct: number | null; direction: 'up' | 'down' | 'flat' };
const computeDelta = (current: number, previous: number): Delta => {
    const value = current - previous;
    if (previous === 0 && current === 0) return { value: 0, pct: null, direction: 'flat' };
    if (previous === 0) return { value, pct: null, direction: value >= 0 ? 'up' : 'down' };
    const pct = (value / Math.abs(previous)) * 100;
    return { value, pct, direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
};

// ─────── Page ────────
const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const currentUserId = useCurrentUserId();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const now = new Date();
    // All date keys below must be in business timezone (Africa/Casablanca) so they
    // line up with the daily rows produced by useMediaBuyerStats. Using
    // `format(now, 'yyyy-MM-dd')` gives the viewer's browser-local date, which can
    // drift one day relative to business time (e.g. SSR in UTC at 23:30 on 15/04
    // shows "today=15/04" while the business is already on 16/04).
    const todayKey = todayBusinessYmd();
    const currentMonth = todayKey.slice(0, 7);

    // Time-range filter. Default "all" so the dashboard totals match the sum
    // of each campaign's preview-page totals without any scope trickery.
    type Preset = 'all' | 'mtd' | 'lastmonth' | '30d' | '7d';
    const [preset, setPreset] = useState<Preset>('all');

    const filterRange = useMemo<{ from: string; to: string; label: string }>(() => {
        const y = Number(todayKey.slice(0, 4));
        const m = Number(todayKey.slice(5, 7));
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const lastDay = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
        switch (preset) {
            case '7d':
                return { from: shiftYmd(todayKey, -6), to: todayKey, label: 'Last 7 days' };
            case '30d':
                return { from: shiftYmd(todayKey, -29), to: todayKey, label: 'Last 30 days' };
            case 'mtd':
                return { from: `${currentMonth}-01`, to: todayKey, label: 'This month' };
            case 'lastmonth': {
                const ly = m === 1 ? y - 1 : y;
                const lm = m === 1 ? 12 : m - 1;
                const key = `${ly}-${pad2(lm)}`;
                return { from: `${key}-01`, to: `${key}-${pad2(lastDay(ly, lm))}`, label: 'Last month' };
            }
            case 'all':
            default:
                return { from: '2020-01-01', to: todayKey, label: 'All time' };
        }
    }, [preset, todayKey, currentMonth]);

    // Primary hook call — scoped to the preset. `totals` and `perCampaign` both
    // reflect the selected window, so every tile on the dashboard agrees with
    // the other and with each campaign's preview page (when preset = "all").
    const { totals, perCampaign, campaigns, currency, isLoading: loadingStats } = useMediaBuyerStats(filterRange);

    // Separate all-time fetch for the 14-day sparkline so the trend line is
    // stable regardless of the preset the user picks.
    const allTimeRange = useMemo(() => ({ from: '2020-01-01', to: todayKey }), [todayKey]);
    const { daily } = useMediaBuyerStats(allTimeRange);
    const { rows: earningsRows } = useMediaBuyerEarnings(currentMonth);
    const myEarnings = useMemo(() => earningsRows.find((r) => r.mediabuyer_id === currentUserId) || null, [earningsRows, currentUserId]);

    // Profile for the greeting.
    const { data: profile } = useQuery<Profile | null>({
        queryKey: ['mb-dash-profile', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, payment_type, commission_price, salary_amount')
                .eq('id', currentUserId)
                .single();
            return (data || null) as Profile | null;
        },
        enabled: !!currentUserId,
    });

    // Campaigns with no entry for today — "needs attention".
    const { data: todayEntryCampaignIds = new Set<string>() } = useQuery<Set<string>>({
        queryKey: ['mb-dash-today-entries', currentUserId, todayKey],
        queryFn: async () => {
            if (!currentUserId) return new Set();
            const { data, error } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('campaign_id')
                .eq('created_by', currentUserId)
                .eq('entry_date', todayKey);
            if (error) throw error;
            return new Set((data || []).map((e: any) => e.campaign_id).filter(Boolean));
        },
        enabled: !!currentUserId && !!activeBusinessId,
    });

    // ─────── Derived date keys (all in business TZ) ────────
    const curYear = Number(currentMonth.slice(0, 4));
    const curMon = Number(currentMonth.slice(5, 7)); // 1-12
    const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
    const sparklineStart = shiftYmd(todayKey, -13);

    const sparklineData = useMemo(() => {
        return daily
            .filter((d) => d.date >= sparklineStart)
            .map((d) => ({
                date: format(parseISO(d.date), 'dd MMM'),
                Spend: Number(d.spend.toFixed(2)),
                Revenue: Number(d.revenue.toFixed(2)),
            }));
    }, [daily, sparklineStart]);

    const monthProgress = useMemo(() => {
        const total = daysInMonth(curYear, curMon);
        const elapsed = Number(todayKey.slice(8, 10));
        const pct = (elapsed / total) * 100;
        return { daysInMonth: total, daysElapsed: elapsed, pct };
    }, [todayKey, curYear, curMon]);

    const activeCampaigns = useMemo(() => campaigns.filter((c) => c.status === 'active'), [campaigns]);
    const needsAttention = useMemo(
        () => activeCampaigns.filter((c) => !todayEntryCampaignIds.has(c.id)),
        [activeCampaigns, todayEntryCampaignIds]
    );
    const topCampaigns = useMemo(() => perCampaign.filter((c) => c.spend > 0).slice(0, 5), [perCampaign]);

    const greet = greetForHour(now.getHours());
    const firstName = (profile?.name || 'there').split(' ')[0];

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-12">
            {/* ─────── Hero ─────── */}
            <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/90 text-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.4)]">
                {/* Decorative blobs */}
                <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-primary/20 blur-3xl" />
                <div className="absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-white/5 blur-3xl" />

                <div className="relative p-8 md:p-10">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
                        <div className="flex items-center gap-5 min-w-0">
                            <Avatar className="h-16 w-16 border-2 border-white/20 shadow-xl shrink-0">
                                <AvatarImage src={profile?.avatar_url || ''} />
                                <AvatarFallback className="bg-primary/20 text-white font-black text-xl">
                                    {firstName.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-white/60">
                                    {greet.greeting} {greet.emoji}
                                </p>
                                <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight truncate">{firstName}</h1>
                                <p className="text-xs text-white/50 font-medium mt-0.5">
                                    {format(now, 'EEEE, MMMM d, yyyy')} · {activeCampaigns.length} active campaign{activeCampaigns.length !== 1 ? 's' : ''}
                                </p>
                            </div>
                        </div>

                        {/* Headline revenue — scoped to the selected preset. */}
                        <div className="rounded-3xl bg-white/[0.06] backdrop-blur-xl border border-white/10 p-5 min-w-[260px]">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-1">{filterRange.label} · revenue</p>
                            {loadingStats ? (
                                <Skeleton className="h-10 w-40 bg-white/10" />
                            ) : (
                                <p className="text-3xl font-black text-white tabular-nums leading-tight break-words" title={fmtCurFull(totals.revenue, currency)}>
                                    {fmtCur(totals.revenue, currency)}
                                </p>
                            )}
                            <p className="text-[11px] text-white/40 font-medium mt-1">
                                {fmtNum(totals.delivered)} delivered · {fmtCur(totals.spend, currency)} spend
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─────── Preset filter bar ─────── */}
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-3xl bg-white/80 backdrop-blur border border-gray-100 shadow-sm">
                {([
                    { k: 'all', label: 'All time' },
                    { k: 'mtd', label: 'This month' },
                    { k: 'lastmonth', label: 'Last month' },
                    { k: '30d', label: 'Last 30 days' },
                    { k: '7d', label: 'Last 7 days' },
                ] as const).map(({ k, label }) => (
                    <button
                        key={k}
                        type="button"
                        onClick={() => setPreset(k)}
                        className={cn(
                            'px-4 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wider transition-all',
                            preset === k
                                ? 'bg-brand-navy text-white shadow'
                                : 'text-brand-navy/60 hover:text-brand-navy hover:bg-brand-navy/5'
                        )}
                    >
                        {label}
                    </button>
                ))}
                <div className="ml-auto text-[10px] font-bold text-muted-foreground tabular-nums pr-2">
                    {filterRange.from} → {filterRange.to}
                </div>
            </div>

            {/* ─────── KPI strip ─────── */}
            {loadingStats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-3xl bg-white/60" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KpiCard
                        label="Spend"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={filterRange.label}
                        icon={DollarSign}
                        tone="bg-red-500/10 text-red-500"
                    />
                    <KpiCard
                        label="Revenue"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={totals.revenue - totals.spend >= 0 ? 'profitable' : 'below spend'}
                        icon={TrendingUp}
                        tone={totals.revenue - totals.spend >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}
                    />
                    <KpiCard
                        label="Delivered"
                        value={fmtNum(totals.delivered)}
                        sub="commission-eligible"
                        icon={PackageCheck}
                        tone="bg-emerald-500/10 text-emerald-600"
                    />
                    <KpiCard
                        label="Confirmed"
                        value={fmtNum(totals.confirmed)}
                        sub={`${fmtNum(totals.leads)} leads`}
                        icon={BarChart3}
                        tone="bg-indigo-500/10 text-indigo-500"
                    />
                </div>
            )}

            {/* ─────── Main grid ─────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: chart + top campaigns */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Sparkline card */}
                    <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between mb-5">
                                <div>
                                    <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Last 14 days</h2>
                                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">Daily spend vs revenue</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigate('/mediabuyer/statistics')}
                                    className="h-8 rounded-xl text-[10px] font-black uppercase tracking-wider text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5 gap-1"
                                >
                                    Full stats <ArrowRight className="w-3 h-3" />
                                </Button>
                            </div>
                            {sparklineData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                                    <div className="w-14 h-14 rounded-full bg-brand-navy/[0.04] flex items-center justify-center">
                                        <BarChart3 className="w-6 h-6 text-brand-navy/20" />
                                    </div>
                                    <p className="text-xs text-muted-foreground font-medium max-w-xs">
                                        No data to chart. Add daily entries to your campaigns to see trends.
                                    </p>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={sparklineData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="mbDashSpendGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="mbDashRevGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} width={50} />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: 16,
                                                border: 'none',
                                                boxShadow: '0 20px 50px -10px rgba(15,23,42,0.15)',
                                                fontSize: 11,
                                                fontWeight: 700,
                                            }}
                                        />
                                        <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={2.5} fill="url(#mbDashSpendGrad)" />
                                        <Area type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#mbDashRevGrad)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    {/* Top campaigns */}
                    <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between mb-5">
                                <div>
                                    <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Top campaigns</h2>
                                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">Sorted by revenue · {filterRange.label.toLowerCase()}</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigate('/mediabuyer/campaigns')}
                                    className="h-8 rounded-xl text-[10px] font-black uppercase tracking-wider text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/5 gap-1"
                                >
                                    All <ArrowRight className="w-3 h-3" />
                                </Button>
                            </div>
                            {topCampaigns.length === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">No campaign data yet.</div>
                            ) : (
                                <div className="space-y-2">
                                    {topCampaigns.map((c, i) => (
                                        <button
                                            key={c.id}
                                            onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/5 hover:bg-brand-navy/[0.04] hover:border-brand-navy/10 transition-all group/row tabular-nums text-left"
                                        >
                                            <div className="w-6 h-6 rounded-lg bg-brand-navy/[0.06] flex items-center justify-center shrink-0">
                                                <span className="text-[10px] font-black text-brand-navy/50">{i + 1}</span>
                                            </div>
                                            <div
                                                className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0"
                                                style={{ backgroundColor: getPlatformColor(c.platform) }}
                                            >
                                                {getPlatformIcon(c.platform, 'w-3.5 h-3.5')}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold text-brand-navy truncate">{c.name}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {fmtNum(c.delivered)} delivered · ROAS {c.roas == null ? '—' : c.roas.toFixed(2) + 'x'}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p
                                                    className="text-xs font-black tabular-nums text-brand-navy"
                                                    title={fmtCurFull(c.revenue, currency)}
                                                >
                                                    {fmtCur(c.revenue, currency)}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground" title={fmtCurFull(c.spend, currency)}>
                                                    {fmtCur(c.spend, currency)} spend
                                                </p>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-brand-navy/20 group-hover/row:text-brand-navy/60 transition-colors shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right: needs attention + quick actions + month progress */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Needs attention */}
                    <Card
                        className={cn(
                            'border-none rounded-[28px] shadow-sm overflow-hidden',
                            needsAttention.length > 0
                                ? 'bg-gradient-to-br from-amber-50 via-white to-amber-50/30 ring-1 ring-amber-200/50'
                                : 'bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 ring-1 ring-emerald-200/40'
                        )}
                    >
                        <CardContent className="p-6">
                            <div className="flex items-center gap-2 mb-3">
                                {needsAttention.length > 0 ? (
                                    <>
                                        <div className="w-9 h-9 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                                            <AlertTriangle className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h2 className="text-xs font-black uppercase tracking-widest text-amber-700">Needs data</h2>
                                            <p className="text-[10px] text-amber-700/60 font-medium">No entry for today</p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
                                            <CheckCircle2 className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h2 className="text-xs font-black uppercase tracking-widest text-emerald-700">All caught up</h2>
                                            <p className="text-[10px] text-emerald-700/60 font-medium">Today's entries are in</p>
                                        </div>
                                    </>
                                )}
                            </div>
                            {needsAttention.length > 0 ? (
                                <div className="space-y-2 mt-4">
                                    {needsAttention.slice(0, 5).map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => navigate(`/mediabuyer/campaigns/${c.id}/manage`)}
                                            className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-white/80 backdrop-blur border border-amber-200/40 hover:border-amber-300 hover:shadow-sm transition-all group/att text-left"
                                        >
                                            <div
                                                className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                                                style={{ backgroundColor: getPlatformColor(c.platform) }}
                                            >
                                                {getPlatformIcon(c.platform, 'w-3 h-3')}
                                            </div>
                                            <p className="flex-1 text-xs font-bold text-brand-navy truncate">{c.name}</p>
                                            <ChevronRight className="w-4 h-4 text-amber-600/50 group-hover/att:text-amber-600 shrink-0" />
                                        </button>
                                    ))}
                                    {needsAttention.length > 5 && (
                                        <p className="text-[10px] text-amber-700/60 text-center font-bold pt-1">
                                            +{needsAttention.length - 5} more
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-emerald-800/70 mt-2 font-medium">
                                    Every active campaign has today's spend and leads logged. Keep it up.
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Quick actions */}
                    <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm overflow-hidden">
                        <CardContent className="p-6">
                            <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50 mb-4">Quick actions</h2>
                            <div className="space-y-2">
                                <QuickAction icon={Plus} label="Create campaign" tone="bg-primary/10 text-primary" onClick={() => navigate('/mediabuyer/campaigns/new')} />
                                <QuickAction icon={BarChart3} label="View statistics" tone="bg-indigo-500/10 text-indigo-500" onClick={() => navigate('/mediabuyer/statistics')} />
                                <QuickAction icon={Wallet} label="View payments" tone="bg-emerald-500/10 text-emerald-600" onClick={() => navigate('/mediabuyer/payments')} />
                                <QuickAction icon={ListChecks} label="All campaigns" tone="bg-brand-navy/10 text-brand-navy" onClick={() => navigate('/mediabuyer/campaigns')} />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Month progress */}
                    <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Month progress</h2>
                                <Badge className="rounded-full bg-brand-navy/5 text-brand-navy border-none text-[9px] font-black uppercase">
                                    {monthProgress.pct.toFixed(0)}%
                                </Badge>
                            </div>
                            <div className="space-y-3">
                                <div className="relative h-2 rounded-full bg-brand-navy/[0.06] overflow-hidden">
                                    <div
                                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-700"
                                        style={{ width: `${Math.min(100, monthProgress.pct)}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
                                    <span>Day {monthProgress.daysElapsed} of {monthProgress.daysInMonth}</span>
                                    <span>{format(parseISO(`${currentMonth}-${String(daysInMonth(curYear, curMon)).padStart(2, '0')}`), 'MMM d')}</span>
                                </div>
                            </div>
                            {myEarnings && (
                                <div className="mt-5 pt-4 border-t border-brand-navy/5 space-y-2.5">
                                    <MiniRow label="To be paid" value={fmtCur(myEarnings.remaining_amount, currency)} valueTitle={fmtCurFull(myEarnings.remaining_amount, currency)} tone="text-primary" icon={Wallet} />
                                    <MiniRow label="Delivered (mo)" value={fmtNum(myEarnings.delivered_orders)} tone="text-emerald-600" icon={PackageCheck} />
                                    <MiniRow label="Campaigns (mo)" value={fmtNum(myEarnings.campaigns_count)} tone="text-indigo-600" icon={Megaphone} />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

// ─────── Subcomponents ────────
const KpiCard: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub: string;
    delta?: Delta;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
}> = ({ label, value, valueTitle, sub, delta, icon: Icon, tone }) => (
    <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl', tone)}>
                <Icon className="h-4 w-4" />
            </div>
        </div>
        <p className="text-xl font-black tabular-nums text-gray-900 tracking-tight break-words leading-tight" title={valueTitle || value}>
            {value}
        </p>
        <div className="flex items-center gap-2 mt-1">
            <p className="text-[10px] text-muted-foreground font-medium truncate">{sub}</p>
            {delta && <DeltaBadge delta={delta} />}
        </div>
    </div>
);

const DeltaBadge: React.FC<{ delta: Delta; dark?: boolean }> = ({ delta, dark }) => {
    if (delta.direction === 'flat' && delta.pct == null) return null;
    const isUp = delta.direction === 'up';
    const isDown = delta.direction === 'down';
    const Arrow = isUp ? TrendingUp : isDown ? TrendingDown : Clock;
    return (
        <div
            className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-black tabular-nums',
                dark
                    ? isUp
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : isDown
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-white/10 text-white/60'
                    : isUp
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : isDown
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-brand-navy/5 text-brand-navy/40'
            )}
        >
            <Arrow className="w-2.5 h-2.5" />
            {delta.pct == null ? 'new' : `${Math.abs(delta.pct).toFixed(0)}%`}
        </div>
    );
};

const QuickAction: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; tone: string; onClick: () => void }> = ({
    icon: Icon,
    label,
    tone,
    onClick,
}) => (
    <button
        onClick={onClick}
        className="w-full flex items-center gap-3 p-3 rounded-2xl bg-brand-navy/[0.02] border border-brand-navy/5 hover:bg-brand-navy/[0.04] hover:border-brand-navy/10 hover:translate-x-0.5 transition-all group/qa text-left"
    >
        <div className={cn('w-9 h-9 rounded-2xl flex items-center justify-center shrink-0', tone)}>
            <Icon className="w-4 h-4" />
        </div>
        <span className="flex-1 text-xs font-bold text-brand-navy">{label}</span>
        <ChevronRight className="w-4 h-4 text-brand-navy/20 group-hover/qa:text-brand-navy/60 transition-colors" />
    </button>
);

const MiniRow: React.FC<{ label: string; value: string; valueTitle?: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = ({
    label,
    value,
    valueTitle,
    tone,
    icon: Icon,
}) => (
    <div className="flex items-center gap-2">
        <Icon className={cn('w-3.5 h-3.5 shrink-0', tone)} />
        <span className="text-[11px] text-muted-foreground font-medium flex-1">{label}</span>
        <span className={cn('text-xs font-black tabular-nums', tone)} title={valueTitle || value}>
            {value}
        </span>
    </div>
);

export default Dashboard;
