import { useMemo, useState, useEffect } from 'react';
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
    X,
    AlertTriangle,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
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

const PROVIDER_ORDER = ['ameex', 'coliaty', 'ozon', 'quicklivraison', 'vitex', 'forcelog'] as const;
type ProviderKey = (typeof PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<ProviderKey, string> = {
    ameex: 'AMEEX',
    coliaty: 'Coliaty',
    ozon: 'Ozon',
    quicklivraison: 'Quick Livraison',
    vitex: 'VITEX',
    forcelog: 'Forcelog',
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
    ameex_city_code: z.string().optional().nullable(),
    coliaty_city_name: z.string().optional().nullable(),
    ozon_city_id: z.string().optional().nullable(),
    quicklivraison_city_id: z.string().optional().nullable(),
    vitex_city_id: z.string().optional().nullable(),
    forcelog_city_id: z.string().optional().nullable(),
});

type CityFormValues = z.infer<typeof citySchema>;

const emptyCityForm: CityFormValues = {
    name: '',
    zone_id: '',
    ameex_city_code: '',
    coliaty_city_name: '',
    ozon_city_id: '',
    quicklivraison_city_id: '',
    vitex_city_id: '',
    forcelog_city_id: '',
};

function cityToFormDefaults(city: MasterCityRow | null): CityFormValues {
    if (!city) return { ...emptyCityForm };
    const by = (t: string) =>
        city.provider_cities?.find((p) => String(p.provider_type || '').toLowerCase() === t);
    const am = by('ameex');
    const co = by('coliaty');
    const oz = by('ozon');
    const ql = by('quicklivraison');
    const vx = by('vitex');
    const fl = by('forcelog');
    return {
        name: city.name,
        zone_id: city.zone_id || '',
        ameex_city_code: (am?.provider_city_id || am?.provider_city_name || '').trim() || '',
        coliaty_city_name: (co?.provider_city_name || '').trim() || '',
        ozon_city_id: (oz?.provider_city_id || '').trim() || '',
        quicklivraison_city_id: (ql?.provider_city_id || '').trim() || '',
        vitex_city_id: (vx?.provider_city_id || '').trim() || '',
        forcelog_city_id: (fl?.provider_city_id || '').trim() || '',
    };
}

function buildProviderMap(city: MasterCityRow): Record<ProviderKey, string | null> {
    const out: Record<ProviderKey, string | null> = {
        ameex: null,
        coliaty: null,
        ozon: null,
        quicklivraison: null,
        vitex: null,
        forcelog: null,
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
        } else if (t === 'quicklivraison') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id ? `${id}${nm ? ` · ${nm}` : ''}` : nm || null;
        } else if (t === 'vitex') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id ? `${id}${nm ? ` · ${nm}` : ''}` : nm || null;
        } else if (t === 'forcelog') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id ? `${id}${nm ? ` · ${nm}` : ''}` : nm || null;
        }
    }
    return out;
}

const MASTER_CITIES_PAGE_SIZE = 1000;

async function fetchAllMasterCities(): Promise<MasterCityRow[]> {
    const all: MasterCityRow[] = [];
    let from = 0;
    for (; ;) {
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
    v: Pick<CityFormValues, 'ameex_city_code' | 'coliaty_city_name' | 'ozon_city_id' | 'quicklivraison_city_id' | 'vitex_city_id' | 'forcelog_city_id'>
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

    const ql = (v.quicklivraison_city_id || '').trim();
    if (ql) {
        await upsert('quicklivraison', {
            provider_city_id: ql,
            provider_city_name: name || ql,
        });
    } else {
        await del('quicklivraison');
    }

    const vx = (v.vitex_city_id || '').trim();
    if (vx) {
        await upsert('vitex', {
            provider_city_id: vx,
            provider_city_name: name || vx,
        });
    } else {
        await del('vitex');
    }

    const fl = (v.forcelog_city_id || '').trim();
    if (fl) {
        await upsert('forcelog', {
            provider_city_id: fl,
            provider_city_name: name || fl,
        });
    } else {
        await del('forcelog');
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
    dense?: boolean;
}) {
    const label = PROVIDER_LABELS[type];
    const imgCls = dense ? 'h-6 w-6 rounded-lg' : 'h-8 w-8 rounded-xl';
    return (
        <div className={cn('flex items-start gap-1.5 min-w-0', compact && 'flex-col gap-1')}>
            {logoUrl ? (
                <img
                    src={logoUrl}
                    alt=""
                    className={cn(
                        imgCls,
                        'object-contain bg-ant-light border border-ant-line shrink-0 p-0.5',
                    )}
                />
            ) : (
                <div
                    className={cn(
                        imgCls,
                        'bg-ant-light border border-ant-line flex items-center justify-center text-[8px] font-medium text-ant-mid shrink-0',
                    )}
                >
                    {label.slice(0, 2)}
                </div>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
                {!dense && (
                    <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-ant-mid">{label}</p>
                )}
                <p
                    className={cn(
                        'truncate',
                        dense ? 'text-[12px]' : 'text-[13px]',
                        mappedName ? 'font-display text-ant-ink' : 'font-serif italic text-ant-mid/70',
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
                    raw === 'ozonexpress' || raw === 'ozon_express' ? 'ozon' : raw;
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
                    String(pc.provider_city_name || '').toLowerCase().includes(q),
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
                if (filterMapping === 'missing_quicklivraison') return !hasProvider(city, 'quicklivraison');
                if (filterMapping === 'missing_vitex') return !hasProvider(city, 'vitex');
                return true;
            });
        }

        return list;
    }, [cities, searchQuery, filterZoneId, filterMapping]);

    const visibleCities = useMemo(
        () => filteredCities.slice(0, visibleLimit),
        [filteredCities, visibleLimit],
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
        let quicklivraison = 0;
        let vitex = 0;
        for (const city of list) {
            if (city.zone_id) withHub++;
            if (allMap(city)) fullyMapped++;
            if (hasProv(city, 'ameex')) ameex++;
            if (hasProv(city, 'coliaty')) coliaty++;
            if (hasProv(city, 'ozon')) ozon++;
            if (hasProv(city, 'quicklivraison')) quicklivraison++;
            if (hasProv(city, 'vitex')) vitex++;
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
            quicklivraison,
            vitex,
        };
    }, [cities]);

    const addCityMutation = useMutation({
        mutationFn: async (values: CityFormValues) => {
            const { data, error } = await supabase
                .from('master_cities')
                .insert({
                    name: values.name.trim(),
                    zone_id: values.zone_id,
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
            toast({ title: "City created", description: "Added to the master catalog." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        },
    });

    const updateCityMutation = useMutation({
        mutationFn: async (values: CityFormValues & { id: string }) => {
            const { data, error } = await supabase
                .from('master_cities')
                .update({
                    name: values.name.trim(),
                    zone_id: values.zone_id,
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
            toast({ title: "City updated", description: "Changes saved." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        },
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
            toast({ title: "City deleted", description: "Removed from the catalog." });
        },
        onError: (error) => {
            toast({ title: "Error", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        },
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

    const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Cities & hubs
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Cities & localities
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Master catalog, hub assignment, and carrier mappings for every deliverable location.
                        </p>
                    </div>
                    {isOwner && (
                        <button
                            type="button"
                            onClick={() => { setEditingCity(null); form.reset({ ...emptyCityForm }); setIsModalOpen(true); }}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)] self-start lg:self-auto"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add city
                        </button>
                    )}
                </div>
            </header>

            {/* KPI hairline strip */}
            {!isLoading && cities != null && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                    <KpiTile label="Total cities" value={cityCatalogStats.total} accent="bg-ant-ink" />
                    <KpiTile label="Linked to hub" value={cityCatalogStats.withHub} accent="bg-ant-green" />
                    <KpiTile label="Fully mapped" value={cityCatalogStats.fullyMapped} accent="bg-ant-green" />
                    <KpiTile label="Incomplete" value={cityCatalogStats.missingProviders} accent="bg-ant-orange" />
                </div>
            )}

            {/* Carrier coverage line */}
            {!isLoading && cities != null && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-ant-mid">
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Carrier coverage</span>
                    <div className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-light border border-ant-line">
                            <span className="font-medium text-ant-ink">AMEEX</span>
                            <span className="tabular-nums text-ant-ink">{cityCatalogStats.ameex}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-light border border-ant-line">
                            <span className="font-medium text-ant-ink">Coliaty</span>
                            <span className="tabular-nums text-ant-ink">{cityCatalogStats.coliaty}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-light border border-ant-line">
                            <span className="font-medium text-ant-ink">Ozon</span>
                            <span className="tabular-nums text-ant-ink">{cityCatalogStats.ozon}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-light border border-ant-line">
                            <span className="font-medium text-ant-ink">Quick Livraison</span>
                            <span className="tabular-nums text-ant-ink">{cityCatalogStats.quicklivraison}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-light border border-ant-line">
                            <span className="font-medium text-ant-ink">VITEX</span>
                            <span className="tabular-nums text-ant-ink">{cityCatalogStats.vitex}</span>
                        </span>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 sm:flex-initial min-w-[220px]">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                    <input
                        type="search"
                        placeholder="Search city, hub or carrier…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full sm:w-60 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
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

                <Select value={filterZoneId} onValueChange={setFilterZoneId}>
                    <SelectTrigger className="h-10 rounded-full border-ant-line bg-ant-paper text-[12px] px-4 w-[160px]">
                        <SelectValue placeholder="Hub / zone" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                        <SelectItem value="all" className="text-[12px]">All hubs</SelectItem>
                        {zones?.map((z) => (
                            <SelectItem key={z.id} value={z.id} className="text-[12px]">{z.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={filterMapping} onValueChange={setFilterMapping}>
                    <SelectTrigger className="h-10 rounded-full border-ant-line bg-ant-paper text-[12px] px-4 w-[170px]">
                        <SelectValue placeholder="Mapping" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                        <SelectItem value="all" className="text-[12px]">All mappings</SelectItem>
                        <SelectItem value="full" className="text-[12px]">Fully mapped</SelectItem>
                        <SelectItem value="missing_any" className="text-[12px]">Missing any</SelectItem>
                        <SelectItem value="missing_ameex" className="text-[12px]">Missing AMEEX</SelectItem>
                        <SelectItem value="missing_coliaty" className="text-[12px]">Missing Coliaty</SelectItem>
                        <SelectItem value="missing_ozon" className="text-[12px]">Missing Ozon</SelectItem>
                        <SelectItem value="missing_quicklivraison" className="text-[12px]">Missing Quick Livraison</SelectItem>
                        <SelectItem value="missing_vitex" className="text-[12px]">Missing VITEX</SelectItem>
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
                    {visibleCities.length} / {filteredCities.length}
                </span>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
                </div>
            ) : filteredCities.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <MapPin className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No cities match</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Adjust your search or filters to see more results.
                        </p>
                    </div>
                </section>
            ) : viewMode === 'table' ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="max-h-[min(70vh,720px)] overflow-y-auto overflow-x-auto overscroll-x-contain">
                        <table className="w-full min-w-[720px] table-fixed caption-bottom text-sm border-collapse">
                            <colgroup>
                                {isOwner && <col style={{ width: 84 }} />}
                                <col />
                                {PROVIDER_ORDER.map((type) => (
                                    <col key={type} />
                                ))}
                                <col />
                            </colgroup>
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/60">
                                    {isOwner && (
                                        <th
                                            scope="col"
                                            className="sticky top-0 left-0 z-30 h-10 w-[84px] min-w-[84px] max-w-[84px] whitespace-nowrap px-0 py-2 text-center align-middle text-[9px] font-medium uppercase leading-tight tracking-[0.22em] text-ant-mid bg-ant-light/95 backdrop-blur border-r border-ant-line"
                                        >
                                            Actions
                                        </th>
                                    )}
                                    <th scope="col" className="sticky top-0 z-20 h-10 px-4 py-2 text-left align-middle text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid bg-ant-light/95 backdrop-blur">
                                        City
                                    </th>
                                    {PROVIDER_ORDER.map((type) => (
                                        <th key={type} scope="col" className="sticky top-0 z-20 h-10 px-3 py-2 text-left align-middle bg-ant-light/95 backdrop-blur" title={PROVIDER_LABELS[type]}>
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {providerLogos[type] ? (
                                                    <img src={providerLogos[type]} alt="" className="h-5 w-5 rounded-lg object-contain bg-ant-paper border border-ant-line shrink-0 p-0.5" />
                                                ) : (
                                                    <span className="h-5 w-5 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center text-[7px] font-medium text-ant-mid shrink-0">
                                                        {PROVIDER_LABELS[type].slice(0, 2)}
                                                    </span>
                                                )}
                                                <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">{PROVIDER_LABELS[type]}</span>
                                            </div>
                                        </th>
                                    ))}
                                    <th scope="col" className="sticky top-0 z-20 h-10 px-3 py-2 text-left align-middle text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid bg-ant-light/95 backdrop-blur">
                                        Hub
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleCities.map((city) => {
                                    const pmap = buildProviderMap(city);
                                    const hub = (city.zones as { name?: string } | null)?.name;
                                    return (
                                        <tr key={city.id} className="group border-b border-ant-line last:border-b-0 transition-colors hover:bg-ant-light/40">
                                            {isOwner && (
                                                <td className="sticky left-0 z-10 w-[84px] min-w-[84px] max-w-[84px] whitespace-nowrap align-middle p-0 bg-ant-paper group-hover:bg-ant-light/40 border-r border-ant-line">
                                                    <div className="flex h-full flex-row items-center justify-center gap-1 px-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => { setEditingCity(city); form.reset(cityToFormDefaults(city)); setIsModalOpen(true); }}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                            title="Edit"
                                                        >
                                                            <Pencil className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCityToDelete(city)}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                            <td className="align-middle px-4 py-2.5 min-w-0">
                                                <span className="font-display text-[13px] text-ant-ink leading-snug line-clamp-2 break-words">{city.name}</span>
                                            </td>
                                            {PROVIDER_ORDER.map((type) => (
                                                <td key={type} className="align-middle px-3 py-2.5 min-w-0">
                                                    <ProviderMappingCell type={type} logoUrl={providerLogos[type]} mappedName={pmap[type]} dense />
                                                </td>
                                            ))}
                                            <td className="align-middle px-3 py-2.5 min-w-0">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1 text-[11px] truncate',
                                                    hub ? 'text-ant-ink' : 'font-serif italic text-ant-mid',
                                                )}>
                                                    {hub && <MapPin className="w-3 h-3 text-ant-mid shrink-0" />}
                                                    {hub || '—'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {hasMore && (
                        <div className="p-3 border-t border-ant-line flex justify-center">
                            <button
                                type="button"
                                onClick={() => setVisibleLimit((n) => n + 200)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                            >
                                Load more <span className="tabular-nums">({hiddenCount})</span>
                            </button>
                        </div>
                    )}
                </section>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                        {visibleCities.map((city) => {
                            const pmap = buildProviderMap(city);
                            const hub = (city.zones as { name?: string } | null)?.name;
                            const allMapped = PROVIDER_ORDER.every((k) => !!pmap[k]);
                            return (
                                <div key={city.id} className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors flex flex-col">
                                    <div className={cn('h-[3px] w-full', allMapped ? 'bg-ant-green' : 'bg-ant-orange')} />
                                    <div className="p-4 flex flex-col gap-3 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <p className="font-display text-[14px] text-ant-ink truncate leading-tight">{city.name}</p>
                                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ant-mid">
                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                    {hub || <span className="font-serif italic">No hub</span>}
                                                </span>
                                            </div>
                                            {isOwner && (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setEditingCity(city); form.reset(cityToFormDefaults(city)); setIsModalOpen(true); }}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setCityToDelete(city)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-2 pt-3 border-t border-ant-line">
                                            {PROVIDER_ORDER.map((type) => (
                                                <ProviderMappingCell key={type} type={type} logoUrl={providerLogos[type]} mappedName={pmap[type]} compact />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <button
                                type="button"
                                onClick={() => setVisibleLimit((n) => n + 200)}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                            >
                                Load more <span className="tabular-nums">({hiddenCount})</span>
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Upsert Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className={cn(
                    'max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                            <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                City · {editingCity ? 'Edit' : 'New'}
                                            </span>
                                        </div>
                                        <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                            {editingCity ? 'Edit city' : 'Add city'}
                                        </DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                            Leave a carrier blank to drop its mapping.
                                        </DialogDescription>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { setIsModalOpen(false); setEditingCity(null); }}
                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                        aria-label="Close"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </DialogHeader>

                            <ScrollArea className="min-h-0 flex-1">
                                <div className="px-5 py-4 space-y-5">
                                    {/* Chapter 01 — Identity */}
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-ink" />
                                        <div className="px-4 py-3 border-b border-ant-line">
                                            <div className="flex items-center gap-2">
                                                <span className="font-display text-[10px] text-ant-orange">01</span>
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                    Identity & hub
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Master city name</FormLabel>
                                                        <FormControl>
                                                            <input placeholder="E.g. Casablanca" {...field} className={inputClass} />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="zone_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Hub (zone)</FormLabel>
                                                        <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] focus:ring-2 focus:ring-ant-orange/20">
                                                                    <SelectValue placeholder="Choose a zone" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                                                {zones?.map((zone) => (
                                                                    <SelectItem key={zone.id} value={zone.id} className="text-[12px]">
                                                                        {zone.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </section>

                                    {/* Chapter 02 — Carrier mapping */}
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-orange" />
                                        <div className="px-4 py-3 border-b border-ant-line">
                                            <div className="flex items-center gap-2">
                                                <span className="font-display text-[10px] text-ant-orange">02</span>
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                    Carrier mapping
                                                </span>
                                            </div>
                                            <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                                                Each carrier uses its own identifier for this city.
                                            </p>
                                        </div>
                                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                                            <FormField
                                                control={form.control}
                                                name="ameex_city_code"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            AMEEX <span className="font-mono normal-case text-ant-mid/60">· city</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="City code"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="coliaty_city_name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            Coliaty <span className="font-mono normal-case text-ant-mid/60">· package_city</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="City name"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="ozon_city_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            Ozon <span className="font-mono normal-case text-ant-mid/60">· parcel-city</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="City id"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="quicklivraison_city_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            Quick Livraison <span className="font-mono normal-case text-ant-mid/60">· district_id</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="District id"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="vitex_city_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            VITEX <span className="font-mono normal-case text-ant-mid/60">· city_id</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="City id"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="forcelog_city_id"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                            Forcelog <span className="font-mono normal-case text-ant-mid/60">· city_id</span>
                                                        </FormLabel>
                                                        <FormControl>
                                                            <input
                                                                placeholder="City id"
                                                                {...field}
                                                                value={field.value || ''}
                                                                className={inputClass}
                                                            />
                                                        </FormControl>
                                                        <FormMessage className="text-[10px] text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </section>
                                </div>
                            </ScrollArea>

                            <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                                <button
                                    type="button"
                                    onClick={() => { setIsModalOpen(false); setEditingCity(null); }}
                                    className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={addCityMutation.isPending || updateCityMutation.isPending}
                                    className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                                >
                                    {(addCityMutation.isPending || updateCityMutation.isPending) && (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    )}
                                    {editingCity ? 'Save changes' : 'Create city'}
                                </button>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete alert */}
            <AlertDialog open={!!cityToDelete} onOpenChange={() => setCityToDelete(null)}>
                <AlertDialogContent className={cn(
                    'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                )}>
                    <div className="h-[3px] w-full bg-ant-rose" />
                    <AlertDialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-2">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center text-ant-rose shrink-0">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-rose" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                        City · Delete
                                    </span>
                                </div>
                                <AlertDialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                                    Delete city?
                                </AlertDialogTitle>
                                <AlertDialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    Permanently delete <span className="font-display not-italic text-ant-ink">{cityToDelete?.name}</span>. This cannot be undone.
                                </AlertDialogDescription>
                            </div>
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line">
                        <AlertDialogCancel className="flex-1 h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors mt-0">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => cityToDelete && deleteCityMutation.mutate(cityToDelete.id)}
                            className="flex-1 h-11 px-5 rounded-full bg-ant-rose text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/95 transition-all shadow-[0_10px_24px_-10px_rgba(201,57,66,0.5)]"
                        >
                            {deleteCityMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
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

export default Cities;
