import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PackageOpen, AlertTriangle, Box } from 'lucide-react';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { LOW_STOCK_THRESHOLD } from '@/lib/analyticsDefinitions';
import { useStatusCategories } from '@/hooks/useStatusCategories';

interface InventorySectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const InventorySection = ({ businessId, dateFilter }: InventorySectionProps) => {
    const { deliveredPkgIds } = useStatusCategories();

    const { data: products, isLoading } = useQuery({
        queryKey: ['analytics-products-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('products').select('id, name, code, cost_price, selling_price, stock, active, image_url').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: accessories } = useQuery({
        queryKey: ['analytics-accessories-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('accessories').select('id, name, code, cost_price, stock, active').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    // Row shape returned by the query. Supabase-generated types lag behind
    // newer columns (`product_unit_cost_snapshot` was added after the types
    // were last regenerated), so we cast the result through `unknown` to
    // keep TS clean without losing structural typing. Same pattern used in
    // the P&L section.
    type InvOrderItemRow = {
        id: string;
        product_id: string | null;
        quantity: number | null;
        unit_price: number | string | null;
        product_unit_cost_snapshot: number | string | null;
        accessory_id: string | null;
        accessory_quantity: number | null;
        order_id: string;
        orders: { date: string | null; order_status_id: string | null; package_status_id: string | null } | null;
    };

    const { data: orderItems } = useQuery<InvOrderItemRow[]>({
        queryKey: ['analytics-order-items-inv-v2', businessId],
        queryFn: async () => {
            return (await fetchAllRows(
                'order_items',
                'id, product_id, quantity, unit_price, product_unit_cost_snapshot, accessory_id, accessory_quantity, order_id, orders(date, order_status_id, package_status_id)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                    ],
                },
            )) as unknown as InvOrderItemRow[];
        },
        enabled: !!businessId,
    });

    const { data: transactions } = useQuery({
        queryKey: ['analytics-transactions-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('transactions').select('id, total_price, paid_price, date, status').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products) return null;

        const hasExplicitFilter = !!dateFilter.from || !!dateFilter.to;
        const isInRange = (dateStr: string | null) => {
            // All-Time: everything passes. Explicit window: null-date rows
            // are excluded so they don't leak into every filtered period.
            if (!hasExplicitFilter) return true;
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const totalProducts = products.length;
        const activeProducts = products.filter(p => p.active).length;
        const totalAccessories = accessories?.length || 0;
        // Locked threshold (§16): < 10 units. Applies equally to products and accessories.
        const lowStockProducts = products.filter(p => Number(p.stock || 0) < LOW_STOCK_THRESHOLD && p.active);
        const lowStockAccessories = (accessories || []).filter(a => Number(a.stock || 0) < LOW_STOCK_THRESHOLD && a.active);

        // Stock value shown both ways (§16): at cost (money tied up) and at selling price
        // (potential revenue if everything sells). Accessories contribute cost only.
        const stockValueAtCost =
            products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.cost_price || 0), 0)
            + (accessories || []).reduce((s, a) => s + Number(a.stock || 0) * Number(a.cost_price || 0), 0);
        const stockValueAtSelling =
            products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.selling_price || 0), 0);

        // "Sold" = units from orders that were actually DELIVERED. Previously
        // the loop counted every order_items row regardless of parent order
        // status, so cancelled / fake / double / blacklisted rows inflated
        // "units sold", per-product "sold", revenue and COGS on the Top
        // Products table. Inventory performance numbers now match the P&L
        // contract (delivered = category-strict).
        const productSales: Record<string, { name: string; image_url: string | null; sold: number; revenue: number; cost: number }> = {};
        (orderItems || []).forEach(item => {
            const joined = item.orders;
            if (!isInRange(joined?.date ?? null)) return;
            const pkgId = joined?.package_status_id;
            if (!pkgId || !deliveredPkgIds.has(pkgId)) return;
            const pid = item.product_id;
            if (!pid) return;
            const product = products.find(p => p.id === pid);
            if (!product) return;
            if (!productSales[pid]) productSales[pid] = { name: product.name, image_url: product.image_url, sold: 0, revenue: 0, cost: 0 };
            const qty = Number(item.quantity || 0);
            // Snapshot COGS preferred (matches P&L). Falls back to current
            // products.cost_price when the snapshot is missing on legacy rows.
            const snap = Number(item.product_unit_cost_snapshot || 0);
            const unitCost = snap > 0 ? snap : Number(product.cost_price || 0);
            productSales[pid].sold += qty;
            productSales[pid].revenue += qty * Number(item.unit_price || 0);
            productSales[pid].cost += qty * unitCost;
        });

        const productPerformance = Object.values(productSales)
            .sort((a, b) => b.sold - a.sold)
            .map(p => ({
                ...p,
                margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0,
            }));

        const totalUnitsSold = productPerformance.reduce((s, p) => s + p.sold, 0);

        const filteredTransactions = (transactions || []).filter(t => isInRange(t.date));
        const totalTransactionValue = filteredTransactions.reduce((s, t) => s + Number(t.total_price || 0), 0);
        const totalPaid = filteredTransactions.reduce((s, t) => s + Number(t.paid_price || 0), 0);
        const unpaidAmount = totalTransactionValue - totalPaid;

        return {
            totalProducts, activeProducts, totalAccessories,
            lowStockProducts, lowStockAccessories,
            stockValueAtCost, stockValueAtSelling,
            totalUnitsSold, productPerformance,
            totalTransactionValue, unpaidAmount,
        };
    }, [products, accessories, orderItems, transactions, dateFilter, deliveredPkgIds]);

    return (
        <SectionWrapper
            id="inventory"
            title="Inventory & Products"
            description={`Stock at cost + at selling price. Flagged below ${LOW_STOCK_THRESHOLD} units.`}
            icon={PackageOpen}
            iconColor="text-ant-mid"
            loading={isLoading}
        >
            {metrics && (() => {
                const lowStockTotal = metrics.lowStockProducts.length + metrics.lowStockAccessories.length;
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

                    {(metrics.lowStockProducts.length > 0 || metrics.lowStockAccessories.length > 0) && (() => {
                        type LowStockRow = {
                            id: string;
                            name: string;
                            kind: 'Product' | 'Accessory';
                            stock: number;
                            cost: number;
                            image: string | null;
                        };
                        const rows: LowStockRow[] = [
                            ...metrics.lowStockProducts.map((p) => ({
                                id: p.id,
                                name: p.name,
                                kind: 'Product' as const,
                                stock: Number(p.stock || 0),
                                cost: Number(p.cost_price || 0),
                                image: p.image_url,
                            })),
                            ...metrics.lowStockAccessories.map((a) => ({
                                id: a.id,
                                name: a.name,
                                kind: 'Accessory' as const,
                                stock: Number(a.stock || 0),
                                cost: Number(a.cost_price || 0),
                                image: null,
                            })),
                        ].sort((a, b) => a.stock - b.stock);

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
                                                    const atRisk = r.stock * r.cost;
                                                    return (
                                                        <tr key={`${r.kind}-${r.id}`} className="border-b border-ant-line hover:bg-ant-rose/10 transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {r.image ? (
                                                                        <img src={r.image} alt={r.name} className="w-6 h-6 rounded-sm object-cover border border-ant-ink/5 shrink-0" />
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-sm bg-ant-ink/[0.04] flex items-center justify-center shrink-0">
                                                                            <Box className="w-3 h-3 text-ant-line" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{r.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-ant-mid">
                                                                {r.kind}
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${stockTone}`}>
                                                                {r.stock} left
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {r.cost.toLocaleString('fr-MA')}
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
