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
                .is('date_deleted', null)
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Attributed Orders</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {orders.length} attributed · read-only view
                        </p>
                    </div>
                </div>
            </header>

            {/* Filters */}
            <div className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-center gap-2 mb-2">
                    <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <Input
                            placeholder="Search name, phone, city, product…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 h-8 text-[11px] rounded-md border-gray-100"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-navy"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {distinctPlatforms.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Filter className="w-3 h-3 text-gray-400" />
                        <button
                            onClick={() => setPlatformFilter('all')}
                            className={cn(
                                'h-6 px-2 rounded text-[10px] font-semibold uppercase tracking-wider transition-all',
                                platformFilter === 'all' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
                                        'h-6 px-2 rounded text-[10px] font-semibold uppercase tracking-wider transition-all flex items-center gap-1',
                                        active ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                    )}
                                    style={active ? { backgroundColor: color } : undefined}
                                >
                                    {getPlatformIcon(p, 'w-3 h-3')}
                                    {p.replace(/ ads$/i, '')} · {platformCounts[p] ?? 0}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* States */}
            {isLoading && (
                <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                </div>
            )}

            {!isLoading && hasNoCampaignHistory && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white">
                    <div className="py-8 flex flex-col items-center text-center gap-2">
                        <Megaphone className="w-6 h-6 text-gray-400" />
                        <p className="text-[12px] font-semibold text-brand-navy">No campaign activity yet</p>
                        <p className="text-[11px] text-gray-400 max-w-sm">
                            Log spend on a campaign day to start seeing orders attributed to you here.
                        </p>
                    </div>
                </div>
            )}

            {!isLoading && !hasNoCampaignHistory && filteredOrders.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white">
                    <div className="py-8 flex flex-col items-center text-center gap-2">
                        <SearchX className="w-6 h-6 text-gray-400" />
                        <p className="text-[12px] font-semibold text-brand-navy">No matching orders</p>
                        <p className="text-[11px] text-gray-400 max-w-sm">
                            No orders match the current filter on the days you ran ads on these platforms.
                        </p>
                    </div>
                </div>
            )}

            {/* Orders table */}
            {!isLoading && filteredOrders.length > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Customer</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Status</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Platform</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Date</th>
                                <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Total</th>
                                <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.map((o) => {
                                const platformColor = o.source_name ? getPlatformColor(`${o.source_name} ads`) : '#3b5e5e';
                                return (
                                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-3 py-2">
                                            <p className="text-[11px] font-semibold text-brand-navy/80">{o.name || 'Unnamed'}</p>
                                            <div className="flex items-center gap-2 text-[9px] text-gray-400 mt-0.5">
                                                {o.phone && (
                                                    <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{o.phone}</span>
                                                )}
                                                {o.city?.name && (
                                                    <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{o.city.name}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-col gap-0.5">
                                                {o.status?.label && (
                                                    <Badge
                                                        variant="outline"
                                                        className="h-5 px-1.5 text-[9px] font-semibold uppercase tracking-wider border-none w-fit"
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
                                                        className="h-5 px-1.5 text-[9px] font-semibold uppercase tracking-wider border-none w-fit"
                                                        style={{
                                                            backgroundColor: `${o.package_status.color || '#6b7280'}15`,
                                                            color: o.package_status.color || '#6b7280',
                                                        }}
                                                    >
                                                        {o.package_status.label}
                                                    </Badge>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {o.source_name && (
                                                <span
                                                    className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
                                                    style={{ color: platformColor }}
                                                >
                                                    {getPlatformIcon(`${o.source_name} ads`, 'w-3 h-3')}
                                                    {o.source_name}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                            {o.date ? format(new Date(o.date), 'dd MMM yyyy') : '—'}
                                        </td>
                                        <td className="text-right px-3 py-2">
                                            <p className="text-[12px] font-semibold tabular-nums text-brand-navy">
                                                {o.price != null ? Number(o.price).toLocaleString('fr-MA') : '—'}
                                                <span className="text-[9px] ml-1 text-gray-400">DH</span>
                                            </p>
                                        </td>
                                        <td className="text-right px-3 py-2">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 rounded text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                                    onClick={() => setPreviewOrder(o)}
                                                    title="Preview"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 rounded text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                                    onClick={() => setTrackingOrderId(o.id)}
                                                    title="Tracking"
                                                >
                                                    <Truck className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 rounded text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5"
                                                    onClick={() => setHistoryOrder(o)}
                                                    title="History"
                                                >
                                                    <History className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Preview dialog — read-only */}
            <Dialog open={!!previewOrder} onOpenChange={(v) => !v && setPreviewOrder(null)}>
                <DialogContent className="max-w-2xl p-0 border border-gray-100 bg-white rounded-xl overflow-hidden max-h-[90vh] flex flex-col">
                    {previewOrder && (
                        <>
                            <DialogHeader className="p-5 border-b border-gray-100 shrink-0">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">
                                            {previewOrder.name || 'Unnamed'}
                                        </DialogTitle>
                                        <DialogDescription className="text-[10px] text-gray-400 flex items-center gap-2 mt-0.5">
                                            {previewOrder.date && (
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {format(new Date(previewOrder.date), 'dd MMM yyyy')}
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
                                    <div className="text-right shrink-0">
                                        <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400">Total</p>
                                        <p className="text-[16px] font-semibold tabular-nums text-brand-navy">
                                            {previewOrder.price != null ? Number(previewOrder.price).toLocaleString('fr-MA') : '—'}
                                            <span className="text-[10px] ml-1 text-gray-400">DH</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                                    {previewOrder.status?.label && (
                                        <Badge
                                            className="h-5 px-1.5 text-[9px] font-semibold uppercase tracking-wider border-none"
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
                                            className="h-5 px-1.5 text-[9px] font-semibold uppercase tracking-wider border-none"
                                            style={{
                                                backgroundColor: `${previewOrder.package_status.color || '#6b7280'}15`,
                                                color: previewOrder.package_status.color || '#6b7280',
                                            }}
                                        >
                                            {previewOrder.package_status.label}
                                        </Badge>
                                    )}
                                </div>
                            </DialogHeader>

                            <div className="p-5 space-y-4 overflow-y-auto">
                                {/* Delivery */}
                                <div className="p-3 rounded-lg bg-gray-50 border border-gray-100 space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                                        <Truck className="w-3 h-3" /> Delivery
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[9px] uppercase text-gray-400">City</p>
                                            <p className="text-[11px] font-semibold text-brand-navy">{previewOrder.city?.name || '—'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] uppercase text-gray-400">Address</p>
                                            <p className="text-[11px] font-semibold text-brand-navy">{previewOrder.address || '—'}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Items */}
                                <div className="space-y-2">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                                        <Package className="w-3 h-3" /> Cart Items
                                    </p>
                                    <div className="space-y-1.5">
                                        {(previewOrder.items || [])
                                            .filter((i) => (i.quantity || 0) > 0 && i.product)
                                            .map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100"
                                                >
                                                    {item.product?.image_url ? (
                                                        <img
                                                            src={item.product.image_url}
                                                            alt={item.product.name || ''}
                                                            className="w-10 h-10 rounded object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center shrink-0">
                                                            <Package className="w-4 h-4 text-gray-400" />
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-semibold text-brand-navy truncate">
                                                            {item.product?.name || '—'}
                                                        </p>
                                                        {item.product?.code && (
                                                            <p className="text-[9px] text-gray-400 uppercase">{item.product.code}</p>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] text-gray-400">Qty</p>
                                                        <p className="text-[11px] font-semibold text-brand-navy">{item.quantity}</p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] text-gray-400">Line</p>
                                                        <p className="text-[11px] font-semibold text-brand-navy tabular-nums">
                                                            {((item.quantity || 0) * (item.unit_price || 0)).toLocaleString('fr-MA')} DH
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        {(previewOrder.items || []).filter((i) => (i.quantity || 0) > 0).length === 0 && (
                                            <p className="text-[11px] text-gray-400 text-center py-4">No items.</p>
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
