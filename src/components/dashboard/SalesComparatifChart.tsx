import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import {
    differenceInDays,
    eachDayOfInterval,
    eachMonthOfInterval,
    eachWeekOfInterval,
    endOfDay,
    endOfMonth,
    endOfWeek,
    format,
    isWithinInterval,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subDays,
} from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { pureRevenueForOrder, type AnalyticsOrder } from '@/lib/analyticsDefinitions';

interface SalesComparatifChartProps {
    businessId: string;
    dateFilter: DateFilter;
}

type Granularity = 'daily' | 'weekly' | 'monthly';
type GranularityChoice = Granularity | 'auto';

// Shape verified against public.orders via MCP.
type SCCOrder = {
    id: string;
    date: string | null;               // placement timestamp (aka created_at)
    date_livraison: string | null;     // when the parcel was delivered to the customer
    updated_at: string | null;         // safety fallback for `date_livraison`
    price: number | null;
    shipping_cost: number | null;
    include_delivery_in_total: boolean | null;
    package_status_id: string | null;
    package_status_label: string | null;
    package_statuses: { label?: string | null } | null;
};

const COLOR_REVENUE = '#d97757'; // ant-orange — hero metric
const COLOR_ORDERS = '#141413'; // ant-ink — secondary line
const COLOR_PREV = '#b0aea5'; // ant-mid — previous period

export const SalesComparatifChart = ({ businessId, dateFilter }: SalesComparatifChartProps) => {
    const [granularityChoice, setGranularityChoice] = useState<GranularityChoice>('auto');
    const [showComparison, setShowComparison] = useState(true);
    const { deliveredPkgIds } = useStatusCategories();

    const { data: orders } = useQuery({
        queryKey: ['sales-comparatif-orders', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, date, date_livraison, updated_at, price, shipping_cost, include_delivery_in_total, package_status_id, package_status_label, package_statuses(label)',
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

    const built = useMemo(() => {
        const now = new Date();
        if (!orders) {
            return null;
        }
        const ordersTyped = orders as unknown as SCCOrder[];

        // "All Time" → span the real dataset. Use the earliest of placement or
        // delivery timestamps so the chart covers every bucket we attribute to
        // (orders line uses placement date, revenue line uses delivery date).
        const timestamps: number[] = [];
        ordersTyped.forEach((o) => {
            if (o.date) {
                const t = new Date(o.date).getTime();
                if (!Number.isNaN(t)) timestamps.push(t);
            }
            const deliv = o.date_livraison ?? o.updated_at;
            if (deliv) {
                const t = new Date(deliv).getTime();
                if (!Number.isNaN(t)) timestamps.push(t);
            }
        });
        const earliest = timestamps.length ? new Date(Math.min(...timestamps)) : subDays(now, 30);

        const rangeStart = dateFilter.from ? startOfDay(dateFilter.from) : startOfDay(earliest);
        const rangeEnd = dateFilter.to ? endOfDay(dateFilter.to) : endOfDay(now);
        const rangeDays = Math.max(0, differenceInDays(rangeEnd, rangeStart));

        // Auto: keep the chart readable regardless of range length.
        const autoGranularity: Granularity =
            rangeDays <= 31 ? 'daily' : rangeDays <= 120 ? 'weekly' : 'monthly';
        const granularity: Granularity =
            granularityChoice === 'auto' ? autoGranularity : granularityChoice;

        // Comparison only makes sense with an explicit range of ≥1 day.
        const hasExplicitRange = !!dateFilter.from && !!dateFilter.to;
        const comparisonEligible = hasExplicitRange && rangeDays >= 1;
        const useComparison = showComparison && comparisonEligible;

        const prevOffsetDays = rangeDays + 1;
        const prevRangeStart = subDays(rangeStart, prevOffsetDays);
        const prevRangeEnd = subDays(rangeEnd, prevOffsetDays);

        // Revenue: delivered-only. Use the SHARED revenue definition so this
        // chart matches the P&L / analytics everywhere — product revenue PLUS the
        // delivery the customer paid when it's folded into the order total
        // (include_delivery_in_total = true). The old inline version stripped
        // shipping unconditionally, understating revenue by the collected delivery
        // and diverging from the Orders page "Total sales".
        const productRevenue = (o: SCCOrder) => pureRevenueForOrder(o as unknown as AnalyticsOrder);
        const isRevenue = (o: SCCOrder) => isDeliveredForCommission(o, deliveredPkgIds);

        const parse = (s: string | null | undefined) => (s ? new Date(s) : null);
        // Revenue is attributed to when the money was realized — the delivery
        // timestamp — not when the order was placed. Matches every other
        // analytics surface (BusinessHealthSection, seller_daily_earnings, …).
        // `updated_at` is a safety net for legacy rows missing `date_livraison`.
        const revenueTimestamp = (o: SCCOrder) => parse(o.date_livraison ?? o.updated_at);
        const placementTs = (o: SCCOrder) => parse(o.date);
        const inRange = (d: Date | null, from: Date, to: Date) =>
            d ? isWithinInterval(d, { start: from, end: to }) : false;

        // Two working sets — placement-bucketed for orders line, delivery-bucketed
        // for revenue line. An order can appear in one window and not the other
        // (e.g. placed in March, delivered in April).
        const currentOrdersByPlacement = ordersTyped.filter((o) =>
            inRange(placementTs(o), rangeStart, rangeEnd),
        );
        const currentDeliveriesInRange = ordersTyped.filter((o) =>
            isRevenue(o) && inRange(revenueTimestamp(o), rangeStart, rangeEnd),
        );
        const prevOrdersByPlacement = useComparison
            ? ordersTyped.filter((o) => inRange(placementTs(o), prevRangeStart, prevRangeEnd))
            : [];
        const prevDeliveriesInRange = useComparison
            ? ordersTyped.filter((o) => isRevenue(o) && inRange(revenueTimestamp(o), prevRangeStart, prevRangeEnd))
            : [];

        let intervals: Date[];
        let formatStr: string;
        if (granularity === 'monthly') {
            intervals = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            formatStr = 'MMM yy';
        } else if (granularity === 'weekly') {
            intervals = eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 1 });
            formatStr = 'MMM d';
        } else {
            intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            formatStr = rangeDays <= 14 ? 'EEE d' : 'MMM d';
        }

        // Clamp every bucket to the actual range so edge buckets don't pull in
        // out-of-window orders (old bug: first weekly/monthly bucket leaked).
        const bucketBounds = (date: Date): { start: Date; end: Date } => {
            if (granularity === 'monthly') {
                const s = startOfMonth(date).getTime() < rangeStart.getTime() ? rangeStart : startOfMonth(date);
                const e = endOfMonth(date).getTime() > rangeEnd.getTime() ? rangeEnd : endOfMonth(date);
                return { start: s, end: e };
            }
            if (granularity === 'weekly') {
                const ws = startOfWeek(date, { weekStartsOn: 1 });
                const we = endOfWeek(date, { weekStartsOn: 1 });
                const s = ws.getTime() < rangeStart.getTime() ? rangeStart : ws;
                const e = we.getTime() > rangeEnd.getTime() ? rangeEnd : we;
                return { start: s, end: e };
            }
            return { start: startOfDay(date), end: endOfDay(date) };
        };

        const rows = intervals.map((date) => {
            const { start, end } = bucketBounds(date);
            // Orders line: placement-bucketed (top-of-funnel volume).
            const ordersInBucket = currentOrdersByPlacement.filter((o) =>
                inRange(placementTs(o), start, end),
            );
            // Revenue line: delivery-bucketed (money realized on that day).
            const deliveriesInBucket = currentDeliveriesInRange.filter((o) =>
                inRange(revenueTimestamp(o), start, end),
            );
            const curRevenue = deliveriesInBucket.reduce((s, o) => s + productRevenue(o), 0);

            let prevOrdersCount = 0;
            let prevRevenue = 0;
            if (useComparison) {
                const prevStart = subDays(start, prevOffsetDays);
                const prevEnd = subDays(end, prevOffsetDays);
                prevOrdersCount = prevOrdersByPlacement.filter((o) =>
                    inRange(placementTs(o), prevStart, prevEnd),
                ).length;
                prevRevenue = prevDeliveriesInRange
                    .filter((o) => inRange(revenueTimestamp(o), prevStart, prevEnd))
                    .reduce((s, o) => s + productRevenue(o), 0);
            }

            return {
                label: format(date, formatStr),
                orders: ordersInBucket.length,
                revenue: curRevenue,
                prevOrders: prevOrdersCount,
                prevRevenue,
            };
        });

        const totals = rows.reduce(
            (acc, d) => ({
                orders: acc.orders + d.orders,
                revenue: acc.revenue + d.revenue,
                prevOrders: acc.prevOrders + d.prevOrders,
                prevRevenue: acc.prevRevenue + d.prevRevenue,
            }),
            { orders: 0, revenue: 0, prevOrders: 0, prevRevenue: 0 },
        );

        return {
            rows,
            totals,
            granularity,
            autoGranularity,
            comparisonEligible,
            useComparison,
        };
    }, [orders, dateFilter, granularityChoice, showComparison, deliveredPkgIds]);

    const totals = built?.totals ?? { orders: 0, revenue: 0, prevOrders: 0, prevRevenue: 0 };
    const rows = built?.rows ?? [];
    const autoGranularity = built?.autoGranularity ?? 'daily';
    const comparisonEligible = built?.comparisonEligible ?? false;
    const useComparison = built?.useComparison ?? false;

    const orderGrowth = useComparison && totals.prevOrders > 0
        ? ((totals.orders - totals.prevOrders) / totals.prevOrders) * 100
        : null;
    const revenueGrowth = useComparison && totals.prevRevenue > 0
        ? ((totals.revenue - totals.prevRevenue) / totals.prevRevenue) * 100
        : null;

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">
                            Sales overview
                        </CardTitle>
                        {granularityChoice === 'auto' && (
                            <span className="text-[10px] text-ant-mid tabular-nums">· auto {autoGranularity}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-0.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!comparisonEligible}
                            onClick={() => setShowComparison((v) => !v)}
                            className={cn(
                                'rounded-md text-[10px] h-6 px-2',
                                useComparison
                                    ? 'bg-ant-ink/10 text-ant-ink'
                                    : 'text-ant-mid hover:text-ant-ink',
                                !comparisonEligible && 'opacity-40 cursor-not-allowed',
                            )}
                        >
                            vs Prev
                        </Button>
                        <div className="h-3.5 w-px bg-ant-line mx-1" />
                        {(['auto', 'daily', 'weekly', 'monthly'] as GranularityChoice[]).map((g) => (
                            <Button
                                key={g}
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setGranularityChoice(g)}
                                className={cn(
                                    'rounded-md text-[10px] h-6 px-2 capitalize',
                                    granularityChoice === g
                                        ? 'bg-ant-ink text-ant-light hover:bg-ant-ink/90 hover:text-ant-light'
                                        : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                {g === 'auto' ? 'Auto' : g[0].toUpperCase()}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <HeadlineStat
                        label="Revenue"
                        accent={COLOR_REVENUE}
                        value={`${Math.round(totals.revenue).toLocaleString('fr-MA')} MAD`}
                        delta={revenueGrowth}
                        prevValue={useComparison ? `${Math.round(totals.prevRevenue).toLocaleString('fr-MA')} MAD prev` : null}
                    />
                    <HeadlineStat
                        label="Orders"
                        accent={COLOR_ORDERS}
                        value={totals.orders.toLocaleString('fr-MA')}
                        delta={orderGrowth}
                        prevValue={useComparison ? `${totals.prevOrders.toLocaleString('fr-MA')} prev` : null}
                    />
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
                <div className="h-[150px] md:h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rows} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="salesRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={COLOR_REVENUE} stopOpacity={0.18} />
                                    <stop offset="100%" stopColor={COLOR_REVENUE} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="salesOrdersGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={COLOR_ORDERS} stopOpacity={0.12} />
                                    <stop offset="100%" stopColor={COLOR_ORDERS} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 10, fill: '#b0aea5' }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                                minTickGap={24}
                            />
                            <YAxis
                                yAxisId="revenue"
                                orientation="left"
                                tick={{ fontSize: 10, fill: '#b0aea5' }}
                                tickLine={false}
                                axisLine={false}
                                width={48}
                                tickFormatter={(v: number) =>
                                    v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v)
                                }
                            />
                            <YAxis
                                yAxisId="orders"
                                orientation="right"
                                tick={{ fontSize: 10, fill: '#b0aea5' }}
                                tickLine={false}
                                axisLine={false}
                                width={28}
                            />
                            <Tooltip content={<SalesTooltip useComparison={useComparison} />} />
                            <Area
                                yAxisId="revenue"
                                type="monotone"
                                dataKey="revenue"
                                name="Revenue"
                                stroke={COLOR_REVENUE}
                                strokeWidth={2}
                                fill="url(#salesRevenueGrad)"
                                dot={false}
                                activeDot={{ r: 3, strokeWidth: 0 }}
                            />
                            <Area
                                yAxisId="orders"
                                type="monotone"
                                dataKey="orders"
                                name="Orders"
                                stroke={COLOR_ORDERS}
                                strokeWidth={2}
                                fill="url(#salesOrdersGrad)"
                                dot={false}
                                activeDot={{ r: 3, strokeWidth: 0 }}
                            />
                            {useComparison && (
                                <>
                                    <Area
                                        yAxisId="revenue"
                                        type="monotone"
                                        dataKey="prevRevenue"
                                        name="Revenue (prev)"
                                        stroke={COLOR_PREV}
                                        strokeDasharray="4 3"
                                        strokeWidth={1.25}
                                        fill="none"
                                        dot={false}
                                    />
                                    <Area
                                        yAxisId="orders"
                                        type="monotone"
                                        dataKey="prevOrders"
                                        name="Orders (prev)"
                                        stroke={COLOR_PREV}
                                        strokeDasharray="4 3"
                                        strokeWidth={1.25}
                                        fill="none"
                                        dot={false}
                                    />
                                </>
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-3 mt-2.5 px-1">
                    <LegendDot color={COLOR_REVENUE} label="Revenue" />
                    <LegendDot color={COLOR_ORDERS} label="Orders" />
                    {useComparison && <LegendDot color={COLOR_PREV} label="Previous" dashed />}
                </div>
            </CardContent>
        </Card>
    );
};

function HeadlineStat({
    label,
    value,
    accent,
    delta,
    prevValue,
}: {
    label: string;
    value: string;
    accent: string;
    delta: number | null;
    prevValue: string | null;
}) {
    const up = delta !== null && delta >= 0;
    return (
        <div className="rounded-lg border border-ant-line bg-ant-light-soft/0 px-3 py-2">
            <div className="flex items-center gap-1.5">
                <span
                    className="inline-block w-1 h-1 rounded-full"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                />
                <span className="text-[9.5px] uppercase tracking-[0.18em] font-medium text-ant-mid">
                    {label}
                </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-1">
                <span className="font-display text-[17px] font-semibold text-ant-ink tabular-nums leading-none tracking-[-0.02em]">
                    {value}
                </span>
                {delta !== null && (
                    <span
                        className={cn(
                            'inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums',
                            up ? 'text-ant-green' : 'text-ant-rose',
                        )}
                    >
                        {up ? (
                            <TrendingUp className="w-2.5 h-2.5" strokeWidth={2.5} />
                        ) : (
                            <TrendingDown className="w-2.5 h-2.5" strokeWidth={2.5} />
                        )}
                        {up ? '+' : ''}
                        {delta.toFixed(1)}%
                    </span>
                )}
            </div>
            {prevValue && (
                <div className="text-[10px] text-ant-muted mt-0.5 tabular-nums">{prevValue}</div>
            )}
        </div>
    );
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-ant-muted">
            {dashed ? (
                <svg width="12" height="4" viewBox="0 0 12 4" aria-hidden>
                    <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth="1.5" strokeDasharray="3 2" />
                </svg>
            ) : (
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            )}
            {label}
        </span>
    );
}

interface SalesTooltipRow {
    revenue: number;
    orders: number;
    prevRevenue: number;
    prevOrders: number;
}

interface SalesTooltipPayload {
    value: number;
    name?: string;
    dataKey?: string;
    color?: string;
    payload?: SalesTooltipRow;
}

function SalesTooltip({
    active,
    payload,
    label,
    useComparison,
}: {
    active?: boolean;
    payload?: SalesTooltipPayload[];
    label?: string;
    useComparison: boolean;
}) {
    if (!active || !payload || payload.length === 0) return null;

    const row = payload[0]?.payload;
    if (!row) return null;

    const revDelta =
        useComparison && row.prevRevenue > 0
            ? ((row.revenue - row.prevRevenue) / row.prevRevenue) * 100
            : null;
    const ordDelta =
        useComparison && row.prevOrders > 0
            ? ((row.orders - row.prevOrders) / row.prevOrders) * 100
            : null;

    return (
        <div className="ant-surface rounded-lg bg-ant-paper border border-ant-line shadow-[0_6px_20px_rgba(20,20,19,0.08)] px-3 py-2 min-w-[168px]">
            <div className="text-[10px] uppercase tracking-[0.18em] font-medium text-ant-mid">
                {label}
            </div>
            <TooltipRow
                color={COLOR_REVENUE}
                name="Revenue"
                value={`${Math.round(row.revenue).toLocaleString('fr-MA')} MAD`}
                prev={
                    useComparison ? `${Math.round(row.prevRevenue).toLocaleString('fr-MA')} prev` : null
                }
                delta={revDelta}
            />
            <TooltipRow
                color={COLOR_ORDERS}
                name="Orders"
                value={row.orders.toLocaleString('fr-MA')}
                prev={useComparison ? `${row.prevOrders.toLocaleString('fr-MA')} prev` : null}
                delta={ordDelta}
            />
        </div>
    );
}

function TooltipRow({
    color,
    name,
    value,
    prev,
    delta,
}: {
    color: string;
    name: string;
    value: string;
    prev: string | null;
    delta: number | null;
}) {
    const up = delta !== null && delta >= 0;
    return (
        <div className="mt-1.5">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-[11px] font-medium text-ant-muted">{name}</span>
                </div>
                <span className="text-[12px] font-semibold text-ant-ink tabular-nums">{value}</span>
            </div>
            {(prev || delta !== null) && (
                <div className="flex items-center justify-between gap-2 pl-3.5 mt-0.5">
                    <span className="text-[10px] text-ant-mid tabular-nums">{prev}</span>
                    {delta !== null && (
                        <span
                            className={cn(
                                'text-[10px] font-semibold tabular-nums',
                                up ? 'text-ant-green' : 'text-ant-rose',
                            )}
                        >
                            {up ? '+' : ''}
                            {delta.toFixed(1)}%
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
