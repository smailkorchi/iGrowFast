import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle, Hourglass, CalendarClock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { differenceInDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface PendingOrdersBreakdownProps {
    businessId: string;
    dateFilter: DateFilter;
}

const BUCKETS = [
    { key: 'today', label: 'Today', color: '#10b981', icon: Clock },
    { key: '1-3d', label: '1-3 Days', color: '#f59e0b', icon: Hourglass },
    { key: '3-7d', label: '3-7 Days', color: '#f97316', icon: CalendarClock },
    { key: '7+d', label: '7+ Days', color: '#ef4444', icon: AlertTriangle },
];

export const PendingOrdersBreakdown = ({ businessId, dateFilter }: PendingOrdersBreakdownProps) => {
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

        const pending = orders.filter((o: any) => {
            const code = (o.order_statuses as any)?.code?.toUpperCase();
            return (code === 'NEW' || code === 'INTERESTED') && isInRange(o.date);
        });

        const now = new Date();
        const buckets: Record<string, any[]> = { 'today': [], '1-3d': [], '3-7d': [], '7+d': [] };

        pending.forEach((o: any) => {
            const age = differenceInDays(now, new Date(o.date || o.created_at));
            if (age <= 0) buckets['today'].push(o);
            else if (age <= 3) buckets['1-3d'].push(o);
            else if (age <= 7) buckets['3-7d'].push(o);
            else buckets['7+d'].push(o);
        });

        const chartData = BUCKETS.map(b => ({
            name: b.label,
            count: buckets[b.key].length,
            color: b.color,
            value: buckets[b.key].reduce((s: number, o: any) => s + Number(o.price || 0), 0),
        }));

        return { total: pending.length, buckets, chartData };
    }, [orders, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Pending Orders</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.total} orders awaiting confirmation</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-4 gap-2 mb-4">
                    {BUCKETS.map(b => {
                        const count = metrics.buckets[b.key].length;
                        const Icon = b.icon;
                        return (
                            <div key={b.key} className="rounded-2xl p-3 bg-gray-50 text-center">
                                <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: b.color }} />
                                <div className="text-xl font-black text-brand-navy">{count}</div>
                                <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{b.label}</div>
                            </div>
                        );
                    })}
                </div>
                <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metrics.chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
                            <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={70} />
                            <Tooltip
                                formatter={(value: any, name: string) => [value, name === 'count' ? 'Orders' : name]}
                                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }}
                            />
                            <Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={24}>
                                {metrics.chartData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};
