import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { Users } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useSellerCommissionTotals } from '@/hooks/useSellerCommissionTotals';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import {
    assignmentTimestampForMetrics,
    commissionAccruedForDeliveredOrder,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { SourcePills, type SourceStat } from './performance/SourcePills';

export interface SellerSelfPerformanceSectionProps {
    sellerId: string;
    businessId: string | null | undefined;
    dateFilter: DateFilter;
}

// Types verified against public.{orders, order_items, order_statuses, package_statuses, users} via MCP
type SSPOrderItem = { product_id: string; quantity: number };
type SSPOrder = {
    id: string;
    date: string | null;
    assignment_date: string | null;
    confirmation_date: string | null;
    date_livraison: string | null;
    updated_at: string | null;
    price: number | null;
    order_status_id: string | null;
    package_status_id: string | null;
    package_status_label: string | null;
    tracking_number: string | null;
    seller_id: string | null;
    source_name: string | null;
    order_items: SSPOrderItem[] | null;
    order_statuses: { code: string; label: string; category: string } | null;
    package_statuses: { label: string; category: string } | null;
};

export function SellerSelfPerformanceSection({
    sellerId,
    businessId,
    dateFilter,
}: SellerSelfPerformanceSectionProps) {
    const {
        orderStatuses,
        packageStatuses,
        deliveredPkgIds,
        pendingIds,
        adminPullbackOrderIds,
        adminPullbackPackageIds,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(businessId ?? null);

    const { data: sellerRow, isLoading: loadingSeller } = useQuery({
        queryKey: ['seller-self-performance-profile', sellerId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('users')
                .select('id, name, avatar_url, active, commission_price, commission_basis, products')
                .eq('id', sellerId)
                .single();
            if (error) throw error;
            return data;
        },
        enabled: !!sellerId,
    });

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['seller-self-performance-orders', businessId || 'no-biz', sellerId],
        queryFn: async () => {
            // Paginated (fetchAllRows) so we never silently truncate at PostgREST's
            // 1000-row default — that cap dropped a high-volume seller's newest
            // orders and undercounted delivered/attributed/confirmed counts.
            const filters: { column: string; op: 'eq' | 'neq' | 'is'; value: unknown }[] = [
                businessId
                    ? { column: 'DigiCom Business', op: 'eq', value: businessId }
                    : { column: 'seller_id', op: 'eq', value: sellerId },
                { column: 'date_deleted', op: 'is', value: null },
                { column: 'source_review_status', op: 'neq', value: 'pending' },
            ];
            return await fetchAllRows(
                'orders',
                'id, date, assignment_date, confirmation_date, date_livraison, updated_at, price, order_status_id, package_status_id, package_status_label, tracking_number, seller_id, source_name, order_items(product_id, quantity), order_statuses(code, label, category), package_statuses(label, category)',
                { filters },
            );
        },
        enabled: !!sellerId,
        // Always refetch on mount so the seller and admin dashboards can't drift
        // apart on any order that changed status between loads.
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const { data: commissionTotals } = useSellerCommissionTotals(
        businessId || null,
        dateFilter.from,
        dateFilter.to,
    );

    const loading = loadingSeller || loadingOrders;
    const commissionBasis: CommissionBasis = normalizeCommissionBasis(sellerRow?.commission_basis);
    const commissionPrice = Number(sellerRow?.commission_price ?? 0) || 0;

    const metrics = useMemo(() => {
        if (!orders || !sellerRow) return null;

        const attributedProducts: string[] = Array.isArray(sellerRow.products)
            ? (sellerRow.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
            : [];

        const withinWindow = (d: Date | null) => {
            if (!d) return false;
            if (!dateFilter.from && !dateFilter.to) return true;
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const inCohortWindow = (o: SSPOrder) => withinWindow(assignmentTimestampForMetrics(o));
        const inCreateWindow = (o: SSPOrder) => {
            if (!o.date) return false;
            const d = new Date(o.date);
            return Number.isNaN(d.getTime()) ? false : withinWindow(d);
        };

        const ordersTyped = orders as unknown as SSPOrder[];
        const totalInWindow = ordersTyped.filter(inCreateWindow).length;

        // Cohort-walk-forward: assigned defines the cohort, confirmed/delivered are strict
        // subsets, so funnel stages always reconcile.
        const sellerOrders = ordersTyped.filter((o) => o.seller_id === sellerId);
        const cohort = sellerOrders.filter(inCohortWindow);
        const assignedCount = cohort.length;
        const assignedPercent = totalInWindow > 0 ? (assignedCount / totalInWindow) * 100 : 0;

        // Confirmed = status NOT in pending ({new, postponed}) OR has tracking.
        // Empty-set guard: see DashboardSellersPerformance for the explanation.
        const hasTracking = (o: SSPOrder) => !!o.id && trackedOrderIds.has(o.id);
        const statusMapsReady = pendingIds.size > 0;
        const confirmed = cohort.filter((o) =>
            hasTracking(o)
            || (statusMapsReady
                && !!o.order_status_id
                && !pendingIds.has(o.order_status_id)),
        );
        const confirmedCount = confirmed.length;

        // Rate denominator = full cohort (no "touched" exclusion).
        const confirmedPercent = cohort.length > 0 ? (confirmedCount / cohort.length) * 100 : 0;

        // Delivered = package state is delivered. Computed directly from the
        // cohort so it is independent of the confirmed set.
        const delivered = cohort.filter((o) => isDeliveredForCommission(o, deliveredPkgIds));
        const deliveredCount = delivered.length;

        // Delivery rate (Coliaty formula):
        //   delivered ÷ (tracked − admin-pullback)
        // Tracked = order has a tracking_code in company_parcels or courier_parcels.
        // Admin-pullback = tracked AND flagged fake/double/blacklisted/cancelled
        //   at order level, OR Hors-zone/Annulé at package level.
        const tracked = cohort.filter((o) => !!o.id && trackedOrderIds.has(o.id));
        const pullback = tracked.filter((o) =>
            isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
        );
        const deliveryDenom = tracked.length - pullback.length;
        const deliveredPercent = deliveryDenom > 0 ? (deliveredCount / deliveryDenom) * 100 : 0;

        const sourceAgg = new Map<string, { assigned: number; confirmed: number; delivered: number }>();
        const bump = (src: string, k: 'assigned' | 'confirmed' | 'delivered') => {
            const row = sourceAgg.get(src) || { assigned: 0, confirmed: 0, delivered: 0 };
            row[k] += 1;
            sourceAgg.set(src, row);
        };
        cohort.forEach((o) => bump((o.source_name || 'other').toLowerCase(), 'assigned'));
        confirmed.forEach((o) => bump((o.source_name || 'other').toLowerCase(), 'confirmed'));
        delivered.forEach((o) => bump((o.source_name || 'other').toLowerCase(), 'delivered'));
        const sources: SourceStat[] = Array.from(sourceAgg, ([source, v]) => ({ source, ...v }));

        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        // Pre-conf pane: one pill per distinct current order_status in the not-yet-confirmed
        // subset of the cohort. Sum always equals assignedCount - confirmedCount.
        // Uses the same one-true-definition as the count/rate above.
        const confirmedIdSet = new Set(confirmed.map((o) => o.id));
        const notYetConfirmed = cohort.filter((o) => !confirmedIdSet.has(o.id));
        const preConfShareTotal = notYetConfirmed.length;
        const preCountByStatus = new Map<string | null, number>();
        notYetConfirmed.forEach((o) => {
            preCountByStatus.set(o.order_status_id, (preCountByStatus.get(o.order_status_id) || 0) + 1);
        });
        const preConfEntries: StatusQueueEntry[] = Array.from(preCountByStatus, ([sid, count]) => {
            if (!sid) {
                return { id: '__unset__', label: 'Unset (no status)', count, color: '#9ca3af' };
            }
            const status = orderStatusById.get(sid);
            return {
                id: sid,
                label: status?.label || 'Unknown status',
                count,
                color: getOrderStatusColor(sid),
            };
        });

        // Post-conf pane: one pill per distinct current package_status in the not-yet-delivered
        // subset of the confirmed orders. Sum always equals confirmedCount - deliveredCount.
        const notYetDelivered = confirmed.filter((o) => !isDeliveredForCommission(o, deliveredPkgIds));
        const postConfShareTotal = notYetDelivered.length;
        // Bucket by package_status if set, otherwise by the confirmed order_status so the
        // actual sub-state (Paid, Unpaid, Processed, etc.) is visible.
        const postCountByStatus = new Map<string, number>();
        notYetDelivered.forEach((o) => {
            const key = o.package_status_id
                ? `pkg:${o.package_status_id}`
                : o.order_status_id
                    ? `os:${o.order_status_id}`
                    : 'unset';
            postCountByStatus.set(key, (postCountByStatus.get(key) || 0) + 1);
        });
        const postConfEntries: StatusQueueEntry[] = Array.from(postCountByStatus, ([key, count]) => {
            if (key === 'unset') {
                return { id: 'unset', label: 'Unset (no status)', count, color: '#9ca3af' };
            }
            if (key.startsWith('pkg:')) {
                const sid = key.slice(4);
                const status = packageStatusById.get(sid);
                return {
                    id: key,
                    label: status?.label || 'Unknown package status',
                    count,
                    color: getPkgStatusColor(sid),
                };
            }
            const sid = key.slice(3);
            const status = orderStatusById.get(sid);
            return {
                id: key,
                label: status?.label || 'Unknown status',
                count,
                color: getOrderStatusColor(sid),
            };
        });

        // Commission: seller_daily_earnings is the source of truth (payouts match this)
        const commissionClient = delivered.reduce(
            (s, o) =>
                s +
                commissionAccruedForDeliveredOrder({
                    order: o as unknown as Parameters<typeof commissionAccruedForDeliveredOrder>[0]['order'],
                    basis: commissionBasis,
                    commissionPrice,
                    sellerProductIds: attributedProducts,
                }),
            0,
        );
        const commissionFromView = commissionTotals?.totals.get(sellerId) ?? null;
        const commission = commissionFromView ?? commissionClient;
        const commissionDrift = commissionFromView !== null && Math.abs(commissionFromView - commissionClient) > 1;

        return {
            name: sellerRow.name,
            avatar_url: sellerRow.avatar_url,
            active: sellerRow.active,
            assignedCount,
            assignedPercent,
            confirmedCount,
            confirmedPercent,
            deliveredCount,
            deliveredPercent,
            sources,
            preConfEntries,
            preConfShareTotal,
            postConfEntries,
            postConfShareTotal,
            commission,
            commissionClient,
            commissionDrift,
            totalInWindow,
        };
    }, [
        orders,
        sellerRow,
        sellerId,
        dateFilter,
        deliveredPkgIds,
        pendingIds,
        adminPullbackOrderIds,
        adminPullbackPackageIds,
        trackedOrderIds,
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
        commissionBasis,
        commissionPrice,
        commissionTotals,
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
                        {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" className="w-10 h-10 rounded-xl object-cover border border-ant-line shrink-0" />
                        ) : (
                            <div className="w-10 h-10 rounded-xl border border-ant-line bg-ant-light text-ant-ink flex items-center justify-center font-display text-[14px] font-semibold shrink-0">
                                {s.name?.[0] ?? '?'}
                            </div>
                        )}
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
                        {s.commissionDrift && (
                            <p className="font-serif italic text-[11px] text-ant-orange mt-0.5 tabular-nums">
                                client {Math.round(s.commissionClient).toLocaleString('fr-MA')} MAD
                            </p>
                        )}
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
