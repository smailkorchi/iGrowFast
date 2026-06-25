import React, { useMemo, useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Users as UsersIcon,
    MapPin,
    CreditCard,
    Phone,
    Mail,
    X,
    Package,
    Store,
    ShieldCheck,
    UserCheck,
    BarChart3,
    DollarSign,
    Target,
    TrendingUp,
    Coins,
    Award,
    Sparkles,
    Crown,
    Medal,
    Search,
    ArrowUpRight,
    type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format, parseISO, differenceInDays } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useTrackedOrders } from '@/hooks/useTrackedOrders';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

// ============ TYPE DEFINITIONS ============

interface SellerProfile {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    products: string[];
    assignment: number;
    commission_price: number;
    commission_basis?: string | null;
    created_at: string;
    bank_account_holder: string | null;
    bank_name: string | null;
    bank_rib: string | null;
    cin_number: string | null;
    address: string | null;
    phone: string | null;
}

interface SellerKPIs {
    totalOrders: number;
    pendingOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    fakeOrders: number;
    shippedOrders: number;
    confirmRate: number;
    deliveryRate: number;
    deliveryDenom: number;
    cancellationRate: number;
    liveCommission: number;
    totalRevenue: number;
    totalEarnings: number;
    totalCommissionEarned: number;
    totalPaid: number;
    totalUnpaid: number;
    daysPresent: number;
    avgDailyDelivered: number;
    productNames: { name: string; image: string | null }[];
    lastActive: string | null;
    topCity: string | null;
    monthlyPayments: {
        month: string;
        total_amount: number;
        paid_amount: number;
        delivered_orders: number;
        status: string;
        period_state: string;
    }[];
}

interface EnrichedSeller extends SellerProfile {
    kpis: SellerKPIs;
}

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const SellerKpi: React.FC<{
    label: string;
    value: number | string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const MiniTile: React.FC<{ label: string; value: string; sub?: string; tone?: 'ink' | 'orange' | 'green' | 'rose' }> = ({ label, value, sub, tone = 'ink' }) => {
    const a = KPI_ACCENTS[tone];
    return (
        <div className="rounded-xl border border-ant-line bg-ant-paper p-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                {label}
            </div>
            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums mt-1.5">{value}</p>
            {sub && <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{sub}</p>}
        </div>
    );
};

// Compute delivery-rate tier → Anthropic stripe + label tone
const deliveryTier = (rate: number) => {
    if (rate >= 70) return { stripe: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', dot: 'bg-ant-green', label: 'Strong' };
    if (rate >= 40) return { stripe: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', dot: 'bg-ant-orange', label: 'Steady' };
    return { stripe: 'bg-ant-rose', text: 'text-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', dot: 'bg-ant-rose', label: 'At risk' };
};

// ============ MAIN COMPONENT ============

const Sellers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const {
        confirmedIds,
        cancelledIds,
        deliveredPkgIds,
        pendingIds,
        adminPullbackOrderIds,
        adminPullbackPackageIds,
        isOrderCategory,
        isOrderInCategories,
    } = useStatusCategories();
    const { trackedOrderIds } = useTrackedOrders(activeBusinessId);
    const [sellers, setSellers] = useState<EnrichedSeller[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSeller, setSelectedSeller] = useState<EnrichedSeller | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'delivered' | 'revenue' | 'rate' | 'commission'>('delivered');
    const [globalStats, setGlobalStats] = useState({
        totalSellers: 0,
        totalDelivered: 0,
        totalRevenue: 0,
        totalPaid: 0,
        avgDeliveryRate: 0,
    });

    useEffect(() => {
        fetchSellers();
    }, [confirmedIds, cancelledIds, deliveredPkgIds, pendingIds, adminPullbackOrderIds, adminPullbackPackageIds, trackedOrderIds, isOrderCategory, isOrderInCategories]);

    const fetchSellers = async () => {
        setLoading(true);
        try {
            const { data: sellersData, error: sellersErr } = await supabase
                .from('users')
                .select('id, name, email, avatar_url, avatar_config, products, assignment, commission_price, commission_basis, created_at, bank_account_holder, bank_name, bank_rib, cin_number, address, phone')
                .eq('role', 'commercial')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: true });

            if (sellersErr) throw sellersErr;
            if (!sellersData || sellersData.length === 0) {
                setSellers([]);
                setLoading(false);
                return;
            }

            const sellerIds = sellersData.map((s) => s.id);

            // Paginated (fetchAllRows) so we never truncate at PostgREST's 1000-row
            // default — that cap was undercounting high-volume sellers' delivered,
            // revenue and live-commission figures.
            const orders = await fetchAllRows<any>(
                'orders',
                'id, seller_id, order_status_id, package_status_id, price, created_at, date_livraison, master_city_id, status:order_statuses(code, label), city:master_cities(name), package_statuses(label), order_items(product_id, quantity)',
                {
                    filters: [
                        { column: 'seller_id', op: 'in', value: sellerIds },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );

            const earnings = await fetchAllRows<any>('seller_daily_earnings', '*', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }],
            });

            const presences = await fetchAllRows<any>('seller_presences', '*', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }],
            });

            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('payout_month', { ascending: false });

            const payments = paymentsData || [];

            const getSellerProducts = (s: any): string[] =>
                Array.isArray(s.products) ? (s.products as unknown[]).filter((p): p is string => typeof p === 'string') : [];

            const allProductIds = [...new Set(sellersData.flatMap((s: any) => getSellerProducts(s)))];
            const productsMap: Record<string, { name: string; image: string | null }> = {};
            if (allProductIds.length > 0) {
                const { data: prodData } = await supabase
                    .from('products')
                    .select('id, name, image_url')
                    .eq('active', true)
                    .in('id', allProductIds as string[]);

                (prodData || []).forEach((p) => {
                    const nameObj = p.name as any;
                    const displayName = typeof nameObj === 'string' ? nameObj : (nameObj?.en || nameObj?.fr || 'Unknown');
                    productsMap[p.id] = { name: displayName, image: p.image_url };
                });
            }

            const enriched: EnrichedSeller[] = sellersData.map((seller: any) => {
                const sellerOrders = orders.filter((o) => o.seller_id === seller.id);
                const sellerEarnings = earnings.filter((e) => e.seller_id === seller.id);
                const sellerPresences = presences.filter((p) => p.seller_id === seller.id);
                const sellerPayments = payments.filter((p) => p.seller_id === seller.id);

                const total = sellerOrders.length;

                let delivered = 0,
                    shipped = 0,
                    confirmed = 0,
                    pending = 0,
                    cancelled = 0,
                    fake = 0;

                sellerOrders.forEach((o) => {
                    const sid = o.order_status_id;
                    const isDeliveredPkg = isDeliveredForCommission(o, deliveredPkgIds);

                    if (isDeliveredPkg) {
                        delivered++;
                    } else if (isOrderCategory(sid, 'processed')) {
                        shipped++;
                    } else if (confirmedIds.has(o.order_status_id)) {
                        confirmed++;
                    } else if (isOrderCategory(sid, 'cancelled')) {
                        cancelled++;
                    } else if (isOrderInCategories(sid, ['fake', 'double'])) {
                        fake++;
                    } else if (pendingIds.has(o.order_status_id)) {
                        pending++;
                    } else {
                        pending++;
                    }
                });

                // Confirmation rate: numerator = orders NOT in pending (new +
                // postponed) OR with tracking. Denominator = total seller orders.
                // Empty-set guard: see analyticsDefinitions.isRateConfirmed.
                const statusMapsReady = pendingIds.size > 0;
                const rateConfirmedCount = sellerOrders.filter((o: any) => {
                    const hasTracking = !!o.id && trackedOrderIds.has(o.id);
                    if (hasTracking) return true;
                    if (!statusMapsReady) return false;
                    return !!o.order_status_id && !pendingIds.has(o.order_status_id);
                }).length;
                const confirmRate = sellerOrders.length > 0 ? (rateConfirmedCount / sellerOrders.length) * 100 : 0;
                // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
                const sellerTracked = sellerOrders.filter((o: any) => !!o.id && trackedOrderIds.has(o.id));
                const sellerPullback = sellerTracked.filter((o: any) =>
                    isAdminPullback(o, true, adminPullbackOrderIds, adminPullbackPackageIds),
                );
                const sellerDeliveryDenom = sellerTracked.length - sellerPullback.length;
                const deliveryRate = sellerDeliveryDenom > 0 ? (delivered / sellerDeliveryDenom) * 100 : 0;
                const cancellationRate = total > 0 ? ((cancelled + fake) / total) * 100 : 0;

                // Partial-payout-aware: aggregate `paid_amount` across every
                // payout row (full + partial + pending). Pending rows return 0,
                // partials return their running sum, full-paid rows return
                // total_amount. The trigger keeps `paid_amount` in lockstep
                // with `seller_payment_txns`, so this is the single source of
                // truth for "how much cash has actually been disbursed".
                const alreadyPaidAmount = sellerPayments
                    .reduce((sum, p: any) => sum + (Number(p.paid_amount) || 0), 0);

                const isDeliveredOrder = (o: any) => isDeliveredForCommission(o, deliveredPkgIds);
                const basis = normalizeCommissionBasis(seller.commission_basis);
                const sellerProductIds = getSellerProducts(seller);
                const { unpaidCommission: liveCommission } = computeUnpaidCommission({
                    basis,
                    commissionPrice: Number(seller.commission_price) || 0,
                    orders: sellerOrders,
                    isDelivered: isDeliveredOrder,
                    sellerProductIds,
                    paidAmount: alreadyPaidAmount,
                });

                const totalRevenue = sellerOrders
                    .filter((o) => isDeliveredForCommission(o, deliveredPkgIds))
                    .reduce((sum, o) => sum + (Number(o.price) || 0), 0);

                const totalCommissionEarned = sellerEarnings.reduce((sum, e) => sum + (Number(e.commission_earned) || 0), 0);
                const totalEarnings = sellerEarnings.reduce((sum, e) => sum + (Number(e.total_earned) || 0), 0);

                // Totals respect partials AND the rolling-ledger carry: paid = sum of
                // every disbursement; unpaid = the OPEN month's remaining ONLY. Closed
                // months' unpaid already rolled forward into the open ticket, so summing
                // every row would double-count it (e.g. May 1530 already inside Jun 710).
                const totalPaid = sellerPayments.reduce(
                    (sum, p: any) => sum + (Number(p.paid_amount) || 0),
                    0,
                );
                const totalUnpaid = sellerPayments.reduce(
                    (sum, p: any) => sum + (p.period_state === 'open'
                        ? Math.max(0, (Number(p.total_amount) || 0) - (Number(p.paid_amount) || 0))
                        : 0),
                    0,
                );

                const daysPresent = sellerPresences.length;
                const avgDailyDelivered = daysPresent > 0 ? delivered / daysPresent : 0;

                const productNames = sellerProductIds
                    .map((pid: string) => productsMap[pid])
                    .filter((x): x is { name: string; image: string | null } => !!x);

                const sortedPresences = [...sellerPresences].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const lastActive = sortedPresences[0]?.date || null;

                const cityMap: Record<string, number> = {};
                sellerOrders
                    .filter((o) => isDeliveredForCommission(o, deliveredPkgIds))
                    .forEach((o) => {
                        const cityName = (o.city as any)?.name || 'Unknown';
                        cityMap[cityName] = (cityMap[cityName] || 0) + 1;
                    });
                const topCity = Object.entries(cityMap).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

                const monthlyPayments = sellerPayments.map((p) => ({
                    month: p.payout_month,
                    total_amount: Number(p.total_amount) || 0,
                    paid_amount: Number((p as any).paid_amount) || 0,
                    delivered_orders: p.delivered_orders || 0,
                    status: p.status || 'pending',
                    period_state: (p as any).period_state || 'closed',
                }));

                return {
                    ...seller,
                    commission_price: Number(seller.commission_price) || 0,
                    assignment: Number(seller.assignment) || 0,
                    products: sellerProductIds,
                    kpis: {
                        totalOrders: total,
                        pendingOrders: pending,
                        // Confirmed count = one-true-definition (yes was spoken).
                        confirmedOrders: rateConfirmedCount,
                        deliveredOrders: delivered,
                        cancelledOrders: cancelled,
                        fakeOrders: fake,
                        shippedOrders: shipped,
                        confirmRate,
                        deliveryRate,
                        deliveryDenom: sellerDeliveryDenom,
                        cancellationRate,
                        liveCommission,
                        totalRevenue,
                        totalEarnings,
                        totalCommissionEarned,
                        totalPaid,
                        totalUnpaid,
                        daysPresent,
                        avgDailyDelivered,
                        productNames,
                        lastActive,
                        topCity,
                        monthlyPayments,
                    },
                } as EnrichedSeller;
            });

            setSellers(enriched);

            const gTotalDelivered = enriched.reduce((s, e) => s + e.kpis.deliveredOrders, 0);
            const gTotalDeliveryDenom = enriched.reduce((s, e) => s + e.kpis.deliveryDenom, 0);
            setGlobalStats({
                totalSellers: enriched.length,
                totalDelivered: gTotalDelivered,
                totalRevenue: enriched.reduce((s, e) => s + e.kpis.totalRevenue, 0),
                totalPaid: enriched.reduce((s, e) => s + e.kpis.totalPaid, 0),
                avgDeliveryRate: gTotalDeliveryDenom > 0 ? (gTotalDelivered / gTotalDeliveryDenom) * 100 : 0,
            });
        } catch (error) {
            console.error('Error fetching sellers:', error);
        } finally {
            setLoading(false);
        }
    };

    // ========== Derived lists: podium + filtered/sorted ==========
    const podium = useMemo(() => {
        return [...sellers]
            .filter((s) => s.kpis.deliveredOrders > 0)
            .sort((a, b) => b.kpis.deliveredOrders - a.kpis.deliveredOrders)
            .slice(0, 3);
    }, [sellers]);

    const rankMap = useMemo(() => {
        const sorted = [...sellers].sort((a, b) => b.kpis.deliveredOrders - a.kpis.deliveredOrders);
        const map = new Map<string, number>();
        sorted.forEach((s, i) => map.set(s.id, i + 1));
        return map;
    }, [sellers]);

    const displaySellers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        let list = sellers.filter((s) => {
            if (!q) return true;
            return (
                s.name?.toLowerCase().includes(q) ||
                s.email?.toLowerCase().includes(q) ||
                (s.kpis.topCity || '').toLowerCase().includes(q)
            );
        });
        list = [...list].sort((a, b) => {
            if (sortBy === 'delivered') return b.kpis.deliveredOrders - a.kpis.deliveredOrders;
            if (sortBy === 'revenue') return b.kpis.totalRevenue - a.kpis.totalRevenue;
            if (sortBy === 'rate') return b.kpis.deliveryRate - a.kpis.deliveryRate;
            if (sortBy === 'commission') return b.kpis.liveCommission - a.kpis.liveCommission;
            return 0;
        });
        return list;
    }, [sellers, searchQuery, sortBy]);

    // ========== PODIUM CARD ==========
    const PodiumCard: React.FC<{ seller: EnrichedSeller; rank: 1 | 2 | 3 }> = ({ seller, rank }) => {
        const k = seller.kpis;
        const tier = deliveryTier(k.deliveryRate);
        const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

        const rankMeta = rank === 1
            ? { icon: Crown, accentBg: 'bg-ant-orange/10', accentBorder: 'border-ant-orange/30', accentText: 'text-ant-orange', label: 'Top seller · 01', avatarSize: 'h-20 w-20', nameSize: 'text-[22px]', rankBg: 'bg-ant-orange text-white' }
            : rank === 2
            ? { icon: Medal, accentBg: 'bg-ant-ink/6', accentBorder: 'border-ant-ink/20', accentText: 'text-ant-ink', label: 'Runner up · 02', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-ink text-white' }
            : { icon: Medal, accentBg: 'bg-ant-rose/8', accentBorder: 'border-ant-rose/25', accentText: 'text-ant-rose', label: 'Third place · 03', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-rose text-white' };
        const RankIcon = rankMeta.icon;

        return (
            <div
                onClick={() => setSelectedSeller(seller)}
                className={cn(
                    'relative overflow-hidden rounded-2xl border bg-ant-paper cursor-pointer transition-all hover:border-ant-ink/20 hover:shadow-[0_24px_60px_-24px_rgba(20,20,19,0.22)]',
                    rankMeta.accentBorder
                )}
            >
                <div className={cn('h-[3px] w-full', rank === 1 ? 'bg-ant-orange' : rank === 2 ? 'bg-ant-ink' : 'bg-ant-rose')} />
                <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', rankMeta.accentBg, rankMeta.accentBorder, rankMeta.accentText)}>
                            <RankIcon className="w-3 h-3" />
                            {rankMeta.label}
                        </div>
                        <div className={cn('inline-flex items-center justify-center h-8 w-8 rounded-full font-display font-semibold text-[13px]', rankMeta.rankBg)}>
                            {rank}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                            <UserAvatar url={seller.avatar_url} config={(seller as any).avatar_config} name={seller.name} className={cn('rounded-2xl border border-ant-line', rankMeta.avatarSize)} />
                            <span className={cn('absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ant-paper', isOnline ? 'bg-ant-green' : 'bg-ant-mid/50')} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className={cn('font-display font-semibold text-ant-ink leading-tight truncate', rankMeta.nameSize)}>{seller.name}</h3>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{seller.email}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivered</p>
                            <p className="font-display text-[18px] font-semibold text-ant-green tabular-nums mt-0.5">{k.deliveredOrders}</p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivery</p>
                            <p className={cn('font-display text-[18px] font-semibold tabular-nums mt-0.5', tier.text)}>{k.deliveryRate.toFixed(1)}%</p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Revenue</p>
                            <p className="font-display text-[15px] font-semibold text-ant-ink tabular-nums mt-0.5 truncate">
                                {Math.round(k.totalRevenue).toLocaleString()}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <div className="min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unpaid commission</p>
                            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums truncate">
                                {k.liveCommission.toLocaleString()}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-ant-mid">
                            View <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== ROSTER CARD (for non-podium sellers) ==========
    const RosterCard: React.FC<{ seller: EnrichedSeller; rank: number }> = ({ seller, rank }) => {
        const k = seller.kpis;
        const tier = deliveryTier(k.deliveryRate);
        const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

        return (
            <div
                onClick={() => setSelectedSeller(seller)}
                className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all group"
            >
                <div className={cn('h-[3px] w-full', tier.stripe)} />
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                            <UserAvatar url={seller.avatar_url} config={(seller as any).avatar_config} name={seller.name} className="h-12 w-12 rounded-2xl border border-ant-line" />
                            <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ant-paper', isOnline ? 'bg-ant-green' : 'bg-ant-mid/50')} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-display text-[14px] font-semibold text-ant-ink truncate">{seller.name}</h3>
                                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid tabular-nums">
                                    #{rank}
                                </span>
                            </div>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{seller.email}</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>

                    {/* Delivery progress bar */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            <span>Delivery</span>
                            <span className={cn('font-display text-[14px] tracking-normal tabular-nums normal-case', tier.text)}>
                                {k.deliveryRate.toFixed(1)}%
                            </span>
                        </div>
                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                            <div
                                className={cn('h-full rounded-full transition-all', tier.stripe)}
                                style={{ width: `${Math.min(100, k.deliveryRate)}%` }}
                            />
                        </div>
                    </div>

                    {/* 3-col hairline stats */}
                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Orders</p>
                            <p className="text-[13px] font-semibold text-ant-ink tabular-nums">{k.totalOrders}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Delivered</p>
                            <p className="text-[13px] font-semibold text-ant-green tabular-nums">{k.deliveredOrders}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Comm.</p>
                            <p className="text-[11px] font-semibold text-ant-ink tabular-nums truncate">
                                {seller.commission_price}<span className="text-ant-mid font-normal">/{normalizeCommissionBasis(seller.commission_basis) === 'per_unit' ? 'u' : 'o'}</span>
                            </p>
                        </div>
                    </div>

                    {/* Unpaid commission footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tier.bg, tier.border, tier.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                            {tier.label}
                        </span>
                        <div className="text-right">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Unpaid</p>
                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                {k.liveCommission.toLocaleString()}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== DETAIL MODAL ==========
    const SellerDetailModal = ({ seller, onClose }: { seller: EnrichedSeller; onClose: () => void }) => {
        const k = seller.kpis;
        const daysActive = differenceInDays(new Date(), new Date(seller.created_at)) + 1;
        const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

        const statusDistribution = [
            { label: 'Delivered', count: k.deliveredOrders, color: '#2D7A3E' },
            { label: 'Shipped', count: k.shippedOrders, color: '#8B4A9B' },
            { label: 'Confirmed', count: k.confirmedOrders, color: '#D97706' },
            { label: 'Pending', count: k.pendingOrders, color: '#8B8680' },
            { label: 'Cancelled', count: k.cancelledOrders, color: '#B54040' },
            { label: 'Fake', count: k.fakeOrders, color: '#A8A29E' },
        ].filter((s) => s.count > 0);

        const totalForBar = statusDistribution.reduce((s, d) => s + d.count, 0);

        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ant-ink/55 backdrop-blur-sm"
                onClick={onClose}
            >
                <div
                    className="ant-surface relative bg-ant-paper rounded-2xl border border-ant-line w-full max-w-4xl max-h-[92vh] overflow-y-auto ant-scroll shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Editorial header */}
                    <div className="sticky top-0 bg-ant-paper z-10 border-b border-ant-line px-6 py-5">
                        <div className="flex items-start gap-4">
                            <div className="relative shrink-0">
                                <UserAvatar url={seller.avatar_url} config={(seller as any).avatar_config} name={seller.name} className="h-14 w-14 rounded-2xl border border-ant-line" />
                                <span
                                    className={cn(
                                        'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-ant-paper',
                                        isOnline ? 'bg-ant-green' : 'bg-ant-mid/50'
                                    )}
                                />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Seller · Profile
                                </div>
                                <h2 className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">{seller.name}</h2>
                                <div className="flex flex-wrap items-center gap-3 text-[12px] text-ant-mid">
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="w-3.5 h-3.5" /> {seller.email}
                                    </span>
                                    {seller.phone && (
                                        <>
                                            <span>·</span>
                                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                                                <Phone className="w-3.5 h-3.5" /> {seller.phone}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Contract config */}
                        <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                            <SellerKpi label="Commission" value={seller.commission_price} suffix={normalizeCommissionBasis(seller.commission_basis) === 'per_unit' ? 'DH/unit' : 'DH/order'} accent="orange" icon={Coins} />
                            <SellerKpi label="Assignment" value={seller.assignment} suffix="orders/day" accent="ink" icon={Target} />
                            <SellerKpi label="Products" value={k.productNames.length} suffix="attributed" accent="orange" icon={Package} />
                            <SellerKpi label="Days since join" value={daysActive} suffix="days" accent="ink" icon={UserCheck} />
                        </section>

                        {/* Order performance */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <BarChart3 className="w-3 h-3" />
                                    Order performance
                                </div>

                                {totalForBar > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-ant-line">
                                            {statusDistribution.map((s, i) => (
                                                <div
                                                    key={i}
                                                    className="rounded-full"
                                                    style={{ width: `${(s.count / totalForBar) * 100}%`, background: s.color }}
                                                    title={`${s.label}: ${s.count}`}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                            {statusDistribution.map((s, i) => (
                                                <div key={i} className="flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                                                    <span className="text-[11px] text-ant-mid">
                                                        {s.label} <span className="font-semibold text-ant-ink tabular-nums ml-0.5">{s.count}</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-ant-line">
                                    <MiniTile label="Confirm rate" value={`${k.confirmRate.toFixed(1)}%`} tone="orange" />
                                    <MiniTile label="Delivery rate" value={`${k.deliveryRate.toFixed(1)}%`} tone="green" />
                                    <MiniTile label="Loss rate" value={`${k.cancellationRate.toFixed(1)}%`} tone="rose" />
                                    <MiniTile label="Avg per day" value={k.avgDailyDelivered.toFixed(1)} sub="delivered" tone="ink" />
                                </div>
                            </div>
                        </section>

                        {/* Financial overview — ink panel */}
                        <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                    <DollarSign className="w-3 h-3" />
                                    Financial overview
                                </div>
                                <Sparkles className="w-3.5 h-3.5 text-ant-orange/70" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                        Revenue generated
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-ant-green tabular-nums mt-1.5">
                                        {k.totalRevenue.toLocaleString()}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Unpaid commission
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-ant-orange tabular-nums mt-1.5">
                                        {k.liveCommission.toLocaleString()}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                        Total earnings
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-1.5">
                                        {k.totalEarnings.toLocaleString()}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-white/10 border-t border-white/10">
                                {[
                                    { label: 'Commission earned', value: k.totalCommissionEarned.toLocaleString() },
                                    { label: 'Total paid', value: k.totalPaid.toLocaleString() },
                                    { label: 'Unpaid draft', value: k.totalUnpaid.toLocaleString() },
                                ].map((t) => (
                                    <div key={t.label} className="bg-ant-ink px-5 py-3">
                                        <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55">{t.label}</p>
                                        <p className="font-display text-[14px] font-semibold text-white mt-0.5 tabular-nums">
                                            {t.value} <span className="text-[10px] text-white/55 font-normal">MAD</span>
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Activity + Products */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <UserCheck className="w-3 h-3" />
                                    Activity
                                </div>
                                {[
                                    { label: 'Days present', value: String(k.daysPresent) },
                                    { label: 'Last active', value: k.lastActive ? format(parseISO(k.lastActive), 'MMM d, yyyy') : 'Never' },
                                    { label: 'Top city', value: k.topCity || 'N/A' },
                                    { label: 'Daily assignment', value: `${seller.assignment} orders/day` },
                                ].map((r) => (
                                    <div key={r.label} className="flex items-center justify-between py-2 border-b border-ant-line last:border-0">
                                        <span className="text-[11px] text-ant-mid">{r.label}</span>
                                        <span className="text-[12px] font-semibold text-ant-ink tabular-nums">{r.value}</span>
                                    </div>
                                ))}
                            </section>

                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3 flex flex-col">
                                <div className="flex items-center justify-between shrink-0">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <Package className="w-3 h-3" />
                                        Attributed products
                                    </div>
                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                        {k.productNames.length}
                                    </span>
                                </div>
                                {k.productNames.length === 0 ? (
                                    <p className="font-serif italic text-[12px] text-ant-mid py-4 text-center">No products attributed.</p>
                                ) : (
                                    <div className="ant-scroll max-h-[220px] overflow-y-auto pr-1 -mr-1 space-y-1">
                                        {k.productNames.map((p, i) => (
                                            <div key={i} className="flex items-center gap-2.5 py-1.5 border-b border-ant-line last:border-0">
                                                <div className="w-8 h-8 bg-ant-light rounded-lg border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                    {p.image ? (
                                                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Package className="w-3.5 h-3.5 text-ant-mid" />
                                                    )}
                                                </div>
                                                <span className="text-[12px] text-ant-ink truncate">{p.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Payout history */}
                        {k.monthlyPayments.length > 0 && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <CreditCard className="w-3 h-3" />
                                        Payout history
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-mid tabular-nums">{k.monthlyPayments.length} months</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line">
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Month</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Delivered</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Total</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Paid</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {k.monthlyPayments.map((p, i) => {
                                                const totalAmount = Number(p.total_amount) || 0;
                                                const paidAmount = Number(p.paid_amount) || 0;
                                                const pct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
                                                const isPaid = p.status === 'paid';
                                                const isPartial = p.status === 'partial';
                                                const isOpen = p.period_state === 'open';
                                                const statusMeta = isPaid
                                                    ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                                    : isPartial
                                                      ? { bg: 'bg-ant-blue/10', text: 'text-ant-blue', dot: 'bg-ant-blue' }
                                                      : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                                return (
                                                    <tr key={i} className="border-t border-ant-line/60 hover:bg-ant-light/40 transition-colors tabular-nums">
                                                        <td className="px-4 py-3.5 text-[12px] font-semibold text-ant-ink whitespace-nowrap">{format(parseISO(p.month), 'MMM yyyy')}</td>
                                                        <td className="px-4 py-3.5 text-[13px] text-ant-green font-semibold">{p.delivered_orders}</td>
                                                        <td className="px-4 py-3.5 text-right text-[13px] font-semibold text-ant-ink">
                                                            {totalAmount.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right" title={`${paidAmount.toLocaleString()} paid of ${totalAmount.toLocaleString()}`}>
                                                            <div className="flex flex-col items-end gap-1.5">
                                                                <span className={cn('text-[13px] font-semibold tabular-nums leading-none', paidAmount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                                    {paidAmount.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                                </span>
                                                                {isOpen && isPartial && (
                                                                    <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                                        <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                                {p.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* Personal & Banking */}
                        {(seller.cin_number || seller.bank_name || seller.address || seller.phone || seller.bank_rib) && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <ShieldCheck className="w-3 h-3" />
                                    Personal &amp; banking
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {seller.cin_number && <InfoRow icon={ShieldCheck} label="CIN" value={seller.cin_number} />}
                                    {seller.address && <InfoRow icon={MapPin} label="Address" value={seller.address} />}
                                    {seller.bank_name && <InfoRow icon={CreditCard} label="Bank" value={seller.bank_name} />}
                                    {seller.bank_rib && <InfoRow icon={CreditCard} label="RIB" value={seller.bank_rib} mono />}
                                    {seller.phone && <InfoRow icon={Phone} label="Phone" value={seller.phone} />}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ========== RENDER ==========
    return (
        <>
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                    {/* Editorial header */}
                    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Collaborators · Commercial roster
                            </div>
                            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                                Sellers
                            </h1>
                            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                                A leaderboard, not a list — the closers, their deliveries, their unpaid commission. Crown the top three, watch the rest climb.
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 h-9 text-[12px] font-semibold text-ant-ink shrink-0">
                            <Award className="w-3.5 h-3.5 text-ant-orange" />
                            <span className="tabular-nums">{globalStats.totalSellers}</span>
                            <span className="text-ant-mid font-normal">active</span>
                        </div>
                    </header>

                    {/* KPI strip */}
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <SellerKpi label="Total sellers" value={globalStats.totalSellers} suffix="commercials" accent="ink" icon={UsersIcon} />
                        <SellerKpi label="Total delivered" value={globalStats.totalDelivered.toLocaleString()} suffix="orders" accent="green" icon={Package} />
                        <SellerKpi label="Total revenue" value={Math.round(globalStats.totalRevenue).toLocaleString()} suffix="MAD" accent="green" icon={TrendingUp} />
                        <SellerKpi label="Avg delivery rate" value={`${globalStats.avgDeliveryRate.toFixed(1)}%`} accent="orange" icon={Target} />
                    </section>

                    {/* Podium — top 3 performers by delivered */}
                    {!loading && podium.length > 0 && (
                        <section className="space-y-3">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Podium
                                    </div>
                                    <h2 className="font-display text-[22px] tracking-tight text-ant-ink">The closers</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">Ranked by delivered orders this lifetime — the three hands that move the most boxes.</p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 items-center justify-center shrink-0">
                                    <Crown className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            {/* Podium layout — winner emphasized on desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                {podium[0] && (
                                    <div className="md:col-span-2 md:row-span-1">
                                        <PodiumCard seller={podium[0]} rank={1} />
                                    </div>
                                )}
                                {podium[1] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard seller={podium[1]} rank={2} />
                                    </div>
                                )}
                                {podium[2] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard seller={podium[2]} rank={3} />
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Full roster */}
                    <section className="space-y-3">
                        <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Roster
                                </div>
                                <h2 className="font-display text-[22px] tracking-tight text-ant-ink">
                                    Every seller
                                    <span className="ml-2 text-[13px] font-normal text-ant-mid tabular-nums">· {displaySellers.length}</span>
                                </h2>
                            </div>
                        </div>

                        {/* Search + Sort toolbar */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="relative w-full md:w-[340px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                <Input
                                    placeholder="Search by name, email or top city..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                />
                            </div>

                            <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                                {([
                                    { key: 'delivered', label: 'Delivered' },
                                    { key: 'revenue', label: 'Revenue' },
                                    { key: 'rate', label: 'Rate' },
                                    { key: 'commission', label: 'Unpaid' },
                                ] as const).map((t) => {
                                    const active = sortBy === t.key;
                                    return (
                                        <button
                                            key={t.key}
                                            onClick={() => setSortBy(t.key)}
                                            className={cn(
                                                'inline-flex items-center rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer whitespace-nowrap',
                                                active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {loading ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="h-52 rounded-2xl bg-ant-light animate-pulse" />
                                ))}
                            </div>
                        ) : displaySellers.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                                <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                                    <Store className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                                </div>
                                <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                                    {sellers.length ? 'No sellers match that search' : 'No sellers yet'}
                                </h3>
                                <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                                    {sellers.length
                                        ? 'Relax the search to bring the full roster back.'
                                        : 'Create a commercial user from the Users page and they will appear here with live performance.'}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {displaySellers.map((seller) => (
                                    <RosterCard
                                        key={seller.id}
                                        seller={seller}
                                        rank={rankMap.get(seller.id) ?? 0}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* Detail Modal */}
            <AnimatePresence>
                {selectedSeller && (
                    <SellerDetailModal seller={selectedSeller} onClose={() => setSelectedSeller(null)} />
                )}
            </AnimatePresence>
        </>
    );
};

const InfoRow: React.FC<{
    icon: LucideIcon;
    label: string;
    value: string;
    mono?: boolean;
}> = ({ icon: Icon, label, value, mono }) => (
    <div className="flex items-start gap-2.5 py-2 border-b border-ant-line last:border-0">
        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{label}</p>
            <p className={cn('text-[12px] text-ant-ink mt-0.5 break-words', mono && 'font-mono tabular-nums')}>{value}</p>
        </div>
    </div>
);

export default Sellers;
