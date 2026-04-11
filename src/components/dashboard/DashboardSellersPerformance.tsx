import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Users, ChevronDown } from 'lucide-react';
import { DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    commissionAccruedForDeliveredOrder,
    isDeliveredForCommission,
    normalizeCommissionBasis,
    type CommissionBasis,
} from '@/lib/commercialCommission';

interface DashboardSellersPerformanceProps {
    businessId: string;
    dateFilter: DateFilter;
}

const PRE_CONFIRMATION_LABELS = new Set<string>([
    'NOUVELLE COMMANDE',
    'Black liste',
    'Fausse commande',
    'ANNULER',
    'RAPPELE 1',
    'RAPPELE 2',
    'RAPPELE 3',
    'RAPPELE 4',
    'RAPPELE 5',
    'RAPPELE 6',
    'Boite vocale',
    'Boite vocale + Sms',
    'Boite vocale + message whatsup',
    'Pas de réponse',
    'Pas de réponse + SMS',
    'Pas de réponse + Message whatsup',
    'Mauvais numéro',
].map((l) => l.trim().toLowerCase()));

const POST_CONFIRMATION_LABELS = new Set<string>([
    'Client pas intéressé',
    'Mise en distribution',
    'Relancer',
    'Relancé nouveau client',
    'PRÉPARATION RETOUR',
    'RETURN',
    'Reporté',
    'Annulé',
    'Pas de réponse',
    'Refusé',
    'Hors-zone',
    'Numéro Incorrect',
    'Pas de réponse + SMS',
    'Injoignable',
    'Client na pas commandé',
    'Boite Vocal',
    'En voyage',
    'Programmé',
    'Retourné',
].map((l) => l.trim().toLowerCase()));

const normalizeLabel = (l: string | null | undefined) => (l || '').trim().toLowerCase();

// Types verified against public.{orders, order_items, order_statuses, users, ads_history} via MCP
type DSOrderItem = { product_id: string; quantity: number; unit_price: number; total_price: number | null };
type DSOrderStatuses = { code: string; label: string } | null;
type DSOrder = {
    id: string;
    date: string | null;
    price: number | null;
    raw_price: number | null;
    shipping_cost: number | null;
    include_delivery_in_total: boolean;
    order_status_id: string | null;
    package_status_id: string | null;
    package_status_label: string | null;
    seller_id: string | null;
    company_id: string | null;
    source_name: string | null;
    order_items: DSOrderItem[] | null;
    order_statuses: DSOrderStatuses;
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

const SOURCE_COLORS: Record<string, string> = {
    facebook: 'bg-blue-50 text-blue-700',
    instagram: 'bg-pink-50 text-pink-700',
    tiktok: 'bg-slate-100 text-slate-800',
    whatsapp: 'bg-emerald-50 text-emerald-700',
    'phone call': 'bg-sky-50 text-sky-700',
    connaissance: 'bg-amber-50 text-amber-700',
    reorder: 'bg-teal-50 text-teal-700',
    other: 'bg-gray-100 text-gray-600',
};

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
        confirmedIds,
        callbackIds,
        cancelledIds,
        deliveredPkgIds,
        getPkgsByCategories,
        getOrderStatusColor,
        getPkgStatusColor,
    } = useStatusCategories();

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

    /** Rich orders for net math (isolated key so shared dashboard-orders stays unchanged). */
    const { data: orders } = useQuery({
        queryKey: ['dashboard-sellers-performance-orders', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select(
                    'id, date, price, raw_price, shipping_cost, include_delivery_in_total, order_status_id, package_status_id, package_status_label, seller_id, company_id, source_name, order_items(product_id, quantity, unit_price, total_price), order_statuses(code, label)'
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

    const metrics = useMemo(() => {
        if (!sellers || !orders) return null;

        const recheckPackageIds = new Set(getPkgsByCategories(['recheck']).map((p) => p.id));
        const isExcludedFromConfirmation = (statusId: string) =>
            callbackIds.has(statusId) || cancelledIds.has(statusId);

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const ordersTyped = orders as unknown as DSOrder[];
        const filtered = ordersTyped.filter((o) => isInRange(o.date));
        const totalOrders = filtered.length;

        const filteredAds = ((adsHistory || []) as unknown as DSAd[]).filter((a) => isInRange(a.start_date));
        const adsByProduct = new Map<string, number>();
        filteredAds.forEach((a) => {
            if (a.product_id) {
                adsByProduct.set(a.product_id, (adsByProduct.get(a.product_id) || 0) + Number(a.amount || 0));
            }
        });

        const globalProductDeliveredQty = new Map<string, number>();
        filtered.forEach((o) => {
            if (!isDeliveredForCommission(o, deliveredPkgIds)) return;
            const items = o.order_items || [];
            for (const oi of items) {
                const pid = oi?.product_id;
                if (!pid) continue;
                const q = Number(oi.quantity || 1);
                globalProductDeliveredQty.set(pid, (globalProductDeliveredQty.get(pid) || 0) + q);
            }
        });

        const sellersTyped = sellers as unknown as DSSeller[];
        const sellerData = sellersTyped.map((seller) => {
            const sellerOrders = filtered.filter((o) => o.seller_id === seller.id);
            const assignedCount = sellerOrders.length;
            const assignedPercent = totalOrders > 0 ? (assignedCount / totalOrders) * 100 : 0;

            const sourceBreakdown: Record<string, number> = {};
            sellerOrders.forEach((o) => {
                const src = (o.source_name || 'other').toLowerCase();
                sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
            });

            const preConfOrders = sellerOrders.filter((o) => {
                const label = o.order_statuses?.label;
                return PRE_CONFIRMATION_LABELS.has(normalizeLabel(label));
            });
            const preConfirmationBreakdown: Record<string, { count: number; color: string }> = {};
            preConfOrders.forEach((o) => {
                const label = o.order_statuses?.label || 'Unknown';
                if (!preConfirmationBreakdown[label]) {
                    preConfirmationBreakdown[label] = {
                        count: 0,
                        color: getOrderStatusColor(o.order_status_id),
                    };
                }
                preConfirmationBreakdown[label].count += 1;
            });

            const confirmedCount = sellerOrders.filter((o) => !!o.order_status_id && confirmedIds.has(o.order_status_id)).length;
            const confirmedPercent = assignedCount > 0 ? (confirmedCount / assignedCount) * 100 : 0;

            const postConfOrders = sellerOrders.filter((o) =>
                POST_CONFIRMATION_LABELS.has(normalizeLabel(o.package_status_label))
            );
            const postConfirmationBreakdown: Record<string, { count: number; color: string }> = {};
            postConfOrders.forEach((o) => {
                const label = o.package_status_label || 'Unknown';
                if (!postConfirmationBreakdown[label]) {
                    postConfirmationBreakdown[label] = {
                        count: 0,
                        color: getPkgStatusColor(o.package_status_id),
                    };
                }
                postConfirmationBreakdown[label].count += 1;
            });

            const delivered = sellerOrders.filter((o) => isDeliveredForCommission(o, deliveredPkgIds));
            const deliveredCount = delivered.length;
            const deliveredPercent = confirmedCount > 0 ? (deliveredCount / confirmedCount) * 100 : 0;

            const basis: CommissionBasis = normalizeCommissionBasis(seller.commission_basis);
            const commissionPrice = Number(seller.commission_price ?? 0) || 0;
            const sellerProductIds: string[] = Array.isArray(seller.products)
                ? (seller.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];

            let productRevenueDelivered = 0;
            const sellerProductDeliveredQty = new Map<string, number>();

            delivered.forEach((o) => {
                productRevenueDelivered += productRevenueExcludingShipping(o);
                const items = o.order_items || [];
                for (const oi of items) {
                    const pid = oi?.product_id;
                    if (!pid) continue;
                    const q = Number(oi.quantity || 1);
                    sellerProductDeliveredQty.set(pid, (sellerProductDeliveredQty.get(pid) || 0) + q);
                }
            });

            let adsShare = 0;
            sellerProductDeliveredQty.forEach((sqty, pid) => {
                const gqty = globalProductDeliveredQty.get(pid) || 0;
                const ads = adsByProduct.get(pid) || 0;
                if (gqty > 0 && ads > 0) adsShare += (sqty / gqty) * ads;
            });

            const commissionTotal = delivered.reduce(
                (s: number, o) =>
                    s +
                    commissionAccruedForDeliveredOrder({
                        order: o,
                        basis,
                        commissionPrice,
                        sellerProductIds,
                    }),
                0
            );

            const netResult = productRevenueDelivered - adsShare - commissionTotal;

            return {
                id: seller.id,
                name: seller.name,
                avatar_url: seller.avatar_url,
                active: seller.active,
                assignedCount,
                assignedPercent,
                sourceBreakdown,
                preConfirmationBreakdown,
                confirmedCount,
                confirmedPercent,
                postConfirmationBreakdown,
                deliveredCount,
                deliveredPercent,
                netResult,
            };
        }).sort((a, b) => b.deliveredCount - a.deliveredCount);

        return { sellerData, totalOrders };
    }, [
        sellers,
        orders,
        adsHistory,
        dateFilter,
        confirmedIds,
        callbackIds,
        cancelledIds,
        deliveredPkgIds,
        getPkgsByCategories,
        getOrderStatusColor,
        getPkgStatusColor,
    ]);

    if (!metrics) return null;

    return (
        <Card className="border-0 shadow-sm rounded-3xl">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-orange-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                        <CardTitle className="text-sm font-bold text-brand-navy">Sellers Performance</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">
                            {metrics.sellerData.length} sellers &middot; {metrics.totalOrders.toLocaleString('fr-MA')}{' '}
                            total orders &middot; Net = product total − ads (share) − commission
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
                {metrics.sellerData.map((s) => {
                    const isExpanded = expandedSellers.has(s.id);
                    return (
                        <div
                            key={s.id}
                            className={cn(
                                'border rounded-2xl overflow-hidden transition-all',
                                isExpanded ? 'border-gray-200 shadow-sm' : 'border-gray-100'
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => toggleSeller(s.id)}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors text-left"
                            >
                                <div className="flex items-center gap-2.5 min-w-[130px] shrink-0">
                                    {s.avatar_url ? (
                                        <img src={s.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-brand-navy/10 flex items-center justify-center text-[11px] font-bold text-brand-navy shrink-0">
                                            {s.name?.[0]}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <span className="font-bold text-brand-navy text-xs block truncate">{s.name}</span>
                                        {!s.active && (
                                            <Badge variant="outline" className="text-[8px] px-1 py-0 mt-0.5">
                                                Inactive
                                            </Badge>
                                        )}
                                    </div>
                                </div>

                                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                                    <MetricCell
                                        label="Assigned"
                                        value={s.assignedCount}
                                        sub={`${s.assignedPercent.toFixed(1)}% of total`}
                                    />
                                    <MetricCell
                                        label="Confirmed"
                                        value={s.confirmedCount}
                                        percent={s.confirmedPercent}
                                    />
                                    <MetricCell
                                        label="Delivered"
                                        value={s.deliveredCount}
                                        percent={s.deliveredPercent}
                                    />
                                    <div className="text-center">
                                        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                                            Net result
                                        </p>
                                        <p
                                            className={cn(
                                                'text-sm font-bold leading-tight mt-0.5',
                                                s.netResult >= 0 ? 'text-emerald-600' : 'text-red-600'
                                            )}
                                        >
                                            {s.netResult.toLocaleString('fr-MA')}
                                        </p>
                                        <p className="text-[10px] text-gray-400">MAD</p>
                                        <p className="text-[8px] text-gray-400 leading-tight mt-0.5 px-0.5">
                                            excl. shipping, ads share, commission
                                        </p>
                                    </div>
                                </div>

                                <ChevronDown
                                    className={cn(
                                        'w-4 h-4 text-gray-400 transition-transform shrink-0',
                                        isExpanded && 'rotate-180'
                                    )}
                                />
                            </button>

                            {isExpanded && (
                                <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/30 space-y-3">
                                    <BreakdownSection title="Sources">
                                        {Object.entries(s.sourceBreakdown).length > 0 ? (
                                            Object.entries(s.sourceBreakdown)
                                                .sort(([, a], [, b]) => b - a)
                                                .map(([source, count]) => (
                                                    <PillBadge
                                                        key={source}
                                                        label={source}
                                                        count={count}
                                                        className={SOURCE_COLORS[source] || SOURCE_COLORS.other}
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="No source data" />
                                        )}
                                    </BreakdownSection>

                                    <BreakdownSection title="Status Before Confirmation">
                                        {Object.entries(s.preConfirmationBreakdown).length > 0 ? (
                                            Object.entries(s.preConfirmationBreakdown)
                                                .sort(([, a], [, b]) => b.count - a.count)
                                                .map(([label, { count, color }]) => (
                                                    <PillBadge
                                                        key={label}
                                                        label={label}
                                                        count={count}
                                                        color={color}
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="None pending" />
                                        )}
                                    </BreakdownSection>

                                    <BreakdownSection title="Status After Confirmation">
                                        {Object.entries(s.postConfirmationBreakdown).length > 0 ? (
                                            Object.entries(s.postConfirmationBreakdown)
                                                .sort(([, a], [, b]) => b.count - a.count)
                                                .map(([label, { count, color }]) => (
                                                    <PillBadge
                                                        key={label}
                                                        label={label}
                                                        count={count}
                                                        color={color}
                                                    />
                                                ))
                                        ) : (
                                            <EmptyLabel text="None in suivi" />
                                        )}
                                    </BreakdownSection>
                                </div>
                            )}
                        </div>
                    );
                })}
                {metrics.sellerData.length === 0 && (
                    <p className="text-center py-8 text-gray-400 text-xs">No sellers found</p>
                )}
            </CardContent>
        </Card>
    );
};

function MetricCell({
    label,
    value,
    sub,
    percent,
}: {
    label: string;
    value: number;
    sub?: string;
    percent?: number;
}) {
    return (
        <div className="text-center">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</p>
            <p className="text-sm font-bold text-brand-navy leading-tight mt-0.5">{value}</p>
            {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
            {percent !== undefined && (
                <Badge
                    className={cn(
                        'text-[9px] px-1.5 py-0 font-bold',
                        percent >= 50
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-50'
                            : percent >= 25
                              ? 'bg-amber-50 text-amber-600 hover:bg-amber-50'
                              : 'bg-red-50 text-red-600 hover:bg-red-50'
                    )}
                >
                    {percent.toFixed(1)}%
                </Badge>
            )}
        </div>
    );
}

function BreakdownSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{title}</h5>
            <div className="flex flex-wrap gap-1.5">{children}</div>
        </div>
    );
}

function PillBadge({
    label,
    count,
    className,
    color,
}: {
    label: string;
    count: number;
    className?: string;
    color?: string;
}) {
    const style = color ? { backgroundColor: `${color}1A`, color } : undefined;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                className
            )}
            style={style}
        >
            {label}: {count}
        </span>
    );
}

function EmptyLabel({ text }: { text: string }) {
    return <span className="text-[10px] text-gray-400 italic">{text}</span>;
}
