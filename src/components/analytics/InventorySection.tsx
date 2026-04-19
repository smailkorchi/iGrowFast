import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PackageOpen, AlertTriangle, Box } from 'lucide-react';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { LOW_STOCK_THRESHOLD } from '@/lib/analyticsDefinitions';

interface InventorySectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const InventorySection = ({ businessId, dateFilter }: InventorySectionProps) => {
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

    const { data: orderItems } = useQuery({
        queryKey: ['analytics-order-items-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('order_items').select('id, product_id, quantity, unit_price, accessory_id, accessory_quantity, order_id, orders(date, order_status_id, package_status_id)').eq('DigiCom Business', businessId);
            return data || [];
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

    const { data: trnsPurchases } = useQuery({
        queryKey: ['analytics-trns-purchase-inv', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('trns_purchase').select('id, product_id, quantity, sub_total, accessory_id, accessory_quantity, accessory_sub_total, transaction_id').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
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

        const productSales: Record<string, { name: string; image_url: string | null; sold: number; revenue: number; cost: number }> = {};
        (orderItems || []).forEach(item => {
            const orderDate = (item as { orders?: { date?: string } }).orders?.date;
            if (!isInRange(orderDate)) return;
            const pid = item.product_id;
            const product = products.find(p => p.id === pid);
            if (!product) return;
            if (!productSales[pid]) productSales[pid] = { name: product.name, image_url: product.image_url, sold: 0, revenue: 0, cost: 0 };
            productSales[pid].sold += Number(item.quantity || 0);
            productSales[pid].revenue += Number(item.quantity || 0) * Number(item.unit_price || 0);
            productSales[pid].cost += Number(item.quantity || 0) * Number(product.cost_price || 0);
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
    }, [products, accessories, orderItems, transactions, dateFilter]);

    return (
        <SectionWrapper
            id="inventory"
            title="Inventory & Products"
            description={`Stock at cost + at selling price. Flagged below ${LOW_STOCK_THRESHOLD} units.`}
            icon={PackageOpen}
            iconColor="text-gray-400"
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
                        <Card className="border border-gray-100 shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <CardTitle className="text-[12px] font-semibold text-brand-navy">Top products</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-100">
                                                <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Product</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Sold</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Revenue</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Cost</th>
                                                <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Margin</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {metrics.productPerformance.slice(0, 10).map((p, i) => {
                                                const marginTone =
                                                    p.margin > 30 ? 'text-emerald-600' : p.margin > 0 ? 'text-amber-600' : 'text-red-500';
                                                return (
                                                    <tr key={i} className="border-b border-gray-50 hover:bg-brand-navy/[0.02] transition-colors">
                                                        <td className="py-1.5">
                                                            <div className="flex items-center gap-2">
                                                                {p.image_url ? (
                                                                    <img src={p.image_url} alt={p.name} className="w-6 h-6 rounded-sm object-cover border border-brand-navy/5 shrink-0" />
                                                                ) : (
                                                                    <div className="w-6 h-6 rounded-sm bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                        <Box className="w-3 h-3 text-brand-navy/20" />
                                                                    </div>
                                                                )}
                                                                <span className="text-[11px] font-medium text-brand-navy truncate">{p.name}</span>
                                                            </div>
                                                        </td>
                                                        <td className="py-1.5 text-right text-[11px] font-semibold text-brand-navy tabular-nums">{p.sold}</td>
                                                        <td className="py-1.5 text-right text-[11px] tabular-nums">{p.revenue.toLocaleString('fr-MA')} <span className="text-[9px] text-brand-navy/40">MAD</span></td>
                                                        <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">{p.cost.toLocaleString('fr-MA')} <span className="text-[9px] text-brand-navy/40">MAD</span></td>
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
                            <Card className="border border-red-100 shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-red-600 flex items-center gap-1.5">
                                        <AlertTriangle className="w-3 h-3" /> Low stock — {rows.length} item{rows.length > 1 ? 's' : ''}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Item</th>
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Kind</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Stock</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Unit cost</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">At risk</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((r) => {
                                                    const stockTone =
                                                        r.stock === 0 ? 'text-red-600' : r.stock <= 2 ? 'text-red-500' : 'text-amber-600';
                                                    const atRisk = r.stock * r.cost;
                                                    return (
                                                        <tr key={`${r.kind}-${r.id}`} className="border-b border-gray-50 hover:bg-red-50/30 transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {r.image ? (
                                                                        <img src={r.image} alt={r.name} className="w-6 h-6 rounded-sm object-cover border border-brand-navy/5 shrink-0" />
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-sm bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                            <Box className="w-3 h-3 text-brand-navy/20" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[11px] font-medium text-brand-navy truncate">{r.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-gray-400">
                                                                {r.kind}
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${stockTone}`}>
                                                                {r.stock} left
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">
                                                                {r.cost.toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-brand-navy tabular-nums">
                                                                {atRisk.toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
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
