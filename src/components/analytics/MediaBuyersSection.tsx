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
import { normalizeSource, pureRevenueForOrder } from '@/lib/analyticsDefinitions';
import { differenceInCalendarDays, format, startOfDay, endOfDay, isWithinInterval } from 'date-fns';

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

export const MediaBuyersSection = ({ businessId, dateFilter }: MediaBuyersSectionProps) => {
    const { deliveredPkgIds } = useStatusCategories();

    // For All-Time (no explicit filter), pass a very early date so the server
    // query returns every entry. Earlier behaviour used a 30-day fallback,
    // which truncated MB spend on All-Time while orders stayed unbounded,
    // inflating ROAS.
    const rangeStart = dateFilter.from || new Date('2020-01-01');
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

    const { data: orders, isLoading: loadingOrders } = useQuery({
        queryKey: ['analytics-mb-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, date, source_name, seller_id, price, raw_price, shipping_cost, include_delivery_in_total, package_status_id, package_status_label, package_statuses(label, category), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price)'
                )
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null).neq('source_review_status', 'pending');
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

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();
        const inWindow = (dateStr: string | null) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return isWithinInterval(d, { start: windowStart, end: windowEnd });
        };

        // Window day count — used to pro-rate salary-MBs' monthly salary_amount
        // into an attributable cost for the selected period. All-Time is capped
        // at the span from the earliest entry/order date to today.
        const windowDays = (() => {
            if (dateFilter.from && dateFilter.to) {
                return Math.max(1, differenceInCalendarDays(windowEnd, windowStart) + 1);
            }
            const ts: number[] = [];
            entries.forEach((e) => {
                if (e.entry_date) {
                    const t = new Date(e.entry_date).getTime();
                    if (!Number.isNaN(t)) ts.push(t);
                }
            });
            orders.forEach((o) => {
                if (o.date) {
                    const t = new Date(o.date).getTime();
                    if (!Number.isNaN(t)) ts.push(t);
                }
            });
            if (ts.length === 0) return 30;
            const earliest = new Date(Math.min(...ts));
            return Math.max(1, differenceInCalendarDays(new Date(), earliest) + 1);
        })();

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

        // Bucket delivered orders by (day, normalized-source). Sources are
        // normalized on BOTH sides via `normalizeSource` so `orders.source_name`
        // ("facebook", "facebook ads", "Facebook") and entries' platform
        // ("Facebook ads", "facebook") collapse to the same key. Previously
        // only the entry side normalized — asymmetric and silent zero-match
        // for any mismatched casing / suffix.
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
            const src = normalizeSource(o.source_name);
            if (!src) return;
            const key = `${d}|${src}`;
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
                b.revenue += pureRevenueForOrder(o as unknown as Parameters<typeof pureRevenueForOrder>[0]);
                b.cogs += orderCogs(o);
                b.shipping += Number(o.shipping_cost || 0);
                b.sellerCommission += sellerCommissionForOrder(o);
            }
            orderBucket.set(key, b);
        });

        // Build per-MB seenKeys first, then count global claimants per bucket so
        // each MB gets a proportional share (1/N) when multiple MBs ran the
        // same (day, platform). Previously every MB got 100 % of the bucket,
        // which double-counted revenue and spending across the team totals.
        const mbKeys = new Map<string, Set<string>>();
        const claimantCount = new Map<string, number>();
        mediaBuyers.forEach((mb) => {
            const own = entries.filter((e) => e.created_by === mb.id);
            const keys = new Set<string>();
            own.forEach((e) => {
                const src = normalizeSource(e.platform);
                if (!src || !e.entry_date) return;
                keys.add(`${e.entry_date}|${src}`);
            });
            mbKeys.set(mb.id, keys);
            keys.forEach((k) => {
                claimantCount.set(k, (claimantCount.get(k) || 0) + 1);
            });
        });

        const perMB = mediaBuyers.map((mb) => {
            const own = entries.filter((e) => e.created_by === mb.id);
            const spend = own.reduce((s, e) => s + Number(e.spend || 0), 0);
            const seenKeys = mbKeys.get(mb.id) || new Set<string>();

            let attributedOrders = 0;
            let attributedDelivered = 0;
            let revenue = 0;
            let cogs = 0;
            let shipping = 0;
            let sellerCommission = 0;
            seenKeys.forEach((k) => {
                const b = orderBucket.get(k);
                if (!b) return;
                const share = 1 / (claimantCount.get(k) || 1);
                attributedOrders += b.leads * share;
                attributedDelivered += b.delivered * share;
                revenue += b.revenue * share;
                cogs += b.cogs * share;
                shipping += b.shipping * share;
                sellerCommission += b.sellerCommission * share;
            });

            // MB's own payout attributable to this period.
            // Commission MBs: rate × attributed delivered.
            // Salary MBs: monthly salary pro-rated by calendar-day window overlap
            //   (window_days / 30 × salary_amount). Covers the "all-in cost"
            //   promise in the card description.
            let mbCost = 0;
            if (mb.payment_type === 'commission') {
                mbCost = attributedDelivered * Number(mb.commission_price || 0);
            } else if (Number(mb.salary_amount || 0) > 0) {
                mbCost = (Number(mb.salary_amount || 0) * windowDays) / 30;
            }

            const netProfit = revenue - cogs - shipping - sellerCommission - mbCost - spend;
            const grossMargin = revenue - cogs - shipping - sellerCommission - mbCost;
            const roas = spend > 0 ? revenue / spend : 0;
            const costPerDelivered = attributedDelivered > 0 ? spend / attributedDelivered : 0;

            return {
                ...mb,
                spend,
                attributedOrders,
                attributedDelivered,
                revenue,
                cogs,
                shipping,
                sellerCommission,
                mbCost,
                grossMargin,
                netProfit,
                roas,
                costPerDelivered,
            };
        });

        const sorted = [...perMB].sort((a, b) => b.netProfit - a.netProfit);
        const activeMBs = mediaBuyers.filter((m) => m.active !== false).length;
        const totalSpend = sorted.reduce((s, m) => s + m.spend, 0);
        const totalRevenue = sorted.reduce((s, m) => s + m.revenue, 0);
        const totalCogs = sorted.reduce((s, m) => s + m.cogs, 0);
        const totalShipping = sorted.reduce((s, m) => s + m.shipping, 0);
        const totalSellerCommission = sorted.reduce((s, m) => s + m.sellerCommission, 0);
        const totalMbCost = sorted.reduce((s, m) => s + m.mbCost, 0);
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
            totalMbCost,
            totalNetProfit,
            totalDelivered,
            overallRoas,
            top,
        };
    }, [mediaBuyers, entries, orders, sellers, products, accessories, dateFilter, deliveredPkgIds]);

    return (
        <SectionWrapper
            id="mediabuyers"
            title="Media Buyers"
            description="Attributed revenue, all-in costs, and net profit per media buyer"
            icon={Radar}
            iconColor="text-ant-mid"
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
                            ? `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} drove ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD in attributed revenue on ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD spend (${metrics.overallRoas.toFixed(2)}x ROAS), netting ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD after COGS, shipping, seller commission, and buyer cost.${
                                  metrics.top ? ` ${metrics.top.name} leads with ${Math.round(metrics.top.netProfit).toLocaleString('fr-MA')} MAD net.` : ''
                              }`
                            : `${metrics.activeMBs} media buyer${metrics.activeMBs === 1 ? '' : 's'} spent ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD and returned ${Math.round(metrics.totalRevenue).toLocaleString('fr-MA')} MAD (${metrics.overallRoas.toFixed(2)}x ROAS), but net is ${Math.round(metrics.totalNetProfit).toLocaleString('fr-MA')} MAD once COGS, shipping, seller commission, and buyer cost are removed. Campaigns need review.`;

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
                            { label: 'Buyer cost', value: `${Math.round(metrics.totalMbCost).toLocaleString('fr-MA')} MAD`, tone: 'warning', sub: 'commission + pro-rated salary' },
                            { label: 'ROAS', value: `${metrics.overallRoas.toFixed(2)}x`, tone: metrics.overallRoas >= 2 ? 'positive' : metrics.overallRoas >= 1 ? 'warning' : 'negative' },
                        ]}
                    >
                        {metrics.perMB.length > 0 && (
                            <Card className="border border-ant-line shadow-none rounded-xl">
                                <CardHeader className="pb-1">
                                    <CardTitle className="text-[12px] font-semibold text-ant-ink">Media buyer leaderboard</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-ant-line">
                                                    <th className="text-left py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Buyer</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Spend</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Delivered</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Revenue</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">COGS + ship</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Seller comm.</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Buyer cost</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">ROAS</th>
                                                    <th className="text-right py-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-ant-mid">Net profit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.perMB.map((m) => {
                                                    const roasTone =
                                                        m.roas >= 2 ? 'text-ant-green' : m.roas >= 1 ? 'text-ant-orange' : 'text-ant-rose';
                                                    const netTone = m.netProfit > 0 ? 'text-ant-green' : m.netProfit === 0 ? 'text-ant-muted' : 'text-ant-rose';
                                                    return (
                                                        <tr key={m.id} className="border-b border-ant-line hover:bg-ant-ink/[0.02] transition-colors">
                                                            <td className="py-1.5">
                                                                <div className="flex items-center gap-2">
                                                                    {m.avatar_url ? (
                                                                        <img src={m.avatar_url} alt={m.name} className="w-6 h-6 rounded-full object-cover border border-ant-ink/5 shrink-0" />
                                                                    ) : (
                                                                        <div className="w-6 h-6 rounded-full bg-ant-ink/[0.04] flex items-center justify-center shrink-0">
                                                                            <User className="w-3 h-3 text-ant-line" />
                                                                        </div>
                                                                    )}
                                                                    <span className="text-[11px] font-medium text-ant-ink truncate">{m.name || 'Unnamed'}</span>
                                                                    {m.active === false && (
                                                                        <span className="text-[8px] uppercase tracking-[0.14em] font-bold text-ant-rose">· inactive</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.spend).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-ant-ink tabular-nums">{Math.round(m.attributedDelivered)}</td>
                                                            <td className="py-1.5 text-right text-[11px] font-semibold text-ant-green tabular-nums">
                                                                {Math.round(m.revenue).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.cogs + m.shipping).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.sellerCommission).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className="py-1.5 text-right text-[11px] text-ant-muted tabular-nums">
                                                                {Math.round(m.mbCost).toLocaleString('fr-MA')}
                                                                <span className="text-[9px] text-ant-mid ml-0.5">MAD</span>
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${roasTone}`}>
                                                                {m.roas.toFixed(2)}x
                                                            </td>
                                                            <td className={`py-1.5 text-right text-[11px] font-semibold tabular-nums ${netTone}`}>
                                                                {Math.round(m.netProfit).toLocaleString('fr-MA')}
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
                        )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
