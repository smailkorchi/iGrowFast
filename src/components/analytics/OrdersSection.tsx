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
    isFailed,
    isRateConfirmed,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    ShoppingBag, CheckCircle, Truck, XCircle, Receipt,
    TrendingUp, Clock, BarChart3, MapPin,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, subDays } from 'date-fns';

interface OrdersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const OrdersSection = ({ businessId, dateFilter }: OrdersSectionProps) => {
    const {
        cancelledIds,
        pendingIds,
        adminPullbackOrderIds,
        adminPullbackPackageIds,
        deliveredPkgIds,
    } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-full-v2', businessId],
        queryFn: async () => {
            const rows = await fetchAllRows(
                'orders',
                'id, price, date, order_status_id, package_status_id, tracking_number, master_city_id, source_name, shipping_cost, replace, master_cities(name), package_statuses(label), order_items(quantity, unit_price)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
            // Exclude exchange swap/return legs (replace=true) — not organic orders,
            // so they must not inflate order volume / value / delivered counts.
            return (rows as Array<{ replace?: boolean | null }>).filter(o => o.replace !== true);
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;
        const ordersTyped = orders as unknown as (AnalyticsOrder & { master_cities?: { name?: string } | null })[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));
        const total = filtered.length;
        // "Order value" = raw order total for volume metrics (not pure revenue — see §1).
        const avgOrderValue = total > 0 ? filtered.reduce((s, o) => s + Number(o.price || 0), 0) / total : 0;

        const deliveredCount = filtered.filter(o => isDelivered(o, deliveredPkgIds)).length;
        // Failed = cancelled + fake + double + blacklisted merged bucket (§4).
        const failedCount = filtered.filter(o => isFailed(o, cancelledIds)).length;

        // Confirmation-rate metric. Numerator = orders NOT in pending set
        // (new + postponed) OR with tracking. Denominator = total filtered.
        const rateConfirmedCount = filtered.filter(o => isRateConfirmed(o, pendingIds, trackedOrderIds)).length;

        // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
        const tracked = filtered.filter(o => !!o.id && trackedOrderIds.has(o.id));
        const pullback = tracked.filter(o =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - pullback.length;

        const confirmRate = total > 0 ? (rateConfirmedCount / total) * 100 : 0;
        const deliveryRate = deliveryDenom > 0 ? (deliveredCount / deliveryDenom) * 100 : 0;
        const failedRate = total > 0 ? (failedCount / total) * 100 : 0;

        // "Today" and "This week" are absolute reference chips — always
        // computed against ALL orders, never against the `filtered` window.
        // If the user picks "Last month", they still want to see how many
        // orders arrived today vs. in the past seven days for context.
        const today = new Date();
        const todayOrders = ordersTyped.filter(o => {
            const ts = placementTimestamp(o);
            return ts && format(ts, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
        }).length;
        const weekOrders = ordersTyped.filter(o => {
            const ts = placementTimestamp(o);
            return ts && isWithinInterval(ts, { start: subDays(today, 7), end: today });
        }).length;

        const rangeStart = dateFilter.from || (filtered.length > 0
            ? new Date(Math.min(...filtered.map(o => placementTimestamp(o)?.getTime() ?? Date.now())))
            : subMonths(today, 6));
        const rangeEnd = dateFilter.to || today;

        const diffDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
        let trendData: { label: string; orders: number }[];

        if (diffDays <= 31) {
            const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = days.map(day => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const dayOrders = filtered.filter(o => {
                    const ts = placementTimestamp(o);
                    return ts && format(ts, 'yyyy-MM-dd') === dayStr;
                });
                return { label: format(day, 'MMM d'), orders: dayOrders.length };
            });
        } else {
            const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = months.map(month => {
                const mStart = startOfMonth(month);
                const mEnd = endOfMonth(month);
                const monthOrders = filtered.filter(o => inWindow(placementTimestamp(o), mStart, mEnd));
                return { label: format(month, 'MMM yy'), orders: monthOrders.length };
            });
        }

        // Geography — group by master_city canonical (§13).
        const cityCounts: Record<string, number> = {};
        filtered.forEach(o => {
            const city = o.master_cities?.name;
            if (!city) return;
            cityCounts[city] = (cityCounts[city] || 0) + 1;
        });
        const topCities = Object.entries(cityCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([city, count]) => ({ city, count }));

        // Funnel = success path only: Total → Confirmed → Delivered. The
        // previous "New" stage (= total − touched) is zero for well-run
        // businesses (every order gets called), which made the first bar
        // empty and broke scaling. "Total" as the pool reads naturally and
        // makes the drop-off visible. Failed stays as a parallel tile.
        const funnelData = [
            { stage: 'Total orders', count: total },
            { stage: 'Confirmed', count: rateConfirmedCount },
            { stage: 'Delivered', count: deliveredCount },
        ];

        return {
            total,
            // Confirmed count = one-true-definition (yes was spoken).
            confirmedCount: rateConfirmedCount,
            deliveredCount, failedCount,
            confirmRate, deliveryRate, failedRate, avgOrderValue,
            todayOrders, weekOrders, trendData, topCities, funnelData,
        };
    }, [orders, dateFilter, cancelledIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, deliveredPkgIds]);

    return (
        <SectionWrapper
            id="orders"
            title="Orders"
            description="Order volume by placement date. Confirmation includes orders with a tracking number."
            icon={ShoppingBag}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const deliveryTone: 'positive' | 'warning' | 'negative' =
                    metrics.deliveryRate >= 50 ? 'positive' : metrics.deliveryRate >= 25 ? 'warning' : 'negative';
                const narrative = metrics.total === 0
                    ? 'No orders in this period.'
                    : `${metrics.total.toLocaleString('fr-MA')} orders came in. ${metrics.confirmedCount.toLocaleString('fr-MA')} confirmed (${metrics.confirmRate.toFixed(1)}% of touched) and ${metrics.deliveredCount.toLocaleString('fr-MA')} delivered (${metrics.deliveryRate.toFixed(1)}% delivery rate). ${
                        metrics.failedRate > 20
                            ? `${metrics.failedRate.toFixed(0)}% failed — worth investigating.`
                            : metrics.deliveryRate >= 60
                                ? 'Strong delivery conversion.'
                                : ''
                    }`;

                return (
                    <SectionStory
                        hero={{
                            label: 'total orders',
                            value: metrics.total.toLocaleString('fr-MA'),
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Today', value: metrics.todayOrders.toLocaleString('fr-MA') },
                            { label: 'This week', value: metrics.weekOrders.toLocaleString('fr-MA') },
                            { label: 'Confirmed', value: metrics.confirmedCount.toLocaleString('fr-MA'), sub: `${metrics.confirmRate.toFixed(1)}%` },
                            { label: 'Delivered', value: metrics.deliveredCount.toLocaleString('fr-MA'), sub: `${metrics.deliveryRate.toFixed(1)}%`, tone: deliveryTone },
                            { label: 'Failed', value: metrics.failedCount.toLocaleString('fr-MA'), sub: `${metrics.failedRate.toFixed(1)}%`, tone: metrics.failedRate > 15 ? 'negative' : 'neutral' },
                            { label: 'Avg order value', value: `${Math.round(metrics.avgOrderValue).toLocaleString('fr-MA')} MAD` },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Orders over time</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={140}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#141413" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#141413" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={32} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                    <Area type="monotone" dataKey="orders" stroke="#141413" fill="url(#colorOrders)" strokeWidth={1.75} name="Orders" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Order funnel</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {(() => {
                                    // Scale every bar to the widest stage so no
                                    // bar can overflow when an upstream stage is
                                    // smaller than a downstream one.
                                    const maxCount = Math.max(
                                        1,
                                        ...metrics.funnelData.map((s) => s.count),
                                    );
                                    return (
                                        <div className="space-y-3">
                                            {metrics.funnelData.map((stage, i) => {
                                                const prev = i > 0 ? metrics.funnelData[i - 1].count : null;
                                                const widthPct = (stage.count / maxCount) * 100;
                                                const convPct =
                                                    prev !== null && prev > 0
                                                        ? (stage.count / prev) * 100
                                                        : null;
                                                const prevLabel = i > 0 ? metrics.funnelData[i - 1].stage.toLowerCase() : '';
                                                return (
                                                    <div key={stage.stage} className="space-y-1">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-ant-mid">
                                                                {stage.stage}
                                                            </span>
                                                            <span className="font-display text-[14px] font-semibold text-ant-ink tabular-nums leading-none">
                                                                {stage.count.toLocaleString('fr-MA')}
                                                            </span>
                                                        </div>
                                                        <div className="h-2 rounded-full bg-ant-line-soft overflow-hidden">
                                                            <div
                                                                className="h-full bg-ant-ink rounded-full transition-[width] duration-500"
                                                                style={{ width: `${Math.max(widthPct, 1)}%` }}
                                                            />
                                                        </div>
                                                        {convPct !== null && (
                                                            <div className="text-[10px] text-ant-mid tabular-nums">
                                                                <span className="font-semibold text-ant-ink">
                                                                    {convPct.toFixed(1)}%
                                                                </span>
                                                                <span className="ml-1 italic font-serif text-ant-muted">
                                                                    of {prevLabel}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </CardContent>
                        </Card>

                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink flex items-center gap-2">
                                    <MapPin className="w-4 h-4" /> Top Cities
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1.5">
                                    {metrics.topCities.map((city, i) => (
                                        <div key={city.city} className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-ant-mid w-4 tabular-nums text-right">{i + 1}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center mb-0.5 gap-2">
                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{city.city}</span>
                                                    <span className="text-[11px] font-semibold text-ant-muted tabular-nums">{city.count}</span>
                                                </div>
                                                <div className="h-1 bg-ant-line rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-ant-ink to-ant-ink/70 rounded-full"
                                                        style={{ width: `${(city.count / (metrics.topCities[0]?.count || 1)) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {metrics.topCities.length === 0 && (
                                        <p className="text-[11px] text-ant-mid text-center py-2">No city data available</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
