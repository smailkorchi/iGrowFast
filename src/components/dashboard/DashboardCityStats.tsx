import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MapPin, AlertTriangle, ChevronRight } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { isAdminPullback, pureRevenueForOrder, type AnalyticsOrder } from '@/lib/analyticsDefinitions';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface DashboardCityStatsProps {
    businessId: string;
    dateFilter: DateFilter;
}

const TOP_N_PREVIEW = 8;

// Deterministic palette for the top-N proportion bar. Cities beyond TOP_N fall into
// an "Others" segment. Warm Anthropic-inspired neutrals + single orange lead.
const TOP_COLORS = [
    '#141413',
    '#d97757',
    '#6a9bcc',
    '#788c5d',
    '#b0aea5',
    '#c96356',
    '#3f3e3a',
    '#8d8b84',
];
const OTHERS_COLOR = '#e8e6dc';

export const DashboardCityStats = ({ businessId, dateFilter }: DashboardCityStatsProps) => {
    const { deliveredPkgIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);
    const [showAll, setShowAll] = useState(false);

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders-cities', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, date, price, shipping_cost, include_delivery_in_total, package_status_id, master_city_id, master_cities(name), order_status_id, package_statuses(label)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;

        const hasExplicitFilter = !!dateFilter.from || !!dateFilter.to;
        const isInRange = (dateStr: string | null) => {
            // All-Time view lets everything through (null dates included).
            if (!hasExplicitFilter) return true;
            // Explicit window: null-date rows are excluded so they don't
            // leak into every filtered period.
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        type CityOrderRow = {
            id?: string;
            date?: string | null;
            master_cities?: { name?: string | null } | null;
            package_status_id?: string | null;
            package_statuses?: { label?: string | null } | null;
            order_status_id?: string | null;
            price?: number | string | null;
            shipping_cost?: number | string | null;
            include_delivery_in_total?: boolean | null;
        };
        const filtered = orders.filter((o: CityOrderRow) => isInRange(o.date));

        // Per-city delivery rate uses Coliaty's formula: delivered divided by
        // (tracked − admin-pullback). `deliveryDenom` replaces the old strict
        // "confirmed" counter.
        const cityMap: Record<
            string,
            { name: string; total: number; deliveryDenom: number; delivered: number; revenue: number }
        > = {};

        // Shared revenue definition (product + collected delivery when folded
        // into the order total) so per-city revenue matches the P&L / analytics.
        // The old inline version stripped shipping, understating revenue by the
        // delivery the customer reimbursed.
        const productRevenue = (o: CityOrderRow) => pureRevenueForOrder(o as unknown as AnalyticsOrder);

        let totalOrders = 0;
        let totalDeliveryDenom = 0;  // tracked − admin-pullback, per Coliaty
        let totalDelivered = 0;
        let totalRevenue = 0;

        filtered.forEach((o: CityOrderRow) => {
            const cityName = o.master_cities?.name;
            if (!cityName) return;
            if (!cityMap[cityName]) {
                cityMap[cityName] = { name: cityName, total: 0, deliveryDenom: 0, delivered: 0, revenue: 0 };
            }
            cityMap[cityName].total += 1;
            totalOrders += 1;

            // Delivery-rate denominator = tracked orders minus admin pullbacks.
            const hasTracking = !!o.id && trackedOrderIds.has(o.id);
            if (hasTracking) {
                const pullback = isAdminPullback(
                    o,
                    true,
                    adminPullbackOrderIds,
                    adminPullbackPackageIds,
                );
                if (!pullback) {
                    cityMap[cityName].deliveryDenom += 1;
                    totalDeliveryDenom += 1;
                }
            }

            // Delivered iff package_status_id resolves to a delivered-category row.
            // Single source of truth — matches seller_daily_earnings view.
            const delivered = !!o.package_status_id && deliveredPkgIds.has(o.package_status_id);
            if (delivered) {
                cityMap[cityName].delivered += 1;
                cityMap[cityName].revenue += productRevenue(o);
                totalDelivered += 1;
                totalRevenue += productRevenue(o);
            }
        });

        // Primary sort: delivered desc (ops signal), tiebreaker: total desc.
        const sortedByDelivered = Object.values(cityMap).sort((a, b) => {
            if (b.delivered !== a.delivered) return b.delivered - a.delivered;
            return b.total - a.total;
        });

        // Concentration bar: top-N as named segments, remainder rolled up as "Others".
        const byVolume = [...sortedByDelivered].sort((a, b) => b.total - a.total);
        const topVolume = byVolume.slice(0, TOP_N_PREVIEW);
        const otherVolume = byVolume.slice(TOP_N_PREVIEW);
        const othersCount = otherVolume.reduce((s, c) => s + c.total, 0);
        const concentrationSegments = topVolume.map((c, i) => ({
            id: `top:${c.name}`,
            label: c.name,
            count: c.total,
            color: TOP_COLORS[i % TOP_COLORS.length],
        }));
        if (othersCount > 0) {
            concentrationSegments.push({
                id: 'others',
                label: `+${otherVolume.length} more cities`,
                count: othersCount,
                color: OTHERS_COLOR,
            });
        }
        const topVolumeShare = totalOrders > 0 ? (topVolume.reduce((s, c) => s + c.total, 0) / totalOrders) * 100 : 0;

        // Problem cities: meaningful volume AND weak delivery rate.
        const problemCities = sortedByDelivered
            .filter((c) => c.deliveryDenom >= 3 && c.delivered / Math.max(1, c.deliveryDenom) < 0.3)
            .slice(0, 3);

        const overallRate =
            totalDeliveryDenom > 0 ? Math.min(100, (totalDelivered / totalDeliveryDenom) * 100) : 0;

        return {
            cities: sortedByDelivered,
            concentrationSegments,
            topVolumeShare,
            problemCities,
            totalCities: sortedByDelivered.length,
            totalOrders,
            totalDeliveryDenom,
            totalDelivered,
            totalRevenue,
            overallRate,
        };
    }, [orders, dateFilter, deliveredPkgIds, trackedOrderIds, adminPullbackOrderIds, adminPullbackPackageIds]);

    if (!metrics) return null;

    const visibleCities = showAll ? metrics.cities : metrics.cities.slice(0, 10);
    const hasMore = metrics.cities.length > 10;
    const maxCityVolume = Math.max(1, ...metrics.cities.map((c) => c.total));

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Cities
                        </CardTitle>
                        <MapPin className="hidden" />
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                        {metrics.totalCities} cities · {metrics.totalOrders.toLocaleString('fr-MA')} orders
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {metrics.totalCities === 0 ? (
                    <p className="font-serif-display text-[12px] text-ant-muted italic py-8 text-center">
                        No city-tagged orders in this period
                    </p>
                ) : (
                    <>
                        {/* Summary chips */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <SummaryChip
                                label="Delivered"
                                value={metrics.totalDelivered.toLocaleString('fr-MA')}
                                accent="#788c5d"
                            />
                            <SummaryChip
                                label="Delivery rate"
                                value={`${metrics.overallRate.toFixed(1)}%`}
                                accent={
                                    metrics.overallRate >= 50
                                        ? '#788c5d'
                                        : metrics.overallRate >= 25
                                            ? '#d97757'
                                            : '#c96356'
                                }
                            />
                            <SummaryChip
                                label="Revenue"
                                value={`${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')}`}
                                suffix="MAD"
                                accent="#6a9bcc"
                            />
                            <SummaryChip
                                label="Top 8 share"
                                value={`${metrics.topVolumeShare.toFixed(0)}%`}
                                accent="#141413"
                            />
                        </div>

                        {/* Concentration bar */}
                        <div className="space-y-1.5">
                            <div className="flex items-baseline justify-between">
                                <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                    Concentration
                                </h4>
                                <span className="text-[10px] text-ant-mid tabular-nums">
                                    by order volume
                                </span>
                            </div>
                            <StackedProportionBar
                                segments={metrics.concentrationSegments}
                                total={metrics.totalOrders}
                                height={6}
                            />
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                {metrics.concentrationSegments.slice(0, 4).map((seg) => {
                                    const pct = metrics.totalOrders > 0
                                        ? (seg.count / metrics.totalOrders) * 100
                                        : 0;
                                    return (
                                        <span
                                            key={seg.id}
                                            className="inline-flex items-center gap-1 text-[10px]"
                                        >
                                            <span
                                                className="w-1.5 h-1.5 rounded-full"
                                                style={{ backgroundColor: seg.color }}
                                            />
                                            <span className="text-ant-ink truncate max-w-[100px]">
                                                {seg.label}
                                            </span>
                                            <span className="text-ant-mid tabular-nums">
                                                {pct.toFixed(0)}%
                                            </span>
                                        </span>
                                    );
                                })}
                                {metrics.concentrationSegments.length > 4 && (
                                    <span className="text-[10px] text-ant-mid">
                                        +{metrics.concentrationSegments.length - 4} more
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Problem cities alert */}
                        {metrics.problemCities.length > 0 && (
                            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-ant-rose/[0.06] border border-ant-rose/25">
                                <AlertTriangle
                                    className="w-3.5 h-3.5 text-ant-rose shrink-0 mt-0.5"
                                    strokeWidth={2.25}
                                />
                                <div className="text-[11px] text-ant-rose font-medium">
                                    Low delivery rate in{' '}
                                    {metrics.problemCities.map((c, i) => {
                                        const rate = c.deliveryDenom > 0
                                            ? Math.round((c.delivered / c.deliveryDenom) * 100)
                                            : 0;
                                        return (
                                            <span key={c.name} className="font-semibold">
                                                {c.name} ({rate}%)
                                                {i < metrics.problemCities.length - 1 && ', '}
                                            </span>
                                        );
                                    })}
                                    {' — investigate routing or delivery partner'}
                                </div>
                            </div>
                        )}

                        {/* City list */}
                        <div className="space-y-0">
                            <div className="flex items-baseline justify-between px-2 pb-1.5">
                                <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                    {showAll ? 'All cities' : 'Top cities'}
                                </h4>
                                <span className="text-[9px] text-ant-mid uppercase tracking-[0.16em]">
                                    Rank · City · Volume · Rate · Revenue
                                </span>
                            </div>
                            {visibleCities.map((c, i) => {
                                const deliveryRateNum = c.deliveryDenom > 0
                                    ? Math.min(100, (c.delivered / c.deliveryDenom) * 100)
                                    : 0;
                                const volumeShare = (c.total / maxCityVolume) * 100;
                                const rateTone =
                                    deliveryRateNum >= 50
                                        ? 'text-ant-green bg-ant-green/10'
                                        : deliveryRateNum >= 25
                                            ? 'text-ant-orange bg-ant-orange/10'
                                            : 'text-ant-rose bg-ant-rose/10';
                                return (
                                    <div
                                        key={c.name}
                                        className="grid grid-cols-[22px_minmax(0,1fr)_44px_1fr_48px_78px] items-center gap-2 py-1.5 px-2 rounded-md hover:bg-ant-line-soft transition-colors"
                                    >
                                        <span className="text-[10px] font-semibold text-ant-mid text-right tabular-nums">
                                            {i + 1}
                                        </span>
                                        <span className="text-[11px] font-medium text-ant-ink truncate">
                                            {c.name}
                                        </span>
                                        <span className="text-[11px] font-semibold text-ant-ink tabular-nums text-right">
                                            {c.total}
                                        </span>
                                        <div className="h-[3px] rounded-full bg-ant-line overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-ant-ink/60"
                                                style={{ width: `${volumeShare}%` }}
                                            />
                                        </div>
                                        <span
                                            className={cn(
                                                'text-[9.5px] font-semibold rounded-full px-1.5 py-px tabular-nums text-center',
                                                rateTone,
                                            )}
                                        >
                                            {deliveryRateNum.toFixed(1)}%
                                        </span>
                                        <span className="text-[10px] text-ant-mid tabular-nums text-right">
                                            {Math.round(c.revenue).toLocaleString('fr-MA')}{' '}
                                            <span className="text-[9px]">MAD</span>
                                        </span>
                                    </div>
                                );
                            })}
                            {hasMore && (
                                <button
                                    type="button"
                                    onClick={() => setShowAll((v) => !v)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold text-ant-ink hover:text-ant-orange hover:bg-ant-line-soft rounded-md transition-colors"
                                >
                                    {showAll
                                        ? 'Show top 10 only'
                                        : `Show all ${metrics.totalCities} cities`}
                                    <ChevronRight
                                        className={cn('w-3 h-3 transition-transform', showAll && 'rotate-90')}
                                    />
                                </button>
                            )}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

function SummaryChip({
    label,
    value,
    suffix,
    accent,
}: {
    label: string;
    value: string;
    suffix?: string;
    accent: string;
}) {
    return (
        <div className="rounded-lg border border-ant-line px-3 py-2">
            <div className="flex items-center gap-1.5">
                <span
                    className="w-1 h-1 rounded-full"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                />
                <span className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid">
                    {label}
                </span>
            </div>
            <div className="font-display text-[16px] font-semibold text-ant-ink tabular-nums mt-1 leading-none tracking-[-0.02em]">
                {value}
                {suffix && <span className="text-[9px] text-ant-mid font-medium ml-1">{suffix}</span>}
            </div>
        </div>
    );
}
