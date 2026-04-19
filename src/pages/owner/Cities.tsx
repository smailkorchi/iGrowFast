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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Cities & Localities</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Master catalog, hub assignment, carrier mappings</p>
                    </div>
                    {isOwner && (
                        <Button
                            onClick={() => { setEditingCity(null); form.reset({ ...emptyCityForm }); setIsModalOpen(true); }}
                            className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5 px-3"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add City
                        </Button>
                    )}
                </div>
            </header>

            {/* KPI Strip */}
            {!isLoading && cities != null && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                        { label: 'Total cities', value: cityCatalogStats.total, accent: '#3b5e5e' },
                        { label: 'Linked to hub', value: cityCatalogStats.withHub, accent: '#059669' },
                        { label: 'Fully mapped', value: cityCatalogStats.fullyMapped, accent: '#059669' },
                        { label: 'Incomplete', value: cityCatalogStats.missingProviders, accent: '#d97706' },
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

            {/* Carrier coverage line */}
            {!isLoading && cities != null && (
                <p className="text-[10px] text-gray-400 tabular-nums">
                    Carrier coverage: AMEEX {cityCatalogStats.ameex} · Coliaty {cityCatalogStats.coliaty} · Ozon {cityCatalogStats.ozon}
                </p>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <Input
                        placeholder="Search city, hub or carrier..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                    />
                </div>
                <Select value={filterZoneId} onValueChange={setFilterZoneId}>
                    <SelectTrigger className="h-8 rounded-md border-gray-200 bg-white text-[11px] w-[140px]">
                        <SelectValue placeholder="Hub / zone" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-[11px]">All hubs</SelectItem>
                        {zones?.map((z) => (
                            <SelectItem key={z.id} value={z.id} className="text-[11px]">{z.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterMapping} onValueChange={setFilterMapping}>
                    <SelectTrigger className="h-8 rounded-md border-gray-200 bg-white text-[11px] w-[150px]">
                        <SelectValue placeholder="Mapping" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-[11px]">All mappings</SelectItem>
                        <SelectItem value="full" className="text-[11px]">Fully mapped</SelectItem>
                        <SelectItem value="missing_any" className="text-[11px]">Missing any</SelectItem>
                        <SelectItem value="missing_ameex" className="text-[11px]">Missing AMEEX</SelectItem>
                        <SelectItem value="missing_coliaty" className="text-[11px]">Missing Coliaty</SelectItem>
                        <SelectItem value="missing_ozon" className="text-[11px]">Missing Ozon</SelectItem>
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
                    {visibleCities.length} / {filteredCities.length}
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
            ) : filteredCities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 bg-white">
                    <MapPin className="w-6 h-6 text-gray-300 mb-2" />
                    <p className="text-[11px] font-medium text-gray-500">No cities match</p>
                </div>
            ) : viewMode === 'table' ? (
                <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden bg-white min-w-0">
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
                                    <tr className="border-b border-gray-100 bg-white">
                                        {isOwner && (
                                            <th
                                                scope="col"
                                                className="sticky top-0 left-0 z-30 h-9 w-[76px] min-w-[76px] max-w-[76px] whitespace-nowrap px-0 py-2 text-center align-bottom text-[9px] uppercase leading-tight tracking-[0.18em] text-gray-400 bg-white border-r border-gray-100"
                                            >
                                                Actions
                                            </th>
                                        )}
                                        <th scope="col" className="sticky top-0 z-20 h-9 px-3 py-2 text-left align-bottom text-[9px] uppercase tracking-[0.18em] text-gray-400 bg-white">
                                            City
                                        </th>
                                        {PROVIDER_ORDER.map((type) => (
                                            <th key={type} scope="col" className="sticky top-0 z-20 h-9 px-3 py-2 text-left align-bottom bg-white" title={`${PROVIDER_LABELS[type]}`}>
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    {providerLogos[type] ? (
                                                        <img src={providerLogos[type]} alt="" className="h-5 w-5 rounded object-contain bg-gray-50 border border-gray-100 shrink-0" />
                                                    ) : (
                                                        <span className="h-5 w-5 rounded bg-gray-100 flex items-center justify-center text-[7px] font-bold text-gray-500 shrink-0">
                                                            {PROVIDER_LABELS[type].slice(0, 2)}
                                                        </span>
                                                    )}
                                                    <span className="text-[9px] uppercase tracking-[0.18em] text-gray-400 truncate">{PROVIDER_LABELS[type]}</span>
                                                </div>
                                            </th>
                                        ))}
                                        <th scope="col" className="sticky top-0 z-20 h-9 px-3 py-2 text-left align-bottom text-[9px] uppercase tracking-[0.18em] text-gray-400 bg-white">
                                            Hub
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleCities.map((city) => {
                                        const pmap = buildProviderMap(city);
                                        const hub = (city.zones as { name?: string } | null)?.name;
                                        return (
                                            <tr key={city.id} className="group border-b border-gray-50 transition-colors hover:bg-gray-50/50">
                                                {isOwner && (
                                                    <td className="sticky left-0 z-10 w-[76px] min-w-[76px] max-w-[76px] whitespace-nowrap align-middle p-0 bg-white group-hover:bg-gray-50/50 border-r border-gray-100">
                                                        <div className="flex h-full flex-row items-center justify-center gap-px">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => { setEditingCity(city); form.reset(cityToFormDefaults(city)); setIsModalOpen(true); }}
                                                                className="h-7 w-[34px] min-w-[34px] shrink-0 px-0 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded"
                                                                title="Edit"
                                                            >
                                                                <Pencil className="h-3 w-3" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => setCityToDelete(city)}
                                                                className="h-7 w-[34px] min-w-[34px] shrink-0 px-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="align-middle px-3 py-2 min-w-0">
                                                    <span className="text-[11px] font-semibold text-brand-navy/80 leading-snug line-clamp-2 break-words">{city.name}</span>
                                                </td>
                                                {PROVIDER_ORDER.map((type) => (
                                                    <td key={type} className="align-middle px-3 py-2 min-w-0">
                                                        <ProviderMappingCell type={type} logoUrl={providerLogos[type]} mappedName={pmap[type]} dense />
                                                    </td>
                                                ))}
                                                <td className="align-middle px-3 py-2 min-w-0">
                                                    <span className="text-[11px] text-brand-navy/60 tabular-nums truncate">{hub || '—'}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {hasMore && (
                            <div className="p-3 border-t border-gray-100 flex justify-center">
                                <Button variant="outline" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => setVisibleLimit((n) => n + 200)}>
                                    Load more ({hiddenCount} left)
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                        {visibleCities.map((city) => {
                            const pmap = buildProviderMap(city);
                            const hub = (city.zones as { name?: string } | null)?.name;
                            return (
                                <div key={city.id} className="rounded-xl border border-gray-100 bg-white p-3.5 flex flex-col gap-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[12px] font-semibold text-brand-navy truncate leading-tight">{city.name}</p>
                                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 mt-1">
                                                <MapPin className="w-2.5 h-2.5 shrink-0" />
                                                {hub || 'No hub'}
                                            </span>
                                        </div>
                                        {isOwner && (
                                            <div className="flex items-center gap-0.5 shrink-0">
                                                <Button variant="ghost" size="icon" onClick={() => { setEditingCity(city); form.reset(cityToFormDefaults(city)); setIsModalOpen(true); }} className="h-7 w-7 p-0 rounded text-gray-400 hover:text-brand-navy hover:bg-gray-100">
                                                    <Pencil className="w-3 h-3" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => setCityToDelete(city)} className="h-7 w-7 p-0 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2 pt-2 border-t border-gray-50">
                                        {PROVIDER_ORDER.map((type) => (
                                            <ProviderMappingCell key={type} type={type} logoUrl={providerLogos[type]} mappedName={pmap[type]} compact />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <Button variant="outline" className="h-8 rounded-md text-[11px] font-semibold" onClick={() => setVisibleLimit((n) => n + 200)}>
                                Load more ({hiddenCount} left)
                            </Button>
                        </div>
                    )}
                </>
            )}

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-2xl p-0 border border-gray-100 bg-white rounded-xl shadow-md overflow-hidden flex flex-col max-h-[90vh] gap-0">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
                            <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
                                <DialogTitle className="text-[14px] font-semibold text-brand-navy">
                                    {editingCity ? 'Edit city' : 'Add city'}
                                </DialogTitle>
                                <DialogDescription className="text-[11px] text-gray-400 mt-0.5">
                                    Leave a carrier blank to drop its mapping.
                                </DialogDescription>
                            </DialogHeader>

                            <ScrollArea className="min-h-0 flex-1">
                                <div className="px-5 py-4 space-y-4">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Master city name</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            placeholder="E.g. Casablanca"
                                                            {...field}
                                                            className="h-9 rounded-md border-gray-200 text-sm"
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
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Hub (zone)</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-9 rounded-md border-gray-200 text-[11px]">
                                                                <SelectValue placeholder="Choose a zone" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {zones?.map((zone) => (
                                                                <SelectItem key={zone.id} value={zone.id} className="text-[11px]">
                                                                    {zone.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="rounded-xl border border-gray-100 p-3.5 space-y-3">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Carrier mapping</p>
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                            <FormField
                                                control={form.control}
                                                name="ameex_city_code"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">AMEEX <span className="font-mono normal-case text-gray-300">city</span></FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="City code"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className="h-9 rounded-md border-gray-200 text-[11px]"
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
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Coliaty <span className="font-mono normal-case text-gray-300">package_city</span></FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="City name"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className="h-9 rounded-md border-gray-200 text-[11px]"
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
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ozon <span className="font-mono normal-case text-gray-300">parcel-city</span></FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="City id"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className="h-9 rounded-md border-gray-200 text-[11px]"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>

                            <DialogFooter className="px-5 py-3 border-t border-gray-100 shrink-0 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingCity(null);
                                    }}
                                    className="h-8 px-3 text-[11px] font-semibold text-gray-500"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={addCityMutation.isPending || updateCityMutation.isPending}
                                    className="h-8 px-4 text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white rounded-md gap-1.5"
                                >
                                    {(addCityMutation.isPending || updateCityMutation.isPending) && (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    )}
                                    {editingCity ? 'Save changes' : 'Create city'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!cityToDelete} onOpenChange={() => setCityToDelete(null)}>
                <AlertDialogContent className="rounded-xl border border-gray-100 p-5 max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[14px] font-semibold text-brand-navy">Delete city?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[12px] text-gray-500">
                            Permanently delete <span className="font-semibold text-brand-navy">{cityToDelete?.name}</span>. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-3 gap-2">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200 text-gray-500">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteCityMutation.mutate(cityToDelete.id)}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white gap-1.5"
                        >
                            {deleteCityMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Cities;
