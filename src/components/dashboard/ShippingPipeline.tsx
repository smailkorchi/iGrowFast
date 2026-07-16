import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Truck, Building2, Bike } from 'lucide-react';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { resolveProviderLogo } from '@/lib/providerLogos';
import { StackedProportionBar } from './performance/StackedProportionBar';

/**
 * `shipping_pipeline` section of admin_dashboard_stats (D2). shipped = pkg in
 * (is_shipped ∪ is_delivered ∪ is_returned); overall rate reconciles with the
 * KPI tile (Coliaty denominator over the FULL filtered set). Names/logos stay
 * client-side (providers/couriers support queries below).
 */
export interface ShippingPipelineSection {
    filtered_total: number;
    shipped_total: number;
    delivered: number;
    returned: number;
    in_transit: number;
    overall_denom: number;
    overall_rate: number;
    by_status: Array<{
        package_status_id: string;
        label: string;
        count: number;
    }>;
    by_fulfiller: Array<{
        kind: 'provider' | 'courier';
        id: string;
        total: number;
        delivered: number;
        returned: number;
        in_transit: number;
        denom: number;
        rate: number;
    }>;
    provider_shipments: number;
    courier_shipments: number;
}

interface ShippingPipelineProps {
    businessId: string;
    stats: ShippingPipelineSection | undefined;
}

const COLOR_DELIVERED = '#788c5d'; // ant green
const COLOR_RETURNED = '#c96356'; // ant rose
const COLOR_IN_TRANSIT = '#6a9bcc'; // ant blue

export const ShippingPipeline = ({ businessId, stats }: ShippingPipelineProps) => {
    // Status masters stay client-side only for the per-status colors.
    const { getPkgStatusColor } = useStatusCategories();

    const { data: providers } = useQuery({
        queryKey: ['dashboard-providers', businessId],
        staleTime: 60_000,
        queryFn: async () => {
            const { data } = await supabase
                .from('providers')
                .select('id, name, provider_type, logo_url')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    // In-house couriers (users with role='courier'). Separate fulfillment channel
    // from external providers — previously invisible in this card.
    const { data: couriers } = useQuery({
        queryKey: ['dashboard-couriers', businessId],
        staleTime: 60_000,
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, avatar_config')
                .eq('role', 'courier')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!stats || !providers || !couriers) return null;

        type SPProvider = { id: string; name: string; provider_type: string | null; logo_url: string | null };
        type SPCourier = { id: string; name: string; avatar_url: string | null };

        const statusChart = stats.by_status.map((s) => ({
            id: s.package_status_id,
            label: s.label,
            count: s.count,
            color: getPkgStatusColor(s.package_status_id),
        }));

        const providersTyped = (providers || []) as unknown as SPProvider[];
        const couriersTyped = (couriers || []) as unknown as SPCourier[];
        const providerById = new Map(providersTyped.map((p) => [p.id, p]));
        const courierById = new Map(couriersTyped.map((c) => [c.id, c]));

        // RPC rows are already sorted total desc; only names/logos are resolved here.
        const fulfillerList = stats.by_fulfiller.map((f) => {
            if (f.kind === 'provider') {
                const p = providerById.get(f.id);
                return {
                    kind: 'provider' as const,
                    id: f.id,
                    name: p?.name || 'Unknown provider',
                    imageUrl: resolveProviderLogo(p),
                    total: f.total,
                    delivered: f.delivered,
                    returned: f.returned,
                    inTransit: f.in_transit,
                    deliveryRate: f.rate,
                };
            }
            const c = courierById.get(f.id);
            return {
                kind: 'courier' as const,
                id: f.id,
                name: c?.name || 'Unknown courier',
                imageUrl: c?.avatar_url || null,
                total: f.total,
                delivered: f.delivered,
                returned: f.returned,
                inTransit: f.in_transit,
                deliveryRate: f.rate,
            };
        });

        return {
            total: stats.shipped_total,
            delivered: stats.delivered,
            returned: stats.returned,
            inTransit: stats.in_transit,
            overallRate: stats.overall_rate,
            statusChart,
            fulfillerList,
            providerShipments: stats.provider_shipments,
            courierShipments: stats.courier_shipments,
        };
    }, [stats, providers, couriers, getPkgStatusColor]);

    if (!metrics) return null;

    const overallDeliveryRate = metrics.overallRate;

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Shipping pipeline
                        </CardTitle>
                        <Truck className="hidden" />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] tabular-nums">
                        <HeaderChip label="Total" value={metrics.total} tone="navy" />
                        <HeaderChip label="In transit" value={metrics.inTransit} tone="indigo" />
                        <HeaderChip label="Delivered" value={metrics.delivered} tone="emerald" />
                        <HeaderChip label="Returned" value={metrics.returned} tone="red" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {metrics.total === 0 ? (
                    <p className="font-serif-display text-[12px] text-ant-muted italic py-8 text-center">
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
                            <div className="flex items-center justify-between text-[10px] text-ant-mid">
                                <span className="tabular-nums">
                                    Overall delivery rate{' '}
                                    <span
                                        className={cn(
                                            'font-semibold tabular-nums ml-0.5',
                                            overallDeliveryRate >= 50
                                                ? 'text-ant-green'
                                                : overallDeliveryRate >= 25
                                                    ? 'text-ant-orange'
                                                    : 'text-ant-rose',
                                        )}
                                    >
                                        {overallDeliveryRate.toFixed(1)}%
                                    </span>
                                </span>
                                <div className="flex items-center gap-2.5">
                                    <LegendDot color={COLOR_IN_TRANSIT} label="In transit" />
                                    <LegendDot color={COLOR_DELIVERED} label="Delivered" />
                                    <LegendDot color={COLOR_RETURNED} label="Returned" />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3 pt-2">
                            {/* By status */}
                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between">
                                    <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                        By status
                                    </h4>
                                    <span className="text-[10px] text-ant-mid tabular-nums">
                                        {metrics.statusChart.length} statuses
                                    </span>
                                </div>
                                <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1 ant-scroll">
                                    {metrics.statusChart.map((s) => {
                                        const pct = metrics.total > 0 ? (s.count / metrics.total) * 100 : 0;
                                        return (
                                            <div
                                                key={s.id}
                                                className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-ant-line-soft transition-colors"
                                            >
                                                <span
                                                    className="w-1 h-3.5 rounded-full shrink-0"
                                                    style={{ backgroundColor: s.color }}
                                                    aria-hidden
                                                />
                                                <span className="text-[11.5px] font-medium text-ant-ink flex-1 min-w-0 truncate">
                                                    {s.label}
                                                </span>
                                                <div className="w-20 h-1 rounded-full bg-ant-line overflow-hidden shrink-0">
                                                    <div
                                                        className="h-full rounded-full"
                                                        style={{
                                                            width: `${Math.min(100, pct)}%`,
                                                            backgroundColor: s.color,
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[11.5px] font-semibold text-ant-ink tabular-nums w-7 text-right shrink-0">
                                                    {s.count}
                                                </span>
                                                <span className="text-[10px] text-ant-mid tabular-nums w-9 text-right shrink-0">
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
                                    <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                        By fulfiller
                                    </h4>
                                    <span className="text-[10px] text-ant-mid tabular-nums">
                                        {metrics.providerShipments.toLocaleString('fr-MA')} via providers ·{' '}
                                        {metrics.courierShipments.toLocaleString('fr-MA')} via couriers
                                    </span>
                                </div>
                                <div className="space-y-1.5">
                                    {metrics.fulfillerList.length === 0 ? (
                                        <p className="font-serif-display text-[11px] text-ant-muted italic py-3 text-center">
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
            ? 'text-ant-green'
            : tone === 'red'
                ? 'text-ant-rose'
                : tone === 'indigo'
                    ? 'text-ant-blue'
                    : 'text-ant-ink';
    return (
        <span className="flex items-baseline gap-1">
            <span className="text-ant-mid uppercase tracking-[0.18em]">{label}</span>
            <span className={cn('font-semibold tabular-nums', toneClass)}>
                {value.toLocaleString('fr-MA')}
            </span>
        </span>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[10px] text-ant-muted">{label}</span>
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
        f.deliveryRate >= 50 ? 'text-ant-green' : f.deliveryRate >= 25 ? 'text-ant-orange' : 'text-ant-rose';
    const isCourier = f.kind === 'courier';
    const kindLabel = isCourier ? 'Courier' : 'Provider';
    const FallbackIcon = isCourier ? Bike : Building2;
    return (
        <div className="rounded-lg border border-ant-line px-2.5 py-2 transition-colors hover:border-ant-ink/20">
            <div className="flex items-center gap-2">
                {f.imageUrl ? (
                    <img
                        src={f.imageUrl}
                        alt={f.name}
                        className={cn(
                            'w-6 h-6 shrink-0 border border-ant-line bg-ant-paper',
                            isCourier ? 'rounded-full object-cover' : 'rounded-md object-contain p-0.5',
                        )}
                    />
                ) : (
                    <div
                        className={cn(
                            'w-6 h-6 flex items-center justify-center shrink-0',
                            isCourier ? 'rounded-full bg-ant-blue/10' : 'rounded-md bg-ant-line-soft',
                        )}
                    >
                        <FallbackIcon
                            className={cn('w-3 h-3', isCourier ? 'text-ant-blue' : 'text-ant-mid')}
                        />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="text-[11.5px] font-semibold text-ant-ink truncate">{f.name}</span>
                            <span
                                className={cn(
                                    'text-[8.5px] uppercase tracking-[0.18em] font-medium shrink-0',
                                    isCourier ? 'text-ant-blue' : 'text-ant-mid',
                                )}
                            >
                                {kindLabel}
                            </span>
                        </div>
                        <span className={cn('text-[11.5px] font-semibold tabular-nums shrink-0', rateTone)}>
                            {f.deliveryRate.toFixed(1)}%
                        </span>
                    </div>
                    <StackedProportionBar
                        className="mt-1"
                        height={2}
                        total={f.total}
                        segments={[
                            { id: 'it', label: 'In transit', count: f.inTransit, color: COLOR_IN_TRANSIT },
                            { id: 'd', label: 'Delivered', count: f.delivered, color: COLOR_DELIVERED },
                            { id: 'r', label: 'Returned', count: f.returned, color: COLOR_RETURNED },
                        ]}
                    />
                    <div className="flex items-center justify-between text-[9px] text-ant-mid tabular-nums mt-1">
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
