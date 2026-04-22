import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import {
    AnalyticsOrder,
    inWindow,
    isAdminPullback,
    isDelivered,
    isRateConfirmed,
    isRateTouched,
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
    format, startOfDay, endOfDay, eachMonthOfInterval, startOfMonth, endOfMonth, subMonths, differenceInDays,
} from 'date-fns';

interface BusinessHealthSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const BusinessHealthSection = ({ businessId, dateFilter }: BusinessHealthSectionProps) => {
    const { confirmedIds, cancelledIds, deliveredPkgIds, paidOrderIds, newOrderIds, unreachedOrderIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-health-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, package_status_label, package_statuses(label, category), tracking_number, confirmation_date, order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)',
                )
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;
        const ordersTyped = orders as unknown as (AnalyticsOrder & { confirmation_date?: string | null })[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        const datesWithOrders = filtered
            .map(o => placementTimestamp(o))
            .filter((d): d is Date => !!d);
        const minDate = datesWithOrders.length > 0 ? new Date(Math.min(...datesWithOrders.map(d => d.getTime()))) : new Date();
        const maxDate = datesWithOrders.length > 0 ? new Date(Math.max(...datesWithOrders.map(d => d.getTime()))) : new Date();
        const daySpan = Math.max(1, differenceInDays(maxDate, minDate));
        const orderVelocity = filtered.length / daySpan;

        // ── Rates under the locked rules ────────────────────────────────
        // Delivered = package category or label match. No "must be paid" private rule.
        const delivered = filtered.filter(o => isDelivered(o, deliveredPkgIds));
        // Confirmation-rate metric: numerator counts every order where a yes was
        // spoken (all categories except `new` and `callback`); denominator is
        // "touched" (total minus `new`). Unreached orders still drag the rate.
        const rateConfirmedCount = filtered.filter(o => isRateConfirmed(o, newOrderIds, unreachedOrderIds, trackedOrderIds)).length;
        const rateTouchedCount = filtered.filter(o => isRateTouched(o, newOrderIds, trackedOrderIds)).length;
        const confirmRate = rateTouchedCount > 0 ? (rateConfirmedCount / rateTouchedCount) * 100 : 0;
        // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
        const tracked = filtered.filter(o => !!o.id && trackedOrderIds.has(o.id));
        const pullback = tracked.filter(o =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - pullback.length;
        const deliveryRate = deliveryDenom > 0 ? (delivered.length / deliveryDenom) * 100 : 0;

        // Revenue (pure, paid+delivered) for trend only — not a health metric, but shown as context.
        const revenueOrders = filtered.filter(o => isRevenueOrder(o, deliveredPkgIds, paidOrderIds));
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

        // ── Monthly trend — revenue + confirm/delivery rate (no composite score).
        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = endOfMonth(month);
            const monthOrders = filtered.filter(o => inWindow(placementTimestamp(o), mStart, mEnd));
            const monthRateTouched = monthOrders.filter(o => isRateTouched(o, newOrderIds, trackedOrderIds));
            const monthRateConfirmed = monthOrders.filter(o => isRateConfirmed(o, newOrderIds, unreachedOrderIds, trackedOrderIds));
            const monthDelivered = monthOrders.filter(o => isDelivered(o, deliveredPkgIds));
            const monthTracked = monthOrders.filter(o => !!o.id && trackedOrderIds.has(o.id));
            const monthPullback = monthTracked.filter(o =>
                isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
            );
            const monthDeliveryDenom = monthTracked.length - monthPullback.length;
            const monthRevenue = monthOrders
                .filter(o => isRevenueOrder(o, deliveredPkgIds, paidOrderIds))
                .reduce((s, o) => s + pureRevenueForOrder(o), 0);

            return {
                month: format(month, 'MMM yy'),
                revenue: monthRevenue,
                confirmRate: monthRateTouched.length > 0 ? (monthRateConfirmed.length / monthRateTouched.length) * 100 : 0,
                deliveryRate: monthDeliveryDenom > 0 ? (monthDelivered.length / monthDeliveryDenom) * 100 : 0,
            };
        });

        let revenueGrowth = 0;
        if (trendData.length >= 2) {
            const lastMonth = trendData[trendData.length - 1].revenue;
            const prevMonth = trendData[trendData.length - 2].revenue;
            revenueGrowth = prevMonth > 0 ? ((lastMonth - prevMonth) / prevMonth) * 100 : 0;
        }

        return {
            orderVelocity,
            totalRevenue,
            confirmRate,
            deliveryRate,
            avgConfirmTime,
            hasConfirmTimeData: withConfDate.length > 0,
            failedCount,
            revenueGrowth,
            trendData,
            totalOrders: filtered.length,
            // Confirmed count = one-true-definition (yes was spoken).
            confirmedCount: rateConfirmedCount,
            deliveredCount: delivered.length,
            touchedCount: rateTouchedCount,
        };
    }, [orders, dateFilter, cancelledIds, deliveredPkgIds, paidOrderIds, newOrderIds, unreachedOrderIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds]);

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
                            { label: 'Growth', value: `${metrics.revenueGrowth >= 0 ? '+' : ''}${metrics.revenueGrowth.toFixed(1)}%`, tone: metrics.revenueGrowth >= 0 ? 'positive' : 'negative' },
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
