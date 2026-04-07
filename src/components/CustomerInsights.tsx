import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import {
    ShoppingBag,
    Truck,
    CheckCircle2,
    XCircle,
    DollarSign,
    TrendingUp,
    User,
    BarChart3,
    Loader2,
    AlertCircle,
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
    const { deliveredPkgIds, cancelledIds } = useStatusCategories();
    const [orders, setOrders] = useState<OrderRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Debounce phone search
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
                const { data, error } = await supabase
                    .from('orders')
                    .select(`
                        id,
                        date,
                        created_at,
                        raw_price,
                        order_status_id,
                        package_status_id,
                        package_status_label,
                        status:order_statuses(code, label, color),
                        package_status:package_statuses(code, label)
                    `)
                    .eq('DigiCom Business', activeBusinessId)
                    .ilike('phone', `%${cleaned}%`)
                    .order('date', { ascending: false });

                if (error) throw error;

                const mapped: OrderRecord[] = (data || []).map((o: any) => ({
                    id: o.id,
                    date: o.date || o.created_at,
                    created_at: o.created_at,
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

    // Stats
    const stats = useMemo(() => {
        const total = orders.length;
        const delivered = orders.filter(o => isDeliveredForCommission(o, deliveredPkgIds)).length;
        const cancelled = orders.filter(o => o.order_status_id && cancelledIds.has(o.order_status_id)).length;
        const totalSpent = orders.reduce((acc, o) => acc + o.raw_price, 0);
        const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
        return { total, delivered, cancelled, totalSpent, deliveryRate };
    }, [orders, deliveredPkgIds, cancelledIds]);

    // Chart data: last 6 months
    const chartData = useMemo((): MonthData[] => {
        if (orders.length === 0) return [];
        const now = new Date();
        const months: MonthData[] = [];

        for (let i = 5; i >= 0; i--) {
            const m = subMonths(now, i);
            const start = startOfMonth(m);
            const end = endOfMonth(m);
            const monthOrders = orders.filter(o => {
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

    // Risk level based on cancel rate
    const riskLevel = useMemo(() => {
        if (stats.total === 0) return null;
        const cancelRate = stats.total > 0 ? (stats.cancelled / stats.total) * 100 : 0;
        if (cancelRate > 60) return { label: 'High Risk', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' };
        if (cancelRate > 30) return { label: 'Medium Risk', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' };
        return { label: 'Low Risk', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' };
    }, [stats]);

    const cleaned = phone?.replace(/[^0-9+]/g, '') || '';
    if (cleaned.length < 6) return null;

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-brand-navy/10 flex items-center justify-center">
                        <BarChart3 className="w-3 h-3 text-brand-navy" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                        Customer Intelligence
                    </span>
                </div>
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-navy/30" />}
                {riskLevel && !loading && (
                    <span className={cn("text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border", riskLevel.color, riskLevel.bg, riskLevel.border)}>
                        {riskLevel.label}
                    </span>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-6">
                    <div className="flex items-center gap-2 text-brand-navy/30">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-bold">Analyzing customer...</span>
                    </div>
                </div>
            ) : searched && orders.length === 0 ? (
                <div className="flex items-center gap-3 py-4 px-4 rounded-2xl bg-blue-50/80 border border-blue-100">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-blue-700">New Customer</p>
                        <p className="text-[10px] text-blue-500 font-medium">No previous orders found for this number.</p>
                    </div>
                </div>
            ) : searched && orders.length > 0 ? (
                <>
                    {/* Stats Grid */}
                    <div className="grid grid-cols-4 gap-2">
                        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy to-brand-navy/90 p-3 text-white">
                            <div className="relative z-10">
                                <div className="flex items-center gap-1 mb-1">
                                    <ShoppingBag className="w-3 h-3 opacity-60" />
                                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Total</span>
                                </div>
                                <span className="text-2xl font-black leading-none">{stats.total}</span>
                            </div>
                            <div className="absolute -right-2 -bottom-2 w-12 h-12 bg-white/5 rounded-full blur-lg" />
                        </div>

                        <div className="relative overflow-hidden rounded-2xl bg-emerald-50 border border-emerald-100 p-3">
                            <div className="relative z-10">
                                <div className="flex items-center gap-1 mb-1">
                                    <Truck className="w-3 h-3 text-emerald-400" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/60">Delivered</span>
                                </div>
                                <span className="text-2xl font-black text-emerald-700 leading-none">{stats.delivered}</span>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-2xl bg-red-50 border border-red-100 p-3">
                            <div className="relative z-10">
                                <div className="flex items-center gap-1 mb-1">
                                    <XCircle className="w-3 h-3 text-red-400" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-red-500/60">Cancelled</span>
                                </div>
                                <span className="text-2xl font-black text-red-700 leading-none">{stats.cancelled}</span>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-2xl bg-amber-50 border border-amber-100 p-3">
                            <div className="relative z-10">
                                <div className="flex items-center gap-1 mb-1">
                                    <DollarSign className="w-3 h-3 text-amber-400" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/60">Spent</span>
                                </div>
                                <span className="text-lg font-black text-amber-700 leading-none">{stats.totalSpent.toLocaleString()}<span className="text-[10px] font-bold ml-0.5">DH</span></span>
                            </div>
                        </div>
                    </div>

                    {/* Delivery Rate Bar */}
                    <div className="rounded-xl bg-white border border-brand-navy/[0.04] p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-brand-navy/40 uppercase tracking-wider">Delivery Rate</span>
                            <span className={cn(
                                "text-sm font-black",
                                stats.deliveryRate >= 60 ? "text-emerald-600" : stats.deliveryRate >= 30 ? "text-amber-600" : "text-red-600"
                            )}>{stats.deliveryRate}%</span>
                        </div>
                        <div className="w-full h-2 bg-brand-navy/[0.04] rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all duration-700 ease-out",
                                    stats.deliveryRate >= 60 ? "bg-gradient-to-r from-emerald-400 to-emerald-500" :
                                        stats.deliveryRate >= 30 ? "bg-gradient-to-r from-amber-400 to-amber-500" :
                                            "bg-gradient-to-r from-red-400 to-red-500"
                                )}
                                style={{ width: `${stats.deliveryRate}%` }}
                            />
                        </div>
                    </div>

                    {/* Chart */}
                    {chartData.some(d => d.orders > 0) && (
                        <div className="rounded-2xl bg-white border border-brand-navy/[0.04] p-3 pb-1">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                    <TrendingUp className="w-3 h-3 text-brand-navy/30" />
                                    <span className="text-[10px] font-bold text-brand-navy/40 uppercase tracking-wider">Order History (6 months)</span>
                                </div>
                            </div>
                            <div className="h-[100px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="customerInsightsGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#1e293b" stopOpacity={0.15} />
                                                <stop offset="100%" stopColor="#1e293b" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                                        <XAxis
                                            dataKey="month"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                                            dy={4}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                                            allowDecimals={false}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                borderRadius: '12px',
                                                border: 'none',
                                                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                padding: '8px 12px',
                                            }}
                                            formatter={(value: any, name: string) => [
                                                name === 'orders' ? `${value} orders` : `${value} DH`,
                                                name === 'orders' ? 'Orders' : 'Revenue'
                                            ]}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="orders"
                                            stroke="#1e293b"
                                            strokeWidth={2.5}
                                            fillOpacity={1}
                                            fill="url(#customerInsightsGrad)"
                                            activeDot={{ r: 4, strokeWidth: 0, fill: '#1e293b' }}
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

export default CustomerInsights;
