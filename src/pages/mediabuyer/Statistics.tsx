import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    format,
    differenceInDays,
    parseISO,
} from 'date-fns';
import {
    Calendar as CalendarIcon,
    DollarSign,
    Users as UsersIcon,
    CheckCircle2,
    PackageCheck,
    TrendingUp,
    Wallet,
    Target,
    Megaphone,
    BarChart3,
    ExternalLink,
    ArrowRight,
    Trophy,
    AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
    LineChart,
    Line,
    Area,
    AreaChart,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { getPlatformIcon, getPlatformColor } from '@/lib/campaignConstants';
import { useMediaBuyerStats, type StatsDateRange } from '@/hooks/useMediaBuyerStats';
import { fmtCur, fmtCurFull, fmtNum, fmtNumCompact, fmtPct } from '@/lib/formatNumbers';
import { todayBusinessYmd, shiftYmd } from '@/lib/dateBuckets';

// ── Date range presets ───────────────────────────────────────────
type PresetKey = '7d' | '30d' | 'mtd' | 'lastmonth' | 'all';

const PRESETS: { key: PresetKey; label: string }[] = [
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
    { key: 'mtd', label: 'Month' },
    { key: 'lastmonth', label: 'Last mo.' },
    { key: 'all', label: 'All' },
];

const computePreset = (key: PresetKey): StatsDateRange => {
    const today = todayBusinessYmd();
    const [y, m] = today.split('-').map(Number);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const daysInMonth = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
    switch (key) {
        case '7d':
            return { from: shiftYmd(today, -6), to: today };
        case '30d':
            return { from: shiftYmd(today, -29), to: today };
        case 'mtd':
            return { from: `${today.slice(0, 7)}-01`, to: today };
        case 'lastmonth': {
            const ly = m === 1 ? y - 1 : y;
            const lm = m === 1 ? 12 : m - 1;
            const k = `${ly}-${pad2(lm)}`;
            return { from: `${k}-01`, to: `${k}-${pad2(daysInMonth(ly, lm))}` };
        }
        case 'all':
        default:
            return { from: '2000-01-01', to: today };
    }
};

// ── KPI tile ─────────────────────────────────────────────────────
const KpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: string;
}> = ({ label, value, valueTitle, sub, accent }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none break-words" title={valueTitle || value}>{value}</p>
            {sub && <p className="text-[9px] text-gray-400 mt-1">{sub}</p>}
        </div>
    </div>
);

// ── Small KPI tile ────────────────────────────────────────────────
const SmallKpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: string;
}> = ({ label, value, valueTitle, sub, accent }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2">
        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
            <p className="text-[14px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none break-words" title={valueTitle || value}>{value}</p>
            {sub && <p className="text-[9px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
    </div>
);

// ── Chart tooltip ────────────────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg bg-white shadow border border-gray-100 p-2.5 text-[11px]">
            <p className="font-semibold text-brand-navy mb-1">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.payload?.fill }} />
                    <span className="text-gray-500">{p.name}:</span>
                    <span className="font-semibold tabular-nums text-brand-navy">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
                </div>
            ))}
        </div>
    );
};

// ── Page ─────────────────────────────────────────────────────────
const Statistics: React.FC = () => {
    const navigate = useNavigate();
    const [presetKey, setPresetKey] = useState<PresetKey>('30d');
    const [customRange, setCustomRange] = useState<StatsDateRange | null>(null);
    const [customOpen, setCustomOpen] = useState(false);
    const [pickingFrom, setPickingFrom] = useState<Date | null>(null);

    const range = useMemo<StatsDateRange>(() => customRange || computePreset(presetKey), [presetKey, customRange]);

    const { totals, daily, perPlatform, perCampaign, currency, campaigns, mediabuyer, isLoading } = useMediaBuyerStats(range);

    const rangeLabel = useMemo(() => {
        if (customRange) return `${format(parseISO(range.from), 'dd MMM yyyy')} → ${format(parseISO(range.to), 'dd MMM yyyy')}`;
        return PRESETS.find((p) => p.key === presetKey)?.label || 'Custom';
    }, [presetKey, customRange, range]);

    const rangeDays = useMemo(() => {
        try {
            return differenceInDays(parseISO(range.to), parseISO(range.from)) + 1;
        } catch {
            return 0;
        }
    }, [range]);

    const chartData = useMemo(
        () =>
            daily.map((d) => ({
                date: format(parseISO(d.date), 'dd MMM'),
                Spend: Number(d.spend.toFixed(2)),
                Revenue: Number(d.revenue.toFixed(2)),
                Leads: d.leads,
                Confirmed: d.confirmed,
                Delivered: d.delivered,
                CPL: d.costPerLead == null ? null : Number(d.costPerLead.toFixed(2)),
                CPC: d.costPerConfirmed == null ? null : Number(d.costPerConfirmed.toFixed(2)),
                CPD: d.costPerDelivered == null ? null : Number(d.costPerDelivered.toFixed(2)),
                ConfRate: d.confirmRate == null ? null : Number((d.confirmRate * 100).toFixed(2)),
                DelivRate: d.deliveryRate == null ? null : Number((d.deliveryRate * 100).toFixed(2)),
            })),
        [daily]
    );

    const bestDay = useMemo(() => {
        if (daily.length === 0) return null;
        return [...daily].sort((a, b) => b.revenue - a.revenue)[0];
    }, [daily]);
    const worstDay = useMemo(() => {
        if (daily.length === 0) return null;
        return [...daily].sort((a, b) => a.revenue - b.revenue)[0];
    }, [daily]);

    const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Statistics</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {rangeLabel} · {rangeDays} day{rangeDays !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                        {PRESETS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => { setPresetKey(p.key); setCustomRange(null); }}
                                className={cn(
                                    'h-7 px-2.5 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all',
                                    !customRange && presetKey === p.key
                                        ? 'bg-brand-navy text-white'
                                        : 'text-gray-400 hover:text-brand-navy border border-gray-100'
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                        <Popover open={customOpen} onOpenChange={setCustomOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    className={cn(
                                        'h-7 px-2.5 rounded-md text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 transition-all',
                                        customRange ? 'bg-brand-navy text-white' : 'text-gray-400 hover:text-brand-navy border border-gray-100'
                                    )}
                                >
                                    <CalendarIcon className="w-3 h-3" /> Custom
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="p-3 rounded-xl border-gray-100 shadow-lg w-auto" align="end">
                                <div className="space-y-2">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">
                                        {pickingFrom ? 'Pick end date' : 'Pick start date'}
                                    </p>
                                    <CalendarComponent
                                        mode="single"
                                        selected={pickingFrom ?? undefined}
                                        onSelect={(d) => {
                                            if (!d) return;
                                            if (!pickingFrom) {
                                                setPickingFrom(d);
                                            } else {
                                                const from = pickingFrom < d ? pickingFrom : d;
                                                const to = pickingFrom < d ? d : pickingFrom;
                                                setCustomRange({ from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') });
                                                setPickingFrom(null);
                                                setCustomOpen(false);
                                            }
                                        }}
                                    />
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </header>

            {/* Hero KPIs */}
            {isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <KpiTile
                        label="Total Spend"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={`${daily.length} day${daily.length !== 1 ? 's' : ''}`}
                        accent="#ef4444"
                    />
                    <KpiTile
                        label="Revenue"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={mediabuyer?.payment_type === 'commission' ? `${fmtCur(Number(mediabuyer.commission_price || 0), currency)} / del` : 'commission'}
                        accent="#059669"
                    />
                    <KpiTile
                        label="Active Campaigns"
                        value={fmtNumCompact(activeCampaigns)}
                        sub={`${campaigns.length} total`}
                        accent="#3b5e5e"
                    />
                    <KpiTile
                        label="Delivered"
                        value={fmtNumCompact(totals.delivered)}
                        valueTitle={fmtNum(totals.delivered)}
                        sub={fmtPct(totals.deliveryRate) + ' liv rate'}
                        accent="#059669"
                    />
                </div>
            )}

            {/* Secondary KPIs */}
            {!isLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                    <SmallKpiTile label="Leads" value={fmtNumCompact(totals.leads)} valueTitle={fmtNum(totals.leads)} accent="#3b5e5e" />
                    <SmallKpiTile label="Confirmed" value={fmtNumCompact(totals.confirmed)} valueTitle={fmtNum(totals.confirmed)} sub={fmtPct(totals.confirmRate)} accent="#3b5e5e" />
                    <SmallKpiTile
                        label="Cost / Lead"
                        value={totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}
                        valueTitle={totals.costPerLead == null ? undefined : fmtCurFull(totals.costPerLead, currency)}
                        accent="#d97706"
                    />
                    <SmallKpiTile
                        label="Cost / Conf"
                        value={totals.costPerConfirmed == null ? '—' : fmtCur(totals.costPerConfirmed, currency)}
                        valueTitle={totals.costPerConfirmed == null ? undefined : fmtCurFull(totals.costPerConfirmed, currency)}
                        accent="#d97706"
                    />
                    <SmallKpiTile
                        label="Cost / Del"
                        value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                        valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                        accent="#d97706"
                    />
                    <SmallKpiTile label="Conf rate" value={fmtPct(totals.confirmRate)} accent="#3b5e5e" />
                    <SmallKpiTile label="Deliv rate" value={fmtPct(totals.deliveryRate)} accent="#059669" />
                </div>
            )}

            {/* Empty state */}
            {!isLoading && daily.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white">
                    <div className="py-8 flex flex-col items-center text-center gap-3">
                        <BarChart3 className="w-6 h-6 text-gray-400" />
                        <div className="space-y-1 max-w-md">
                            <p className="text-[12px] font-semibold text-brand-navy">No performance data for this range</p>
                            <p className="text-[11px] text-gray-400">
                                {campaigns.length === 0
                                    ? 'Create your first campaign to start tracking performance.'
                                    : 'Add daily entries or pick a wider date range.'}
                            </p>
                        </div>
                        <Button
                            onClick={() => navigate('/mediabuyer/campaigns')}
                            className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5"
                        >
                            Go to campaigns <ArrowRight className="w-3 h-3" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Main chart + platform breakdown */}
            {!isLoading && daily.length > 0 && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        {/* Performance over time */}
                        <div className="rounded-xl border border-gray-100 bg-white p-3.5 lg:col-span-2">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-3">Performance over time</p>
                            <Tabs defaultValue="finance">
                                <TabsList className="h-8">
                                    <TabsTrigger className="text-[11px] h-6 px-3 gap-1.5" value="finance">Finance</TabsTrigger>
                                    <TabsTrigger className="text-[11px] h-6 px-3 gap-1.5" value="volume">Volume</TabsTrigger>
                                    <TabsTrigger className="text-[11px] h-6 px-3 gap-1.5" value="cost">Cost</TabsTrigger>
                                    <TabsTrigger className="text-[11px] h-6 px-3 gap-1.5" value="rates">Rates</TabsTrigger>
                                </TabsList>

                                <TabsContent value="finance" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="spendStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="revStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                            <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={1.5} fill="url(#spendStatsGrad)" />
                                            <Area type="monotone" dataKey="Revenue" stroke="#059669" strokeWidth={1.5} fill="url(#revStatsGrad)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="volume" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <BarChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.03)' }} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                            <Bar dataKey="Leads" fill="#3b5e5e" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Confirmed" fill="#d97706" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Delivered" fill="#059669" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="cost" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                            <Line type="monotone" dataKey="CPL" stroke="#3b5e5e" strokeWidth={1.5} dot={{ r: 2 }} name="Cost / Lead" />
                                            <Line type="monotone" dataKey="CPC" stroke="#d97706" strokeWidth={1.5} dot={{ r: 2 }} name="Cost / Confirmed" />
                                            <Line type="monotone" dataKey="CPD" stroke="#059669" strokeWidth={1.5} dot={{ r: 2 }} name="Cost / Delivered" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="rates" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={180}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="confStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="delivStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit="%" />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                            <Area type="monotone" dataKey="ConfRate" stroke="#3b5e5e" strokeWidth={1.5} fill="url(#confStatsGrad)" name="Confirmation %" />
                                            <Area type="monotone" dataKey="DelivRate" stroke="#059669" strokeWidth={1.5} fill="url(#delivStatsGrad)" name="Delivery %" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </TabsContent>
                            </Tabs>
                        </div>

                        {/* Platform split */}
                        <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-3">Spend by platform</p>
                            {perPlatform.length === 0 ? (
                                <p className="text-[11px] text-gray-400">No spend yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {perPlatform.slice(0, 6).map((p) => {
                                        const pct = totals.spend > 0 ? (p.spend / totals.spend) * 100 : 0;
                                        return (
                                            <div key={p.platform} className="flex items-center gap-2.5">
                                                <div
                                                    className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0"
                                                    style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                >
                                                    {getPlatformIcon(p.platform, 'w-3 h-3')}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-0.5">
                                                        <p className="text-[10px] font-semibold text-brand-navy truncate">{p.platform}</p>
                                                        <p className="text-[9px] tabular-nums text-gray-400">{pct.toFixed(1)}%</p>
                                                    </div>
                                                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: getPlatformColor(p.platform) }} />
                                                    </div>
                                                    <p className="text-[9px] text-gray-400 tabular-nums mt-0.5">{fmtCur(p.spend, currency)} spend · {fmtCur(p.revenue, currency)} rev</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Best / worst day */}
                    {bestDay && worstDay && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 flex items-start gap-3">
                                <Trophy className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-emerald-700">Best day</p>
                                    <p className="text-[12px] font-semibold text-emerald-800 mt-0.5">{format(parseISO(bestDay.date), 'EEE dd MMM yyyy')}</p>
                                    <p className="text-[10px] text-emerald-700/70 tabular-nums mt-0.5">
                                        {fmtCurFull(bestDay.revenue, currency)} rev · {fmtNum(bestDay.delivered)} del · {fmtCurFull(bestDay.spend, currency)} spend
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-xl border border-red-100 bg-red-50/40 p-3.5 flex items-start gap-3">
                                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-red-600">Worst day</p>
                                    <p className="text-[12px] font-semibold text-red-800 mt-0.5">{format(parseISO(worstDay.date), 'EEE dd MMM yyyy')}</p>
                                    <p className="text-[10px] text-red-700/70 tabular-nums mt-0.5">
                                        {fmtCurFull(worstDay.revenue, currency)} rev · {fmtNum(worstDay.delivered)} del · {fmtCurFull(worstDay.spend, currency)} spend
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Platform + campaign leaderboards */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {/* Platform leaderboard */}
                        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                            <div className="px-3.5 py-3 border-b border-gray-100">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Platform leaderboard</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Platform</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Del</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPD</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {perPlatform.map((p) => (
                                            <tr key={p.platform} className="border-b border-gray-50 hover:bg-gray-50/50">
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <div
                                                            className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                        >
                                                            {getPlatformIcon(p.platform, 'w-3 h-3')}
                                                        </div>
                                                        <span className="text-[11px] font-semibold text-brand-navy/80">{p.platform}</span>
                                                    </div>
                                                </td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(p.spend, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-emerald-600 tabular-nums">{fmtNum(p.delivered)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{p.costPerDelivered == null ? '—' : fmtCurFull(p.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(p.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Campaign leaderboard */}
                        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                            <div className="px-3.5 py-3 border-b border-gray-100 flex items-center justify-between">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Campaign leaderboard</p>
                                <Button variant="ghost" size="sm" onClick={() => navigate('/mediabuyer/campaigns')} className="h-6 text-[9px] font-semibold text-gray-400 hover:text-brand-navy gap-1 px-1.5">
                                    All <ExternalLink className="w-3 h-3" />
                                </Button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Campaign</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Del</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Rev</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {perCampaign.slice(0, 10).map((c) => (
                                            <tr
                                                key={c.id}
                                                onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                                className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                                            >
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <div
                                                            className="w-4 h-4 rounded flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(c.platform) }}
                                                        >
                                                            {getPlatformIcon(c.platform, 'w-2.5 h-2.5')}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-[11px] font-semibold text-brand-navy truncate">{c.name}</p>
                                                            <p className="text-[9px] text-gray-400">{c.status === 'active' ? '● Active' : '○ Draft'}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(c.spend, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-emerald-600 tabular-nums">{fmtNum(c.delivered)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(c.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                        {perCampaign.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="text-center py-8 text-[11px] text-gray-400">
                                                    No campaigns with data in this range.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Daily rollup table */}
                    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                        <div className="px-3.5 py-3 border-b border-gray-100">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Daily breakdown</p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 sticky left-0 bg-white">Date</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Leads</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Conf</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Deliv</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPL</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPC</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPD</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">%C</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">%L</th>
                                        <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Revenue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daily.map((d) => (
                                        <tr key={d.date} className="border-b border-gray-50 hover:bg-gray-50/50">
                                            <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy/80 tabular-nums sticky left-0 bg-white">
                                                {format(parseISO(d.date), 'EEE dd MMM')}
                                            </td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(d.spend, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(d.leads)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtNum(d.confirmed)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-emerald-600 tabular-nums">{fmtNum(d.delivered)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtPct(d.confirmRate)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtPct(d.deliveryRate)}</td>
                                            <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{fmtCurFull(d.revenue, currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-brand-navy text-white tabular-nums">
                                        <td className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] sticky left-0 bg-brand-navy">Totals</td>
                                        <td className="text-right px-3 py-2 text-[11px]">{fmtCurFull(totals.spend, currency)}</td>
                                        <td className="text-right px-3 py-2 text-[11px]">{fmtNum(totals.leads)}</td>
                                        <td className="text-right px-3 py-2 text-[11px]">{fmtNum(totals.confirmed)}</td>
                                        <td className="text-right px-3 py-2 text-[11px]">{fmtNum(totals.delivered)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-white/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-white/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-white/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-white/70">{fmtPct(totals.confirmRate)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-white/70">{fmtPct(totals.deliveryRate)}</td>
                                        <td className="text-right px-3 py-2 text-[11px]">{fmtCurFull(totals.revenue, currency)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default Statistics;
