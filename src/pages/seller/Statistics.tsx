import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission, type CommissionBasis } from '@/lib/commercialCommission';
import {
    ShoppingBag,
    MapPin,
    Receipt,
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

            let ordersBuilder = supabase
                .from('orders')
                .select('city_id, order_status_id, package_status_id, package_status_label, master_cities(name, lat, lng), order_statuses(code), package_statuses(label), order_items(product_id, unit_price, quantity, products(name, image_url))')
                .eq('seller_id', user.id)
                .is('date_deleted', null);
            if (sellerBusinessId) {
                ordersBuilder = ordersBuilder.eq('DigiCom Business', sellerBusinessId);
            }
            const { data: ordersData, error: ordersError } = await ordersBuilder;

            const orders = (ordersData || []).map(o => ({
                ...o,
                order_status_id: (o as any).order_status_id,
                package_status_id: (o as any).package_status_id,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                packageStatus: ((o as any).package_status_label || '').toLowerCase(),
                cityData: (o.master_cities as any)
            }));

            const isDelivered = (o: any) => isDeliveredForCommission(o, statusCats.deliveredPkgIds);
            const isConfirmedOrBeyond = (o: any) => statusCats.confirmedIds.has(o.order_status_id);
            const isFake = (o: any) => statusCats.isOrderInCategories(o.order_status_id, ['fake', 'double']);

            if (ordersError) throw ordersError;

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
                items.forEach((item: any) => {
                    const product = item.products;
                    const pName = product?.name || 'Generic Item';
                    const pImage = product?.image_url || null;
                    if (!prodMap[pName]) prodMap[pName] = { name: pName, image: pImage, attributed: 0, delivered: 0, successRate: 0, revenue: 0 };
                    if (!seenProducts.has(pName)) {
                        seenProducts.add(pName);
                        prodMap[pName].attributed += 1;
                        if (isDelivered(o)) prodMap[pName].delivered += 1;
                    }
                    if (isDelivered(o)) prodMap[pName].revenue += Number(item.unit_price) * Number(item.quantity);
                });
            });

            const formattedProducts = Object.values(prodMap).map(p => ({
                ...p,
                successRate: p.attributed > 0 ? (p.delivered / p.attributed) * 100 : 0
            })).sort((a, b) => b.delivered - a.delivered).slice(0, 5);
            setProductPerformance(formattedProducts);

            const { data: earnings, error: earningsError } = await supabase
                .from('seller_daily_earnings')
                .select('*')
                .eq('seller_id', user.id)
                .order('date', { ascending: true });
            if (earningsError) throw earningsError;

            const monthlyMap: Record<string, ChartData> = {};
            earnings?.forEach(e => {
                const monthStr = format(parseISO(e.date), 'MMM yyyy');
                if (!monthlyMap[monthStr]) monthlyMap[monthStr] = { month: monthStr, commission: 0, total: 0 };
                monthlyMap[monthStr].commission += Number(e.commission_earned);
                monthlyMap[monthStr].total += Number(e.total_earned);
            });
            setRevenueData(Object.values(monthlyMap));

            const { data: payments, error: paymentsError } = await supabase
                .from('seller_payments')
                .select('total_amount')
                .eq('seller_id', user.id)
                .eq('status', 'paid');
            if (paymentsError) throw paymentsError;
            const totalRealized = payments?.reduce((acc, curr) => acc + Number(curr.total_amount), 0) || 0;

            const { count: presenceCount, error: presenceError } = await supabase
                .from('seller_presences')
                .select('*', { count: 'exact', head: true })
                .eq('seller_id', user.id);
            if (presenceError) throw presenceError;

            const totalAttributed = orders?.length || 0;
            const deliveredOrders = orders?.filter(o => isDelivered(o)).length || 0;
            const successRate = totalAttributed > 0 ? (deliveredOrders / totalAttributed) * 100 : 0;
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
            const confirmRate = totalOrdersCount > 0 ? (confirmedOrders / totalOrdersCount) * 100 : 0;
            const deliveryEff = confirmedOrders > 0 ? (deliveredOrdersCount / confirmedOrders) * 100 : 0;
            const integrityScore = totalOrdersCount > 0 ? (1 - (fakeOrders / totalOrdersCount)) * 100 : 100;

            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('delivered_orders, status')
                .eq('seller_id', user.id)
                .eq('status', 'paid');
            const alreadyPaidDeliveries = (paymentsData || []).reduce((sum, p) => sum + (Number(p.delivered_orders) || 0), 0);

            const { unpaidCommission: liveCommission } = computeUnpaidCommission({
                basis: commissionBasis,
                commissionPrice: Number(commissionRate) || 0,
                orders: orders || [],
                isDelivered,
                sellerProductIds,
                paidTally: alreadyPaidDeliveries,
            });

            setStats({ successRate, totalRealized, efficiency, totalOrders: totalAttributed, deliveredOrders: deliveredOrdersCount, growth, confirmRate, integrityScore, deliveryEff, liveCommission, commissionBasis });
        } catch (error) {
            console.error('Error fetching analytics:', error);
            toast({ title: "Data Error", description: "Failed to load performance metrics.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const totalOrdersForDist = orderDistribution.reduce((s, d) => s + d.value, 0);

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Performance Intelligence
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Deep analytical insights
                        </p>
                    </div>
                    <AnalyticsDateFilter dateFilter={perfDateFilter} onDateFilterChange={setPerfDateFilter} />
                </div>
            </header>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                {[
                    { label: 'Performance Score', value: `${stats.successRate.toFixed(1)}%`, sub: 'Delivery success rate', accent: '#d97706' },
                    { label: 'Realized Wealth', value: `${stats.totalRealized.toLocaleString()} MAD`, sub: `${stats.growth.toFixed(0)}% vs last month`, accent: '#059669' },
                    { label: 'Service Efficiency', value: `${stats.efficiency.toFixed(1)}`, sub: 'Delivered / presence day', accent: '#3b5e5e' },
                    { label: 'Total Impact', value: `${stats.deliveredOrders}/${stats.totalOrders}`, sub: 'Attributed vs delivered', accent: '#3b5e5e' },
                    { label: 'Live Commission', value: `${stats.liveCommission.toLocaleString()} MAD`, sub: stats.commissionBasis === 'per_unit' ? 'Unpaid units' : 'Unpaid orders', accent: '#d97706' },
                ].map((kpi, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: kpi.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{kpi.label}</p>
                            <p className="text-[15px] font-semibold tabular-nums text-brand-navy mt-1 leading-tight">{kpi.value}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">{kpi.sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            {sellerPerfContext ? (
                <SellerSelfPerformanceSection
                    sellerId={sellerPerfContext.id}
                    businessId={sellerPerfContext.businessId}
                    dateFilter={perfDateFilter}
                />
            ) : null}

            {/* Revenue Chart + Status Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                {/* Revenue Engine */}
                <Card className="lg:col-span-2 border border-gray-100 shadow-none rounded-xl">
                    <CardHeader className="p-3.5 pb-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Revenue Engine</p>
                                <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">
                                    <span className="inline-flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#3b5e5e] inline-block" />
                                        Monthly commission
                                    </span>
                                </p>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-3.5 pb-3.5">
                        <div className="h-[160px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="sellerCommGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.12} />
                                            <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} dy={4} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={(v) => `${v}`} width={40} />
                                    <Tooltip
                                        contentStyle={{ background: '#fff', border: '1px solid #f3f4f6', borderRadius: 8, boxShadow: 'none', fontSize: 11 }}
                                        formatter={(v: number) => [`${v.toLocaleString()} MAD`, 'Commission']}
                                    />
                                    <Area type="monotone" dataKey="commission" stroke="#3b5e5e" strokeWidth={2} fill="url(#sellerCommGrad)" fillOpacity={1} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Order Status Distribution — proportion list */}
                <Card className="border border-gray-100 shadow-none rounded-xl">
                    <CardHeader className="p-3.5 pb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">Lifecycle Pulse</p>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Order status distribution</p>
                    </CardHeader>
                    <CardContent className="px-3.5 pb-3.5">
                        {loading ? (
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => <div key={i} className="h-5 bg-gray-50 rounded animate-pulse" />)}
                            </div>
                        ) : orderDistribution.length === 0 ? (
                            <p className="text-[11px] text-gray-400 py-4 text-center">No data yet</p>
                        ) : (
                            <div className="space-y-1.5">
                                {orderDistribution.slice(0, 6).map((item) => {
                                    const pct = totalOrdersForDist > 0 ? (item.value / totalOrdersForDist) * 100 : 0;
                                    return (
                                        <div key={item.name} className="flex items-center gap-2 text-[11px]">
                                            <span className="text-gray-600 w-20 truncate">{item.name}</span>
                                            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                <div style={{ width: `${pct}%`, background: item.color || '#3b5e5e' }} className="h-full rounded-full" />
                                            </div>
                                            <span className="tabular-nums text-brand-navy font-semibold w-10 text-right">{item.value}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Conversion Tunnel + Regional */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {/* Yield Analysis */}
                <Card className="border border-gray-100 shadow-none rounded-xl">
                    <CardHeader className="p-3.5 pb-2">
                        <p className="text-[11px] font-semibold text-brand-navy">Yield Analysis</p>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Productivity ratios</p>
                    </CardHeader>
                    <CardContent className="px-3.5 pb-3.5 space-y-3">
                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 mb-1">Revenue / Unit</p>
                                <p className="text-[15px] font-semibold text-brand-navy tabular-nums">
                                    {stats.deliveredOrders > 0 ? (stats.totalRealized / stats.deliveredOrders).toFixed(0) : 0} <span className="text-[10px] text-gray-400">MAD</span>
                                </p>
                            </div>
                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 mb-1">Success Rate</p>
                                <p className="text-[15px] font-semibold text-[#059669] tabular-nums">{stats.successRate.toFixed(1)}%</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Conversion Tunnel</p>
                            {[
                                { label: 'Confirmation', pct: stats.confirmRate, color: '#3b5e5e' },
                                { label: 'Fulfilment', pct: stats.deliveryEff, color: '#059669' },
                                { label: 'Pipeline Integrity', pct: stats.integrityScore, color: '#d97706' },
                            ].map((metric) => (
                                <div key={metric.label} className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-gray-500 font-semibold">{metric.label}</span>
                                        <span className="font-bold text-brand-navy tabular-nums">{metric.pct.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                                        <div style={{ width: `${metric.pct}%`, background: metric.color }} className="h-full rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Regional dominance — proportion list */}
                <Card className="border border-gray-100 shadow-none rounded-xl">
                    <CardHeader className="p-3.5 pb-2">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Regional Dominance</p>
                                <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Top cities (delivered)</p>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="px-3.5 pb-3.5">
                        {regionalData.length === 0 ? (
                            <p className="text-[11px] text-gray-400 py-4 text-center">No regional data yet</p>
                        ) : (
                            <div className="space-y-1.5">
                                {regionalData.slice(0, 6).map((r) => {
                                    const max = regionalData[0]?.delivered || 1;
                                    const pct = (r.delivered / max) * 100;
                                    return (
                                        <div key={r.city} className="flex items-center gap-2 text-[11px]">
                                            <span className="text-gray-600 w-20 truncate">{r.city}</span>
                                            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                                                <div style={{ width: `${pct}%`, background: '#3b5e5e' }} className="h-full rounded-full" />
                                            </div>
                                            <span className="tabular-nums text-brand-navy font-semibold w-10 text-right">{r.delivered}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Product Intelligence */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardHeader className="p-3.5 pb-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ShoppingBag className="w-3.5 h-3.5 text-gray-400" />
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Product Intelligence</p>
                                <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Performance per attributed item</p>
                            </div>
                        </div>
                        <div className="hidden md:flex items-center gap-4">
                            <div className="text-right">
                                <p className="text-[9px] uppercase font-bold text-gray-400">Most Profitable</p>
                                <p className="text-[11px] text-brand-navy">{productPerformance[0]?.name || 'N/A'}</p>
                            </div>
                            <div className="w-px h-6 bg-gray-100" />
                            <div className="text-right">
                                <p className="text-[9px] uppercase font-bold text-gray-400">Top Success Rate</p>
                                <p className="text-[11px] text-[#059669]">{Math.max(...productPerformance.map(p => p.successRate), 0).toFixed(1)}%</p>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-3.5 pb-3.5">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-gray-50">
                                    <th className="pb-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 pl-1">Product</th>
                                    <th className="pb-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 text-center">Attributed</th>
                                    <th className="pb-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 text-center">Delivered</th>
                                    <th className="pb-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 text-right pr-1">Success</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {productPerformance.map((prod, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="py-2.5 pl-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 shrink-0">
                                                    {prod.image ? (
                                                        <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <ShoppingBag className="w-3.5 h-3.5 text-gray-300" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-semibold text-brand-navy">{prod.name}</p>
                                                    <p className="text-[9px] text-gray-400">{prod.revenue.toLocaleString()} MAD</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-2.5 text-center">
                                            <span className="text-[11px] text-gray-600 tabular-nums">{prod.attributed}</span>
                                        </td>
                                        <td className="py-2.5 text-center">
                                            <span className="text-[11px] font-semibold text-[#059669] tabular-nums">{prod.delivered}</span>
                                        </td>
                                        <td className="py-2.5 text-right pr-1">
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={`text-[11px] font-bold tabular-nums ${prod.successRate > 70 ? 'text-[#059669]' : 'text-[#d97706]'}`}>
                                                    {prod.successRate.toFixed(1)}%
                                                </span>
                                                <div className="w-20 bg-gray-100 h-1 rounded-full overflow-hidden">
                                                    <div
                                                        style={{ width: `${prod.successRate}%`, background: prod.successRate > 70 ? '#059669' : '#d97706' }}
                                                        className="h-full rounded-full"
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default SellerStatistics;
