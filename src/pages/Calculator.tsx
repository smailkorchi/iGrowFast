import { useState, useMemo } from 'react';
import {
    Calculator as CalculatorIcon, TrendingUp, Package, DollarSign,
    Target, Truck, Phone, Box, AlertTriangle, Sparkles,
    ArrowUpRight, ArrowDownRight, Percent, RefreshCcw, ChevronRight,
    BarChart3, Zap, Scale, CheckCircle, XCircle, Clock, Info,
    Wallet, PiggyBank, Receipt, TrendingDown, Activity
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ComposedChart, Line
} from 'recharts';

// Types
interface CalculatorInputs {
    productCost: number;
    callCenter: number;
    packaging: number;
    shippingFee: number;
    riskBuffer: number;
    fbLeads: number;
    costPerLead: number;
    confirmationRate: number;
    deliveryRate: number;
    salePrice: number;
}

const defaultInputs: CalculatorInputs = {
    productCost: 25,
    callCenter: 0,
    packaging: 2,
    shippingFee: 35,
    riskBuffer: 0,
    fbLeads: 20,
    costPerLead: 20,
    confirmationRate: 60,
    deliveryRate: 60,
    salePrice: 199
};

type ChartTooltipPayload = { color?: string; name?: string; value?: number };
function ProfitChartTooltip({ active, payload, label }: { active?: boolean; payload?: ChartTooltipPayload[]; label?: string }) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-sm">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1.5">{label}</p>
                {payload.map((entry: ChartTooltipPayload, index: number) => (
                    <p key={index} className="text-[11px] tabular-nums" style={{ color: entry.color }}>
                        <span className="font-medium">{entry.name}:</span> {entry.value?.toLocaleString()} MAD
                    </p>
                ))}
            </div>
        );
    }
    return null;
}

function CalculatorInputField({
    label,
    field,
    value,
    onFieldChange,
    suffix,
    hint,
}: {
    label: string;
    field: keyof CalculatorInputs;
    value: number;
    onFieldChange: (field: keyof CalculatorInputs, value: string) => void;
    suffix?: string;
    hint?: string;
}) {
    return (
        <div className="space-y-1">
            <Label className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{label}</Label>
            <div className="relative">
                <Input
                    type="number"
                    value={value}
                    onChange={(e) => onFieldChange(field, e.target.value)}
                    className="pr-10 h-8 rounded-md border-gray-200 text-[11px] font-medium text-brand-navy"
                />
                {suffix && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-gray-400">
                        {suffix}
                    </span>
                )}
            </div>
            {hint && <p className="text-[9px] text-gray-400">{hint}</p>}
        </div>
    );
}

type StatBoxTone = 'success' | 'danger' | 'warning' | 'info' | 'default';

function CalculatorStatBox({
    label,
    value,
    subValue,
    type = 'default',
    large = false,
}: {
    label: string;
    value: string | number;
    subValue?: string;
    type?: StatBoxTone;
    large?: boolean;
}) {
    const accentMap: Record<StatBoxTone, string> = {
        success: '#059669',
        danger: '#ef4444',
        warning: '#d97706',
        info: '#3b5e5e',
        default: '#9ca3af',
    };
    const bgMap: Record<StatBoxTone, string> = {
        success: 'bg-emerald-50/60',
        danger: 'bg-red-50/60',
        warning: 'bg-amber-50/60',
        info: 'bg-gray-50',
        default: 'bg-gray-50',
    };

    return (
        <div className={`rounded-xl border border-gray-100 p-3 flex items-start gap-2 ${bgMap[type]}`}>
            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: accentMap[type] }} />
            <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{label}</p>
                <p className={`font-semibold tabular-nums text-brand-navy mt-0.5 ${large ? 'text-[18px]' : 'text-[14px]'}`}>{value}</p>
                {subValue && <p className="text-[9px] text-gray-400 mt-0.5">{subValue}</p>}
            </div>
        </div>
    );
}

function CalculatorProgressBar({
    label,
    value,
    max,
    color = 'primary',
}: {
    label: string;
    value: number;
    max: number;
    color?: string;
}) {
    const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    const colorClasses: Record<string, string> = {
        primary: 'bg-brand-navy',
        green: 'bg-emerald-500',
        red: 'bg-red-500',
        blue: 'bg-brand-navy',
        amber: 'bg-amber-500',
    };

    return (
        <div className="space-y-1">
            <div className="flex justify-between">
                <span className="text-[10px] text-gray-500">{label}</span>
                <span className="text-[10px] font-semibold text-brand-navy tabular-nums">{percent.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                    className={`h-full ${colorClasses[color] ?? 'bg-brand-navy'} rounded-full transition-all duration-500`}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    );
}

const Calculator = () => {
    const [inputs, setInputs] = useState<CalculatorInputs>(defaultInputs);
    const [targetProfit, setTargetProfit] = useState(50000);
    const [scalingSteps, setScalingSteps] = useState(5);
    const [scalingTarget, setScalingTarget] = useState(100000);

    // Core calculation logic
    const metrics = useMemo(() => {
        const {
            productCost, callCenter, packaging, shippingFee, riskBuffer,
            fbLeads, costPerLead, confirmationRate, deliveryRate, salePrice
        } = inputs;

        const confirmedOrders = Math.round(fbLeads * (confirmationRate / 100));
        const deliveredOrders = Math.round(confirmedOrders * (deliveryRate / 100));
        const failedOrders = confirmedOrders - deliveredOrders;
        const overallConversionRate = fbLeads > 0 ? (deliveredOrders / fbLeads) * 100 : 0;

        const totalAdSpend = fbLeads * costPerLead;
        const adCostPerConfirmed = confirmedOrders > 0 ? totalAdSpend / confirmedOrders : 0;
        const adCostPerDelivered = deliveredOrders > 0 ? totalAdSpend / deliveredOrders : 0;

        const upfrontCostPerOrder = productCost + callCenter + packaging + riskBuffer;
        const totalCostPerDelivered = upfrontCostPerOrder + shippingFee + adCostPerDelivered;
        const profitPerDelivered = salePrice - totalCostPerDelivered;

        const lossPerFailed = upfrontCostPerOrder + adCostPerConfirmed;
        const totalLossFromFailures = lossPerFailed * failedOrders;

        const grossRevenue = deliveredOrders * salePrice;
        const totalProductCosts = confirmedOrders * upfrontCostPerOrder;
        const totalShippingCosts = deliveredOrders * shippingFee;
        const totalCosts = totalAdSpend + totalProductCosts + totalShippingCosts;
        const netProfit = grossRevenue - totalCosts;

        const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
        const costMargin = grossRevenue > 0 ? (totalCosts / grossRevenue) * 100 : 0;
        const roi = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;
        const roas = totalAdSpend > 0 ? grossRevenue / totalAdSpend : 0;

        const initialInvestment = totalAdSpend + (confirmedOrders * upfrontCostPerOrder);
        const breakEvenDays = netProfit > 0 ? Math.ceil(initialInvestment / netProfit) : Infinity;

        const monthlyLeads = fbLeads * 28;
        const monthlyConfirmed = confirmedOrders * 28;
        const monthlyDelivered = deliveredOrders * 28;
        const monthlyFailed = failedOrders * 28;
        const monthlyRevenue = grossRevenue * 28;
        const monthlyAdSpend = totalAdSpend * 28;
        const monthlyCosts = totalCosts * 28;
        const monthlyProfit = netProfit * 28;
        const monthlyLossFromFailures = totalLossFromFailures * 28;

        const productCostPercent = totalCostPerDelivered > 0 ? (productCost / totalCostPerDelivered) * 100 : 0;
        const shippingPercent = totalCostPerDelivered > 0 ? (shippingFee / totalCostPerDelivered) * 100 : 0;
        const adCostPercent = totalCostPerDelivered > 0 ? (adCostPerDelivered / totalCostPerDelivered) * 100 : 0;
        const otherCostPercent = totalCostPerDelivered > 0 ? ((callCenter + packaging + riskBuffer) / totalCostPerDelivered) * 100 : 0;

        return {
            confirmedOrders, deliveredOrders, failedOrders, overallConversionRate,
            totalAdSpend, adCostPerConfirmed, adCostPerDelivered,
            upfrontCostPerOrder, totalCostPerDelivered, profitPerDelivered,
            lossPerFailed, totalLossFromFailures,
            grossRevenue, totalProductCosts, totalShippingCosts, totalCosts, netProfit, initialInvestment,
            profitMargin, costMargin, roi, roas, breakEvenDays,
            monthlyLeads, monthlyConfirmed, monthlyDelivered, monthlyFailed,
            monthlyRevenue, monthlyAdSpend, monthlyCosts, monthlyProfit, monthlyLossFromFailures,
            productCostPercent, shippingPercent, adCostPercent, otherCostPercent
        };
    }, [inputs]);

    const projectionChartData = useMemo(() => {
        const days = [1, 7, 14, 21, 28, 60, 90];
        return days.map(day => ({
            day: day === 1 ? '1d' : day === 7 ? '1w' : day === 14 ? '2w' : day === 21 ? '3w' : day === 28 ? '1m' : day === 60 ? '2m' : '3m',
            revenue: metrics.grossRevenue * day,
            profit: metrics.netProfit * day,
            costs: metrics.totalCosts * day,
            investment: metrics.initialInvestment
        }));
    }, [metrics]);

    const funnelChartData = useMemo(() => [
        { stage: 'Leads', value: inputs.fbLeads },
        { stage: 'Confirmed', value: metrics.confirmedOrders },
        { stage: 'Delivered', value: metrics.deliveredOrders }
    ], [inputs.fbLeads, metrics.confirmedOrders, metrics.deliveredOrders]);

    const scalingChartData = useMemo(() => {
        if (metrics.profitPerDelivered <= 0) return [];
        const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
        return steps.map(multiplier => {
            const profit = targetProfit * multiplier;
            const sales = Math.ceil(profit / metrics.profitPerDelivered);
            const conversionRate = (inputs.confirmationRate / 100) * (inputs.deliveryRate / 100);
            const leads = Math.ceil(sales / conversionRate);
            const adBudget = leads * inputs.costPerLead;
            return {
                target: `${(profit / 1000).toFixed(0)}K`,
                profit: profit,
                sales: sales,
                adBudget: adBudget
            };
        });
    }, [targetProfit, metrics.profitPerDelivered, inputs]);

    const reverseCalc = useMemo(() => {
        if (metrics.profitPerDelivered <= 0) return null;

        const conversionRate = (inputs.confirmationRate / 100) * (inputs.deliveryRate / 100);
        const monthly = {
            sales: Math.ceil(targetProfit / metrics.profitPerDelivered),
            leads: 0,
            confirmed: 0,
            adBudget: 0,
            revenue: 0,
            totalInvestment: 0
        };

        monthly.leads = Math.ceil(monthly.sales / conversionRate);
        monthly.confirmed = Math.ceil(monthly.leads * (inputs.confirmationRate / 100));
        monthly.adBudget = monthly.leads * inputs.costPerLead;
        monthly.revenue = monthly.sales * inputs.salePrice;
        monthly.totalInvestment = monthly.adBudget + (monthly.confirmed * metrics.upfrontCostPerOrder);

        const daily = {
            sales: Math.ceil(monthly.sales / 28),
            leads: Math.ceil(monthly.leads / 28),
            adBudget: Math.ceil(monthly.adBudget / 28),
            revenue: Math.ceil(monthly.revenue / 28),
            profit: Math.ceil(targetProfit / 28)
        };

        const weekly = {
            sales: Math.ceil(monthly.sales / 4),
            leads: Math.ceil(monthly.leads / 4),
            adBudget: Math.ceil(monthly.adBudget / 4),
            profit: Math.ceil(targetProfit / 4)
        };

        return { monthly, daily, weekly };
    }, [targetProfit, inputs, metrics]);

    const roiTimelineData = useMemo(() => {
        const periods = [1, 7, 14, 28, 60, 90];
        return periods.map(days => {
            const cumulativeProfit = metrics.netProfit * days;
            const roi = metrics.initialInvestment > 0 ? (cumulativeProfit / metrics.initialInvestment) * 100 : 0;
            let badge: 'excellent' | 'good' | 'moderate' | 'poor' = 'poor';
            if (roi >= 300) badge = 'excellent';
            else if (roi >= 150) badge = 'good';
            else if (roi >= 50) badge = 'moderate';
            return { days, cumulativeProfit, roi, badge };
        });
    }, [metrics]);

    const recommendations = useMemo(() => {
        const recs: { text: string; type: 'success' | 'warning' | 'danger' | 'info' }[] = [];
        const grossMargin = inputs.salePrice > 0 ? (metrics.profitPerDelivered / inputs.salePrice) * 100 : 0;

        if (metrics.roi < 100) {
            recs.push({ text: 'Low ROI: Your return on investment is below 100%. Consider optimizing ad campaigns or increasing your sale price.', type: 'danger' });
        } else if (metrics.roi < 300) {
            recs.push({ text: 'Moderate ROI: Your business is profitable but there is room for improvement. Test improving conversion rates.', type: 'warning' });
        } else {
            recs.push({ text: 'Excellent ROI! Your business is highly profitable. Focus on scaling now.', type: 'success' });
        }

        if (grossMargin < 30) {
            recs.push({ text: 'Low margin: Your gross margin is below 30%. Negotiate better supplier prices or increase your sale price.', type: 'danger' });
        } else if (grossMargin > 50) {
            recs.push({ text: 'Excellent margin! You have a healthy margin to invest in growth.', type: 'success' });
        }

        if (metrics.breakEvenDays > 7 && metrics.breakEvenDays !== Infinity) {
            recs.push({ text: 'Slow break-even: It takes more than a week to recover your investment. Reduce acquisition costs.', type: 'warning' });
        } else if (metrics.breakEvenDays <= 3) {
            recs.push({ text: 'Fast break-even! You recover your investment very quickly.', type: 'success' });
        }

        if (metrics.overallConversionRate < 30) {
            recs.push({ text: `Low conversion: Only ${metrics.overallConversionRate.toFixed(1)}% of leads convert to sales. Improve your confirmation and delivery process.`, type: 'warning' });
        }

        if (metrics.roas < 2) {
            recs.push({ text: `ROAS is ${metrics.roas.toFixed(2)}x. Aim for at least 3x to ensure sustainable growth.`, type: 'warning' });
        } else if (metrics.roas >= 5) {
            recs.push({ text: `Strong ROAS of ${metrics.roas.toFixed(2)}x. Your ad spend is very efficient.`, type: 'success' });
        }

        return recs;
    }, [metrics, inputs.salePrice]);

    const scalingPlanData = useMemo(() => {
        if (metrics.profitPerDelivered <= 0) return [];

        const conversionRate = (inputs.confirmationRate / 100) * (inputs.deliveryRate / 100);
        const currentMonthlyProfit = metrics.netProfit * 28;
        const profitIncrement = (scalingTarget - currentMonthlyProfit) / scalingSteps;

        const steps = [];
        for (let i = 0; i <= scalingSteps; i++) {
            const stepProfit = currentMonthlyProfit + (profitIncrement * i);
            const salesPerMonth = stepProfit / metrics.profitPerDelivered;
            const salesPerDay = salesPerMonth / 28;
            const leadsPerMonth = salesPerMonth / conversionRate;
            const leadsPerDay = leadsPerMonth / 28;
            const adBudgetPerMonth = leadsPerMonth * inputs.costPerLead;
            const adBudgetPerDay = adBudgetPerMonth / 28;
            const revenuePerDay = salesPerDay * inputs.salePrice;

            steps.push({
                step: i,
                label: i === 0 ? 'Baseline' : `Step ${i}`,
                month: i === 0 ? 'Current' : `Month ${i}`,
                monthlyProfit: stepProfit,
                dailySales: Math.ceil(salesPerDay),
                dailyLeads: Math.ceil(leadsPerDay),
                dailyAdBudget: Math.round(adBudgetPerDay),
                dailyRevenue: Math.round(revenuePerDay),
            });
        }
        return steps;
    }, [scalingTarget, scalingSteps, metrics, inputs]);

    const optimizationImpact = useMemo(() => {
        const { confirmationRate, deliveryRate, costPerLead, salePrice } = inputs;
        const { profitPerDelivered } = metrics;

        const newConfRate = Math.min(confirmationRate + 10, 100);
        const newDelRate = Math.min(deliveryRate + 10, 100);
        const oldConv = (confirmationRate / 100) * (deliveryRate / 100);
        const confImpactConv = (newConfRate / 100) * (deliveryRate / 100);
        const delImpactConv = (confirmationRate / 100) * (newDelRate / 100);

        const confImpact = oldConv > 0 ? ((confImpactConv - oldConv) / oldConv * 100).toFixed(0) : '0';
        const delImpact = oldConv > 0 ? ((delImpactConv - oldConv) / oldConv * 100).toFixed(0) : '0';

        const cpl15 = profitPerDelivered > 0 ? (((profitPerDelivered + (costPerLead * (1 / oldConv) - 15 * (1 / oldConv))) / profitPerDelivered - 1) * 100).toFixed(0) : '0';
        const cpl10 = profitPerDelivered > 0 ? (((profitPerDelivered + (costPerLead * (1 / oldConv) - 10 * (1 / oldConv))) / profitPerDelivered - 1) * 100).toFixed(0) : '0';

        const price249 = salePrice > 0 ? (((249 - (salePrice - profitPerDelivered)) / profitPerDelivered - 1) * 100).toFixed(0) : '0';
        const price299 = salePrice > 0 ? (((299 - (salePrice - profitPerDelivered)) / profitPerDelivered - 1) * 100).toFixed(0) : '0';

        return { confImpact, delImpact, cpl15, cpl10, price249, price299 };
    }, [inputs, metrics]);

    const handleInputChange = (field: keyof CalculatorInputs, value: string) => {
        setInputs(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Profit Calculator</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">E-commerce profitability analysis</p>
                    </div>
                </div>
            </header>

            <Tabs defaultValue="calculator" className="space-y-3">
                <TabsList className="h-8">
                    <TabsTrigger value="calculator" className="text-[11px] h-6 px-3 gap-1.5">
                        <CalculatorIcon className="w-3 h-3" />
                        Calculator
                    </TabsTrigger>
                    <TabsTrigger value="target" className="text-[11px] h-6 px-3 gap-1.5">
                        <Target className="w-3 h-3" />
                        Profit Target
                    </TabsTrigger>
                    <TabsTrigger value="investment" className="text-[11px] h-6 px-3 gap-1.5">
                        <BarChart3 className="w-3 h-3" />
                        Investment & ROI
                    </TabsTrigger>
                    <TabsTrigger value="scaling" className="text-[11px] h-6 px-3 gap-1.5">
                        <Zap className="w-3 h-3" />
                        Scaling Plan
                    </TabsTrigger>
                </TabsList>

                {/* ==================== TAB 1: MAIN CALCULATOR ==================== */}
                <TabsContent value="calculator" className="space-y-3 mt-0">

                    {/* KPI Strip */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: metrics.netProfit >= 0 ? '#059669' : '#ef4444' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Daily Profit</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{metrics.netProfit.toFixed(2)}</p>
                                <p className="text-[9px] text-gray-400">MAD / day</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: '#3b5e5e' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Per Sale</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{metrics.profitPerDelivered.toFixed(2)}</p>
                                <p className="text-[9px] text-gray-400">MAD profit</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: metrics.roi >= 0 ? '#059669' : '#ef4444' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">ROI</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{metrics.roi.toFixed(0)}%</p>
                                <p className="text-[9px] text-gray-400">return</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: '#d97706' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">ROAS</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{metrics.roas.toFixed(2)}x</p>
                                <p className="text-[9px] text-gray-400">ad return</p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: '#9ca3af' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Break-even</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">
                                    {metrics.breakEvenDays === Infinity ? '—' : metrics.breakEvenDays}
                                </p>
                                <p className="text-[9px] text-gray-400">{metrics.breakEvenDays === Infinity ? 'Not profitable' : 'days'}</p>
                            </div>
                        </div>
                    </div>

                    {/* Input Sections */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <Box className="w-3.5 h-3.5 text-gray-400" />
                                    Product & Operations
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5 space-y-2.5">
                                <CalculatorInputField label="Product Cost" field="productCost" value={inputs.productCost} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Call Center" field="callCenter" value={inputs.callCenter} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Packaging" field="packaging" value={inputs.packaging} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Shipping Fee" field="shippingFee" value={inputs.shippingFee} onFieldChange={handleInputChange} suffix="MAD" hint="Only charged on delivered orders" />
                                <CalculatorInputField label="Risk Buffer" field="riskBuffer" value={inputs.riskBuffer} onFieldChange={handleInputChange} suffix="MAD" />
                                <div className="pt-2.5 border-t border-gray-100 space-y-1.5">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-gray-500">Upfront cost/order</span>
                                        <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{metrics.upfrontCostPerOrder.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-gray-500">Total cost/delivered</span>
                                        <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{metrics.totalCostPerDelivered.toFixed(2)} MAD</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5 text-gray-400" />
                                    Advertising
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5 space-y-2.5">
                                <CalculatorInputField label="Daily FB Leads" field="fbLeads" value={inputs.fbLeads} onFieldChange={handleInputChange} />
                                <CalculatorInputField label="Cost per Lead" field="costPerLead" value={inputs.costPerLead} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Confirmation Rate" field="confirmationRate" value={inputs.confirmationRate} onFieldChange={handleInputChange} suffix="%" />
                                <CalculatorInputField label="Delivery Rate" field="deliveryRate" value={inputs.deliveryRate} onFieldChange={handleInputChange} suffix="%" />
                                <div className="pt-2.5 border-t border-gray-100 space-y-1.5">
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-gray-500">Daily ad spend</span>
                                        <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{metrics.totalAdSpend.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-gray-500">Ad cost/delivered</span>
                                        <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{metrics.adCostPerDelivered.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-[10px] text-gray-500">Overall conversion</span>
                                        <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{metrics.overallConversionRate.toFixed(1)}%</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                                    Sales & Conversion
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5 space-y-2.5">
                                <CalculatorInputField label="Sale Price" field="salePrice" value={inputs.salePrice} onFieldChange={handleInputChange} suffix="MAD" />
                                <div className="pt-1 space-y-1.5">
                                    {[
                                        { label: 'Leads', value: inputs.fbLeads, color: '#3b5e5e' },
                                        { label: 'Confirmed', value: metrics.confirmedOrders, color: '#d97706' },
                                        { label: 'Delivered', value: metrics.deliveredOrders, color: '#059669' },
                                        { label: 'Failed', value: metrics.failedOrders, color: '#ef4444' },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full" style={{ background: row.color }} />
                                                <span className="text-[11px] text-gray-600">{row.label}</span>
                                            </div>
                                            <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                                    Profit & Revenue Projection
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5">
                                <ResponsiveContainer width="100%" height={200}>
                                    <AreaChart data={projectionChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                        <Tooltip content={<ProfitChartTooltip />} />
                                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#3b5e5e" strokeWidth={1.5} fill="#3b5e5e20" />
                                        <Area type="monotone" dataKey="profit" name="Profit" stroke="#059669" strokeWidth={1.5} fill="#05966920" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="flex justify-center gap-4 mt-2">
                                    <div className="flex items-center gap-1.5 text-[9px] text-gray-500">
                                        <div className="w-3 h-0.5 rounded bg-brand-navy" />Revenue
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[9px] text-gray-500">
                                        <div className="w-3 h-0.5 rounded bg-emerald-500" />Profit
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <Activity className="w-3.5 h-3.5 text-brand-navy/40" />
                                    Conversion Funnel
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5">
                                <ResponsiveContainer width="100%" height={200}>
                                    <AreaChart data={funnelChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                        <XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} />
                                        <Tooltip content={<ProfitChartTooltip />} />
                                        <Area type="monotone" dataKey="value" name="Count" stroke="#3b5e5e" strokeWidth={1.5} fill="#3b5e5e20" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="grid grid-cols-3 gap-1.5 mt-2">
                                    {[
                                        { label: 'Leads', value: inputs.fbLeads, color: '#3b5e5e' },
                                        { label: 'Confirmed', value: metrics.confirmedOrders, color: '#d97706' },
                                        { label: 'Delivered', value: metrics.deliveredOrders, color: '#059669' },
                                    ].map(r => (
                                        <div key={r.label} className="text-center p-1.5 bg-gray-50 rounded-lg border border-gray-100">
                                            <p className="text-[13px] font-semibold tabular-nums text-brand-navy">{r.value}</p>
                                            <p className="text-[9px] text-gray-400 uppercase tracking-wide">{r.label}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Daily Summary & Loss Analysis */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy">Daily Financial Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <CalculatorStatBox label="Revenue" value={`${metrics.grossRevenue.toFixed(2)} MAD`} type="info" />
                                    <CalculatorStatBox label="Total Costs" value={`${metrics.totalCosts.toFixed(2)} MAD`} />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <CalculatorStatBox label="Ad Spend" value={`${metrics.totalAdSpend.toFixed(0)} MAD`} subValue={`${metrics.adCostPercent.toFixed(0)}%`} />
                                    <CalculatorStatBox label="Product" value={`${metrics.totalProductCosts.toFixed(0)} MAD`} subValue={`${metrics.productCostPercent.toFixed(0)}%`} />
                                    <CalculatorStatBox label="Shipping" value={`${metrics.totalShippingCosts.toFixed(0)} MAD`} subValue={`${metrics.shippingPercent.toFixed(0)}%`} />
                                </div>
                                <CalculatorStatBox
                                    label="Net Profit"
                                    value={`${metrics.netProfit.toFixed(2)} MAD`}
                                    subValue={`${metrics.profitMargin.toFixed(1)}% margin`}
                                    type={metrics.netProfit >= 0 ? 'success' : 'danger'}
                                    large
                                />
                            </CardContent>
                        </Card>

                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="p-3.5 pb-2">
                                <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                    Failed Delivery Impact
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3.5 pb-3.5 space-y-2.5">
                                <div className="p-3 bg-red-50/60 rounded-xl border border-red-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] text-red-700 font-semibold uppercase tracking-wide">Failed Orders</span>
                                        <span className="text-[18px] font-semibold tabular-nums text-red-700">{metrics.failedOrders}</span>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-[10px] text-red-600">Loss per failed</span>
                                            <span className="text-[11px] font-semibold tabular-nums text-red-700">{metrics.lossPerFailed.toFixed(2)} MAD</span>
                                        </div>
                                        <div className="flex justify-between pt-1.5 border-t border-red-200">
                                            <span className="text-[10px] text-red-600 font-semibold">Total daily loss</span>
                                            <span className="text-[11px] font-semibold tabular-nums text-red-700">{metrics.totalLossFromFailures.toFixed(2)} MAD</span>
                                        </div>
                                    </div>
                                </div>
                                <CalculatorProgressBar label="Delivery Success Rate" value={metrics.deliveredOrders} max={metrics.confirmedOrders} color="green" />
                                <CalculatorProgressBar label="Failure Rate" value={metrics.failedOrders} max={metrics.confirmedOrders} color="red" />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Monthly Projection */}
                    <Card className="border border-gray-100 shadow-none rounded-xl">
                        <CardHeader className="p-3.5 pb-2">
                            <CardTitle className="text-[11px] font-semibold text-brand-navy">Monthly Projection (28 days)</CardTitle>
                        </CardHeader>
                        <CardContent className="px-3.5 pb-3.5">
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                                <CalculatorStatBox label="Leads" value={metrics.monthlyLeads.toLocaleString()} type="info" />
                                <CalculatorStatBox label="Confirmed" value={metrics.monthlyConfirmed.toLocaleString()} type="warning" />
                                <CalculatorStatBox label="Delivered" value={metrics.monthlyDelivered.toLocaleString()} type="success" />
                                <CalculatorStatBox label="Failed" value={metrics.monthlyFailed.toLocaleString()} type="danger" />
                                <CalculatorStatBox label="Revenue" value={`${(metrics.monthlyRevenue / 1000).toFixed(1)}K`} subValue="MAD" type="info" />
                                <CalculatorStatBox label="Costs" value={`${(metrics.monthlyCosts / 1000).toFixed(1)}K`} subValue="MAD" />
                                <CalculatorStatBox label="Ad Spend" value={`${(metrics.monthlyAdSpend / 1000).toFixed(1)}K`} subValue="MAD" />
                                <CalculatorStatBox label="Net Profit" value={`${(metrics.monthlyProfit / 1000).toFixed(1)}K`} subValue="MAD" type={metrics.monthlyProfit >= 0 ? 'success' : 'danger'} />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Cost Distribution */}
                    <Card className="border border-gray-100 shadow-none rounded-xl">
                        <CardHeader className="p-3.5 pb-2">
                            <CardTitle className="text-[11px] font-semibold text-brand-navy">Cost Distribution (per delivered order)</CardTitle>
                        </CardHeader>
                        <CardContent className="px-3.5 pb-3.5 space-y-3">
                            <div className="h-6 flex rounded-lg overflow-hidden">
                                <div className="bg-brand-navy h-full flex items-center justify-center text-white text-[9px] font-medium transition-all"
                                    style={{ width: `${metrics.productCostPercent}%` }}>
                                    {metrics.productCostPercent > 10 && `${metrics.productCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-emerald-500 h-full flex items-center justify-center text-white text-[9px] font-medium transition-all"
                                    style={{ width: `${metrics.shippingPercent}%` }}>
                                    {metrics.shippingPercent > 10 && `${metrics.shippingPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-gray-400 h-full flex items-center justify-center text-white text-[9px] font-medium transition-all"
                                    style={{ width: `${metrics.adCostPercent}%` }}>
                                    {metrics.adCostPercent > 10 && `${metrics.adCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-amber-500 h-full flex items-center justify-center text-white text-[9px] font-medium transition-all"
                                    style={{ width: `${metrics.otherCostPercent}%` }}>
                                    {metrics.otherCostPercent > 10 && `${metrics.otherCostPercent.toFixed(0)}%`}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {[
                                    { color: 'bg-brand-navy', label: `Product (${inputs.productCost} MAD)` },
                                    { color: 'bg-emerald-500', label: `Shipping (${inputs.shippingFee} MAD)` },
                                    { color: 'bg-gray-400', label: `Ad Cost (${metrics.adCostPerDelivered.toFixed(2)} MAD)` },
                                    { color: 'bg-amber-500', label: `Other (${(inputs.callCenter + inputs.packaging + inputs.riskBuffer).toFixed(2)} MAD)` },
                                ].map(item => (
                                    <div key={item.label} className="flex items-center gap-1.5">
                                        <div className={`w-2.5 h-2.5 rounded ${item.color}`} />
                                        <span className="text-[10px] text-gray-500">{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== TAB 2: PROFIT TARGET ==================== */}
                <TabsContent value="target" className="space-y-3 mt-0">

                    <Card className="border border-gray-100 shadow-none rounded-xl">
                        <CardContent className="p-3.5">
                            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                                <div className="flex-1">
                                    <Label className="text-[10px] uppercase tracking-[0.15em] font-semibold text-gray-500 mb-1.5 block">Monthly Profit Target</Label>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={targetProfit}
                                            onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                                            className="h-8 text-[13px] font-semibold pr-14 rounded-md border-gray-200 text-brand-navy"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium">MAD</span>
                                    </div>
                                </div>
                                <div className="flex gap-1.5">
                                    {[10000, 25000, 50000, 100000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setTargetProfit(val)}
                                            className={`h-8 px-3 rounded-md text-[11px] font-semibold transition-all ${targetProfit === val
                                                    ? 'bg-brand-navy text-white'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                        >
                                            {(val / 1000)}K
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {metrics.profitPerDelivered <= 0 ? (
                        <Card className="border border-red-100 bg-red-50/60 rounded-xl">
                            <CardContent className="p-6 text-center">
                                <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                                <h3 className="text-[12px] font-semibold text-red-700 mb-1">Cannot Calculate Target</h3>
                                <p className="text-[11px] text-red-600">Your profit per sale is {metrics.profitPerDelivered.toFixed(2)} MAD. Adjust your costs or pricing first.</p>
                            </CardContent>
                        </Card>
                    ) : reverseCalc && (
                        <>
                            {/* Required Sales Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                                <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-brand-navy p-4">
                                    <p className="text-[9px] uppercase tracking-[0.18em] text-white/60 mb-3">To reach {targetProfit.toLocaleString()} MAD/month</p>
                                    <div className="grid grid-cols-3 gap-4 mt-2">
                                        {[
                                            { label: 'sales needed', value: reverseCalc.monthly.sales.toLocaleString() },
                                            { label: 'leads needed', value: reverseCalc.monthly.leads.toLocaleString() },
                                            { label: 'ad budget (MAD)', value: `${(reverseCalc.monthly.adBudget / 1000).toFixed(1)}K` },
                                        ].map(item => (
                                            <div key={item.label}>
                                                <p className="text-[22px] font-semibold tabular-nums text-white">{item.value}</p>
                                                <p className="text-[9px] text-white/50 mt-0.5">{item.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Card className="border border-gray-100 shadow-none rounded-xl">
                                    <CardContent className="p-3.5">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-1">Total Investment Required</p>
                                        <p className="text-[22px] font-semibold tabular-nums text-brand-navy">{(reverseCalc.monthly.totalInvestment / 1000).toFixed(1)}K</p>
                                        <p className="text-[10px] text-gray-400">MAD / month</p>
                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                            <div className="flex justify-between">
                                                <span className="text-[10px] text-gray-500">Expected Revenue</span>
                                                <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{(reverseCalc.monthly.revenue / 1000).toFixed(1)}K MAD</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Scaling Chart */}
                            <Card className="border border-gray-100 shadow-none rounded-xl">
                                <CardHeader className="p-3.5 pb-2">
                                    <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                                        Scaling Projection
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-3.5 pb-3.5">
                                    <ResponsiveContainer width="100%" height={220}>
                                        <ComposedChart data={scalingChartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                            <XAxis dataKey="target" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} />
                                            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} />
                                            <Tooltip content={<ProfitChartTooltip />} />
                                            <Area yAxisId="left" type="monotone" dataKey="profit" name="Profit" stroke="#059669" strokeWidth={1.5} fill="#05966920" />
                                            <Line yAxisId="right" type="monotone" dataKey="sales" name="Sales" stroke="#3b5e5e" strokeWidth={1.5} dot={{ fill: '#3b5e5e', strokeWidth: 0, r: 3 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                    <div className="flex justify-center gap-4 mt-2">
                                        <div className="flex items-center gap-1.5 text-[9px] text-gray-500">
                                            <div className="w-3 h-0.5 rounded bg-emerald-500" />Profit (MAD)
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[9px] text-gray-500">
                                            <div className="w-2 h-2 rounded-full bg-brand-navy" />Sales Required
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Daily & Weekly Requirements */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                <Card className="border border-gray-100 shadow-none rounded-xl">
                                    <CardHeader className="p-3.5 pb-2">
                                        <CardTitle className="text-[11px] font-semibold text-brand-navy">Daily Requirements</CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3.5 pb-3.5">
                                        <div className="grid grid-cols-2 gap-2">
                                            <CalculatorStatBox label="Sales" value={reverseCalc.daily.sales} type="success" large />
                                            <CalculatorStatBox label="Leads" value={reverseCalc.daily.leads} type="info" large />
                                            <CalculatorStatBox label="Ad Budget" value={`${reverseCalc.daily.adBudget} MAD`} />
                                            <CalculatorStatBox label="Revenue" value={`${reverseCalc.daily.revenue} MAD`} />
                                        </div>
                                        <div className="mt-2 p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
                                            <div className="flex justify-between">
                                                <span className="text-[10px] text-emerald-700 font-semibold">Daily Profit</span>
                                                <span className="text-[11px] font-semibold tabular-nums text-emerald-700">{reverseCalc.daily.profit.toLocaleString()} MAD</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border border-gray-100 shadow-none rounded-xl">
                                    <CardHeader className="p-3.5 pb-2">
                                        <CardTitle className="text-[11px] font-semibold text-brand-navy">Weekly Requirements</CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3.5 pb-3.5">
                                        <div className="grid grid-cols-2 gap-2">
                                            <CalculatorStatBox label="Sales" value={reverseCalc.weekly.sales} type="success" large />
                                            <CalculatorStatBox label="Leads" value={reverseCalc.weekly.leads} type="info" large />
                                            <CalculatorStatBox label="Ad Budget" value={`${reverseCalc.weekly.adBudget.toLocaleString()} MAD`} />
                                            <CalculatorStatBox label="Profit" value={`${reverseCalc.weekly.profit.toLocaleString()} MAD`} type="success" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Comparison Table */}
                            <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                                <CardHeader className="p-3.5 pb-2">
                                    <CardTitle className="text-[11px] font-semibold text-brand-navy">Current vs Target Comparison</CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Metric</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Current</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Target</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Change</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {[
                                                    { label: 'FB Leads', current: inputs.fbLeads, target: reverseCalc.daily.leads },
                                                    { label: 'Sales', current: metrics.deliveredOrders, target: reverseCalc.daily.sales },
                                                    { label: 'Ad Budget', current: metrics.totalAdSpend, target: reverseCalc.daily.adBudget, isMoney: true },
                                                    { label: 'Revenue', current: metrics.grossRevenue, target: reverseCalc.daily.revenue, isMoney: true },
                                                    { label: 'Profit', current: metrics.netProfit, target: reverseCalc.daily.profit, isMoney: true }
                                                ].map((row, idx) => (
                                                    <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50">
                                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80">{row.label}</td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.isMoney ? `${row.current.toFixed(0)} MAD` : row.current}</td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.isMoney ? `${row.target.toLocaleString()} MAD` : row.target}</td>
                                                        <td className="px-3 py-2 text-right">
                                                            <span className={`text-[11px] font-semibold tabular-nums ${row.target > row.current ? 'text-emerald-600' : 'text-red-500'}`}>
                                                                {row.target > row.current ? '+' : ''}{((row.target - row.current) / (row.current || 1) * 100).toFixed(0)}%
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Feasibility */}
                            <Card className="border border-gray-100 shadow-none rounded-xl">
                                <CardHeader className="p-3.5 pb-2">
                                    <CardTitle className="text-[11px] font-semibold text-brand-navy">Feasibility Analysis</CardTitle>
                                </CardHeader>
                                <CardContent className="px-3.5 pb-3.5">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        {[
                                            {
                                                label: 'Current Daily Capacity',
                                                main: `${metrics.deliveredOrders}`,
                                                sub: `sales/day`,
                                                note: `Required: ${reverseCalc.daily.sales} sales/day`
                                            },
                                            {
                                                label: 'Scale Factor Needed',
                                                main: metrics.deliveredOrders > 0 ? `${(reverseCalc.daily.sales / metrics.deliveredOrders).toFixed(1)}x` : '—',
                                                sub: '',
                                                note: 'Multiply operations'
                                            },
                                            {
                                                label: 'Budget Scale',
                                                main: metrics.totalAdSpend > 0 ? `${(reverseCalc.daily.adBudget / metrics.totalAdSpend).toFixed(1)}x` : '—',
                                                sub: '',
                                                note: `${metrics.totalAdSpend.toFixed(0)} → ${reverseCalc.daily.adBudget} MAD`
                                            },
                                        ].map(item => (
                                            <div key={item.label} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-1.5">{item.label}</p>
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-[18px] font-semibold tabular-nums text-brand-navy">{item.main}</span>
                                                    {item.sub && <span className="text-[10px] text-gray-400">{item.sub}</span>}
                                                </div>
                                                <p className="text-[9px] text-gray-400 mt-1">{item.note}</p>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </TabsContent>

                {/* ==================== TAB 3: INVESTMENT & ROI ==================== */}
                <TabsContent value="investment" className="space-y-3 mt-0">

                    {/* Summary Banner */}
                    <div className="rounded-xl border border-gray-100 bg-brand-navy p-4">
                        <p className="text-[9px] uppercase tracking-[0.18em] text-white/60 mb-3">Investment Overview</p>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {[
                                { label: 'Total Investment', value: metrics.initialInvestment.toLocaleString(), unit: 'MAD' },
                                { label: 'Monthly Revenue', value: metrics.monthlyRevenue.toLocaleString(), unit: 'MAD' },
                                { label: 'ROI', value: `${metrics.roi.toFixed(1)}%`, unit: '', highlight: metrics.roi >= 100 },
                                { label: 'Break-Even Days', value: metrics.breakEvenDays === Infinity ? '∞' : metrics.breakEvenDays.toFixed(1), unit: '' },
                            ].map(item => (
                                <div key={item.label}>
                                    <p className="text-[18px] font-semibold tabular-nums text-white">{item.value}</p>
                                    <p className="text-[9px] text-white/50 mt-0.5">{item.label}{item.unit ? ` (${item.unit})` : ''}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Investment Breakdown */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <CalculatorStatBox
                            label="Ad Cost"
                            value={`${metrics.monthlyAdSpend.toLocaleString()} MAD`}
                            subValue={`${((metrics.monthlyAdSpend / (metrics.initialInvestment || 1)) * 100).toFixed(0)}% of investment`}
                            type="info"
                        />
                        <CalculatorStatBox
                            label="Product Cost (batch)"
                            value={`${(inputs.productCost * metrics.deliveredOrders).toLocaleString()} MAD`}
                            subValue={`${inputs.productCost} MAD × ${metrics.deliveredOrders} units`}
                        />
                        <CalculatorStatBox
                            label="Other Costs"
                            value={`${((inputs.callCenter + inputs.packaging + inputs.riskBuffer) * metrics.confirmedOrders).toLocaleString()} MAD`}
                            subValue="Call center + packaging + risk"
                            type="warning"
                        />
                        <CalculatorStatBox
                            label="Gross Margin"
                            value={`${(inputs.salePrice > 0 ? (metrics.profitPerDelivered / inputs.salePrice * 100) : 0).toFixed(1)}%`}
                            subValue={`${metrics.profitPerDelivered.toFixed(0)} MAD per sale`}
                            type={metrics.profitPerDelivered > 0 ? 'success' : 'danger'}
                        />
                    </div>

                    {/* ROI Timeline */}
                    <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                        <CardHeader className="p-3.5 pb-2">
                            <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-gray-400" />
                                ROI Timeline
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Period</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Cumulative Profit</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">ROI</th>
                                            <th className="px-3 py-2 text-center text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Rating</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {roiTimelineData.map((row) => (
                                            <tr key={row.days} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80">
                                                    {row.days === 1 ? 'Day 1' : `${row.days} Days`}
                                                </td>
                                                <td className={`px-3 py-2 text-right text-[11px] font-semibold tabular-nums ${row.cumulativeProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                                    {row.cumulativeProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} MAD
                                                </td>
                                                <td className={`px-3 py-2 text-right text-[11px] font-semibold tabular-nums ${row.roi >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                                    {row.roi.toFixed(1)}%
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <Badge className={`text-[9px] border-none ${
                                                        row.badge === 'excellent' ? 'bg-emerald-50 text-emerald-700' :
                                                        row.badge === 'good' ? 'bg-gray-100 text-gray-600' :
                                                        row.badge === 'moderate' ? 'bg-amber-50 text-amber-700' :
                                                        'bg-red-50 text-red-600'
                                                    }`}>
                                                        {row.badge}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Recommendations */}
                    <Card className="border border-gray-100 shadow-none rounded-xl">
                        <CardHeader className="p-3.5 pb-2">
                            <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                Recommendations
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-3.5 pb-3.5 space-y-2">
                            {recommendations.map((rec, i) => (
                                <div key={i} className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                                    rec.type === 'success' ? 'bg-emerald-50/60 border-emerald-100' :
                                    rec.type === 'warning' ? 'bg-amber-50/60 border-amber-100' :
                                    rec.type === 'danger' ? 'bg-red-50/60 border-red-100' :
                                    'bg-gray-50 border-gray-100'
                                }`}>
                                    {rec.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> :
                                     rec.type === 'warning' ? <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" /> :
                                     rec.type === 'danger' ? <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" /> :
                                     <Info className="w-4 h-4 text-brand-navy/40 mt-0.5 shrink-0" />}
                                    <p className={`text-[11px] ${
                                        rec.type === 'success' ? 'text-emerald-800' :
                                        rec.type === 'warning' ? 'text-amber-800' :
                                        rec.type === 'danger' ? 'text-red-800' :
                                        'text-brand-navy/70'
                                    }`}>{rec.text}</p>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== TAB 4: SCALING PLAN ==================== */}
                <TabsContent value="scaling" className="space-y-3 mt-0">

                    <Card className="border border-gray-100 shadow-none rounded-xl">
                        <CardContent className="p-3.5">
                            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                                <div className="flex-1">
                                    <Label className="text-[10px] uppercase tracking-[0.15em] font-semibold text-gray-500 mb-1.5 block">Target Monthly Profit</Label>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={scalingTarget}
                                            onChange={(e) => setScalingTarget(parseFloat(e.target.value) || 0)}
                                            className="h-8 text-[13px] font-semibold pr-14 rounded-md border-gray-200 text-brand-navy"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium">MAD</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <Label className="text-[10px] uppercase tracking-[0.15em] font-semibold text-gray-500 mb-1.5 block">Number of Steps</Label>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            min={2}
                                            max={10}
                                            value={scalingSteps}
                                            onChange={(e) => setScalingSteps(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                                            className="h-8 text-[13px] font-semibold pr-14 rounded-md border-gray-200 text-brand-navy"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium">steps</span>
                                    </div>
                                </div>
                                <div className="flex gap-1.5">
                                    {[50000, 100000, 200000, 500000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setScalingTarget(val)}
                                            className={`h-8 px-3 rounded-md text-[11px] font-semibold transition-all ${scalingTarget === val
                                                    ? 'bg-brand-navy text-white'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                        >
                                            {(val / 1000)}K
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {metrics.profitPerDelivered <= 0 ? (
                        <Card className="border border-red-100 bg-red-50/60 rounded-xl">
                            <CardContent className="p-6 text-center">
                                <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                                <h3 className="text-[12px] font-semibold text-red-700 mb-1">Cannot Generate Scaling Plan</h3>
                                <p className="text-[11px] text-red-600">Your profit per sale is negative. Adjust your costs or pricing first.</p>
                            </CardContent>
                        </Card>
                    ) : scalingPlanData.length > 0 && (
                        <>
                            {/* Current vs Target Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                <div className="rounded-xl border border-gray-100 bg-brand-navy p-4">
                                    <p className="text-[9px] uppercase tracking-[0.18em] text-white/60 mb-2">Current State</p>
                                    <div className="grid grid-cols-2 gap-3 mt-2">
                                        <div>
                                            <p className="text-[18px] font-semibold tabular-nums text-white">{(metrics.netProfit * 28).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                            <p className="text-[9px] text-white/50 mt-0.5">Monthly Profit MAD</p>
                                        </div>
                                        <div>
                                            <p className="text-[18px] font-semibold tabular-nums text-white">{scalingPlanData[0]?.dailySales || 0}</p>
                                            <p className="text-[9px] text-white/50 mt-0.5">Daily Sales</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-xl border border-emerald-200 bg-emerald-600 p-4">
                                    <p className="text-[9px] uppercase tracking-[0.18em] text-white/60 mb-2">Target State</p>
                                    <div className="grid grid-cols-2 gap-3 mt-2">
                                        <div>
                                            <p className="text-[18px] font-semibold tabular-nums text-white">{scalingTarget.toLocaleString()}</p>
                                            <p className="text-[9px] text-white/50 mt-0.5">Monthly Profit MAD</p>
                                        </div>
                                        <div>
                                            <p className="text-[18px] font-semibold tabular-nums text-white">{scalingPlanData[scalingPlanData.length - 1]?.dailySales || 0}</p>
                                            <p className="text-[9px] text-white/50 mt-0.5">Daily Sales</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Growth Timeline Table */}
                            <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                                <CardHeader className="p-3.5 pb-2">
                                    <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                        <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                                        Growth Timeline
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Step</th>
                                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Month</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Profit/Mo</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Sales/Day</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Leads/Day</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Ad Budget/Day</th>
                                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Revenue/Day</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {scalingPlanData.map((row, i) => (
                                                    <tr key={row.step} className={`border-b border-gray-50 hover:bg-gray-50 ${i === scalingPlanData.length - 1 ? 'bg-emerald-50/40' : ''}`}>
                                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 font-medium">{row.label}</td>
                                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80">{row.month}</td>
                                                        <td className="px-3 py-2 text-right text-[11px] font-semibold tabular-nums text-brand-navy">{row.monthlyProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-[9px] text-gray-400">MAD</span></td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.dailySales}</td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.dailyLeads}</td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.dailyAdBudget.toLocaleString()} <span className="text-[9px] text-gray-400">MAD</span></td>
                                                        <td className="px-3 py-2 text-right text-[11px] tabular-nums text-brand-navy/80">{row.dailyRevenue.toLocaleString()} <span className="text-[9px] text-gray-400">MAD</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Scaling Step Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                {scalingPlanData.filter(s => s.step > 0).map((step) => (
                                    <Card key={step.step} className="border border-gray-100 shadow-none rounded-xl">
                                        <CardContent className="p-3.5">
                                            <div className="flex items-center justify-between mb-3">
                                                <Badge className="bg-brand-navy text-white text-[9px] border-none">{step.label}</Badge>
                                                <span className="text-[9px] text-gray-400 uppercase tracking-wide">{step.month}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <CalculatorStatBox label="Profit/Mo" value={`${(step.monthlyProfit / 1000).toFixed(1)}K`} type="success" />
                                                <CalculatorStatBox label="Sales/Day" value={step.dailySales} type="info" />
                                                <CalculatorStatBox label="Leads/Day" value={step.dailyLeads} type="warning" />
                                                <CalculatorStatBox label="Ad Budget/Day" value={step.dailyAdBudget.toLocaleString()} />
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {/* Optimization Strategies */}
                            <Card className="border border-gray-100 shadow-none rounded-xl">
                                <CardHeader className="p-3.5 pb-2">
                                    <CardTitle className="text-[11px] font-semibold text-brand-navy flex items-center gap-1.5">
                                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                                        Optimization Strategies
                                    </CardTitle>
                                    <p className="text-[10px] text-gray-400">Impact of improving key metrics on your profit</p>
                                </CardHeader>
                                <CardContent className="px-3.5 pb-3.5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {[
                                            {
                                                icon: <Phone className="w-3.5 h-3.5 text-emerald-600" />,
                                                title: '+10% Confirmation Rate',
                                                value: `+${optimizationImpact.confImpact}%`,
                                                note: `Profit increase from ${inputs.confirmationRate}% → ${Math.min(inputs.confirmationRate + 10, 100)}%`,
                                                bg: 'bg-emerald-50/60 border-emerald-100',
                                                textColor: 'text-emerald-800',
                                                valueColor: 'text-emerald-700',
                                            },
                                            {
                                                icon: <Truck className="w-3.5 h-3.5 text-brand-navy/60" />,
                                                title: '+10% Delivery Rate',
                                                value: `+${optimizationImpact.delImpact}%`,
                                                note: `Profit increase from ${inputs.deliveryRate}% → ${Math.min(inputs.deliveryRate + 10, 100)}%`,
                                                bg: 'bg-gray-50 border-gray-100',
                                                textColor: 'text-brand-navy/80',
                                                valueColor: 'text-brand-navy',
                                            },
                                            {
                                                icon: <TrendingDown className="w-3.5 h-3.5 text-amber-600" />,
                                                title: 'Reduce CPL to 15 MAD',
                                                value: `+${optimizationImpact.cpl15}%`,
                                                note: `Current CPL: ${inputs.costPerLead} MAD → 15 MAD`,
                                                bg: 'bg-amber-50/60 border-amber-100',
                                                textColor: 'text-amber-800',
                                                valueColor: 'text-amber-700',
                                            },
                                            {
                                                icon: <DollarSign className="w-3.5 h-3.5 text-brand-navy/60" />,
                                                title: 'Increase Price to 299 MAD',
                                                value: `+${optimizationImpact.price299}%`,
                                                note: `Current price: ${inputs.salePrice} MAD → 299 MAD`,
                                                bg: 'bg-gray-50 border-gray-100',
                                                textColor: 'text-brand-navy/80',
                                                valueColor: 'text-brand-navy',
                                            },
                                        ].map(item => (
                                            <div key={item.title} className={`p-3 rounded-xl border ${item.bg}`}>
                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                    {item.icon}
                                                    <p className={`text-[11px] font-semibold ${item.textColor}`}>{item.title}</p>
                                                </div>
                                                <p className={`text-[18px] font-semibold tabular-nums ${item.valueColor}`}>{item.value}</p>
                                                <p className={`text-[9px] mt-0.5 ${item.textColor} opacity-70`}>{item.note}</p>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default Calculator;
