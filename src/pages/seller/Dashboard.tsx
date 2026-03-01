import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
    ShoppingCart, DollarSign, Clock, Package, ArrowUpRight,
    TrendingUp, CheckCircle, ChevronRight, Truck, Eye,
    Receipt, Target, Zap, ShieldCheck, CalendarDays,
    BarChart3, MessageSquare, HeartPulse, Trophy, Star
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isToday, isYesterday, format } from 'date-fns';

interface UserProfile {
    id: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
    "DigiCom Business": string | null;
}

interface SellerStats {
    todayOrders: number;
    todayRevenue: number;
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
}

interface RecentOrder {
    id: string;
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



// --- Helper: Time-aware Greeting ---
const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
};

const SellerDashboard = () => {
    const navigate = useNavigate();
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [stats, setStats] = useState<SellerStats>({
        todayOrders: 0,
        todayRevenue: 0,
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
    });
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
    const [topProduct, setTopProduct] = useState<TopProduct | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        initDashboard();
        fetchSellerData();
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

            if (error) {
                console.error('Error logging presence:', error);
            }
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

            // Get seller config
            const { data: sellerData } = await supabase
                .from('users')
                .select('products, commission_price')
                .eq('id', userId)
                .single();

            const attributedProducts: string[] = sellerData?.products || [];
            const commissionRate = sellerData?.commission_price || 0;

            // Get orders attributed to this seller
            const { data: ordersData } = await supabase
                .from('orders')
                .select('id, price, created_at, name, package_status_label, order_statuses(code), order_items(product_id, products(name, image_url))')
                .eq('seller_id', userId)
                .order('created_at', { ascending: false });

            const orders = (ordersData || []).map(o => ({
                ...o,
                status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                packageStatus: ((o as any).package_status_label || '').toLowerCase()
            }));

            // Delivered = package_status is "Livré" (physically delivered by courier)
            const isDelivered = (o: any) => o.packageStatus === 'livré';
            const isPending = (o: any) => ['new', 'relaunch_new'].includes(o.status);
            const isConfirmed = (o: any) => ['confirmed', 'processed', 'paid', 'unpaid'].includes(o.status);

            const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
            const todayRevenue = todayOrders.reduce((sum, o) => sum + (Number((o as any).price) || 0), 0);

            const delivered = orders.filter(o => isDelivered(o)).length;
            const confirmed = orders.filter(o => isConfirmed(o)).length;
            const successRate = orders.length > 0 ? (delivered / orders.length) * 100 : 0;
            const confirmRate = orders.length > 0 ? (confirmed / orders.length) * 100 : 0;
            
            // Get already paid deliveries from seller_payments
            const { data: paymentsData } = await supabase
                .from('seller_payments')
                .select('delivered_orders, status')
                .eq('seller_id', userId)
                .eq('status', 'paid');

            const alreadyPaidDeliveries = (paymentsData || []).reduce((sum, p) => sum + (Number(p.delivered_orders) || 0), 0);
            
            // Live commission should only count unpaid deliveries
            const unpaidDeliveries = Math.max(0, delivered - alreadyPaidDeliveries);
            const liveCommission = unpaidDeliveries * commissionRate;

            setStats({
                todayOrders: todayOrders.length,
                todayRevenue,
                pendingOrders: orders.filter(o => isPending(o)).length,
                confirmedOrders: confirmed,
                deliveredOrders: delivered,
                unpaidDeliveries,
                totalOrders: orders.length,
                totalProducts: attributedProducts.length,
                liveCommission,
                successRate,
                confirmRate,
                commissionRate,
            });

            // Recent orders with product images
            setRecentOrders(orders.slice(0, 10).map(o => {
                const orderItem = (o.order_items as any)?.[0];
                const product = orderItem?.products;
                return {
                    id: o.id,
                    status: (o as any).status,
                    total_amount: Number((o as any).price) || 0,
                    created_at: (o as any).created_at,
                    customer_name: (o as any).name || 'Unknown',
                    product_name: product?.name || 'N/A',
                    product_image: product?.image_url || null,
                };
            }));

            // Top Product calculation
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

    const getUserName = () => {
        return userProfile?.name || userProfile?.email?.split('@')[0] || 'Seller';
    };

    const getStatusColor = (status: string) => {
        if (['paid', 'unpaid'].includes(status)) return 'bg-green-100 text-green-700';
        if (['new', 'relaunch_new'].includes(status)) return 'bg-orange-100 text-orange-700';
        if (status === 'confirmed') return 'bg-blue-100 text-blue-700';
        if (status === 'canceled') return 'bg-red-100 text-red-700';
        if (status === 'processed') return 'bg-indigo-100 text-indigo-700';
        if (['faux commande', 'commandedouble'].includes(status)) return 'bg-rose-100 text-rose-700';
        if (status === 'return') return 'bg-amber-100 text-amber-700';
        return 'bg-gray-100 text-gray-700';
    };

    // Group recent orders by day
    const groupedOrders = recentOrders.reduce<{ label: string; orders: RecentOrder[] }[]>((acc, order) => {
        const date = new Date(order.created_at);
        let label = format(date, 'MMM d, yyyy');
        if (isToday(date)) label = 'Today';
        else if (isYesterday(date)) label = 'Yesterday';

        const existing = acc.find(g => g.label === label);
        if (existing) {
            existing.orders.push(order);
        } else {
            acc.push({ label, orders: [order] });
        }
        return acc;
    }, []);

    // SVG Gauge Component
    const SuccessGauge = ({ value, size = 140 }: { value: number; size?: number }) => {
        const strokeWidth = 10;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const progress = (value / 100) * circumference;
        const color = value > 70 ? '#10B981' : value > 50 ? '#F59E0B' : '#EF4444';

        return (
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F3F4F6" strokeWidth={strokeWidth} />
                    <motion.circle
                        cx={size / 2} cy={size / 2} r={radius}
                        fill="none" stroke={color} strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset: circumference - progress }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-light text-gray-900">{value.toFixed(0)}%</span>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Success</span>
                </div>
            </div>
        );
    };

    return (
        <>


            {/* Dashboard Content */}
            <div className="space-y-8 pb-8">
                {/* ============ HEADER ============ */}
                <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                    <div className="relative p-8">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-6">
                                {userProfile?.avatar_url ? (
                                    <img
                                        src={userProfile.avatar_url}
                                        alt={getUserName()}
                                        className="w-20 h-20 rounded-full border-2 border-primary/20 shadow-lg object-cover"
                                    />
                                ) : (
                                    <div className="w-20 h-20 rounded-full border-2 border-primary/20 shadow-lg bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center">
                                        <span className="text-3xl font-light text-primary">
                                            {getUserName().charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                )}
                                <div>
                                    <p className="text-sm text-gray-400 font-medium mb-1">
                                        {getGreeting()}, {getUserName().split(' ')[0]}
                                    </p>
                                    <h1 className="text-4xl font-extralight text-gray-900 mb-1">
                                        Dashboard
                                    </h1>
                                    <p className="text-xs text-gray-400 flex items-center gap-2">
                                        <CalendarDays className="w-3 h-3" />
                                        {format(new Date(), 'EEEE, MMMM d, yyyy')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {stats.pendingOrders > 0 && (
                                    <motion.div
                                        initial={{ scale: 0.9 }}
                                        animate={{ scale: [0.9, 1.05, 0.9] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                    >
                                        <Badge className="bg-orange-500 text-white border-0 h-8 px-4 text-sm rounded-xl shadow-lg shadow-orange-500/20">
                                            {stats.pendingOrders} pending
                                        </Badge>
                                    </motion.div>
                                )}
                                <Button
                                    onClick={() => navigate('/seller/orders')}
                                    className="bg-gray-900 hover:bg-black text-white rounded-2xl h-12 px-6"
                                >
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Orders
                                    <ArrowUpRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ============ KPI GRID ============ */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {[
                        {
                            label: "Today's Orders",
                            value: stats.todayOrders,
                            sub: 'New orders received',
                            icon: ShoppingCart,
                            color: 'text-blue-600',
                            bg: 'bg-blue-50',
                            gradient: 'from-blue-50 to-white',
                        },

                        {
                            label: 'Pending',
                            value: stats.pendingOrders,
                            sub: 'Awaiting confirmation',
                            icon: Clock,
                            color: 'text-orange-600',
                            bg: 'bg-orange-50',
                            gradient: 'from-orange-50 to-white',
                            pulse: stats.pendingOrders > 0,
                        },
                        {
                            label: 'Delivered',
                            value: `${stats.deliveredOrders}/${stats.totalOrders}`,
                            sub: 'Fulfillment ratio',
                            icon: Truck,
                            color: 'text-emerald-600',
                            bg: 'bg-emerald-50',
                            gradient: 'from-emerald-50 to-white',
                        },
                        {
                            label: 'Live Commission (Unpaid)',
                            value: `${stats.liveCommission.toLocaleString()} MAD`,
                            sub: `${stats.commissionRate} MAD × ${stats.unpaidDeliveries} unpaid deliveries`,
                            icon: Receipt,
                            color: 'text-amber-600',
                            bg: 'bg-amber-50',
                            gradient: 'from-amber-50 to-white',
                        },
                    ].map((kpi, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.08, duration: 0.4 }}
                        >
                            <Card className={`border-0 shadow-sm rounded-3xl overflow-hidden bg-gradient-to-br ${kpi.gradient} hover:shadow-xl transition-all duration-500 group h-full`}>
                                <CardContent className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className={`w-11 h-11 ${kpi.bg} ${kpi.color} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500`}>
                                            <kpi.icon className="w-5 h-5" />
                                        </div>
                                        {(kpi as any).pulse && (
                                            <span className="relative flex h-3 w-3">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-2xl font-light text-gray-900 mb-1">{kpi.value}</h3>
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-0.5">{kpi.label}</p>
                                    <p className="text-[10px] text-gray-400 font-light">{kpi.sub}</p>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ))}
                </div>

                {/* ============ CONVERSION SNAPSHOT (full width) ============ */}
                <Card className="border-0 shadow-sm rounded-3xl overflow-hidden bg-white">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
                                    <ShieldCheck className="w-4 h-4 text-indigo-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-900">Conversion Pipeline</p>
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Live Funnel Status</p>
                                </div>
                            </div>
                            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => navigate('/seller/statistics')}>
                                Deep Dive <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                            {/* Funnel steps */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase">
                                    <span>Attributed</span>
                                    <span>{stats.totalOrders}</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 0.8 }} className="h-full bg-gray-400 rounded-full" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase">
                                    <span>Confirmed</span>
                                    <span>{stats.confirmRate.toFixed(0)}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${stats.confirmRate}%` }} transition={{ duration: 1 }} className="h-full bg-blue-500 rounded-full" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase">
                                    <span>Delivered</span>
                                    <span>{stats.successRate.toFixed(0)}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${stats.successRate}%` }} transition={{ duration: 1.2 }} className="h-full bg-emerald-500 rounded-full" />
                                </div>
                            </div>
                            {/* Earnings result */}
                            <div className="flex items-center justify-center gap-3 p-4 bg-amber-50/60 rounded-2xl border border-amber-100/50">
                                <Receipt className="w-5 h-5 text-amber-500" />
                                <div>
                                    <p className="text-lg font-light text-gray-900">{stats.liveCommission.toLocaleString()} <span className="text-xs text-gray-400 font-bold">MAD</span></p>
                                    <p className="text-[9px] uppercase tracking-widest font-bold text-amber-600">Unpaid Commission</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* ============ COMMAND CENTER + ACTIVITY FEED ============ */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Command Center */}
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden lg:col-span-1">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50 to-transparent p-6">
                            <CardTitle className="text-lg font-light text-gray-900">Command Center</CardTitle>
                        </CardHeader>
                        <CardContent className="p-5 space-y-3">
                            {[
                                {
                                    label: 'Process Orders',
                                    icon: CheckCircle,
                                    iconColor: 'text-blue-500',
                                    bg: 'bg-blue-50',
                                    path: '/seller/orders',
                                    badge: stats.pendingOrders > 0 ? stats.pendingOrders : null,
                                    badgeColor: 'bg-primary text-white',
                                },
                                {
                                    label: 'View Statistics',
                                    icon: BarChart3,
                                    iconColor: 'text-indigo-500',
                                    bg: 'bg-indigo-50',
                                    path: '/seller/statistics',
                                    badge: null,
                                    badgeColor: '',
                                },
                                {
                                    label: 'View Payments',
                                    icon: DollarSign,
                                    iconColor: 'text-green-500',
                                    bg: 'bg-green-50',
                                    path: '/seller/payments',
                                    badge: null,
                                    badgeColor: '',
                                },
                                {
                                    label: 'Submit Demand',
                                    icon: MessageSquare,
                                    iconColor: 'text-purple-500',
                                    bg: 'bg-purple-50',
                                    path: '/seller/demands',
                                    badge: null,
                                    badgeColor: '',
                                },
                                {
                                    label: 'My Profile',
                                    icon: Target,
                                    iconColor: 'text-orange-500',
                                    bg: 'bg-orange-50',
                                    path: '/seller/profile',
                                    badge: null,
                                    badgeColor: '',
                                },
                            ].map((action, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.3 + i * 0.06 }}
                                >
                                    <Button
                                        onClick={() => navigate(action.path)}
                                        variant="outline"
                                        className="w-full justify-between h-12 rounded-2xl group border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-all duration-300"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 ${action.bg} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                                                <action.icon className={`w-4 h-4 ${action.iconColor}`} />
                                            </div>
                                            <span className="text-sm text-gray-700">{action.label}</span>
                                        </div>
                                        {action.badge !== null ? (
                                            <Badge className={`${action.badgeColor} border-0 text-xs rounded-lg`}>{action.badge}</Badge>
                                        ) : (
                                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                                        )}
                                    </Button>
                                </motion.div>
                            ))}
                        </CardContent>
                    </Card>

                    {/* Activity Feed */}
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden lg:col-span-2">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50 to-transparent p-6">
                            <CardTitle className="text-lg font-light text-gray-900">Activity Feed</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 max-h-[440px] overflow-y-auto">
                            {loading ? (
                                <div className="p-6 space-y-4">
                                    {[1, 2, 3, 4].map(i => (
                                        <div key={i} className="h-14 bg-gray-50 rounded-xl animate-pulse" />
                                    ))}
                                </div>
                            ) : recentOrders.length === 0 ? (
                                <div className="p-12 text-center">
                                    <ShoppingCart className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                                    <p className="text-gray-400 font-light">No orders yet</p>
                                </div>
                            ) : (
                                <div>
                                    {groupedOrders.map((group, gi) => (
                                        <div key={gi}>
                                            <div className="px-6 py-2 bg-gray-50/80 sticky top-0 z-10">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{group.label}</p>
                                            </div>
                                            <div className="divide-y divide-gray-50">
                                                {group.orders.map((order) => (
                                                    <div
                                                        key={order.id}
                                                        className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                                                        onClick={() => navigate('/seller/orders')}
                                                    >
                                                        <div className="flex items-center gap-3.5">
                                                            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                                                                {order.product_image ? (
                                                                    <img src={order.product_image} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <ShoppingCart className="w-4 h-4 text-gray-400" />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-gray-900 truncate">{order.customer_name}</p>
                                                                <p className="text-[10px] text-gray-400 truncate">{order.product_name} · #{order.id.slice(0, 8)}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3 flex-shrink-0">
                                                            <Badge className={`border-0 text-[10px] rounded-lg ${getStatusColor(order.status)}`}>
                                                                {order.status.replace('_', ' ')}
                                                            </Badge>
                                                            <p className="text-[10px] text-gray-400">
                                                                {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* ============ PERFORMANCE SNAPSHOT ============ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Success Gauge */}
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden">
                        <CardContent className="p-8 flex items-center gap-8">
                            <SuccessGauge value={stats.successRate} size={140} />
                            <div className="flex-1 space-y-4">
                                <div>
                                    <p className="text-lg font-light text-gray-900 mb-1">Delivery Performance</p>
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Your success rate across all orders</p>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Your Rate</span>
                                        <span className="text-xs font-bold text-gray-900">{stats.successRate.toFixed(1)}%</span>
                                    </div>
                                    <div className="relative h-2 bg-gray-100 rounded-full">
                                        <div className="absolute top-0 left-0 h-full bg-gray-200 rounded-full" style={{ width: '64.2%' }} />
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${stats.successRate}%` }}
                                            transition={{ duration: 1.2 }}
                                            className="absolute top-0 left-0 h-full bg-primary rounded-full shadow-lg shadow-primary/20"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <Trophy className="w-3 h-3 text-amber-500" />
                                            <span className="text-[10px] font-bold text-gray-400 uppercase">Network Avg: 64.2%</span>
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase">Elite: 82%</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Top Product Highlight */}
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden">
                        <CardContent className="p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
                                    <Star className="w-4 h-4 text-amber-500" />
                                </div>
                                <div>
                                    <p className="text-lg font-light text-gray-900">Top Performer</p>
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Your best-selling product</p>
                                </div>
                            </div>
                            {topProduct ? (
                                <div className="flex items-center gap-5">
                                    <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center overflow-hidden border border-gray-100 flex-shrink-0">
                                        {topProduct.image ? (
                                            <img src={topProduct.image} alt={topProduct.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Package className="w-8 h-8 text-gray-200" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate mb-3">{topProduct.name}</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-2 bg-green-50/60 rounded-xl text-center">
                                                <p className="text-sm font-bold text-gray-900">{topProduct.delivered}</p>
                                                <p className="text-[9px] text-gray-400 font-bold uppercase">Delivered</p>
                                            </div>
                                            <div className="p-2 bg-amber-50/60 rounded-xl text-center">
                                                <p className="text-sm font-bold text-gray-900">{topProduct.successRate.toFixed(0)}%</p>
                                                <p className="text-[9px] text-gray-400 font-bold uppercase">Success</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-6">
                                    <Package className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                                    <p className="text-sm text-gray-400 font-light">No product data yet</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
};

export default SellerDashboard;
