import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Building2, Activity, Gauge, TrendingUp,
    BarChart3, Zap, Timer, Target,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths, differenceInDays } from 'date-fns';

interface BusinessHealthSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const BusinessHealthSection = ({ businessId, dateFilter }: BusinessHealthSectionProps) => {
    const { confirmedIds, cancelledIds, deliveredPkgIds, isOrderCategory } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-health', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, price, date, order_status_id, package_status_id, confirmation_date')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;

        const isPaidAndDelivered = (o: any) =>
            o.order_status_id && isOrderCategory(o.order_status_id, 'paid') &&
            o.package_status_id && deliveredPkgIds.has(o.package_status_id);

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
        const datesWithOrders = filtered.filter(o => o.date).map(o => new Date(o.date!));
        const minDate = datesWithOrders.length > 0 ? new Date(Math.min(...datesWithOrders.map(d => d.getTime()))) : new Date();
        const maxDate = datesWithOrders.length > 0 ? new Date(Math.max(...datesWithOrders.map(d => d.getTime()))) : new Date();
        const daySpan = Math.max(1, differenceInDays(maxDate, minDate));
        const orderVelocity = filtered.length / daySpan;

        const revenueOrders = filtered.filter(isPaidAndDelivered);
        const totalRevenue = revenueOrders.reduce((s, o) => s + Number(o.price || 0), 0);

        const confirmedCount = filtered.filter(o => o.order_status_id && confirmedIds.has(o.order_status_id)).length;
        const canceledCount = filtered.filter(o => o.order_status_id && cancelledIds.has(o.order_status_id)).length;
        const confirmRate = filtered.length > 0 ? (confirmedCount / filtered.length) * 100 : 0;
        const deliveryRate = filtered.length > 0 ? (revenueOrders.length / filtered.length) * 100 : 0;

        const withConfDate = filtered.filter(o => o.date && o.confirmation_date);
        const avgConfirmTime = withConfDate.length > 0
            ? withConfDate.reduce((s, o) => {
                const hrs = (new Date(o.confirmation_date!).getTime() - new Date(o.date!).getTime()) / (1000 * 60 * 60);
                return s + Math.max(0, hrs);
            }, 0) / withConfDate.length
            : 0;

        const operationalEfficiency = (confirmRate * 0.3 + deliveryRate * 0.5 + Math.min(100, (1 / Math.max(1, avgConfirmTime / 24)) * 100) * 0.2);

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));
            const monthRevenue = monthOrders.filter(isPaidAndDelivered)
                .reduce((s, o) => s + Number(o.price || 0), 0);
            const monthDays = differenceInDays(mEnd, mStart) || 1;
            const monthConfirmed = monthOrders.filter(o => o.order_status_id && confirmedIds.has(o.order_status_id)).length;
            const monthDelivered = monthOrders.filter(isPaidAndDelivered).length;

            return {
                month: format(month, 'MMM yy'),
                revenue: monthRevenue,
                velocity: monthOrders.length / monthDays,
                confirmRate: monthOrders.length > 0 ? (monthConfirmed / monthOrders.length) * 100 : 0,
                deliveryRate: monthOrders.length > 0 ? (monthDelivered / monthOrders.length) * 100 : 0,
            };
        });

        let revenueGrowth = 0;
        if (trendData.length >= 2) {
            const lastMonth = trendData[trendData.length - 1].revenue;
            const prevMonth = trendData[trendData.length - 2].revenue;
            revenueGrowth = prevMonth > 0 ? ((lastMonth - prevMonth) / prevMonth) * 100 : 0;
        }

        return {
            orderVelocity, totalRevenue, confirmRate, deliveryRate,
            avgConfirmTime, operationalEfficiency, revenueGrowth, trendData,
            totalOrders: filtered.length,
        };
    }, [orders, dateFilter, confirmedIds, cancelledIds, deliveredPkgIds, isOrderCategory]);

    return (
        <SectionWrapper
            id="business-health"
            title="Business Health"
            description="Operational KPIs, efficiency, and growth trajectory"
            icon={Activity}
            iconBg="bg-rose-50"
            iconColor="text-rose-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                        <StatCard title="Order Velocity" value={metrics.orderVelocity.toFixed(1)} suffix="/day" icon={Zap} iconBg="bg-amber-50" iconColor="text-amber-600" />
                        <StatCard title="Total Revenue" value={metrics.totalRevenue.toLocaleString('fr-MA')} suffix=" MAD" icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Revenue Growth" value={metrics.revenueGrowth.toFixed(1)} suffix="%" icon={BarChart3} iconBg="bg-blue-50" iconColor="text-blue-600" trend={metrics.revenueGrowth} />
                        <StatCard title="Confirm Rate" value={metrics.confirmRate.toFixed(1)} suffix="%" icon={Target} iconBg="bg-teal-50" iconColor="text-teal-600" />
                        <StatCard title="Delivery Rate" value={metrics.deliveryRate.toFixed(1)} suffix="%" icon={Target} iconBg="bg-green-50" iconColor="text-green-600" />
                        <StatCard title="Avg Confirm Time" value={metrics.avgConfirmTime.toFixed(1)} suffix="h" icon={Timer} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Efficiency Score" value={metrics.operationalEfficiency.toFixed(0)} suffix="/100" icon={Gauge} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                        <StatCard title="Total Orders" value={metrics.totalOrders} icon={Building2} iconBg="bg-rose-50" iconColor="text-rose-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Revenue Trajectory</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorBizRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: number) => typeof val === 'number' && val > 100 ? `${val.toLocaleString('fr-MA')} MAD` : val} />
                                        <Area type="monotone" dataKey="revenue" stroke="#10B981" fill="url(#colorBizRevenue)" strokeWidth={2.5} name="Revenue" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Rates Trend</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorConfRate" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorDelRate" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#14B8A6" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#14B8A6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: number) => `${val.toFixed(1)}%`} />
                                        <Area type="monotone" dataKey="confirmRate" stroke="#3B82F6" fill="url(#colorConfRate)" strokeWidth={2} name="Confirm Rate %" />
                                        <Area type="monotone" dataKey="deliveryRate" stroke="#14B8A6" fill="url(#colorDelRate)" strokeWidth={2} name="Delivery Rate %" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </SectionWrapper>
    );
};
