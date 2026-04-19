import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    AnalyticsOrder,
    cogsForOrder,
    inWindow,
    isProvisional,
    isRevenueOrder,
    isReturned,
    overlapFraction,
    payoutMonthOverlap,
    placementTimestamp,
    pureRevenueForOrder,
    returnFeeForOrder,
    shippingCostForDelivered,
} from '@/lib/analyticsDefinitions';
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
    format, startOfDay, endOfDay, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths,
} from 'date-fns';

// Ranked cost tones (darkest = biggest expense). Uses the locked palette — no rainbow.
const EXPENSE_COLORS = ['#141413', '#3f3e3a', '#6b6a63', '#8d8b84', '#b0aea5', '#d8d6cc'];

interface ProfitabilitySectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ProfitabilitySection = ({ businessId, dateFilter }: ProfitabilitySectionProps) => {
    const { deliveredPkgIds, returnedPkgIds, paidOrderIds, unpaidOrderIds } = useStatusCategories();

    // Orders query — adds all fields needed for pure revenue, snapshot COGS,
    // return-fee lookup, and delivered/returned classification.
    const { data: orders, isLoading: ordersLoading } = useQuery({
        queryKey: ['analytics-orders-profit', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, price, shipping_cost, raw_price, include_delivery_in_total, date, date_livraison, updated_at, order_status_id, package_status_id, package_status_label, tracking_number, courier_id, company_id, master_city_id, city_id, order_statuses(code), package_statuses(label, category), order_items(quantity, unit_price, total_price, product_id, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)',
                )
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: products } = useQuery({
        queryKey: ['analytics-products', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('products').select('id, cost_price, name').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: accessories } = useQuery({
        queryKey: ['analytics-accessories', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('accessories').select('id, cost_price').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: expenses } = useQuery({
        queryKey: ['analytics-expenses', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('expenses')
                .select('id, amount, date, type_id, expense_types(name, recurrent)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    // Seller earnings (accrual) — daily rows matching server-side payout math.
    const { data: sellerEarnings } = useQuery({
        queryKey: ['analytics-seller-daily-earnings', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('seller_daily_earnings')
                .select('seller_id, date, salary_earned, commission_earned, total_earned')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{
                seller_id: string;
                date: string;
                salary_earned: number | string | null;
                commission_earned: number | string | null;
                total_earned: number | string | null;
            }>;
        },
        enabled: !!businessId,
    });

    const { data: mediabuyerPayments } = useQuery({
        queryKey: ['analytics-mediabuyer-payments', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('id, total_amount, payout_month')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{ id: string; total_amount: number | string; payout_month: string }>;
        },
        enabled: !!businessId,
    });

    const { data: adsHistory } = useQuery({
        queryKey: ['analytics-ads-history', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('ads_history').select('id, amount, start_date, end_date').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: campaignEntries } = useQuery({
        queryKey: ['analytics-campaign-entries-profit', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('entry_date, spend')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{ entry_date: string; spend: number | string }>;
        },
        enabled: !!businessId,
    });

    // Return fees — lookup table keyed by (courier_id|city_id) and (company_id|city_id).
    // Prefer master_city_id; fallback to city_id.
    const { data: courierFees } = useQuery({
        queryKey: ['analytics-courier-fees', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('courier_fees')
                .select('courier_id, city_id, master_city_id, return_fee')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{
                courier_id: string;
                city_id: string | null;
                master_city_id: string | null;
                return_fee: number | string | null;
            }>;
        },
        enabled: !!businessId,
    });

    const { data: companyFees } = useQuery({
        queryKey: ['analytics-company-fees', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('company_fees')
                .select('company_id, city_id, master_city_id, return_fee')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{
                company_id: string;
                city_id: string | null;
                master_city_id: string | null;
                return_fee: number | string | null;
            }>;
        },
        enabled: !!businessId,
    });

    const isLoading = ordersLoading;

    const metrics = useMemo(() => {
        if (!orders) return null;
        // Supabase-generated row types don't know about newly added columns until
        // types are regenerated. Cast once so the analytics helpers get a clean
        // structural type instead of SelectQueryError wrappers.
        const ordersTyped = orders as unknown as AnalyticsOrder[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        // Build lookups.
        const productCost = new Map<string, number>();
        (products || []).forEach(p => productCost.set(p.id, Number(p.cost_price || 0)));
        const accessoryCost = new Map<string, number>();
        (accessories || []).forEach(a => accessoryCost.set(a.id, Number(a.cost_price || 0)));

        const returnFeeByCourierCity = new Map<string, number>();
        (courierFees || []).forEach(r => {
            const city = r.master_city_id || r.city_id;
            if (r.courier_id && city) {
                returnFeeByCourierCity.set(`${r.courier_id}|${city}`, Number(r.return_fee || 0));
            }
        });
        const returnFeeByCompanyCity = new Map<string, number>();
        (companyFees || []).forEach(r => {
            const city = r.master_city_id || r.city_id;
            if (r.company_id && city) {
                returnFeeByCompanyCity.set(`${r.company_id}|${city}`, Number(r.return_fee || 0));
            }
        });

        // ── Orders classification ───────────────────────────────────────
        // Revenue is anchored to placement date (per locked rule); date_deleted already filtered server-side.
        const ordersInWindow = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));

        const revenueOrders = ordersInWindow.filter(o => isRevenueOrder(o, deliveredPkgIds, paidOrderIds));
        const provisionalOrders = ordersInWindow.filter(o => isProvisional(o, deliveredPkgIds, unpaidOrderIds));
        const returnedOrders = ordersInWindow.filter(o => isReturned(o, returnedPkgIds));

        // ── Pure revenue (product-only, shipping stripped) ──────────────
        const totalRevenue = revenueOrders.reduce((s, o) => s + pureRevenueForOrder(o), 0);

        // ── COGS + shipping (only for revenue orders — returns contribute zero) ──
        let totalCOGS = 0;
        let totalShippingCost = 0;
        revenueOrders.forEach(o => {
            totalCOGS += cogsForOrder(o, productCost, accessoryCost);
            totalShippingCost += shippingCostForDelivered(o);
        });

        // ── Return fees (only for returned orders in the window) ────────
        const totalReturnFees = returnedOrders.reduce(
            (s, o) => s + returnFeeForOrder(o, returnFeeByCourierCity, returnFeeByCompanyCity),
            0,
        );

        // ── Owner expenses — pro-rate recurrent; count one-off if date in window ──
        let totalExpenses = 0;
        const expenseByType = new Map<string, number>();
        (expenses || []).forEach(e => {
            const raw = Number(e.amount || 0);
            if (raw <= 0) return;
            const eType = (e.expense_types as unknown as { name?: string | null; recurrent?: boolean | null } | null);
            const isRecurrent = !!eType?.recurrent;
            const eDate = e.date ? new Date(e.date) : null;
            let contrib = 0;
            if (isRecurrent && eDate && !Number.isNaN(eDate.getTime())) {
                // Expense represents a month of spend; pro-rate its month against window.
                const mStart = startOfMonth(eDate);
                const mEnd = endOfMonth(eDate);
                contrib = raw * overlapFraction(mStart, mEnd, windowStart, windowEnd);
            } else if (eDate && inWindow(eDate, windowStart, windowEnd)) {
                contrib = raw;
            }
            if (contrib > 0) {
                totalExpenses += contrib;
                const name = (eType?.name?.trim()) || 'Uncategorized';
                expenseByType.set(name, (expenseByType.get(name) || 0) + contrib);
            }
        });

        // ── Salaries (accrual) ───────────────────────────────────────────
        // Sellers: seller_daily_earnings.date in window (daily granularity).
        const totalSellerSalaries = (sellerEarnings || [])
            .filter(r => {
                if (!r.date) return false;
                const d = new Date(r.date);
                return !Number.isNaN(d.getTime()) && inWindow(d, windowStart, windowEnd);
            })
            .reduce((s, r) => s + Number(r.total_earned || 0), 0);

        // MBs: pro-rate payout_month by window overlap.
        const totalMediabuyerSalaries = (mediabuyerPayments || []).reduce((s, mp) => {
            const frac = payoutMonthOverlap(mp.payout_month, windowStart, windowEnd);
            return frac > 0 ? s + Number(mp.total_amount || 0) * frac : s;
        }, 0);

        const totalSalaries = totalSellerSalaries + totalMediabuyerSalaries;

        // ── Ad spend ─────────────────────────────────────────────────────
        let spendProductAds = 0;
        (adsHistory || []).forEach(a => {
            const s = a.start_date ? new Date(a.start_date) : null;
            const e = a.end_date ? new Date(a.end_date) : s;
            const frac = overlapFraction(s, e, windowStart, windowEnd);
            if (frac > 0) spendProductAds += Number(a.amount || 0) * frac;
        });

        const spendGlobalAds = (campaignEntries || [])
            .filter(ce => {
                if (!ce.entry_date) return false;
                const d = new Date(ce.entry_date);
                return !Number.isNaN(d.getTime()) && inWindow(d, windowStart, windowEnd);
            })
            .reduce((s, ce) => s + Number(ce.spend || 0), 0);

        const totalAdSpend = spendProductAds + spendGlobalAds;

        // ── Totals ───────────────────────────────────────────────────────
        const allExpenses =
            totalCOGS + totalShippingCost + totalReturnFees + totalExpenses + totalSalaries + totalAdSpend;
        const netProfit = totalRevenue - allExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const roi = allExpenses > 0 ? (netProfit / allExpenses) * 100 : 0;

        const expenseBreakdown = [
            { name: 'Product COGS', value: totalCOGS },
            { name: 'Shipping', value: totalShippingCost },
            { name: 'Return fees', value: totalReturnFees },
            { name: 'Product ads', value: spendProductAds },
            { name: 'Campaign ads', value: spendGlobalAds },
            { name: 'Seller salaries', value: totalSellerSalaries },
            { name: 'Media buyer salaries', value: totalMediabuyerSalaries },
            ...Array.from(expenseByType.entries()).map(([name, value]) => ({ name, value })),
        ]
            .filter(e => e.value > 0)
            .sort((a, b) => b.value - a.value);

        // ── Trend (monthly) ──────────────────────────────────────────────
        const rangeStart = dateFilter.from || (ordersInWindow.length > 0
            ? new Date(Math.min(...ordersInWindow.map(o => placementTimestamp(o)?.getTime() ?? Date.now())))
            : subMonths(new Date(), 6));
        const rangeEnd = dateFilter.to || new Date();

        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const monthStart = startOfMonth(month);
            const monthEnd = endOfMonth(month);
            const monthLabel = format(month, 'MMM yy');

            const revenueInMonth = revenueOrders.filter(o =>
                inWindow(placementTimestamp(o), monthStart, monthEnd),
            );
            const returnedInMonth = returnedOrders.filter(o =>
                inWindow(placementTimestamp(o), monthStart, monthEnd),
            );

            const monthRevenue = revenueInMonth.reduce((s, o) => s + pureRevenueForOrder(o), 0);
            const monthCogs = revenueInMonth.reduce(
                (s, o) => s + cogsForOrder(o, productCost, accessoryCost),
                0,
            );
            const monthShipping = revenueInMonth.reduce(
                (s, o) => s + shippingCostForDelivered(o),
                0,
            );
            const monthReturnFees = returnedInMonth.reduce(
                (s, o) => s + returnFeeForOrder(o, returnFeeByCourierCity, returnFeeByCompanyCity),
                0,
            );

            const monthOther = (expenses || []).reduce((sum, e) => {
                const raw = Number(e.amount || 0);
                if (raw <= 0) return sum;
                const eType = (e.expense_types as unknown as { recurrent?: boolean | null } | null);
                const isRecurrent = !!eType?.recurrent;
                const eDate = e.date ? new Date(e.date) : null;
                if (!eDate || Number.isNaN(eDate.getTime())) return sum;
                if (isRecurrent) {
                    const mS = startOfMonth(eDate);
                    const mE = endOfMonth(eDate);
                    return sum + raw * overlapFraction(mS, mE, monthStart, monthEnd);
                }
                return inWindow(eDate, monthStart, monthEnd) ? sum + raw : sum;
            }, 0);

            const monthProductAds = (adsHistory || []).reduce((sum, a) => {
                const s = a.start_date ? new Date(a.start_date) : null;
                const e = a.end_date ? new Date(a.end_date) : s;
                const frac = overlapFraction(s, e, monthStart, monthEnd);
                return frac > 0 ? sum + Number(a.amount || 0) * frac : sum;
            }, 0);

            const monthGlobalAds = (campaignEntries || [])
                .filter(ce => {
                    if (!ce.entry_date) return false;
                    const d = new Date(ce.entry_date);
                    return !Number.isNaN(d.getTime()) && inWindow(d, monthStart, monthEnd);
                })
                .reduce((s, ce) => s + Number(ce.spend || 0), 0);

            const monthSellerSalaries = (sellerEarnings || [])
                .filter(r => {
                    if (!r.date) return false;
                    const d = new Date(r.date);
                    return !Number.isNaN(d.getTime()) && inWindow(d, monthStart, monthEnd);
                })
                .reduce((sum, r) => sum + Number(r.total_earned || 0), 0);

            const monthMBSalaries = (mediabuyerPayments || []).reduce((sum, mp) => {
                const frac = payoutMonthOverlap(mp.payout_month, monthStart, monthEnd);
                return frac > 0 ? sum + Number(mp.total_amount || 0) * frac : sum;
            }, 0);

            const monthExpenses =
                monthCogs + monthShipping + monthReturnFees + monthOther +
                monthProductAds + monthGlobalAds + monthSellerSalaries + monthMBSalaries;

            return {
                month: monthLabel,
                revenue: monthRevenue,
                expenses: monthExpenses,
                profit: monthRevenue - monthExpenses,
                provisional: 0,
            };
        });

        // Build provisional per-order amounts (delivered-unpaid: pure revenue − COGS − shipping).
        const provisionByOrderId = new Map<string, number>();
        provisionalOrders.forEach(o => {
            const pure = pureRevenueForOrder(o);
            const cogs = cogsForOrder(o, productCost, accessoryCost);
            const ship = shippingCostForDelivered(o);
            provisionByOrderId.set(o.id, pure - cogs - ship);
        });

        trendData.forEach((row, i) => {
            const monthStart = startOfMonth(months[i]);
            const monthEnd = endOfMonth(months[i]);
            row.provisional = provisionalOrders
                .filter(o => inWindow(placementTimestamp(o), monthStart, monthEnd))
                .reduce((s, o) => s + (provisionByOrderId.get(o.id) ?? 0), 0);
        });

        const provisionalRevenue = provisionalOrders.reduce((s, o) => s + pureRevenueForOrder(o), 0);
        const provisionalProfit = Array.from(provisionByOrderId.values()).reduce((s, v) => s + v, 0);

        return {
            totalRevenue,
            allExpenses,
            netProfit,
            profitMargin,
            roi,
            totalCOGS,
            totalShippingCost,
            totalReturnFees,
            totalAdSpend,
            totalSalaries,
            totalExpenses,
            spendProductAds,
            spendGlobalAds,
            totalSellerSalaries,
            totalMediabuyerSalaries,
            expenseBreakdown,
            trendData,
            revenueOrderCount: revenueOrders.length,
            totalOrderCount: ordersInWindow.length,
            returnedOrderCount: returnedOrders.length,
            provisionalProfit,
            provisionalRevenue,
            provisionOrderCount: provisionalOrders.length,
        };
    }, [
        orders, products, accessories, expenses, sellerEarnings, mediabuyerPayments,
        adsHistory, campaignEntries, courierFees, companyFees,
        dateFilter, deliveredPkgIds, returnedPkgIds, paidOrderIds, unpaidOrderIds,
    ]);

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
            if (metrics.revenueOrderCount > 0 && metrics.totalOrderCount > 0) {
                const conversionRate = (metrics.revenueOrderCount / metrics.totalOrderCount) * 100;
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
            loading={isLoading}
        >
            {metrics && (() => {
                const isProfit = metrics.netProfit >= 0;
                const marginTone: 'positive' | 'warning' | 'negative' =
                    metrics.profitMargin >= 15 ? 'positive' : metrics.profitMargin >= 0 ? 'warning' : 'negative';
                const conversionRate = metrics.totalOrderCount > 0
                    ? (metrics.revenueOrderCount / metrics.totalOrderCount) * 100
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
                            { label: 'Conversion', value: `${conversionRate.toFixed(1)}%`, sub: `${metrics.revenueOrderCount}/${metrics.totalOrderCount}` },
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
