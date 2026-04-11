import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    startOfMonth,
    endOfMonth,
    subDays,
    subMonths,
    startOfDay,
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
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
    PieChart,
    Pie,
    Cell,
} from 'recharts';
import { getPlatformIcon, getPlatformColor } from '@/lib/campaignConstants';
import { useMediaBuyerStats, type StatsDateRange } from '@/hooks/useMediaBuyerStats';
import { fmtCur, fmtCurFull, fmtNum, fmtNumCompact, fmtPct } from '@/lib/formatNumbers';

// ── Date range presets ───────────────────────────────────────────
type PresetKey = '7d' | '30d' | 'mtd' | 'lastmonth' | 'all';

const PRESETS: { key: PresetKey; label: string }[] = [
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'mtd', label: 'This month' },
    { key: 'lastmonth', label: 'Last month' },
    { key: 'all', label: 'All time' },
];

const computePreset = (key: PresetKey): StatsDateRange => {
    const today = startOfDay(new Date());
    switch (key) {
        case '7d':
            return { from: format(subDays(today, 6), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
        case '30d':
            return { from: format(subDays(today, 29), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
        case 'mtd':
            return { from: format(startOfMonth(today), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
        case 'lastmonth': {
            const lm = subMonths(today, 1);
            return { from: format(startOfMonth(lm), 'yyyy-MM-dd'), to: format(endOfMonth(lm), 'yyyy-MM-dd') };
        }
        case 'all':
        default:
            return { from: '2000-01-01', to: format(today, 'yyyy-MM-dd') };
    }
};

// ── KPI card ─────────────────────────────────────────────────────
// The value is rendered inside a `break-words` container so large compact strings like
// "1.2B MAD" still wrap nicely on very narrow widths instead of being ellipsed away.
// An optional `title` prop is applied to show the full value on hover.
const Kpi: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
    tone?: string;
    large?: boolean;
}> = ({ label, value, valueTitle, sub, icon: Icon, tone = 'bg-brand-navy/10 text-brand-navy', large }) => (
    <div className={cn('rounded-3xl border border-gray-100/80 bg-white/90 shadow-sm backdrop-blur-sm', large ? 'p-5' : 'p-4')}>
        <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0 flex-1">
                <p className={cn('font-black uppercase tracking-widest text-gray-400', large ? 'text-[10px]' : 'text-[9px]')}>{label}</p>
                <p
                    title={valueTitle || value}
                    className={cn(
                        'font-black tabular-nums text-gray-900 tracking-tight leading-tight break-words',
                        large ? 'text-xl xl:text-2xl' : 'text-base xl:text-lg'
                    )}
                >
                    {value}
                </p>
                {sub && <p className="text-[10px] text-muted-foreground font-medium truncate">{sub}</p>}
            </div>
            <div className={cn('flex shrink-0 items-center justify-center rounded-2xl', tone, large ? 'h-10 w-10' : 'h-9 w-9')}>
                <Icon className={cn(large ? 'h-5 w-5' : 'h-4 w-4')} />
            </div>
        </div>
    </div>
);

// ── Chart tooltip ────────────────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-2xl bg-white/95 backdrop-blur shadow-2xl border border-brand-navy/5 p-3 text-[11px]">
            <p className="font-black text-brand-navy mb-1.5">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.payload?.fill }} />
                    <span className="font-medium text-brand-navy/60">{p.name}:</span>
                    <span className="font-bold tabular-nums text-brand-navy">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
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

    const platformPieData = useMemo(
        () => perPlatform.filter((p) => p.spend > 0).map((p) => ({ name: p.platform, value: Number(p.spend.toFixed(2)), fill: getPlatformColor(p.platform) })),
        [perPlatform]
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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Statistics</h1>
                            <p className="text-gray-500 font-light">Aggregated performance across all your campaigns.</p>
                        </div>

                        {/* Date range controls */}
                        <div className="flex flex-col items-start md:items-end gap-2">
                            <div className="flex flex-wrap gap-2 bg-white/80 p-1 rounded-2xl border border-gray-100 shadow-sm">
                                {PRESETS.map((p) => (
                                    <Button
                                        key={p.key}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setPresetKey(p.key);
                                            setCustomRange(null);
                                        }}
                                        className={cn(
                                            'rounded-xl h-9 px-3.5 text-[11px] font-black uppercase tracking-wider transition-all',
                                            !customRange && presetKey === p.key
                                                ? 'bg-brand-navy text-white shadow-lg'
                                                : 'text-gray-400 hover:text-brand-navy'
                                        )}
                                    >
                                        {p.label}
                                    </Button>
                                ))}
                                <Popover open={customOpen} onOpenChange={setCustomOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={cn(
                                                'rounded-xl h-9 px-3.5 text-[11px] font-black uppercase tracking-wider gap-1.5 transition-all',
                                                customRange ? 'bg-brand-navy text-white shadow-lg' : 'text-gray-400 hover:text-brand-navy'
                                            )}
                                        >
                                            <CalendarIcon className="w-3.5 h-3.5" /> Custom
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="p-4 rounded-3xl border-none shadow-2xl w-auto" align="end">
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-brand-navy/50">
                                                {pickingFrom ? 'Pick end date' : 'Pick start date'}
                                            </div>
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
                            <p className="text-[11px] text-muted-foreground font-bold">
                                {rangeLabel} · {rangeDays} day{rangeDays !== 1 ? 's' : ''}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hero KPIs */}
            {isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-3xl bg-white/60" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Kpi
                        label="Total Spend"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={`${daily.length} day${daily.length !== 1 ? 's' : ''}`}
                        icon={DollarSign}
                        tone="bg-red-500/10 text-red-500"
                        large
                    />
                    <Kpi
                        label="Revenue"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={
                            mediabuyer?.payment_type === 'commission'
                                ? `${fmtCur(Number(mediabuyer.commission_price || 0), currency)} / delivered`
                                : 'commission'
                        }
                        icon={Wallet}
                        tone="bg-primary/10 text-primary"
                        large
                    />
                    <Kpi
                        label="Active Campaigns"
                        value={fmtNumCompact(activeCampaigns)}
                        sub={`${campaigns.length} total`}
                        icon={Megaphone}
                        tone="bg-indigo-500/10 text-indigo-500"
                        large
                    />
                    <Kpi
                        label="Delivered"
                        value={fmtNumCompact(totals.delivered)}
                        valueTitle={fmtNum(totals.delivered)}
                        sub={fmtPct(totals.deliveryRate) + ' liv rate'}
                        icon={PackageCheck}
                        tone="bg-emerald-500/10 text-emerald-600"
                        large
                    />
                </div>
            )}

            {/* Secondary KPIs */}
            {!isLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    <Kpi label="Leads" value={fmtNumCompact(totals.leads)} valueTitle={fmtNum(totals.leads)} icon={UsersIcon} tone="bg-blue-500/10 text-blue-500" />
                    <Kpi label="Confirmed" value={fmtNumCompact(totals.confirmed)} valueTitle={fmtNum(totals.confirmed)} sub={fmtPct(totals.confirmRate)} icon={CheckCircle2} tone="bg-indigo-500/10 text-indigo-500" />
                    <Kpi
                        label="Cost / Lead"
                        value={totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}
                        valueTitle={totals.costPerLead == null ? undefined : fmtCurFull(totals.costPerLead, currency)}
                        icon={Target}
                        tone="bg-amber-500/10 text-amber-600"
                    />
                    <Kpi
                        label="Cost / Confirmed"
                        value={totals.costPerConfirmed == null ? '—' : fmtCur(totals.costPerConfirmed, currency)}
                        valueTitle={totals.costPerConfirmed == null ? undefined : fmtCurFull(totals.costPerConfirmed, currency)}
                        icon={Target}
                        tone="bg-amber-500/10 text-amber-600"
                    />
                    <Kpi
                        label="Cost / Delivered"
                        value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                        valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                        icon={Target}
                        tone="bg-amber-500/10 text-amber-600"
                    />
                    <Kpi label="Confirm rate" value={fmtPct(totals.confirmRate)} icon={BarChart3} tone="bg-indigo-500/10 text-indigo-500" />
                    <Kpi label="Delivery rate" value={fmtPct(totals.deliveryRate)} icon={BarChart3} tone="bg-emerald-500/10 text-emerald-600" />
                </div>
            )}

            {/* Empty state */}
            {!isLoading && daily.length === 0 && (
                <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur">
                    <CardContent className="p-16 flex flex-col items-center text-center gap-5">
                        <div className="w-20 h-20 rounded-full bg-brand-navy/[0.04] flex items-center justify-center">
                            <BarChart3 className="w-10 h-10 text-brand-navy/20" />
                        </div>
                        <div className="space-y-1 max-w-md">
                            <h3 className="text-xl font-bold text-brand-navy">No performance data for this range</h3>
                            <p className="text-sm text-muted-foreground">
                                {campaigns.length === 0
                                    ? 'Create your first campaign to start tracking performance.'
                                    : 'Add daily entries to your campaigns or pick a wider date range to see data here.'}
                            </p>
                        </div>
                        <Button
                            onClick={() => navigate('/mediabuyer/campaigns')}
                            className="rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-white font-bold gap-2"
                        >
                            Go to campaigns <ArrowRight className="w-4 h-4" />
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Main chart + platform breakdown */}
            {!isLoading && daily.length > 0 && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Performance over time */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur lg:col-span-2 overflow-hidden">
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Performance over time</h2>
                                </div>
                                <Tabs defaultValue="finance">
                                    <TabsList className="bg-brand-navy/[0.04] p-1 rounded-2xl h-auto inline-flex gap-1 mb-5">
                                        <TabsTrigger value="finance" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Finance
                                        </TabsTrigger>
                                        <TabsTrigger value="volume" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Volume
                                        </TabsTrigger>
                                        <TabsTrigger value="cost" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Cost
                                        </TabsTrigger>
                                        <TabsTrigger value="rates" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Rates
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="finance" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={320}>
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="spendStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="revStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={2.5} fill="url(#spendStatsGrad)" />
                                                <Area type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revStatsGrad)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </TabsContent>

                                    <TabsContent value="volume" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={320}>
                                            <BarChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Bar dataKey="Leads" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                                                <Bar dataKey="Confirmed" fill="#6366f1" radius={[8, 8, 0, 0]} />
                                                <Bar dataKey="Delivered" fill="#10b981" radius={[8, 8, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </TabsContent>

                                    <TabsContent value="cost" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={320}>
                                            <LineChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Line type="monotone" dataKey="CPL" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} name="Cost / Lead" />
                                                <Line type="monotone" dataKey="CPC" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} name="Cost / Confirmed" />
                                                <Line type="monotone" dataKey="CPD" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} name="Cost / Delivered" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </TabsContent>

                                    <TabsContent value="rates" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={320}>
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="confStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="delivStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} unit="%" />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Area type="monotone" dataKey="ConfRate" stroke="#6366f1" strokeWidth={2.5} fill="url(#confStatsGrad)" name="Confirmation %" />
                                                <Area type="monotone" dataKey="DelivRate" stroke="#10b981" strokeWidth={2.5} fill="url(#delivStatsGrad)" name="Delivery %" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>

                        {/* Platform split */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                            <CardContent className="p-6">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50 mb-5">Spend by platform</h2>
                                {platformPieData.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No spend yet.</p>
                                ) : (
                                    <>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <PieChart>
                                                <Pie
                                                    data={platformPieData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={55}
                                                    outerRadius={85}
                                                    paddingAngle={3}
                                                    stroke="none"
                                                >
                                                    {platformPieData.map((p, i) => (
                                                        <Cell key={i} fill={p.fill} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<ChartTooltip />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="space-y-2 mt-4">
                                            {perPlatform.slice(0, 5).map((p) => {
                                                const pct = totals.spend > 0 ? (p.spend / totals.spend) * 100 : 0;
                                                return (
                                                    <div key={p.platform} className="flex items-center gap-3">
                                                        <div
                                                            className="w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                        >
                                                            {getPlatformIcon(p.platform, 'w-3 h-3')}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-bold text-brand-navy truncate">{p.platform}</p>
                                                            <p className="text-[10px] font-medium text-muted-foreground tabular-nums">
                                                                {fmtCur(p.spend, currency)} · {pct.toFixed(1)}%
                                                            </p>
                                                        </div>
                                                        <Badge
                                                            className="rounded-full text-[9px] font-black uppercase tabular-nums border-none bg-primary/10 text-primary"
                                                        >
                                                            {fmtCur(p.revenue, currency)}
                                                        </Badge>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Best / worst day */}
                    {bestDay && worstDay && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-[28px] bg-gradient-to-br from-emerald-500/10 via-emerald-50 to-white border border-emerald-100/50 p-6 shadow-sm">
                                <div className="flex items-start gap-4">
                                    <div className="h-12 w-12 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                                        <Trophy className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700/70">Best day</p>
                                        <p className="text-xl font-black text-emerald-800 mt-0.5">{format(parseISO(bestDay.date), 'EEE dd MMM yyyy')}</p>
                                        <p className="text-xs text-emerald-800/70 font-medium mt-1 tabular-nums">
                                            {fmtCurFull(bestDay.revenue, currency)} revenue · {fmtNum(bestDay.delivered)} delivered · {fmtCurFull(bestDay.spend, currency)} spent
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-[28px] bg-gradient-to-br from-red-500/10 via-red-50 to-white border border-red-100/50 p-6 shadow-sm">
                                <div className="flex items-start gap-4">
                                    <div className="h-12 w-12 rounded-2xl bg-red-500/15 text-red-600 flex items-center justify-center shrink-0">
                                        <AlertCircle className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-red-700/70">Worst day</p>
                                        <p className="text-xl font-black text-red-800 mt-0.5">{format(parseISO(worstDay.date), 'EEE dd MMM yyyy')}</p>
                                        <p className="text-xs text-red-800/70 font-medium mt-1 tabular-nums">
                                            {fmtCurFull(worstDay.revenue, currency)} revenue · {fmtNum(worstDay.delivered)} delivered · {fmtCurFull(worstDay.spend, currency)} spent
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Platform + campaign leaderboards */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {/* Platform leaderboard */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                            <CardContent className="p-0">
                                <div className="p-6 pb-4">
                                    <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Platform leaderboard</h2>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                                <th className="text-left px-6 py-3">Platform</th>
                                                <th className="text-right px-3 py-3">Spend</th>
                                                <th className="text-right px-3 py-3">Del</th>
                                                <th className="text-right px-3 py-3">CPD</th>
                                                <th className="text-right px-3 py-3 pr-6">Revenue</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {perPlatform.map((p) => (
                                                <tr key={p.platform} className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums">
                                                    <td className="px-6 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className="w-7 h-7 rounded-xl flex items-center justify-center text-white shrink-0"
                                                                style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                            >
                                                                {getPlatformIcon(p.platform, 'w-3.5 h-3.5')}
                                                            </div>
                                                            <span className="font-bold text-brand-navy text-xs">{p.platform}</span>
                                                        </div>
                                                    </td>
                                                    <td className="text-right px-3 py-3 font-bold text-brand-navy">{fmtCurFull(p.spend, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-emerald-600 font-bold">{fmtNum(p.delivered)}</td>
                                                    <td className="text-right px-3 py-3 text-brand-navy/50 text-xs">
                                                        {p.costPerDelivered == null ? '—' : fmtCurFull(p.costPerDelivered, currency)}
                                                    </td>
                                                    <td className="text-right px-3 py-3 pr-6 font-bold text-brand-navy">{fmtCurFull(p.revenue, currency)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Campaign leaderboard */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                            <CardContent className="p-0">
                                <div className="p-6 pb-4 flex items-center justify-between">
                                    <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Campaign leaderboard</h2>
                                    <Button variant="ghost" size="sm" onClick={() => navigate('/mediabuyer/campaigns')} className="text-[10px] font-black uppercase tracking-widest text-brand-navy/50 hover:text-brand-navy gap-1 h-auto px-2">
                                        All <ExternalLink className="w-3 h-3" />
                                    </Button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                                <th className="text-left px-6 py-3">Campaign</th>
                                                <th className="text-right px-3 py-3">Spend</th>
                                                <th className="text-right px-3 py-3">Del</th>
                                                <th className="text-right px-3 py-3 pr-6">Rev</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {perCampaign.slice(0, 10).map((c) => (
                                                <tr
                                                    key={c.id}
                                                    onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                                    className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums cursor-pointer"
                                                >
                                                    <td className="px-6 py-3">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div
                                                                className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0"
                                                                style={{ backgroundColor: getPlatformColor(c.platform) }}
                                                            >
                                                                {getPlatformIcon(c.platform, 'w-3 h-3')}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-brand-navy truncate">{c.name}</p>
                                                                <p className="text-[10px] text-muted-foreground">
                                                                    {c.status === 'active' ? '● Active' : '○ Draft'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="text-right px-3 py-3 font-bold">{fmtCurFull(c.spend, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-emerald-600 font-bold">{fmtNum(c.delivered)}</td>
                                                    <td className="text-right px-3 py-3 pr-6 font-bold">{fmtCurFull(c.revenue, currency)}</td>
                                                </tr>
                                            ))}
                                            {perCampaign.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">
                                                        No campaigns with data in this range.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Daily rollup table (sheet mimic) */}
                    <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                        <CardContent className="p-0">
                            <div className="p-6 pb-4">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Daily breakdown</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                            <th className="text-left px-6 py-3 sticky left-0 bg-white/95 backdrop-blur">Date</th>
                                            <th className="text-right px-3 py-3">Spend</th>
                                            <th className="text-right px-3 py-3">Leads</th>
                                            <th className="text-right px-3 py-3">Conf</th>
                                            <th className="text-right px-3 py-3">Deliv</th>
                                            <th className="text-right px-3 py-3">CPL</th>
                                            <th className="text-right px-3 py-3">CPC</th>
                                            <th className="text-right px-3 py-3">CPD</th>
                                            <th className="text-right px-3 py-3">%C</th>
                                            <th className="text-right px-3 py-3">%L</th>
                                            <th className="text-right px-3 py-3 pr-6">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {daily.map((d) => (
                                            <tr key={d.date} className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums">
                                                <td className="px-6 py-2.5 font-bold text-brand-navy sticky left-0 bg-white/95 backdrop-blur">
                                                    {format(parseISO(d.date), 'EEE dd MMM')}
                                                </td>
                                                <td className="text-right px-3 py-2.5 font-bold">{fmtCurFull(d.spend, currency)}</td>
                                                <td className="text-right px-3 py-2.5 text-brand-navy/70">{fmtNum(d.leads)}</td>
                                                <td className="text-right px-3 py-2.5 text-brand-navy/70">{fmtNum(d.confirmed)}</td>
                                                <td className="text-right px-3 py-2.5 text-emerald-600 font-bold">{fmtNum(d.delivered)}</td>
                                                <td className="text-right px-3 py-2.5 text-xs text-brand-navy/50">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                                <td className="text-right px-3 py-2.5 text-xs text-brand-navy/50">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                                <td className="text-right px-3 py-2.5 text-xs text-brand-navy/50">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-2.5 text-xs text-brand-navy/50">{fmtPct(d.confirmRate)}</td>
                                                <td className="text-right px-3 py-2.5 text-xs text-brand-navy/50">{fmtPct(d.deliveryRate)}</td>
                                                <td className="text-right px-3 py-2.5 pr-6 font-bold">{fmtCurFull(d.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-brand-navy text-white font-black tabular-nums">
                                            <td className="px-6 py-3 text-[10px] uppercase tracking-widest sticky left-0 bg-brand-navy">Totals</td>
                                            <td className="text-right px-3 py-3">{fmtCurFull(totals.spend, currency)}</td>
                                            <td className="text-right px-3 py-3">{fmtNum(totals.leads)}</td>
                                            <td className="text-right px-3 py-3">{fmtNum(totals.confirmed)}</td>
                                            <td className="text-right px-3 py-3">{fmtNum(totals.delivered)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-white/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-white/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-white/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-white/70">{fmtPct(totals.confirmRate)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-white/70">{fmtPct(totals.deliveryRate)}</td>
                                            <td className="text-right px-3 py-3 pr-6">{fmtCurFull(totals.revenue, currency)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};

export default Statistics;
