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
    Download,
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
    MessageSquare,
    DollarSign,
    Store,
    Puzzle
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    role: z.enum(['super admin', 'admin', 'commercial']),
    assignment: z.number().default(0),
    commission_price: z.number().default(0),
    commission_basis: z.enum(['per_order', 'per_unit']).default('per_order'),
    products: z.array(z.string()).default([]),
    active: z.boolean().default(true),
    permissions: z.record(z.any()).default({}),
    avatar_url: z.string().optional().nullable(),
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
    { label: 'Sellers', path: '/sellers', icon: Store },
    { label: 'Demands', path: '/demands', icon: MessageSquare },
    { label: 'Salaries', path: '/salaries', icon: DollarSign },
    { label: 'Ads History', path: '/ads-history', icon: Target },
    { label: 'Expenses Details', path: '/expenses-details', icon: List },
    { label: 'Expenses Types', path: '/expenses-types', icon: Tag },
    { label: 'Businesses', path: '/businesses', icon: Building2 },
    { label: 'Import Orders', path: '/import-orders', icon: Download },
    { label: 'Profit Calculator', path: '/calculator', icon: Calculator },
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

    const addUserMutation = useMutation({
        mutationFn: async (values: UserFormValues) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: { ...values, 'DigiCom Business': activeBusinessId }
                }
            });

            if (error) throw error;
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
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'update',
                    userId: id,
                    userData: { ...values, 'DigiCom Business': activeBusinessId }
                }
            });

            if (error) throw error;
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
            const { error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'delete', userId: id }
            });

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
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
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Team Members</h1>
                            <p className="text-gray-500 font-light">Manage your team roles, permissions, and account access.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={() => setIsAddModalOpen(true)}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group"
                            >
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                                Add New User
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Card className="border-none shadow-sm bg-white/50 backdrop-blur-sm rounded-[24px]">
                <CardContent className="p-4">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <Input
                            placeholder="Search by name, username or email..."
                            className="pl-12 bg-transparent border-none text-lg h-12 focus-visible:ring-0"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </CardContent>
            </Card>

            <div>
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Card key={i} className="h-[280px] animate-pulse bg-muted rounded-[32px] border-none" />
                        ))}
                    </div>
                ) : filteredUsers?.length === 0 ? (
                    <div className="col-span-full text-center py-20 bg-white/50 backdrop-blur-sm rounded-[32px] mt-6">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-4">
                            <UserIcon className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-bold">No users found</h3>
                        <p className="text-muted-foreground">Try adjusting your search or add a new user.</p>
                    </div>
                ) : (
                    <div className="space-y-10 mt-6">
                        {['super admin', 'admin', 'commercial', 'delivery person', 'others'].map(roleGroup => {
                            const groupUsers = filteredUsers?.filter(u => {
                                const r = (u.role || '').toLowerCase();
                                if (roleGroup === 'super admin') return r === 'super admin';
                                if (roleGroup === 'admin') return r === 'admin';
                                if (roleGroup === 'commercial') return r === 'commercial';
                                if (roleGroup === 'delivery person') return r === 'delivery person' || r === 'courier';
                                if (roleGroup === 'others') return r !== 'super admin' && r !== 'admin' && r !== 'commercial' && r !== 'delivery person' && r !== 'courier';
                                return false;
                            });

                            if (!groupUsers || groupUsers.length === 0) return null;

                            const title = roleGroup === 'super admin' ? 'Super Admins' :
                                roleGroup === 'admin' ? 'Admins' :
                                    roleGroup === 'commercial' ? 'Commercials' :
                                        roleGroup === 'delivery person' ? 'Couriers' : 'Others';

                            return (
                                <div key={roleGroup} className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <h3 className="text-2xl font-black text-brand-navy">{title}</h3>
                                        <Badge variant="secondary" className="bg-brand-navy/10 text-brand-navy rounded-full px-2 py-0.5">{groupUsers.length}</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {groupUsers.map((user) => (
                                            <UserCard
                                                key={user.id}
                                                user={user}
                                                onEdit={() => setEditingUser(user)}
                                                onDelete={() => {
                                                    if (confirm("Are you sure you want to delete this user?")) {
                                                        deleteUserMutation.mutate(user.id);
                                                    }
                                                }}
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

const UserCard = ({ user, onEdit, onDelete }: { user: any, onEdit: () => void, onDelete: () => void }) => {
    return (
        <Card className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 rounded-[32px]">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 border-2 border-brand-white shadow-sm">
                        <AvatarImage src={user.avatar_url || ''} />
                        <AvatarFallback className="bg-brand-navy text-brand-white text-lg font-bold">
                            {user.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="space-y-0.5">
                        <CardTitle className="text-xl font-bold group-hover:text-brand-navy transition-colors">{user.name}</CardTitle>
                        <CardDescription className="flex items-center text-sm font-medium">
                            <Badge variant="secondary" className={cn(
                                "rounded-lg text-[10px] uppercase font-bold px-2 py-0.5",
                                user.role === 'super admin' ? "bg-brand-red/10 text-brand-red" :
                                    user.role === 'admin' ? "bg-brand-navy/10 text-brand-navy" :
                                        user.role === 'commercial' ? "bg-brand-blue/10 text-brand-blue" :
                                            "bg-emerald-500/10 text-emerald-600"
                            )}>
                                {user.role}
                            </Badge>
                        </CardDescription>
                    </div>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-10 w-10 rounded-full p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-xl">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer">
                            <Edit2 className="w-4 h-4 mr-3" />
                            Edit Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-brand-red hover:bg-brand-red/5">
                            <Trash2 className="w-4 h-4 mr-3" />
                            Delete User
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
                <div className={cn("grid gap-2 text-sm", user.role === 'commercial' ? "grid-cols-2" : "grid-cols-1")}>
                    <div className="flex flex-col p-3 rounded-2xl bg-muted/30">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Username</span>
                        <span className="font-semibold text-brand-navy truncate">@{user.username}</span>
                    </div>
                    {user.role === 'commercial' && (
                        <div className="flex flex-col p-3 rounded-2xl bg-muted/30">
                            <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Assignment</span>
                            <span className="font-semibold text-brand-navy">{user.assignment}</span>
                        </div>
                    )}
                </div>
                {user.role === 'commercial' && (
                    <div className="flex flex-col p-3 rounded-2xl bg-brand-blue/5 border border-brand-blue/10">
                        <div className="flex items-center gap-2 mb-1">
                            <Tag className="w-3.5 h-3.5 text-brand-blue/60" />
                            <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Commission Price</span>
                        </div>
                        <span className="font-semibold text-brand-blue">
                            {user.commission_price || 0} DH
                            <span className="text-[10px] font-bold text-brand-blue/70 ml-1">
                                {normalizeCommissionBasis(user.commission_basis) === 'per_unit' ? '/ unit' : '/ order'}
                            </span>
                        </span>
                    </div>
                )}
                <div className="flex flex-col p-3 rounded-2xl bg-brand-navy/5 border border-brand-navy/10">
                    <div className="flex items-center gap-2 mb-1">
                        <Mail className="w-3.5 h-3.5 text-brand-navy/60" />
                        <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Email Address</span>
                    </div>
                    <span className="font-medium text-brand-navy truncate">{user.email}</span>
                </div>
            </CardContent>
            <CardFooter className="pt-0 pb-6 flex items-center justify-between">
                <div className="flex -space-x-2">
                    {user.products && (Array.isArray(user.products) ? user.products : []).slice(0, 3).map((p: string, i: number) => (
                        <div key={i} className="w-8 h-8 rounded-full bg-brand-white border-2 border-brand-navy/10 flex items-center justify-center shadow-sm">
                            <Package className="w-4 h-4 text-brand-navy/60" />
                        </div>
                    ))}
                    {(user.products?.length > 3) && (
                        <div className="w-8 h-8 rounded-full bg-muted border-2 border-brand-white flex items-center justify-center text-[10px] font-bold">
                            +{user.products.length - 3}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "w-2 h-2 rounded-full",
                        user.active ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-muted"
                    )} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {user.active ? 'Active' : 'Inactive'}
                    </span>
                </div>
            </CardFooter>
        </Card>
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
            products: [],
            active: true,
            permissions: {},
        }
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

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({
                    ...initialData,
                    password: '',
                    commission_basis: normalizeCommissionBasis(initialData.commission_basis),
                    products: Array.isArray(initialData.products) ? initialData.products : [],
                    permissions: initialData.permissions || {},
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
                    products: [],
                    active: true,
                    permissions: {},
                });
                setAvatarPreview(null);
            }
        }
    }, [initialData, form, isOpen]);

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
        let finalValues = { ...values };

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
            <DialogContent className="max-w-6xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col h-full overflow-hidden">
                        <DialogHeader className="p-8 pb-4 border-b border-brand-navy/5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <DialogTitle className="text-3xl font-bold text-brand-navy">{title}</DialogTitle>
                                    <DialogDescription className="text-muted-foreground mt-1 text-base">
                                        Configure account details and access levels.
                                    </DialogDescription>
                                </div>
                            </div>
                        </DialogHeader>

                        <div className="flex flex-col lg:flex-row min-h-[500px] max-h-[70vh] overflow-hidden">
                            {/* Main Section - Base Information */}
                            <ScrollArea className="flex-1 p-8">
                                <div className="space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* Avatar Section */}
                                        <div className="space-y-4">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Profile Avatar</FormLabel>
                                            <div
                                                {...getRootProps()}
                                                className={cn(
                                                    "relative group flex flex-col items-center justify-center border-2 border-dashed rounded-[40px] p-4 transition-all duration-500 cursor-pointer overflow-hidden aspect-square max-w-[180px] bg-brand-navy/[0.02]",
                                                    isDragActive ? "border-brand-blue bg-brand-blue/5 scale-95" : "border-brand-navy/10 hover:border-brand-navy/30 hover:bg-brand-navy/[0.05]",
                                                    avatarPreview ? "p-0" : ""
                                                )}
                                            >
                                                <input {...getInputProps()} />
                                                {avatarPreview ? (
                                                    <>
                                                        <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                                                        <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                                                            <div className="bg-brand-white/20 p-3 rounded-full border border-brand-white/30 backdrop-blur-md">
                                                                <Upload className="w-6 h-6 text-brand-white" />
                                                            </div>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-center group-hover:scale-105 transition-transform duration-500">
                                                        <div className="w-12 h-12 rounded-[18px] bg-brand-navy/5 flex items-center justify-center mx-auto mb-2 border border-brand-navy/5">
                                                            <Upload className="w-5 h-5 text-brand-navy/40" />
                                                        </div>
                                                        <p className="text-[10px] font-bold text-brand-navy">Drop Image</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Name & Role Section */}
                                        <div className="space-y-6">
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Full Name</FormLabel>
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
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">System Role</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy focus:ring-2 focus:ring-brand-navy/10 transition-all shadow-inner">
                                                                    <SelectValue placeholder="Assign a role" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white/95 backdrop-blur-xl">
                                                                {['super admin', 'admin', 'commercial'].map((role) => (
                                                                    <SelectItem key={role} value={role} className="rounded-xl p-3 capitalize font-bold text-brand-navy focus:bg-brand-navy focus:text-brand-white transition-colors cursor-pointer">
                                                                        {role}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <FormField
                                            control={form.control}
                                            name="username"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Username</FormLabel>
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
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Email Address</FormLabel>
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

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Password</FormLabel>
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
                                                <FormItem className="flex flex-col justify-end">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">Account Status</FormLabel>
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
                                </div>
                            </ScrollArea>

                            {/* Side Section - Role Specific Details */}
                            {form.watch('role') !== 'super admin' && (
                                <div className="w-full lg:w-[450px] bg-muted/20 border-l border-brand-navy/5 flex flex-col overflow-hidden">
                                    <div className="p-8 pb-4">
                                        <h4 className="text-xl font-bold text-brand-navy">
                                            {form.watch('role') === 'admin' ? 'Page Access' : 'Business Parameters'}
                                        </h4>
                                        <p className="text-xs text-muted-foreground font-medium">
                                            {form.watch('role') === 'admin' ? 'Select which modules this admin can access.' : 'Configure sales targets and product scope.'}
                                        </p>
                                    </div>

                                    <ScrollArea className="flex-1 p-8 pt-2">
                                        {form.watch('role') === 'admin' && (
                                            <div className="grid grid-cols-1 gap-3">
                                                {pages.map((page) => {
                                                    const isChecked = form.watch('permissions.pages')?.[page.path];
                                                    return (
                                                        <div
                                                            key={page.path}
                                                            className={cn(
                                                                "flex items-center gap-4 p-4 rounded-2xl transition-all duration-200 cursor-pointer group border-2",
                                                                isChecked
                                                                    ? "bg-brand-navy border-brand-navy text-brand-white"
                                                                    : "bg-brand-white border-transparent hover:border-brand-navy/10"
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
                                                                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                                                                isChecked ? "bg-white/10" : "bg-brand-navy/5 text-brand-navy"
                                                            )}>
                                                                <page.icon className="w-5 h-5" />
                                                            </div>
                                                            <span className="text-sm font-bold flex-1">{page.label}</span>
                                                            <div className={cn(
                                                                "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all",
                                                                isChecked ? "bg-white border-white text-brand-navy" : "border-brand-navy/10 text-transparent"
                                                            )}>
                                                                <Check className="w-3.5 h-3.5" />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {form.watch('role') === 'commercial' && (
                                            <div className="space-y-8">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="assignment"
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-2">
                                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Order Attribution</FormLabel>
                                                                <FormControl>
                                                                    <div className="relative">
                                                                        <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-white text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-sm" />
                                                                    </div>
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
                                                                        <Input type="number" placeholder="0" {...field} onChange={e => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-white text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-sm" />
                                                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/20 text-xs">DH</span>
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
                                                        <FormItem className="space-y-3 rounded-2xl border border-brand-navy/10 bg-brand-navy/[0.02] p-4">
                                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                                                                Commission calculation
                                                            </FormLabel>
                                                            <FormControl>
                                                                <RadioGroup
                                                                    onValueChange={field.onChange}
                                                                    value={field.value}
                                                                    className="grid gap-3"
                                                                >
                                                                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 hover:bg-brand-white/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-navy/20">
                                                                        <RadioGroupItem value="per_order" id="commission-per-order" className="mt-0.5" />
                                                                        <div className="space-y-0.5">
                                                                            <span className="text-sm font-bold text-brand-navy">Per order</span>
                                                                            <p className="text-[11px] text-muted-foreground leading-snug">
                                                                                Commission price × each delivered order
                                                                            </p>
                                                                        </div>
                                                                    </label>
                                                                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 hover:bg-brand-white/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-navy/20">
                                                                        <RadioGroupItem value="per_unit" id="commission-per-unit" className="mt-0.5" />
                                                                        <div className="space-y-0.5">
                                                                            <span className="text-sm font-bold text-brand-navy">Per unit</span>
                                                                            <p className="text-[11px] text-muted-foreground leading-snug">
                                                                                Commission price × total units (assigned products only) across delivered orders
                                                                            </p>
                                                                        </div>
                                                                    </label>
                                                                </RadioGroup>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Available Products</FormLabel>
                                                        <Badge variant="outline" className="text-[10px] font-bold">{form.watch('products')?.length || 0} selected</Badge>
                                                    </div>
                                                    <div className="relative">
                                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                                        <Input
                                                            placeholder="Search products..."
                                                            value={productSearch}
                                                            onChange={(e) => setProductSearch(e.target.value)}
                                                            className="h-11 pl-11 rounded-2xl border-none bg-white shadow-sm text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium"
                                                        />
                                                    </div>
                                                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                                        {!activeBusinessId ? (
                                                            <p className="text-xs text-muted-foreground text-center py-8 px-2">
                                                                No business selected. Open the app with an active business (e.g. from your profile or business switcher) before assigning products.
                                                            </p>
                                                        ) : isProductsLoading ? (
                                                            <div className="flex justify-center py-12">
                                                                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                                                            </div>
                                                        ) : !filteredProducts?.length ? (
                                                            <p className="text-xs text-muted-foreground text-center py-8">
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
                                                                            "flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer border-2 group",
                                                                            isSelected ? "bg-brand-navy border-brand-navy text-white" : "bg-white border-transparent hover:border-brand-navy/10"
                                                                        )}
                                                                    >
                                                                        <Avatar className="h-10 w-10 rounded-xl border border-muted group-hover:scale-105 transition-transform">
                                                                            <AvatarImage src={product.image_url || ''} className="object-cover" />
                                                                            <AvatarFallback className="text-[10px] font-bold">PR</AvatarFallback>
                                                                        </Avatar>
                                                                        <div className="flex flex-col min-w-0 flex-1">
                                                                            <span className="text-xs font-bold truncate">{product.name}</span>
                                                                            <span className={cn("text-[10px] font-medium", isSelected ? "text-white/60" : "text-muted-foreground")}>{product.code}</span>
                                                                        </div>
                                                                        <div className={cn(
                                                                            "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all",
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
                                            </div>
                                        )}
                                    </ScrollArea>
                                </div>
                            )}
                        </div>

                        <DialogFooter className="p-8 pb-8 pt-4 gap-4 bg-brand-white border-t border-brand-navy/5">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="h-12 px-8 rounded-2xl font-bold text-xs uppercase tracking-widest text-muted-foreground hover:bg-muted/50 hover:text-brand-navy transition-all"
                            >
                                Discard
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-12 px-10 rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-brand-white font-bold text-xs uppercase tracking-[0.1em] shadow-xl shadow-brand-navy/20 transition-all hover:translate-y-[-2px] active:scale-95 disabled:opacity-50"
                            >
                                {loading && <Loader2 className="w-4 h-4 mr-3 animate-spin" />}
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
