import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle, Hourglass, CalendarClock } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { differenceInDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { PENDING_STALE_DAYS } from '@/lib/analyticsDefinitions';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface PendingOrdersBreakdownProps {
    businessId: string;
    dateFilter: DateFilter;
}

// Mutually exclusive age buckets. Labels match the branch logic exactly so no
// silent overlap between "1-3" and "4-7" at day 3.
const BUCKETS = [
    { key: 'today', label: 'Today', color: '#788c5d', icon: Clock },
    { key: '1-3d', label: '1–3 days', color: '#d1bfa3', icon: Hourglass },
    { key: '4-7d', label: '4–7 days', color: '#d97757', icon: CalendarClock },
    { key: '7+d', label: '7+ days', color: '#c96356', icon: AlertTriangle },
] as const;

export const PendingOrdersBreakdown = ({ businessId, dateFilter }: PendingOrdersBreakdownProps) => {
    const { pendingIds, callbackIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders } = useQuery({
        queryKey: ['pending-orders-breakdown-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, created_at, price, order_status_id, tracking_number')
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

        type POBOrder = {
            id: string;
            order_status_id: string | null;
            date: string | null;
            price: number | null;
            created_at?: string | null;
            tracking_number?: string | null;
        };
        const isPendingStatus = (id: string | null) =>
            !!id && (pendingIds.has(id) || callbackIds.has(id));
        // Tracking code (company_parcels / courier_parcels) overrides
        // everything: once a parcel is handed to a courier, the order is
        // confirmed regardless of status and must leave the pending queue.
        const pending = (orders as unknown as POBOrder[]).filter((o) => {
            if (o.id && trackedOrderIds.has(o.id)) return false;
            return isPendingStatus(o.order_status_id) && isInRange(o.date);
        });

        const startOfNow = startOfDay(new Date());
        const buckets: Record<string, POBOrder[]> = { today: [], '1-3d': [], '4-7d': [], '7+d': [] };

        pending.forEach((o) => {
            const raw = o.date || o.created_at;
            if (!raw) return;
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) return;
            const age = differenceInDays(startOfNow, startOfDay(d));
            if (age <= 0) buckets.today.push(o);
            else if (age <= 3) buckets['1-3d'].push(o);
            else if (age <= 7) buckets['4-7d'].push(o);
            else buckets['7+d'].push(o);
        });

        const totalValue = pending.reduce((s, o) => s + Number(o.price || 0), 0);
        // Stale = pending longer than PENDING_STALE_DAYS. The "1–3d" bucket is the cutoff;
        // anything beyond sits in the 4–7d or 7+d buckets which both count as stale.
        void PENDING_STALE_DAYS;
        const staleCount = buckets['4-7d'].length + buckets['7+d'].length;

        const bucketStats = BUCKETS.map((b) => {
            const rows = buckets[b.key];
            const count = rows.length;
            const value = rows.reduce((s, o) => s + Number(o.price || 0), 0);
            return { ...b, count, value };
        });

        return { total: pending.length, totalValue, staleCount, bucketStats };
    }, [orders, dateFilter, pendingIds, callbackIds, trackedOrderIds]);

    if (!metrics) return null;

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Pending orders
                        </CardTitle>
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                        {metrics.total.toLocaleString('fr-MA')} awaiting · {Math.round(metrics.totalValue).toLocaleString('fr-MA')} MAD
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {metrics.total === 0 ? (
                    <p className="font-serif-display text-[12px] text-ant-muted italic py-8 text-center">
                        No pending orders in this period
                    </p>
                ) : (
                    <>
                        <StackedProportionBar
                            segments={metrics.bucketStats.map((b) => ({
                                id: b.key,
                                label: b.label,
                                count: b.count,
                                color: b.color,
                            }))}
                            total={metrics.total}
                            height={6}
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {metrics.bucketStats.map((b) => {
                                const pct = metrics.total > 0 ? (b.count / metrics.total) * 100 : 0;
                                const Icon = b.icon;
                                return (
                                    <div
                                        key={b.key}
                                        className="rounded-lg px-3 py-2.5 border border-ant-line transition-colors hover:border-ant-ink/15"
                                    >
                                        <div className="flex items-center justify-between gap-1.5">
                                            <div className="flex items-center gap-1 min-w-0">
                                                <Icon
                                                    className="w-2.5 h-2.5 shrink-0"
                                                    style={{ color: b.color }}
                                                    strokeWidth={2.25}
                                                />
                                                <span className="text-[9.5px] uppercase tracking-[0.16em] font-medium text-ant-mid truncate">
                                                    {b.label}
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-semibold tabular-nums text-ant-mid">
                                                {pct.toFixed(0)}%
                                            </span>
                                        </div>
                                        <div
                                            className={cn(
                                                'font-display text-[20px] font-semibold tabular-nums mt-1 leading-none tracking-[-0.02em]',
                                                b.key === '7+d' && b.count > 0 ? 'text-ant-rose' : 'text-ant-ink',
                                            )}
                                        >
                                            {b.count.toLocaleString('fr-MA')}
                                        </div>
                                        <div className="text-[10px] text-ant-muted mt-1 tabular-nums">
                                            {Math.round(b.value).toLocaleString('fr-MA')} MAD
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {metrics.staleCount > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-ant-rose/[0.06] border border-ant-rose/25">
                                <AlertTriangle className="w-3.5 h-3.5 text-ant-rose shrink-0" strokeWidth={2.25} />
                                <span className="text-[11px] text-ant-rose font-medium">
                                    {metrics.staleCount.toLocaleString('fr-MA')} orders pending 4+ days — action required
                                </span>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};
