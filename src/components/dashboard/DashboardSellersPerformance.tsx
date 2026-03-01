import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Users, User } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface DashboardSellersPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

const BAR_COLORS = ['#3b5e5e', '#7a9385', '#F97316', '#3B82F6', '#A855F7', '#14B8A6', '#EC4899', '#c93942'];

export const DashboardSellersPerformance = ({ businessId, dateFilter }: DashboardSellersPerformanceProps) => {
    const { data: sellers } = useQuery({
        queryKey: ['dashboard-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, commission_price, active')
                .eq('role', 'commercial')
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

    const { data: sellerPayments } = useQuery({
        queryKey: ['analytics-seller-payments', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('seller_payments')
                .select('id, seller_id, total_amount, salary_earned, commission_earned, delivered_orders, days_present, status, payout_month, created_at')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: presences } = useQuery({
        queryKey: ['dashboard-presences', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('seller_presences')
                .select('id, seller_id, date')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!sellers || !orders) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = orders.filter((o: any) => isInRange(o.date));

        const sellerData = sellers.map((seller: any) => {
            const sellerOrders = filtered.filter((o: any) => o.seller_id === seller.id);
            const confirmed = sellerOrders.filter((o: any) => {
                const code = ((o.order_statuses as any)?.code || '').toUpperCase();
                return code === 'CONFIRMED' || code === 'PAID' || code === 'UNPAID' || code === 'PROCESSED';
            });
            const delivered = sellerOrders.filter((o: any) =>
                (o.package_status_label || '').toLowerCase() === 'livré'
            );
            const revenue = delivered.reduce((s: number, o: any) => s + Number(o.price || 0), 0);
            const successRate = sellerOrders.length > 0 ? (delivered.length / sellerOrders.length) * 100 : 0;

            const paidPayments = (sellerPayments || []).filter((sp: any) => sp.seller_id === seller.id && sp.status === 'paid');
            const totalPaid = paidPayments.reduce((s: number, sp: any) => s + Number(sp.total_amount || 0), 0);
            const alreadyPaidDeliveries = paidPayments.reduce((s: number, sp: any) => s + Number(sp.delivered_orders || 0), 0);
            const unpaidDeliveries = Math.max(0, delivered.length - alreadyPaidDeliveries);
            const liveCommission = unpaidDeliveries * (Number(seller.commission_price) || 0);

            const sellerPresences = (presences || []).filter((p: any) => p.seller_id === seller.id && isInRange(p.date)).length;

            return {
                id: seller.id,
                name: seller.name,
                avatar_url: seller.avatar_url,
                active: seller.active,
                totalOrders: sellerOrders.length,
                confirmed: confirmed.length,
                delivered: delivered.length,
                revenue,
                successRate,
                totalPaid,
                liveCommission,
                presences: sellerPresences,
            };
        }).sort((a: any, b: any) => b.delivered - a.delivered);

        const chartData = sellerData.slice(0, 8).map((s: any) => ({
            name: s.name?.split(' ')[0] || 'N/A',
            delivered: s.delivered,
            orders: s.totalOrders,
        }));

        return { sellerData, chartData };
    }, [sellers, orders, sellerPayments, presences, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Sellers Performance</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.sellerData.length} sellers tracked</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Chart */}
                    <div className="lg:col-span-1">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Deliveries by Seller</h4>
                        <div className="h-[260px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metrics.chartData} margin={{ left: 0, right: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
                                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', fontSize: 12 }} />
                                    <Bar dataKey="delivered" name="Delivered" radius={[8, 8, 0, 0]} barSize={28}>
                                        {metrics.chartData.map((_: any, i: number) => (
                                            <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="lg:col-span-2 overflow-x-auto">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Performance Details</h4>
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Seller</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Orders</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Confirmed</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Delivered</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Rate</th>
                                    <th className="text-right py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Revenue</th>
                                    <th className="text-center py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Presence</th>
                                    <th className="text-right py-2 px-1 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Paid</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-400 uppercase tracking-widest text-[10px]">Unpaid</th>
                                </tr>
                            </thead>
                            <tbody>
                                {metrics.sellerData.map((s: any) => (
                                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                        <td className="py-2.5 px-2">
                                            <div className="flex items-center gap-2">
                                                {s.avatar_url ? (
                                                    <img src={s.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                                                ) : (
                                                    <div className="w-7 h-7 rounded-full bg-brand-navy/10 flex items-center justify-center text-[10px] font-bold text-brand-navy">
                                                        {s.name?.[0]}
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="font-bold text-brand-navy text-xs">{s.name}</span>
                                                    {!s.active && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">Inactive</Badge>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="text-center font-bold text-brand-navy">{s.totalOrders}</td>
                                        <td className="text-center font-bold text-brand-navy">{s.confirmed}</td>
                                        <td className="text-center font-bold text-brand-navy">{s.delivered}</td>
                                        <td className="text-center">
                                            <Badge className={cn(
                                                'text-[10px] px-1.5 py-0 font-bold',
                                                s.successRate >= 20 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                                s.successRate >= 10 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                                'bg-red-50 text-red-600 hover:bg-red-50'
                                            )}>
                                                {s.successRate.toFixed(1)}%
                                            </Badge>
                                        </td>
                                        <td className="text-right font-bold text-brand-navy">
                                            {s.revenue.toLocaleString('fr-MA')} <span className="text-[10px] text-gray-400">MAD</span>
                                        </td>
                                        <td className="text-center text-gray-500">{s.presences} days</td>
                                        <td className="text-right font-bold text-emerald-600">
                                            {s.totalPaid.toLocaleString('fr-MA')} <span className="text-[10px] text-gray-400">MAD</span>
                                        </td>
                                        <td className="text-right px-2 font-bold text-orange-600">
                                            {s.liveCommission.toLocaleString('fr-MA')} <span className="text-[10px] text-gray-400">MAD</span>
                                        </td>
                                    </tr>
                                ))}
                                {metrics.sellerData.length === 0 && (
                                    <tr><td colSpan={9} className="text-center py-8 text-gray-400">No sellers found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
