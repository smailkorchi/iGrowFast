import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    commissionAccruedForDeliveredOrder,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Radar, User } from 'lucide-react';
import { getPlatformSource } from '@/lib/campaignConstants';
import { format, startOfDay, endOfDay, isWithinInterval, subDays } from 'date-fns';

interface MediaBuyersSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

type MBRow = {
    id: string;
    name: string;
    avatar_url: string | null;
    active: boolean | null;
    commission_price: number | null;
    payment_type: string | null;
    salary_amount: number | null;
};

type EntryRow = {
    entry_date: string;
    spend: number | null;
    leads: number | null;
    platform: string;
    created_by: string | null;
};

type CampaignRow = {
    id: string;
    created_by: string | null;
    status: 'active' | 'draft' | 'deleted' | string;
};

type MBOrderItem = {
    product_id: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
    accessory_id: string | null;
    accessory_quantity: number | null;
    accessory_unit_price: number | null;
};

type MBOrderRow = {
    id: string;
    date: string | null;
    source_name: string | null;
    seller_id: string | null;
    price: number | null;
    raw_price: number | null;
    shipping_cost: number | null;
    include_delivery_in_total: boolean | null;
    package_status_id: string | null;
    package_status_label: string | null;
    package_statuses: { label?: string | null; category?: string | null } | null;
    order_items: MBOrderItem[] | null;
};

type SellerRow = {
    id: string;
    commission_price: number | null;
    commission_basis: string | null;
    products: unknown;
};

type ProductRow = { id: string; cost_price: number | null };
type AccessoryRow = { id: string; cost_price: number | null };

/** Product-line revenue only (no shipping). Accessories are cost-only — never in revenue. */
function productRevenueExcludingShipping(o: MBOrderRow): number {
    const items = o.order_items || [];
    let sum = 0;
    for (const oi of items) {
        if (!oi?.product_id) continue;
        const q = Number(oi.quantity) || 0;
        if (q <= 0) continue;
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

export const MediaBuyersSection = ({ businessId, dateFilter }: MediaBuyersSectionProps) => {
    const { deliveredPkgIds } = useStatusCategories();

    const rangeStart = dateFilter.from || subDays(new Date(), 30);
    const rangeEnd = dateFilter.to || new Date();
    const fromYmd = format(rangeStart, 'yyyy-MM-dd');
    const toYmd = format(rangeEnd, 'yyyy-MM-dd');

    const { data: mediaBuyers, isLoading: loadingMBs } = useQuery({
        queryKey: ['analytics-mediabuyers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, name, avatar_url, active, commission_price, payment_type, salary_amount')
                .eq('role', 'mediabuyer')
                .eq('DigiCom Business', businessId);
            return (data || []) as unknown as MBRow[];
        },
        enabled: !!businessId,
    });

    const { data: entries, isLoading: loadingEntries } = useQuery({
        queryKey: ['analytics-mb-entries', businessId, fromYmd, toYmd],
        queryFn: async () => {
            const { data } = await supabase
                .from('campaign_daily_entries')
                .select('entry_date, spend, leads, platform, created_by')
                .eq('DigiCom Business', businessId)
                .gte('entry_date', fromYmd)
                .lte('entry_date', toYmd);
            return (data || []) as unknown as EntryRow[];
        },
        enabled: !!businessId,
    });

    const { data: campaigns } = useQuery({
        queryKey: ['analytics-mb-campaigns', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('campaigns')
                .select('id, created_by, status')
                .eq('DigiCom Business', businessId);
            return (data || []) as unknown as CampaignRow[];
        },
        enabled: !!businessId,
    });

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['analytics-mb-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, date, source_name, seller_id, price, raw_price, shipping_cost, include_delivery_in_total, package_status_id, package_status_label, package_statuses(label, category), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price)'
                )
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return (data || []) as unknown as MBOrderRow[];
        },
        enabled: !!businessId,
    });

    const { data: sellers } = useQuery({
        queryKey: ['analytics-mb-sellers', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('users')
                .select('id, commission_price, commission_basis, products')
                .eq('role', 'commercial')
                .eq('DigiCom Business', businessId);
            return (data || []) as unknown as SellerRow[];
        },
        enabled: !!businessId,
    });

    const { data: products } = useQuery({
        queryKey: ['dashboard-products', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('products')
                .select('id, cost_price')
                .eq('DigiCom Business', businessId);
            return (data || []) as unknown as ProductRow[];
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
            return (data || []) as unknown as AccessoryRow[];
        },
        enabled: !!businessId,
    });

    const isLoading = loadingMBs || loadingEntries || loadingOrders;

    const metrics = useMemo(() => {
        if (!mediaBuyers || !entries || !orders) return null;

        const inWindow = (dateStr: string | null) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const productCost = new Map<string, number>();
        (products || []).forEach((p) => productCost.set(p.id, Number(p.cost_price || 0)));
        const accessoryCost = new Map<string, number>();
        (accessories || []).forEach((a) => accessoryCost.set(a.id, Number(a.cost_price || 0)));

        const sellerById = new Map<string, SellerRow>();
        (sellers || []).forEach((s) => sellerById.set(s.id, s));

        const sellerCommissionForOrder = (o: MBOrderRow): number => {
            if (!o.seller_id) return 0;
            const seller = sellerById.get(o.seller_id);
            if (!seller) return 0;
            const basis: CommissionBasis = normalizeCommissionBasis(seller.commission_basis);
            const commissionPrice = Number(seller.commission_price ?? 0) || 0;
            if (commissionPrice <= 0) return 0;
            const sellerProductIds: string[] = Array.isArray(seller.products)
                ? (seller.products as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];
            return commissionAccruedForDeliveredOrder({
                order: o,
                basis,
                commissionPrice,
                sellerProductIds,
            });
        };

        const orderCogs = (o: MBOrderRow): number => {
            let cogs = 0;
            for (const oi of o.order_items || []) {
                if (oi.product_id) {
                    const q = Number(oi.quantity) || 0;
                    if (q > 0) cogs += (productCost.get(oi.product_id) || 0) * q;
                }
                if (oi.accessory_id) {
                    const aq = Number(oi.accessory_quantity) || 0;
                    if (aq > 0) {
                        const snap = Number(oi.accessory_unit_price);
                        const unit = Number.isFinite(snap) && snap > 0
                            ? snap
                            : (accessoryCost.get(oi.accessory_id) || 0);
                        cogs += unit * aq;
                    }
                }
            }
            return cogs;
        };

        // Bucket delivered orders by (day, source) once. Each bucket carries aggregated
        // revenue / cogs / shipping / seller-commission so per-MB attribution is a
        // simple lookup keyed on the (date, source) pairs the MB actually ran.
        type Bucket = {
            leads: number;
            delivered: number;
            revenue: number;
            cogs: number;
            shipping: number;
            sellerCommission: number;
        };
        const orderBucket = new Map<string, Bucket>();
        orders.forEach((o) => {
            if (!o.date || !o.source_name) return;
            if (!inWindow(o.date)) return;
            const d = format(new Date(o.date), 'yyyy-MM-dd');
            const key = `${d}|${o.source_name.toLowerCase()}`;
            const b = orderBucket.get(key) || {
                leads: 0,
                delivered: 0,
                revenue: 0,
                cogs: 0,
                shipping: 0,
                sellerCommission: 0,
            };
            b.leads += 1;
            if (isDeliveredForCommission(o, deliveredPkgIds)) {
                b.delivered += 1;
                b.revenue += productRevenueExcludingShipping(o);
                b.cogs += orderCogs(o);
                b.shipping += Number(o.shipping_cost || 0);
                b.sellerCommission += sellerCommissionForOrder(o);
            }
            orderBucket.set(key, b);
        });

        const campaignsByOwner = new Map<string, number>();
        (campaigns || []).forEach((c) => {
            if (!c.created_by) return;
            campaignsByOwner.set(c.created_by, (campaignsByOwner.get(c.created_by) || 0) + 1);
        });

        const perMB = mediaBuyers.map((mb) => {
            const own = entries.filter((e) => e.created_by === mb.id);
            const spend = own.reduce((s, e) => s + Number(e.spend || 0), 0);
            const loggedLeads = own.reduce((s, e) => s + Number(e.leads || 0), 0);

            // De-duplicate orders by (day, source) so multi-campaign same-day attribution
            // doesn't double count — same convention as useMediaBuyerStats.
            const seenKeys = new Set<string>();
            own.forEach((e) => {
                const src = getPlatformSource(e.platform);
                seenKeys.add(`${e.entry_date}|${src.toLowerCase()}`);
            });

            let attributedOrders = 0;
            let attributedDelivered = 0;
            let revenue = 0;
            let cogs = 0;
            let shipping = 0;
            let sellerCommission = 0;
            seenKeys.forEach((k) => {
                const b = orderBucket.get(k);
                if (!b) return;
                attributedOrders += b.leads;
                attributedDelivered += b.delivered;
                revenue += b.revenue;
                cogs += b.cogs;
                shipping += b.shipping;
                sellerCommission += b.sellerCommission;
            });

            // MB's own payout that is directly attributable to these campaigns.
            // Commission-based MBs earn per delivered order; salary MBs are a flat
            // overhead unrelated to campaign volume, so salary is excluded here.
            const mbCommissionRate = mb.payment_type === 'commission' ? Number(mb.commission_price || 0) : 0;
            const mbCommission = attributedDelivered * mbCommissionRate;

            const netProfit = revenue - cogs - shipping - sellerCommission - mbCommission - spend;
            const grossMargin = revenue - cogs - shipping - sellerCommission - mbCommission;
            const roas = spend > 0 ? revenue / spend : 0;
            const costPerDelivered = attributedDelivered > 0 ? spend / attributedDelivered : 0;

            return {
                ...mb,
                spend,
                loggedLeads,
                attributedOrders,
                attributedDelivered,
                revenue,
                cogs,
                shipping,
                sellerCommission,
                mbCommission,
                grossMargin,
                netProfit,
                roas,
                costPerDelivered,
                campaignsRun: campaignsByOwner.get(mb.id) || 0,
            };
        });

        const sorted = [...perMB].sort((a, b) => b.netProfit - a.netProfit);
        const activeMBs = mediaBuyers.filter((m) => m.active !== false).length;
        const totalSpend = sorted.reduce((s, m) => s + m.spend, 0);
        const totalRevenue = sorted.reduce((s, m) => s + m.revenue, 0);
        const totalCogs = sorted.reduce((s, m) => s + m.cogs, 0);
        const totalShipping = sorted.reduce((s, m) => s + m.shipping, 0);
        const totalSellerCommission = sorted.reduce((s, m) => s + m.sellerCommission, 0);
        const totalMbCommission = sorted.reduce((s, m) => s + m.mbCommission, 0);
        const totalNetProfit = sorted.reduce((s, m) => s + m.netProfit, 0);
        const totalDelivered = sorted.reduce((s, m) => s + m.attributedDelivered, 0);
        const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const top = sorted[0];

        return {
            perMB: sorted,
            totalMBs: mediaBuyers.length,
            activeMBs,
            totalSpend,
            totalRevenue,
            totalCogs,
            totalShipping,
            totalSellerCommission,
            totalMbCommission,
            totalNetProfit,
            totalDelivered,
            overallRoas,
            top,
        };
    }, [mediaBuyers, entries, orders, campaigns, sellers, products, accessories, dateFilter, deliveredPkgIds]);

    return (
        <SectionWrapper
            id="mediabuyers"
            title="Media Buyers"
            description="Attributed revenue, all-in costs, and net profit per media buyer"
            icon={Radar}
            iconColor="text-gray-400"
            loading={isLoading}
        >
            {metrics && (() => {
                const profitTone: 'positive' | 'warning' | 'negative' =
                    metrics.totalNetProfit > 0 ? 'positive' : metrics.totalNetProfit === 0 ? 'warning' : 'negative';
                const narrative = metrics.totalMBs === 0
                    ? 'No media buyers on the team yet.'
                    : metrics.totalSpend === 0
                        ? `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} on roster, but no ad spend logged in this period.`
                        : metrics.totalNetProfit >= 0
                            ? `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} drove ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD in attributed revenue on ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD spend (${metrics.overallRoas.toFixed(2)}x ROAS), netting ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD after COGS, shipping, seller and buyer commissions.${
                                  metrics.top ? ` ${metrics.top.name} leads with ${Math.round(metrics.top.netProfit).toLocaleString('fr-MA')} MAD net.` : ''
                              }`
                            : `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} spent ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD and returned ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD (${metrics.overallRoas.toFixed(2)}x ROAS), but net is ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD once COGS, shipping, seller and buyer commissions are removed. Campaigns need review.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'net profit',
                            value: `${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD`,
                            tone: profitTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Spend', value: `${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD`, tone: 'negative' },
                            { label: 'Revenue', value: `${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD`, tone: 'positive' },
                            { label: 'COGS + shipping', value: `${Math.round(metrics.totalCogs + metrics.totalShipping).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'Seller comm.', value: `${Math.round(metrics.totalSellerCommission).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'Buyer comm.', value: `${Math.round(metrics.totalMbCommission).toLocaleString('fr-MA')} MAD`, tone: 'warning' },
                            { label: 'ROAS', value: `${metrics.overallRoas.toFixed(2)}x`, tone: metrics.overallRoas >= 2 ? 'positive' : metrics.overallRoas >= 1 ? 'warning' : 'negative' },
                        ]}
                    >
                        {metrics.perMB.length > 0 && (
                            <Card className="border border-gray-100 shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-brand-navy">Media buyer leaderboard</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-gray-100">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Buyer</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Spend</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Delivered</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Revenue</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">COGS + ship</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Seller comm.</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Buyer comm.</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">ROAS</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Net profit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.perMB.map((m) => {
                                                    const roasTone =
                                                        m.roas >= 2 ? 'text-emerald-600' : m.roas >= 1 ? 'text-amber-600' : 'text-red-500';
                                                    const netTone = m.netProfit > 0 ? 'text-emerald-600' : m.netProfit === 0 ? 'text-gray-500' : 'text-red-500';
                                                    return (
                                                        <tr key={m.id} className="border-b border-gray-50 hover:bg-brand-navy/[0.02] transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {m.avatar_url ? (
                                                                        <img src={m.avatar_url} alt={m.name} className="w-6 h-6 rounded-full object-cover border border-brand-navy/5 shrink-0" />
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-full bg-brand-navy/[0.04] flex items-center justify-center shrink-0">
                                                                            <User className="w-3 h-3 text-brand-navy/20" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[11px] font-medium text-brand-navy truncate">{m.name || 'Unnamed'}</span>
                                                                    {m.active === false && (
                                                                        <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-red-400">· inactive</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">
                                                                {Math.round(m.spend).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-brand-navy tabular-nums">{m.attributedDelivered}</td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-emerald-600 tabular-nums">
                                                                {Math.round(m.revenue).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">
                                                                {Math.round(m.cogs + m.shipping).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">
                                                                {Math.round(m.sellerCommission).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-gray-500 tabular-nums">
                                                                {Math.round(m.mbCommission).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-brand-navy/40 ml-0.5">MAD</span>
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${roasTone}`}>
                                                                {m.roas.toFixed(2)}x
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${netTone}`}>
                                                                {Math.round(m.netProfit).toLocaleString('fr-MA')}
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
                        )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
