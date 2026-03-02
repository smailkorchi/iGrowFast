import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TrendingUp, BarChart3 } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import {
    format, startOfDay, endOfDay, isWithinInterval, eachDayOfInterval,
    eachWeekOfInterval, eachMonthOfInterval, startOfMonth, endOfMonth,
    subDays, differenceInDays, subMonths,
} from 'date-fns';

interface SalesComparatifChartProps {
    businessId: string;
    dateFilter: DateFilter;
}

type Granularity = 'daily' | 'weekly' | 'monthly';

export const SalesComparatifChart = ({ businessId, dateFilter }: SalesComparatifChartProps) => {
    const [granularity, setGranularity] = useState<Granularity>('daily');
    const [showComparison, setShowComparison] = useState(true);

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, shipping_cost, order_status_id, package_status_id, package_status_label, seller_id, company_id, source_name, order_statuses(code, label)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const chartData = useMemo(() => {
        if (!orders) return [];

        const rangeStart = dateFilter.from || subDays(new Date(), 30);
        const rangeEnd = dateFilter.to || new Date();
        const rangeDays = differenceInDays(rangeEnd, rangeStart);

        const prevStart = subDays(rangeStart, rangeDays + 1);
        const prevEnd = subDays(rangeStart, 1);

        const isInRange = (dateStr: string, from: Date, to: Date) => {
            if (!dateStr) return false;
            return isWithinInterval(new Date(dateStr), { start: startOfDay(from), end: endOfDay(to) });
        };

        const currentOrders = orders.filter((o: any) => o.date && isInRange(o.date, rangeStart, rangeEnd));
        const prevOrders = orders.filter((o: any) => o.date && isInRange(o.date, prevStart, prevEnd));

        let intervals: Date[];
        let formatStr: string;

        const autoGranularity = rangeDays <= 31 ? 'daily' : rangeDays <= 120 ? 'weekly' : 'monthly';
        const effectiveGranularity = granularity || autoGranularity;

        if (effectiveGranularity === 'monthly') {
            intervals = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            formatStr = 'MMM yy';
        } else if (effectiveGranularity === 'weekly') {
            intervals = eachWeekOfInterval({ start: rangeStart, end: rangeEnd });
            formatStr = 'MMM d';
        } else {
            intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            formatStr = rangeDays <= 14 ? 'EEE d' : 'MMM d';
        }

        return intervals.map((date, idx) => {
            let periodStart: Date, periodEnd: Date;
            if (effectiveGranularity === 'monthly') {
                periodStart = startOfMonth(date);
                periodEnd = endOfMonth(date);
            } else if (effectiveGranularity === 'weekly') {
                periodStart = date;
                periodEnd = subDays(intervals[idx + 1] || rangeEnd, 0);
            } else {
                periodStart = startOfDay(date);
                periodEnd = endOfDay(date);
            }

            const curPeriod = currentOrders.filter((o: any) =>
                isWithinInterval(new Date(o.date), { start: periodStart, end: periodEnd })
            );
            const curRevenue = curPeriod
                .filter((o: any) => (o.package_status_label || '').toLowerCase() === 'livré')
                .reduce((s: number, o: any) => s + Number(o.price || 0), 0);

            const prevOffset = rangeDays + 1;
            const prevPeriodStart = subDays(periodStart, prevOffset);
            const prevPeriodEnd = subDays(periodEnd, prevOffset);
            const prevPeriod = prevOrders.filter((o: any) =>
                o.date && isWithinInterval(new Date(o.date), { start: prevPeriodStart, end: prevPeriodEnd })
            );
            const prevRevenue = prevPeriod
                .filter((o: any) => (o.package_status_label || '').toLowerCase() === 'livré')
                .reduce((s: number, o: any) => s + Number(o.price || 0), 0);

            return {
                label: format(date, formatStr),
                orders: curPeriod.length,
                revenue: curRevenue,
                prevOrders: prevPeriod.length,
                prevRevenue: prevRevenue,
            };
        });
    }, [orders, dateFilter, granularity]);

    const totals = useMemo(() => {
        if (!chartData.length) return { orders: 0, revenue: 0, prevOrders: 0, prevRevenue: 0 };
        return chartData.reduce((acc, d) => ({
            orders: acc.orders + d.orders,
            revenue: acc.revenue + d.revenue,
            prevOrders: acc.prevOrders + d.prevOrders,
            prevRevenue: acc.prevRevenue + d.prevRevenue,
        }), { orders: 0, revenue: 0, prevOrders: 0, prevRevenue: 0 });
    }, [chartData]);

    const orderGrowth = totals.prevOrders > 0
        ? (((totals.orders - totals.prevOrders) / totals.prevOrders) * 100).toFixed(1)
        : null;
    const revenueGrowth = totals.prevRevenue > 0
        ? (((totals.revenue - totals.prevRevenue) / totals.prevRevenue) * 100).toFixed(1)
        : null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <CardTitle className="text-sm font-bold text-brand-navy">Sales Overview</CardTitle>
                            <p className="text-xs text-gray-400 mt-0.5">Orders & revenue over time</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowComparison(!showComparison)}
                            className={cn(
                                'rounded-xl text-xs h-8',
                                showComparison ? 'bg-brand-navy/10 text-brand-navy' : 'text-gray-400'
                            )}
                        >
                            vs Previous
                        </Button>
                        {(['daily', 'weekly', 'monthly'] as Granularity[]).map(g => (
                            <Button
                                key={g}
                                variant="ghost"
                                size="sm"
                                onClick={() => setGranularity(g)}
                                className={cn(
                                    'rounded-xl text-xs h-8 capitalize',
                                    granularity === g ? 'bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white' : 'text-gray-400'
                                )}
                            >
                                {g}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <MiniStat label="Orders" value={totals.orders} growth={orderGrowth} />
                    <MiniStat label="Revenue" value={`${totals.revenue.toLocaleString('fr-MA')} MAD`} growth={revenueGrowth} />
                    <MiniStat label="Prev. Orders" value={totals.prevOrders} muted />
                    <MiniStat label="Prev. Revenue" value={`${totals.prevRevenue.toLocaleString('fr-MA')} MAD`} muted />
                </div>
            </CardHeader>
            <CardContent>
                <div className="h-[320px] mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="ordersGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40} />
                            <Tooltip
                                contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }}
                            />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                            <Area type="monotone" dataKey="orders" name="Orders" stroke="#3b5e5e" fill="url(#ordersGrad)" strokeWidth={2.5} dot={false} />
                            <Area type="monotone" dataKey="revenue" name="Revenue (MAD)" stroke="#2563eb" fill="url(#revenueGrad)" strokeWidth={2.5} dot={false} />
                            {showComparison && (
                                <>
                                    <Area type="monotone" dataKey="prevOrders" name="Prev. Orders" stroke="#3b5e5e" strokeDasharray="5 5" fill="none" strokeWidth={1.5} dot={false} />
                                    <Area type="monotone" dataKey="prevRevenue" name="Prev. Revenue" stroke="#2563eb" strokeDasharray="5 5" fill="none" strokeWidth={1.5} dot={false} />
                                </>
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};

const MiniStat = ({ label, value, growth, muted }: { label: string; value: string | number; growth?: string | null; muted?: boolean }) => (
    <div className={cn('rounded-2xl p-3', muted ? 'bg-gray-50' : 'bg-brand-navy/[0.03]')}>
        <div className={cn('text-lg font-black tracking-tight', muted ? 'text-gray-400' : 'text-brand-navy')}>
            {typeof value === 'number' ? value.toLocaleString('fr-MA') : value}
        </div>
        <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{label}</span>
            {growth && (
                <span className={cn(
                    'text-[10px] font-bold',
                    Number(growth) >= 0 ? 'text-emerald-600' : 'text-red-500'
                )}>
                    {Number(growth) >= 0 ? '+' : ''}{growth}%
                </span>
            )}
        </div>
    </div>
);
