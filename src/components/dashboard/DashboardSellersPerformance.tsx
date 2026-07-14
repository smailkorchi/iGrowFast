import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Users, ChevronDown } from 'lucide-react';
import { useStatusCategories } from '@/hooks/useStatusCategories';

import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { SourcePills, type SourceStat } from './performance/SourcePills';
import { FinancialsWaterfall } from './performance/FinancialsWaterfall';
import { UserAvatar } from '@/components/users/UserAvatar';

/**
 * `sellers_performance` section of admin_dashboard_stats (D2). Per-seller
 * cohort (assignment_date ?? date window, exchange legs excluded), funnel
 * counts, dropoff groupings, financials (full pureRevenue chain, snapshot-first
 * COGS, start-date-in-window ads share) and commission (seller_daily_earnings
 * windowed Σ as source of truth + the client-formula fallback for the drift
 * indicator) are all computed server-side. Rows are sorted delivered desc.
 * Only seller names/avatars (support query below) and status labels/colors
 * (5-min cached masters) stay client-side.
 */
export interface SellersPerformanceSection {
    total_in_window: number;
    sellers: Array<{
        seller_id: string;
        assigned: number;
        confirmed: number;
        delivered: number;
        tracked: number;
        pullback: number;
        sources: Array<{ source: string; assigned: number; confirmed: number; delivered: number }>;
        pre_conf: Array<{ order_status_id: string | null; count: number }>;
        post_conf: Array<{ kind: 'pkg' | 'os' | 'unset'; id: string | null; count: number }>;
        revenue: number;
        cogs: number;
        shipping: number;
        ads_share: number;
        commission_view: number | null;
        commission_client: number;
        net: number;
    }>;
}

interface DashboardSellersPerformanceProps {
    businessId: string;
    stats: SellersPerformanceSection | undefined;
}

type DSSeller = {
    id: string;
    name: string;
    avatar_url: string | null;
    avatar_config: unknown | null;
    active: boolean | null;
};

export const DashboardSellersPerformance = ({ businessId, stats }: DashboardSellersPerformanceProps) => {
    const [expandedSellers, setExpandedSellers] = useState<Set<string>>(new Set());
    const {
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();

    const toggleSeller = (id: string) => {
        setExpandedSellers((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Names/avatars only — every aggregate rides the RPC section.
    const { data: sellers } = useQuery({
        queryKey: ['dashboard-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, avatar_config, active')
                .eq('role', 'commercial')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!sellers || !stats) return null;

        const sellerMetaById = new Map(
            (sellers as unknown as DSSeller[]).map((s) => [s.id, s]),
        );

        // Status-id lookup for naming pills in the live-queue panes
        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        const totalInWindow = stats.total_in_window;

        // RPC rows are already sorted deliveredCount desc.
        const sellerData = stats.sellers.map((row) => {
            const meta = sellerMetaById.get(row.seller_id);

            const assignedCount = row.assigned;
            const assignedPercent = totalInWindow > 0 ? (assignedCount / totalInWindow) * 100 : 0;
            const confirmedCount = row.confirmed;
            // Rate denominator = full cohort (every order in the window).
            const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;
            const deliveredCount = row.delivered;
            // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
            const deliveryDenom = row.tracked - row.pullback;
            const deliveredPercent = deliveryDenom > 0 ? (deliveredCount / deliveryDenom) * 100 : 0;

            const sources: SourceStat[] = row.sources.map((s) => ({
                source: s.source,
                assigned: s.assigned,
                confirmed: s.confirmed,
                delivered: s.delivered,
            }));

            // Pre-confirmation bucket = cohort orders NOT YET confirmed, one pill
            // per current order_status (null grouped as "Unset"). Sum of pills
            // always equals assignedCount - confirmedCount.
            const preConfEntries: StatusQueueEntry[] = row.pre_conf.map((e) => {
                if (!e.order_status_id) {
                    return { id: '__unset__', label: 'Unset (no status)', count: e.count, color: '#9ca3af' };
                }
                const status = orderStatusById.get(e.order_status_id);
                return {
                    id: e.order_status_id,
                    label: status?.label || 'Unknown status',
                    count: e.count,
                    color: getOrderStatusColor(e.order_status_id),
                };
            });

            // Post-confirmation bucket = confirmed orders NOT YET delivered,
            // bucketed by package_status (fallback order_status). Namespaced keys
            // keep the two kinds from colliding.
            const postConfEntries: StatusQueueEntry[] = row.post_conf.map((e) => {
                if (e.kind === 'unset' || !e.id) {
                    return { id: 'unset', label: 'Unset (no status)', count: e.count, color: '#9ca3af' };
                }
                if (e.kind === 'pkg') {
                    const status = packageStatusById.get(e.id);
                    return {
                        id: `pkg:${e.id}`,
                        label: status?.label || 'Unknown package status',
                        count: e.count,
                        color: getPkgStatusColor(e.id),
                    };
                }
                const status = orderStatusById.get(e.id);
                return {
                    id: `os:${e.id}`,
                    label: status?.label || 'Unknown status',
                    count: e.count,
                    color: getOrderStatusColor(e.id),
                };
            });

            // Commission: view is source of truth; client-formula value used for
            // the drift indicator (both computed server-side).
            const commission = row.commission_view ?? row.commission_client;
            const commissionDrift =
                row.commission_view !== null
                && Math.abs(row.commission_view - row.commission_client) > 1;

            return {
                id: row.seller_id,
                name: meta?.name || 'Unknown seller',
                avatar_url: meta?.avatar_url ?? null,
                avatar_config: meta?.avatar_config ?? null,
                active: meta?.active ?? null,
                assignedCount,
                assignedPercent,
                confirmedCount,
                confirmedPercent,
                deliveredCount,
                deliveredPercent,
                sources,
                preConfEntries,
                postConfEntries,
                revenue: row.revenue,
                cogs: row.cogs,
                shipping: row.shipping,
                adsShare: row.ads_share,
                commission,
                commissionClient: row.commission_client,
                commissionDrift,
                netResult: row.net,
            };
        });

        return { sellerData, totalInWindow };
    }, [
        sellers,
        stats,
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    ]);

    if (!metrics) return null;

    return (
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">Sellers performance</CardTitle>
                        <Users className="hidden" />
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums">
                        {metrics.sellerData.length} sellers · {metrics.totalInWindow.toLocaleString('fr-MA')} orders
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                {metrics.sellerData.map((s) => {
                    const isExpanded = expandedSellers.has(s.id);
                    const stages: FunnelStage[] = [
                        {
                            key: 'assigned',
                            label: 'Assigned',
                            count: s.assignedCount,
                            sub: `${s.assignedPercent.toFixed(1)}% of all`,
                            accent: '#141413',
                            fillClass: 'bg-ant-ink/5',
                        },
                        {
                            key: 'confirmed',
                            label: 'Confirmed',
                            count: s.confirmedCount,
                            ratePct: s.confirmedPercent,
                            accent: '#D97706',
                            fillClass: 'bg-ant-orange/10',
                        },
                        {
                            key: 'delivered',
                            label: 'Delivered',
                            count: s.deliveredCount,
                            ratePct: s.deliveredPercent,
                            accent: '#2D7A3E',
                            fillClass: 'bg-ant-green/12',
                        },
                    ];

                    return (
                        <div
                            key={s.id}
                            className={cn(
                                'border rounded-xl overflow-hidden transition-colors bg-ant-paper',
                                isExpanded ? 'border-ant-ink/20' : 'border-ant-line',
                            )}
                        >
                            <SellerHeaderRow
                                seller={s}
                                stages={stages}
                                isExpanded={isExpanded}
                                onToggle={() => toggleSeller(s.id)}
                            />

                            {isExpanded && (
                                <div className="px-3 pb-3 pt-2 border-t border-ant-line bg-ant-light space-y-2">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr,1fr] gap-2">
                                        <section className="rounded-lg bg-ant-paper border border-ant-line p-3 space-y-3">
                                            <header className="flex items-baseline justify-between">
                                                <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                                    Funnel dropoff
                                                </h4>
                                                <span className="text-[10px] text-ant-mid tabular-nums">
                                                    {(s.assignedCount - s.deliveredCount).toLocaleString('fr-MA')} / {s.assignedCount.toLocaleString('fr-MA')}
                                                </span>
                                            </header>
                                            <StatusQueuePane
                                                title="Before confirmation"
                                                totalLost={s.assignedCount - s.confirmedCount}
                                                cohortSize={s.assignedCount}
                                                entries={s.preConfEntries}
                                                emptyText="All cohort orders confirmed"
                                            />
                                            <div className="h-px bg-ant-line" />
                                            <StatusQueuePane
                                                title="After confirmation"
                                                totalLost={s.confirmedCount - s.deliveredCount}
                                                cohortSize={s.confirmedCount}
                                                entries={s.postConfEntries}
                                                emptyText="All confirmed orders delivered"
                                            />
                                        </section>

                                        <section className="rounded-lg bg-ant-paper border border-ant-line p-3 space-y-2">
                                            <header className="flex items-baseline justify-between">
                                                <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                                    Financials
                                                </h4>
                                                <span className="text-[10px] text-ant-mid tabular-nums">
                                                    on {s.deliveredCount.toLocaleString('fr-MA')} delivered
                                                </span>
                                            </header>
                                            <FinancialsWaterfall
                                                revenue={s.revenue}
                                                cogs={s.cogs}
                                                adsShare={s.adsShare}
                                                commission={s.commission}
                                                shipping={s.shipping}
                                                net={s.netResult}
                                            />
                                        </section>
                                    </div>

                                    <section className="rounded-lg bg-ant-paper border border-ant-line px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                        <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em] shrink-0">
                                            Sources
                                        </h4>
                                        <div className="flex-1 min-w-[200px]">
                                            <SourcePills sources={s.sources} />
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    );
                })}
                {metrics.sellerData.length === 0 && (
                    <p className="text-center py-8 font-serif-display text-ant-muted text-xs italic">No sellers found</p>
                )}
            </CardContent>
        </Card>
    );
};

interface SellerRow {
    id: string;
    name: string;
    avatar_url: string | null;
    avatar_config: unknown | null;
    active: boolean | null;
    netResult: number;
    commission: number;
    commissionClient: number;
    commissionDrift: boolean;
    deliveredCount: number;
}

function SellerHeaderRow({
    seller,
    stages,
    isExpanded,
    onToggle,
}: {
    seller: SellerRow;
    stages: FunnelStage[];
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const netPositive = seller.netResult >= 0;
    return (
        <button
            type="button"
            onClick={onToggle}
            className="w-full grid grid-cols-[minmax(120px,140px)_1fr_minmax(100px,120px)_14px] items-center gap-3 px-3 py-2 hover:bg-ant-line-soft transition-colors text-left"
        >
            <div className="flex items-center gap-2 min-w-0">
                <UserAvatar url={seller.avatar_url} config={(seller as any).avatar_config} name={seller.name} className="w-7 h-7 rounded-full text-[11px] font-semibold" />
                <div className="min-w-0">
                    <p className="font-semibold text-ant-ink text-[11.5px] truncate leading-tight">{seller.name}</p>
                    <p className="text-[9px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">
                        {seller.active === false ? 'Inactive' : 'Commercial'}
                    </p>
                </div>
            </div>

            <div className="min-w-0">
                <PerformanceFunnel stages={stages} dense />
            </div>

            <div className="min-w-0 border-l border-ant-line pl-3">
                <p className="text-[9px] text-ant-mid font-medium uppercase tracking-[0.2em]">Net</p>
                <p
                    className={cn(
                        'font-display text-[14px] font-semibold leading-tight tabular-nums tracking-[-0.02em]',
                        netPositive ? 'text-ant-green' : 'text-ant-rose',
                    )}
                >
                    {Math.round(seller.netResult).toLocaleString('fr-MA')}
                    <span className="text-[9px] text-ant-mid font-medium ml-0.5">MAD</span>
                </p>
                <p className="text-[9px] text-ant-mid mt-0.5 flex items-center gap-0.5">
                    <span className="tabular-nums">{Math.round(seller.commission).toLocaleString('fr-MA')} comm</span>
                </p>
            </div>

            <ChevronDown
                className={cn(
                    'w-3.5 h-3.5 text-ant-mid transition-transform justify-self-end',
                    isExpanded && 'rotate-180 text-ant-ink',
                )}
            />
        </button>
    );
}
