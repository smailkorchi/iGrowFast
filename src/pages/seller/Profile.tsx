import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    User, Mail, ShieldCheck, DollarSign, TrendingUp,
    Calendar, LogOut, Loader2, CreditCard, Building2,
    Fingerprint, MapPin, Zap, CheckCircle2, Target,
    Search, ChevronLeft, ChevronRight, Package, X
} from 'lucide-react';
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
    name: { [key: string]: string };
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
    const carouselRef = React.useRef<HTMLDivElement>(null);

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
                    .select('order_status_id, package_status_id, package_status_label, order_statuses(code)')
                    .eq('seller_id', session.user.id);

                const orders = (ordersData || []).map(o => ({
                    order_status_id: (o as any).order_status_id,
                    package_status_id: (o as any).package_status_id,
                    status: (o.order_statuses as any)?.code?.toLowerCase() || 'unknown',
                    packageStatus: ((o as any).package_status_label || '').toLowerCase()
                }));

                if (!ordersError && orders) {
                    const total = orders.length;
                    const confirmed = orders.filter(o => statusCats.confirmedIds.has(o.order_status_id)).length;
                    const delivered = orders.filter(o => o.package_status_id && statusCats.deliveredPkgIds.has(o.package_status_id)).length;

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
                        .select('order_id, product_id, orders!inner(seller_id, order_status_id, package_status_id, package_status_label, order_statuses(code))')
                        .eq('orders.seller_id', session.user.id);

                    const orderItems = (orderItemsData || []).map(oi => ({
                        ...oi,
                        orders: {
                            order_status_id: (oi.orders as any)?.order_status_id,
                            package_status_id: (oi.orders as any)?.package_status_id,
                            status: (oi.orders as any)?.order_statuses?.code?.toLowerCase() || 'unknown',
                            packageStatus: ((oi.orders as any)?.package_status_label || '').toLowerCase()
                        }
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

                            return {
                                id: p.id,
                                name: p.name,
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
                                    return oo?.package_status_id && statusCats.deliveredPkgIds.has(oo.package_status_id);
                                }).length
                            };
                        });
                        setProductStats(calculatedProductStats);
                    }
                }
            }
        } catch (error: any) {
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
        } catch (error: any) {
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

    const scrollCarousel = (direction: 'left' | 'right') => {
        if (carouselRef.current) {
            const scrollAmount = 300;
            carouselRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    const filteredProducts = productStats.filter(p =>
        JSON.stringify(p.name).toLowerCase().includes(searchQuery.toLowerCase())
    );


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
                                <p className="text-xs text-gray-400 italic font-light">per order delivered</p>
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

                {/* Product Performance Carousel */}
                <Card className="lg:col-span-3 border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500">
                    <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-8">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                                    <Package className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-2xl font-light text-gray-900">Inventory Performance</CardTitle>
                                    <CardDescription className="font-light">Real-time metrics for each attributed product</CardDescription>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="relative group flex-1 md:w-64">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                    <Input
                                        placeholder="Search products..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-11 h-11 rounded-2xl border-gray-100 bg-gray-50/50 focus:bg-white transition-all duration-300"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => scrollCarousel('left')}
                                        className="rounded-xl border-gray-100 hover:bg-white hover:border-primary/20 hover:text-primary shadow-sm"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => scrollCarousel('right')}
                                        className="rounded-xl border-gray-100 hover:bg-white hover:border-primary/20 hover:text-primary shadow-sm"
                                    >
                                        <ChevronRight className="w-5 h-5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8">
                        <div
                            ref={carouselRef}
                            className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide snap-x"
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                        >
                            {filteredProducts.length > 0 ? (
                                filteredProducts.map((p) => (
                                    <div
                                        key={p.id}
                                        className="min-w-[320px] max-w-[320px] snap-start group cursor-pointer"
                                        onClick={() => setSelectedProduct(p)}
                                    >
                                        <div className="bg-gray-50/50 rounded-3xl p-6 border border-transparent group-hover:border-primary/10 group-hover:bg-white group-hover:shadow-xl transition-all duration-500">
                                            <div className="flex gap-4 mb-6">
                                                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-white border border-gray-100 shrink-0">
                                                    {p.image_url ? (
                                                        <img src={p.image_url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                                            <Package className="w-8 h-8 text-gray-200" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-medium text-gray-900 truncate mb-1">{p.name?.en || Object.values(p.name || {})[0] || 'Unknown Product'}</h4>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="secondary" className="bg-white border-gray-100 text-[10px] font-normal px-2 py-0 h-5">
                                                            ID: {p.id.substring(0, 8)}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="p-3 bg-white rounded-xl border border-gray-50 text-center">
                                                    <p className="text-[10px] text-gray-400 uppercase tracking-tighter font-medium mb-1">Attr.</p>
                                                    <p className="text-lg font-medium text-gray-900">{p.total}</p>
                                                </div>
                                                <div className="p-3 bg-white rounded-xl border border-gray-50 text-center">
                                                    <p className="text-[10px] text-primary uppercase tracking-tighter font-medium mb-1">Conf.</p>
                                                    <p className="text-lg font-medium text-gray-900">{p.confirmed}</p>
                                                </div>
                                                <div className="p-3 bg-white rounded-xl border border-gray-50 text-center">
                                                    <p className="text-[10px] text-green-600 uppercase tracking-tighter font-medium mb-1">Deliv.</p>
                                                    <p className="text-lg font-medium text-gray-900">{p.delivered}</p>
                                                </div>
                                            </div>

                                            <div className="mt-6 space-y-2">
                                                <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-gray-400">
                                                    <span>Performance</span>
                                                    <span>{p.total > 0 ? Math.round((p.delivered / p.total) * 100) : 0}%</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary transition-all duration-1000 ease-out"
                                                        style={{ width: `${p.total > 0 ? (p.delivered / p.total) * 100 : 0}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 font-light">
                                    <Search className="w-12 h-12 mb-4 opacity-10" />
                                    <p>No products found matching your search.</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
            {/* Product Detail Modal */}
            <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
                <DialogContent className="max-w-lg p-0 border-none bg-white rounded-[32px] shadow-2xl overflow-hidden">
                    {selectedProduct && (() => {
                        const p = selectedProduct;
                        const displayName = p.name?.en || Object.values(p.name || {})[0] || 'Unknown Product';
                        const confirmRate = p.total > 0 ? Math.round((p.confirmed / p.total) * 100) : 0;
                        const deliveryRate = p.total > 0 ? Math.round((p.delivered / p.total) * 100) : 0;
                        return (
                            <>
                                {/* Hero Image */}
                                <div className="relative w-full h-56 bg-gradient-to-br from-gray-100 to-gray-50 overflow-hidden">
                                    {p.image_url ? (
                                        <img src={p.image_url} alt={displayName} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Package className="w-16 h-16 text-gray-200" />
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                                    <div className="absolute bottom-4 left-6 right-6">
                                        <h2 className="text-2xl font-bold text-white drop-shadow-lg leading-tight">{displayName}</h2>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge className="bg-white/20 backdrop-blur-md text-white border-none text-[10px] font-bold">{p.code}</Badge>
                                            {p.label && <Badge className="bg-white/20 backdrop-blur-md text-white border-none text-[10px] font-bold">{p.label}</Badge>}
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="p-6 space-y-6">
                                    {/* Description */}
                                    {p.description && (
                                        <p className="text-sm text-gray-500 font-light leading-relaxed">{p.description}</p>
                                    )}

                                    {/* Price & Stock */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-4 rounded-2xl bg-gray-50 text-center">
                                            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">Selling</p>
                                            <p className="text-lg font-bold text-gray-900">{p.selling_price}<span className="text-xs font-normal text-gray-400 ml-0.5">DH</span></p>
                                        </div>
                                        <div className="p-4 rounded-2xl bg-gray-50 text-center">
                                            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium mb-1">Stock</p>
                                            <p className="text-lg font-bold text-gray-900">{p.stock}</p>
                                        </div>
                                    </div>

                                    {/* Performance Stats */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">Performance</h4>

                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="p-4 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 text-center text-white">
                                                <p className="text-[10px] uppercase tracking-widest font-medium opacity-60 mb-1">Attributed</p>
                                                <p className="text-2xl font-bold">{p.total}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 text-center">
                                                <p className="text-[10px] text-blue-500 uppercase tracking-widest font-medium mb-1">Confirmed</p>
                                                <p className="text-2xl font-bold text-blue-700">{p.confirmed}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center">
                                                <p className="text-[10px] text-emerald-500 uppercase tracking-widest font-medium mb-1">Delivered</p>
                                                <p className="text-2xl font-bold text-emerald-700">{p.delivered}</p>
                                            </div>
                                        </div>

                                        {/* Confirmation Rate */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-medium text-gray-500">Confirmation Rate</span>
                                                <span className={`text-sm font-bold ${confirmRate >= 60 ? 'text-emerald-600' : confirmRate >= 30 ? 'text-amber-600' : 'text-red-600'}`}>{confirmRate}%</span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-700 ease-out ${confirmRate >= 60 ? 'bg-emerald-500' : confirmRate >= 30 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                    style={{ width: `${confirmRate}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Delivery Rate */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-medium text-gray-500">Delivery Rate</span>
                                                <span className={`text-sm font-bold ${deliveryRate >= 60 ? 'text-emerald-600' : deliveryRate >= 30 ? 'text-amber-600' : 'text-red-600'}`}>{deliveryRate}%</span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-700 ease-out ${deliveryRate >= 60 ? 'bg-emerald-500' : deliveryRate >= 30 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                    style={{ width: `${deliveryRate}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerProfile;

