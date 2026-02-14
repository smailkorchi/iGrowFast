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

const Calculator = () => {
    const [inputs, setInputs] = useState<CalculatorInputs>(defaultInputs);
    const [targetProfit, setTargetProfit] = useState(50000);

    // Core calculation logic
    const metrics = useMemo(() => {
        const {
            productCost, callCenter, packaging, shippingFee, riskBuffer,
            fbLeads, costPerLead, confirmationRate, deliveryRate, salePrice
        } = inputs;

        // Pipeline
        const confirmedOrders = Math.round(fbLeads * (confirmationRate / 100));
        const deliveredOrders = Math.round(confirmedOrders * (deliveryRate / 100));
        const failedOrders = confirmedOrders - deliveredOrders;
        const overallConversionRate = fbLeads > 0 ? (deliveredOrders / fbLeads) * 100 : 0;

        // Ad spend
        const totalAdSpend = fbLeads * costPerLead;
        const adCostPerConfirmed = confirmedOrders > 0 ? totalAdSpend / confirmedOrders : 0;
        const adCostPerDelivered = deliveredOrders > 0 ? totalAdSpend / deliveredOrders : 0;

        // Costs
        const upfrontCostPerOrder = productCost + callCenter + packaging + riskBuffer;
        const totalCostPerDelivered = upfrontCostPerOrder + shippingFee + adCostPerDelivered;
        const profitPerDelivered = salePrice - totalCostPerDelivered;

        // Loss per failed
        const lossPerFailed = upfrontCostPerOrder + adCostPerConfirmed;
        const totalLossFromFailures = lossPerFailed * failedOrders;

        // Revenue & costs
        const grossRevenue = deliveredOrders * salePrice;
        const totalProductCosts = confirmedOrders * upfrontCostPerOrder;
        const totalShippingCosts = deliveredOrders * shippingFee;
        const totalCosts = totalAdSpend + totalProductCosts + totalShippingCosts;
        const netProfit = grossRevenue - totalCosts;

        // Margins & rates
        const profitMargin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
        const costMargin = grossRevenue > 0 ? (totalCosts / grossRevenue) * 100 : 0;
        const roi = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;
        const roas = totalAdSpend > 0 ? grossRevenue / totalAdSpend : 0;

        // Initial investment
        const initialInvestment = totalAdSpend + (confirmedOrders * upfrontCostPerOrder);
        const breakEvenDays = netProfit > 0 ? Math.ceil(initialInvestment / netProfit) : Infinity;

        // Monthly (28 days)
        const monthlyLeads = fbLeads * 28;
        const monthlyConfirmed = confirmedOrders * 28;
        const monthlyDelivered = deliveredOrders * 28;
        const monthlyFailed = failedOrders * 28;
        const monthlyRevenue = grossRevenue * 28;
        const monthlyAdSpend = totalAdSpend * 28;
        const monthlyCosts = totalCosts * 28;
        const monthlyProfit = netProfit * 28;
        const monthlyLossFromFailures = totalLossFromFailures * 28;

        // Cost breakdown percentages
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

    // Chart data: Profit projection over time
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

    // Chart data: Funnel visualization
    const funnelChartData = useMemo(() => [
        { stage: 'Leads', value: inputs.fbLeads, fill: '#6366f1' },
        { stage: 'Confirmed', value: metrics.confirmedOrders, fill: '#f59e0b' },
        { stage: 'Delivered', value: metrics.deliveredOrders, fill: '#10b981' }
    ], [inputs.fbLeads, metrics.confirmedOrders, metrics.deliveredOrders]);

    // Chart data: Scaling projection for target tab
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

    // Reverse calculation for target profit
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

    const handleInputChange = (field: keyof CalculatorInputs, value: string) => {
        setInputs(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
    };

    // Custom Tooltip for charts
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white/95 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg border border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <p key={index} className="text-sm" style={{ color: entry.color }}>
                            <span className="font-medium">{entry.name}:</span> {entry.value.toLocaleString()} MAD
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    // Input Field Component
    const InputField = ({ label, field, suffix, hint }: { label: string; field: keyof CalculatorInputs; suffix?: string; hint?: string }) => (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium text-gray-600 uppercase tracking-wider">{label}</Label>
            <div className="relative">
                <Input
                    type="number"
                    value={inputs[field]}
                    onChange={(e) => handleInputChange(field, e.target.value)}
                    className="pr-12 h-10 rounded-lg border-gray-200 bg-gray-50/50 focus:bg-white focus:border-gray-300 transition-all"
                />
                {suffix && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-400">
                        {suffix}
                    </span>
                )}
            </div>
            {hint && <p className="text-[10px] text-gray-400">{hint}</p>}
        </div>
    );

    // Stat Box Component
    const StatBox = ({ label, value, subValue, type = 'default', large = false }: {
        label: string; value: string | number; subValue?: string;
        type?: 'success' | 'danger' | 'warning' | 'info' | 'default'; large?: boolean;
    }) => {
        const colors = {
            success: 'bg-emerald-50 border-emerald-100 text-emerald-700',
            danger: 'bg-red-50 border-red-100 text-red-700',
            warning: 'bg-amber-50 border-amber-100 text-amber-700',
            info: 'bg-blue-50 border-blue-100 text-blue-700',
            default: 'bg-gray-50 border-gray-100 text-gray-700'
        };

        return (
            <div className={`p-4 rounded-xl border ${colors[type]}`}>
                <p className="text-[10px] uppercase tracking-wider opacity-70 mb-1">{label}</p>
                <p className={`font-semibold ${large ? 'text-2xl' : 'text-lg'}`}>{value}</p>
                {subValue && <p className="text-xs opacity-60 mt-0.5">{subValue}</p>}
            </div>
        );
    };

    // Progress Bar Component
    const ProgressBar = ({ label, value, max, color = 'primary' }: { label: string; value: number; max: number; color?: string }) => {
        const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
        const colorClasses: Record<string, string> = {
            primary: 'bg-primary', green: 'bg-emerald-500', red: 'bg-red-500', blue: 'bg-blue-500', amber: 'bg-amber-500'
        };

        return (
            <div className="space-y-1">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-900">{percent.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${colorClasses[color]} rounded-full transition-all duration-500`} style={{ width: `${percent}%` }} />
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-8 pb-8">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Profit Calculator</h1>
                            <p className="text-gray-500 font-light">Complete e-commerce profitability analysis</p>
                        </div>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="calculator" className="space-y-6">
                <TabsList className="bg-white border border-gray-200 p-1 rounded-xl shadow-sm">
                    <TabsTrigger value="calculator" className="rounded-lg data-[state=active]:bg-gray-900 data-[state=active]:text-white px-6 py-2.5">
                        <CalculatorIcon className="w-4 h-4 mr-2" />
                        Main Calculator
                    </TabsTrigger>
                    <TabsTrigger value="target" className="rounded-lg data-[state=active]:bg-gray-900 data-[state=active]:text-white px-6 py-2.5">
                        <Target className="w-4 h-4 mr-2" />
                        Profit Target
                    </TabsTrigger>
                </TabsList>

                {/* ==================== TAB 1: MAIN CALCULATOR ==================== */}
                <TabsContent value="calculator" className="space-y-6 mt-0">

                    {/* Top Summary Row */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <Card className={`border-0 shadow-md rounded-2xl overflow-hidden ${metrics.netProfit >= 0 ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-red-500 to-red-600'} text-white`}>
                            <CardContent className="p-5">
                                <div className="flex items-center gap-2 mb-2 opacity-80">
                                    {metrics.netProfit >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                    <span className="text-xs uppercase tracking-wider">Daily Profit</span>
                                </div>
                                <p className="text-3xl font-light">{metrics.netProfit.toFixed(2)}</p>
                                <p className="text-xs opacity-70 mt-1">MAD / day</p>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-md rounded-2xl bg-white">
                            <CardContent className="p-5">
                                <div className="flex items-center gap-2 mb-2 text-gray-500">
                                    <Wallet className="w-4 h-4" />
                                    <span className="text-xs uppercase tracking-wider">Per Sale</span>
                                </div>
                                <p className="text-3xl font-light text-gray-900">{metrics.profitPerDelivered.toFixed(2)}</p>
                                <p className="text-xs text-gray-400 mt-1">MAD profit</p>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-md rounded-2xl bg-white">
                            <CardContent className="p-5">
                                <div className="flex items-center gap-2 mb-2 text-gray-500">
                                    <TrendingUp className="w-4 h-4" />
                                    <span className="text-xs uppercase tracking-wider">ROI</span>
                                </div>
                                <p className={`text-3xl font-light ${metrics.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{metrics.roi.toFixed(0)}%</p>
                                <p className="text-xs text-gray-400 mt-1">return</p>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-md rounded-2xl bg-white">
                            <CardContent className="p-5">
                                <div className="flex items-center gap-2 mb-2 text-gray-500">
                                    <Activity className="w-4 h-4" />
                                    <span className="text-xs uppercase tracking-wider">ROAS</span>
                                </div>
                                <p className="text-3xl font-light text-gray-900">{metrics.roas.toFixed(2)}x</p>
                                <p className="text-xs text-gray-400 mt-1">ad return</p>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-md rounded-2xl bg-white">
                            <CardContent className="p-5">
                                <div className="flex items-center gap-2 mb-2 text-gray-500">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-xs uppercase tracking-wider">Break-even</span>
                                </div>
                                <p className="text-3xl font-light text-gray-900">
                                    {metrics.breakEvenDays === Infinity ? '—' : metrics.breakEvenDays}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">{metrics.breakEvenDays === Infinity ? 'Not profitable' : 'days'}</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Input Sections */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        {/* Product Costs */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Box className="w-4 h-4 text-gray-400" />
                                    Product & Operations
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <InputField label="Product Cost" field="productCost" suffix="MAD" />
                                <InputField label="Call Center" field="callCenter" suffix="MAD" />
                                <InputField label="Packaging" field="packaging" suffix="MAD" />
                                <InputField label="Shipping Fee" field="shippingFee" suffix="MAD" hint="Only charged on delivered orders" />
                                <InputField label="Risk Buffer" field="riskBuffer" suffix="MAD" />

                                <div className="pt-3 border-t border-gray-100 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Upfront cost/order</span>
                                        <span className="font-semibold">{metrics.upfrontCostPerOrder.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Total cost/delivered</span>
                                        <span className="font-semibold">{metrics.totalCostPerDelivered.toFixed(2)} MAD</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Advertising */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-gray-400" />
                                    Advertising
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <InputField label="Daily FB Leads" field="fbLeads" />
                                <InputField label="Cost per Lead" field="costPerLead" suffix="MAD" />
                                <InputField label="Confirmation Rate" field="confirmationRate" suffix="%" />
                                <InputField label="Delivery Rate" field="deliveryRate" suffix="%" />

                                <div className="pt-3 border-t border-gray-100 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Daily ad spend</span>
                                        <span className="font-semibold">{metrics.totalAdSpend.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Ad cost/delivered</span>
                                        <span className="font-semibold">{metrics.adCostPerDelivered.toFixed(2)} MAD</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Overall conversion</span>
                                        <span className="font-semibold">{metrics.overallConversionRate.toFixed(1)}%</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Sales & Pipeline */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-4">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-gray-400" />
                                    Sales & Conversion
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <InputField label="Sale Price" field="salePrice" suffix="MAD" />

                                <div className="pt-2 space-y-3">
                                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-indigo-500" />
                                            <span className="text-sm text-gray-600">Leads</span>
                                        </div>
                                        <span className="font-semibold text-gray-900">{inputs.fbLeads}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-amber-50/50 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-amber-500" />
                                            <span className="text-sm text-amber-700">Confirmed</span>
                                        </div>
                                        <span className="font-semibold text-amber-700">{metrics.confirmedOrders}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                            <span className="text-sm text-emerald-700">Delivered</span>
                                        </div>
                                        <span className="font-semibold text-emerald-700">{metrics.deliveredOrders}</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-red-50/50 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-red-500" />
                                            <span className="text-sm text-red-700">Failed</span>
                                        </div>
                                        <span className="font-semibold text-red-700">{metrics.failedOrders}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Profit Projection Chart */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                                    Profit & Revenue Projection
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={projectionChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradientRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="gradientProfit" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#gradientRevenue)" />
                                        <Area type="monotone" dataKey="profit" name="Profit" stroke="#10b981" strokeWidth={2} fill="url(#gradientProfit)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="flex justify-center gap-6 mt-3">
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <div className="w-3 h-1 rounded bg-indigo-500" />
                                        Revenue
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <div className="w-3 h-1 rounded bg-emerald-500" />
                                        Profit
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Conversion Funnel Chart */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-indigo-500" />
                                    Conversion Funnel
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={funnelChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradientFunnel" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                        <XAxis dataKey="stage" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                        <Tooltip content={<CustomTooltip />} formatter={(value: number) => [value, 'Count']} />
                                        <Area type="monotone" dataKey="value" name="Count" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradientFunnel)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                                <div className="grid grid-cols-3 gap-2 mt-3">
                                    <div className="text-center p-2 bg-indigo-50 rounded-lg">
                                        <p className="text-lg font-semibold text-indigo-700">{inputs.fbLeads}</p>
                                        <p className="text-[10px] text-indigo-500 uppercase">Leads</p>
                                    </div>
                                    <div className="text-center p-2 bg-amber-50 rounded-lg">
                                        <p className="text-lg font-semibold text-amber-700">{metrics.confirmedOrders}</p>
                                        <p className="text-[10px] text-amber-500 uppercase">Confirmed</p>
                                    </div>
                                    <div className="text-center p-2 bg-emerald-50 rounded-lg">
                                        <p className="text-lg font-semibold text-emerald-700">{metrics.deliveredOrders}</p>
                                        <p className="text-[10px] text-emerald-500 uppercase">Delivered</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Loss Analysis & Monthly Projection */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Daily Breakdown */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-700">Daily Financial Summary</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <StatBox label="Revenue" value={`${metrics.grossRevenue.toFixed(2)} MAD`} type="info" />
                                    <StatBox label="Total Costs" value={`${metrics.totalCosts.toFixed(2)} MAD`} type="default" />
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <StatBox label="Ad Spend" value={`${metrics.totalAdSpend.toFixed(0)} MAD`} subValue={`${metrics.adCostPercent.toFixed(0)}%`} />
                                    <StatBox label="Product" value={`${metrics.totalProductCosts.toFixed(0)} MAD`} subValue={`${metrics.productCostPercent.toFixed(0)}%`} />
                                    <StatBox label="Shipping" value={`${metrics.totalShippingCosts.toFixed(0)} MAD`} subValue={`${metrics.shippingPercent.toFixed(0)}%`} />
                                </div>
                                <StatBox
                                    label="Net Profit"
                                    value={`${metrics.netProfit.toFixed(2)} MAD`}
                                    subValue={`${metrics.profitMargin.toFixed(1)}% margin`}
                                    type={metrics.netProfit >= 0 ? 'success' : 'danger'}
                                    large
                                />
                            </CardContent>
                        </Card>

                        {/* Loss Analysis */}
                        <Card className="border border-gray-100 shadow-sm rounded-2xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                                    Failed Delivery Impact
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-sm text-red-700">Failed Orders</span>
                                        <span className="text-2xl font-semibold text-red-700">{metrics.failedOrders}</span>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-red-600">Loss per failed</span>
                                            <span className="font-medium text-red-700">{metrics.lossPerFailed.toFixed(2)} MAD</span>
                                        </div>
                                        <div className="flex justify-between pt-2 border-t border-red-200">
                                            <span className="text-red-600 font-medium">Total daily loss</span>
                                            <span className="font-bold text-red-700">{metrics.totalLossFromFailures.toFixed(2)} MAD</span>
                                        </div>
                                    </div>
                                </div>
                                <ProgressBar label="Delivery Success Rate" value={metrics.deliveredOrders} max={metrics.confirmedOrders} color="green" />
                                <ProgressBar label="Failure Rate" value={metrics.failedOrders} max={metrics.confirmedOrders} color="red" />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Monthly Projection */}
                    <Card className="border border-gray-100 shadow-sm rounded-2xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-700">Monthly Projection (28 days)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                                <StatBox label="Leads" value={metrics.monthlyLeads.toLocaleString()} type="info" />
                                <StatBox label="Confirmed" value={metrics.monthlyConfirmed.toLocaleString()} type="warning" />
                                <StatBox label="Delivered" value={metrics.monthlyDelivered.toLocaleString()} type="success" />
                                <StatBox label="Failed" value={metrics.monthlyFailed.toLocaleString()} type="danger" />
                                <StatBox label="Revenue" value={`${(metrics.monthlyRevenue / 1000).toFixed(1)}K`} subValue="MAD" type="info" />
                                <StatBox label="Costs" value={`${(metrics.monthlyCosts / 1000).toFixed(1)}K`} subValue="MAD" />
                                <StatBox label="Ad Spend" value={`${(metrics.monthlyAdSpend / 1000).toFixed(1)}K`} subValue="MAD" />
                                <StatBox label="Net Profit" value={`${(metrics.monthlyProfit / 1000).toFixed(1)}K`} subValue="MAD" type={metrics.monthlyProfit >= 0 ? 'success' : 'danger'} />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Cost Distribution */}
                    <Card className="border border-gray-100 shadow-sm rounded-2xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-gray-700">Cost Distribution (per delivered order)</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="h-8 flex rounded-lg overflow-hidden">
                                <div className="bg-primary h-full flex items-center justify-center text-white text-xs font-medium transition-all"
                                    style={{ width: `${metrics.productCostPercent}%` }}>
                                    {metrics.productCostPercent > 10 && `${metrics.productCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-emerald-500 h-full flex items-center justify-center text-white text-xs font-medium transition-all"
                                    style={{ width: `${metrics.shippingPercent}%` }}>
                                    {metrics.shippingPercent > 10 && `${metrics.shippingPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-indigo-500 h-full flex items-center justify-center text-white text-xs font-medium transition-all"
                                    style={{ width: `${metrics.adCostPercent}%` }}>
                                    {metrics.adCostPercent > 10 && `${metrics.adCostPercent.toFixed(0)}%`}
                                </div>
                                <div className="bg-amber-500 h-full flex items-center justify-center text-white text-xs font-medium transition-all"
                                    style={{ width: `${metrics.otherCostPercent}%` }}>
                                    {metrics.otherCostPercent > 10 && `${metrics.otherCostPercent.toFixed(0)}%`}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded bg-primary" />
                                    <span className="text-gray-600">Product ({inputs.productCost} MAD)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded bg-emerald-500" />
                                    <span className="text-gray-600">Shipping ({inputs.shippingFee} MAD)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded bg-indigo-500" />
                                    <span className="text-gray-600">Ad Cost ({metrics.adCostPerDelivered.toFixed(2)} MAD)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded bg-amber-500" />
                                    <span className="text-gray-600">Other ({(inputs.callCenter + inputs.packaging + inputs.riskBuffer).toFixed(2)} MAD)</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ==================== TAB 2: PROFIT TARGET ==================== */}
                <TabsContent value="target" className="space-y-6 mt-0">

                    {/* Target Input */}
                    <Card className="border border-gray-100 shadow-sm rounded-2xl">
                        <CardContent className="p-6">
                            <div className="flex flex-col lg:flex-row lg:items-end gap-6">
                                <div className="flex-1">
                                    <Label className="text-sm font-medium text-gray-700 mb-2 block">Monthly Profit Target</Label>
                                    <div className="relative">
                                        <Input
                                            type="number"
                                            value={targetProfit}
                                            onChange={(e) => setTargetProfit(parseFloat(e.target.value) || 0)}
                                            className="h-14 text-3xl font-light pl-4 pr-16 rounded-xl border-gray-200"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">MAD</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {[10000, 25000, 50000, 100000].map(val => (
                                        <button
                                            key={val}
                                            onClick={() => setTargetProfit(val)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${targetProfit === val
                                                    ? 'bg-gray-900 text-white'
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
                        <Card className="border-2 border-red-200 bg-red-50 rounded-2xl">
                            <CardContent className="p-6 text-center">
                                <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                                <h3 className="text-lg font-medium text-red-700 mb-2">Cannot Calculate Target</h3>
                                <p className="text-red-600">Your profit per sale is {metrics.profitPerDelivered.toFixed(2)} MAD. Adjust your costs or pricing first.</p>
                            </CardContent>
                        </Card>
                    ) : reverseCalc && (
                        <>
                            {/* Required Sales Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <Card className="lg:col-span-2 border-0 shadow-md rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 text-white">
                                    <CardContent className="p-6">
                                        <p className="text-sm opacity-70 uppercase tracking-wider mb-2">To reach {targetProfit.toLocaleString()} MAD/month</p>
                                        <div className="grid grid-cols-3 gap-6 mt-4">
                                            <div>
                                                <p className="text-4xl font-light">{reverseCalc.monthly.sales.toLocaleString()}</p>
                                                <p className="text-sm opacity-60 mt-1">sales needed</p>
                                            </div>
                                            <div>
                                                <p className="text-4xl font-light">{reverseCalc.monthly.leads.toLocaleString()}</p>
                                                <p className="text-sm opacity-60 mt-1">leads needed</p>
                                            </div>
                                            <div>
                                                <p className="text-4xl font-light">{(reverseCalc.monthly.adBudget / 1000).toFixed(1)}K</p>
                                                <p className="text-sm opacity-60 mt-1">ad budget (MAD)</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                    <CardContent className="p-6">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Total Investment Required</p>
                                        <p className="text-4xl font-light text-gray-900">{(reverseCalc.monthly.totalInvestment / 1000).toFixed(1)}K</p>
                                        <p className="text-sm text-gray-500 mt-1">MAD / month</p>
                                        <div className="mt-4 pt-4 border-t border-gray-100">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-gray-500">Expected Revenue</span>
                                                <span className="font-medium">{(reverseCalc.monthly.revenue / 1000).toFixed(1)}K MAD</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Scaling Chart */}
                            <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                                        Scaling Projection
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ResponsiveContainer width="100%" height={250}>
                                        <ComposedChart data={scalingChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="gradientScaling" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                            <XAxis dataKey="target" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                                            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Area yAxisId="left" type="monotone" dataKey="profit" name="Profit" stroke="#10b981" strokeWidth={2} fill="url(#gradientScaling)" />
                                            <Line yAxisId="right" type="monotone" dataKey="sales" name="Sales" stroke="#6366f1" strokeWidth={2} dot={{ fill: '#6366f1', strokeWidth: 0, r: 4 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                    <div className="flex justify-center gap-6 mt-3">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <div className="w-3 h-1 rounded bg-emerald-500" />
                                            Profit (MAD)
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <div className="w-3 h-3 rounded-full bg-indigo-500" />
                                            Sales Required
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Daily & Weekly Requirements */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-gray-700">Daily Requirements</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-2 gap-3">
                                            <StatBox label="Sales" value={reverseCalc.daily.sales} type="success" large />
                                            <StatBox label="Leads" value={reverseCalc.daily.leads} type="info" large />
                                            <StatBox label="Ad Budget" value={`${reverseCalc.daily.adBudget} MAD`} />
                                            <StatBox label="Revenue" value={`${reverseCalc.daily.revenue} MAD`} />
                                        </div>
                                        <div className="mt-3 p-3 bg-emerald-50 rounded-lg">
                                            <div className="flex justify-between">
                                                <span className="text-sm text-emerald-700">Daily Profit</span>
                                                <span className="font-semibold text-emerald-700">{reverseCalc.daily.profit.toLocaleString()} MAD</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-medium text-gray-700">Weekly Requirements</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-2 gap-3">
                                            <StatBox label="Sales" value={reverseCalc.weekly.sales} type="success" large />
                                            <StatBox label="Leads" value={reverseCalc.weekly.leads} type="info" large />
                                            <StatBox label="Ad Budget" value={`${reverseCalc.weekly.adBudget.toLocaleString()} MAD`} />
                                            <StatBox label="Profit" value={`${reverseCalc.weekly.profit.toLocaleString()} MAD`} type="success" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Comparison Table */}
                            <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-700">Current vs Target Comparison</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="text-left py-3 px-4 font-medium text-gray-500">Metric</th>
                                                    <th className="text-right py-3 px-4 font-medium text-gray-500">Current (Daily)</th>
                                                    <th className="text-right py-3 px-4 font-medium text-gray-500">Target (Daily)</th>
                                                    <th className="text-right py-3 px-4 font-medium text-gray-500">Change</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {[
                                                    { label: 'FB Leads', current: inputs.fbLeads, target: reverseCalc.daily.leads },
                                                    { label: 'Sales', current: metrics.deliveredOrders, target: reverseCalc.daily.sales },
                                                    { label: 'Ad Budget', current: metrics.totalAdSpend, target: reverseCalc.daily.adBudget, isMoney: true },
                                                    { label: 'Revenue', current: metrics.grossRevenue, target: reverseCalc.daily.revenue, isMoney: true },
                                                    { label: 'Profit', current: metrics.netProfit, target: reverseCalc.daily.profit, isMoney: true }
                                                ].map((row, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50">
                                                        <td className="py-3 px-4 text-gray-700">{row.label}</td>
                                                        <td className="py-3 px-4 text-right font-medium">{row.isMoney ? `${row.current.toFixed(0)} MAD` : row.current}</td>
                                                        <td className="py-3 px-4 text-right font-medium">{row.isMoney ? `${row.target.toLocaleString()} MAD` : row.target}</td>
                                                        <td className="py-3 px-4 text-right">
                                                            <span className={`font-medium ${row.target > row.current ? 'text-emerald-600' : 'text-red-600'}`}>
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
                            <Card className="border border-gray-100 shadow-sm rounded-2xl">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-700">Feasibility Analysis</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Current Daily Capacity</p>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-semibold text-gray-900">{metrics.deliveredOrders}</span>
                                                <span className="text-sm text-gray-500">sales/day</span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-2">Required: {reverseCalc.daily.sales} sales/day</p>
                                        </div>

                                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Scale Factor Needed</p>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-semibold text-gray-900">
                                                    {metrics.deliveredOrders > 0 ? (reverseCalc.daily.sales / metrics.deliveredOrders).toFixed(1) : '—'}x
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-2">Multiply operations</p>
                                        </div>

                                        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Budget Scale</p>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-semibold text-gray-900">
                                                    {metrics.totalAdSpend > 0 ? (reverseCalc.daily.adBudget / metrics.totalAdSpend).toFixed(1) : '—'}x
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-2">{metrics.totalAdSpend.toFixed(0)} → {reverseCalc.daily.adBudget} MAD</p>
                                        </div>
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
