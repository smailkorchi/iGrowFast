import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { imageUrl } from '@/lib/imageUrl';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { type CommissionBasis } from '@/lib/commercialCommission';
import {
    ShoppingBag,
    MapPin,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { useToast } from "@/hooks/use-toast";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { AnalyticsDateFilter, type DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { SellerSelfPerformanceSection } from '@/components/dashboard/SellerSelfPerformanceSection';

interface PerformanceStats {
    successRate: number;
    totalRealized: number;
    efficiency: number;
    totalOrders: number;
    deliveredOrders: number;
    growth: number;
    confirmRate: number;
    integrityScore: number;
    deliveryEff: number;
    liveCommission: number;
    earnedCommission: number;
    commissionBasis: CommissionBasis;
}

interface ChartData {
    month: string;
    commission: number;
    total: number;
}

interface StatusDistribution {
    name: string;
    value: number;
    color: string;
}

interface RegionalData {
    city: string;
    delivered: number;
}

interface ProductPerformance {
    name: string;
    image: string | null;
    attributed: number;
    delivered: number;
    tracked: number;
    pullback: number;
    successRate: number;
    revenue: number;
}

const SellerStatistics = () => {
    const { toast } = useToast();
    // Labels/colors for the status distribution — the counts come from the RPC.
    const statusCats = useStatusCategories();
    const [revenueData, setRevenueData] = useState<ChartData[]>([]);
    const [growth, setGrowth] = useState(0);
    const [perfDateFilter, setPerfDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });
    const [sellerPerfContext, setSellerPerfContext] = useState<{
        id: string;
        businessId: string | null;
    } | null>(null);

    useEffect(() => {
        (async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return;
            const { data: prof } = await supabase
                .from('users')
                .select('"DigiCom Business"')
                .eq('id', user.id)
                .single();
            setSellerPerfContext({
                id: user.id,
                businessId: (prof as { 'DigiCom Business'?: string | null } | null)?.['DigiCom Business'] ?? null,
            });
        })();
    }, []);

    const sellerId = sellerPerfContext?.id ?? null;
    const businessId = sellerPerfContext?.businessId ?? null;
    const statsEnabled = !!sellerId && !!businessId;

    // D2 — ONE server-side aggregate (seller_dashboard_stats) replaces the
    // own-orders full scan, the TWO business-wide parcel dumps, both
    // seller_payments sums and the seller_presences count. Commission money
    // is ledger-reconciled in the RPC — no client commission math remains.
    // This page's own stat block is LIFETIME (the date filter only drives the
    // SellerSelfPerformanceSection), so no window params are sent. p_seller is
    // ALWAYS the auth uid — the RPC raises 42501 for anything else.
    const { data: dashStats, isLoading: statsFetching, error: statsError } = useQuery<any>({
        queryKey: ['dash-stats', 'seller', businessId, sellerId],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('seller_dashboard_stats', {
                p_business: businessId,
                p_seller: sellerId,
            });
            if (error) throw error;
            return data;
        },
        enabled: statsEnabled,
        staleTime: 60_000,
    });

    useEffect(() => {
        if (statsError) {
            console.error('Error fetching analytics:', statsError);
            toast({ title: "Data Error", description: "Failed to load performance metrics.", variant: "destructive" });
        }
    }, [statsError, toast]);

    const loading = !sellerPerfContext || (statsEnabled && statsFetching);

    // Earnings history is a real ROW LIST (monthly commission chart + growth)
    // — it stays a direct fetch per the D2 contract.
    useEffect(() => {
        if (!sellerId) return;
        (async () => {
            try {
                // Paginated so a seller with >1000 earning-days is never truncated.
                // Only the 3 columns the chart + growth calc read — the view is
                // O(history) per read, no reason to ship every ledger column.
                const earnings = await fetchAllRows<any>('seller_daily_earnings', 'date, commission_earned, total_earned', {
                    filters: [{ column: 'seller_id', op: 'eq', value: sellerId }],
                    orderBy: 'date',
                    ascending: true,
                });

                const monthlyMap: Record<string, ChartData> = {};
                earnings?.forEach(e => {
                    const monthStr = format(parseISO(e.date), 'MMM yyyy');
                    if (!monthlyMap[monthStr]) monthlyMap[monthStr] = { month: monthStr, commission: 0, total: 0 };
                    monthlyMap[monthStr].commission += Number(e.commission_earned);
                    monthlyMap[monthStr].total += Number(e.total_earned);
                });
                setRevenueData(Object.values(monthlyMap));

                const currentMonth = startOfMonth(new Date());
                const lastMonth = startOfMonth(subMonths(new Date(), 1));
                const currentMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), { start: currentMonth, end: endOfMonth(new Date()) })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;
                const lastMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), { start: lastMonth, end: endOfMonth(lastMonth) })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;
                setGrowth(lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0);
            } catch (error) {
                console.error('Error fetching analytics:', error);
                toast({ title: "Data Error", description: "Failed to load performance metrics.", variant: "destructive" });
            }
        })();
    }, [sellerId, toast]);

    const stats: PerformanceStats = useMemo(() => {
        const strip = dashStats?.stat_strip;
        const money = dashStats?.money;
        const extra = dashStats?.statistics;
        const total = Number(strip?.total) || 0;
        const delivered = Number(strip?.delivered) || 0;
        const presenceDays = Number(extra?.presence_days) || 0;
        const fakeOrders = Number(extra?.fake_count) || 0;
        // Delivery rate (Coliaty, raw ratio) computed server-side.
        const successRate = Number(strip?.success_rate) || 0;
        return {
            successRate,
            totalRealized: Number(extra?.total_realized) || 0,
            efficiency: presenceDays > 0 ? delivered / presenceDays : 0,
            totalOrders: total,
            deliveredOrders: delivered,
            growth,
            confirmRate: Number(strip?.confirm_rate) || 0,
            integrityScore: total > 0 ? (1 - fakeOrders / total) * 100 : 100,
            deliveryEff: successRate,
            liveCommission: Number(money?.live_commission) || 0,
            // Gross commission earned (delivered units/orders × rate), independent of
            // how much has been paid — drives the per-order earning rate card.
            earnedCommission: Number(money?.earned_commission) || 0,
            commissionBasis: money?.commission_basis === 'per_unit' ? 'per_unit' : 'per_order',
        };
    }, [dashStats, growth]);

    const orderDistribution: StatusDistribution[] = useMemo(() => (
        ((dashStats?.statistics?.status_distribution ?? []) as any[]).map((row) => {
            const statusId: string = row.order_status_id || 'unknown';
            return {
                name: statusCats.orderStatuses.find(s => s.id === statusId)?.label || statusId.slice(0, 8),
                value: Number(row.count) || 0,
                color: statusCats.getOrderStatusColor(statusId),
            };
        }).sort((a, b) => b.value - a.value)
    ), [dashStats, statusCats]);

    const regionalData: RegionalData[] = useMemo(() => (
        ((dashStats?.statistics?.regional ?? []) as any[]).map((r) => ({
            city: r.city || 'Unknown',
            delivered: Number(r.delivered) || 0,
        }))
    ), [dashStats]);

    // Top-5 per-product cards from the RPC (delivered desc); Coliaty
    // delivery-rate per product: delivered ÷ (tracked − admin-pullback).
    const productPerformance: ProductPerformance[] = useMemo(() => (
        ((dashStats?.statistics?.product_perf ?? []) as any[]).map((p) => {
            const tracked = Number(p.tracked) || 0;
            const pullback = Number(p.pullback) || 0;
            const delivered = Number(p.delivered) || 0;
            const denom = tracked - pullback;
            return {
                name: p.name || 'Generic Item',
                image: p.image ?? null,
                attributed: Number(p.attributed) || 0,
                delivered,
                tracked,
                pullback,
                successRate: denom > 0 ? (delivered / denom) * 100 : 0,
                revenue: Number(p.revenue) || 0,
            };
        })
    ), [dashStats]);

    const totalOrdersForDist = orderDistribution.reduce((s, d) => s + d.value, 0);

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Analytique
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Performance
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Les signaux qui comptent — taux de livraison, revenu réalisé, conversion, répartition régionale et produit.
                        </p>
                    </div>
                    <AnalyticsDateFilter dateFilter={perfDateFilter} onDateFilterChange={setPerfDateFilter} variant="ant" />
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {[
                        { label: 'Score performance', value: `${stats.successRate.toFixed(1)}%`, sub: 'taux de livraison', dot: 'bg-ant-orange', text: 'text-ant-orange' },
                        { label: 'Revenu réalisé', value: `${stats.totalRealized.toLocaleString()}`, unit: 'MAD', sub: `${stats.growth >= 0 ? '+' : ''}${stats.growth.toFixed(0)}% vs mois dernier`, dot: 'bg-ant-green', text: 'text-ant-green' },
                        { label: 'Efficacité', value: `${stats.efficiency.toFixed(1)}`, sub: 'livrées / jour de présence', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                        { label: 'Total impact', value: `${stats.deliveredOrders}/${stats.totalOrders}`, sub: 'livrées / attribuées', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                        { label: 'Commission en attente', value: `${stats.liveCommission.toLocaleString()}`, unit: 'MAD', sub: stats.commissionBasis === 'per_unit' ? 'unités non payées' : 'commandes non payées', dot: 'bg-ant-orange', text: 'text-ant-orange' },
                    ].map((kpi, i) => (
                        <div key={i} className="bg-ant-paper p-4">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                <span className={`h-1.5 w-1.5 rounded-full ${kpi.dot}`} />
                                {kpi.label}
                            </div>
                            <p className={`font-display text-[18px] font-semibold tabular-nums mt-2 truncate ${kpi.text}`}>
                                {kpi.value}
                                {kpi.unit && <span className="text-[11px] text-ant-mid font-normal ml-1">{kpi.unit}</span>}
                            </p>
                            <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{kpi.sub}</p>
                        </div>
                    ))}
                </section>

                {sellerPerfContext ? (
                    <SellerSelfPerformanceSection
                        sellerId={sellerPerfContext.id}
                        businessId={sellerPerfContext.businessId}
                        dateFilter={perfDateFilter}
                    />
                ) : null}

                {/* Revenue + Distribution */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <section className="lg:col-span-2 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">01</span>
                                    Moteur de revenu
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">commission mensuelle</span>
                            </div>
                            <div className="h-[200px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="sellerCommGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.18} />
                                                <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="#EDE9E0" strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6760' }} dy={4} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6760' }} width={50} />
                                        <Tooltip
                                            contentStyle={{
                                                background: '#FFFFFF',
                                                border: '1px solid #E8E6DC',
                                                borderRadius: 12,
                                                boxShadow: '0 16px 48px -20px rgba(20,20,19,0.2)',
                                                fontSize: 12,
                                            }}
                                            formatter={(v: number) => [`${v.toLocaleString()} MAD`, 'Commission']}
                                        />
                                        <Area type="monotone" dataKey="commission" stroke="#2D7A3E" strokeWidth={1.75} fill="url(#sellerCommGrad)" fillOpacity={1} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Pouls du cycle
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">statuts</span>
                            </div>
                            {loading ? (
                                <div className="space-y-2">
                                    {[1, 2, 3, 4].map((i) => <div key={i} className="h-4 bg-ant-light rounded animate-pulse" />)}
                                </div>
                            ) : orderDistribution.length === 0 ? (
                                <p className="font-serif italic text-[12px] text-ant-mid py-4 text-center">Aucune donnée</p>
                            ) : (
                                <div className="space-y-2">
                                    {orderDistribution.slice(0, 6).map((item) => {
                                        const pct = totalOrdersForDist > 0 ? (item.value / totalOrdersForDist) * 100 : 0;
                                        return (
                                            <div key={item.name} className="space-y-1">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="inline-flex items-center gap-2 text-ant-ink truncate max-w-[160px]">
                                                        <span
                                                            className="h-1.5 w-1.5 rounded-full"
                                                            style={{ backgroundColor: item.color || '#141413' }}
                                                        />
                                                        {item.name}
                                                    </span>
                                                    <span className="font-display text-[12px] font-semibold tabular-nums text-ant-ink">{item.value}</span>
                                                </div>
                                                <div className="h-1 bg-ant-line rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full"
                                                        style={{ width: `${pct}%`, backgroundColor: item.color || '#141413' }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Yield + Regional */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">03</span>
                                    Analyse du rendement
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">ratios clés</span>
                            </div>
                            <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                <div className="bg-ant-paper p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Revenu / commande</p>
                                    <p className="font-display text-[16px] font-semibold tabular-nums text-ant-ink mt-1">
                                        {stats.deliveredOrders > 0 ? (stats.earnedCommission / stats.deliveredOrders).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}
                                        <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                    </p>
                                </div>
                                <div className="bg-ant-paper p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Taux de succès</p>
                                    <p className="font-display text-[16px] font-semibold tabular-nums text-ant-green mt-1">
                                        {stats.successRate.toFixed(1)}%
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-3 pt-1">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Tunnel de conversion</p>
                                {[
                                    { label: 'Confirmation', pct: stats.confirmRate, bar: 'bg-ant-ink', text: 'text-ant-ink' },
                                    { label: 'Livraison', pct: stats.deliveryEff, bar: 'bg-ant-green', text: 'text-ant-green' },
                                    { label: 'Intégrité pipeline', pct: stats.integrityScore, bar: 'bg-ant-orange', text: 'text-ant-orange' },
                                ].map((metric) => (
                                    <div key={metric.label} className="space-y-1.5">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">{metric.label}</span>
                                            <span className={`font-display text-[13px] font-semibold tabular-nums ${metric.text}`}>{metric.pct.toFixed(1)}%</span>
                                        </div>
                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                            <div className={`h-full ${metric.bar} rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, metric.pct)}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">04</span>
                                    Villes dominantes
                                </div>
                                <MapPin className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            </div>
                            {regionalData.length === 0 ? (
                                <p className="font-serif italic text-[12px] text-ant-mid py-4 text-center">Aucune donnée régionale</p>
                            ) : (
                                <div className="space-y-2">
                                    {regionalData.slice(0, 6).map((r) => {
                                        const max = regionalData[0]?.delivered || 1;
                                        const pct = (r.delivered / max) * 100;
                                        return (
                                            <div key={r.city} className="space-y-1">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="inline-flex items-center gap-2 text-ant-ink truncate max-w-[140px]">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                                        {r.city}
                                                    </span>
                                                    <span className="font-display text-[12px] font-semibold tabular-nums text-ant-ink">{r.delivered}</span>
                                                </div>
                                                <div className="h-1 bg-ant-line rounded-full overflow-hidden">
                                                    <div className="h-full bg-ant-ink rounded-full" style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Product intelligence */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-green" />
                    <div className="px-5 py-4 border-b border-ant-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="font-display text-ant-orange font-semibold">05</span>
                            Intelligence produit
                        </div>
                        {productPerformance.length > 0 && (
                            <div className="flex items-center gap-4">
                                <div className="text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Le plus rentable</p>
                                    <p className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[180px]">{productPerformance[0]?.name || '—'}</p>
                                </div>
                                <div className="w-px h-8 bg-ant-line" />
                                <div className="text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Meilleur taux</p>
                                    <p className="font-display text-[12px] font-semibold text-ant-green tabular-nums">
                                        {Math.max(...productPerformance.map((p) => p.successRate), 0).toFixed(1)}%
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light">
                                    <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Produit</th>
                                    <th className="px-5 py-2.5 text-center text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Attribuées</th>
                                    <th className="px-5 py-2.5 text-center text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Livrées</th>
                                    <th className="px-5 py-2.5 pr-5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Succès</th>
                                </tr>
                            </thead>
                            <tbody>
                                {productPerformance.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="p-0">
                                            <div className="mx-5 my-5 rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-8 flex flex-col items-center gap-2 text-center">
                                                <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper flex items-center justify-center">
                                                    <ShoppingBag className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                                </div>
                                                <p className="font-serif italic text-[12px] text-ant-mid">Aucune donnée produit</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    productPerformance.map((prod, idx) => (
                                        <tr key={idx} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors">
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-10 h-10 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center overflow-hidden shrink-0">
                                                        {prod.image ? (
                                                            <img src={imageUrl(prod.image, 'thumb')} alt={prod.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <ShoppingBag className="w-4 h-4 text-ant-mid" strokeWidth={1.75} />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{prod.name}</p>
                                                        <p className="font-serif italic text-[11px] text-ant-mid tabular-nums">{prod.revenue.toLocaleString()} MAD</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-center font-display text-[13px] font-semibold tabular-nums text-ant-ink">{prod.attributed}</td>
                                            <td className="px-5 py-3 text-center font-display text-[13px] font-semibold tabular-nums text-ant-green">{prod.delivered}</td>
                                            <td className="px-5 py-3 pr-5 text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className={`font-display text-[13px] font-semibold tabular-nums ${prod.successRate > 70 ? 'text-ant-green' : 'text-ant-orange'}`}>
                                                        {prod.successRate.toFixed(1)}%
                                                    </span>
                                                    <div className="w-20 bg-ant-line h-1 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${prod.successRate > 70 ? 'bg-ant-green' : 'bg-ant-orange'}`}
                                                            style={{ width: `${prod.successRate}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default SellerStatistics;
