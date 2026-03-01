import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PhoneCall } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface ConfirmationPipelineProps {
    businessId: string;
    dateFilter: DateFilter;
}

const COLORS = [
    '#3b5e5e', '#7a9385', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#a855f7', '#e11d48',
];

const CONFIRMATION_CODES = new Set([
    'NEW', 'INTERESTED', 'RAPPEL 1', 'RAPPEL2', 'RAPPEL3', 'RAPPEL',
    'RAPPEL 5', 'RAPPEL 6', 'Boitevocale', 'Rappel + msg wtsp',
    'Boite vocale + msg wtsp', 'Pasdereponse', 'PASDEREPONSE + Sms',
    'PASDEREPONSE + Messagewhatsup', 'RECHECK',
]);

export const ConfirmationPipeline = ({ businessId, dateFilter }: ConfirmationPipelineProps) => {
    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, order_status_id, package_status_id, package_status_label, seller_id, company_id, order_statuses(code, label)')
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

        const confirmationOrders = orders.filter((o: any) => {
            const code = (o.order_statuses as any)?.code;
            return code && CONFIRMATION_CODES.has(code) && isInRange(o.date);
        });

        const statusCounts: Record<string, { label: string; count: number }> = {};
        confirmationOrders.forEach((o: any) => {
            const status = o.order_statuses as any;
            const label = status?.label || status?.code || 'Unknown';
            const code = status?.code || 'unknown';
            if (!statusCounts[code]) statusCounts[code] = { label, count: 0 };
            statusCounts[code].count++;
        });

        const sorted = Object.entries(statusCounts)
            .map(([code, { label, count }]) => ({ code, label, count }))
            .sort((a, b) => b.count - a.count);

        const total = confirmationOrders.length;

        return { total, sorted };
    }, [orders, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center">
                        <PhoneCall className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Confirmation Pipeline</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.total} orders being confirmed</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={metrics.sorted}
                                    dataKey="count"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    innerRadius={55}
                                    paddingAngle={2}
                                >
                                    {metrics.sorted.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: any, name: string) => [`${value} orders`, name]}
                                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                        {metrics.sorted.map((s, i) => (
                            <div key={s.code} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                    <span className="text-xs font-medium text-brand-navy truncate max-w-[140px]">{s.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-black text-brand-navy">{s.count}</span>
                                    <span className="text-[10px] text-gray-400 font-bold w-10 text-right">
                                        {metrics.total > 0 ? ((s.count / metrics.total) * 100).toFixed(0) : 0}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
