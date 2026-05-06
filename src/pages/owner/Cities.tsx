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
import { useForm, type UseFormReturn } from 'react-hook-form';
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
import { cn } from '@/lib/utils';

type ProviderFieldDef = {
    key: 'ameex' | 'coliaty' | 'ozon' | 'quicklivraison' | 'vitex' | 'forcelog' | 'sendit' | 'digylog' | 'delvoexpress';
    label: string;
    ticker: string;
    formField: 'ameex_city_code' | 'coliaty_city_name' | 'ozon_city_id' | 'quicklivraison_city_id' | 'vitex_city_id' | 'forcelog_city_id' | 'sendit_city_id' | 'digylog_city_name' | 'delvoexpress_city_name';
    placeholder: string;
    apiHint: string;
};

const PROVIDER_FIELDS: ProviderFieldDef[] = [
    { key: 'ameex', label: 'AMEEX', ticker: 'AME', formField: 'ameex_city_code', placeholder: 'City code', apiHint: 'city' },
    { key: 'coliaty', label: 'Coliaty', ticker: 'COL', formField: 'coliaty_city_name', placeholder: 'City name', apiHint: 'package_city' },
    { key: 'ozon', label: 'Ozon', ticker: 'OZN', formField: 'ozon_city_id', placeholder: 'City id', apiHint: 'parcel-city' },
    { key: 'quicklivraison', label: 'Quick Livraison', ticker: 'QL', formField: 'quicklivraison_city_id', placeholder: 'District id', apiHint: 'district_id' },
    { key: 'vitex', label: 'VITEX', ticker: 'VTX', formField: 'vitex_city_id', placeholder: 'City id', apiHint: 'city_id' },
    { key: 'forcelog', label: 'Forcelog', ticker: 'FCL', formField: 'forcelog_city_id', placeholder: 'City id', apiHint: 'city_id' },
    { key: 'sendit', label: 'Sendit', ticker: 'SND', formField: 'sendit_city_id', placeholder: 'District id', apiHint: 'district_id' },
    { key: 'digylog', label: 'Digylog', ticker: 'DGY', formField: 'digylog_city_name', placeholder: 'City name', apiHint: 'city' },
    { key: 'delvoexpress', label: 'Delevo Express', ticker: 'DLV', formField: 'delvoexpress_city_name', placeholder: 'City name', apiHint: 'city' },
];

const PROVIDER_ORDER = PROVIDER_FIELDS.map((p) => p.key) as readonly ProviderFieldDef['key'][];
type ProviderKey = ProviderFieldDef['key'];

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
    sendit_city_id: z.string().optional().nullable(),
    digylog_city_name: z.string().optional().nullable(),
    delvoexpress_city_name: z.string().optional().nullable(),
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
    sendit_city_id: '',
    digylog_city_name: '',
    delvoexpress_city_name: '',
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
    const se = by('sendit');
    const dg = by('digylog');
    const dl = by('delvoexpress');
    return {
        name: city.name,
        zone_id: city.zone_id || '',
        ameex_city_code: (am?.provider_city_id || am?.provider_city_name || '').trim() || '',
        coliaty_city_name: (co?.provider_city_name || '').trim() || '',
        ozon_city_id: (oz?.provider_city_id || '').trim() || '',
        quicklivraison_city_id: (ql?.provider_city_id || '').trim() || '',
        vitex_city_id: (vx?.provider_city_id || '').trim() || '',
        forcelog_city_id: (fl?.provider_city_id || '').trim() || '',
        sendit_city_id: (se?.provider_city_id || '').trim() || '',
        digylog_city_name: (dg?.provider_city_name || '').trim() || '',
        delvoexpress_city_name: (dl?.provider_city_name || '').trim() || '',
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
        sendit: null,
        digylog: null,
        delvoexpress: null,
    };
    for (const pc of city.provider_cities || []) {
        const t = String(pc.provider_type || '').toLowerCase() as ProviderKey;
        if (!PROVIDER_ORDER.includes(t) || out[t] != null) continue;
        if (t === 'ameex') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id || nm || null;
        } else if (t === 'coliaty' || t === 'digylog' || t === 'delvoexpress') {
            const nm = (pc.provider_city_name || '').trim();
            out[t] = nm || null;
        } else if (t === 'ozon') {
            const id = (pc.provider_city_id || '').trim();
            const nm = (pc.provider_city_name || '').trim();
            out[t] = id || nm || null;
        } else if (t === 'quicklivraison' || t === 'vitex' || t === 'forcelog' || t === 'sendit') {
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
    v: Pick<CityFormValues, 'ameex_city_code' | 'coliaty_city_name' | 'ozon_city_id' | 'quicklivraison_city_id' | 'vitex_city_id' | 'forcelog_city_id' | 'sendit_city_id' | 'digylog_city_name' | 'delvoexpress_city_name'>
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

    const se = (v.sendit_city_id || '').trim();
    if (se) {
        await upsert('sendit', {
            provider_city_id: se,
            provider_city_name: name || se,
        });
    } else {
        await del('sendit');
    }

    // Digylog uses city NAME only (no ID exposed by their /cities endpoint), Coliaty pattern.
    const dg = (v.digylog_city_name || '').trim();
    if (dg) {
        await upsert('digylog', { provider_city_id: null, provider_city_name: dg });
    } else {
        await del('digylog');
    }

    // Delevo Express also takes city NAME (107 named districts; full names like "Casablanca - Nassim II").
    const dl = (v.delvoexpress_city_name || '').trim();
    if (dl) {
        await upsert('delvoexpress', { provider_city_id: null, provider_city_name: dl });
    } else {
        await del('delvoexpress');
    }
}

function CityCoverageStrip({
    pmap,
}: {
    pmap: Record<ProviderKey, string | null>;
}) {
    const filled = PROVIDER_FIELDS.reduce((n, p) => n + (pmap[p.key] ? 1 : 0), 0);
    const total = PROVIDER_FIELDS.length;

    return (
        <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
                {PROVIDER_FIELDS.map((p) => {
                    const value = pmap[p.key];
                    const isFilled = !!value;
                    return (
                        <span
                            key={p.key}
                            title={`${p.label}${isFilled ? ` · ${value}` : ' — not mapped'}`}
                            className={cn(
                                'inline-flex items-center justify-center h-[22px] min-w-[34px] px-1.5 text-[10px] font-display tracking-[0.08em] uppercase transition-all',
                                isFilled
                                    ? 'bg-ant-ink text-ant-light rounded-[6px]'
                                    : 'border border-dashed border-ant-line text-ant-mid/55 rounded-[6px] bg-ant-paper',
                            )}
                        >
                            {p.ticker}
                        </span>
                    );
                })}
            </div>
            <span
                className={cn(
                    'tabular-nums font-display text-[11px] shrink-0',
                    filled === total
                        ? 'text-ant-green'
                        : filled === 0
                        ? 'text-ant-mid/60'
                        : 'text-ant-orange',
                )}
            >
                {filled}/{total}
            </span>
        </div>
    );
}

function CarrierMappingSection({
    form,
    providerLogos,
    providerSearch,
    setProviderSearch,
}: {
    form: UseFormReturn<CityFormValues>;
    providerLogos: Record<string, string>;
    providerSearch: string;
    setProviderSearch: (v: string) => void;
}) {
    const watched = form.watch();
    const filledCount = PROVIDER_FIELDS.reduce(
        (n, p) => n + (String((watched as Record<string, unknown>)[p.formField] || '').trim() ? 1 : 0),
        0,
    );
    const total = PROVIDER_FIELDS.length;

    const q = providerSearch.trim().toLowerCase();
    const visible = q
        ? PROVIDER_FIELDS.filter(
              (p) =>
                  p.label.toLowerCase().includes(q) ||
                  p.key.toLowerCase().includes(q) ||
                  p.apiHint.toLowerCase().includes(q),
          )
        : PROVIDER_FIELDS;

    const pct = total ? (filledCount / total) * 100 : 0;

    return (
        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <header className="px-5 pt-4 pb-3 space-y-3">
                <div className="flex items-end justify-between gap-3">
                    <div className="space-y-0.5">
                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                            Carrier mapping
                        </span>
                        <h3 className="font-display text-[15px] tracking-[-0.005em] text-ant-ink leading-tight">
                            Identifiers per delivery partner
                        </h3>
                    </div>
                    <div className="flex items-baseline gap-1 shrink-0">
                        <span className="font-display text-[20px] tabular-nums text-ant-ink leading-none">
                            {filledCount}
                        </span>
                        <span className="font-display text-[12px] tabular-nums text-ant-mid leading-none">
                            /{total}
                        </span>
                    </div>
                </div>
                <div className="h-[2px] w-full rounded-full bg-ant-line/60 overflow-hidden">
                    <div
                        className={cn(
                            'h-full transition-all duration-500',
                            pct === 100 ? 'bg-ant-green' : pct === 0 ? 'bg-ant-line' : 'bg-ant-orange',
                        )}
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                    <input
                        type="search"
                        placeholder="Filter carriers…"
                        value={providerSearch}
                        onChange={(e) => setProviderSearch(e.target.value)}
                        className="w-full h-9 pl-9 pr-9 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/15 transition-all"
                    />
                    {providerSearch && (
                        <button
                            type="button"
                            onClick={() => setProviderSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                            aria-label="Clear filter"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </header>

            {visible.length === 0 ? (
                <div className="p-6 text-center font-serif italic text-[12px] text-ant-mid border-t border-ant-line">
                    No carrier matches "{providerSearch}".
                </div>
            ) : (
                <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {visible.map((p) => (
                        <FormField
                            key={p.key}
                            control={form.control}
                            name={p.formField}
                            render={({ field }) => {
                                const filled = !!String(field.value || '').trim();
                                return (
                                    <FormItem
                                        className={cn(
                                            'group relative m-0 rounded-xl border bg-ant-paper transition-all overflow-hidden',
                                            filled
                                                ? 'border-ant-ink/15 bg-ant-light/40'
                                                : 'border-ant-line hover:border-ant-ink/20',
                                        )}
                                    >
                                        <span
                                            aria-hidden
                                            className={cn(
                                                'absolute left-0 top-0 bottom-0 w-[2px] transition-colors',
                                                filled ? 'bg-ant-green' : 'bg-transparent',
                                            )}
                                        />
                                        <div className="p-3 space-y-2.5">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center shrink-0 overflow-hidden">
                                                    {providerLogos[p.key] ? (
                                                        <img
                                                            src={providerLogos[p.key]}
                                                            alt=""
                                                            className="w-full h-full object-contain p-1"
                                                        />
                                                    ) : (
                                                        <span className="font-display text-[9px] tracking-[0.08em] text-ant-mid">
                                                            {p.ticker}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <FormLabel className="block font-display text-[12.5px] text-ant-ink leading-tight truncate cursor-pointer">
                                                        {p.label}
                                                    </FormLabel>
                                                    <p className="font-mono text-[10px] text-ant-mid truncate">
                                                        {p.apiHint}
                                                    </p>
                                                </div>
                                                <span
                                                    className={cn(
                                                        'font-display text-[9px] tracking-[0.08em] uppercase px-1.5 h-[18px] inline-flex items-center rounded shrink-0',
                                                        filled
                                                            ? 'bg-ant-ink text-ant-light'
                                                            : 'border border-dashed border-ant-line text-ant-mid/60',
                                                    )}
                                                >
                                                    {p.ticker}
                                                </span>
                                            </div>
                                            <FormControl>
                                                <input
                                                    placeholder={p.placeholder}
                                                    {...field}
                                                    value={field.value || ''}
                                                    className="w-full h-9 px-3 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/15 transition-all"
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[10px] text-ant-rose" />
                                        </div>
                                    </FormItem>
                                );
                            }}
                        />
                    ))}
                </div>
            )}
        </section>
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
    const [providerSearch, setProviderSearch] = useState('');
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
            // Bundled fallbacks render the logo before the provider is added (cards still show the brand).
            const map: Record<string, string> = {
                ameex: '/providers/Ameex.png',
                coliaty: '/providers/Coliaty.png',
                ozon: '/providers/OZON.png',
                quicklivraison: '/providers/Quick Livraison.png',
                vitex: '/providers/Vitex.png',
                forcelog: '/providers/Forcelog.png',
                sendit: '/providers/Sendit.jpg',
                digylog: '/providers/Digylog.webp',
                delvoexpress: '/providers/Delvo.png',
            };
            for (const row of data || []) {
                const raw = String(row.provider_type || '').trim().toLowerCase();
                const t =
                    raw === 'ozonexpress' || raw === 'ozon_express' ? 'ozon' : raw;
                const url = String(row.logo_url || '').trim();
                if (t && url) map[t] = row.logo_url as string; // DB row overrides the bundled fallback.
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

    useEffect(() => {
        if (!isModalOpen) setProviderSearch('');
    }, [isModalOpen]);

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
                if (filterMapping === 'unmapped') return PROVIDER_ORDER.every((k) => !hasProvider(city, k));
                if (filterMapping.startsWith('missing_')) {
                    const key = filterMapping.slice('missing_'.length) as ProviderKey;
                    if (PROVIDER_ORDER.includes(key)) return !hasProvider(city, key);
                }
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
        const perProvider: Record<ProviderKey, number> = PROVIDER_FIELDS.reduce(
            (acc, p) => ({ ...acc, [p.key]: 0 }),
            {} as Record<ProviderKey, number>,
        );
        let withHub = 0;
        let fullyMapped = 0;
        for (const city of list) {
            if (city.zone_id) withHub++;
            if (allMap(city)) fullyMapped++;
            for (const p of PROVIDER_FIELDS) {
                if (hasProv(city, p.key)) perProvider[p.key]++;
            }
        }
        const total = list.length;
        return {
            total,
            withHub,
            noHub: total - withHub,
            fullyMapped,
            missingProviders: total - fullyMapped,
            perProvider,
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

            {/* Snapshot panel — KPIs + per-carrier coverage as hairline bars */}
            {!isLoading && cities != null && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr]">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 divide-x divide-ant-line border-b lg:border-b-0 lg:border-r border-ant-line">
                            <KpiBlock label="Total cities" value={cityCatalogStats.total} />
                            <KpiBlock
                                label="Fully mapped"
                                value={cityCatalogStats.fullyMapped}
                                hint={cityCatalogStats.total > 0
                                    ? `${Math.round((cityCatalogStats.fullyMapped / cityCatalogStats.total) * 100)}%`
                                    : undefined}
                                tone={cityCatalogStats.fullyMapped === cityCatalogStats.total ? 'green' : 'orange'}
                            />
                        </div>
                        {/* Per-carrier coverage bars */}
                        <div className="p-4 sm:p-5">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Carrier coverage
                                </span>
                                <span className="font-serif italic text-[11px] text-ant-mid">
                                    {cityCatalogStats.withHub} of {cityCatalogStats.total} linked to a hub
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                                {PROVIDER_FIELDS.map((p) => {
                                    const count = cityCatalogStats.perProvider[p.key];
                                    const pct = cityCatalogStats.total > 0
                                        ? Math.round((count / cityCatalogStats.total) * 100)
                                        : 0;
                                    return (
                                        <div key={p.key} className="flex items-center gap-3 min-w-0">
                                            <span className="font-display text-[10px] tracking-[0.08em] uppercase text-ant-ink w-9 shrink-0">
                                                {p.ticker}
                                            </span>
                                            <div className="h-1 flex-1 rounded-full bg-ant-line/60 overflow-hidden min-w-0">
                                                <div
                                                    className={cn(
                                                        'h-full rounded-full transition-all',
                                                        pct >= 95 ? 'bg-ant-green' : pct >= 50 ? 'bg-ant-ink' : 'bg-ant-orange',
                                                    )}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <span className="font-display text-[11px] tabular-nums text-ant-ink w-10 shrink-0 text-right">
                                                {pct}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>
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
                        <SelectItem value="unmapped" className="text-[12px]">Unmapped</SelectItem>
                        {PROVIDER_FIELDS.map((p) => (
                            <SelectItem key={p.key} value={`missing_${p.key}`} className="text-[12px]">
                                Missing {p.label}
                            </SelectItem>
                        ))}
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
                    <div className="max-h-[min(70vh,720px)] overflow-y-auto overscroll-contain">
                        <table className="w-full caption-bottom text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-ant-line">
                                    <th scope="col" className="sticky top-0 z-20 h-11 px-5 py-2 text-left align-middle text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid bg-ant-paper/95 backdrop-blur w-[36%]">
                                        City
                                    </th>
                                    <th scope="col" className="sticky top-0 z-20 h-11 px-4 py-2 text-left align-middle text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid bg-ant-paper/95 backdrop-blur">
                                        Carrier coverage
                                    </th>
                                    {isOwner && (
                                        <th scope="col" className="sticky top-0 z-20 h-11 px-4 py-2 text-right align-middle text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid bg-ant-paper/95 backdrop-blur w-[110px]">
                                            <span className="sr-only">Actions</span>
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {visibleCities.map((city) => {
                                    const pmap = buildProviderMap(city);
                                    const hub = (city.zones as { name?: string } | null)?.name;
                                    return (
                                        <tr
                                            key={city.id}
                                            className="group border-b border-ant-line last:border-b-0 transition-colors hover:bg-ant-light/50 cursor-pointer"
                                            onClick={() => isOwner && (setEditingCity(city), form.reset(cityToFormDefaults(city)), setIsModalOpen(true))}
                                        >
                                            <td className="align-middle px-5 py-3.5 min-w-0">
                                                <div className="min-w-0">
                                                    <span className="font-display text-[9px] uppercase tracking-[0.22em] text-ant-mid block truncate">
                                                        {hub || <span className="font-serif italic normal-case tracking-normal">Unassigned hub</span>}
                                                    </span>
                                                    <p className="font-display text-[15px] text-ant-ink leading-tight truncate mt-0.5">
                                                        {city.name}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="align-middle px-4 py-3.5 min-w-0">
                                                <CityCoverageStrip pmap={pmap} />
                                            </td>
                                            {isOwner && (
                                                <td className="align-middle px-4 py-3.5 w-[110px]" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
                            const filledCount = PROVIDER_FIELDS.reduce((n, p) => n + (pmap[p.key] ? 1 : 0), 0);
                            const total = PROVIDER_FIELDS.length;
                            const pct = total ? (filledCount / total) * 100 : 0;
                            return (
                                <div
                                    key={city.id}
                                    className="group relative rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/30 hover:shadow-[0_12px_28px_-18px_rgba(20,20,19,0.45)] transition-all flex flex-col cursor-pointer"
                                    onClick={() => isOwner && (setEditingCity(city), form.reset(cityToFormDefaults(city)), setIsModalOpen(true))}
                                >
                                    <div className="px-4 pt-4 pb-3 flex flex-col gap-3 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <span className="font-display text-[9px] uppercase tracking-[0.22em] text-ant-mid block truncate">
                                                    {hub || <span className="font-serif italic normal-case tracking-normal">Unassigned hub</span>}
                                                </span>
                                                <p className="font-display text-[16px] text-ant-ink truncate leading-tight mt-0.5">
                                                    {city.name}
                                                </p>
                                            </div>
                                            {isOwner && (
                                                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                                        <div className="pt-3 border-t border-ant-line">
                                            <CityCoverageStrip pmap={pmap} />
                                        </div>
                                    </div>
                                    <div className="h-[3px] w-full bg-ant-line/60 overflow-hidden">
                                        <div
                                            className={cn(
                                                'h-full transition-all duration-500',
                                                pct === 100 ? 'bg-ant-green' : pct === 0 ? 'bg-ant-line' : 'bg-ant-orange',
                                            )}
                                            style={{ width: `${pct}%` }}
                                        />
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

                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                                <div className="px-5 py-5 space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                                    <CarrierMappingSection
                                        form={form}
                                        providerLogos={providerLogos}
                                        providerSearch={providerSearch}
                                        setProviderSearch={setProviderSearch}
                                    />
                                </div>
                            </div>

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

function KpiBlock({
    label,
    value,
    hint,
    tone = 'ink',
}: {
    label: string;
    value: number;
    hint?: string;
    tone?: 'ink' | 'green' | 'orange';
}) {
    return (
        <div className="px-5 py-5 flex flex-col gap-2 bg-ant-paper">
            <span className="font-display text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                {label}
            </span>
            <div className="flex items-baseline gap-2">
                <p className="font-display text-[28px] md:text-[32px] leading-none tabular-nums text-ant-ink">
                    {value.toLocaleString('fr-MA')}
                </p>
                {hint && (
                    <span
                        className={cn(
                            'font-display text-[12px] tabular-nums',
                            tone === 'green'
                                ? 'text-ant-green'
                                : tone === 'orange'
                                ? 'text-ant-orange'
                                : 'text-ant-mid',
                        )}
                    >
                        {hint}
                    </span>
                )}
            </div>
        </div>
    );
}

export default Cities;
