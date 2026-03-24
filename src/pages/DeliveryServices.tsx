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
    Check
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
    fee: number
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
            .update({ fee, updated_at })
            .eq('id', existing.id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from(table as typeof COMPANY_FEES_TABLE).insert({
            ...match,
            fee,
            updated_at,
        });
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
];

type ProviderPermissionSlug = 'ameex' | 'coliaty' | 'ozon';

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
};

function normalizePartnerProviderType(raw: string | undefined | null): ProviderPermissionSlug | null {
    const t = (raw || '').toString().toLowerCase().trim();
    if (!t) return null;
    if (t === 'ameex' || t.includes('ameex')) return 'ameex';
    if (t === 'coliaty' || t.includes('coliaty')) return 'coliaty';
    if (t === 'ozon' || t.includes('ozon')) return 'ozon';
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
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [selectedProviderTemplate, setSelectedProviderTemplate] = useState<typeof KNOWN_PROVIDERS[number] | null>(null);
    const [isZonesModalOpen, setIsZonesModalOpen] = useState(false);
    const [isFeesModalOpen, setIsFeesModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [selectedCourier, setSelectedCourier] = useState<any>(null);
    const [selectedCompany, setSelectedCompany] = useState<any>(null);
    const [isCompanyZonesModalOpen, setIsCompanyZonesModalOpen] = useState(false);
    const [isCompanyFeesModalOpen, setIsCompanyFeesModalOpen] = useState(false);
    const [isProviderPermissionsOpen, setIsProviderPermissionsOpen] = useState(false);
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
                .eq('role', 'delivery person' as any)
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
                role: 'delivery person',
                active: true,
                assignment: 0,
                products: [],
                permissions: { pages: { '/orders': true } }, // Default access
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
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setIsPersonModalOpen(false);
            setEditingItem(null);
            toast({ title: "Success", description: "Delivery person account processed successfully." });
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Delivery Services</h1>
                            <p className="text-gray-500 font-light">Manage your logistics network, couriers, and provider integrations.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            {(activeTab === 'person' || !allProvidersConnected) && (
                                <Button
                                    onClick={() => {
                                        setEditingItem(null);
                                        if (activeTab === 'person') {
                                            setIsPersonModalOpen(true);
                                        } else {
                                            setIsPickerOpen(true);
                                        }
                                    }}
                                    className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2"
                                >
                                    <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                                    Add {activeTab === 'person' ? 'Courier' : 'Partner'}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs & Search */}
            <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <TabsList className="bg-white/50 backdrop-blur-md p-1.5 h-16 rounded-[24px] border border-brand-navy/5 shadow-sm inline-flex">
                        <TabsTrigger
                            value="company"
                            className="rounded-[18px] px-8 h-full data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-xl font-bold transition-all text-base gap-2"
                        >
                            <Building2 className="w-4 h-4" /> Partners
                        </TabsTrigger>
                        <TabsTrigger
                            value="person"
                            className="rounded-[18px] px-8 h-full data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-xl font-bold transition-all text-base gap-2"
                        >
                            <User className="w-4 h-4" /> Couriers
                        </TabsTrigger>
                    </TabsList>

                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/60" />
                        <Input
                            placeholder="Search service..."
                            className="h-16 pl-14 pr-6 rounded-[24px] border-none bg-white shadow-sm font-bold text-brand-navy placeholder:text-muted-foreground/40 focus-visible:ring-brand-navy/10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <TabsContent value="company" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoadingCompanies ? <SkeletonCards /> : filteredCompanies?.map(company => (
                            <PartnerCard
                                key={company.id}
                                company={company}
                                onEdit={() => handleEdit(company, 'company')}
                                onZones={() => { setSelectedCompany(company); setIsCompanyZonesModalOpen(true); }}
                                onFees={() => { setSelectedCompany(company); setIsCompanyFeesModalOpen(true); }}
                                onPermissions={() => {
                                    setSelectedCourier(null);
                                    setSelectedCompany(company);
                                    setIsProviderPermissionsOpen(true);
                                }}
                                onDelete={() => {
                                    if (confirm('Delete provider connection?')) deleteMutation.mutate({ id: company.id, type: 'company' });
                                }}
                            />
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="person" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoadingPeople ? <SkeletonCards /> : filteredPeople?.map(person => (
                            <CourierCard
                                key={person.id}
                                person={person}
                                onEdit={() => handleEdit(person, 'person')}
                                onZones={() => { setSelectedCourier(person); setIsZonesModalOpen(true); }}
                                onFees={() => { setSelectedCourier(person); setIsFeesModalOpen(true); }}
                                onPermissions={() => {
                                    setSelectedCompany(null);
                                    setSelectedCourier(person);
                                    setIsProviderPermissionsOpen(true);
                                }}
                                onDelete={() => {
                                    if (confirm('Delete courier account?')) deleteMutation.mutate({ id: person.id, type: 'person' });
                                }}
                            />
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Modals */}
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
        </div>
    );
};

// --- Sub-components ---

function CourierCard({ person, onEdit, onZones, onFees, onPermissions, onDelete }: any) {
    return (
        <Card className="group relative overflow-hidden border-none bg-white hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.1)] transition-all duration-500 rounded-[32px] border border-slate-100 flex flex-col h-full">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-navy/5 group-hover:bg-brand-navy transition-colors" />

            <CardHeader className="flex flex-row items-start justify-between p-6">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <Avatar className="h-16 w-16 border-2 border-slate-50 shadow-lg">
                            <AvatarImage src={person.avatar_url} />
                            <AvatarFallback className="bg-brand-navy/5 text-brand-navy text-xl font-black">
                                {person.name.substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 border-4 border-white rounded-full shadow-sm" />
                    </div>
                    <div>
                        <CardTitle className="text-xl font-bold text-brand-navy leading-none mb-1.5">{person.name}</CardTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none font-bold text-[10px] uppercase tracking-wider px-2 h-5">
                                Courier Agent
                            </Badge>
                        </div>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-xl h-10 w-10 shrink-0 text-brand-navy/55 hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
                        >
                            <MoreVertical className="w-5 h-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px]">
                        <DropdownMenuItem
                            onClick={onEdit}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Edit2 className="w-4 h-4 mr-3 shrink-0" /> Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onZones}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <MapPin className="w-4 h-4 mr-3 shrink-0" /> Manage Zones
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={onFees}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Coins className="w-4 h-4 mr-3 shrink-0" /> Set City Fees
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={onPermissions}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Shield className="w-4 h-4 mr-3 shrink-0" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onDelete}
                            className="rounded-xl p-3 cursor-pointer font-bold text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700 focus:bg-red-50 focus:text-red-700"
                        >
                            <Trash2 className="w-4 h-4 mr-3 text-red-500" /> Terminate Agent
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-6 pb-6 flex-grow space-y-4">
                <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50/50 border border-slate-100">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Mail className="w-3.5 h-3.5 text-brand-navy/40" />
                        </div>
                        <span className="text-sm font-semibold text-brand-navy truncate">{person.email}</span>
                    </div>
                    <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50/50 border border-slate-100">
                        <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <AtSign className="w-3.5 h-3.5 text-brand-navy/40" />
                        </div>
                        <span className="text-sm font-semibold text-brand-navy">@{person.username}</span>
                    </div>
                </div>
            </CardContent>

            <div className="px-6 py-4 bg-slate-50/30 border-t border-slate-50 mt-auto flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Courier ID</span>
                <span className="text-xs font-mono font-bold text-brand-navy/30">{person.id.substring(0, 8).toUpperCase()}</span>
            </div>
        </Card>
    );
};

function PartnerCard({ company, onEdit, onZones, onFees, onPermissions, onDelete }: any) {
    return (
        <Card className="group relative overflow-hidden border-none bg-white hover:shadow-[0_40px_80px_-15px_rgba(0,0,0,0.1)] transition-all duration-500 rounded-[32px] border border-slate-100 flex flex-col h-full">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-navy/5 group-hover:bg-brand-navy transition-colors" />

            <CardHeader className="flex flex-row items-start justify-between p-6">
                <div className="flex flex-col gap-5">
                    {/* Logo Section - Massive and Clear */}
                    <div className="h-24 w-24 rounded-3xl bg-slate-50 border border-slate-100 p-2 flex items-center justify-center overflow-hidden shadow-inner group-hover:scale-105 transition-transform duration-500">
                        {company.logo_url ? (
                            <img src={company.logo_url} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <div className="flex flex-col items-center gap-1 opacity-20">
                                <Building2 className="w-8 h-8 text-brand-navy" />
                                <span className="text-[8px] font-black uppercase tracking-tighter">No Logo</span>
                            </div>
                        )}
                    </div>

                    <div>
                        <CardTitle className="text-2xl font-black text-brand-navy tracking-tight">{company.name}</CardTitle>
                        <Badge
                            className={cn("mt-1.5 border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg", !company.color && "bg-slate-100 text-slate-500")}
                            style={company.color ? { backgroundColor: `${company.color}20`, color: company.color } : undefined}
                        >
                            {company.provider_type || 'Provider'} System
                        </Badge>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="rounded-xl h-10 w-10 shrink-0 text-brand-navy/55 hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
                        >
                            <MoreVertical className="w-5 h-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px]">
                        <DropdownMenuItem
                            onClick={onEdit}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Edit2 className="w-4 h-4 mr-3 shrink-0" /> API Configurations
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onZones}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <MapPin className="w-4 h-4 mr-3 shrink-0" /> Service Zones
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={onFees}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Coins className="w-4 h-4 mr-3 shrink-0" /> Delivery Fees
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={onPermissions}
                            className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                        >
                            <Shield className="w-4 h-4 mr-3 shrink-0" /> Permissions
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={onDelete}
                            className="rounded-xl p-3 cursor-pointer font-bold text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700 focus:bg-red-50 focus:text-red-700"
                        >
                            <Trash2 className="w-4 h-4 mr-3 text-red-500" /> Delete Connection
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>

            <CardContent className="px-6 pb-8 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Legal Entity</p>
                        <p className="text-sm font-bold text-brand-navy truncate leading-tight">{company.business_name || 'Not Set'}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 relative overflow-hidden">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Network Status</p>
                        <div className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", company.active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300")} />
                            <p className={cn("text-xs font-bold", company.active ? "text-emerald-600" : "text-slate-500")}>
                                {company.active ? 'Operational' : 'Offline'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 py-3 px-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/10 group-hover:bg-brand-navy group-hover:border-brand-navy transition-all duration-300">
                    <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
                        <Shield className="w-4 h-4 text-brand-navy" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-brand-navy/40 uppercase group-hover:text-white/40 transition-colors">Security Layer</span>
                        <span className="text-xs font-bold text-brand-navy group-hover:text-white transition-colors">
                            {company.api_key ? 'AES-256 Encrypted' : 'Config Warning'}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

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
            <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="p-10 pb-6">
                            <DialogTitle className="text-3xl font-black text-brand-navy">{initialData ? 'Edit Courier' : 'New Delivery Agent'}</DialogTitle>
                            <DialogDescription className="text-base font-medium">Create a new authenticated account for your delivery personnel.</DialogDescription>
                        </DialogHeader>
                        <div className="p-10 pt-0 space-y-6">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Full Name</FormLabel>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                        <FormControl><Input placeholder="John Doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold text-base shadow-inner" /></FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <div className="grid grid-cols-2 gap-6">
                                <FormField control={form.control} name="username" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Username</FormLabel>
                                        <div className="relative">
                                            <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                            <FormControl><Input placeholder="j_doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Password</FormLabel>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                            <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Email Address</FormLabel>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                        <FormControl><Input type="email" placeholder="john@company.com" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner" /></FormControl>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        <DialogFooter className="p-10 pt-0">
                            <Button type="submit" disabled={loading} className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-16 text-lg font-black shadow-2xl transition-all flex items-center gap-3">
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
            <DialogContent className="max-w-lg p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <DialogHeader className="p-10 pb-6">
                    <DialogTitle className="text-3xl font-black text-brand-navy">Connect Provider</DialogTitle>
                    <DialogDescription className="text-base font-medium">Select a delivery partner to integrate.</DialogDescription>
                </DialogHeader>

                <div className="px-10 pb-10 space-y-4">
                    {availableProviders.map((provider) => (
                        <div
                            key={provider.type}
                            onClick={() => onSelect(provider)}
                            className="group relative flex items-center gap-5 p-5 rounded-[24px] border-2 border-transparent bg-slate-50 hover:border-brand-navy/20 hover:shadow-xl cursor-pointer transition-all duration-300"
                        >
                            <div
                                className="h-16 w-16 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 p-2 border border-slate-100"
                                style={{ backgroundColor: `${provider.color}08` }}
                            >
                                <img src={provider.logo} alt={provider.name} className="max-w-full max-h-full object-contain" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-black text-brand-navy">{provider.name}</h3>
                                <p className="text-sm text-slate-500 font-medium leading-snug mt-0.5">{provider.description}</p>
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
        let finalValues = { ...values };

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
            <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)}>
                        <DialogHeader className="p-10 pb-6 flex flex-row items-center justify-between">
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
                                    <DialogTitle className="text-3xl font-black text-brand-navy">
                                        {initialData ? 'Configure Service' : isTemplateCreate ? `Connect ${providerTemplate?.name}` : 'Connect Delivery Partner'}
                                    </DialogTitle>
                                    <DialogDescription className="text-base font-medium">
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
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Company Branding</FormLabel>
                                        <div {...getRootProps()} className={cn(
                                            "relative group h-40 rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden",
                                            logoPreview ? "border-transparent" : "border-brand-navy/10 hover:border-brand-navy/30 bg-brand-navy/[0.02]"
                                        )}>
                                            <input {...getInputProps()} />
                                            {logoPreview ? (
                                                <>
                                                    <img src={logoPreview} alt="Preview" className="w-full h-full object-contain p-4" />
                                                    <div className="absolute inset-0 bg-brand-navy/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Upload className="w-8 h-8 text-white" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-center">
                                                    <ImageIcon className="w-10 h-10 text-brand-navy/20 mx-auto mb-2" />
                                                    <p className="text-xs font-bold text-brand-navy/60">Upload Logo</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Display Name</FormLabel>
                                        <FormControl><Input placeholder="Internal Name" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="business_name" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Registered Business Name</FormLabel>
                                            <FormControl><Input placeholder="Legal Entity" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="business_id" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Business ID / Tax ID</FormLabel>
                                            <FormControl><Input placeholder="RC / ICE" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="provider_type" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Provider Type (System)</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="e.g. ameex, coliaty"
                                                    {...field}
                                                    disabled={isTemplateCreate}
                                                    className={cn(
                                                        "h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium font-bold shadow-inner px-6",
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
                                            <div className="h-14 flex items-center gap-3 bg-brand-navy/5 rounded-2xl px-4 border border-transparent shadow-inner cursor-pointer" onClick={() => field.onChange(!field.value)}>
                                                <div className={cn("w-3 h-3 rounded-full transition-all", field.value ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300")} />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-brand-navy">{field.value ? 'Active' : 'Offline'}</span>
                                            </div>
                                        </FormItem>
                                    )} />
                                </div>
                            </div>

                            {/* Right Column: API Keys */}
                            <div className="space-y-8 bg-brand-navy/[0.02] p-8 rounded-[40px] border border-brand-navy/[0.04]">
                                <h4 className="flex items-center gap-3 text-sm font-black text-brand-navy uppercase tracking-[0.15em] border-b border-brand-navy/5 pb-4">
                                    <Shield className="w-5 h-5 opacity-30" /> Auth & Endpoints
                                </h4>

                                <FormField control={form.control} name="api_base_url" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40 leading-none flex items-center gap-2">
                                            <LinkIcon className="w-3 h-3" /> Base Endpoint
                                        </FormLabel>
                                        <FormControl><Input placeholder="https://api.provider.com" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" /></FormControl>
                                    </FormItem>
                                )} />

                                <div className="space-y-6">
                                    <FormField control={form.control} name="api_key" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Universal API Key</FormLabel>
                                            <FormControl><Input placeholder="Bearer or Secret Token" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" /></FormControl>
                                        </FormItem>
                                    )} />

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_login" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">API User/Login</FormLabel>
                                                <FormControl><Input placeholder="Username" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_password" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">API Password</FormLabel>
                                                <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_public_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Public Key</FormLabel>
                                                <FormControl><Input placeholder="pk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_secret_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Secret Key</FormLabel>
                                                <FormControl><Input type="password" placeholder="sk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>
                                </div>
                                <div className="p-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/10">
                                    <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
                                        Note: These credentials will be used for tracking, status syncing, and automatic delivery note generation.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="p-10 pt-0">
                            <Button type="submit" disabled={loading} className="w-full bg-brand-navy hover:bg-brand-navy/90 text-white rounded-2xl h-16 text-lg font-black shadow-2xl transition-all flex items-center justify-center gap-3">
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
            <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <DialogHeader className="p-8 pb-4">
                    <DialogTitle className="text-2xl font-black text-brand-navy truncate">Service Zones: {courier?.name}</DialogTitle>
                    <DialogDescription className="font-bold">Select the geographical areas this courier will cover.</DialogDescription>
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
                                    active ? "bg-brand-navy border-brand-navy text-white shadow-xl" : "bg-brand-navy/5 border-transparent text-brand-navy hover:bg-brand-navy/10"
                                )}
                            >
                                <span className="font-bold">{zone.name}</span>
                                {active ? <Check className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-brand-navy/20 group-hover:border-brand-navy/40" />}
                            </div>
                        );
                    })}
                </div>

                <div className="p-8 pt-0">
                    <Button onClick={onClose} variant="secondary" className="w-full h-12 rounded-2xl font-black">Close Management</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

function FeesModal({ isOpen, onClose, courier }: any) {
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
        queryKey: ['courier_fees', courier?.id, activeBusinessId],
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
                if (k) feeMap[k] = f.fee.toString();
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
                numericFee
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['courier_fees', courier?.id, activeBusinessId] });
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
                    numericPrice
                );
            }
            queryClient.invalidateQueries({ queryKey: ['courier_fees', courier?.id, activeBusinessId] });
            toast({ title: "Success", description: `Updated ${cities.length} cities to ${bulkPrice} MAD` });
        } catch {
            toast({ title: "Error", description: "Failed to update bulk fees", variant: "destructive" });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="p-10 pb-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-3xl font-black text-brand-navy">City Delivery Fees</DialogTitle>
                            <DialogDescription className="font-bold flex items-center gap-2 mt-1">
                                <Coins className="w-4 h-4 text-brand-navy" />
                                Configure per-city rates for {courier?.name}
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3 p-4 bg-brand-navy/5 rounded-2xl border border-brand-navy/10">
                        <div className="relative flex-1">
                            <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                            <Input
                                placeholder="Unified Price..."
                                value={bulkPrice}
                                onChange={(e) => setBulkPrice(e.target.value)}
                                className="h-12 pl-10 rounded-xl border-none bg-white font-bold text-brand-navy shadow-sm"
                            />
                        </div>
                        <Button onClick={handleBulkApply} className="h-12 px-6 rounded-xl bg-brand-navy text-white font-bold shadow-lg hover:bg-brand-navy/90">
                            Auto Fill All
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-10 pt-4 space-y-4">
                    {loadingCities ? (
                        <div className="flex items-center justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-brand-navy/20" /></div>
                    ) : cities?.length === 0 ? (
                        <div className="text-center py-20 bg-brand-navy/5 rounded-[32px] border border-dashed border-brand-navy/10">
                            <MapPin className="w-12 h-12 text-brand-navy/20 mx-auto mb-4" />
                            <p className="font-bold text-brand-navy/40">No cities found in assigned zones.</p>
                            <p className="text-xs font-bold text-brand-navy/20 uppercase mt-1">Assign zones first</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {cities?.map((city: any) => (
                                <div key={city.id} className="flex items-center justify-between p-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/[0.03] group hover:bg-brand-navy/[0.08] transition-all">
                                    <div>
                                        <p className="font-bold text-brand-navy text-lg">{city.name}</p>
                                        <p className="text-[10px] font-black uppercase text-brand-navy/20 tracking-widest mt-0.5">Target Destination</p>
                                    </div>
                                    <div className="relative w-32">
                                        <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                        <Input
                                            value={fees[city.id] || ''}
                                            onChange={(e) => setFees({ ...fees, [city.id]: e.target.value })}
                                            onBlur={(e) =>
                                                saveFee.mutate({ cityId: city.id, fee: e.currentTarget.value })
                                            }
                                            placeholder="0.00"
                                            className="h-12 pl-10 pr-4 rounded-xl border-none bg-white font-black text-brand-navy text-right shadow-inner focus-visible:ring-brand-navy/20"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-10 pt-0 shrink-0 bg-brand-white border-t border-brand-navy/5">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-14 rounded-2xl font-black bg-brand-navy text-white shadow-xl shadow-brand-navy/20 hover:bg-brand-navy/90 hover:text-white focus-visible:text-white"
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
            <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <DialogHeader className="p-8 pb-4">
                    <DialogTitle className="text-2xl font-black text-brand-navy truncate">Service Zones: {company?.name}</DialogTitle>
                    <DialogDescription className="font-bold">Select the geographical areas this partner will cover.</DialogDescription>
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
                                    active ? "bg-brand-navy border-brand-navy text-white shadow-xl" : "bg-brand-navy/5 border-transparent text-brand-navy hover:bg-brand-navy/10"
                                )}
                            >
                                <span className="font-bold">{zone.name}</span>
                                {active ? <Check className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-brand-navy/20 group-hover:border-brand-navy/40" />}
                            </div>
                        );
                    })}
                </div>

                <div className="p-8 pt-0">
                    <Button onClick={onClose} variant="secondary" className="w-full h-12 rounded-2xl font-black">Close Management</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

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
        providerSlug === 'ameex' ? 'AMEEX' : providerSlug === 'coliaty' ? 'Coliaty' : providerSlug === 'ozon' ? 'Ozon' : null;

    const canSave = !!company && !!rows && !!activeBusinessId && !loadingPerm && !permError;

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border-none bg-brand-white rounded-[32px] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
                <DialogHeader className="p-8 pb-4 shrink-0 border-b border-brand-navy/5">
                    <DialogTitle className="text-2xl font-black text-brand-navy flex items-center gap-2">
                        <Shield className="w-6 h-6 text-brand-navy/80 shrink-0" />
                        Permissions
                    </DialogTitle>
                    <DialogDescription className="font-semibold text-brand-navy/70 mt-2 text-left">
                        {courier && !company ? (
                            <>
                                <span className="font-bold text-brand-navy">{titleName}</span>
                                <span className="block mt-2 font-medium">
                                    Parcel API flags are defined per carrier. Use Permissions on the AMEEX, Coliaty, or Ozon partner card.
                                </span>
                            </>
                        ) : company ? (
                            <>
                                <span className="font-bold text-brand-navy">{titleName}</span>
                                {providerLabel ? (
                                    <span className="block mt-1 text-brand-navy/55">{providerLabel}</span>
                                ) : null}
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                {company && rows ? (
                    <div className="flex-1 overflow-y-auto px-8 py-2 min-h-[120px]">
                        {loadingPerm ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 className="w-10 h-10 animate-spin text-brand-navy/25" />
                            </div>
                        ) : permError ? (
                            <p className="text-sm font-bold text-brand-navy/55 text-center py-10">
                                Unable to load settings for this partner.
                            </p>
                        ) : (
                            <div className="space-y-0">
                                {rows.map((row) => (
                                    <div
                                        key={row.key}
                                        className="flex items-start justify-between gap-4 py-4 border-b border-brand-navy/[0.06] last:border-b-0"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-brand-navy leading-snug">{row.label}</p>
                                            {row.hint ? (
                                                <p className="text-xs font-medium text-brand-navy/45 mt-1.5 leading-relaxed">
                                                    {row.hint}
                                                </p>
                                            ) : null}
                                        </div>
                                        <Switch
                                            className="shrink-0 mt-0.5 data-[state=checked]:bg-brand-navy"
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
                        <p className="text-sm font-bold text-brand-navy/55 text-center leading-relaxed">
                            No toggle set for provider type &ldquo;{String(company.provider_type || 'unknown')}&rdquo;. Supported:
                            AMEEX, Coliaty, Ozon.
                        </p>
                    </div>
                ) : null}

                {courier && !company ? (
                    <div className="px-8 py-6">
                        <p className="text-xs font-semibold text-brand-navy/40 text-center leading-relaxed">
                            When carrier-specific courier fields exist, we can mirror the same toggles here.
                        </p>
                    </div>
                ) : null}

                <DialogFooter className="p-8 pt-2 border-t border-brand-navy/5 bg-brand-white shrink-0 flex-col gap-2 sm:flex-col">
                    {company && rows ? (
                        <Button
                            type="button"
                            disabled={!canSave || savePermissions.isPending}
                            onClick={() => savePermissions.mutate()}
                            className="w-full h-12 rounded-2xl font-black bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white"
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
                                ? 'w-full h-12 rounded-2xl font-black'
                                : 'w-full h-12 rounded-2xl font-black bg-brand-navy text-white hover:bg-brand-navy/90 hover:text-white'
                        }
                    >
                        {company && rows ? 'Cancel' : 'Close'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CompanyFeesModal({ isOpen, onClose, company }: any) {
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
        queryKey: ['company_fees', company?.id, activeBusinessId],
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
                if (k) feeMap[k] = f.fee.toString();
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
                numericFee
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['company_fees', company?.id, activeBusinessId] });
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
                    numericPrice
                );
            }
            queryClient.invalidateQueries({ queryKey: ['company_fees', company?.id, activeBusinessId] });
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
            <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="p-10 pb-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-3xl font-black text-brand-navy">Company Delivery Fees</DialogTitle>
                            <DialogDescription className="font-bold flex items-center gap-2 mt-1">
                                <Coins className="w-4 h-4 text-brand-navy" />
                                Configure per-city rates for {company?.name}
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-row items-center gap-2 sm:gap-2.5 p-3 sm:p-3.5 bg-brand-navy/5 rounded-2xl border border-brand-navy/10 min-w-0">
                        <div className="relative flex-1 min-w-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/35 pointer-events-none" />
                            <Input
                                type="search"
                                placeholder="Search cities..."
                                value={citySearch}
                                onChange={(e) => setCitySearch(e.target.value)}
                                className="h-10 pl-9 pr-3 rounded-xl border border-brand-navy/10 bg-white text-sm font-semibold text-brand-navy placeholder:text-brand-navy/35 shadow-sm focus-visible:ring-brand-navy/20"
                            />
                        </div>
                        <div className="relative w-[5.5rem] sm:w-24 shrink-0">
                            <Coins className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/30 pointer-events-none" />
                            <Input
                                inputMode="decimal"
                                placeholder="Price"
                                value={bulkPrice}
                                onChange={(e) => setBulkPrice(e.target.value)}
                                className="h-10 pl-8 pr-2 rounded-xl border border-brand-navy/10 bg-white text-sm font-bold text-brand-navy text-right shadow-sm focus-visible:ring-brand-navy/20"
                            />
                        </div>
                        <Button
                            type="button"
                            onClick={handleBulkApply}
                            className="h-10 px-2.5 sm:px-3 shrink-0 rounded-xl bg-brand-navy text-white text-[11px] sm:text-xs font-bold shadow-md hover:bg-brand-navy/90 whitespace-nowrap"
                        >
                            Auto Fill All
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-10 pt-4 space-y-4">
                    {loadingCities ? (
                        <div className="flex items-center justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-brand-navy/20" /></div>
                    ) : cities?.length === 0 ? (
                        <div className="text-center py-20 bg-brand-navy/5 rounded-[32px] border border-dashed border-brand-navy/10">
                            <MapPin className="w-12 h-12 text-brand-navy/20 mx-auto mb-4" />
                            <p className="font-bold text-brand-navy/40">No cities found in assigned zones.</p>
                            <p className="text-xs font-bold text-brand-navy/20 uppercase mt-1">Assign zones first</p>
                        </div>
                    ) : filteredCities.length === 0 ? (
                        <div className="text-center py-16 bg-brand-navy/5 rounded-[32px] border border-dashed border-brand-navy/10">
                            <Search className="w-10 h-10 text-brand-navy/25 mx-auto mb-3" />
                            <p className="font-bold text-brand-navy/50 text-sm">No cities match your search</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {filteredCities.map((city: any) => (
                                <div key={city.id} className="flex items-center justify-between p-4 rounded-2xl bg-brand-navy/5 border border-brand-navy/[0.03] group hover:bg-brand-navy/[0.08] transition-all">
                                    <div>
                                        <p className="font-bold text-brand-navy text-lg">{city.name}</p>
                                        <p className="text-[10px] font-black uppercase text-brand-navy/20 tracking-widest mt-0.5">Target Destination</p>
                                    </div>
                                    <div className="relative w-32">
                                        <Coins className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                        <Input
                                            value={fees[city.id] || ''}
                                            onChange={(e) => setFees({ ...fees, [city.id]: e.target.value })}
                                            onBlur={(e) =>
                                                saveFee.mutate({ cityId: city.id, fee: e.currentTarget.value })
                                            }
                                            placeholder="0.00"
                                            className="h-12 pl-10 pr-4 rounded-xl border-none bg-white font-black text-brand-navy text-right shadow-inner focus-visible:ring-brand-navy/20"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-10 pt-0 shrink-0 bg-brand-white border-t border-brand-navy/5">
                    <Button
                        type="button"
                        onClick={onClose}
                        className="w-full h-14 rounded-2xl font-black bg-brand-navy text-white shadow-xl shadow-brand-navy/20 hover:bg-brand-navy/90 hover:text-white focus-visible:text-white"
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
                <div key={i} className="h-[240px] rounded-[40px] bg-white animate-pulse" />
            ))}
        </>
    );
}

export default DeliveryServices;
