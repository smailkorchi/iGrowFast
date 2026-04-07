import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    PackageOpen, AlertTriangle, DollarSign, Archive,
    TrendingUp, ShoppingCart, Layers, Box,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, AreaChart, Area, Legend, Cell,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths } from 'date-fns';

interface InventorySectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const InventorySection = ({ businessId, dateFilter }: InventorySectionProps) => {
    const { data: products, isLoading } = useQuery({
        queryKey: ['analytics-products-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('products').select('id, name, code, cost_price, selling_price, stock, active, image_url').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: accessories } = useQuery({
        queryKey: ['analytics-accessories-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('accessories').select('id, name, code, cost_price, stock, active').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orderItems } = useQuery({
        queryKey: ['analytics-order-items-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('order_items').select('id, product_id, quantity, unit_price, accessory_id, accessory_quantity, order_id, orders(date, order_status_id, package_status_id)').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: transactions } = useQuery({
        queryKey: ['analytics-transactions-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('transactions').select('id, total_price, paid_price, date, status').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: trnsPurchases } = useQuery({
        queryKey: ['analytics-trns-purchase-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('trns_purchase').select('id, product_id, quantity, sub_total, accessory_id, accessory_quantity, accessory_sub_total, transaction_id').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const totalProducts = products.length;
        const activeProducts = products.filter(p => p.active).length;
        const totalAccessories = accessories?.length || 0;
        const lowStockProducts = products.filter(p => Number(p.stock || 0) <= 5 && p.active);
        const lowStockAccessories = (accessories || []).filter(a => Number(a.stock || 0) <= 5 && a.active);

        const totalStockValue = products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.cost_price || 0), 0)
            + (accessories || []).reduce((s, a) => s + Number(a.stock || 0) * Number(a.cost_price || 0), 0);

        const productSales: Record<string, { name: string; image_url: string | null; sold: number; revenue: number; cost: number }> = {};
        (orderItems || []).forEach(item => {
            const orderDate = (item as { orders?: { date?: string } }).orders?.date;
            if (!isInRange(orderDate)) return;
            const pid = item.product_id;
            const product = products.find(p => p.id === pid);
            if (!product) return;
            if (!productSales[pid]) productSales[pid] = { name: product.name, image_url: product.image_url, sold: 0, revenue: 0, cost: 0 };
            productSales[pid].sold += Number(item.quantity || 0);
            productSales[pid].revenue += Number(item.quantity || 0) * Number(item.unit_price || 0);
            productSales[pid].cost += Number(item.quantity || 0) * Number(product.cost_price || 0);
        });

        const productPerformance = Object.values(productSales)
            .sort((a, b) => b.sold - a.sold)
            .map(p => ({
                ...p,
                margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0,
            }));

        const totalUnitsSold = productPerformance.reduce((s, p) => s + p.sold, 0);

        const filteredTransactions = (transactions || []).filter(t => isInRange(t.date));
        const totalTransactionValue = filteredTransactions.reduce((s, t) => s + Number(t.total_price || 0), 0);
        const totalPaid = filteredTransactions.reduce((s, t) => s + Number(t.paid_price || 0), 0);
        const unpaidAmount = totalTransactionValue - totalPaid;

        const stockData = products
            .filter(p => p.active)
            .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
            .slice(0, 15)
            .map(p => ({
                name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
                stock: Number(p.stock || 0),
                isLow: Number(p.stock || 0) <= 5,
            }));

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const salesTrend = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthItems = (orderItems || []).filter(item => {
                const od = (item as { orders?: { date?: string } }).orders?.date;
                return od && isWithinInterval(new Date(od), { start: mStart, end: mEnd });
            });
            return {
                month: format(month, 'MMM yy'),
                units: monthItems.reduce((s, i) => s + Number(i.quantity || 0), 0),
                revenue: monthItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
            };
        });

        return {
            totalProducts, activeProducts, totalAccessories,
            lowStockProducts, lowStockAccessories,
            totalStockValue, totalUnitsSold, productPerformance,
            totalTransactionValue, unpaidAmount, stockData, salesTrend,
        };
    }, [products, accessories, orderItems, transactions, dateFilter]);

    return (
        <SectionWrapper
            id="inventory"
            title="Inventory & Products"
            description="Stock levels, product performance, and transactions"
            icon={PackageOpen}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                        <StatCard title="Products" value={metrics.totalProducts} icon={Box} iconBg="bg-blue-50" iconColor="text-blue-600" subtitle={`${metrics.activeProducts} active`} />
                        <StatCard title="Accessories" value={metrics.totalAccessories} icon={Layers} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Low Stock" value={metrics.lowStockProducts.length + metrics.lowStockAccessories.length} icon={AlertTriangle} iconBg="bg-red-50" iconColor="text-red-500" valueColor={metrics.lowStockProducts.length > 0 ? 'text-red-500' : undefined} />
                        <StatCard title="Stock Value" value={metrics.totalStockValue.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Units Sold" value={metrics.totalUnitsSold} icon={ShoppingCart} iconBg="bg-teal-50" iconColor="text-teal-600" />
                        <StatCard title="Transactions" value={metrics.totalTransactionValue.toLocaleString('fr-MA')} suffix=" MAD" icon={Archive} iconBg="bg-amber-50" iconColor="text-amber-600" />
                        <StatCard title="Unpaid" value={metrics.unpaidAmount.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-orange-50" iconColor="text-orange-600" valueColor={metrics.unpaidAmount > 0 ? 'text-orange-600' : undefined} />
                        <StatCard title="Top Product" value={metrics.productPerformance[0]?.sold || 0} suffix=" sold" icon={TrendingUp} iconBg="bg-indigo-50" iconColor="text-indigo-600" subtitle={metrics.productPerformance[0]?.name || 'N/A'} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Stock Levels</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={metrics.stockData} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} width={120} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="stock" radius={[0, 8, 8, 0]} name="Stock">
                                            {metrics.stockData.map((entry, i) => (
                                                <Cell key={i} fill={entry.isLow ? '#EF4444' : '#3b5e5e'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Sales Velocity</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={metrics.salesTrend}>
                                        <defs>
                                            <linearGradient id="colorUnits" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="units" stroke="#F97316" fill="url(#colorUnits)" strokeWidth={2.5} name="Units Sold" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {metrics.productPerformance.length > 0 && (
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Product Performance</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-100">
                                                <th className="text-left py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Product</th>
                                                <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Sold</th>
                                                <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Revenue</th>
                                                <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Cost</th>
                                                <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Margin</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {metrics.productPerformance.slice(0, 10).map((p, i) => (
                                                <tr key={i} className="border-b border-gray-50 hover:bg-brand-navy/[0.02] transition-colors">
                                                    <td className="py-2.5">
                                                        <div className="flex items-center gap-3">
                                                            {p.image_url ? (
                                                                <img src={p.image_url} alt={p.name} className="w-9 h-9 rounded-xl object-cover border border-brand-navy/5 shrink-0" />
                                                            ) : (
                                                                <div className="w-9 h-9 rounded-xl bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                    <Box className="w-4 h-4 text-brand-navy/20" />
                                                                </div>
                                                            )}
                                                            <span className="font-semibold text-brand-navy">{p.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 text-right font-bold">{p.sold}</td>
                                                    <td className="py-2.5 text-right">{p.revenue.toLocaleString('fr-MA')} <span className="text-[10px] text-brand-navy/40">MAD</span></td>
                                                    <td className="py-2.5 text-right text-gray-500">{p.cost.toLocaleString('fr-MA')} <span className="text-[10px] text-brand-navy/40">MAD</span></td>
                                                    <td className="py-2.5 text-right">
                                                        <Badge className={`text-xs ${p.margin > 30 ? 'bg-emerald-50 text-emerald-600' : p.margin > 0 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'} border-0`}>
                                                            {p.margin.toFixed(1)}%
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {(metrics.lowStockProducts.length > 0 || metrics.lowStockAccessories.length > 0) && (
                        <Card className="border-0 shadow-sm rounded-3xl bg-red-50/30">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-red-600 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4" /> Low Stock Alerts
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-2">
                                    {metrics.lowStockProducts.map(p => (
                                        <Badge key={p.id} className="bg-red-100 text-red-700 border-0 text-xs">
                                            {p.name}: {p.stock} left
                                        </Badge>
                                    ))}
                                    {metrics.lowStockAccessories.map(a => (
                                        <Badge key={a.id} className="bg-orange-100 text-orange-700 border-0 text-xs">
                                            {a.name} (acc): {a.stock} left
                                        </Badge>
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
