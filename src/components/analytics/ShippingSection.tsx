import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Globe } from '@/components/ui/globe';
import {
    Truck, Package, RotateCcw, DollarSign, Clock,
    CheckCircle, MapPin, Building2,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths, differenceInDays } from 'date-fns';
import { COBEOptions } from 'cobe';

const PROVIDER_COLORS = ['#3b5e5e', '#7a9385', '#F97316', '#3B82F6', '#A855F7', '#14B8A6'];

interface ShippingSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ShippingSection = ({ businessId, dateFilter }: ShippingSectionProps) => {
    const { deliveredPkgIds, returnedPkgIds } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-shipping', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, shipping_cost, delivery_type, company_id, courier_id, package_status_id, package_status_label, date_livraison, master_city_id, master_cities(name, lat, lng), package_statuses(label)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: providers } = useQuery({
        queryKey: ['analytics-providers', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('providers').select('id, name, logo_url').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: packageStatuses } = useQuery({
        queryKey: ['analytics-package-statuses'],
        queryFn: async () => {
            const { data } = await supabase.from('package_statuses').select('id, code, label');
            return data || [];
        },
    });

    const { data: returnNotes } = useQuery({
        queryKey: ['analytics-return-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('company_return_notes').select('id, order_count, total_amount, created_at').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: paymentNotes } = useQuery({
        queryKey: ['analytics-payment-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('company_payment_notes').select('id, status, total_amount, net_amount, order_count, created_at').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders || !packageStatuses) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = orders.filter(o => isInRange(o.date));
        const shippedOrders = filtered.filter(o => o.package_status_id);
        const total = shippedOrders.length;

        const isDelivered = (o: any) => isDeliveredForCommission(o, deliveredPkgIds);
        const isReturned = (o: any) => o.package_status_id && returnedPkgIds.has(o.package_status_id);

        const deliveredCount = shippedOrders.filter(isDelivered).length;
        const returnedCount = shippedOrders.filter(isReturned).length;
        const deliveryRate = total > 0 ? (deliveredCount / total) * 100 : 0;
        const returnRate = total > 0 ? (returnedCount / total) * 100 : 0;

        const totalShippingCost = filtered.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

        const deliveredWithDates = shippedOrders.filter(o => isDelivered(o) && o.date && o.date_livraison);
        const avgDeliveryDays = deliveredWithDates.length > 0
            ? deliveredWithDates.reduce((s, o) => s + differenceInDays(new Date(o.date_livraison!), new Date(o.date!)), 0) / deliveredWithDates.length
            : 0;

        const providerInfoMap = new Map((providers || []).map(p => [p.id, { name: p.name, logo_url: p.logo_url }]));
        const providerCounts: Record<string, { total: number; delivered: number; name: string; logo_url?: string }> = {};
        shippedOrders.forEach(o => {
            const pid = o.company_id || o.courier_id;
            if (!pid) return;
            const info = providerInfoMap.get(pid);
            const name = info?.name || 'Courier';
            if (!providerCounts[pid]) providerCounts[pid] = { total: 0, delivered: 0, name, logo_url: info?.logo_url };
            providerCounts[pid].total++;
            if (isDelivered(o)) providerCounts[pid].delivered++;
        });
        const providerData = Object.values(providerCounts)
            .sort((a, b) => b.total - a.total)
            .map(p => ({ ...p, rate: p.total > 0 ? (p.delivered / p.total) * 100 : 0 }));

        const pendingPayments = (paymentNotes || []).filter(p => p.status === 'unpaid').reduce((s, p) => s + Number(p.total_amount || 0), 0);

        const statusCounts: Record<string, number> = {};
        shippedOrders.forEach(o => {
            const label = packageStatuses?.find(s => s.id === o.package_status_id)?.label ?? 'Unknown';
            statusCounts[label] = (statusCounts[label] || 0) + 1;
        });
        const statusDistribution = Object.entries(statusCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthOrders = shippedOrders.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));
            return {
                month: format(month, 'MMM yy'),
                shipped: monthOrders.length,
                delivered: monthOrders.filter(isDelivered).length,
                cost: monthOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0),
            };
        });

        const cityDeliveries: Record<string, { count: number; lat: number; lng: number }> = {};
        shippedOrders.forEach(o => {
            const mc = (o as any).master_cities;
            if (!mc?.name || !mc?.lat || !mc?.lng) return;
            const lat = parseFloat(mc.lat);
            const lng = parseFloat(mc.lng);
            if (isNaN(lat) || isNaN(lng)) return;
            if (!cityDeliveries[mc.name]) cityDeliveries[mc.name] = { count: 0, lat, lng };
            cityDeliveries[mc.name].count++;
        });

        const globeMarkers = Object.values(cityDeliveries)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map(c => ({
                location: [c.lat, c.lng] as [number, number],
                size: Math.min(0.15, 0.03 + (c.count / 50) * 0.12),
            }));

        return {
            total, deliveredCount, returnedCount, deliveryRate, returnRate,
            totalShippingCost, avgDeliveryDays, providerData, pendingPayments,
            statusDistribution, trendData, globeMarkers,
        };
    }, [orders, packageStatuses, providers, paymentNotes, dateFilter, deliveredPkgIds, returnedPkgIds]);

    const globeConfig: COBEOptions = useMemo(() => ({
        width: 800,
        height: 800,
        onRender: () => {},
        devicePixelRatio: 2,
        phi: 0,
        theta: 0.3,
        dark: 0,
        diffuse: 1.2,
        mapSamples: 16000,
        mapBrightness: 6,
        baseColor: [1, 1, 1],
        markerColor: [59 / 255, 94 / 255, 94 / 255],
        glowColor: [1, 1, 1],
        markers: metrics?.globeMarkers || [{ location: [33.5731, -7.5898], size: 0.1 }],
    }), [metrics?.globeMarkers]);

    return (
        <SectionWrapper
            id="shipping"
            title="Shipping & Delivery"
            description="Provider performance, delivery rates, and logistics"
            icon={Truck}
            iconBg="bg-teal-50"
            iconColor="text-teal-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                        <StatCard title="Total Shipments" value={metrics.total} icon={Package} iconBg="bg-teal-50" iconColor="text-teal-600" />
                        <StatCard title="Delivered" value={metrics.deliveredCount} icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" subtitle={`${metrics.deliveryRate.toFixed(1)}%`} />
                        <StatCard title="Returns" value={metrics.returnedCount} icon={RotateCcw} iconBg="bg-red-50" iconColor="text-red-500" subtitle={`${metrics.returnRate.toFixed(1)}%`} />
                        <StatCard title="Avg. Delivery" value={metrics.avgDeliveryDays.toFixed(1)} suffix=" days" icon={Clock} iconBg="bg-blue-50" iconColor="text-blue-600" />
                        <StatCard title="Shipping Cost" value={metrics.totalShippingCost.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-amber-50" iconColor="text-amber-600" />
                        <StatCard title="Pending Payments" value={metrics.pendingPayments.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-orange-50" iconColor="text-orange-600" />
                        <StatCard title="Providers" value={metrics.providerData.length} icon={Building2} iconBg="bg-purple-50" iconColor="text-purple-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl lg:col-span-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Shipping Trends</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorShipped" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorDelivered2" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="shipped" stroke="#3b5e5e" fill="url(#colorShipped)" strokeWidth={2.5} name="Shipped" />
                                        <Area type="monotone" dataKey="delivered" stroke="#10B981" fill="url(#colorDelivered2)" strokeWidth={2.5} name="Delivered" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy flex items-center gap-2">
                                    <MapPin className="w-4 h-4" /> Delivery Map
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="flex items-center justify-center p-0">
                                <Globe config={globeConfig} className="max-w-[280px]" />
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">By Provider</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {metrics.providerData.map((p, i) => (
                                        <div key={i} className="flex items-center gap-4 p-3 rounded-2xl bg-brand-navy/[0.02] hover:bg-brand-navy/[0.04] transition-colors">
                                            <div className="w-10 h-10 rounded-xl bg-white border border-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                                {p.logo_url ? (
                                                    <img src={p.logo_url} alt={p.name} className="w-full h-full object-contain p-1" />
                                                ) : (
                                                    <Building2 className="w-5 h-5 text-brand-navy/30" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-brand-navy">{p.name}</div>
                                                <div className="text-xs text-gray-400">{p.total} shipped · {p.delivered} delivered</div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-sm font-black text-brand-navy">{p.rate.toFixed(1)}%</div>
                                                <div className="text-[10px] text-gray-400">delivery rate</div>
                                            </div>
                                            <div className="w-16 shrink-0">
                                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${p.rate}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {metrics.providerData.length === 0 && (
                                        <p className="text-sm text-gray-400 text-center py-4">No provider data</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Package Status</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={250}>
                                    <PieChart>
                                        <Pie data={metrics.statusDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value">
                                            {metrics.statusDistribution.map((_, i) => (
                                                <Cell key={i} fill={PROVIDER_COLORS[i % PROVIDER_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `${val} packages`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </SectionWrapper>
    );
};
