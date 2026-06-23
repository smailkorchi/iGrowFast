import { useState, useEffect } from 'react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    computeUnpaidCommission,
    normalizeCommissionBasis,
    isDeliveredForCommission,
    isDeliveredOnLocalDay,
    type CommissionBasis,
} from '@/lib/commercialCommission';
import { isAdminPullback, isRateConfirmed } from '@/lib/analyticsDefinitions';
import {
    ShoppingCart, Eye, ChevronRight, Truck, Receipt,
    Wallet as WalletIcon, Clock, PackageCheck, CalendarDays,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import { AnalyticsDateFilter, type DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { SellerSelfPerformanceSection } from '@/components/dashboard/SellerSelfPerformanceSection';

interface UserProfile {
    id: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
    "DigiCom Business": string | null;
}

interface SellerStats {
    todayOrders: number;
    deliveredToday: number;
    pendingOrders: number;
    confirmedOrders: number;
    deliveredOrders: number;
    unpaidDeliveries: number;
    totalOrders: number;
    totalProducts: number;
    liveCommission: number;
    successRate: number;
    confirmRate: number;
    commissionRate: number;
    commissionBasis: CommissionBasis;
}

interface RecentOrder {
    id: string;
    order_status_id?: string;
    status: string;
    total_amount: number;
    created_at: string;
    customer_name: string;
    product_name: string;
    product_image: string | null;
}

interface TopProduct {
    name: string;
    image: string | null;
    delivered: number;
    revenue: number;
    successRate: number;
}

const SellerDashboard = () => {
    const navigate = useNavigate();
    const statusCats = useStatusCategories();
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [stats, setStats] = useState<SellerStats>({
        todayOrders: 0,
        deliveredToday: 0,
        pendingOrders: 0,
        confirmedOrders: 0,
        deliveredOrders: 0,
        unpaidDeliveries: 0,
        totalOrders: 0,
        totalProducts: 0,
        liveCommission: 0,
        successRate: 0,
        confirmRate: 0,
        commissionRate: 0,
        commissionBasis: 'per_order',
    });
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
    const [topProduct, setTopProduct] = useState<TopProduct | null>(null);
    const [loading, setLoading] = useState(true);
    const [perfDateFilter, setPerfDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    useEffect(() => {
        initDashboard();
        fetchSellerData();
    }, [statusCats.confirmedIds.size, statusCats.deliveredPkgIds.size, statusCats.pendingIds.size]);

    const logPresence = async (userId: string, businessId?: string) => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const { error } = await supabase
                .from('seller_presences')
                .upsert(
                    {
                        seller_id: userId,
                        date: today,
                        "DigiCom Business": businessId
                    },
                    { onConflict: 'seller_id, date' }
                );
            if (error) console.error('Error logging presence:', error);
        } catch (err) {
            console.error('Unexpected error during presence logging:', err);
        }
    };

    const initDashboard = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const { data: profile } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
            if (profile) {
                setUserProfile(profile as UserProfile);
                logPresence(session.user.id, profile["DigiCom Business"]);
            }
        }
    };

    const fetchSellerData = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const userId = session.user.id;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const { data: sellerData } = await supabase
                .from('users')
                .select('products, commission_price, commission_basis, "DigiCom Business"')
                .eq('id', userId)
                .single();

            const attributedProducts: string[] = Array.isArray(sellerData?.products)
                ? (sellerData!.products as string[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
                : [];
            const commissionRate = sellerData?.commission_price || 0;
            const commissionBasis = normalizeCommissionBasis(sellerData?.commission_basis as string | null | undefined);
            const sellerBusinessId = (sellerData as { 'DigiCom Business'?: string | null } | null)?.['DigiCom Business'] ?? null;

            // Paginated so a seller exceeding 1000 orders is never truncated.
            const ordersFilters: { column: string; op: 'eq' | 'is'; value: unknown }[] = [
                { column: 'seller_id', op: 'eq', value: userId },
                { column: 'date_deleted', op: 'is', value: null },
            ];
            if (sellerBusinessId) ordersFilters.push({ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId });
            const ordersData = await fetchAllRows<any>(
                'orders',
                'id, price, created_at, updated_at, date_livraison, name, tracking_number, order_status_id, package_status_id, package_status_label, order_statuses(code), package_statuses(label), order_items(product_id, quantity, products(name, image_url))',
                { filters: ordersFilters },
            );

            const orders = (ordersData || []).map(o => ({
                ...o,
                order_status_id: (o as any).order_status_id,
                package_status_id: (o as any).package_status_id,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                packageStatus: ((o as any).package_status_label || '').toLowerCase()
            }));

            const isDelivered = (o: any) => isDeliveredForCommission(o, statusCats.deliveredPkgIds);

            // Fetch per-order parcel tracking up front. `orders.tracking_number`
            // is not populated in production — the authoritative tracking source
            // is company_parcels.tracking_code / courier_parcels.tracking_code.
            const trackedSet = new Set<string>();
            if (sellerBusinessId) {
                const [cpRows, xpRows] = await Promise.all([
                    fetchAllRows<{ order_id: string | null; tracking_code: string | null }>(
                        'company_parcels', 'order_id, tracking_code',
                        { filters: [{ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId }] },
                    ),
                    fetchAllRows<{ order_id: string | null; tracking_code: string | null }>(
                        'courier_parcels', 'order_id, tracking_code',
                        { filters: [{ column: 'DigiCom Business', op: 'eq', value: sellerBusinessId }] },
                    ),
                ]);
                (cpRows || []).forEach((p: { order_id: string | null; tracking_code: string | null }) => {
                    if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) trackedSet.add(p.order_id);
                });
                (xpRows || []).forEach((p: { order_id: string | null; tracking_code: string | null }) => {
                    if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) trackedSet.add(p.order_id);
                });
            }

            // Pending confirmation = status ∈ {new, callback} AND no tracking
            // code. Tracking code (company_parcels / courier_parcels) overrides
            // everything — once the parcel is handed to a courier the order is
            // confirmed regardless of its order_status.
            const isPending = (o: any) => {
                if (o?.id && trackedSet.has(o.id)) return false;
                return statusCats.pendingIds.has(o.order_status_id);
            };

            const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
            const now = new Date();
            const deliveredToday = orders.filter(o =>
                isDeliveredOnLocalDay(o, statusCats.deliveredPkgIds, now),
            ).length;

            const delivered = orders.filter(o => isDelivered(o)).length;
            // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
            const tracked = orders.filter(o => !!o.id && trackedSet.has(o.id));
            const pullback = tracked.filter(o =>
                isAdminPullback(
                    o as any,
                    true,
                    statusCats.adminPullbackOrderIds,
                    statusCats.adminPullbackPackageIds,
                ),
            );
            const deliveryDenom = tracked.length - pullback.length;
            const successRate = deliveryDenom > 0 ? (delivered / deliveryDenom) * 100 : 0;
            // Confirmation rate: numerator = orders NOT in pending (new +
            // postponed) OR with tracking. Denominator = total orders.
            const rateConfirmedCount = orders.filter(o => isRateConfirmed(o, statusCats.pendingIds, trackedSet)).length;
            const confirmRate = orders.length > 0 ? (rateConfirmedCount / orders.length) * 100 : 0;

            // Partial-payout-aware: sum `paid_amount` across all payout rows
            // (pending + partial + paid). The trigger on seller_payment_txns
            // keeps `paid_amount` in lockstep with disbursements, so this is
            // the single source of truth for cash already received.
            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('paid_amount, status')
                .eq('seller_id', userId);

            const alreadyPaidAmount = (paymentsData || []).reduce((sum, p: any) => sum + (Number(p.paid_amount) || 0), 0);

            const { unpaidCommission: liveCommission, unpaidAccrued: unpaidDeliveries } = computeUnpaidCommission({
                basis: commissionBasis,
                commissionPrice: Number(commissionRate) || 0,
                orders,
                isDelivered,
                sellerProductIds: attributedProducts,
                paidAmount: alreadyPaidAmount,
            });

            setStats({
                todayOrders: todayOrders.length,
                deliveredToday,
                pendingOrders: orders.filter(o => isPending(o)).length,
                // Confirmed count = one-true-definition (yes was spoken).
                confirmedOrders: rateConfirmedCount,
                deliveredOrders: delivered,
                unpaidDeliveries,
                totalOrders: orders.length,
                totalProducts: attributedProducts.length,
                liveCommission,
                successRate,
                confirmRate,
                commissionRate: Number(commissionRate) || 0,
                commissionBasis,
            });

            // fetchAllRows paginates by stable 'id', so sort by recency here for the
            // activity feed (the old query's created_at-desc ordering moved client-side).
            const recentSorted = [...orders].sort((a, b) =>
                new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime()
            );
            setRecentOrders(recentSorted.slice(0, 10).map(o => {
                const orderItem = (o.order_items as any)?.[0];
                const product = orderItem?.products;
                return {
                    id: o.id,
                    order_status_id: (o as any).order_status_id,
                    status: (o as any).status,
                    total_amount: Number((o as any).price) || 0,
                    created_at: (o as any).created_at,
                    customer_name: (o as any).name || 'Unknown',
                    product_name: product?.name || 'N/A',
                    product_image: product?.image_url || null,
                };
            }));

            const productMap: Record<string, { name: string; image: string | null; delivered: number; total: number; tracked: number; pullback: number; revenue: number }> = {};
            orders.forEach((o: any) => {
                const item = o.order_items?.[0];
                if (!item) return;
                const pName = item.products?.name || 'Unknown';
                if (!productMap[pName]) {
                    productMap[pName] = { name: pName, image: item.products?.image_url || null, delivered: 0, total: 0, tracked: 0, pullback: 0, revenue: 0 };
                }
                productMap[pName].total++;
                if (!!o.id && trackedSet.has(o.id)) {
                    productMap[pName].tracked++;
                    if (isAdminPullback(o as any, true, statusCats.adminPullbackOrderIds, statusCats.adminPullbackPackageIds)) {
                        productMap[pName].pullback++;
                    }
                }
                if (isDelivered(o)) {
                    productMap[pName].delivered++;
                    productMap[pName].revenue += Number(o.price) || 0;
                }
            });

            const topProd = Object.values(productMap).sort((a, b) => b.revenue - a.revenue)[0];
            if (topProd) {
                const prodDenom = topProd.tracked - topProd.pullback;
                setTopProduct({
                    name: topProd.name,
                    image: topProd.image,
                    delivered: topProd.delivered,
                    revenue: topProd.revenue,
                    successRate: prodDenom > 0 ? (topProd.delivered / prodDenom) * 100 : 0,
                });
            }
        } catch (error) {
            console.error('Error fetching seller data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusStyle = (statusId: string) => {
        const hex = statusCats.getOrderStatusColor(statusId);
        return { backgroundColor: `${hex}20`, color: hex };
    };

    const groupedOrders = recentOrders.reduce<{ label: string; orders: RecentOrder[] }[]>((acc, order) => {
        const date = new Date(order.created_at);
        let label = format(date, 'MMM d, yyyy');
        if (isToday(date)) label = 'Today';
        else if (isYesterday(date)) label = 'Yesterday';
        const existing = acc.find(g => g.label === label);
        if (existing) existing.orders.push(order);
        else acc.push({ label, orders: [order] });
        return acc;
    }, []);

    const firstName = userProfile?.name?.split(' ')[0] ?? 'commercial';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Aperçu
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Bon retour, <span className="font-serif italic font-light">{firstName}</span>
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Ce qui s&apos;est passé aujourd&apos;hui, ce qui attend confirmation, et ce que votre commission doit encaisser.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/seller/orders')}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                        <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Voir les commandes
                    </button>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {[
                        {
                            label: 'Commandes du jour',
                            value: stats.todayOrders,
                            sub: 'par date de création',
                            icon: CalendarDays,
                            dot: 'bg-ant-ink',
                            iconBg: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink',
                            text: 'text-ant-ink',
                            href: '/seller/orders',
                        },
                        {
                            label: 'En attente',
                            value: stats.pendingOrders,
                            sub: 'à confirmer',
                            icon: Clock,
                            dot: 'bg-ant-orange',
                            iconBg: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange',
                            text: stats.pendingOrders > 0 ? 'text-ant-orange' : 'text-ant-ink',
                            href: '/seller/orders',
                        },
                        {
                            label: 'Livrées aujourd\u2019hui',
                            value: stats.deliveredToday,
                            sub: `total : ${stats.deliveredOrders}/${stats.totalOrders}`,
                            icon: PackageCheck,
                            dot: 'bg-ant-green',
                            iconBg: 'bg-ant-green/10 border-ant-green/25 text-ant-green',
                            text: 'text-ant-ink',
                            href: '/seller/orders',
                        },
                        {
                            label: 'Commission en attente',
                            value: `${stats.liveCommission.toLocaleString()}`,
                            sub: stats.commissionBasis === 'per_unit'
                                ? `${stats.commissionRate} MAD × ${stats.unpaidDeliveries} unités`
                                : `${stats.commissionRate} MAD × ${stats.unpaidDeliveries} commandes`,
                            icon: WalletIcon,
                            dot: 'bg-ant-orange',
                            iconBg: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange',
                            text: 'text-ant-ink',
                            unit: 'MAD',
                            href: '/seller/payments',
                        },
                    ].map((kpi, i) => {
                        const Icon = kpi.icon;
                        return (
                            <button
                                type="button"
                                key={i}
                                onClick={() => navigate(kpi.href)}
                                className="bg-ant-paper p-4 text-left hover:bg-ant-light/60 transition-colors cursor-pointer group"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className={`h-1.5 w-1.5 rounded-full ${kpi.dot}`} />
                                        {kpi.label}
                                    </div>
                                    <div className={`h-8 w-8 rounded-lg border flex items-center justify-center ${kpi.iconBg}`}>
                                        <Icon className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className={`font-display text-[22px] font-semibold tabular-nums mt-2 truncate ${kpi.text}`}>
                                    {kpi.value}
                                    {kpi.unit && <span className="text-[12px] text-ant-mid font-normal ml-1.5">{kpi.unit}</span>}
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{kpi.sub}</p>
                            </button>
                        );
                    })}
                </section>

                {/* Conversion pipeline */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">01</span>
                                Pipeline de conversion
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/seller/statistics')}
                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                            >
                                Analyse détaillée
                                <ChevronRight className="w-3 h-3" strokeWidth={1.75} />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[
                                { label: 'Attribuées', value: stats.totalOrders, pct: 100, tone: 'bar-ink' },
                                { label: 'Confirmées', value: stats.confirmedOrders, pct: stats.confirmRate, tone: 'bar-orange' },
                                { label: 'Livrées', value: stats.deliveredOrders, pct: stats.successRate, tone: 'bar-green' },
                            ].map((step) => {
                                const barColor = step.tone === 'bar-green' ? 'bg-ant-green' : step.tone === 'bar-orange' ? 'bg-ant-orange' : 'bg-ant-ink';
                                const dotColor = step.tone === 'bar-green' ? 'bg-ant-green' : step.tone === 'bar-orange' ? 'bg-ant-orange' : 'bg-ant-ink';
                                return (
                                    <div key={step.label} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                                                {step.label}
                                            </div>
                                            <span className="font-display text-[14px] font-semibold tabular-nums text-ant-ink">
                                                {step.value}
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${barColor} rounded-full transition-all duration-700`}
                                                style={{ width: `${Math.min(100, step.pct)}%` }}
                                            />
                                        </div>
                                        <p className="font-serif italic text-[11px] text-ant-mid tabular-nums">{step.pct.toFixed(1)}%</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </section>

                {/* Performance */}
                {userProfile?.id ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">02</span>
                                Performance personnelle
                            </div>
                            <AnalyticsDateFilter dateFilter={perfDateFilter} onDateFilterChange={setPerfDateFilter} variant="ant" />
                        </div>
                        <SellerSelfPerformanceSection
                            sellerId={userProfile.id}
                            businessId={userProfile['DigiCom Business']}
                            dateFilter={perfDateFilter}
                        />
                    </div>
                ) : null}

                {/* Quick access + activity */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="p-5 space-y-3">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">03</span>
                                Accès rapides
                            </div>
                            <div className="space-y-1.5">
                                {[
                                    { label: 'Traiter les commandes', path: '/seller/orders', badge: stats.pendingOrders > 0 ? stats.pendingOrders : null },
                                    { label: 'Voir les statistiques', path: '/seller/statistics', badge: null },
                                    { label: 'Voir les paiements', path: '/seller/payments', badge: null },
                                    { label: 'Soumettre une demande', path: '/seller/demands', badge: null },
                                    { label: 'Mon profil', path: '/seller/profile', badge: null },
                                ].map((action) => (
                                    <button
                                        key={action.path}
                                        type="button"
                                        onClick={() => navigate(action.path)}
                                        className="w-full flex items-center justify-between h-9 px-3 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-left transition-colors cursor-pointer"
                                    >
                                        <span className="text-[12px] font-medium text-ant-ink">{action.label}</span>
                                        {action.badge !== null ? (
                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange tabular-nums">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                {action.badge}
                                            </span>
                                        ) : (
                                            <ChevronRight className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="lg:col-span-2 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">04</span>
                                Flux d&apos;activité
                            </div>
                            <span className="font-serif italic text-[11px] text-ant-mid">commandes récentes</span>
                        </div>
                        <div className="max-h-[420px] overflow-y-auto ant-scroll">
                            {loading ? (
                                <div className="p-5 space-y-2">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="h-12 bg-ant-light rounded-lg animate-pulse" />
                                    ))}
                                </div>
                            ) : recentOrders.length === 0 ? (
                                <div className="p-10 flex flex-col items-center gap-2 text-center">
                                    <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                                        <ShoppingCart className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid">Aucune commande pour l&apos;instant</p>
                                </div>
                            ) : (
                                groupedOrders.map((group, gi) => (
                                    <div key={gi}>
                                        <div className="px-5 py-2 bg-ant-light/70 sticky top-0 z-10 border-b border-ant-line">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                {group.label}
                                            </p>
                                        </div>
                                        <div className="divide-y divide-ant-line">
                                            {group.orders.map((order) => {
                                                const statusStyle = order.order_status_id
                                                    ? getStatusStyle(order.order_status_id)
                                                    : { backgroundColor: 'rgba(107,106,99,0.15)', color: '#6B6A63' };
                                                return (
                                                    <button
                                                        key={order.id}
                                                        type="button"
                                                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-ant-light/50 transition-colors cursor-pointer text-left"
                                                        onClick={() => navigate('/seller/orders')}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="w-10 h-10 bg-ant-light border border-ant-line rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                                                                {order.product_image ? (
                                                                    <img src={order.product_image} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <ShoppingCart className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-display text-[13px] font-semibold text-ant-ink truncate">{order.customer_name}</p>
                                                                <p className="font-serif italic text-[11px] text-ant-mid truncate">
                                                                    {order.product_name} · #{order.id.slice(0, 8)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <span
                                                                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize"
                                                                style={{
                                                                    backgroundColor: statusStyle.backgroundColor,
                                                                    borderColor: `${statusStyle.color}40`,
                                                                    color: statusStyle.color,
                                                                }}
                                                            >
                                                                <span
                                                                    className="h-1.5 w-1.5 rounded-full"
                                                                    style={{ backgroundColor: statusStyle.color }}
                                                                />
                                                                {order.status.replace('_', ' ')}
                                                            </span>
                                                            <span className="font-serif italic text-[11px] text-ant-mid">
                                                                {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>

                {/* Delivery performance + top product */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">05</span>
                                    Performance de livraison
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">toutes commandes confondues</span>
                            </div>
                            <div className="space-y-3 pt-1">
                                {[
                                    { label: 'Taux de livraison', pct: stats.successRate, bar: 'bg-ant-green', text: 'text-ant-green' },
                                    { label: 'Taux de confirmation', pct: stats.confirmRate, bar: 'bg-ant-orange', text: 'text-ant-orange' },
                                ].map((metric) => (
                                    <div key={metric.label} className="space-y-1.5">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">{metric.label}</span>
                                            <span className={`font-display text-[14px] font-semibold tabular-nums ${metric.text}`}>
                                                {metric.pct.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${metric.bar} rounded-full transition-all duration-700`}
                                                style={{ width: `${Math.min(100, metric.pct)}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">06</span>
                                    Top performer
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">meilleure référence</span>
                            </div>
                            {topProduct ? (
                                <div className="flex items-start gap-4">
                                    <div className="w-16 h-16 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center overflow-hidden shrink-0">
                                        {topProduct.image ? (
                                            <img src={topProduct.image} alt={topProduct.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Truck className="w-6 h-6 text-ant-mid" strokeWidth={1.5} />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-2">
                                        <p className="font-display text-[14px] font-semibold text-ant-ink truncate">{topProduct.name}</p>
                                        <div className="grid grid-cols-3 gap-px bg-ant-line rounded-lg border border-ant-line overflow-hidden">
                                            <div className="bg-ant-paper px-3 py-2">
                                                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Livré</p>
                                                <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink mt-0.5">{topProduct.delivered}</p>
                                            </div>
                                            <div className="bg-ant-paper px-3 py-2">
                                                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Succès</p>
                                                <p className="font-display text-[14px] font-semibold tabular-nums text-ant-green mt-0.5">{topProduct.successRate.toFixed(0)}%</p>
                                            </div>
                                            <div className="bg-ant-paper px-3 py-2">
                                                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ant-mid">CA</p>
                                                <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink mt-0.5">
                                                    {topProduct.revenue.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-6 flex flex-col items-center gap-2 text-center">
                                    <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                                        <Receipt className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                    </div>
                                    <p className="font-serif italic text-[12px] text-ant-mid">Pas encore de données produit</p>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default SellerDashboard;
