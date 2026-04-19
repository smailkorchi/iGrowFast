import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneCall } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface ConfirmationPipelineProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ConfirmationPipeline = ({ businessId, dateFilter }: ConfirmationPipelineProps) => {
    const { pendingIds, callbackIds, getOrderStatusColor } = useStatusCategories();

    const { data: orders } = useQuery({
        queryKey: ['confirmation-pipeline-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, order_status_id, order_statuses(code, label)')
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

        const isConfirmationStatus = (statusId: string) =>
            statusId && (pendingIds.has(statusId) || callbackIds.has(statusId));

        type OrderRow = {
            order_status_id?: string | null;
            date?: string | null;
            order_statuses?: { label?: string | null; code?: string | null } | null;
        };
        const confirmationOrders = orders.filter(
            (o: OrderRow) =>
                o.order_status_id && isConfirmationStatus(o.order_status_id) && isInRange(o.date),
        );

        const statusCounts: Record<string, { label: string; count: number }> = {};
        confirmationOrders.forEach((o: OrderRow) => {
            const status = o.order_statuses;
            const label = status?.label || status?.code || 'Unknown';
            const id = o.order_status_id || 'unknown';
            if (!statusCounts[id]) statusCounts[id] = { label, count: 0 };
            statusCounts[id].count += 1;
        });

        const sorted = Object.entries(statusCounts)
            .map(([id, { label, count }]) => ({
                code: id,
                label,
                count,
                color: id === 'unknown' ? '#9ca3af' : getOrderStatusColor(id),
            }))
            .sort((a, b) => b.count - a.count);

        return { total: confirmationOrders.length, sorted };
    }, [orders, dateFilter, pendingIds, callbackIds, getOrderStatusColor]);

    if (!metrics) return null;

    const topThree = metrics.sorted.slice(0, 3);

    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardHeader className="px-3.5 pt-2.5 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <PhoneCall className="w-3 h-3 text-gray-400" />
                        <CardTitle className="text-[12px] font-semibold text-brand-navy">
                            Confirmation pipeline
                        </CardTitle>
                    </div>
                    <span className="text-[9px] text-gray-400 uppercase tracking-[0.14em] tabular-nums">
                        {metrics.total.toLocaleString('fr-MA')} being confirmed
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-3.5 pb-3 pt-0 space-y-2.5">
                <div className="space-y-1.5">
                    <StackedProportionBar
                        segments={metrics.sorted.map((s) => ({
                            id: s.code,
                            label: s.label,
                            count: s.count,
                            color: s.color,
                        }))}
                        total={metrics.total}
                        height={6}
                    />
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        {topThree.map((s) => {
                            const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                            return (
                                <span key={s.code} className="inline-flex items-center gap-1 text-[9px]">
                                    <span
                                        className="w-1 h-1 rounded-full"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    <span className="text-gray-600 truncate max-w-[110px]">{s.label}</span>
                                    <span className="text-gray-400 tabular-nums">
                                        {pct.toFixed(0)}%
                                    </span>
                                </span>
                            );
                        })}
                        {metrics.sorted.length > 3 && (
                            <span className="text-[9px] text-gray-400">+{metrics.sorted.length - 3} more</span>
                        )}
                    </div>
                </div>

                <div className="h-px bg-gray-100" />

                <div className="space-y-0 max-h-[180px] overflow-y-auto pr-0.5 -mr-0.5">
                    {metrics.sorted.length === 0 ? (
                        <p className="text-[10px] text-gray-400 italic py-2 text-center">
                            No orders awaiting confirmation in this period
                        </p>
                    ) : (
                        metrics.sorted.map((s) => {
                            const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                            return (
                                <div
                                    key={s.code}
                                    className="flex items-center gap-1.5 py-1 px-1.5 rounded-md hover:bg-gray-50/60 transition-colors"
                                >
                                    <span
                                        className="w-[3px] h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: s.color }}
                                        aria-hidden
                                    />
                                    <span className="text-[10px] font-medium text-gray-700 flex-1 min-w-0 truncate">
                                        {s.label}
                                    </span>
                                    <div className="w-16 h-[3px] rounded-full bg-gray-100 overflow-hidden shrink-0">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.min(100, pct)}%`,
                                                backgroundColor: s.color,
                                            }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-semibold text-brand-navy tabular-nums w-7 text-right shrink-0">
                                        {s.count}
                                    </span>
                                    <span className="text-[9px] text-gray-400 tabular-nums w-8 text-right shrink-0">
                                        {pct.toFixed(1)}%
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
