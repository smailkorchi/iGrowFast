import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bike } from 'lucide-react';
import { UserAvatar } from '@/components/users/UserAvatar';

/**
 * `couriers` section of admin_analytics_stats (D3). Every aggregate is
 * server-side: the courier-assigned order pool (placement-windowed in
 * Casablanca, replace legs KEPT), tracked/pullback counts, delivered/returned
 * counts and the lifetime pending-payout balance (Σ total_shipping_fees where
 * status <> 'paid'). Rows arrive sorted delivered desc.
 *
 * Client keeps only presentation: courier names/avatars (support query below —
 * the RPC rows carry ids), the unclamped rate arithmetic derived from the
 * server's delivered/denom columns, and the best-rate sample gate.
 */
export interface CouriersSlice {
    total_couriers: number;
    active_couriers: number;
    total_shipments: number;
    /** Overall delivery-rate denominator = windowed tracked − admin pullbacks. */
    overall_denom: number;
    total_delivered: number;
    overall_rate: number;
    total_pending: number;
    couriers: Array<{
        courier_id: string;
        total: number;
        tracked: number;
        pullback: number;
        denom: number;
        delivered: number;
        returned: number;
        pending: number;
    }>;
}

interface CouriersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: CouriersSlice | null;
}

type CourierRow = {
    id: string;
    name: string;
    avatar_url: string | null;
    avatar_config?: unknown;
    active: boolean | null;
};

export const CouriersSection = ({ businessId, stats }: CouriersSectionProps) => {
    // Names/avatars only — every aggregate rides the RPC section.
    const { data: couriers, isLoading: loadingCouriers } = useQuery({
        queryKey: ['analytics-couriers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, avatar_config, active')
                .eq('role', 'courier')
                .eq('DigiCom Business', businessId);
            return (data || []) as CourierRow[];
        },
        enabled: !!businessId,
    });

    const isLoading = loadingCouriers || !stats;

    const metrics = useMemo(() => {
        if (!couriers || !stats) return null;

        const metaById = new Map(couriers.map((c) => [c.id, c]));

        // Rows are already sorted delivered desc by the RPC.
        // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
        // Unclamped — parity with the old client math (no least(100, …)).
        const perCourier = stats.couriers.map((row) => {
            const meta = metaById.get(row.courier_id);
            return {
                id: row.courier_id,
                name: meta?.name || 'Unnamed',
                avatar_url: meta?.avatar_url ?? null,
                avatar_config: meta?.avatar_config ?? null,
                active: meta?.active ?? null,
                total: row.total,
                confirmed: row.denom,
                delivered: row.delivered,
                returned: row.returned,
                rate: row.denom > 0 ? (row.delivered / row.denom) * 100 : 0,
                pendingPayment: row.pending,
            };
        });

        const top = perCourier[0];
        // Gate "Best rate" by minimum shipment count so a courier with one
        // lucky delivery can't claim 100 % and outrank a high-volume courier.
        // Low-sample case falls back to the raw max with a flag in the tile.
        const BEST_RATE_MIN_SHIPMENTS = 3;
        const qualifiers = perCourier.filter((s) => s.total >= BEST_RATE_MIN_SHIPMENTS);
        const bestRate = qualifiers.length > 0
            ? Math.max(...qualifiers.map((s) => s.rate), 0)
            : Math.max(...perCourier.map((s) => s.rate), 0);
        const bestRateLowSample = qualifiers.length === 0 && perCourier.length > 0;

        return {
            perCourier,
            totalCouriers: stats.total_couriers,
            activeCouriers: stats.active_couriers,
            totalShipments: stats.total_shipments,
            totalConfirmed: stats.overall_denom,
            totalDelivered: stats.total_delivered,
            overallRate: stats.overall_rate,
            totalPending: stats.total_pending,
            top,
            bestRate,
            bestRateLowSample,
            bestRateMinShipments: BEST_RATE_MIN_SHIPMENTS,
        };
    }, [couriers, stats]);

    return (
        <SectionWrapper
            id="couriers"
            title="Couriers"
            description="In-house couriers. Delivery rate = delivered ÷ (tracked − admin pullbacks), per courier."
            icon={Bike}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const rateTone: 'positive' | 'warning' | 'negative' =
                    metrics.overallRate >= 70 ? 'positive' : metrics.overallRate >= 40 ? 'warning' : 'negative';
                const narrative = metrics.totalCouriers === 0
                    ? 'No couriers on the team yet.'
                    : metrics.totalShipments === 0
                        ? `${metrics.activeCouriers} courier${metrics.activeCouriers === 1 ? '' : 's'} on roster, but no shipments handled in this period.`
                        : `${metrics.totalDelivered.toLocaleString('fr-MA')} of ${metrics.totalShipments.toLocaleString('fr-MA')} shipments delivered across ${metrics.activeCouriers} active courier${metrics.activeCouriers === 1 ? '' : 's'}.${
                              metrics.top ? ` ${metrics.top.name} leads with ${metrics.top.delivered} delivered (${metrics.top.rate.toFixed(1)}% rate).` : ''
                          }${metrics.totalPending > 0 ? ` ${Math.round(metrics.totalPending).toLocaleString('fr-MA')} MAD pending in payouts.` : ''}`;

                return (
                    <SectionStory
                        hero={{
                            label: 'overall delivery rate',
                            value: `${metrics.overallRate.toFixed(1)}%`,
                            tone: rateTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Couriers', value: metrics.totalCouriers.toLocaleString('fr-MA'), sub: `${metrics.activeCouriers} active` },
                            { label: 'Shipments', value: metrics.totalShipments.toLocaleString('fr-MA') },
                            { label: 'Delivered', value: metrics.totalDelivered.toLocaleString('fr-MA'), tone: 'positive' },
                            {
                                label: 'Best rate',
                                value: `${metrics.bestRate.toFixed(1)}%`,
                                tone: 'positive',
                                ...(metrics.bestRateLowSample
                                    ? { sub: `low sample (<${metrics.bestRateMinShipments} shipments)` }
                                    : {}),
                            },
                            { label: 'Pending payouts', value: `${Math.round(metrics.totalPending).toLocaleString('fr-MA')} MAD`, tone: metrics.totalPending > 0 ? 'warning' : 'neutral' },
                        ]}
                    >
                        {metrics.perCourier.length > 0 && (
                            <Card className="border border-ant-line shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-ant-ink">Courier leaderboard</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-ant-line">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Courier</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Shipments</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Delivered</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Returns</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Rate</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Pending</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.perCourier.map((c) => {
                                                    const tone =
                                                        c.rate >= 60 ? 'text-ant-green' : c.rate >= 30 ? 'text-ant-orange' : 'text-ant-rose';
                                                    return (
                                                        <tr key={c.id} className="border-b border-ant-line hover:bg-ant-ink/[0.02] transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    <UserAvatar url={c.avatar_url} config={(c as any).avatar_config} name={c.name} className="w-6 h-6 rounded-full border border-ant-ink/5" />
                                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{c.name || 'Unnamed'}</span>
                                                                    {c.active === false && (
                                                                        <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-ant-rose">· inactive</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] tabular-nums">{c.total}</td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{c.delivered}</td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">{c.returned}</td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${tone}`}>
                                                                {c.rate.toFixed(1)}%
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-orange tabular-nums">
                                                                {Math.round(c.pendingPayment).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
