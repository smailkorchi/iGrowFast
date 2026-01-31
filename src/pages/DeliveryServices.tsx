import React, { useState, useCallback } from 'react';
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
    ExternalLink
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
    const [activeTab, setActiveTab] = useState<'person' | 'company'>('person');
    const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
    const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---

    const { data: deliveryPeople, isLoading: isLoadingPeople } = useQuery({
        queryKey: ['users', 'delivery-person'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(USERS_TABLE)
                .select('*')
                .eq('role', 'delivery person' as any)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data as any[]) || [];
        },
    });

    const { data: companies, isLoading: isLoadingCompanies } = useQuery({
        queryKey: ['providers'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(PROVIDERS_TABLE)
                .select('*')
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
                permissions: { pages: { '/orders': true } } // Default access
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
                const { data, error } = await supabase.from(PROVIDERS_TABLE).update(values as any).eq('id', id).select().single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase.from(PROVIDERS_TABLE).insert([values as any]).select().single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['providers'] });
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
                const { error } = await supabase.from(PROVIDERS_TABLE).delete().eq('id', id);
                if (error) throw error;
            }
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: [variables.type === 'person' ? 'users' : 'providers'] });
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

    const handleEdit = (item: any, type: 'person' | 'company') => {
        setEditingItem(item);
        if (type === 'person') setIsPersonModalOpen(true);
        else setIsCompanyModalOpen(true);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black tracking-tight text-brand-navy">Delivery Services</h1>
                    <p className="text-muted-foreground mt-2 text-lg">Manage your logistics network, couriers, and provider integrations.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => {
                            setEditingItem(null);
                            if (activeTab === 'person') setIsPersonModalOpen(true);
                            else setIsCompanyModalOpen(true);
                        }}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-8 text-base font-bold shadow-2xl shadow-brand-navy/20 transition-all hover:scale-[1.02] active:scale-95 flex items-center gap-3"
                    >
                        <Plus className="w-5 h-5" />
                        Add {activeTab === 'person' ? 'Courier' : 'Partner'}
                    </Button>
                </div>
            </div>

            {/* Tabs & Search */}
            <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <TabsList className="bg-white/50 backdrop-blur-md p-1.5 h-16 rounded-[24px] border border-brand-navy/5 shadow-sm inline-flex">
                        <TabsTrigger
                            value="person"
                            className="rounded-[18px] px-8 h-full data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-xl font-bold transition-all text-base gap-2"
                        >
                            <User className="w-4 h-4" /> Couriers
                        </TabsTrigger>
                        <TabsTrigger
                            value="company"
                            className="rounded-[18px] px-8 h-full data-[state=active]:bg-brand-navy data-[state=active]:text-white data-[state=active]:shadow-xl font-bold transition-all text-base gap-2"
                        >
                            <Building2 className="w-4 h-4" /> Partners
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

                <TabsContent value="person" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoadingPeople ? <SkeletonCards /> : filteredPeople?.map(person => (
                            <CourierCard
                                key={person.id}
                                person={person}
                                onEdit={() => handleEdit(person, 'person')}
                                onDelete={() => {
                                    if (confirm('Delete courier account?')) deleteMutation.mutate({ id: person.id, type: 'person' });
                                }}
                            />
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="company" className="mt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {isLoadingCompanies ? <SkeletonCards /> : filteredCompanies?.map(company => (
                            <PartnerCard
                                key={company.id}
                                company={company}
                                onEdit={() => handleEdit(company, 'company')}
                                onDelete={() => {
                                    if (confirm('Delete provider connection?')) deleteMutation.mutate({ id: company.id, type: 'company' });
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

            <CompanyModal
                isOpen={isCompanyModalOpen}
                onClose={() => setIsCompanyModalOpen(false)}
                onSubmit={(values) => companyMutation.mutate({ values, id: editingItem?.id })}
                initialData={editingItem}
                loading={companyMutation.isPending}
            />
        </div>
    );
};

// --- Sub-components ---

const CourierCard = ({ person, onEdit, onDelete }: any) => {
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
                        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 hover:bg-slate-50">
                            <MoreVertical className="w-5 h-5 text-slate-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px]">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy focus:bg-slate-50">
                            <Edit2 className="w-4 h-4 mr-3" /> Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer font-bold text-red-500 hover:bg-red-50 focus:bg-red-50">
                            <Trash2 className="w-4 h-4 mr-3" /> Terminate Agent
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

const PartnerCard = ({ company, onEdit, onDelete }: any) => {
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
                        <Badge className={cn(
                            "mt-1.5 border-none font-bold text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-lg",
                            company.provider_type?.toLowerCase() === 'ameex' ? "bg-orange-100 text-orange-600" :
                                company.provider_type?.toLowerCase() === 'coliaty' ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                        )}>
                            {company.provider_type} System
                        </Badge>
                    </div>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 hover:bg-slate-50">
                            <MoreVertical className="w-5 h-5 text-slate-400" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[200px]">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer font-bold text-brand-navy focus:bg-slate-50">
                            <Edit2 className="w-4 h-4 mr-3" /> API Configurations
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer font-bold text-red-500 hover:bg-red-50 focus:bg-red-50">
                            <Trash2 className="w-4 h-4 mr-3" /> Delete Connection
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

const PersonModal = ({ isOpen, onClose, onSubmit, initialData, loading }: any) => {
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
                                        <FormControl><Input placeholder="John Doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold text-base shadow-inner" /></FormControl>
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
                                            <FormControl><Input placeholder="j_doe" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner" /></FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Password</FormLabel>
                                        <div className="relative">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                            <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner" /></FormControl>
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
                                        <FormControl><Input type="email" placeholder="john@company.com" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner" /></FormControl>
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

const CompanyModal = ({ isOpen, onClose, onSubmit, initialData, loading }: any) => {
    const [logo, setLogo] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialData?.logo_url || null);

    const form = useForm<DeliveryCompanyValues>({
        resolver: zodResolver(deliveryCompanySchema),
        defaultValues: {
            name: '',
            business_name: '',
            provider_type: 'other',
            api_key: '',
            api_login: '',
            api_password: '',
            api_base_url: 'https://app.ameex.co/api',
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
        } else if (isOpen) {
            form.reset({
                name: '',
                business_name: '',
                business_id: '',
                provider_type: 'other',
                api_key: '',
                api_login: '',
                api_password: '',
                api_base_url: 'https://app.ameex.co/api',
                api_public_key: '',
                api_secret_key: '',
                active: true,
                logo_url: ''
            });
            setLogoPreview(null);
        }
    }, [isOpen, initialData, form]);

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
        }

        onSubmit(finalValues);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)}>
                        <DialogHeader className="p-10 pb-6 flex flex-row items-center justify-between">
                            <div className="space-y-1">
                                <DialogTitle className="text-3xl font-black text-brand-navy">{initialData ? 'Configure Service' : 'Connect Delivery Partner'}</DialogTitle>
                                <DialogDescription className="text-base font-medium">Link an external delivery company via API integration.</DialogDescription>
                            </div>
                        </DialogHeader>

                        <div className="px-10 pb-10 grid grid-cols-1 md:grid-cols-2 gap-10">
                            {/* Left Column: Basic Info */}
                            <div className="space-y-8">
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

                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Display Name</FormLabel>
                                        <FormControl><Input placeholder="Internal Name" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="business_name" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Registered Business Name</FormLabel>
                                            <FormControl><Input placeholder="Legal Entity" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="business_id" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Business ID / Tax ID</FormLabel>
                                            <FormControl><Input placeholder="RC / ICE" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner px-6" value={field.value || ''} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="provider_type" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Provider Type (System)</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. ameex, coliaty, speedaf" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-brand-navy font-bold shadow-inner px-6" value={field.value || ''} />
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
                                        <FormControl><Input placeholder="https://api.provider.com" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" /></FormControl>
                                    </FormItem>
                                )} />

                                <div className="space-y-6">
                                    <FormField control={form.control} name="api_key" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Universal API Key</FormLabel>
                                            <FormControl><Input placeholder="Bearer or Secret Token" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" /></FormControl>
                                        </FormItem>
                                    )} />

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_login" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">API User/Login</FormLabel>
                                                <FormControl><Input placeholder="Username" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_password" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">API Password</FormLabel>
                                                <FormControl><Input type="password" placeholder="••••••••" {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <FormField control={form.control} name="api_public_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Public Key</FormLabel>
                                                <FormControl><Input placeholder="pk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" value={field.value || ''} /></FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={form.control} name="api_secret_key" render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Secret Key</FormLabel>
                                                <FormControl><Input type="password" placeholder="sk_live_..." {...field} className="h-12 bg-transparent border-b-2 border-brand-navy/10 rounded-none focus-visible:ring-0 font-bold px-0 text-brand-navy" value={field.value || ''} /></FormControl>
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
                                {initialData ? 'Save Configuration' : 'Establish Connection'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

const SkeletonCards = () => (
    <>
        {[1, 2, 3].map(i => (
            <div key={i} className="h-[240px] rounded-[40px] bg-white animate-pulse" />
        ))}
    </>
);

export default DeliveryServices;
