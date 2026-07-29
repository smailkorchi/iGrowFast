import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Shield,
    Mail,
    User as UserIcon,
    Check,
    Loader2,
    BarChart2,
    Users as UsersGroupIcon,
    Target,
    DollarSign,
    UserPlus,
    Crown,
    Gem,
    Headphones,
    Bike,
    Sparkles,
    Power,
    PowerOff,
    KeyRound,
    Lock,
    Send,
    Ban,
    CircleCheck,
    type LucideIcon,
} from 'lucide-react';

// Roles whose job has admin-configurable settings → get an Edit button.
// super admin / courier / others have nothing to configure here (enable/disable + delete only).
// Business-owner viewers get the Edit button on EVERY row — they also edit identity + role.
const EDITABLE_ROLES = ['admin', 'commercial', 'mediabuyer'];
const hasEditableConfig = (role: unknown) => EDITABLE_ROLES.includes(String(role || '').toLowerCase());
type ConfigTab = 'permissions' | 'performance' | 'payment' | 'integrations' | 'courier' | 'none';
// 'none' = super admin / business owner: unlimited access, nothing to configure.
const firstConfigTab = (role: unknown): ConfigTab => {
    const r = String(role || '').toLowerCase();
    if (r === 'admin') return 'permissions';
    if (r === 'mediabuyer') return 'payment';
    if (r === 'courier') return 'courier';
    if (r === 'super admin' || r === 'business owner') return 'none';
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
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';
import { edgeFnErrorMessage } from '@/lib/edgeError';
import { InviteUserWizard } from '@/components/users/InviteUserWizard';
import { InvitationsPanel } from '@/components/users/InvitationsPanel';
import { DirectCreateUserDialog, type RoleOption } from '@/components/users/DirectCreateUserDialog';
import { ChangeRoleDialog } from '@/components/users/ChangeRoleDialog';
import { SetPasswordDialog } from '@/components/users/SetPasswordDialog';
import { requestCredentialChange } from '@/lib/credentialChange';
import { USER_PAGES, USER_PAGE_GROUPS } from '@/lib/invitations';

const userSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal('')),
    // 'business owner' is only selectable by a business-owner viewer, but it must be a
    // valid value so their own peers' rows can be opened and saved.
    role: z.enum(['business owner', 'super admin', 'admin', 'commercial', 'courier', 'mediabuyer']),
    commission_price: z.number().default(0),
    commission_basis: z.enum(['per_order', 'per_unit']).default('per_order'),
    payment_type: z.enum(['commission', 'salary']).default('commission'),
    salary_amount: z.number().default(0),
    phone: z.string().optional().or(z.literal('')),
    products: z.array(z.string()).default([]),
    active: z.boolean().default(true),
    permissions: z.record(z.any()).default({}),
    avatar_url: z.string().optional().nullable(),
    // Courier parcel handling — same keys the invite wizard sets.
    courier_parcel_fragile: z.boolean().default(false),
    courier_parcel_open: z.boolean().default(false),
    courier_parcel_try_on: z.boolean().default(false),
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
    /** Viewer is a business owner — unlocks identity + role editing and every role's config. */
    isBO?: boolean;
    /** The six assignable tenant roles (business-owner viewers only). */
    roleOptions?: RoleOption[];
}

// Page list for the permissions tab = THE registry (src/lib/invitations.ts USER_PAGES),
// the same source the sidebar filter and the route gate read.

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
    'business owner': {
        label: 'Business owner',
        plural: 'Business owners',
        chapter: '00',
        description: 'Founding authority for this business — protected from demotion or removal by peers.',
        pill: { bg: 'bg-ant-blue/10', border: 'border-ant-blue/25', text: 'text-ant-blue', dot: 'bg-ant-blue' },
        stripe: 'bg-ant-blue',
        icon: Gem,
    },
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

const ROLE_ORDER = ['business owner', 'super admin', 'admin', 'commercial', 'courier', 'mediabuyer', 'others'] as const;

// The six real, assignable roles — 'others' is a display bucket, never a choice.
const ASSIGNABLE_ROLES: RoleOption[] = ROLE_ORDER
    .filter((r) => r !== 'others')
    .map((r) => ({ value: r, label: ROLE_META[r].label }));

const Users = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    // Business owners choose between direct creation and an invitation before the wizard opens.
    const [isAddChooserOpen, setIsAddChooserOpen] = useState(false);
    const [isDirectCreateOpen, setIsDirectCreateOpen] = useState(false);
    const [roleTarget, setRoleTarget] = useState<any>(null);
    const [passwordTarget, setPasswordTarget] = useState<any>(null);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [userToDelete, setUserToDelete] = useState<any>(null);
    // Suspend / reactivate flow: capture an optional reason (fed into the email) before flipping status.
    const [statusTarget, setStatusTarget] = useState<{ user: any; active: boolean } | null>(null);
    const [statusReason, setStatusReason] = useState('');
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<'all' | typeof ROLE_ORDER[number]>('all');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Viewer's own role — gates the business-owner management powers below.
    // Session uid first, so the role query below is keyed per user — a
    // same-tab account switch can never serve the previous user's cached role.
    const { data: viewerUid } = useQuery({
        queryKey: ['viewer-uid'],
        staleTime: 5 * 60 * 1000,
        queryFn: async () => (await supabase.auth.getUser()).data?.user?.id ?? null,
    });
    const { data: viewerRole } = useQuery({
        queryKey: ['viewer-role', viewerUid],
        enabled: !!viewerUid,
        staleTime: 30 * 60 * 1000, // own role barely changes within a session
        queryFn: async () => {
            const { data: auth } = await supabase.auth.getUser();
            const uid = auth?.user?.id;
            if (!uid) return null;
            const { data, error } = await supabase.from('users').select('role').eq('id', uid).maybeSingle();
            if (error) throw error;
            return (data?.role as string | null) ?? null;
        },
    });
    const isBO = String(viewerRole || '').toLowerCase() === 'business owner';

    // Non-BO viewers keep the invitation wizard as the only path.
    const openAddFlow = () => (isBO ? setIsAddChooserOpen(true) : setIsAddModalOpen(true));

    const { data: users, isLoading } = useQuery({
        queryKey: ['users', activeBusinessId],
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
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

    const addUserMutation = useMutation({
        mutationFn: async (values: UserFormValues) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: {
                        ...values,
                        'DigiCom Business': activeBusinessId,
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
            // Business owners are the exception: they manage identity too (block below).
            const userData: Record<string, unknown> = {
                role: values.role,
                'DigiCom Business': activeBusinessId,
                commission_price: values.commission_price,
                commission_basis: values.commission_basis,
                payment_type: values.payment_type,
                salary_amount: values.salary_amount,
                products: values.products,
                permissions: values.permissions,
                ga_access: values.role === 'mediabuyer'
                    ? { ...values.ga_access, business_id: activeBusinessId }
                    : { mode: 'none' },
                meta_access: values.role === 'mediabuyer'
                    ? { ...values.meta_access, business_id: activeBusinessId }
                    : { mode: 'none' },
            };
            if (isBO) {
                // Identity — email rides manage-users' authUpdates path (auth.users stays canonical).
                userData.name = values.name;
                userData.username = values.username;
                userData.email = values.email;
                if (values.role === 'courier') {
                    userData.phone = values.phone || null;
                    userData.courier_parcel_fragile = values.courier_parcel_fragile;
                    userData.courier_parcel_open = values.courier_parcel_open;
                    userData.courier_parcel_try_on = values.courier_parcel_try_on;
                }
            }
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
            setUserToDelete(null);
            toast({ title: "User deleted", description: "The user has been successfully removed from Auth and Database." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const toggleActiveMutation = useMutation({
        mutationFn: async ({ id, active, reason }: { id: string; active: boolean; reason?: string }) => {
            // Server-side: flips users.active AND emails account_suspended / account_reactivated with the reason.
            const { data, error } = await supabase.functions.invoke('account-status-change', {
                body: { user_id: id, active, reason: reason ?? '', origin: window.location.origin },
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
            if (data && data.ok === false) throw new Error(data.detail || data.reason || 'Could not change the account status.');
            return data as { active: boolean; email_warning?: string | null };
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setStatusTarget(null); setStatusReason('');
            toast({
                title: res?.active ? 'Account reactivated' : 'Account suspended',
                description: res?.email_warning ? 'Status changed — but the email could not be sent.' : 'Status changed and the user was notified by email.',
            });
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
        if (r === 'business owner') return 'business owner';
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
            admin: list.filter((u: any) => ['super admin', 'business owner', 'admin'].includes(String(u.role || '').toLowerCase())).length,
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
                        onClick={openAddFlow}
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
                                onClick={openAddFlow}
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
                                            onEdit={() => setEditingUser(user)}
                                            onDelete={() => setUserToDelete(user)}
                                            onToggleActive={() => { setStatusReason(''); setStatusTarget({ user, active: !user.active }); }}
                                            onSendLink={() => sendLinkMutation.mutate(user.id)}
                                            isBO={isBO}
                                            onChangeRole={() => setRoleTarget(user)}
                                            onSetPassword={() => setPasswordTarget(user)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}

                {/* Delete confirmation */}
                <Dialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                    <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                        {/* Gradient hairline — rose: destructive */}
                        <div className="h-[3px] w-full bg-gradient-to-r from-ant-rose via-ant-rose/60 to-transparent" />
                        <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-11 h-11 rounded-2xl bg-ant-rose text-white flex items-center justify-center shrink-0 shadow-sm">
                                    <Trash2 className="w-5 h-5" strokeWidth={1.75} />
                                </div>
                                <div className="min-w-0">
                                    <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                        Action irréversible
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                        Supprimer cet utilisateur&nbsp;?
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                        <span className="not-italic font-semibold text-ant-ink">« {userToDelete?.name} »</span> sera retiré de l&rsquo;authentification et de la base. Les commandes et l&rsquo;activité passées sont conservées.
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                        <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => setUserToDelete(null)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                            >
                                Annuler
                            </Button>
                            <Button
                                onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
                                disabled={deleteUserMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteUserMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Supprimer définitivement
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Suspend / reactivate — capture an optional reason fed into the email notice */}
                <Dialog open={!!statusTarget} onOpenChange={(open) => { if (!open && !toggleActiveMutation.isPending) { setStatusTarget(null); setStatusReason(''); } }}>
                    <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                        {/* Gradient hairline — contextual hue: green reactivate / rose suspend */}
                        <div className={cn('h-[3px] w-full bg-gradient-to-r to-transparent', statusTarget?.active ? 'from-ant-green via-ant-green/60' : 'from-ant-rose via-ant-rose/60')} />
                        <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                            <div className="flex items-start gap-3">
                                <div className={cn('w-11 h-11 rounded-2xl text-white flex items-center justify-center shrink-0 shadow-sm', statusTarget?.active ? 'bg-ant-green' : 'bg-ant-rose')}>
                                    {statusTarget?.active
                                        ? <CircleCheck className="w-5 h-5" strokeWidth={1.75} />
                                        : <Ban className="w-5 h-5" strokeWidth={1.75} />}
                                </div>
                                <div className="min-w-0">
                                    <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                        <span className={cn('h-1.5 w-1.5 rounded-full', statusTarget?.active ? 'bg-ant-green' : 'bg-ant-rose')} />
                                        {statusTarget?.active ? 'Réactivation' : 'Suspension'}
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                        {statusTarget?.active ? 'Réactiver ce compte ?' : 'Suspendre ce compte ?'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                        <span className="not-italic font-semibold text-ant-ink">« {statusTarget?.user?.name} »</span>{' '}
                                        {statusTarget?.active
                                            ? 'retrouve son accès et reçoit un email de réactivation.'
                                            : 'perd son accès et reçoit un email de suspension.'}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                        <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-2">
                            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                {statusTarget?.active ? 'Note (facultative)' : 'Motif (facultatif)'}
                            </label>
                            <Textarea
                                value={statusReason}
                                onChange={(e) => setStatusReason(e.target.value)}
                                rows={3}
                                autoFocus
                                placeholder={statusTarget?.active ? 'Ex. Problème résolu — accès rétabli.' : 'Ex. Paiement en retard / non-respect des règles…'}
                                className="rounded-xl border-ant-line bg-ant-paper text-[13px] text-ant-ink resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                            <p className="text-[11px] text-ant-mid">Affiché à l&rsquo;utilisateur dans l&rsquo;email. Laissez vide pour le message par défaut.</p>
                        </div>
                        <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => { setStatusTarget(null); setStatusReason(''); }}
                                disabled={toggleActiveMutation.isPending}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                            >
                                Annuler
                            </Button>
                            <Button
                                onClick={() => statusTarget && toggleActiveMutation.mutate({ id: statusTarget.user.id, active: statusTarget.active, reason: statusReason })}
                                disabled={toggleActiveMutation.isPending}
                                className={cn('h-10 px-5 rounded-full text-[12px] font-semibold text-white gap-2 cursor-pointer',
                                    statusTarget?.active ? 'bg-ant-green hover:bg-ant-green/90' : 'bg-ant-rose hover:bg-ant-rose/90')}
                            >
                                {toggleActiveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {statusTarget?.active ? 'Réactiver et notifier' : 'Suspendre et notifier'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Business owners pick the path first: full identity now, or an invite link. */}
                <Dialog open={isAddChooserOpen} onOpenChange={(open) => !open && setIsAddChooserOpen(false)}>
                    <DialogContent className="max-w-lg p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                        {/* Gradient hairline */}
                        <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />
                        <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center shrink-0 shadow-sm">
                                    <UserPlus className="w-5 h-5" strokeWidth={1.75} />
                                </div>
                                <div className="min-w-0">
                                    <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Nouvel utilisateur
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                        Comment voulez-vous procéder&nbsp;?
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                        Créez le compte vous-même, ou laissez la personne définir sa propre identité via un lien.
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>
                        <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => { setIsAddChooserOpen(false); setIsDirectCreateOpen(true); }}
                                className="group text-left p-4 rounded-2xl border border-ant-line bg-ant-paper flex items-start gap-3.5 hover:border-ant-ink/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/25 focus-visible:border-ant-ink/30 transition-all duration-200 motion-reduce:transition-none cursor-pointer"
                            >
                                <div className="w-11 h-11 rounded-xl border bg-ant-ink/6 border-ant-ink/20 text-ant-ink flex items-center justify-center shrink-0">
                                    <UserPlus className="w-5 h-5" strokeWidth={1.75} />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-display text-[14.5px] font-semibold text-ant-ink leading-tight">Créer directement</p>
                                    <p className="text-[11.5px] text-ant-mid leading-snug mt-0.5">
                                        Vous saisissez l&rsquo;identité et le mot de passe. Compte actif immédiatement.
                                    </p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setIsAddChooserOpen(false); setIsAddModalOpen(true); }}
                                className="group text-left p-4 rounded-2xl border border-ant-line bg-ant-paper flex items-start gap-3.5 hover:border-ant-ink/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/25 focus-visible:border-ant-ink/30 transition-all duration-200 motion-reduce:transition-none cursor-pointer"
                            >
                                <div className="w-11 h-11 rounded-xl border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center shrink-0">
                                    <Send className="w-5 h-5" strokeWidth={1.75} />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-display text-[14.5px] font-semibold text-ant-ink leading-tight">Envoyer une invitation</p>
                                    <p className="text-[11.5px] text-ant-mid leading-snug mt-0.5">
                                        La personne choisit son nom, son email, son mot de passe et son avatar.
                                    </p>
                                </div>
                            </button>
                        </div>
                    </DialogContent>
                </Dialog>

                <DirectCreateUserDialog
                    isOpen={isDirectCreateOpen}
                    onClose={() => setIsDirectCreateOpen(false)}
                    roleOptions={ASSIGNABLE_ROLES}
                    activeBusinessId={activeBusinessId}
                />

                {/* New users are created via an invite link — admins set role + access, the
                    invitee sets their own identity (name, email, password, avatar). */}
                <InviteUserWizard
                    isOpen={isAddModalOpen}
                    onClose={() => { setIsAddModalOpen(false); queryClient.invalidateQueries({ queryKey: ['invitations'] }); }}
                    activeBusinessId={activeBusinessId}
                    allowBusinessOwner={isBO}
                />

                <ChangeRoleDialog
                    isOpen={!!roleTarget}
                    onClose={() => setRoleTarget(null)}
                    user={roleTarget}
                    roleOptions={ASSIGNABLE_ROLES}
                />

                <SetPasswordDialog
                    isOpen={!!passwordTarget}
                    onClose={() => setPasswordTarget(null)}
                    user={passwordTarget}
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
                        isBO={isBO}
                        roleOptions={ASSIGNABLE_ROLES}
                    />
                )}
            </div>
        </div>
    );
};

const UserCard = ({
    user,
    meta,
    onEdit,
    onDelete,
    onToggleActive,
    onSendLink,
    isBO,
    onChangeRole,
    onSetPassword,
}: {
    user: any;
    meta: typeof ROLE_META[string];
    onEdit: () => void;
    onDelete: () => void;
    onToggleActive: () => void;
    onSendLink: () => void;
    /** Viewer is a business owner — unlocks role + password management on every row. */
    isBO: boolean;
    onChangeRole: () => void;
    onSetPassword: () => void;
}) => {
    const isActive = user.active;
    // Business owners edit identity + role on every row, so the button is never hidden for them.
    const canEdit = hasEditableConfig(user.role) || isBO;

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
                            {isBO && (
                                <>
                                    <DropdownMenuSeparator className="my-1 bg-ant-line" />
                                    <DropdownMenuItem onClick={onChangeRole} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                        <Shield className="w-3.5 h-3.5 text-ant-blue" /> Changer le rôle
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={onSetPassword} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                        <Lock className="w-3.5 h-3.5 text-ant-blue" /> Définir le mot de passe
                                    </DropdownMenuItem>
                                </>
                            )}
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
    isBO = false,
    roleOptions = [],
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
            commission_price: 0,
            commission_basis: 'per_order',
            payment_type: 'commission',
            salary_amount: 0,
            phone: '',
            products: [],
            active: true,
            permissions: {},
            ga_access: { mode: 'none', ids: [] },
            meta_access: { mode: 'none', ids: [] },
            courier_parcel_fragile: false,
            courier_parcel_open: false,
            courier_parcel_try_on: false,
        }
    });

    const editingUserId = (initialData as any)?.id;

    // Mediabuyer GA / Meta current grants (round-trip) + the business's connectable properties/accounts.
    const { data: existingGaAccess } = useQuery({
        queryKey: ['mb-ga-access', editingUserId],
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
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
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
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
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('google_analytics_connections').select('id, display_name, property_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });
    const { data: metaConns } = useQuery({
        queryKey: ['mb-meta-conns', activeBusinessId],
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data } = await supabase.from('meta_ads_connections').select('id, display_name, ad_account_id').eq('DigiCom Business', activeBusinessId).order('display_name');
            return data ?? [];
        },
        enabled: !!activeBusinessId && isOpen,
    });

    const { data: products, isLoading: isProductsLoading } = useQuery({
        queryKey: ['products-user-modal', activeBusinessId],
        staleTime: 5 * 60 * 1000, // Users audit: reference data; mutations invalidate
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

    const [activeTab, setActiveTab] = useState<ConfigTab>('permissions');
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
                    commission_basis: normalizeCommissionBasis(initialData.commission_basis),
                    products: Array.isArray(initialData.products) ? initialData.products : [],
                    permissions: initialData.permissions || {},
                    ga_access: existingGaAccess || { mode: 'none', ids: [] },
                    meta_access: existingMetaAccess || { mode: 'none', ids: [] },
                    courier_parcel_fragile: !!raw.courier_parcel_fragile,
                    courier_parcel_open: !!raw.courier_parcel_open,
                    courier_parcel_try_on: !!raw.courier_parcel_try_on,
                });
                setAvatarPreview(initialData.avatar_url ?? null);
            } else {
                form.reset({
                    name: '',
                    username: '',
                    email: '',
                    password: '',
                    role: 'commercial',
                    commission_price: 0,
                    commission_basis: 'per_order',
                    payment_type: 'commission',
                    salary_amount: 0,
                    phone: '',
                    products: [],
                    active: true,
                    permissions: {},
                    ga_access: { mode: 'none', ids: [] },
                    meta_access: { mode: 'none', ids: [] },
                    courier_parcel_fragile: false,
                    courier_parcel_open: false,
                    courier_parcel_try_on: false,
                });
                setAvatarPreview(null);
            }
        }
    }, [initialData, form, isOpen, existingGaAccess, existingMetaAccess]);

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

    // Page-permission helpers — default-allow semantics: a page is granted unless it is
    // explicitly false, so a stored map written before a page existed keeps it CHECKED.
    const watchedPages = (form.watch('permissions.pages') || {}) as Record<string, boolean>;
    const isPageChecked = (path: string) => watchedPages[path] !== false;
    const grantedPageCount = USER_PAGES.filter((p) => isPageChecked(p.path)).length;
    const setPageFlag = (path: string, on: boolean) => {
        const current = (form.getValues('permissions.pages') || {}) as Record<string, boolean>;
        form.setValue('permissions.pages', { ...current, [path]: on }, { shouldDirty: true });
    };
    const setPagesGroup = (group: string, on: boolean) => {
        const current = (form.getValues('permissions.pages') || {}) as Record<string, boolean>;
        const next = { ...current };
        for (const p of USER_PAGES) if (p.group === group) next[p.path] = on;
        form.setValue('permissions.pages', next, { shouldDirty: true });
    };
    const setAllPages = (on: boolean) =>
        form.setValue('permissions.pages', Object.fromEntries(USER_PAGES.map((p) => [p.path, on])), { shouldDirty: true });

    const handleFormSubmit = async (values: UserFormValues) => {
        // An admin with every page denied could not open anything — block the save.
        if (values.role === 'admin' && grantedPageCount === 0) {
            toast({
                title: 'Autorisez au moins une page',
                description: 'Un admin sans aucune page autorisée ne peut rien ouvrir.',
                variant: 'destructive',
            });
            return;
        }

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
    // super admin / business owner have unlimited access — no config tab to show.
    const hasConfigTabs = firstConfigTab(currentRole) !== 'none';

    /** BO role switch inside the modal: config never carries over — reset to the new role's defaults. */
    const changeRole = (next: string) => {
        form.setValue('role', next as UserFormValues['role'], { shouldDirty: true });
        form.setValue('permissions', {}, { shouldDirty: true });
        form.setValue('commission_price', 0, { shouldDirty: true });
        form.setValue('commission_basis', 'per_order', { shouldDirty: true });
        form.setValue('payment_type', 'commission', { shouldDirty: true });
        form.setValue('salary_amount', 0, { shouldDirty: true });
        form.setValue('products', [], { shouldDirty: true });
        form.setValue('phone', '', { shouldDirty: true });
        form.setValue('courier_parcel_fragile', false, { shouldDirty: true });
        form.setValue('courier_parcel_open', false, { shouldDirty: true });
        form.setValue('courier_parcel_try_on', false, { shouldDirty: true });
        form.setValue('ga_access', { mode: 'none', ids: [] }, { shouldDirty: true });
        form.setValue('meta_access', { mode: 'none', ids: [] }, { shouldDirty: true });
        setActiveTab(firstConfigTab(next));
    };

    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';
    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const tabClass = 'text-[11px] h-8 px-3.5 rounded-full gap-1.5 data-[state=active]:bg-ant-ink data-[state=active]:text-white text-ant-mid';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col">
                {/* Gradient hairline */}
                <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />
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
                        <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                            <div className="flex items-center gap-4">
                                {/* Identity is read-only for admin/super-admin viewers — owned by the user.
                                    Business owners edit it in the identity section below. */}
                                <UserAvatar
                                    url={(initialData as any)?.avatar_url}
                                    config={(initialData as any)?.avatar_config}
                                    name={(initialData as any)?.name}
                                    className="w-16 h-16 rounded-2xl border border-ant-line text-[18px]"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Modification · accès et conditions
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink truncate mt-1">{title}</DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid truncate mt-0.5">
                                        @{(initialData as any)?.username} · {(initialData as any)?.email}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        {/* IDENTITY + ROLE — business-owner viewers only */}
                        {isBO && (
                            <div className="px-6 pt-5 space-y-4 border-b border-ant-line pb-5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-blue" />
                                    Identité
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Nom</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className={inputCls} placeholder="Ex. Yassine Alami" />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="username"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Nom d&rsquo;utilisateur</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className={inputCls} autoCapitalize="off" placeholder="Ex. yassine" />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Email</FormLabel>
                                                <FormControl>
                                                    <Input {...field} type="email" className={inputCls} autoComplete="off" autoCapitalize="off" placeholder="nom@email.com" />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="role"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Rôle</FormLabel>
                                                <Select value={field.value} onValueChange={changeRole}>
                                                    <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink focus:ring-1 focus:ring-ant-orange/40">
                                                        <SelectValue placeholder="Choisir un rôle" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-ant-line bg-ant-paper">
                                                        {roleOptions.map((r) => (
                                                            <SelectItem key={r.value} value={r.value} className="text-[12px]">
                                                                {r.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <p className="text-[11px] text-ant-mid leading-snug">
                                    Le changement de rôle réinitialise la configuration à celle du nouveau rôle. Le mot de passe se définit via « Définir le mot de passe ».
                                </p>
                            </div>
                        )}

                        {/* Tabs */}
                        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                            {hasConfigTabs ? (
                            <div className="px-6 pt-4">
                                <TabsList className="h-10 rounded-full p-1 bg-ant-light border border-ant-line inline-flex w-auto">
                                    {currentRole === 'admin' && (
                                        <TabsTrigger value="permissions" className={tabClass}>
                                            <Shield className="w-3 h-3" />
                                            Accès aux pages
                                        </TabsTrigger>
                                    )}
                                    {currentRole === 'mediabuyer' && (
                                        <>
                                            <TabsTrigger value="payment" className={tabClass}>
                                                <DollarSign className="w-3 h-3" />
                                                Paiement
                                            </TabsTrigger>
                                            <TabsTrigger value="integrations" className={tabClass}>
                                                <BarChart2 className="w-3 h-3" />
                                                Intégrations
                                            </TabsTrigger>
                                        </>
                                    )}
                                    {currentRole === 'commercial' && (
                                        <>
                                            <TabsTrigger value="performance" className={tabClass}>
                                                <BarChart2 className="w-3 h-3" />
                                                Performance
                                            </TabsTrigger>
                                        </>
                                    )}
                                    {currentRole === 'courier' && (
                                        <TabsTrigger value="courier" className={tabClass}>
                                            <Bike className="w-3 h-3" />
                                            Livraison
                                        </TabsTrigger>
                                    )}
                                </TabsList>
                            </div>
                            ) : (
                                <div className="px-6 pt-5">
                                    <div className="rounded-2xl border border-ant-line bg-ant-light px-4 py-5 text-center">
                                        <Crown className="w-5 h-5 text-ant-mid mx-auto mb-2" />
                                        <p className="text-[12px] text-ant-mid">Accès illimité à l&rsquo;entreprise.</p>
                                    </div>
                                </div>
                            )}

                            {/* Body */}
                            <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6">
                                {/* PAGE ACCESS */}
                                <TabsContent value="permissions" className="m-0 outline-none">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <p className="text-[12px] font-semibold text-ant-ink tabular-nums">
                                                {grantedPageCount}/{USER_PAGES.length} pages autorisées
                                            </p>
                                            <div className="flex items-center gap-1.5">
                                                <button type="button" onClick={() => setAllPages(true)}
                                                    className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-ink hover:border-ant-ink/30 transition cursor-pointer">
                                                    Tout autoriser
                                                </button>
                                                <button type="button" onClick={() => setAllPages(false)}
                                                    className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer">
                                                    Tout retirer
                                                </button>
                                            </div>
                                        </div>
                                        {USER_PAGE_GROUPS.map((g) => {
                                            const items = USER_PAGES.filter((p) => p.group === g);
                                            const onCount = items.filter((p) => isPageChecked(p.path)).length;
                                            const allOn = onCount === items.length;
                                            return (
                                                <div key={g} className="rounded-2xl border border-ant-line p-4 space-y-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-[13px] font-semibold text-ant-ink flex items-center gap-2">
                                                            {g}
                                                            <span className={cn(
                                                                'text-[10px] font-semibold tabular-nums px-1.5 h-[18px] rounded-full flex items-center border',
                                                                onCount > 0 ? 'bg-ant-ink/5 text-ant-ink border-ant-ink/15' : 'text-ant-mid border-ant-line',
                                                            )}>
                                                                {onCount}/{items.length}
                                                            </span>
                                                        </p>
                                                        <button type="button" onClick={() => setPagesGroup(g, !allOn)}
                                                            className="h-7 px-2.5 rounded-full border border-ant-line text-[10px] font-semibold text-ant-mid hover:text-ant-ink hover:border-ant-ink/30 transition cursor-pointer">
                                                            {allOn ? 'Tout retirer' : 'Tout sélectionner'}
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        {items.map((page) => {
                                                            // Absent key = allowed (default-allow semantics) → renders CHECKED.
                                                            const isChecked = isPageChecked(page.path);
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
                                                                        setPageFlag(page.path, !isChecked);
                                                                    }}
                                                                >
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

                                {/* LIVRAISON (courier) — phone + parcel handling permissions */}
                                <TabsContent value="courier" className="m-0 space-y-4 outline-none">
                                    <FormField
                                        control={form.control}
                                        name="phone"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Téléphone</FormLabel>
                                                <FormControl>
                                                    <Input {...field} value={field.value ?? ''} className={inputCls} placeholder="+212 6 00 00 00 00" />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    {([
                                        ['courier_parcel_fragile', 'Colis fragiles'],
                                        ['courier_parcel_open', 'Ouverture à la livraison'],
                                        ['courier_parcel_try_on', 'Essayage autorisé'],
                                    ] as const).map(([key, label]) => (
                                        <FormField
                                            key={key}
                                            control={form.control}
                                            name={key}
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between h-11 px-4 rounded-xl border border-ant-line bg-ant-paper space-y-0">
                                                    <FormLabel className="text-[12px] font-semibold text-ant-ink">{label}</FormLabel>
                                                    <FormControl>
                                                        <Switch
                                                            checked={!!field.value}
                                                            onCheckedChange={field.onChange}
                                                            className="data-[state=checked]:bg-ant-green"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    ))}
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
                                Annuler
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                {initialData ? 'Enregistrer les modifications' : 'Créer l’utilisateur'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Users;
