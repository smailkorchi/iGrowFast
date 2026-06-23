import { useState, useEffect } from 'react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission, type CommissionBasis } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
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
    lat: number;
    lng: number;
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
    const statusCats = useStatusCategories();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<PerformanceStats>({
        successRate: 0,
        totalRealized: 0,
        efficiency: 0,
        totalOrders: 0,
        deliveredOrders: 0,
        growth: 0,
        confirmRate: 0,
        integrityScore: 0,
        deliveryEff: 0,
        liveCommission: 0,
        earnedCommission: 0,
        commissionBasis: 'per_order',
    });
    const [revenueData, setRevenueData] = useState<ChartData[]>([]);
    const [orderDistribution, setOrderDistribution] = useState<StatusDistribution[]>([]);
    const [regionalData, setRegionalData] = useState<RegionalData[]>([]);
    const [productPerformance, setProductPerformance] = useState<ProductPerformance[]>([]);
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
            const { data: { user } } = await supabase.auth.getUser();
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

    useEffect(() => {
        fetchAllStats();
    }, [statusCats.confirmedIds.size, statusCats.deliveredPkgIds.size, statusCats.orderStatuses.length]);

    const fetchAllStats = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: sellerProfile } = await supabase
                .from('users')
                .select('"DigiCom Business"')
                .eq('id', user.id)
                .single();
            const sellerBusinessId = (sellerProfile as { 'DigiCom Business'?: string | null } | null)?.['DigiCom Business'] ?? null;

            // Paginated so a seller exceeding 1000 orders is never truncated.
            const ordersFilters: { column: string; op: 'eq' | 'is'; value: unknown }[] = [
                { column: 'seller_id', op: 'eq', value: user.id },
                { column: 'date_deleted', op: 'is', value: null },
            ];
            if (sellerBusinessId) ordersFilters.push({ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId });
            const ordersData = await fetchAllRows<any>(
                'orders',
                'id, order_status_id, package_status_id, package_status_label, tracking_number, master_cities(name, lat, lng), order_statuses(code), package_statuses(label), order_items(product_id, unit_price, quantity, products(name, image_url))',
                { filters: ordersFilters },
            );

            const orders = (ordersData || []).map(o => ({
                ...o,
                order_status_id: (o as any).order_status_id,
                package_status_id: (o as any).package_status_id,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                packageStatus: ((o as any).package_status_label || '').toLowerCase(),
                cityData: (o.master_cities as any)
            }));

            // Fetch parcel tracking codes up front — the `orders.tracking_number`
            // column is not populated in production; the authoritative source is
            // company_parcels.tracking_code / courier_parcels.tracking_code.
            // Every "has tracking" check below must use this set, otherwise
            // confirmed counts / rates drift from the real state.
            const trackedSet = new Set<string>();
            if (sellerBusinessId) {
                const [cpRows, xpRows] = await Promise.all([
                    fetchAllRows<{ order_id: string | null; tracking_code: string | null }>(
                        'company_parcels', 'order_id, tracking_code',
                        { filters: [{ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId }] },
                    ),
                    fetchAllRows<{ order_id: string | null; tracking_code: string | null }>(
                        'courier_parcels', 'order_id, tracking_code',
                        { filters: [{ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId }] },
                    ),
                ]);
                (cpRows || []).forEach((p: { order_id: string | null; tracking_code: string | null }) => {
                    if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) trackedSet.add(p.order_id);
                });
                (xpRows || []).forEach((p: { order_id: string | null; tracking_code: string | null }) => {
                    if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) trackedSet.add(p.order_id);
                });
            }
            const hasTracking = (o: any) => !!o?.id && trackedSet.has(o.id);

            const isDelivered = (o: any) => isDeliveredForCommission(o, statusCats.deliveredPkgIds);
            // Confirmed = status in confirmed bucket OR parcel already handed to
            // a courier (tracking code). Must match the rule used for the rate
            // below, otherwise "Confirmées" count and "Taux de confirmation"
            // disagree on the same orders.
            const isConfirmedOrBeyond = (o: any) => hasTracking(o) || statusCats.confirmedIds.has(o.order_status_id);
            const isFake = (o: any) => statusCats.isOrderInCategories(o.order_status_id, ['fake', 'double']);

            const distMap: Record<string, number> = {};
            orders?.forEach(o => {
                const id = o.order_status_id || 'unknown';
                distMap[id] = (distMap[id] || 0) + 1;
            });

            const formattedDist = Object.entries(distMap).map(([statusId, count]) => ({
                name: statusCats.orderStatuses.find(s => s.id === statusId)?.label || statusId.slice(0, 8),
                value: count,
                color: statusCats.getOrderStatusColor(statusId)
            })).sort((a, b) => b.value - a.value);
            setOrderDistribution(formattedDist);

            const cityMap: Record<string, { count: number; lat: number | null; lng: number | null }> = {};
            orders?.filter(o => isDelivered(o)).forEach(o => {
                const cityData = (o.master_cities as any);
                const cityName = cityData?.name || 'Unknown';
                const lat = cityData?.lat != null ? parseFloat(cityData.lat) : null;
                const lng = cityData?.lng != null ? parseFloat(cityData.lng) : null;
                if (!cityMap[cityName]) cityMap[cityName] = { count: 0, lat, lng };
                cityMap[cityName].count++;
            });

            const formattedRegional = Object.entries(cityMap)
                .filter(([, data]) => data.lat != null && data.lng != null && !isNaN(data.lat) && !isNaN(data.lng))
                .map(([city, data]) => ({ city, delivered: data.count, lat: data.lat as number, lng: data.lng as number }))
                .sort((a, b) => b.delivered - a.delivered);
            setRegionalData(formattedRegional);

            const prodMap: Record<string, ProductPerformance> = {};
            orders?.forEach((o: any) => {
                const items = o.order_items || [];
                const seenProducts = new Set<string>();
                const isTracked = !!o.id && trackedSet.has(o.id);
                const isPullback = isTracked && isAdminPullback(
                    o,
                    true,
                    statusCats.adminPullbackOrderIds,
                    statusCats.adminPullbackPackageIds,
                );
                items.forEach((item: any) => {
                    const product = item.products;
                    const pName = product?.name || 'Generic Item';
                    const pImage = product?.image_url || null;
                    if (!prodMap[pName]) prodMap[pName] = { name: pName, image: pImage, attributed: 0, delivered: 0, tracked: 0, pullback: 0, successRate: 0, revenue: 0 };
                    if (!seenProducts.has(pName)) {
                        seenProducts.add(pName);
                        prodMap[pName].attributed += 1;
                        if (isTracked) prodMap[pName].tracked += 1;
                        if (isPullback) prodMap[pName].pullback += 1;
                        if (isDelivered(o)) prodMap[pName].delivered += 1;
                    }
                    if (isDelivered(o)) prodMap[pName].revenue += Number(item.unit_price) * Number(item.quantity);
                });
            });

            // Coliaty delivery-rate per product: delivered ÷ (tracked − admin-pullback).
            const formattedProducts = Object.values(prodMap).map(p => {
                const denom = p.tracked - p.pullback;
                return { ...p, successRate: denom > 0 ? (p.delivered / denom) * 100 : 0 };
            }).sort((a, b) => b.delivered - a.delivered).slice(0, 5);
            setProductPerformance(formattedProducts);

            // Paginated so a seller with >1000 earning-days is never truncated.
            const earnings = await fetchAllRows<any>('seller_daily_earnings', '*', {
                filters: [{ column: 'seller_id', op: 'eq', value: user.id }],
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

            // Realized = cash actually paid out to the seller = Σ paid_amount across
            // ALL payout rows. The old code summed total_amount only for status='paid'
            // rows, which dropped partial payouts (ghita: 4800 paid -> showed 0).
            const { data: payments, error: paymentsError } = await supabase
                .from('seller_payments')
                .select('paid_amount')
                .eq('seller_id', user.id);
            if (paymentsError) throw paymentsError;
            const totalRealized = payments?.reduce((acc, curr) => acc + Number(curr.paid_amount), 0) || 0;

            const { count: presenceCount, error: presenceError } = await supabase
                .from('seller_presences')
                .select('*', { count: 'exact', head: true })
                .eq('seller_id', user.id);
            if (presenceError) throw presenceError;

            const totalAttributed = orders?.length || 0;
            const deliveredOrders = orders?.filter(o => isDelivered(o)).length || 0;
            const efficiency = (presenceCount || 0) > 0 ? deliveredOrders / (presenceCount || 0) : 0;

            const currentMonth = startOfMonth(new Date());
            const lastMonth = startOfMonth(subMonths(new Date(), 1));
            const currentMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), { start: currentMonth, end: endOfMonth(new Date()) })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;
            const lastMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), { start: lastMonth, end: endOfMonth(lastMonth) })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;
            const growth = lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

            const { data: sellerInfo, error: sellerError } = await supabase
                .from('users')
                .select('commission_price, commission_basis, products')
                .eq('id', user.id)
                .single();
            if (sellerError && sellerError.code !== 'PGRST116') console.warn('Could not fetch seller commission info');

            const commissionRate = sellerInfo?.commission_price || 0;
            const commissionBasis = normalizeCommissionBasis(sellerInfo?.commission_basis as string | null | undefined);
            const sellerProductIds = Array.isArray(sellerInfo?.products)
                ? (sellerInfo!.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];

            const totalOrdersCount = orders?.length || 0;
            const confirmedOrders = orders?.filter(o => isConfirmedOrBeyond(o)).length || 0;
            const deliveredOrdersCount = orders?.filter(o => isDelivered(o)).length || 0;
            const fakeOrders = orders?.filter(o => isFake(o)).length || 0;
            // Confirmation rate: numerator = orders NOT in pending (new +
            // postponed) OR with tracking. Denominator = total orders.
            const statusMapsReady = statusCats.pendingIds.size > 0;
            const rateConfirmedCount = orders?.filter((o: any) => {
                if (hasTracking(o)) return true;
                return statusMapsReady
                    && !!o.order_status_id
                    && !statusCats.pendingIds.has(o.order_status_id);
            }).length || 0;
            const confirmRate = totalOrdersCount > 0 ? (rateConfirmedCount / totalOrdersCount) * 100 : 0;

            // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
            // `trackedSet` was fetched above (before the confirmation rules).
            const trackedCount = (orders || []).filter((o: any) => !!o.id && trackedSet.has(o.id)).length;
            const pullbackCount = (orders || []).filter((o: any) =>
                !!o.id && trackedSet.has(o.id) && isAdminPullback(o, true, statusCats.adminPullbackOrderIds, statusCats.adminPullbackPackageIds),
            ).length;
            const deliveryDenom = trackedCount - pullbackCount;
            const deliveryEff = deliveryDenom > 0 ? (deliveredOrdersCount / deliveryDenom) * 100 : 0;
            const successRate = deliveryEff;
            const integrityScore = totalOrdersCount > 0 ? (1 - (fakeOrders / totalOrdersCount)) * 100 : 100;

            // Owed = accrued − ALL cash paid (Σ paid_amount across every payout
            // row, incl. partials). The old code summed delivered_orders only for
            // status='paid' rows, which dropped partial payouts entirely and made
            // "commission en attente" show the full accrual (6,420 instead of
            // 1,620). Mirrors the seller Dashboard's owed calc exactly.
            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('paid_amount')
                .eq('seller_id', user.id);
            const alreadyPaidAmount = (paymentsData || []).reduce((sum, p) => sum + (Number(p.paid_amount) || 0), 0);

            const { unpaidCommission: liveCommission, accruedTotal } = computeUnpaidCommission({
                basis: commissionBasis,
                commissionPrice: Number(commissionRate) || 0,
                orders: orders || [],
                isDelivered,
                sellerProductIds,
                paidAmount: alreadyPaidAmount,
            });
            // Gross commission earned (delivered units/orders × rate), independent of
            // how much has been paid — drives the per-order earning rate card.
            const earnedCommission = accruedTotal * (Number(commissionRate) || 0);

            setStats({ successRate, totalRealized, efficiency, totalOrders: totalAttributed, deliveredOrders: deliveredOrdersCount, growth, confirmRate, integrityScore, deliveryEff, liveCommission, earnedCommission, commissionBasis });
        } catch (error) {
            console.error('Error fetching analytics:', error);
            toast({ title: "Data Error", description: "Failed to load performance metrics.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

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
                                                            <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
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
