import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { imageUrl } from '@/lib/imageUrl';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { type CommissionBasis } from '@/lib/commercialCommission';
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
    // Status pill colors only — every stat below now comes from the RPC.
    const statusCats = useStatusCategories();
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [perfDateFilter, setPerfDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    useEffect(() => {
        initDashboard();
    }, []);

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
                .select('id, name, avatar_url, email, "DigiCom Business"')
                .eq('id', session.user.id)
                .single();
            if (profile) {
                setUserProfile(profile as UserProfile);
                logPresence(session.user.id, profile["DigiCom Business"]);
            }
        }
    };

    const sellerId = userProfile?.id ?? null;
    const businessId = userProfile?.['DigiCom Business'] ?? null;
    const statsEnabled = !!sellerId && !!businessId;

    // D2 — ONE server-side aggregate (seller_dashboard_stats) replaces the
    // own-orders full scan, the TWO business-wide parcel dumps and the
    // seller_payments sum. Commission money is ledger-reconciled in the RPC —
    // no client commission math remains. Lifetime pool (this page has no date
    // window of its own; the AnalyticsDateFilter only drives the
    // SellerSelfPerformanceSection). p_seller is ALWAYS the auth uid — the RPC
    // raises 42501 for anything else. Note: "today" tiles are now bucketed on
    // Africa/Casablanca days server-side (was browser-local — accepted D2 delta).
    const { data: dashStats, isLoading: statsFetching } = useQuery<any>({
        queryKey: ['dash-stats', 'seller', businessId, sellerId],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('seller_dashboard_stats', {
                p_business: businessId,
                p_seller: sellerId,
            });
            if (error) throw error;
            return data;
        },
        enabled: statsEnabled,
        staleTime: 60_000,
    });

    const loading = !userProfile || (statsEnabled && statsFetching);

    const stats: SellerStats = useMemo(() => {
        const strip = dashStats?.stat_strip;
        const money = dashStats?.money;
        return {
            todayOrders: Number(strip?.today_orders) || 0,
            deliveredToday: Number(strip?.delivered_today) || 0,
            pendingOrders: Number(strip?.pending) || 0,
            // Confirmed count = one-true-definition (rate-confirmed).
            confirmedOrders: Number(strip?.confirmed) || 0,
            deliveredOrders: Number(strip?.delivered) || 0,
            unpaidDeliveries: Number(money?.unpaid_deliveries) || 0,
            totalOrders: Number(strip?.total) || 0,
            liveCommission: Number(money?.live_commission) || 0,
            successRate: Number(strip?.success_rate) || 0,
            confirmRate: Number(strip?.confirm_rate) || 0,
            commissionRate: Number(money?.commission_rate) || 0,
            commissionBasis: money?.commission_basis === 'per_unit' ? 'per_unit' : 'per_order',
        };
    }, [dashStats]);

    // Top-10 slim rows straight from the RPC (created_at desc server-side).
    const recentOrders: RecentOrder[] = useMemo(() => (
        ((dashStats?.recent_orders ?? []) as any[]).map((r) => ({
            id: r.id,
            order_status_id: r.order_status_id ?? undefined,
            status: r.status || 'unknown',
            total_amount: Number(r.price) || 0,
            created_at: r.created_at,
            customer_name: r.customer_name || 'Unknown',
            product_name: r.product_name || 'N/A',
            product_image: r.product_image ?? null,
        }))
    ), [dashStats]);

    // Per-product table comes revenue-desc from the RPC — row 0 is the top performer.
    const topProduct: TopProduct | null = useMemo(() => {
        const top = ((dashStats?.product_table ?? []) as any[])[0];
        if (!top) return null;
        const delivered = Number(top.delivered) || 0;
        const prodDenom = (Number(top.tracked) || 0) - (Number(top.pullback) || 0);
        return {
            name: top.name || 'Unknown',
            image: top.image ?? null,
            delivered,
            revenue: Number(top.revenue) || 0,
            successRate: prodDenom > 0 ? (delivered / prodDenom) * 100 : 0,
        };
    }, [dashStats]);

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
                                                                    <img src={imageUrl(order.product_image, 'thumb')} alt="" className="w-full h-full object-cover" />
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
                                            <img src={imageUrl(topProduct.image, 'thumb')} alt={topProduct.name} className="w-full h-full object-cover" />
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
