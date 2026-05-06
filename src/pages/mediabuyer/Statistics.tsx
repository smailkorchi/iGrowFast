import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    format,
    differenceInDays,
    parseISO,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Calendar as CalendarIcon,
    BarChart3,
    ExternalLink,
    ArrowRight,
    Trophy,
    AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
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

// Ant tokens
const ANT = {
    ink: '#141413',
    orange: '#D97706',
    green: '#2D7A3E',
    rose: '#c93942',
    mid: '#6b6a63',
    line: '#e8e6dc',
    paper: '#ffffff',
};

// ── Date range presets ───────────────────────────────────────────
type PresetKey = '7d' | '30d' | 'mtd' | 'lastmonth' | 'all';

const PRESETS: { key: PresetKey; label: string }[] = [
    { key: '7d', label: '7j' },
    { key: '30d', label: '30j' },
    { key: 'mtd', label: 'Ce mois' },
    { key: 'lastmonth', label: 'Mois dernier' },
    { key: 'all', label: 'Tout' },
];

const PRESET_FULL_LABEL: Record<PresetKey, string> = {
    '7d': '7 derniers jours',
    '30d': '30 derniers jours',
    'mtd': 'Ce mois-ci',
    'lastmonth': 'Mois dernier',
    'all': 'Depuis le début',
};

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

// ── KPI hairline tile ─────────────────────────────────────────────
const KpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: string;
}> = ({ label, value, valueTitle, sub, accent }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink break-words" title={valueTitle || value}>
            {value}
        </p>
        {sub && <p className="font-serif italic text-[11px] text-ant-mid">{sub}</p>}
    </div>
);

const SmallKpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: string;
}> = ({ label, value, valueTitle, sub, accent }) => (
    <div className="bg-ant-paper p-3 md:p-3.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
            <span className={cn('w-0.5 h-3 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[15px] md:text-[16px] leading-none tabular-nums text-ant-ink break-words" title={valueTitle || value}>
            {value}
        </p>
        {sub && <p className="font-serif italic text-[10px] text-ant-mid">{sub}</p>}
    </div>
);

// ── Chart tooltip ────────────────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-xl bg-ant-paper border border-ant-line p-3 shadow-[0_8px_24px_rgba(20,20,19,0.08)] text-[11px]">
            <p className="font-display text-ant-ink mb-1.5">{label}</p>
            <div className="space-y-1">
                {payload.map((p: any) => (
                    <div key={p.dataKey} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || p.payload?.fill }} />
                        <span className="text-ant-mid flex-1">{p.name}</span>
                        <span className="tabular-nums text-ant-ink font-medium">
                            {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Chart tab key ────────────────────────────────────────────────
type ChartTab = 'finance' | 'volume' | 'cost' | 'rates';
const CHART_TABS: { key: ChartTab; label: string }[] = [
    { key: 'finance', label: 'Finance' },
    { key: 'volume', label: 'Volume' },
    { key: 'cost', label: 'Coût' },
    { key: 'rates', label: 'Taux' },
];

const Statistics: React.FC = () => {
    const navigate = useNavigate();
    const [presetKey, setPresetKey] = useState<PresetKey>('30d');
    const [customRange, setCustomRange] = useState<StatsDateRange | null>(null);
    const [customOpen, setCustomOpen] = useState(false);
    const [pickingFrom, setPickingFrom] = useState<Date | null>(null);
    const [chartTab, setChartTab] = useState<ChartTab>('finance');

    const range = useMemo<StatsDateRange>(() => customRange || computePreset(presetKey), [presetKey, customRange]);

    const { totals, daily, perPlatform, perCampaign, currency, campaigns, mediabuyer, isLoading } = useMediaBuyerStats(range);

    const rangeLabel = useMemo(() => {
        if (customRange) return `${format(parseISO(range.from), 'dd MMM yyyy', { locale: fr })} → ${format(parseISO(range.to), 'dd MMM yyyy', { locale: fr })}`;
        return PRESET_FULL_LABEL[presetKey];
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
                date: format(parseISO(d.date), 'dd MMM', { locale: fr }),
                Dépense: Number(d.spend.toFixed(2)),
                Revenu: Number(d.revenue.toFixed(2)),
                Leads: d.leads,
                Confirmées: d.confirmed,
                Livrées: d.delivered,
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
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Media Buyer · Statistiques
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Performance
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            {rangeLabel} · {rangeDays} jour{rangeDays !== 1 ? 's' : ''} de données
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto no-scrollbar">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.key}
                                    type="button"
                                    onClick={() => { setPresetKey(p.key); setCustomRange(null); }}
                                    className={cn(
                                        'shrink-0 h-8 px-3 rounded-full text-[11px] font-medium transition-all',
                                        !customRange && presetKey === p.key
                                            ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]'
                                            : 'text-ant-mid hover:text-ant-ink',
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <Popover open={customOpen} onOpenChange={setCustomOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    className={cn(
                                        'h-10 px-3.5 rounded-full border text-[11px] font-medium flex items-center gap-1.5 transition-all',
                                        customRange
                                            ? 'bg-ant-ink text-ant-light border-ant-ink'
                                            : 'bg-ant-paper text-ant-ink border-ant-line hover:bg-ant-light',
                                    )}
                                >
                                    <CalendarIcon className="w-3.5 h-3.5" /> Personnalisé
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="p-3 rounded-2xl border-ant-line bg-ant-paper shadow-[0_20px_50px_-12px_rgba(20,20,19,0.25)] w-auto" align="end">
                                <div className="space-y-2">
                                    <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        {pickingFrom ? 'Choisir la date de fin' : 'Choisir la date de début'}
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="bg-ant-paper p-4 space-y-2">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-7 w-20" />
                            <Skeleton className="h-3 w-14" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <KpiTile
                        label="Dépenses totales"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={`${daily.length} jour${daily.length !== 1 ? 's' : ''} de données`}
                        accent="bg-ant-rose"
                    />
                    <KpiTile
                        label="Revenus"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={mediabuyer?.payment_type === 'commission' ? `${fmtCur(Number(mediabuyer.commission_price || 0), currency)} / livrée` : 'commission'}
                        accent="bg-ant-green"
                    />
                    <KpiTile
                        label="Campagnes actives"
                        value={fmtNumCompact(activeCampaigns)}
                        sub={`${campaigns.length} au total`}
                        accent="bg-ant-ink"
                    />
                    <KpiTile
                        label="Livrées"
                        value={fmtNumCompact(totals.delivered)}
                        valueTitle={fmtNum(totals.delivered)}
                        sub={fmtPct(totals.deliveryRate) + ' taux livraison'}
                        accent="bg-ant-green"
                    />
                </div>
            )}

            {/* Secondary KPIs */}
            {!isLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <SmallKpiTile label="Leads" value={fmtNumCompact(totals.leads)} valueTitle={fmtNum(totals.leads)} accent="bg-ant-ink" />
                    <SmallKpiTile label="Confirmées" value={fmtNumCompact(totals.confirmed)} valueTitle={fmtNum(totals.confirmed)} sub={fmtPct(totals.confirmRate)} accent="bg-ant-ink" />
                    <SmallKpiTile
                        label="Coût / Lead"
                        value={totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}
                        valueTitle={totals.costPerLead == null ? undefined : fmtCurFull(totals.costPerLead, currency)}
                        accent="bg-ant-orange"
                    />
                    <SmallKpiTile
                        label="Coût / Conf."
                        value={totals.costPerConfirmed == null ? '—' : fmtCur(totals.costPerConfirmed, currency)}
                        valueTitle={totals.costPerConfirmed == null ? undefined : fmtCurFull(totals.costPerConfirmed, currency)}
                        accent="bg-ant-orange"
                    />
                    <SmallKpiTile
                        label="Coût / Livrée"
                        value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                        valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                        accent="bg-ant-orange"
                    />
                    <SmallKpiTile label="Taux conf." value={fmtPct(totals.confirmRate)} accent="bg-ant-ink" />
                    <SmallKpiTile label="Taux livr." value={fmtPct(totals.deliveryRate)} accent="bg-ant-green" />
                </div>
            )}

            {/* Empty state */}
            {!isLoading && daily.length === 0 && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <BarChart3 className="w-6 h-6 text-ant-mid" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">Aucune donnée pour cette période</p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-md mx-auto">
                                {campaigns.length === 0
                                    ? 'Créez votre première campagne pour commencer à suivre la performance.'
                                    : 'Ajoutez des entrées quotidiennes ou élargissez la plage de dates.'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/mediabuyer/campaigns')}
                            className="mt-2 inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors"
                        >
                            Voir les campagnes <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </section>
            )}

            {/* Main chart + platform split */}
            {!isLoading && daily.length > 0 && (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
                        {/* Performance over time */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden lg:col-span-2">
                            <div className="h-[3px] w-full bg-ant-ink" />
                            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[11px] text-ant-orange">01</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Performance dans le temps
                                        </span>
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                        Tendances quotidiennes · {rangeDays} jour{rangeDays !== 1 ? 's' : ''}
                                    </p>
                                </div>
                                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-light/50 overflow-x-auto no-scrollbar shrink-0">
                                    {CHART_TABS.map((t) => (
                                        <button
                                            key={t.key}
                                            type="button"
                                            onClick={() => setChartTab(t.key)}
                                            className={cn(
                                                'shrink-0 h-7 px-3 rounded-full text-[11px] font-medium transition-all',
                                                chartTab === t.key
                                                    ? 'bg-ant-ink text-ant-light shadow-[0_4px_12px_-4px_rgba(20,20,19,0.3)]'
                                                    : 'text-ant-mid hover:text-ant-ink',
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="p-3 md:p-5">
                                {chartTab === 'finance' && (
                                    <ResponsiveContainer width="100%" height={220}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="spendStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ANT.rose} stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor={ANT.rose} stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="revStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ANT.green} stopOpacity={0.28} />
                                                    <stop offset="95%" stopColor={ANT.green} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: ANT.mid }} />
                                            <Area type="monotone" dataKey="Dépense" stroke={ANT.rose} strokeWidth={1.75} fill="url(#spendStatsGrad)" />
                                            <Area type="monotone" dataKey="Revenu" stroke={ANT.green} strokeWidth={1.75} fill="url(#revStatsGrad)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                )}

                                {chartTab === 'volume' && (
                                    <ResponsiveContainer width="100%" height={220}>
                                        <BarChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(20,20,19,0.04)' }} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: ANT.mid }} />
                                            <Bar dataKey="Leads" fill={ANT.ink} radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Confirmées" fill={ANT.orange} radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Livrées" fill={ANT.green} radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}

                                {chartTab === 'cost' && (
                                    <ResponsiveContainer width="100%" height={220}>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: ANT.mid }} />
                                            <Line type="monotone" dataKey="CPL" stroke={ANT.ink} strokeWidth={1.75} dot={{ r: 2 }} name="Coût / Lead" />
                                            <Line type="monotone" dataKey="CPC" stroke={ANT.orange} strokeWidth={1.75} dot={{ r: 2 }} name="Coût / Confirmée" />
                                            <Line type="monotone" dataKey="CPD" stroke={ANT.green} strokeWidth={1.75} dot={{ r: 2 }} name="Coût / Livrée" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}

                                {chartTab === 'rates' && (
                                    <ResponsiveContainer width="100%" height={220}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="confStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ANT.ink} stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor={ANT.ink} stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="delivStatsGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ANT.green} stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor={ANT.green} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke={ANT.line} vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: ANT.mid }} axisLine={false} tickLine={false} unit="%" />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: ANT.mid }} />
                                            <Area type="monotone" dataKey="ConfRate" stroke={ANT.ink} strokeWidth={1.75} fill="url(#confStatsGrad)" name="Taux confirmation %" />
                                            <Area type="monotone" dataKey="DelivRate" stroke={ANT.green} strokeWidth={1.75} fill="url(#delivStatsGrad)" name="Taux livraison %" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </section>

                        {/* Platform split */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="px-4 md:px-5 py-4 md:py-5 border-b border-ant-line">
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[11px] text-ant-orange">02</span>
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Dépenses par plateforme
                                    </span>
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                    Répartition relative du budget
                                </p>
                            </div>
                            <div className="p-4 md:p-5">
                                {perPlatform.length === 0 ? (
                                    <p className="font-serif italic text-[12px] text-ant-mid">Aucune dépense.</p>
                                ) : (
                                    <div className="space-y-3">
                                        {perPlatform.slice(0, 6).map((p) => {
                                            const pct = totals.spend > 0 ? (p.spend / totals.spend) * 100 : 0;
                                            return (
                                                <div key={p.platform} className="space-y-1.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <div
                                                            className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                        >
                                                            {getPlatformIcon(p.platform, 'w-3 h-3')}
                                                        </div>
                                                        <span className="font-display text-[12px] text-ant-ink flex-1 truncate">{p.platform}</span>
                                                        <span className="font-display text-[12px] tabular-nums text-ant-ink">{pct.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-1 rounded-full bg-ant-line overflow-hidden">
                                                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: getPlatformColor(p.platform) }} />
                                                    </div>
                                                    <p className="text-[10px] text-ant-mid tabular-nums">
                                                        {fmtCur(p.spend, currency)} dépensé · {fmtCur(p.revenue, currency)} gagné
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Best / worst day */}
                    {bestDay && worstDay && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                            <section className="rounded-2xl border border-ant-green/25 bg-ant-green/5 overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-green" />
                                <div className="p-4 md:p-5 flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-ant-green/15 flex items-center justify-center text-ant-green shrink-0">
                                        <Trophy className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-green">
                                            Meilleur jour
                                        </span>
                                        <p className="font-display text-[14px] text-ant-ink">
                                            {format(parseISO(bestDay.date), 'EEEE d MMMM yyyy', { locale: fr })}
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                                            {fmtCurFull(bestDay.revenue, currency)} revenus · {fmtNum(bestDay.delivered)} livrées · {fmtCurFull(bestDay.spend, currency)} dépensés
                                        </p>
                                    </div>
                                </div>
                            </section>
                            <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/5 overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-rose" />
                                <div className="p-4 md:p-5 flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-ant-rose/12 flex items-center justify-center text-ant-rose shrink-0">
                                        <AlertCircle className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                            Jour le plus faible
                                        </span>
                                        <p className="font-display text-[14px] text-ant-ink">
                                            {format(parseISO(worstDay.date), 'EEEE d MMMM yyyy', { locale: fr })}
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                                            {fmtCurFull(worstDay.revenue, currency)} revenus · {fmtNum(worstDay.delivered)} livrées · {fmtCurFull(worstDay.spend, currency)} dépensés
                                        </p>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}

                    {/* Platform + campaign leaderboards */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5">
                        {/* Platform leaderboard */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-ink" />
                            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[11px] text-ant-orange">03</span>
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Classement des plateformes
                                    </span>
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                    Performance par canal publicitaire
                                </p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light/40">
                                            <th className="text-left px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Plateforme</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Dépenses</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Livrées</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">CPL</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Revenus</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {perPlatform.map((p) => (
                                            <tr key={p.platform} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-6 h-6 rounded-lg flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(p.platform) }}
                                                        >
                                                            {getPlatformIcon(p.platform, 'w-3 h-3')}
                                                        </div>
                                                        <span className="font-display text-[12px] text-ant-ink">{p.platform}</span>
                                                    </div>
                                                </td>
                                                <td className="text-right px-4 py-2.5 text-[12px] text-ant-ink tabular-nums">{fmtCurFull(p.spend, currency)}</td>
                                                <td className="text-right px-4 py-2.5 text-[12px] text-ant-green tabular-nums">{fmtNum(p.delivered)}</td>
                                                <td className="text-right px-4 py-2.5 text-[12px] text-ant-ink tabular-nums">{p.costPerDelivered == null ? '—' : fmtCurFull(p.costPerDelivered, currency)}</td>
                                                <td className="text-right px-4 py-2.5 font-display text-[13px] text-ant-ink tabular-nums">{fmtCurFull(p.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        {/* Campaign leaderboard */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line flex items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[11px] text-ant-orange">04</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Classement des campagnes
                                        </span>
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                        Top 10 par revenus
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate('/mediabuyer/campaigns')}
                                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors shrink-0"
                                >
                                    Toutes <ExternalLink className="w-3 h-3" />
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light/40">
                                            <th className="text-left px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Campagne</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Dép.</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Livr.</th>
                                            <th className="text-right px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Rev.</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {perCampaign.slice(0, 10).map((c) => (
                                            <tr
                                                key={c.id}
                                                onClick={() => navigate(`/mediabuyer/campaigns/${c.id}`)}
                                                className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 cursor-pointer transition-colors"
                                            >
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <div
                                                            className="w-5 h-5 rounded flex items-center justify-center text-white shrink-0"
                                                            style={{ backgroundColor: getPlatformColor(c.platform) }}
                                                        >
                                                            {getPlatformIcon(c.platform, 'w-3 h-3')}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-display text-[12px] text-ant-ink truncate leading-tight">{c.name}</p>
                                                            <p className="text-[10px] text-ant-mid mt-0.5 flex items-center gap-1">
                                                                <span className={cn('w-1 h-1 rounded-full', c.status === 'active' ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                                {c.status === 'active' ? 'Active' : 'Brouillon'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="text-right px-4 py-2.5 text-[12px] text-ant-ink tabular-nums">{fmtCurFull(c.spend, currency)}</td>
                                                <td className="text-right px-4 py-2.5 text-[12px] text-ant-green tabular-nums">{fmtNum(c.delivered)}</td>
                                                <td className="text-right px-4 py-2.5 font-display text-[13px] text-ant-ink tabular-nums">{fmtCurFull(c.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                        {perCampaign.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="text-center py-8 font-serif italic text-[12px] text-ant-mid">
                                                    Aucune campagne avec données dans cette plage.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>

                    {/* Daily rollup */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                            <div className="flex items-center gap-2">
                                <span className="font-display text-[11px] text-ant-orange">05</span>
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Détail quotidien
                                </span>
                            </div>
                            <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                {daily.length} ligne{daily.length !== 1 ? 's' : ''} · totalisation en bas
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/40">
                                        <th className="text-left px-4 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid sticky left-0 bg-ant-light/95 backdrop-blur z-10">Date</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Dép.</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Leads</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Conf.</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Livr.</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">CPL</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">CPC</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">CPD</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">%C</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">%L</th>
                                        <th className="text-right px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Revenus</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daily.map((d) => (
                                        <tr key={d.date} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 transition-colors">
                                            <td className="px-4 py-2.5 font-display text-[12px] text-ant-ink tabular-nums sticky left-0 bg-ant-paper z-10">
                                                {format(parseISO(d.date), 'EEE dd MMM', { locale: fr })}
                                            </td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-ink tabular-nums">{fmtCurFull(d.spend, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-ink tabular-nums">{fmtNum(d.leads)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-ink tabular-nums">{fmtNum(d.confirmed)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-green tabular-nums">{fmtNum(d.delivered)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-mid tabular-nums">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-mid tabular-nums">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-mid tabular-nums">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-mid tabular-nums">{fmtPct(d.confirmRate)}</td>
                                            <td className="text-right px-3 py-2.5 text-[12px] text-ant-mid tabular-nums">{fmtPct(d.deliveryRate)}</td>
                                            <td className="text-right px-3 py-2.5 font-display text-[13px] text-ant-ink tabular-nums">{fmtCurFull(d.revenue, currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-ant-ink text-ant-light tabular-nums">
                                        <td className="px-4 py-3 font-display text-[10px] uppercase tracking-[0.22em] sticky left-0 bg-ant-ink z-10">
                                            Totaux
                                        </td>
                                        <td className="text-right px-3 py-3 font-display text-[13px]">{fmtCurFull(totals.spend, currency)}</td>
                                        <td className="text-right px-3 py-3 font-display text-[13px]">{fmtNum(totals.leads)}</td>
                                        <td className="text-right px-3 py-3 font-display text-[13px]">{fmtNum(totals.confirmed)}</td>
                                        <td className="text-right px-3 py-3 font-display text-[13px]">{fmtNum(totals.delivered)}</td>
                                        <td className="text-right px-3 py-3 text-[12px] text-ant-light/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                        <td className="text-right px-3 py-3 text-[12px] text-ant-light/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                        <td className="text-right px-3 py-3 text-[12px] text-ant-light/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                        <td className="text-right px-3 py-3 text-[12px] text-ant-light/70">{fmtPct(totals.confirmRate)}</td>
                                        <td className="text-right px-3 py-3 text-[12px] text-ant-light/70">{fmtPct(totals.deliveryRate)}</td>
                                        <td className="text-right px-3 py-3 font-display text-[14px] text-ant-orange">{fmtCurFull(totals.revenue, currency)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
};

export default Statistics;
