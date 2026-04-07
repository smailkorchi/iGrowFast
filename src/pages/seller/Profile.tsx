import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { normalizeCommissionBasis, isDeliveredForCommission } from '@/lib/commercialCommission';
import {
    User, Mail, ShieldCheck, DollarSign, TrendingUp,
    Calendar, LogOut, Loader2, CreditCard, Building2,
    Fingerprint, MapPin, Zap, CheckCircle2, Target,
    Search, ChevronLeft, ChevronRight, Package, X,
    SlidersHorizontal, ArrowUpDown
} from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface SellerProfileData {
    id: string;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    avatar_url: string | null;
    commission_price: number;
    commission_basis?: string | null;
    created_at: string;
    products: any[] | null;
    bank_account_holder: string | null;
    bank_name: string | null;
    bank_rib: string | null;
    cin_number: string | null;
    address: string | null;
}

interface ProductStat {
    id: string;
    name: string;
    image_url: string | null;
    code: string;
    label: string | null;
    description: string | null;
    selling_price: number;
    cost_price: number;
    stock: number;
    total: number;
    confirmed: number;
    delivered: number;
}

type ProductSort = 'attributed' | 'delivered' | 'performance' | 'name';
type PerformanceBucket = 'all' | 'high' | 'mid' | 'low' | 'none';

const getDeliveryRate = (p: ProductStat) => (p.total > 0 ? (p.delivered / p.total) * 100 : 0);
const getConfirmRate = (p: ProductStat) => (p.total > 0 ? (p.confirmed / p.total) * 100 : 0);

const SellerProfile = () => {
    const { toast } = useToast();
    const statusCats = useStatusCategories();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<SellerProfileData | null>(null);

    const [bankInfo, setBankInfo] = useState({
        bank_name: '',
        bank_account_holder: '',
        bank_rib: '',
        cin_number: '',
        address: ''
    });

    const [stats, setStats] = useState({
        total: 0,
        confirmed: 0,
        delivered: 0,
        confirmationRate: 0,
        deliveryRate: 0,
        performanceStatus: 'Standard'
    });

    const [productStats, setProductStats] = useState<ProductStat[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<ProductStat | null>(null);
    const [sortBy, setSortBy] = useState<ProductSort>('attributed');
    const [performanceBucket, setPerformanceBucket] = useState<PerformanceBucket>('all');

    useEffect(() => {
        fetchProfile();
    }, [statusCats.confirmedIds, statusCats.deliveredPkgIds]);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const { data: seller, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

            if (error) throw error;

            if (seller) {
                setProfile(seller as any);
                setBankInfo({
                    bank_name: seller.bank_name || '',
                    bank_account_holder: seller.bank_account_holder || '',
                    bank_rib: seller.bank_rib || '',
                    cin_number: seller.cin_number || '',
                    address: seller.address || ''
                });

                // Fetch real performance stats
                const { data: ordersData, error: ordersError } = await supabase
                    .from('orders')
                    .select('order_status_id, package_status_id, package_status_label, order_statuses(code), package_statuses(label)')
                    .eq('seller_id', session.user.id);

                if (!ordersError && ordersData) {
                    const ordersList = ordersData;
                    const total = ordersList.length;
                    const confirmed = ordersList.filter(o => statusCats.confirmedIds.has(o.order_status_id)).length;
                    const delivered = ordersList.filter(o => isDeliveredForCommission(o, statusCats.deliveredPkgIds)).length;

                    const cRate = total > 0 ? (confirmed / total) * 100 : 0;
                    const dRate = confirmed > 0 ? (delivered / confirmed) * 100 : 0;

                    let status = 'Standard';
                    if (dRate >= 90 && cRate >= 80) status = 'Elite';
                    else if (dRate >= 75) status = 'Pro';
                    else if (total > 0 && dRate < 40) status = 'Review';

                    setStats({
                        total,
                        confirmed,
                        delivered,
                        confirmationRate: Math.round(cRate),
                        deliveryRate: Math.round(dRate),
                        performanceStatus: status
                    });
                }

                // Fetch Product-specific stats
                const productIds = seller.products || [];
                if (productIds.length > 0) {
                    const { data: productsData } = await supabase
                        .from('products')
                        .select('id, name, image_url, code, label, description, selling_price, cost_price, stock')
                        .eq('active', true)
                        .in('id', productIds);

                    const { data: orderItemsData } = await supabase
                        .from('order_items')
                        .select('order_id, product_id, orders!inner(seller_id, order_status_id, package_status_id, package_status_label, order_statuses(code), package_statuses(label))')
                        .eq('orders.seller_id', session.user.id);

                    const orderItems = (orderItemsData || []).map(oi => ({
                        ...oi,
                        orders: oi.orders as any,
                    }));

                    if (productsData) {
                        const calculatedProductStats = productsData.map(p => {
                            const items = orderItems?.filter(oi => oi.product_id === p.id) || [];

                            // Extract unique orders for this product to prevent double counting
                            const uniqueOrdersMap = new Map();
                            items.forEach(i => {
                                if (i.order_id && !uniqueOrdersMap.has(i.order_id)) {
                                    uniqueOrdersMap.set(i.order_id, i.orders);
                                }
                            });

                            const uniqueOrders = Array.from(uniqueOrdersMap.values());

                            // name in DB is text; legacy rows may be a JSON-encoded object string.
                            let nameStr = '';
                            if (typeof p.name === 'string') {
                                const trimmed = p.name.trim();
                                if (trimmed.startsWith('{')) {
                                    try {
                                        const parsed = JSON.parse(trimmed);
                                        nameStr = parsed.en || Object.values(parsed)[0] || '';
                                    } catch {
                                        nameStr = trimmed;
                                    }
                                } else {
                                    nameStr = trimmed;
                                }
                            } else if (p.name && typeof p.name === 'object') {
                                nameStr = (p.name as any).en || Object.values(p.name as any)[0] || '';
                            }
                            if (!nameStr) nameStr = p.label || p.code || 'Unnamed Product';

                            return {
                                id: p.id,
                                name: nameStr,
                                image_url: p.image_url,
                                code: p.code || '',
                                label: p.label,
                                description: p.description,
                                selling_price: Number(p.selling_price) || 0,
                                cost_price: Number(p.cost_price) || 0,
                                stock: Number(p.stock) || 0,
                                total: uniqueOrders.length,
                                confirmed: uniqueOrders.filter(o => {
                                    const oo = Array.isArray(o) ? o[0] : o;
                                    return oo?.order_status_id && statusCats.confirmedIds.has(oo.order_status_id);
                                }).length,
                                delivered: uniqueOrders.filter(o => {
                                    const oo = Array.isArray(o) ? o[0] : o;
                                    return isDeliveredForCommission(oo, statusCats.deliveredPkgIds);
                                }).length
                            };
                        });
                        setProductStats(calculatedProductStats);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
        } finally {
            setLoading(false);
        }
    };
    const handleUpdateBankInfo = async () => {
        try {
            setSaving(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const { error } = await supabase
                .from('users')
                .update(bankInfo)
                .eq('id', session.user.id);

            if (error) throw error;

            toast({
                title: "Success",
                description: "Bank & Identity information saved successfully.",
            });

            // Refresh profile to lock the fields
            fetchProfile();
        } catch (error) {
            console.error('Error updating bank info:', error);
            toast({
                title: "Error",
                description: "Failed to save information.",
                variant: "destructive",
            });
        } finally {
            setSaving(false);
        }
    };

    const filteredProducts = React.useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        let list = productStats.filter((p) => {
            if (!q) return true;
            return (
                p.name.toLowerCase().includes(q) ||
                (p.code || '').toLowerCase().includes(q) ||
                (p.label || '').toLowerCase().includes(q)
            );
        });

        if (performanceBucket !== 'all') {
            list = list.filter((p) => {
                if (p.total === 0) return performanceBucket === 'none';
                const r = getDeliveryRate(p);
                if (performanceBucket === 'high') return r >= 60;
                if (performanceBucket === 'mid') return r >= 30 && r < 60;
                if (performanceBucket === 'low') return r < 30;
                return true;
            });
        }

        const sorted = [...list];
        sorted.sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'attributed') return b.total - a.total;
            if (sortBy === 'delivered') return b.delivered - a.delivered;
            if (sortBy === 'performance') return getDeliveryRate(b) - getDeliveryRate(a);
            return 0;
        });
        return sorted;
    }, [productStats, searchQuery, sortBy, performanceBucket]);

    const bucketCounts = React.useMemo(() => {
        const c = { all: productStats.length, high: 0, mid: 0, low: 0, none: 0 };
        productStats.forEach((p) => {
            if (p.total === 0) c.none++;
            else {
                const r = getDeliveryRate(p);
                if (r >= 60) c.high++;
                else if (r >= 30) c.mid++;
                else c.low++;
            }
        });
        return c;
    }, [productStats]);


    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/auth';
    };

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h1 className="text-4xl font-extralight text-gray-900 mb-2">My Profile</h1>
                        <p className="text-gray-500 font-light">Manage your professional identity and view performance stats.</p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleLogout}
                        className="rounded-2xl border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all duration-300 h-12 px-6"
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        Log Out
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
                <div className="lg:col-span-2 flex flex-col gap-8">
                    {/* Profile Information */}
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                                    <User className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-2xl font-light text-gray-900">Personal Data</CardTitle>
                                    <CardDescription className="font-light">Your professional identity details</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-8">
                            <div className="flex flex-col sm:flex-row items-center gap-8">
                                <div className="relative group">
                                    <Avatar className="w-32 h-32 border-4 border-white shadow-2xl ring-1 ring-gray-100">
                                        <AvatarImage src={profile?.avatar_url || ''} className="object-cover" />
                                        <AvatarFallback className="bg-gradient-to-br from-primary/5 to-primary/20 text-4xl font-light text-primary">
                                            {profile?.name?.charAt(0).toUpperCase() || <User />}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>
                                <div className="space-y-1 text-center sm:text-left">
                                    <h3 className="text-2xl font-light text-gray-900">{profile?.name || 'No Name Set'}</h3>
                                    <p className="text-gray-500 font-light flex items-center justify-center sm:justify-start gap-2">
                                        <Mail className="w-4 h-4 text-gray-400" />
                                        {profile?.email}
                                    </p>
                                    <div className="pt-2 flex flex-wrap justify-center sm:justify-start gap-2">
                                        <Badge variant="outline" className="rounded-xl border-primary/20 text-primary font-light px-3 py-1">
                                            <ShieldCheck className="w-3 h-3 mr-1" />
                                            Verified Seller
                                        </Badge>
                                        <Badge variant="outline" className="rounded-xl border-gray-200 text-gray-500 font-light px-3 py-1">
                                            Active since {profile?.created_at ? new Date(profile.created_at).getFullYear() : 'N/A'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Bank & Identity Information */}
                    <Card className="flex-1 border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                                    <CreditCard className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-2xl font-light text-gray-900">Bank & Identity</CardTitle>
                                    <CardDescription className="font-light">
                                        {(!profile?.bank_rib || !profile?.cin_number)
                                            ? "Provide your details once to enable payments (cannot be edited later)."
                                            : "Secure payment and identification details"}
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <div className="flex items-start gap-4">
                                            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                                                <Building2 className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">Bank Name</p>
                                                {profile?.bank_name ? (
                                                    <p className="text-gray-900 font-light">{profile.bank_name}</p>
                                                ) : (
                                                    <Input
                                                        placeholder="Enter bank name"
                                                        value={bankInfo.bank_name}
                                                        onChange={(e) => setBankInfo({ ...bankInfo, bank_name: e.target.value })}
                                                        className="h-10 rounded-xl border-gray-100 bg-gray-50/30 focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-start gap-4">
                                            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                                                <User className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">Account Holder</p>
                                                {profile?.bank_account_holder ? (
                                                    <p className="text-gray-900 font-light">{profile.bank_account_holder}</p>
                                                ) : (
                                                    <Input
                                                        placeholder="Enter full name"
                                                        value={bankInfo.bank_account_holder}
                                                        onChange={(e) => setBankInfo({ ...bankInfo, bank_account_holder: e.target.value })}
                                                        className="h-10 rounded-xl border-gray-100 bg-gray-50/30 focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-start gap-4">
                                            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                                                <CreditCard className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">RIB (Bank Account Number)</p>
                                                {profile?.bank_rib ? (
                                                    <p className="text-gray-900 font-mono text-sm tracking-widest bg-gray-50 px-3 py-1 rounded-lg inline-block whitespace-nowrap">{profile.bank_rib}</p>
                                                ) : (
                                                    <Input
                                                        placeholder="24-digit RIB"
                                                        value={bankInfo.bank_rib}
                                                        onChange={(e) => setBankInfo({ ...bankInfo, bank_rib: e.target.value })}
                                                        className="h-10 rounded-xl border-gray-100 bg-gray-50/30 font-mono tracking-wider focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <div className="flex items-start gap-4">
                                            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                                                <Fingerprint className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">CIN (Identity Number)</p>
                                                {profile?.cin_number ? (
                                                    <p className="text-gray-900 font-light">{profile.cin_number}</p>
                                                ) : (
                                                    <Input
                                                        placeholder="Enter CIN"
                                                        value={bankInfo.cin_number}
                                                        onChange={(e) => setBankInfo({ ...bankInfo, cin_number: e.target.value })}
                                                        className="h-10 rounded-xl border-gray-100 bg-gray-50/30 focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-start gap-4">
                                            <div className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                                                <MapPin className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">Full Address</p>
                                                {profile?.address ? (
                                                    <p className="text-gray-900 font-light leading-relaxed max-w-sm">{profile.address}</p>
                                                ) : (
                                                    <Input
                                                        placeholder="Enter your complete address"
                                                        value={bankInfo.address}
                                                        onChange={(e) => setBankInfo({ ...bankInfo, address: e.target.value })}
                                                        className="h-10 rounded-xl border-gray-100 bg-gray-50/30 focus:ring-primary/20"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {!profile?.bank_rib && (
                                        <div className="pt-4">
                                            <Button
                                                onClick={handleUpdateBankInfo}
                                                disabled={saving || !bankInfo.bank_rib || !bankInfo.cin_number}
                                                className="w-full bg-gray-900 hover:bg-black text-white rounded-xl h-11 transition-all duration-300"
                                            >
                                                {saving ? (
                                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                                ) : (
                                                    <ShieldCheck className="w-4 h-4 mr-2" />
                                                )}
                                                Confirm & Lock Details
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Seller Statistics */}
                <div className="space-y-6">
                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-6 pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-xl font-light text-gray-900">Performance Pulse</CardTitle>
                                <Badge className={`border-0 text-[10px] h-5 px-2 font-medium bg-opacity-10
                                            ${stats.performanceStatus === 'Elite' ? 'bg-green-500 text-green-600' :
                                        stats.performanceStatus === 'Pro' ? 'bg-blue-500 text-blue-600' :
                                            stats.performanceStatus === 'Review' ? 'bg-red-500 text-red-600' :
                                                'bg-gray-500 text-gray-600'}`}
                                >
                                    {stats.performanceStatus}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                                        <Zap className="w-5 h-5 text-gray-400" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 font-light">Attributed</p>
                                        <p className="text-lg font-medium text-gray-900">{stats.total}</p>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 font-light">Total orders</p>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-primary/5 rounded-xl flex items-center justify-center">
                                        <Target className="w-5 h-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 font-light">Confirmation</p>
                                        <p className="text-lg font-medium text-gray-900">{stats.confirmationRate}%</p>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 font-light">{stats.confirmed} orders</p>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 font-light">Delivery</p>
                                        <p className="text-lg font-medium text-gray-900">{stats.deliveryRate}%</p>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 font-light">{stats.delivered} orders</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500">
                        <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-6">
                            <CardTitle className="text-xl font-light text-gray-900">Financial Earnings</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                                        <TrendingUp className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 font-light">Commission Rate</p>
                                        <p className="text-lg font-medium text-gray-900">{profile?.commission_price || 0} MAD</p>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 italic font-light">
                                    {normalizeCommissionBasis(profile?.commission_basis) === 'per_unit'
                                        ? 'per unit (assigned products) on delivered orders'
                                        : 'per delivered order'}
                                </p>
                            </div>

                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 text-white hover:shadow-2xl transition-all duration-500">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-white/80" />
                                </div>
                                <div>
                                    <p className="text-xs text-white/50 font-light uppercase tracking-widest">Account Details</p>
                                    <CardTitle className="text-sm font-light">Member Information</CardTitle>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-white/60 font-light">Join Date</span>
                                    <span className="font-light">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-white/60 font-light">Role</span>
                                    <Badge className="bg-white/10 hover:bg-white/20 text-white border-0 font-light">Seller Partner</Badge>
                                </div>

                            </div>


                        </CardContent>
                    </Card>
                </div>

                {/* Inventory Performance */}
                <Card className="lg:col-span-3 border-0 shadow-xl rounded-3xl overflow-hidden bg-white">
                    <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-8">
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                                        <Package className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-2xl font-light text-gray-900">Inventory Performance</CardTitle>
                                        <CardDescription className="font-light">
                                            {filteredProducts.length} of {productStats.length} attributed product{productStats.length === 1 ? '' : 's'}
                                        </CardDescription>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="relative group flex-1 md:w-72">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                        <Input
                                            placeholder="Search by name, code, label..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-11 h-11 rounded-2xl border-gray-100 bg-gray-50/50 focus:bg-white"
                                        />
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setSearchQuery('')}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as ProductSort)}>
                                        <SelectTrigger className="h-11 rounded-2xl border-gray-100 bg-gray-50/50 w-44 gap-2">
                                            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-2xl">
                                            <SelectItem value="attributed">Most attributed</SelectItem>
                                            <SelectItem value="delivered">Most delivered</SelectItem>
                                            <SelectItem value="performance">Best performance</SelectItem>
                                            <SelectItem value="name">Name (A–Z)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Performance bucket pills */}
                            <div className="flex items-center gap-2 flex-wrap">
                                {([
                                    { id: 'all', label: 'All', count: bucketCounts.all, color: 'text-gray-700', active: 'bg-gray-900 text-white' },
                                    { id: 'high', label: 'High ≥60%', count: bucketCounts.high, color: 'text-emerald-700', active: 'bg-emerald-600 text-white' },
                                    { id: 'mid', label: 'Mid 30-60%', count: bucketCounts.mid, color: 'text-amber-700', active: 'bg-amber-500 text-white' },
                                    { id: 'low', label: 'Low <30%', count: bucketCounts.low, color: 'text-red-700', active: 'bg-red-500 text-white' },
                                    { id: 'none', label: 'No data', count: bucketCounts.none, color: 'text-gray-500', active: 'bg-gray-500 text-white' },
                                ] as const).map((b) => {
                                    const isActive = performanceBucket === b.id;
                                    return (
                                        <button
                                            key={b.id}
                                            type="button"
                                            onClick={() => setPerformanceBucket(b.id)}
                                            className={`h-9 px-4 rounded-2xl text-xs font-semibold transition-all flex items-center gap-2 ${
                                                isActive
                                                    ? b.active + ' shadow-md'
                                                    : `bg-gray-100/70 hover:bg-gray-200/70 ${b.color}`
                                            }`}
                                        >
                                            {b.label}
                                            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
                                                isActive ? 'bg-white/20 text-white' : 'bg-white text-gray-500'
                                            }`}>
                                                {b.count}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8">
                        {filteredProducts.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                                {filteredProducts.map((p) => {
                                    const rate = Math.round(getDeliveryRate(p));
                                    const rateColor = p.total === 0
                                        ? 'bg-gray-300'
                                        : rate >= 60
                                            ? 'bg-emerald-500'
                                            : rate >= 30
                                                ? 'bg-amber-500'
                                                : 'bg-red-500';
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setSelectedProduct(p)}
                                            className="group relative text-left bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-primary/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                                        >
                                            <div className="aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url}
                                                        alt={p.name}
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Package className="w-12 h-12 text-gray-200" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-4 space-y-3">
                                                <div className="min-h-[44px]">
                                                    <h4 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2" title={p.name}>
                                                        {p.name}
                                                    </h4>
                                                </div>
                                                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                                                    <span>{p.code || '—'}</span>
                                                    <span className="text-gray-700 font-semibold normal-case tracking-normal">
                                                        {p.selling_price.toLocaleString()} dh
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-gray-50">
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Attr</p>
                                                        <p className="text-sm font-bold text-gray-900">{p.total}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-blue-500 uppercase font-bold">Conf</p>
                                                        <p className="text-sm font-bold text-gray-900">{p.confirmed}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-emerald-500 uppercase font-bold">Deliv</p>
                                                        <p className="text-sm font-bold text-gray-900">{p.delivered}</p>
                                                    </div>
                                                </div>

                                                <div>
                                                    <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                                                        <span>Delivery</span>
                                                        <span className="text-gray-700">{p.total === 0 ? '—' : `${rate}%`}</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${rateColor} transition-all duration-700 ease-out`}
                                                            style={{ width: `${p.total === 0 ? 100 : rate}%`, opacity: p.total === 0 ? 0.4 : 1 }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-16 flex flex-col items-center justify-center text-gray-400 font-light">
                                <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
                                    <Search className="w-7 h-7 text-gray-300" />
                                </div>
                                <p className="text-sm font-medium text-gray-500">No products match the current filters.</p>
                                <button
                                    type="button"
                                    onClick={() => { setSearchQuery(''); setPerformanceBucket('all'); }}
                                    className="mt-3 text-xs font-semibold text-primary hover:underline"
                                >
                                    Reset filters
                                </button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            {/* Product Detail Modal */}
            <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
                <DialogContent className="max-w-4xl p-0 border-none bg-white rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
                    {selectedProduct && (() => {
                        const p = selectedProduct;
                        const displayName = p.name || 'Unknown Product';
                        const confirmRate = p.total > 0 ? Math.round((p.confirmed / p.total) * 100) : 0;
                        const deliveryRate = p.total > 0 ? Math.round((p.delivered / p.total) * 100) : 0;
                        const stockTone = p.stock === 0 ? 'text-red-600' : p.stock < 10 ? 'text-amber-600' : 'text-emerald-600';
                        const stockLabel = p.stock === 0 ? 'Out of stock' : p.stock < 10 ? 'Low stock' : 'In stock';
                        const rateColor = (rate: number) =>
                            rate >= 60 ? { text: 'text-emerald-600', bar: 'bg-emerald-500' }
                                : rate >= 30 ? { text: 'text-amber-600', bar: 'bg-amber-500' }
                                : { text: 'text-red-600', bar: 'bg-red-500' };
                        const cr = rateColor(confirmRate);
                        const dr = rateColor(deliveryRate);

                        return (
                            <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-0">
                                {/* Left: hero image */}
                                <div className="md:col-span-2 relative bg-gradient-to-br from-gray-100 to-gray-50 min-h-[260px] md:min-h-full overflow-hidden">
                                    {p.image_url ? (
                                        <img src={p.image_url} alt={displayName} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Package className="w-20 h-20 text-gray-200" />
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />
                                    <div className="absolute bottom-5 left-5 right-5 flex flex-wrap gap-1.5">
                                        {p.code && (
                                            <Badge className="bg-white/15 backdrop-blur-md text-white border-white/10 text-[10px] font-bold">{p.code}</Badge>
                                        )}
                                        {p.label && (
                                            <Badge className="bg-white/15 backdrop-blur-md text-white border-white/10 text-[10px] font-bold">{p.label}</Badge>
                                        )}
                                        <Badge className={`bg-white/15 backdrop-blur-md border-white/10 text-[10px] font-bold ${stockTone}`}>
                                            {stockLabel}
                                        </Badge>
                                    </div>
                                </div>

                                {/* Right: details */}
                                <div className="md:col-span-3 flex flex-col min-h-0">
                                    <div className="px-7 pt-7 pb-4 border-b border-gray-50 shrink-0">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-primary mb-2">Product Details</p>
                                        <h2 className="text-2xl font-light text-gray-900 leading-tight" title={displayName}>
                                            {displayName}
                                        </h2>
                                    </div>

                                    <div className="px-7 py-5 space-y-6 overflow-y-auto flex-1">
                                        {p.description && (
                                            <p className="text-sm text-gray-500 font-light leading-relaxed line-clamp-4">{p.description}</p>
                                        )}

                                        {/* Price & stock */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-1">Sell Price</p>
                                                <p className="text-xl font-bold text-gray-900">{p.selling_price.toLocaleString()}<span className="text-xs font-normal text-gray-400 ml-1">DH</span></p>
                                            </div>
                                            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-1">Stock</p>
                                                <p className="text-xl font-bold text-gray-900">{p.stock.toLocaleString()}<span className="text-xs font-normal text-gray-400 ml-1">units</span></p>
                                            </div>
                                        </div>

                                        {/* Performance */}
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Performance</h4>
                                                <span className="text-[10px] font-semibold text-gray-400">
                                                    Stock: <span className="text-gray-700">{p.stock}</span>
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2.5">
                                                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 text-white">
                                                    <p className="text-[9px] uppercase tracking-widest font-bold opacity-60 mb-1">Attributed</p>
                                                    <p className="text-2xl font-bold leading-none">{p.total}</p>
                                                </div>
                                                <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-100">
                                                    <p className="text-[9px] text-blue-500 uppercase tracking-widest font-bold mb-1">Confirmed</p>
                                                    <p className="text-2xl font-bold text-blue-700 leading-none">{p.confirmed}</p>
                                                </div>
                                                <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-100">
                                                    <p className="text-[9px] text-emerald-500 uppercase tracking-widest font-bold mb-1">Delivered</p>
                                                    <p className="text-2xl font-bold text-emerald-700 leading-none">{p.delivered}</p>
                                                </div>
                                            </div>

                                            <div className="space-y-3 pt-1">
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs font-semibold text-gray-500">Confirmation Rate</span>
                                                        <span className={`text-xs font-bold ${cr.text}`}>{p.total === 0 ? '—' : `${confirmRate}%`}</span>
                                                    </div>
                                                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-700 ease-out ${cr.bar}`}
                                                            style={{ width: `${p.total === 0 ? 0 : confirmRate}%` }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs font-semibold text-gray-500">Delivery Rate</span>
                                                        <span className={`text-xs font-bold ${dr.text}`}>{p.total === 0 ? '—' : `${deliveryRate}%`}</span>
                                                    </div>
                                                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-700 ease-out ${dr.bar}`}
                                                            style={{ width: `${p.total === 0 ? 0 : deliveryRate}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Funnel summary */}
                                            <div className="mt-3 p-4 rounded-2xl bg-gray-50/70 border border-gray-100">
                                                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400 mb-3">Funnel</p>
                                                <div className="flex items-center gap-2 text-xs">
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1.5 bg-gray-300 rounded-full mb-1.5" />
                                                        <p className="font-bold text-gray-900">{p.total}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Attr</p>
                                                    </div>
                                                    <ChevronRight className="w-3 h-3 text-gray-300" />
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1.5 bg-blue-400 rounded-full mb-1.5" style={{ width: `${p.total === 0 ? 100 : (p.confirmed / p.total) * 100}%`, marginLeft: 'auto', marginRight: 'auto' }} />
                                                        <p className="font-bold text-blue-700">{p.confirmed}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Conf</p>
                                                    </div>
                                                    <ChevronRight className="w-3 h-3 text-gray-300" />
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1.5 bg-emerald-500 rounded-full mb-1.5" style={{ width: `${p.total === 0 ? 100 : (p.delivered / p.total) * 100}%`, marginLeft: 'auto', marginRight: 'auto' }} />
                                                        <p className="font-bold text-emerald-700">{p.delivered}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Deliv</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerProfile;

