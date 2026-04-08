import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MapPin,
    Trash2,
    Loader2,
    Pencil,
    LayoutGrid,
    Table2,
    Building2,
    CheckCircle2,
    AlertCircle,
} from 'lucide-react';
import {
    Card,
    CardContent
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const PROVIDER_ORDER = ['ameex', 'coliaty', 'ozon'] as const;
type ProviderKey = (typeof PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<ProviderKey, string> = {
    ameex: 'AMEEX',
    coliaty: 'Coliaty',
    ozon: 'Ozon',
};

type MasterCityRow = {
    id: string;
    name: string;
    zone_id: string | null;
    zones?: { name: string } | null;
    provider_cities?: {
        provider_type: string;
        provider_city_id: string | null;
        provider_city_name: string | null;
    }[] | null;
};

const citySchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    zone_id: z.string().uuid("Please select a valid zone"),
    /** AMEEX API `city` (stored as provider_cities.provider_city_id) */
    ameex_city_code: z.string().optional().nullable(),
    /** Coliaty `package_city` — must match their city label exactly */
    coliaty_city_name: z.string().optional().nullable(),
    /** Ozon `parcel-city` (their internal city id) */
    ozon_city_id: z.string().optional().nullable(),
});

type CityFormValues = z.infer<typeof citySchema>;

const emptyCityForm: CityFormValues = {
    name: '',
    zone_id: '',
    ameex_city_code: '',
    coliaty_city_name: '',
    ozon_city_id: '',
};

function cityToFormDefaults(city: MasterCityRow | null): CityFormValues {
    if (!city) return { ...emptyCityForm };
    const by = (t: string) =>
        city.provider_cities?.find((p) => String(p.provider_type || '').toLowerCase() === t);
    const am = by('ameex');
    const co = by('coliaty');
    const oz = by('ozon');
    return {
        name: city.name,
        zone_id: city.zone_id || '',
        ameex_city_code: (am?.provider_city_id || am?.provider_city_name || '').trim() || '',
        coliaty_city_name: (co?.provider_city_name || '').trim() || '',
        ozon_city_id: (oz?.provider_city_id || '').trim() || '',
    };
}

function buildProviderMap(city: MasterCityRow): Record<ProviderKey, string | null> {
    const out: Record<ProviderKey, string | null> = {
        ameex: null,
        coliaty: null,
        ozon: null,
    };
    for (const pc of city.provider_cities || []) {
        const t = String(pc.provider_type || '').toLowerCase() as ProviderKey;
        if (!PROVIDER_ORDER.includes(t) || out[t] != null) continue;
        if (t === 'ameex') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id || nm || null;
        } else if (t === 'coliaty') {
            const nm = (pc.provider_city_name || '').trim();
            out[t] = nm || null;
        } else if (t === 'ozon') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id || nm || null;
        }
    }
    return out;
}

const MASTER_CITIES_PAGE_SIZE = 1000;

async function fetchAllMasterCities(): Promise<MasterCityRow[]> {
    const all: MasterCityRow[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('master_cities')
            .select('*, zones(name), provider_cities(provider_type, provider_city_id, provider_city_name)')
            .order('name')
            .range(from, from + MASTER_CITIES_PAGE_SIZE - 1);
        if (error) throw error;
        const batch = (data ?? []) as MasterCityRow[];
        all.push(...batch);
        if (batch.length < MASTER_CITIES_PAGE_SIZE) break;
        from += MASTER_CITIES_PAGE_SIZE;
    }
    return all;
}

async function syncProviderMappings(
    masterCityId: string,
    masterCityName: string,
    v: Pick<CityFormValues, 'ameex_city_code' | 'coliaty_city_name' | 'ozon_city_id'>
) {
    const name = masterCityName.trim();

    const del = async (providerType: ProviderKey) => {
        const { error } = await supabase
            .from('provider_cities')
            .delete()
            .eq('master_city_id', masterCityId)
            .eq('provider_type', providerType);
        if (error) throw error;
    };

    const upsert = async (
        providerType: ProviderKey,
        row: { provider_city_id: string | null; provider_city_name: string }
    ) => {
        const { error } = await supabase.from('provider_cities').upsert(
            {
                master_city_id: masterCityId,
                provider_type: providerType,
                provider_city_id: row.provider_city_id,
                provider_city_name: row.provider_city_name,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'master_city_id,provider_type' }
        );
        if (error) throw error;
    };

    const ameex = (v.ameex_city_code || '').trim();
    if (ameex) {
        await upsert('ameex', { provider_city_id: ameex, provider_city_name: ameex });
    } else {
        await del('ameex');
    }

    const coliaty = (v.coliaty_city_name || '').trim();
    if (coliaty) {
        await upsert('coliaty', { provider_city_id: null, provider_city_name: coliaty });
    } else {
        await del('coliaty');
    }

    const ozon = (v.ozon_city_id || '').trim();
    if (ozon) {
        await upsert('ozon', {
            provider_city_id: ozon,
            provider_city_name: name || ozon,
        });
    } else {
        await del('ozon');
    }
}

function ProviderMappingCell({
    type,
    logoUrl,
    mappedName,
    compact,
    dense,
}: {
    type: ProviderKey;
    logoUrl?: string;
    mappedName: string | null;
    compact?: boolean;
    /** Tighter row for fixed-layout table */
    dense?: boolean;
}) {
    const label = PROVIDER_LABELS[type];
    const imgCls = dense ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg';
    return (
        <div className={cn('flex items-start gap-1.5 min-w-0', compact && 'flex-col gap-1')}>
            {logoUrl ? (
                <img
                    src={logoUrl}
                    alt=""
                    className={cn(
                        imgCls,
                        'object-contain bg-white border border-brand-navy/[0.06] shrink-0'
                    )}
                />
            ) : (
                <div
                    className={cn(
                        imgCls,
                        'bg-brand-navy/[0.06] flex items-center justify-center text-[8px] font-black text-brand-navy/50 shrink-0'
                    )}
                >
                    {label.slice(0, 2)}
                </div>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
                {!dense && (
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
                )}
                <p
                    className={cn(
                        'font-semibold truncate',
                        dense ? 'text-xs' : 'text-sm',
                        mappedName ? 'text-brand-navy' : 'text-muted-foreground/60'
                    )}
                    title={mappedName || undefined}
                >
                    {mappedName || '—'}
                </p>
            </div>
        </div>
    );
}

const Cities = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCity, setEditingCity] = useState<MasterCityRow | null>(null);
    const [cityToDelete, setCityToDelete] = useState<MasterCityRow | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
    const [filterZoneId, setFilterZoneId] = useState<string>('all');
    const [filterMapping, setFilterMapping] = useState<string>('all');
    const [visibleLimit, setVisibleLimit] = useState(150);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: isOwner } = useQuery({
        queryKey: ['user-role'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;
            const { data, error } = await supabase
                .from('users')
                .select('role')
                .eq('id', user.id)
                .single();
            if (error || !data) return false;
            return data.role === 'owner';
        },
    });

    const { data: providerLogos = {} } = useQuery({
        queryKey: ['provider-logos-by-type'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('providers')
                .select('provider_type, logo_url, updated_at')
                .not('logo_url', 'is', null)
                .order('updated_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            const map: Record<string, string> = {};
            for (const row of data || []) {
                const raw = String(row.provider_type || '').trim().toLowerCase();
                const t =
                    raw === 'ozonexpress' || raw === 'ozon_express'
                        ? 'ozon'
                        : raw;
                const url = String(row.logo_url || '').trim();
                if (t && url && !map[t]) map[t] = row.logo_url as string;
            }
            return map;
        },
    });

    const { data: zones } = useQuery({
        queryKey: ['zones'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('zones')
                .select('id, name')
                .order('name');
            if (error) throw error;
            return data ?? [];
        },
    });

    const { data: cities, isLoading } = useQuery({
        // Must not share queryKey with ImportOrders' slim master_cities query — same key overwrites cache and breaks counts / load-more.
        queryKey: ['master-cities', 'owner-catalog-full'],
        queryFn: fetchAllMasterCities,
    });

    useEffect(() => {
        setVisibleLimit(150);
    }, [searchQuery, filterZoneId, filterMapping]);

    const filteredCities = useMemo(() => {
        let list = cities ?? [];

        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((city) => {
                if (city.name.toLowerCase().includes(q)) return true;
                const zn = (city.zones as { name?: string } | null)?.name?.toLowerCase() ?? '';
                if (zn.includes(q)) return true;
                return (city.provider_cities || []).some((pc) =>
                    String(pc.provider_city_name || '').toLowerCase().includes(q)
                );
            });
        }

        if (filterZoneId !== 'all') {
            list = list.filter((c) => c.zone_id === filterZoneId);
        }

        if (filterMapping !== 'all') {
            const hasProvider = (city: MasterCityRow, key: ProviderKey) => {
                const m = buildProviderMap(city);
                return !!(m[key] && String(m[key]).trim());
            };
            const allMapped = (city: MasterCityRow) =>
                PROVIDER_ORDER.every((k) => hasProvider(city, k));

            list = list.filter((city) => {
                if (filterMapping === 'missing_any') return !allMapped(city);
                if (filterMapping === 'full') return allMapped(city);
                if (filterMapping === 'missing_ameex') return !hasProvider(city, 'ameex');
                if (filterMapping === 'missing_coliaty') return !hasProvider(city, 'coliaty');
                if (filterMapping === 'missing_ozon') return !hasProvider(city, 'ozon');
                return true;
            });
        }

        return list;
    }, [cities, searchQuery, filterZoneId, filterMapping]);

    const visibleCities = useMemo(
        () => filteredCities.slice(0, visibleLimit),
        [filteredCities, visibleLimit]
    );
    const hiddenCount = Math.max(0, filteredCities.length - visibleCities.length);
    const hasMore = hiddenCount > 0;

    const cityCatalogStats = useMemo(() => {
        const list = cities ?? [];
        const hasProv = (city: MasterCityRow, key: ProviderKey) => {
            const m = buildProviderMap(city);
            return !!(m[key] && String(m[key]).trim());
        };
        const allMap = (city: MasterCityRow) => PROVIDER_ORDER.every((k) => hasProv(city, k));
        let withHub = 0;
        let fullyMapped = 0;
        let ameex = 0;
        let coliaty = 0;
        let ozon = 0;
        for (const city of list) {
            if (city.zone_id) withHub++;
            if (allMap(city)) fullyMapped++;
            if (hasProv(city, 'ameex')) ameex++;
            if (hasProv(city, 'coliaty')) coliaty++;
            if (hasProv(city, 'ozon')) ozon++;
        }
        const total = list.length;
        return {
            total,
            withHub,
            noHub: total - withHub,
            fullyMapped,
            missingProviders: total - fullyMapped,
            ameex,
            coliaty,
            ozon,
        };
    }, [cities]);

    const addCityMutation = useMutation({
        mutationFn: async (values: CityFormValues) => {
            const { data, error } = await supabase
                .from('master_cities')
                .insert({
                    name: values.name.trim(),
                    zone_id: values.zone_id
                })
                .select('*, zones(name)')
                .single();

            if (error) throw error;
            await syncProviderMappings(data.id, data.name, values);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setIsModalOpen(false);
            toast({ title: "City created", description: "The city has been successfully added to Master Cities." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        }
    });

    const updateCityMutation = useMutation({
        mutationFn: async (values: CityFormValues & { id: string }) => {
            const { data, error } = await supabase
                .from('master_cities')
                .update({
                    name: values.name.trim(),
                    zone_id: values.zone_id
                })
                .eq('id', values.id)
                .select('*, zones(name)')
                .single();

            if (error) throw error;
            await syncProviderMappings(data.id, data.name, values);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setIsModalOpen(false);
            setEditingCity(null);
            toast({ title: "City updated", description: "The city has been successfully updated." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        }
    });

    const deleteCityMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('master_cities')
                .delete()
                .eq('id', id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setCityToDelete(null);
            toast({ title: "City deleted", description: "The city was successfully removed." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        }
    });

    const form = useForm<CityFormValues>({
        resolver: zodResolver(citySchema),
        defaultValues: { ...emptyCityForm },
    });

    const onSubmit = (values: CityFormValues) => {
        if (editingCity) {
            updateCityMutation.mutate({ ...values, id: editingCity.id });
        } else {
            addCityMutation.mutate(values);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col gap-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-2">Cities & Localities</h1>
                                <p className="text-gray-500 font-light">
                                    Master cities, hub assignment, and provider mappings.
                                </p>
                            </div>
                            {isOwner && (
                                <Button
                                    onClick={() => {
                                        setEditingCity(null);
                                        form.reset({ ...emptyCityForm });
                                        setIsModalOpen(true);
                                    }}
                                    className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 flex items-center gap-2 shrink-0"
                                >
                                    <Plus className="w-5 h-5" />
                                    Add City
                                </Button>
                            )}
                        </div>

                        {!isLoading && cities != null && (
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                    Total cities
                                                </p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                    {cityCatalogStats.total}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">Master catalog</p>
                                            </div>
                                            <MapPin className="h-9 w-9 shrink-0 text-brand-navy/15" aria-hidden />
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                    Linked to hub
                                                </p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                    {cityCatalogStats.withHub}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {cityCatalogStats.noHub} no hub
                                                </p>
                                            </div>
                                            <Building2 className="h-9 w-9 shrink-0 text-brand-navy/15" aria-hidden />
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                    Fully mapped
                                                </p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                    {cityCatalogStats.fullyMapped}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    AMEEX + Coliaty + Ozon
                                                </p>
                                            </div>
                                            <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-600/25" aria-hidden />
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-brand-navy/[0.08] bg-white/95 px-5 py-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy/45">
                                                    Incomplete
                                                </p>
                                                <p className="mt-1 text-2xl font-bold tabular-nums text-brand-navy">
                                                    {cityCatalogStats.missingProviders}
                                                </p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    Missing ≥1 carrier field
                                                </p>
                                            </div>
                                            <AlertCircle className="h-9 w-9 shrink-0 text-amber-600/30" aria-hidden />
                                        </div>
                                    </div>
                                </div>
                                <p className="text-center text-[11px] font-semibold text-brand-navy/50 sm:text-left">
                                    <span className="text-brand-navy/35">Carrier coverage:</span>{' '}
                                    AMEEX {cityCatalogStats.ameex} · Coliaty {cityCatalogStats.coliaty} · Ozon{' '}
                                    {cityCatalogStats.ozon}
                                </p>
                            </div>
                        )}

                        <div className="flex flex-col xl:flex-row flex-wrap gap-3 items-stretch xl:items-center">
                            <div className="relative group flex-1 min-w-[200px] max-w-md">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search city, hub, or mapped provider name..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Select value={filterZoneId} onValueChange={setFilterZoneId}>
                                <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-white w-full sm:w-[200px] font-semibold">
                                    <SelectValue placeholder="Hub / zone" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="all" className="font-semibold">All hubs</SelectItem>
                                    {zones?.map((z) => (
                                        <SelectItem key={z.id} value={z.id} className="font-medium">
                                            {z.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={filterMapping} onValueChange={setFilterMapping}>
                                <SelectTrigger className="h-12 rounded-2xl border-gray-100 bg-white w-full sm:w-[220px] font-semibold">
                                    <SelectValue placeholder="Mapping" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="all" className="font-medium">All mappings</SelectItem>
                                    <SelectItem value="full" className="font-medium">Fully mapped (3)</SelectItem>
                                    <SelectItem value="missing_any" className="font-medium">Missing any provider</SelectItem>
                                    <SelectItem value="missing_ameex" className="font-medium">Missing AMEEX</SelectItem>
                                    <SelectItem value="missing_coliaty" className="font-medium">Missing Coliaty</SelectItem>
                                    <SelectItem value="missing_ozon" className="font-medium">Missing Ozon</SelectItem>
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
                            Showing {visibleCities.length} of {filteredCities.length}
                            {cities?.length != null && filteredCities.length !== cities.length
                                ? ` (${cities.length} total)`
                                : ''}
                        </p>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <div className="w-12 h-12 rounded-full border-4 border-brand-navy/10 border-t-brand-navy animate-spin" />
                    <p className="text-muted-foreground font-bold animate-pulse">Loading cities...</p>
                </div>
            ) : filteredCities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-20 h-20 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <MapPin className="w-10 h-10 text-brand-navy/20" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-brand-navy">No cities match</h3>
                        <p className="text-muted-foreground">Adjust filters or search</p>
                    </div>
                </div>
            ) : viewMode === 'table' ? (
                <Card className="border-none shadow-sm rounded-[32px] overflow-hidden bg-white min-w-0">
                    <CardContent className="p-0 min-w-0">
                        <div className="max-h-[min(70vh,720px)] overflow-y-auto overflow-x-auto overscroll-x-contain">
                            <table className="w-full min-w-[720px] table-fixed caption-bottom text-sm border-collapse">
                                <colgroup>
                                    {isOwner && <col style={{ width: 76 }} />}
                                    <col />
                                    {PROVIDER_ORDER.map((type) => (
                                        <col key={type} />
                                    ))}
                                    <col />
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
                                                'sticky top-0 z-20 h-12 px-2 py-2 text-left align-bottom font-bold text-brand-white bg-brand-navy',
                                                isOwner && 'shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]'
                                            )}
                                        >
                                            City
                                        </th>
                                        {PROVIDER_ORDER.map((type) => (
                                            <th
                                                key={type}
                                                scope="col"
                                                className="sticky top-0 z-20 h-12 px-2 py-2 text-left align-bottom bg-brand-navy"
                                                title={`${PROVIDER_LABELS[type]} — mapped city`}
                                            >
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    {providerLogos[type] ? (
                                                        <img
                                                            src={providerLogos[type]}
                                                            alt=""
                                                            className="h-6 w-6 rounded-md object-contain bg-white border border-white/20 shrink-0"
                                                        />
                                                    ) : (
                                                        <span className="h-6 w-6 rounded-md bg-white/15 flex items-center justify-center text-[7px] font-black text-brand-white/80 shrink-0">
                                                            {PROVIDER_LABELS[type].slice(0, 2)}
                                                        </span>
                                                    )}
                                                    <span className="font-bold text-brand-white text-[10px] uppercase tracking-wide truncate">
                                                        {PROVIDER_LABELS[type]}
                                                    </span>
                                                </div>
                                            </th>
                                        ))}
                                        <th
                                            scope="col"
                                            className="sticky top-0 z-20 h-12 px-2 py-2 text-left align-bottom font-bold text-brand-white bg-brand-navy"
                                        >
                                            Hub
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleCities.map((city) => {
                                        const pmap = buildProviderMap(city);
                                        const hub = (city.zones as { name?: string } | null)?.name;
                                        return (
                                            <tr
                                                key={city.id}
                                                className="group border-b border-brand-navy/[0.04] transition-colors hover:bg-brand-navy/[0.025]"
                                            >
                                                {isOwner && (
                                                    <td
                                                        className={cn(
                                                            'sticky left-0 z-10 w-[76px] min-w-[76px] max-w-[76px] whitespace-nowrap align-middle p-0 bg-white group-hover:bg-brand-navy/[0.03] border-r border-brand-navy/[0.05] shadow-[4px_0_12px_-6px_rgba(0,0,0,0.08)]'
                                                        )}
                                                    >
                                                        <div className="flex h-full flex-row items-center justify-center gap-px">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => {
                                                                    setEditingCity(city);
                                                                    form.reset(cityToFormDefaults(city));
                                                                    setIsModalOpen(true);
                                                                }}
                                                                className="h-8 w-[34px] min-w-[34px] shrink-0 px-0 text-brand-navy/50 hover:text-brand-navy hover:bg-brand-navy/10 rounded-md"
                                                                title="Edit"
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => setCityToDelete(city)}
                                                                className="h-8 w-[34px] min-w-[34px] shrink-0 px-0 text-brand-navy/40 hover:text-red-600 hover:bg-red-50 rounded-md"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="align-middle px-2 py-2 min-w-0">
                                                    <span className="font-bold text-brand-navy text-sm leading-snug line-clamp-2 break-words">
                                                        {city.name}
                                                    </span>
                                                </td>
                                                {PROVIDER_ORDER.map((type) => (
                                                    <td key={type} className="align-middle px-2 py-2 min-w-0">
                                                        <ProviderMappingCell
                                                            type={type}
                                                            logoUrl={providerLogos[type]}
                                                            mappedName={pmap[type]}
                                                            dense
                                                        />
                                                    </td>
                                                ))}
                                                <td className="align-middle px-2 py-2 min-w-0">
                                                    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[11px] font-bold text-brand-navy/70 max-w-full min-w-0">
                                                        <MapPin className="w-3 h-3 shrink-0" />
                                                        <span className="truncate min-w-0" title={hub || undefined}>
                                                            {hub || '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {hasMore && (
                            <div className="p-4 border-t border-brand-navy/[0.06] flex justify-center bg-brand-navy/[0.02]">
                                <Button
                                    variant="outline"
                                    className="rounded-xl font-bold"
                                    onClick={() => setVisibleLimit((n) => n + 200)}
                                >
                                    Load more ({hiddenCount} left)
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {visibleCities.map((city) => {
                            const pmap = buildProviderMap(city);
                            const hub = (city.zones as { name?: string } | null)?.name;
                            return (
                                <Card
                                    key={city.id}
                                    className="group relative overflow-hidden border-none bg-white shadow-sm hover:shadow-xl transition-all duration-300 rounded-[32px] p-6 flex flex-col gap-4"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-lg font-bold text-brand-navy truncate leading-tight">
                                                {city.name}
                                            </h3>
                                            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/60 uppercase tracking-wider">
                                                <MapPin className="w-2.5 h-2.5 shrink-0" />
                                                <span className="truncate">{hub || 'No hub'}</span>
                                            </div>
                                        </div>
                                        {isOwner && (
                                            <div className="flex items-center gap-1 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setEditingCity(city);
                                                        form.reset(cityToFormDefaults(city));
                                                        setIsModalOpen(true);
                                                    }}
                                                    className="h-9 w-9 text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5 rounded-full"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setCityToDelete(city)}
                                                    className="h-9 w-9 text-brand-navy/40 hover:text-red-500 hover:bg-red-50 rounded-full"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-3 pt-2 border-t border-brand-navy/[0.06]">
                                        {PROVIDER_ORDER.map((type) => (
                                            <ProviderMappingCell
                                                key={type}
                                                type={type}
                                                logoUrl={providerLogos[type]}
                                                mappedName={pmap[type]}
                                                compact
                                            />
                                        ))}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <Button
                                variant="outline"
                                className="rounded-xl font-bold"
                                onClick={() => setVisibleLimit((n) => n + 200)}
                            >
                                Load more ({hiddenCount} left)
                            </Button>
                        </div>
                    )}
                </>
            )}

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent
                    className={cn(
                        'w-[min(100vw-1.25rem,56rem)] max-w-none lg:max-w-[56rem]',
                        'max-h-[min(92vh,56rem)] flex flex-col p-0 gap-0 overflow-hidden',
                        'rounded-[2rem] border border-brand-navy/15 bg-brand-white',
                        'shadow-[0_28px_56px_-16px_rgba(59,94,94,0.45),0_0_0_1px_rgba(59,94,94,0.06)]',
                        'ring-1 ring-black/[0.04]'
                    )}
                >
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
                            <DialogHeader className="relative shrink-0 space-y-0 px-8 pb-3 pt-10 pr-14 text-left sm:px-10 sm:pt-11">
                                <div
                                    className="pointer-events-none absolute inset-0 rounded-t-[2rem] bg-gradient-to-r from-brand-navy/[0.07] via-brand-white to-brand-blue/[0.06]"
                                    aria-hidden
                                />
                                <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-navy/40">
                                            Master catalog
                                        </p>
                                        <DialogTitle className="text-3xl font-semibold leading-[1.15] tracking-tight text-brand-navy">
                                            {editingCity ? 'Edit city' : 'Add city'}
                                        </DialogTitle>
                                    </div>
                                    <DialogDescription className="lg:max-w-[26rem] lg:pb-1 text-[15px] leading-relaxed text-brand-navy/55 lg:text-right">
                                        Leave a carrier blank to drop its mapping.
                                    </DialogDescription>
                                </div>
                            </DialogHeader>

                            <ScrollArea className="min-h-0 flex-1 border-t border-brand-navy/[0.08] bg-brand-navy/[0.015]">
                                <div className="px-6 py-8 sm:px-8 lg:px-10 lg:py-9">
                                    <div className="flex w-full min-w-0 flex-col gap-8">
                                        {/* Master name + hub — one row on sm+ */}
                                        <section className="grid w-full min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 sm:items-start sm:gap-6 lg:gap-8">
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="min-w-0 space-y-3">
                                                        <FormLabel className="text-[11px] font-bold uppercase tracking-wider text-brand-navy/55">
                                                            Master city name
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="E.g. Casablanca"
                                                                {...field}
                                                                className="h-[3.25rem] w-full rounded-2xl border border-brand-navy/[0.08] bg-white px-4 text-base font-semibold text-brand-navy shadow-sm transition-shadow placeholder:text-brand-navy/25 focus-visible:border-brand-navy/25 focus-visible:ring-2 focus-visible:ring-brand-navy/10"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="zone_id"
                                                render={({ field }) => (
                                                    <FormItem className="min-w-0 space-y-3">
                                                        <FormLabel className="text-[11px] font-bold uppercase tracking-wider text-brand-navy/55">
                                                            Hub (zone)
                                                        </FormLabel>
                                                        <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-[3.25rem] w-full rounded-2xl border border-brand-navy/[0.08] bg-white px-4 text-base font-semibold text-brand-navy shadow-sm focus:ring-2 focus:ring-brand-navy/10">
                                                                    <SelectValue placeholder="Choose a zone" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="rounded-2xl border border-brand-navy/[0.08] shadow-xl">
                                                                {zones?.map((zone) => (
                                                                    <SelectItem
                                                                        key={zone.id}
                                                                        value={zone.id}
                                                                        className="rounded-xl py-3 font-semibold focus:bg-brand-navy focus:text-brand-white"
                                                                    >
                                                                        {zone.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </section>

                                        {/* Carriers — full width */}
                                        <section className="w-full min-w-0 rounded-[1.5rem] border border-brand-navy/10 bg-gradient-to-br from-white to-brand-navy/[0.04] p-6 shadow-sm sm:p-7 lg:rounded-2xl">
                                            <div className="mb-6 flex flex-col gap-1 border-b border-brand-navy/[0.08] pb-5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-brand-navy">
                                                    Carrier mapping
                                                </h3>
                                                <p className="text-[13px] leading-snug text-brand-navy/45">
                                                    AMEEX · Coliaty · Ozon — provider-integration
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-4 xl:gap-5">
                                                <FormField
                                                    control={form.control}
                                                    name="ameex_city_code"
                                                    render={({ field }) => (
                                                        <FormItem className="flex min-w-0 flex-col space-y-4 rounded-2xl border border-brand-navy/[0.08] bg-white/95 p-5 shadow-sm">
                                                            <FormLabel className="text-sm font-bold text-brand-navy">
                                                                AMEEX
                                                            </FormLabel>
                                                            <FormDescription className="space-y-2 text-[13px] leading-relaxed text-brand-navy/80 [&_code]:text-brand-navy">
                                                                <span className="block font-semibold text-brand-navy">
                                                                    API field{' '}
                                                                    <code className="rounded-md border border-brand-navy/15 bg-brand-navy/[0.08] px-2 py-0.5 font-mono text-[12px] font-bold">
                                                                        city
                                                                    </code>
                                                                </span>
                                                                <span className="block text-[12px] text-brand-navy/65">
                                                                    Use the city code from AMEEX’s documentation (same value their API expects for <code className="font-mono text-[11px]">city</code>).
                                                                </span>
                                                            </FormDescription>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="City code"
                                                                    {...field}
                                                                    value={field.value || ''}
                                                                    className="h-11 rounded-xl border border-brand-navy/[0.1] bg-brand-white px-3 text-sm font-medium text-brand-navy placeholder:text-brand-navy/30 focus-visible:ring-2 focus-visible:ring-brand-navy/15"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={form.control}
                                                    name="coliaty_city_name"
                                                    render={({ field }) => (
                                                        <FormItem className="flex min-w-0 flex-col space-y-4 rounded-2xl border border-brand-navy/[0.08] bg-white/95 p-5 shadow-sm">
                                                            <FormLabel className="text-sm font-bold text-brand-navy">
                                                                Coliaty
                                                            </FormLabel>
                                                            <FormDescription className="space-y-2 text-[13px] leading-relaxed text-brand-navy/80 [&_code]:text-brand-navy">
                                                                <span className="block font-semibold text-brand-navy">
                                                                    API field{' '}
                                                                    <code className="break-all rounded-md border border-brand-navy/15 bg-brand-navy/[0.08] px-2 py-0.5 font-mono text-[12px] font-bold">
                                                                        package_city
                                                                    </code>
                                                                </span>
                                                                <span className="block text-[12px] text-brand-navy/65">
                                                                    Match the city string from Coliaty’s docs exactly (spelling and casing).
                                                                </span>
                                                            </FormDescription>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="City name"
                                                                    {...field}
                                                                    value={field.value || ''}
                                                                    className="h-11 rounded-xl border border-brand-navy/[0.1] bg-brand-white px-3 text-sm font-medium text-brand-navy placeholder:text-brand-navy/30 focus-visible:ring-2 focus-visible:ring-brand-navy/15"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={form.control}
                                                    name="ozon_city_id"
                                                    render={({ field }) => (
                                                        <FormItem className="flex min-w-0 flex-col space-y-4 rounded-2xl border border-brand-navy/[0.08] bg-white/95 p-5 shadow-sm">
                                                            <FormLabel className="text-sm font-bold text-brand-navy">
                                                                Ozon
                                                            </FormLabel>
                                                            <FormDescription className="space-y-2 text-[13px] leading-relaxed text-brand-navy/80 [&_code]:text-brand-navy">
                                                                <span className="block font-semibold text-brand-navy">
                                                                    API field{' '}
                                                                    <code className="rounded-md border border-brand-navy/15 bg-brand-navy/[0.08] px-2 py-0.5 font-mono text-[12px] font-bold">
                                                                        parcel-city
                                                                    </code>
                                                                </span>
                                                                <span className="block text-[12px] text-brand-navy/65">
                                                                    Ozon Express multipart field — use the city id from their documentation (not the display name).
                                                                </span>
                                                            </FormDescription>
                                                            <FormControl>
                                                                <Input
                                                                    placeholder="City id"
                                                                    {...field}
                                                                    value={field.value || ''}
                                                                    className="h-11 rounded-xl border border-brand-navy/[0.1] bg-brand-white px-3 text-sm font-medium text-brand-navy placeholder:text-brand-navy/30 focus-visible:ring-2 focus-visible:ring-brand-navy/15"
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </section>
                                    </div>
                                </div>
                            </ScrollArea>

                            <DialogFooter className="shrink-0 flex flex-row flex-wrap items-center justify-end gap-3 border-t border-brand-navy/10 bg-gradient-to-t from-brand-navy/[0.06] to-brand-navy/[0.02] px-8 py-6 sm:gap-4 sm:px-10 sm:py-7">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingCity(null);
                                    }}
                                    className="h-12 min-w-[7rem] rounded-xl px-8 text-[15px] font-bold text-brand-navy/70 hover:bg-white/80 hover:text-brand-navy"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={addCityMutation.isPending || updateCityMutation.isPending}
                                    className="h-12 min-w-[10rem] rounded-xl bg-brand-navy px-10 text-[15px] font-bold text-brand-white shadow-lg shadow-brand-navy/25 transition-all hover:bg-brand-navy/90 active:scale-[0.98] disabled:opacity-60"
                                >
                                    {(addCityMutation.isPending || updateCityMutation.isPending) && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {editingCity ? 'Save changes' : 'Create city'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!cityToDelete} onOpenChange={() => setCityToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-8">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-bold text-brand-navy">Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription className="text-base text-muted-foreground">
                            This will permanently delete <span className="font-black text-brand-navy">{cityToDelete?.name}</span>. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6">
                        <AlertDialogCancel className="rounded-2xl h-12 px-6 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08]">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteCityMutation.mutate(cityToDelete.id)}
                            className="rounded-2xl h-12 px-8 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-lg shadow-red-500/20"
                        >
                            {deleteCityMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete City
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Cities;
