import { useMemo } from 'react';
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
    parseISO,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';

/**
 * `health` section of admin_analytics_stats (D3). Pool = STRICT placement
 * window with exchange legs KEPT (rates count real parcels); revenue
 * re-excludes them inline and is paid-gated AND placement-windowed — it
 * deliberately deviates from the P&L's delivery anchor, exactly as the old
 * client did. Rates are UNCLAMPED. `velocity_day_span` is the server-resolved
 * divisor (explicit window → window days; All-Time → min..max placement span;
 * min 1). `trend` is day-bucketed with raw components (not rates), so this
 * section re-buckets to its 3-tier grain and derives the rates per bucket —
 * a rate can never be averaged from day rates.
 */
export interface HealthSlice {
    total: number;
    confirmed: number;
    delivered: number;
    failed: number;
    confirm_rate: number;
    /** Coliaty delivery denominator: tracked − admin-pullback. */
    delivery_denom: number;
    delivery_rate: number;
    /** Mean of max(0, confirmation_date − date) in hours; null when no row has both. */
    avg_confirm_hours: number | null;
    confirm_time_count: number;
    total_revenue: number;
    velocity_day_span: number;
    /** Casablanca placement day bounds of the windowed pool; null on an empty pool. */
    min_day: string | null;
    max_day: string | null;
    trend: Array<{
        d: string;
        total: number;
        confirmed: number;
        delivered: number;
        /** Per-day Coliaty denominator (tracked − pullback). */
        denom: number;
        revenue: number;
    }>;
}

interface BusinessHealthSectionProps {
    dateFilter: DateFilter;
    stats?: HealthSlice | null;
}

export const BusinessHealthSection = ({ dateFilter, stats }: BusinessHealthSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        // Velocity = orders per day over the server-resolved span (explicit
        // window → window days; All-Time → the data's own min..max span,
        // because dividing by "years since epoch" would reach infinity).
        const orderVelocity = stats.total / Math.max(1, stats.velocity_day_span);

        const confirmRate = stats.confirm_rate;
        const deliveryRate = stats.delivery_rate;
        const totalRevenue = stats.total_revenue;
        const avgConfirmTime = stats.avg_confirm_hours ?? 0;
        const failedCount = stats.failed;

        // ── Trend (adaptive: day / week / month) ──
        // Auto-pick granularity from window length and clamp each bucket's
        // [start, end] to the user-selected range. Anchor range to the
        // earliest order day on All-Time instead of a fixed 6-month fallback.
        const byDay = new Map(stats.trend.map(r => [r.d, r]));
        const earliest = stats.min_day ? parseISO(stats.min_day) : subMonths(new Date(), 6);
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

        // Rates are rebuilt from summed components per bucket — never averaged
        // from the day-level rates.
        const trendData = intervals.map((anchor) => {
            const { start, end } = bucketBounds(anchor);
            const rows = eachDayOfInterval({ start, end })
                .map(d => byDay.get(format(d, 'yyyy-MM-dd')))
                .filter((r): r is HealthSlice['trend'][number] => !!r);

            const bTotal = rows.reduce((s, r) => s + r.total, 0);
            const bConfirmed = rows.reduce((s, r) => s + r.confirmed, 0);
            const bDelivered = rows.reduce((s, r) => s + r.delivered, 0);
            const bDeliveryDenom = rows.reduce((s, r) => s + r.denom, 0);
            const bRevenue = rows.reduce((s, r) => s + r.revenue, 0);

            return {
                month: format(anchor, labelFormat),
                revenue: bRevenue,
                confirmRate: bTotal > 0 ? (bConfirmed / bTotal) * 100 : 0,
                deliveryRate: bDeliveryDenom > 0 ? (bDelivered / bDeliveryDenom) * 100 : 0,
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
            hasConfirmTimeData: stats.confirm_time_count > 0,
            failedCount,
            revenueGrowth,
            growthBucketLabel,
            trendData,
            totalOrders: stats.total,
            // Confirmed count = one-true-definition (yes was spoken).
            confirmedCount: stats.confirmed,
            deliveredCount: stats.delivered,
            touchedCount: stats.total,
        };
    }, [stats, dateFilter]);

    return (
        <SectionWrapper
            id="business-health"
            title="Business Health"
            description="Raw confirmation rate, delivery rate, and speed — no composite score"
            icon={Activity}
            iconColor="text-ant-mid"
            loading={!stats}
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
