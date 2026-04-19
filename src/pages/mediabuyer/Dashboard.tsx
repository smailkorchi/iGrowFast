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
    const todayKey = todayBusinessYmd();
    const currentMonth = todayKey.slice(0, 7);

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

    const { totals, perCampaign, campaigns, currency, isLoading: loadingStats } = useMediaBuyerStats(filterRange);

    const allTimeRange = useMemo(() => ({ from: '2020-01-01', to: todayKey }), [todayKey]);
    const { daily } = useMediaBuyerStats(allTimeRange);
    const { rows: earningsRows } = useMediaBuyerEarnings(currentMonth);
    const myEarnings = useMemo(() => earningsRows.find((r) => r.mediabuyer_id === currentUserId) || null, [earningsRows, currentUserId]);

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

    const activeCampaigns = useMemo(() => campaigns.filter((c) => c.status === 'active'), [campaigns]);
    const needsAttention = useMemo(
        () => activeCampaigns.filter((c) => !todayEntryCampaignIds.has(c.id)),
        [activeCampaigns, todayEntryCampaignIds]
    );
    const topCampaigns = useMemo(() => perCampaign.filter((c) => c.spend > 0).slice(0, 5), [perCampaign]);

    const firstName = (profile?.name || 'there').split(' ')[0];

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Dashboard
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {firstName} · {activeCampaigns.length} active campaign{activeCampaigns.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    {/* Preset filter */}
                    <div className="flex flex-wrap items-center gap-1">
                        {([
                            { k: 'all', label: 'All time' },
                            { k: 'mtd', label: 'Month' },
                            { k: 'lastmonth', label: 'Last mo.' },
                            { k: '30d', label: '30d' },
                            { k: '7d', label: '7d' },
                        ] as const).map(({ k, label }) => (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setPreset(k)}
                                className={cn(
                                    'h-7 px-2.5 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all',
                                    preset === k
                                        ? 'bg-brand-navy text-white'
                                        : 'text-gray-400 hover:text-brand-navy border border-gray-100'
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            {/* KPI strip */}
            {loadingStats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <KpiTile label="Spend" value={fmtCur(totals.spend, currency)} accent="#ef4444" />
                    <KpiTile label="Revenue" value={fmtCur(totals.revenue, currency)} accent="#059669" />
                    <KpiTile label="Delivered" value={fmtNum(totals.delivered)} accent="#059669" />
                    <KpiTile label="Confirmed" value={fmtNum(totals.confirmed)} accent="#3b5e5e" />
                </div>
            )}

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Left: sparkline + top campaigns */}
                <div className="lg:col-span-2 space-y-3">
                    {/* Sparkline */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Last 14 days</p>
                                <p className="text-[11px] text-brand-navy/60 font-medium mt-0.5">Daily spend vs revenue</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate('/mediabuyer/statistics')}
                                className="h-7 rounded-md text-[10px] font-semibold text-brand-navy/50 hover:text-brand-navy gap-1 px-2"
                            >
                                Full stats <ArrowRight className="w-3 h-3" />
                            </Button>
                        </div>
                        {sparklineData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center border border-dashed border-gray-200 rounded-lg">
                                <BarChart3 className="w-6 h-6 text-gray-400" />
                                <p className="text-[11px] text-gray-400">No data yet. Add daily entries to see trends.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={160}>
                                <AreaChart data={sparklineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="mbDashSpendGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="mbDashRevGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 11 }}
                                    />
                                    <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={1.5} fill="url(#mbDashSpendGrad)" />
                                    <Area type="monotone" dataKey="Revenue" stroke="#059669" strokeWidth={1.5} fill="url(#mbDashRevGrad)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* Top campaigns */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Top campaigns</p>
                                <p className="text-[11px] text-brand-navy/60 font-medium mt-0.5">Sorted by revenue · {filterRange.label.toLowerCase()}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate('/mediabuyer/campaigns')}
                                className="h-7 rounded-md text-[10px] font-semibold text-brand-navy/50 hover:text-brand-navy gap-1 px-2"
                            >
                                All <ArrowRight className="w-3 h-3" />
                            </Button>
                        </div>
                        {topCampaigns.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 gap-2 border border-dashed border-gray-200 rounded-lg">
                                <Megaphone className="w-6 h-6 text-gray-400" />
                                <p className="text-[11px] text-gray-400">No campaign data yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {topCampaigns.map((c, i) => (
                                    <button
                                        key={c.id}
                                        onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors group/row text-left"
                                    >
                                        <span className="w-5 h-5 rounded flex items-center justify-center bg-gray-100 shrink-0">
                                            <span className="text-[9px] font-semibold text-gray-500">{i + 1}</span>
                                        </span>
                                        <div
                                            className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0"
                                            style={{ backgroundColor: getPlatformColor(c.platform) }}
                                        >
                                            {getPlatformIcon(c.platform, 'w-3 h-3')}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-semibold text-brand-navy truncate">{c.name}</p>
                                            <p className="text-[9px] text-gray-400">
                                                {fmtNum(c.delivered)} del · ROAS {c.roas == null ? '—' : c.roas.toFixed(2) + 'x'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[11px] font-semibold tabular-nums text-brand-navy">{fmtCur(c.revenue, currency)}</p>
                                            <p className="text-[9px] text-gray-400 tabular-nums">{fmtCur(c.spend, currency)} spend</p>
                                        </div>
                                        <ChevronRight className="w-3 h-3 text-gray-300 group-hover/row:text-brand-navy/40 shrink-0" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: attention + quick actions + month */}
                <div className="lg:col-span-1 space-y-3">
                    {/* Needs attention */}
                    <div className={cn(
                        'rounded-xl border p-3.5',
                        needsAttention.length > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'
                    )}>
                        <div className="flex items-center gap-2 mb-2">
                            {needsAttention.length > 0 ? (
                                <>
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-amber-700">Needs data</p>
                                        <p className="text-[9px] text-amber-600/70 mt-0.5">No entry for today</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-emerald-700">All caught up</p>
                                        <p className="text-[9px] text-emerald-600/70 mt-0.5">Today's entries logged</p>
                                    </div>
                                </>
                            )}
                        </div>
                        {needsAttention.length > 0 ? (
                            <div className="space-y-1 mt-2">
                                {needsAttention.slice(0, 5).map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => navigate(`/mediabuyer/campaigns/${c.id}/manage`)}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-amber-100 hover:border-amber-300 transition-all group/att text-left"
                                    >
                                        <div
                                            className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0"
                                            style={{ backgroundColor: getPlatformColor(c.platform) }}
                                        >
                                            {getPlatformIcon(c.platform, 'w-3 h-3')}
                                        </div>
                                        <p className="flex-1 text-[11px] font-semibold text-brand-navy truncate">{c.name}</p>
                                        <ChevronRight className="w-3 h-3 text-amber-400 shrink-0" />
                                    </button>
                                ))}
                                {needsAttention.length > 5 && (
                                    <p className="text-[9px] text-amber-600/70 text-center pt-1">
                                        +{needsAttention.length - 5} more
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-[11px] text-emerald-700/70 mt-1">
                                Every active campaign has today's spend and leads logged.
                            </p>
                        )}
                    </div>

                    {/* Quick actions */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">Quick actions</p>
                        <div className="space-y-1">
                            <QuickAction label="Create campaign" onClick={() => navigate('/mediabuyer/campaigns/new')} />
                            <QuickAction label="View statistics" onClick={() => navigate('/mediabuyer/statistics')} />
                            <QuickAction label="View payments" onClick={() => navigate('/mediabuyer/payments')} />
                            <QuickAction label="All campaigns" onClick={() => navigate('/mediabuyer/campaigns')} />
                        </div>
                    </div>

                    {/* Month earnings */}
                    {myEarnings && (
                        <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">This month</p>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] text-gray-500">To be paid</p>
                                    <p className="text-[13px] font-semibold tabular-nums text-brand-navy">{fmtCur(myEarnings.remaining_amount, currency)}</p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] text-gray-500">Delivered</p>
                                    <p className="text-[12px] font-semibold tabular-nums text-emerald-600">{fmtNum(myEarnings.delivered_orders)}</p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-[10px] text-gray-500">Campaigns</p>
                                    <p className="text-[12px] font-semibold tabular-nums text-brand-navy">{fmtNum(myEarnings.campaigns_count)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── KPI Tile ────────
const KpiTile: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none">{value}</p>
        </div>
    </div>
);

// ─── Quick Action ────────
const QuickAction: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button
        onClick={onClick}
        className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group/qa"
    >
        <span className="text-[11px] font-semibold text-brand-navy/80">{label}</span>
        <ChevronRight className="w-3 h-3 text-gray-300 group-hover/qa:text-brand-navy/40" />
    </button>
);

export default Dashboard;
