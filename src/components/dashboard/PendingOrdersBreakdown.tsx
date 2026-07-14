import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle, Hourglass, CalendarClock } from 'lucide-react';
import { StackedProportionBar } from './performance/StackedProportionBar';

/**
 * `pending_breakdown` section of admin_dashboard_stats (D2). Pool = pending
 * (pending_confirmation flag, no tracking code) with the old null-dates-pass
 * window rule; age buckets measured against NOW server-side.
 */
export interface PendingBreakdownSection {
    total: number;
    total_value: number;
    buckets: {
        today: { count: number; value: number };
        d1_3: { count: number; value: number };
        d4_7: { count: number; value: number };
        d7_plus: { count: number; value: number };
    };
}

interface PendingOrdersBreakdownProps {
    stats: PendingBreakdownSection | undefined;
}

// Mutually exclusive age buckets. Labels match the RPC branch logic exactly so
// no silent overlap between "1-3" and "4-7" at day 3.
const BUCKETS = [
    { key: 'today', label: 'Today', color: '#788c5d', icon: Clock },
    { key: 'd1_3', label: '1–3 days', color: '#d1bfa3', icon: Hourglass },
    { key: 'd4_7', label: '4–7 days', color: '#d97757', icon: CalendarClock },
    { key: 'd7_plus', label: '7+ days', color: '#c96356', icon: AlertTriangle },
] as const;

export const PendingOrdersBreakdown = ({ stats }: PendingOrdersBreakdownProps) => {
    if (!stats) return null;

    const bucketStats = BUCKETS.map((b) => ({ ...b, ...stats.buckets[b.key] }));
    // Stale = pending longer than the "1–3d" cutoff; the 4–7d and 7+d buckets
    // both count as stale.
    const staleCount = stats.buckets.d4_7.count + stats.buckets.d7_plus.count;

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
                        {stats.total.toLocaleString('fr-MA')} awaiting · {Math.round(stats.total_value).toLocaleString('fr-MA')} MAD
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {stats.total === 0 ? (
                    <p className="font-serif-display text-[12px] text-ant-muted italic py-8 text-center">
                        No pending orders in this period
                    </p>
                ) : (
                    <>
                        <StackedProportionBar
                            segments={bucketStats.map((b) => ({
                                id: b.key,
                                label: b.label,
                                count: b.count,
                                color: b.color,
                            }))}
                            total={stats.total}
                            height={6}
                        />

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {bucketStats.map((b) => {
                                const pct = stats.total > 0 ? (b.count / stats.total) * 100 : 0;
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
                                                b.key === 'd7_plus' && b.count > 0 ? 'text-ant-rose' : 'text-ant-ink',
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

                        {staleCount > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-ant-rose/[0.06] border border-ant-rose/25">
                                <AlertTriangle className="w-3.5 h-3.5 text-ant-rose shrink-0" strokeWidth={2.25} />
                                <span className="text-[11px] text-ant-rose font-medium">
                                    {staleCount.toLocaleString('fr-MA')} orders pending 4+ days — action required
                                </span>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};
