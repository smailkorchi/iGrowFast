import { useMemo } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DollarSign, TrendingUp, AlertTriangle, Lightbulb,
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

// Ranked cost tones (darkest = biggest expense). Uses the locked palette — no rainbow.
const EXPENSE_COLORS = ['#141413', '#3f3e3a', '#6b6a63', '#8d8b84', '#b0aea5', '#d8d6cc'];

/**
 * `profitability` section of admin_analytics_stats (D3). The ENTIRE P&L is
 * server-side now — revenue (full pureRevenue chain over paid+delivered orders),
 * snapshot-first COGS, shipping, courier-first return fees, cash-basis expenses
 * grouped by type, seller salaries (seller_daily_earnings Σ), media-buyer
 * salaries (payout-month overlap), product ads (overlap pro-rated), campaign
 * ads (daily entries), the provisional block and the day-bucketed trend. This
 * also kills the last wrong-money 1000-cap bare selects on this page
 * (seller_daily_earnings, campaign_daily_entries, mediabuyer_payments,
 * ads_history, courier_fees).
 *
 * Per-metric window anchors are preserved verbatim (NOT unified): revenue/COGS/
 * shipping on delivery (date_livraison ?? updated_at), returns on updated_at,
 * expenses/global ads/seller salaries on their own day columns, product ads by
 * range overlap, MB salaries by payout-month overlap, and the conversion
 * denominator alone on placement.
 *
 * Client keeps only presentation: the expense-breakdown ordering, the
 * rule-based insight tips and the trend re-bucketing to the adaptive grain.
 */
export interface ProfitabilitySlice {
    /** Conversion denominator — the placement cohort. */
    placed_count: number;
    /** Conversion numerator — placed cohort ∩ paid+delivered (⊆ denominator). */
    converted_count: number;
    revenue_order_count: number;
    total_revenue: number;
    total_cogs: number;
    total_shipping_cost: number;
    total_return_fees: number;
    total_expenses: number;
    total_seller_salaries: number;
    total_mediabuyer_salaries: number;
    spend_product_ads: number;
    spend_global_ads: number;
    all_expenses: number;
    net_profit: number;
    profit_margin: number;
    roi: number;
    provisional_count: number;
    provisional_revenue: number;
    provisional_profit: number;
    /** Sorted amount desc by the RPC. */
    expense_by_type: Array<{ name: string; amount: number }>;
    /** All-Time trend anchor: earliest placement-or-delivery day. 'YYYY-MM-DD'. */
    earliest_day: string | null;
    /** Casablanca day buckets, ascending. */
    trend: Array<{
        d: string;
        revenue: number;
        cogs: number;
        shipping: number;
        return_fees: number;
        expenses: number;
        product_ads: number;
        global_ads: number;
        seller_salaries: number;
        mb_salaries: number;
        provisional: number;
    }>;
}

interface ProfitabilitySectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: ProfitabilitySlice | null;
}

export const ProfitabilitySection = ({ dateFilter, stats }: ProfitabilitySectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        const totalAdSpend = stats.spend_product_ads + stats.spend_global_ads;

        // Seven fixed cost lines + one row per expense type, biggest first.
        const expenseBreakdown = [
            { name: 'Product COGS', value: stats.total_cogs },
            { name: 'Shipping', value: stats.total_shipping_cost },
            { name: 'Return fees', value: stats.total_return_fees },
            { name: 'Product ads', value: stats.spend_product_ads },
            { name: 'Campaign ads', value: stats.spend_global_ads },
            { name: 'Seller salaries', value: stats.total_seller_salaries },
            { name: 'Media buyer salaries', value: stats.total_mediabuyer_salaries },
            ...stats.expense_by_type.map((e) => ({ name: e.name, value: e.amount })),
        ]
            .filter(e => e.value > 0)
            .sort((a, b) => b.value - a.value);

        // ── Trend ────────────────────────────────────────────────────────
        // The RPC returns Casablanca day buckets with every P&L component
        // pre-split per day (product ads spread amount/total_days over their
        // range, MB salaries amount/days-in-month over the payout month — the
        // exact 1-day equivalent of the old overlap fractions). Granularity
        // and bucket clamping stay client-side: auto-pick from the window
        // length and clamp each bucket to the user's range, so a "Today"
        // filter can't render a bucket covering the whole month.
        const earliest = stats.earliest_day
            ? startOfDay(parseISO(stats.earliest_day))
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

        // Day keys are compared as 'YYYY-MM-DD' strings (ISO dates sort
        // lexicographically) so the server's Casablanca day never gets
        // re-interpreted through the browser's timezone.
        const trendData = intervals.map((anchor) => {
            const { start: bStart, end: bEnd } = bucketBounds(anchor);
            const startKey = format(bStart, 'yyyy-MM-dd');
            const endKey = format(bEnd, 'yyyy-MM-dd');

            let revenue = 0;
            let expenses = 0;
            let provisional = 0;
            for (const row of stats.trend) {
                if (row.d < startKey || row.d > endKey) continue;
                revenue += row.revenue;
                expenses += row.cogs + row.shipping + row.return_fees + row.expenses
                    + row.product_ads + row.global_ads + row.seller_salaries + row.mb_salaries;
                provisional += row.provisional;
            }

            return {
                month: format(anchor, labelFormat),
                revenue,
                expenses,
                profit: revenue - expenses,
                provisional,
            };
        });

        return {
            totalRevenue: stats.total_revenue,
            allExpenses: stats.all_expenses,
            netProfit: stats.net_profit,
            profitMargin: stats.profit_margin,
            roi: stats.roi,
            totalCOGS: stats.total_cogs,
            totalShippingCost: stats.total_shipping_cost,
            totalReturnFees: stats.total_return_fees,
            totalAdSpend,
            totalExpenses: stats.total_expenses,
            spendProductAds: stats.spend_product_ads,
            spendGlobalAds: stats.spend_global_ads,
            totalSellerSalaries: stats.total_seller_salaries,
            totalMediabuyerSalaries: stats.total_mediabuyer_salaries,
            expenseBreakdown,
            trendData,
            revenueOrderCount: stats.revenue_order_count,
            // Conversion denominator + numerator are both drawn from the
            // placement cohort so the ratio is bounded 0..100 %.
            totalOrderCount: stats.placed_count,
            convertedFromPlacedCohort: stats.converted_count,
            provisionalProfit: stats.provisional_profit,
            provisionalRevenue: stats.provisional_revenue,
            provisionOrderCount: stats.provisional_count,
        };
    }, [stats, dateFilter]);

    const insights = useMemo(() => {
        if (!metrics) return [];
        const tips: { type: 'warning' | 'success' | 'info'; text: string }[] = [];

        if (metrics.netProfit < 0) {
            const biggest = metrics.expenseBreakdown[0];
            if (biggest) {
                tips.push({
                    type: 'warning',
                    text: `Biggest expense: ${biggest.name} at ${Math.round(biggest.value).toLocaleString('fr-MA')} MAD. Focus on reducing this category first.`,
                });
            }
            if (metrics.totalAdSpend > 0 && metrics.totalRevenue > 0 && metrics.totalAdSpend > metrics.totalRevenue * 0.5) {
                tips.push({
                    type: 'warning',
                    text: `Ad spend is ${((metrics.totalAdSpend / metrics.totalRevenue) * 100).toFixed(0)}% of revenue. Consider pausing low-performing campaigns.`,
                });
            }
            if (metrics.profitMargin < -20) {
                tips.push({
                    type: 'warning',
                    text: `Margins are deeply negative (${metrics.profitMargin.toFixed(1)}%). Review product pricing against cost.`,
                });
            }
        } else {
            if (metrics.profitMargin > 30) {
                tips.push({
                    type: 'success',
                    text: `Strong ${metrics.profitMargin.toFixed(1)}% margin. Consider reinvesting in ads to scale revenue.`,
                });
            }
            if (metrics.roi > 50) {
                tips.push({
                    type: 'success',
                    text: `ROI of ${metrics.roi.toFixed(0)}% is excellent. Double down on winning channels.`,
                });
            }
            if (metrics.convertedFromPlacedCohort > 0 && metrics.totalOrderCount > 0) {
                const conversionRate = (metrics.convertedFromPlacedCohort / metrics.totalOrderCount) * 100;
                if (conversionRate < 30) {
                    tips.push({
                        type: 'info',
                        text: `Only ${conversionRate.toFixed(0)}% of orders convert to paid+delivered. Improving confirmation and delivery rates could multiply revenue.`,
                    });
                }
            }
        }
        return tips;
    }, [metrics]);

    return (
        <SectionWrapper
            id="profitability"
            title="Profitability & P&L"
            description="Pure revenue minus every real cost — COGS, shipping, returns, ads, salaries, expenses"
            icon={DollarSign}
            iconBg="bg-ant-green/10"
            iconColor="text-ant-green"
            loading={!stats}
        >
            {metrics && (() => {
                const isProfit = metrics.netProfit >= 0;
                const marginTone: 'positive' | 'warning' | 'negative' =
                    metrics.profitMargin >= 15 ? 'positive' : metrics.profitMargin >= 0 ? 'warning' : 'negative';
                const conversionRate = metrics.totalOrderCount > 0
                    ? (metrics.convertedFromPlacedCohort / metrics.totalOrderCount) * 100
                    : 0;
                const narrative = isProfit
                    ? `You kept ${metrics.profitMargin.toFixed(1)}% of revenue as net profit on ${metrics.revenueOrderCount} paid+delivered orders. ${
                          metrics.provisionalProfit > 0
                              ? `Another ${Math.round(metrics.provisionalProfit).toLocaleString('fr-MA')} MAD is pending from ${metrics.provisionOrderCount} delivered orders awaiting payment.`
                              : ''
                      }`
                    : `Expenses outpaced revenue by ${Math.round(Math.abs(metrics.netProfit)).toLocaleString('fr-MA')} MAD. Review ${metrics.expenseBreakdown[0]?.name || 'top cost'} — it's your largest cost at ${metrics.allExpenses > 0 ? ((metrics.expenseBreakdown[0]?.value || 0) / metrics.allExpenses * 100).toFixed(0) : 0}% of spend.`;

                return (
                    <SectionStory
                        hero={{
                            label: isProfit ? 'net profit' : 'net loss',
                            value: `${Math.round(Math.abs(metrics.netProfit)).toLocaleString('fr-MA')}`,
                            suffix: 'MAD',
                            tone: isProfit ? 'positive' : 'negative',
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Revenue', value: `${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD`, sub: `${metrics.revenueOrderCount} paid+delivered` },
                            { label: 'Expenses', value: `${Math.round(metrics.allExpenses).toLocaleString('fr-MA')} MAD`, tone: 'negative' },
                            { label: 'Margin', value: `${metrics.profitMargin.toFixed(1)}%`, tone: marginTone },
                            { label: 'ROI', value: `${metrics.roi.toFixed(1)}%` },
                            { label: 'Conversion', value: `${conversionRate.toFixed(1)}%`, sub: `${metrics.convertedFromPlacedCohort}/${metrics.totalOrderCount} of placed cohort` },
                            ...(metrics.provisionalProfit > 0
                                ? [{
                                      label: 'Provisional',
                                      value: `${Math.round(metrics.provisionalProfit).toLocaleString('fr-MA')} MAD`,
                                      tone: 'warning' as const,
                                      sub: `${metrics.provisionOrderCount} awaiting payment`,
                                  }]
                                : []),
                        ]}
                    >

                    {/* Revenue vs Expenses — full width */}
                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Revenue vs Expenses</CardTitle>
                                <div className="flex items-center gap-2.5 text-[10px] text-ant-muted">
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#788c5d]" /> Revenue</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#c96356]" /> Expenses</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#d97757]" /> Provisional</span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={160}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#788c5d" stopOpacity={0.22} />
                                            <stop offset="95%" stopColor="#788c5d" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#c96356" stopOpacity={0.22} />
                                            <stop offset="95%" stopColor="#c96356" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorProvisional" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#d97757" stopOpacity={0.18} />
                                            <stop offset="95%" stopColor="#d97757" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={40} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }}
                                        formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`}
                                    />
                                    <Area type="monotone" dataKey="revenue" stroke="#788c5d" fill="url(#colorRevenue)" strokeWidth={1.75} name="Revenue" dot={false} />
                                    <Area type="monotone" dataKey="expenses" stroke="#c96356" fill="url(#colorExpenses)" strokeWidth={1.75} name="Expenses" dot={false} />
                                    <Area type="monotone" dataKey="provisional" stroke="#d97757" fill="url(#colorProvisional)" strokeWidth={1.5} strokeDasharray="4 3" name="Provisional" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {/* Expense Breakdown */}
                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-[12px] font-semibold text-ant-ink">Expense breakdown</CardTitle>
                                    <p className="text-[10px] text-ant-muted mt-0.5">
                                        {metrics.expenseBreakdown.length} categories, sorted by size
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[14px] font-semibold text-ant-ink tabular-nums leading-none">
                                        {Math.round(metrics.allExpenses).toLocaleString('fr-MA')} <span className="text-[10px] font-medium text-ant-muted">MAD</span>
                                    </p>
                                    <p className="text-[9px] text-ant-muted uppercase tracking-[0.14em] mt-0.5">Total expenses</p>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2">
                            <div className="space-y-1.5">
                                {metrics.expenseBreakdown.map((entry, i) => {
                                    const pct = metrics.allExpenses > 0 ? (entry.value / metrics.allExpenses) * 100 : 0;
                                    const maxVal = metrics.expenseBreakdown[0]?.value || 1;
                                    const barWidth = (entry.value / maxVal) * 100;
                                    return (
                                        <div key={entry.name}>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span
                                                    className="w-[3px] h-3 rounded-full shrink-0"
                                                    style={{ backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }}
                                                />
                                                <span className="text-[11px] text-ant-ink/80 flex-1 truncate">{entry.name}</span>
                                                <span className="text-[11px] font-semibold text-ant-ink tabular-nums">
                                                    {Math.round(entry.value).toLocaleString('fr-MA')}
                                                    <span className="text-[9px] font-normal text-ant-muted ml-0.5">MAD</span>
                                                </span>
                                                <span className="text-[10px] text-ant-muted tabular-nums w-10 text-right">
                                                    {pct.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="ml-[11px] h-1 bg-ant-line rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${barWidth}%`,
                                                        backgroundColor: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {insights.length > 0 && (
                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink flex items-center gap-1.5">
                                    <Lightbulb className="w-3 h-3 text-ant-orange" />
                                    Insights
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1.5">
                                    {insights.map((insight, i) => (
                                        <div key={i} className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md ${
                                            insight.type === 'warning' ? 'bg-ant-rose/10' :
                                            insight.type === 'success' ? 'bg-ant-green/10' : 'bg-ant-blue/10'
                                        }`}>
                                            {insight.type === 'warning' && <AlertTriangle className="w-3 h-3 text-ant-rose mt-0.5 shrink-0" />}
                                            {insight.type === 'success' && <TrendingUp className="w-3 h-3 text-ant-green mt-0.5 shrink-0" />}
                                            {insight.type === 'info' && <Lightbulb className="w-3 h-3 text-ant-blue mt-0.5 shrink-0" />}
                                            <p className="text-[11px] text-ant-ink/80 leading-snug">{insight.text}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
