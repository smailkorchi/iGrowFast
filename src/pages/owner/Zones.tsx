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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Geographic Zones</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Delivery zones and regional territories</p>
                    </div>
                    {isOwner && (
                        <Button
                            onClick={() => setIsAddModalOpen(true)}
                            className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5 px-3"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add Zone
                        </Button>
                    )}
                </div>
            </header>

            {/* KPI Strip */}
            {!isLoading && zones != null && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                        { label: 'Total zones', value: zoneCatalogStats.totalZones, accent: '#3b5e5e' },
                        { label: 'With cities', value: zoneCatalogStats.withCities, accent: '#059669' },
                        { label: 'Empty zones', value: zoneCatalogStats.emptyZones, accent: '#d97706' },
                        { label: 'City links', value: zoneCatalogStats.cityLinks, accent: '#3b5e5e' },
                    ].map((kpi) => (
                        <div key={kpi.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: kpi.accent }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{kpi.label}</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{kpi.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <Input
                        placeholder="Search zone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-44"
                    />
                </div>
                <Select value={filterCities} onValueChange={setFilterCities}>
                    <SelectTrigger className="h-8 rounded-md border-gray-200 bg-white text-[11px] w-[130px]">
                        <SelectValue placeholder="Cities" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-[11px]">All zones</SelectItem>
                        <SelectItem value="with_cities" className="text-[11px]">Has cities</SelectItem>
                        <SelectItem value="empty" className="text-[11px]">No cities</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'created' | 'name')}>
                    <SelectTrigger className="h-8 rounded-md border-gray-200 bg-white text-[11px] w-[120px]">
                        <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="created" className="text-[11px]">Newest first</SelectItem>
                        <SelectItem value="name" className="text-[11px]">Name A–Z</SelectItem>
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-md ml-auto">
                    <button
                        onClick={() => setViewMode('table')}
                        className={cn("h-7 px-2.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all", viewMode === 'table' ? "bg-white text-brand-navy shadow-sm" : "text-gray-500 hover:text-gray-700")}
                    >
                        <Table2 className="w-3 h-3" /> Table
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        className={cn("h-7 px-2.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all", viewMode === 'grid' ? "bg-white text-brand-navy shadow-sm" : "text-gray-500 hover:text-gray-700")}
                    >
                        <LayoutGrid className="w-3 h-3" /> Grid
                    </button>
                </div>
                <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em]">
                    {visibleZones.length} / {filteredZones.length}
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
            ) : filteredZones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 bg-white">
                    <MapPin className="w-6 h-6 text-gray-300 mb-2" />
                    <p className="text-[11px] font-medium text-gray-500">No zones match</p>
                </div>
            ) : viewMode === 'table' ? (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    {isOwner && <th className="px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold w-20">Actions</th>}
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Zone</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Cities</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold hidden sm:table-cell">Created</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
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
                                            className="cursor-pointer hover:bg-gray-50/50 transition-colors"
                                        >
                                            {isOwner && (
                                                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center gap-0.5 justify-center">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            type="button"
                                                            onClick={() => setEditingZone(zone)}
                                                            className="h-7 w-7 p-0 rounded text-gray-400 hover:text-brand-navy hover:bg-gray-100"
                                                        >
                                                            <Pencil className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            type="button"
                                                            onClick={() => setZoneToDelete(zone)}
                                                            className="h-7 w-7 p-0 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-3 py-2">
                                                <span className="text-[11px] font-semibold text-brand-navy">{zone.name}</span>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-navy/70 tabular-nums">
                                                    <Building2 className="h-3 w-3 shrink-0" />
                                                    {n}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/60 tabular-nums hidden sm:table-cell">
                                                {zone.created_at ? format(new Date(zone.created_at), 'MMM d, yyyy') : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {hasMore && (
                        <div className="flex justify-center border-t border-gray-100 p-3">
                            <Button variant="outline" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => setVisibleLimit((x) => x + 200)}>
                                Load more ({hiddenCount} left)
                            </Button>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                            <Button variant="outline" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => setVisibleLimit((x) => x + 200)}>
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

const ZoneCard = ({ zone, isOwner, onClick, onEdit, onDelete }: { zone: ZoneRow, isOwner: boolean, onClick: () => void, onEdit: () => void, onDelete: () => void }) => {
    return (
        <div
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
            className="rounded-xl border border-gray-100 bg-white p-3.5 cursor-pointer hover:bg-gray-50/50 transition-colors"
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Map className="w-4 h-4 text-brand-navy/40 shrink-0" />
                    <span className="text-[12px] font-semibold text-brand-navy leading-tight">{zone.name}</span>
                </div>
                {isOwner && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" className="h-7 w-7 p-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-lg border border-gray-200 shadow-md p-1 min-w-[120px]">
                            <DropdownMenuItem onClick={onEdit} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                                <Edit2 className="w-3 h-3" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="w-3 h-3" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-navy/60 tabular-nums">
                    <Building2 className="w-3 h-3" />
                    {zone.master_cities?.length || 0} cities
                </span>
                <span className="text-[10px] text-gray-400">
                    {zone.created_at ? format(new Date(zone.created_at), 'MMM d, yyyy') : '—'}
                </span>
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
            <DialogContent className="max-w-sm p-0 border border-gray-100 bg-white rounded-xl shadow-md overflow-hidden gap-0">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100">
                            <DialogTitle className="text-[14px] font-semibold text-brand-navy">{title}</DialogTitle>
                        </DialogHeader>

                        <div className="px-5 py-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Zone Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="E.g. Northern Region" {...field} className="h-9 rounded-md border-gray-200 text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <DialogFooter className="px-5 py-3 border-t border-gray-100 gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} className="h-8 px-3 text-[11px] font-semibold text-gray-500">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="h-8 px-4 text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md gap-1.5">
                                {loading && <Loader2 className="w-3 h-3 animate-spin" />}
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
            <DialogContent className="max-w-lg p-0 border border-gray-100 bg-white rounded-xl shadow-md overflow-hidden flex flex-col max-h-[90vh] gap-0">
                <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
                    <DialogTitle className="text-[14px] font-semibold text-brand-navy">{zone?.name}</DialogTitle>
                    <div className="relative mt-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <Input
                            placeholder="Search cities..."
                            value={citySearch}
                            onChange={(e) => setCitySearch(e.target.value)}
                            className="pl-7 h-8 rounded-md border-gray-200 text-[11px]"
                        />
                    </div>
                </DialogHeader>

                <div className="overflow-y-auto p-4 space-y-4 flex-1">
                    <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">
                            Assigned ({currentZoneCities.length})
                        </p>
                        <div className="space-y-1">
                            {filteredCurrent.length > 0 ? filteredCurrent.map(city => (
                                <div key={city.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                                    <span className="text-[11px] font-semibold text-brand-navy">{city.name}</span>
                                    {isOwner && (
                                        <Button size="icon" variant="ghost" onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: null })} className="h-6 w-6 p-0 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                                            <X className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                            )) : (
                                <p className="text-[11px] text-gray-400 px-1 py-2">No cities assigned yet.</p>
                            )}
                        </div>
                    </div>

                    <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">
                            Unassigned
                        </p>
                        <div className="space-y-1">
                            {filteredAvailable.length > 0 ? filteredAvailable.map(city => (
                                <div key={city.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-gray-100 bg-white">
                                    <span className="text-[11px] font-medium text-brand-navy/70">{city.name}</span>
                                    {isOwner && (
                                        <Button size="icon" variant="ghost" onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: zone.id })} className="h-6 w-6 p-0 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50">
                                            <Plus className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                            )) : (
                                <p className="text-[11px] text-gray-400 px-1 py-2">No unassigned cities available.</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end">
                    <Button onClick={onClose} variant="ghost" className="h-8 px-3 text-[11px] font-semibold text-gray-500">
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Zones;
