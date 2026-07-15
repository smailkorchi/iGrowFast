import { useMemo } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PackageOpen, AlertTriangle, Box } from 'lucide-react';
import { LOW_STOCK_THRESHOLD } from '@/lib/analyticsDefinitions';

/**
 * `inventory` section of admin_analytics_stats (D3). Catalog counts, stock
 * valuations, the low-stock row list (stock < 10 AND active — strict `<`,
 * NOT catalog_totals' `<= 10`), per-product sold/revenue/cost and the
 * transactions unpaid figure are all computed server-side.
 *
 * Replicated (deliberately, parity-first) by the RPC: "sold" is windowed on the
 * parent order's PLACEMENT date with NO date_deleted / source_review_status
 * filter (recon 02 §2 DEFECT — the fix is a separate owner decision); revenue
 * is qty × unit_price only (not the pureRevenue chain); All-Time passes rows
 * with NULL dates; unpaid = Σtotal − Σpaid as an aggregate diff (may go
 * negative on overpayment — NOT transactions_totals' per-row clamp).
 *
 * Client keeps only presentation: margin arithmetic, sorting is already done
 * server-side, and the top-10 slice.
 */
export interface InventorySlice {
    total_products: number;
    active_products: number;
    total_accessories: number;
    stock_value_at_cost: number;
    stock_value_at_selling: number;
    low_stock: Array<{
        kind: 'product' | 'accessory';
        id: string;
        name: string;
        stock: number;
        cost_price: number;
    }>;
    units_sold: number;
    /** Sorted sold desc by the RPC. */
    product_sales: Array<{
        product_id: string;
        name: string;
        image_url: string | null;
        sold: number;
        revenue: number;
        cost: number;
    }>;
    transactions_value: number;
    transactions_paid: number;
    unpaid_amount: number;
}

interface InventorySectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: InventorySlice | null;
}

export const InventorySection = ({ stats }: InventorySectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        // Rows arrive sorted sold desc; margin is the only derived figure.
        const productPerformance = stats.product_sales.map((p) => ({
            name: p.name,
            image_url: p.image_url,
            sold: p.sold,
            revenue: p.revenue,
            cost: p.cost,
            margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
        }));

        return {
            totalProducts: stats.total_products,
            activeProducts: stats.active_products,
            totalAccessories: stats.total_accessories,
            lowStock: stats.low_stock,
            stockValueAtCost: stats.stock_value_at_cost,
            stockValueAtSelling: stats.stock_value_at_selling,
            totalUnitsSold: stats.units_sold,
            productPerformance,
            totalTransactionValue: stats.transactions_value,
            unpaidAmount: stats.unpaid_amount,
        };
    }, [stats]);

    return (
        <SectionWrapper
            id="inventory"
            title="Inventory & Products"
            description={`Stock at cost + at selling price. Flagged below ${LOW_STOCK_THRESHOLD} units.`}
            icon={PackageOpen}
            iconColor="text-ant-mid"
            loading={!stats}
        >
            {metrics && (() => {
                const lowStockTotal = metrics.lowStock.length;
                const top = metrics.productPerformance[0];
                const narrative = lowStockTotal > 0
                    ? `${lowStockTotal} item${lowStockTotal > 1 ? 's' : ''} running low on stock — restock before they sell out.${top ? ` ${top.name} is your top seller with ${top.sold} units moved.` : ''}`
                    : top
                        ? `Stock levels healthy across ${metrics.totalProducts} products. ${top.name} leads at ${top.sold} units sold.`
                        : `Tracking ${metrics.totalProducts} products and ${metrics.totalAccessories} accessories.`;

                return (
                    <SectionStory
                        hero={{
                            label: lowStockTotal > 0 ? 'items need restock' : 'stock value at cost',
                            value: lowStockTotal > 0 ? lowStockTotal.toString() : `${Math.round(metrics.stockValueAtCost).toLocaleString('fr-MA')}`,
                            suffix: lowStockTotal > 0 ? undefined : 'MAD',
                            tone: lowStockTotal > 0 ? 'negative' : 'neutral',
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Products', value: metrics.totalProducts.toLocaleString('fr-MA'), sub: `${metrics.activeProducts} active` },
                            { label: 'Accessories', value: metrics.totalAccessories.toLocaleString('fr-MA') },
                            { label: 'Value at cost', value: `${Math.round(metrics.stockValueAtCost).toLocaleString('fr-MA')} MAD` },
                            { label: 'Value at selling', value: `${Math.round(metrics.stockValueAtSelling).toLocaleString('fr-MA')} MAD`, tone: 'positive' },
                            { label: 'Units sold', value: metrics.totalUnitsSold.toLocaleString('fr-MA') },
                            { label: 'Unpaid', value: `${Math.round(metrics.unpaidAmount).toLocaleString('fr-MA')} MAD`, tone: metrics.unpaidAmount > 0 ? 'warning' : 'neutral' },
                        ]}
                    >

                    {metrics.productPerformance.length > 0 && (
                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Top products</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line">
                                                <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Product</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Sold</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Revenue</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Cost</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Margin</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {metrics.productPerformance.slice(0, 10).map((p, i) => {
                                                const marginTone =
                                                    p.margin > 30 ? 'text-ant-green' : p.margin > 0 ? 'text-ant-orange' : 'text-ant-rose';
                                                return (
                                                    <tr key={i} className="border-b border-ant-line hover:bg-ant-ink/[0.02] transition-colors">
                                                        <td className="py-1.5">
                                                            <div className="flex items-center gap-2">
                                                                {p.image_url ? (
                                                                    <img src={p.image_url} alt={p.name} className="w-6 h-6 rounded-sm object-cover border border-ant-ink/5 shrink-0" />
                                                                ) : (
                                                                    <div className="w-6 h-6 rounded-sm bg-ant-ink/[0.04] flex items-center justify-center shrink-0">
                                                                        <Box className="w-3 h-3 text-ant-line" />
                                                                    </div>
                                                                )}
                                                                <span className="text-[11px] font-medium text-ant-ink truncate">{p.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="py-1.5 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{p.sold}</td>
                                                        <td className="py-1.5 text-right text-[11px] tabular-nums">{p.revenue.toLocaleString('fr-MA')} <span className="text-[9px] text-ant-mid">MAD</span></td>
                                                        <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">{p.cost.toLocaleString('fr-MA')} <span className="text-[9px] text-ant-mid">MAD</span></td>
                                                        <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${marginTone}`}>
                                                            {p.margin.toFixed(1)}%
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

                    {metrics.lowStock.length > 0 && (() => {
                        // Rows arrive sorted stock asc (products before accessories on ties).
                        // NOTE: the RPC's low_stock payload carries no image_url, so these
                        // rows render the placeholder glyph — see the D3 gap note.
                        const rows = metrics.lowStock;

                        return (
                            <Card className="border border-ant-rose/25 shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-ant-rose flex items-center gap-1.5">
                                        <AlertTriangle className="w-3 h-3" /> Low stock — {rows.length} item{rows.length > 1 ? 's' : ''}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-ant-line">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Item</th>
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Kind</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Stock</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Unit cost</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">At risk</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((r) => {
                                                    const stockTone =
                                                        r.stock === 0 ? 'text-ant-rose' : r.stock <= 2 ? 'text-ant-rose' : 'text-ant-orange';
                                                    const atRisk = r.stock * r.cost_price;
                                                    const kindLabel = r.kind === 'product' ? 'Product' : 'Accessory';
                                                    return (
                                                        <tr key={`${r.kind}-${r.id}`} className="border-b border-ant-line hover:bg-ant-rose/10 transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-6 h-6 rounded-sm bg-ant-ink/[0.04] flex items-center justify-center shrink-0">
                                                                        <Box className="w-3 h-3 text-ant-line" />
                                                                    </div>
                                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{r.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-ant-mid">
                                                                {kindLabel}
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${stockTone}`}>
                                                                {r.stock} left
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {r.cost_price.toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-ink tabular-nums">
                                                                {atRisk.toLocaleString('fr-MA')}
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
                        );
                    })()}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
