import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneCall } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface ConfirmationPipelineProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ConfirmationPipeline = ({ businessId, dateFilter }: ConfirmationPipelineProps) => {
    const { pendingIds, getOrderStatusColor } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders } = useQuery({
        queryKey: ['confirmation-pipeline-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, order_status_id, tracking_number, order_statuses(code, label)')
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

        type OrderRow = {
            id?: string | null;
            order_status_id?: string | null;
            date?: string | null;
            tracking_number?: string | null;
            order_statuses?: { label?: string | null; code?: string | null } | null;
        };
        // Pipeline = orders whose status has `pending_confirmation=true` (NEW +
        // RAPPELE 1-6 + REPORTER) AND no tracking code yet. The previous version
        // also lumped in every callback variant (Boitevocale, Pas de réponse,
        // Mauvais numéro, …), which the product owner does not consider pending
        // — those CSR interactions are already resolved.
        const confirmationOrders = orders.filter((o: OrderRow) => {
            if (o.id && trackedOrderIds.has(o.id)) return false;
            return !!o.order_status_id
                && pendingIds.has(o.order_status_id)
                && isInRange(o.date);
        });

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
    }, [orders, dateFilter, pendingIds, getOrderStatusColor, trackedOrderIds]);

    if (!metrics) return null;

    const topThree = metrics.sorted.slice(0, 3);

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Confirmation pipeline
                        </CardTitle>
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                        {metrics.total.toLocaleString('fr-MA')} being confirmed
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                <div className="space-y-2">
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {topThree.map((s) => {
                            const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                            return (
                                <span key={s.code} className="inline-flex items-center gap-1 text-[10px]">
                                    <PhoneCall className="hidden" />
                                    <span
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{ backgroundColor: s.color }}
                                    />
                                    <span className="text-ant-ink truncate max-w-[110px]">{s.label}</span>
                                    <span className="text-ant-mid tabular-nums">
                                        {pct.toFixed(0)}%
                                    </span>
                                </span>
                            );
                        })}
                        {metrics.sorted.length > 3 && (
                            <span className="text-[10px] text-ant-mid">+{metrics.sorted.length - 3} more</span>
                        )}
                    </div>
                </div>

                <div className="h-px bg-ant-line" />

                <div className="space-y-0 max-h-[200px] overflow-y-auto pr-1 ant-scroll">
                    {metrics.sorted.length === 0 ? (
                        <p className="font-serif-display text-[11px] text-ant-muted italic py-2 text-center">
                            No orders awaiting confirmation in this period
                        </p>
                    ) : (
                        metrics.sorted.map((s) => {
                            const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                            return (
                                <div
                                    key={s.code}
                                    className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-ant-line-soft transition-colors"
                                >
                                    <span
                                        className="w-[3px] h-3.5 rounded-full shrink-0"
                                        style={{ backgroundColor: s.color }}
                                        aria-hidden
                                    />
                                    <span className="text-[11px] font-medium text-ant-ink flex-1 min-w-0 truncate">
                                        {s.label}
                                    </span>
                                    <div className="w-20 h-[3px] rounded-full bg-ant-line overflow-hidden shrink-0">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.min(100, pct)}%`,
                                                backgroundColor: s.color,
                                            }}
                                        />
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-ink tabular-nums w-8 text-right shrink-0">
                                        {s.count}
                                    </span>
                                    <span className="text-[10px] text-ant-mid tabular-nums w-10 text-right shrink-0">
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
