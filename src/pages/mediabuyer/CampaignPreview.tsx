import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    ArrowLeft,
    Edit2,
    Loader2,
    Megaphone,
    PlayCircle,
    TrendingUp,
    ListChecks,
    ChevronLeft,
    ChevronRight,
    Lock,
    Coins,
    Users as UsersIcon,
    CheckCircle2,
    Target,
    Wallet,
    type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
} from 'recharts';
import {
    getPlatformIcon,
    getPlatformColor,
    CAMPAIGN_TYPES,
    CONVERSION_TYPES,
    type Campaign,
    type CampaignMedia,
} from '@/lib/campaignConstants';
import { useCampaignMetrics } from '@/hooks/useCampaignMetrics';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useCampaignBasePath } from '@/hooks/useCampaignBasePath';
import { fmtCur, fmtCurFull, fmtNum, fmtNumCompact, fmtPct } from '@/lib/formatNumbers';

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

// ── KPI tile ──────────────────────────────────────────────────────────────────
const KpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, valueTitle, sub, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', a.dot)} />
                    <span className="truncate">{label}</span>
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center shrink-0', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p
                title={valueTitle || value}
                className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 leading-tight break-words"
            >
                {value}
            </p>
            {sub && <p className="text-[10px] text-ant-mid font-serif italic mt-0.5 truncate">{sub}</p>}
        </div>
    );
};

// ── Ad mockup ─────────────────────────────────────────────────────────────────
const AdMock: React.FC<{ campaign: Campaign; businessName: string; businessLogo: string | null }> = ({
    campaign,
    businessName,
    businessLogo,
}) => {
    const [idx, setIdx] = useState(0);
    const media = (campaign.media || []) as CampaignMedia[];
    const current = media[idx];
    const hasMultiple = media.length > 1;
    const stripe = campaign.status === 'active' ? 'bg-ant-green' : 'bg-ant-orange';

    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper">
            <div className={cn('h-[3px] w-full', stripe)} />
            <div className="flex items-center gap-2.5 px-3.5 py-3">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
                    {businessLogo ? (
                        <img src={businessLogo} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-semibold text-ant-ink">{(businessName || 'DG').substring(0, 2).toUpperCase()}</span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-ant-ink truncate leading-tight">{businessName || 'Your business'}</p>
                    <p className="text-[10px] font-serif italic text-ant-mid inline-flex items-center gap-1">
                        Sponsored · <span className="text-ant-mid">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5 inline')}</span>
                    </p>
                </div>
            </div>
            {campaign.primary_text && (
                <div className="px-3.5 pb-3">
                    <p className="text-[12px] leading-snug text-ant-ink/85 whitespace-pre-wrap break-words">{campaign.primary_text}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-ant-light">
                {current ? (
                    current.type === 'video' ? (
                        <video src={current.url} className="w-full h-full object-cover" controls muted playsInline loop />
                    ) : (
                        <img src={current.url} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-ant-mid/40">
                        <Megaphone className="w-10 h-10" strokeWidth={1.25} />
                        <span className="text-[10px] uppercase tracking-[0.24em] font-semibold">No media</span>
                    </div>
                )}
                {current?.type === 'video' && (
                    <div className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-ant-ink/55 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-4 h-4 text-white" />
                    </div>
                )}
                {hasMultiple && (
                    <>
                        <button
                            onClick={() => setIdx((i) => (i === 0 ? media.length - 1 : i - 1))}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ant-paper/90 backdrop-blur border border-ant-line flex items-center justify-center shadow-sm cursor-pointer hover:bg-ant-paper transition-colors"
                        >
                            <ChevronLeft className="w-3.5 h-3.5 text-ant-ink" />
                        </button>
                        <button
                            onClick={() => setIdx((i) => (i === media.length - 1 ? 0 : i + 1))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-ant-paper/90 backdrop-blur border border-ant-line flex items-center justify-center shadow-sm cursor-pointer hover:bg-ant-paper transition-colors"
                        >
                            <ChevronRight className="w-3.5 h-3.5 text-ant-ink" />
                        </button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                            {media.map((_, i) => (
                                <div key={i} className={cn('h-1 rounded-full transition-all', i === idx ? 'bg-white w-4' : 'bg-white/50 w-1')} />
                            ))}
                        </div>
                    </>
                )}
            </div>
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-ant-light border-t border-ant-line">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[10px] uppercase tracking-[0.18em] text-ant-mid truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && <p className="text-[12px] font-semibold text-ant-ink truncate">{campaign.headline}</p>}
                    </div>
                    {campaign.cta_label && (
                        <div className="shrink-0 h-8 px-3 rounded-full bg-ant-ink text-white text-[11px] font-semibold flex items-center">
                            {campaign.cta_label}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Chart tooltip ─────────────────────────────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-xl bg-ant-paper border border-ant-line shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-3 text-[11px]">
            <p className="font-display font-semibold text-ant-ink mb-1.5">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-ant-mid">{p.name}:</span>
                    <span className="font-semibold tabular-nums text-ant-ink">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
                </div>
            ))}
        </div>
    );
};

// ── Page ──────────────────────────────────────────────────────────────────────
const CampaignPreview: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();
    const basePath = useCampaignBasePath();

    const { data: campaign, isLoading: loadingCampaign } = useQuery<Campaign | null>({
        queryKey: ['campaign', id],
        queryFn: async () => {
            if (!id) return null;
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('id', id)
                .single();
            if (error) throw error;
            return data as Campaign;
        },
        enabled: !!id,
    });

    const { data: business } = useQuery({
        queryKey: ['campaign-preview-business', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data } = await (supabase as any)
                .from('businesses')
                .select('name, logo')
                .eq('id', activeBusinessId)
                .single();
            return data;
        },
        enabled: !!activeBusinessId,
    });

    const { daily, totals, mediabuyer, isLoading: loadingMetrics } = useCampaignMetrics(campaign);

    const currency = campaign?.currency || 'MAD';

    const chartData = useMemo(
        () =>
            daily.map((d) => ({
                date: format(new Date(d.date), 'dd MMM'),
                rawDate: d.date,
                Spend: Number(d.spend.toFixed(2)),
                Leads: d.leads,
                Confirmed: d.confirmed,
                Delivered: d.delivered,
                Revenue: Number(d.revenue.toFixed(2)),
                CPL: d.costPerLead == null ? null : Number(d.costPerLead.toFixed(2)),
                CPC: d.costPerConfirmed == null ? null : Number(d.costPerConfirmed.toFixed(2)),
                CPD: d.costPerDelivered == null ? null : Number(d.costPerDelivered.toFixed(2)),
                ConfRate: d.confirmRate == null ? null : Number((d.confirmRate * 100).toFixed(2)),
                DelivRate: d.deliveryRate == null ? null : Number((d.deliveryRate * 100).toFixed(2)),
            })),
        [daily]
    );

    if (loadingCampaign) {
        return (
            <div className="ant-surface min-h-screen flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="ant-surface min-h-screen flex flex-col items-center justify-center py-32 gap-3">
                <div className="h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center">
                    <Megaphone className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                </div>
                <p className="font-serif italic text-[13px] text-ant-mid">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} className="h-9 px-5 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 text-[12px] font-semibold gap-2 cursor-pointer">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Global Ads
                </Button>
            </div>
        );
    }

    const campaignTypeLabel = CAMPAIGN_TYPES.find((t) => t.value === campaign.campaign_type)?.label || campaign.campaign_type;
    const conversionMeta = CONVERSION_TYPES.find((c) => c.value === campaign.conversion_type);
    const canEdit = !!currentUserId && campaign.created_by === currentUserId;
    const statusPill = campaign.status === 'active'
        ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' }
        : { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-10 w-10 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light shrink-0 cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <div className="space-y-2 min-w-0">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Campaign · Report
                            </div>
                            <h1 className="font-display text-[28px] md:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink truncate">
                                {campaign.name}
                            </h1>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white capitalize"
                                    style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                >
                                    <span>{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                                    {campaign.platform}
                                </span>
                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', statusPill.bg, statusPill.border, statusPill.text)}>
                                    <span className={cn('h-1.5 w-1.5 rounded-full', statusPill.dot)} />
                                    {campaign.status}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-paper px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                    {campaignTypeLabel}
                                </span>
                                {campaign.objective && (
                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-mid">
                                        {campaign.objective}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {canEdit ? (
                            <>
                                <Button
                                    onClick={() => navigate(`${basePath}/${campaign.id}/manage`)}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                >
                                    <ListChecks className="w-4 h-4" /> Manage data
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => navigate(`${basePath}/${campaign.id}/edit`)}
                                    className="h-10 px-4 rounded-full text-[12px] font-semibold border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light gap-2 cursor-pointer"
                                >
                                    <Edit2 className="w-3.5 h-3.5" /> Edit
                                </Button>
                            </>
                        ) : (
                            <div className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-ant-line bg-ant-light text-ant-mid">
                                <Lock className="w-3.5 h-3.5" />
                                <span className="text-[11px] uppercase tracking-[0.18em] font-semibold">Read only</span>
                            </div>
                        )}
                    </div>
                </header>

                {/* KPIs */}
                {loadingMetrics ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <KpiTile
                            label="Total spend"
                            value={fmtCur(totals.spend, currency)}
                            valueTitle={fmtCurFull(totals.spend, currency)}
                            sub={`${totals.days} day${totals.days !== 1 ? 's' : ''}`}
                            accent="rose"
                            icon={Coins}
                        />
                        <KpiTile
                            label="Leads"
                            value={fmtNumCompact(totals.leads)}
                            valueTitle={fmtNum(totals.leads)}
                            sub="manual entry"
                            accent="ink"
                            icon={UsersIcon}
                        />
                        <KpiTile
                            label="Confirmed"
                            value={fmtNumCompact(totals.confirmed)}
                            valueTitle={fmtNum(totals.confirmed)}
                            sub={fmtPct(totals.confirmRate)}
                            accent="orange"
                            icon={CheckCircle2}
                        />
                        <KpiTile
                            label="Delivered"
                            value={fmtNumCompact(totals.delivered)}
                            valueTitle={fmtNum(totals.delivered)}
                            sub={fmtPct(totals.deliveryRate)}
                            accent="green"
                            icon={Target}
                        />
                        <KpiTile
                            label="Cost / delivered"
                            value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                            valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                            sub={`CPL ${totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}`}
                            accent="orange"
                            icon={Wallet}
                        />
                        <KpiTile
                            label="Revenue"
                            value={fmtCur(totals.revenue, currency)}
                            valueTitle={fmtCurFull(totals.revenue, currency)}
                            sub={mediabuyer?.payment_type === 'commission' ? `× ${fmtCur(Number(mediabuyer.commission_price || 0), currency)}/order` : 'commission'}
                            accent="green"
                            icon={TrendingUp}
                        />
                    </section>
                )}

                {/* Main grid: charts + ad mock */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2 space-y-5">
                        {/* Charts */}
                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-4">
                                    <TrendingUp className="w-3 h-3" />
                                    Performance over time
                                </div>
                                {daily.length === 0 ? (
                                    <EmptyCharts
                                        canManage={canEdit}
                                        onManage={() => navigate(`${basePath}/${campaign.id}/manage`)}
                                    />
                                ) : (
                                    <Tabs defaultValue="volume">
                                        <TabsList className="h-9 rounded-full p-1 bg-ant-light border border-ant-line inline-flex w-auto">
                                            <TabsTrigger value="volume" className="text-[11px] h-7 px-3.5 rounded-full font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">Volume</TabsTrigger>
                                            <TabsTrigger value="cost" className="text-[11px] h-7 px-3.5 rounded-full font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">Cost / KPI</TabsTrigger>
                                            <TabsTrigger value="rates" className="text-[11px] h-7 px-3.5 rounded-full font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">Rates</TabsTrigger>
                                            <TabsTrigger value="finance" className="text-[11px] h-7 px-3.5 rounded-full font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">Finance</TabsTrigger>
                                        </TabsList>

                                        <TabsContent value="volume" className="mt-4 outline-none">
                                            <ResponsiveContainer width="100%" height={260}>
                                                <BarChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D6" vertical={false} />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(230,225,214,0.5)' }} />
                                                    <Bar dataKey="Leads" fill="#141413" radius={[6, 6, 0, 0]} />
                                                    <Bar dataKey="Confirmed" fill="#D97706" radius={[6, 6, 0, 0]} />
                                                    <Bar dataKey="Delivered" fill="#2D7A3E" radius={[6, 6, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </TabsContent>

                                        <TabsContent value="cost" className="mt-4 outline-none">
                                            <ResponsiveContainer width="100%" height={260}>
                                                <LineChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D6" vertical={false} />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <Tooltip content={<ChartTooltip />} />
                                                    <Line type="monotone" dataKey="CPL" stroke="#141413" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Lead" />
                                                    <Line type="monotone" dataKey="CPC" stroke="#D97706" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Confirmed" />
                                                    <Line type="monotone" dataKey="CPD" stroke="#2D7A3E" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Delivered" />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </TabsContent>

                                        <TabsContent value="rates" className="mt-4 outline-none">
                                            <ResponsiveContainer width="100%" height={260}>
                                                <AreaChart data={chartData}>
                                                    <defs>
                                                        <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#D97706" stopOpacity={0.3} />
                                                            <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                                                        </linearGradient>
                                                        <linearGradient id="delivGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.3} />
                                                            <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D6" vertical={false} />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} unit="%" />
                                                    <Tooltip content={<ChartTooltip />} />
                                                    <Area type="monotone" dataKey="ConfRate" stroke="#D97706" strokeWidth={2} fill="url(#confGrad)" name="Confirmation %" />
                                                    <Area type="monotone" dataKey="DelivRate" stroke="#2D7A3E" strokeWidth={2} fill="url(#delivGrad)" name="Delivery %" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </TabsContent>

                                        <TabsContent value="finance" className="mt-4 outline-none">
                                            <ResponsiveContainer width="100%" height={260}>
                                                <AreaChart data={chartData}>
                                                    <defs>
                                                        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#B54040" stopOpacity={0.3} />
                                                            <stop offset="95%" stopColor="#B54040" stopOpacity={0} />
                                                        </linearGradient>
                                                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.3} />
                                                            <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#E6E1D6" vertical={false} />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <YAxis tick={{ fontSize: 10, fill: '#8B8680' }} axisLine={false} tickLine={false} />
                                                    <Tooltip content={<ChartTooltip />} />
                                                    <Area type="monotone" dataKey="Spend" stroke="#B54040" strokeWidth={2} fill="url(#spendGrad)" name="Spend" />
                                                    <Area type="monotone" dataKey="Revenue" stroke="#2D7A3E" strokeWidth={2} fill="url(#revGrad)" name="Revenue" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </TabsContent>
                                    </Tabs>
                                )}
                            </div>
                        </div>

                        {/* Daily breakdown table */}
                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <ListChecks className="w-3 h-3" />
                                    Daily breakdown
                                </div>
                                <span className="text-[11px] font-semibold text-ant-mid tabular-nums">{daily.length} entries</span>
                            </div>
                            {daily.length === 0 ? (
                                <div className="px-5 py-10 text-center">
                                    <p className="font-serif italic text-[13px] text-ant-mid">No daily entries yet.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line bg-ant-light/50">
                                                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Date</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spend</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Leads</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Conf</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Deliv</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPL</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPC</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">CPD</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">%C</th>
                                                <th className="text-right px-3 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">%L</th>
                                                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Revenue</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {daily.map((d) => (
                                                <tr key={d.date} className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums">
                                                    <td className="px-4 py-3 text-[12px] font-semibold text-ant-ink">{format(new Date(d.date), 'EEE dd MMM')}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] font-semibold text-ant-ink">{fmtCurFull(d.spend, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-ink">{fmtNum(d.leads)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-orange font-semibold">{fmtNum(d.confirmed)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-green font-semibold">{fmtNum(d.delivered)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{fmtPct(d.confirmRate)}</td>
                                                    <td className="text-right px-3 py-3 text-[12px] text-ant-mid">{fmtPct(d.deliveryRate)}</td>
                                                    <td className="text-right px-4 py-3 text-[12px] font-semibold text-ant-green">{fmtCurFull(d.revenue, currency)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-ant-ink text-white font-semibold tabular-nums">
                                                <td className="px-4 py-3.5 text-[10px] uppercase tracking-[0.24em]">Totals</td>
                                                <td className="text-right px-3 py-3.5 text-[12px]">{fmtCurFull(totals.spend, currency)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.leads)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.confirmed)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px]">{fmtNum(totals.delivered)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{fmtPct(totals.confirmRate)}</td>
                                                <td className="text-right px-3 py-3.5 text-[12px] text-white/60">{fmtPct(totals.deliveryRate)}</td>
                                                <td className="text-right px-4 py-3.5 text-[12px]">{fmtCurFull(totals.revenue, currency)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Sidebar: ad mock + details */}
                    <div className="lg:col-span-1 space-y-5">
                        <div className="lg:sticky lg:top-6 space-y-5">
                            <div>
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-3">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Ad preview
                                </div>
                                <AdMock campaign={campaign} businessName={business?.name || ''} businessLogo={business?.logo || null} />
                            </div>
                            <div className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3 text-[12px]">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    Setup
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                    <span className="text-[11px] font-semibold text-ant-mid">Spending</span>
                                    <span className="font-semibold text-ant-ink tabular-nums">
                                        {campaign.spending_type === 'ongoing'
                                            ? `${fmtCur(Number(campaign.daily_budget || 0), currency)} / day`
                                            : `${fmtCur(Number(campaign.total_budget || 0), currency)} total`}
                                    </span>
                                </div>
                                {campaign.start_date && (
                                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                        <span className="text-[11px] font-semibold text-ant-mid">Start</span>
                                        <span className="font-semibold text-ant-ink tabular-nums">{format(new Date(campaign.start_date), 'dd MMM yyyy')}</span>
                                    </div>
                                )}
                                {campaign.end_date && (
                                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                        <span className="text-[11px] font-semibold text-ant-mid">End</span>
                                        <span className="font-semibold text-ant-ink tabular-nums">{format(new Date(campaign.end_date), 'dd MMM yyyy')}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                    <span className="text-[11px] font-semibold text-ant-mid">Conversion</span>
                                    <span className="font-semibold text-ant-ink inline-flex items-center gap-1.5">
                                        {conversionMeta && <conversionMeta.icon className="w-3.5 h-3.5 text-ant-orange" />}
                                        {conversionMeta?.label || campaign.conversion_type}
                                    </span>
                                </div>
                                {campaign.conversion_content && (
                                    <div className="pt-3 border-t border-ant-line">
                                        <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid mb-1.5">
                                            {conversionMeta?.contentLabel}
                                        </p>
                                        <p className="font-mono text-[11px] text-ant-ink break-all bg-ant-light border border-ant-line rounded-lg p-2.5">{campaign.conversion_content}</p>
                                    </div>
                                )}
                                {mediabuyer && (
                                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                        <span className="text-[11px] font-semibold text-ant-mid">Commission</span>
                                        <span className="font-semibold text-ant-ink tabular-nums">
                                            {mediabuyer.payment_type === 'commission'
                                                ? `${fmtCur(Number(mediabuyer.commission_price || 0), currency)} / delivered`
                                                : mediabuyer.payment_type === 'salary'
                                                ? 'Salary'
                                                : '—'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const EmptyCharts: React.FC<{ canManage: boolean; onManage: () => void }> = ({ canManage, onManage }) => (
    <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
        <div className="h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
        </div>
        <div>
            <h3 className="font-display text-[16px] text-ant-ink tracking-tight">No data to chart yet</h3>
            <p className="font-serif italic text-[13px] text-ant-mid mt-1 max-w-xs mx-auto">
                {canManage
                    ? 'Add daily spend and lead counts — orders will attribute themselves.'
                    : 'The campaign owner has not added any daily entries yet.'}
            </p>
        </div>
        {canManage && (
            <Button onClick={onManage} className="bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-4 rounded-full text-[12px] font-semibold gap-2 cursor-pointer">
                <ListChecks className="w-3.5 h-3.5" /> Manage data
            </Button>
        )}
    </div>
);

export default CampaignPreview;
