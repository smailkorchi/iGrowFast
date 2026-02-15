import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    BarChart3,
    TrendingUp,
    Target,
    Zap,
    DollarSign,
    ShoppingBag,
    MapPin,
    Clock,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    Search,
    Filter,
    PieChart as PieChartIcon,
    Activity,
    Navigation,
    Globe as GlobeIcon,
    ShieldCheck,
    HeartPulse,
    Trophy,
    Receipt
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe } from '@/components/ui/globe';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    Legend
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/hooks/use-toast";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';

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

const COLORS = ['#F97316', '#3B82F6', '#10B981', '#6366F1', '#F43F5E', '#A855F7'];

const CITY_COORDS: Record<string, [number, number]> = {
    'Casablanca': [33.5731, -7.5898],
    'Rabat': [34.0209, -6.8416],
    'Marrakech': [31.6295, -7.9811],
    'Tangier': [35.7595, -5.8340],
    'Fez': [34.0181, -5.0078],
    'Agadir': [30.4278, -9.5981],
    'Oujda': [34.6805, -1.9075],
    'Meknes': [33.8935, -5.5473],
    'Kenitra': [34.2610, -6.5802],
    'Tetouan': [35.5785, -5.3684],
    'Safi': [32.2994, -9.2372],
    'El Jadida': [33.2316, -8.5007],
    'Beni Mellal': [32.3373, -6.3498],
    'Nador': [35.1689, -2.9335],
    'Settat': [33.0010, -7.6166],
    'Mohammedia': [33.6833, -7.3833],
    'Laayoune': [27.1500, -13.2000],
    'Guelmim': [28.9870, -10.0574],
    'Khemisset': [33.8247, -6.0667],
    'Taza': [34.2167, -4.0167],
};

const SellerStatistics = () => {
    const { toast } = useToast();
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
        liveCommission: 0
    });
    const [revenueData, setRevenueData] = useState<ChartData[]>([]);
    const [orderDistribution, setOrderDistribution] = useState<StatusDistribution[]>([]);
    const [regionalData, setRegionalData] = useState<RegionalData[]>([]);
    const [productPerformance, setProductPerformance] = useState<ProductPerformance[]>([]);

    useEffect(() => {
        fetchAllStats();
    }, []);

    const fetchAllStats = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Fetch Orders with Items & Product Images for Granular Analysis
            const { data: ordersData, error: ordersError } = await supabase
                .from('orders')
                .select('city_id, master_cities(name), order_statuses(code), order_items(unit_price, quantity, products(name, image_url))')
                .eq('seller_id', user.id);

            const orders = (ordersData || []).map(o => ({
                ...o,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown'
            }));

            // Status code helpers matching actual order_statuses.code values
            const isDelivered = (s: string) => ['paid', 'unpaid'].includes(s);
            const isConfirmedOrBeyond = (s: string) => ['confirmed', 'processed', 'paid', 'unpaid'].includes(s);
            const isFake = (s: string) => ['faux commande', 'commandedouble'].includes(s);

            if (ordersError) throw ordersError;

            // Calculate Order Distribution
            const distMap: Record<string, number> = {};
            orders?.forEach(o => {
                distMap[o.status] = (distMap[o.status] || 0) + 1;
            });

            const statusConfig: Record<string, { label: string, color: string }> = {
                paid: { label: 'Delivered (Paid)', color: '#10B981' },
                unpaid: { label: 'Delivered (Unpaid)', color: '#F59E0B' },
                confirmed: { label: 'Confirmed', color: '#3B82F6' },
                new: { label: 'New', color: '#F97316' },
                relaunch_new: { label: 'Relaunched', color: '#F97316' },
                canceled: { label: 'Cancelled', color: '#EF4444' },
                processed: { label: 'Processed', color: '#6366F1' },
                return: { label: 'Return', color: '#DC2626' },
                'faux commande': { label: 'Fake', color: '#94A3B8' },
                commandedouble: { label: 'Duplicate', color: '#94A3B8' }
            };

            const formattedDist = Object.entries(distMap).map(([status, count]) => ({
                name: statusConfig[status]?.label || status.charAt(0).toUpperCase() + status.slice(1),
                value: count,
                color: statusConfig[status]?.color || '#CBD5E1'
            })).sort((a, b) => b.value - a.value);
            setOrderDistribution(formattedDist);

            // Calculate Regional Data
            const cityMap: Record<string, number> = {};
            orders?.filter(o => isDelivered(o.status)).forEach(o => {
                const cityName = (o.master_cities as any)?.name || 'Unknown';
                cityMap[cityName] = (cityMap[cityName] || 0) + 1;
            });
            const formattedRegional = Object.entries(cityMap)
                .map(([city, count]) => ({
                    city,
                    delivered: count,
                    lat: CITY_COORDS[city]?.[0] || 33.57, // Default to Casa
                    lng: CITY_COORDS[city]?.[1] || -7.58
                }))
                .sort((a, b) => b.delivered - a.delivered);
            setRegionalData(formattedRegional);

            // Calculate Product Performance
            const prodMap: Record<string, ProductPerformance> = {};
            orders?.forEach((o: any) => {
                const items = o.order_items || [];
                items.forEach((item: any) => {
                    const product = item.products;
                    const pName = product?.name || 'Generic Item';
                    const pImage = product?.image_url || null;
                    if (!prodMap[pName]) {
                        prodMap[pName] = { name: pName, image: pImage, attributed: 0, delivered: 0, successRate: 0, revenue: 0 };
                    }
                    prodMap[pName].attributed += 1;
                    if (isDelivered(o.status)) {
                        prodMap[pName].delivered += 1;
                        prodMap[pName].revenue += Number(item.unit_price) * Number(item.quantity);
                    }
                });
            });

            const formattedProducts = Object.values(prodMap).map(p => ({
                ...p,
                successRate: p.attributed > 0 ? (p.delivered / p.attributed) * 100 : 0
            })).sort((a, b) => b.delivered - a.delivered).slice(0, 5);
            setProductPerformance(formattedProducts);

            // 2. Fetch Daily Earnings for Revenue History
            const { data: earnings, error: earningsError } = await supabase
                .from('seller_daily_earnings')
                .select('*')
                .eq('seller_id', user.id)
                .order('date', { ascending: true });

            if (earningsError) throw earningsError;

            // Group by Month for Chart
            const monthlyMap: Record<string, ChartData> = {};
            earnings?.forEach(e => {
                const monthStr = format(parseISO(e.date), 'MMM yyyy');
                if (!monthlyMap[monthStr]) {
                    monthlyMap[monthStr] = { month: monthStr, commission: 0, total: 0 };
                }
                monthlyMap[monthStr].commission += Number(e.commission_earned);
                monthlyMap[monthStr].total += Number(e.total_earned);
            });
            setRevenueData(Object.values(monthlyMap));

            // 3. Fetch Payouts for Realized Wealth
            const { data: payments, error: paymentsError } = await supabase
                .from('seller_payments')
                .select('total_amount')
                .eq('seller_id', user.id)
                .eq('status', 'paid');

            if (paymentsError) throw paymentsError;
            const totalRealized = payments?.reduce((acc, curr) => acc + Number(curr.total_amount), 0) || 0;

            // 4. Fetch Presences for Efficiency
            const { count: presenceCount, error: presenceError } = await supabase
                .from('seller_presences')
                .select('*', { count: 'exact', head: true })
                .eq('seller_id', user.id);

            if (presenceError) throw presenceError;

            // Calculate Final KPIs
            const totalAttributed = orders?.length || 0;
            const deliveredOrders = orders?.filter(o => isDelivered(o.status)).length || 0;
            const successRate = totalAttributed > 0 ? (deliveredOrders / totalAttributed) * 100 : 0;
            const efficiency = (presenceCount || 0) > 0 ? deliveredOrders / (presenceCount || 0) : 0;

            // Calculate Growth (compared to last month)
            const currentMonth = startOfMonth(new Date());
            const lastMonth = startOfMonth(subMonths(new Date(), 1));

            const currentMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), {
                start: currentMonth,
                end: endOfMonth(new Date())
            })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;

            const lastMonthTotal = earnings?.filter(e => isWithinInterval(parseISO(e.date), {
                start: lastMonth,
                end: endOfMonth(lastMonth)
            })).reduce((acc, curr) => acc + Number(curr.total_earned), 0) || 0;

            const growth = lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

            // Fetch Seller Config for Commission
            const { data: sellerInfo, error: sellerError } = await supabase
                .from('users')
                .select('commission_price')
                .eq('id', user.id)
                .single();

            if (sellerError && sellerError.code !== 'PGRST116') {
                console.warn('Could not fetch seller commission info');
            }

            const commissionRate = sellerInfo?.commission_price || 0;

            // Calculate Detailed Ratios
            const totalOrdersCount = orders?.length || 0;
            const confirmedOrders = orders?.filter(o => isConfirmedOrBeyond(o.status)).length || 0;
            const deliveredOrdersCount = orders?.filter(o => isDelivered(o.status)).length || 0;
            const fakeOrders = orders?.filter(o => isFake(o.status)).length || 0;

            const confirmRate = totalOrdersCount > 0 ? (confirmedOrders / totalOrdersCount) * 100 : 0;
            const deliveryEff = confirmedOrders > 0 ? (deliveredOrdersCount / confirmedOrders) * 100 : 0;
            const integrityScore = totalOrdersCount > 0 ? (1 - (fakeOrders / totalOrdersCount)) * 100 : 100;

            // Live Commission is usually (Delivered Orders * Commission per delivery)
            // If the commission field is treated as MAD per delivery
            const liveCommission = deliveredOrdersCount * commissionRate;

            setStats({
                successRate,
                totalRealized,
                efficiency,
                totalOrders: totalAttributed,
                deliveredOrders: deliveredOrdersCount,
                growth,
                confirmRate,
                integrityScore,
                deliveryEff,
                liveCommission
            });

        } catch (error) {
            console.error('Error fetching analytics:', error);
            toast({
                title: "Data Error",
                description: "Failed to load performance metrics.",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white/95 backdrop-blur-xl border border-gray-100 p-4 rounded-2xl shadow-2xl shadow-primary/5 min-w-[160px]">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center justify-between gap-4 py-1">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="text-xs font-medium text-gray-600">{entry.name}</span>
                            </div>
                            <span className="text-sm font-bold text-gray-900">{entry.value.toLocaleString()} MAD</span>
                        </div>
                    ))}
                    <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-gray-400">Monthly Total</span>
                        <span className="text-xs font-bold text-primary">
                            {payload[0].value.toLocaleString()} MAD
                        </span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Performance Intelligence</h1>
                            <p className="text-gray-500 font-light">Deep analytical insights into your realized success.</p>
                        </div>

                    </div>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                {[
                    {
                        label: 'Performance Score',
                        value: `${stats.successRate.toFixed(1)}%`,
                        sub: 'Delivery Success Rate',
                        icon: Target,
                        color: 'text-orange-600',
                        bg: 'bg-orange-50',
                        trend: stats.successRate > 70 ? 'Optimal' : 'Needs Focus'
                    },
                    {
                        label: 'Realized Wealth',
                        value: `${stats.totalRealized.toLocaleString()} MAD`,
                        sub: 'Life cumulative Paid',
                        icon: DollarSign,
                        color: 'text-green-600',
                        bg: 'bg-green-50',
                        trend: `${stats.growth.toFixed(0)}% vs last month`
                    },
                    {
                        label: 'Service Efficiency',
                        value: `${stats.efficiency.toFixed(1)}`,
                        sub: 'Delivered / Presence Day',
                        icon: Zap,
                        color: 'text-blue-600',
                        bg: 'bg-blue-50',
                        trend: 'Active Pace'
                    },
                    {
                        label: 'Total Impact',
                        value: `${stats.deliveredOrders}/${stats.totalOrders}`,
                        sub: 'Attributed vs Delivered',
                        icon: ShoppingBag,
                        color: 'text-purple-600',
                        bg: 'bg-purple-50',
                        trend: 'Active Supply'
                    },
                    {
                        label: 'Live Commission',
                        value: `${stats.liveCommission.toLocaleString()} MAD`,
                        sub: 'Estimate for Current Shipments',
                        icon: Receipt,
                        color: 'text-amber-600',
                        bg: 'bg-amber-50',
                        trend: 'Unbilled Earnings'
                    }
                ].map((stat, i) => (
                    <Card key={i} className="border-0 shadow-sm rounded-3xl overflow-hidden group hover:shadow-xl transition-all duration-500 flex flex-col justify-between">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className={`w-12 h-12 ${stat.bg} ${stat.color} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500`}>
                                    <stat.icon className="w-6 h-6" />
                                </div>
                                <span className={`text-[8px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${stat.bg} ${stat.color}`}>
                                    {stat.trend}
                                </span>
                            </div>
                            <div>
                                <h3 className="text-2xl font-light text-gray-900 mb-1">{stat.value}</h3>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1">{stat.label}</p>
                                <p className="text-xs text-gray-400 font-light">{stat.sub}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Revenue Engine Chart */}
                <Card className="lg:col-span-2 border-0 shadow-2xl rounded-[2.5rem] bg-white overflow-hidden flex flex-col">
                    <CardHeader className="p-8 pb-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl font-light">The Revenue Engine</CardTitle>
                                <CardDescription className="text-xs tracking-wide uppercase font-bold text-gray-400">Earnings Components Over Time</CardDescription>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-primary" />
                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Growth Performance (Commission)</span>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8 pt-0 flex-1 min-h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={revenueData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCommission" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#F97316" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                <XAxis
                                    dataKey="month"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }}
                                    tickFormatter={(value) => `${value} MAD`}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="commission"
                                    name="Monthly Settlement"
                                    stroke="#F97316"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorCommission)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Status distribution Pie */}
                <Card className="border-0 shadow-2xl rounded-[2.5rem] bg-white overflow-hidden flex flex-col">
                    <CardHeader className="p-8 pb-4">
                        <CardTitle className="text-2xl font-light text-center">Lifecycle Pulse</CardTitle>
                        <CardDescription className="text-[10px] tracking-widest uppercase font-bold text-gray-400 text-center">Order Status Distribution</CardDescription>
                    </CardHeader>
                    <CardContent className="p-8 pt-0 flex-1 flex flex-col items-center justify-center min-h-[400px]">
                        <div className="relative w-full h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={orderDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={90}
                                        paddingAngle={8}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {orderDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
                                <p className="text-3xl font-light text-gray-900">{stats.totalOrders}</p>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Items</p>
                            </div>
                        </div>
                        <div className="w-full mt-6 space-y-3">
                            {orderDistribution.slice(0, 4).map((item, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                        <span className="text-xs font-medium text-gray-600">{item.name}</span>
                                    </div>
                                    <span className="text-xs font-bold text-gray-900">
                                        {((item.value / stats.totalOrders) * 100).toFixed(0)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Regional Performance */}
                <Card className="border-0 shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
                    <CardHeader className="p-8">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
                                <MapPin className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-light">Regional Dominance</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Top Performing Cities (Delivered)</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 h-[520px] relative overflow-hidden flex flex-col items-center justify-center">
                        <div className="absolute top-8 left-8 z-10">
                            <Badge className="bg-primary/10 text-primary border-primary/20 rounded-xl px-4 py-2 font-bold uppercase tracking-widest text-[10px]">
                                <GlobeIcon className="w-3 h-3 mr-2" />
                                {regionalData[0]?.city || 'Analyzing Region...'}
                            </Badge>
                            <p className="text-[10px] text-gray-400 font-bold uppercase mt-2 ml-1">Dominant Hub</p>
                        </div>

                        <div className="relative w-full h-full flex items-center justify-center">
                            <Globe
                                className="w-full h-full"
                                config={{
                                    width: 1000,
                                    height: 1000,
                                    onRender: () => { },
                                    devicePixelRatio: 2,
                                    phi: 0,
                                    theta: 0.3,
                                    dark: 0,
                                    diffuse: 1.2,
                                    mapSamples: 16000,
                                    mapBrightness: 6,
                                    baseColor: [1, 1, 1],
                                    markerColor: [249 / 255, 115 / 255, 22 / 255],
                                    glowColor: [1, 1, 1],
                                    markers: regionalData.map(r => ({
                                        location: [r.lat, r.lng],
                                        size: Math.min(Math.max(r.delivered / 100, 0.05), 0.15)
                                    })),
                                }}
                            />
                            <div className="pointer-events-none absolute inset-0 h-full bg-[radial-gradient(circle_at_50%_100%,rgba(249,115,22,0.05),rgba(255,255,255,0))]" />
                        </div>

                        {/* City Overlay List */}
                        <div className="absolute bottom-6 left-6 right-6 z-10 flex flex-wrap gap-2 justify-center">
                            {regionalData.slice(0, 4).map((r, i) => (
                                <div key={i} className="bg-white/60 backdrop-blur-md border border-white/40 px-3 py-1.5 rounded-xl shadow-sm flex items-center gap-2 group hover:bg-white transition-all">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                    <span className="text-[10px] font-bold text-gray-700">{r.city}</span>
                                    <span className="text-[10px] text-gray-400">{r.delivered}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Efficiency Forecast */}
                <Card className="border-0 shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full translate-x-1/3 -translate-y-1/3 blur-3xl" />
                    <CardHeader className="p-8 relative z-10">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-blue-500" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-light">Yield Analysis</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Productivity Ratios</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8 pt-0 relative z-10 space-y-8">
                        {/* Tier 1: Core Financials */}
                        <div className="grid grid-cols-2 gap-6">
                            <div className="p-6 rounded-3xl bg-gray-50 border border-gray-100 group hover:bg-white hover:shadow-lg transition-all duration-300">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2">Revenue / Unit</p>
                                <p className="text-2xl font-light text-gray-900">
                                    {stats.deliveredOrders > 0 ? (stats.totalRealized / stats.deliveredOrders).toFixed(0) : 0} <span className="text-xs font-bold text-gray-400">MAD</span>
                                </p>
                            </div>
                            <div className="p-6 rounded-3xl bg-gray-50 border border-gray-100 group hover:bg-white hover:shadow-lg transition-all duration-300">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2">Success Rate</p>
                                <p className="text-2xl font-light text-green-600">
                                    {stats.successRate.toFixed(1)}%
                                </p>
                            </div>
                        </div>

                        {/* Tier 2: The Conversion Tunnel */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Conversion Tunnel</p>
                                <ShieldCheck className="w-4 h-4 text-green-500" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase">
                                        <span>Confirmation</span>
                                        <span>{stats.confirmRate.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${stats.confirmRate}%` }}
                                            className="h-full bg-blue-500 rounded-full"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase">
                                        <span>Fullfillment</span>
                                        <span>{stats.deliveryEff.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${stats.deliveryEff}%` }}
                                            className="h-full bg-indigo-500 rounded-full"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tier 3: Health & Benchmarks */}
                        <div className="pt-4 border-t border-gray-50 space-y-6">
                            <div className="flex items-center justify-between p-4 bg-orange-50/50 rounded-2xl border border-orange-100/50">
                                <div className="flex items-center gap-3">
                                    <HeartPulse className="w-5 h-5 text-orange-500" />
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Pipeline Integrity</p>
                                        <p className="text-sm font-medium text-gray-900">{stats.integrityScore.toFixed(0)}/100</p>
                                    </div>
                                </div>
                                <Badge className="bg-white text-orange-600 border-orange-100 rounded-lg text-[10px] font-bold">
                                    {stats.integrityScore > 90 ? 'Healthy' : 'Risk Detected'}
                                </Badge>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Trophy className="w-3.5 h-3.5 text-amber-500" />
                                        <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Network Benchmark</p>
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-900">Elite 10%: 82%</span>
                                </div>
                                <div className="relative h-2 bg-gray-100 rounded-full">
                                    <div className="absolute top-0 left-0 h-full bg-gray-200 rounded-full" style={{ width: '82%' }} />
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${stats.successRate}%` }}
                                        className="absolute top-0 left-0 h-full bg-primary rounded-full shadow-lg shadow-primary/20"
                                    />
                                    <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-primary rounded-full shadow-sm" style={{ left: `${stats.successRate}%` }} />
                                </div>
                                <p className="text-[10px] text-gray-400 font-medium italic text-center">
                                    {stats.successRate > 64.2 ? 'Outperforming the regional average by ' + (stats.successRate - 64.2).toFixed(1) + '%' : 'Focus on confirmation speed to reach average.'}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Product Intelligence Section */}
            <Card className="border-0 shadow-2xl rounded-[2.5rem] bg-white overflow-hidden">
                <CardHeader className="p-8">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
                                <ShoppingBag className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-light">Product Intelligence</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Performance per Attributed item</CardDescription>
                            </div>
                        </div>
                        <div className="hidden md:flex items-center gap-6">
                            <div className="text-right">
                                <p className="text-[10px] uppercase font-bold text-gray-400">Most Profitable</p>
                                <p className="text-sm font-light text-gray-900">{productPerformance[0]?.name || 'N/A'}</p>
                            </div>
                            <div className="w-px h-8 bg-gray-100" />
                            <div className="text-right">
                                <p className="text-[10px] uppercase font-bold text-gray-400">Top Success Rate</p>
                                <p className="text-sm font-light text-green-600">
                                    {Math.max(...productPerformance.map(p => p.successRate), 0).toFixed(1)}%
                                </p>
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8 pt-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-gray-50">
                                    <th className="pb-4 text-[10px] uppercase tracking-widest font-bold text-gray-400 pl-4">Product Identity</th>
                                    <th className="pb-4 text-[10px] uppercase tracking-widest font-bold text-gray-400 text-center">Attributed</th>
                                    <th className="pb-4 text-[10px] uppercase tracking-widest font-bold text-gray-400 text-center">Delivered</th>
                                    <th className="pb-4 text-[10px] uppercase tracking-widest font-bold text-gray-400 text-right pr-4">Success Matrix</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {productPerformance.map((prod, idx) => (
                                    <tr key={idx} className="group hover:bg-gray-50/50 transition-colors">
                                        <td className="py-6 pl-4">
                                            <div className="flex items-center gap-4">
                                                <div className="relative">
                                                    <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center overflow-hidden border border-gray-100 shadow-sm transition-transform group-hover:scale-105 duration-500">
                                                        {prod.image ? (
                                                            <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <ShoppingBag className="w-6 h-6 text-gray-200" />
                                                        )}
                                                    </div>
                                                    <div className="absolute -top-2 -left-2 w-6 h-6 bg-white border border-gray-100 rounded-lg flex items-center justify-center text-[10px] font-bold text-gray-400 shadow-sm">
                                                        #{idx + 1}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900 group-hover:text-primary transition-colors">{prod.name}</p>
                                                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">Gross: {prod.revenue.toLocaleString()} MAD</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-6 text-center">
                                            <span className="text-sm font-light text-gray-600">{prod.attributed}</span>
                                        </td>
                                        <td className="py-6 text-center">
                                            <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100 rounded-lg px-2 text-[10px] font-bold">
                                                {prod.delivered} Done
                                            </Badge>
                                        </td>
                                        <td className="py-6 text-right pr-4 min-w-[200px]">
                                            <div className="flex flex-col items-end gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold ${prod.successRate > 70 ? 'text-green-600' : 'text-amber-500'}`}>
                                                        {prod.successRate.toFixed(1)}%
                                                    </span>
                                                    <ArrowUpRight className={`w-3 h-3 ${prod.successRate > 70 ? 'text-green-600' : 'text-amber-500 opacity-50'}`} />
                                                </div>
                                                <div className="w-32 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        whileInView={{ width: `${prod.successRate}%` }}
                                                        transition={{ duration: 1, delay: idx * 0.1 }}
                                                        className={`h-full rounded-full ${prod.successRate > 70 ? 'bg-green-500' : 'bg-amber-500'}`}
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
