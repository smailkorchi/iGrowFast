import React, { useState, useEffect, useCallback } from 'react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { normalizeCommissionBasis, isDeliveredForCommission } from '@/lib/commercialCommission';
import { isAdminPullback } from '@/lib/analyticsDefinitions';
import {
    User, Mail, ShieldCheck, LogOut, Loader2, CreditCard, Building2,
    Fingerprint, MapPin, Zap, CheckCircle2, Target, Award,
    Search, ChevronRight, Package, X, ArrowUpDown,
} from 'lucide-react';
import { AvatarEditDialog } from '@/components/profile/AvatarEditDialog';
import { SecuritySection } from '@/components/profile/SecuritySection';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { UserAvatar } from '@/components/users/UserAvatar';
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
    rateConfirmed: number;
    rateTouched: number;
    delivered: number;
    tracked: number;
    pullback: number;
}

type ProductSort = 'attributed' | 'delivered' | 'performance' | 'name';
type PerformanceBucket = 'all' | 'high' | 'mid' | 'low' | 'none';

const getDeliveryRate = (p: ProductStat) => {
    const denom = p.tracked - p.pullback;
    return denom > 0 ? (p.delivered / denom) * 100 : 0;
};
const getConfirmRate = (p: ProductStat) => (p.rateTouched > 0 ? (p.rateConfirmed / p.rateTouched) * 100 : 0);

const SellerProfile = () => {
    const { toast } = useToast();
    const statusCats = useStatusCategories();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<SellerProfileData | null>(null);
    const [avatarOpen, setAvatarOpen] = useState(false);

    const [bankInfo, setBankInfo] = useState({
        bank_name: '',
        bank_account_holder: '',
        bank_rib: '',
        cin_number: '',
        address: ''
    });

    const [stats, setStats] = useState<{
        total: number;
        confirmed: number;
        delivered: number;
        confirmationRate: number;
        deliveryRate: number;
        performanceStatus: string;
    }>({
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
                const sellerBusinessId = (seller as { 'DigiCom Business'?: string | null } | null)?.['DigiCom Business'] ?? null;
                // Paginated so a seller exceeding 1000 orders is never truncated.
                let ordersData: any[] = [];
                try {
                    ordersData = await fetchAllRows<any>(
                        'orders',
                        'id, order_status_id, package_status_id, package_status_label, tracking_number, order_statuses(code), package_statuses(label)',
                        {
                            filters: [
                                { column: 'seller_id', op: 'eq', value: session.user.id },
                                { column: 'date_deleted', op: 'is', value: null },
                            ],
                        },
                    );
                } catch {
                    ordersData = [];
                }

                // Fetch parcel tracking up front — `orders.tracking_number`
                // is never populated; the authoritative source for "has
                // tracking" is company_parcels / courier_parcels. Hoisted so
                // the per-product stats block below can reuse it.
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

                if (ordersData) {
                    const ordersList = ordersData;
                    const total = ordersList.length;
                    const delivered = ordersList.filter(o => isDeliveredForCommission(o, statusCats.deliveredPkgIds)).length;

                    // Confirmation rate: numerator = orders NOT in pending
                    // (new + postponed) OR with tracking. Denominator = total.
                    const statusMapsReady = statusCats.pendingIds.size > 0;
                    const rateConfirmedCount = ordersList.filter((o: any) => {
                        const hasTracking = !!o.id && trackedSet.has(o.id);
                        if (hasTracking) return true;
                        return statusMapsReady
                            && !!o.order_status_id
                            && !statusCats.pendingIds.has(o.order_status_id);
                    }).length;

                    const cRate = ordersList.length > 0 ? (rateConfirmedCount / ordersList.length) * 100 : 0;

                    // Delivery rate (Coliaty formula): delivered ÷ (tracked − admin-pullback).
                    const trackedCount = ordersList.filter((o: any) => !!o.id && trackedSet.has(o.id)).length;
                    const pullbackCount = ordersList.filter((o: any) =>
                        !!o.id && trackedSet.has(o.id)
                        && isAdminPullback(o, true, statusCats.adminPullbackOrderIds, statusCats.adminPullbackPackageIds),
                    ).length;
                    const deliveryDenom = trackedCount - pullbackCount;
                    const dRate = deliveryDenom > 0 ? (delivered / deliveryDenom) * 100 : 0;
                    const confirmed = rateConfirmedCount;

                    let status = 'Standard';
                    if (dRate >= 90 && cRate >= 80) status = 'Elite';
                    else if (dRate >= 75) status = 'Pro';
                    else if (total > 0 && dRate < 40) status = 'Review';

                    setStats({
                        total,
                        // Confirmed count = one-true-definition (yes was spoken).
                        confirmed: rateConfirmedCount,
                        delivered,
                        confirmationRate: cRate,
                        deliveryRate: dRate,
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

                    const orderItemsData = await fetchAllRows('order_items', 'order_id, product_id, orders!inner(id, seller_id, order_status_id, package_status_id, package_status_label, tracking_number, order_statuses(code), package_statuses(label))', {
                        filters: [{ column: 'orders.seller_id', op: 'eq', value: session.user.id }],
                    });

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

                            // Coliaty delivery-rate inputs per product.
                            // Tracked = parcel exists with tracking_code.
                            // Pullback = tracked AND flagged fake/double/blacklisted/cancelled
                            // at order level OR Hors-zone/Annulé at package level.
                            const trackedForProduct = uniqueOrders.filter(o => {
                                const oo = Array.isArray(o) ? o[0] : o;
                                return !!oo?.id && trackedSet.has(oo.id);
                            });
                            const pullbackForProduct = trackedForProduct.filter(o => {
                                const oo = Array.isArray(o) ? o[0] : o;
                                return isAdminPullback(
                                    oo,
                                    true,
                                    statusCats.adminPullbackOrderIds,
                                    statusCats.adminPullbackPackageIds,
                                );
                            });

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
                                tracked: trackedForProduct.length,
                                pullback: pullbackForProduct.length,
                                confirmed: uniqueOrders.filter(o => {
                                    const oo = Array.isArray(o) ? o[0] : o;
                                    return oo?.order_status_id && statusCats.confirmedIds.has(oo.order_status_id);
                                }).length,
                                // Rate helpers: confirmed = NOT in pending (new+postponed)
                                // OR has tracking. Denominator = total uniqueOrders.
                                rateConfirmed: uniqueOrders.filter(o => {
                                    const oo = Array.isArray(o) ? o[0] : o;
                                    const hasTracking = !!oo?.id && trackedSet.has(oo.id);
                                    if (hasTracking) return true;
                                    return statusCats.pendingIds.size > 0
                                        && !!oo?.order_status_id
                                        && !statusCats.pendingIds.has(oo.order_status_id);
                                }).length,
                                rateTouched: uniqueOrders.length,
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
            <div className="ant-surface min-h-screen flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-ant-mid animate-spin" strokeWidth={1.5} />
            </div>
        );
    }

    const statusTone =
        stats.performanceStatus === 'Elite'
            ? { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' }
            : stats.performanceStatus === 'Pro'
                ? { bg: 'bg-ant-ink/6', border: 'border-ant-ink/15', text: 'text-ant-ink', dot: 'bg-ant-ink' }
                : stats.performanceStatus === 'Review'
                    ? { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' }
                    : { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };

    const initials = profile?.name?.charAt(0).toUpperCase() || '?';
    const joinYear = profile?.created_at ? new Date(profile.created_at).getFullYear() : 'N/A';
    const detailsLocked = !!profile?.bank_rib && !!profile?.cin_number;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Commercial · Profil
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Mon profil
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Votre identité professionnelle, vos coordonnées bancaires et votre performance au cordeau.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-[12px] font-semibold text-ant-rose cursor-pointer shrink-0 transition-colors"
                    >
                        <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Déconnexion
                    </button>
                </header>

                {/* Hero identity card */}
                <section className="rounded-2xl border border-ant-ink bg-ant-ink overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6">
                        <button type="button" onClick={() => setAvatarOpen(true)} title="Modifier l'avatar"
                            className="relative h-20 w-20 md:h-24 md:w-24 rounded-2xl overflow-hidden border-2 border-white/10 shrink-0 group cursor-pointer">
                            <UserAvatar url={profile?.avatar_url} config={(profile as any)?.avatar_config} name={profile?.name} className="w-full h-full text-[24px]" />
                            <span className="absolute inset-0 bg-ant-ink/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold uppercase tracking-[0.18em] text-white">Modifier</span>
                        </button>

                        <div className="flex-1 min-w-0 space-y-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Commercial · vérifié
                            </div>
                            <h2 className="font-display text-[24px] md:text-[28px] font-semibold text-white leading-tight truncate">
                                {profile?.name || 'Sans nom'}
                            </h2>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-serif italic text-[12px] text-white/60">
                                <span className="inline-flex items-center gap-1.5">
                                    <Mail className="w-3 h-3" strokeWidth={1.75} />
                                    {profile?.email || '—'}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                                    <ShieldCheck className="w-3 h-3" strokeWidth={1.75} />
                                    Vendeur vérifié
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                                    Depuis {joinYear}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Main grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="lg:col-span-2 flex flex-col gap-3">
                        {/* Bank & Identity */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className={`h-[3px] w-full ${detailsLocked ? 'bg-ant-green' : 'bg-ant-orange'}`} />
                            <div className="p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Banque &amp; identité
                                    </div>
                                    {detailsLocked ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green">
                                            <ShieldCheck className="w-3 h-3" strokeWidth={1.75} />
                                            Verrouillé
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                            À compléter
                                        </span>
                                    )}
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid">
                                    {detailsLocked
                                        ? 'Coordonnées bancaires et pièce d\u2019identité — données sécurisées.'
                                        : 'Renseignez vos coordonnées une seule fois pour activer les paiements. Ces champs sont verrouillés après sauvegarde.'}
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        {/* Bank Name */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid inline-flex items-center gap-1.5">
                                                <Building2 className="w-3 h-3" strokeWidth={1.75} />
                                                Banque
                                            </label>
                                            {profile?.bank_name ? (
                                                <p className="font-display text-[13px] font-semibold text-ant-ink">{profile.bank_name}</p>
                                            ) : (
                                                <Input
                                                    placeholder="Nom de la banque"
                                                    value={bankInfo.bank_name}
                                                    onChange={(e) => setBankInfo({ ...bankInfo, bank_name: e.target.value })}
                                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                />
                                            )}
                                        </div>

                                        {/* Account Holder */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid inline-flex items-center gap-1.5">
                                                <User className="w-3 h-3" strokeWidth={1.75} />
                                                Titulaire du compte
                                            </label>
                                            {profile?.bank_account_holder ? (
                                                <p className="font-display text-[13px] font-semibold text-ant-ink">{profile.bank_account_holder}</p>
                                            ) : (
                                                <Input
                                                    placeholder="Nom complet"
                                                    value={bankInfo.bank_account_holder}
                                                    onChange={(e) => setBankInfo({ ...bankInfo, bank_account_holder: e.target.value })}
                                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                />
                                            )}
                                        </div>

                                        {/* RIB */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid inline-flex items-center gap-1.5">
                                                <CreditCard className="w-3 h-3" strokeWidth={1.75} />
                                                RIB
                                            </label>
                                            {profile?.bank_rib ? (
                                                <p className="font-mono text-[12px] text-ant-ink bg-ant-light border border-ant-line px-3 py-2 rounded-lg tracking-wider">
                                                    {profile.bank_rib}
                                                </p>
                                            ) : (
                                                <Input
                                                    placeholder="24 chiffres"
                                                    value={bankInfo.bank_rib}
                                                    onChange={(e) => setBankInfo({ ...bankInfo, bank_rib: e.target.value })}
                                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink font-mono tracking-wider placeholder:font-serif placeholder:italic placeholder:tracking-normal placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {/* CIN */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid inline-flex items-center gap-1.5">
                                                <Fingerprint className="w-3 h-3" strokeWidth={1.75} />
                                                CIN
                                            </label>
                                            {profile?.cin_number ? (
                                                <p className="font-display text-[13px] font-semibold text-ant-ink">{profile.cin_number}</p>
                                            ) : (
                                                <Input
                                                    placeholder="Numéro d'identité"
                                                    value={bankInfo.cin_number}
                                                    onChange={(e) => setBankInfo({ ...bankInfo, cin_number: e.target.value })}
                                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                />
                                            )}
                                        </div>

                                        {/* Address */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid inline-flex items-center gap-1.5">
                                                <MapPin className="w-3 h-3" strokeWidth={1.75} />
                                                Adresse complète
                                            </label>
                                            {profile?.address ? (
                                                <p className="font-display text-[13px] font-semibold text-ant-ink leading-relaxed">{profile.address}</p>
                                            ) : (
                                                <Input
                                                    placeholder="Adresse complète"
                                                    value={bankInfo.address}
                                                    onChange={(e) => setBankInfo({ ...bankInfo, address: e.target.value })}
                                                    className="h-10 rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:font-serif placeholder:italic placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                />
                                            )}
                                        </div>

                                        {!profile?.bank_rib && (
                                            <div className="pt-1">
                                                <button
                                                    type="button"
                                                    onClick={handleUpdateBankInfo}
                                                    disabled={saving || !bankInfo.bank_rib || !bankInfo.cin_number}
                                                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-semibold cursor-pointer transition-colors"
                                                >
                                                    {saving ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                                                    ) : (
                                                        <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                    )}
                                                    Confirmer et verrouiller
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                {/* Sidebar: Performance + Financial + Account */}
                <div className="space-y-3">
                    {/* Performance Pulse */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Pouls de performance
                                </div>
                                <span className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                    statusTone.bg,
                                    statusTone.border,
                                    statusTone.text,
                                )}>
                                    <Award className="w-3 h-3" strokeWidth={1.75} />
                                    {stats.performanceStatus}
                                </span>
                            </div>
                            <div className="space-y-3">
                                {[
                                    { label: 'Attribuées', value: stats.total.toLocaleString(), sub: 'total', icon: Zap, dot: 'bg-ant-ink', text: 'text-ant-ink' },
                                    { label: 'Confirmation', value: `${stats.confirmationRate.toFixed(1)}%`, sub: `${stats.confirmed} commandes`, icon: Target, dot: 'bg-ant-orange', text: 'text-ant-orange' },
                                    { label: 'Livraison', value: `${stats.deliveryRate.toFixed(1)}%`, sub: `${stats.delivered} livrées`, icon: CheckCircle2, dot: 'bg-ant-green', text: 'text-ant-green' },
                                ].map((row) => {
                                    const Icon = row.icon;
                                    return (
                                        <div key={row.label} className="flex items-center gap-3">
                                            <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center shrink-0',
                                                row.dot === 'bg-ant-green' ? 'bg-ant-green/10 border-ant-green/25 text-ant-green'
                                                    : row.dot === 'bg-ant-orange' ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange'
                                                        : 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink',
                                            )}>
                                                <Icon className="w-4 h-4" strokeWidth={1.75} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">{row.label}</p>
                                                <p className={cn('font-display text-[15px] font-semibold tabular-nums leading-tight', row.text)}>{row.value}</p>
                                            </div>
                                            <p className="font-serif italic text-[11px] text-ant-mid shrink-0 tabular-nums">{row.sub}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    {/* Financial Earnings */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-5 space-y-3">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">03</span>
                                Rémunération
                            </div>
                            <div className="rounded-xl bg-ant-ink p-4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Taux de commission</p>
                                <p className="font-display text-[26px] font-semibold tabular-nums text-white leading-none mt-1.5">
                                    {profile?.commission_price || 0}
                                    <span className="text-[12px] text-white/50 font-normal ml-1.5">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-white/60 mt-2">
                                    {normalizeCommissionBasis(profile?.commission_basis) === 'per_unit'
                                        ? 'par unité livrée (produits assignés)'
                                        : 'par commande livrée'}
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Account Details */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <div className="p-5 space-y-3">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">04</span>
                                Détails du compte
                            </div>
                            <div className="space-y-px rounded-xl border border-ant-line overflow-hidden">
                                <div className="bg-ant-paper px-3 py-2.5 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Date d'entrée</span>
                                    <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">
                                        {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                    </span>
                                </div>
                                <div className="bg-ant-paper px-3 py-2.5 flex items-center justify-between border-t border-ant-line">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Rôle</span>
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                        Commercial partenaire
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Inventory Performance */}
                <section className="lg:col-span-3 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="px-5 py-4 border-b border-ant-line space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">05</span>
                                    Performance produit
                                </div>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 tabular-nums">
                                    {filteredProducts.length} sur {productStats.length} {productStats.length === 1 ? 'produit assigné' : 'produits assignés'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1 md:w-60">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                    <Input
                                        placeholder="Rechercher par nom, code…"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9 pr-8 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery('')}
                                            aria-label="Effacer"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-full text-ant-mid hover:bg-ant-light hover:text-ant-ink transition-colors"
                                        >
                                            <X className="w-3 h-3" strokeWidth={1.75} />
                                        </button>
                                    )}
                                </div>
                                <Select value={sortBy} onValueChange={(v) => setSortBy(v as ProductSort)}>
                                    <SelectTrigger className="h-9 rounded-full border-ant-line bg-ant-paper w-44 text-[12px] gap-1.5 focus:ring-1 focus:ring-ant-orange/40">
                                        <ArrowUpDown className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                        <SelectItem value="attributed">Plus attribuées</SelectItem>
                                        <SelectItem value="delivered">Plus livrées</SelectItem>
                                        <SelectItem value="performance">Meilleure performance</SelectItem>
                                        <SelectItem value="name">Nom (A–Z)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Performance bucket pills */}
                        <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-light overflow-x-auto max-w-full">
                            {([
                                { id: 'all', label: 'Tous', count: bucketCounts.all },
                                { id: 'high', label: 'Haute ≥60%', count: bucketCounts.high },
                                { id: 'mid', label: 'Moyenne 30-60%', count: bucketCounts.mid },
                                { id: 'low', label: 'Basse <30%', count: bucketCounts.low },
                                { id: 'none', label: 'Sans donnée', count: bucketCounts.none },
                            ] as const).map((b) => {
                                const isActive = performanceBucket === b.id;
                                return (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => setPerformanceBucket(b.id)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap',
                                            isActive
                                                ? 'bg-ant-ink text-white'
                                                : 'text-ant-mid hover:text-ant-ink',
                                        )}
                                    >
                                        {b.label}
                                        <span className={cn(
                                            'inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[9px] font-bold tabular-nums',
                                            isActive ? 'bg-white/20 text-white' : 'bg-ant-paper text-ant-mid',
                                        )}>
                                            {b.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-5">
                        {filteredProducts.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {filteredProducts.map((p) => {
                                    const rate = Math.round(getDeliveryRate(p));
                                    const rateTone = p.total === 0
                                        ? { bar: 'bg-ant-mid', text: 'text-ant-mid', dot: 'bg-ant-mid' }
                                        : rate >= 60
                                            ? { bar: 'bg-ant-green', text: 'text-ant-green', dot: 'bg-ant-green' }
                                            : rate >= 30
                                                ? { bar: 'bg-ant-orange', text: 'text-ant-orange', dot: 'bg-ant-orange' }
                                                : { bar: 'bg-ant-rose', text: 'text-ant-rose', dot: 'bg-ant-rose' };
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setSelectedProduct(p)}
                                            className="group text-left rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/30 transition-colors"
                                        >
                                            <div className="h-[3px] w-full bg-ant-orange" />
                                            <div className="aspect-[4/3] bg-ant-light overflow-hidden">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url}
                                                        alt={p.name}
                                                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Package className="w-8 h-8 text-ant-mid" strokeWidth={1.5} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-4 space-y-3">
                                                <div className="space-y-1">
                                                    <p className="font-display text-[13px] font-semibold text-ant-ink leading-snug line-clamp-2" title={p.name}>
                                                        {p.name}
                                                    </p>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">{p.code || '—'}</span>
                                                        <span className="font-display text-[12px] font-semibold tabular-nums text-ant-ink">
                                                            {p.selling_price.toLocaleString()}
                                                            <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-lg border border-ant-line overflow-hidden">
                                                    <div className="bg-ant-paper px-2 py-1.5 text-center">
                                                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Attr</p>
                                                        <p className="font-display text-[13px] font-semibold tabular-nums text-ant-ink mt-0.5">{p.total}</p>
                                                    </div>
                                                    <div className="bg-ant-paper px-2 py-1.5 text-center">
                                                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-orange">Conf</p>
                                                        <p className="font-display text-[13px] font-semibold tabular-nums text-ant-ink mt-0.5">{p.rateConfirmed}</p>
                                                    </div>
                                                    <div className="bg-ant-paper px-2 py-1.5 text-center">
                                                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-green">Liv</p>
                                                        <p className="font-display text-[13px] font-semibold tabular-nums text-ant-green mt-0.5">{p.delivered}</p>
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Taux livraison</span>
                                                        <span className={cn('font-display text-[11px] font-semibold tabular-nums', rateTone.text)}>
                                                            {p.total === 0 ? '—' : `${rate}%`}
                                                        </span>
                                                    </div>
                                                    <div className="h-1 w-full bg-ant-line rounded-full overflow-hidden">
                                                        <div
                                                            className={cn('h-full rounded-full transition-all duration-500 ease-out', rateTone.bar, p.total === 0 && 'opacity-30')}
                                                            style={{ width: `${p.total === 0 ? 100 : rate}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-12 flex flex-col items-center gap-3 text-center">
                                <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                                    <Search className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                                </div>
                                <p className="font-serif italic text-[12px] text-ant-mid">Aucun produit ne correspond aux filtres.</p>
                                <button
                                    type="button"
                                    onClick={() => { setSearchQuery(''); setPerformanceBucket('all'); }}
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                                >
                                    Réinitialiser les filtres
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                <SecuritySection email={profile?.email} />
            </div>

            {/* Product Detail Modal */}
            <Dialog open={!!selectedProduct} onOpenChange={(open) => !open && setSelectedProduct(null)}>
                <DialogContent className="max-w-3xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden flex flex-col max-h-[90vh]">
                    {selectedProduct && (() => {
                        const p = selectedProduct;
                        const displayName = p.name || 'Produit inconnu';
                        const confirmRate = p.rateTouched > 0 ? (p.rateConfirmed / p.rateTouched) * 100 : 0;
                        const pDenom = p.tracked - p.pullback;
                        const deliveryRate = pDenom > 0 ? Math.round((p.delivered / pDenom) * 100) : 0;
                        const stockTone = p.stock === 0
                            ? { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' }
                            : p.stock < 10
                                ? { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' }
                                : { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
                        const stockLabel = p.stock === 0 ? 'Rupture' : p.stock < 10 ? 'Faible' : 'En stock';
                        const rateTone = (rate: number) =>
                            rate >= 60 ? { text: 'text-ant-green', bar: 'bg-ant-green' }
                                : rate >= 30 ? { text: 'text-ant-orange', bar: 'bg-ant-orange' }
                                    : { text: 'text-ant-rose', bar: 'bg-ant-rose' };
                        const cr = rateTone(confirmRate);
                        const dr = rateTone(deliveryRate);

                        return (
                            <>
                                <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                                <DialogHeader className="px-5 py-4 border-b border-ant-line text-left space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid flex-wrap">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Produit · Performance
                                    </div>
                                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight" title={displayName}>
                                        {displayName}
                                    </DialogTitle>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-0">
                                    {/* Image */}
                                    <div className="md:col-span-2 relative bg-ant-light min-h-[220px] md:min-h-full overflow-hidden border-b md:border-b-0 md:border-r border-ant-line">
                                        {p.image_url ? (
                                            <img src={p.image_url} alt={displayName} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Package className="w-14 h-14 text-ant-mid" strokeWidth={1.5} />
                                            </div>
                                        )}
                                        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
                                            {p.code && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-ant-paper/90 backdrop-blur px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                    {p.code}
                                                </span>
                                            )}
                                            {p.label && (
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-ant-paper/90 backdrop-blur px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                    {p.label}
                                                </span>
                                            )}
                                            <span className={cn(
                                                'inline-flex items-center gap-1.5 rounded-full border bg-ant-paper/90 backdrop-blur px-2 py-0.5 text-[10px] font-semibold',
                                                stockTone.border,
                                                stockTone.text,
                                            )}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', stockTone.dot)} />
                                                {stockLabel}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Details */}
                                    <div className="md:col-span-3 flex flex-col min-h-0 overflow-y-auto ant-scroll">
                                        <div className="px-5 py-4 space-y-4">
                                            {p.description && (
                                                <p className="font-serif italic text-[12px] text-ant-mid leading-relaxed line-clamp-3">{p.description}</p>
                                            )}

                                            {/* Price & stock */}
                                            <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                                <div className="bg-ant-paper p-3">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Prix de vente</p>
                                                    <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink mt-1">
                                                        {p.selling_price.toLocaleString()}
                                                        <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                    </p>
                                                </div>
                                                <div className="bg-ant-paper p-3">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Stock</p>
                                                    <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink mt-1">
                                                        {p.stock.toLocaleString()}
                                                        <span className="text-[10px] text-ant-mid font-normal ml-1">unités</span>
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Performance */}
                                            <div className="space-y-3">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Performance
                                                </div>

                                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                                    <div className="bg-ant-paper p-3 text-center">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Attribuées</p>
                                                        <p className="font-display text-[16px] font-semibold tabular-nums text-ant-ink mt-1">{p.total}</p>
                                                    </div>
                                                    <div className="bg-ant-paper p-3 text-center">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-orange">Confirmées</p>
                                                        <p className="font-display text-[16px] font-semibold tabular-nums text-ant-ink mt-1">{p.rateConfirmed}</p>
                                                    </div>
                                                    <div className="bg-ant-paper p-3 text-center">
                                                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-green">Livrées</p>
                                                        <p className="font-display text-[16px] font-semibold tabular-nums text-ant-green mt-1">{p.delivered}</p>
                                                    </div>
                                                </div>

                                                <div className="space-y-3 pt-1">
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Taux de confirmation</span>
                                                            <span className={cn('font-display text-[13px] font-semibold tabular-nums', cr.text)}>
                                                                {p.total === 0 ? '—' : `${confirmRate.toFixed(1)}%`}
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-ant-line rounded-full overflow-hidden">
                                                            <div
                                                                className={cn('h-full rounded-full transition-all duration-500', cr.bar)}
                                                                style={{ width: `${p.total === 0 ? 0 : confirmRate}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Taux de livraison</span>
                                                            <span className={cn('font-display text-[13px] font-semibold tabular-nums', dr.text)}>
                                                                {p.total === 0 ? '—' : `${deliveryRate}%`}
                                                            </span>
                                                        </div>
                                                        <div className="h-1.5 w-full bg-ant-line rounded-full overflow-hidden">
                                                            <div
                                                                className={cn('h-full rounded-full transition-all duration-500', dr.bar)}
                                                                style={{ width: `${p.total === 0 ? 0 : deliveryRate}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Funnel summary */}
                                                <div className="rounded-xl border border-ant-line bg-ant-light p-3">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mb-2">Entonnoir</p>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 text-center">
                                                            <div className="h-1 bg-ant-ink rounded-full mb-1" />
                                                            <p className="font-display text-[13px] font-semibold tabular-nums text-ant-ink">{p.total}</p>
                                                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Attr</p>
                                                        </div>
                                                        <ChevronRight className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                                                        <div className="flex-1 text-center">
                                                            <div className="h-1 bg-ant-orange rounded-full mb-1 mx-auto" style={{ width: `${p.rateTouched === 0 ? 100 : (p.rateConfirmed / p.rateTouched) * 100}%` }} />
                                                            <p className="font-display text-[13px] font-semibold tabular-nums text-ant-orange">{p.rateConfirmed}</p>
                                                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Conf</p>
                                                        </div>
                                                        <ChevronRight className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                                                        <div className="flex-1 text-center">
                                                            <div className="h-1 bg-ant-green rounded-full mb-1 mx-auto" style={{ width: `${pDenom <= 0 ? 100 : (p.delivered / pDenom) * 100}%` }} />
                                                            <p className="font-display text-[13px] font-semibold tabular-nums text-ant-green">{p.delivered}</p>
                                                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid">Liv</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>
            <AvatarEditDialog isOpen={avatarOpen} onClose={() => setAvatarOpen(false)} onSaved={fetchProfile} seed={profile?.email} />
            </div>
        </div>
    );
};

export default SellerProfile;
