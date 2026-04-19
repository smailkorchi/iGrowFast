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
    Wallet,
    ListChecks,
    ChevronLeft,
    ChevronRight,
    Lock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

// ── KPI tile ──────────────────────────────────────────────────────────────────
const KpiTile: React.FC<{
    label: string;
    value: string;
    valueTitle?: string;
    sub?: string;
    accent: string;
}> = ({ label, value, valueTitle, sub, accent }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
        <span className="w-[3px] self-stretch rounded-full" style={{ background: accent }} />
        <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
            <p
                title={valueTitle || value}
                className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-tight break-words"
            >
                {value}
            </p>
            {sub && <p className="text-[9px] text-gray-400 mt-0.5 truncate">{sub}</p>}
        </div>
    </div>
);

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

    return (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                    {businessLogo ? (
                        <img src={businessLogo} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-semibold text-brand-navy">{(businessName || 'DG').substring(0, 2).toUpperCase()}</span>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-brand-navy truncate leading-tight">{businessName || 'Your business'}</p>
                    <p className="text-[9px] text-gray-400">Sponsored · <span style={{ color: getPlatformColor(campaign.platform) }}>{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5 inline')}</span></p>
                </div>
            </div>
            {campaign.primary_text && (
                <div className="px-3 pb-2">
                    <p className="text-[11px] leading-snug text-brand-navy/80 whitespace-pre-wrap break-words">{campaign.primary_text}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-gray-50">
                {current ? (
                    current.type === 'video' ? (
                        <video src={current.url} className="w-full h-full object-cover" controls muted playsInline loop />
                    ) : (
                        <img src={current.url} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300">
                        <Megaphone className="w-10 h-10" />
                        <span className="text-[9px] uppercase tracking-[0.18em]">No media</span>
                    </div>
                )}
                {current?.type === 'video' && (
                    <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                        <PlayCircle className="w-4 h-4 text-white" />
                    </div>
                )}
                {hasMultiple && (
                    <>
                        <button
                            onClick={() => setIdx((i) => (i === 0 ? media.length - 1 : i - 1))}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow"
                        >
                            <ChevronLeft className="w-3.5 h-3.5 text-brand-navy" />
                        </button>
                        <button
                            onClick={() => setIdx((i) => (i === media.length - 1 ? 0 : i + 1))}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow"
                        >
                            <ChevronRight className="w-3.5 h-3.5 text-brand-navy" />
                        </button>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                            {media.map((_, i) => (
                                <div key={i} className={cn('h-1 rounded-full transition-all', i === idx ? 'bg-white w-3' : 'bg-white/50 w-1')} />
                            ))}
                        </div>
                    </>
                )}
            </div>
            {(campaign.headline || campaign.cta_label) && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <div className="min-w-0 flex-1">
                        {campaign.conversion_content && (
                            <p className="text-[9px] uppercase tracking-[0.12em] text-gray-400 truncate">
                                {campaign.conversion_content.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {campaign.headline && <p className="text-[11px] font-semibold text-brand-navy truncate">{campaign.headline}</p>}
                    </div>
                    {campaign.cta_label && (
                        <div className="shrink-0 h-7 px-2.5 rounded-md bg-brand-navy text-white text-[10px] font-semibold flex items-center">
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
        <div className="rounded-lg bg-white border border-gray-100 shadow-md p-2.5 text-[11px]">
            <p className="font-semibold text-brand-navy mb-1.5">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-gray-400">{p.name}:</span>
                    <span className="font-semibold tabular-nums text-brand-navy">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
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
            <div className="flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
                <Megaphone className="w-10 h-10 text-gray-200" />
                <p className="text-[12px] text-gray-400">Campaign not found.</p>
                <Button onClick={() => navigate(basePath)} variant="outline" className="h-8 rounded-md text-[11px] font-semibold">
                    Back to campaigns
                </Button>
            </div>
        );
    }

    const campaignTypeLabel = CAMPAIGN_TYPES.find((t) => t.value === campaign.campaign_type)?.label || campaign.campaign_type;
    const conversionMeta = CONVERSION_TYPES.find((c) => c.value === campaign.conversion_type);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-8 w-8 rounded-md border border-gray-200 text-gray-500 hover:text-brand-navy shrink-0"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                        </Button>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">{campaign.name}</h1>
                                <Badge
                                    className="h-5 px-1.5 text-[9px] rounded-md border-none font-semibold text-white shrink-0"
                                    style={{ backgroundColor: getPlatformColor(campaign.platform) }}
                                >
                                    <span className="mr-1">{getPlatformIcon(campaign.platform, 'w-2.5 h-2.5')}</span>
                                    {campaign.platform}
                                </Badge>
                                <Badge
                                    className={cn(
                                        'h-5 px-1.5 text-[9px] rounded-md border-none font-semibold',
                                        campaign.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                    )}
                                >
                                    {campaign.status}
                                </Badge>
                                <Badge variant="secondary" className="h-5 px-1.5 text-[9px] rounded-md font-semibold">
                                    {campaignTypeLabel}
                                </Badge>
                                {campaign.objective && (
                                    <Badge variant="outline" className="h-5 px-1.5 text-[9px] rounded-md font-semibold">
                                        {campaign.objective}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Performance dashboard</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {currentUserId && campaign.created_by === currentUserId ? (
                            <>
                                <Button
                                    onClick={() => navigate(`${basePath}/${campaign.id}/manage`)}
                                    className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3"
                                >
                                    <ListChecks className="w-3.5 h-3.5" /> Manage data
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => navigate(`${basePath}/${campaign.id}/edit`)}
                                    className="h-8 rounded-md text-[11px] font-semibold gap-1.5 border-gray-200"
                                >
                                    <Edit2 className="w-3.5 h-3.5" /> Edit
                                </Button>
                            </>
                        ) : (
                            <div className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-gray-50 text-gray-400 border border-gray-100">
                                <Lock className="w-3.5 h-3.5" />
                                <span className="text-[9px] uppercase tracking-[0.18em]">Read only</span>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* KPIs */}
            {loadingMetrics ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 rounded-xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    <KpiTile
                        label="Total Spend"
                        value={fmtCur(totals.spend, currency)}
                        valueTitle={fmtCurFull(totals.spend, currency)}
                        sub={`${totals.days} day${totals.days !== 1 ? 's' : ''}`}
                        accent="#ef4444"
                    />
                    <KpiTile
                        label="Leads"
                        value={fmtNumCompact(totals.leads)}
                        valueTitle={fmtNum(totals.leads)}
                        sub="manual"
                        accent="#3b5e5e"
                    />
                    <KpiTile
                        label="Confirmed"
                        value={fmtNumCompact(totals.confirmed)}
                        valueTitle={fmtNum(totals.confirmed)}
                        sub={fmtPct(totals.confirmRate)}
                        accent="#3b5e5e"
                    />
                    <KpiTile
                        label="Delivered"
                        value={fmtNumCompact(totals.delivered)}
                        valueTitle={fmtNum(totals.delivered)}
                        sub={fmtPct(totals.deliveryRate)}
                        accent="#059669"
                    />
                    <KpiTile
                        label="Cost / Delivered"
                        value={totals.costPerDelivered == null ? '—' : fmtCur(totals.costPerDelivered, currency)}
                        valueTitle={totals.costPerDelivered == null ? undefined : fmtCurFull(totals.costPerDelivered, currency)}
                        sub={`CPL ${totals.costPerLead == null ? '—' : fmtCur(totals.costPerLead, currency)}`}
                        accent="#d97706"
                    />
                    <KpiTile
                        label="Revenue"
                        value={fmtCur(totals.revenue, currency)}
                        valueTitle={fmtCurFull(totals.revenue, currency)}
                        sub={mediabuyer?.payment_type === 'commission' ? `× ${fmtCur(Number(mediabuyer.commission_price || 0), currency)}/order` : 'commission'}
                        accent="#059669"
                    />
                </div>
            )}

            {/* Main grid: charts + ad mock */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 space-y-3">
                    {/* Charts card */}
                    <div className="border border-gray-100 rounded-xl bg-white p-3.5">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-3">Performance over time</p>
                        {daily.length === 0 ? (
                            <EmptyCharts
                                canManage={!!currentUserId && campaign.created_by === currentUserId}
                                onManage={() => navigate(`${basePath}/${campaign.id}/manage`)}
                            />
                        ) : (
                            <Tabs defaultValue="volume">
                                <TabsList className="h-8">
                                    <TabsTrigger value="volume" className="text-[11px] h-6 px-3 gap-1.5">Volume</TabsTrigger>
                                    <TabsTrigger value="cost" className="text-[11px] h-6 px-3 gap-1.5">Cost / KPI</TabsTrigger>
                                    <TabsTrigger value="rates" className="text-[11px] h-6 px-3 gap-1.5">Rates</TabsTrigger>
                                    <TabsTrigger value="finance" className="text-[11px] h-6 px-3 gap-1.5">Finance</TabsTrigger>
                                </TabsList>

                                <TabsContent value="volume" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <BarChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(243,244,246,0.8)' }} />
                                            <Bar dataKey="Leads" fill="#3b5e5e" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Confirmed" fill="#6b7280" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="Delivered" fill="#059669" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="cost" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Line type="monotone" dataKey="CPL" stroke="#3b5e5e" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Lead" />
                                            <Line type="monotone" dataKey="CPC" stroke="#9ca3af" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Confirmed" />
                                            <Line type="monotone" dataKey="CPD" stroke="#059669" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Cost / Delivered" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="rates" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="delivGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} unit="%" />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Area type="monotone" dataKey="ConfRate" stroke="#3b5e5e" strokeWidth={2} fill="url(#confGrad)" name="Confirmation %" />
                                            <Area type="monotone" dataKey="DelivRate" stroke="#059669" strokeWidth={2} fill="url(#delivGrad)" name="Delivery %" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </TabsContent>

                                <TabsContent value="finance" className="mt-3 outline-none">
                                    <ResponsiveContainer width="100%" height={260}>
                                        <AreaChart data={chartData}>
                                            <defs>
                                                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                                                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Area type="monotone" dataKey="Spend" stroke="#ef4444" strokeWidth={2} fill="url(#spendGrad)" name="Spend" />
                                            <Area type="monotone" dataKey="Revenue" stroke="#059669" strokeWidth={2} fill="url(#revGrad)" name="Revenue" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>

                    {/* Daily breakdown table */}
                    <div className="border border-gray-100 rounded-xl bg-white overflow-hidden">
                        <div className="px-3.5 py-2.5 border-b border-gray-100">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Daily breakdown</p>
                        </div>
                        {daily.length === 0 ? (
                            <div className="px-3.5 py-6 text-[11px] text-gray-400">No daily entries yet.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Date</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Leads</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Conf</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Deliv</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPL</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPC</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">CPD</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">%C</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">%L</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 pr-3">Revenue</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {daily.map((d) => (
                                            <tr key={d.date} className="border-b border-gray-50 hover:bg-gray-50 transition-colors tabular-nums">
                                                <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy/80">{format(new Date(d.date), 'EEE dd MMM')}</td>
                                                <td className="text-right px-3 py-2 text-[11px] font-semibold text-brand-navy/80">{fmtCurFull(d.spend, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtNum(d.leads)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtNum(d.confirmed)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-emerald-600 font-semibold">{fmtNum(d.delivered)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerLead == null ? '—' : fmtCurFull(d.costPerLead, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerConfirmed == null ? '—' : fmtCurFull(d.costPerConfirmed, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{d.costPerDelivered == null ? '—' : fmtCurFull(d.costPerDelivered, currency)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtPct(d.confirmRate)}</td>
                                                <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80">{fmtPct(d.deliveryRate)}</td>
                                                <td className="text-right px-3 py-2 pr-3 text-[11px] font-semibold text-brand-navy/80">{fmtCurFull(d.revenue, currency)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-brand-navy text-white font-semibold tabular-nums">
                                            <td className="px-3 py-2.5 text-[9px] uppercase tracking-[0.18em]">Totals</td>
                                            <td className="text-right px-3 py-2.5 text-[11px]">{fmtCurFull(totals.spend, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.leads)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.confirmed)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px]">{fmtNum(totals.delivered)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerLead == null ? '—' : fmtCurFull(totals.costPerLead, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerConfirmed == null ? '—' : fmtCurFull(totals.costPerConfirmed, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{totals.costPerDelivered == null ? '—' : fmtCurFull(totals.costPerDelivered, currency)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{fmtPct(totals.confirmRate)}</td>
                                            <td className="text-right px-3 py-2.5 text-[11px] text-white/70">{fmtPct(totals.deliveryRate)}</td>
                                            <td className="text-right px-3 py-2.5 pr-3 text-[11px]">{fmtCurFull(totals.revenue, currency)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar: ad mock + details */}
                <div className="lg:col-span-1 space-y-3">
                    <div className="lg:sticky lg:top-4 space-y-3">
                        <div>
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">Ad preview</p>
                            <AdMock campaign={campaign} businessName={business?.name || ''} businessLogo={business?.logo || null} />
                        </div>
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3 text-[11px]">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Spending</span>
                                <span className="font-semibold text-brand-navy/80 tabular-nums">
                                    {campaign.spending_type === 'ongoing'
                                        ? `${fmtCur(Number(campaign.daily_budget || 0), currency)} / day`
                                        : `${fmtCur(Number(campaign.total_budget || 0), currency)} total`}
                                </span>
                            </div>
                            {campaign.start_date && (
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Start</span>
                                    <span className="font-semibold text-brand-navy/80">{format(new Date(campaign.start_date), 'dd MMM yyyy')}</span>
                                </div>
                            )}
                            {campaign.end_date && (
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">End</span>
                                    <span className="font-semibold text-brand-navy/80">{format(new Date(campaign.end_date), 'dd MMM yyyy')}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Conversion</span>
                                <span className="font-semibold text-brand-navy/80 flex items-center gap-1.5">
                                    {conversionMeta && <conversionMeta.icon className="w-3 h-3" />}
                                    {conversionMeta?.label || campaign.conversion_type}
                                </span>
                            </div>
                            {campaign.conversion_content && (
                                <div className="pt-2 border-t border-gray-100">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-1">
                                        {conversionMeta?.contentLabel}
                                    </p>
                                    <p className="font-mono text-[10px] text-brand-navy/80 break-all">{campaign.conversion_content}</p>
                                </div>
                            )}
                            {mediabuyer && (
                                <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                                    <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Commission</span>
                                    <span className="font-semibold text-brand-navy/80 tabular-nums">
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
    );
};

const EmptyCharts: React.FC<{ canManage: boolean; onManage: () => void }> = ({ canManage, onManage }) => (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <TrendingUp className="w-8 h-8 text-gray-200" />
        <div>
            <p className="text-[12px] font-semibold text-brand-navy">No data to chart yet</p>
            <p className="text-[10px] text-gray-400 max-w-xs mt-0.5">
                {canManage
                    ? 'Add daily spend and lead counts to start tracking performance.'
                    : 'The campaign owner has not added any daily entries yet.'}
            </p>
        </div>
        {canManage && (
            <Button onClick={onManage} className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3 mt-1">
                <ListChecks className="w-3.5 h-3.5" /> Manage data
            </Button>
        )}
    </div>
);

export default CampaignPreview;
