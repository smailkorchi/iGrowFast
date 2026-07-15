import { useMemo } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    ShoppingBag, MapPin,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, parseISO } from 'date-fns';

/**
 * `orders` section of admin_analytics_stats (D3). Pool = replace-excluded
 * (exchange legs are not organic orders), STRICT placement window, Casablanca
 * days. `avg_order_value` is the mean of the raw `orders.price` (customer-paid
 * total — deliberately NOT pureRevenue: this is a volume metric). Rates are
 * UNCLAMPED, matching the old client (the dashboard KPI clamp does not apply
 * on this page). `today_orders` / `week_orders` are window-INDEPENDENT chips
 * computed server-side over the unwindowed pool. Cities with no master_cities
 * name are skipped (no 'Unknown' bucket — deviates from Customers, as before).
 * `trend` is day-bucketed; this section re-buckets it on its own 2-tier ladder
 * (≤31d daily, else monthly — no weekly tier, unlike every other section).
 */
export interface OrdersSlice {
    total: number;
    /** isRateConfirmed: tracked OR (a pending status exists AND status set AND not pending). */
    confirmed: number;
    delivered: number;
    /** Merged cancelled/fake/double/blacklisted bucket. */
    failed: number;
    confirm_rate: number;
    /** Coliaty delivery denominator: tracked − admin-pullback. */
    delivery_denom: number;
    delivery_rate: number;
    failed_rate: number;
    avg_order_value: number;
    today_orders: number;
    week_orders: number;
    top_cities: Array<{ city: string; count: number }>;
    trend: Array<{ d: string; orders: number }>;
}

interface OrdersSectionProps {
    dateFilter: DateFilter;
    stats?: OrdersSlice | null;
}

export const OrdersSection = ({ dateFilter, stats }: OrdersSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        const ordersByDay = new Map(stats.trend.map(r => [r.d, r.orders]));

        // All-Time → anchor to the earliest day that actually carries orders
        // (the old client anchored to the earliest placement instant of the
        // filtered pool; day-resolution is the accepted D3 delta).
        const today = new Date();
        const earliest = stats.trend.length
            ? parseISO(stats.trend.reduce((min, r) => (r.d < min ? r.d : min), stats.trend[0].d))
            : subMonths(today, 6);
        const rangeStart = dateFilter.from || earliest;
        const rangeEnd = dateFilter.to || today;

        // Sum a day-keyed map over a bucket's calendar days. Bucket bounds stay
        // UNCLAMPED (as before): the map only holds in-window days, so a full
        // calendar month can never pull an out-of-window day in.
        const sumDays = (start: Date, end: Date) =>
            eachDayOfInterval({ start, end }).reduce(
                (s, d) => s + (ordersByDay.get(format(d, 'yyyy-MM-dd')) || 0),
                0,
            );

        const diffDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));
        let trendData: { label: string; orders: number }[];

        if (diffDays <= 31) {
            const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = days.map(day => ({
                label: format(day, 'MMM d'),
                orders: ordersByDay.get(format(day, 'yyyy-MM-dd')) || 0,
            }));
        } else {
            const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            trendData = months.map(month => ({
                label: format(month, 'MMM yy'),
                orders: sumDays(startOfMonth(month), endOfMonth(month)),
            }));
        }

        // Funnel = success path only: Total → Confirmed → Delivered. The
        // previous "New" stage (= total − touched) is zero for well-run
        // businesses (every order gets called), which made the first bar
        // empty and broke scaling. "Total" as the pool reads naturally and
        // makes the drop-off visible. Failed stays as a parallel tile.
        const funnelData = [
            { stage: 'Total orders', count: stats.total },
            { stage: 'Confirmed', count: stats.confirmed },
            { stage: 'Delivered', count: stats.delivered },
        ];

        return {
            total: stats.total,
            // Confirmed count = one-true-definition (yes was spoken).
            confirmedCount: stats.confirmed,
            deliveredCount: stats.delivered,
            failedCount: stats.failed,
            confirmRate: stats.confirm_rate,
            deliveryRate: stats.delivery_rate,
            failedRate: stats.failed_rate,
            avgOrderValue: stats.avg_order_value,
            todayOrders: stats.today_orders,
            weekOrders: stats.week_orders,
            topCities: stats.top_cities,
            trendData,
            funnelData,
        };
    }, [stats, dateFilter]);

    return (
        <SectionWrapper
            id="orders"
            title="Orders"
            description="Order volume by placement date. Confirmation includes orders with a tracking number."
            icon={ShoppingBag}
            iconColor="text-ant-mid"
            loading={!stats}
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
