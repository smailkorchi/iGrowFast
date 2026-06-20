import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Shield,
    Mail,
    User as UserIcon,
    Check,
    Loader2,
    Upload,
    Home,
    ShoppingBag,
    FileText,
    Repeat,
    Globe,
    CreditCard,
    BarChart2,
    Megaphone,
    Users as UsersGroupIcon,
    Zap,
    Target,
    Building2,
    Calculator,
    FileSpreadsheet,
    Receipt,
    ClipboardList,
    PackageCheck,
    MessageSquare,
    DollarSign,
    Store,
    Puzzle,
    LayoutDashboard,
    List,
    Tag,
    ArrowRightLeft,
    Box,
    UserPlus,
    Wallet,
    Crown,
    Headphones,
    Bike,
    Sparkles,
    Power,
    PowerOff,
    KeyRound,
    type LucideIcon,
} from 'lucide-react';

// Roles whose job has admin-configurable settings → get an Edit button.
// super admin / courier / others have nothing to configure here (enable/disable + delete only).
const EDITABLE_ROLES = ['admin', 'commercial', 'mediabuyer'];
const hasEditableConfig = (role: unknown) => EDITABLE_ROLES.includes(String(role || '').toLowerCase());
const firstConfigTab = (role: unknown): 'permissions' | 'performance' | 'payment' => {
    const r = String(role || '').toLowerCase();
    if (r === 'admin') return 'permissions';
    if (r === 'mediabuyer') return 'payment';
    return 'performance'; // commercial
};
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
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserAvatar } from '@/components/users/UserAvatar';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FaWhatsapp } from 'react-icons/fa';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import { InviteUserWizard } from '@/components/users/InviteUserWizard';
import { InvitationsPanel } from '@/components/users/InvitationsPanel';
import { requestCredentialChange } from '@/lib/credentialChange';

const userSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal('')),
    role: z.enum(['super admin', 'admin', 'commercial', 'courier', 'mediabuyer']),
    assignment: z.number().default(0),
    commission_price: z.number().default(0),
    commission_basis: z.enum(['per_order', 'per_unit']).default('per_order'),
    payment_type: z.enum(['commission', 'salary']).default('commission'),
    salary_amount: z.number().default(0),
    phone: z.string().optional().or(z.literal('')),
    products: z.array(z.string()).default([]),
    active: z.boolean().default(true),
    permissions: z.record(z.any()).default({}),
    avatar_url: z.string().optional().nullable(),
    whatsapp_access: z.object({
        mode: z.enum(['none', 'all', 'specific']).default('none'),
        instance_ids: z.array(z.string()).default([]),
    }).default({ mode: 'none', instance_ids: [] }),
    // Mediabuyer integration scoping — which GA properties / Meta ad accounts they may see.
    ga_access: z.object({
        mode: z.enum(['none', 'all', 'specific']).default('none'),
        ids: z.array(z.string()).default([]),
    }).default({ mode: 'none', ids: [] }),
    meta_access: z.object({
        mode: z.enum(['none', 'all', 'specific']).default('none'),
        ids: z.array(z.string()).default([]),
    }).default({ mode: 'none', ids: [] }),
});

type UserFormValues = z.infer<typeof userSchema>;

type UserModalInitialData = Partial<UserFormValues> & {
    id?: string;
    avatar_url?: string | null;
};

// Reusable picker for a mediabuyer's GA / Meta access (mode none/all/specific + checkboxes).
const IntegrationAccessField: React.FC<{
    control: any;
    name: 'ga_access' | 'meta_access';
    title: string;
    hint: string;
    conns: any[] | undefined;
    primaryKey: string;   // display label field
    secondaryKey: string; // mono sub-label field (property_id / ad_account_id)
    emptyText: string;
}> = ({ control, name, title, hint, conns, primaryKey, secondaryKey, emptyText }) => {
    const modes: Array<['none' | 'all' | 'specific', string]> = [['none', 'No access'], ['all', 'All'], ['specific', 'Specific']];
    return (
        <FormField
            control={control}
            name={name as any}
            render={({ field }: any) => {
                const access = field.value || { mode: 'none', ids: [] };
                const setMode = (mode: 'none' | 'all' | 'specific') =>
                    field.onChange({ mode, ids: mode === 'specific' ? (access.ids || []) : [] });
                const toggle = (id: string) => {
                    const cur: string[] = access.ids || [];
                    field.onChange({ mode: 'specific', ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
                };
                return (
                    <FormItem className="space-y-3 rounded-2xl border border-ant-line bg-ant-paper p-5">
                        <div className="space-y-0.5">
                            <FormLabel className="font-display text-[14px] font-semibold text-ant-ink block">{title}</FormLabel>
                            <p className="font-serif italic text-[12px] text-ant-mid leading-snug">{hint}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {modes.map(([m, lbl]) => (
                                <button
                                    type="button"
                                    key={m}
                                    onClick={() => setMode(m)}
                                    className={cn(
                                        'h-9 px-3.5 rounded-full text-[11px] font-semibold border transition cursor-pointer',
                                        access.mode === m ? 'bg-ant-ink text-white border-ant-ink shadow-sm'
                                            : 'border-ant-line text-ant-mid hover:text-ant-ink hover:border-ant-ink/30',
                                    )}
                                >
                                    {lbl}
                                </button>
                            ))}
                        </div>
                        {access.mode === 'specific' && (
                            <div className="grid grid-cols-1 gap-1.5 pt-1">
                                {!conns?.length ? (
                                    <p className="font-serif italic text-[12px] text-ant-mid">{emptyText}</p>
                                ) : (
                                    conns.map((c: any) => {
                                        const on = (access.ids || []).includes(c.id);
                                        return (
                                            <button
                                                type="button"
                                                key={c.id}
                                                onClick={() => toggle(c.id)}
                                                className={cn('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer',
                                                    on ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line hover:border-ant-ink/20')}
                                            >
                                                <span className={cn('w-4 h-4 rounded-md flex items-center justify-center shrink-0 border',
                                                    on ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line')}>
                                                    {on && <Check className="w-3 h-3" />}
                                                </span>
                                                <span className="text-[12px] text-ant-ink truncate">
                                                    {c[primaryKey] || c[secondaryKey]} <span className="text-ant-mid">· {c[secondaryKey]}</span>
                                                </span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </FormItem>
                );
            }}
        />
    );
};

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: UserFormValues) => void;
    initialData?: UserModalInitialData;
    loading?: boolean;
    title: string;
    activeBusinessId: string | null;
}

const pages = [
    { label: 'Dashboard', path: '/', icon: Home },
    { label: 'Orders', path: '/orders', icon: ShoppingBag },
    { label: 'Delivery Note', path: '/delivery-note', icon: FileText },
    { label: 'Return Note', path: '/return-note', icon: Repeat },
    { label: 'Delivery Services', path: '/delivery-services', icon: Globe },
    { label: 'Payments', path: '/payments', icon: CreditCard },
    { label: 'Webhooks', path: '/webhooks', icon: Zap },
    { label: 'Transactions', path: '/transactions', icon: ArrowRightLeft },
    { label: 'Products', path: '/products', icon: Box },
    { label: 'Accessories', path: '/accessories', icon: Puzzle },
    { label: 'Analytics', path: '/analytics', icon: BarChart2 },
    { label: 'Sales Channels', path: '/sales-channels', icon: Megaphone },
    { label: 'Customers', path: '/customers', icon: UsersGroupIcon },
    { label: 'Users', path: '/users', icon: UserPlus },
    { label: 'Collaborators — Sellers', path: '/collaborators/sellers', icon: Store },
    { label: 'Collaborators — Couriers', path: '/collaborators/couriers', icon: Store },
    { label: 'Collaborators — Media Buyers', path: '/collaborators/mediabuyers', icon: Store },
    { label: 'Business — Overview', path: '/business', icon: LayoutDashboard },
    { label: 'Business — Payments', path: '/business/payments', icon: Wallet },
    { label: 'Demands', path: '/demands', icon: MessageSquare },
    { label: 'Salaries', path: '/salaries', icon: DollarSign },
    { label: 'Product Ads', path: '/ads-history', icon: Target },
    { label: 'Global Ads', path: '/campaigns', icon: Megaphone },
    { label: 'Expenses Details', path: '/expenses-details', icon: List },
    { label: 'Expenses Types', path: '/expenses-types', icon: Tag },
    { label: 'Businesses', path: '/businesses', icon: Building2 },
    { label: 'Import Orders', path: '/import-orders', icon: Upload },
    { label: 'Import Products', path: '/import-products', icon: Upload },
    { label: 'Import Accessories', path: '/import-accessories', icon: Upload },
    { label: 'Import Customers', path: '/import-customers', icon: Upload },
    { label: 'Profit Calculator', path: '/calculator', icon: Calculator },
    { label: 'Devis', path: '/devis', icon: FileSpreadsheet },
    { label: 'Facture', path: '/facture', icon: Receipt },
    { label: 'Bon de commande', path: '/bon-de-commande', icon: ClipboardList },
    { label: 'Bon de livraison', path: '/bon-de-livraison', icon: PackageCheck },
];

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const UserKpi: React.FC<{
    label: string;
    value: number | string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const ROLE_META: Record<string, {
    label: string;
    plural: string;
    chapter: string;
    description: string;
    pill: { bg: string; border: string; text: string; dot: string };
    stripe: string;
    icon: LucideIcon;
}> = {
    'super admin': {
        label: 'Super admin',
        plural: 'Super admins',
        chapter: '01',
        description: 'Unrestricted access — the highest authority in the platform.',
        pill: { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' },
        stripe: 'bg-ant-rose',
        icon: Crown,
    },
    'admin': {
        label: 'Admin',
        plural: 'Admins',
        chapter: '02',
        description: 'Operational owners with configurable page access.',
        pill: { bg: 'bg-ant-ink/6', border: 'border-ant-ink/20', text: 'text-ant-ink', dot: 'bg-ant-ink' },
        stripe: 'bg-ant-ink',
        icon: Shield,
    },
    'commercial': {
        label: 'Commercial',
        plural: 'Commercials',
        chapter: '03',
        description: 'Close deals, talk to customers, earn commission.',
        pill: { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' },
        stripe: 'bg-ant-orange',
        icon: Headphones,
    },
    'courier': {
        label: 'Courier',
        plural: 'Couriers',
        chapter: '04',
        description: 'Move the package from shelf to customer door.',
        pill: { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' },
        stripe: 'bg-ant-green',
        icon: Bike,
    },
    'mediabuyer': {
        label: 'Media buyer',
        plural: 'Media buyers',
        chapter: '05',
        description: 'Buys attention on every platform — runs the ads.',
        pill: { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' },
        stripe: 'bg-ant-orange',
        icon: Target,
    },
    'others': {
        label: 'Other',
        plural: 'Others',
        chapter: '06',
        description: 'Legacy or custom roles that fall outside the five archetypes.',
        pill: { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' },
        stripe: 'bg-ant-line',
        icon: UserIcon,
    },
};

const ROLE_ORDER = ['super admin', 'admin', 'commercial', 'courier', 'mediabuyer', 'others'] as const;

const Users = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [userToDelete, setUserToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<'all' | typeof ROLE_ORDER[number]>('all');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: users, isLoading } = useQuery({
        queryKey: ['users', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const { data: usersWithWhatsApp } = useQuery({
        queryKey: ['users-wa-access', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return new Set<string>();
            const { data, error } = await (supabase as any)
                .from('whatsapp_user_instances')
                .select('user_id')
                .eq('business_id', activeBusinessId);
            if (error) return new Set<string>();
            return new Set<string>((data || []).map((r: any) => r.user_id));
        },
        enabled: !!activeBusinessId,
    });

    const addUserMutation = useMutation({
        mutationFn: async (values: UserFormValues) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: {
                        ...values,
                        'DigiCom Business': activeBusinessId,
                        whatsapp_access: values.role === 'commercial'
                            ? { ...values.whatsapp_access, business_id: activeBusinessId }
                            : { mode: 'none' },
                        ga_access: values.role === 'mediabuyer'
                            ? { ...values.ga_access, business_id: activeBusinessId }
                            : { mode: 'none' },
                        meta_access: values.role === 'mediabuyer'
                            ? { ...values.meta_access, business_id: activeBusinessId }
                            : { mode: 'none' },
                    }
                }
            });

            if (error) {
                throw new Error(await edgeFnErrorMessage(error, data));
            }
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['users-wa-access'] });
            setIsAddModalOpen(false);
            toast({ title: "User created", description: "The user has been successfully created in Auth and Database." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateUserMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: UserFormValues }) => {
            // Privacy: admins edit authorization & terms only — never identity/credentials
            // (name, username, email, password, avatar are owned by the user).
            const userData: Record<string, unknown> = {
                role: values.role,
                'DigiCom Business': activeBusinessId,
                assignment: values.assignment,
                commission_price: values.commission_price,
                commission_basis: values.commission_basis,
                payment_type: values.payment_type,
                salary_amount: values.salary_amount,
                products: values.products,
                permissions: values.permissions,
                whatsapp_access: values.role === 'commercial'
                    ? { ...values.whatsapp_access, business_id: activeBusinessId }
                    : { mode: 'none' },
                ga_access: values.role === 'mediabuyer'
                    ? { ...values.ga_access, business_id: activeBusinessId }
                    : { mode: 'none' },
                meta_access: values.role === 'mediabuyer'
                    ? { ...values.meta_access, business_id: activeBusinessId }
                    : { mode: 'none' },
            };
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'update', userId: id, userData }
            });

            if (error) {
                throw new Error(await edgeFnErrorMessage(error, data));
            }
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['users-wa-access'] });
            setEditingUser(null);
            toast({ title: "User updated", description: "The user has been successfully updated." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteUserMutation = useMutation({
        mutationFn: async (id: string) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'delete', userId: id }
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['users-wa-access'] });
            setUserToDelete(null);
            toast({ title: "User deleted", description: "The user has been successfully removed from Auth and Database." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const toggleActiveMutation = useMutation({
        mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
            const { error } = await supabase.from('users').update({ active } as never).eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({ title: 'Updated', description: 'Account status changed.' });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        }
    });

    const sendLinkMutation = useMutation({
        mutationFn: (id: string) => requestCredentialChange(id),
        onSuccess: (res) => {
            toast({ title: 'Link sent', description: `A secure change link was emailed to ${res.email}.` });
        },
        onError: (error: any) => {
            toast({ title: 'Could not send link', description: error.message, variant: 'destructive' });
        }
    });

    const getRoleBucket = (rawRole: any): typeof ROLE_ORDER[number] => {
        const r = String(rawRole || '').toLowerCase();
        if (r === 'super admin') return 'super admin';
        if (r === 'admin') return 'admin';
        if (r === 'commercial') return 'commercial';
        if (r === 'courier') return 'courier';
        if (r === 'mediabuyer') return 'mediabuyer';
        return 'others';
    };

    const filteredUsers = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return (users || []).filter((u) => {
            const bucket = getRoleBucket(u.role);
            if (roleFilter !== 'all' && bucket !== roleFilter) return false;
            if (!q) return true;
            return (
                u.name?.toLowerCase().includes(q) ||
                u.username?.toLowerCase().includes(q) ||
                u.email?.toLowerCase().includes(q)
            );
        });
    }, [users, searchQuery, roleFilter]);

    const totals = useMemo(() => {
        const list = users || [];
        return {
            total: list.length,
            active: list.filter((u: any) => u.active).length,
            admin: list.filter((u: any) => ['super admin', 'admin'].includes(String(u.role || '').toLowerCase())).length,
            commercial: list.filter((u: any) => String(u.role || '').toLowerCase() === 'commercial').length,
            courier: list.filter((u: any) => String(u.role || '').toLowerCase() === 'courier').length,
        };
    }, [users]);

    const groupedUsers = useMemo(() => {
        return ROLE_ORDER.map((bucket) => ({
            bucket,
            meta: ROLE_META[bucket],
            users: filteredUsers.filter((u: any) => getRoleBucket(u.role) === bucket),
        })).filter((g) => g.users.length > 0);
    }, [filteredUsers]);

    const roleCounts = useMemo(() => {
        const base: Record<string, number> = { all: users?.length || 0 };
        ROLE_ORDER.forEach((r) => {
            base[r] = (users || []).filter((u: any) => getRoleBucket(u.role) === r).length;
        });
        return base;
    }, [users]);

    const visibleRoleTabs: Array<{ key: 'all' | typeof ROLE_ORDER[number]; label: string }> = [
        { key: 'all', label: 'All' },
        ...ROLE_ORDER.filter((r) => roleCounts[r] > 0).map((r) => ({
            key: r,
            label: ROLE_META[r].label,
        })),
    ];

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Team · Access control
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Users
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every person who touches the business — admins with the keys, commercials with the phones, couriers at the door.
                        </p>
                    </div>
                    <Button
                        onClick={() => setIsAddModalOpen(true)}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <UserPlus className="w-4 h-4" />
                        New user
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <UserKpi label="Total" value={totals.total} suffix="users" accent="ink" icon={UsersGroupIcon} />
                        <UserKpi label="Active" value={totals.active} suffix="live" accent="green" icon={Check} />
                        <UserKpi label="Admins" value={totals.admin} suffix="" accent="rose" icon={Shield} />
                        <UserKpi label="Commercials" value={totals.commercial} suffix="" accent="orange" icon={Headphones} />
                        <UserKpi label="Couriers" value={totals.courier} suffix="" accent="green" icon={Bike} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {visibleRoleTabs.map((t) => {
                            const active = roleFilter === t.key;
                            const count = t.key === 'all' ? roleCounts.all : roleCounts[t.key];
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setRoleFilter(t.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative flex-1 md:max-w-[360px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search name, username or email..."
                            className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Pending / revoked / expired invitations (self-renders only when there are some) */}
                <InvitationsPanel activeBusinessId={activeBusinessId} />

                {/* Content */}
                {isLoading ? (
                    <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
                ) : filteredUsers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <UsersGroupIcon className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {users?.length ? 'No users match those filters' : 'No users yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {users?.length
                                ? 'Relax the search or switch role tabs to bring the roster back.'
                                : 'Invite your first admin, commercial or courier — every access level has a different set of gates.'}
                        </p>
                        {!users?.length && (
                            <Button
                                onClick={() => setIsAddModalOpen(true)}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <UserPlus className="w-4 h-4" />
                                Invite your first user
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-8">
                        {groupedUsers.map((group) => (
                            <section key={group.bucket} className="space-y-3">
                                <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                    <div className="space-y-1">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">{group.meta.chapter}</span>
                                            Chapter
                                        </div>
                                        <h2 className="font-display text-[22px] tracking-tight text-ant-ink">
                                            {group.meta.plural}
                                            <span className="ml-2 text-[13px] font-normal text-ant-mid tabular-nums">· {group.users.length}</span>
                                        </h2>
                                        <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">{group.meta.description}</p>
                                    </div>
                                    <div className={cn('hidden md:flex h-12 w-12 rounded-2xl border items-center justify-center shrink-0', group.meta.pill.bg, group.meta.pill.border, group.meta.pill.text)}>
                                        <group.meta.icon className="w-5 h-5" strokeWidth={1.5} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    {group.users.map((user: any) => (
                                        <UserCard
                                            key={user.id}
                                            user={user}
                                            meta={group.meta}
                                            hasWhatsApp={usersWithWhatsApp?.has(user.id) || false}
                                            onEdit={() => setEditingUser(user)}
                                            onDelete={() => setUserToDelete(user)}
                                            onToggleActive={() => toggleActiveMutation.mutate({ id: user.id, active: !user.active })}
                                            onSendLink={() => sendLinkMutation.mutate(user.id)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}

                {/* Delete confirmation */}
                <Dialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                    <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this user?</DialogTitle>
                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                <span className="not-italic font-semibold text-ant-ink">&ldquo;{userToDelete?.name}&rdquo;</span> will be removed from Auth and the database. Past orders and activity stay.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="px-6 py-4 gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => setUserToDelete(null)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
                                disabled={deleteUserMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteUserMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* New users are created via an invite link — admins set role + access, the
                    invitee sets their own identity (name, email, password, avatar). */}
                <InviteUserWizard
                    isOpen={isAddModalOpen}
                    onClose={() => { setIsAddModalOpen(false); queryClient.invalidateQueries({ queryKey: ['invitations'] }); }}
                    activeBusinessId={activeBusinessId}
                />

                {editingUser && (
                    <UserModal
                        isOpen={!!editingUser}
                        onClose={() => setEditingUser(null)}
                        onSubmit={(values) => updateUserMutation.mutate({ id: editingUser.id, values })}
                        initialData={editingUser}
                        loading={updateUserMutation.isPending}
                        title={`Editing ${editingUser?.name}`}
                        activeBusinessId={activeBusinessId}
                    />
                )}
            </div>
        </div>
    );
};

const UserCard = ({
    user,
    meta,
    hasWhatsApp,
    onEdit,
    onDelete,
    onToggleActive,
    onSendLink,
}: {
    user: any;
    meta: typeof ROLE_META[string];
    hasWhatsApp?: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onToggleActive: () => void;
    onSendLink: () => void;
}) => {
    const isActive = user.active;
    const canEdit = hasEditableConfig(user.role);

    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all">
            <div className={cn('h-[3px] w-full', meta.stripe)} />
            <div className="p-4 flex items-center gap-4">
                <UserAvatar
                    url={user.avatar_url}
                    config={(user as any).avatar_config}
                    name={user.name}
                    className="h-14 w-14 shrink-0 rounded-2xl border border-ant-line font-display font-semibold text-[15px]"
                />

                <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-[15px] font-semibold text-ant-ink truncate">{user.name}</h3>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0', meta.pill.bg, meta.pill.border, meta.pill.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', meta.pill.dot)} />
                            {meta.label}
                        </span>
                        {hasWhatsApp && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-ant-green/25 bg-ant-green/10 px-1.5 py-0.5 text-[9px] font-semibold text-ant-green">
                                <FaWhatsapp className="w-2.5 h-2.5" />
                                WA
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-[11px]">
                        <span className="text-ant-mid tabular-nums">@{user.username}</span>
                        <span className="text-ant-mid inline-flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            <span className="truncate max-w-[180px]">{user.email}</span>
                        </span>
                        {user.role === 'commercial' && (
                            <span className="font-display font-semibold text-ant-ink tabular-nums">
                                {user.commission_price || 0} <span className="text-ant-mid font-normal">DH/{normalizeCommissionBasis(user.commission_basis) === 'per_unit' ? 'unit' : 'order'}</span>
                            </span>
                        )}
                        {user.role === 'mediabuyer' && user.payment_type === 'salary' && (
                            <span className="font-display font-semibold text-ant-ink tabular-nums">
                                {user.salary_amount || 0} <span className="text-ant-mid font-normal">DH/month</span>
                            </span>
                        )}
                        {user.role === 'courier' && user.phone && (
                            <span className="text-ant-mid tabular-nums">{user.phone}</span>
                        )}
                    </div>
                </div>

                <div className="shrink-0 flex items-center gap-1">
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            isActive ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-light border-ant-line text-ant-mid'
                        )}
                        title={isActive ? 'Active' : 'Inactive'}
                    >
                        <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-ant-green' : 'bg-ant-mid')} />
                        {isActive ? 'Live' : 'Off'}
                    </span>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[170px]">
                            {canEdit && (
                                <>
                                    <DropdownMenuItem onClick={onEdit} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                        <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="my-1 bg-ant-line" />
                                </>
                            )}
                            <DropdownMenuItem onClick={onToggleActive} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                {isActive
                                    ? <><PowerOff className="w-3.5 h-3.5 text-ant-mid" /> Disable account</>
                                    : <><Power className="w-3.5 h-3.5 text-ant-green" /> Enable account</>}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={onSendLink} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                <KeyRound className="w-3.5 h-3.5 text-ant-orange" /> Send change link
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-ant-line" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 gap-2">
                                <Trash2 className="w-3.5 h-3.5" /> Delete user
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
};

const UserModal = ({
    isOpen,
    onClose,
    onSubmit,
    initialData,
    loading,
    title,
    activeBusinessId,
}: UserModalProps) => {
    const { toast } = useToast();
    const [avatar, setAvatar] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(initialData?.avatar_url ?? null);

    const form = useForm<UserFormValues>({
        resolver: zodResolver(userSchema),
        defaultValues: {
            name: '',
            username: '',
            email: '',
            password: '',
            role: 'commercial',
            assignment: 0,
            commission_price: 0,
            commission_basis: 'per_order',
            payment_type: 'commission',
            salary_amount: 0,
            phone: '',
            products: [],
            active: true,
            permissions: {},
            whatsapp_access: { mode: 'none', instance_ids: [] },
            ga_access: { mode: 'none', ids: [] },
            meta_access: { mode: 'none', ids: [] },
        }
    });

    const { data: waInstances } = useQuery({
        queryKey: ['whatsapp-instances-user-modal', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('whatsapp_instances')
                .select('id, instance_name, phone_number, profile_pic, status')
                .eq('business_id', activeBusinessId)
                .eq('status', 'open')
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });

    const editingUserId = (initialData as any)?.id;
    const { data: existingAccess } = useQuery({
        queryKey: ['whatsapp-user-access', editingUserId],
        queryFn: async () => {
            if (!editingUserId) return null;
            const { data, error } = await (supabase as any)
                .from('whatsapp_user_instances')
                .select('instance_id, scope')
                .eq('user_id', editingUserId);
            if (error) throw error;
            const rows = data || [];
            if (rows.length === 0) return { mode: 'none' as const, instance_ids: [] };
            if (rows.some((r: any) => r.scope === 'all')) return { mode: 'all' as const, instance_ids: [] };
            return {
                mode: 'specific' as const,
                instance_ids: rows.map((r: any) => r.instance_id).filter(Boolean),
            };
        },
        enabled: !!editingUserId && isOpen,
    });

    // Mediabuyer GA / Meta current grants (round-trip) + the business's connectable properties/accounts.
    const { data: existingGaAccess } = useQuery({
        queryKey: ['mb-ga-access', editingUserId],
        queryFn: async () => {
            if (!editingUserId) return null;
            const { data, error } = await (supabase as any).from('mediabuyer_ga_access').select('ga_connection_id, scope').eq('user_id', editingUserId);
            if (error) throw error;
            const rows = data || [];
            if (rows.length === 0) return { mode: 'none' as const, ids: [] };
            if (rows.some((r: any) => r.scope === 'all')) return { mode: 'all' as const, ids: [] };
            return { mode: 'specific' as const, ids: rows.map((r: any) => r.ga_connection_id).filter(Boolean) };
        },
        enabled: !!editingUserId && isOpen,
    });
    const { data: existingMetaAccess } = useQuery({
        queryKey: ['mb-meta-access', editingUserId],
        queryFn: async () => {
            if (!editingUserId) return null;
            const { data, error } = await (supabase as any).from('mediabuyer_meta_access').select('meta_connection_id, scope').eq('user_id', editingUserId);
            if (error) throw error;
            const rows = data || [];
            if (rows.length === 0) return { mode: 'none' as const, ids: [] };
            if (rows.some((r: any) => r.scope === 'all')) return { mode: 'all' as const, ids: [] };
            return { mode: 'specific' as const, ids: rows.map((r: any) => r.meta_connection_id).filter(Boolean) };
        },
        enabled: !!editingUserId && isOpen,
    });
    const { data: gaConns } = useQuery({
        queryKey: ['mb-ga-conns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('google_analytics_connections').select('id, display_name, property_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });
    const { data: metaConns } = useQuery({
        queryKey: ['mb-meta-conns', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('meta_ads_connections').select('id, display_name, ad_account_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });

    const { data: products, isLoading: isProductsLoading } = useQuery({
        queryKey: ['products-user-modal', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, name, image_url, code')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });

    const [productSearch, setProductSearch] = useState("");
    const filteredProducts = products?.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.code.toLowerCase().includes(productSearch.toLowerCase())
    );

    const [activeTab, setActiveTab] = useState<'permissions' | 'performance' | 'whatsapp' | 'payment' | 'integrations'>('permissions');
    useEffect(() => { if (isOpen) setActiveTab(firstConfigTab((initialData as any)?.role)); }, [isOpen, initialData]);

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                const raw = initialData as any;
                form.reset({
                    ...initialData,
                    password: '',
                    phone: raw.phone ?? '',
                    payment_type: raw.payment_type ?? 'commission',
                    salary_amount: Number(raw.salary_amount ?? 0),
                    commission_price: Number(raw.commission_price ?? 0),
                    assignment: Number(raw.assignment ?? 0),
                    commission_basis: normalizeCommissionBasis(initialData.commission_basis),
                    products: Array.isArray(initialData.products) ? initialData.products : [],
                    permissions: initialData.permissions || {},
                    whatsapp_access: existingAccess || { mode: 'none', instance_ids: [] },
                    ga_access: existingGaAccess || { mode: 'none', ids: [] },
                    meta_access: existingMetaAccess || { mode: 'none', ids: [] },
                });
                setAvatarPreview(initialData.avatar_url ?? null);
            } else {
                form.reset({
                    name: '',
                    username: '',
                    email: '',
                    password: '',
                    role: 'commercial',
                    assignment: 0,
                    commission_price: 0,
                    commission_basis: 'per_order',
                    payment_type: 'commission',
                    salary_amount: 0,
                    phone: '',
                    products: [],
                    active: true,
                    permissions: {},
                    whatsapp_access: { mode: 'none', instance_ids: [] },
                    ga_access: { mode: 'none', ids: [] },
                    meta_access: { mode: 'none', ids: [] },
                });
                setAvatarPreview(null);
            }
        }
    }, [initialData, form, isOpen, existingAccess, existingGaAccess, existingMetaAccess]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        setAvatar(file);
        setAvatarPreview(URL.createObjectURL(file));
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'image/*': [] },
        multiple: false
    });

    const handleFormSubmit = async (values: UserFormValues) => {
        const finalValues = { ...values };

        if (avatar) {
            const fileExt = avatar.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `avatars/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('avatar')
                .upload(filePath, avatar);

            if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage
                    .from('avatar')
                    .getPublicUrl(filePath);
                finalValues.avatar_url = publicUrl;
            }
        }

        onSubmit(finalValues);
    };

    const currentRole = form.watch('role');
    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';
    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const tabClass = 'text-[11px] h-8 px-3.5 rounded-full gap-1.5 data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col">
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(handleFormSubmit, (errors) => {
                            const first = Object.values(errors)[0] as any;
                            toast({
                                title: 'Form validation failed',
                                description: first?.message || 'Check the form fields and try again.',
                                variant: 'destructive',
                            });
                        })}
                        className="flex flex-col flex-1 min-h-0 overflow-hidden"
                    >
                        {/* Editorial header */}
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                            <div className="flex items-center gap-4">
                                {/* Identity is read-only — owned by the user, never edited by an admin */}
                                <UserAvatar
                                    url={(initialData as any)?.avatar_url}
                                    config={(initialData as any)?.avatar_config}
                                    name={(initialData as any)?.name}
                                    className="w-16 h-16 rounded-2xl border border-ant-line text-[18px]"
                                />
                                <div className="flex-1 min-w-0 space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Edit · Access &amp; terms
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink truncate">{title}</DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid truncate">
                                        @{(initialData as any)?.username} · {(initialData as any)?.email}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        {/* Tabs */}
                        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                            <div className="px-6 pt-4">
                                <TabsList className="h-10 rounded-full p-1 bg-ant-light border border-ant-line inline-flex w-auto">
                                    {currentRole === 'admin' && (
                                        <TabsTrigger value="permissions" className={tabClass}>
                                            <Shield className="w-3 h-3" />
                                            Page access
                                        </TabsTrigger>
                                    )}
                                    {currentRole === 'mediabuyer' && (
                                        <>
                                            <TabsTrigger value="payment" className={tabClass}>
                                                <DollarSign className="w-3 h-3" />
                                                Payment
                                            </TabsTrigger>
                                            <TabsTrigger value="integrations" className={tabClass}>
                                                <BarChart2 className="w-3 h-3" />
                                                Integrations
                                            </TabsTrigger>
                                        </>
                                    )}
                                    {currentRole === 'commercial' && (
                                        <>
                                            <TabsTrigger value="performance" className={tabClass}>
                                                <BarChart2 className="w-3 h-3" />
                                                Performance
                                            </TabsTrigger>
                                            <TabsTrigger value="whatsapp" className={tabClass}>
                                                <FaWhatsapp className="w-3 h-3 text-[#25D366]" />
                                                WhatsApp
                                            </TabsTrigger>
                                        </>
                                    )}
                                </TabsList>
                            </div>

                            {/* Body */}
                            <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6">
                                {/* PAGE ACCESS */}
                                <TabsContent value="permissions" className="m-0 outline-none">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {pages.map((page) => {
                                            const isChecked = form.watch('permissions.pages')?.[page.path];
                                            return (
                                                <div
                                                    key={page.path}
                                                    className={cn(
                                                        'flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group border',
                                                        isChecked
                                                            ? 'bg-ant-ink border-ant-ink text-white'
                                                            : 'bg-ant-paper border-ant-line hover:border-ant-ink/30'
                                                    )}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        const current = form.getValues('permissions.pages') || {};
                                                        form.setValue('permissions.pages', {
                                                            ...current,
                                                            [page.path]: !current[page.path]
                                                        }, { shouldDirty: true });
                                                    }}
                                                >
                                                    <div className={cn(
                                                        'w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0',
                                                        isChecked ? 'bg-white/10' : 'bg-ant-light border border-ant-line text-ant-ink'
                                                    )}>
                                                        <page.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                    </div>
                                                    <span className="text-[12px] font-semibold flex-1 truncate">{page.label}</span>
                                                    <div className={cn(
                                                        'w-5 h-5 rounded-full flex items-center justify-center border transition-all shrink-0',
                                                        isChecked ? 'bg-white border-white text-ant-ink' : 'border-ant-line text-transparent'
                                                    )}>
                                                        <Check className="w-3 h-3" />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </TabsContent>

                                {/* PERFORMANCE (commercial) */}
                                <TabsContent value="performance" className="m-0 space-y-5 outline-none">
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name="assignment"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Order attribution</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" placeholder="0" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'tabular-nums')} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="commission_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Commission · DH</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'tabular-nums pr-12')} />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">DH</span>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="commission_basis"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className={labelCls}>Commission calculation</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="per_order" id="commission-per-order" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="font-display text-[13px] font-semibold text-ant-ink block">Per order</span>
                                                                <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Commission × each delivered order</p>
                                                            </div>
                                                        </label>
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="per_unit" id="commission-per-unit" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="font-display text-[13px] font-semibold text-ant-ink block">Per unit</span>
                                                                <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Commission × total units delivered</p>
                                                            </div>
                                                        </label>
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="space-y-3 pt-1">
                                        <div className="flex items-center justify-between">
                                            <FormLabel className={labelCls}>Available products</FormLabel>
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                    {form.watch('products')?.length || 0} / {products?.length || 0}
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full cursor-pointer"
                                                    onClick={() => {
                                                        const allIds = products?.map((p) => p.id) || [];
                                                        const current = form.getValues('products') || [];
                                                        const allSelected = allIds.length > 0 && allIds.every((id) => current.includes(id));
                                                        form.setValue('products', allSelected ? [] : allIds, { shouldDirty: true });
                                                    }}
                                                >
                                                    {(() => {
                                                        const allIds = products?.map((p) => p.id) || [];
                                                        const current = form.watch('products') || [];
                                                        return allIds.length > 0 && allIds.every((id) => current.includes(id)) ? 'Deselect all' : 'Select all';
                                                    })()}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                            <Input
                                                placeholder="Search products..."
                                                value={productSearch}
                                                onChange={(e) => setProductSearch(e.target.value)}
                                                className={cn(inputCls, 'pl-9')}
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1 ant-scroll">
                                            {!activeBusinessId ? (
                                                <p className="col-span-full font-serif italic text-[12px] text-ant-mid text-center py-8">
                                                    No business selected. Open the app with an active business before assigning products.
                                                </p>
                                            ) : isProductsLoading ? (
                                                <div className="col-span-full flex justify-center py-12">
                                                    <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
                                                </div>
                                            ) : !filteredProducts?.length ? (
                                                <p className="col-span-full font-serif italic text-[12px] text-ant-mid text-center py-8">
                                                    No active products for this business.
                                                </p>
                                            ) : (
                                                filteredProducts.map((product) => {
                                                    const isSelected = form.watch('products')?.includes(product.id);
                                                    return (
                                                        <div
                                                            key={product.id}
                                                            onClick={() => {
                                                                const current = form.getValues('products') || [];
                                                                const next = isSelected
                                                                    ? current.filter((id) => id !== product.id)
                                                                    : [...current, product.id];
                                                                form.setValue('products', next, { shouldDirty: true });
                                                            }}
                                                            className={cn(
                                                                'flex items-center gap-3 p-2.5 rounded-xl transition-all cursor-pointer border',
                                                                isSelected ? 'bg-ant-orange/10 border-ant-orange/30' : 'bg-ant-paper border-ant-line hover:border-ant-ink/30'
                                                            )}
                                                        >
                                                            <Avatar className="h-9 w-9 rounded-lg border border-ant-line shrink-0">
                                                                <AvatarImage src={product.image_url || ''} className="object-cover" />
                                                                <AvatarFallback className="rounded-lg text-[10px] font-semibold bg-ant-ink/5 text-ant-ink">
                                                                    PR
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col min-w-0 flex-1">
                                                                <span className="text-[12px] font-semibold text-ant-ink truncate">{product.name}</span>
                                                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid truncate">{product.code}</span>
                                                            </div>
                                                            <div className={cn(
                                                                'w-5 h-5 rounded-full flex items-center justify-center border transition-all shrink-0',
                                                                isSelected ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line text-transparent'
                                                            )}>
                                                                <Check className="w-3 h-3" />
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </TabsContent>

                                {/* WHATSAPP (commercial) */}
                                <TabsContent value="whatsapp" className="m-0 outline-none">
                                    <FormField
                                        control={form.control}
                                        name="whatsapp_access"
                                        render={({ field }) => {
                                            const access = field.value || { mode: 'none' as const, instance_ids: [] };
                                            const enabled = access.mode !== 'none';
                                            const setMode = (mode: 'none' | 'all' | 'specific') => {
                                                field.onChange({ ...access, mode, instance_ids: mode === 'specific' ? access.instance_ids : [] });
                                            };
                                            const toggleInstance = (id: string) => {
                                                const current = access.instance_ids || [];
                                                const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
                                                field.onChange({ ...access, mode: 'specific', instance_ids: next });
                                            };
                                            return (
                                                <FormItem className="space-y-4">
                                                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-ant-line bg-ant-paper p-5">
                                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                                            <div className="w-11 h-11 rounded-2xl bg-ant-green/10 border border-ant-green/25 flex items-center justify-center shrink-0">
                                                                <FaWhatsapp className="w-5 h-5 text-ant-green" />
                                                            </div>
                                                            <div className="space-y-0.5 min-w-0">
                                                                <FormLabel className="font-display text-[14px] font-semibold text-ant-ink block">Enable inbox access</FormLabel>
                                                                <p className="font-serif italic text-[12px] text-ant-mid leading-snug">
                                                                    Let this commercial open the WhatsApp inbox for selected devices.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <Switch
                                                            checked={enabled}
                                                            onCheckedChange={(v) => setMode(v ? 'all' : 'none')}
                                                            className="data-[state=checked]:bg-ant-green"
                                                        />
                                                    </div>

                                                    {enabled && (
                                                        <>
                                                            <RadioGroup
                                                                value={access.mode}
                                                                onValueChange={(v) => setMode(v as 'all' | 'specific')}
                                                                className="grid grid-cols-2 gap-3"
                                                            >
                                                                <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                                    <RadioGroupItem value="all" id="wa-all-tab" className="mt-0.5" />
                                                                    <div className="space-y-0.5">
                                                                        <span className="font-display text-[13px] font-semibold text-ant-ink block">All devices</span>
                                                                        <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Includes future devices automatically</p>
                                                                    </div>
                                                                </label>
                                                                <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                                    <RadioGroupItem value="specific" id="wa-specific-tab" className="mt-0.5" />
                                                                    <div className="space-y-0.5">
                                                                        <span className="font-display text-[13px] font-semibold text-ant-ink block">Specific</span>
                                                                        <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Pick the devices below</p>
                                                                    </div>
                                                                </label>
                                                            </RadioGroup>

                                                            {access.mode === 'specific' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <FormLabel className={labelCls}>Connected devices</FormLabel>
                                                                        <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                                            {(access.instance_ids || []).length} / {waInstances?.length || 0}
                                                                        </span>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1 ant-scroll">
                                                                        {!waInstances?.length ? (
                                                                            <p className="col-span-full font-serif italic text-[12px] text-ant-mid text-center py-8">
                                                                                No connected WhatsApp devices for this business yet.
                                                                            </p>
                                                                        ) : (
                                                                            waInstances.map((inst: any) => {
                                                                                const checked = (access.instance_ids || []).includes(inst.id);
                                                                                return (
                                                                                    <div
                                                                                        key={inst.id}
                                                                                        onClick={() => toggleInstance(inst.id)}
                                                                                        className={cn(
                                                                                            'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                                                                                            checked
                                                                                                ? 'bg-ant-orange/10 border-ant-orange/30'
                                                                                                : 'bg-ant-paper border-ant-line hover:border-ant-ink/30'
                                                                                        )}
                                                                                    >
                                                                                        <Avatar className="h-9 w-9 rounded-full border border-ant-line shrink-0">
                                                                                            <AvatarImage src={inst.profile_pic || ''} className="object-cover" />
                                                                                            <AvatarFallback className="text-[10px] font-semibold bg-ant-ink/5 text-ant-ink">
                                                                                                {inst.instance_name.substring(0, 2).toUpperCase()}
                                                                                            </AvatarFallback>
                                                                                        </Avatar>
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <p className="text-[12px] font-semibold text-ant-ink truncate">{inst.instance_name}</p>
                                                                                            {inst.phone_number && (
                                                                                                <p className="text-[11px] text-ant-mid truncate tabular-nums">+{inst.phone_number}</p>
                                                                                            )}
                                                                                        </div>
                                                                                        <div className={cn(
                                                                                            'w-5 h-5 rounded-full flex items-center justify-center border transition-all shrink-0',
                                                                                            checked ? 'bg-ant-orange border-ant-orange text-white' : 'border-ant-line text-transparent'
                                                                                        )}>
                                                                                            <Check className="w-3 h-3" />
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </FormItem>
                                            );
                                        }}
                                    />
                                </TabsContent>

                                {/* INTEGRATIONS (mediabuyer) — which GA properties / Meta ad accounts they may see */}
                                <TabsContent value="integrations" className="m-0 space-y-4 outline-none">
                                    <IntegrationAccessField
                                        control={form.control}
                                        name="ga_access"
                                        title="Google Analytics"
                                        hint="Which GA properties this media buyer can view."
                                        conns={gaConns}
                                        primaryKey="display_name"
                                        secondaryKey="property_id"
                                        emptyText="No Google Analytics properties connected to this business."
                                    />
                                    <IntegrationAccessField
                                        control={form.control}
                                        name="meta_access"
                                        title="Meta Ads"
                                        hint="Which ad accounts this media buyer can use."
                                        conns={metaConns}
                                        primaryKey="display_name"
                                        secondaryKey="ad_account_id"
                                        emptyText="No Meta ad accounts connected to this business."
                                    />
                                </TabsContent>

                                {/* PAYMENT (mediabuyer) */}
                                <TabsContent value="payment" className="m-0 space-y-5 outline-none">
                                    <FormField
                                        control={form.control}
                                        name="payment_type"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className={labelCls}>Payment structure</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="commission" id="mb-pay-commission" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="font-display text-[13px] font-semibold text-ant-ink block">Commission</span>
                                                                <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Fixed amount × each delivered order</p>
                                                            </div>
                                                        </label>
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="salary" id="mb-pay-salary" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="font-display text-[13px] font-semibold text-ant-ink block">Fixed salary</span>
                                                                <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Monthly fixed amount</p>
                                                            </div>
                                                        </label>
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />

                                    {form.watch('payment_type') === 'commission' ? (
                                        <FormField
                                            control={form.control}
                                            name="commission_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Commission per delivered order</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'tabular-nums pr-12')} />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">DH</span>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    ) : (
                                        <FormField
                                            control={form.control}
                                            name="salary_amount"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Monthly salary</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'tabular-nums pr-12')} />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">DH</span>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </TabsContent>
                            </div>
                        </Tabs>

                        <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                            >
                                Discard
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                {initialData ? 'Save changes' : 'Create user'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Users;
