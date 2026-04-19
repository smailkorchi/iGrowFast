import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Box, ChevronDown, ChevronRight, ShoppingBag } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { differenceInCalendarDays, endOfDay, isWithinInterval, startOfDay } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    isConfirmed,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';
import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { FinancialsWaterfall } from './performance/FinancialsWaterfall';
import { SourcePills, type SourceStat } from './performance/SourcePills';

interface DashboardProductsPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

// All shapes verified against DB schema via MCP
type DPOrderItem = {
    id: string;
    order_id: string;
    product_id: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
    accessory_id: string | null;
    accessory_quantity: number | null;
    accessory_unit_price: number | null;
    product_unit_cost_snapshot: number | null;
};
type DPOrder = {
    id: string;
    date: string | null;
    shipping_cost: number | null;
    order_status_id: string | null;
    package_status_id: string | null;
    package_status_label: string | null;
    source_name: string | null;
    seller_id: string | null;
    order_statuses: { code: string; label: string; category: string } | null;
    package_statuses: { label: string; category: string } | null;
};
type DPProduct = {
    id: string;
    name: string;
    image_url: string | null;
    stock: number | null;
    cost_price: number | null;
    selling_price: number | null;
    active: boolean | null;
};
type DPAccessory = { id: string; cost_price: number | null };
type DPAd = {
    product_id: string | null;
    amount: number | null;
    start_date: string | null;
    end_date: string | null;
};
type DPSeller = {
    id: string;
    commission_price: number | null;
    commission_basis: string | null;
    products: unknown;
};

/**
 * Revenue for a product line. Convention (verified across codebase):
 * - Product revenue = coalesce(total_price, unit_price × productQty)
 * - Accessories NEVER contribute to revenue — they're cost-only attachments.
 */
function productLineRevenue(oi: DPOrderItem, productQty: number): number {
    if (productQty <= 0) return 0;
    const tp = Number(oi.total_price || 0);
    if (tp > 0) return tp;
    return Number(oi.unit_price || 0) * productQty;
}

/**
 * Fraction of an ad's spend attributable to the window.
 *   attributed = amount × (overlap_days / total_days)
 * Ads with no end_date are treated as single-day. Returns 0 when no overlap.
 */
function adsOverlapFraction(
    start: Date,
    end: Date | null,
    wStart: Date,
    wEnd: Date,
): number {
    const adEnd = end || start;
    const oStart = start.getTime() > wStart.getTime() ? start : wStart;
    const oEnd = adEnd.getTime() < wEnd.getTime() ? adEnd : wEnd;
    if (oEnd.getTime() < oStart.getTime()) return 0;
    const overlapDays = differenceInCalendarDays(oEnd, oStart) + 1;
    const totalDays = differenceInCalendarDays(adEnd, start) + 1;
    if (totalDays <= 0) return 0;
    return Math.max(0, Math.min(1, overlapDays / totalDays));
}

export const DashboardProductsPerformance = ({
    businessId,
    dateFilter,
}: DashboardProductsPerformanceProps) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState(false);
    const TOP_N = 3;

    const {
        confirmedIds,
        deliveredPkgIds,
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();

    const toggle = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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

    const { data: orderItems } = useQuery({
        queryKey: ['dashboard-order-items', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('order_items')
                .select('id, order_id, product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price, product_unit_cost_snapshot')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: orders } = useQuery({
        queryKey: ['dashboard-products-performance-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, date, shipping_cost, order_status_id, package_status_id, package_status_label, source_name, seller_id, order_statuses(code, label, category), package_statuses(label, category)'
                )
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return data || [];
        },
        enabled: !!businessId,
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

    const { data: sellersForCommission } = useQuery({
        queryKey: ['dashboard-sellers-for-products', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, commission_price, commission_basis, products')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products || !orderItems || !orders) return null;

        const hasWindow = !!dateFilter.from || !!dateFilter.to;
        const wStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const wEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();
        const inWindow = (d: Date | null) => {
            if (!d) return false;
            if (!hasWindow) return true;
            return isWithinInterval(d, { start: wStart, end: wEnd });
        };
        const parseDate = (s: string | null | undefined): Date | null => {
            if (!s) return null;
            const d = new Date(s);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const productsTyped = products as unknown as DPProduct[];
        const itemsTyped = orderItems as unknown as DPOrderItem[];
        const ordersTyped = orders as unknown as DPOrder[];

        // Cohort: orders created in window, not soft-deleted (already filtered server-side)
        const ordersInWindow = ordersTyped.filter((o) => inWindow(parseDate(o.date)));
        const cohortOrderIds = new Set(ordersInWindow.map((o) => o.id));
        const orderById = new Map(ordersInWindow.map((o) => [o.id, o]));

        // Items restricted to cohort
        const cohortItems = itemsTyped.filter((oi) => cohortOrderIds.has(oi.order_id));

        // Per-order total PRODUCT qty (accessory-only rows with qty=0 contribute 0).
        // Used for shipping allocation and commission share.
        const orderProductQty = new Map<string, number>();
        cohortItems.forEach((oi) => {
            const q = Number(oi.quantity) || 0;
            if (q <= 0) return;
            orderProductQty.set(oi.order_id, (orderProductQty.get(oi.order_id) || 0) + q);
        });

        // Cost lookups
        const productCostById = new Map<string, number>();
        productsTyped.forEach((p) => productCostById.set(p.id, Number(p.cost_price || 0)));
        const accessoryCostById = new Map<string, number>();
        (accessories as unknown as DPAccessory[] | undefined)?.forEach((a) => {
            accessoryCostById.set(a.id, Number(a.cost_price || 0));
        });

        // Ads: pro-rate by window overlap, attribute to product_id
        const adsByProduct = new Map<string, number>();
        ((adsHistory || []) as unknown as DPAd[]).forEach((ad) => {
            if (!ad.product_id) return;
            const start = parseDate(ad.start_date);
            if (!start) return;
            const end = parseDate(ad.end_date);
            const fraction = adsOverlapFraction(start, end, wStart, wEnd);
            if (fraction <= 0) return;
            adsByProduct.set(
                ad.product_id,
                (adsByProduct.get(ad.product_id) || 0) + Number(ad.amount || 0) * fraction,
            );
        });

        // Sellers lookup for commission
        const sellerById = new Map<string, DPSeller>();
        (sellersForCommission as unknown as DPSeller[] | undefined)?.forEach((s) => sellerById.set(s.id, s));

        // Pre-compute delivered-in-cohort order ids, for commission iteration
        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        /**
         * Commission earned by this product on ONE delivered order.
         *
         * per_unit: commission = productQty × price, but only if this product is in the
         *   seller's attributed list (or the seller has no attributed list — lenient fallback).
         * per_order: the order's flat commission allocated across all products in the order
         *   proportionally to product qty.
         */
        const productCommissionOnOrder = (
            productId: string,
            productQtyInOrder: number,
            order: DPOrder,
        ): number => {
            if (productQtyInOrder <= 0) return 0;
            const seller = order.seller_id ? sellerById.get(order.seller_id) : undefined;
            if (!seller) return 0;
            const basis: CommissionBasis = normalizeCommissionBasis(seller.commission_basis);
            const price = Number(seller.commission_price || 0);
            if (price <= 0) return 0;

            if (basis === 'per_unit') {
                const attributed: string[] = Array.isArray(seller.products)
                    ? (seller.products as string[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
                    : [];
                const productAllowed = attributed.length === 0 || attributed.includes(productId);
                return productAllowed ? productQtyInOrder * price : 0;
            }

            // per_order: flat price distributed across this order's products by qty share
            const totalProductQty = orderProductQty.get(order.id) || productQtyInOrder;
            if (totalProductQty <= 0) return 0;
            return price * (productQtyInOrder / totalProductQty);
        };

        const productData = productsTyped.map((product) => {
            // ========= Partition lines =========
            // PRODUCT lines: this product's actual product sales (qty > 0)
            // ACCESSORY lines: this product's accessory attachments (accessory_id set, acc qty > 0)
            // A single row can be both (product + accessory on same line).
            const productLines = cohortItems.filter(
                (oi) => oi.product_id === product.id && (Number(oi.quantity) || 0) > 0,
            );
            const accessoryLines = cohortItems.filter(
                (oi) =>
                    oi.product_id === product.id &&
                    !!oi.accessory_id &&
                    (Number(oi.accessory_quantity) || 0) > 0,
            );

            // ========= Funnel (in UNITS of this product) =========
            let orderedUnits = 0;
            let confirmedUnits = 0;
            let deliveredUnits = 0;
            // Keep delivered orders distinct (for accessory COGS / shipping / commission)
            const deliveredOrderIds = new Set<string>();
            // Product qty per delivered order, for commission allocation
            const deliveredOrderProductQty = new Map<string, number>();

            productLines.forEach((oi) => {
                const q = Number(oi.quantity) || 0;
                const order = orderById.get(oi.order_id);
                if (!order) return;
                orderedUnits += q;
                if (!isConfirmed(order, confirmedIds)) return;
                confirmedUnits += q;
                if (!isDeliveredForCommission(order, deliveredPkgIds)) return;
                deliveredUnits += q;
                deliveredOrderIds.add(oi.order_id);
                deliveredOrderProductQty.set(
                    oi.order_id,
                    (deliveredOrderProductQty.get(oi.order_id) || 0) + q,
                );
            });

            const confirmedPercent = orderedUnits > 0 ? (confirmedUnits / orderedUnits) * 100 : 0;
            const deliveredPercent = confirmedUnits > 0 ? (deliveredUnits / confirmedUnits) * 100 : 0;

            // ========= Revenue (product-side only) =========
            // Prefer the per-line cost snapshot so a product's current cost_price change
            // can't retroactively re-price historical COGS (§6).
            let revenue = 0;
            let productCOGS = 0;
            let shippingAlloc = 0;
            const currentProductCost = Number(product.cost_price || 0);

            productLines.forEach((oi) => {
                const order = orderById.get(oi.order_id);
                if (!order || !deliveredOrderIds.has(order.id)) return;
                const q = Number(oi.quantity) || 0;
                if (q <= 0) return;
                revenue += productLineRevenue(oi, q);
                const snap = Number(oi.product_unit_cost_snapshot || 0);
                const unitProductCost = snap > 0 ? snap : currentProductCost;
                productCOGS += unitProductCost * q;
                const totalProdQty = orderProductQty.get(order.id) || q;
                shippingAlloc += (Number(order.shipping_cost || 0) * q) / totalProdQty;
            });

            // ========= Accessory COGS (delivered orders only; cost-only, never revenue) =========
            let accessoryCOGS = 0;
            accessoryLines.forEach((oi) => {
                if (!deliveredOrderIds.has(oi.order_id)) return;
                const accQty = Number(oi.accessory_quantity) || 0;
                if (accQty <= 0) return;
                const snapshot = Number(oi.accessory_unit_price || 0);
                const fallback = oi.accessory_id ? accessoryCostById.get(oi.accessory_id) || 0 : 0;
                // Prefer the per-line snapshot (cost at purchase time); fall back only when snapshot is missing
                const unitCost = snapshot > 0 ? snapshot : fallback;
                accessoryCOGS += unitCost * accQty;
            });

            // ========= Ads (pro-rated to window, tagged to this product) =========
            const adsShare = adsByProduct.get(product.id) || 0;

            // ========= Commission (per-delivered-order, allocated to this product) =========
            let commission = 0;
            deliveredOrderIds.forEach((oid) => {
                const order = orderById.get(oid);
                if (!order) return;
                const qtyInOrder = deliveredOrderProductQty.get(oid) || 0;
                commission += productCommissionOnOrder(product.id, qtyInOrder, order);
            });

            const netProfit = revenue - productCOGS - accessoryCOGS - shippingAlloc - adsShare - commission;

            // ========= Sources (over this product's cohort orders) =========
            const sourceAgg = new Map<string, { assigned: number; confirmed: number; delivered: number }>();
            const bump = (src: string, k: 'assigned' | 'confirmed' | 'delivered') => {
                const row = sourceAgg.get(src) || { assigned: 0, confirmed: 0, delivered: 0 };
                row[k] += 1;
                sourceAgg.set(src, row);
            };
            const seenOrder = new Set<string>();
            productLines.forEach((oi) => {
                if (seenOrder.has(oi.order_id)) return;
                seenOrder.add(oi.order_id);
                const order = orderById.get(oi.order_id);
                if (!order) return;
                const src = (order.source_name || 'other').toLowerCase();
                bump(src, 'assigned');
                if (isConfirmed(order, confirmedIds)) {
                    bump(src, 'confirmed');
                    if (isDeliveredForCommission(order, deliveredPkgIds)) bump(src, 'delivered');
                }
            });
            const sources: SourceStat[] = Array.from(sourceAgg, ([source, v]) => ({ source, ...v }));

            // ========= Dropoff panes (in ORDERS, matching sellers section semantics) =========
            const distinctOrderIds = Array.from(seenOrder);
            const productOrders = distinctOrderIds.map((oid) => orderById.get(oid)).filter((o): o is DPOrder => !!o);
            const totalOrders = productOrders.length;
            const confirmedOrders = productOrders.filter((o) => isConfirmed(o, confirmedIds));
            const deliveredOrders = confirmedOrders.filter((o) => isDeliveredForCommission(o, deliveredPkgIds));
            const confirmedOrdersCount = confirmedOrders.length;
            const deliveredOrdersCount = deliveredOrders.length;

            const notYetConfirmed = productOrders.filter((o) => !isConfirmed(o, confirmedIds));
            const preCountByStatus = new Map<string | null, number>();
            notYetConfirmed.forEach((o) => {
                preCountByStatus.set(o.order_status_id, (preCountByStatus.get(o.order_status_id) || 0) + 1);
            });
            const preConfEntries: StatusQueueEntry[] = Array.from(preCountByStatus, ([sid, count]) => {
                if (!sid) return { id: '__unset__', label: 'Unset (no status)', count, color: '#9ca3af' };
                const status = orderStatusById.get(sid);
                return {
                    id: sid,
                    label: status?.label || 'Unknown status',
                    count,
                    color: getOrderStatusColor(sid),
                };
            });

            const notYetDelivered = confirmedOrders.filter(
                (o) => !isDeliveredForCommission(o, deliveredPkgIds),
            );
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
                if (key === 'unset') return { id: 'unset', label: 'Unset (no status)', count, color: '#9ca3af' };
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

            // ========= Per-unit derivatives (all over delivered units) =========
            const unitShipping = deliveredUnits > 0 ? shippingAlloc / deliveredUnits : 0;
            const unitAdsShare = deliveredUnits > 0 ? adsShare / deliveredUnits : 0;
            const unitCommission = deliveredUnits > 0 ? commission / deliveredUnits : 0;
            const unitAccessoryCOGS = deliveredUnits > 0 ? accessoryCOGS / deliveredUnits : 0;
            const unitMargin = deliveredUnits > 0 ? netProfit / deliveredUnits : 0;

            return {
                id: product.id,
                name: product.name,
                image_url: product.image_url,
                active: product.active,
                stock: Number(product.stock || 0),
                sellingPrice: Number(product.selling_price || 0),
                unitProductCost: currentProductCost,
                // Funnel (units)
                orderedUnits,
                confirmedUnits,
                confirmedPercent,
                deliveredUnits,
                deliveredPercent,
                // Funnel (orders, for dropoff pane reconciliation)
                totalOrders,
                confirmedOrdersCount,
                deliveredOrdersCount,
                // Financials
                revenue,
                productCOGS,
                accessoryCOGS,
                shipping: shippingAlloc,
                adsShare,
                commission,
                netProfit,
                // Per-unit
                unitShipping,
                unitAdsShare,
                unitCommission,
                unitAccessoryCOGS,
                unitMargin,
                // Dropoff
                preConfEntries,
                postConfEntries,
                // Sources
                sources,
            };
        })
            .filter((p) => p.orderedUnits > 0)
            .sort((a, b) => {
                if (b.deliveredUnits !== a.deliveredUnits) return b.deliveredUnits - a.deliveredUnits;
                if (b.revenue !== a.revenue) return b.revenue - a.revenue;
                return (a.name || '').localeCompare(b.name || '');
            });

        return { productData };
    }, [
        products,
        orderItems,
        orders,
        accessories,
        adsHistory,
        sellersForCommission,
        dateFilter,
        confirmedIds,
        deliveredPkgIds,
        orderStatuses,
        packageStatuses,
        getOrderStatusColor,
        getPkgStatusColor,
    ]);

    if (!metrics) return null;

    const totalProducts = metrics.productData.length;
    const visibleProducts = showAll ? metrics.productData : metrics.productData.slice(0, TOP_N);
    const hasMore = totalProducts > TOP_N;

    return (
        <Card className="border border-gray-100 shadow-none rounded-xl">
            <CardHeader className="px-3.5 pt-2.5 pb-1.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <ShoppingBag className="w-3 h-3 text-gray-400" />
                        <CardTitle className="text-[12px] font-semibold text-brand-navy">Products performance</CardTitle>
                    </div>
                    <span className="text-[9px] text-gray-400 uppercase tracking-[0.14em] tabular-nums truncate">
                        {hasMore && !showAll
                            ? `Top ${Math.min(TOP_N, totalProducts)} of ${totalProducts}`
                            : `${totalProducts} in period`}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-2.5 pb-2.5 pt-0 space-y-1">
                {visibleProducts.map((p) => {
                    const isExpanded = expanded.has(p.id);
                    const stages: FunnelStage[] = [
                        {
                            key: 'ordered',
                            label: 'Ordered',
                            count: p.orderedUnits,
                            sub: 'units',
                            accent: '#6b7280',
                            fillClass: 'bg-gray-50',
                        },
                        {
                            key: 'confirmed',
                            label: 'Confirmed',
                            count: p.confirmedUnits,
                            ratePct: p.confirmedPercent,
                            accent: '#3b82f6',
                            fillClass: 'bg-blue-50/70',
                        },
                        {
                            key: 'delivered',
                            label: 'Delivered',
                            count: p.deliveredUnits,
                            ratePct: p.deliveredPercent,
                            accent: '#10b981',
                            fillClass: 'bg-emerald-50/70',
                        },
                    ];

                    return (
                        <div
                            key={p.id}
                            className={cn(
                                'border rounded-xl overflow-hidden transition-colors bg-white',
                                isExpanded ? 'border-gray-200' : 'border-gray-100',
                            )}
                        >
                            <ProductHeaderRow
                                product={p}
                                stages={stages}
                                isExpanded={isExpanded}
                                onToggle={() => toggle(p.id)}
                            />

                            {isExpanded && (
                                <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/30 space-y-2">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1.15fr,1fr] gap-2">
                                        <section className="rounded-lg bg-white border border-gray-100 p-3 space-y-3">
                                            <header className="flex items-baseline justify-between">
                                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em]">
                                                    Funnel dropoff
                                                </h4>
                                                <span className="text-[10px] text-gray-400 tabular-nums">
                                                    {(p.totalOrders - p.deliveredOrdersCount).toLocaleString('fr-MA')} / {p.totalOrders.toLocaleString('fr-MA')}
                                                </span>
                                            </header>
                                            <StatusQueuePane
                                                title="Before confirmation"
                                                totalLost={p.totalOrders - p.confirmedOrdersCount}
                                                cohortSize={p.totalOrders}
                                                entries={p.preConfEntries}
                                                emptyText="All cohort orders confirmed"
                                            />
                                            <div className="h-px bg-gray-100" />
                                            <StatusQueuePane
                                                title="After confirmation"
                                                totalLost={p.confirmedOrdersCount - p.deliveredOrdersCount}
                                                cohortSize={p.confirmedOrdersCount}
                                                entries={p.postConfEntries}
                                                emptyText="All confirmed orders delivered"
                                            />
                                        </section>

                                        <section className="rounded-lg bg-white border border-gray-100 p-3 space-y-2">
                                            <header className="flex items-baseline justify-between">
                                                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em]">
                                                    Financials
                                                </h4>
                                                <span className="text-[10px] text-gray-400 tabular-nums">
                                                    on {p.deliveredUnits.toLocaleString('fr-MA')} delivered units
                                                </span>
                                            </header>
                                            <FinancialsWaterfall
                                                revenue={p.revenue}
                                                cogs={p.productCOGS}
                                                cogsLabel="Product COGS"
                                                accessoryCogs={p.accessoryCOGS}
                                                adsShare={p.adsShare}
                                                commission={p.commission}
                                                shipping={p.shipping}
                                                net={p.netProfit}
                                            />
                                        </section>
                                    </div>

                                    <section className="rounded-lg bg-white border border-gray-100 p-3">
                                        <header className="flex items-baseline justify-between mb-2">
                                            <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em]">
                                                Unit economics
                                            </h4>
                                            <span className="text-[10px] text-gray-400">per delivered unit</span>
                                        </header>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-1.5">
                                            <UnitCell label="Selling" value={p.sellingPrice} positive />
                                            <UnitCell label="Buying" value={p.unitProductCost} />
                                            <UnitCell label="Accessories" value={p.unitAccessoryCOGS} />
                                            <UnitCell label="Shipping" value={p.unitShipping} />
                                            <UnitCell label="Ads" value={p.unitAdsShare} />
                                            <UnitCell label="Commission" value={p.unitCommission} />
                                            <UnitCell
                                                label="Margin"
                                                value={p.unitMargin}
                                                highlight={p.unitMargin >= 0 ? 'positive' : 'negative'}
                                            />
                                        </div>
                                    </section>

                                    <section className="rounded-lg bg-white border border-gray-100 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.16em] shrink-0">
                                            Sources
                                        </h4>
                                        <div className="flex-1 min-w-[200px]">
                                            <SourcePills sources={p.sources} />
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    );
                })}
                {totalProducts === 0 && (
                    <p className="text-center py-8 text-gray-400 text-xs">
                        No products with activity in this period
                    </p>
                )}
                {hasMore && (
                    <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="w-full flex items-center justify-center gap-1 py-2 text-[11px] font-bold text-brand-navy/60 hover:text-brand-navy hover:bg-gray-50 rounded-xl transition-colors"
                    >
                        {showAll ? `Show top ${TOP_N} only` : `Show all ${totalProducts} products`}
                        <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showAll && 'rotate-90')} />
                    </button>
                )}
            </CardContent>
        </Card>
    );
};

interface ProductRow {
    id: string;
    name: string;
    image_url: string | null;
    active: boolean | null;
    stock: number;
    deliveredUnits: number;
    netProfit: number;
    commission: number;
}

function ProductHeaderRow({
    product,
    stages,
    isExpanded,
    onToggle,
}: {
    product: ProductRow;
    stages: FunnelStage[];
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const netPositive = product.netProfit >= 0;
    const stockTone =
        product.stock > 10 ? 'text-emerald-600' : product.stock > 0 ? 'text-amber-600' : 'text-red-600';
    return (
        <button
            type="button"
            onClick={onToggle}
            className="w-full grid grid-cols-[minmax(140px,170px)_1fr_minmax(100px,120px)_14px] items-center gap-2.5 px-2.5 py-1.5 hover:bg-gray-50/50 transition-colors text-left"
        >
            <div className="flex items-center gap-1.5 min-w-0">
                {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-6 h-6 rounded-sm object-cover bg-gray-100 shrink-0" />
                ) : (
                    <div className="w-6 h-6 rounded-sm bg-gray-100 flex items-center justify-center shrink-0">
                        <Box className="w-3 h-3 text-gray-400" />
                    </div>
                )}
                <div className="min-w-0">
                    <p className="font-semibold text-brand-navy text-[11px] truncate leading-tight">{product.name}</p>
                    <p className="text-[8px] text-gray-400 uppercase tracking-[0.14em] mt-0.5">
                        Stock <span className={cn('font-bold tabular-nums ml-0.5', stockTone)}>{product.stock}</span>
                        {product.active === false && <span className="ml-1 text-red-500">· Inactive</span>}
                    </p>
                </div>
            </div>

            <div className="min-w-0">
                <PerformanceFunnel stages={stages} dense />
            </div>

            <div className="min-w-0 border-l border-gray-100 pl-2.5">
                <p className="text-[8px] text-gray-400 font-bold uppercase tracking-[0.14em]">Net</p>
                <p
                    className={cn(
                        'text-[12px] font-semibold leading-tight tabular-nums',
                        netPositive ? 'text-emerald-600' : 'text-red-600',
                    )}
                >
                    {Math.round(product.netProfit).toLocaleString('fr-MA')}
                    <span className="text-[8px] text-gray-400 font-medium ml-0.5">MAD</span>
                </p>
                <p className="text-[8px] text-gray-400 mt-0.5 tabular-nums">
                    {Math.round(product.commission).toLocaleString('fr-MA')} comm
                </p>
            </div>

            <ChevronDown
                className={cn(
                    'w-3 h-3 text-gray-300 transition-transform justify-self-end',
                    isExpanded && 'rotate-180 text-gray-500',
                )}
            />
        </button>
    );
}

function UnitCell({
    label,
    value,
    positive,
    highlight,
}: {
    label: string;
    value: number;
    positive?: boolean;
    highlight?: 'positive' | 'negative';
}) {
    const toneClass = highlight === 'positive'
        ? 'text-emerald-600'
        : highlight === 'negative'
            ? 'text-red-600'
            : positive
                ? 'text-brand-navy'
                : 'text-gray-700';
    return (
        <div className="rounded-md px-2 py-1.5 border border-gray-100">
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.14em] truncate">{label}</p>
            <p className={cn('text-[12px] font-semibold leading-tight tabular-nums mt-0.5', toneClass)}>
                {value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
        </div>
    );
}
