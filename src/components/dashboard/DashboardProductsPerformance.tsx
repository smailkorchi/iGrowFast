import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ShoppingBag, Box, ChevronDown } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

interface DashboardProductsPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

const CONFIRMED_CODES = new Set(['CONFIRMED', 'PAID', 'UNPAID', 'PROCESSED']);

export const DashboardProductsPerformance = ({ businessId, dateFilter }: DashboardProductsPerformanceProps) => {
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

    const toggleProduct = (id: string) => {
        setExpandedProducts(prev => {
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

    const { data: orderItems } = useQuery({
        queryKey: ['dashboard-order-items', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('order_items')
                .select('id, order_id, product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price')
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

    const { data: orders } = useQuery({
        queryKey: ['dashboard-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, price, shipping_cost, order_status_id, package_status_id, package_status_label, seller_id, company_id, source_name, order_statuses(code, label)')
                .eq('DigiCom Business', businessId);
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

    const { data: sellerPayments } = useQuery({
        queryKey: ['dashboard-seller-payments-products', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('seller_payments')
                .select('id, total_amount, status, created_at')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!products || !orderItems || !orders) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filteredOrders = orders.filter((o: any) => isInRange(o.date));
        const filteredOrderIds = new Set(filteredOrders.map((o: any) => o.id));
        const orderMap = new Map<string, any>();
        filteredOrders.forEach((o: any) => orderMap.set(o.id, o));

        const accessoryCostMap = new Map<string, number>();
        (accessories || []).forEach((a: any) => accessoryCostMap.set(a.id, Number(a.cost_price || 0)));

        const filteredAds = (adsHistory || []).filter((a: any) => isInRange(a.start_date));
        const adsByProduct = new Map<string, number>();
        filteredAds.forEach((a: any) => {
            if (a.product_id) {
                adsByProduct.set(a.product_id, (adsByProduct.get(a.product_id) || 0) + Number(a.amount || 0));
            }
        });

        const filteredPayments = (sellerPayments || []).filter((sp: any) => isInRange(sp.created_at));
        const totalSellerPayments = filteredPayments.reduce((s: number, sp: any) => s + Number(sp.total_amount || 0), 0);

        // First pass: count total delivered units across all products for confirmation cost rate
        let globalDeliveredUnits = 0;
        const filteredItems = orderItems.filter((oi: any) => filteredOrderIds.has(oi.order_id));
        filteredItems.forEach((oi: any) => {
            const order = orderMap.get(oi.order_id);
            if (order && (order.package_status_label || '').toLowerCase() === 'livré') {
                globalDeliveredUnits += Number(oi.quantity || 1);
            }
        });
        const confirmationCostPerUnit = globalDeliveredUnits > 0 ? totalSellerPayments / globalDeliveredUnits : 0;

        // Build a map of total quantity per order (for shipping cost allocation)
        const orderTotalQty = new Map<string, number>();
        filteredItems.forEach((oi: any) => {
            const current = orderTotalQty.get(oi.order_id) || 0;
            orderTotalQty.set(oi.order_id, current + Number(oi.quantity || 1));
        });

        const productData = products.map((product: any) => {
            const items = filteredItems.filter((oi: any) => oi.product_id === product.id);
            const totalOrderedUnits = items.reduce((s: number, oi: any) => s + Number(oi.quantity || 1), 0);

            let deliveredUnits = 0;
            let confirmedUnits = 0;
            let sellingTotal = 0;
            let shippingTotal = 0;
            let accessoriesTotal = 0;

            items.forEach((oi: any) => {
                const order = orderMap.get(oi.order_id);
                if (!order) return;
                const code = ((order.order_statuses as any)?.code || '').toUpperCase();
                const qty = Number(oi.quantity || 1);

                if (CONFIRMED_CODES.has(code)) confirmedUnits += qty;

                if ((order.package_status_label || '').toLowerCase() === 'livré') {
                    deliveredUnits += qty;
                    sellingTotal += Number(oi.total_price || 0) || (Number(oi.unit_price || 0) * qty);

                    const totalQtyInOrder = orderTotalQty.get(oi.order_id) || 1;
                    const shippingShare = (Number(order.shipping_cost || 0) * qty) / totalQtyInOrder;
                    shippingTotal += shippingShare;

                    if (oi.accessory_id) {
                        const accCost = accessoryCostMap.get(oi.accessory_id) || 0;
                        accessoriesTotal += accCost * Number(oi.accessory_quantity || 0);
                    }
                }
            });

            const unitBuyingPrice = Number(product.cost_price || 0);
            const unitSellingPrice = Number(product.selling_price || 0);
            const unitShippingCost = deliveredUnits > 0 ? shippingTotal / deliveredUnits : 0;
            const unitConfirmationCost = confirmationCostPerUnit;

            const adsTotal = adsByProduct.get(product.id) || 0;
            const unitAdsCost = totalOrderedUnits > 0 ? adsTotal / totalOrderedUnits : 0;
            const unitDeliveryAdsCost = deliveredUnits > 0 ? adsTotal / deliveredUnits : 0;

            const unitAccessoriesCost = deliveredUnits > 0 ? accessoriesTotal / deliveredUnits : 0;

            const buyingTotal = deliveredUnits * unitBuyingPrice;
            const confirmationTotal = deliveredUnits * unitConfirmationCost;
            const deliveredPercent = totalOrderedUnits > 0 ? (deliveredUnits / totalOrderedUnits) * 100 : 0;

            const netProfit = sellingTotal - buyingTotal - shippingTotal - confirmationTotal - adsTotal - accessoriesTotal;

            return {
                id: product.id,
                name: product.name,
                image_url: product.image_url,
                stock: Number(product.stock || 0),
                active: product.active,
                totalOrderedUnits,
                deliveredUnits,
                deliveredPercent,
                confirmedUnits,
                unitBuyingPrice,
                unitSellingPrice,
                unitShippingCost,
                unitConfirmationCost,
                unitAdsCost,
                unitDeliveryAdsCost,
                unitAccessoriesCost,
                sellingTotal,
                buyingTotal,
                shippingTotal,
                confirmationTotal,
                adsTotal,
                accessoriesTotal,
                netProfit,
            };
        }).sort((a, b) => b.deliveredUnits - a.deliveredUnits);

        return { productData };
    }, [products, orderItems, orders, accessories, adsHistory, sellerPayments, dateFilter]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Products Performance</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{metrics.productData.length} products tracked</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
                {metrics.productData.map((p) => {
                    const isExpanded = expandedProducts.has(p.id);
                    return (
                        <div
                            key={p.id}
                            className={cn(
                                'border rounded-2xl overflow-hidden transition-all',
                                isExpanded ? 'border-gray-200 shadow-sm' : 'border-gray-100'
                            )}
                        >
                            <button
                                onClick={() => toggleProduct(p.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors text-left"
                            >
                                <div className="flex items-center gap-2.5 min-w-[140px] shrink-0">
                                    {p.image_url ? (
                                        <img src={p.image_url} alt="" className="w-9 h-9 rounded-xl object-cover bg-gray-100 shrink-0" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                                            <Box className="w-4 h-4 text-gray-400" />
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <span className="font-bold text-brand-navy text-xs block truncate max-w-[120px]">{p.name}</span>
                                        {!p.active && <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5">Inactive</Badge>}
                                    </div>
                                </div>

                                <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Stock</p>
                                        <Badge className={cn(
                                            'text-[10px] px-1.5 py-0 font-bold mt-0.5',
                                            p.stock > 10 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                            p.stock > 0 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                            'bg-red-50 text-red-600 hover:bg-red-50'
                                        )}>
                                            {p.stock}
                                        </Badge>
                                    </div>

                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Delivered</p>
                                        <p className="text-sm font-bold text-brand-navy leading-tight mt-0.5">{p.deliveredUnits}</p>
                                        <Badge className={cn(
                                            'text-[9px] px-1.5 py-0 font-bold',
                                            p.deliveredPercent >= 40 ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50' :
                                            p.deliveredPercent >= 20 ? 'bg-amber-50 text-amber-600 hover:bg-amber-50' :
                                            'bg-red-50 text-red-600 hover:bg-red-50'
                                        )}>
                                            {p.deliveredPercent.toFixed(1)}%
                                        </Badge>
                                    </div>

                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Revenue</p>
                                        <p className="text-sm font-bold text-brand-navy leading-tight mt-0.5">
                                            {p.sellingTotal.toLocaleString('fr-MA')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">MAD</p>
                                    </div>

                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Costs</p>
                                        <p className="text-sm font-bold text-red-500 leading-tight mt-0.5">
                                            {(p.buyingTotal + p.shippingTotal + p.confirmationTotal + p.adsTotal + p.accessoriesTotal).toLocaleString('fr-MA')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">MAD</p>
                                    </div>

                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Net Profit</p>
                                        <p className={cn(
                                            'text-sm font-bold leading-tight mt-0.5',
                                            p.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'
                                        )}>
                                            {p.netProfit.toLocaleString('fr-MA')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">MAD</p>
                                    </div>
                                </div>

                                <ChevronDown className={cn(
                                    'w-4 h-4 text-gray-400 transition-transform shrink-0',
                                    isExpanded && 'rotate-180'
                                )} />
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/30">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <CostTable
                                            title="Unit Costs"
                                            rows={[
                                                { label: 'Selling Price', value: p.unitSellingPrice, color: 'text-brand-navy' },
                                                { label: 'Buying Price', value: p.unitBuyingPrice, color: 'text-red-500' },
                                                { label: 'Shipping', value: p.unitShippingCost, color: 'text-red-500' },
                                                { label: 'Confirmation', value: p.unitConfirmationCost, color: 'text-red-500' },
                                                { label: 'Ads (per order)', value: p.unitAdsCost, color: 'text-red-500' },
                                                { label: 'Ads (per delivery)', value: p.unitDeliveryAdsCost, color: 'text-red-500' },
                                                { label: 'Accessories', value: p.unitAccessoriesCost, color: 'text-red-500' },
                                            ]}
                                        />
                                        <CostTable
                                            title="Total Costs"
                                            rows={[
                                                { label: 'Selling Total', value: p.sellingTotal, color: 'text-brand-navy' },
                                                { label: 'Buying Total', value: p.buyingTotal, color: 'text-red-500' },
                                                { label: 'Shipping Total', value: p.shippingTotal, color: 'text-red-500' },
                                                { label: 'Confirmation Total', value: p.confirmationTotal, color: 'text-red-500' },
                                                { label: 'Ads Total', value: p.adsTotal, color: 'text-red-500' },
                                                { label: 'Accessories Total', value: p.accessoriesTotal, color: 'text-red-500' },
                                            ]}
                                            footer={{ label: 'Net Profit', value: p.netProfit, color: p.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600' }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {metrics.productData.length === 0 && (
                    <p className="text-center py-8 text-gray-400 text-xs">No products found</p>
                )}
            </CardContent>
        </Card>
    );
};

function CostTable({ title, rows, footer }: {
    title: string;
    rows: { label: string; value: number; color: string }[];
    footer?: { label: string; value: number; color: string };
}) {
    return (
        <div>
            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</h5>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-xs">
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.label} className="border-b border-gray-50 last:border-b-0">
                                <td className="py-1.5 px-3 text-gray-500 font-medium">{row.label}</td>
                                <td className={cn('py-1.5 px-3 text-right font-bold tabular-nums', row.color)}>
                                    {row.value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-[9px] text-gray-400 ml-0.5">MAD</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {footer && (
                        <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-gray-50/50">
                                <td className="py-2 px-3 font-bold text-brand-navy text-xs">{footer.label}</td>
                                <td className={cn('py-2 px-3 text-right font-bold text-sm tabular-nums', footer.color)}>
                                    {footer.value.toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-[9px] text-gray-400 ml-0.5">MAD</span>
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}
