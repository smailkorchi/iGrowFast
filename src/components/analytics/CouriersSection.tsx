import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import {
    AnalyticsOrder,
    inWindow,
    isAdminPullback,
    isDelivered,
    isReturned,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bike } from 'lucide-react';
import { UserAvatar } from '@/components/users/UserAvatar';
import { startOfDay, endOfDay } from 'date-fns';

interface CouriersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

type CourierRow = {
    id: string;
    name: string;
    avatar_url: string | null;
    avatar_config?: unknown;
    active: boolean | null;
};

type OrderRow = {
    id: string;
    date: string | null;
    courier_id: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
    package_statuses: { label?: string | null } | null;
};

type CourierPaymentNote = {
    courier_id: string | null;
    total_shipping_fees: number | null;
    status: string | null;
};

export const CouriersSection = ({ businessId, dateFilter }: CouriersSectionProps) => {
    const { deliveredPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

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

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['analytics-courier-orders-v2', businessId],
        queryFn: async () => {
            return (await fetchAllRows(
                'orders',
                'id, date, courier_id, order_status_id, package_status_id, package_statuses(label)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                    orFilter: 'courier_id.not.is.null',
                },
            )) as unknown as OrderRow[];
        },
        enabled: !!businessId,
    });

    const { data: paymentNotes } = useQuery({
        queryKey: ['analytics-courier-payment-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('courier_payment_notes')
                .select('courier_id, total_shipping_fees, status')
                .eq('DigiCom Business', businessId);
            return (data || []) as CourierPaymentNote[];
        },
        enabled: !!businessId,
    });

    const isLoading = loadingCouriers || loadingOrders;

    const metrics = useMemo(() => {
        if (!couriers || !orders) return null;

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const windowed = (orders as unknown as AnalyticsOrder[])
            .filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        // "Pending" is a current balance (not period-scoped): sum every
        // unpaid courier_payment_note.total_shipping_fees, lifetime. All
        // other metrics on this card are window-scoped by placement date.
        // `paidByCourier` was also built here but never rendered — dropped.
        const pendingByCourier = new Map<string, number>();
        (paymentNotes || []).forEach((n) => {
            if (!n.courier_id) return;
            if (n.status !== 'paid') {
                pendingByCourier.set(n.courier_id, (pendingByCourier.get(n.courier_id) || 0) + Number(n.total_shipping_fees || 0));
            }
        });

        const perCourier = couriers.map((c) => {
            const own = windowed.filter(o => o.courier_id === c.id);
            const total = own.length;
            // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
            const tracked = own.filter(o => !!o.id && trackedOrderIds.has(o.id));
            const pullback = tracked.filter(o =>
                isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
            );
            const confirmed = tracked.length - pullback.length;
            const delivered = own.filter(o => isDelivered(o, deliveredPkgIds)).length;
            const returned = own.filter(o => isReturned(o, returnedPkgIds)).length;
            const rate = confirmed > 0 ? (delivered / confirmed) * 100 : 0;
            return {
                ...c,
                total,
                confirmed,
                delivered,
                returned,
                rate,
                pendingPayment: pendingByCourier.get(c.id) || 0,
            };
        });

        const sorted = [...perCourier].sort((a, b) => b.delivered - a.delivered);

        const totalCouriers = couriers.length;
        const activeCouriers = couriers.filter((c) => c.active !== false).length;
        const totalShipments = windowed.length;
        // Overall delivery-rate denominator = windowed tracked orders minus admin pullbacks.
        const windowTracked = windowed.filter(o => !!o.id && trackedOrderIds.has(o.id));
        const windowPullback = windowTracked.filter(o =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const totalConfirmed = windowTracked.length - windowPullback.length;
        const totalDelivered = windowed.filter(o => isDelivered(o, deliveredPkgIds)).length;
        const overallRate = totalConfirmed > 0 ? (totalDelivered / totalConfirmed) * 100 : 0;
        const totalPending = Array.from(pendingByCourier.values()).reduce((s, v) => s + v, 0);
        const top = sorted[0];
        // Gate "Best rate" by minimum shipment count so a courier with one
        // lucky delivery can't claim 100 % and outrank a high-volume courier.
        // Low-sample case falls back to the raw max with a flag in the tile.
        const BEST_RATE_MIN_SHIPMENTS = 3;
        const qualifiers = sorted.filter((s) => s.total >= BEST_RATE_MIN_SHIPMENTS);
        const bestRate = qualifiers.length > 0
            ? Math.max(...qualifiers.map((s) => s.rate), 0)
            : Math.max(...sorted.map((s) => s.rate), 0);
        const bestRateLowSample = qualifiers.length === 0 && sorted.length > 0;

        return {
            perCourier: sorted,
            totalCouriers,
            activeCouriers,
            totalShipments,
            totalConfirmed,
            totalDelivered,
            overallRate,
            totalPending,
            top,
            bestRate,
            bestRateLowSample,
            bestRateMinShipments: BEST_RATE_MIN_SHIPMENTS,
        };
    }, [couriers, orders, paymentNotes, dateFilter, deliveredPkgIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds]);

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
