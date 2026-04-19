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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
                    .eq('seller_id', session.user.id)
                    .is('date_deleted', null);

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

    const statusAccent =
        stats.performanceStatus === 'Elite' ? '#059669'
            : stats.performanceStatus === 'Pro' ? '#3b5e5e'
                : stats.performanceStatus === 'Review' ? '#ef4444'
                    : '#9ca3af';

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">My Profile</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Professional identity & performance</p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleLogout}
                        className="h-8 rounded-md text-[11px] font-semibold text-red-600 border-red-100 hover:bg-red-50 hover:border-red-200"
                    >
                        <LogOut className="w-3.5 h-3.5 mr-1.5" />
                        Log Out
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2 flex flex-col gap-3">
                    {/* Profile Information */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <p className="text-[11px] font-semibold text-brand-navy mb-3">Personal Data</p>
                        <div className="flex flex-col sm:flex-row items-start gap-4">
                            <Avatar className="h-14 w-14 shrink-0">
                                <AvatarImage src={profile?.avatar_url || ''} className="object-cover" />
                                <AvatarFallback className="bg-gray-100 text-[15px] font-semibold text-brand-navy">
                                    {profile?.name?.charAt(0).toUpperCase() || <User className="w-5 h-5 text-gray-400" />}
                                </AvatarFallback>
                            </Avatar>
                            <div className="space-y-1">
                                <p className="text-[13px] font-semibold text-brand-navy">{profile?.name || 'No Name Set'}</p>
                                <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                                    <Mail className="w-3 h-3" />
                                    {profile?.email}
                                </p>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    <Badge variant="outline" className="rounded-md border-gray-200 text-gray-500 text-[10px] px-2 h-5 font-medium gap-1">
                                        <ShieldCheck className="w-2.5 h-2.5" />
                                        Verified Seller
                                    </Badge>
                                    <Badge variant="outline" className="rounded-md border-gray-200 text-gray-400 text-[10px] px-2 h-5 font-medium">
                                        Since {profile?.created_at ? new Date(profile.created_at).getFullYear() : 'N/A'}
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bank & Identity Information */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5 flex-1">
                        <p className="text-[11px] font-semibold text-brand-navy mb-0.5">Bank & Identity</p>
                        <p className="text-[9px] text-gray-400 mb-3">
                            {(!profile?.bank_rib || !profile?.cin_number)
                                ? "Provide your details once to enable payments (cannot be edited later)."
                                : "Secure payment and identification details"}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-3">
                                {/* Bank Name */}
                                <div>
                                    <label className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <Building2 className="w-3 h-3 text-gray-400" />
                                        Bank Name
                                    </label>
                                    {profile?.bank_name ? (
                                        <p className="text-[12px] text-brand-navy font-medium">{profile.bank_name}</p>
                                    ) : (
                                        <Input
                                            placeholder="Enter bank name"
                                            value={bankInfo.bank_name}
                                            onChange={(e) => setBankInfo({ ...bankInfo, bank_name: e.target.value })}
                                            className="h-9 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                        />
                                    )}
                                </div>
                                {/* Account Holder */}
                                <div>
                                    <label className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <User className="w-3 h-3 text-gray-400" />
                                        Account Holder
                                    </label>
                                    {profile?.bank_account_holder ? (
                                        <p className="text-[12px] text-brand-navy font-medium">{profile.bank_account_holder}</p>
                                    ) : (
                                        <Input
                                            placeholder="Enter full name"
                                            value={bankInfo.bank_account_holder}
                                            onChange={(e) => setBankInfo({ ...bankInfo, bank_account_holder: e.target.value })}
                                            className="h-9 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                        />
                                    )}
                                </div>
                                {/* RIB */}
                                <div>
                                    <label className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <CreditCard className="w-3 h-3 text-gray-400" />
                                        RIB (Bank Account Number)
                                    </label>
                                    {profile?.bank_rib ? (
                                        <p className="text-[12px] text-brand-navy font-mono tracking-wider bg-gray-50 px-2.5 py-1 rounded-md inline-block">{profile.bank_rib}</p>
                                    ) : (
                                        <Input
                                            placeholder="24-digit RIB"
                                            value={bankInfo.bank_rib}
                                            onChange={(e) => setBankInfo({ ...bankInfo, bank_rib: e.target.value })}
                                            className="h-9 text-[12px] rounded-md border-gray-100 bg-gray-50/50 font-mono tracking-wider"
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {/* CIN */}
                                <div>
                                    <label className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <Fingerprint className="w-3 h-3 text-gray-400" />
                                        CIN (Identity Number)
                                    </label>
                                    {profile?.cin_number ? (
                                        <p className="text-[12px] text-brand-navy font-medium">{profile.cin_number}</p>
                                    ) : (
                                        <Input
                                            placeholder="Enter CIN"
                                            value={bankInfo.cin_number}
                                            onChange={(e) => setBankInfo({ ...bankInfo, cin_number: e.target.value })}
                                            className="h-9 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                        />
                                    )}
                                </div>
                                {/* Address */}
                                <div>
                                    <label className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <MapPin className="w-3 h-3 text-gray-400" />
                                        Full Address
                                    </label>
                                    {profile?.address ? (
                                        <p className="text-[12px] text-brand-navy font-medium leading-relaxed">{profile.address}</p>
                                    ) : (
                                        <Input
                                            placeholder="Enter your complete address"
                                            value={bankInfo.address}
                                            onChange={(e) => setBankInfo({ ...bankInfo, address: e.target.value })}
                                            className="h-9 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                        />
                                    )}
                                </div>

                                {!profile?.bank_rib && (
                                    <div className="pt-1">
                                        <Button
                                            onClick={handleUpdateBankInfo}
                                            disabled={saving || !bankInfo.bank_rib || !bankInfo.cin_number}
                                            className="h-8 rounded-md text-[11px] font-semibold"
                                        >
                                            {saving ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                                            ) : (
                                                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                                            )}
                                            Confirm & Lock Details
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar: Performance + Financial + Account */}
                <div className="space-y-3">
                    {/* Performance Pulse */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold text-brand-navy">Performance Pulse</p>
                            <span
                                className="text-[9px] font-bold px-2 h-4 rounded flex items-center"
                                style={{ background: `${statusAccent}18`, color: statusAccent }}
                            >
                                {stats.performanceStatus}
                            </span>
                        </div>
                        <div className="space-y-2.5">
                            {[
                                { label: 'Attributed', value: stats.total, sub: 'Total orders', icon: Zap, accent: '#9ca3af' },
                                { label: 'Confirmation', value: `${stats.confirmationRate}%`, sub: `${stats.confirmed} orders`, icon: Target, accent: '#3b5e5e' },
                                { label: 'Delivery', value: `${stats.deliveryRate}%`, sub: `${stats.delivered} orders`, icon: CheckCircle2, accent: '#059669' },
                            ].map((row) => (
                                <div key={row.label} className="flex items-center gap-2.5">
                                    <span className="w-[3px] h-8 rounded-full shrink-0" style={{ background: row.accent }} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{row.label}</p>
                                        <p className="text-[13px] font-semibold text-brand-navy tabular-nums leading-tight">{row.value}</p>
                                    </div>
                                    <p className="text-[9px] text-gray-400 shrink-0">{row.sub}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Financial Earnings */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <p className="text-[11px] font-semibold text-brand-navy mb-3">Financial Earnings</p>
                        <div className="flex items-center gap-2.5">
                            <span className="w-[3px] h-8 rounded-full shrink-0 bg-[#059669]" />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Commission Rate</p>
                                <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{profile?.commission_price || 0} MAD</p>
                            </div>
                        </div>
                        <p className="text-[9px] text-gray-400 mt-2 pl-3.5">
                            {normalizeCommissionBasis(profile?.commission_basis) === 'per_unit'
                                ? 'Per unit (assigned products) on delivered orders'
                                : 'Per delivered order'}
                        </p>
                    </div>

                    {/* Account Details */}
                    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                        <p className="text-[11px] font-semibold text-brand-navy mb-3">Account Details</p>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] text-gray-500">Join Date</span>
                                <span className="text-[11px] font-medium text-brand-navy">
                                    {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[11px] text-gray-500">Role</span>
                                <Badge variant="outline" className="rounded-md border-gray-200 text-gray-500 text-[10px] px-2 h-5 font-medium">Seller Partner</Badge>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Inventory Performance — full width */}
                <div className="lg:col-span-3 rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="p-3.5 border-b border-gray-50">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold text-brand-navy">Inventory Performance</p>
                                <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-0.5">
                                    {filteredProducts.length} of {productStats.length} attributed product{productStats.length === 1 ? '' : 's'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1 md:w-56">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                    <Input
                                        placeholder="Search by name, code..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-8 h-8 text-[12px] rounded-md border-gray-100 bg-gray-50/50"
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:bg-gray-100"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                                <Select value={sortBy} onValueChange={(v) => setSortBy(v as ProductSort)}>
                                    <SelectTrigger className="h-8 rounded-md border-gray-100 bg-gray-50/50 w-40 text-[12px] gap-1.5">
                                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="attributed">Most attributed</SelectItem>
                                        <SelectItem value="delivered">Most delivered</SelectItem>
                                        <SelectItem value="performance">Best performance</SelectItem>
                                        <SelectItem value="name">Name (A–Z)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Performance bucket pills */}
                        <div className="flex items-center gap-1.5 flex-wrap mt-3">
                            {([
                                { id: 'all', label: 'All', count: bucketCounts.all },
                                { id: 'high', label: 'High ≥60%', count: bucketCounts.high },
                                { id: 'mid', label: 'Mid 30-60%', count: bucketCounts.mid },
                                { id: 'low', label: 'Low <30%', count: bucketCounts.low },
                                { id: 'none', label: 'No data', count: bucketCounts.none },
                            ] as const).map((b) => {
                                const isActive = performanceBucket === b.id;
                                return (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => setPerformanceBucket(b.id)}
                                        className={`h-6 px-2.5 rounded-md text-[10px] font-semibold transition-colors flex items-center gap-1.5 ${
                                            isActive
                                                ? 'bg-brand-navy text-white'
                                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                        }`}
                                    >
                                        {b.label}
                                        <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-bold ${
                                            isActive ? 'bg-white/20 text-white' : 'bg-white text-gray-500'
                                        }`}>
                                            {b.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-3.5">
                        {filteredProducts.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {filteredProducts.map((p) => {
                                    const rate = Math.round(getDeliveryRate(p));
                                    const rateColor = p.total === 0
                                        ? '#9ca3af'
                                        : rate >= 60
                                            ? '#059669'
                                            : rate >= 30
                                                ? '#d97706'
                                                : '#ef4444';
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setSelectedProduct(p)}
                                            className="group text-left bg-white border border-gray-100 rounded-xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all duration-200"
                                        >
                                            <div className="aspect-[4/3] bg-gray-50 overflow-hidden">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url}
                                                        alt={p.name}
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Package className="w-8 h-8 text-gray-200" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-3 space-y-2">
                                                <div>
                                                    <p className="text-[11px] font-semibold text-brand-navy leading-snug line-clamp-2" title={p.name}>
                                                        {p.name}
                                                    </p>
                                                    <div className="flex items-center justify-between mt-0.5">
                                                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">{p.code || '—'}</span>
                                                        <span className="text-[10px] font-semibold text-brand-navy tabular-nums">{p.selling_price.toLocaleString()} dh</span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-gray-50">
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Attr</p>
                                                        <p className="text-[12px] font-bold text-brand-navy">{p.total}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-[#3b5e5e] uppercase font-bold">Conf</p>
                                                        <p className="text-[12px] font-bold text-brand-navy">{p.confirmed}</p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-[9px] text-[#059669] uppercase font-bold">Deliv</p>
                                                        <p className="text-[12px] font-bold text-brand-navy">{p.delivered}</p>
                                                    </div>
                                                </div>

                                                <div>
                                                    <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                                                        <span>Delivery</span>
                                                        <span style={{ color: rateColor }}>{p.total === 0 ? '—' : `${rate}%`}</span>
                                                    </div>
                                                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full transition-all duration-500 ease-out"
                                                            style={{
                                                                width: `${p.total === 0 ? 100 : rate}%`,
                                                                background: rateColor,
                                                                opacity: p.total === 0 ? 0.3 : 1
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-12 flex flex-col items-center justify-center text-gray-400">
                                <Search className="w-7 h-7 text-gray-200 mb-2" />
                                <p className="text-[11px] font-medium text-gray-500">No products match the current filters.</p>
                                <button
                                    type="button"
                                    onClick={() => { setSearchQuery(''); setPerformanceBucket('all'); }}
                                    className="mt-2 text-[10px] font-semibold text-brand-navy hover:underline"
                                >
                                    Reset filters
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Product Detail Modal */}
            <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
                <DialogContent className="max-w-3xl p-0 border border-gray-100 bg-white rounded-xl shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
                    {selectedProduct && (() => {
                        const p = selectedProduct;
                        const displayName = p.name || 'Unknown Product';
                        const confirmRate = p.total > 0 ? Math.round((p.confirmed / p.total) * 100) : 0;
                        const deliveryRate = p.total > 0 ? Math.round((p.delivered / p.total) * 100) : 0;
                        const stockTone = p.stock === 0 ? 'text-red-600' : p.stock < 10 ? 'text-amber-600' : 'text-emerald-600';
                        const stockLabel = p.stock === 0 ? 'Out of stock' : p.stock < 10 ? 'Low stock' : 'In stock';
                        const rateColor = (rate: number) =>
                            rate >= 60 ? { text: 'text-[#059669]', bar: '#059669' }
                                : rate >= 30 ? { text: 'text-[#d97706]', bar: '#d97706' }
                                : { text: 'text-[#ef4444]', bar: '#ef4444' };
                        const cr = rateColor(confirmRate);
                        const dr = rateColor(deliveryRate);

                        return (
                            <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-0">
                                {/* Left: image */}
                                <div className="md:col-span-2 relative bg-gray-50 min-h-[220px] md:min-h-full overflow-hidden">
                                    {p.image_url ? (
                                        <img src={p.image_url} alt={displayName} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Package className="w-14 h-14 text-gray-200" />
                                        </div>
                                    )}
                                    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1">
                                        {p.code && (
                                            <Badge className="bg-white/80 backdrop-blur text-gray-700 border-0 text-[9px] font-bold">{p.code}</Badge>
                                        )}
                                        {p.label && (
                                            <Badge className="bg-white/80 backdrop-blur text-gray-700 border-0 text-[9px] font-bold">{p.label}</Badge>
                                        )}
                                        <Badge className={`bg-white/80 backdrop-blur border-0 text-[9px] font-bold ${stockTone}`}>
                                            {stockLabel}
                                        </Badge>
                                    </div>
                                </div>

                                {/* Right: details */}
                                <div className="md:col-span-3 flex flex-col min-h-0">
                                    <div className="px-4 pt-4 pb-3 border-b border-gray-50 shrink-0">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-1">Product Details</p>
                                        <h2 className="text-[15px] font-semibold text-brand-navy leading-tight" title={displayName}>
                                            {displayName}
                                        </h2>
                                    </div>

                                    <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1">
                                        {p.description && (
                                            <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-3">{p.description}</p>
                                        )}

                                        {/* Price & stock */}
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mb-0.5">Sell Price</p>
                                                <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{p.selling_price.toLocaleString()}<span className="text-[10px] text-gray-400 ml-0.5">DH</span></p>
                                            </div>
                                            <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] text-gray-400 uppercase tracking-wider font-bold mb-0.5">Stock</p>
                                                <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{p.stock.toLocaleString()}<span className="text-[10px] text-gray-400 ml-0.5">units</span></p>
                                            </div>
                                        </div>

                                        {/* Performance */}
                                        <div className="space-y-3">
                                            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Performance</p>

                                            <div className="grid grid-cols-3 gap-2">
                                                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-center">
                                                    <p className="text-[9px] uppercase font-bold text-gray-400 mb-0.5">Attributed</p>
                                                    <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{p.total}</p>
                                                </div>
                                                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-center">
                                                    <p className="text-[9px] uppercase font-bold text-[#3b5e5e] mb-0.5">Confirmed</p>
                                                    <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{p.confirmed}</p>
                                                </div>
                                                <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-center">
                                                    <p className="text-[9px] uppercase font-bold text-[#059669] mb-0.5">Delivered</p>
                                                    <p className="text-[15px] font-semibold text-[#059669] tabular-nums">{p.delivered}</p>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="space-y-1">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] font-semibold text-gray-500">Confirmation Rate</span>
                                                        <span className={`text-[10px] font-bold tabular-nums ${cr.text}`}>{p.total === 0 ? '—' : `${confirmRate}%`}</span>
                                                    </div>
                                                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full transition-all duration-500"
                                                            style={{ width: `${p.total === 0 ? 0 : confirmRate}%`, background: cr.bar }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] font-semibold text-gray-500">Delivery Rate</span>
                                                        <span className={`text-[10px] font-bold tabular-nums ${dr.text}`}>{p.total === 0 ? '—' : `${deliveryRate}%`}</span>
                                                    </div>
                                                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full transition-all duration-500"
                                                            style={{ width: `${p.total === 0 ? 0 : deliveryRate}%`, background: dr.bar }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Funnel summary */}
                                            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">Funnel</p>
                                                <div className="flex items-center gap-2 text-[11px]">
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1 bg-gray-300 rounded-full mb-1" />
                                                        <p className="font-bold text-brand-navy">{p.total}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Attr</p>
                                                    </div>
                                                    <ChevronRight className="w-3 h-3 text-gray-300" />
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1 bg-[#3b5e5e] rounded-full mb-1" style={{ width: `${p.total === 0 ? 100 : (p.confirmed / p.total) * 100}%`, marginLeft: 'auto', marginRight: 'auto' }} />
                                                        <p className="font-bold text-[#3b5e5e]">{p.confirmed}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Conf</p>
                                                    </div>
                                                    <ChevronRight className="w-3 h-3 text-gray-300" />
                                                    <div className="flex-1 text-center">
                                                        <div className="h-1 bg-[#059669] rounded-full mb-1" style={{ width: `${p.total === 0 ? 100 : (p.delivered / p.total) * 100}%`, marginLeft: 'auto', marginRight: 'auto' }} />
                                                        <p className="font-bold text-[#059669]">{p.delivered}</p>
                                                        <p className="text-[9px] text-gray-400 uppercase font-bold">Deliv</p>
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
