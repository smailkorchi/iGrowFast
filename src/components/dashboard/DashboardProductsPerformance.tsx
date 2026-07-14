import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Box, ChevronDown, ChevronRight, ShoppingBag } from 'lucide-react';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { PerformanceFunnel, type FunnelStage } from './performance/PerformanceFunnel';
import { StatusQueuePane, type StatusQueueEntry } from './performance/StatusQueuePane';
import { FinancialsWaterfall } from './performance/FinancialsWaterfall';
import { SourcePills, type SourceStat } from './performance/SourcePills';

/**
 * `products_performance` section of admin_dashboard_stats (D2). Per-product
 * units funnel (Coliaty per units), delivered-line revenue, snapshot-first
 * COGS, qty-share shipping allocation, window-overlap pro-rated ads and the
 * LENIENT per_unit commission rule (empty seller.products = all allowed —
 * known asymmetry replicated as-is, recon 01 §11.5) are all computed
 * server-side. Rows filtered to ordered_units > 0 and sorted deliveredUnits
 * desc, revenue desc, name asc. Only product metadata (support query below)
 * and status labels/colors stay client-side.
 */
export interface ProductsPerformanceSection {
    products: Array<{
        product_id: string;
        ordered_units: number;
        confirmed_units: number;
        tracked_units: number;
        pullback_units: number;
        delivered_units: number;
        total_orders: number;
        confirmed_orders: number;
        delivered_orders: number;
        revenue: number;
        product_cogs: number;
        accessory_cogs: number;
        shipping_alloc: number;
        ads_share: number;
        commission: number;
        net: number;
        sources: Array<{ source: string; assigned: number; confirmed: number; delivered: number }>;
        pre_conf: Array<{ order_status_id: string | null; count: number }>;
        post_conf: Array<{ kind: 'pkg' | 'os' | 'unset'; id: string | null; count: number }>;
    }>;
}

interface DashboardProductsPerformanceProps {
    businessId: string;
    stats: ProductsPerformanceSection | undefined;
}

type DPProduct = {
    id: string;
    name: string;
    image_url: string | null;
    stock: number | null;
    cost_price: number | null;
    selling_price: number | null;
    active: boolean | null;
};

export const DashboardProductsPerformance = ({
    businessId,
    stats,
}: DashboardProductsPerformanceProps) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState(false);
    const TOP_N = 3;

    const {
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

    // Product metadata only (name/image/stock/prices/active) — every aggregate
    // rides the RPC section.
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

    const metrics = useMemo(() => {
        if (!products || !stats) return null;

        const productMetaById = new Map(
            (products as unknown as DPProduct[]).map((p) => [p.id, p]),
        );

        const orderStatusById = new Map(orderStatuses.map((s) => [s.id, s]));
        const packageStatusById = new Map(packageStatuses.map((s) => [s.id, s]));

        // RPC rows already filtered to orderedUnits>0 and sorted deliveredUnits
        // desc, revenue desc, name asc.
        const productData = stats.products.map((row) => {
            const meta = productMetaById.get(row.product_id);

            const confirmedPercent = row.ordered_units > 0
                ? (row.confirmed_units / row.ordered_units) * 100
                : 0;
            // Delivery rate (Coliaty): delivered ÷ (tracked − admin-pullback), in units.
            const deliveryDenomUnits = row.tracked_units - row.pullback_units;
            const deliveredPercent = deliveryDenomUnits > 0
                ? (row.delivered_units / deliveryDenomUnits) * 100
                : 0;

            const sources: SourceStat[] = row.sources.map((s) => ({
                source: s.source,
                assigned: s.assigned,
                confirmed: s.confirmed,
                delivered: s.delivered,
            }));

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

            // Per-unit derivatives (all over delivered units)
            const du = row.delivered_units;
            const unitShipping = du > 0 ? row.shipping_alloc / du : 0;
            const unitAdsShare = du > 0 ? row.ads_share / du : 0;
            const unitCommission = du > 0 ? row.commission / du : 0;
            const unitAccessoryCOGS = du > 0 ? row.accessory_cogs / du : 0;
            const unitMargin = du > 0 ? row.net / du : 0;

            return {
                id: row.product_id,
                name: meta?.name || 'Unknown product',
                image_url: meta?.image_url ?? null,
                active: meta?.active ?? null,
                stock: Number(meta?.stock || 0),
                sellingPrice: Number(meta?.selling_price || 0),
                unitProductCost: Number(meta?.cost_price || 0),
                // Funnel (units)
                orderedUnits: row.ordered_units,
                confirmedUnits: row.confirmed_units,
                confirmedPercent,
                deliveredUnits: row.delivered_units,
                deliveredPercent,
                // Funnel (orders, for dropoff pane reconciliation)
                totalOrders: row.total_orders,
                confirmedOrdersCount: row.confirmed_orders,
                deliveredOrdersCount: row.delivered_orders,
                // Financials
                revenue: row.revenue,
                productCOGS: row.product_cogs,
                accessoryCOGS: row.accessory_cogs,
                shipping: row.shipping_alloc,
                adsShare: row.ads_share,
                commission: row.commission,
                netProfit: row.net,
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
        });

        return { productData };
    }, [
        products,
        stats,
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
        <Card className="ant-surface border border-ant-line bg-ant-paper shadow-none rounded-xl">
            <CardHeader className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        <CardTitle className="font-display text-[13px] font-semibold text-ant-ink tracking-tight">Products performance</CardTitle>
                        <ShoppingBag className="hidden" />
                    </div>
                    <span className="text-[10px] text-ant-mid uppercase tracking-[0.18em] tabular-nums truncate">
                        {hasMore && !showAll
                            ? `Top ${Math.min(TOP_N, totalProducts)} of ${totalProducts}`
                            : `${totalProducts} in period`}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
                {visibleProducts.map((p) => {
                    const isExpanded = expanded.has(p.id);
                    const stages: FunnelStage[] = [
                        {
                            key: 'ordered',
                            label: 'Ordered',
                            count: p.orderedUnits,
                            sub: 'units',
                            accent: '#b0aea5',
                            fillClass: 'bg-ant-line-soft',
                        },
                        {
                            key: 'confirmed',
                            label: 'Confirmed',
                            count: p.confirmedUnits,
                            ratePct: p.confirmedPercent,
                            accent: '#6a9bcc',
                            fillClass: 'bg-ant-blue/10',
                        },
                        {
                            key: 'delivered',
                            label: 'Delivered',
                            count: p.deliveredUnits,
                            ratePct: p.deliveredPercent,
                            accent: '#788c5d',
                            fillClass: 'bg-ant-green/10',
                        },
                    ];

                    return (
                        <div
                            key={p.id}
                            className={cn(
                                'border rounded-xl overflow-hidden transition-colors bg-ant-paper',
                                isExpanded ? 'border-ant-ink/20' : 'border-ant-line',
                            )}
                        >
                            <ProductHeaderRow
                                product={p}
                                stages={stages}
                                isExpanded={isExpanded}
                                onToggle={() => toggle(p.id)}
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
                                            <div className="h-px bg-ant-line" />
                                            <StatusQueuePane
                                                title="After confirmation"
                                                totalLost={p.confirmedOrdersCount - p.deliveredOrdersCount}
                                                cohortSize={p.confirmedOrdersCount}
                                                entries={p.postConfEntries}
                                                emptyText="All confirmed orders delivered"
                                            />
                                        </section>

                                        <section className="rounded-lg bg-ant-paper border border-ant-line p-3 space-y-2">
                                            <header className="flex items-baseline justify-between">
                                                <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                                    Financials
                                                </h4>
                                                <span className="text-[10px] text-ant-mid tabular-nums">
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

                                    <section className="rounded-lg bg-ant-paper border border-ant-line p-3">
                                        <header className="flex items-baseline justify-between mb-2">
                                            <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em]">
                                                Unit economics
                                            </h4>
                                            <span className="text-[10px] text-ant-mid">per delivered unit</span>
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

                                    <section className="rounded-lg bg-ant-paper border border-ant-line px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                        <h4 className="text-[10px] font-medium text-ant-mid uppercase tracking-[0.2em] shrink-0">
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
                    <p className="text-center py-8 font-serif-display text-ant-muted text-xs italic">
                        No products with activity in this period
                    </p>
                )}
                {hasMore && (
                    <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold text-ant-ink hover:text-ant-orange hover:bg-ant-line-soft rounded-xl transition-colors"
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
        product.stock > 10 ? 'text-ant-green' : product.stock > 0 ? 'text-ant-orange' : 'text-ant-rose';
    return (
        <button
            type="button"
            onClick={onToggle}
            className="w-full grid grid-cols-[minmax(140px,170px)_1fr_minmax(100px,120px)_14px] items-center gap-3 px-3 py-2 hover:bg-ant-line-soft transition-colors text-left"
        >
            <div className="flex items-center gap-2 min-w-0">
                {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-7 h-7 rounded-md object-cover bg-ant-line-soft shrink-0 border border-ant-line" />
                ) : (
                    <div className="w-7 h-7 rounded-md bg-ant-line-soft flex items-center justify-center shrink-0 border border-ant-line">
                        <Box className="w-3.5 h-3.5 text-ant-mid" />
                    </div>
                )}
                <div className="min-w-0">
                    <p className="font-semibold text-ant-ink text-[11.5px] truncate leading-tight">{product.name}</p>
                    <p className="text-[9px] text-ant-mid uppercase tracking-[0.18em] mt-0.5">
                        Stock <span className={cn('font-semibold tabular-nums ml-0.5', stockTone)}>{product.stock}</span>
                        {product.active === false && <span className="ml-1 text-ant-rose">· Inactive</span>}
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
                    {Math.round(product.netProfit).toLocaleString('fr-MA')}
                    <span className="text-[9px] text-ant-mid font-medium ml-0.5">MAD</span>
                </p>
                <p className="text-[9px] text-ant-mid mt-0.5 tabular-nums">
                    {Math.round(product.commission).toLocaleString('fr-MA')} comm
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
        ? 'text-ant-green'
        : highlight === 'negative'
            ? 'text-ant-rose'
            : positive
                ? 'text-ant-ink'
                : 'text-ant-muted';
    return (
        <div className="rounded-md px-2.5 py-1.5 border border-ant-line">
            <p className="text-[9.5px] text-ant-mid font-medium uppercase tracking-[0.18em] truncate">{label}</p>
            <p className={cn('font-display text-[13px] font-semibold leading-tight tabular-nums mt-0.5 tracking-[-0.01em]', toneClass)}>
                {value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
        </div>
    );
}
