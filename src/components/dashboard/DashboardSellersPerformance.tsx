import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Users, ChevronDown, AlertTriangle } from 'lucide-react';
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { SourcePills, type SourceStat } from './performance/SourcePills';
import { FinancialsWaterfall } from './performance/FinancialsWaterfall';

interface DashboardSellersPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

// Types verified against public.{orders, order_items, order_statuses, package_statuses, users, ads_history} via MCP
type DSOrderItem = {
    product_id: string;
    quantity: number;
    unit_price: number;
    total_price: number | null;
    accessory_id: string | null;
    accessory_quantity: number | null;
};
type DSOrderStatusJoin = { code: string; label: string; category: string } | null;
type DSPackageStatusJoin = { label: string; category: string } | null;
type DSOrder = {
    id: string;
    date: string | null;
    assignment_date: string | null;
    confirmation_date: string | null;
    date_livraison: string | null;
    updated_at: string | null;
    price: number | null;
    raw_price: number | null;
    shipping_cost: number | null;
    include_delivery_in_total: boolean;
    order_status_id: string | null;
    package_status_id: string | null;
    package_status_label: string | null;
    tracking_number: string | null;
    seller_id: string | null;
    company_id: string | null;
    source_name: string | null;
    order_items: DSOrderItem[] | null;
    order_statuses: DSOrderStatusJoin;
    package_statuses: DSPackageStatusJoin;
};
type DSSeller = {
    id: string;
    name: string;
    avatar_url: string | null;
    active: boolean | null;
    commission_price: number | null;
    commission_basis: string;
    products: unknown;
};
type DSAd = { product_id: string | null; amount: number; start_date: string };
type DSProduct = { id: string; cost_price: number | null };
type DSAccessory = { id: string; cost_price: number | null };

/** Product-line revenue only (no shipping). Uses line totals; falls back to raw_price or price − shipping. */
function productRevenueExcludingShipping(o: DSOrder): number {
    const items = o.order_items || [];
    let sum = 0;
    for (const oi of items) {
        if (!oi?.product_id) continue;
        const q = Number(oi.quantity || 1);
        sum += Number(oi.total_price || 0) || Number(oi.unit_price || 0) * q;
    }
    if (sum > 0) return sum;
    const raw = Number(o.raw_price);
    if (raw > 0) return raw;
    const p = Number(o.price || 0);
    const ship = Number(o.shipping_cost || 0);
    if (o.include_delivery_in_total === false) return p;
    return Math.max(0, p - ship);
}

export const DashboardSellersPerformance = ({ businessId, dateFilter }: DashboardSellersPerformanceProps) => {
    const [expandedSellers, setExpandedSellers] = useState<Set<string>>(new Set());
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
    const { trackedOrderIds } = useTrackedOrders(businessId);

    const toggleSeller = (id: string) => {
        setExpandedSellers((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const { data: sellers } = useQuery({
        queryKey: ['dashboard-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, active, commission_price, commission_basis, products')
                .eq('role', 'commercial')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orders } = useQuery({
        queryKey: ['dashboard-sellers-performance-orders', businessId],
        queryFn: async () => {
            // Paginated so we never truncate at the 1000-row default cap.
            return await fetchAllRows(
                'orders',
                'id, date, assignment_date, confirmation_date, date_livraison, updated_at, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, package_status_label, tracking_number, seller_id, company_id, source_name, order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot), order_statuses(code, label, category), package_statuses(label, category)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
        },
        enabled: !!businessId,
        // Always refetch on mount so the seller and admin dashboards can't drift
        // apart on any order that changed status between loads.
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const { data: adsHistory } = useQuery({
        queryKey: ['dashboard-ads-history', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('ads_history')
                .select('id, product_id, amount, start_date, end_date')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

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

    const { data: accessories } = useQuery({
        queryKey: ['dashboard-accessories', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('accessories')
                .select('id, cost_price')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: commissionTotals } = useSellerCommissionTotals(
        businessId,
        dateFilter.from,
        dateFilter.to,
    );

    const metrics = useMemo(() => {
        if (!sellers || !orders) return null;

        const withinWindow = (d: Date | null) => {
            if (!d) return false;
            if (!dateFilter.from && !dateFilter.to) return true;
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const inCohortWindow = (o: DSOrder) => withinWindow(assignmentTimestampForMetrics(o));
        const inCreateWindow = (o: DSOrder) => {
            if (!o.date) return false;
            const d = new Date(o.date);
            return Number.isNaN(d.getTime()) ? false : withinWindow(d);
        };

        const ordersTyped = orders as unknown as DSOrder[];
        const totalInWindow = ordersTyped.filter(inCreateWindow).length;

        // Ads restricted to window + business
        const filteredAds = ((adsHistory || []) as unknown as DSAd[]).filter((a) => {
            if (!a.start_date) return false;
            const d = new Date(a.start_date);
            return withinWindow(d);
        });
        const adsByProduct = new Map<string, number>();
        filteredAds.forEach((a) => {
            if (a.product_id) {
                adsByProduct.set(a.product_id, (adsByProduct.get(a.product_id) || 0) + Number(a.amount || 0));
            }
        });

        // Product cost lookup
        const productCost = new Map<string, number>();
        (products as unknown as DSProduct[] | undefined)?.forEach((p) => {
            productCost.set(p.id, Number(p.cost_price || 0));
        });
        const accessoryCost = new Map<string, number>();
        (accessories as unknown as DSAccessory[] | undefined)?.forEach((a) => {
            accessoryCost.set(a.id, Number(a.cost_price || 0));
        });

        // Status-id lookup for naming pills in the live-queue panes
        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        // Global cohort-delivered qty per product for ads share denominator
        const globalDeliveredQty = new Map<string, number>();
        ordersTyped.forEach((o) => {
            if (!inCohortWindow(o)) return;
            if (!isDeliveredForCommission(o, deliveredPkgIds)) return;
            for (const oi of o.order_items || []) {
                if (!oi?.product_id) continue;
                globalDeliveredQty.set(
                    oi.product_id,
                    (globalDeliveredQty.get(oi.product_id) || 0) + Number(oi.quantity || 1),
                );
            }
        });

        const sellersTyped = sellers as unknown as DSSeller[];
        const sellerData = sellersTyped.map((seller) => {
            const sellerOrders = ordersTyped.filter((o) => o.seller_id === seller.id);

            // Cohort = orders assigned to this seller, anchored in window by assignment_date
            // (fallback orders.date). Confirmed/delivered are strict subsets of cohort so the
            // funnel always reconciles: assigned = confirmed + not-confirmed-yet (which is
            // the pre-conf live queue), and confirmed = delivered + not-delivered-yet (post-conf).
            const cohort = sellerOrders.filter(inCohortWindow);
            const assignedCount = cohort.length;
            const assignedPercent = totalInWindow > 0 ? (assignedCount / totalInWindow) * 100 : 0;

            // Confirmed = order_status NOT in pending ({new, postponed}) OR has
            // tracking code (handed to courier ⇒ confirmed regardless of status).
            // Empty-set guard: `pendingIds` is empty while `useStatusCategories`
            // is loading; `.has` returns false for everything in that window,
            // so without the guard every order would slip through as confirmed.
            const hasTracking = (o: DSOrder) => !!o.id && trackedOrderIds.has(o.id);
            const statusMapsReady = pendingIds.size > 0;
            const confirmed = cohort.filter((o) =>
                hasTracking(o)
                || (statusMapsReady
                    && !!o.order_status_id
                    && !pendingIds.has(o.order_status_id)),
            );
            const confirmedCount = confirmed.length;

            // Rate denominator = full cohort (every order in the window). The
            // old "touched" denominator dropped `new` orders, hiding the CSR
            // backlog and pushing the rate toward 100%.
            const confirmedPercent = cohort.length > 0 ? (confirmedCount / cohort.length) * 100 : 0;

            // Delivered = package state is delivered. Computed directly from
            // the cohort so it is independent of the confirmed set.
            const delivered = cohort.filter((o) => isDeliveredForCommission(o, deliveredPkgIds));
            const deliveredCount = delivered.length;

            // Delivery rate (Coliaty formula):
            //   delivered ÷ (tracked − admin-pullback)
            // Tracked = order has a tracking_code (company_parcels/courier_parcels).
            // Admin-pullback = tracked AND flagged fake/double/blacklisted/cancelled
            //   at order level, OR Hors-zone/Annulé at package level.
            const tracked = cohort.filter((o) => !!o.id && trackedOrderIds.has(o.id));
            const pullback = tracked.filter((o) =>
                isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
            );
            const deliveryDenom = tracked.length - pullback.length;
            const deliveredPercent = deliveryDenom > 0 ? (deliveredCount / deliveryDenom) * 100 : 0;

            // Sources — bucket by the cohort, each source counts assigned/confirmed/delivered subsets
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

            // Pre-confirmation bucket = cohort orders NOT YET confirmed. Every distinct current
            // order_status gets its own pill. Orders with no status are grouped as "— no status".
            // Sum of pills always equals assignedCount - confirmedCount.
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

            // Post-confirmation bucket = confirmed orders NOT YET delivered. Same treatment —
            // every current package_status gets its own pill. Orders without a package_status
            // (pre-dispatch) are grouped as "— no package status".
            const notYetDelivered = confirmed.filter((o) => !isDeliveredForCommission(o, deliveredPkgIds));
            const postConfShareTotal = notYetDelivered.length;
            // If a package_status is set, bucket by that. Otherwise bucket by the current
            // order_status (confirmed sub-state like "Paid" / "Unpaid" / "Processed").
            // Namespaces keep the two kinds from colliding.
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

            // Net components
            const basis: CommissionBasis = normalizeCommissionBasis(seller.commission_basis);
            const commissionPrice = Number(seller.commission_price ?? 0) || 0;
            const sellerProductIds: string[] = Array.isArray(seller.products)
                ? (seller.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];

            let revenue = 0;
            let cogs = 0;
            let shipping = 0;
            const sellerDeliveredQty = new Map<string, number>();
            delivered.forEach((o) => {
                revenue += productRevenueExcludingShipping(o);
                shipping += Number(o.shipping_cost || 0);
                for (const oi of o.order_items || []) {
                    const q = Number(oi.quantity) || 0;
                    if (q <= 0) continue;
                    if (oi.product_id) {
                        // Prefer the per-line cost snapshot so historical COGS
                        // isn't re-priced when products.cost_price changes (§6).
                        const snap = Number((oi as { product_unit_cost_snapshot?: number | null }).product_unit_cost_snapshot || 0);
                        const unit = snap > 0 ? snap : (productCost.get(oi.product_id) || 0);
                        cogs += unit * q;
                        sellerDeliveredQty.set(
                            oi.product_id,
                            (sellerDeliveredQty.get(oi.product_id) || 0) + q,
                        );
                    }
                    if (oi.accessory_id) {
                        const aq = Number(oi.accessory_quantity) || 0;
                        if (aq > 0) {
                            // Same snapshot-first rule for accessories.
                            const snap = Number((oi as { accessory_unit_price?: number | null }).accessory_unit_price || 0);
                            const unit = snap > 0 ? snap : (accessoryCost.get(oi.accessory_id) || 0);
                            cogs += unit * aq;
                        }
                    }
                }
            });

            let adsShare = 0;
            sellerDeliveredQty.forEach((sqty, pid) => {
                const gqty = globalDeliveredQty.get(pid) || 0;
                const ads = adsByProduct.get(pid) || 0;
                if (gqty > 0 && ads > 0) adsShare += (sqty / gqty) * ads;
            });

            // Commission: view is source of truth; client calc used for drift detection
            const commissionClient = delivered.reduce(
                (s, o) =>
                    s +
                    commissionAccruedForDeliveredOrder({
                        order: o,
                        basis,
                        commissionPrice,
                        sellerProductIds,
                    }),
                0,
            );
            const commissionFromView = commissionTotals?.totals.get(seller.id) ?? null;
            const commission = commissionFromView ?? commissionClient;
            const commissionDrift =
                commissionFromView !== null && Math.abs(commissionFromView - commissionClient) > 1;

            const netResult = revenue - cogs - shipping - adsShare - commission;

            return {
                id: seller.id,
                name: seller.name,
                avatar_url: seller.avatar_url,
                active: seller.active,
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
                revenue,
                cogs,
                shipping,
                adsShare,
                commission,
                commissionClient,
                commissionDrift,
                netResult,
            };
        }).sort((a, b) => b.deliveredCount - a.deliveredCount);

        return { sellerData, totalInWindow };
    }, [
        sellers,
        orders,
        adsHistory,
        products,
        accessories,
        commissionTotals,
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
                {seller.avatar_url ? (
                    <img src={seller.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                ) : (
                    <div className="w-7 h-7 rounded-full bg-ant-ink/5 flex items-center justify-center text-[11px] font-semibold text-ant-ink shrink-0">
                        {seller.name?.[0]}
                    </div>
                )}
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
