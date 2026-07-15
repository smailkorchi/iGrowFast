import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Radar } from 'lucide-react';
import { UserAvatar } from '@/components/users/UserAvatar';

/**
 * `mediabuyers` section of admin_analytics_stats (D3). Server-side: the
 * (Casablanca placement day, normalized source) buckets over windowed
 * replace-excluded orders — leads, delivered, revenue (full pureRevenue chain,
 * delivered but NOT paid-gated), COGS, shipping and seller commission — the
 * per-MB attribution (key = campaign_daily_entries.created_by; a bucket claimed
 * by N roster MBs is split 1/N), spend, and MB cost (commission → rate ×
 * attributed delivered; salaried → salary × window_days/30). Rows arrive sorted
 * net_profit desc.
 *
 * Replicated deviations (deliberate, parity-first): MB COGS uses the CURRENT
 * products.cost_price only — no product_unit_cost_snapshot — so this section's
 * COGS will not reconcile with the P&L's snapshot-first COGS; the MB-cost model
 * (roster payment_type) also differs from ProfitabilitySection's
 * mediabuyer_payments × payout-month overlap. Both are pre-existing and were
 * flagged for a separate unification decision.
 *
 * Client keeps only presentation: names/avatars (support query below — the RPC
 * rows carry ids), the totals Σ over the already-shared per-MB rows (no double
 * counting) and the ROAS arithmetic.
 */
export interface MediaBuyersSlice {
    window_days: number;
    mediabuyers: Array<{
        mb_id: string;
        spend: number;
        /** Fractional — attribution shares split a bucket 1/N across claimants. */
        orders: number;
        delivered: number;
        revenue: number;
        cogs: number;
        shipping: number;
        seller_commission: number;
        mb_cost: number;
        net_profit: number;
    }>;
}

interface MediaBuyersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: MediaBuyersSlice | null;
}

type MBMeta = {
    id: string;
    name: string;
    avatar_url: string | null;
    avatar_config?: unknown;
    active: boolean | null;
};

export const MediaBuyersSection = ({ businessId, stats }: MediaBuyersSectionProps) => {
    // Names/avatars only — every aggregate (including MB cost, which reads
    // payment_type/commission_price/salary_amount) rides the RPC section.
    const { data: mediaBuyers, isLoading } = useQuery({
        queryKey: ['analytics-mediabuyers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, avatar_config, active')
                .eq('role', 'mediabuyer')
                .eq('DigiCom Business', businessId);
            return (data || []) as unknown as MBMeta[];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!mediaBuyers || !stats) return null;

        const metaById = new Map(mediaBuyers.map((m) => [m.id, m]));

        // Rows are already sorted netProfit desc by the RPC and already carry
        // their proportional share of each (day, platform) bucket.
        const perMB = stats.mediabuyers.map((row) => {
            const meta = metaById.get(row.mb_id);
            return {
                id: row.mb_id,
                name: meta?.name || 'Unnamed',
                avatar_url: meta?.avatar_url ?? null,
                avatar_config: meta?.avatar_config ?? null,
                active: meta?.active ?? null,
                spend: row.spend,
                attributedOrders: row.orders,
                attributedDelivered: row.delivered,
                revenue: row.revenue,
                cogs: row.cogs,
                shipping: row.shipping,
                sellerCommission: row.seller_commission,
                mbCost: row.mb_cost,
                netProfit: row.net_profit,
                roas: row.spend > 0 ? row.revenue / row.spend : 0,
            };
        });

        // Totals are Σ over the post-share rows — no double counting.
        const totalSpend = perMB.reduce((s, m) => s + m.spend, 0);
        const totalRevenue = perMB.reduce((s, m) => s + m.revenue, 0);
        const totalCogs = perMB.reduce((s, m) => s + m.cogs, 0);
        const totalShipping = perMB.reduce((s, m) => s + m.shipping, 0);
        const totalSellerCommission = perMB.reduce((s, m) => s + m.sellerCommission, 0);
        const totalMbCost = perMB.reduce((s, m) => s + m.mbCost, 0);
        const totalNetProfit = perMB.reduce((s, m) => s + m.netProfit, 0);
        const totalDelivered = perMB.reduce((s, m) => s + m.attributedDelivered, 0);

        return {
            perMB,
            // Roster-shaped facts: the RPC rows carry no active flag, and the
            // array is roster-complete, so both counts come off the meta query.
            totalMBs: mediaBuyers.length,
            activeMBs: mediaBuyers.filter((m) => m.active !== false).length,
            totalSpend,
            totalRevenue,
            totalCogs,
            totalShipping,
            totalSellerCommission,
            totalMbCost,
            totalNetProfit,
            totalDelivered,
            overallRoas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
            top: perMB[0],
        };
    }, [mediaBuyers, stats]);

    return (
        <SectionWrapper
            id="mediabuyers"
            title="Media Buyers"
            description="Attributed revenue, all-in costs, and net profit per media buyer"
            icon={Radar}
            iconColor="text-ant-mid"
            loading={isLoading || !stats}
        >
            {metrics && (() => {
                const profitTone: 'positive' | 'warning' | 'negative' =
                    metrics.totalNetProfit > 0 ? 'positive' : metrics.totalNetProfit === 0 ? 'warning' : 'negative';
                const narrative = metrics.totalMBs === 0
                    ? 'No media buyers on the team yet.'
                    : metrics.totalSpend === 0
                        ? `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} on roster, but no ad spend logged in this period.`
                        : metrics.totalNetProfit >= 0
                            ? `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} drove ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD in attributed revenue on ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD spend (${metrics.overallRoas.toFixed(2)}x ROAS), netting ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD after COGS, shipping, seller commission, and buyer cost.${
                                  metrics.top ? ` ${metrics.top.name} leads with ${Math.round(metrics.top.netProfit).toLocaleString('fr-MA')} MAD net.` : ''
                              }`
                            : `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} spent ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD and returned ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD (${metrics.overallRoas.toFixed(2)}x ROAS), but net is ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD once COGS, shipping, seller commission, and buyer cost are removed. Campaigns need review.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'net profit',
                            value: `${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD`,
                            tone: profitTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Spend', value: `${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD`, tone: 'negative' },
                            { label: 'Revenue', value: `${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD`, tone: 'positive' },
                            { label: 'COGS + shipping', value: `${Math.round(metrics.totalCogs + metrics.totalShipping).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'Seller comm.', value: `${Math.round(metrics.totalSellerCommission).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'Buyer cost', value: `${Math.round(metrics.totalMbCost).toLocaleString('fr-MA')} MAD`, tone: 'warning', sub: 'commission + pro-rated salary' },
                            { label: 'ROAS', value: `${metrics.overallRoas.toFixed(2)}x`, tone: metrics.overallRoas >= 2 ? 'positive' : metrics.overallRoas >= 1 ? 'warning' : 'negative' },
                        ]}
                    >
                        {metrics.perMB.length > 0 && (
                            <Card className="border border-ant-line shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-ant-ink">Media buyer leaderboard</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-ant-line">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Buyer</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Spend</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Delivered</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Revenue</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">COGS + ship</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Seller comm.</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Buyer cost</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">ROAS</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Net profit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.perMB.map((m) => {
                                                    const roasTone =
                                                        m.roas >= 2 ? 'text-ant-green' : m.roas >= 1 ? 'text-ant-orange' : 'text-ant-rose';
                                                    const netTone = m.netProfit > 0 ? 'text-ant-green' : m.netProfit === 0 ? 'text-ant-muted' : 'text-ant-rose';
                                                    return (
                                                        <tr key={m.id} className="border-b border-ant-line hover:bg-ant-ink/[0.02] transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    <UserAvatar url={m.avatar_url} config={(m as any).avatar_config} name={m.name} className="w-6 h-6 rounded-full border border-ant-ink/5" />
                                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{m.name || 'Unnamed'}</span>
                                                                    {m.active === false && (
                                                                        <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-ant-rose">· inactive</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.spend).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{Math.round(m.attributedDelivered)}</td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-ant-green tabular-nums">
                                                                {Math.round(m.revenue).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.cogs + m.shipping).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.sellerCommission).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.mbCost).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${roasTone}`}>
                                                                {m.roas.toFixed(2)}x
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${netTone}`}>
                                                                {Math.round(m.netProfit).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
