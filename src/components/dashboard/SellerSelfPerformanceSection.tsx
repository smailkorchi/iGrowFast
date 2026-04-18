import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useSellerCommissionTotals } from '@/hooks/useSellerCommissionTotals';
import {
    assignmentTimestampForMetrics,
    commissionAccruedForDeliveredOrder,
    isConfirmed,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';
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
        confirmedIds,
        deliveredPkgIds,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();

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
            let q = supabase
                .from('orders')
                .select(
                    'id, date, assignment_date, confirmation_date, date_livraison, updated_at, price, order_status_id, package_status_id, package_status_label, seller_id, source_name, order_items(product_id, quantity), order_statuses(code, label, category), package_statuses(label, category)'
                );
            if (businessId) {
                q = q.eq('DigiCom Business', businessId);
            } else {
                q = q.eq('seller_id', sellerId);
            }
            q = q.is('date_deleted', null);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        },
        enabled: !!sellerId,
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

        const confirmed = cohort.filter((o) => isConfirmed(o, confirmedIds));
        const confirmedCount = confirmed.length;
        const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;

        const delivered = confirmed.filter((o) => isDeliveredForCommission(o, deliveredPkgIds));
        const deliveredCount = delivered.length;
        const deliveredPercent = confirmedCount > 0 ? (deliveredCount / confirmedCount) * 100 : 0;

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
        const notYetConfirmed = cohort.filter((o) => !isConfirmed(o, confirmedIds));
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
        confirmedIds,
        deliveredPkgIds,
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
            <Card className="border-0 shadow-sm rounded-3xl">
                <CardHeader className="pb-2">
                    <div className="h-10 w-48 rounded-xl bg-gray-100 animate-pulse" />
                </CardHeader>
                <CardContent>
                    <div className="h-24 rounded-2xl bg-gray-50 animate-pulse" />
                </CardContent>
            </Card>
        );
    }

    if (!metrics) return null;

    const s = metrics;
    const stages: FunnelStage[] = [
        {
            key: 'assigned',
            label: 'Assigned',
            count: s.assignedCount,
            sub: `${s.assignedPercent.toFixed(1)}% of all`,
            accent: '#6b7280',
            fillClass: 'bg-gray-50',
        },
        {
            key: 'confirmed',
            label: 'Confirmed',
            count: s.confirmedCount,
            ratePct: s.confirmedPercent,
            accent: '#3b82f6',
            fillClass: 'bg-blue-50/70',
        },
        {
            key: 'delivered',
            label: 'Delivered',
            count: s.deliveredCount,
            ratePct: s.deliveredPercent,
            accent: '#10b981',
            fillClass: 'bg-emerald-50/70',
        },
    ];

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Performance breakdown</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Your stats &middot; {s.totalInWindow.toLocaleString('fr-MA')} orders in period
                            {businessId ? ' (business-wide)' : ''}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="grid grid-cols-[minmax(150px,180px)_1fr_minmax(140px,160px)] items-center gap-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-brand-navy/10 flex items-center justify-center text-sm font-bold text-brand-navy shrink-0">
                                {s.name?.[0] ?? '?'}
                            </div>
                        )}
                        <div className="min-w-0">
                            <p className="font-bold text-brand-navy text-sm truncate leading-tight">{s.name || 'You'}</p>
                            <p className="text-[10px] text-gray-400 uppercase tracking-[0.18em] mt-0.5">
                                {sellerRow && sellerRow.active === false ? 'Inactive' : 'Commercial'}
                            </p>
                        </div>
                    </div>

                    <div className="min-w-0">
                        <PerformanceFunnel stages={stages} />
                    </div>

                    <div className="min-w-0 border-l border-gray-100 pl-4">
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.2em]">Commission</p>
                        <p className="text-xl font-bold text-emerald-600 leading-tight tabular-nums">
                            {Math.round(s.commission).toLocaleString('fr-MA')}
                            <span className="text-[10px] text-gray-400 font-medium ml-1">MAD</span>
                        </p>
                        {s.commissionDrift && (
                            <p className="text-[9px] text-amber-600 mt-0.5">
                                client {Math.round(s.commissionClient).toLocaleString('fr-MA')}
                            </p>
                        )}
                    </div>
                </div>

                <section className="rounded-2xl bg-white border border-gray-100 p-4 space-y-4">
                    <header className="flex items-baseline justify-between">
                        <h4 className="text-[11px] font-bold text-brand-navy uppercase tracking-[0.2em]">
                            Funnel dropoff
                        </h4>
                        <span className="text-[10px] text-gray-400 tabular-nums">
                            {(s.assignedCount - s.deliveredCount).toLocaleString('fr-MA')} not delivered of {s.assignedCount.toLocaleString('fr-MA')}
                        </span>
                    </header>
                    <StatusQueuePane
                        title="Before confirmation"
                        totalLost={s.assignedCount - s.confirmedCount}
                        cohortSize={s.assignedCount}
                        entries={s.preConfEntries}
                        emptyText="All cohort orders confirmed"
                    />
                    <div className="h-px bg-gray-100" />
                    <StatusQueuePane
                        title="After confirmation"
                        totalLost={s.confirmedCount - s.deliveredCount}
                        cohortSize={s.confirmedCount}
                        entries={s.postConfEntries}
                        emptyText="All confirmed orders delivered"
                    />
                </section>

                <section className="rounded-2xl bg-white border border-gray-100 p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h4 className="text-[11px] font-bold text-brand-navy uppercase tracking-[0.2em] shrink-0">
                        Sources
                    </h4>
                    <span className="text-[10px] text-gray-400">hover for conversion</span>
                    <div className="flex-1 min-w-[220px]">
                        <SourcePills sources={s.sources} />
                    </div>
                </section>
            </CardContent>
        </Card>
    );
}
