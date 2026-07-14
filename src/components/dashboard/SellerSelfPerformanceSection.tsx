import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Users } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { format } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { SourcePills, type SourceStat } from './performance/SourcePills';
import { UserAvatar } from '@/components/users/UserAvatar';

export interface SellerSelfPerformanceSectionProps {
    sellerId: string;
    businessId: string | null | undefined;
    dateFilter: DateFilter;
}

// D2: all figures come from seller_dashboard_stats' self_perf jsonb slice
// (mig 20260714230000) — the former business-wide orders download + the two
// parcel dumps + client commission math are retired. Labels/colors for the
// queue panes stay client-side via the cached global status masters.
type SelfPerfSlice = {
    total_in_window: number;
    assigned: number;
    confirmed: number;
    delivered: number;
    tracked: number;
    pullback: number;
    sources: Array<{ source: string; assigned: number; confirmed: number; delivered: number }>;
    pre_conf: Array<{ order_status_id: string | null; count: number }>;
    post_conf: Array<{ kind: 'pkg' | 'os' | 'unset'; id: string | null; count: number }>;
    commission_view: number | null;
    commission_client: number;
};

export function SellerSelfPerformanceSection({
    sellerId,
    businessId,
    dateFilter,
}: SellerSelfPerformanceSectionProps) {
    const {
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();

    const { data: sellerRow, isLoading: loadingSeller } = useQuery({
        queryKey: ['seller-self-performance-profile', sellerId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('users')
                .select('id, name, avatar_url, avatar_config, active')
                .eq('id', sellerId)
                .single();
            if (error) throw error;
            return data;
        },
        enabled: !!sellerId,
    });

    // Windowed self_perf slice from the role RPC (its own cache entry per
    // window; the ['dash-stats'] prefix is invalidated by EcomBizRealtime on
    // order/parcel broadcasts). The RPC validates p_seller against auth.uid().
    const fromKey = dateFilter.from ? format(dateFilter.from, 'yyyy-MM-dd') : null;
    const toKey = dateFilter.to ? format(dateFilter.to, 'yyyy-MM-dd') : null;
    const { data: selfPerf, isLoading: loadingStats } = useQuery<SelfPerfSlice | null>({
        queryKey: ['dash-stats', 'seller', businessId, sellerId, fromKey, toKey],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('seller_dashboard_stats', {
                p_business: businessId,
                p_seller: sellerId,
                p_from: fromKey,
                p_to: toKey,
            });
            if (error) throw error;
            return (data?.self_perf ?? null) as SelfPerfSlice | null;
        },
        enabled: !!sellerId && !!businessId,
        staleTime: 60_000,
    });

    const loading = loadingSeller || loadingStats;

    const metrics = useMemo(() => {
        if (!selfPerf || !sellerRow) return null;

        const assignedCount = selfPerf.assigned;
        const totalInWindow = selfPerf.total_in_window;
        const assignedPercent = totalInWindow > 0 ? (assignedCount / totalInWindow) * 100 : 0;
        const confirmedCount = selfPerf.confirmed;
        const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;
        const deliveredCount = selfPerf.delivered;
        const deliveryDenom = selfPerf.tracked - selfPerf.pullback;
        const deliveredPercent = deliveryDenom > 0 ? (deliveredCount / deliveryDenom) * 100 : 0;

        const sources: SourceStat[] = (selfPerf.sources || []).map((s) => ({
            source: s.source,
            assigned: s.assigned,
            confirmed: s.confirmed,
            delivered: s.delivered,
        }));

        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        const preConfEntries: StatusQueueEntry[] = (selfPerf.pre_conf || []).map((e) => {
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

        const postConfEntries: StatusQueueEntry[] = (selfPerf.post_conf || []).map((e) => {
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

        // Commission: seller_daily_earnings (commission_view) is the source of
        // truth; the RPC's client-formula fallback mirrors the old behavior.
        const commissionClient = selfPerf.commission_client;
        const commissionFromView = selfPerf.commission_view;
        const commission = commissionFromView ?? commissionClient;
        const commissionDrift = commissionFromView !== null && Math.abs(commissionFromView - commissionClient) > 1;

        return {
            name: sellerRow.name,
            avatar_url: sellerRow.avatar_url,
            avatar_config: (sellerRow as any).avatar_config ?? null,
            active: sellerRow.active,
            assignedCount,
            assignedPercent,
            confirmedCount,
            confirmedPercent,
            deliveredCount,
            deliveredPercent,
            sources,
            preConfEntries,
            preConfShareTotal: assignedCount - confirmedCount,
            postConfEntries,
            postConfShareTotal: confirmedCount - deliveredCount,
            commission,
            commissionClient,
            commissionDrift,
            totalInWindow,
        };
    }, [
        selfPerf,
        sellerRow,
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    ]);

    if (!sellerId) return null;

    if (loading) {
        return (
            <div className="rounded-2xl border border-ant-line bg-ant-paper p-5 animate-pulse">
                <div className="h-4 w-48 bg-ant-line rounded" />
                <div className="mt-4 h-24 bg-ant-line rounded-xl" />
            </div>
        );
    }

    if (!metrics) return null;

    const s = metrics;
    const stages: FunnelStage[] = [
        {
            key: 'assigned',
            label: 'Attribuées',
            count: s.assignedCount,
            sub: `${s.assignedPercent.toFixed(1)}% du total`,
            accent: '#141413',
            fillClass: 'bg-ant-ink/5',
        },
        {
            key: 'confirmed',
            label: 'Confirmées',
            count: s.confirmedCount,
            ratePct: s.confirmedPercent,
            accent: '#D97706',
            fillClass: 'bg-ant-orange/10',
        },
        {
            key: 'delivered',
            label: 'Livrées',
            count: s.deliveredCount,
            ratePct: s.deliveredPercent,
            accent: '#2D7A3E',
            fillClass: 'bg-ant-green/12',
        },
    ];

    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                    <Users className="w-3.5 h-3.5" strokeWidth={1.75} />
                    Votre performance
                </div>
                <span className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                    {s.totalInWindow.toLocaleString('fr-MA')} commandes{businessId ? ' · business' : ''}
                </span>
            </div>

            <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(160px,180px)_1fr_minmax(130px,160px)] items-center gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar url={s.avatar_url} config={(s as any).avatar_config} name={s.name} className="w-10 h-10 rounded-xl border border-ant-line font-display text-[14px] font-semibold" />
                        <div className="min-w-0">
                            <p className="font-display text-[13px] font-semibold text-ant-ink truncate leading-tight">{s.name || 'Vous'}</p>
                            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] mt-1 text-ant-mid">
                                <span className={`h-1.5 w-1.5 rounded-full ${sellerRow && sellerRow.active === false ? 'bg-ant-mid' : 'bg-ant-green'}`} />
                                {sellerRow && sellerRow.active === false ? 'Inactif' : 'Commercial'}
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0">
                        <PerformanceFunnel stages={stages} dense />
                    </div>

                    <div className="min-w-0 lg:border-l lg:border-ant-line lg:pl-4">
                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                            Commission
                        </div>
                        <p className="font-display text-[18px] font-semibold text-ant-green tabular-nums leading-tight mt-1">
                            {Math.round(s.commission).toLocaleString('fr-MA')}
                            <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-ant-line bg-ant-light p-4 space-y-3">
                    <div className="flex items-baseline justify-between">
                        <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            Funnel dropoff
                        </h4>
                        <span className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                            {(s.assignedCount - s.deliveredCount).toLocaleString('fr-MA')} / {s.assignedCount.toLocaleString('fr-MA')}
                        </span>
                    </div>
                    <StatusQueuePane
                        title="Avant confirmation"
                        totalLost={s.assignedCount - s.confirmedCount}
                        cohortSize={s.assignedCount}
                        entries={s.preConfEntries}
                        emptyText="Toutes les commandes confirmées"
                    />
                    <div className="h-px bg-ant-line" />
                    <StatusQueuePane
                        title="Après confirmation"
                        totalLost={s.confirmedCount - s.deliveredCount}
                        cohortSize={s.confirmedCount}
                        entries={s.postConfEntries}
                        emptyText="Toutes les commandes livrées"
                    />
                </div>

                <div className="rounded-xl border border-ant-line bg-ant-light px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid shrink-0">
                        Sources
                    </h4>
                    <div className="flex-1 min-w-[200px]">
                        <SourcePills sources={s.sources} />
                    </div>
                </div>
            </div>
        </section>
    );
}
