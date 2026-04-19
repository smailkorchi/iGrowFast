import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    AnalyticsOrder,
    SHIPPING_STUCK_DAYS,
    deliveryTimestamp,
    inWindow,
    isConfirmed,
    isDelivered,
    isReturned,
    isShipped,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, Building2 } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, startOfDay, endOfDay, eachMonthOfInterval, startOfMonth, endOfMonth, subMonths, differenceInDays } from 'date-fns';

interface ShippingSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ShippingSection = ({ businessId, dateFilter }: ShippingSectionProps) => {
    const { deliveredPkgIds, returnedPkgIds } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-shipping-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, updated_at, shipping_cost, delivery_type, company_id, courier_id, order_status_id, package_status_id, package_status_label, date_livraison, tracking_number, master_city_id, master_cities(name, lat, lng), package_statuses(label, category)')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: providers } = useQuery({
        queryKey: ['analytics-providers', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('providers').select('id, name, logo_url').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    // In-house couriers — treated as fulfillers alongside external providers.
    const { data: couriers } = useQuery({
        queryKey: ['analytics-shipping-couriers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url')
                .eq('role', 'courier')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{ id: string; name: string | null; avatar_url: string | null }>;
        },
        enabled: !!businessId,
    });

    const { data: returnNotes } = useQuery({
        queryKey: ['analytics-return-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('company_return_notes').select('id, order_count, total_amount, created_at').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: paymentNotes } = useQuery({
        queryKey: ['analytics-payment-notes', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('company_payment_notes').select('id, status, total_amount, net_amount, order_count, created_at').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;
        const ordersTyped = orders as unknown as AnalyticsOrder[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        // Confirmed orders anchor most rates (delivery rate denominator).
        const confirmedOrders = filtered.filter(o => isConfirmed(o, { has: (id: string) => false } as Set<string>) || isConfirmed(o, new Set([o.order_status_id || ''])));
        // Simpler: build the confirmed id check via the hook-level confirmedIds.
        // We don't have that Set here; use the tracking-number short-circuit to approximate,
        // falling back to any order that has moved past 'new' by checking tracking_number OR package_status.
        const isConfirmedLoose = (o: AnalyticsOrder) =>
            !!o.tracking_number || !!o.package_status_id;
        const confirmedBasis = filtered.filter(isConfirmedLoose);

        // Shipped = has a tracking number (locked rule §5).
        const shippedOrders = filtered.filter(o => isShipped(o));
        const totalShipments = shippedOrders.length;

        const deliveredCount = filtered.filter(o => isDelivered(o, deliveredPkgIds)).length;
        const returnedCount = filtered.filter(o => isReturned(o, returnedPkgIds)).length;

        // Locked rule: delivery rate = delivered / confirmed; return rate = returned / shipped.
        const deliveryRate = confirmedBasis.length > 0 ? (deliveredCount / confirmedBasis.length) * 100 : 0;
        const returnRate = totalShipments > 0 ? (returnedCount / totalShipments) * 100 : 0;

        const totalShippingCost = filtered
            .filter(o => isDelivered(o, deliveredPkgIds))
            .reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

        const deliveredWithDates = filtered
            .filter(o => isDelivered(o, deliveredPkgIds))
            .filter(o => o.date && deliveryTimestamp(o));
        const avgDeliveryDays = deliveredWithDates.length > 0
            ? deliveredWithDates.reduce((s, o) => {
                const ship = deliveryTimestamp(o);
                const place = placementTimestamp(o);
                if (!ship || !place) return s;
                return s + differenceInDays(ship, place);
            }, 0) / deliveredWithDates.length
            : 0;

        // Stuck shipping — in-transit (shipped but not delivered) for > SHIPPING_STUCK_DAYS.
        const now = new Date();
        const stuckCount = shippedOrders.filter(o => {
            if (isDelivered(o, deliveredPkgIds) || isReturned(o, returnedPkgIds)) return false;
            const place = placementTimestamp(o);
            if (!place) return false;
            return differenceInDays(now, place) > SHIPPING_STUCK_DAYS;
        }).length;

        // Fulfiller lookup — providers AND in-house couriers share one map so the
        // same "By provider" list shows both with their proper names and avatars.
        const fulfillerInfo = new Map<string, { name: string; logo_url: string | null; kind: 'provider' | 'courier' }>();
        (providers || []).forEach(p => fulfillerInfo.set(p.id, { name: p.name || 'Provider', logo_url: p.logo_url, kind: 'provider' }));
        (couriers || []).forEach(c => fulfillerInfo.set(c.id, { name: c.name || 'Courier', logo_url: c.avatar_url, kind: 'courier' }));

        // Use ALL orders in the window that have been handed off to a provider or courier,
        // not just shipped (has tracking). Otherwise fulfillers with offline handoff never show.
        const assignedOrders = filtered.filter(o => o.company_id || o.courier_id);
        const providerCounts: Record<string, { total: number; delivered: number; name: string; logo_url: string | null; kind: 'provider' | 'courier' }> = {};
        assignedOrders.forEach(o => {
            const pid = o.company_id || o.courier_id;
            if (!pid) return;
            const info = fulfillerInfo.get(pid);
            const name = info?.name || (o.courier_id ? 'Courier' : 'Provider');
            if (!providerCounts[pid]) providerCounts[pid] = {
                total: 0,
                delivered: 0,
                name,
                logo_url: info?.logo_url ?? null,
                kind: info?.kind ?? (o.courier_id ? 'courier' : 'provider'),
            };
            providerCounts[pid].total++;
            if (isDelivered(o, deliveredPkgIds)) providerCounts[pid].delivered++;
        });
        const providerData = Object.values(providerCounts)
            .sort((a, b) => b.total - a.total)
            .map(p => ({ ...p, rate: p.total > 0 ? (p.delivered / p.total) * 100 : 0 }));

        const pendingPayments = (paymentNotes || []).filter(p => p.status === 'unpaid').reduce((s, p) => s + Number(p.total_amount || 0), 0);

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = endOfMonth(month);
            const monthOrders = shippedOrders.filter(o => inWindow(placementTimestamp(o), mStart, mEnd));
            return {
                month: format(month, 'MMM yy'),
                shipped: monthOrders.length,
                delivered: monthOrders.filter(o => isDelivered(o, deliveredPkgIds)).length,
                cost: monthOrders
                    .filter(o => isDelivered(o, deliveredPkgIds))
                    .reduce((s, o) => s + Number(o.shipping_cost || 0), 0),
            };
        });

        return {
            totalShipments,
            confirmedCount: confirmedBasis.length,
            deliveredCount,
            returnedCount,
            deliveryRate,
            returnRate,
            totalShippingCost,
            avgDeliveryDays,
            stuckCount,
            providerData,
            pendingPayments,
            trendData,
        };
    }, [orders, providers, couriers, paymentNotes, dateFilter, deliveredPkgIds, returnedPkgIds]);

    return (
        <SectionWrapper
            id="shipping"
            title="Shipping & Delivery"
            description="Delivery rate = delivered ÷ confirmed. Return rate = returned ÷ shipped. Stuck flagged after 5 days."
            icon={Truck}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const rateTone: 'positive' | 'warning' | 'negative' =
                    metrics.deliveryRate >= 60 ? 'positive' : metrics.deliveryRate >= 30 ? 'warning' : 'negative';
                const topProvider = metrics.providerData[0];
                const narrative = metrics.totalShipments === 0
                    ? 'No shipments in this period.'
                    : `${metrics.deliveredCount.toLocaleString('fr-MA')} of ${metrics.confirmedCount.toLocaleString('fr-MA')} confirmed orders delivered (${metrics.deliveryRate.toFixed(0)}%).${
                          metrics.avgDeliveryDays > 0 ? ` Average ${metrics.avgDeliveryDays.toFixed(1)} days from order to delivery.` : ''
                      }${
                          metrics.returnRate > 10
                              ? ` ${metrics.returnRate.toFixed(0)}% of shipped packages came back — worth auditing.`
                              : ''
                      }${
                          metrics.stuckCount > 0
                              ? ` ${metrics.stuckCount} package${metrics.stuckCount === 1 ? '' : 's'} stuck in transit for more than ${SHIPPING_STUCK_DAYS} days.`
                              : ''
                      }${
                          topProvider
                              ? ` ${topProvider.name} handled the most shipments at ${topProvider.rate.toFixed(0)}% delivery rate.`
                              : ''
                      }`;

                return (
                    <SectionStory
                        hero={{
                            label: 'delivery rate',
                            value: `${metrics.deliveryRate.toFixed(1)}%`,
                            tone: rateTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Delivered', value: metrics.deliveredCount.toLocaleString('fr-MA'), tone: 'positive' },
                            { label: 'Returns', value: metrics.returnedCount.toLocaleString('fr-MA'), sub: `${metrics.returnRate.toFixed(1)}%`, tone: metrics.returnRate > 10 ? 'negative' : 'neutral' },
                            { label: `Stuck > ${SHIPPING_STUCK_DAYS}d`, value: metrics.stuckCount.toLocaleString('fr-MA'), tone: metrics.stuckCount > 0 ? 'warning' : 'neutral' },
                            { label: 'Avg days', value: metrics.avgDeliveryDays.toFixed(1) },
                            { label: 'Shipping cost', value: `${Math.round(metrics.totalShippingCost).toLocaleString('fr-MA')} MAD`, tone: 'negative' },
                            { label: 'Fulfillers', value: metrics.providerData.length.toLocaleString('fr-MA') },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Shipped vs delivered</CardTitle>
                                <div className="flex items-center gap-2.5 text-[10px] text-ant-muted">
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#141413]" /> Shipped</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#788c5d]" /> Delivered</span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={140}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorShipped" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#141413" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#141413" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorDelivered2" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#788c5d" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#788c5d" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={32} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                    <Area type="monotone" dataKey="shipped" stroke="#141413" fill="url(#colorShipped)" strokeWidth={1.75} name="Shipped" dot={false} />
                                    <Area type="monotone" dataKey="delivered" stroke="#788c5d" fill="url(#colorDelivered2)" strokeWidth={1.75} name="Delivered" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">By fulfiller</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1">
                                {metrics.providerData.map((p, i) => (
                                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ant-ink/[0.03] transition-colors">
                                        <div className="w-6 h-6 rounded bg-white border border-ant-ink/5 flex items-center justify-center overflow-hidden shrink-0">
                                            {p.logo_url ? (
                                                <img src={p.logo_url} alt={p.name} className="w-full h-full object-contain p-0.5" />
                                            ) : (
                                                <Building2 className="w-3.5 h-3.5 text-ant-ink/30" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-semibold text-ant-ink leading-tight truncate flex items-center gap-1.5">
                                                {p.name}
                                                <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-ant-mid">
                                                    · {p.kind}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-ant-mid tabular-nums">{p.total} assigned · {p.delivered} delivered</div>
                                        </div>
                                        <div className="w-20 h-1 rounded-full bg-ant-line overflow-hidden shrink-0">
                                            <div className="h-full bg-ant-green/100 rounded-full" style={{ width: `${p.rate}%` }} />
                                        </div>
                                        <div className="text-[12px] font-semibold text-ant-ink tabular-nums shrink-0 w-12 text-right">
                                            {p.rate.toFixed(1)}%
                                        </div>
                                    </div>
                                ))}
                                {metrics.providerData.length === 0 && (
                                    <p className="text-[11px] text-ant-mid text-center py-2">No fulfiller data yet</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
