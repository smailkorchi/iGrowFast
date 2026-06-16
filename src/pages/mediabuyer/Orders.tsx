/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Search,
    Eye,
    Truck,
    History,
    MapPin,
    Phone,
    Package,
    SearchX,
    Calendar,
    Megaphone,
    X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource, getPlatformIcon, getPlatformColor, type CampaignDailyEntry } from '@/lib/campaignConstants';
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

const fmtMAD = (n: number) => new Intl.NumberFormat('fr-MA').format(n || 0);

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
                .is('date_deleted', null).neq('source_review_status', 'pending')
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

    const summaryStats = useMemo(() => {
        const totalRevenue = filteredOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);
        const delivered = filteredOrders.filter((o) =>
            (o.status?.category || '') === 'delivered' || (o.package_status?.category || '') === 'delivered'
        ).length;
        const confirmed = filteredOrders.filter((o) =>
            ['confirmed', 'delivered'].includes(o.status?.category || '')
        ).length;
        return {
            total: filteredOrders.length,
            revenue: totalRevenue,
            delivered,
            confirmed,
        };
    }, [filteredOrders]);

    const isLoading = loadingEntries || loadingOrders;
    const hasNoCampaignHistory = !loadingEntries && entries.length === 0;

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Media Buyer · Commandes
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Commandes attribuées
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Les commandes issues des plateformes où vous avez diffusé · vue en lecture seule.
                        </p>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Attribuées" value={String(summaryStats.total)} accent="bg-ant-ink" />
                <KpiTile label="Confirmées" value={String(summaryStats.confirmed)} accent="bg-ant-orange" />
                <KpiTile label="Livrées" value={String(summaryStats.delivered)} accent="bg-ant-green" />
                <KpiTile label="Chiffre d'affaires" value={`${fmtMAD(summaryStats.revenue)}`} sub="DH" accent="bg-ant-green" />
            </div>

            {/* Search + platform pill-group */}
            <div className="space-y-3">
                <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                    <input
                        type="search"
                        placeholder="Rechercher nom, téléphone, ville, produit…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-11 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                            aria-label="Effacer"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {distinctPlatforms.length > 0 && (
                    <div className="-mx-0 overflow-x-auto no-scrollbar">
                        <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper min-w-min">
                            <button
                                type="button"
                                onClick={() => setPlatformFilter('all')}
                                className={cn(
                                    'shrink-0 h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[12px] font-medium transition-all',
                                    platformFilter === 'all'
                                        ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]'
                                        : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <span>Toutes</span>
                                <span className={cn(
                                    'px-1.5 min-w-[20px] h-[18px] rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center',
                                    platformFilter === 'all' ? 'bg-white/15 text-ant-light' : 'bg-ant-line text-ant-mid',
                                )}>
                                    {platformCounts.all ?? 0}
                                </span>
                            </button>
                            {distinctPlatforms.map((p) => {
                                const active = platformFilter === p;
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPlatformFilter(p)}
                                        className={cn(
                                            'shrink-0 h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[12px] font-medium transition-all',
                                            active
                                                ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]'
                                                : 'text-ant-mid hover:text-ant-ink',
                                        )}
                                    >
                                        <span className="w-4 h-4 rounded flex items-center justify-center text-white shrink-0" style={{ backgroundColor: getPlatformColor(p) }}>
                                            {getPlatformIcon(p, 'w-2.5 h-2.5')}
                                        </span>
                                        <span>{p.replace(/ ads$/i, '')}</span>
                                        <span className={cn(
                                            'px-1.5 min-w-[20px] h-[18px] rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center',
                                            active ? 'bg-white/15 text-ant-light' : 'bg-ant-line text-ant-mid',
                                        )}>
                                            {platformCounts[p] ?? 0}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* States */}
            {isLoading && (
                <div className="space-y-2">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-16 rounded-2xl" />
                    ))}
                </div>
            )}

            {!isLoading && hasNoCampaignHistory && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <Megaphone className="w-6 h-6 text-ant-mid" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">Aucune activité de campagne</p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-sm mx-auto">
                                Enregistrez une dépense sur une campagne pour commencer à voir les commandes attribuées ici.
                            </p>
                        </div>
                    </div>
                </section>
            )}

            {!isLoading && !hasNoCampaignHistory && filteredOrders.length === 0 && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <SearchX className="w-6 h-6 text-ant-mid" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">Aucune commande</p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-sm mx-auto">
                                Aucune commande ne correspond au filtre sur les jours où vous avez diffusé sur ces plateformes.
                            </p>
                        </div>
                    </div>
                </section>
            )}

            {/* Orders list */}
            {!isLoading && filteredOrders.length > 0 && (
                <>
                    {/* Mobile: card list */}
                    <div className="md:hidden space-y-2">
                        {filteredOrders.map((o) => {
                            const platformColor = o.source_name ? getPlatformColor(`${o.source_name} ads`) : '#141413';
                            const statusColor = o.status?.color || '#b0aea5';
                            return (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => setPreviewOrder(o)}
                                    className="w-full rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left active:scale-[0.995] transition-transform"
                                >
                                    <div className="h-[3px] w-full" style={{ backgroundColor: statusColor }} />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-0.5">
                                                <p className="font-display text-[14px] text-ant-ink truncate leading-tight">
                                                    {o.name || 'Sans nom'}
                                                </p>
                                                <p className="text-[11px] text-ant-mid truncate">{o.phone || '—'}</p>
                                            </div>
                                            {o.status?.label && (
                                                <span
                                                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{ backgroundColor: `${statusColor}14`, color: statusColor }}
                                                >
                                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: statusColor }} />
                                                    {o.status.label}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 text-[11px] text-ant-mid">
                                            {o.city?.name && (
                                                <span className="inline-flex items-center gap-1 truncate">
                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                    <span className="truncate">{o.city.name}</span>
                                                </span>
                                            )}
                                            {o.source_name && (
                                                <span className="inline-flex items-center gap-1" style={{ color: platformColor }}>
                                                    {getPlatformIcon(`${o.source_name} ads`, 'w-3 h-3')}
                                                    <span className="font-medium">{o.source_name}</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-end justify-between pt-2 border-t border-ant-line">
                                            <span className="text-[10px] uppercase tracking-[0.2em] text-ant-mid">
                                                {o.date ? format(new Date(o.date), 'dd MMM', { locale: fr }) : '—'}
                                            </span>
                                            <span className="font-display text-[16px] tabular-nums text-ant-ink leading-none">
                                                {o.price != null ? fmtMAD(Number(o.price)) : '—'}{' '}
                                                <span className="text-[11px] text-ant-mid">DH</span>
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Desktop: table */}
                    <section className="hidden md:block rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-ink" />
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/40">
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Client</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Statut</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Plateforme</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Date</th>
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Total</th>
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid w-32">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((o) => {
                                    const platformColor = o.source_name ? getPlatformColor(`${o.source_name} ads`) : '#141413';
                                    return (
                                        <tr key={o.id} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 transition-colors">
                                            <td className="px-4 py-3">
                                                <p className="font-display text-[13px] text-ant-ink leading-tight">{o.name || 'Sans nom'}</p>
                                                <div className="flex items-center gap-2 text-[11px] text-ant-mid mt-0.5">
                                                    {o.phone && (
                                                        <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{o.phone}</span>
                                                    )}
                                                    {o.city?.name && (
                                                        <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{o.city.name}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-1 items-start">
                                                    {o.status?.label && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                            style={{ backgroundColor: `${o.status.color || '#b0aea5'}14`, color: o.status.color || '#6b6a63' }}
                                                        >
                                                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: o.status.color || '#b0aea5' }} />
                                                            {o.status.label}
                                                        </span>
                                                    )}
                                                    {o.package_status?.label && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                            style={{ backgroundColor: `${o.package_status.color || '#b0aea5'}14`, color: o.package_status.color || '#6b6a63' }}
                                                        >
                                                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: o.package_status.color || '#b0aea5' }} />
                                                            {o.package_status.label}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {o.source_name && (
                                                    <span
                                                        className="inline-flex items-center gap-1.5 text-[11px] font-medium"
                                                        style={{ color: platformColor }}
                                                    >
                                                        {getPlatformIcon(`${o.source_name} ads`, 'w-3.5 h-3.5')}
                                                        <span className="capitalize">{o.source_name}</span>
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-[12px] text-ant-ink tabular-nums">
                                                {o.date ? format(new Date(o.date), 'dd MMM yyyy', { locale: fr }) : '—'}
                                            </td>
                                            <td className="text-right px-4 py-3">
                                                <p className="font-display text-[14px] tabular-nums text-ant-ink leading-none">
                                                    {o.price != null ? fmtMAD(Number(o.price)) : '—'}
                                                    <span className="text-[11px] ml-1 text-ant-mid">DH</span>
                                                </p>
                                            </td>
                                            <td className="text-right px-4 py-3">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewOrder(o)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                        title="Aperçu"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setTrackingOrderId(o.id)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                        title="Suivi"
                                                    >
                                                        <Truck className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setHistoryOrder(o)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                        title="Historique"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                </>
            )}

            {/* Preview dialog */}
            <Dialog open={!!previewOrder} onOpenChange={(v) => !v && setPreviewOrder(null)}>
                <DialogContent
                    className={cn(
                        'max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[90vh]',
                        'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                        'sm:rounded-2xl',
                        'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                        'max-sm:!translate-x-0 max-sm:!translate-y-0',
                        'max-sm:!w-full max-sm:!max-w-none',
                        'max-sm:!h-[92dvh] max-sm:!max-h-[92dvh]',
                        'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                        '[&>button.absolute]:hidden',
                    )}
                >
                    {previewOrder && (
                        <>
                            {/* Mobile drag handle */}
                            <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                                <div className="w-10 h-1 rounded-full bg-ant-line" />
                            </div>

                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                            <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Commande · Aperçu
                                            </span>
                                        </div>
                                        <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink truncate">
                                            {previewOrder.name || 'Sans nom'}
                                        </DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid flex items-center gap-3 flex-wrap">
                                            {previewOrder.date && (
                                                <span className="inline-flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {format(new Date(previewOrder.date), 'dd MMMM yyyy', { locale: fr })}
                                                </span>
                                            )}
                                            {previewOrder.phone && (
                                                <span className="inline-flex items-center gap-1">
                                                    <Phone className="w-3 h-3" />
                                                    {previewOrder.phone}
                                                </span>
                                            )}
                                        </DialogDescription>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPreviewOrder(null)}
                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                        aria-label="Fermer"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </DialogHeader>

                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                                {/* Ink total card */}
                                <div className="rounded-2xl bg-ant-ink text-ant-light p-4 md:p-5 space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                            Montant total
                                        </span>
                                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                            {previewOrder.status?.label && (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{ backgroundColor: `${previewOrder.status.color || '#faf9f5'}25`, color: '#faf9f5' }}
                                                >
                                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: previewOrder.status.color || '#faf9f5' }} />
                                                    {previewOrder.status.label}
                                                </span>
                                            )}
                                            {previewOrder.package_status?.label && (
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{ backgroundColor: `${previewOrder.package_status.color || '#faf9f5'}25`, color: '#faf9f5' }}
                                                >
                                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: previewOrder.package_status.color || '#faf9f5' }} />
                                                    {previewOrder.package_status.label}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className="font-display text-[28px] tabular-nums leading-none">
                                        {previewOrder.price != null ? fmtMAD(Number(previewOrder.price)) : '—'}
                                        <span className="text-[13px] text-ant-light/60 ml-1 font-normal">DH</span>
                                    </p>
                                    {previewOrder.source_name && (
                                        <p className="font-serif italic text-[11px] text-ant-light/60 flex items-center gap-1.5">
                                            {getPlatformIcon(`${previewOrder.source_name} ads`, 'w-3 h-3')}
                                            Attribuée à <span className="font-medium capitalize text-ant-light">{previewOrder.source_name}</span>
                                        </p>
                                    )}
                                </div>

                                {/* Delivery */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-ink" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">01</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Livraison
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Ville</p>
                                            <p className="text-[12px] font-medium text-ant-ink">{previewOrder.city?.name || '—'}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Adresse</p>
                                            <p className="text-[12px] font-medium text-ant-ink">{previewOrder.address || '—'}</p>
                                        </div>
                                    </div>
                                </section>

                                {/* Items */}
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">02</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Panier
                                            </span>
                                        </div>
                                        <span className="text-[11px] tabular-nums text-ant-mid">
                                            {(previewOrder.items || []).filter((i) => (i.quantity || 0) > 0).length}
                                        </span>
                                    </div>
                                    <div className="p-3 space-y-2">
                                        {(previewOrder.items || [])
                                            .filter((i) => (i.quantity || 0) > 0 && i.product)
                                            .map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-3 p-2.5 rounded-xl bg-ant-light border border-ant-line"
                                                >
                                                    {item.product?.image_url ? (
                                                        <img
                                                            src={item.product.image_url}
                                                            alt={item.product.name || ''}
                                                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center shrink-0">
                                                            <Package className="w-4 h-4 text-ant-mid" />
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-display text-[12px] text-ant-ink truncate leading-tight">
                                                            {item.product?.name || '—'}
                                                        </p>
                                                        {item.product?.code && (
                                                            <p className="font-mono text-[10px] text-ant-mid uppercase mt-0.5">{item.product.code}</p>
                                                        )}
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid">Qté</p>
                                                        <p className="font-display text-[13px] tabular-nums text-ant-ink">{item.quantity}</p>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid">Ligne</p>
                                                        <p className="font-display text-[13px] tabular-nums text-ant-ink">
                                                            {fmtMAD((item.quantity || 0) * (item.unit_price || 0))} <span className="text-[10px] text-ant-mid font-normal">DH</span>
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        {(previewOrder.items || []).filter((i) => (i.quantity || 0) > 0).length === 0 && (
                                            <p className="font-serif italic text-[12px] text-ant-mid text-center py-4">Aucun article.</p>
                                        )}
                                    </div>
                                </section>
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

const KpiTile: React.FC<{ label: string; value: string; sub?: string; accent: string }> = ({ label, value, sub, accent }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">
                {label}
            </span>
        </div>
        <p className="font-display text-[20px] md:text-[24px] leading-none tabular-nums text-ant-ink break-words">
            {value}
            {sub && <span className="text-[11px] text-ant-mid ml-1 font-normal tracking-normal">{sub}</span>}
        </p>
    </div>
);

export default MediaBuyerOrders;
