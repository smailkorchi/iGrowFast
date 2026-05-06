import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCheck, Trophy } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { eachDayOfInterval, startOfDay, endOfDay } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';
import {
    AnalyticsOrder,
    inWindow,
    isAdminPullback,
    isDelivered,
    isRevenueOrder,
    placementTimestamp,
    pureRevenueForOrder,
} from '@/lib/analyticsDefinitions';

interface SellersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const SellersSection = ({ businessId, dateFilter }: SellersSectionProps) => {
    const { deliveredPkgIds, paidOrderIds, adminPullbackOrderIds, adminPullbackPackageIds } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId);
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
        queryKey: ['analytics-orders-sellers-v3', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, seller_id, date, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, package_status_label, package_statuses(label, category), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot)')
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
    });

    // Commission source of truth — seller_daily_earnings view. Date column matches
    // seller_daily_earnings.date (= date_livraison fallback updated_at).
    const { data: sellerEarnings } = useQuery({
        queryKey: ['analytics-seller-daily-earnings-section', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('seller_daily_earnings')
                .select('seller_id, date, commission_earned, total_earned, delivered_count')
                .eq('DigiCom Business', businessId);
            return (data || []) as Array<{
                seller_id: string;
                date: string;
                commission_earned: number | string | null;
                total_earned: number | string | null;
                delivered_count: number | null;
            }>;
        },
        enabled: !!businessId,
    });

    // Payouts table — only for lifetime "paid vs pending" summary; commission math
    // now comes from the daily earnings view above.
    const { data: sellerPayments } = useQuery({
        queryKey: ['analytics-seller-payments', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            const { data } = await supabase
                .from('seller_payments')
                .select('id, seller_id, total_amount, status')
                .eq('DigiCom Business', businessId);
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
        const ordersTyped = orders as unknown as AnalyticsOrder[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        // Window is anchored to orders.date (placement) for volume metrics like "orders in range".
        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));
        const activeSellers = sellers.filter(s => s.active);

        // Commission from the authoritative view — sum commission_earned per seller
        // for rows whose (delivery) date falls in the window.
        const commissionBySeller = new Map<string, number>();
        (sellerEarnings || []).forEach(row => {
            if (!row.seller_id || !row.date) return;
            const d = new Date(row.date);
            if (Number.isNaN(d.getTime()) || !inWindow(d, windowStart, windowEnd)) return;
            commissionBySeller.set(row.seller_id, (commissionBySeller.get(row.seller_id) || 0) + Number(row.commission_earned || 0));
        });

        const totalPaidToSellers = (sellerPayments || [])
            .filter(sp => sp.status === 'paid')
            .reduce((s, sp) => s + Number(sp.total_amount || 0), 0);
        const totalPendingToSellers = (sellerPayments || [])
            .filter(sp => sp.status === 'pending')
            .reduce((s, sp) => s + Number(sp.total_amount || 0), 0);

        const totalPresences = (presences || []).filter(p => {
            if (!p.date) return false;
            const d = new Date(p.date);
            return !Number.isNaN(d.getTime()) && inWindow(d, windowStart, windowEnd);
        }).length;
        // Expected presences scales with the selected window.
        // Morocco convention: 6-day working week (Mon-Sat). Sundays excluded.
        // Previous behaviour hardcoded 26 days × active sellers regardless of
        // window, which made "Today" read 0–4 % even with full attendance and
        // pushed "YTD" / "All Time" over 100 %.
        const clampedStart = dateFilter.from ? windowStart : null;
        const clampedEnd = dateFilter.to ? windowEnd : null;
        let workingDaysInWindow = 0;
        if (clampedStart && clampedEnd && clampedEnd.getTime() >= clampedStart.getTime()) {
            const days = eachDayOfInterval({ start: clampedStart, end: clampedEnd });
            workingDaysInWindow = days.filter((d) => d.getDay() !== 0).length; // 0 = Sunday
        } else {
            // All-Time: take the span from the earliest presence to today.
            const presenceDates = (presences || [])
                .map((p) => (p.date ? new Date(p.date) : null))
                .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
            if (presenceDates.length > 0) {
                const earliest = new Date(Math.min(...presenceDates.map((d) => d.getTime())));
                const days = eachDayOfInterval({ start: startOfDay(earliest), end: endOfDay(new Date()) });
                workingDaysInWindow = days.filter((d) => d.getDay() !== 0).length;
            }
        }
        const expectedPresences = activeSellers.length * workingDaysInWindow;
        const attendanceRate = expectedPresences > 0 ? (totalPresences / expectedPresences) * 100 : 0;

        const sellerPerformance = sellers
            .filter(s => !!s.id)
            .map(seller => {
                const sellerOrdersInRange = filtered.filter(o => o.seller_id === seller.id);
                // Delivered count = from view (matches payouts). Revenue counted only on paid+delivered.
                const revenueOrders = sellerOrdersInRange.filter(o => isRevenueOrder(o, deliveredPkgIds, paidOrderIds));
                const deliveredAny = sellerOrdersInRange.filter(o => isDelivered(o, deliveredPkgIds)).length;
                const deliveredPaid = revenueOrders.length;
                const revenue = revenueOrders.reduce((s, o) => s + pureRevenueForOrder(o), 0);
                const sellerPresences = (presences || [])
                    .filter(p => p.seller_id === seller.id && p.date && inWindow(new Date(p.date), windowStart, windowEnd))
                    .length;
                const commission = commissionBySeller.get(seller.id) || 0;
                const basis = normalizeCommissionBasis((seller as { commission_basis?: string | null }).commission_basis);

                // Success / delivery rate (Coliaty formula):
                //   delivered ÷ (tracked − admin-pullback)
                const tracked = sellerOrdersInRange.filter((o) => !!o.id && trackedOrderIds.has(o.id));
                const pullback = tracked.filter((o) =>
                    isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
                );
                const deliveryDenom = tracked.length - pullback.length;
                return {
                    name: seller.name,
                    active: seller.active,
                    avatar_url: seller.avatar_url,
                    commission_price: Number(seller.commission_price) || 0,
                    commission_basis: basis,
                    totalOrders: sellerOrdersInRange.length,
                    delivered: deliveredAny,
                    deliveredPaid,
                    revenue,
                    successRate: deliveryDenom > 0 ? (deliveredAny / deliveryDenom) * 100 : 0,
                    presences: sellerPresences,
                    commission,
                };
            })
            .sort((a, b) => b.delivered - a.delivered);

        const topPerformer = sellerPerformance[0];
        const avgOrdersPerSeller = activeSellers.length > 0 ? filtered.length / activeSellers.length : 0;
        const totalLiveCommission = sellerPerformance.reduce((s, sp) => s + sp.commission, 0);

        return {
            totalSellers: sellers.length,
            activeSellers: activeSellers.length,
            totalPaidToSellers, totalPendingToSellers, totalLiveCommission, attendanceRate,
            topPerformer, avgOrdersPerSeller,
            sellerPerformance: sellerPerformance.slice(0, 10),
        };
    }, [sellers, orders, sellerEarnings, sellerPayments, presences, dateFilter, deliveredPkgIds, paidOrderIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds]);

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
            {metrics && (() => {
                const bestSuccess = Math.max(...metrics.sellerPerformance.map((s) => s.successRate), 0);
                const narrative = metrics.totalSellers === 0
                    ? 'No sellers on the roster.'
                    : `${metrics.activeSellers.toLocaleString('fr-MA')} of ${metrics.totalSellers.toLocaleString('fr-MA')} sellers active. ${
                          metrics.topPerformer
                              ? `${metrics.topPerformer.name} leads with ${metrics.topPerformer.delivered} delivered orders.`
                              : ''
                      } ${Math.round(metrics.totalPendingToSellers).toLocaleString('fr-MA')} MAD pending in commission payouts.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'top performer',
                            value: metrics.topPerformer?.name || 'N/A',
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Sellers', value: metrics.totalSellers.toLocaleString('fr-MA'), sub: `${metrics.activeSellers} active` },
                            { label: 'Top delivered', value: (metrics.topPerformer?.delivered || 0).toLocaleString('fr-MA') },
                            { label: 'Best success', value: `${bestSuccess.toFixed(1)}%`, tone: 'positive' },
                            { label: 'Commission (window)', value: `${Math.round(metrics.totalLiveCommission).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'Paid (lifetime)', value: `${Math.round(metrics.totalPaidToSellers).toLocaleString('fr-MA')} MAD` },
                            { label: 'Pending payouts', value: `${Math.round(metrics.totalPendingToSellers).toLocaleString('fr-MA')} MAD`, tone: metrics.totalPendingToSellers > 0 ? 'warning' : 'neutral' },
                            { label: 'Attendance', value: `${metrics.attendanceRate.toFixed(0)}%` },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Seller ranking by delivered orders</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={160}>
                                <BarChart data={metrics.sellerPerformance} layout="vertical" margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" horizontal={false} />
                                    <XAxis type="number" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#6b6a63' }} tickLine={false} axisLine={false} width={100} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                    <Bar dataKey="delivered" radius={[0, 4, 4, 0]} name="Delivered" fill="#141413" />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Performance Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-ant-line">
                                            <th className="text-left py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Seller</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Orders</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Delivered</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Success</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Revenue</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Presence</th>
                                            <th className="text-right py-3 text-[10px] uppercase tracking-widest font-bold text-ant-mid">Commission</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metrics.sellerPerformance.map((s, i) => (
                                            <tr key={i} className="border-b border-ant-line hover:bg-ant-ink/[0.02] transition-colors">
                                                <td className="py-2.5">
                                                    <div className="flex items-center gap-3">
                                                        {s.avatar_url ? (
                                                            <img src={s.avatar_url} alt={s.name} className="w-8 h-8 rounded-xl object-cover border border-ant-ink/5 shrink-0" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-xl bg-ant-ink/[0.06] flex items-center justify-center shrink-0">
                                                                <span className="text-xs font-bold text-ant-ink/50">{s.name?.charAt(0)?.toUpperCase()}</span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="font-semibold text-ant-ink flex items-center gap-1.5">
                                                                {i === 0 && <Trophy className="w-3.5 h-3.5 text-ant-orange" />}
                                                                {s.name}
                                                            </div>
                                                            {!s.active && <Badge className="bg-ant-line text-ant-muted border-0 text-[9px]">Inactive</Badge>}
                                                            <div className="text-[10px] text-ant-mid">
                                                                {s.commission_price} MAD/{s.commission_basis === 'per_unit' ? 'unit' : 'order'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 text-right font-bold">{s.totalOrders}</td>
                                                <td className="py-2.5 text-right">{s.delivered}</td>
                                                <td className="py-2.5 text-right">
                                                    <Badge className={`text-xs border-0 ${s.successRate > 40 ? 'bg-ant-green/10 text-ant-green' : s.successRate > 20 ? 'bg-ant-orange/10 text-ant-orange' : 'bg-ant-rose/10 text-ant-rose'}`}>
                                                        {s.successRate.toFixed(1)}%
                                                    </Badge>
                                                </td>
                                                <td className="py-2.5 text-right">{Math.round(s.revenue).toLocaleString('fr-MA')} <span className="text-[10px] text-ant-mid">MAD</span></td>
                                                <td className="py-2.5 text-right">{s.presences} days</td>
                                                <td className="py-2.5 text-right text-ant-green font-semibold tabular-nums">{Math.round(s.commission).toLocaleString('fr-MA')} <span className="text-[10px] opacity-60">MAD</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
