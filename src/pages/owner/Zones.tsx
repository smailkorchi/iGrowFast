import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Plus,
    Search,
    Map,
    MoreVertical,
    Edit2,
    Trash2,
    MapPin,
    Loader2,
    X,
    Building2,
    LayoutGrid,
    Table2,
    Pencil,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const zoneSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
});

type ZoneFormValues = z.infer<typeof zoneSchema>;

type ZoneRow = {
    id: string;
    name: string;
    created_at?: string | null;
    master_cities?: { id: string }[] | null;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

function zoneCityCount(zone: ZoneRow): number {
    return zone.master_cities?.length ?? 0;
}

const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

const Zones = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingZone, setEditingZone] = useState<ZoneRow | null>(null);
    const [selectedZoneCities, setSelectedZoneCities] = useState<ZoneRow | null>(null);
    const [zoneToDelete, setZoneToDelete] = useState<ZoneRow | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
    const [filterCities, setFilterCities] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'created' | 'name'>('created');
    const [visibleLimit, setVisibleLimit] = useState(150);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: userRole } = useQuery({
        queryKey: ['current-user-role'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return null;
            const { data, error } = await supabase
                .from('users')
                .select('role')
                .eq('id', user.id)
                .single();
            if (error) throw error;
            return data?.role ?? null;
        },
    });
    const isOwner = userRole === 'owner';

    const { data: zones, isLoading } = useQuery({
        queryKey: ['zones'],
        staleTime: 60_000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('zones')
                .select('*, master_cities(id)')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const addZoneMutation = useMutation({
        mutationFn: async (values: ZoneFormValues) => {
            const { data, error } = await supabase
                .from('zones')
                .insert({ name: values.name })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            setIsAddModalOpen(false);
            toast({ title: "Zone created", description: "The zone has been successfully created." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        },
    });

    const updateZoneMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: ZoneFormValues }) => {
            const { data, error } = await supabase
                .from('zones')
                .update({ name: values.name })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            setEditingZone(null);
            toast({ title: "Zone updated", description: "Saved successfully." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        },
    });

    const deleteZoneMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('zones').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            toast({ title: "Zone deleted", description: "Removed from the catalog." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        },
    });

    useEffect(() => {
        setVisibleLimit(150);
    }, [searchQuery, filterCities, sortBy]);

    const filteredZones = useMemo(() => {
        let list = (zones ?? []) as ZoneRow[];
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((z) => z.name.toLowerCase().includes(q));
        }
        if (filterCities === 'with_cities') {
            list = list.filter((z) => zoneCityCount(z) > 0);
        } else if (filterCities === 'empty') {
            list = list.filter((z) => zoneCityCount(z) === 0);
        }
        const sorted = [...list];
        if (sortBy === 'name') {
            sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        } else {
            sorted.sort((a, b) => {
                const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
                const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
                return tb - ta;
            });
        }
        return sorted;
    }, [zones, searchQuery, filterCities, sortBy]);

    const visibleZones = useMemo(
        () => filteredZones.slice(0, visibleLimit),
        [filteredZones, visibleLimit],
    );
    const hiddenCount = Math.max(0, filteredZones.length - visibleZones.length);
    const hasMore = hiddenCount > 0;

    const zoneCatalogStats = useMemo(() => {
        const list = (zones ?? []) as ZoneRow[];
        let withCities = 0;
        let cityLinks = 0;
        for (const z of list) {
            const n = zoneCityCount(z);
            cityLinks += n;
            if (n > 0) withCities++;
        }
        const totalZones = list.length;
        return {
            totalZones,
            withCities,
            emptyZones: totalZones - withCities,
            cityLinks,
        };
    }, [zones]);

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Geographic zones
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Geographic zones
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Regional territories that group cities into delivery hubs.
                        </p>
                    </div>
                    {isOwner && (
                        <button
                            type="button"
                            onClick={() => setIsAddModalOpen(true)}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)] self-start lg:self-auto"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add zone
                        </button>
                    )}
                </div>
            </header>

            {/* KPI hairline strip */}
            {!isLoading && zones != null && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <KpiTile label="Total zones" value={zoneCatalogStats.totalZones} accent="bg-ant-ink" />
                    <KpiTile label="With cities" value={zoneCatalogStats.withCities} accent="bg-ant-green" />
                    <KpiTile label="Empty zones" value={zoneCatalogStats.emptyZones} accent="bg-ant-orange" />
                    <KpiTile label="City links" value={zoneCatalogStats.cityLinks} accent="bg-ant-ink" />
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                    <input
                        type="search"
                        placeholder="Search zone…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full sm:w-56 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <Select value={filterCities} onValueChange={setFilterCities}>
                    <SelectTrigger className="h-10 rounded-full border-ant-line bg-ant-paper text-[12px] px-4 w-[140px]">
                        <SelectValue placeholder="Cities" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                        <SelectItem value="all" className="text-[12px]">All zones</SelectItem>
                        <SelectItem value="with_cities" className="text-[12px]">Has cities</SelectItem>
                        <SelectItem value="empty" className="text-[12px]">No cities</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'created' | 'name')}>
                    <SelectTrigger className="h-10 rounded-full border-ant-line bg-ant-paper text-[12px] px-4 w-[140px]">
                        <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                        <SelectItem value="created" className="text-[12px]">Newest first</SelectItem>
                        <SelectItem value="name" className="text-[12px]">Name A–Z</SelectItem>
                    </SelectContent>
                </Select>
                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper ml-auto">
                    <button
                        type="button"
                        onClick={() => setViewMode('table')}
                        className={cn(
                            'h-8 px-3 rounded-full flex items-center gap-1 text-[11px] font-medium transition-all',
                            viewMode === 'table' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                        )}
                    >
                        <Table2 className="w-3 h-3" /> Table
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode('grid')}
                        className={cn(
                            'h-8 px-3 rounded-full flex items-center gap-1 text-[11px] font-medium transition-all',
                            viewMode === 'grid' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                        )}
                    >
                        <LayoutGrid className="w-3 h-3" /> Grid
                    </button>
                </div>
                <span className="font-serif italic text-[11px] text-ant-mid tabular-nums">
                    {visibleZones.length} / {filteredZones.length}
                </span>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
                </div>
            ) : filteredZones.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <MapPin className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No zones match</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Adjust your search or filters to see more results.
                        </p>
                    </div>
                </section>
            ) : viewMode === 'table' ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/60">
                                    {isOwner && (
                                        <th className="px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid w-24 text-center">
                                            Actions
                                        </th>
                                    )}
                                    <th className="px-4 py-2.5 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Zone</th>
                                    <th className="px-3 py-2.5 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Cities</th>
                                    <th className="px-3 py-2.5 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid hidden sm:table-cell">Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleZones.map((zone) => {
                                    const n = zoneCityCount(zone);
                                    return (
                                        <tr
                                            key={zone.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedZoneCities(zone)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    setSelectedZoneCities(zone);
                                                }
                                            }}
                                            className="border-b border-ant-line last:border-b-0 cursor-pointer hover:bg-ant-light/40 transition-colors"
                                        >
                                            {isOwner && (
                                                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center gap-1 justify-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingZone(zone)}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setZoneToDelete(zone)}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <Map className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                                    <span className="font-display text-[13px] text-ant-ink">{zone.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em]',
                                                    n > 0 ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid',
                                                )}>
                                                    <Building2 className="w-2.5 h-2.5" />
                                                    {n} {n === 1 ? 'city' : 'cities'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-[11px] text-ant-mid tabular-nums hidden sm:table-cell">
                                                {zone.created_at ? format(new Date(zone.created_at), 'dd MMM yyyy', { locale: fr }) : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {hasMore && (
                        <div className="flex justify-center border-t border-ant-line p-3">
                            <button
                                type="button"
                                onClick={() => setVisibleLimit((x) => x + 200)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                            >
                                Load more <span className="tabular-nums">({hiddenCount})</span>
                            </button>
                        </div>
                    )}
                </section>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleZones.map((zone) => (
                            <ZoneCard
                                key={zone.id}
                                zone={zone}
                                isOwner={isOwner}
                                onClick={() => setSelectedZoneCities(zone)}
                                onEdit={() => setEditingZone(zone)}
                                onDelete={() => setZoneToDelete(zone)}
                            />
                        ))}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <button
                                type="button"
                                onClick={() => setVisibleLimit((x) => x + 200)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                            >
                                Load more <span className="tabular-nums">({hiddenCount})</span>
                            </button>
                        </div>
                    )}
                </>
            )}

            <ZoneCitiesModal
                zone={selectedZoneCities}
                isOpen={!!selectedZoneCities}
                onClose={() => setSelectedZoneCities(null)}
                isOwner={isOwner}
            />

            <ZoneModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={(values) => addZoneMutation.mutate(values)}
                loading={addZoneMutation.isPending}
                kicker="Zone · New"
                title="Create zone"
            />

            {editingZone && (
                <ZoneModal
                    isOpen={!!editingZone}
                    onClose={() => setEditingZone(null)}
                    onSubmit={(values) => editingZone && updateZoneMutation.mutate({ id: editingZone.id, values })}
                    initialData={editingZone}
                    loading={updateZoneMutation.isPending}
                    kicker="Zone · Edit"
                    title="Edit zone"
                />
            )}

            <ConfirmDialog
                open={!!zoneToDelete}
                onOpenChange={(o) => { if (!o) setZoneToDelete(null); }}
                kicker="Zone · Suppression"
                title="Supprimer cette zone ?"
                description={zoneToDelete
                    ? `La zone « ${zoneToDelete.name} » sera retirée. Les villes qui lui sont rattachées seront détachées.`
                    : undefined}
                confirmLabel="Supprimer la zone"
                loading={deleteZoneMutation.isPending}
                onConfirm={() => {
                    if (!zoneToDelete) return;
                    deleteZoneMutation.mutate(zoneToDelete.id, {
                        onSettled: () => setZoneToDelete(null),
                    });
                }}
            />
        </div>
    );
};

const KpiTile = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
            {value.toLocaleString('fr-MA')}
        </p>
    </div>
);

const ZoneCard = ({ zone, isOwner, onClick, onEdit, onDelete }: {
    zone: ZoneRow;
    isOwner: boolean;
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) => {
    const n = zoneCityCount(zone);
    return (
        <div
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
            className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden cursor-pointer hover:border-ant-ink/25 transition-colors"
        >
            <div className={cn('h-[3px] w-full', n > 0 ? 'bg-ant-green' : 'bg-ant-orange')} />
            <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center text-ant-ink shrink-0">
                            <Map className="w-4 h-4" />
                        </div>
                        <span className="font-display text-[14px] text-ant-ink leading-tight truncate">{zone.name}</span>
                    </div>
                    {isOwner && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-light transition-colors shrink-0"
                                >
                                    <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[140px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                                <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                                    <Edit2 className="w-3.5 h-3.5" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-ant-line" />
                                <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                    <Trash2 className="w-3.5 h-3.5" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                <div className="pt-3 border-t border-ant-line flex items-center justify-between">
                    <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em]',
                        n > 0 ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid',
                    )}>
                        <Building2 className="w-3 h-3" />
                        {n} {n === 1 ? 'city' : 'cities'}
                    </span>
                    <span className="font-serif italic text-[10px] text-ant-mid tabular-nums">
                        {zone.created_at ? format(new Date(zone.created_at), 'dd MMM yyyy', { locale: fr }) : '—'}
                    </span>
                </div>
            </div>
        </div>
    );
};

type ZoneModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: ZoneFormValues) => void;
    initialData?: ZoneRow | null;
    loading?: boolean;
    kicker: string;
    title: string;
};

const ZoneModal = ({ isOpen, onClose, onSubmit, initialData, loading, kicker, title }: ZoneModalProps) => {
    const form = useForm<ZoneFormValues>({
        resolver: zodResolver(zoneSchema),
        defaultValues: { name: '' },
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) form.reset({ name: initialData.name });
            else form.reset({ name: '' });
        }
    }, [initialData, form, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                'sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none',
                'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                '[&>button.absolute]:hidden',
            )}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <DialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            {kicker}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        {title}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        A zone groups multiple cities into a single delivery territory.
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </DialogHeader>

                        <div className="px-5 py-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Zone name</FormLabel>
                                        <FormControl>
                                            <input placeholder="E.g. Northern Region" {...field} className={inputClass} />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {initialData ? 'Save changes' : 'Create zone'}
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

const ZoneCitiesModal = ({ zone, isOpen, onClose, isOwner }: {
    zone: ZoneRow | null;
    isOpen: boolean;
    onClose: () => void;
    isOwner: boolean;
}) => {
    const [citySearch, setCitySearch] = useState("");
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: cities } = useQuery({
        queryKey: ['cities-all'],
        staleTime: 5 * 60_000,
        queryFn: () => fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', 'id, name, zone_id', { orderBy: 'name' }),
        enabled: isOpen,
    });

    const updateCityZoneMutation = useMutation({
        mutationFn: async ({ cityId, zoneId }: { cityId: string, zoneId: string | null }) => {
            const { error } = await supabase
                .from('master_cities')
                .update({ zone_id: zoneId })
                .eq('id', cityId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['cities-all'] });
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            toast({ title: "Updated", description: "City association updated." });
        },
    });

    const currentZoneCities = cities?.filter(c => c.zone_id === zone?.id) || [];
    const availableCities = cities?.filter(c => c.zone_id === null) || [];

    const filteredCurrent = currentZoneCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));
    const filteredAvailable = availableCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'max-w-lg p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                'sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none',
                'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                '[&>button.absolute]:hidden',
            )}>
                <div className="h-[3px] w-full bg-ant-ink shrink-0" />
                <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-2">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1.5 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Zone · Cities
                                </span>
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                {zone?.name || '—'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                Attach cities to this zone or detach them.
                            </DialogDescription>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <input
                            type="search"
                            placeholder="Search cities…"
                            value={citySearch}
                            onChange={(e) => setCitySearch(e.target.value)}
                            className="w-full h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                        />
                        {citySearch && (
                            <button
                                type="button"
                                onClick={() => setCitySearch('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-display text-[10px] text-ant-orange">01</span>
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Assigned
                                </span>
                            </div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-green/12 text-ant-green">
                                <Building2 className="w-2.5 h-2.5" />
                                {currentZoneCities.length}
                            </span>
                        </div>
                        <div className="p-2 space-y-1">
                            {filteredCurrent.length > 0 ? filteredCurrent.map(city => (
                                <div key={city.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-ant-light border border-ant-line">
                                    <span className="text-[12px] font-medium text-ant-ink truncate">{city.name}</span>
                                    {isOwner && (
                                        <button
                                            type="button"
                                            onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: null })}
                                            className="w-7 h-7 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            )) : (
                                <p className="font-serif italic text-[11px] text-ant-mid text-center py-3">
                                    No cities assigned yet.
                                </p>
                            )}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-display text-[10px] text-ant-orange">02</span>
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Unassigned
                                </span>
                            </div>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                <Building2 className="w-2.5 h-2.5" />
                                {availableCities.length}
                            </span>
                        </div>
                        <div className="p-2 space-y-1">
                            {filteredAvailable.length > 0 ? filteredAvailable.map(city => (
                                <div key={city.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-ant-paper border border-ant-line">
                                    <span className="text-[12px] text-ant-ink truncate">{city.name}</span>
                                    {isOwner && zone && (
                                        <button
                                            type="button"
                                            onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: zone.id })}
                                            className="w-7 h-7 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-green/10 hover:text-ant-green hover:border-ant-green/30 transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            )) : (
                                <p className="font-serif italic text-[11px] text-ant-mid text-center py-3">
                                    No unassigned cities available.
                                </p>
                            )}
                        </div>
                    </section>
                </div>

                <div className="px-5 py-3 border-t border-ant-line shrink-0 flex justify-end pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                    >
                        Close
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Zones;
