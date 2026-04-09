import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    UserCheck, Trophy, DollarSign, CalendarCheck,
    TrendingUp, Users, ShoppingBag, Award,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, AreaChart, Area, Cell, Legend,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission } from '@/lib/commercialCommission';

const BAR_COLORS = ['#3b5e5e', '#7a9385', '#F97316', '#3B82F6', '#A855F7', '#14B8A6', '#EC4899', '#c93942'];

interface SellersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const SellersSection = ({ businessId, dateFilter }: SellersSectionProps) => {
    const { deliveredPkgIds } = useStatusCategories();
    const { data: sellers, isLoading } = useQuery({
        queryKey: ['analytics-sellers-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, active, commission_price, commission_basis, products, role, avatar_url')
                .eq('DigiCom Business', businessId)
                .eq('role', 'commercial');
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orders } = useQuery({
        queryKey: ['analytics-orders-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, seller_id, date, price, order_status_id, package_status_id, package_status_label, package_statuses(label), order_items(product_id, quantity)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: sellerPayments } = useQuery({
        queryKey: ['analytics-seller-payments', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            const { data } = await supabase.from('seller_payments').select('id, seller_id, total_amount, salary_earned, commission_earned, delivered_orders, days_present, status, payout_month, created_at').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: presences } = useQuery({
        queryKey: ['analytics-presences', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            const { data } = await supabase.from('seller_presences').select('id, seller_id, date').eq('DigiCom Business', businessId);
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

        const filtered = orders.filter(o => isInRange(o.date));
        const activeSellers = sellers.filter(s => s.active);

        const isDelivered = (o: Record<string, unknown>) => isDeliveredForCommission(o, deliveredPkgIds);

        /** Unpaid commission uses lifetime paid tally — orders must not be date-filtered. */
        const totalPaidToSellers = (sellerPayments || [])
            .filter(sp => sp.status === 'paid')
            .reduce((s, sp) => s + Number(sp.total_amount || 0), 0);

        const totalPendingToSellers = (sellerPayments || [])
            .filter(sp => sp.status === 'pending')
            .reduce((s, sp) => s + Number(sp.total_amount || 0), 0);

        const totalPresences = (presences || []).filter(p => isInRange(p.date)).length;
        const expectedPresences = activeSellers.length * 26;
        const attendanceRate = expectedPresences > 0 ? (totalPresences / expectedPresences) * 100 : 0;

        const sellerPerformance = sellers.map(seller => {
            const sellerOrdersInRange = filtered.filter(o => o.seller_id === seller.id);
            const sellerOrdersAllTime = orders.filter(o => o.seller_id === seller.id);
            const delivered = sellerOrdersInRange.filter(isDelivered);
            const revenue = delivered.reduce((s, o) => s + Number(o.price || 0), 0);
            const sellerPresences = (presences || []).filter(p => p.seller_id === seller.id && isInRange(p.date)).length;

            const paidPayments = (sellerPayments || []).filter(sp => sp.seller_id === seller.id && sp.status === 'paid');
            const totalPaid = paidPayments.reduce((s, sp) => s + Number(sp.total_amount || 0), 0);
            const alreadyPaidDeliveries = paidPayments.reduce((s, sp) => s + Number(sp.delivered_orders || 0), 0);
            const sellerExt = seller as { commission_basis?: string | null; products?: unknown };
            const basis = normalizeCommissionBasis(sellerExt.commission_basis);
            const sellerProductIds = Array.isArray(sellerExt.products)
                ? (sellerExt.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];
            const { unpaidCommission: liveCommission } = computeUnpaidCommission({
                basis,
                commissionPrice: Number(seller.commission_price) || 0,
                orders: sellerOrdersAllTime,
                isDelivered,
                sellerProductIds,
                paidTally: alreadyPaidDeliveries,
            });
            const totalCommissionEarned = (sellerPayments || [])
                .filter(sp => sp.seller_id === seller.id)
                .reduce((s, sp) => s + Number(sp.commission_earned || 0), 0);

            return {
                name: seller.name,
                active: seller.active,
                avatar_url: seller.avatar_url,
                commission_price: Number(seller.commission_price) || 0,
                commission_basis: basis,
                totalOrders: sellerOrdersInRange.length,
                delivered: delivered.length,
                revenue,
                successRate: sellerOrdersInRange.length > 0 ? (delivered.length / sellerOrdersInRange.length) * 100 : 0,
                presences: sellerPresences,
                totalPaid,
                liveCommission,
                totalCommissionEarned,
            };
        }).sort((a, b) => b.delivered - a.delivered);

        const topPerformer = sellerPerformance[0];
        const avgOrdersPerSeller = activeSellers.length > 0 ? filtered.length / activeSellers.length : 0;
        const totalLiveCommission = sellerPerformance.reduce((s, sp) => s + sp.liveCommission, 0);

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = endOfDay(new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0));
            const monthOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));
            const monthCommissions = (sellerPayments || [])
                .filter(sp => sp.created_at && isWithinInterval(new Date(sp.created_at), { start: mStart, end: mEnd }))
                .reduce((s, sp) => s + Number(sp.total_amount || 0), 0);
            return {
                month: format(month, 'MMM yy'),
                orders: monthOrders.length,
                commissions: monthCommissions,
            };
        });

        return {
            totalSellers: sellers.length,
            activeSellers: activeSellers.length,
            totalPaidToSellers, totalPendingToSellers, totalLiveCommission, attendanceRate,
            topPerformer, avgOrdersPerSeller,
            sellerPerformance: sellerPerformance.slice(0, 10),
            trendData,
        };
    }, [sellers, orders, sellerPayments, presences, dateFilter, deliveredPkgIds]);

    return (
        <SectionWrapper
            id="sellers"
            title="Sellers & Commercials"
            description="Team performance, commissions, and attendance"
            icon={UserCheck}
            iconBg="bg-orange-50"
            iconColor="text-orange-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                        <StatCard title="Total Sellers" value={metrics.totalSellers} icon={Users} iconBg="bg-orange-50" iconColor="text-orange-600" subtitle={`${metrics.activeSellers} active`} />
                        <StatCard title="Total Paid" value={metrics.totalPaidToSellers.toLocaleString('fr-MA')} suffix=" MAD" subtitle="Lifetime — ignores date filter" icon={DollarSign} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Pending Payment" value={metrics.totalPendingToSellers.toLocaleString('fr-MA')} suffix=" MAD" subtitle="Lifetime — ignores date filter" icon={DollarSign} iconBg="bg-orange-50" iconColor="text-orange-600" />
                        <StatCard title="Live Commission" value={metrics.totalLiveCommission.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-amber-50" iconColor="text-amber-600" subtitle="Unpaid accrual (lifetime vs paid payouts)" />
                        <StatCard title="Top Performer" value={metrics.topPerformer?.name || 'N/A'} icon={Trophy} iconBg="bg-amber-50" iconColor="text-amber-600" subtitle={`${metrics.topPerformer?.delivered || 0} delivered`} />
                        <StatCard title="Attendance" value={metrics.attendanceRate.toFixed(0)} suffix="%" icon={CalendarCheck} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Best Success Rate" value={Math.max(...metrics.sellerPerformance.map(s => s.successRate), 0).toFixed(1)} suffix="%" icon={Award} iconBg="bg-teal-50" iconColor="text-teal-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Seller Ranking</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={metrics.sellerPerformance} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} width={100} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="delivered" radius={[0, 8, 8, 0]} name="Delivered">
                                            {metrics.sellerPerformance.map((_, i) => (
                                                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Commission Trend</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorCommissions" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`} />
                                        <Area type="monotone" dataKey="commissions" stroke="#F97316" fill="url(#colorCommissions)" strokeWidth={2.5} name="Commissions" />
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-0 shadow-sm rounded-3xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold text-brand-navy">Performance Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Seller</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Orders</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Delivered</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Success</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Revenue</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Presence</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Paid</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-gray-400">Unpaid</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metrics.sellerPerformance.map((s, i) => (
                                            <tr key={i} className="border-b border-gray-50 hover:bg-brand-navy/[0.02] transition-colors">
                                                <td className="py-2.5">
                                                    <div className="flex items-center gap-3">
                                                        {s.avatar_url ? (
                                                            <img src={s.avatar_url} alt={s.name} className="w-8 h-8 rounded-xl object-cover border border-brand-navy/5 shrink-0" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-xl bg-brand-navy/[0.06] flex items-center justify-center shrink-0">
                                                                <span className="text-xs font-bold text-brand-navy/50">{s.name?.charAt(0)?.toUpperCase()}</span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="font-semibold text-brand-navy flex items-center gap-1.5">
                                                                {i === 0 && <Trophy className="w-3.5 h-3.5 text-amber-500" />}
                                                                {s.name}
                                                            </div>
                                                            {!s.active && <Badge className="bg-gray-100 text-gray-500 border-0 text-[9px]">Inactive</Badge>}
                                                            <div className="text-[10px] text-gray-400">
                                                                {s.commission_price} MAD/{s.commission_basis === 'per_unit' ? 'unit' : 'order'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 text-right font-bold">{s.totalOrders}</td>
                                                <td className="py-2.5 text-right">{s.delivered}</td>
                                                <td className="py-2.5 text-right">
                                                    <Badge className={`text-xs border-0 ${s.successRate > 40 ? 'bg-emerald-50 text-emerald-600' : s.successRate > 20 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
                                                        {s.successRate.toFixed(1)}%
                                                    </Badge>
                                                </td>
                                                <td className="py-2.5 text-right">{s.revenue.toLocaleString('fr-MA')} <span className="text-[10px] text-brand-navy/40">MAD</span></td>
                                                <td className="py-2.5 text-right">{s.presences} days</td>
                                                <td className="py-2.5 text-right text-emerald-600 font-bold">{s.totalPaid.toLocaleString('fr-MA')} <span className="text-[10px] opacity-60">MAD</span></td>
                                                <td className="py-2.5 text-right text-amber-600 font-bold">{s.liveCommission.toLocaleString('fr-MA')} <span className="text-[10px] opacity-60">MAD</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </SectionWrapper>
    );
};
