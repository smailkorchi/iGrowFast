import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    format,
    startOfMonth,
    subMonths,
    subDays,
    endOfMonth,
    parseISO,
    differenceInDays,
    startOfDay,
} from 'date-fns';
import {
    TrendingUp,
    TrendingDown,
    Wallet,
    DollarSign,
    PackageCheck,
    Target,
    ArrowRight,
    Sparkles,
    Plus,
    BarChart3,
    ListChecks,
    AlertTriangle,
    Trophy,
    Megaphone,
    CheckCircle2,
    Clock,
    Zap,
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
import { fmtCur, fmtCurFull, fmtNum, fmtPct } from '@/lib/formatNumbers';
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
    const todayKey = format(now, 'yyyy-MM-dd');
    const currentMonth = format(now, 'yyyy-MM');

    // Wide range: last 60 days. Covers this month + previous month + 14-day sparkline.
    const range = useMemo(() => {
        const to = format(now, 'yyyy-MM-dd');
        const from = format(subDays(now, 60), 'yyyy-MM-dd');
        return { from, to };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const { daily, perCampaign, campaigns, currency, isLoading: loadingStats } = useMediaBuyerStats(range);
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

    // ─────── Derived metrics ────────
    const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
    const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
    const weekStart = format(subDays(now, 6), 'yyyy-MM-dd');
    const prevWeekStart = format(subDays(now, 13), 'yyyy-MM-dd');
    const prevWeekEnd = format(subDays(now, 7), 'yyyy-MM-dd');
    const sparklineStart = format(subDays(now, 13), 'yyyy-MM-dd');

    const metrics = useMemo(() => {
        const sum = (from: string, to: string) =>
            daily
                .filter((d) => d.date >= from && d.date <= to)
                .reduce(
                    (a, r) => {
                        a.spend += r.spend;
                        a.leads += r.leads;
                        a.delivered += r.delivered;
                        a.revenue += r.revenue;
                        return a;
                    },
                    { spend: 0, leads: 0, delivered: 0, revenue: 0 }
                );
        const thisMonth = sum(thisMonthStart, todayKey);
        const lastMonth = sum(lastMonthStart, lastMonthEnd);
        const today = sum(todayKey, todayKey);
        const yesterday = sum(format(subDays(now, 1), 'yyyy-MM-dd'), format(subDays(now, 1), 'yyyy-MM-dd'));
        const thisWeek = sum(weekStart, todayKey);
        const prevWeek = sum(prevWeekStart, prevWeekEnd);

        return { thisMonth, lastMonth, today, yesterday, thisWeek, prevWeek };
    }, [daily, thisMonthStart, todayKey, lastMonthStart, lastMonthEnd, weekStart, prevWeekStart, prevWeekEnd, now]);

    const profitThisMonth = metrics.thisMonth.revenue - metrics.thisMonth.spend;
    const profitLastMonth = metrics.lastMonth.revenue - metrics.lastMonth.spend;
    const profitDelta = computeDelta(profitThisMonth, profitLastMonth);
    const spendDelta = computeDelta(metrics.thisMonth.spend, metrics.lastMonth.spend);
    const deliveredDelta = computeDelta(metrics.thisMonth.delivered, metrics.lastMonth.delivered);
    const weekProfitDelta = computeDelta(metrics.thisWeek.revenue - metrics.thisWeek.spend, metrics.prevWeek.revenue - metrics.prevWeek.spend);

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
        const start = startOfMonth(now);
        const end = endOfMonth(now);
        const daysInMonth = differenceInDays(end, start) + 1;
        const daysElapsed = differenceInDays(startOfDay(now), start) + 1;
        const pct = (daysElapsed / daysInMonth) * 100;
        return { daysInMonth, daysElapsed, pct };
    }, [now]);

    const activeCampaigns = useMemo(() => campaigns.filter((c) => c.status === 'active'), [campaigns]);
    const needsAttention = useMemo(
        () => activeCampaigns.filter((c) => !todayEntryCampaignIds.has(c.id)),
        [activeCampaigns, todayEntryCampaignIds]
    );
    const topCampaigns = useMemo(() => perCampaign.filter((c) => c.spend > 0).slice(0, 5), [perCampaign]);

    const bestDay = useMemo(() => {
        if (daily.length === 0) return null;
        return [...daily].sort((a, b) => b.profit - a.profit)[0];
    }, [daily]);

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

                        {/* Headline metric: this month profit */}
                        <div className="rounded-3xl bg-white/[0.06] backdrop-blur-xl border border-white/10 p-5 min-w-[260px]">
                            <div className="flex items-center justify-between gap-3 mb-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/50">This month · profit</p>
                                <DeltaBadge delta={profitDelta} dark />
                            </div>
                            {loadingStats ? (
                                <Skeleton className="h-10 w-40 bg-white/10" />
                            ) : (
                                <p className="text-3xl font-black text-white tabular-nums leading-tight break-words" title={fmtCurFull(profitThisMonth, currency)}>
                                    {fmtCur(profitThisMonth, currency)}
                                </p>
                            )}
                            <p className="text-[11px] text-white/40 font-medium mt-1">
                                {fmtCur(metrics.thisMonth.revenue, currency)} rev · {fmtCur(metrics.thisMonth.spend, currency)} spend
                            </p>
                        </div>
                    </div>
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
                        label="Today's spend"
                        value={fmtCur(metrics.today.spend, currency)}
                        valueTitle={fmtCurFull(metrics.today.spend, currency)}
                        sub={`${fmtNum(metrics.today.delivered)} delivered today`}
                        icon={DollarSign}
                        tone="bg-red-500/10 text-red-500"
                    />
                    <KpiCard
                        label="This week · profit"
                        value={fmtCur(metrics.thisWeek.revenue - metrics.thisWeek.spend, currency)}
                        valueTitle={fmtCurFull(metrics.thisWeek.revenue - metrics.thisWeek.spend, currency)}
                        sub="vs last 7 days"
                        delta={weekProfitDelta}
                        icon={TrendingUp}
                        tone={metrics.thisWeek.revenue - metrics.thisWeek.spend >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}
                    />
                    <KpiCard
                        label="Month · spend"
                        value={fmtCur(metrics.thisMonth.spend, currency)}
                        valueTitle={fmtCurFull(metrics.thisMonth.spend, currency)}
                        sub={`${monthProgress.daysElapsed} / ${monthProgress.daysInMonth} days`}
                        delta={spendDelta}
                        icon={BarChart3}
                        tone="bg-indigo-500/10 text-indigo-500"
                    />
                    <KpiCard
                        label="Month · delivered"
                        value={fmtNum(metrics.thisMonth.delivered)}
                        sub="commission-eligible"
                        delta={deliveredDelta}
                        icon={PackageCheck}
                        tone="bg-emerald-500/10 text-emerald-600"
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
                                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">Sorted by profit · last 60 days</p>
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
                                                    className={cn('text-xs font-black tabular-nums', c.profit >= 0 ? 'text-emerald-600' : 'text-red-500')}
                                                    title={fmtCurFull(c.profit, currency)}
                                                >
                                                    {fmtCur(c.profit, currency)}
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
                                    <span>{format(endOfMonth(now), 'MMM d')}</span>
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

            {/* ─────── Best day badge — only if we have data and profit is positive ─────── */}
            {bestDay && bestDay.profit > 0 && (
                <div className="rounded-[28px] bg-gradient-to-r from-emerald-500/10 via-emerald-50/50 to-white border border-emerald-200/40 p-5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                        <Trophy className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700/70">Best day · last 60 days</p>
                        <p className="text-base font-black text-emerald-800">{format(parseISO(bestDay.date), 'EEEE, MMMM d')}</p>
                        <p className="text-[11px] text-emerald-800/70 font-medium tabular-nums">
                            {fmtCurFull(bestDay.profit, currency)} profit · {fmtNum(bestDay.delivered)} delivered · {fmtPct(bestDay.deliveryRate)} delivery rate
                        </p>
                    </div>
                    <Sparkles className="w-5 h-5 text-emerald-500/50 shrink-0 hidden md:block" />
                </div>
            )}
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
