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
    DollarSign,
    Users as UsersIcon,
    CheckCircle2,
    PackageCheck,
    TrendingUp,
    Target,
    Percent,
    Wallet,
    ListChecks,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
    Legend,
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
import { Lock } from 'lucide-react';
import { fmtCur, fmtCurFull, fmtNum, fmtNumCompact, fmtPct } from '@/lib/formatNumbers';

// ── KPI Card ─────────────────────────────────────────────────────
const Kpi: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
    tone?: string;
}> = ({ label, value, valueTitle, sub, icon: Icon, tone = 'bg-brand-navy/10 text-brand-navy' }) => (
    <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                <p
                    title={valueTitle || value}
                    className="text-base xl:text-lg font-black tabular-nums text-gray-900 tracking-tight leading-tight break-words"
                >
                    {value}
                </p>
                {sub && <p className="text-[10px] text-muted-foreground font-medium truncate">{sub}</p>}
            </div>
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl', tone)}>
                <Icon className="h-4 w-4" />
            </div>
        </div>
    </div>
);

// ── Ad mockup ────────────────────────────────────────────────────
const AdMock: React.FC<{ campaign: Campaign; businessName: string; businessLogo: string | null }> = ({
    campaign,
    businessName,
    businessLogo,
}) => {
    const [idx, setIdx] = useState(0);
    const media = (campaign.media || []) as CampaignMedia[];
    const current = media[idx];
    const hasMultiple = media.length > 1;

    return (
        <div className="rounded-[28px] overflow-hidden bg-white border border-brand-navy/[0.06] shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-3 p-4 pb-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-brand-navy/[0.05] flex items-center justify-center border border-brand-navy/5">
                    {businessLogo ? (
                        <img src={businessLogo} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[11px] font-black text-brand-navy">{(businessName || 'DG').substring(0, 2).toUpperCase()}</span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-brand-navy truncate leading-tight">{businessName || 'Your business'}</p>
                    <p className="text-[10px] text-muted-foreground">Sponsored · <span style={{ color: getPlatformColor(campaign.platform) }}>{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5 inline')}</span></p>
                </div>
            </div>
            {campaign.primary_text && (
                <div className="px-4 pb-3">
                    <p className="text-[13px] leading-snug text-brand-navy/80 whitespace-pre-wrap break-words">{campaign.primary_text}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-brand-navy/[0.05]">
                {current ? (
                    current.type === 'video' ? (
                        <video src={current.url} className="w-full h-full object-cover" controls muted playsInline loop />
                    ) : (
                        <img src={current.url} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-brand-navy/20">
                        <Megaphone className="w-12 h-12" />
                        <span className="text-xs font-bold uppercase">No media</span>
                    </div>
                )}
                {current?.type === 'video' && (
                    <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-5 h-5 text-white" />
                    </div>
                )}
                {hasMultiple && (
                    <>
                        <button
                            onClick={() => setIdx((i) => (i === 0 ? media.length - 1 : i - 1))}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-md"
                        >
                            <ChevronLeft className="w-4 h-4 text-brand-navy" />
                        </button>
                        <button
                            onClick={() => setIdx((i) => (i === media.length - 1 ? 0 : i + 1))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-md"
                        >
                            <ChevronRight className="w-4 h-4 text-brand-navy" />
                        </button>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                            {media.map((_, i) => (
                                <div key={i} className={cn('h-1.5 rounded-full transition-all', i === idx ? 'bg-white w-4' : 'bg-white/50 w-1.5')} />
                            ))}
                        </div>
                    </>
                )}
            </div>
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-brand-navy/[0.02] border-t border-brand-navy/5">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && <p className="text-[13px] font-bold text-brand-navy truncate">{campaign.headline}</p>}
                    </div>
                    {campaign.cta_label && (
                        <div className="shrink-0 h-8 px-3 rounded-xl bg-brand-navy/[0.06] text-brand-navy text-[10px] font-black uppercase tracking-wider flex items-center">
                            {campaign.cta_label}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Chart tooltip ────────────────────────────────────────────────
const ChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-2xl bg-white/95 backdrop-blur shadow-2xl border border-brand-navy/5 p-3 text-[11px]">
            <p className="font-black text-brand-navy mb-1.5">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="font-medium text-brand-navy/60">{p.name}:</span>
                    <span className="font-bold tabular-nums text-brand-navy">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
                </div>
            ))}
        </div>
    );
};

// ── Page ─────────────────────────────────────────────────────────
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

    // Prepare chart data — prettified dates + formatted numbers
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
            <div className="flex items-center justify-center py-32">
                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
                <Megaphone className="w-12 h-12 text-brand-navy/20" />
                <p className="text-muted-foreground">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} variant="outline" className="rounded-xl">
                    Back to campaigns
                </Button>
            </div>
        );
    }

    const campaignTypeLabel = CAMPAIGN_TYPES.find((t) => t.value === campaign.campaign_type)?.label || campaign.campaign_type;
    const conversionMeta = CONVERSION_TYPES.find((c) => c.value === campaign.conversion_type);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex items-start gap-4 min-w-0">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(basePath)}
                                className="h-12 w-12 rounded-2xl bg-white shadow-sm hover:bg-brand-navy hover:text-white transition-all shrink-0"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <Badge
                                        className="rounded-full text-[10px] font-black uppercase px-2.5 py-0.5 border-none text-white shrink-0"
                                        style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                    >
                                        <span className="mr-1">{getPlatformIcon(campaign.platform, 'w-3 h-3')}</span>
                                        {campaign.platform}
                                    </Badge>
                                    <Badge
                                        className={cn(
                                            'rounded-full text-[10px] font-black uppercase px-2.5 py-0.5 border-none',
                                            campaign.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                                        )}
                                    >
                                        {campaign.status}
                                    </Badge>
                                    <Badge variant="secondary" className="rounded-full text-[10px] font-bold uppercase px-2.5 py-0.5">
                                        {campaignTypeLabel}
                                    </Badge>
                                    {campaign.objective && (
                                        <Badge variant="outline" className="rounded-full text-[10px] font-bold uppercase px-2.5 py-0.5">
                                            {campaign.objective}
                                        </Badge>
                                    )}
                                </div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-1 truncate">{campaign.name}</h1>
                                <p className="text-gray-500 font-light">
                                    Performance dashboard · metrics auto-computed from orders attributed to{' '}
                                    <span className="font-bold capitalize">{campaign.platform}</span>.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            {currentUserId && campaign.created_by === currentUserId ? (
                                <>
                                    <Button
                                        onClick={() => navigate(`${basePath}/${campaign.id}/manage`)}
                                        className="h-12 px-6 rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-white font-bold text-xs uppercase tracking-widest gap-2 shadow-xl shadow-brand-navy/20"
                                    >
                                        <ListChecks className="w-4 h-4" /> Manage data
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => navigate(`${basePath}/${campaign.id}/edit`)}
                                        className="h-12 px-6 rounded-2xl font-bold text-xs uppercase tracking-widest border-brand-navy/10 gap-2"
                                    >
                                        <Edit2 className="w-4 h-4" /> Edit
                                    </Button>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 h-12 px-5 rounded-2xl bg-brand-navy/[0.04] text-brand-navy/60">
                                    <Lock className="w-4 h-4" />
                                    <span className="text-[11px] font-black uppercase tracking-widest">Read only</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            {loadingMetrics ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 rounded-3xl bg-white/60" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <Kpi
                        label="Total Spend"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={`${totals.days} day${totals.days !== 1 ? 's' : ''}`}
                        icon={DollarSign}
                        tone="bg-red-500/10 text-red-500"
                    />
                    <Kpi label="Leads" value={fmtNumCompact(totals.leads)} valueTitle={fmtNum(totals.leads)} sub="manual" icon={UsersIcon} tone="bg-blue-500/10 text-blue-500" />
                    <Kpi label="Confirmed" value={fmtNumCompact(totals.confirmed)} valueTitle={fmtNum(totals.confirmed)} sub={fmtPct(totals.confirmRate)} icon={CheckCircle2} tone="bg-indigo-500/10 text-indigo-500" />
                    <Kpi label="Delivered" value={fmtNumCompact(totals.delivered)} valueTitle={fmtNum(totals.delivered)} sub={fmtPct(totals.deliveryRate)} icon={PackageCheck} tone="bg-emerald-500/10 text-emerald-600" />
                    <Kpi
                        label="Cost / Delivered"
                        value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                        valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                        sub={`CPL ${totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}`}
                        icon={Target}
                        tone="bg-amber-500/10 text-amber-600"
                    />
                    <Kpi
                        label="Revenue"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={mediabuyer?.payment_type === 'commission' ? `× ${fmtCur(Number(mediabuyer.commission_price || 0), currency)}/order` : 'commission'}
                        icon={Wallet}
                        tone="bg-primary/10 text-primary"
                    />
                </div>
            )}

            {/* Main grid: charts + ad mock */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between mb-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Performance over time</h2>
                            </div>
                            {daily.length === 0 ? (
                                <EmptyCharts
                                    canManage={!!currentUserId && campaign.created_by === currentUserId}
                                    onManage={() => navigate(`${basePath}/${campaign.id}/manage`)}
                                />
                            ) : (
                                <Tabs defaultValue="volume">
                                    <TabsList className="bg-brand-navy/[0.04] p-1 rounded-2xl h-auto inline-flex gap-1 mb-5">
                                        <TabsTrigger value="volume" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Volume
                                        </TabsTrigger>
                                        <TabsTrigger value="cost" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Cost / KPI
                                        </TabsTrigger>
                                        <TabsTrigger value="rates" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Rates
                                        </TabsTrigger>
                                        <TabsTrigger value="finance" className="rounded-xl px-4 py-2 text-[11px] font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-brand-navy text-brand-navy/50">
                                            Finance
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="volume" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={300}>
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
                                        <ResponsiveContainer width="100%" height={300}>
                                            <LineChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Line type="monotone" dataKey="CPL" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Cost / Lead" />
                                                <Line type="monotone" dataKey="CPC" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Cost / Confirmed" />
                                                <Line type="monotone" dataKey="CPD" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Cost / Delivered" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </TabsContent>

                                    <TabsContent value="rates" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={300}>
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="delivGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} unit="%" />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Area type="monotone" dataKey="ConfRate" stroke="#6366f1" strokeWidth={2.5} fill="url(#confGrad)" name="Confirmation %" />
                                                <Area type="monotone" dataKey="DelivRate" stroke="#10b981" strokeWidth={2.5} fill="url(#delivGrad)" name="Delivery %" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </TabsContent>

                                    <TabsContent value="finance" className="mt-0 outline-none">
                                        <ResponsiveContainer width="100%" height={300}>
                                            <AreaChart data={chartData}>
                                                <defs>
                                                    <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend iconType="circle" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                                                <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={2.5} fill="url(#spendGrad)" name="Spend" />
                                                <Area type="monotone" dataKey="Revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revGrad)" name="Revenue" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </TabsContent>
                                </Tabs>
                            )}
                        </CardContent>
                    </Card>

                    {/* Per-day breakdown table */}
                    <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur overflow-hidden">
                        <CardContent className="p-0">
                            <div className="p-6 pb-4">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Daily breakdown</h2>
                            </div>
                            {daily.length === 0 ? (
                                <div className="px-6 pb-6 text-sm text-muted-foreground">No daily entries yet.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                                <th className="text-left px-6 py-3">Date</th>
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
                                                    <td className="px-6 py-2.5 font-bold text-brand-navy">{format(new Date(d.date), 'EEE dd MMM')}</td>
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
                                                <td className="px-6 py-3 text-[10px] uppercase tracking-widest">Totals</td>
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
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar: ad mock + details */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="lg:sticky lg:top-6 space-y-6">
                        <div>
                            <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50 mb-3 px-1">Ad preview</h2>
                            <AdMock campaign={campaign} businessName={business?.name || ''} businessLogo={business?.logo || null} />
                        </div>
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/90 backdrop-blur">
                            <CardContent className="p-6 space-y-4 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Spending</span>
                                    <span className="font-bold text-brand-navy">
                                        {campaign.spending_type === 'ongoing'
                                            ? `${fmtCur(Number(campaign.daily_budget || 0), currency)} / day`
                                            : `${fmtCur(Number(campaign.total_budget || 0), currency)} total`}
                                    </span>
                                </div>
                                {campaign.start_date && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Start</span>
                                        <span className="font-bold text-brand-navy">{format(new Date(campaign.start_date), 'dd MMM yyyy')}</span>
                                    </div>
                                )}
                                {campaign.end_date && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">End</span>
                                        <span className="font-bold text-brand-navy">{format(new Date(campaign.end_date), 'dd MMM yyyy')}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Conversion</span>
                                    <span className="font-bold text-brand-navy flex items-center gap-1.5">
                                        {conversionMeta && <conversionMeta.icon className="w-3.5 h-3.5" />}
                                        {conversionMeta?.label || campaign.conversion_type}
                                    </span>
                                </div>
                                {campaign.conversion_content && (
                                    <div className="pt-2 border-t border-brand-navy/5">
                                        <p className="text-muted-foreground font-bold uppercase tracking-wider text-[10px] mb-1">
                                            {conversionMeta?.contentLabel}
                                        </p>
                                        <p className="font-mono text-[11px] text-brand-navy break-all">{campaign.conversion_content}</p>
                                    </div>
                                )}
                                {mediabuyer && (
                                    <div className="pt-2 border-t border-brand-navy/5 flex items-center justify-between">
                                        <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Commission</span>
                                        <span className="font-bold text-brand-navy">
                                            {mediabuyer.payment_type === 'commission'
                                                ? `${fmtCur(Number(mediabuyer.commission_price || 0), currency)} / delivered`
                                                : mediabuyer.payment_type === 'salary'
                                                ? 'Salary'
                                                : '—'}
                                        </span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
};

const EmptyCharts: React.FC<{ canManage: boolean; onManage: () => void }> = ({ canManage, onManage }) => (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-brand-navy/[0.04] flex items-center justify-center">
            <TrendingUp className="w-7 h-7 text-brand-navy/20" />
        </div>
        <div>
            <p className="text-base font-bold text-brand-navy">No data to chart yet</p>
            <p className="text-xs text-muted-foreground max-w-sm">
                {canManage
                    ? 'Add daily spend and lead counts to start tracking performance.'
                    : 'The campaign owner has not added any daily entries yet.'}
            </p>
        </div>
        {canManage && (
            <Button onClick={onManage} className="rounded-xl bg-brand-navy hover:bg-brand-navy/90 text-white font-bold gap-2">
                <ListChecks className="w-4 h-4" /> Manage data
            </Button>
        )}
    </div>
);

export default CampaignPreview;
