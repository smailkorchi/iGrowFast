/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { DynamicIcon } from '@/lib/renderReactIcon';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
import {
    Search,
    Package,
    Layers,
    MapPin,
    Phone,
    Loader2,
    SearchX,
    CheckCircle2,
    Clock,
    AlertCircle,
    History,
    X,
    ChevronRight,
    Truck,
    Hash,
    MessageCircle,
    QrCode,
    RotateCcw,
} from 'lucide-react';
import QrScanModal from '@/components/scanner/QrScanModal';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────
type PackageStatus = {
    id: string;
    code: string | null;
    label: string | null;
    color: string | null;
    recheck: boolean | null;
    ranking: string | number | null;
    icon: string | null;
    is_new: boolean;
    is_postponed: boolean;
    is_delivered: boolean;
    is_returned: boolean;
    show_in_courier: boolean;
};

type CourierOrderRow = {
    parcel_id: string;
    parcel_tracking_code: string | null;
    parcel_created_at: string | null;
    parcel_status: PackageStatus | null;
    note_id: string;
    note_reference: string | null;
    note_finalized_at: string | null;
    order: {
        id: string;
        name: string | null;
        phone: string | null;
        address: string | null;
        price: number | null;
        delivery_note: string | null;
        created_at: string | null;
        city: { id: string; name: string | null } | null;
        items: Array<{
            quantity: number | null;
            product?: { name: string | null; code: string | null } | null;
        }> | null;
    };
};

type TabKey = 'all' | 'livre' | 'nouveau' | 'suivi' | 'reported' | 'retour';

const TABS: Array<{
    key: TabKey;
    label: string;
    icon: typeof CheckCircle2;
    match: (status: PackageStatus | null) => boolean;
}> = [
    { key: 'all', label: 'Tout', icon: Layers, match: () => true },
    { key: 'nouveau', label: 'Nouveau', icon: Package, match: (s) => !!s?.is_new },
    { key: 'suivi', label: 'Suivi', icon: AlertCircle, match: (s) => !!s?.recheck && !s?.is_postponed && !s?.is_delivered },
    { key: 'reported', label: 'Reporté', icon: Clock, match: (s) => !!s?.is_postponed },
    { key: 'livre', label: 'Livré', icon: CheckCircle2, match: (s) => !!s?.is_delivered },
    { key: 'retour', label: 'Retour', icon: RotateCcw, match: (s) => !!s?.is_returned },
];

const fmtMAD = (n: number) => new Intl.NumberFormat('fr-FR').format(n || 0);

const CourierOrders = () => {
    const { toast } = useToast();
    const { resolve: resolvePkgStatus, resolveById } = usePackageStatusResolver();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<TabKey>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRow, setSelectedRow] = useState<CourierOrderRow | null>(null);
    const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);

    const { data: meRow } = useQuery({
        queryKey: ['courier-me'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, "DigiCom Business", name')
                .eq('id', user.id)
                .maybeSingle();
            if (error) throw error;
            return data as { id: string; ['DigiCom Business']: string; name: string | null } | null;
        },
        staleTime: 60_000,
    });

    const courierId = meRow?.id;
    const businessId = meRow?.['DigiCom Business'];

    const { data: packageStatuses = [] } = useQuery<PackageStatus[]>({
        queryKey: ['courier-package-statuses', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            const { data, error } = await supabase
                .from('package_statuses')
                .select('id, code, label, color, recheck, ranking, icon, is_new, is_postponed, is_delivered, is_returned, show_in_courier')
                .order('ranking');
            if (error) throw error;
            return (data || []) as PackageStatus[];
        },
        enabled: !!businessId,
        staleTime: 5 * 60_000,
    });

    const { data: rows = [], isLoading } = useQuery<CourierOrderRow[]>({
        queryKey: ['courier-orders', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];

            // Paginated so the lifetime list never silently truncates at the
            // 1000-row default cap (search / QR scan need every parcel).
            const data = await fetchAllRows<any>(
                'courier_parcels',
                `
                    id,
                    tracking_code,
                    status_id,
                    created_at,
                    courier_delivery_note_id,
                    note:courier_delivery_notes!inner(
                        id, reference, is_finalized, updated_at
                    ),
                    order:orders!courier_parcels_order_id_fkey(
                        id, name, phone, address, price, delivery_note, created_at,
                        city:master_cities(id, name),
                        items:order_items(quantity, product:products(name, code))
                    ),
                    status:package_statuses(id, code, label, color, recheck, ranking, icon, is_new, is_postponed, is_delivered, is_returned)
                `,
                {
                    filters: [
                        { column: 'courier_id', op: 'eq', value: courierId },
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'note.is_finalized', op: 'eq', value: true },
                    ],
                }
            );

            const list = (data || []) as any[];
            return list
                .filter((p) => p?.note && p?.order)
                .map((p) => ({
                    parcel_id: p.id,
                    parcel_tracking_code: p.tracking_code,
                    parcel_created_at: p.created_at,
                    parcel_status: (p.status as PackageStatus) || null,
                    note_id: p.note.id,
                    note_reference: p.note.reference,
                    note_finalized_at: p.note.updated_at,
                    order: p.order,
                }))
                // fetchAllRows paginates on a stable id order — restore the
                // page's newest-first display order here.
                .sort((a, b) =>
                    new Date(b.parcel_created_at || 0).getTime() - new Date(a.parcel_created_at || 0).getTime()
                ) as CourierOrderRow[];
        },
        enabled: !!courierId && !!businessId,
    });

    useEffect(() => {
        const tracking = searchParams.get('tracking');
        if (!tracking) return;
        if (rows.length === 0) return;

        const normalized = tracking.trim().toUpperCase();
        const match = rows.find(
            (r) => (r.parcel_tracking_code || '').toUpperCase() === normalized,
        );

        if (match) {
            setActiveTab('all');
            setSearchQuery(normalized);
            setSelectedRow(match);
        } else {
            toast({
                title: 'Colis non trouvé',
                description: `« ${normalized} » n'est pas dans vos colis actuels.`,
                variant: 'destructive',
            });
        }

        const next = new URLSearchParams(searchParams);
        next.delete('tracking');
        setSearchParams(next, { replace: true });
    }, [rows, searchParams, setSearchParams, toast]);

    // Server-side tab counts (courier_parcel_counts RPC) — the client set is
    // page-scoped, so counting it locally undercounts once it exceeds a page.
    const EMPTY_COUNTS: Record<TabKey, number> = useMemo(
        () => ({ all: 0, livre: 0, nouveau: 0, suivi: 0, reported: 0, retour: 0 }),
        [],
    );
    const { data: counts = EMPTY_COUNTS } = useQuery<Record<TabKey, number>>({
        queryKey: ['courier-parcel-counts', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return EMPTY_COUNTS;
            const { data, error } = await (supabase as any)
                .rpc('courier_parcel_counts', { p_courier: courierId, p_business: businessId });
            if (error) throw error;
            const d = (data || {}) as Record<string, number | string>;
            return {
                all: Number(d.all || 0),
                livre: Number(d.livre || 0),
                nouveau: Number(d.nouveau || 0),
                suivi: Number(d.suivi || 0),
                reported: Number(d.reported || 0),
                retour: Number(d.retour || 0),
            };
        },
        enabled: !!courierId && !!businessId,
    });

    const searchableRows = useMemo(() => {
        const normalizeDigits = (v: string) => v.replace(/\D/g, '');
        return rows.map((r) => {
            const items = r.order.items || [];
            const parts: Array<string | number | null | undefined> = [
                r.parcel_id,
                r.parcel_tracking_code,
                r.parcel_status?.label,
                r.parcel_status?.code,
                r.note_id,
                r.note_reference,
                r.order.id,
                r.order.name,
                r.order.phone,
                normalizeDigits(r.order.phone || ''),
                r.order.address,
                r.order.city?.name,
                r.order.delivery_note,
                r.order.price,
                r.order.created_at,
                r.parcel_created_at,
                r.note_finalized_at,
                ...items.flatMap((i) => [i.product?.name, i.product?.code, i.quantity]),
            ];
            const haystack = parts
                .filter((x) => x !== null && x !== undefined && String(x).length > 0)
                .join(' ')
                .toLowerCase();
            return { row: r, haystack };
        });
    }, [rows]);

    const filteredRows = useMemo(() => {
        const tab = TABS.find((t) => t.key === activeTab);
        if (!tab) return [];
        const raw = searchQuery.trim().toLowerCase();
        const tokens = raw ? raw.split(/\s+/).filter(Boolean) : [];
        return searchableRows
            .filter(({ row, haystack }) => {
                if (!tab.match(row.parcel_status)) return false;
                if (tokens.length === 0) return true;
                return tokens.every((t) => haystack.includes(t));
            })
            .map(({ row }) => row);
    }, [searchableRows, activeTab, searchQuery]);

    const handleScannedCode = (code: string) => {
        const normalized = code.trim().toUpperCase();
        setIsScannerOpen(false);

        const match = rows.find(
            (r) => (r.parcel_tracking_code || '').toUpperCase() === normalized,
        );

        if (!match) {
            toast({
                title: 'Colis non attribué',
                description: `Le QR « ${normalized} » ne correspond à aucun colis de vos bons de livraison.`,
                variant: 'destructive',
            });
            setSearchQuery('');
            return;
        }

        setActiveTab('all');
        setSearchQuery(normalized);
        setSelectedRow(match);
        toast({
            title: 'Colis trouvé',
            description: `${match.order.name || 'Client'} · ${normalized}`,
        });
    };

    const updateStatusMutation = useMutation({
        mutationFn: async ({
            parcelId,
            status,
        }: {
            parcelId: string;
            status: PackageStatus;
        }) => {
            const { error } = await (supabase as any)
                .from('courier_parcels')
                .update({ status_id: status.id })
                .eq('id', parcelId);
            if (error) throw error;
        },
        onSuccess: (_d, variables) => {
            queryClient.invalidateQueries({ queryKey: ['courier-orders', courierId, businessId] });
            queryClient.invalidateQueries({ queryKey: ['courier-parcel-counts', courierId, businessId] });
            toast({
                title: 'Statut mis à jour',
                description: `Le colis est maintenant marqué « ${variables.status.label} ».`,
            });
            setSelectedRow((prev) => (prev && prev.parcel_id === variables.parcelId
                ? { ...prev, parcel_status: variables.status }
                : prev));
        },
        onError: (err: any) => {
            toast({
                title: 'Erreur',
                description: err?.message || 'Impossible de mettre à jour le statut.',
                variant: 'destructive',
            });
        },
    });

    const kpiTiles = [
        { label: 'Total colis', value: String(counts.all), accent: 'bg-ant-ink' },
        { label: 'Nouveaux', value: String(counts.nouveau), accent: 'bg-ant-ink' },
        { label: 'À suivre', value: String(counts.suivi + counts.reported), accent: 'bg-ant-orange' },
        { label: 'Livrés', value: String(counts.livre), accent: 'bg-ant-green' },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Livreur · Commandes
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Mes commandes
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Colis confiés via vos bons de livraison — suivez, mettez à jour, avancez.
                        </p>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {kpiTiles.map((k) => (
                    <div key={k.label} className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', k.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">
                                {k.label}
                            </span>
                        </div>
                        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
                            {k.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Search + scan */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                    <input
                        type="search"
                        placeholder="Rechercher nom, téléphone, ville, tracking…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-11 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                        aria-label="Rechercher"
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
                <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    aria-label="Scanner le QR d'un colis"
                    className="h-11 w-11 rounded-full bg-ant-ink text-ant-light flex items-center justify-center shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)] hover:bg-ant-ink/95 active:scale-95 transition-all shrink-0"
                >
                    <QrCode className="w-4 h-4" />
                </button>
            </div>

            {/* Tab filter pill-group */}
            <div className="-mx-3 md:-mx-0 px-3 md:px-0 overflow-x-auto no-scrollbar">
                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper min-w-min">
                    {TABS.map((t) => {
                        const isActive = activeTab === t.key;
                        const count = counts[t.key];
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setActiveTab(t.key)}
                                className={cn(
                                    'shrink-0 h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[12px] font-medium transition-all',
                                    isActive
                                        ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]'
                                        : 'text-ant-mid hover:text-ant-ink',
                                )}
                                aria-pressed={isActive}
                            >
                                <Icon className="w-3.5 h-3.5 shrink-0" />
                                <span>{t.label}</span>
                                <span
                                    className={cn(
                                        'px-1.5 min-w-[20px] h-[18px] rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center',
                                        isActive ? 'bg-white/15 text-ant-light' : 'bg-ant-line text-ant-mid',
                                    )}
                                >
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="w-6 h-6 text-ant-mid animate-spin" />
                    <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Chargement…</p>
                </div>
            ) : filteredRows.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <SearchX className="w-6 h-6 text-ant-mid" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">Aucun colis</p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-xs mx-auto">
                                Les commandes apparaissent ici une fois confiées dans un bon de livraison finalisé.
                            </p>
                        </div>
                    </div>
                </section>
            ) : (
                <>
                    {/* Mobile: card list */}
                    <div className="md:hidden space-y-2">
                        {filteredRows.map((row) => {
                            const { order, parcel_status, parcel_tracking_code } = row;
                            const rps = resolveById(parcel_status?.id) ?? (parcel_status ? resolvePkgStatus(parcel_status.label, parcel_status.label, parcel_status.color) : null);
                            const color = rps?.color || parcel_status?.color || '#b0aea5';
                            const label = rps?.label || parcel_status?.label || 'Nouveau';
                            return (
                                <button
                                    key={row.parcel_id}
                                    type="button"
                                    onClick={() => setSelectedRow(row)}
                                    className="w-full relative rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left active:scale-[0.995] transition-transform"
                                >
                                    <div className="h-[3px] w-full" style={{ backgroundColor: color }} />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <p className="font-display text-[14px] text-ant-ink truncate leading-tight">
                                                    {order.name || 'Client'}
                                                </p>
                                                <p className="text-[11px] text-ant-mid truncate">
                                                    {order.phone || '—'}
                                                </p>
                                            </div>
                                            <span
                                                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                style={{ backgroundColor: `${color}14`, color }}
                                            >
                                                {rps?.icon
                                                    ? <DynamicIcon name={rps.icon} className="w-2.5 h-2.5 shrink-0" />
                                                    : <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />}
                                                {label}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-3 text-[11px] text-ant-mid">
                                            {order.city?.name && (
                                                <span className="inline-flex items-center gap-1 truncate">
                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                    <span className="truncate">{order.city.name}</span>
                                                </span>
                                            )}
                                            {parcel_tracking_code && (
                                                <span className="inline-flex items-center gap-1 font-mono truncate">
                                                    <Hash className="w-3 h-3 shrink-0" />
                                                    <span className="truncate">{parcel_tracking_code}</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-end justify-between pt-1 border-t border-ant-line">
                                            <span className="text-[10px] uppercase tracking-[0.2em] text-ant-mid">
                                                Montant
                                            </span>
                                            <span className="font-display text-[18px] tabular-nums text-ant-ink leading-none">
                                                {fmtMAD(order.price || 0)} <span className="text-[11px] text-ant-mid">DH</span>
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
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Ville</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Tracking</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Statut</th>
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Montant</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((row) => {
                                    const { order, parcel_status, parcel_tracking_code } = row;
                                    const rps = resolveById(parcel_status?.id) ?? (parcel_status ? resolvePkgStatus(parcel_status.label, parcel_status.label, parcel_status.color) : null);
                                    const color = rps?.color || parcel_status?.color || '#b0aea5';
                                    const label = rps?.label || parcel_status?.label || 'Nouveau';
                                    return (
                                        <tr
                                            key={row.parcel_id}
                                            className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/50 transition-colors cursor-pointer"
                                            onClick={() => setSelectedRow(row)}
                                        >
                                            <td className="px-4 py-3">
                                                <p className="font-display text-[13px] text-ant-ink leading-tight">{order.name || 'Client'}</p>
                                                <p className="text-[11px] text-ant-mid mt-0.5">{order.phone || '—'}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                {order.city?.name ? (
                                                    <span className="inline-flex items-center gap-1 text-[12px] text-ant-ink">
                                                        <MapPin className="w-3 h-3 text-ant-mid" />
                                                        {order.city.name}
                                                    </span>
                                                ) : <span className="text-[12px] text-ant-mid">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                {parcel_tracking_code ? (
                                                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ant-ink">
                                                        <Hash className="w-3 h-3 text-ant-mid" />
                                                        {parcel_tracking_code}
                                                    </span>
                                                ) : <span className="text-[12px] text-ant-mid">—</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]"
                                                    style={{ backgroundColor: `${color}14`, color }}
                                                >
                                                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
                                                    {label}
                                                </span>
                                            </td>
                                            <td className="text-right px-4 py-3 font-display text-[14px] tabular-nums text-ant-ink">
                                                {fmtMAD(order.price || 0)} <span className="text-[11px] text-ant-mid">DH</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <ChevronRight className="w-3.5 h-3.5 text-ant-mid ml-auto" />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                </>
            )}

            {/* Detail / status update sheet */}
            <CourierOrderSheet
                row={selectedRow}
                onClose={() => setSelectedRow(null)}
                packageStatuses={packageStatuses}
                onSelectStatus={(status) => {
                    if (!selectedRow) return;
                    updateStatusMutation.mutate({ parcelId: selectedRow.parcel_id, status });
                }}
                isUpdating={updateStatusMutation.isPending}
            />

            {/* QR scanner */}
            <QrScanModal
                open={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onDecoded={handleScannedCode}
            />
        </div>
    );
};

export default CourierOrders;

// ── Detail / status sheet ──────────────────────────────────────────────────
function CourierOrderSheet({
    row,
    onClose,
    packageStatuses,
    onSelectStatus,
    isUpdating,
}: {
    row: CourierOrderRow | null;
    onClose: () => void;
    packageStatuses: PackageStatus[];
    onSelectStatus: (status: PackageStatus) => void;
    isUpdating: boolean;
}) {
    const isOpen = !!row;
    const [pickerOpen, setPickerOpen] = useState(false);
    const { resolve: resolvePkgStatus, resolveById } = usePackageStatusResolver();

    useEffect(() => {
        if (!isOpen) setPickerOpen(false);
    }, [isOpen]);

    if (!row) return null;

    const { order, parcel_status, parcel_tracking_code, note_reference } = row;
    // Always resolve to the master status; raw synthetic value only as fallback.
    const rps = resolveById(parcel_status?.id) ?? (parcel_status ? resolvePkgStatus(parcel_status.label, parcel_status.label, parcel_status.color) : null);
    const color = rps?.color || parcel_status?.color || '#b0aea5';
    const masterStatusLabel = rps?.label || parcel_status?.label || 'Non défini';
    const masterStatusIcon = rps?.icon ?? null;

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="
                    p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col
                    shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]
                    sm:max-w-[560px] sm:rounded-2xl sm:max-h-[90vh]
                    max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0
                    max-sm:!translate-x-0 max-sm:!translate-y-0
                    max-sm:!w-full max-sm:!max-w-none
                    max-sm:!h-[92dvh] max-sm:!max-h-[92dvh]
                    max-sm:!rounded-t-2xl max-sm:!rounded-b-none
                    [&>button.absolute]:hidden
                "
            >
                <div className="flex flex-col flex-1 min-h-0">
                    {/* Drag handle on mobile */}
                    <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                        <div className="h-1 w-10 rounded-full bg-ant-line" />
                    </div>

                    {/* Top orange stripe */}
                    <div className="h-[3px] w-full bg-ant-orange shrink-0" />

                    {/* Header */}
                    <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Colis · Aperçu
                                    </span>
                                </div>
                                <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink truncate">
                                    {order.name || 'Client'}
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    {order.phone || 'Pas de téléphone'} · {order.city?.name || 'Ville inconnue'}
                                </DialogDescription>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                aria-label="Fermer"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </DialogHeader>

                    {/* Scrollable body */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
                        {/* Status + amount ink card */}
                        <div className="rounded-2xl bg-ant-ink text-ant-light p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1 min-w-0">
                                    <span className="font-display text-[9px] uppercase tracking-[0.22em] text-ant-light/55">
                                        Montant
                                    </span>
                                    <p className="font-display text-[22px] tabular-nums leading-none">
                                        {fmtMAD(order.price || 0)} <span className="text-[12px] text-ant-light/60">DH</span>
                                    </p>
                                </div>
                                <span
                                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em]"
                                    style={{ backgroundColor: `${color}28`, color: '#faf9f5' }}
                                >
                                    {masterStatusIcon ? (
                                        <DynamicIcon name={masterStatusIcon} className="w-2.5 h-2.5 shrink-0" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                                    )}
                                    {masterStatusLabel}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPickerOpen((v) => !v)}
                                className="w-full h-10 rounded-full bg-ant-light/10 hover:bg-ant-light/15 flex items-center justify-center gap-2 text-[12px] font-medium text-ant-light transition-colors"
                            >
                                {pickerOpen ? 'Masquer les statuts' : 'Changer le statut'}
                                <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', pickerOpen && 'rotate-90')} />
                            </button>
                        </div>

                        {/* Status picker — expandable */}
                        {pickerOpen && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className="px-4 py-3 border-b border-ant-line">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[10px] text-ant-orange">01</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Nouveau statut
                                        </span>
                                    </div>
                                </div>
                                <div className="p-2 grid grid-cols-1 gap-1">
                                    {packageStatuses
                                        .filter((s) => s.label && s.show_in_courier)
                                        .map((s) => {
                                            const isCurrent = parcel_status?.id === s.id;
                                            const c = s.color || '#b0aea5';
                                            return (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    disabled={isUpdating || isCurrent}
                                                    onClick={() => onSelectStatus(s)}
                                                    className={cn(
                                                        'h-11 px-3 rounded-xl border flex items-center justify-between gap-3 text-left transition-all disabled:opacity-50',
                                                        isCurrent
                                                            ? 'border-ant-ink bg-ant-ink/5'
                                                            : 'border-ant-line bg-ant-paper hover:border-ant-ink/30 active:scale-[0.99]',
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        {s.icon
                                                            ? <DynamicIcon name={s.icon} className="w-3.5 h-3.5 shrink-0" style={{ color: c }} />
                                                            : <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />}
                                                        <span className="text-[12px] font-medium text-ant-ink truncate">
                                                            {s.label}
                                                        </span>
                                                        {s.recheck && (
                                                            <span className="shrink-0 inline-flex items-center px-1.5 h-[18px] rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/15 text-ant-orange">
                                                                Suivi
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isCurrent && (
                                                        <CheckCircle2 className="w-4 h-4 text-ant-ink shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                </div>
                            </section>
                        )}

                        {/* Info rows */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-ink" />
                            <div className="px-4 py-3 border-b border-ant-line">
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[10px] text-ant-orange">02</span>
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                        Détails
                                    </span>
                                </div>
                            </div>
                            <div className="p-4 space-y-3">
                                <InfoRow icon={MapPin} label="Adresse" value={order.address || '—'} multiline />
                                <InfoRow
                                    icon={Package}
                                    label="Articles"
                                    value={
                                        (order.items && order.items.length > 0)
                                            ? order.items
                                                .filter((i) => (i.quantity || 0) > 0)
                                                .map((i) => `${i.product?.code || i.product?.name || 'Item'} ×${i.quantity}`)
                                                .join(' · ') || '—'
                                            : '—'
                                    }
                                    multiline
                                />
                                <InfoRow icon={Truck} label="Tracking" value={parcel_tracking_code || '—'} mono />
                                <InfoRow icon={History} label="Bon de livraison" value={note_reference || '—'} mono />
                                {order.delivery_note && (
                                    <InfoRow icon={MessageCircle} label="Note pour le livreur" value={order.delivery_note} multiline />
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Sticky footer */}
                    <div className="shrink-0 border-t border-ant-line bg-ant-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2">
                        {order.phone && (
                            <a
                                href={`tel:${order.phone.replace(/\D/g, '')}`}
                                className="flex-1 h-11 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-light transition-colors"
                            >
                                <Phone className="w-3.5 h-3.5" />
                                Appeler
                            </a>
                        )}
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            disabled={isUpdating}
                            className="flex-1 h-11 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 active:scale-[0.98] transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                        >
                            {isUpdating ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Mise à jour…
                                </>
                            ) : (
                                'Changer le statut'
                            )}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function InfoRow({
    icon: Icon,
    label,
    value,
    mono,
    multiline,
}: {
    icon: typeof MapPin;
    label: string;
    value: string;
    mono?: boolean;
    multiline?: boolean;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-ant-light flex items-center justify-center text-ant-mid shrink-0">
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                    {label}
                </div>
                <div
                    className={cn(
                        'text-[12px] font-medium text-ant-ink break-words',
                        mono && 'font-mono',
                        !multiline && 'truncate',
                    )}
                >
                    {value}
                </div>
            </div>
        </div>
    );
}
