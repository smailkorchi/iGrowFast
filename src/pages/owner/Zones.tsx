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
    Calendar,
    Loader2,
    X,
    Building2,
    LayoutGrid,
    Table2,
    Pencil,
    Inbox,
    CheckCircle2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    DialogFooter,
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
    FormMessage
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';

import { format } from 'date-fns';

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

const Zones = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingZone, setEditingZone] = useState<ZoneRow | null>(null);
    const [selectedZoneCities, setSelectedZoneCities] = useState<ZoneRow | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
    const [filterCities, setFilterCities] = useState<string>('all');
    const [sortBy, setSortBy] = useState<'created' | 'name'>('created');
    const [visibleLimit, setVisibleLimit] = useState(150);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: userRole } = useQuery({
        queryKey: ['current-user-role'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
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

    // --- Queries ---
    const { data: zones, isLoading } = useQuery({
        queryKey: ['zones'],
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
                .insert({
                    name: values.name,
                })
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
        }
    });

    const updateZoneMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: ZoneFormValues }) => {
            const { data, error } = await supabase
                .from('zones')
                .update({
                    name: values.name,
                })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            setEditingZone(null);
            toast({ title: "Zone updated", description: "The zone has been successfully updated." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        }
    });

    const deleteZoneMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('zones')
                .delete()
                .eq('id', id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            toast({ title: "Zone deleted", description: "The zone has been successfully removed." });
        },
        onError: (error) => {
            toast({ title: "Error", description: errorMessage(error), variant: "destructive" });
        }
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
        [filteredZones, visibleLimit]
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
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col gap-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-2">Geographic Zones</h1>
                                <p className="text-gray-500 font-light">
                                    Manage delivery zones and regional territories.
                                </p>
                            </div>
                            {isOwner && (
                                <Button
                                    onClick={() => setIsAddModalOpen(true)}
                                    className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 flex items-center gap-2 shrink-0"
                                >
                                    <Plus className="w-5 h-5" />
                                    Add New Zone
                                </Button>
                            )}
                        </div>

                        {!isLoading && zones != null && (
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                Total zones
                                            </p>
                                            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                {zoneCatalogStats.totalZones}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">Hubs / territories</p>
                                        </div>
                                        <Map className="h-9 w-9 shrink-0 text-brand-navy/15" aria-hidden />
                                    </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                With cities
                                            </p>
                                            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                {zoneCatalogStats.withCities}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                At least one city assigned
                                            </p>
                                        </div>
                                        <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-600/25" aria-hidden />
                                    </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                Empty zones
                                            </p>
                                            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                {zoneCatalogStats.emptyZones}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">No cities linked yet</p>
                                        </div>
                                        <Inbox className="h-9 w-9 shrink-0 text-brand-navy/15" aria-hidden />
                                    </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                City assignments
                                            </p>
                                            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                {zoneCatalogStats.cityLinks}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                Sum of cities across hubs
                                            </p>
                                        </div>
                                        <MapPin className="h-9 w-9 shrink-0 text-brand-navy/15" aria-hidden />
                                    </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col xl:flex-row flex-wrap gap-3 items-stretch xl:items-center">
                            <div className="relative group flex-1 min-w-[200px] max-w-md">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search zone name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Select value={filterCities} onValueChange={setFilterCities}>
                                <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-white w-full sm:w-[200px] font-semibold">
                                    <SelectValue placeholder="Cities" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="all" className="font-semibold">
                                        All zones
                                    </SelectItem>
                                    <SelectItem value="with_cities" className="font-medium">
                                        Has cities
                                    </SelectItem>
                                    <SelectItem value="empty" className="font-medium">
                                        No cities
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'created' | 'name')}>
                                <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-white w-full sm:w-[200px] font-semibold">
                                    <SelectValue placeholder="Sort" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="created" className="font-medium">
                                        Newest first
                                    </SelectItem>
                                    <SelectItem value="name" className="font-medium">
                                        Name A–Z
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="flex rounded-2xl border border-gray-100 bg-white p-1 shrink-0">
                                <Button
                                    type="button"
                                    variant={viewMode === 'table' ? 'default' : 'ghost'}
                                    size="sm"
                                    className={cn(
                                        'rounded-xl h-10 px-4 gap-2 font-bold',
                                        viewMode === 'table' && 'shadow-sm'
                                    )}
                                    onClick={() => setViewMode('table')}
                                >
                                    <Table2 className="w-4 h-4" />
                                    Table
                                </Button>
                                <Button
                                    type="button"
                                    variant={viewMode === 'grid' ? 'default' : 'ghost'}
                                    size="sm"
                                    className={cn(
                                        'rounded-xl h-10 px-4 gap-2 font-bold',
                                        viewMode === 'grid' && 'shadow-sm'
                                    )}
                                    onClick={() => setViewMode('grid')}
                                >
                                    <LayoutGrid className="w-4 h-4" />
                                    Grid
                                </Button>
                            </div>
                        </div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                            Showing {visibleZones.length} of {filteredZones.length}
                            {zones != null && filteredZones.length !== zones.length
                                ? ` (${zones.length} total)`
                                : ''}
                        </p>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <div className="w-12 h-12 rounded-full border-4 border-brand-navy/10 border-t-brand-navy animate-spin" />
                    <p className="text-muted-foreground font-bold animate-pulse">Loading zones...</p>
                </div>
            ) : filteredZones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-20 h-20 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <MapPin className="w-10 h-10 text-brand-navy/20" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-brand-navy">No zones match</h3>
                        <p className="text-muted-foreground">Adjust filters or add a zone</p>
                    </div>
                </div>
            ) : viewMode === 'table' ? (
                <Card className="border-none shadow-sm rounded-[32px] overflow-hidden bg-white min-w-0">
                    <CardContent className="p-0 min-w-0">
                        <div className="max-h-[min(70vh,720px)] overflow-y-auto overflow-x-auto overscroll-x-contain">
                            <table className="w-full min-w-[640px] table-fixed caption-bottom text-sm border-collapse">
                                <colgroup>
                                    {isOwner && <col style={{ width: 76 }} />}
                                    <col />
                                    <col style={{ width: '22%' }} />
                                    <col style={{ width: '26%' }} />
                                </colgroup>
                                <thead>
                                    <tr className="border-b border-white/15 bg-brand-navy">
                                        {isOwner && (
                                            <th
                                                scope="col"
                                                className="sticky top-0 left-0 z-30 h-12 w-[76px] min-w-[76px] max-w-[76px] whitespace-nowrap px-0 py-2 text-center align-bottom font-bold text-[9px] uppercase leading-tight tracking-wide text-brand-white bg-brand-navy shadow-[4px_0_12px_-4px_rgba(0,0,0,0.25)] border-r border-white/15"
                                            >
                                                Actions
                                            </th>
                                        )}
                                        <th
                                            scope="col"
                                            className={cn(
                                                'sticky top-0 z-20 h-12 px-3 py-2 text-left align-bottom font-bold text-brand-white bg-brand-navy',
                                                isOwner && 'shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]'
                                            )}
                                        >
                                            Zone
                                        </th>
                                        <th
                                            scope="col"
                                            className="sticky top-0 z-20 h-12 px-3 py-2 text-left align-bottom font-bold text-brand-white bg-brand-navy"
                                        >
                                            Cities
                                        </th>
                                        <th
                                            scope="col"
                                            className="sticky top-0 z-20 h-12 px-3 py-2 text-left align-bottom font-bold text-brand-white bg-brand-navy"
                                        >
                                            Created
                                        </th>
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
                                                className="group cursor-pointer border-b border-brand-navy/[0.04] transition-colors hover:bg-brand-navy/[0.025]"
                                            >
                                                {isOwner && (
                                                    <td
                                                        className="sticky left-0 z-10 w-[76px] min-w-[76px] max-w-[76px] whitespace-nowrap align-middle p-0 bg-white group-hover:bg-brand-navy/[0.03] border-r border-brand-navy/[0.05] shadow-[4px_0_12px_-6px_rgba(0,0,0,0.08)]"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <div className="flex h-full flex-row items-center justify-center gap-px">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                type="button"
                                                                onClick={() => setEditingZone(zone)}
                                                                className="h-8 w-[34px] min-w-[34px] shrink-0 px-0 text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/10 rounded-md"
                                                                title="Edit"
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                type="button"
                                                                onClick={() => {
                                                                    if (
                                                                        confirm(
                                                                            'Are you sure you want to delete this zone?'
                                                                        )
                                                                    ) {
                                                                        deleteZoneMutation.mutate(zone.id);
                                                                    }
                                                                }}
                                                                className="h-8 w-[34px] min-w-[34px] shrink-0 px-0 text-brand-navy/40 hover:text-red-600 hover:bg-red-50 rounded-md"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="align-middle px-3 py-2 min-w-0">
                                                    <span className="font-bold text-brand-navy text-sm leading-snug line-clamp-2 break-words">
                                                        {zone.name}
                                                    </span>
                                                </td>
                                                <td className="align-middle px-3 py-2 min-w-0">
                                                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy/[0.04] px-2 py-1 text-[11px] font-bold text-brand-navy/70">
                                                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                                                        <span>{n}</span>
                                                    </div>
                                                </td>
                                                <td className="align-middle px-3 py-2 min-w-0 text-xs font-medium text-brand-navy/60">
                                                    {zone.created_at
                                                        ? format(new Date(zone.created_at), 'MMM d, yyyy')
                                                        : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {hasMore && (
                            <div className="flex justify-center border-t border-brand-navy/[0.06] bg-brand-navy/[0.02] p-4">
                                <Button
                                    variant="outline"
                                    className="rounded-xl font-bold"
                                    onClick={() => setVisibleLimit((x) => x + 200)}
                                >
                                    Load more ({hiddenCount} left)
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleZones.map((zone) => (
                            <ZoneCard
                                key={zone.id}
                                zone={zone}
                                isOwner={isOwner}
                                onClick={() => setSelectedZoneCities(zone)}
                                onEdit={() => setEditingZone(zone)}
                                onDelete={() => {
                                    if (confirm('Are you sure you want to delete this zone?')) {
                                        deleteZoneMutation.mutate(zone.id);
                                    }
                                }}
                            />
                        ))}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <Button
                                variant="outline"
                                className="rounded-xl font-bold"
                                onClick={() => setVisibleLimit((x) => x + 200)}
                            >
                                Load more ({hiddenCount} left)
                            </Button>
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
                title="Create New Zone"
            />

            {editingZone && (
                <ZoneModal
                    isOpen={!!editingZone}
                    onClose={() => setEditingZone(null)}
                    onSubmit={(values) => editingZone && updateZoneMutation.mutate({ id: editingZone.id, values })}
                    initialData={editingZone}
                    loading={updateZoneMutation.isPending}
                    title="Edit Zone"
                />
            )}
        </div>
    );
};

const ZoneCard = ({ zone, isOwner, onClick, onEdit, onDelete }: { zone: ZoneRow, isOwner: boolean, onClick: () => void, onEdit: () => void, onDelete: () => void }) => {
    return (
        <Card
            onClick={onClick}
            className="group relative cursor-pointer overflow-hidden border border-brand-white/10 bg-white/50 backdrop-blur-sm hover:shadow-2xl hover:shadow-brand-navy/5 transition-all duration-300 rounded-[32px] p-6 hover:-translate-y-1"
        >
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy group-hover:bg-brand-navy group-hover:text-brand-white transition-all duration-500">
                    <Map className="w-6 h-6" />
                </div>
                {isOwner && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" className="h-10 w-10 rounded-full p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreVertical className="h-5 w-5 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-xl">
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer">
                                <Edit2 className="w-4 h-4 mr-3" />
                                Edit Zone
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-brand-red hover:bg-brand-red/5">
                                <Trash2 className="w-4 h-4 mr-3" />
                                Delete Zone
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            <div className="space-y-2">
                <h3 className="text-xl font-bold text-brand-navy group-hover:translate-x-1 transition-transform duration-300">
                    {zone.name}
                </h3>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">
                        Added {zone.created_at ? format(new Date(zone.created_at), 'MMM dd, yyyy') : 'N/A'}
                    </span>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-navy/[0.04] text-brand-navy border border-brand-navy/[0.06]">
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold leading-none">{zone.master_cities?.length || 0} Cities</span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40 group-hover:text-brand-navy transition-colors">
                    Territory
                </div>
            </div>
        </Card>
    );
};

type ZoneModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: ZoneFormValues) => void;
    initialData?: ZoneRow | null;
    loading?: boolean;
    title: string;
};

const ZoneModal = ({ isOpen, onClose, onSubmit, initialData, loading, title }: ZoneModalProps) => {
    const form = useForm<ZoneFormValues>({
        resolver: zodResolver(zoneSchema),
        defaultValues: {
            name: '',
        }
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({ name: initialData.name });
            } else {
                form.reset({ name: '' });
            }
        }
    }, [initialData, form, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="p-8 pb-4">
                            <DialogTitle className="text-2xl font-bold text-brand-navy">{title}</DialogTitle>
                            <DialogDescription className="text-muted-foreground mt-1">
                                Define geographical boundaries for this zone.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="p-8 pt-0 space-y-6">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Zone Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="E.g. Northern Region" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DialogFooter className="p-8 pt-0">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="rounded-xl h-12 px-6 font-bold hover:bg-muted"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/20 transition-all active:scale-95"
                            >
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {initialData ? 'Save Changes' : 'Create Zone'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

const ZoneCitiesModal = ({ zone, isOpen, onClose, isOwner }: { zone: ZoneRow, isOpen: boolean, onClose: () => void, isOwner: boolean }) => {
    const [citySearch, setCitySearch] = useState("");
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: cities, isLoading } = useQuery({
        queryKey: ['cities-all'],
        queryFn: () => fetchAllRows<{ id: string; name: string; zone_id: string | null }>('master_cities', '*', { orderBy: 'name' }),
        enabled: isOpen
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
            toast({ title: "Updated", description: "City association updated successfully." });
        }
    });

    const currentZoneCities = cities?.filter(c => c.zone_id === zone?.id) || [];
    const availableCities = cities?.filter(c => c.zone_id === null) || [];

    const filteredCurrent = currentZoneCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));
    const filteredAvailable = availableCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="p-8 pb-4 shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-brand-navy flex items-center justify-center text-brand-white shadow-lg shadow-brand-navy/20">
                            <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-bold text-brand-navy">{zone?.name}</DialogTitle>
                            <DialogDescription>Manage cities covered by this hub</DialogDescription>
                        </div>
                    </div>
                    <div className="relative mt-4">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search cities..."
                            value={citySearch}
                            onChange={(e) => setCitySearch(e.target.value)}
                            className="pl-11 h-12 bg-brand-navy/[0.04] border-none rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                </DialogHeader>

                <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1">
                    {/* Current Cities */}
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 px-2">
                            Assigned to this zone ({currentZoneCities.length})
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredCurrent.length > 0 ? filteredCurrent.map(city => (
                                <div key={city.id} className="group/item flex items-center justify-between p-4 rounded-2xl bg-brand-navy/[0.03] border border-transparent hover:border-brand-navy/10 transition-all">
                                    <span className="font-bold text-brand-navy">{city.name}</span>
                                    {isOwner && (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: null })}
                                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground px-2 pt-2 italic">No cities assigned yet.</p>
                            )}
                        </div>
                    </div>

                    {/* Available Cities */}
                    <div className="space-y-4 pt-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 px-2">
                            Available Cities (Unassigned)
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredAvailable.length > 0 ? filteredAvailable.map(city => (
                                <div key={city.id} className="group/item flex items-center justify-between p-4 rounded-2xl bg-brand-white border border-brand-navy/[0.06] hover:border-brand-navy/20 transition-all">
                                    <span className="font-bold text-brand-navy/70">{city.name}</span>
                                    {isOwner && (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: zone.id })}
                                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-green-600 hover:bg-green-50"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground px-2 pt-2 italic">No unassigned cities available.</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-8 pb-10 border-t border-brand-navy/[0.04] shrink-0 bg-brand-white">
                    <Button onClick={onClose} variant="ghost" className="w-full h-12 rounded-2xl font-bold bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy transition-all">
                        Close Management
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Zones;
