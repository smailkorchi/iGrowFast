/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    Search,
    Eye,
    Truck,
    History,
    ShoppingCart,
    MapPin,
    Phone,
    Package,
    Loader2,
    SearchX,
    Calendar,
    Megaphone,
    Filter,
    X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource, getPlatformIcon, getPlatformColor, type CampaignDailyEntry } from '@/lib/campaignConstants';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { ParcelTrackingDialog } from '@/components/orders/ParcelTrackingDialog';
import { OrderStatusHistoryDialog } from '@/components/orders/OrderStatusHistoryDialog';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────
type OrderRow = {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
    price: number | null;
    date: string | null;
    created_at: string | null;
    source_name: string | null;
    delivery_note: string | null;
    note: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
    status: { id: string; label: string | null; color: string | null; category: string | null } | null;
    package_status: { id: string; label: string | null; color: string | null; category: string | null } | null;
    city: { id: string; name: string | null } | null;
    items: Array<{
        id: string;
        quantity: number | null;
        unit_price: number | null;
        product?: { id: string; name: string | null; code: string | null; image_url: string | null } | null;
    }> | null;
    history?: Array<{
        id: string;
        created_at: string | null;
        comment: string | null;
        status_id: string | null;
        status?: { id: string; label: string | null; color: string | null; category?: string | null } | null;
        user?: { name: string | null; avatar_url: string | null } | null;
    }> | null;
};

// ── Page ───────────────────────────────────────────────────────────────────
const MediaBuyerOrders = () => {
    const currentUserId = useCurrentUserId();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { isOrderCategory } = useStatusCategories();

    const [searchQuery, setSearchQuery] = useState('');
    const [platformFilter, setPlatformFilter] = useState<string>('all');
    const [previewOrder, setPreviewOrder] = useState<OrderRow | null>(null);
    const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
    const [historyOrder, setHistoryOrder] = useState<OrderRow | null>(null);

    // 1. All campaign_daily_entries authored by this media buyer. Survives campaign deletion
    //    because `platform` + `created_by` are denormalized on the entry row.
    const { data: entries = [], isLoading: loadingEntries } = useQuery<CampaignDailyEntry[]>({
        queryKey: ['mb-orders-entries', activeBusinessId, currentUserId],
        queryFn: async () => {
            if (!activeBusinessId || !currentUserId) return [];
            const { data, error } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('id, campaign_id, "DigiCom Business", entry_date, spend, leads, notes, platform, created_by, created_at, updated_at')
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', currentUserId);
            if (error) throw error;
            return (data || []) as CampaignDailyEntry[];
        },
        enabled: !!activeBusinessId && !!currentUserId,
    });

    // 2. Build attribution buckets and date window. A (date, source) pair = this MB was active
    //    on that platform that day. Orders outside this grid are not his.
    const {
        attributionSet,
        distinctSources,
        distinctPlatforms,
        minDate,
        maxDate,
    } = useMemo(() => {
        const set = new Set<string>();
        const sources = new Set<string>();
        const platforms = new Set<string>();
        let min: string | null = null;
        let max: string | null = null;
        for (const e of entries) {
            const src = getPlatformSource(e.platform);
            if (!src || !e.entry_date) continue;
            const d = e.entry_date.slice(0, 10);
            set.add(`${d}|${src.toLowerCase()}`);
            sources.add(src.toLowerCase());
            platforms.add(e.platform);
            if (!min || d < min) min = d;
            if (!max || d > max) max = d;
        }
        return {
            attributionSet: set,
            distinctSources: Array.from(sources),
            distinctPlatforms: Array.from(platforms).sort(),
            minDate: min,
            maxDate: max,
        };
    }, [entries]);

    // 3. Pull orders across the entry date window, filter client-side by (date, source) bucket.
    const { data: orders = [], isLoading: loadingOrders } = useQuery<OrderRow[]>({
        queryKey: ['mb-orders', activeBusinessId, minDate, maxDate, distinctSources.join(',')],
        queryFn: async () => {
            if (!activeBusinessId || !minDate || !maxDate || distinctSources.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select(`
                    id, name, phone, address, price, date, created_at, source_name, delivery_note, note,
                    order_status_id, package_status_id,
                    status:order_statuses(id, label, color, category),
                    package_status:package_statuses(id, label, color, category),
                    city:master_cities(id, name),
                    items:order_items(id, quantity, unit_price, product:products(id, name, code, image_url)),
                    history:order_status_history(
                        id, created_at, comment, status_id,
                        status:order_statuses!status_id(id, label, color, category),
                        user:users!changed_by(name, avatar_url)
                    )
                `)
                .eq('DigiCom Business', activeBusinessId)
                .gte('date', minDate)
                .lte('date', `${maxDate}T23:59:59.999Z`)
                .order('date', { ascending: false });
            if (error) throw error;
            return ((data || []) as OrderRow[]).filter((o) => {
                if (!o.date || !o.source_name) return false;
                const key = `${o.date.slice(0, 10)}|${o.source_name.toLowerCase()}`;
                return attributionSet.has(key);
            });
        },
        enabled: !!activeBusinessId && !!minDate && !!maxDate && distinctSources.length > 0,
    });

    // 4. Apply platform filter + search
    const filteredOrders = useMemo(() => {
        let list = orders;
        if (platformFilter !== 'all') {
            const src = getPlatformSource(platformFilter).toLowerCase();
            list = list.filter((o) => (o.source_name || '').toLowerCase() === src);
        }
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((o) => {
                const hay = [
                    o.id, o.name, o.phone, o.address, o.city?.name,
                    o.source_name, o.status?.label, o.package_status?.label,
                    o.price != null ? String(o.price) : null,
                    ...(o.items || []).flatMap((i) => [i.product?.name, i.product?.code]),
                ]
                    .filter((v): v is string => typeof v === 'string' && v.length > 0)
                    .join(' ')
                    .toLowerCase();
                return hay.includes(q);
            });
        }
        return list;
    }, [orders, platformFilter, searchQuery]);

    // 5. Per-platform counts for filter pills
    const platformCounts = useMemo(() => {
        const counts: Record<string, number> = { all: orders.length };
        for (const p of distinctPlatforms) {
            const src = getPlatformSource(p).toLowerCase();
            counts[p] = orders.filter((o) => (o.source_name || '').toLowerCase() === src).length;
        }
        return counts;
    }, [orders, distinctPlatforms]);

    const isLoading = loadingEntries || loadingOrders;
    const hasNoCampaignHistory = !loadingEntries && entries.length === 0;

    return (
        <div className="p-6 space-y-6">
            {/* Hero */}
            <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-black text-brand-navy tracking-tight">Attributed Orders</h1>
                    <p className="text-sm text-brand-navy/50 font-medium mt-1">
                        Orders that came in from the platforms and days you ran ads. Read-only view.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-xl px-3 py-1.5 font-black border-brand-navy/10 text-brand-navy/70">
                        <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                        {orders.length} attributed
                    </Badge>
                </div>
            </div>

            {/* Filters */}
            <Card className="border-0 shadow-sm rounded-[28px]">
                <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-navy/30" />
                            <Input
                                placeholder="Search name, phone, city, product…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-10 rounded-2xl border-brand-navy/10"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-navy/30 hover:text-brand-navy"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Platform pills */}
                    {distinctPlatforms.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <Filter className="w-3.5 h-3.5 text-brand-navy/40" />
                            <button
                                onClick={() => setPlatformFilter('all')}
                                className={cn(
                                    "h-8 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                                    platformFilter === 'all'
                                        ? "bg-brand-navy text-white"
                                        : "bg-brand-navy/[0.04] text-brand-navy/60 hover:bg-brand-navy/[0.08]"
                                )}
                            >
                                All · {platformCounts.all ?? 0}
                            </button>
                            {distinctPlatforms.map((p) => {
                                const active = platformFilter === p;
                                const color = getPlatformColor(p);
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setPlatformFilter(p)}
                                        className={cn(
                                            "h-8 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                                            active
                                                ? "text-white"
                                                : "bg-brand-navy/[0.04] text-brand-navy/60 hover:bg-brand-navy/[0.08]"
                                        )}
                                        style={active ? { backgroundColor: color } : undefined}
                                    >
                                        {getPlatformIcon(p, 'w-3.5 h-3.5')}
                                        {p.replace(/ ads$/i, '')} · {platformCounts[p] ?? 0}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* States */}
            {isLoading && (
                <div className="space-y-3">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-24 rounded-[24px]" />
                    ))}
                </div>
            )}

            {!isLoading && hasNoCampaignHistory && (
                <Card className="border-0 shadow-sm rounded-[28px]">
                    <CardContent className="p-12 text-center space-y-3">
                        <div className="w-16 h-16 rounded-3xl bg-brand-navy/5 mx-auto flex items-center justify-center">
                            <Megaphone className="w-8 h-8 text-brand-navy/30" />
                        </div>
                        <h3 className="text-lg font-black text-brand-navy">No campaign activity yet</h3>
                        <p className="text-sm text-brand-navy/50 max-w-md mx-auto">
                            Log spend on a campaign day to start seeing orders attributed to you here.
                        </p>
                    </CardContent>
                </Card>
            )}

            {!isLoading && !hasNoCampaignHistory && filteredOrders.length === 0 && (
                <Card className="border-0 shadow-sm rounded-[28px]">
                    <CardContent className="p-12 text-center space-y-3">
                        <div className="w-16 h-16 rounded-3xl bg-brand-navy/5 mx-auto flex items-center justify-center">
                            <SearchX className="w-8 h-8 text-brand-navy/30" />
                        </div>
                        <h3 className="text-lg font-black text-brand-navy">No matching orders</h3>
                        <p className="text-sm text-brand-navy/50 max-w-md mx-auto">
                            No orders match the current filter on the days you ran ads on these platforms.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Orders list */}
            {!isLoading && filteredOrders.length > 0 && (
                <div className="space-y-3">
                    {filteredOrders.map((o) => {
                        const platformColor = o.source_name
                            ? getPlatformColor(`${o.source_name} ads`)
                            : '#0F172A';
                        return (
                            <Card key={o.id} className="border-0 shadow-sm rounded-[24px] hover:shadow-md transition-all">
                                <CardContent className="p-5">
                                    <div className="flex items-start gap-4 flex-wrap">
                                        {/* Identity block */}
                                        <div className="flex-1 min-w-[240px] space-y-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-base font-black text-brand-navy truncate">
                                                    {o.name || 'Unnamed customer'}
                                                </h3>
                                                {o.status?.label && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-6 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider border-none"
                                                        style={{
                                                            backgroundColor: `${o.status.color || '#6b7280'}15`,
                                                            color: o.status.color || '#6b7280',
                                                        }}
                                                    >
                                                        {o.status.label}
                                                    </Badge>
                                                )}
                                                {o.package_status?.label && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-6 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider border-none"
                                                        style={{
                                                            backgroundColor: `${o.package_status.color || '#6b7280'}15`,
                                                            color: o.package_status.color || '#6b7280',
                                                        }}
                                                    >
                                                        <Package className="w-3 h-3 mr-1 inline" />
                                                        {o.package_status.label}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 flex-wrap text-xs font-bold text-brand-navy/50">
                                                {o.phone && (
                                                    <span className="flex items-center gap-1.5">
                                                        <Phone className="w-3.5 h-3.5" />
                                                        {o.phone}
                                                    </span>
                                                )}
                                                {o.city?.name && (
                                                    <span className="flex items-center gap-1.5">
                                                        <MapPin className="w-3.5 h-3.5" />
                                                        {o.city.name}
                                                    </span>
                                                )}
                                                {o.date && (
                                                    <span className="flex items-center gap-1.5">
                                                        <Calendar className="w-3.5 h-3.5" />
                                                        {format(new Date(o.date), 'MMM dd, yyyy')}
                                                    </span>
                                                )}
                                                {o.source_name && (
                                                    <span
                                                        className="flex items-center gap-1.5 font-black uppercase tracking-wider"
                                                        style={{ color: platformColor }}
                                                    >
                                                        {getPlatformIcon(`${o.source_name} ads`, 'w-3.5 h-3.5')}
                                                        {o.source_name}
                                                    </span>
                                                )}
                                            </div>
                                            {o.items && o.items.length > 0 && (
                                                <div className="text-xs text-brand-navy/40 font-medium truncate">
                                                    {o.items
                                                        .filter((i) => (i.quantity || 0) > 0 && i.product?.name)
                                                        .map((i) => `${i.quantity}× ${i.product!.name}`)
                                                        .join(' · ') || '—'}
                                                </div>
                                            )}
                                        </div>

                                        {/* Price */}
                                        <div className="text-right shrink-0">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/30">Total</p>
                                            <p className="text-xl font-black text-brand-navy">
                                                {o.price != null ? Number(o.price).toLocaleString('fr-MA') : '—'}
                                                <span className="text-xs ml-1">DH</span>
                                            </p>
                                        </div>

                                        {/* Actions — the three only ones the MB is allowed */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 rounded-xl border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5 font-bold text-xs"
                                                onClick={() => setPreviewOrder(o)}
                                            >
                                                <Eye className="w-3.5 h-3.5 mr-1.5" />
                                                Preview
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 rounded-xl border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5 font-bold text-xs"
                                                onClick={() => setTrackingOrderId(o.id)}
                                            >
                                                <Truck className="w-3.5 h-3.5 mr-1.5" />
                                                Tracking
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 rounded-xl border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5 font-bold text-xs"
                                                onClick={() => setHistoryOrder(o)}
                                            >
                                                <History className="w-3.5 h-3.5 mr-1.5" />
                                                History
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Preview dialog — read-only */}
            <Dialog open={!!previewOrder} onOpenChange={(v) => !v && setPreviewOrder(null)}>
                <DialogContent className="max-w-2xl p-0 border-none bg-white rounded-[32px] overflow-hidden max-h-[90vh] flex flex-col">
                    {previewOrder && (
                        <>
                            <DialogHeader className="p-8 pb-4 shrink-0">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-[22px] bg-brand-navy flex items-center justify-center text-white shadow-lg">
                                            <ShoppingCart className="w-7 h-7" />
                                        </div>
                                        <div>
                                            <DialogTitle className="text-2xl font-black text-brand-navy">
                                                {previewOrder.name || 'Unnamed'}
                                            </DialogTitle>
                                            <DialogDescription className="text-xs font-bold text-brand-navy/50 flex items-center gap-3 mt-1">
                                                {previewOrder.date && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        {format(new Date(previewOrder.date), 'MMM dd, yyyy')}
                                                    </span>
                                                )}
                                                {previewOrder.phone && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="w-3 h-3" />
                                                        {previewOrder.phone}
                                                    </span>
                                                )}
                                            </DialogDescription>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/30">Total</p>
                                        <p className="text-2xl font-black text-brand-navy">
                                            {previewOrder.price != null ? Number(previewOrder.price).toLocaleString('fr-MA') : '—'}
                                            <span className="text-xs ml-1">DH</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-4 flex-wrap">
                                    {previewOrder.status?.label && (
                                        <Badge
                                            className="h-6 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider border-none"
                                            style={{
                                                backgroundColor: `${previewOrder.status.color || '#6b7280'}15`,
                                                color: previewOrder.status.color || '#6b7280',
                                            }}
                                        >
                                            {previewOrder.status.label}
                                        </Badge>
                                    )}
                                    {previewOrder.package_status?.label && (
                                        <Badge
                                            className="h-6 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider border-none"
                                            style={{
                                                backgroundColor: `${previewOrder.package_status.color || '#6b7280'}15`,
                                                color: previewOrder.package_status.color || '#6b7280',
                                            }}
                                        >
                                            {previewOrder.package_status.label}
                                        </Badge>
                                    )}
                                    {previewOrder.source_name && (
                                        <Badge
                                            className="h-6 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider border-none"
                                            style={{
                                                backgroundColor: `${getPlatformColor(`${previewOrder.source_name} ads`)}15`,
                                                color: getPlatformColor(`${previewOrder.source_name} ads`),
                                            }}
                                        >
                                            {previewOrder.source_name}
                                        </Badge>
                                    )}
                                </div>
                            </DialogHeader>

                            <div className="px-8 pb-8 space-y-6 overflow-y-auto">
                                {/* Delivery */}
                                <div className="p-5 rounded-[24px] bg-brand-navy/[0.02] border border-brand-navy/[0.05] space-y-3">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                        <Truck className="w-3.5 h-3.5" /> Delivery
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-[9px] font-black uppercase text-brand-navy/30">City</p>
                                            <p className="font-bold text-brand-navy">{previewOrder.city?.name || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black uppercase text-brand-navy/30">Address</p>
                                            <p className="font-bold text-brand-navy text-xs italic">"{previewOrder.address || '—'}"</p>
                                        </div>
                                    </div>
                                    {previewOrder.delivery_note && (
                                        <div className="pt-2 border-t border-brand-navy/5">
                                            <p className="text-[9px] font-black uppercase text-brand-navy/30">Delivery note</p>
                                            <p className="text-xs font-bold text-brand-navy italic">"{previewOrder.delivery_note}"</p>
                                        </div>
                                    )}
                                </div>

                                {/* Items */}
                                <div className="space-y-3">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 flex items-center gap-2">
                                        <Package className="w-3.5 h-3.5" /> Cart Items
                                    </h4>
                                    <div className="space-y-2">
                                        {(previewOrder.items || [])
                                            .filter((i) => (i.quantity || 0) > 0 && i.product)
                                            .map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-3 p-3 rounded-[20px] bg-brand-navy/[0.02] border border-brand-navy/[0.05]"
                                                >
                                                    {item.product?.image_url ? (
                                                        <img
                                                            src={item.product.image_url}
                                                            alt={item.product.name || ''}
                                                            className="w-12 h-12 rounded-xl object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-xl bg-brand-navy/5 flex items-center justify-center">
                                                            <Package className="w-5 h-5 text-brand-navy/30" />
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-sm text-brand-navy truncate">
                                                            {item.product?.name || '—'}
                                                        </p>
                                                        {item.product?.code && (
                                                            <p className="text-[10px] font-bold text-brand-navy/40 uppercase tracking-wider">
                                                                {item.product.code}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] font-black uppercase text-brand-navy/30">Qty</p>
                                                        <p className="font-black text-brand-navy">{item.quantity}</p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] font-black uppercase text-brand-navy/30">Line</p>
                                                        <p className="font-black text-brand-navy text-sm">
                                                            {((item.quantity || 0) * (item.unit_price || 0)).toLocaleString('fr-MA')} DH
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        {(previewOrder.items || []).filter((i) => (i.quantity || 0) > 0).length === 0 && (
                                            <p className="text-xs text-brand-navy/30 italic text-center py-4">No items.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Tracking dialog */}
            <ParcelTrackingDialog
                open={!!trackingOrderId}
                onOpenChange={(v) => !v && setTrackingOrderId(null)}
                orderId={trackingOrderId}
            />

            {/* History dialog */}
            <OrderStatusHistoryDialog
                open={!!historyOrder}
                onOpenChange={(v) => !v && setHistoryOrder(null)}
                order={historyOrder}
                isOrderInCategory={(statusId, cat) =>
                    !!statusId && isOrderCategory(statusId, cat as any)
                }
            />
        </div>
    );
};

export default MediaBuyerOrders;
