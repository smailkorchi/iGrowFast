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
            <div className="bg-ant-paper px-3.5 py-2.5 rounded-xl border border-ant-line shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-mid mb-1.5">{label}</p>
                {payload.map((entry: ChartTooltipPayload, index: number) => (
                    <p key={index} className="text-[12px] font-semibold tabular-nums" style={{ color: entry.color }}>
                        <span className="text-ant-mid font-normal mr-1.5">{entry.name}</span>
                        {entry.value?.toLocaleString()} <span className="text-ant-mid font-normal text-[10px]">MAD</span>
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
        <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">{label}</Label>
            <div className="relative">
                <Input
                    type="number"
                    value={value}
                    onChange={(e) => onFieldChange(field, e.target.value)}
                    className="pr-12 h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                />
                {suffix && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                        {suffix}
                    </span>
                )}
            </div>
            {hint && <p className="font-serif italic text-[11px] text-ant-mid">{hint}</p>}
        </div>
    );
}

type StatBoxTone = 'success' | 'danger' | 'warning' | 'info' | 'default';

const STAT_TONE: Record<StatBoxTone, { dot: string; text: string }> = {
    success: { dot: 'bg-ant-green', text: 'text-ant-green' },
    danger: { dot: 'bg-ant-rose', text: 'text-ant-rose' },
    warning: { dot: 'bg-ant-orange', text: 'text-ant-orange' },
    info: { dot: 'bg-ant-ink', text: 'text-ant-ink' },
    default: { dot: 'bg-ant-mid', text: 'text-ant-ink' },
};

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
    const tone = STAT_TONE[type];
    return (
        <div className="rounded-xl border border-ant-line bg-ant-paper p-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {label}
            </div>
            <p className={`font-display font-semibold tabular-nums mt-1 truncate ${tone.text} ${large ? 'text-[20px]' : 'text-[15px]'}`}>
                {value}
            </p>
            {subValue && <p className="font-serif italic text-[10px] text-ant-mid mt-0.5 truncate">{subValue}</p>}
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
    const colorClasses: Record<string, { bar: string; text: string }> = {
        primary: { bar: 'bg-ant-ink', text: 'text-ant-ink' },
        green: { bar: 'bg-ant-green', text: 'text-ant-green' },
        red: { bar: 'bg-ant-rose', text: 'text-ant-rose' },
        blue: { bar: 'bg-ant-ink', text: 'text-ant-ink' },
        amber: { bar: 'bg-ant-orange', text: 'text-ant-orange' },
    };
    const tone = colorClasses[color] ?? colorClasses.primary;

    return (
        <div className="space-y-1.5">
            <div className="flex justify-between items-baseline">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">{label}</span>
                <span className={`font-display text-[14px] font-semibold tabular-nums ${tone.text}`}>
                    {percent.toFixed(1)}%
                </span>
            </div>
            <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                <div
                    className={`h-full ${tone.bar} rounded-full transition-all duration-500`}
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
        // Sheet model ("calcul" tab): product cost is incurred only on DELIVERED orders
        // (returns are recovered), not on every confirmed order. = "total prix intial".
        const totalProductCosts = deliveredOrders * upfrontCostPerOrder;
        const totalShippingCosts = deliveredOrders * shippingFee;
        const totalCosts = totalAdSpend + totalProductCosts + totalShippingCosts;
        const netProfit = grossRevenue - totalCosts;

        // Sheet "Investissement" = ad spend + delivered product cost (shipping excluded).
        const investment = totalAdSpend + totalProductCosts;

        const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
        const costMargin = grossRevenue > 0 ? (totalCosts / grossRevenue) * 100 : 0;
        // Sheet ROI = net profit ÷ Investissement.
        const roi = investment > 0 ? (netProfit / investment) * 100 : 0;
        const roas = totalAdSpend > 0 ? grossRevenue / totalAdSpend : 0;

        const initialInvestment = investment;
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
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
            {/* Editorial header */}
            <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Finance · Simulation
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Profit Calculator
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        Ad spend in, delivered orders out — adjust the levers and watch the margin breathe. A sandbox for every hypothesis before the money moves.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setInputs(defaultInputs)}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer shrink-0"
                >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Reset inputs
                </button>
            </header>

            <Tabs defaultValue="calculator" className="space-y-5">
                <TabsList className="h-10 rounded-full p-1 bg-ant-paper border border-ant-line inline-flex w-auto">
                    <TabsTrigger value="calculator" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                        <CalculatorIcon className="w-3.5 h-3.5" />
                        Calculator
                    </TabsTrigger>
                    <TabsTrigger value="target" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                        <Target className="w-3.5 h-3.5" />
                        Profit target
                    </TabsTrigger>
                    <TabsTrigger value="investment" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                        <BarChart3 className="w-3.5 h-3.5" />
                        Investment &amp; ROI
                    </TabsTrigger>
                    <TabsTrigger value="scaling" className="text-[12px] h-8 px-3.5 rounded-full gap-1.5 font-semibold data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid">
                        <Zap className="w-3.5 h-3.5" />
                        Scaling plan
                    </TabsTrigger>
                </TabsList>

                {/* ==================== TAB 1: MAIN CALCULATOR ==================== */}
                <TabsContent value="calculator" className="space-y-5 mt-0">

                    {/* KPI Strip — hairline divider grid */}
                    <section className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className={`h-1.5 w-1.5 rounded-full ${metrics.netProfit >= 0 ? 'bg-ant-green' : 'bg-ant-rose'}`} />
                                    Daily profit
                                </div>
                                <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${metrics.netProfit >= 0 ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose'}`}>
                                    <Wallet className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 truncate ${metrics.netProfit >= 0 ? 'text-ant-ink' : 'text-ant-rose'}`}>
                                {metrics.netProfit.toFixed(2)}
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD/day</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                    Per sale
                                </div>
                                <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                    <PiggyBank className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                {metrics.profitPerDelivered.toFixed(2)}
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className={`h-1.5 w-1.5 rounded-full ${metrics.roi >= 0 ? 'bg-ant-green' : 'bg-ant-rose'}`} />
                                    ROI
                                </div>
                                <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${metrics.roi >= 0 ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose'}`}>
                                    <Percent className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 truncate ${metrics.roi >= 0 ? 'text-ant-ink' : 'text-ant-rose'}`}>
                                {metrics.roi.toFixed(0)}%
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">return</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    ROAS
                                </div>
                                <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                                    <Zap className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                {metrics.roas.toFixed(2)}x
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">ad return</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                                    Break-even
                                </div>
                                <div className="h-8 w-8 rounded-lg border bg-ant-light border-ant-line text-ant-mid flex items-center justify-center">
                                    <Clock className="w-4 h-4" strokeWidth={1.75} />
                                </div>
                            </div>
                            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                {metrics.breakEvenDays === Infinity ? '—' : metrics.breakEvenDays}
                                <span className="text-[12px] text-ant-mid font-normal ml-1.5">
                                    {metrics.breakEvenDays === Infinity ? 'not profitable' : 'days'}
                                </span>
                            </p>
                        </div>
                    </section>

                    {/* Input Sections */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-3.5">
                                <div className="flex items-center gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Product &amp; operations
                                    </div>
                                </div>
                                <CalculatorInputField label="Product cost" field="productCost" value={inputs.productCost} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Call center" field="callCenter" value={inputs.callCenter} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Packaging" field="packaging" value={inputs.packaging} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Shipping fee" field="shippingFee" value={inputs.shippingFee} onFieldChange={handleInputChange} suffix="MAD" hint="Only charged on delivered orders" />
                                <CalculatorInputField label="Risk buffer" field="riskBuffer" value={inputs.riskBuffer} onFieldChange={handleInputChange} suffix="MAD" />
                                <div className="pt-3 border-t border-ant-line space-y-2">
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Upfront / order</span>
                                        <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                            {metrics.upfrontCostPerOrder.toFixed(2)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Total / delivered</span>
                                        <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                            {metrics.totalCostPerDelivered.toFixed(2)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-3.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Advertising
                                </div>
                                <CalculatorInputField label="Daily FB leads" field="fbLeads" value={inputs.fbLeads} onFieldChange={handleInputChange} />
                                <CalculatorInputField label="Cost per lead" field="costPerLead" value={inputs.costPerLead} onFieldChange={handleInputChange} suffix="MAD" />
                                <CalculatorInputField label="Confirmation rate" field="confirmationRate" value={inputs.confirmationRate} onFieldChange={handleInputChange} suffix="%" />
                                <CalculatorInputField label="Delivery rate" field="deliveryRate" value={inputs.deliveryRate} onFieldChange={handleInputChange} suffix="%" />
                                <div className="pt-3 border-t border-ant-line space-y-2">
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Daily ad spend</span>
                                        <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                            {metrics.totalAdSpend.toFixed(2)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Ad / delivered</span>
                                        <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                            {metrics.adCostPerDelivered.toFixed(2)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Overall conv.</span>
                                        <span className="font-display text-[13px] font-semibold tabular-nums text-ant-green">
                                            {metrics.overallConversionRate.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-3.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">03</span>
                                    Sales &amp; conversion
                                </div>
                                <CalculatorInputField label="Sale price" field="salePrice" value={inputs.salePrice} onFieldChange={handleInputChange} suffix="MAD" />
                                <div className="pt-2 space-y-1.5">
                                    {[
                                        { label: 'Leads', value: inputs.fbLeads, dot: 'bg-ant-ink', text: 'text-ant-ink' },
                                        { label: 'Confirmed', value: metrics.confirmedOrders, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                                        { label: 'Delivered', value: metrics.deliveredOrders, dot: 'bg-ant-green', text: 'text-ant-green' },
                                        { label: 'Failed', value: metrics.failedOrders, dot: 'bg-ant-rose', text: 'text-ant-rose' },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center justify-between px-3 py-2 rounded-xl bg-ant-light border border-ant-line">
                                            <div className="flex items-center gap-2">
                                                <span className={`h-1.5 w-1.5 rounded-full ${row.dot}`} />
                                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">{row.label}</span>
                                            </div>
                                            <span className={`font-display text-[14px] font-semibold tabular-nums ${row.text}`}>{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-green" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">04</span>
                                        Profit &amp; revenue projection
                                    </div>
                                    <span className="font-serif italic text-[11px] text-ant-mid">over 90 days</span>
                                </div>
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={projectionChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E0" vertical={false} />
                                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                        <Tooltip content={<ProfitChartTooltip />} />
                                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#141413" strokeWidth={1.75} fill="#14141310" />
                                        <Area type="monotone" dataKey="profit" name="Profit" stroke="#2D7A3E" strokeWidth={1.75} fill="#2D7A3E18" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="flex justify-center gap-5 pt-1 border-t border-ant-line">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid pt-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />Revenue
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid pt-2">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />Profit
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">05</span>
                                        Conversion funnel
                                    </div>
                                    <span className="font-serif italic text-[11px] text-ant-mid">leads to delivery</span>
                                </div>
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={funnelChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E0" vertical={false} />
                                        <XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} />
                                        <Tooltip content={<ProfitChartTooltip />} />
                                        <Area type="monotone" dataKey="value" name="Count" stroke="#D97706" strokeWidth={1.75} fill="#D9770618" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                    {[
                                        { label: 'Leads', value: inputs.fbLeads, dot: 'bg-ant-ink', text: 'text-ant-ink' },
                                        { label: 'Confirmed', value: metrics.confirmedOrders, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                                        { label: 'Delivered', value: metrics.deliveredOrders, dot: 'bg-ant-green', text: 'text-ant-green' },
                                    ].map(r => (
                                        <div key={r.label} className="bg-ant-paper px-3 py-2.5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
                                                {r.label}
                                            </div>
                                            <p className={`font-display text-[16px] font-semibold tabular-nums mt-1 ${r.text}`}>{r.value}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Daily Summary & Loss Analysis */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-ink" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">06</span>
                                        Daily financial summary
                                    </div>
                                    <span className="font-serif italic text-[11px] text-ant-mid">per 24h cycle</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <CalculatorStatBox label="Revenue" value={`${metrics.grossRevenue.toFixed(2)} MAD`} type="info" />
                                    <CalculatorStatBox label="Total costs" value={`${metrics.totalCosts.toFixed(2)} MAD`} />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <CalculatorStatBox label="Ad spend" value={`${metrics.totalAdSpend.toFixed(0)} MAD`} subValue={`${metrics.adCostPercent.toFixed(0)}% of cost`} />
                                    <CalculatorStatBox label="Product" value={`${metrics.totalProductCosts.toFixed(0)} MAD`} subValue={`${metrics.productCostPercent.toFixed(0)}% of cost`} />
                                    <CalculatorStatBox label="Shipping" value={`${metrics.totalShippingCosts.toFixed(0)} MAD`} subValue={`${metrics.shippingPercent.toFixed(0)}% of cost`} />
                                </div>
                                <div className={`rounded-xl p-4 ${metrics.netProfit >= 0 ? 'bg-ant-ink text-white' : 'bg-ant-rose/10 border border-ant-rose/25'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] opacity-70">
                                            <span className={`h-1.5 w-1.5 rounded-full ${metrics.netProfit >= 0 ? 'bg-ant-orange' : 'bg-ant-rose'}`} />
                                            Net profit
                                        </div>
                                        <span className="font-serif italic text-[11px] opacity-70">{metrics.profitMargin.toFixed(1)}% margin</span>
                                    </div>
                                    <p className={`font-display text-[28px] font-semibold tabular-nums mt-1.5 ${metrics.netProfit >= 0 ? '' : 'text-ant-rose'}`}>
                                        {metrics.netProfit.toFixed(2)}
                                        <span className={`text-[13px] font-normal ml-2 ${metrics.netProfit >= 0 ? 'opacity-60' : 'text-ant-mid'}`}>MAD / day</span>
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-rose" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">07</span>
                                        Failed delivery impact
                                    </div>
                                    <AlertTriangle className="w-3.5 h-3.5 text-ant-rose" strokeWidth={1.75} />
                                </div>
                                <div className="rounded-xl border border-ant-rose/25 bg-ant-rose/10 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-ant-rose">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                            Failed orders
                                        </div>
                                        <span className="font-display text-[22px] font-semibold tabular-nums text-ant-rose">{metrics.failedOrders}</span>
                                    </div>
                                    <div className="space-y-1.5 pt-2 border-t border-ant-rose/20">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-rose/80">Loss per failed</span>
                                            <span className="font-display text-[13px] font-semibold tabular-nums text-ant-rose">{metrics.lossPerFailed.toFixed(2)} <span className="text-[10px] opacity-70 font-normal">MAD</span></span>
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-rose/80">Total daily loss</span>
                                            <span className="font-display text-[13px] font-semibold tabular-nums text-ant-rose">{metrics.totalLossFromFailures.toFixed(2)} <span className="text-[10px] opacity-70 font-normal">MAD</span></span>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-3 pt-1">
                                    <CalculatorProgressBar label="Delivery success rate" value={metrics.deliveredOrders} max={metrics.confirmedOrders} color="green" />
                                    <CalculatorProgressBar label="Failure rate" value={metrics.failedOrders} max={metrics.confirmedOrders} color="red" />
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Monthly Projection */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">08</span>
                                    Monthly projection
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">28-day rolling window</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                {[
                                    { label: 'Leads', value: metrics.monthlyLeads.toLocaleString(), sub: 'visitors', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                                    { label: 'Confirmed', value: metrics.monthlyConfirmed.toLocaleString(), sub: 'orders', dot: 'bg-ant-orange', text: 'text-ant-orange' },
                                    { label: 'Delivered', value: metrics.monthlyDelivered.toLocaleString(), sub: 'orders', dot: 'bg-ant-green', text: 'text-ant-green' },
                                    { label: 'Failed', value: metrics.monthlyFailed.toLocaleString(), sub: 'orders', dot: 'bg-ant-rose', text: 'text-ant-rose' },
                                    { label: 'Revenue', value: `${(metrics.monthlyRevenue / 1000).toFixed(1)}K`, sub: 'MAD', dot: 'bg-ant-ink', text: 'text-ant-ink' },
                                    { label: 'Costs', value: `${(metrics.monthlyCosts / 1000).toFixed(1)}K`, sub: 'MAD', dot: 'bg-ant-mid', text: 'text-ant-ink' },
                                    { label: 'Ad spend', value: `${(metrics.monthlyAdSpend / 1000).toFixed(1)}K`, sub: 'MAD', dot: 'bg-ant-orange', text: 'text-ant-orange' },
                                    { label: 'Net profit', value: `${(metrics.monthlyProfit / 1000).toFixed(1)}K`, sub: 'MAD', dot: metrics.monthlyProfit >= 0 ? 'bg-ant-green' : 'bg-ant-rose', text: metrics.monthlyProfit >= 0 ? 'text-ant-green' : 'text-ant-rose' },
                                ].map(t => (
                                    <div key={t.label} className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                            <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                                            {t.label}
                                        </div>
                                        <p className={`font-display text-[16px] font-semibold tabular-nums mt-1 truncate ${t.text}`}>{t.value}</p>
                                        <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{t.sub}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Cost Distribution */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">09</span>
                                    Cost distribution
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">per delivered order</span>
                            </div>
                            <div className="h-8 flex rounded-xl overflow-hidden border border-ant-line">
                                <div className="bg-ant-ink h-full flex items-center justify-center text-white text-[10px] font-semibold tabular-nums transition-all"
                                    style={{ width: `${metrics.productCostPercent}%` }}>
                                    {metrics.productCostPercent > 10 && `${metrics.productCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-ant-green h-full flex items-center justify-center text-white text-[10px] font-semibold tabular-nums transition-all"
                                    style={{ width: `${metrics.shippingPercent}%` }}>
                                    {metrics.shippingPercent > 10 && `${metrics.shippingPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-ant-mid h-full flex items-center justify-center text-white text-[10px] font-semibold tabular-nums transition-all"
                                    style={{ width: `${metrics.adCostPercent}%` }}>
                                    {metrics.adCostPercent > 10 && `${metrics.adCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-ant-orange h-full flex items-center justify-center text-white text-[10px] font-semibold tabular-nums transition-all"
                                    style={{ width: `${metrics.otherCostPercent}%` }}>
                                    {metrics.otherCostPercent > 10 && `${metrics.otherCostPercent.toFixed(0)}%`}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                {[
                                    { dot: 'bg-ant-ink', label: 'Product', amount: `${inputs.productCost}` },
                                    { dot: 'bg-ant-green', label: 'Shipping', amount: `${inputs.shippingFee}` },
                                    { dot: 'bg-ant-mid', label: 'Ad cost', amount: `${metrics.adCostPerDelivered.toFixed(2)}` },
                                    { dot: 'bg-ant-orange', label: 'Other', amount: `${(inputs.callCenter + inputs.packaging + inputs.riskBuffer).toFixed(2)}` },
                                ].map(item => (
                                    <div key={item.label} className="bg-ant-paper px-3 py-2.5">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                            <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                                            {item.label}
                                        </div>
                                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink mt-1">{item.amount} <span className="text-[10px] text-ant-mid font-normal">MAD</span></p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                </TabsContent>

                {/* ==================== TAB 2: PROFIT TARGET ==================== */}
                <TabsContent value="target" className="space-y-5 mt-0">

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5">
                            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                                <div className="flex-1 space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Monthly profit target
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={targetProfit}
                                            onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                                            className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums pr-14 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">MAD</span>
                                    </div>
                                    <p className="font-serif italic text-[11px] text-ant-mid">Set the ceiling, we compute the climb.</p>
                                </div>
                                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-light">
                                    {[10000, 25000, 50000, 100000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setTargetProfit(val)}
                                            className={`h-8 px-3.5 rounded-full text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${targetProfit === val
                                                    ? 'bg-ant-ink text-white'
                                                    : 'text-ant-mid hover:text-ant-ink'
                                                }`}
                                        >
                                            {(val / 1000)}K
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {metrics.profitPerDelivered <= 0 ? (
                        <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/10 p-6 text-center">
                            <XCircle className="w-8 h-8 text-ant-rose mx-auto mb-2" strokeWidth={1.5} />
                            <h3 className="font-display text-[16px] font-semibold text-ant-rose mb-1">Cannot calculate target</h3>
                            <p className="font-serif italic text-[12px] text-ant-rose/80">Your profit per sale is {metrics.profitPerDelivered.toFixed(2)} MAD. Adjust your costs or pricing first.</p>
                        </section>
                    ) : reverseCalc && (
                        <>
                            {/* Required Sales Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                <div className="lg:col-span-2 rounded-2xl border border-ant-ink bg-ant-ink p-5 overflow-hidden relative">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        To reach {targetProfit.toLocaleString()} MAD / month
                                    </div>
                                    <div className="grid grid-cols-3 gap-6 mt-5">
                                        {[
                                            { label: 'sales needed', value: reverseCalc.monthly.sales.toLocaleString() },
                                            { label: 'leads needed', value: reverseCalc.monthly.leads.toLocaleString() },
                                            { label: 'ad budget', value: `${(reverseCalc.monthly.adBudget / 1000).toFixed(1)}K`, unit: 'MAD' },
                                        ].map(item => (
                                            <div key={item.label}>
                                                <p className="font-display text-[28px] font-semibold tabular-nums text-white leading-none">
                                                    {item.value}
                                                    {item.unit && <span className="text-[12px] text-white/50 font-normal ml-1.5">{item.unit}</span>}
                                                </p>
                                                <p className="font-serif italic text-[11px] text-white/60 mt-2">{item.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <div className="p-5">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">02</span>
                                            Total investment
                                        </div>
                                        <p className="font-display text-[28px] font-semibold tabular-nums text-ant-ink mt-3 leading-none">
                                            {(reverseCalc.monthly.totalInvestment / 1000).toFixed(1)}K
                                            <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-mid mt-2">Capital required each month.</p>
                                        <div className="mt-3 pt-3 border-t border-ant-line flex justify-between items-baseline">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Expected revenue</span>
                                            <span className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                {(reverseCalc.monthly.revenue / 1000).toFixed(1)}K <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                            </span>
                                        </div>
                                    </div>
                                </section>
                            </div>

                            {/* Scaling Chart */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-green" />
                                <div className="p-5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">03</span>
                                            Scaling projection
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">0.25× to 3× the target</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <ComposedChart data={scalingChartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#EDE9E0" vertical={false} />
                                            <XAxis dataKey="target" axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} />
                                            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#6B6760', fontSize: 10 }} />
                                            <Tooltip content={<ProfitChartTooltip />} />
                                            <Area yAxisId="left" type="monotone" dataKey="profit" name="Profit" stroke="#2D7A3E" strokeWidth={1.75} fill="#2D7A3E18" />
                                            <Line yAxisId="right" type="monotone" dataKey="sales" name="Sales" stroke="#141413" strokeWidth={1.75} dot={{ fill: '#141413', strokeWidth: 0, r: 3 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                    <div className="flex justify-center gap-5 pt-2 border-t border-ant-line">
                                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid pt-1">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />Profit (MAD)
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid pt-1">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />Sales required
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Daily & Weekly Requirements */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-orange" />
                                    <div className="p-5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="font-display text-ant-orange font-semibold">04</span>
                                                Daily requirements
                                            </div>
                                            <span className="font-serif italic text-[11px] text-ant-mid">per 24h</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <CalculatorStatBox label="Sales" value={reverseCalc.daily.sales} type="success" large />
                                            <CalculatorStatBox label="Leads" value={reverseCalc.daily.leads} type="info" large />
                                            <CalculatorStatBox label="Ad budget" value={`${reverseCalc.daily.adBudget} MAD`} />
                                            <CalculatorStatBox label="Revenue" value={`${reverseCalc.daily.revenue} MAD`} />
                                        </div>
                                        <div className="rounded-xl bg-ant-ink p-4">
                                            <div className="flex items-center justify-between">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                    Daily profit
                                                </div>
                                                <span className="font-display text-[18px] font-semibold tabular-nums text-white">
                                                    {reverseCalc.daily.profit.toLocaleString()} <span className="text-[11px] text-white/60 font-normal">MAD</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="p-5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="font-display text-ant-orange font-semibold">05</span>
                                                Weekly requirements
                                            </div>
                                            <span className="font-serif italic text-[11px] text-ant-mid">per 7-day cycle</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <CalculatorStatBox label="Sales" value={reverseCalc.weekly.sales} type="success" large />
                                            <CalculatorStatBox label="Leads" value={reverseCalc.weekly.leads} type="info" large />
                                            <CalculatorStatBox label="Ad budget" value={`${reverseCalc.weekly.adBudget.toLocaleString()} MAD`} />
                                            <CalculatorStatBox label="Profit" value={`${reverseCalc.weekly.profit.toLocaleString()} MAD`} type="success" />
                                        </div>
                                    </div>
                                </section>
                            </div>

                            {/* Comparison Table */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-ink" />
                                <div className="p-5 pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">06</span>
                                            Current vs target
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">daily delta</span>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-y border-ant-line bg-ant-light">
                                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Metric</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Current</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Target</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Change</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[
                                                { label: 'FB leads', current: inputs.fbLeads, target: reverseCalc.daily.leads },
                                                { label: 'Sales', current: metrics.deliveredOrders, target: reverseCalc.daily.sales },
                                                { label: 'Ad budget', current: metrics.totalAdSpend, target: reverseCalc.daily.adBudget, isMoney: true },
                                                { label: 'Revenue', current: metrics.grossRevenue, target: reverseCalc.daily.revenue, isMoney: true },
                                                { label: 'Profit', current: metrics.netProfit, target: reverseCalc.daily.profit, isMoney: true }
                                            ].map((row, idx) => (
                                                <tr key={idx} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors">
                                                    <td className="px-5 py-3 text-[12px] font-medium text-ant-ink">{row.label}</td>
                                                    <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                        {row.isMoney ? `${row.current.toFixed(0)} ` : row.current}
                                                        {row.isMoney && <span className="text-[10px] text-ant-mid font-normal">MAD</span>}
                                                    </td>
                                                    <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                        {row.isMoney ? `${row.target.toLocaleString()} ` : row.target}
                                                        {row.isMoney && <span className="text-[10px] text-ant-mid font-normal">MAD</span>}
                                                    </td>
                                                    <td className="px-5 py-3 text-right">
                                                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${row.target > row.current ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose'}`}>
                                                            <span className={`h-1.5 w-1.5 rounded-full ${row.target > row.current ? 'bg-ant-green' : 'bg-ant-rose'}`} />
                                                            {row.target > row.current ? '+' : ''}{((row.target - row.current) / (row.current || 1) * 100).toFixed(0)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            {/* Feasibility */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className="p-5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">07</span>
                                            Feasibility analysis
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">how far to stretch</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                        {[
                                            {
                                                label: 'Current daily capacity',
                                                main: `${metrics.deliveredOrders}`,
                                                sub: 'sales / day',
                                                note: `Required: ${reverseCalc.daily.sales} sales/day`,
                                                dot: 'bg-ant-ink',
                                                text: 'text-ant-ink',
                                            },
                                            {
                                                label: 'Scale factor needed',
                                                main: metrics.deliveredOrders > 0 ? `${(reverseCalc.daily.sales / metrics.deliveredOrders).toFixed(1)}x` : '—',
                                                sub: 'multiplier',
                                                note: 'Multiply operations',
                                                dot: 'bg-ant-orange',
                                                text: 'text-ant-orange',
                                            },
                                            {
                                                label: 'Budget scale',
                                                main: metrics.totalAdSpend > 0 ? `${(reverseCalc.daily.adBudget / metrics.totalAdSpend).toFixed(1)}x` : '—',
                                                sub: 'ad uplift',
                                                note: `${metrics.totalAdSpend.toFixed(0)} → ${reverseCalc.daily.adBudget} MAD`,
                                                dot: 'bg-ant-green',
                                                text: 'text-ant-green',
                                            },
                                        ].map(item => (
                                            <div key={item.label} className="bg-ant-paper p-4">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                                                    {item.label}
                                                </div>
                                                <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 ${item.text}`}>
                                                    {item.main}
                                                    <span className="text-[11px] text-ant-mid font-normal ml-1.5">{item.sub}</span>
                                                </p>
                                                <p className="font-serif italic text-[11px] text-ant-mid mt-1">{item.note}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        </>
                    )}
                </TabsContent>

                {/* ==================== TAB 3: INVESTMENT & ROI ==================== */}
                <TabsContent value="investment" className="space-y-5 mt-0">

                    {/* Summary Banner */}
                    <div className="rounded-2xl border border-ant-ink bg-ant-ink p-6">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Investment overview
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-5">
                            {[
                                { label: 'Total investment', value: metrics.initialInvestment.toLocaleString(), unit: 'MAD', dot: 'bg-ant-orange' },
                                { label: 'Monthly revenue', value: metrics.monthlyRevenue.toLocaleString(), unit: 'MAD', dot: 'bg-ant-green' },
                                { label: 'ROI', value: `${metrics.roi.toFixed(1)}%`, unit: '', dot: metrics.roi >= 100 ? 'bg-ant-green' : 'bg-ant-rose' },
                                { label: 'Break-even', value: metrics.breakEvenDays === Infinity ? '∞' : metrics.breakEvenDays.toFixed(1), unit: 'days', dot: 'bg-white/60' },
                            ].map(item => (
                                <div key={item.label}>
                                    <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                                        <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                                        {item.label}
                                    </div>
                                    <p className="font-display text-[26px] font-semibold tabular-nums text-white mt-2 leading-none">
                                        {item.value}
                                        {item.unit && <span className="text-[12px] text-white/50 font-normal ml-1.5">{item.unit}</span>}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Investment Breakdown */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">01</span>
                                    Investment breakdown
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">where the capital lands</span>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                {[
                                    {
                                        label: 'Ad cost',
                                        value: `${metrics.monthlyAdSpend.toLocaleString()}`,
                                        unit: 'MAD',
                                        sub: `${((metrics.monthlyAdSpend / (metrics.initialInvestment || 1)) * 100).toFixed(0)}% of investment`,
                                        dot: 'bg-ant-ink', text: 'text-ant-ink',
                                    },
                                    {
                                        label: 'Product cost',
                                        value: `${(inputs.productCost * metrics.deliveredOrders).toLocaleString()}`,
                                        unit: 'MAD',
                                        sub: `${inputs.productCost} × ${metrics.deliveredOrders} units`,
                                        dot: 'bg-ant-mid', text: 'text-ant-ink',
                                    },
                                    {
                                        label: 'Other costs',
                                        value: `${((inputs.callCenter + inputs.packaging + inputs.riskBuffer) * metrics.confirmedOrders).toLocaleString()}`,
                                        unit: 'MAD',
                                        sub: 'Call + packaging + risk',
                                        dot: 'bg-ant-orange', text: 'text-ant-orange',
                                    },
                                    {
                                        label: 'Gross margin',
                                        value: `${(inputs.salePrice > 0 ? (metrics.profitPerDelivered / inputs.salePrice * 100) : 0).toFixed(1)}%`,
                                        unit: '',
                                        sub: `${metrics.profitPerDelivered.toFixed(0)} MAD / sale`,
                                        dot: metrics.profitPerDelivered > 0 ? 'bg-ant-green' : 'bg-ant-rose',
                                        text: metrics.profitPerDelivered > 0 ? 'text-ant-green' : 'text-ant-rose',
                                    },
                                ].map(item => (
                                    <div key={item.label} className="bg-ant-paper p-4">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                            <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                                            {item.label}
                                        </div>
                                        <p className={`font-display text-[18px] font-semibold tabular-nums mt-2 ${item.text}`}>
                                            {item.value}
                                            {item.unit && <span className="text-[11px] text-ant-mid font-normal ml-1">{item.unit}</span>}
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-mid mt-1">{item.sub}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* ROI Timeline */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="p-5 pb-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    ROI timeline
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">how capital compounds</span>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-y border-ant-line bg-ant-light">
                                        <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Period</th>
                                        <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Cumulative profit</th>
                                        <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">ROI</th>
                                        <th className="px-5 py-2.5 text-center text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Rating</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {roiTimelineData.map((row) => {
                                        const badgeTone = row.badge === 'excellent'
                                            ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' }
                                            : row.badge === 'good'
                                            ? { bg: 'bg-ant-ink/6', border: 'border-ant-ink/15', text: 'text-ant-ink', dot: 'bg-ant-ink' }
                                            : row.badge === 'moderate'
                                            ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' }
                                            : { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };
                                        return (
                                            <tr key={row.days} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors">
                                                <td className="px-5 py-3 text-[12px] font-medium text-ant-ink">
                                                    {row.days === 1 ? 'Day 1' : `${row.days} days`}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums ${row.cumulativeProfit >= 0 ? 'text-ant-green' : 'text-ant-rose'}`}>
                                                    {row.cumulativeProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                    <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                </td>
                                                <td className={`px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums ${row.roi >= 0 ? 'text-ant-green' : 'text-ant-rose'}`}>
                                                    {row.roi.toFixed(1)}%
                                                </td>
                                                <td className="px-5 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeTone.bg} ${badgeTone.border} ${badgeTone.text}`}>
                                                        <span className={`h-1.5 w-1.5 rounded-full ${badgeTone.dot}`} />
                                                        {row.badge}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Recommendations */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">03</span>
                                    Recommendations
                                </div>
                                <Sparkles className="w-3.5 h-3.5 text-ant-orange" strokeWidth={1.75} />
                            </div>
                            <div className="space-y-2">
                                {recommendations.map((rec, i) => {
                                    const tone = rec.type === 'success'
                                        ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', icon: <CheckCircle className="w-4 h-4 text-ant-green mt-0.5 shrink-0" strokeWidth={1.75} /> }
                                        : rec.type === 'warning'
                                        ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', icon: <AlertTriangle className="w-4 h-4 text-ant-orange mt-0.5 shrink-0" strokeWidth={1.75} /> }
                                        : rec.type === 'danger'
                                        ? { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', icon: <XCircle className="w-4 h-4 text-ant-rose mt-0.5 shrink-0" strokeWidth={1.75} /> }
                                        : { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-ink', icon: <Info className="w-4 h-4 text-ant-mid mt-0.5 shrink-0" strokeWidth={1.75} /> };
                                    return (
                                        <div key={i} className={`p-3.5 rounded-xl border flex items-start gap-3 ${tone.bg} ${tone.border}`}>
                                            {tone.icon}
                                            <p className={`text-[12px] leading-relaxed ${tone.text}`}>{rec.text}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                </TabsContent>

                {/* ==================== TAB 4: SCALING PLAN ==================== */}
                <TabsContent value="scaling" className="space-y-5 mt-0">

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5">
                            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                                <div className="flex-1 space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Target monthly profit
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={scalingTarget}
                                            onChange={(e) => setScalingTarget(parseFloat(e.target.value) || 0)}
                                            className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums pr-14 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">MAD</span>
                                    </div>
                                </div>
                                <div className="flex-1 space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">02</span>
                                        Number of steps
                                    </div>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            min={2}
                                            max={10}
                                            value={scalingSteps}
                                            onChange={(e) => setScalingSteps(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                                            className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] font-semibold text-ant-ink tabular-nums pr-16 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">steps</span>
                                    </div>
                                </div>
                                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-light">
                                    {[50000, 100000, 200000, 500000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setScalingTarget(val)}
                                            className={`h-8 px-3.5 rounded-full text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${scalingTarget === val
                                                    ? 'bg-ant-ink text-white'
                                                    : 'text-ant-mid hover:text-ant-ink'
                                                }`}
                                        >
                                            {(val / 1000)}K
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <p className="font-serif italic text-[11px] text-ant-mid mt-3">Trajectory from where you stand today to the ceiling you set.</p>
                        </div>
                    </section>

                    {metrics.profitPerDelivered <= 0 ? (
                        <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/10 p-6 text-center">
                            <XCircle className="w-8 h-8 text-ant-rose mx-auto mb-2" strokeWidth={1.5} />
                            <h3 className="font-display text-[16px] font-semibold text-ant-rose mb-1">Cannot generate scaling plan</h3>
                            <p className="font-serif italic text-[12px] text-ant-rose/80">Your profit per sale is negative. Adjust your costs or pricing first.</p>
                        </section>
                    ) : scalingPlanData.length > 0 && (
                        <>
                            {/* Current vs Target Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <div className="rounded-2xl border border-ant-ink bg-ant-ink p-5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                        <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
                                        Current state
                                    </div>
                                    <div className="grid grid-cols-2 gap-6 mt-5">
                                        <div>
                                            <p className="font-display text-[24px] font-semibold tabular-nums text-white leading-none">
                                                {(metrics.netProfit * 28).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                <span className="text-[11px] text-white/50 font-normal ml-1.5">MAD</span>
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/60 mt-2">monthly profit</p>
                                        </div>
                                        <div>
                                            <p className="font-display text-[24px] font-semibold tabular-nums text-white leading-none">
                                                {scalingPlanData[0]?.dailySales || 0}
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/60 mt-2">daily sales</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-ant-green bg-ant-green p-5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/60">
                                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                        Target state
                                    </div>
                                    <div className="grid grid-cols-2 gap-6 mt-5">
                                        <div>
                                            <p className="font-display text-[24px] font-semibold tabular-nums text-white leading-none">
                                                {scalingTarget.toLocaleString()}
                                                <span className="text-[11px] text-white/60 font-normal ml-1.5">MAD</span>
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/70 mt-2">monthly profit</p>
                                        </div>
                                        <div>
                                            <p className="font-display text-[24px] font-semibold tabular-nums text-white leading-none">
                                                {scalingPlanData[scalingPlanData.length - 1]?.dailySales || 0}
                                            </p>
                                            <p className="font-serif italic text-[11px] text-white/70 mt-2">daily sales</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Growth Timeline Table */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-ink" />
                                <div className="p-5 pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">03</span>
                                            Growth timeline
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">month-by-month roadmap</span>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-y border-ant-line bg-ant-light">
                                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Step</th>
                                                <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Month</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Profit / mo</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Sales / day</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Leads / day</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Ad / day</th>
                                                <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Revenue / day</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {scalingPlanData.map((row, i) => {
                                                const isLast = i === scalingPlanData.length - 1;
                                                const isFirst = i === 0;
                                                return (
                                                    <tr key={row.step} className={`border-b border-ant-line last:border-0 transition-colors ${isLast ? 'bg-ant-green/10 hover:bg-ant-green/15' : isFirst ? 'bg-ant-ink/6 hover:bg-ant-ink/10' : 'hover:bg-ant-light/50'}`}>
                                                        <td className="px-5 py-3">
                                                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${isLast ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : isFirst ? 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' : 'bg-ant-light border-ant-line text-ant-mid'}`}>
                                                                <span className={`h-1.5 w-1.5 rounded-full ${isLast ? 'bg-ant-green' : isFirst ? 'bg-ant-ink' : 'bg-ant-mid'}`} />
                                                                {row.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3 font-serif italic text-[12px] text-ant-mid">{row.month}</td>
                                                        <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">{row.monthlyProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-[10px] text-ant-mid font-normal">MAD</span></td>
                                                        <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">{row.dailySales}</td>
                                                        <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">{row.dailyLeads}</td>
                                                        <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">{row.dailyAdBudget.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">MAD</span></td>
                                                        <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">{row.dailyRevenue.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">MAD</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                            {/* Scaling Step Cards */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-green" />
                                <div className="p-5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">04</span>
                                            Scaling steps
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">each milestone, unpacked</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {scalingPlanData.filter(s => s.step > 0).map((step) => (
                                            <div key={step.step} className="rounded-xl border border-ant-line bg-ant-light overflow-hidden">
                                                <div className="flex items-center justify-between px-4 py-2.5 border-b border-ant-line bg-ant-paper">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-ink">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                                        {step.label}
                                                    </span>
                                                    <span className="font-serif italic text-[11px] text-ant-mid">{step.month}</span>
                                                </div>
                                                <div className="p-3 grid grid-cols-2 gap-2">
                                                    <CalculatorStatBox label="Profit / mo" value={`${(step.monthlyProfit / 1000).toFixed(1)}K`} type="success" />
                                                    <CalculatorStatBox label="Sales / day" value={step.dailySales} type="info" />
                                                    <CalculatorStatBox label="Leads / day" value={step.dailyLeads} type="warning" />
                                                    <CalculatorStatBox label="Ad / day" value={step.dailyAdBudget.toLocaleString()} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            {/* Optimization Strategies */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className="p-5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">05</span>
                                            Optimization strategies
                                        </div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">levers that bend the curve</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {[
                                            {
                                                icon: <Phone className="w-3.5 h-3.5" strokeWidth={1.75} />,
                                                title: '+10% confirmation rate',
                                                value: `+${optimizationImpact.confImpact}%`,
                                                note: `${inputs.confirmationRate}% → ${Math.min(inputs.confirmationRate + 10, 100)}%`,
                                                tone: 'green' as const,
                                            },
                                            {
                                                icon: <Truck className="w-3.5 h-3.5" strokeWidth={1.75} />,
                                                title: '+10% delivery rate',
                                                value: `+${optimizationImpact.delImpact}%`,
                                                note: `${inputs.deliveryRate}% → ${Math.min(inputs.deliveryRate + 10, 100)}%`,
                                                tone: 'ink' as const,
                                            },
                                            {
                                                icon: <TrendingDown className="w-3.5 h-3.5" strokeWidth={1.75} />,
                                                title: 'Reduce CPL to 15 MAD',
                                                value: `+${optimizationImpact.cpl15}%`,
                                                note: `${inputs.costPerLead} → 15 MAD`,
                                                tone: 'orange' as const,
                                            },
                                            {
                                                icon: <DollarSign className="w-3.5 h-3.5" strokeWidth={1.75} />,
                                                title: 'Increase price to 299 MAD',
                                                value: `+${optimizationImpact.price299}%`,
                                                note: `${inputs.salePrice} → 299 MAD`,
                                                tone: 'ink' as const,
                                            },
                                        ].map(item => {
                                            const tone = item.tone === 'green'
                                                ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', iconBg: 'bg-ant-green/10 border-ant-green/25 text-ant-green', value: 'text-ant-green', dot: 'bg-ant-green' }
                                                : item.tone === 'orange'
                                                ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', iconBg: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange', value: 'text-ant-orange', dot: 'bg-ant-orange' }
                                                : { bg: 'bg-ant-light', border: 'border-ant-line', iconBg: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink', value: 'text-ant-ink', dot: 'bg-ant-ink' };
                                            return (
                                                <div key={item.title} className={`p-4 rounded-xl border ${tone.bg} ${tone.border} flex items-start gap-3`}>
                                                    <div className={`h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 ${tone.iconBg}`}>
                                                        {item.icon}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                                                            {item.title}
                                                        </div>
                                                        <p className={`font-display text-[22px] font-semibold tabular-nums mt-1 ${tone.value}`}>{item.value}</p>
                                                        <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{item.note}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        </>
                    )}
                </TabsContent>
            </Tabs>
            </div>
        </div>
    );
};

export default Calculator;
