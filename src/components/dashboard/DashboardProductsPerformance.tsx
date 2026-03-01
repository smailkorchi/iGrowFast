import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Box, ShoppingBag } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface DashboardProductsPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

const COLORS = ['#3b5e5e', '#7a9385', '#F97316', '#3B82F6', '#A855F7', '#14B8A6', '#EC4899', '#c93942'];

export const DashboardProductsPerformance = ({ businessId, dateFilter }: DashboardProductsPerformanceProps) => {
    const { data: products } = useQuery({
        queryKey: ['dashboard-products', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('products')
                .select('id, name, image_url, stock, cost_price, selling_price, active')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orderItems } = useQuery({
        queryKey: ['dashboard-order-items', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('order_items')
                .select('id, order_id, product_id, quantity, unit_price, total_price')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, order_status_id, package_status_id, package_status_label, seller_id, company_id, order_statuses(code, label)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products || !orderItems || !orders) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filteredOrders = orders.filter((o: any) => isInRange(o.date));
        const filteredOrderIds = new Set(filteredOrders.map((o: any) => o.id));

        const orderMap = new Map<string, any>();
        filteredOrders.forEach((o: any) => orderMap.set(o.id, o));

        const productData = products.map((product: any) => {
            const items = orderItems.filter((oi: any) => oi.product_id === product.id && filteredOrderIds.has(oi.order_id));
            const totalOrders = items.length;
            const totalQuantity = items.reduce((s: number, oi: any) => s + Number(oi.quantity || 1), 0);

            let confirmedOrders = 0;
            let deliveredOrders = 0;
            let revenue = 0;

            items.forEach((oi: any) => {
                const order = orderMap.get(oi.order_id);
                if (!order) return;
                const code = ((order.order_statuses as any)?.code || '').toUpperCase();
                if (['CONFIRMED', 'PAID', 'UNPAID', 'PROCESSED'].includes(code)) confirmedOrders++;
                if ((order.package_status_label || '').toLowerCase() === 'livré') {
                    deliveredOrders++;
                    revenue += Number(oi.total_price || oi.unit_price || 0);
                }
            });

            return {
                id: product.id,
                name: product.name,
                image_url: product.image_url,
                stock: Number(product.stock || 0),
                active: product.active,
                totalOrders,
                totalQuantity,
                confirmedOrders,
                deliveredOrders,
                revenue,
                confirmRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0,
                deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
            };
        }).sort((a: any, b: any) => b.totalOrders - a.totalOrders);

        const chartData = productData.slice(0, 8).map((p: any) => ({
            name: (p.name || '').substring(0, 12),
            orders: p.totalOrders,
            delivered: p.deliveredOrders,
        }));

        return { productData, chartData };
    }, [products, orderItems, orders, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Products Performance</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.productData.length} products tracked</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Top Products</h4>
                        <div className="h-[260px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metrics.chartData} layout="vertical" margin={{ left: 0, right: 5 }}>
                                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }} />
                                    <Bar dataKey="orders" name="Orders" radius={[0, 8, 8, 0]} barSize={18}>
                                        {metrics.chartData.map((_: any, i: number) => (
                                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="lg:col-span-2 overflow-x-auto">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Details</h4>
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Product</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Orders</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Confirmed</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Delivered</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Rate</th>
                                    <th className="text-right py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Revenue</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Stock</th>
                                </tr>
                            </thead>
                            <tbody>
                                {metrics.productData.map((p: any) => (
                                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="py-2.5 px-2">
                                            <div className="flex items-center gap-2">
                                                {p.image_url ? (
                                                    <img src={p.image_url} alt="" className="w-8 h-8 rounded-xl object-cover bg-gray-100" />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
                                                        <Box className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                )}
                                                <span className="font-bold text-brand-navy text-xs truncate max-w-[120px]">{p.name}</span>
                                            </div>
                                        </td>
                                        <td className="text-center font-bold text-brand-navy">{p.totalOrders}</td>
                                        <td className="text-center font-bold text-brand-navy">{p.confirmedOrders}</td>
                                        <td className="text-center font-bold text-brand-navy">{p.deliveredOrders}</td>
                                        <td className="text-center">
                                            <Badge className={cn(
                                                'text-[10px] px-1.5 py-0 font-bold',
                                                p.deliveryRate >= 20 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                                p.deliveryRate >= 10 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                                'bg-red-50 text-red-600 hover:bg-red-50'
                                            )}>
                                                {p.deliveryRate.toFixed(1)}%
                                            </Badge>
                                        </td>
                                        <td className="text-right font-bold text-brand-navy">
                                            {p.revenue.toLocaleString('fr-MA')} <span className="text-[10px] text-gray-400">MAD</span>
                                        </td>
                                        <td className="text-right px-2">
                                            <Badge className={cn(
                                                'text-[10px] px-1.5 py-0 font-bold',
                                                p.stock > 10 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                                p.stock > 0 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                                'bg-red-50 text-red-600 hover:bg-red-50'
                                            )}>
                                                {p.stock}
                                            </Badge>
                                        </td>
                                    </tr>
                                ))}
                                {metrics.productData.length === 0 && (
                                    <tr><td colSpan={7} className="text-center py-8 text-gray-400">No products found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
