import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    computeUnpaidCommission,
    normalizeCommissionBasis,
    isConfirmed,
    isDeliveredForCommission,
    isDeliveredOnLocalDay,
    type CommissionBasis,
} from '@/lib/commercialCommission';
import {
    ShoppingCart, Eye, ChevronRight, Truck, Receipt
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';
import { AnalyticsDateFilter, type DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { SellerSelfPerformanceSection } from '@/components/dashboard/SellerSelfPerformanceSection';
import { SellerWhatsAppUnreadCard } from '@/components/dashboard/SellerWhatsAppUnreadCard';

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

            let ordersQuery = supabase
                .from('orders')
                .select('id, price, created_at, updated_at, date_livraison, name, order_status_id, package_status_id, package_status_label, order_statuses(code), package_statuses(label), order_items(product_id, quantity, products(name, image_url))')
                .eq('seller_id', userId)
                .is('date_deleted', null);
            if (sellerBusinessId) {
                ordersQuery = ordersQuery.eq('DigiCom Business', sellerBusinessId);
            }
            const { data: ordersData } = await ordersQuery.order('created_at', { ascending: false });

            const orders = (ordersData || []).map(o => ({
                ...o,
                order_status_id: (o as any).order_status_id,
                package_status_id: (o as any).package_status_id,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                packageStatus: ((o as any).package_status_label || '').toLowerCase()
            }));

            const isDelivered = (o: any) => isDeliveredForCommission(o, statusCats.deliveredPkgIds);
            const isPending = (o: any) => statusCats.pendingIds.has(o.order_status_id);
            const isOrderConfirmed = (o: any) => isConfirmed(o, statusCats.confirmedIds);

            const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
            const now = new Date();
            const deliveredToday = orders.filter(o =>
                isDeliveredOnLocalDay(o, statusCats.deliveredPkgIds, now),
            ).length;

            const delivered = orders.filter(o => isDelivered(o)).length;
            const confirmed = orders.filter(o => isOrderConfirmed(o)).length;
            const successRate = orders.length > 0 ? (delivered / orders.length) * 100 : 0;
            const confirmRate = orders.length > 0 ? (confirmed / orders.length) * 100 : 0;

            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('delivered_orders, status')
                .eq('seller_id', userId)
                .eq('status', 'paid');

            const alreadyPaidDeliveries = (paymentsData || []).reduce((sum, p) => sum + (Number(p.delivered_orders) || 0), 0);

            const { unpaidCommission: liveCommission, unpaidAccrued: unpaidDeliveries } = computeUnpaidCommission({
                basis: commissionBasis,
                commissionPrice: Number(commissionRate) || 0,
                orders,
                isDelivered,
                sellerProductIds: attributedProducts,
                paidTally: alreadyPaidDeliveries,
            });

            setStats({
                todayOrders: todayOrders.length,
                deliveredToday,
                pendingOrders: orders.filter(o => isPending(o)).length,
                confirmedOrders: confirmed,
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

            setRecentOrders(orders.slice(0, 10).map(o => {
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

            const productMap: Record<string, { name: string; image: string | null; delivered: number; total: number; revenue: number }> = {};
            orders.forEach((o: any) => {
                const item = o.order_items?.[0];
                if (!item) return;
                const pName = item.products?.name || 'Unknown';
                if (!productMap[pName]) {
                    productMap[pName] = { name: pName, image: item.products?.image_url || null, delivered: 0, total: 0, revenue: 0 };
                }
                productMap[pName].total++;
                if (isDelivered(o)) {
                    productMap[pName].delivered++;
                    productMap[pName].revenue += Number(o.price) || 0;
                }
            });

            const topProd = Object.values(productMap).sort((a, b) => b.revenue - a.revenue)[0];
            if (topProd) {
                setTopProduct({
                    name: topProd.name,
                    image: topProd.image,
                    delivered: topProd.delivered,
                    revenue: topProd.revenue,
                    successRate: topProd.total > 0 ? (topProd.delivered / topProd.total) * 100 : 0,
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

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Dashboard
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Seller Overview
                        </p>
                    </div>
                    <Button
                        onClick={() => navigate('/seller/orders')}
                        className="h-8 rounded-md text-[11px] font-semibold"
                    >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        View Orders
                    </Button>
                </div>
            </header>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {[
                    {
                        label: 'Orders today',
                        value: stats.todayOrders,
                        sub: 'By creation date',
                        accent: '#3b5e5e',
                        href: '/seller/orders',
                    },
                    {
                        label: 'Pending',
                        value: stats.pendingOrders,
                        sub: 'Awaiting confirmation',
                        accent: '#d97706',
                        href: '/seller/orders',
                    },
                    {
                        label: 'Delivered today',
                        value: stats.deliveredToday,
                        sub: `All-time: ${stats.deliveredOrders}/${stats.totalOrders}`,
                        accent: '#059669',
                        href: '/seller/orders',
                    },
                    {
                        label: 'Live commission (unpaid)',
                        value: `${stats.liveCommission.toLocaleString()} MAD`,
                        sub: stats.commissionBasis === 'per_unit'
                            ? `${stats.commissionRate} MAD × ${stats.unpaidDeliveries} units`
                            : `${stats.commissionRate} MAD × ${stats.unpaidDeliveries} orders`,
                        accent: '#d97706',
                        href: '/seller/payments',
                    },
                ].map((kpi, i) => (
                    <div
                        key={i}
                        role="link"
                        tabIndex={0}
                        className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5 cursor-pointer hover:border-gray-200 transition-colors"
                        onClick={() => navigate(kpi.href)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(kpi.href); } }}
                    >
                        <span className="w-[3px] self-stretch rounded-full" style={{ background: kpi.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{kpi.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{kpi.value}</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">{kpi.sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Conversion Pipeline */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-[11px] font-semibold text-brand-navy">Conversion Pipeline</p>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Live funnel</p>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => navigate('/seller/statistics')}>
                        Deep Dive <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        { label: 'Attributed', value: stats.totalOrders, pct: 100, color: '#9ca3af' },
                        { label: 'Confirmed', value: stats.confirmedOrders, pct: stats.confirmRate, color: '#3b5e5e' },
                        { label: 'Delivered', value: stats.deliveredOrders, pct: stats.successRate, color: '#059669' },
                    ].map((step) => (
                        <div key={step.label} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{step.label}</span>
                                <span className="text-[10px] font-bold text-brand-navy tabular-nums">{step.value}</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div style={{ width: `${step.pct}%`, background: step.color }} className="h-full rounded-full transition-all duration-700" />
                            </div>
                            <p className="text-[9px] text-gray-400 tabular-nums">{step.pct.toFixed(0)}%</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* WhatsApp Card */}
            <SellerWhatsAppUnreadCard businessId={userProfile?.['DigiCom Business'] || ''} />

            {/* Performance Section */}
            {userProfile?.id ? (
                <div className="space-y-2.5">
                    <div className="flex justify-end">
                        <AnalyticsDateFilter dateFilter={perfDateFilter} onDateFilterChange={setPerfDateFilter} />
                    </div>
                    <SellerSelfPerformanceSection
                        sellerId={userProfile.id}
                        businessId={userProfile['DigiCom Business']}
                        dateFilter={perfDateFilter}
                    />
                </div>
            ) : null}

            {/* Two column: Quick Links + Activity Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                {/* Quick Links */}
                <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-1.5">
                    <p className="text-[11px] font-semibold text-brand-navy mb-2">Quick Access</p>
                    {[
                        { label: 'Process Orders', path: '/seller/orders', badge: stats.pendingOrders > 0 ? stats.pendingOrders : null },
                        { label: 'View Statistics', path: '/seller/statistics', badge: null },
                        { label: 'View Payments', path: '/seller/payments', badge: null },
                        { label: 'Submit Demand', path: '/seller/demands', badge: null },
                        { label: 'My Profile', path: '/seller/profile', badge: null },
                    ].map((action) => (
                        <button
                            key={action.path}
                            onClick={() => navigate(action.path)}
                            className="w-full flex items-center justify-between h-8 px-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors text-left"
                        >
                            <span className="text-[11px] font-medium text-gray-700">{action.label}</span>
                            {action.badge !== null ? (
                                <Badge className="bg-brand-navy text-white border-0 text-[10px] h-4 px-1.5 rounded">{action.badge}</Badge>
                            ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Activity Feed */}
                <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="p-3.5 border-b border-gray-50">
                        <p className="text-[11px] font-semibold text-brand-navy">Activity Feed</p>
                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Recent orders</p>
                    </div>
                    <div className="max-h-[380px] overflow-y-auto">
                        {loading ? (
                            <div className="p-4 space-y-2.5">
                                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}
                            </div>
                        ) : recentOrders.length === 0 ? (
                            <div className="p-8 text-center">
                                <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                <p className="text-[11px] text-gray-400">No orders yet</p>
                            </div>
                        ) : (
                            groupedOrders.map((group, gi) => (
                                <div key={gi}>
                                    <div className="px-3.5 py-1.5 bg-gray-50/80 sticky top-0 z-10">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{group.label}</p>
                                    </div>
                                    <div className="divide-y divide-gray-50">
                                        {group.orders.map((order) => (
                                            <div
                                                key={order.id}
                                                className="flex items-center justify-between px-3.5 py-2.5 hover:bg-gray-50/50 transition-colors cursor-pointer"
                                                onClick={() => navigate('/seller/orders')}
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                                        {order.product_image ? (
                                                            <img src={order.product_image} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <ShoppingCart className="w-3.5 h-3.5 text-gray-400" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-[11px] font-semibold text-brand-navy truncate">{order.customer_name}</p>
                                                        <p className="text-[9px] text-gray-400 truncate">{order.product_name} · #{order.id.slice(0, 8)}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Badge
                                                        className="border-0 text-[9px] rounded px-1.5 h-4"
                                                        style={order.order_status_id ? getStatusStyle(order.order_status_id) : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                                                    >
                                                        {order.status.replace('_', ' ')}
                                                    </Badge>
                                                    <p className="text-[9px] text-gray-400">
                                                        {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Top Product + Performance Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {/* Success Rate */}
                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <p className="text-[11px] font-semibold text-brand-navy mb-1">Delivery Performance</p>
                    <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mb-3">Success rate across all orders</p>
                    <div className="space-y-2">
                        {[
                            { label: 'Delivery Rate', pct: stats.successRate, color: '#059669' },
                            { label: 'Confirmation Rate', pct: stats.confirmRate, color: '#3b5e5e' },
                        ].map((metric) => (
                            <div key={metric.label} className="space-y-1">
                                <div className="flex justify-between">
                                    <span className="text-[10px] font-semibold text-gray-500">{metric.label}</span>
                                    <span className="text-[10px] font-bold text-brand-navy tabular-nums">{metric.pct.toFixed(1)}%</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div style={{ width: `${metric.pct}%`, background: metric.color }} className="h-full rounded-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Top Product */}
                <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <p className="text-[11px] font-semibold text-brand-navy mb-1">Top Performer</p>
                    <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mb-3">Best-selling product</p>
                    {topProduct ? (
                        <div className="flex items-center gap-3">
                            <div className="w-14 h-14 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 shrink-0">
                                {topProduct.image ? (
                                    <img src={topProduct.image} alt={topProduct.name} className="w-full h-full object-cover" />
                                ) : (
                                    <Truck className="w-6 h-6 text-gray-200" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <p className="text-[11px] font-semibold text-brand-navy truncate">{topProduct.name}</p>
                                <div className="flex items-center gap-3">
                                    <div>
                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Delivered</p>
                                        <p className="text-[13px] font-semibold text-brand-navy tabular-nums">{topProduct.delivered}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Success</p>
                                        <p className="text-[13px] font-semibold text-emerald-600 tabular-nums">{topProduct.successRate.toFixed(0)}%</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Revenue</p>
                                        <p className="text-[13px] font-semibold text-brand-navy tabular-nums">{topProduct.revenue.toLocaleString()} MAD</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4">
                            <Receipt className="w-8 h-8 text-gray-200 mx-auto mb-1.5" />
                            <p className="text-[11px] text-gray-400">No product data yet</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SellerDashboard;
