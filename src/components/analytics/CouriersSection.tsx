import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    AnalyticsOrder,
    inWindow,
    isConfirmed,
    isDelivered,
    isReturned,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bike, User } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';

interface CouriersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

type CourierRow = {
    id: string;
    name: string;
    avatar_url: string | null;
    active: boolean | null;
};

type OrderRow = {
    id: string;
    date: string | null;
    courier_id: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
    package_status_label: string | null;
    tracking_number: string | null;
    package_statuses: { label?: string | null; category?: string | null } | null;
};

type CourierPaymentNote = {
    courier_id: string | null;
    total_amount: number | null;
    status: string | null;
};

export const CouriersSection = ({ businessId, dateFilter }: CouriersSectionProps) => {
    const { deliveredPkgIds, returnedPkgIds, confirmedIds } = useStatusCategories();

    const { data: couriers, isLoading: loadingCouriers } = useQuery({
        queryKey: ['analytics-couriers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, active')
                .eq('role', 'courier')
                .eq('DigiCom Business', businessId);
            return (data || []) as CourierRow[];
        },
        enabled: !!businessId,
    });

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['analytics-courier-orders-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, courier_id, order_status_id, package_status_id, package_status_label, tracking_number, package_statuses(label, category)')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null)
                .not('courier_id', 'is', null);
            return (data || []) as unknown as OrderRow[];
        },
        enabled: !!businessId,
    });

    const { data: paymentNotes } = useQuery({
        queryKey: ['analytics-courier-payment-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('courier_payment_notes')
                .select('courier_id, total_amount, status')
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

        const pendingByCourier = new Map<string, number>();
        (paymentNotes || []).forEach((n) => {
            if (!n.courier_id) return;
            if (n.status !== 'paid') {
                pendingByCourier.set(n.courier_id, (pendingByCourier.get(n.courier_id) || 0) + Number(n.total_amount || 0));
            }
        });
        const paidByCourier = new Map<string, number>();
        (paymentNotes || []).forEach((n) => {
            if (!n.courier_id) return;
            if (n.status === 'paid') {
                paidByCourier.set(n.courier_id, (paidByCourier.get(n.courier_id) || 0) + Number(n.total_amount || 0));
            }
        });

        const perCourier = couriers.map((c) => {
            const own = windowed.filter(o => o.courier_id === c.id);
            const total = own.length;
            // Locked: delivery rate = delivered ÷ confirmed (§5). Confirmed uses the
            // tracking-number short-circuit since couriers only get orders post-confirmation.
            const confirmed = own.filter(o => isConfirmed(o, confirmedIds)).length;
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
                paidLifetime: paidByCourier.get(c.id) || 0,
            };
        });

        const sorted = [...perCourier].sort((a, b) => b.delivered - a.delivered);

        const totalCouriers = couriers.length;
        const activeCouriers = couriers.filter((c) => c.active !== false).length;
        const totalShipments = windowed.length;
        const totalConfirmed = windowed.filter(o => isConfirmed(o, confirmedIds)).length;
        const totalDelivered = windowed.filter(o => isDelivered(o, deliveredPkgIds)).length;
        const overallRate = totalConfirmed > 0 ? (totalDelivered / totalConfirmed) * 100 : 0;
        const totalPending = Array.from(pendingByCourier.values()).reduce((s, v) => s + v, 0);
        const top = sorted[0];
        const bestRate = Math.max(...sorted.map((s) => s.rate), 0);

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
        };
    }, [couriers, orders, paymentNotes, dateFilter, confirmedIds, deliveredPkgIds, returnedPkgIds]);

    return (
        <SectionWrapper
            id="couriers"
            title="Couriers"
            description="In-house couriers. Delivery rate = delivered ÷ confirmed (assigned to this courier)."
            icon={Bike}
            iconColor="text-gray-400"
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
                              metrics.top ? ` ${metrics.top.name} leads with ${metrics.top.delivered} delivered (${metrics.top.rate.toFixed(0)}% rate).` : ''
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
                            { label: 'Best rate', value: `${metrics.bestRate.toFixed(1)}%`, tone: 'positive' },
                            { label: 'Pending payouts', value: `${Math.round(metrics.totalPending).toLocaleString('fr-MA')} MAD`, tone: metrics.totalPending > 0 ? 'warning' : 'neutral' },
                        ]}
                    >
                        {metrics.perCourier.length > 0 && (
                            <Card className="border border-gray-100 shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-brand-navy">Courier leaderboard</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Courier</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Shipments</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Delivered</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Returns</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Rate</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Pending</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.perCourier.map((c) => {
                                                    const tone =
                                                        c.rate >= 60 ? 'text-emerald-600' : c.rate >= 30 ? 'text-amber-600' : 'text-red-500';
                                                    return (
                                                        <tr key={c.id} className="border-b border-gray-50 hover:bg-brand-navy/[0.02] transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {c.avatar_url ? (
                                                                        <img src={c.avatar_url} alt={c.name} className="w-6 h-6 rounded-full object-cover border border-brand-navy/5 shrink-0" />
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-full bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                            <User className="w-3 h-3 text-brand-navy/20" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[11px] font-medium text-brand-navy truncate">{c.name || 'Unnamed'}</span>
                                                                    {c.active === false && (
                                                                        <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-red-400">· inactive</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] tabular-nums">{c.total}</td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-brand-navy tabular-nums">{c.delivered}</td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">{c.returned}</td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${tone}`}>
                                                                {c.rate.toFixed(1)}%
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-amber-600 tabular-nums">
                                                                {Math.round(c.pendingPayment).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
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
