import { useMemo } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Users,
} from 'lucide-react';
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
 * `customers` section of admin_analytics_stats (D3). Pool = replace-excluded
 * (a swap is not a new purchase), STRICT placement window. Customer key =
 * `normalize_phone_for_customer` server-side (byte-identical to the old client
 * `normalizePhone`); orders without a phone are skipped from every customer
 * metric. "New" = no order before the window start — the server scans the FULL
 * history for that, which is why this section could never be windowed naively.
 * Revenue replicates the old LIVE collapse: the client select carried no
 * order_items / raw_price / shipping_cost, so pureRevenueForOrder degenerated
 * to greatest(0, price) on paid+delivered — replicated byte-exactly rather
 * than silently "fixed" to the full chain. Cities count ALL windowed orders
 * (including phone-less ones) with an 'Unknown city' bucket, top 8.
 *
 * Trend: the server emits one PRE-DEDUPED new/returning series per grain
 * (trend / trend_week / trend_month) because distinct-customer counts are not
 * additive across days — this component picks the series matching its
 * granularity ladder and never sums day rows.
 */
export interface CustomersSlice {
    total_customers: number;
    /** Customers with more than one order INSIDE the window. */
    repeat_customers: number;
    repeat_rate: number;
    new_customers: number;
    returning_customers: number;
    avg_orders_per_customer: number;
    /** Avg LTV = Σ revenue ÷ customers. */
    avg_customer_value: number;
    total_customer_revenue: number;
    top_cities: Array<{ city: string; count: number }>;
    /**
     * Pre-deduped new/returning series, ONE per client grain. A distinct-customer
     * count is not additive, so the server owns the bucketing: within a bucket a
     * customer counts once (`new` iff not seen before the window AND the bucket
     * holds their first in-window day). `d` = the bucket's first day
     * (yyyy-MM-dd; weeks are Monday-start, matching startOfWeek weekStartsOn:1).
     */
    trend: Array<{ d: string; new: number; returning: number }>;
    trend_week: Array<{ d: string; new: number; returning: number }>;
    trend_month: Array<{ d: string; new: number; returning: number }>;
}

interface CustomersSectionProps {
    dateFilter: DateFilter;
    stats?: CustomersSlice | null;
}

export const CustomersSection = ({ dateFilter, stats }: CustomersSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        const regionData = stats.top_cities.map(c => ({ region: c.city, count: c.count }));

        // ── Trend (adaptive: day / week / month) ──
        // Auto-pick granularity by window length and clamp each bucket's
        // [start, end] to the user-selected range. Anchor range to the
        // earliest day carrying customers on All-Time.
        const earliest = stats.trend.length
            ? parseISO(stats.trend.reduce((min, r) => (r.d < min ? r.d : min), stats.trend[0].d))
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


        // New/returning trend: read the server's PRE-DEDUPED series for this
        // grain — never sum day rows (distinct-customer counts are not additive:
        // a customer active on k days in one bucket would be counted k times as
        // `returning`). The bucket key is the bucket's first day, which is
        // exactly what date_trunc('week'|'month') emits server-side.
        const series =
            granularity === 'monthly' ? stats.trend_month
                : granularity === 'weekly' ? stats.trend_week
                    : stats.trend;
        const byBucket = new Map((series || []).map(r => [r.d, r]));
        const bucketKey = (anchor: Date): string => {
            if (granularity === 'monthly') return format(startOfMonth(anchor), 'yyyy-MM-dd');
            if (granularity === 'weekly') return format(startOfWeek(anchor, { weekStartsOn: 1 }), 'yyyy-MM-dd');
            return format(startOfDay(anchor), 'yyyy-MM-dd');
        };
        const trendData = intervals.map((anchor) => {
            const row = byBucket.get(bucketKey(anchor));
            return {
                month: format(anchor, labelFormat),
                new: row?.new ?? 0,
                returning: row?.returning ?? 0,
            };
        });

        return {
            totalCustomers: stats.total_customers,
            repeatCustomers: stats.repeat_customers,
            repeatRate: stats.repeat_rate,
            avgOrdersPerCustomer: stats.avg_orders_per_customer,
            avgCustomerValue: stats.avg_customer_value,
            totalCustomerRevenue: stats.total_customer_revenue,
            newCustomersInWindow: stats.new_customers,
            returningCustomersInWindow: stats.returning_customers,
            regionData, trendData,
        };
    }, [stats, dateFilter]);

    return (
        <SectionWrapper
            id="customers"
            title="Customers"
            description="Customers keyed by phone number. New = first-ever order in this window."
            icon={Users}
            iconColor="text-ant-mid"
            loading={!stats}
        >
            {metrics && (() => {
                const rateTone: 'positive' | 'warning' | 'negative' =
                    metrics.repeatRate >= 30 ? 'positive' : metrics.repeatRate >= 15 ? 'warning' : 'negative';
                const narrative = metrics.totalCustomers === 0
                    ? 'No customer activity in this period.'
                    : `${metrics.repeatCustomers.toLocaleString('fr-MA')} of ${metrics.totalCustomers.toLocaleString('fr-MA')} customers came back (${metrics.repeatRate.toFixed(1)}% repeat rate). Each customer spends ${metrics.avgCustomerValue.toFixed(0)} MAD on average across ${metrics.avgOrdersPerCustomer.toFixed(1)} orders. ${
                          metrics.repeatRate < 15
                              ? 'Retention is low — consider a loyalty loop.'
                              : metrics.repeatRate >= 30
                                  ? 'Strong retention.'
                                  : ''
                      }`;

                return (
                    <SectionStory
                        hero={{
                            label: 'repeat rate',
                            value: `${metrics.repeatRate.toFixed(1)}%`,
                            tone: rateTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Customers', value: metrics.totalCustomers.toLocaleString('fr-MA') },
                            { label: 'New', value: metrics.newCustomersInWindow.toLocaleString('fr-MA'), tone: 'positive' },
                            { label: 'Returning', value: metrics.returningCustomersInWindow.toLocaleString('fr-MA') },
                            { label: 'Orders / cust', value: metrics.avgOrdersPerCustomer.toFixed(1) },
                            { label: 'Avg LTV', value: `${Math.round(metrics.avgCustomerValue).toLocaleString('fr-MA')} MAD` },
                            { label: 'Revenue', value: `${Math.round(metrics.totalCustomerRevenue).toLocaleString('fr-MA')} MAD` },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">New vs returning</CardTitle>
                                <div className="flex items-center gap-2.5 text-[10px] text-ant-muted">
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#141413]" /> New</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#788c5d]" /> Returning</span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={140}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorNew" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#141413" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#141413" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorReturning" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#788c5d" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#788c5d" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={32} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                    <Area type="monotone" dataKey="new" stroke="#141413" fill="url(#colorNew)" strokeWidth={1.75} name="New" stackId="1" dot={false} />
                                    <Area type="monotone" dataKey="returning" stroke="#788c5d" fill="url(#colorReturning)" strokeWidth={1.75} name="Returning" stackId="1" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Top cities</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1.5">
                                {metrics.regionData.map((row, i) => {
                                    const max = metrics.regionData[0]?.count || 1;
                                    const pct = (row.count / max) * 100;
                                    return (
                                        <div key={row.region} className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-ant-mid w-5 text-right tabular-nums">{i + 1}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{row.region}</span>
                                                    <span className="text-[11px] font-semibold text-ant-ink/80 tabular-nums">{row.count}</span>
                                                </div>
                                                <div className="h-1 bg-ant-line rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-ant-ink/60 rounded-full transition-all duration-500"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {metrics.regionData.length === 0 && (
                                    <p className="text-[11px] text-ant-mid text-center py-2">No city data yet</p>
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
