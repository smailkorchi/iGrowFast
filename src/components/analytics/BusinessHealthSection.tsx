import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import {
    AnalyticsOrder,
    inWindow,
    isAdminPullback,
    isDelivered,
    isRateConfirmed,
    isRevenueOrder,
    placementTimestamp,
    pureRevenueForOrder,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
    differenceInDays,
    eachDayOfInterval,
    eachMonthOfInterval,
    eachWeekOfInterval,
    endOfDay,
    endOfMonth,
    endOfWeek,
    format,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';

interface BusinessHealthSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const BusinessHealthSection = ({ businessId, dateFilter }: BusinessHealthSectionProps) => {
    const { confirmedIds, cancelledIds, deliveredPkgIds, paidOrderIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-health-v2', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, replace, package_statuses(label), confirmation_date, order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)',
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
        const ordersTyped = orders as unknown as (AnalyticsOrder & { confirmation_date?: string | null })[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        // Velocity = orders per day. Divide by the WINDOW length when the
        // user picked an explicit window — otherwise a 30-day filter with
        // orders clustered in the last 3 days would report 10× the real
        // daily rate. All-Time falls back to the data span (min → max)
        // because dividing by "years since Date(0)" would reach infinity.
        const datesWithOrders = filtered
            .map(o => placementTimestamp(o))
            .filter((d): d is Date => !!d);
        const hasExplicitWindow = !!dateFilter.from || !!dateFilter.to;
        let daySpan = 1;
        if (hasExplicitWindow) {
            daySpan = Math.max(1, differenceInDays(windowEnd, windowStart) + 1);
        } else if (datesWithOrders.length > 0) {
            const minDate = new Date(Math.min(...datesWithOrders.map((d) => d.getTime())));
            const maxDate = new Date(Math.max(...datesWithOrders.map((d) => d.getTime())));
            daySpan = Math.max(1, differenceInDays(maxDate, minDate) + 1);
        }
        const orderVelocity = filtered.length / daySpan;

        // ── Rates under the locked rules ────────────────────────────────
        // Delivered = package category or label match. No "must be paid" private rule.
        const delivered = filtered.filter(o => isDelivered(o, deliveredPkgIds));
        // Confirmation-rate metric: numerator counts orders NOT in pending
        // (new + postponed) OR with tracking; denominator = total filtered.
        const rateConfirmedCount = filtered.filter(o => isRateConfirmed(o, pendingIds, trackedOrderIds)).length;
        const rateTouchedCount = filtered.length;
        const confirmRate = rateTouchedCount > 0 ? (rateConfirmedCount / rateTouchedCount) * 100 : 0;
        // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
        const tracked = filtered.filter(o => !!o.id && trackedOrderIds.has(o.id));
        const pullback = tracked.filter(o =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - pullback.length;
        const deliveryRate = deliveryDenom > 0 ? (delivered.length / deliveryDenom) * 100 : 0;

        // Revenue (pure, paid+delivered) for trend only — not a health metric, but shown as context.
        // Exclude exchange swap/return legs (replace=true): rates keep them (real
        // parcels) but a swap is not a sale, so revenue must match the P&L.
        const revenueOrders = filtered.filter(o => o.replace !== true && isRevenueOrder(o, deliveredPkgIds, paidOrderIds));
        const totalRevenue = revenueOrders.reduce((s, o) => s + pureRevenueForOrder(o), 0);

        const withConfDate = filtered.filter(o => o.date && o.confirmation_date);
        const avgConfirmTime = withConfDate.length > 0
            ? withConfDate.reduce((s, o) => {
                const hrs = (new Date(o.confirmation_date!).getTime() - new Date(o.date!).getTime()) / (1000 * 60 * 60);
                return s + Math.max(0, hrs);
            }, 0) / withConfDate.length
            : 0;

        // Failed orders merged bucket (cancelled/fake/blacklisted/double).
        const failedCount = filtered.filter(o => o.order_status_id && cancelledIds.has(o.order_status_id)).length;

        // ── Trend (adaptive: day / week / month) ──
        // Auto-pick granularity from window length and clamp each bucket's
        // [start, end] to the user-selected range. Anchor range to the
        // earliest order timestamp on All-Time instead of a fixed 6-month
        // fallback. Prior behaviour always used monthly buckets sampled
        // at raw calendar bounds — "Today" filter rendered one monthly
        // bucket summing the whole month.
        const allTimestamps: number[] = [];
        ordersTyped.forEach(o => {
            const t = placementTimestamp(o)?.getTime();
            if (t) allTimestamps.push(t);
        });
        const earliest = allTimestamps.length
            ? new Date(Math.min(...allTimestamps))
            : subMonths(new Date(), 6);
        const rangeStart = dateFilter.from ? startOfDay(dateFilter.from) : startOfDay(earliest);
        const rangeEnd = dateFilter.to ? endOfDay(dateFilter.to) : endOfDay(new Date());
        const rangeDays = Math.max(0, differenceInDays(rangeEnd, rangeStart));

        type Granularity = 'daily' | 'weekly' | 'monthly';
        const granularity: Granularity =
            rangeDays <= 31 ? 'daily' : rangeDays <= 120 ? 'weekly' : 'monthly';

        let intervals: Date[];
        let labelFormat: string;
        if (granularity === 'monthly') {
            intervals = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            labelFormat = 'MMM yy';
        } else if (granularity === 'weekly') {
            intervals = eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 1 });
            labelFormat = 'MMM d';
        } else {
            intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            labelFormat = rangeDays <= 14 ? 'EEE d' : 'MMM d';
        }

        const bucketBounds = (anchor: Date): { start: Date; end: Date } => {
            let s: Date;
            let e: Date;
            if (granularity === 'monthly') {
                s = startOfMonth(anchor);
                e = endOfMonth(anchor);
            } else if (granularity === 'weekly') {
                s = startOfWeek(anchor, { weekStartsOn: 1 });
                e = endOfWeek(anchor, { weekStartsOn: 1 });
            } else {
                s = startOfDay(anchor);
                e = endOfDay(anchor);
            }
            if (s.getTime() < rangeStart.getTime()) s = rangeStart;
            if (e.getTime() > rangeEnd.getTime()) e = rangeEnd;
            return { start: s, end: e };
        };

        const trendData = intervals.map((anchor) => {
            const { start, end } = bucketBounds(anchor);
            const bucketOrders = filtered.filter(o => inWindow(placementTimestamp(o), start, end));
            const bTouched = bucketOrders; // denominator = bucket total
            const bConfirmed = bucketOrders.filter(o => isRateConfirmed(o, pendingIds, trackedOrderIds));
            const bDelivered = bucketOrders.filter(o => isDelivered(o, deliveredPkgIds));
            const bTracked = bucketOrders.filter(o => !!o.id && trackedOrderIds.has(o.id));
            const bPullback = bTracked.filter(o =>
                isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
            );
            const bDeliveryDenom = bTracked.length - bPullback.length;
            const bRevenue = bucketOrders
                .filter(o => o.replace !== true && isRevenueOrder(o, deliveredPkgIds, paidOrderIds))
                .reduce((s, o) => s + pureRevenueForOrder(o), 0);

            return {
                month: format(anchor, labelFormat),
                revenue: bRevenue,
                confirmRate: bTouched.length > 0 ? (bConfirmed.length / bTouched.length) * 100 : 0,
                deliveryRate: bDeliveryDenom > 0 ? (bDelivered.length / bDeliveryDenom) * 100 : 0,
            };
        });

        let revenueGrowth = 0;
        if (trendData.length >= 2) {
            const last = trendData[trendData.length - 1].revenue;
            const prev = trendData[trendData.length - 2].revenue;
            revenueGrowth = prev > 0 ? ((last - prev) / prev) * 100 : 0;
        }
        const growthBucketLabel: 'day' | 'week' | 'month' =
            granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';

        return {
            orderVelocity,
            totalRevenue,
            confirmRate,
            deliveryRate,
            avgConfirmTime,
            hasConfirmTimeData: withConfDate.length > 0,
            failedCount,
            revenueGrowth,
            growthBucketLabel,
            trendData,
            totalOrders: filtered.length,
            // Confirmed count = one-true-definition (yes was spoken).
            confirmedCount: rateConfirmedCount,
            deliveredCount: delivered.length,
            touchedCount: rateTouchedCount,
        };
    }, [orders, dateFilter, cancelledIds, deliveredPkgIds, paidOrderIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds]);

    return (
        <SectionWrapper
            id="business-health"
            title="Business Health"
            description="Raw confirmation rate, delivery rate, and speed — no composite score"
            icon={Activity}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const deliveryTone: 'positive' | 'warning' | 'negative' =
                    metrics.deliveryRate >= 70 ? 'positive' : metrics.deliveryRate >= 40 ? 'warning' : 'negative';
                const narrative = metrics.totalOrders === 0
                    ? 'No orders in this window — nothing to score yet.'
                    : `${metrics.deliveredCount.toLocaleString('fr-MA')} of ${metrics.confirmedCount.toLocaleString('fr-MA')} confirmed orders delivered (${metrics.deliveryRate.toFixed(1)}%). ${metrics.confirmRate.toFixed(1)}% of touched orders get confirmed. ${
                        metrics.hasConfirmTimeData
                            ? `Average time to confirm: ${metrics.avgConfirmTime.toFixed(1)} hours.`
                            : 'No confirmation timestamps on file yet.'
                    } ${
                        metrics.revenueGrowth > 0
                            ? `Revenue up ${metrics.revenueGrowth.toFixed(1)}% vs prior period.`
                            : metrics.revenueGrowth < 0
                                ? `Revenue down ${Math.abs(metrics.revenueGrowth).toFixed(1)}% vs prior period.`
                                : ''
                    }`;

                return (
                    <SectionStory
                        hero={{
                            label: 'delivery rate',
                            value: `${metrics.deliveryRate.toFixed(1)}%`,
                            tone: deliveryTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Confirm rate', value: `${metrics.confirmRate.toFixed(1)}%` },
                            { label: 'Avg confirm speed', value: metrics.hasConfirmTimeData ? `${metrics.avgConfirmTime.toFixed(1)}h` : '—' },
                            { label: 'Orders', value: metrics.totalOrders.toLocaleString('fr-MA') },
                            { label: 'Delivered', value: metrics.deliveredCount.toLocaleString('fr-MA'), tone: 'positive' },
                            { label: 'Failed', value: metrics.failedCount.toLocaleString('fr-MA'), tone: metrics.failedCount > 0 ? 'negative' : 'neutral' },
                            { label: 'Velocity', value: `${metrics.orderVelocity.toFixed(1)}/day` },
                            { label: 'Revenue', value: `${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD` },
                            { label: 'Growth', value: `${metrics.revenueGrowth >= 0 ? '+' : ''}${metrics.revenueGrowth.toFixed(1)}%`, sub: `vs prior ${metrics.growthBucketLabel}`, tone: metrics.revenueGrowth >= 0 ? 'positive' : 'negative' },
                        ]}
                    >
                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <CardTitle className="text-[12px] font-semibold text-ant-ink">Revenue + conversion rates</CardTitle>
                                    <div className="flex items-center gap-2.5 text-[10px] text-ant-muted">
                                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#788c5d]" /> Revenue</span>
                                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#141413]" /> Confirm %</span>
                                        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#d97757]" /> Delivery %</span>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={160}>
                                    <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="colorBizRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#788c5d" stopOpacity={0.22} />
                                                <stop offset="95%" stopColor="#788c5d" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                        <YAxis yAxisId="revenue" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                                        <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={28} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                        <Area yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#788c5d" fill="url(#colorBizRevenue)" strokeWidth={1.75} name="Revenue" dot={false} />
                                        <Area yAxisId="rate" type="monotone" dataKey="confirmRate" stroke="#141413" fill="none" strokeWidth={1.5} name="Confirm %" dot={false} />
                                        <Area yAxisId="rate" type="monotone" dataKey="deliveryRate" stroke="#d97757" fill="none" strokeWidth={1.5} strokeDasharray="4 3" name="Delivery %" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
