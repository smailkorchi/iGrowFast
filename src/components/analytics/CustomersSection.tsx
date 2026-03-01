import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Users, UserPlus, Repeat, DollarSign, MapPin,
    TrendingUp, Heart, BarChart3,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell, Legend,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths } from 'date-fns';

const COLORS = ['#3b5e5e', '#7a9385', '#c93942', '#F97316', '#3B82F6', '#14B8A6', '#A855F7', '#EC4899'];

interface CustomersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const CustomersSection = ({ businessId, dateFilter }: CustomersSectionProps) => {
    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-customers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, phone, name, price, date, order_status_id, package_status_id, master_city_id, master_cities(name, region)')
                .eq('DigiCom Business', businessId);
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

        const customerMap: Record<string, { orders: number; revenue: number; firstDate: string; lastDate: string }> = {};
        filtered.forEach(o => {
            const key = o.phone || o.name || o.id;
            if (!customerMap[key]) {
                customerMap[key] = { orders: 0, revenue: 0, firstDate: o.date || '', lastDate: o.date || '' };
            }
            customerMap[key].orders++;
            customerMap[key].revenue += Number(o.price || 0);
            if (o.date && o.date < customerMap[key].firstDate) customerMap[key].firstDate = o.date;
            if (o.date && o.date > customerMap[key].lastDate) customerMap[key].lastDate = o.date;
        });

        const customers = Object.values(customerMap);
        const totalCustomers = customers.length;
        const repeatCustomers = customers.filter(c => c.orders > 1).length;
        const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
        const avgOrdersPerCustomer = totalCustomers > 0 ? customers.reduce((s, c) => s + c.orders, 0) / totalCustomers : 0;
        const avgCustomerValue = totalCustomers > 0 ? customers.reduce((s, c) => s + c.revenue, 0) / totalCustomers : 0;
        const totalCustomerRevenue = customers.reduce((s, c) => s + c.revenue, 0);

        const regionCounts: Record<string, number> = {};
        filtered.forEach(o => {
            const region = (o as any).master_cities?.region || (o as any).master_cities?.name || 'Unknown';
            regionCounts[region] = (regionCounts[region] || 0) + 1;
        });
        const regionData = Object.entries(regionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([region, count]) => ({ region, count }));

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const seenCustomers = new Set<string>();
        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));

            let newCount = 0;
            let returningCount = 0;
            const monthCustomers = new Set<string>();
            monthOrders.forEach(o => {
                const key = o.phone || o.name || o.id;
                if (!monthCustomers.has(key)) {
                    monthCustomers.add(key);
                    if (seenCustomers.has(key)) {
                        returningCount++;
                    } else {
                        newCount++;
                        seenCustomers.add(key);
                    }
                }
            });

            return {
                month: format(month, 'MMM yy'),
                new: newCount,
                returning: returningCount,
            };
        });

        return {
            totalCustomers, repeatCustomers, repeatRate,
            avgOrdersPerCustomer, avgCustomerValue, totalCustomerRevenue,
            regionData, trendData,
        };
    }, [orders, dateFilter]);

    return (
        <SectionWrapper
            id="customers"
            title="Customers"
            description="Customer base, retention, and geographic distribution"
            icon={Users}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                        <StatCard title="Total Customers" value={metrics.totalCustomers} icon={Users} iconBg="bg-violet-50" iconColor="text-violet-600" />
                        <StatCard title="Repeat Customers" value={metrics.repeatCustomers} icon={Repeat} iconBg="bg-emerald-50" iconColor="text-emerald-600" subtitle={`${metrics.repeatRate.toFixed(1)}%`} />
                        <StatCard title="Avg Orders/Customer" value={metrics.avgOrdersPerCustomer.toFixed(1)} icon={BarChart3} iconBg="bg-blue-50" iconColor="text-blue-600" />
                        <StatCard title="Avg Customer Value" value={metrics.avgCustomerValue.toFixed(0)} suffix=" MAD" icon={DollarSign} iconBg="bg-amber-50" iconColor="text-amber-600" />
                        <StatCard title="Repeat Rate" value={metrics.repeatRate.toFixed(1)} suffix="%" icon={Heart} iconBg="bg-pink-50" iconColor="text-pink-600" />
                        <StatCard title="Total Revenue" value={metrics.totalCustomerRevenue.toLocaleString('fr-MA')} suffix=" MAD" icon={TrendingUp} iconBg="bg-teal-50" iconColor="text-teal-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">New vs Returning</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorNew" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorReturning" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="new" stroke="#3B82F6" fill="url(#colorNew)" strokeWidth={2.5} name="New Customers" stackId="1" />
                                        <Area type="monotone" dataKey="returning" stroke="#10B981" fill="url(#colorReturning)" strokeWidth={2.5} name="Returning" stackId="1" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy flex items-center gap-2">
                                    <MapPin className="w-4 h-4" /> Geographic Distribution
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={metrics.regionData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis dataKey="region" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} width={100} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="count" radius={[0, 8, 8, 0]} name="Orders">
                                            {metrics.regionData.map((_, i) => (
                                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </SectionWrapper>
    );
};
