import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCheck, Trophy } from 'lucide-react';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';

/**
 * `sellers` section of admin_analytics_stats (D3). Server-side: the
 * placement-windowed per-seller order counts (replace legs excluded),
 * delivered/tracked/pullback counts, the full pureRevenue chain on
 * paid+delivered orders, commission (seller_daily_earnings view Σ — the source
 * of truth, never re-derived), the lifetime paid/pending payout ledger
 * (period_state='open' for pending — carried months already live in the open
 * ticket) and Mon–Sat attendance. Rows arrive sorted delivered desc.
 *
 * Two window anchors coexist by design: volume on placement, commission on the
 * delivery-anchored view date.
 *
 * Client keeps only presentation: names/avatars/commission rates (support query
 * below — the RPC rows carry ids), the unclamped success-rate arithmetic and
 * the top-10 slice.
 */
export interface SellersSlice {
    total_sellers: number;
    active_sellers: number;
    /** Σ commission over ALL roster sellers (computed before the top-10 slice). */
    total_commission: number;
    total_paid: number;
    total_pending: number;
    presence_total: number;
    working_days: number;
    attendance_rate: number;
    sellers: Array<{
        seller_id: string;
        orders: number;
        delivered: number;
        delivered_paid: number;
        tracked: number;
        pullback: number;
        revenue: number;
        presences: number;
        commission: number;
    }>;
}

interface SellersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: SellersSlice | null;
}

type SellerMeta = {
    id: string;
    name: string;
    active: boolean | null;
    commission_price: number | string | null;
    commission_basis: string | null;
    avatar_url: string | null;
    avatar_config?: unknown;
};

export const SellersSection = ({ businessId, stats }: SellersSectionProps) => {
    // Names/avatars/commission rates only — every aggregate rides the RPC section.
    const { data: sellers, isLoading } = useQuery({
        queryKey: ['analytics-sellers-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, active, commission_price, commission_basis, avatar_url, avatar_config')
                .eq('DigiCom Business', businessId)
                .eq('role', 'commercial');
            return (data || []) as unknown as SellerMeta[];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!sellers || !stats) return null;

        const metaById = new Map(sellers.map((s) => [s.id, s]));

        // Rows are already sorted delivered desc by the RPC.
        // Success / delivery rate (Coliaty formula): delivered ÷ (tracked −
        // admin-pullback). Unclamped — parity with the old client math.
        const sellerPerformance = stats.sellers.map((row) => {
            const meta = metaById.get(row.seller_id);
            const deliveryDenom = row.tracked - row.pullback;
            return {
                name: meta?.name || 'Unknown seller',
                active: meta?.active ?? null,
                avatar_url: meta?.avatar_url ?? null,
                avatar_config: meta?.avatar_config ?? null,
                commission_price: Number(meta?.commission_price) || 0,
                commission_basis: normalizeCommissionBasis(meta?.commission_basis),
                totalOrders: row.orders,
                delivered: row.delivered,
                deliveredPaid: row.delivered_paid,
                revenue: row.revenue,
                successRate: deliveryDenom > 0 ? (row.delivered / deliveryDenom) * 100 : 0,
                presences: row.presences,
                commission: row.commission,
            };
        });

        return {
            totalSellers: stats.total_sellers,
            activeSellers: stats.active_sellers,
            totalPaidToSellers: stats.total_paid,
            totalPendingToSellers: stats.total_pending,
            totalLiveCommission: stats.total_commission,
            attendanceRate: stats.attendance_rate,
            topPerformer: sellerPerformance[0],
            sellerPerformance: sellerPerformance.slice(0, 10),
        };
    }, [sellers, stats]);

    return (
        <SectionWrapper
            id="sellers"
            title="Sellers & Commercials"
            description="Team performance, commissions, and attendance"
            icon={UserCheck}
            iconBg="bg-orange-50"
            iconColor="text-orange-600"
            loading={isLoading || !stats}
        >
            {metrics && (() => {
                // Header is TEAM-ONLY — no single seller's numbers here (the top
                // performer is shown by the trophy in the table + the ranking chart).
                const windowDelivered = metrics.sellerPerformance.reduce((s, x) => s + x.delivered, 0);
                const narrative = metrics.totalSellers === 0
                    ? 'No sellers on the roster.'
                    : `${metrics.activeSellers.toLocaleString('fr-MA')} of ${metrics.totalSellers.toLocaleString('fr-MA')} sellers active · ${Math.round(metrics.totalLiveCommission).toLocaleString('fr-MA')} MAD earned this window · ${Math.round(metrics.totalPendingToSellers).toLocaleString('fr-MA')} MAD still pending in payouts.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'Commission · this window',
                            value: Math.round(metrics.totalLiveCommission).toLocaleString('fr-MA'),
                            suffix: 'MAD',
                            tone: 'warning',
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Sellers', value: metrics.totalSellers.toLocaleString('fr-MA'), sub: `${metrics.activeSellers} active` },
                            { label: 'Delivered · window', value: windowDelivered.toLocaleString('fr-MA') },
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
                                                        <UserAvatar url={s.avatar_url} config={(s as any).avatar_config} name={s.name} className="w-8 h-8 rounded-xl border border-ant-ink/5" />
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
