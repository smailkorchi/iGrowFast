/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Search,
    Truck,
    History,
    MapPin,
    Phone,
    SearchX,
    Megaphone,
    X,
} from 'lucide-react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource, getPlatformIcon, getPlatformColor, type CampaignDailyEntry } from '@/lib/campaignConstants';
import { DELIVERED_PKG_CATS, CANCELLED_ORDER_CATS, RETURNED_PKG_CATS } from '@/lib/status-categories';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from '@/components/ui/select';
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
    package_status: { id: string; label: string | null; color: string | null; category: string | null; icon: string | null } | null;
    city: { id: string; name: string | null } | null;
    items: Array<{
        id: string;
        quantity: number | null;
        unit_price: number | null;
        product?: { id: string; name: string | null; code: string | null; image_url: string | null } | null;
    }> | null;
};

type TabKey = 'all' | 'delivered' | 'inProgress' | 'cancelled';

const fmtMAD = (n: number) => new Intl.NumberFormat('fr-MA').format(n || 0);

const MediaBuyerOrders = () => {
    const currentUserId = useCurrentUserId();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { isOrderCategory } = useStatusCategories();

    const [searchQuery, setSearchQuery] = useState('');
    const [platformFilter, setPlatformFilter] = useState<string>('all');
    const [tab, setTab] = useState<TabKey>('all');
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
            // Paginated so a media buyer with >1000 in-window orders is never truncated.
            const data = await fetchAllRows<OrderRow>(
                'orders',
                `
                    id, name, phone, address, price, date, created_at, source_name, delivery_note, note,
                    order_status_id, package_status_id,
                    status:order_statuses(id, label, color, category),
                    package_status:package_statuses(id, label, color, category, icon),
                    city:master_cities(id, name),
                    items:order_items(id, quantity, unit_price, product:products(id, name, code, image_url))
                `,
                {
                    orderBy: 'id',
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'date', op: 'gte', value: minDate },
                        { column: 'date', op: 'lte', value: `${maxDate}T23:59:59.999Z` },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
            return (data as OrderRow[])
                .filter((o) => {
                    if (!o.date || !o.source_name) return false;
                    const key = `${o.date.slice(0, 10)}|${o.source_name.toLowerCase()}`;
                    return attributionSet.has(key);
                })
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

    const orderTab = (o: OrderRow): Exclude<TabKey, 'all'> => {
        const pkgCat = o.package_status?.category || '';
        const ordCat = o.status?.category || '';
        if (DELIVERED_PKG_CATS.includes(pkgCat as never)) return 'delivered';
        if (CANCELLED_ORDER_CATS.includes(ordCat as never) || RETURNED_PKG_CATS.includes(pkgCat as never)) return 'cancelled';
        return 'inProgress';
    };

    const tabCounts = useMemo(() => {
        const counts = { all: filteredOrders.length, delivered: 0, inProgress: 0, cancelled: 0 };
        for (const o of filteredOrders) counts[orderTab(o)] += 1;
        return counts;
    }, [filteredOrders]);

    const tabbedOrders = useMemo(
        () => (tab === 'all' ? filteredOrders : filteredOrders.filter((o) => orderTab(o) === tab)),
        [filteredOrders, tab],
    );

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

            {/* Search */}
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

            {/* Tabs (left) + platform dropdown (right) */}
            <div className="flex items-center justify-between gap-3">
                <div className="overflow-x-auto no-scrollbar -mx-0">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                        {([
                            { key: 'all', label: 'Toutes', count: tabCounts.all },
                            { key: 'delivered', label: 'Livré', count: tabCounts.delivered },
                            { key: 'inProgress', label: 'En cours', count: tabCounts.inProgress },
                            { key: 'cancelled', label: 'Annulé', count: tabCounts.cancelled },
                        ] as const).map((t) => {
                            const active = tab === t.key;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setTab(t.key)}
                                    className={cn(
                                        'shrink-0 rounded-full px-3.5 h-8 text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink',
                                    )}
                                >
                                    <span>{t.label}</span>
                                    <span className={cn(
                                        'px-1.5 min-w-[18px] h-[16px] rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center',
                                        active ? 'bg-white/15 text-white' : 'bg-ant-line text-ant-mid',
                                    )}>
                                        {t.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {distinctPlatforms.length > 0 && (
                    <Select value={platformFilter} onValueChange={setPlatformFilter}>
                        <SelectTrigger className="h-9 rounded-full border-ant-line bg-ant-paper text-[12px] w-auto min-w-[170px] shrink-0">
                            <SelectValue placeholder="Toutes les plateformes" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Toutes les plateformes</SelectItem>
                            {distinctPlatforms.map((p) => (
                                <SelectItem key={p} value={p}>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span
                                            className="w-4 h-4 rounded flex items-center justify-center text-white shrink-0"
                                            style={{ backgroundColor: getPlatformColor(p) }}
                                        >
                                            {getPlatformIcon(p, 'w-2.5 h-2.5')}
                                        </span>
                                        <span>{p.replace(/ ads$/i, '')}</span>
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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

            {!isLoading && !hasNoCampaignHistory && tabbedOrders.length === 0 && (
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
            {!isLoading && tabbedOrders.length > 0 && (
                <>
                    {/* Mobile: card list */}
                    <div className="md:hidden space-y-2">
                        {tabbedOrders.map((o) => {
                            const platformColor = o.source_name ? getPlatformColor(`${o.source_name} ads`) : '#141413';
                            const pkgColor = o.package_status?.color || '#b0aea5';
                            return (
                                <div
                                    key={o.id}
                                    className="w-full rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left"
                                >
                                    <div className="h-[3px] w-full" style={{ backgroundColor: pkgColor }} />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-0.5">
                                                <p className="font-display text-[14px] text-ant-ink truncate leading-tight">
                                                    {o.name || 'Sans nom'}
                                                </p>
                                                <p className="text-[11px] text-ant-mid truncate">{o.phone || '—'}</p>
                                            </div>
                                            {o.package_status?.label && (
                                                <span
                                                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{ backgroundColor: `${pkgColor}14`, color: pkgColor }}
                                                >
                                                    {o.package_status.icon
                                                        ? <DynamicIcon name={o.package_status.icon} className="w-2.5 h-2.5 shrink-0" />
                                                        : <span className="w-1 h-1 rounded-full" style={{ backgroundColor: pkgColor }} />}
                                                    {o.package_status.label}
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

                                        <div className="flex items-center justify-end pt-2 border-t border-ant-line">
                                            <span className="text-[10px] uppercase tracking-[0.2em] text-ant-mid">
                                                {o.date ? format(new Date(o.date), 'dd MMM', { locale: fr }) : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
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
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid w-24">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tabbedOrders.map((o) => {
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
                                                {o.package_status?.label && (
                                                    <span
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                        style={{ backgroundColor: `${o.package_status.color || '#b0aea5'}14`, color: o.package_status.color || '#6b6a63' }}
                                                    >
                                                        {o.package_status.icon
                                                            ? <DynamicIcon name={o.package_status.icon} className="w-2.5 h-2.5 shrink-0" />
                                                            : <span className="w-1 h-1 rounded-full" style={{ backgroundColor: o.package_status.color || '#b0aea5' }} />}
                                                        {o.package_status.label}
                                                    </span>
                                                )}
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
                                                <div className="flex items-center justify-end gap-1.5">
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
