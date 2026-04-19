import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Truck, Building2, Bike } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface ShippingPipelineProps {
    businessId: string;
    dateFilter: DateFilter;
}

const COLOR_DELIVERED = '#10b981';
const COLOR_RETURNED = '#ef4444';
const COLOR_IN_TRANSIT = '#6366f1';

export const ShippingPipeline = ({ businessId, dateFilter }: ShippingPipelineProps) => {
    const { getPkgStatusColor, shippedPkgIds, deliveredPkgIds, returnedPkgIds } = useStatusCategories();

    const { data: orders } = useQuery({
        queryKey: ['shipping-pipeline-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, package_status_id, package_status_label, company_id, courier_id')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: providers } = useQuery({
        queryKey: ['dashboard-providers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('providers')
                .select('id, name, logo_url')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    // In-house couriers (users with role='courier'). Separate fulfillment channel
    // from external providers — previously invisible in this card.
    const { data: couriers } = useQuery({
        queryKey: ['dashboard-couriers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url')
                .eq('role', 'courier')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders || !providers || !couriers) return null;

        type SPOrder = {
            date: string | null;
            company_id: string | null;
            courier_id: string | null;
            package_status_id: string | null;
            package_status_label: string | null;
        };
        type SPProvider = { id: string; name: string; logo_url: string | null };
        type SPCourier = { id: string; name: string; avatar_url: string | null };

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const isInShipLifecycle = (pkgId: string | null) =>
            !!pkgId && (shippedPkgIds.has(pkgId) || deliveredPkgIds.has(pkgId) || returnedPkgIds.has(pkgId));
        const shipped = (orders as unknown as SPOrder[]).filter(
            (o) => isInShipLifecycle(o.package_status_id) && isInRange(o.date),
        );

        // Top-line funnel within the shipping lifecycle
        const delivered = shipped.filter(
            (o) => o.package_status_id && deliveredPkgIds.has(o.package_status_id),
        ).length;
        const returned = shipped.filter(
            (o) => o.package_status_id && returnedPkgIds.has(o.package_status_id),
        ).length;
        const inTransit = shipped.length - delivered - returned;

        // Status distribution for the left column.
        // Bucket by statusId (not label) so two rows can't collide in the React
        // render with duplicate keys when the same status was saved with
        // slightly different label strings.
        const statusDist: Record<string, { label: string; count: number }> = {};
        shipped.forEach((o) => {
            const statusId = o.package_status_id;
            if (!statusId) return;
            const label = o.package_status_label || statusId;
            if (!statusDist[statusId]) statusDist[statusId] = { label, count: 0 };
            statusDist[statusId].count += 1;
        });
        const statusChart = Object.entries(statusDist)
            .map(([statusId, { label, count }]) => ({
                id: statusId,
                label,
                count,
                color: getPkgStatusColor(statusId),
            }))
            .sort((a, b) => b.count - a.count);

        // Fulfiller distribution covers BOTH external providers (company_id) and
        // in-house couriers (courier_id). A single "fulfiller" row is keyed by
        // kind + id so the two lookup tables never collide.
        type FulfillerKind = 'provider' | 'courier';
        type FulfillerStats = {
            kind: FulfillerKind;
            id: string;
            total: number;
            delivered: number;
            returned: number;
        };
        const fulfillerDist = new Map<string, FulfillerStats>();
        const bump = (kind: FulfillerKind, id: string, o: SPOrder) => {
            const key = `${kind}:${id}`;
            const row = fulfillerDist.get(key) || { kind, id, total: 0, delivered: 0, returned: 0 };
            row.total += 1;
            if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) row.delivered += 1;
            if (o.package_status_id && returnedPkgIds.has(o.package_status_id)) row.returned += 1;
            fulfillerDist.set(key, row);
        };
        shipped.forEach((o) => {
            if (o.company_id) bump('provider', o.company_id, o);
            else if (o.courier_id) bump('courier', o.courier_id, o);
            // Orders without either are invisible in this section; they still show
            // up in the top summary and the "By status" column.
        });

        const providersTyped = (providers || []) as unknown as SPProvider[];
        const couriersTyped = (couriers || []) as unknown as SPCourier[];
        const providerById = new Map(providersTyped.map((p) => [p.id, p]));
        const courierById = new Map(couriersTyped.map((c) => [c.id, c]));

        const fulfillerList = Array.from(fulfillerDist.values())
            .map((stats) => {
                const rate = stats.total > 0 ? Math.min(100, (stats.delivered / stats.total) * 100) : 0;
                const inTransitCount = stats.total - stats.delivered - stats.returned;
                if (stats.kind === 'provider') {
                    const p = providerById.get(stats.id);
                    return {
                        kind: 'provider' as const,
                        id: stats.id,
                        name: p?.name || 'Unknown provider',
                        imageUrl: p?.logo_url || null,
                        total: stats.total,
                        delivered: stats.delivered,
                        returned: stats.returned,
                        inTransit: Math.max(0, inTransitCount),
                        deliveryRate: rate,
                    };
                }
                const c = courierById.get(stats.id);
                return {
                    kind: 'courier' as const,
                    id: stats.id,
                    name: c?.name || 'Unknown courier',
                    imageUrl: c?.avatar_url || null,
                    total: stats.total,
                    delivered: stats.delivered,
                    returned: stats.returned,
                    inTransit: Math.max(0, inTransitCount),
                    deliveryRate: rate,
                };
            })
            .sort((a, b) => b.total - a.total);

        const providerShipments = fulfillerList
            .filter((f) => f.kind === 'provider')
            .reduce((s, f) => s + f.total, 0);
        const courierShipments = fulfillerList
            .filter((f) => f.kind === 'courier')
            .reduce((s, f) => s + f.total, 0);

        return {
            total: shipped.length,
            delivered,
            returned,
            inTransit,
            statusChart,
            fulfillerList,
            providerShipments,
            courierShipments,
        };
    }, [orders, providers, couriers, dateFilter, getPkgStatusColor, shippedPkgIds, deliveredPkgIds, returnedPkgIds]);

    if (!metrics) return null;

    const overallDeliveryRate =
        metrics.total > 0 ? Math.min(100, (metrics.delivered / metrics.total) * 100) : 0;

    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardHeader className="px-3.5 pt-2.5 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <Truck className="w-3 h-3 text-gray-400" />
                        <CardTitle className="text-[12px] font-semibold text-brand-navy">
                            Shipping pipeline
                        </CardTitle>
                    </div>
                    <div className="flex items-center gap-2.5 text-[9px] tabular-nums">
                        <HeaderChip label="Total" value={metrics.total} tone="navy" />
                        <HeaderChip label="In transit" value={metrics.inTransit} tone="indigo" />
                        <HeaderChip label="Delivered" value={metrics.delivered} tone="emerald" />
                        <HeaderChip label="Returned" value={metrics.returned} tone="red" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="px-3.5 pb-3 pt-0 space-y-2.5">
                {metrics.total === 0 ? (
                    <p className="text-[11px] text-gray-400 italic py-8 text-center">
                        No orders in shipping lifecycle
                    </p>
                ) : (
                    <>
                        <div className="space-y-1">
                            <StackedProportionBar
                                segments={[
                                    { id: 'in_transit', label: 'In transit', count: metrics.inTransit, color: COLOR_IN_TRANSIT },
                                    { id: 'delivered', label: 'Delivered', count: metrics.delivered, color: COLOR_DELIVERED },
                                    { id: 'returned', label: 'Returned', count: metrics.returned, color: COLOR_RETURNED },
                                ]}
                                total={metrics.total}
                                height={6}
                            />
                            <div className="flex items-center justify-between text-[9px] text-gray-400">
                                <span className="tabular-nums">
                                    Overall delivery rate{' '}
                                    <span
                                        className={cn(
                                            'font-semibold tabular-nums ml-0.5',
                                            overallDeliveryRate >= 50
                                                ? 'text-emerald-600'
                                                : overallDeliveryRate >= 25
                                                    ? 'text-amber-600'
                                                    : 'text-red-500',
                                        )}
                                    >
                                        {overallDeliveryRate.toFixed(1)}%
                                    </span>
                                </span>
                                <div className="flex items-center gap-2">
                                    <LegendDot color={COLOR_IN_TRANSIT} label="In transit" />
                                    <LegendDot color={COLOR_DELIVERED} label="Delivered" />
                                    <LegendDot color={COLOR_RETURNED} label="Returned" />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-3 pt-1">
                            {/* By status */}
                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between">
                                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em]">
                                        By status
                                    </h4>
                                    <span className="text-[10px] text-gray-400 tabular-nums">
                                        {metrics.statusChart.length} statuses
                                    </span>
                                </div>
                                <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-0.5 -mr-0.5">
                                    {metrics.statusChart.map((s) => {
                                        const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                                        return (
                                            <div
                                                key={s.id}
                                                className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50/60 transition-colors"
                                            >
                                                <span
                                                    className="w-1 h-3.5 rounded-full shrink-0"
                                                    style={{ backgroundColor: s.color }}
                                                    aria-hidden
                                                />
                                                <span className="text-[11px] font-medium text-gray-700 flex-1 min-w-0 truncate">
                                                    {s.label}
                                                </span>
                                                <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden shrink-0">
                                                    <div
                                                        className="h-full rounded-full"
                                                        style={{
                                                            width: `${Math.min(100, pct)}%`,
                                                            backgroundColor: s.color,
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[11px] font-semibold text-brand-navy tabular-nums w-7 text-right shrink-0">
                                                    {s.count}
                                                </span>
                                                <span className="text-[10px] text-gray-400 tabular-nums w-9 text-right shrink-0">
                                                    {pct.toFixed(1)}%
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* By fulfiller (providers + in-house couriers) */}
                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between">
                                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em]">
                                        By fulfiller
                                    </h4>
                                    <span className="text-[10px] text-gray-400 tabular-nums">
                                        {metrics.providerShipments.toLocaleString('fr-MA')} via providers ·{' '}
                                        {metrics.courierShipments.toLocaleString('fr-MA')} via couriers
                                    </span>
                                </div>
                                <div className="space-y-1.5">
                                    {metrics.fulfillerList.length === 0 ? (
                                        <p className="text-[11px] text-gray-400 italic py-3 text-center">
                                            No fulfiller-assigned shipments
                                        </p>
                                    ) : (
                                        metrics.fulfillerList.map((f) => (
                                            <FulfillerRow key={`${f.kind}:${f.id}`} fulfiller={f} />
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

function HeaderChip({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: 'navy' | 'indigo' | 'emerald' | 'red';
}) {
    const toneClass =
        tone === 'emerald'
            ? 'text-emerald-600'
            : tone === 'red'
                ? 'text-red-500'
                : tone === 'indigo'
                    ? 'text-indigo-500'
                    : 'text-brand-navy';
    return (
        <span className="flex items-baseline gap-1">
            <span className="text-gray-400 uppercase tracking-[0.14em]">{label}</span>
            <span className={cn('font-semibold tabular-nums', toneClass)}>
                {value.toLocaleString('fr-MA')}
            </span>
        </span>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[9px] text-gray-500">{label}</span>
        </span>
    );
}

interface FulfillerStats {
    kind: 'provider' | 'courier';
    id: string;
    name: string;
    imageUrl: string | null;
    total: number;
    delivered: number;
    returned: number;
    inTransit: number;
    deliveryRate: number;
}

function FulfillerRow({ fulfiller: f }: { fulfiller: FulfillerStats }) {
    const rateTone =
        f.deliveryRate >= 50 ? 'text-emerald-600' : f.deliveryRate >= 25 ? 'text-amber-600' : 'text-red-500';
    const isCourier = f.kind === 'courier';
    const kindLabel = isCourier ? 'Courier' : 'Provider';
    const FallbackIcon = isCourier ? Bike : Building2;
    return (
        <div className="rounded-md border border-gray-100 px-2 py-1.5 transition-colors hover:border-gray-200">
            <div className="flex items-center gap-1.5">
                {f.imageUrl ? (
                    <img
                        src={f.imageUrl}
                        alt={f.name}
                        className={cn(
                            'w-5 h-5 shrink-0 border border-gray-100 bg-white',
                            isCourier ? 'rounded-full object-cover' : 'rounded-sm object-contain',
                        )}
                    />
                ) : (
                    <div
                        className={cn(
                            'w-5 h-5 flex items-center justify-center shrink-0',
                            isCourier ? 'rounded-full bg-indigo-50' : 'rounded-sm bg-gray-100',
                        )}
                    >
                        <FallbackIcon
                            className={cn('w-2.5 h-2.5', isCourier ? 'text-indigo-500' : 'text-gray-400')}
                        />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-1 min-w-0">
                            <span className="text-[11px] font-semibold text-brand-navy truncate">{f.name}</span>
                            <span
                                className={cn(
                                    'text-[8px] uppercase tracking-[0.12em] font-bold shrink-0',
                                    isCourier ? 'text-indigo-500' : 'text-gray-400',
                                )}
                            >
                                {kindLabel}
                            </span>
                        </div>
                        <span className={cn('text-[11px] font-semibold tabular-nums shrink-0', rateTone)}>
                            {f.deliveryRate.toFixed(1)}%
                        </span>
                    </div>
                    <StackedProportionBar
                        className="mt-0.5"
                        height={2}
                        total={f.total}
                        segments={[
                            { id: 'it', label: 'In transit', count: f.inTransit, color: COLOR_IN_TRANSIT },
                            { id: 'd', label: 'Delivered', count: f.delivered, color: COLOR_DELIVERED },
                            { id: 'r', label: 'Returned', count: f.returned, color: COLOR_RETURNED },
                        ]}
                    />
                    <div className="flex items-center justify-between text-[8px] text-gray-400 tabular-nums mt-0.5">
                        <span>{f.total} shipments</span>
                        <span>
                            {f.delivered} del · {f.returned} ret · {f.inTransit} in transit
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
