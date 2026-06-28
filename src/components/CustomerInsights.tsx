import React, { useEffect, useState, useMemo } from 'react';
import { fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import {
    ShoppingBag,
    Truck,
    XCircle,
    DollarSign,
    TrendingUp,
    User,
    Loader2,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';

interface CustomerInsightsProps {
    phone: string;
    className?: string;
}

interface OrderRecord {
    id: string;
    date: string;
    created_at: string;
    raw_price: number;
    order_status_id: string | null;
    package_status_id: string | null;
    status_code: string;
    status_label: string;
    status_color: string;
    package_status_code: string;
}

interface MonthData {
    month: string;
    orders: number;
    revenue: number;
}

const CustomerInsights: React.FC<CustomerInsightsProps> = ({ phone, className }) => {
    const { deliveredPkgIds, cancelledIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { trackedOrderIds } = useTrackedOrders(activeBusinessId);

    // Debounce phone search — normalize digits only, skip below 6 chars.
    useEffect(() => {
        const cleaned = phone?.replace(/[^0-9+]/g, '') || '';
        if (cleaned.length < 6) {
            setOrders([]);
            setSearched(false);
            return;
        }

        setLoading(true);
        const timer = setTimeout(async () => {
            try {
                // Paginated so we never truncate at the 1000-row default cap.
                const data = await fetchAllRows(
                    'orders',
                    `
                        id,
                        date,
                        created_at,
                        raw_price,
                        order_status_id,
                        package_status_id,
                        replace,
                        status:order_statuses(code, label, color),
                        package_status:package_statuses(code, label)
                    `,
                    {
                        filters: [
                            { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                            { column: 'phone', op: 'ilike', value: `%${cleaned}%` },
                            { column: 'date_deleted', op: 'is', value: null },
                            { column: 'source_review_status', op: 'neq', value: 'pending' },
                        ],
                    }
                );

                // Types verified via MCP: orders (id NOT NULL, date/created_at/raw_price/*_status_id nullable),
                // order_statuses/package_statuses.code/label text NOT NULL, color text nullable.
                type FetchedOrderRow = {
                    id: string;
                    date: string | null;
                    created_at: string | null;
                    raw_price: number | null;
                    order_status_id: string | null;
                    package_status_id: string | null;
                    replace: boolean | null;
                    status: { code: string; label: string; color: string | null } | null;
                    package_status: { code: string; label: string } | null;
                };
                // Exclude exchange swap/return legs (replace=true) — a swap is not a
                // customer purchase, so it must not inflate spent / order counts / risk.
                const mapped: OrderRecord[] = ((data || []) as unknown as FetchedOrderRow[])
                    .filter((o) => o.replace !== true)
                    .map((o) => ({
                    id: o.id,
                    date: o.date || o.created_at || '',
                    created_at: o.created_at || '',
                    raw_price: Number(o.raw_price) || 0,
                    order_status_id: o.order_status_id || null,
                    package_status_id: o.package_status_id || null,
                    status_code: o.status?.code || '',
                    status_label: o.status?.label || '',
                    status_color: o.status?.color || '#999',
                    package_status_code: o.package_status?.code || '',
                }));

                setOrders(mapped);
                setSearched(true);
            } catch (err) {
                console.error('CustomerInsights error:', err);
                setOrders([]);
                setSearched(true);
            } finally {
                setLoading(false);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [phone, activeBusinessId]);

    // Rolled-up KPIs for the intelligence strip.
    //
    // "Failed" captures every order this customer broke: cancelled / fake /
    // double / blacklisted on the order side, AND packages that went out and
    // came back (returned / returning / refused). Previously only the first
    // half was counted, so a customer who returned every package they
    // received showed up as "0 cancelled · Low risk" — exactly the bug the
    // user flagged. "Spent" now only sums delivered orders, because the
    // customer didn't actually pay for failed/in-progress ones.
    const stats = useMemo(() => {
        const isDelivered = (o: OrderRecord) => isDeliveredForCommission(o, deliveredPkgIds);
        const isFailed = (o: OrderRecord) =>
            (!!o.order_status_id && cancelledIds.has(o.order_status_id))
            || (!!o.package_status_id && returnedPkgIds.has(o.package_status_id));

        const total = orders.length;
        const delivered = orders.filter(isDelivered).length;
        const failed = orders.filter(isFailed).length;
        const totalSpent = orders.filter(isDelivered).reduce((acc, o) => acc + o.raw_price, 0);
        // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
        const tracked = orders.filter((o) => !!o.id && trackedOrderIds.has(o.id));
        const pullback = tracked.filter((o) =>
            isAdminPullback(o as any, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - pullback.length;
        const deliveryRate = deliveryDenom > 0 ? Math.round((delivered / deliveryDenom) * 100) : 0;
        return { total, delivered, failed, totalSpent, deliveryRate };
    }, [orders, deliveredPkgIds, cancelledIds, returnedPkgIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds]);

    // Last 6 months of order volume — feeds the sparkline area chart.
    const chartData = useMemo((): MonthData[] => {
        if (orders.length === 0) return [];
        const now = new Date();
        const months: MonthData[] = [];

        for (let i = 5; i >= 0; i--) {
            const m = subMonths(now, i);
            const start = startOfMonth(m);
            const end = endOfMonth(m);
            const monthOrders = orders.filter((o) => {
                const d = new Date(o.date);
                return d >= start && d <= end;
            });
            months.push({
                month: format(m, 'MMM'),
                orders: monthOrders.length,
                revenue: monthOrders.reduce((acc, o) => acc + o.raw_price, 0),
            });
        }
        return months;
    }, [orders]);

    // Risk bucket based on the customer's failure rate over RESOLVED orders
    // (delivered + failed). In-progress orders don't dilute the score — a
    // customer with 1 delivered + 1 returned is 50% risk, regardless of how
    // many fresh orders they currently have in the pipeline. With no
    // resolved orders yet, we don't pretend to know — return null so the
    // pill is hidden.
    const riskLevel = useMemo(() => {
        if (stats.total === 0) return null;
        const resolved = stats.delivered + stats.failed;
        if (resolved === 0) return null;
        const failRate = (stats.failed / resolved) * 100;
        if (failRate > 60) {
            return {
                label: 'High risk',
                tone: 'rose' as const,
                dot: 'bg-ant-rose',
                chip: 'bg-ant-rose/10 text-ant-rose border-ant-rose/25',
            };
        }
        if (failRate > 30) {
            return {
                label: 'Medium risk',
                tone: 'orange' as const,
                dot: 'bg-ant-orange',
                chip: 'bg-ant-orange/10 text-ant-orange border-ant-orange/30',
            };
        }
        return {
            label: 'Low risk',
            tone: 'green' as const,
            dot: 'bg-ant-green',
            chip: 'bg-ant-green/10 text-ant-green border-ant-green/25',
        };
    }, [stats]);

    const deliveryTone =
        stats.deliveryRate >= 60 ? 'text-ant-green' : stats.deliveryRate >= 30 ? 'text-ant-orange' : 'text-ant-rose';
    const deliveryBar =
        stats.deliveryRate >= 60 ? 'bg-ant-green' : stats.deliveryRate >= 30 ? 'bg-ant-orange' : 'bg-ant-rose';

    const cleaned = phone?.replace(/[^0-9+]/g, '') || '';
    if (cleaned.length < 6) return null;

    return (
        <div className={cn('ant-surface space-y-3', className)}>
            {/* Section header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-ant-orange" aria-hidden />
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        Customer intelligence
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-ant-orange" />}
                    {riskLevel && !loading && (
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.2em] px-2 py-0.5 rounded-full border',
                                riskLevel.chip,
                            )}
                        >
                            <span className={cn('w-1 h-1 rounded-full', riskLevel.dot)} />
                            {riskLevel.label}
                        </span>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-8 rounded-xl border border-ant-line bg-ant-paper">
                    <div className="flex items-center gap-2 text-ant-muted">
                        <Loader2 className="w-4 h-4 animate-spin text-ant-orange" />
                        <span className="font-serif-display text-[12px] italic">Analysing this customer…</span>
                    </div>
                </div>
            ) : searched && orders.length === 0 ? (
                <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-ant-blue/10 border border-ant-blue/25">
                    <div className="w-8 h-8 rounded-lg bg-ant-blue/15 ring-1 ring-ant-blue/25 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-ant-blue" strokeWidth={1.75} />
                    </div>
                    <div>
                        <p className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">New customer</p>
                        <p className="font-serif-display text-[11.5px] text-ant-muted italic">
                            No previous orders found for this number.
                        </p>
                    </div>
                </div>
            ) : searched && orders.length > 0 ? (
                <>
                    {/* Stats Grid — hairline divider row */}
                    <div className="grid grid-cols-4 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                        <InsightTile label="Total" value={stats.total} icon={ShoppingBag} accent="#141413" />
                        <InsightTile label="Delivered" value={stats.delivered} icon={Truck} accent="#788c5d" />
                        <InsightTile label="Failed" value={stats.failed} icon={XCircle} accent="#c96356" />
                        <InsightTile
                            label="Spent"
                            value={stats.totalSpent}
                            suffix="DH"
                            icon={DollarSign}
                            accent="#d97757"
                        />
                    </div>

                    {/* Delivery Rate Bar */}
                    <div className="rounded-xl bg-ant-paper border border-ant-line px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Delivery rate
                            </span>
                            <span className={cn('font-display text-[15px] font-semibold tabular-nums tracking-[-0.01em]', deliveryTone)}>
                                {stats.deliveryRate}%
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-ant-line rounded-full overflow-hidden">
                            <div
                                className={cn('h-full rounded-full transition-all duration-700 ease-out', deliveryBar)}
                                style={{ width: `${stats.deliveryRate}%` }}
                            />
                        </div>
                    </div>

                    {/* Chart — 6 month order history */}
                    {chartData.some((d) => d.orders > 0) && (
                        <div className="rounded-xl bg-ant-paper border border-ant-line px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                    <TrendingUp className="w-3 h-3 text-ant-orange" strokeWidth={1.75} />
                                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        Order history · 6 months
                                    </span>
                                </div>
                            </div>
                            <div className="h-[100px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="customerInsightsGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#d97757" stopOpacity={0.25} />
                                                <stop offset="100%" stopColor="#d97757" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} stroke="#e8e6dc" strokeDasharray="2 4" />
                                        <XAxis
                                            dataKey="month"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#b0aea5', fontSize: 10 }}
                                            dy={4}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#b0aea5', fontSize: 10 }}
                                            allowDecimals={false}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: '10px',
                                                border: '1px solid #e8e6dc',
                                                background: '#ffffff',
                                                boxShadow: '0 6px 20px rgba(20,20,19,0.08)',
                                                fontSize: '11px',
                                                padding: '8px 12px',
                                            }}
                                            formatter={(value: number | string, name: string) => [
                                                name === 'orders' ? `${value} orders` : `${value} DH`,
                                                name === 'orders' ? 'Orders' : 'Revenue',
                                            ]}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="orders"
                                            stroke="#d97757"
                                            strokeWidth={2}
                                            fillOpacity={1}
                                            fill="url(#customerInsightsGrad)"
                                            activeDot={{ r: 4, strokeWidth: 0, fill: '#d97757' }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
};

// Single cell in the 4-up insights strip. Keeps every tile on `#e8e6dc`
// divider lines so the row reads as one table, not four cards.
function InsightTile({
    label,
    value,
    suffix,
    icon: Icon,
    accent,
}: {
    label: string;
    value: number;
    suffix?: string;
    icon: typeof ShoppingBag;
    accent: string;
}) {
    return (
        <div className="bg-ant-paper px-3 py-2.5">
            <div className="flex items-center gap-1.5">
                <Icon className="w-3 h-3 text-ant-mid shrink-0" strokeWidth={1.75} />
                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">
                    {label}
                </span>
            </div>
            <div className="font-display text-[18px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-1">
                <span style={{ color: accent }}>{value.toLocaleString('fr-FR')}</span>
                {suffix && <span className="text-[10px] font-medium text-ant-mid ml-1">{suffix}</span>}
            </div>
        </div>
    );
}

export default CustomerInsights;
