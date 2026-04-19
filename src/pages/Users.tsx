import React, { useState, useEffect, useCallback } from 'react';
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
    X,
    Loader2,
    Upload,
    ChevronRight,
    Package,
    ArrowRightLeft,
    Box,
    UserPlus,
    Wallet,
    List,
    Tag,
    CheckCircle,
    Home,
    ShoppingBag,
    FileText,
    Repeat,
    Globe,
    CreditCard,
    BarChart2,
    Megaphone,
    Users as UsersGroupIcon, // Renamed Users to UsersGroupIcon to avoid conflict with the component name 'Users'
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
    LayoutDashboard
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FaWhatsapp } from 'react-icons/fa';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';

// --- Types ---
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
});

type UserFormValues = z.infer<typeof userSchema>;

/** Row shape from `users` when editing; keeps `avatar_url` typed for preview state. */
type UserModalInitialData = Partial<UserFormValues> & {
    id?: string;
    avatar_url?: string | null;
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
    { label: 'Profit Calculator', path: '/calculator', icon: Calculator },
    { label: 'Devis', path: '/devis', icon: FileSpreadsheet },
    { label: 'Facture', path: '/facture', icon: Receipt },
    { label: 'Bon de commande', path: '/bon-de-commande', icon: ClipboardList },
    { label: 'Bon de livraison', path: '/bon-de-livraison', icon: PackageCheck },
];

const Users = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
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

    // Set of user_ids that have at least one WhatsApp instance assigned for this business.
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
                    }
                }
            });

            if (error) {
                const contextMsg = data?.error || error.message;
                throw new Error(contextMsg);
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
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'update',
                    userId: id,
                    userData: {
                        ...values,
                        'DigiCom Business': activeBusinessId,
                        whatsapp_access: values.role === 'commercial'
                            ? { ...values.whatsapp_access, business_id: activeBusinessId }
                            : { mode: 'none' },
                    }
                }
            });

            if (error) {
                const contextMsg = data?.error || error.message;
                throw new Error(contextMsg);
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
            const { error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'delete', userId: id }
            });

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            queryClient.invalidateQueries({ queryKey: ['users-wa-access'] });
            toast({ title: "User deleted", description: "The user has been successfully removed from Auth and Database." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Filter ---
    const filteredUsers = users?.filter(user =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Team Members</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Roles, permissions &amp; account access</p>
                </div>
                <Button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add User
                </Button>
            </header>

            {/* Search */}
            <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                <Input
                    placeholder="Search by name, username or email..."
                    className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            <div>
                {isLoading ? (
                    <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
                ) : filteredUsers?.length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-xl py-8 text-center">
                        <p className="text-[14px] font-semibold text-brand-navy">No users found</p>
                        <p className="text-[11px] text-gray-400 mt-1">Try adjusting your search or add a new user.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {['super admin', 'admin', 'commercial', 'courier', 'mediabuyer', 'others'].map(roleGroup => {
                            const groupUsers = filteredUsers?.filter(u => {
                                const r = (u.role || '').toLowerCase();
                                if (roleGroup === 'super admin') return r === 'super admin';
                                if (roleGroup === 'admin') return r === 'admin';
                                if (roleGroup === 'commercial') return r === 'commercial';
                                if (roleGroup === 'courier') return r === 'courier';
                                if (roleGroup === 'mediabuyer') return r === 'mediabuyer';
                                if (roleGroup === 'others') return r !== 'super admin' && r !== 'admin' && r !== 'commercial' && r !== 'courier' && r !== 'mediabuyer';
                                return false;
                            });

                            if (!groupUsers || groupUsers.length === 0) return null;

                            const title = roleGroup === 'super admin' ? 'Super Admins' :
                                roleGroup === 'admin' ? 'Admins' :
                                    roleGroup === 'commercial' ? 'Commercials' :
                                        roleGroup === 'courier' ? 'Couriers' :
                                            roleGroup === 'mediabuyer' ? 'Media Buyers' : 'Others';

                            return (
                                <div key={roleGroup} className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{title}</p>
                                        <span className="h-5 px-1.5 bg-gray-100 rounded text-[9px] font-bold text-gray-500 inline-flex items-center">{groupUsers.length}</span>
                                    </div>
                                    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                                        {groupUsers.map((user, idx) => (
                                            <UserCard
                                                key={user.id}
                                                user={user}
                                                hasWhatsApp={usersWithWhatsApp?.has(user.id) || false}
                                                onEdit={() => setEditingUser(user)}
                                                onDelete={() => {
                                                    if (confirm("Are you sure you want to delete this user?")) {
                                                        deleteUserMutation.mutate(user.id);
                                                    }
                                                }}
                                                isLast={idx === groupUsers.length - 1}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <UserModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={(values) => addUserMutation.mutate(values)}
                loading={addUserMutation.isPending}
                title="Create New User"
                activeBusinessId={activeBusinessId}
            />

            {editingUser && (
                <UserModal
                    isOpen={!!editingUser}
                    onClose={() => setEditingUser(null)}
                    onSubmit={(values) => updateUserMutation.mutate({ id: editingUser.id, values })}
                    initialData={editingUser}
                    loading={updateUserMutation.isPending}
                    title="Edit User"
                    activeBusinessId={activeBusinessId}
                />
            )}
        </div>
    );
};

const UserCard = ({ user, hasWhatsApp, onEdit, onDelete, isLast }: { user: any, hasWhatsApp?: boolean, onEdit: () => void, onDelete: () => void, isLast?: boolean }) => {
    const roleColor = user.role === 'super admin' ? 'bg-red-50 text-red-600' :
        user.role === 'admin' ? 'bg-brand-navy/10 text-brand-navy' :
        user.role === 'commercial' ? 'bg-amber-50 text-amber-600' :
        user.role === 'courier' ? 'bg-emerald-50 text-emerald-600' :
        'bg-gray-100 text-gray-500';

    return (
        <div className={cn("flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors group", !isLast && "border-b border-gray-100")}>
            <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user.avatar_url || ''} />
                <AvatarFallback className="bg-brand-navy/10 text-brand-navy text-[10px] font-bold">
                    {user.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[12px] font-semibold text-brand-navy truncate">{user.name}</p>
                    {hasWhatsApp && <FaWhatsapp className="w-3 h-3 text-[#25D366] shrink-0" title="WhatsApp access" />}
                </div>
                <p className="text-[10px] text-gray-500 truncate">@{user.username} · {user.email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <span className={cn("h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-[0.08em] inline-flex items-center", roleColor)}>
                    {user.role}
                </span>
                {user.role === 'commercial' && (
                    <span className="text-[10px] text-gray-400 tabular-nums">
                        {user.commission_price || 0} DH/{normalizeCommissionBasis(user.commission_basis) === 'per_unit' ? 'unit' : 'order'}
                    </span>
                )}
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", user.active ? "bg-emerald-500" : "bg-gray-300")} title={user.active ? 'Active' : 'Inactive'} />
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-7 w-7 p-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <MoreVertical className="h-3.5 w-3.5 text-gray-400" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-xl border border-gray-100 shadow-md">
                    <DropdownMenuItem onClick={onEdit} className="rounded-lg cursor-pointer text-[11px]">
                        <Edit2 className="w-3.5 h-3.5 mr-2" />
                        Edit Profile
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onDelete} className="rounded-lg cursor-pointer text-[11px] text-red-500 focus:text-red-600">
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Delete User
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
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
    const [avatarPreview, setAvatarPreview] = useState<string | null>(
        initialData?.avatar_url ?? null,
    );

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
        }
    });

    // ── Connected WhatsApp instances for the active business ──────────
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

    // ── Existing assignments for the user being edited ────────────────
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

    const [activeTab, setActiveTab] = useState<'identity' | 'permissions' | 'performance' | 'whatsapp' | 'payment'>('identity');
    useEffect(() => { if (isOpen) setActiveTab('identity'); }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                // Normalize nullable DB fields back to schema-valid defaults before reset.
                // zod rejects `null` for optional string fields, which would silently fail
                // form.handleSubmit validation and leave the Update button doing nothing.
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
                });
                setAvatarPreview(null);
            }
        }
    }, [initialData, form, isOpen, existingAccess]);

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

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden max-h-[92vh] flex flex-col">
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
                        {/* ── Header ───────────────────────────────────────── */}
                        <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        "relative group flex-shrink-0 flex items-center justify-center border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden w-14 h-14",
                                        isDragActive ? "border-brand-navy/40 scale-95" : "border-gray-200 hover:border-brand-navy/30 bg-gray-50",
                                        avatarPreview ? "border-solid border-gray-200" : ""
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-brand-navy/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-3.5 h-3.5 text-white" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-4 h-4 text-gray-400" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <DialogTitle className="text-[13px] font-semibold text-brand-navy">{title}</DialogTitle>
                                    <DialogDescription className="text-[10px] text-gray-400 mt-0.5">
                                        {form.watch('role') === 'super admin' ? 'Highest privilege account.'
                                            : form.watch('role') === 'admin' ? 'Configure modules this admin can access.'
                                            : form.watch('role') === 'mediabuyer' ? 'Configure media buyer payment structure.'
                                            : 'Configure parameters, products, and inbox access.'}
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        {/* ── Tabs ──────────────────────────────────────────────────── */}
                        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                            <div className="px-4 pt-3">
                                <TabsList className="h-8">
                                    <TabsTrigger value="identity" className="text-[11px] h-6 px-3 gap-1.5">
                                        <UserIcon className="w-3 h-3" />
                                        Identity
                                    </TabsTrigger>
                                    {form.watch('role') === 'admin' && (
                                        <TabsTrigger value="permissions" className="text-[11px] h-6 px-3 gap-1.5">
                                            <Shield className="w-3 h-3" />
                                            Page Access
                                        </TabsTrigger>
                                    )}
                                    {form.watch('role') === 'mediabuyer' && (
                                        <TabsTrigger value="payment" className="text-[11px] h-6 px-3 gap-1.5">
                                            <DollarSign className="w-3 h-3" />
                                            Payment
                                        </TabsTrigger>
                                    )}
                                    {form.watch('role') === 'commercial' && (
                                        <>
                                            <TabsTrigger value="performance" className="text-[11px] h-6 px-3 gap-1.5">
                                                <BarChart2 className="w-3 h-3" />
                                                Performance
                                            </TabsTrigger>
                                            <TabsTrigger value="whatsapp" className="text-[11px] h-6 px-3 gap-1.5">
                                                <FaWhatsapp className="w-3 h-3 text-[#25D366]" />
                                                WhatsApp
                                            </TabsTrigger>
                                        </>
                                    )}
                                </TabsList>
                            </div>

                            {/* ── Body (scrollable) ───────────────────────────────── */}
                            <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
                                {/* ── TAB: Identity ───────────────────────────────── */}
                                <TabsContent value="identity" className="m-0 space-y-6 outline-none">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Full Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="E.g. Alexander Pierce" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="role"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">System Role</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy focus:ring-2 focus:ring-brand-navy/10 transition-all shadow-inner">
                                                                <SelectValue placeholder="Assign a role" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white/95 backdrop-blur-xl">
                                                            {['super admin', 'admin', 'commercial', 'courier', 'mediabuyer'].map((role) => (
                                                                <SelectItem key={role} value={role} className="rounded-xl p-3 capitalize font-bold text-brand-navy focus:bg-brand-navy focus:text-brand-white transition-colors cursor-pointer">
                                                                    {role === 'mediabuyer' ? 'Media Buyer' : role}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <FormField
                                            control={form.control}
                                            name="username"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Username</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-navy/30 font-black text-sm">@</span>
                                                            <Input placeholder="p_alexander" {...field} className="h-12 pl-10 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Email Address</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                                            <Input type="email" placeholder="alex@digicom.team" {...field} className="h-12 pl-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Password</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="password"
                                                            placeholder={initialData ? "••••••••" : "Minimum 6 characters"}
                                                            {...field}
                                                            className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner"
                                                        />
                                                    </FormControl>
                                                    {initialData && <FormDescription className="text-[10px] uppercase font-bold text-brand-navy/30 px-2">Leave blank to keep current</FormDescription>}
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2">Account Status</FormLabel>
                                                    <div className="flex items-center gap-4 h-12 bg-brand-navy/[0.04] px-4 rounded-2xl shadow-inner">
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            className="data-[state=checked]:bg-green-500"
                                                        />
                                                        <span className="text-xs font-black uppercase text-brand-navy tracking-tight">{field.value ? 'Active' : 'Disabled'}</span>
                                                    </div>
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {form.watch('role') === 'courier' && (
                                        <FormField
                                            control={form.control}
                                            name="phone"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Phone number</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="tel"
                                                            placeholder="+212 6 00 00 00 00"
                                                            {...field}
                                                            value={field.value || ''}
                                                            className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner"
                                                        />
                                                    </FormControl>
                                                    <FormDescription className="text-[10px] uppercase font-bold text-brand-navy/30 px-2">Reachable number for delivery coordination</FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </TabsContent>

                                {/* ── TAB: Page Access (admin) ───────────────────── */}
                                <TabsContent value="permissions" className="m-0 outline-none">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                        {pages.map((page) => {
                                            const isChecked = form.watch('permissions.pages')?.[page.path];
                                            return (
                                                <div
                                                    key={page.path}
                                                    className={cn(
                                                        "flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 cursor-pointer group border-2",
                                                        isChecked
                                                            ? "bg-brand-navy border-brand-navy text-brand-white"
                                                            : "bg-brand-white border-brand-navy/5 hover:border-brand-navy/20"
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
                                                        "w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0",
                                                        isChecked ? "bg-white/10" : "bg-brand-navy/5 text-brand-navy"
                                                    )}>
                                                        <page.icon className="w-4 h-4" />
                                                    </div>
                                                    <span className="text-xs font-bold flex-1 truncate">{page.label}</span>
                                                    <div className={cn(
                                                        "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all shrink-0",
                                                        isChecked ? "bg-white border-white text-brand-navy" : "border-brand-navy/10 text-transparent"
                                                    )}>
                                                        <Check className="w-3 h-3" />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </TabsContent>

                                {/* ── TAB: Performance (commercial) ──────────────── */}
                                <TabsContent value="performance" className="m-0 space-y-5 outline-none">
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name="assignment"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Order Attribution</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="commission_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Comm. Price</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-xs font-bold">DH</span>
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
                                            <FormItem className="space-y-3">
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Commission Calculation</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                            <RadioGroupItem value="per_order" id="commission-per-order" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="text-xs font-bold text-brand-navy block">Per order</span>
                                                                <p className="text-[10px] text-muted-foreground leading-snug">Commission × each delivered order</p>
                                                            </div>
                                                        </label>
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                            <RadioGroupItem value="per_unit" id="commission-per-unit" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="text-xs font-bold text-brand-navy block">Per unit</span>
                                                                <p className="text-[10px] text-muted-foreground leading-snug">Commission × total units delivered</p>
                                                            </div>
                                                        </label>
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="space-y-3 pt-1">
                                        <div className="flex items-center justify-between">
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Available Products</FormLabel>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-[10px] font-bold rounded-full">{form.watch('products')?.length || 0} / {products?.length || 0}</Badge>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2.5 text-[10px] font-bold uppercase tracking-wider text-brand-navy/60 hover:text-brand-navy hover:bg-brand-navy/5 rounded-lg"
                                                    onClick={() => {
                                                        const allIds = products?.map(p => p.id) || [];
                                                        const current = form.getValues('products') || [];
                                                        const allSelected = allIds.length > 0 && allIds.every(id => current.includes(id));
                                                        form.setValue('products', allSelected ? [] : allIds, { shouldDirty: true });
                                                    }}
                                                >
                                                    {(() => {
                                                        const allIds = products?.map(p => p.id) || [];
                                                        const current = form.watch('products') || [];
                                                        return allIds.length > 0 && allIds.every(id => current.includes(id)) ? 'Deselect all' : 'Select all';
                                                    })()}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Search products..."
                                                value={productSearch}
                                                onChange={(e) => setProductSearch(e.target.value)}
                                                className="h-11 pl-11 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1">
                                            {!activeBusinessId ? (
                                                <p className="col-span-full text-xs text-muted-foreground text-center py-8 px-2">
                                                    No business selected. Open the app with an active business before assigning products.
                                                </p>
                                            ) : isProductsLoading ? (
                                                <div className="col-span-full flex justify-center py-12">
                                                    <Loader2 className="w-6 h-6 animate-spin text-brand-navy/40" />
                                                </div>
                                            ) : !filteredProducts?.length ? (
                                                <p className="col-span-full text-xs text-muted-foreground text-center py-8">
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
                                                                    ? current.filter(id => id !== product.id)
                                                                    : [...current, product.id];
                                                                form.setValue('products', next, { shouldDirty: true });
                                                            }}
                                                            className={cn(
                                                                "flex items-center gap-3 p-2.5 rounded-2xl transition-all cursor-pointer border-2 group min-w-0 overflow-hidden",
                                                                isSelected ? "bg-brand-navy border-brand-navy text-white" : "bg-white border-brand-navy/5 hover:border-brand-navy/20"
                                                            )}
                                                        >
                                                            <Avatar className="h-9 w-9 rounded-xl border border-muted shrink-0">
                                                                <AvatarImage src={product.image_url || ''} className="object-cover" />
                                                                <AvatarFallback className="text-[10px] font-bold">PR</AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                                                                <span className="text-xs font-bold truncate block">{product.name}</span>
                                                                <span className={cn("text-[10px] font-medium truncate block", isSelected ? "text-white/60" : "text-muted-foreground")}>{product.code}</span>
                                                            </div>
                                                            <div className={cn(
                                                                "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all shrink-0",
                                                                isSelected ? "bg-white border-white text-brand-navy" : "border-brand-navy/10 text-transparent"
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

                                {/* ── TAB: WhatsApp (commercial) ─────────────────── */}
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
                                                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
                                                field.onChange({ ...access, mode: 'specific', instance_ids: next });
                                            };
                                            return (
                                                <FormItem className="space-y-5">
                                                    {/* Top toggle card */}
                                                    <div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-5">
                                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                                            <div className="w-11 h-11 rounded-2xl bg-[#25D366]/10 flex items-center justify-center shrink-0">
                                                                <FaWhatsapp className="w-5 h-5 text-[#25D366]" />
                                                            </div>
                                                            <div className="space-y-0.5 min-w-0">
                                                                <FormLabel className="text-xs font-bold text-brand-navy block">Enable inbox access</FormLabel>
                                                                <p className="text-[11px] text-muted-foreground leading-snug">
                                                                    Let this seller open the WhatsApp inbox for selected devices.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <Switch
                                                            checked={enabled}
                                                            onCheckedChange={(v) => setMode(v ? 'all' : 'none')}
                                                            className="data-[state=checked]:bg-[#25D366]"
                                                        />
                                                    </div>

                                                    {enabled && (
                                                        <>
                                                            {/* Mode selector */}
                                                            <RadioGroup
                                                                value={access.mode}
                                                                onValueChange={(v) => setMode(v as 'all' | 'specific')}
                                                                className="grid grid-cols-2 gap-3"
                                                            >
                                                                <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-white p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.04]">
                                                                    <RadioGroupItem value="all" id="wa-all-tab" className="mt-0.5" />
                                                                    <div className="space-y-0.5">
                                                                        <span className="text-xs font-bold text-brand-navy block">All devices</span>
                                                                        <p className="text-[10px] text-muted-foreground leading-snug">Includes future ones automatically</p>
                                                                    </div>
                                                                </label>
                                                                <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-white p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.04]">
                                                                    <RadioGroupItem value="specific" id="wa-specific-tab" className="mt-0.5" />
                                                                    <div className="space-y-0.5">
                                                                        <span className="text-xs font-bold text-brand-navy block">Specific</span>
                                                                        <p className="text-[10px] text-muted-foreground leading-snug">Pick devices below</p>
                                                                    </div>
                                                                </label>
                                                            </RadioGroup>

                                                            {/* Specific picker */}
                                                            {access.mode === 'specific' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Connected Devices</FormLabel>
                                                                        <Badge variant="outline" className="text-[10px] font-bold rounded-full">
                                                                            {(access.instance_ids || []).length} / {waInstances?.length || 0}
                                                                        </Badge>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
                                                                        {!waInstances?.length ? (
                                                                            <p className="col-span-full text-[11px] text-muted-foreground text-center py-8">
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
                                                                                            "flex items-center gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-all min-w-0",
                                                                                            checked
                                                                                                ? "bg-brand-navy border-brand-navy text-white"
                                                                                                : "bg-white border-brand-navy/5 hover:border-brand-navy/20"
                                                                                        )}
                                                                                    >
                                                                                        <Avatar className="h-9 w-9 rounded-full border border-muted shrink-0">
                                                                                            <AvatarImage src={inst.profile_pic || ''} className="object-cover" />
                                                                                            <AvatarFallback className="text-[10px] font-bold bg-brand-navy/10 text-brand-navy">
                                                                                                {inst.instance_name.substring(0, 2).toUpperCase()}
                                                                                            </AvatarFallback>
                                                                                        </Avatar>
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <p className="text-xs font-bold truncate">{inst.instance_name}</p>
                                                                                            {inst.phone_number && (
                                                                                                <p className={cn(
                                                                                                    "text-[10px] truncate",
                                                                                                    checked ? "text-white/60" : "text-muted-foreground"
                                                                                                )}>+{inst.phone_number}</p>
                                                                                            )}
                                                                                        </div>
                                                                                        <div className={cn(
                                                                                            "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all shrink-0",
                                                                                            checked ? "bg-white border-white text-brand-navy" : "border-brand-navy/10 text-transparent"
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

                                {/* ── TAB: Payment (mediabuyer) ──────────────────── */}
                                <TabsContent value="payment" className="m-0 space-y-5 outline-none">
                                    <FormField
                                        control={form.control}
                                        name="payment_type"
                                        render={({ field }) => (
                                            <FormItem className="space-y-3">
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Payment Structure</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                            <RadioGroupItem value="commission" id="mb-pay-commission" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="text-xs font-bold text-brand-navy block">Commission per delivered</span>
                                                                <p className="text-[10px] text-muted-foreground leading-snug">Fixed amount × each delivered order</p>
                                                            </div>
                                                        </label>
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                            <RadioGroupItem value="salary" id="mb-pay-salary" className="mt-0.5" />
                                                            <div className="space-y-0.5">
                                                                <span className="text-xs font-bold text-brand-navy block">Fixed salary</span>
                                                                <p className="text-[10px] text-muted-foreground leading-snug">Monthly fixed amount</p>
                                                            </div>
                                                        </label>
                                                    </RadioGroup>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {form.watch('payment_type') === 'commission' ? (
                                        <FormField
                                            control={form.control}
                                            name="commission_price"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Commission / delivered order</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-xs font-bold">DH</span>
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
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Monthly salary</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-xs font-bold">DH</span>
                                                        </div>
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </TabsContent>
                            </div>
                        </Tabs>

                        <DialogFooter className="px-4 py-3 border-t border-gray-100 gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="h-8 px-3 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-gray-100"
                            >
                                Discard
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-8 px-4 rounded-md bg-brand-navy hover:bg-brand-navy/90 text-white text-[11px] font-semibold gap-1.5"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {initialData ? 'Update Account' : 'Create User'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Users;
