import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    ShoppingBag, CheckCircle, Truck, XCircle, Receipt,
    TrendingUp, Clock, BarChart3, MapPin,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell, Legend, PieChart, Pie,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths, eachDayOfInterval, subDays } from 'date-fns';

interface OrdersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const OrdersSection = ({ businessId, dateFilter }: OrdersSectionProps) => {
    const {
        confirmedIds,
        cancelledIds,
        deliveredPkgIds,
        getOrderCategory,
        getCategoryColor,
        isOrderCategory,
    } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-full', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, price, date, order_status_id, package_status_id, package_status_label, city_id, master_city_id, source_name, shipping_cost, cities(name), master_cities(name), package_statuses(label), order_items(quantity, unit_price)')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;

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
        const total = filtered.length;
        const avgOrderValue = total > 0 ? filtered.reduce((s, o) => s + Number(o.price || 0), 0) / total : 0;

        const categoryCounts: Record<string, number> = {};
        filtered.forEach(o => {
            const cat = getOrderCategory(o.order_status_id) || 'other';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        const confirmedCount = filtered.filter(o => o.order_status_id && confirmedIds.has(o.order_status_id)).length;
        const canceledCount = filtered.filter(o => o.order_status_id && cancelledIds.has(o.order_status_id)).length;
        const confirmRate = total > 0 ? (confirmedCount / total) * 100 : 0;
        const cancelRate = total > 0 ? (canceledCount / total) * 100 : 0;

        const deliveredCount = filtered.filter(o => isDeliveredForCommission(o, deliveredPkgIds)).length;
        const deliveryRate = total > 0 ? (deliveredCount / total) * 100 : 0;

        const statusDistribution = Object.entries(categoryCounts)
            .map(([cat, count]) => ({ name: cat, value: count, color: getCategoryColor(cat) }))
            .sort((a, b) => b.value - a.value);

        const today = new Date();
        const todayOrders = filtered.filter(o => o.date && format(new Date(o.date), 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')).length;
        const weekOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: subDays(today, 7), end: today })).length;

        const rangeStart = dateFilter.from || (filtered.length > 0
            ? new Date(Math.min(...filtered.filter(o => o.date).map(o => new Date(o.date!).getTime())))
            : subMonths(today, 6));
        const rangeEnd = dateFilter.to || today;

        const diffDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
        let trendData: { label: string; orders: number; revenue: number }[];

        if (diffDays <= 31) {
            const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = days.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const dayOrders = filtered.filter(o => o.date && format(new Date(o.date), 'yyyy-MM-dd') === dayStr);
                return {
                    label: format(day, 'MMM d'),
                    orders: dayOrders.length,
                    revenue: dayOrders.reduce((s, o) => s + Number(o.price || 0), 0),
                };
            });
        } else {
            const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = months.map(month => {
                const mStart = startOfMonth(month);
                const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
                const monthOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));
                return {
                    label: format(month, 'MMM yy'),
                    orders: monthOrders.length,
                    revenue: monthOrders.reduce((s, o) => s + Number(o.price || 0), 0),
                };
            });
        }

        const cityCounts: Record<string, number> = {};
        filtered.forEach(o => {
            const city = (o as { master_cities?: { name?: string }; cities?: { name?: string } }).master_cities?.name || (o as { master_cities?: { name?: string }; cities?: { name?: string } }).cities?.name;
            if (!city) return;
            cityCounts[city] = (cityCounts[city] || 0) + 1;
        });
        const topCities = Object.entries(cityCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([city, count]) => ({ city, count }));

        const funnelData = [
            { stage: 'New', count: filtered.filter(o => o.order_status_id && isOrderCategory(o.order_status_id, 'new')).length },
            { stage: 'Confirmed', count: confirmedCount },
            { stage: 'Shipped', count: filtered.filter(o => o.order_status_id && isOrderCategory(o.order_status_id, 'processed')).length },
            { stage: 'Delivered', count: deliveredCount },
            { stage: 'Paid', count: filtered.filter(o => o.order_status_id && isOrderCategory(o.order_status_id, 'paid')).length },
        ];

        return {
            total, confirmedCount, deliveredCount, canceledCount,
            confirmRate, deliveryRate, cancelRate, avgOrderValue,
            todayOrders, weekOrders, statusDistribution, trendData,
            topCities, funnelData,
        };
    }, [orders, dateFilter, confirmedIds, cancelledIds, deliveredPkgIds, getOrderCategory, getCategoryColor, isOrderCategory]);

    return (
        <SectionWrapper
            id="orders"
            title="Orders"
            description="Order volume, conversion funnel, and status breakdown"
            icon={ShoppingBag}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                        <StatCard title="Total Orders" value={metrics.total} icon={ShoppingBag} iconBg="bg-blue-50" iconColor="text-blue-600" />
                        <StatCard title="Today" value={metrics.todayOrders} icon={Clock} iconBg="bg-amber-50" iconColor="text-amber-600" />
                        <StatCard title="This Week" value={metrics.weekOrders} icon={BarChart3} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                        <StatCard title="Confirmed" value={metrics.confirmedCount} icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" subtitle={`${metrics.confirmRate.toFixed(1)}%`} />
                        <StatCard title="Delivered" value={metrics.deliveredCount} icon={Truck} iconBg="bg-teal-50" iconColor="text-teal-600" subtitle={`${metrics.deliveryRate.toFixed(1)}%`} />
                        <StatCard title="Canceled" value={metrics.canceledCount} icon={XCircle} iconBg="bg-red-50" iconColor="text-red-500" subtitle={`${metrics.cancelRate.toFixed(1)}%`} />
                        <StatCard title="Avg. Order" value={metrics.avgOrderValue.toFixed(0)} suffix=" MAD" icon={Receipt} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Delivery Rate" value={metrics.deliveryRate.toFixed(1)} suffix="%" icon={TrendingUp} iconBg="bg-green-50" iconColor="text-green-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Orders Over Time</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="orders" stroke="#3b5e5e" fill="url(#colorOrders)" strokeWidth={2.5} name="Orders" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Status Distribution</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={metrics.statusDistribution.slice(0, 8)} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
                                            {metrics.statusDistribution.slice(0, 8).map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `${val} orders`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Order Funnel</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={metrics.funnelData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: '#6b7280' }} width={80} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="count" radius={[0, 8, 8, 0]} name="Orders">
                                            {metrics.funnelData.map((_, i) => (
                                                <Cell key={i} fill={['#3B82F6', '#10B981', '#F97316', '#14B8A6', '#059669'][i]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy flex items-center gap-2">
                                    <MapPin className="w-4 h-4" /> Top Cities
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2.5">
                                    {metrics.topCities.map((city, i) => (
                                        <div key={city.city} className="flex items-center gap-3">
                                            <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-sm font-semibold text-brand-navy">{city.city}</span>
                                                    <span className="text-xs font-bold text-gray-500">{city.count}</span>
                                                </div>
                                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-brand-navy to-brand-blue rounded-full"
                                                        style={{ width: `${(city.count / (metrics.topCities[0]?.count || 1)) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {metrics.topCities.length === 0 && (
                                        <p className="text-sm text-gray-400 text-center py-4">No city data available</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </SectionWrapper>
    );
};
