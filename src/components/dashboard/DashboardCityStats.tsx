import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MapPin, AlertTriangle, ChevronRight } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { StackedProportionBar } from './performance/StackedProportionBar';

interface DashboardCityStatsProps {
    businessId: string;
    dateFilter: DateFilter;
}

const TOP_N_PREVIEW = 8;

// Deterministic palette for the top-N proportion bar. Cities beyond TOP_N fall into
// an "Others" segment.
const TOP_COLORS = [
    '#3b5e5e',
    '#7a9385',
    '#6366f1',
    '#f97316',
    '#a855f7',
    '#14b8a6',
    '#ec4899',
    '#0ea5e9',
];
const OTHERS_COLOR = '#d1d5db';

export const DashboardCityStats = ({ businessId, dateFilter }: DashboardCityStatsProps) => {
    const { confirmedIds, deliveredPkgIds } = useStatusCategories();
    const [showAll, setShowAll] = useState(false);

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders-cities', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, date, price, shipping_cost, include_delivery_in_total, package_status_id, package_status_label, master_city_id, master_cities(name), order_status_id, package_statuses(label)',
                )
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

        type CityOrderRow = {
            date?: string | null;
            master_cities?: { name?: string | null } | null;
            package_status_id?: string | null;
            package_status_label?: string | null;
            package_statuses?: { label?: string | null } | null;
            order_status_id?: string | null;
            price?: number | string | null;
            shipping_cost?: number | string | null;
            include_delivery_in_total?: boolean | null;
        };
        const filtered = orders.filter((o: CityOrderRow) => isInRange(o.date));

        const cityMap: Record<
            string,
            { name: string; total: number; confirmed: number; delivered: number; revenue: number }
        > = {};

        const productRevenue = (o: CityOrderRow) => {
            const price = Number(o.price || 0);
            const ship = Number(o.shipping_cost || 0);
            if (o.include_delivery_in_total === false) return Math.max(0, price);
            return Math.max(0, price - ship);
        };

        const labelMatch = (s: string | null | undefined) => {
            const t = (s || '').toLowerCase();
            return t.includes('livré') || t.includes('livre') || t.includes('delivered');
        };

        let totalOrders = 0;
        let totalConfirmed = 0;
        let totalDelivered = 0;
        let totalRevenue = 0;

        filtered.forEach((o: CityOrderRow) => {
            const cityName = o.master_cities?.name;
            if (!cityName) return;
            if (!cityMap[cityName]) {
                cityMap[cityName] = { name: cityName, total: 0, confirmed: 0, delivered: 0, revenue: 0 };
            }
            cityMap[cityName].total += 1;
            totalOrders += 1;

            const confirmed = !!o.order_status_id && confirmedIds.has(o.order_status_id);
            if (confirmed) {
                cityMap[cityName].confirmed += 1;
                totalConfirmed += 1;
            }

            const delivered =
                labelMatch(o.package_status_label) ||
                labelMatch(o.package_statuses?.label) ||
                (!!o.package_status_id && deliveredPkgIds.has(o.package_status_id));
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
            .filter((c) => c.confirmed >= 3 && c.delivered / Math.max(1, c.confirmed) < 0.3)
            .slice(0, 3);

        const overallRate =
            totalConfirmed > 0 ? Math.min(100, (totalDelivered / totalConfirmed) * 100) : 0;

        return {
            cities: sortedByDelivered,
            concentrationSegments,
            topVolumeShare,
            problemCities,
            totalCities: sortedByDelivered.length,
            totalOrders,
            totalConfirmed,
            totalDelivered,
            totalRevenue,
            overallRate,
        };
    }, [orders, dateFilter, confirmedIds, deliveredPkgIds]);

    if (!metrics) return null;

    const visibleCities = showAll ? metrics.cities : metrics.cities.slice(0, 10);
    const hasMore = metrics.cities.length > 10;
    const maxCityVolume = Math.max(1, ...metrics.cities.map((c) => c.total));

    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardHeader className="px-3.5 pt-2.5 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        <CardTitle className="text-[12px] font-semibold text-brand-navy">
                            Cities
                        </CardTitle>
                    </div>
                    <span className="text-[9px] text-gray-400 uppercase tracking-[0.14em] tabular-nums">
                        {metrics.totalCities} cities · {metrics.totalOrders.toLocaleString('fr-MA')} orders
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-3.5 pb-3 pt-0 space-y-2.5">
                {metrics.totalCities === 0 ? (
                    <p className="text-[11px] text-gray-400 italic py-8 text-center">
                        No city-tagged orders in this period
                    </p>
                ) : (
                    <>
                        {/* Summary chips */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            <SummaryChip
                                label="Delivered"
                                value={metrics.totalDelivered.toLocaleString('fr-MA')}
                                accent="#10b981"
                            />
                            <SummaryChip
                                label="Delivery rate"
                                value={`${metrics.overallRate.toFixed(1)}%`}
                                accent={
                                    metrics.overallRate >= 50
                                        ? '#10b981'
                                        : metrics.overallRate >= 25
                                            ? '#f59e0b'
                                            : '#ef4444'
                                }
                            />
                            <SummaryChip
                                label="Revenue"
                                value={`${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')}`}
                                suffix="MAD"
                                accent="#2563eb"
                            />
                            <SummaryChip
                                label="Top 8 share"
                                value={`${metrics.topVolumeShare.toFixed(0)}%`}
                                accent="#6366f1"
                            />
                        </div>

                        {/* Concentration bar */}
                        <div className="space-y-1">
                            <div className="flex items-baseline justify-between">
                                <h4 className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.14em]">
                                    Concentration
                                </h4>
                                <span className="text-[9px] text-gray-400 tabular-nums">
                                    by order volume
                                </span>
                            </div>
                            <StackedProportionBar
                                segments={metrics.concentrationSegments}
                                total={metrics.totalOrders}
                                height={6}
                            />
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                {metrics.concentrationSegments.slice(0, 4).map((seg) => {
                                    const pct = metrics.totalOrders > 0
                                        ? (seg.count / metrics.totalOrders) * 100
                                        : 0;
                                    return (
                                        <span
                                            key={seg.id}
                                            className="inline-flex items-center gap-1 text-[9px]"
                                        >
                                            <span
                                                className="w-1 h-1 rounded-full"
                                                style={{ backgroundColor: seg.color }}
                                            />
                                            <span className="text-gray-600 truncate max-w-[100px]">
                                                {seg.label}
                                            </span>
                                            <span className="text-gray-400 tabular-nums">
                                                {pct.toFixed(0)}%
                                            </span>
                                        </span>
                                    );
                                })}
                                {metrics.concentrationSegments.length > 4 && (
                                    <span className="text-[9px] text-gray-400">
                                        +{metrics.concentrationSegments.length - 4} more
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Problem cities alert */}
                        {metrics.problemCities.length > 0 && (
                            <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50/40 border border-red-100">
                                <AlertTriangle
                                    className="w-3 h-3 text-red-500 shrink-0 mt-0.5"
                                    strokeWidth={2.25}
                                />
                                <div className="text-[10px] text-red-700 font-medium">
                                    Low delivery rate in{' '}
                                    {metrics.problemCities.map((c, i) => {
                                        const rate = c.confirmed > 0
                                            ? Math.round((c.delivered / c.confirmed) * 100)
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
                            <div className="flex items-baseline justify-between px-1.5 pb-1">
                                <h4 className="text-[9px] font-bold text-gray-500 uppercase tracking-[0.14em]">
                                    {showAll ? 'All cities' : 'Top cities'}
                                </h4>
                                <span className="text-[8px] text-gray-400 uppercase tracking-[0.12em]">
                                    Rank · City · Volume · Rate · Revenue
                                </span>
                            </div>
                            {visibleCities.map((c, i) => {
                                const deliveryRateNum = c.confirmed > 0
                                    ? Math.min(100, (c.delivered / c.confirmed) * 100)
                                    : 0;
                                const volumeShare = (c.total / maxCityVolume) * 100;
                                const rateTone =
                                    deliveryRateNum >= 50
                                        ? 'text-emerald-600 bg-emerald-50'
                                        : deliveryRateNum >= 25
                                            ? 'text-amber-600 bg-amber-50'
                                            : 'text-red-600 bg-red-50';
                                return (
                                    <div
                                        key={c.name}
                                        className="grid grid-cols-[18px_minmax(0,1fr)_40px_1fr_44px_72px] items-center gap-1.5 py-1 px-1.5 rounded-md hover:bg-gray-50/60 transition-colors"
                                    >
                                        <span className="text-[9px] font-bold text-gray-300 text-right tabular-nums">
                                            {i + 1}
                                        </span>
                                        <span className="text-[10px] font-medium text-gray-700 truncate">
                                            {c.name}
                                        </span>
                                        <span className="text-[10px] font-semibold text-brand-navy tabular-nums text-right">
                                            {c.total}
                                        </span>
                                        <div className="h-[3px] rounded-full bg-gray-100 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-brand-navy/60"
                                                style={{ width: `${volumeShare}%` }}
                                            />
                                        </div>
                                        <span
                                            className={cn(
                                                'text-[9px] font-semibold rounded px-1 py-px tabular-nums text-center',
                                                rateTone,
                                            )}
                                        >
                                            {deliveryRateNum.toFixed(0)}%
                                        </span>
                                        <span className="text-[9px] text-gray-400 tabular-nums text-right">
                                            {Math.round(c.revenue).toLocaleString('fr-MA')}{' '}
                                            <span className="text-[8px]">MAD</span>
                                        </span>
                                    </div>
                                );
                            })}
                            {hasMore && (
                                <button
                                    type="button"
                                    onClick={() => setShowAll((v) => !v)}
                                    className="w-full flex items-center justify-center gap-1 py-1 text-[10px] font-semibold text-gray-500 hover:text-brand-navy hover:bg-gray-50 rounded-md transition-colors"
                                >
                                    {showAll
                                        ? 'Show top 10 only'
                                        : `Show all ${metrics.totalCities} cities`}
                                    <ChevronRight
                                        className={cn('w-2.5 h-2.5 transition-transform', showAll && 'rotate-90')}
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
        <div className="rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="flex items-center gap-1">
                <span
                    className="w-1 h-1 rounded-full"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                />
                <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">
                    {label}
                </span>
            </div>
            <div className="text-[13px] font-semibold text-brand-navy tabular-nums mt-0.5 leading-none">
                {value}
                {suffix && <span className="text-[8px] text-gray-400 font-medium ml-1">{suffix}</span>}
            </div>
        </div>
    );
}
