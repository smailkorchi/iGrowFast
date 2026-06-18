import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Users, UserPlus, Repeat, DollarSign, MapPin,
    TrendingUp, Heart, BarChart3,
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
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';
import {
    AnalyticsOrder,
    inWindow,
    isRevenueOrder,
    normalizePhone,
    placementTimestamp,
    pureRevenueForOrder,
} from '@/lib/analyticsDefinitions';
import { useStatusCategories } from '@/hooks/useStatusCategories';

const COLORS = ['#141413', '#d97757', '#8d8b84', '#6a9bcc', '#788c5d', '#c96356', '#b0aea5', '#2a2926'];

interface CustomersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const CustomersSection = ({ businessId, dateFilter }: CustomersSectionProps) => {
    const { deliveredPkgIds, paidOrderIds } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-customers', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, phone, name, price, date, order_status_id, package_status_id, master_city_id, master_cities(name, region)',
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
        const ordersTyped = orders as unknown as (AnalyticsOrder & { phone?: string | null; name?: string | null; master_cities?: { name?: string; region?: string } | null })[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        // Customer key = normalized phone (§11). Orders without a phone are skipped
        // from customer metrics entirely (they can't be reliably deduplicated).
        const keyFor = (o: typeof ordersTyped[number]) => normalizePhone(o.phone);

        // Build the set of customers who EVER ordered before this window opened,
        // for the "new customer" rule: no prior orders before the window start.
        const customersSeenBefore = new Set<string>();
        ordersTyped.forEach(o => {
            const ts = placementTimestamp(o);
            if (!ts || ts >= windowStart) return;
            const k = keyFor(o);
            if (k) customersSeenBefore.add(k);
        });

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        // `orders` tracks every placed order (intent signal — drives repeat
        // rate and orders-per-customer). `revenue` only accrues on paid +
        // delivered orders so Avg LTV / Revenue tiles reconcile with the
        // P&L revenue contract. Previously every order contributed revenue,
        // including cancelled / fake / pending ones, which inflated LTV.
        const customerMap: Record<string, { orders: number; revenue: number }> = {};
        filtered.forEach(o => {
            const key = keyFor(o);
            if (!key) return;
            if (!customerMap[key]) customerMap[key] = { orders: 0, revenue: 0 };
            customerMap[key].orders++;
            if (isRevenueOrder(o, deliveredPkgIds, paidOrderIds)) {
                customerMap[key].revenue += pureRevenueForOrder(o);
            }
        });

        const customers = Object.values(customerMap);
        const totalCustomers = customers.length;
        const repeatCustomers = customers.filter(c => c.orders > 1).length;
        const repeatRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
        const avgOrdersPerCustomer = totalCustomers > 0 ? customers.reduce((s, c) => s + c.orders, 0) / totalCustomers : 0;
        const avgCustomerValue = totalCustomers > 0 ? customers.reduce((s, c) => s + c.revenue, 0) / totalCustomers : 0;
        const totalCustomerRevenue = customers.reduce((s, c) => s + c.revenue, 0);

        // New in window = has window order AND wasn't seen before window start.
        const newCustomersInWindow = Object.keys(customerMap).filter(k => !customersSeenBefore.has(k)).length;
        const returningCustomersInWindow = totalCustomers - newCustomersInWindow;

        // Geography — master_city canonical name (§13).
        // Trim whitespace; orders with no resolvable city bucket under "Unknown city"
        // so the chart never has a blank/empty label.
        const regionCounts: Record<string, number> = {};
        filtered.forEach(o => {
            const raw = (o.master_cities?.name || o.master_cities?.region || '').trim();
            const region = raw || 'Unknown city';
            regionCounts[region] = (regionCounts[region] || 0) + 1;
        });
        const regionData = Object.entries(regionCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([region, count]) => ({ region, count }));

        // ── Trend (adaptive: day / week / month) ──
        // Auto-pick granularity by window length and clamp each bucket's
        // [start, end] to the user-selected range. Anchor range to the
        // earliest order timestamp on All-Time. Prior behaviour always used
        // monthly buckets with a fixed 6-month fallback, so "Today" filters
        // collapsed to a single monthly point.
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

        // New/returning trend: walk buckets forward, tracking who was seen
        // BEFORE this bucket (from `customersSeenBefore`) plus the cumulative
        // "seen" set across prior buckets in the range. The walk-order is
        // what matters — granularity is irrelevant to the classification.
        const seenInPriorBuckets = new Set<string>(customersSeenBefore);
        const trendData = intervals.map((anchor) => {
            const { start, end } = bucketBounds(anchor);
            const bucketOrders = filtered.filter(o => inWindow(placementTimestamp(o), start, end));

            let newCount = 0;
            let returningCount = 0;
            const bucketCustomers = new Set<string>();
            bucketOrders.forEach(o => {
                const key = keyFor(o);
                if (!key || bucketCustomers.has(key)) return;
                bucketCustomers.add(key);
                if (seenInPriorBuckets.has(key)) {
                    returningCount++;
                } else {
                    newCount++;
                    seenInPriorBuckets.add(key);
                }
            });

            return {
                month: format(anchor, labelFormat),
                new: newCount,
                returning: returningCount,
            };
        });

        return {
            totalCustomers, repeatCustomers, repeatRate,
            avgOrdersPerCustomer, avgCustomerValue, totalCustomerRevenue,
            newCustomersInWindow, returningCustomersInWindow,
            regionData, trendData,
        };
    }, [orders, dateFilter, deliveredPkgIds, paidOrderIds]);

    return (
        <SectionWrapper
            id="customers"
            title="Customers"
            description="Customers keyed by phone number. New = first-ever order in this window."
            icon={Users}
            iconColor="text-ant-mid"
            loading={isLoading}
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
