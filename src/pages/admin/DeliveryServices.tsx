import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Globe,
    User,
    Mail,
    Lock,
    AtSign,
    Building2,
    Link as LinkIcon,
    Shield,
    Image as ImageIcon,
    Upload,
    Loader2,
    CheckCircle2,
    ExternalLink,
    MapPin,
    Coins,
    Check,
    RotateCcw
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
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
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

// Types are not yet updated in the generated schema, so we'll use any for table names
const PROVIDERS_TABLE = 'providers' as any;
const USERS_TABLE = 'users' as any;
const COURIER_ZONES_TABLE = 'courier_zones' as any;
const COURIER_FEES_TABLE = 'courier_fees' as any;
const ZONES_TABLE = 'zones' as any;
const CITIES_TABLE = 'master_cities' as any;
const COMPANY_ZONES_TABLE = 'company_zones' as any;
const COMPANY_FEES_TABLE = 'company_fees' as any;

type FeeTableEntity = 'company_id' | 'courier_id';

/** DB enforces master-city fees via a partial unique index; PostgREST upsert on_conflict cannot target it. */
async function saveFeeRowByMasterCity(
    table: string,
    entityKey: FeeTableEntity,
    entityId: string,
    masterCityId: string,
    businessId: string | null,
    fee: number,
    feeColumn: 'fee' | 'return_fee' = 'fee'
) {
    if (!businessId) throw new Error('No active business');
    const match = {
        [entityKey]: entityId,
        master_city_id: masterCityId,
        'DigiCom Business': businessId,
    };
    const { data: existing, error: findErr } = await supabase
        .from(table as typeof COMPANY_FEES_TABLE)
        .select('id')
        .match(match)
        .maybeSingle();
    if (findErr) throw findErr;
    const updated_at = new Date().toISOString();
    if (existing?.id) {
        const { error } = await supabase
            .from(table as typeof COMPANY_FEES_TABLE)
            .update({ [feeColumn]: fee, updated_at } as any)
            .eq('id', existing.id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from(table as typeof COMPANY_FEES_TABLE).insert({
            ...match,
            // Seed the missing column so existing delivery/return fees default sensibly.
            fee: feeColumn === 'fee' ? fee : 0,
            return_fee: feeColumn === 'return_fee' ? fee : 0,
            updated_at,
        } as any);
        if (error) throw error;
    }
}

const POSTGREST_MAX_ROWS = 1000;

async function fetchAllMasterCitiesInZones(zoneIds: string[]) {
    if (!zoneIds.length) return [];
    const all: any[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from(CITIES_TABLE)
            .select('*')
            .in('zone_id', zoneIds)
            .order('name')
            .range(from, from + POSTGREST_MAX_ROWS - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...data);
        if (data.length < POSTGREST_MAX_ROWS) break;
        from += POSTGREST_MAX_ROWS;
    }
    return all;
}

async function fetchAllFeeRowsForEntity(
    table: string,
    entityKey: FeeTableEntity,
    entityId: string,
    businessId: string
) {
    const all: any[] = [];
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from(table as typeof COMPANY_FEES_TABLE)
            .select('*')
            .eq(entityKey, entityId)
            .eq('DigiCom Business', businessId)
            .order('id')
            .range(from, from + POSTGREST_MAX_ROWS - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...data);
        if (data.length < POSTGREST_MAX_ROWS) break;
        from += POSTGREST_MAX_ROWS;
    }
    return all;
}

const KNOWN_PROVIDERS = [
    {
        type: 'ameex',
        name: 'AMEEX',
        logo: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/providers-logos/logos/0.2729560049630101.png`,
        color: '#f97316',
        baseUrl: 'https://api.ameex.app',
        description: 'Full delivery management with tracking, labels, and delivery notes.',
    },
    {
        type: 'coliaty',
        name: 'Coliaty',
        logo: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/providers-logos/logos/0.6419997609504474.png`,
        color: '#10b981',
        baseUrl: 'https://customer-api-v1.coliaty.com',
        description: 'Parcel delivery with pickup notes and real-time status tracking.',
    },
    {
        type: 'ozon',
        name: 'OzonExpress',
        logo: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/providers-logos/logos/0.9436752251055719.png`,
        color: '#ef4444',
        baseUrl: 'https://api.ozonexpress.ma',
        description: 'Express delivery network with multipart parcel creation.',
    },
    {
        type: 'quicklivraison',
        name: 'Quick Livraison',
        logo: 'https://clients.quicklivraison.ma/public/assets/v2/img/Logo-light.png',
        color: '#15803d',
        baseUrl: 'https://clients.quicklivraison.ma/api',
        description: 'Livraison rapide au Maroc. Suivi par polling (pas de webhook, pas de bon de ramassage API).',
    },
    {
        type: 'vitex',
        name: 'VITEX',
        logo: '/providers/Vitex.png',
        color: '#b12a6c',
        baseUrl: 'https://vitex.ma/clients-api',
        description: 'Réseau Vitex (Maroc). API REST Bearer + dashboard session pour options spéciales. Suivi par polling.',
    },
    {
        type: 'forcelog',
        name: 'Forcelog',
        logo: '/providers/Forcelog.png',
        color: '#f2c024',
        baseUrl: 'https://api.forcelog.ma',
        description: 'Forcelog (Maroc). API REST X-API-Key + dashboard session pour fragile/carton/échange. Suivi temps réel via webhook natif.',
    },
];

type ProviderPermissionSlug = 'ameex' | 'coliaty' | 'ozon' | 'quicklivraison' | 'vitex' | 'forcelog';

type ProviderPermissionRow = { key: string; label: string; hint?: string };

const PROVIDER_PERMISSION_ROWS: Record<ProviderPermissionSlug, ProviderPermissionRow[]> = {
    ameex: [
        { key: 'fragile', label: 'Fragile' },
        { key: 'autorisation_ouverture_colis', label: "Autorisation d'ouverture du colis par le client" },
        { key: 'autoriser_essayage', label: "Autoriser l'essayage du produit par le client" },
    ],
    coliaty: [
        { key: 'interdit_ouvrir_colis', label: "Interdit d'ouvrir le colis" },
    ],
    ozon: [
        {
            key: 'ouvrir_colis_autorise',
            label: 'Ouverture du colis par le client',
            hint: 'Activé : ouvrir le colis autorisé. Désactivé : interdit d’ouvrir le colis.',
        },
        { key: 'fragile', label: 'Fragile' },
        { key: 'echange', label: 'Échange' },
    ],
    quicklivraison: [
        { key: 'autorisation_ouverture_colis', label: "Autorisation d'ouverture du colis par le client" },
        { key: 'autoriser_essayage', label: "Autoriser l'essayage du produit par le client" },
        // Fragile intentionally omitted — QL's public API ignores `fragile` in any form.
        // Their dashboard toggle applies the +5 MAD fee via an internal mechanism we can't
        // reach via `/deliveries/store`. Manage fragile per-parcel from the QL dashboard.
    ],
    vitex: [
        { key: 'fragile', label: 'Fragile', hint: 'Facture +5 MAD selon Vitex. Route le colis via le flux dashboard.' },
        { key: 'interdit_ouvrir_colis', label: "Interdit d'ouvrir le colis" },
        // Exchange ("Colis à remplacer") intentionally omitted — Vitex requires the previous parcel
        // to be in status DELIVERED inside their dashboard before allowing replacement, which
        // is impossible to bootstrap before the first delivered Vitex parcel exists.
    ],
    forcelog: [
        { key: 'fragile', label: 'Fragile', hint: 'Facture +5 DH selon Forcelog. Route le colis via le flux dashboard.' },
        { key: 'interdit_ouvrir_colis', label: "Interdit d'ouvrir le colis" },
    ],
};

function normalizePartnerProviderType(raw: string | undefined | null): ProviderPermissionSlug | null {
    const t = (raw || '').toString().toLowerCase().trim();
    if (!t) return null;
    if (t === 'ameex' || t.includes('ameex')) return 'ameex';
    if (t === 'coliaty' || t.includes('coliaty')) return 'coliaty';
    if (t === 'ozon' || t.includes('ozon')) return 'ozon';
    if (t === 'quicklivraison' || t.includes('quicklivraison')) return 'quicklivraison';
    if (t === 'vitex' || t.includes('vitex')) return 'vitex';
    if (t === 'forcelog' || t.includes('forcelog')) return 'forcelog';
    return null;
}

function mapProviderRowToFlags(slug: ProviderPermissionSlug, row: Record<string, unknown>): Record<string, boolean> {
    if (slug === 'coliaty') {
        return {
            interdit_ouvrir_colis: !!row.coliaty_package_no_open,
        };
    }
    if (slug === 'ameex') {
        return {
            fragile: !!row.ameex_parcel_fragile,
            autorisation_ouverture_colis: !!row.ameex_parcel_open,
            autoriser_essayage: !!row.ameex_parcel_try_on,
        };
    }
    if (slug === 'ozon') {
        return {
            ouvrir_colis_autorise: Number(row.ozon_parcel_open) === 1,
            fragile: Number(row.ozon_parcel_fragile) === 1,
            echange: Number(row.ozon_parcel_replace) === 1,
        };
    }
    if (slug === 'quicklivraison') {
        return {
            autorisation_ouverture_colis: !!row.quicklivraison_parcel_open,
            autoriser_essayage: !!row.quicklivraison_parcel_try_on,
        };
    }
    if (slug === 'vitex') {
        return {
            fragile: !!row.vitex_parcel_fragile,
            interdit_ouvrir_colis: !!row.vitex_parcel_open,
        };
    }
    if (slug === 'forcelog') {
        return {
            fragile: !!row.forcelog_parcel_fragile,
            interdit_ouvrir_colis: !!row.forcelog_parcel_open,
        };
    }
    return {};
}

function flagsToProviderParcelUpdate(
    slug: ProviderPermissionSlug,
    flags: Record<string, boolean>
): Record<string, boolean | number> {
    if (slug === 'coliaty') {
        return {
            coliaty_package_no_open: !!flags.interdit_ouvrir_colis,
        };
    }
    if (slug === 'ameex') {
        return {
            ameex_parcel_fragile: !!flags.fragile,
            ameex_parcel_replace: false,
            ameex_parcel_open: !!flags.autorisation_ouverture_colis,
            ameex_parcel_try_on: !!flags.autoriser_essayage,
        };
    }
    if (slug === 'ozon') {
        return {
            ozon_parcel_open: flags.ouvrir_colis_autorise ? 1 : 2,
            ozon_parcel_fragile: flags.fragile ? 1 : 0,
            ozon_parcel_replace: flags.echange ? 1 : 0,
        };
    }
    if (slug === 'quicklivraison') {
        return {
            quicklivraison_parcel_open: !!flags.autorisation_ouverture_colis,
            quicklivraison_parcel_try_on: !!flags.autoriser_essayage,
            // quicklivraison_parcel_fragile intentionally not written — QL's API ignores fragile.
        };
    }
    if (slug === 'vitex') {
        return {
            vitex_parcel_fragile: !!flags.fragile,
            vitex_parcel_open: !!flags.interdit_ouvrir_colis,
        };
    }
    if (slug === 'forcelog') {
        return {
            forcelog_parcel_fragile: !!flags.fragile,
            forcelog_parcel_open: !!flags.interdit_ouvrir_colis,
        };
    }
    return {};
}

// --- Schemas ---

const deliveryPersonSchema = z.object({
    name: z.string().min(2, "Full name required"),
    username: z.string().min(3, "Username required"),
    email: z.string().email("Invalid email"),
    password: z.string().min(6, "Pass must be at least 6 digits").optional().or(z.literal('')),
});

const deliveryCompanySchema = z.object({
    name: z.string().min(2, "Company name required"),
    business_name: z.string().optional().nullable(),
    business_id: z.string().optional().nullable(),
    provider_type: z.string().min(2, "Provider type required"),
    api_key: z.string().optional().nullable(),
    api_login: z.string().optional().nullable(),
    api_password: z.string().optional().nullable(),
    api_base_url: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
    api_public_key: z.string().optional().nullable(),
    api_secret_key: z.string().optional().nullable(),
    active: z.boolean().default(true),
    logo_url: z.string().optional().nullable(),
});

type DeliveryPersonValues = z.infer<typeof deliveryPersonSchema>;
type DeliveryCompanyValues = z.infer<typeof deliveryCompanySchema>;

const DeliveryServices = () => {
    const [activeTab, setActiveTab] = useState<'person' | 'company'>('company');
    const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
    const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ id: string; type: 'company' | 'person'; label: string } | null>(null);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [selectedProviderTemplate, setSelectedProviderTemplate] = useState<typeof KNOWN_PROVIDERS[number] | null>(null);
    const [isZonesModalOpen, setIsZonesModalOpen] = useState(false);
    const [isFeesModalOpen, setIsFeesModalOpen] = useState(false);
    const [isCourierReturnFeesModalOpen, setIsCourierReturnFeesModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [selectedCourier, setSelectedCourier] = useState<any>(null);
    const [selectedCompany, setSelectedCompany] = useState<any>(null);
    const [isCompanyZonesModalOpen, setIsCompanyZonesModalOpen] = useState(false);
    const [isCompanyFeesModalOpen, setIsCompanyFeesModalOpen] = useState(false);
    const [isCompanyReturnFeesModalOpen, setIsCompanyReturnFeesModalOpen] = useState(false);
    const [isProviderPermissionsOpen, setIsProviderPermissionsOpen] = useState(false);
    const [isCourierPermissionsOpen, setIsCourierPermissionsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---

    const { data: deliveryPeople, isLoading: isLoadingPeople } = useQuery({
        queryKey: ['delivery-people', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(USERS_TABLE)
                .select('*')
                .eq('role', 'courier' as any)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data as any[]) || [];
        },
    });

    const { data: companies, isLoading: isLoadingCompanies } = useQuery({
        queryKey: ['providers', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(PROVIDERS_TABLE)
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data as any[]) || [];
        },
    });

    // --- Mutations ---

    // Person Mutations (using edge function as requested to create Auth user)
    const personMutation = useMutation({
        mutationFn: async ({ values, id, action }: { values: DeliveryPersonValues, id?: string, action: 'create' | 'update' }) => {
            const userData = {
                ...values,
                role: 'courier',
                active: true,
                assignment: 0,
                products: [],
                permissions: {}, // Courier uses its own /courier/* routes
                'DigiCom Business': activeBusinessId
            };

            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action,
                    userId: id,
                    userData
                }
            });

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['delivery-people', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setIsPersonModalOpen(false);
            setEditingItem(null);
            toast({ title: "Success", description: "Courier account processed successfully." });
        },
        onError: (err: any) => {
            toast({ title: "Operation failed", description: err.message, variant: "destructive" });
        }
    });

    // Company Mutations (direct to table)
    const companyMutation = useMutation({
        mutationFn: async ({ values, id }: { values: DeliveryCompanyValues, id?: string }) => {
            if (id) {
                const { data, error } = await supabase
                    .from(PROVIDERS_TABLE)
                    .update(values as any)
                    .eq('id', id)
                    .eq('DigiCom Business', activeBusinessId)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase
                    .from(PROVIDERS_TABLE)
                    .insert([{
                        ...values as any,
                        'DigiCom Business': activeBusinessId
                    }])
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['providers', activeBusinessId] });
            setIsCompanyModalOpen(false);
            setEditingItem(null);
            toast({ title: "Success", description: "Delivery company saved." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async ({ id, type }: { id: string, type: 'person' | 'company' }) => {
            if (type === 'person') {
                const { error } = await supabase.functions.invoke('manage-users', {
                    body: { action: 'delete', userId: id }
                });
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from(PROVIDERS_TABLE)
                    .delete()
                    .eq('id', id)
                    .eq('DigiCom Business', activeBusinessId);
                if (error) throw error;
            }
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: [variables.type === 'person' ? 'users' : 'providers', activeBusinessId] });
            toast({ title: "Deleted", description: "Entry removed successfully." });
        }
    });

    // --- Filters ---
    const filteredPeople = deliveryPeople?.filter((p: any) =>
        p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.email?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const filteredCompanies = companies?.filter((c: any) =>
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.business_name?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const connectedTypes = new Set((companies || []).map((c: any) => c.provider_type?.toLowerCase()));
    const availableProviders = KNOWN_PROVIDERS.filter(p => !connectedTypes.has(p.type));
    const allProvidersConnected = availableProviders.length === 0;

    const handleEdit = (item: any, type: 'person' | 'company') => {
        setEditingItem(item);
        setSelectedProviderTemplate(null);
        if (type === 'person') setIsPersonModalOpen(true);
        else setIsCompanyModalOpen(true);
    };

    const handlePickProvider = (provider: typeof KNOWN_PROVIDERS[number]) => {
        setSelectedProviderTemplate(provider);
        setIsPickerOpen(false);
        setEditingItem(null);
        setIsCompanyModalOpen(true);
    };

    const partnerCount = filteredCompanies?.length || 0;
    const courierCount = filteredPeople?.length || 0;
    const addCtaLabel = activeTab === 'person' ? 'New courier' : 'Connect partner';

    return (
        <div className="ant-surface mx-auto max-w-[1440px] px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        Shipping · Network
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Delivery services
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Third-party providers and your in-house couriers — one place to manage zones, fees and permissions.
                    </p>
                </div>
                {(activeTab === 'person' || !allProvidersConnected) && (
                    <Button
                        onClick={() => {
                            setEditingItem(null);
                            if (activeTab === 'person') setIsPersonModalOpen(true);
                            else setIsPickerOpen(true);
                        }}
                        className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium shadow-none gap-2 shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {addCtaLabel}
                    </Button>
                )}
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                <div className="bg-ant-paper px-4 py-3">
                    <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-1 h-1 rounded-full bg-ant-ink shrink-0" aria-hidden />
                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">
                                Connected partners
                            </span>
                        </div>
                        <span className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 bg-ant-ink/10 text-ant-ink">
                            <Building2 className="w-3 h-3" strokeWidth={1.75} />
                        </span>
                    </div>
                    <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2">
                        {(companies?.length || 0).toLocaleString('fr-FR')}
                    </div>
                </div>
                <div className="bg-ant-paper px-4 py-3">
                    <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-1 h-1 rounded-full bg-ant-orange shrink-0" aria-hidden />
                            <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid truncate">
                                In-house couriers
                            </span>
                        </div>
                        <span className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 bg-ant-orange/10 text-ant-orange">
                            <User className="w-3 h-3" strokeWidth={1.75} />
                        </span>
                    </div>
                    <div className="font-display text-[22px] font-semibold text-ant-ink tabular-nums tracking-[-0.02em] leading-none mt-2">
                        {(deliveryPeople?.length || 0).toLocaleString('fr-FR')}
                    </div>
                </div>
            </div>

            {/* Tabs & Search toolbar */}
            <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <TabsList className="h-9 p-0.5 rounded-full bg-ant-paper border border-ant-line gap-0">
                        <TabsTrigger
                            value="company"
                            className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                        >
                            <Building2 className="w-3 h-3" /> Partners
                            <span className="text-[10px] tabular-nums opacity-70">{companies?.length || 0}</span>
                        </TabsTrigger>
                        <TabsTrigger
                            value="person"
                            className="rounded-full px-4 h-8 text-[11.5px] font-medium data-[state=active]:bg-ant-ink data-[state=active]:text-ant-light data-[state=inactive]:text-ant-muted gap-1.5"
                        >
                            <User className="w-3 h-3" /> Couriers
                            <span className="text-[10px] tabular-nums opacity-70">{deliveryPeople?.length || 0}</span>
                        </TabsTrigger>
                    </TabsList>

                    <div className="relative w-full sm:w-[280px]">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                        <Input
                            placeholder={activeTab === 'person' ? 'Search couriers by name…' : 'Search partners by name…'}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-ant-orange focus-visible:ring-offset-0 focus-visible:border-ant-ink/25"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    {isLoadingCompanies ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            <SkeletonCards />
                        </div>
                    ) : partnerCount === 0 ? (
                        <EmptyNetworkState
                            kind="partner"
                            onAdd={() => { setEditingItem(null); setIsPickerOpen(true); }}
                        />
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {filteredCompanies?.map((company) => (
                                <PartnerCard
                                    key={company.id}
                                    company={company}
                                    onEdit={() => handleEdit(company, 'company')}
                                    onZones={() => { setSelectedCompany(company); setIsCompanyZonesModalOpen(true); }}
                                    onFees={() => { setSelectedCompany(company); setIsCompanyFeesModalOpen(true); }}
                                    onReturnFees={() => { setSelectedCompany(company); setIsCompanyReturnFeesModalOpen(true); }}
                                    onPermissions={() => {
                                        setSelectedCourier(null);
                                        setSelectedCompany(company);
                                        setIsProviderPermissionsOpen(true);
                                    }}
                                    onDelete={() => setPendingDelete({ id: company.id, type: 'company', label: company.name || 'Provider' })}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="person" className="mt-0">
                    {isLoadingPeople ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            <SkeletonCards />
                        </div>
                    ) : courierCount === 0 ? (
                        <EmptyNetworkState
                            kind="courier"
                            onAdd={() => { setEditingItem(null); setIsPersonModalOpen(true); }}
                        />
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {filteredPeople?.map((person) => (
                                <CourierCard
                                    key={person.id}
                                    person={person}
                                    onEdit={() => handleEdit(person, 'person')}
                                    onZones={() => { setSelectedCourier(person); setIsZonesModalOpen(true); }}
                                    onFees={() => { setSelectedCourier(person); setIsFeesModalOpen(true); }}
                                    onReturnFees={() => { setSelectedCourier(person); setIsCourierReturnFeesModalOpen(true); }}
                                    onPermissions={() => {
                                        setSelectedCompany(null);
                                        setSelectedCourier(person);
                                        setIsCourierPermissionsOpen(true);
                                    }}
                                    onDelete={() => setPendingDelete({ id: person.id, type: 'person', label: person.name || 'Courier' })}
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* Modals */}
            <ConfirmDialog
                open={!!pendingDelete}
                onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
                kicker={pendingDelete?.type === 'company' ? 'Prestataire · Déconnexion' : 'Coursier · Suppression'}
                title={pendingDelete?.type === 'company' ? 'Déconnecter ce prestataire ?' : 'Supprimer ce coursier ?'}
                description={pendingDelete
                    ? `« ${pendingDelete.label} » sera retiré de votre réseau. Les frais, zones et permissions associés seront effacés. L'action est irréversible.`
                    : undefined}
                confirmLabel="Supprimer"
                loading={deleteMutation.isPending}
                onConfirm={() => {
                    if (!pendingDelete) return;
                    deleteMutation.mutate(
                        { id: pendingDelete.id, type: pendingDelete.type },
                        { onSettled: () => setPendingDelete(null) },
                    );
                }}
            />

            <PersonModal
                isOpen={isPersonModalOpen}
                onClose={() => setIsPersonModalOpen(false)}
                onSubmit={(values) => personMutation.mutate({ values, id: editingItem?.id, action: editingItem ? 'update' : 'create' })}
                initialData={editingItem}
                loading={personMutation.isPending}
            />

            <ProviderPickerModal
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                availableProviders={availableProviders}
                onSelect={handlePickProvider}
            />

            <CompanyModal
                isOpen={isCompanyModalOpen}
                onClose={() => { setIsCompanyModalOpen(false); setSelectedProviderTemplate(null); }}
                onSubmit={(values) => companyMutation.mutate({ values, id: editingItem?.id })}
                initialData={editingItem}
                providerTemplate={selectedProviderTemplate}
                loading={companyMutation.isPending}
            />

            <ZonesModal
                isOpen={isZonesModalOpen}
                onClose={() => setIsZonesModalOpen(false)}
                courier={selectedCourier}
            />

            <FeesModal
                isOpen={isFeesModalOpen}
                onClose={() => setIsFeesModalOpen(false)}
                courier={selectedCourier}
            />

            <FeesModal
                isOpen={isCourierReturnFeesModalOpen}
                onClose={() => setIsCourierReturnFeesModalOpen(false)}
                courier={selectedCourier}
                mode="return"
            />

            <CompanyZonesModal
                isOpen={isCompanyZonesModalOpen}
                onClose={() => setIsCompanyZonesModalOpen(false)}
                company={selectedCompany}
            />

            <CompanyFeesModal
                isOpen={isCompanyFeesModalOpen}
                onClose={() => setIsCompanyFeesModalOpen(false)}
                company={selectedCompany}
            />

            <CompanyFeesModal
                isOpen={isCompanyReturnFeesModalOpen}
                onClose={() => setIsCompanyReturnFeesModalOpen(false)}
                company={selectedCompany}
                mode="return"
            />

            <ProviderPermissionsModal
                isOpen={isProviderPermissionsOpen}
                onClose={() => {
                    setIsProviderPermissionsOpen(false);
                    setSelectedCompany(null);
                    setSelectedCourier(null);
                }}
                company={selectedCompany}
                courier={selectedCourier}
            />

            <CourierPermissionsModal
                isOpen={isCourierPermissionsOpen}
                onClose={() => {
                    setIsCourierPermissionsOpen(false);
                    setSelectedCourier(null);
                }}
                courier={selectedCourier}
            />
        </div>
    );
};

// --- Sub-components ---

// Shared dropdown item styling — keeps every row in the action menu uniform.
const MENU_ITEM_CLASS =
    'rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink data-[highlighted]:bg-ant-line-soft data-[highlighted]:text-ant-ink focus:bg-ant-line-soft focus:text-ant-ink';
const MENU_DESTRUCTIVE_CLASS =
    'rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose data-[highlighted]:bg-ant-rose/10 data-[highlighted]:text-ant-rose focus:bg-ant-rose/10 focus:text-ant-rose';
const MENU_CONTENT_CLASS =
    'rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[200px]';

function CourierCard({ person, onEdit, onZones, onFees, onReturnFees, onPermissions, onDelete }: any) {
    return (
        <Card className="group relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 flex flex-col h-full">
            <div className="h-[3px] bg-ant-orange" />

            <CardHeader className="flex flex-row items-start justify-between p-5 pb-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                        <Avatar className="h-12 w-12 border border-ant-line">
                            <AvatarImage src={person.avatar_url} />
                            <AvatarFallback className="bg-ant-line-soft text-ant-ink text-[13px] font-semibold">
                                {person.name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-ant-green rounded-full ring-2 ring-ant-paper" />
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="font-display text-[15px] font-semibold text-ant-ink leading-tight truncate tracking-[-0.01em]">
                            {person.name}
                        </CardTitle>
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-muted mt-1">
                            <User className="w-2.5 h-2.5 text-ant-mid" strokeWidth={2} />
                            Courier agent
                        </span>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-9 w-9 shrink-0 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className={MENU_CONTENT_CLASS}>
                        <DropdownMenuItem onClick={onEdit} className={MENU_ITEM_CLASS}>
                            <Edit2 className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Edit profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line my-1" />
                        <DropdownMenuItem onClick={onZones} className={MENU_ITEM_CLASS}>
                            <MapPin className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Manage zones
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onFees} className={MENU_ITEM_CLASS}>
                            <Coins className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Set city fees
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onReturnFees} className={MENU_ITEM_CLASS}>
                            <RotateCcw className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Set return fees
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onPermissions} className={MENU_ITEM_CLASS}>
                            <Shield className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line my-1" />
                        <DropdownMenuItem onClick={onDelete} className={MENU_DESTRUCTIVE_CLASS}>
                            <Trash2 className="w-3.5 h-3.5 mr-2.5 shrink-0" /> Terminate agent
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-5 pb-4 pt-1 flex-grow space-y-2">
                <div className="flex items-center gap-2 py-1.5">
                    <Mail className="w-3 h-3 text-ant-mid shrink-0" />
                    <span className="text-[11.5px] text-ant-ink truncate">{person.email}</span>
                </div>
                <div className="flex items-center gap-2 py-1.5">
                    <AtSign className="w-3 h-3 text-ant-mid shrink-0" />
                    <span className="text-[11.5px] text-ant-ink">@{person.username}</span>
                </div>
            </CardContent>

            <div className="flex items-center justify-between gap-2 px-5 py-3 bg-ant-light border-t border-ant-line mt-auto">
                <span className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-ant-mid">Agent ID</span>
                <span className="font-mono text-[10.5px] font-medium text-ant-muted tabular-nums">
                    {person.id.substring(0, 8).toUpperCase()}
                </span>
            </div>
        </Card>
    );
}

function PartnerCard({ company, onEdit, onZones, onFees, onReturnFees, onPermissions, onDelete }: any) {
    const accent = company.color || '#141413';
    return (
        <Card className="group relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper shadow-none hover:border-ant-ink/20 transition-all duration-300 flex flex-col h-full">
            <div className="h-[3px]" style={{ backgroundColor: accent }} />

            <CardHeader className="flex flex-row items-start justify-between p-5 pb-3">
                <div className="flex flex-col gap-3 min-w-0">
                    <div className="h-16 w-16 rounded-xl bg-ant-light border border-ant-line p-2 flex items-center justify-center overflow-hidden shrink-0">
                        {company.logo_url ? (
                            <img src={company.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <Building2 className="w-6 h-6 text-ant-mid" strokeWidth={1.5} />
                        )}
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight tracking-[-0.02em] truncate">
                            {company.name}
                        </CardTitle>
                        <span
                            className="inline-flex items-center gap-1.5 mt-1.5 text-[9.5px] font-medium uppercase tracking-[0.22em] px-2 py-0.5 rounded-full border"
                            style={{
                                backgroundColor: `${accent}14`,
                                color: accent,
                                borderColor: `${accent}30`,
                            }}
                        >
                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: accent }} />
                            {company.provider_type || 'Provider'}
                        </span>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-9 w-9 shrink-0 text-ant-mid hover:text-ant-ink hover:bg-ant-line-soft"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className={MENU_CONTENT_CLASS}>
                        <DropdownMenuItem onClick={onEdit} className={MENU_ITEM_CLASS}>
                            <Edit2 className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> API configuration
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line my-1" />
                        <DropdownMenuItem onClick={onZones} className={MENU_ITEM_CLASS}>
                            <MapPin className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Service zones
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onFees} className={MENU_ITEM_CLASS}>
                            <Coins className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Delivery fees
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onReturnFees} className={MENU_ITEM_CLASS}>
                            <RotateCcw className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Return fees
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onPermissions} className={MENU_ITEM_CLASS}>
                            <Shield className="w-3.5 h-3.5 mr-2.5 shrink-0 text-ant-mid" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line my-1" />
                        <DropdownMenuItem onClick={onDelete} className={MENU_DESTRUCTIVE_CLASS}>
                            <Trash2 className="w-3.5 h-3.5 mr-2.5 shrink-0" /> Delete connection
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-5 pb-4 pt-1 space-y-3 flex-grow">
                <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl overflow-hidden border border-ant-line">
                    <div className="bg-ant-paper px-3 py-2.5">
                        <p className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Legal entity</p>
                        <p className="text-[12px] font-medium text-ant-ink truncate leading-tight mt-1">
                            {company.business_name || '—'}
                        </p>
                    </div>
                    <div className="bg-ant-paper px-3 py-2.5">
                        <p className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">Status</p>
                        <div className="flex items-center gap-1.5 mt-1">
                            <span
                                className={cn(
                                    'w-1.5 h-1.5 rounded-full',
                                    company.active ? 'bg-ant-green' : 'bg-ant-mid',
                                )}
                            />
                            <p
                                className={cn(
                                    'text-[12px] font-medium leading-tight',
                                    company.active ? 'text-ant-green' : 'text-ant-muted',
                                )}
                            >
                                {company.active ? 'Operational' : 'Offline'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 py-2.5 px-3 rounded-xl bg-ant-light border border-ant-line">
                    <div className="w-7 h-7 rounded-md bg-ant-paper border border-ant-line flex items-center justify-center shrink-0">
                        <Shield
                            className={cn(
                                'w-3.5 h-3.5',
                                company.api_key ? 'text-ant-green' : 'text-ant-orange',
                            )}
                            strokeWidth={1.75}
                        />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[9.5px] font-medium text-ant-mid uppercase tracking-[0.22em]">
                            Security
                        </span>
                        <span
                            className={cn(
                                'text-[11.5px] font-medium truncate leading-tight',
                                company.api_key ? 'text-ant-green' : 'text-ant-orange',
                            )}
                        >
                            {company.api_key ? 'AES-256 encrypted' : 'Missing API key'}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function EmptyNetworkState({ kind, onAdd }: { kind: 'partner' | 'courier'; onAdd: () => void }) {
    const Icon = kind === 'courier' ? User : Building2;
    return (
        <div className="rounded-2xl border border-ant-line bg-ant-paper px-6 py-14 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-ant-orange/10 ring-1 ring-ant-orange/20 mb-4">
                <Icon className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
            </div>
            <h3 className="font-display text-[18px] font-semibold text-ant-ink tracking-tight">
                {kind === 'courier' ? 'No couriers yet' : 'No partners connected'}
            </h3>
            <p className="font-serif-display text-[12.5px] text-ant-muted italic mt-1 mb-5 max-w-md mx-auto">
                {kind === 'courier'
                    ? 'Add your in-house delivery agents and configure their zones, fees and permissions.'
                    : 'Connect a third-party delivery provider so you can hand orders off to their network.'}
            </p>
            <Button
                onClick={onAdd}
                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-ant-light text-[12px] font-medium gap-2"
            >
                <Plus className="w-3.5 h-3.5" />
                {kind === 'courier' ? 'Add the first courier' : 'Connect a partner'}
            </Button>
        </div>
    );
}

function PersonModal({ isOpen, onClose, onSubmit, initialData, loading }: any) {
    const form = useForm<DeliveryPersonValues>({
        resolver: zodResolver(deliveryPersonSchema),
        defaultValues: { name: '', username: '', email: '', password: '' }
    });

    React.useEffect(() => {
        if (isOpen && initialData) {
            form.reset({
                name: initialData.name,
                username: initialData.username,
                email: initialData.email,
                password: '',
            });
        } else if (isOpen) {
            form.reset({ name: '', username: '', email: '', password: '' });
        }
    }, [isOpen, initialData, form]);

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-xl p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                            <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">{initialData ? 'Edit Courier' : 'New Delivery Agent'}</DialogTitle>
                            <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic">Create a new authenticated account for your delivery personnel.</DialogDescription>
                        </DialogHeader>
                        <div className="p-10 pt-0 space-y-6">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Full Name</FormLabel>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                        <FormControl><Input placeholder="John Doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold text-base shadow-inner" /></FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <div className="grid grid-cols-2 gap-6">
                                <FormField control={form.control} name="username" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Username</FormLabel>
                                        <div className="relative">
                                            <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                            <FormControl><Input placeholder="j_doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Password</FormLabel>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                            <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-14 pl-12 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Email Address</FormLabel>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                        <FormControl><Input type="email" placeholder="john@company.com" {...field} className="h-14 pl-12 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        <DialogFooter className="px-6 pt-4 pb-6 border-t border-ant-line gap-2">
                            <Button type="submit" disabled={loading} className="w-full bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl h-16 text-lg font-semibold shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] transition-all flex items-center gap-3">
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                                {initialData ? 'Update Account' : 'Confirm & Create Account'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

function ProviderPickerModal({ isOpen, onClose, availableProviders, onSelect }: {
    isOpen: boolean;
    onClose: () => void;
    availableProviders: typeof KNOWN_PROVIDERS;
    onSelect: (provider: typeof KNOWN_PROVIDERS[number]) => void;
}) {
    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                    <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">Connect Provider</DialogTitle>
                    <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic">Select a delivery partner to integrate.</DialogDescription>
                </DialogHeader>

                <div className="px-10 pb-10 space-y-4">
                    {availableProviders.map((provider) => (
                        <div
                            key={provider.type}
                            onClick={() => onSelect(provider)}
                            className="group relative flex items-center gap-5 p-5 rounded-2xl border-2 border-transparent bg-ant-line-soft hover:border-ant-ink/20 hover:shadow-xl cursor-pointer transition-all duration-300"
                        >
                            <div
                                className="h-16 w-16 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 p-2 border border-slate-100"
                                style={{ backgroundColor: `${provider.color}08` }}
                            >
                                <img src={provider.logo} alt={provider.name} className="max-w-full max-h-full object-contain" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-semibold text-ant-ink">{provider.name}</h3>
                                <p className="text-sm text-ant-muted font-medium leading-snug mt-0.5">{provider.description}</p>
                            </div>
                            <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                style={{ backgroundColor: provider.color }}
                            >
                                <Plus className="w-5 h-5 text-white" />
                            </div>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function CompanyModal({ isOpen, onClose, onSubmit, initialData, providerTemplate, loading }: any) {
    const [logo, setLogo] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialData?.logo_url || null);

    const form = useForm<DeliveryCompanyValues>({
        resolver: zodResolver(deliveryCompanySchema),
        defaultValues: {
            name: '',
            business_name: '',
            provider_type: '',
            api_key: '',
            api_login: '',
            api_password: '',
            api_base_url: '',
            api_public_key: '',
            api_secret_key: '',
            active: true,
            logo_url: ''
        }
    });

    React.useEffect(() => {
        if (isOpen && initialData) {
            form.reset(initialData);
            setLogoPreview(initialData.logo_url);
        } else if (isOpen && providerTemplate) {
            form.reset({
                name: providerTemplate.name,
                business_name: '',
                business_id: '',
                provider_type: providerTemplate.type,
                api_key: '',
                api_login: '',
                api_password: '',
                api_base_url: providerTemplate.baseUrl,
                api_public_key: '',
                api_secret_key: '',
                active: true,
                logo_url: providerTemplate.logo,
            });
            setLogoPreview(providerTemplate.logo);
        } else if (isOpen) {
            form.reset({
                name: '',
                business_name: '',
                business_id: '',
                provider_type: '',
                api_key: '',
                api_login: '',
                api_password: '',
                api_base_url: '',
                api_public_key: '',
                api_secret_key: '',
                active: true,
                logo_url: ''
            });
            setLogoPreview(null);
        }
    }, [isOpen, initialData, providerTemplate, form]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        setLogo(file);
        setLogoPreview(URL.createObjectURL(file));
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        multiple: false
    });

    const isTemplateCreate = !initialData && !!providerTemplate;

    const handleFormSubmit = async (values: DeliveryCompanyValues) => {
        const finalValues = { ...values };

        if (logo) {
            const fileExt = logo.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `logos/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('providers-logos')
                .upload(filePath, logo);

            if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage
                    .from('providers-logos')
                    .getPublicUrl(filePath);
                finalValues.logo_url = publicUrl;
            }
        } else if (isTemplateCreate && providerTemplate) {
            finalValues.logo_url = providerTemplate.logo;
        }

        if (isTemplateCreate && providerTemplate) {
            finalValues.provider_type = providerTemplate.type;
            (finalValues as any).color = providerTemplate.color;
        }

        onSubmit(finalValues);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-4xl p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden overflow-y-auto max-h-[90vh]">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)}>
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line flex flex-row items-center justify-between">
                            <div className="space-y-1 flex items-center gap-5">
                                {isTemplateCreate && providerTemplate && (
                                    <div
                                        className="h-14 w-14 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 p-2 border"
                                        style={{ backgroundColor: `${providerTemplate.color}10`, borderColor: `${providerTemplate.color}30` }}
                                    >
                                        <img src={providerTemplate.logo} alt={providerTemplate.name} className="max-w-full max-h-full object-contain" />
                                    </div>
                                )}
                                <div>
                                    <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                                        {initialData ? 'Configure Service' : isTemplateCreate ? `Connect ${providerTemplate?.name}` : 'Connect Delivery Partner'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif-display text-[13px] text-ant-muted italic">
                                        {isTemplateCreate ? `Enter your ${providerTemplate?.name} API credentials below.` : 'Link an external delivery company via API integration.'}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="px-10 pb-10 grid grid-cols-1 md:grid-cols-2 gap-10">
                            {/* Left Column: Basic Info */}
                            <div className="space-y-8">
                                {!isTemplateCreate && (
                                    <div className="space-y-4">
                                        <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Company Branding</FormLabel>
                                        <div {...getRootProps()} className={cn(
                                            "relative group h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden",
                                            logoPreview ? "border-transparent" : "border-ant-ink/10 hover:border-ant-ink/30 bg-ant-line-soft"
                                        )}>
                                            <input {...getInputProps()} />
                                            {logoPreview ? (
                                                <>
                                                    <img src={logoPreview} alt="Preview" className="w-full h-full object-contain p-4" />
                                                    <div className="absolute inset-0 bg-ant-ink/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Upload className="w-8 h-8 text-white" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-center">
                                                    <ImageIcon className="w-10 h-10 text-ant-mid mx-auto mb-2" />
                                                    <p className="text-xs font-bold text-ant-ink/60">Upload Logo</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Display Name</FormLabel>
                                        <FormControl><Input placeholder="Internal Name" {...field} className="h-14 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="business_name" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Registered Business Name</FormLabel>
                                            <FormControl><Input placeholder="Legal Entity" {...field} className="h-14 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="business_id" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Business ID / Tax ID</FormLabel>
                                            <FormControl><Input placeholder="RC / ICE" {...field} className="h-14 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="provider_type" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Provider Type (System)</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="e.g. ameex, coliaty"
                                                    {...field}
                                                    disabled={isTemplateCreate}
                                                    className={cn(
                                                        "h-14 rounded-2xl border-none bg-ant-ink/5 text-ant-ink placeholder:text-ant-mid placeholder:font-medium font-bold shadow-inner px-6",
                                                        isTemplateCreate && "opacity-60 cursor-not-allowed"
                                                    )}
                                                    value={field.value || ''}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="active" render={({ field }) => (
                                        <FormItem className="flex flex-col justify-end">
                                            <div className="h-14 flex items-center gap-3 bg-ant-ink/5 rounded-2xl px-4 border border-transparent shadow-inner cursor-pointer" onClick={() => field.onChange(!field.value)}>
                                                <div className={cn("w-3 h-3 rounded-full transition-all", field.value ? "bg-ant-green shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300")} />
                                                <span className="text-[10px] font-semibold uppercase tracking-widest text-ant-ink">{field.value ? 'Active' : 'Offline'}</span>
                                            </div>
                                        </FormItem>
                                    )} />
                                </div>
                            </div>

                            {/* Right Column: API Keys */}
                            <div className="space-y-8 bg-ant-line-soft p-8 rounded-2xl border border-ant-line">
                                <h4 className="flex items-center gap-3 text-sm font-semibold text-ant-ink uppercase tracking-[0.15em] border-b border-ant-line pb-4">
                                    <Shield className="w-5 h-5 opacity-30" /> Auth & Endpoints
                                </h4>

                                <FormField control={form.control} name="api_base_url" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid leading-none flex items-center gap-2">
                                            <LinkIcon className="w-3 h-3" /> Base Endpoint
                                        </FormLabel>
                                        <FormControl><Input placeholder="https://api.provider.com" {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" /></FormControl>
                                    </FormItem>
                                )} />

                                <div className="space-y-6">
                                    <FormField control={form.control} name="api_key" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Universal API Key</FormLabel>
                                            <FormControl><Input placeholder="Bearer or Secret Token" {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" /></FormControl>
                                        </FormItem>
                                    )} />

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_login" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">API User/Login</FormLabel>
                                                <FormControl><Input placeholder="Username" {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_password" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">API Password</FormLabel>
                                                <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_public_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Public Key</FormLabel>
                                                <FormControl><Input placeholder="pk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_secret_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-semibold uppercase tracking-widest text-ant-mid">Secret Key</FormLabel>
                                                <FormControl><Input type="password" placeholder="sk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-ant-ink/10 rounded-none focus-visible:ring-0 font-bold px-0 text-ant-ink placeholder:text-ant-mid placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>
                                </div>
                                <div className="p-4 rounded-2xl bg-ant-ink/5 border border-ant-ink/10">
                                    <p className="text-[10px] font-bold text-ant-muted leading-relaxed">
                                        Note: These credentials will be used for tracking, status syncing, and automatic delivery note generation.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="px-6 pt-4 pb-6 border-t border-ant-line gap-2">
                            <Button type="submit" disabled={loading} className="w-full bg-ant-ink hover:bg-ant-ink/90 text-white rounded-2xl h-16 text-lg font-semibold shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] transition-all flex items-center justify-center gap-3">
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ExternalLink className="w-6 h-6" />}
                                {initialData ? 'Save Configuration' : isTemplateCreate ? `Connect ${providerTemplate?.name}` : 'Establish Connection'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

function ZonesModal({ isOpen, onClose, courier }: any) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: allZones } = useQuery({
        queryKey: ['zones'],
        queryFn: async () => {
            const { data, error } = await supabase.from(ZONES_TABLE).select('*').order('name');
            if (error) throw error;
            return data || [];
        },
        enabled: isOpen
    });

    const { data: assignedZones, isLoading } = useQuery({
        queryKey: ['courier_zones', courier?.id, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(COURIER_ZONES_TABLE)
                .select('zone_id')
                .eq('courier_id', courier.id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data.map((z: any) => z.zone_id);
        },
        enabled: !!courier?.id && isOpen
    });

    const toggleZone = useMutation({
        mutationFn: async (zoneId: string) => {
            const isAssigned = assignedZones?.includes(zoneId);
            if (isAssigned) {
                await supabase
                    .from(COURIER_ZONES_TABLE)
                    .delete()
                    .eq('courier_id', courier.id)
                    .eq('zone_id', zoneId)
                    .eq('DigiCom Business', activeBusinessId);
            } else {
                await supabase
                    .from(COURIER_ZONES_TABLE)
                    .insert({
                        courier_id: courier.id,
                        zone_id: zoneId,
                        'DigiCom Business': activeBusinessId
                    });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['courier_zones', courier?.id, activeBusinessId] });
            toast({ title: "Updated", description: "Courier's service zones updated." });
        }
    });

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-md p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                    <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] truncate">Service Zones: {courier?.name}</DialogTitle>
                    <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic">Select the geographical areas this courier will cover.</DialogDescription>
                </DialogHeader>

                <div className="p-8 pt-2 space-y-3 max-h-[60vh] overflow-y-auto">
                    {allZones?.map((zone: any) => {
                        const active = assignedZones?.includes(zone.id);
                        return (
                            <div
                                key={zone.id}
                                onClick={() => toggleZone.mutate(zone.id)}
                                className={cn(
                                    "p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group",
                                    active ? "bg-ant-ink border-ant-ink text-white shadow-xl" : "bg-ant-ink/5 border-transparent text-ant-ink hover:bg-ant-ink/10"
                                )}
                            >
                                <span className="font-bold">{zone.name}</span>
                                {active ? <Check className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-ant-ink/20 group-hover:border-ant-ink/40" />}
                            </div>
                        );
                    })}
                </div>

                <div className="p-8 pt-0">
                    <Button onClick={onClose} variant="secondary" className="w-full h-12 rounded-2xl font-semibold">Close Management</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

function FeesModal({ isOpen, onClose, courier, mode = 'delivery' }: any) {
    const feeColumn: 'fee' | 'return_fee' = mode === 'return' ? 'return_fee' : 'fee';
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [fees, setFees] = useState<Record<string, string>>({});
    const [bulkPrice, setBulkPrice] = useState("");

    const { data: cities, isLoading: loadingCities } = useQuery({
        queryKey: ['courier_fees_cities', courier?.id],
        queryFn: async () => {
            const { data: czones } = await supabase.from(COURIER_ZONES_TABLE).select('zone_id').eq('courier_id', courier.id);
            const zoneIds = czones?.map((z: any) => z.zone_id) || [];
            return fetchAllMasterCitiesInZones(zoneIds);
        },
        enabled: !!courier?.id && isOpen
    });

    const { data: savedFees } = useQuery({
        queryKey: ['courier_fees', courier?.id, activeBusinessId, feeColumn],
        queryFn: async () => {
            if (!activeBusinessId) return {};
            const data = await fetchAllFeeRowsForEntity(
                COURIER_FEES_TABLE,
                'courier_id',
                courier.id,
                activeBusinessId
            );
            const feeMap: Record<string, string> = {};
            data.forEach((f: any) => {
                const k = f.master_city_id || f.city_id;
                if (k) feeMap[k] = (f[feeColumn] ?? 0).toString();
            });
            setFees(feeMap);
            return feeMap;
        },
        enabled: !!courier?.id && isOpen
    });

    const saveFee = useMutation({
        mutationFn: async ({ cityId, fee }: { cityId: string, fee: string }) => {
            const numericFee = parseFloat(fee) || 0;
            await saveFeeRowByMasterCity(
                COURIER_FEES_TABLE,
                'courier_id',
                courier.id,
                cityId,
                activeBusinessId,
                numericFee,
                feeColumn
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['courier_fees', courier?.id, activeBusinessId, feeColumn] });
        }
    });

    const handleBulkApply = async () => {
        if (!bulkPrice || !cities) return;

        const numericPrice = parseFloat(bulkPrice);
        if (isNaN(numericPrice)) {
            toast({ title: "Invalid Price", description: "Please enter a valid number", variant: "destructive" });
            return;
        }

        const newFees = { ...fees };
        for (const city of cities) {
            newFees[city.id] = bulkPrice;
        }
        setFees(newFees);

        try {
            for (const city of cities) {
                await saveFeeRowByMasterCity(
                    COURIER_FEES_TABLE,
                    'courier_id',
                    courier.id,
                    city.id,
                    activeBusinessId,
                    numericPrice,
                    feeColumn
                );
            }
            queryClient.invalidateQueries({ queryKey: ['courier_fees', courier?.id, activeBusinessId, feeColumn] });
            toast({ title: "Success", description: `Updated ${cities.length} cities to ${bulkPrice} MAD` });
        } catch {
            toast({ title: "Error", description: "Failed to update bulk fees", variant: "destructive" });
        }
    };

    const title = mode === 'return' ? 'City Return Fees' : 'City Delivery Fees';
    const subtitle = mode === 'return'
        ? `Configure per-city return rates for ${courier?.name}`
        : `Configure per-city rates for ${courier?.name}`;

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-2xl p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">{title}</DialogTitle>
                            <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic flex items-center gap-2 mt-1">
                                <Coins className="w-4 h-4 text-ant-ink" />
                                {subtitle}
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3 p-4 bg-ant-ink/5 rounded-2xl border border-ant-ink/10">
                        <div className="relative flex-1">
                            <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                            <Input
                                placeholder="Unified Price..."
                                value={bulkPrice}
                                onChange={(e) => setBulkPrice(e.target.value)}
                                className="h-12 pl-10 rounded-xl border-none bg-white font-bold text-ant-ink shadow-sm"
                            />
                        </div>
                        <Button onClick={handleBulkApply} className="h-12 px-6 rounded-xl bg-ant-ink text-white font-bold shadow-lg hover:bg-ant-ink/90">
                            Auto Fill All
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-10 pt-4 space-y-4">
                    {loadingCities ? (
                        <div className="flex items-center justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-ant-mid" /></div>
                    ) : cities?.length === 0 ? (
                        <div className="text-center py-20 bg-ant-ink/5 rounded-2xl border border-dashed border-ant-ink/10">
                            <MapPin className="w-12 h-12 text-ant-mid mx-auto mb-4" />
                            <p className="font-bold text-ant-mid">No cities found in assigned zones.</p>
                            <p className="text-xs font-bold text-ant-mid uppercase mt-1">Assign zones first</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {cities?.map((city: any) => (
                                <div key={city.id} className="flex items-center justify-between p-4 rounded-2xl bg-ant-ink/5 border border-ant-line group hover:bg-ant-ink/10 transition-all">
                                    <div>
                                        <p className="font-bold text-ant-ink text-lg">{city.name}</p>
                                        <p className="text-[10px] font-semibold uppercase text-ant-mid tracking-widest mt-0.5">Target Destination</p>
                                    </div>
                                    <div className="relative w-32">
                                        <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                        <Input
                                            value={fees[city.id] || ''}
                                            onChange={(e) => setFees({ ...fees, [city.id]: e.target.value })}
                                            onBlur={(e) =>
                                                saveFee.mutate({ cityId: city.id, fee: e.currentTarget.value })
                                            }
                                            placeholder="0.00"
                                            className="h-12 pl-10 pr-4 rounded-xl border-none bg-white font-semibold text-ant-ink text-right shadow-inner focus-visible:ring-ant-ink/20"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-10 pt-0 shrink-0 bg-ant-paper border-t border-ant-line">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-14 rounded-2xl font-semibold bg-ant-ink text-white shadow-xl shadow-brand-navy/20 hover:bg-ant-ink/90 hover:text-white focus-visible:text-white"
                    >
                        Finish Pricing
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

function CompanyZonesModal({ isOpen, onClose, company }: any) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: allZones } = useQuery({
        queryKey: ['zones'],
        queryFn: async () => {
            const { data, error } = await supabase.from(ZONES_TABLE).select('*').order('name');
            if (error) throw error;
            return data || [];
        },
        enabled: isOpen
    });

    const { data: assignedZones, isLoading } = useQuery({
        queryKey: ['company_zones', company?.id, activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from(COMPANY_ZONES_TABLE)
                .select('zone_id')
                .eq('company_id', company.id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return data.map((z: any) => z.zone_id);
        },
        enabled: !!company?.id && isOpen
    });

    const toggleZone = useMutation({
        mutationFn: async (zoneId: string) => {
            const isAssigned = assignedZones?.includes(zoneId);
            if (isAssigned) {
                await supabase
                    .from(COMPANY_ZONES_TABLE)
                    .delete()
                    .eq('company_id', company.id)
                    .eq('zone_id', zoneId)
                    .eq('DigiCom Business', activeBusinessId);
            } else {
                await supabase
                    .from(COMPANY_ZONES_TABLE)
                    .insert({
                        company_id: company.id,
                        zone_id: zoneId,
                        'DigiCom Business': activeBusinessId
                    });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company_zones', company?.id, activeBusinessId] });
            toast({ title: "Updated", description: "Company service zones updated." });
        }
    });

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-md p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                    <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] truncate">Service Zones: {company?.name}</DialogTitle>
                    <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic">Select the geographical areas this partner will cover.</DialogDescription>
                </DialogHeader>

                <div className="p-8 pt-2 space-y-2 max-h-[60vh] overflow-y-auto">
                    {allZones?.map((zone: any) => {
                        const active = assignedZones?.includes(zone.id);
                        return (
                            <div
                                key={zone.id}
                                onClick={() => toggleZone.mutate(zone.id)}
                                className={cn(
                                    "p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group",
                                    active ? "bg-ant-ink border-ant-ink text-white shadow-xl" : "bg-ant-ink/5 border-transparent text-ant-ink hover:bg-ant-ink/10"
                                )}
                            >
                                <span className="font-bold">{zone.name}</span>
                                {active ? <Check className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-ant-ink/20 group-hover:border-ant-ink/40" />}
                            </div>
                        );
                    })}
                </div>

                <div className="p-8 pt-0">
                    <Button onClick={onClose} variant="secondary" className="w-full h-12 rounded-2xl font-semibold">Close Management</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// ── Courier Permissions Modal ──────────────────────────────────────────────
// Stores the courier's parcel-flag defaults on `users` (courier_parcel_*).
// Each parcel created by the wizard snapshots these flags so labels remain
// consistent even if the courier toggles them later.
function CourierPermissionsModal({
    isOpen,
    onClose,
    courier,
}: {
    isOpen: boolean;
    onClose: () => void;
    courier: any | null;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const [flags, setFlags] = useState<{ fragile: boolean; open: boolean; try_on: boolean }>({
        fragile: false,
        open: false,
        try_on: false,
    });

    const { data: permRow, isLoading } = useQuery({
        queryKey: ['courier_permissions', courier?.id],
        queryFn: async () => {
            if (!courier?.id) return null;
            const { data, error } = await (supabase as any)
                .from('users')
                .select('courier_parcel_fragile, courier_parcel_open, courier_parcel_try_on')
                .eq('id', courier.id)
                .maybeSingle();
            if (error) throw error;
            return data as { courier_parcel_fragile?: boolean; courier_parcel_open?: boolean; courier_parcel_try_on?: boolean } | null;
        },
        enabled: !!courier?.id && isOpen,
    });

    useEffect(() => {
        if (!isOpen) return;
        setFlags({
            fragile: !!permRow?.courier_parcel_fragile,
            open: !!permRow?.courier_parcel_open,
            try_on: !!permRow?.courier_parcel_try_on,
        });
    }, [isOpen, permRow]);

    const savePermissions = useMutation({
        mutationFn: async () => {
            if (!courier?.id) throw new Error('Missing courier');
            const { error } = await (supabase as any)
                .from('users')
                .update({
                    courier_parcel_fragile: flags.fragile,
                    courier_parcel_open: flags.open,
                    courier_parcel_try_on: flags.try_on,
                })
                .eq('id', courier.id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['courier_permissions', courier?.id] });
            queryClient.invalidateQueries({ queryKey: ['delivery-people', activeBusinessId] });
            toast({ title: 'Saved', description: 'Courier parcel permission settings updated.' });
            onClose();
        },
        onError: (err: any) => {
            toast({ title: 'Save failed', description: err?.message || 'Unknown error', variant: 'destructive' });
        },
    });

    const rows = [
        { key: 'fragile' as const, label: 'Fragile', hint: 'Affiche le bandeau « FRAGILE » sur l\'étiquette du colis.' },
        { key: 'open' as const, label: "Autorisation d'ouverture du colis par le client" },
        { key: 'try_on' as const, label: "Autoriser l'essayage du produit par le client" },
    ];

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[85vh] flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line">
                    <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] flex items-center gap-2">
                        <Shield className="w-6 h-6 text-ant-ink/80 shrink-0" />
                        Permissions
                    </DialogTitle>
                    <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-2 text-left">
                        <span className="font-bold text-ant-ink">{courier?.name || 'Courier'}</span>
                        <span className="block mt-1 text-ant-ink/55">Internal courier</span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-8 py-2 min-h-[120px]">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="w-10 h-10 animate-spin text-ant-ink/25" />
                        </div>
                    ) : (
                        <div className="space-y-0">
                            {rows.map((row) => (
                                <div
                                    key={row.key}
                                    className="flex items-start justify-between gap-4 py-4 border-b border-ant-line last:border-b-0"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-ant-ink leading-snug">{row.label}</p>
                                        {row.hint ? (
                                            <p className="text-xs font-medium text-ant-ink/45 mt-1.5 leading-relaxed">
                                                {row.hint}
                                            </p>
                                        ) : null}
                                    </div>
                                    <Switch
                                        className="shrink-0 mt-0.5 data-[state=checked]:bg-ant-ink"
                                        checked={flags[row.key]}
                                        onCheckedChange={(v) => setFlags((prev) => ({ ...prev, [row.key]: v }))}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="px-6 py-4 border-t border-ant-line bg-ant-paper shrink-0 flex-col gap-2 sm:flex-col">
                    <Button
                        type="button"
                        disabled={savePermissions.isPending || isLoading}
                        onClick={() => savePermissions.mutate()}
                        className="w-full h-12 rounded-2xl font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 hover:text-white"
                    >
                        {savePermissions.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save'}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onClose}
                        className="w-full h-12 rounded-2xl font-semibold"
                    >
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ProviderPermissionsModal({
    isOpen,
    onClose,
    company,
    courier,
}: {
    isOpen: boolean;
    onClose: () => void;
    company: any | null;
    courier: any | null;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const providerSlug = useMemo(() => {
        if (!company) return null;
        return normalizePartnerProviderType(company.provider_type);
    }, [company]);

    const rows = providerSlug ? PROVIDER_PERMISSION_ROWS[providerSlug] : null;
    const titleName = company?.name || courier?.name || 'Delivery';

    const [flags, setFlags] = useState<Record<string, boolean>>({});

    const { data: permRow, isLoading: loadingPerm, isError: permError, error: permErr } = useQuery({
        queryKey: ['provider_permissions', company?.id, activeBusinessId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(PROVIDERS_TABLE)
                .select(
                    [
                        'coliaty_package_no_open',
                        'ameex_parcel_open',
                        'ameex_parcel_try_on',
                        'ameex_parcel_fragile',
                        'ozon_parcel_open',
                        'ozon_parcel_fragile',
                        'ozon_parcel_replace',
                        'quicklivraison_parcel_open',
                        'quicklivraison_parcel_try_on',
                        'quicklivraison_parcel_fragile',
                        'vitex_parcel_fragile',
                        'vitex_parcel_open',
                        'forcelog_parcel_fragile',
                        'forcelog_parcel_open',
                    ].join(', ')
                )
                .eq('id', company.id)
                .eq('DigiCom Business', activeBusinessId!)
                .single();
            if (error) throw error;
            return data as Record<string, unknown>;
        },
        enabled: !!company?.id && !!activeBusinessId && isOpen && !!providerSlug,
    });

    useEffect(() => {
        if (!isOpen || !providerSlug || !permRow) return;
        setFlags(mapProviderRowToFlags(providerSlug, permRow));
    }, [isOpen, providerSlug, permRow]);

    useEffect(() => {
        if (permError && isOpen) {
            toast({
                title: 'Could not load permissions',
                description: (permErr as Error)?.message || 'Unknown error',
                variant: 'destructive',
            });
        }
    }, [permError, permErr, isOpen, toast]);

    const savePermissions = useMutation({
        mutationFn: async () => {
            if (!company?.id || !activeBusinessId || !providerSlug) throw new Error('Missing context');
            const patch = flagsToProviderParcelUpdate(providerSlug, flags);
            const { error } = await supabase
                .from(PROVIDERS_TABLE)
                .update(patch as any)
                .eq('id', company.id)
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['providers', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['provider_permissions', company?.id, activeBusinessId] });
            toast({ title: 'Saved', description: 'Parcel permission settings updated.' });
            onClose();
        },
        onError: (err: any) => {
            toast({ title: 'Save failed', description: err?.message || 'Unknown error', variant: 'destructive' });
        },
    });

    const providerLabel =
        providerSlug === 'ameex' ? 'AMEEX'
        : providerSlug === 'coliaty' ? 'Coliaty'
        : providerSlug === 'ozon' ? 'Ozon'
        : providerSlug === 'quicklivraison' ? 'Quick Livraison'
        : providerSlug === 'vitex' ? 'VITEX'
        : null;

    const canSave = !!company && !!rows && !!activeBusinessId && !loadingPerm && !permError;

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[85vh] flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line">
                    <DialogTitle className="font-display text-[20px] font-semibold text-ant-ink tracking-[-0.02em] flex items-center gap-2">
                        <Shield className="w-6 h-6 text-ant-ink/80 shrink-0" />
                        Permissions
                    </DialogTitle>
                    <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic mt-2 text-left">
                        {courier && !company ? (
                            <>
                                <span className="font-bold text-ant-ink">{titleName}</span>
                                <span className="block mt-2 font-medium">
                                    Parcel API flags are defined per carrier. Use Permissions on the AMEEX, Coliaty, or Ozon partner card.
                                </span>
                            </>
                        ) : company ? (
                            <>
                                <span className="font-bold text-ant-ink">{titleName}</span>
                                {providerLabel ? (
                                    <span className="block mt-1 text-ant-ink/55">{providerLabel}</span>
                                ) : null}
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                {company && rows ? (
                    <div className="flex-1 overflow-y-auto px-8 py-2 min-h-[120px]">
                        {loadingPerm ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 className="w-10 h-10 animate-spin text-ant-ink/25" />
                            </div>
                        ) : permError ? (
                            <p className="text-sm font-bold text-ant-ink/55 text-center py-10">
                                Unable to load settings for this partner.
                            </p>
                        ) : (
                            <div className="space-y-0">
                                {rows.map((row) => (
                                    <div
                                        key={row.key}
                                        className="flex items-start justify-between gap-4 py-4 border-b border-ant-line last:border-b-0"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-ant-ink leading-snug">{row.label}</p>
                                            {row.hint ? (
                                                <p className="text-xs font-medium text-ant-ink/45 mt-1.5 leading-relaxed">
                                                    {row.hint}
                                                </p>
                                            ) : null}
                                        </div>
                                        <Switch
                                            className="shrink-0 mt-0.5 data-[state=checked]:bg-ant-ink"
                                            checked={!!flags[row.key]}
                                            onCheckedChange={(v) => setFlags((prev) => ({ ...prev, [row.key]: v }))}
                                            disabled={!canSave}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}

                {company && !rows ? (
                    <div className="px-8 py-10">
                        <p className="text-sm font-bold text-ant-ink/55 text-center leading-relaxed">
                            No toggle set for provider type &ldquo;{String(company.provider_type || 'unknown')}&rdquo;. Supported:
                            AMEEX, Coliaty, Ozon.
                        </p>
                    </div>
                ) : null}

                {courier && !company ? (
                    <div className="px-8 py-6">
                        <p className="text-xs font-semibold text-ant-mid text-center leading-relaxed">
                            When carrier-specific courier fields exist, we can mirror the same toggles here.
                        </p>
                    </div>
                ) : null}

                <DialogFooter className="px-6 py-4 border-t border-ant-line bg-ant-paper shrink-0 flex-col gap-2 sm:flex-col">
                    {company && rows ? (
                        <Button
                            type="button"
                            disabled={!canSave || savePermissions.isPending}
                            onClick={() => savePermissions.mutate()}
                            className="w-full h-12 rounded-2xl font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 hover:text-white"
                        >
                            {savePermissions.isPending ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                'Save'
                            )}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant={company && rows ? 'secondary' : 'default'}
                        onClick={onClose}
                        className={
                            company && rows
                                ? 'w-full h-12 rounded-2xl font-semibold'
                                : 'w-full h-12 rounded-2xl font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 hover:text-white'
                        }
                    >
                        {company && rows ? 'Cancel' : 'Close'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CompanyFeesModal({ isOpen, onClose, company, mode = 'delivery' }: any) {
    const feeColumn: 'fee' | 'return_fee' = mode === 'return' ? 'return_fee' : 'fee';
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [fees, setFees] = useState<Record<string, string>>({});
    const [bulkPrice, setBulkPrice] = useState("");
    const [citySearch, setCitySearch] = useState("");

    useEffect(() => {
        if (!isOpen) setCitySearch("");
    }, [isOpen]);

    const { data: cities, isLoading: loadingCities } = useQuery({
        queryKey: ['company_fees_cities', company?.id],
        queryFn: async () => {
            const { data: czones } = await supabase.from(COMPANY_ZONES_TABLE).select('zone_id').eq('company_id', company.id);
            const zoneIds = czones?.map((z: any) => z.zone_id) || [];
            return fetchAllMasterCitiesInZones(zoneIds);
        },
        enabled: !!company?.id && isOpen
    });

    const { data: savedFees } = useQuery({
        queryKey: ['company_fees', company?.id, activeBusinessId, feeColumn],
        queryFn: async () => {
            if (!activeBusinessId) return {};
            const data = await fetchAllFeeRowsForEntity(
                COMPANY_FEES_TABLE,
                'company_id',
                company.id,
                activeBusinessId
            );
            const feeMap: Record<string, string> = {};
            data.forEach((f: any) => {
                const k = f.master_city_id || f.city_id;
                if (k) feeMap[k] = (f[feeColumn] ?? 0).toString();
            });
            setFees(feeMap);
            return feeMap;
        },
        enabled: !!company?.id && isOpen
    });

    const saveFee = useMutation({
        mutationFn: async ({ cityId, fee }: { cityId: string, fee: string }) => {
            const numericFee = parseFloat(fee) || 0;
            await saveFeeRowByMasterCity(
                COMPANY_FEES_TABLE,
                'company_id',
                company.id,
                cityId,
                activeBusinessId,
                numericFee,
                feeColumn
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company_fees', company?.id, activeBusinessId, feeColumn] });
        }
    });

    const handleBulkApply = async () => {
        if (!bulkPrice || !cities) return;

        const numericPrice = parseFloat(bulkPrice);
        if (isNaN(numericPrice)) {
            toast({ title: "Invalid Price", description: "Please enter a valid number", variant: "destructive" });
            return;
        }

        const newFees = { ...fees };
        for (const city of cities) {
            newFees[city.id] = bulkPrice;
        }
        setFees(newFees);

        try {
            for (const city of cities) {
                await saveFeeRowByMasterCity(
                    COMPANY_FEES_TABLE,
                    'company_id',
                    company.id,
                    city.id,
                    activeBusinessId,
                    numericPrice,
                    feeColumn
                );
            }
            queryClient.invalidateQueries({ queryKey: ['company_fees', company?.id, activeBusinessId, feeColumn] });
            toast({ title: "Success", description: `Updated ${cities.length} cities to ${bulkPrice} MAD` });
        } catch {
            toast({ title: "Error", description: "Failed to update bulk fees", variant: "destructive" });
        }
    };

    const filteredCities = useMemo(() => {
        const list = cities || [];
        const q = citySearch.trim().toLowerCase();
        if (!q) return list;
        return list.filter(
            (c: any) =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.name_ar || '').toLowerCase().includes(q) ||
                (c.region || '').toLowerCase().includes(q)
        );
    }, [cities, citySearch]);

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-2xl p-0 border-none bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="font-display text-[22px] font-semibold text-ant-ink tracking-[-0.02em]">
                                {mode === 'return' ? 'Company Return Fees' : 'Company Delivery Fees'}
                            </DialogTitle>
                            <DialogDescription className="font-serif-display text-[12.5px] text-ant-muted italic flex items-center gap-2 mt-1">
                                <Coins className="w-4 h-4 text-ant-ink" />
                                {mode === 'return'
                                    ? `Configure per-city return rates for ${company?.name}`
                                    : `Configure per-city rates for ${company?.name}`}
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-row items-center gap-2 sm:gap-2.5 p-3 sm:p-3.5 bg-ant-ink/5 rounded-2xl border border-ant-ink/10 min-w-0">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-ink/35 pointer-events-none" />
                            <Input
                                type="search"
                                placeholder="Search cities..."
                                value={citySearch}
                                onChange={(e) => setCitySearch(e.target.value)}
                                className="h-10 pl-9 pr-3 rounded-xl border border-ant-ink/10 bg-white text-sm font-semibold text-ant-ink placeholder:text-ant-ink/35 shadow-sm focus-visible:ring-ant-ink/20"
                            />
                        </div>
                        <div className="relative w-[5.5rem] sm:w-24 shrink-0">
                            <Coins className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                inputMode="decimal"
                                placeholder="Price"
                                value={bulkPrice}
                                onChange={(e) => setBulkPrice(e.target.value)}
                                className="h-10 pl-8 pr-2 rounded-xl border border-ant-ink/10 bg-white text-sm font-bold text-ant-ink text-right shadow-sm focus-visible:ring-ant-ink/20"
                            />
                        </div>
                        <Button
                            type="button"
                            onClick={handleBulkApply}
                            className="h-10 px-2.5 sm:px-3 shrink-0 rounded-xl bg-ant-ink text-white text-[11px] sm:text-xs font-bold shadow-md hover:bg-ant-ink/90 whitespace-nowrap"
                        >
                            Auto Fill All
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-10 pt-4 space-y-4">
                    {loadingCities ? (
                        <div className="flex items-center justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-ant-mid" /></div>
                    ) : cities?.length === 0 ? (
                        <div className="text-center py-20 bg-ant-ink/5 rounded-2xl border border-dashed border-ant-ink/10">
                            <MapPin className="w-12 h-12 text-ant-mid mx-auto mb-4" />
                            <p className="font-bold text-ant-mid">No cities found in assigned zones.</p>
                            <p className="text-xs font-bold text-ant-mid uppercase mt-1">Assign zones first</p>
                        </div>
                    ) : filteredCities.length === 0 ? (
                        <div className="text-center py-16 bg-ant-ink/5 rounded-2xl border border-dashed border-ant-ink/10">
                            <Search className="w-10 h-10 text-ant-ink/25 mx-auto mb-3" />
                            <p className="font-bold text-ant-mid text-sm">No cities match your search</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {filteredCities.map((city: any) => (
                                <div key={city.id} className="flex items-center justify-between p-4 rounded-2xl bg-ant-ink/5 border border-ant-line group hover:bg-ant-ink/10 transition-all">
                                    <div>
                                        <p className="font-bold text-ant-ink text-lg">{city.name}</p>
                                        <p className="text-[10px] font-semibold uppercase text-ant-mid tracking-widest mt-0.5">Target Destination</p>
                                    </div>
                                    <div className="relative w-32">
                                        <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ant-mid" />
                                        <Input
                                            value={fees[city.id] || ''}
                                            onChange={(e) => setFees({ ...fees, [city.id]: e.target.value })}
                                            onBlur={(e) =>
                                                saveFee.mutate({ cityId: city.id, fee: e.currentTarget.value })
                                            }
                                            placeholder="0.00"
                                            className="h-12 pl-10 pr-4 rounded-xl border-none bg-white font-semibold text-ant-ink text-right shadow-inner focus-visible:ring-ant-ink/20"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-10 pt-0 shrink-0 bg-ant-paper border-t border-ant-line">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-14 rounded-2xl font-semibold bg-ant-ink text-white shadow-xl shadow-brand-navy/20 hover:bg-ant-ink/90 hover:text-white focus-visible:text-white"
                    >
                        Finish Pricing
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

function SkeletonCards() {
    return (
        <>
            {[1, 2, 3].map(i => (
                <div key={i} className="h-[240px] rounded-2xl bg-white animate-pulse" />
            ))}
        </>
    );
}

export default DeliveryServices;
