import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DollarSign, TrendingUp, TrendingDown, PieChart as PieIcon,
    AlertTriangle, Lightbulb, Target, Percent, ArrowUpRight, Wallet, Hourglass,
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, startOfMonth, eachMonthOfInterval, subMonths } from 'date-fns';

const EXPENSE_COLORS = ['#3b5e5e', '#7a9385', '#c93942', '#daddcc', '#F97316', '#6366F1'];

interface ProfitabilitySectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const ProfitabilitySection = ({ businessId, dateFilter }: ProfitabilitySectionProps) => {
    const { deliveredPkgIds, isOrderCategory } = useStatusCategories();

    const { data: orders, isLoading: ordersLoading } = useQuery({
        queryKey: ['analytics-orders-profit', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, price, shipping_cost, raw_price, date, order_status_id, package_status_id, package_status_label, order_statuses(code), package_statuses(label), order_items(quantity, unit_price, product_id, accessory_id, accessory_quantity, accessory_unit_price)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: products } = useQuery({
        queryKey: ['analytics-products', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('products').select('id, cost_price, selling_price, name').eq('DigiCom Business', businessId);
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
            const { data } = await supabase.from('expenses').select('id, amount, date, type_id, expense_types(name)').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: sellerPayments } = useQuery({
        queryKey: ['analytics-seller-payments', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('seller_payments').select('id, seller_id, total_amount, salary_earned, commission_earned, delivered_orders, days_present, status, payout_month, created_at').eq('DigiCom Business', businessId);
            return data || [];
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

    const isLoading = ordersLoading;

    const metrics = useMemo(() => {
        if (!orders) return null;

        const isPaidAndDelivered = (o: any) =>
            o.order_status_id && isOrderCategory(o.order_status_id, 'paid') &&
            isDeliveredForCommission(o, deliveredPkgIds);

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            const from = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
            const to = dateFilter.to ? endOfDay(dateFilter.to) : new Date();
            return isWithinInterval(d, { start: from, end: to });
        };

        const filteredOrders = orders.filter(o => isInRange(o.date));

        const revenueOrders = filteredOrders.filter(isPaidAndDelivered);

        const totalRevenue = revenueOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);

        const productMap = new Map((products || []).map(p => [p.id, Number(p.cost_price || 0)]));
        const accessoryMap = new Map((accessories || []).map(a => [a.id, Number(a.cost_price || 0)]));

        let totalCOGS = 0;
        let totalShippingCost = 0;
        revenueOrders.forEach(o => {
            totalShippingCost += Number(o.shipping_cost || 0);
            const items = (o as any).order_items || [];
            items.forEach((item: any) => {
                const productCost = productMap.get(item.product_id) || 0;
                totalCOGS += Number(item.quantity || 0) * productCost;
                if (item.accessory_id) {
                    const accCost = accessoryMap.get(item.accessory_id) || 0;
                    totalCOGS += Number(item.accessory_quantity || 0) * accCost;
                }
            });
        });

        const filteredExpenses = (expenses || []).filter(e => isInRange(e.date));
        const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

        const filteredSellerPayments = (sellerPayments || []).filter(sp => isInRange(sp.created_at));
        const totalSalaries = filteredSellerPayments.reduce((sum, sp) => sum + Number(sp.total_amount || 0), 0);

        const filteredAds = (adsHistory || []).filter(a => isInRange(a.start_date));
        const totalAdSpend = filteredAds.reduce((sum, a) => sum + Number(a.amount || 0), 0);

        const allExpenses = totalCOGS + totalShippingCost + totalExpenses + totalSalaries + totalAdSpend;
        const netProfit = totalRevenue - allExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const roi = allExpenses > 0 ? (netProfit / allExpenses) * 100 : 0;

        const expenseBreakdown = [
            { name: 'COGS', value: totalCOGS },
            { name: 'Shipping', value: totalShippingCost },
            { name: 'Ad Spend', value: totalAdSpend },
            { name: 'Salaries', value: totalSalaries },
            { name: 'Expenses', value: totalExpenses },
        ].filter(e => e.value > 0);

        const rangeStart = dateFilter.from || (filteredOrders.length > 0
            ? new Date(Math.min(...filteredOrders.filter(o => o.date).map(o => new Date(o.date!).getTime())))
            : subMonths(new Date(), 6));
        const rangeEnd = dateFilter.to || new Date();

        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const monthStart = startOfMonth(month);
            const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
            const monthLabel = format(month, 'MMM yy');

            const monthRevenue = revenueOrders
                .filter(o => o.date && isWithinInterval(new Date(o.date), { start: monthStart, end: monthEnd }))
                .reduce((sum, o) => sum + Number(o.price || 0), 0);

            const monthExpenses =
                filteredExpenses.filter(e => isWithinInterval(new Date(e.date), { start: monthStart, end: monthEnd }))
                    .reduce((sum, e) => sum + Number(e.amount || 0), 0) +
                filteredAds.filter(a => isWithinInterval(new Date(a.start_date), { start: monthStart, end: monthEnd }))
                    .reduce((sum, a) => sum + Number(a.amount || 0), 0);

            return { month: monthLabel, revenue: monthRevenue, expenses: monthExpenses, profit: monthRevenue - monthExpenses, provisional: 0 };
        });

        // ── Provisional: delivered package but order NOT yet paid (unpaid) ──
        // Computed here so we can also stitch provisional into per-month trendData
        const isDeliveredUnpaid = (o: any) =>
            isDeliveredForCommission(o, deliveredPkgIds) &&
            o.order_status_id &&
            isOrderCategory(o.order_status_id, 'unpaid');
        const provisionOrders = filteredOrders.filter(isDeliveredUnpaid);

        // Build per-order provision amounts (COGS + shipping deducted)
        const provisionByOrderId = new Map<string, number>();
        provisionOrders.forEach(o => {
            const ship = Number(o.shipping_cost || 0);
            let cogs = 0;
            const items = (o as any).order_items || [];
            items.forEach((item: any) => {
                const productCost = productMap.get(item.product_id) || 0;
                cogs += Number(item.quantity || 0) * productCost;
                if (item.accessory_id) {
                    const accCost = accessoryMap.get(item.accessory_id) || 0;
                    cogs += Number(item.accessory_quantity || 0) * accCost;
                }
            });
            provisionByOrderId.set(o.id, Number(o.price || 0) - cogs - ship);
        });

        // Stitch monthly provisional into trendData
        trendData.forEach((row, i) => {
            const monthStart = startOfMonth(months[i]);
            const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
            const monthProv = provisionOrders
                .filter(o => o.date && isWithinInterval(new Date(o.date), { start: monthStart, end: monthEnd }))
                .reduce((sum, o) => sum + (provisionByOrderId.get(o.id) ?? 0), 0);
            row.provisional = monthProv;
        });

        const provisionalRevenue = provisionOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);
        const provisionalProfit = Array.from(provisionByOrderId.values()).reduce((s, v) => s + v, 0);

        return {
            totalRevenue, allExpenses, netProfit, profitMargin, roi,
            totalCOGS, totalShippingCost, totalAdSpend, totalSalaries, totalExpenses,
            expenseBreakdown, trendData, revenueOrderCount: revenueOrders.length,
            totalOrderCount: filteredOrders.length,
            provisionalProfit, provisionalRevenue, provisionOrderCount: provisionOrders.length,
        };
    }, [orders, products, accessories, expenses, sellerPayments, adsHistory, dateFilter, deliveredPkgIds, isOrderCategory]);

    const insights = useMemo(() => {
        if (!metrics) return [];
        const tips: { type: 'warning' | 'success' | 'info'; text: string }[] = [];

        if (metrics.netProfit < 0) {
            const biggest = metrics.expenseBreakdown.sort((a, b) => b.value - a.value)[0];
            if (biggest) tips.push({ type: 'warning', text: `Biggest expense: ${biggest.name} at ${biggest.value.toLocaleString('fr-MA')} MAD. Focus on reducing this category first.` });
            if (metrics.totalAdSpend > 0 && metrics.totalRevenue > 0 && metrics.totalAdSpend > metrics.totalRevenue * 0.5) {
                tips.push({ type: 'warning', text: `Ad spend is ${((metrics.totalAdSpend / metrics.totalRevenue) * 100).toFixed(0)}% of revenue. Consider pausing low-performing campaigns.` });
            }
            if (metrics.totalShippingCost > metrics.totalRevenue * 0.2) {
                tips.push({ type: 'warning', text: `Shipping costs are ${((metrics.totalShippingCost / metrics.totalRevenue) * 100).toFixed(0)}% of revenue. Negotiate better rates or increase free-shipping thresholds.` });
            }
            if (metrics.profitMargin < -20) {
                tips.push({ type: 'warning', text: `Margins are deeply negative (${metrics.profitMargin.toFixed(1)}%). Review product pricing against cost prices.` });
            }
        } else {
            if (metrics.profitMargin > 30) {
                tips.push({ type: 'success', text: `Strong ${metrics.profitMargin.toFixed(1)}% margin. Consider reinvesting in ads to scale revenue.` });
            }
            if (metrics.roi > 50) {
                tips.push({ type: 'success', text: `ROI of ${metrics.roi.toFixed(0)}% is excellent. Double down on winning channels.` });
            }
            if (metrics.revenueOrderCount > 0 && metrics.totalOrderCount > 0) {
                const conversionRate = (metrics.revenueOrderCount / metrics.totalOrderCount) * 100;
                if (conversionRate < 30) {
                    tips.push({ type: 'info', text: `Only ${conversionRate.toFixed(0)}% of orders convert to paid+delivered. Improving confirmation and delivery rates could multiply revenue.` });
                }
            }
        }
        return tips;
    }, [metrics]);

    return (
        <SectionWrapper
            id="profitability"
            title="Profitability & P&L"
            description="Revenue, expenses, and net profit breakdown"
            icon={DollarSign}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
                        <StatCard
                            title="Total Revenue"
                            value={metrics.totalRevenue.toLocaleString('fr-MA')}
                            suffix=" MAD"
                            icon={DollarSign}
                            iconBg="bg-emerald-50"
                            iconColor="text-emerald-600"
                            subtitle={`${metrics.revenueOrderCount} paid & delivered orders`}
                        />
                        <StatCard
                            title="Total Expenses"
                            value={metrics.allExpenses.toLocaleString('fr-MA')}
                            suffix=" MAD"
                            icon={Wallet}
                            iconBg="bg-red-50"
                            iconColor="text-red-500"
                        />
                        <StatCard
                            title="Net Profit / Loss"
                            value={metrics.netProfit.toLocaleString('fr-MA')}
                            suffix=" MAD"
                            icon={metrics.netProfit >= 0 ? TrendingUp : TrendingDown}
                            iconBg={metrics.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
                            iconColor={metrics.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}
                            valueColor={metrics.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}
                            subtitle={`${metrics.revenueOrderCount} paid orders`}
                        />
                        {/* Provisional profit card — amber, only per-order costs deducted */}
                        <div className="relative">
                            <StatCard
                                title="Provisional Profit"
                                value={metrics.provisionalProfit.toLocaleString('fr-MA')}
                                suffix=" MAD"
                                icon={Hourglass}
                                iconBg="bg-amber-50"
                                iconColor="text-amber-500"
                                valueColor={metrics.provisionalProfit >= 0 ? 'text-amber-600' : 'text-red-500'}
                                subtitle={`${metrics.provisionOrderCount} delivered, awaiting payment`}
                                className="border border-amber-200/60 border-dashed"
                            />
                            <div className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-widest text-amber-400 bg-amber-50 px-1.5 py-0.5 rounded-full">
                                Estimate
                            </div>
                        </div>
                        <StatCard
                            title="Profit Margin"
                            value={metrics.profitMargin.toFixed(1)}
                            suffix="%"
                            icon={Percent}
                            iconBg="bg-blue-50"
                            iconColor="text-blue-600"
                        />
                        <StatCard
                            title="ROI"
                            value={metrics.roi.toFixed(1)}
                            suffix="%"
                            icon={Target}
                            iconBg="bg-purple-50"
                            iconColor="text-purple-600"
                        />
                        <StatCard
                            title="Conversion"
                            value={metrics.totalOrderCount > 0 ? ((metrics.revenueOrderCount / metrics.totalOrderCount) * 100).toFixed(1) : '0'}
                            suffix="%"
                            icon={ArrowUpRight}
                            iconBg="bg-orange-50"
                            iconColor="text-orange-600"
                            subtitle={`${metrics.revenueOrderCount} / ${metrics.totalOrderCount} orders`}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl lg:col-span-2">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Revenue vs Expenses</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#c93942" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#c93942" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorProvisional" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                                                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                                            formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`}
                                        />
                                        <Area type="monotone" dataKey="revenue" stroke="#10B981" fill="url(#colorRevenue)" strokeWidth={2.5} name="Revenue (paid)" />
                                        <Area type="monotone" dataKey="expenses" stroke="#c93942" fill="url(#colorExpenses)" strokeWidth={2.5} name="Expenses" />
                                        <Area type="monotone" dataKey="provisional" stroke="#F59E0B" fill="url(#colorProvisional)" strokeWidth={2} strokeDasharray="5 3" name="Provisional Profit" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Expense Breakdown</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie
                                            data={metrics.expenseBreakdown}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={4}
                                            dataKey="value"
                                        >
                                            {metrics.expenseBreakdown.map((_, i) => (
                                                <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {insights.length > 0 && (
                        <Card className="border-0 shadow-sm rounded-3xl bg-gradient-to-br from-brand-navy/[0.02] to-brand-blue/[0.04]">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy flex items-center gap-2">
                                    <Lightbulb className="w-4 h-4 text-amber-500" />
                                    Smart Insights
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {insights.map((insight, i) => (
                                        <div key={i} className={`flex items-start gap-3 p-3 rounded-2xl ${
                                            insight.type === 'warning' ? 'bg-red-50/60' :
                                            insight.type === 'success' ? 'bg-emerald-50/60' : 'bg-blue-50/60'
                                        }`}>
                                            {insight.type === 'warning' && <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                                            {insight.type === 'success' && <TrendingUp className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />}
                                            {insight.type === 'info' && <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />}
                                            <p className="text-sm text-brand-navy/80">{insight.text}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </SectionWrapper>
    );
};
