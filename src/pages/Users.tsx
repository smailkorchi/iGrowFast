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
    MapPin,
    Map,
    Download,
    CheckCircle,
    Home,
    ShoppingBag,
    FileText,
    Repeat,
    Globe,
    CreditCard,
    RefreshCcw,
    BarChart2,
    Megaphone,
    Users as UsersGroupIcon // Renamed Users to UsersGroupIcon to avoid conflict with the component name 'Users'
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

// --- Types ---
const userSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal('')),
    role: z.enum(['super admin', 'admin', 'mediabuyer', 'commercial']),
    assignment: z.number().default(0),
    products: z.array(z.string()).default([]),
    active: z.boolean().default(true),
    permissions: z.record(z.any()).default({}),
    avatar_url: z.string().optional().nullable(),
});

type UserFormValues = z.infer<typeof userSchema>;

const pages = [
    { label: 'Dashboard', path: '/', icon: Home },
    { label: 'Orders', path: '/orders', icon: ShoppingBag },
    { label: 'Delivery Note', path: '/delivery-note', icon: FileText },
    { label: 'Return Note', path: '/return-note', icon: Repeat },
    { label: 'Delivery Services', path: '/delivery-services', icon: Globe },
    { label: 'Payments', path: '/payments', icon: CreditCard },
    { label: 'Transactions', path: '/transactions', icon: ArrowRightLeft },
    { label: 'Products', path: '/products', icon: Box },
    { label: 'Status', path: '/status', icon: RefreshCcw },
    { label: 'Analytics', path: '/analytics', icon: BarChart2 },
    { label: 'Sales Channels', path: '/sales-channels', icon: Megaphone },
    { label: 'Customers', path: '/customers', icon: UsersGroupIcon },
    { label: 'Users', path: '/users', icon: UserPlus },
    { label: 'Expenses Details', path: '/expenses-details', icon: List },
    { label: 'Expenses Types', path: '/expenses-types', icon: Tag },
    { label: 'Cities', path: '/cities', icon: MapPin },
    { label: 'Zones', path: '/zones', icon: Map },
    { label: 'Import Orders', path: '/import-orders', icon: Download },
    { label: 'Import Status', path: '/import-status', icon: CheckCircle },
];

const Users = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---
    const { data: users, isLoading } = useQuery({
        queryKey: ['users'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const addUserMutation = useMutation({
        mutationFn: async (values: UserFormValues) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'create', userData: values }
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
                body: { action: 'update', userId: id, userData: values }
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-bold tracking-tight text-brand-navy">Team Members</h1>
                    <p className="text-muted-foreground mt-2 text-lg">Manage your team roles, permissions, and account access.</p>
                </div>
                <Button
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 text-base font-semibold shadow-lg shadow-brand-navy/20 transition-all hover:scale-[1.02]"
                >
                    <Plus className="w-5 h-5 mr-2" />
                    Add New User
                </Button>
            </div>

            <Card className="border-none shadow-sm bg-brand-white/50 backdrop-blur-sm rounded-[24px]">
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <Card key={i} className="h-[280px] animate-pulse bg-muted rounded-[32px] border-none" />
                    ))
                ) : filteredUsers?.length === 0 ? (
                    <div className="col-span-full text-center py-20">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-4">
                            <UserIcon className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-bold">No users found</h3>
                        <p className="text-muted-foreground">Try adjusting your search or add a new user.</p>
                    </div>
                ) : (
                    filteredUsers?.map((user) => (
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
                    ))
                )}
            </div>

            <UserModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={(values) => addUserMutation.mutate(values)}
                loading={addUserMutation.isPending}
                title="Create New User"
            />

            {editingUser && (
                <UserModal
                    isOpen={!!editingUser}
                    onClose={() => setEditingUser(null)}
                    onSubmit={(values) => updateUserMutation.mutate({ id: editingUser.id, values })}
                    initialData={editingUser}
                    loading={updateUserMutation.isPending}
                    title="Edit User"
                />
            )}
        </div>
    );
};

const UserCard = ({ user, onEdit, onDelete }: { user: any, onEdit: () => void, onDelete: () => void }) => {
    return (
        <Card className="group relative overflow-hidden border border-brand-white/10 bg-brand-white hover:shadow-2xl hover:shadow-brand-navy/5 transition-all duration-300 rounded-[32px]">
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
                                        "bg-brand-blue/10 text-brand-blue"
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
                <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex flex-col p-3 rounded-2xl bg-muted/30">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Username</span>
                        <span className="font-semibold text-brand-navy truncate">@{user.username}</span>
                    </div>
                    <div className="flex flex-col p-3 rounded-2xl bg-muted/30">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Assignment</span>
                        <span className="font-semibold text-brand-navy">{user.assignment}%</span>
                    </div>
                </div>
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

const UserModal = ({ isOpen, onClose, onSubmit, initialData, loading, title }: any) => {
    const [avatar, setAvatar] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(initialData?.avatar_url || null);
    const [activeTab, setActiveTab] = useState<'details' | 'permissions'>('details');

    const form = useForm<UserFormValues>({
        resolver: zodResolver(userSchema),
        defaultValues: {
            name: '',
            username: '',
            email: '',
            password: '',
            role: 'commercial',
            assignment: 0,
            products: [],
            active: true,
            permissions: {},
        }
    });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({
                    ...initialData,
                    password: '',
                    products: Array.isArray(initialData.products) ? initialData.products : [],
                    permissions: initialData.permissions || {},
                });
                setAvatarPreview(initialData.avatar_url);
            } else {
                form.reset({
                    name: '',
                    username: '',
                    email: '',
                    password: '',
                    role: 'commercial',
                    assignment: 0,
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
            <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden overflow-y-auto max-h-[90vh]">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)}>
                        <DialogHeader className="p-8 pb-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <DialogTitle className="text-3xl font-bold text-brand-navy">{title}</DialogTitle>
                                    <DialogDescription className="text-muted-foreground mt-1 text-base">
                                        Account management and security settings.
                                    </DialogDescription>
                                </div>
                                <div className="flex bg-muted/50 p-1.5 rounded-[22px] border border-muted shadow-inner">
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('details')}
                                        className={cn(
                                            "px-8 py-2.5 rounded-[18px] text-sm font-bold transition-all duration-300",
                                            activeTab === 'details' ? "bg-brand-white shadow-md text-brand-navy scale-[1.02]" : "text-muted-foreground hover:text-brand-navy"
                                        )}
                                    >
                                        Member Profile
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('permissions')}
                                        className={cn(
                                            "px-8 py-2.5 rounded-[18px] text-sm font-bold transition-all duration-300",
                                            activeTab === 'permissions' ? "bg-brand-white shadow-md text-brand-navy scale-[1.02]" : "text-muted-foreground hover:text-brand-navy"
                                        )}
                                    >
                                        Permissions
                                    </button>
                                </div>
                            </div>
                        </DialogHeader>

                        <ScrollArea className="h-full min-h-[500px] max-h-[60vh] p-8 pt-6">
                            {activeTab === 'details' ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                    <div className="space-y-8 animate-in slide-in-from-left-4 duration-500">
                                        <div className="space-y-4">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Profile Picture</FormLabel>
                                            <div
                                                {...getRootProps()}
                                                className={cn(
                                                    "relative group flex flex-col items-center justify-center border-2 border-dashed rounded-[40px] p-8 transition-all duration-500 cursor-pointer overflow-hidden aspect-square max-w-[240px] mx-auto bg-brand-navy/[0.02]",
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
                                                        <div className="w-20 h-20 rounded-[24px] bg-brand-navy/5 flex items-center justify-center mx-auto mb-4 border border-brand-navy/5">
                                                            <Upload className="w-8 h-8 text-brand-navy/40" />
                                                        </div>
                                                        <p className="text-sm font-bold text-brand-navy">Drop image here</p>
                                                        <span className="text-[10px] text-muted-foreground mt-1 block uppercase tracking-tighter">or click to browse</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <FormField
                                            control={form.control}
                                            name="role"
                                            render={({ field }) => (
                                                <FormItem className="space-y-2">
                                                    <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Organizational Role</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy focus:ring-2 focus:ring-brand-navy/10 transition-all shadow-inner">
                                                                <SelectValue placeholder="Assign a role" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white/95 backdrop-blur-xl">
                                                            {['super admin', 'admin', 'mediabuyer', 'commercial'].map((role) => (
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

                                        <div className="grid grid-cols-2 gap-6">
                                            <FormField
                                                control={form.control}
                                                name="assignment"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Monthly Assignment</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input
                                                                    type="number"
                                                                    {...field}
                                                                    onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                                                                    className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/[0.04] text-lg font-black text-brand-navy shadow-inner"
                                                                />
                                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-navy/30 font-bold">%</span>
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="active"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-col justify-end">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">Status</FormLabel>
                                                        <div className="flex items-center gap-4 h-14 bg-brand-navy/[0.04] px-4 rounded-2xl border border-transparent transition-all shadow-inner">
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

                                    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                                        <div className="grid grid-cols-1 gap-6">
                                            <FormField
                                                control={form.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Full Identification Name</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="E.g. Alexander Pierce" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="grid grid-cols-1 gap-6">
                                                <FormField
                                                    control={form.control}
                                                    name="username"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2">
                                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Username Address</FormLabel>
                                                            <FormControl>
                                                                <div className="relative">
                                                                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-navy/30 font-black">@</span>
                                                                    <Input placeholder="p_alexander" {...field} className="h-14 pl-10 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Official Email</FormLabel>
                                                            <FormControl>
                                                                <div className="relative">
                                                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                                                    <Input type="email" placeholder="alex@digicom.team" {...field} className="h-14 pl-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                                </div>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <FormField
                                                control={form.control}
                                                name="password"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Secure Code</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="password"
                                                                placeholder={initialData ? "••••••••" : "Minimum 8 characters"}
                                                                {...field}
                                                                className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner"
                                                            />
                                                        </FormControl>
                                                        {initialData && <FormDescription className="text-[10px] uppercase font-bold text-brand-navy/30 px-2 tracking-widest">Only fill if you need to reset</FormDescription>}
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="products"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Inventory Scope (SKUs)</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                placeholder="DIGI-01, DIGI-02"
                                                                value={field.value.join(', ')}
                                                                onChange={e => field.onChange(e.target.value.split(',').map(s => s.trim()).filter(s => s !== ''))}
                                                                className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-10 animate-in slide-in-from-right-6 duration-700">
                                    <div className="bg-brand-navy/[0.03] p-8 rounded-[40px] border border-brand-navy/[0.06] shadow-inner">
                                        <div className="flex items-center gap-5 mb-8">
                                            <div className="w-14 h-14 rounded-[20px] bg-brand-navy text-brand-white flex items-center justify-center shadow-lg shadow-brand-navy/30">
                                                <Shield className="w-7 h-7" />
                                            </div>
                                            <div>
                                                <h4 className="text-xl font-black text-brand-navy tracking-tight">System Module Access</h4>
                                                <p className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wider">Define environment visibility per page</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {pages.map((page) => (
                                                <div
                                                    key={page.path}
                                                    className={cn(
                                                        "flex items-center gap-4 p-5 rounded-[22px] transition-all duration-300 cursor-pointer group/row border-2",
                                                        form.watch('permissions.pages')?.[page.path]
                                                            ? "bg-brand-navy border-brand-navy shadow-2xl shadow-brand-navy/20"
                                                            : "bg-brand-white border-transparent hover:border-brand-navy/10 hover:shadow-xl"
                                                    )}
                                                    onClick={() => {
                                                        const current = form.getValues('permissions.pages') || {};
                                                        form.setValue('permissions.pages', {
                                                            ...current,
                                                            [page.path]: !current[page.path]
                                                        });
                                                    }}
                                                >
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500",
                                                        form.watch('permissions.pages')?.[page.path]
                                                            ? "bg-brand-white/10 text-brand-white scale-110"
                                                            : "bg-brand-navy/5 text-brand-navy"
                                                    )}>
                                                        <page.icon className="w-5 h-5" />
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className={cn(
                                                            "text-sm font-black transition-colors truncate",
                                                            form.watch('permissions.pages')?.[page.path] ? "text-brand-white" : "text-brand-navy"
                                                        )}>
                                                            {page.label}
                                                        </span>
                                                    </div>
                                                    <div className={cn(
                                                        "ml-auto w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500",
                                                        form.watch('permissions.pages')?.[page.path]
                                                            ? "bg-brand-white text-brand-navy rotate-0"
                                                            : "bg-brand-navy/5 text-transparent -rotate-90 scale-50"
                                                    )}>
                                                        <Check className="w-3.5 h-3.5" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-6 px-4">
                                        <div className="flex items-center gap-2">
                                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Structural Action Rights</h5>
                                            <div className="h-px flex-1 bg-brand-navy/5" />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                                            {[
                                                { key: 'can_create', label: 'Write Access', desc: 'Create new records' },
                                                { key: 'can_edit', label: 'Modify Access', desc: 'Edit existing data' },
                                                { key: 'can_delete', label: 'Purge Access', desc: 'Remove entries' },
                                                { key: 'can_export', label: 'Export Rights', desc: 'Download CSV/PDF' },
                                                { key: 'can_import', label: 'Import Rights', desc: 'Upload bulk data' },
                                                { key: 'can_view_sensitive', label: 'Sensitive View', desc: 'Hidden info' },
                                            ].map((perm) => (
                                                <div
                                                    key={perm.key}
                                                    className={cn(
                                                        "flex flex-col gap-3 p-6 rounded-[32px] transition-all duration-300 border-2",
                                                        form.watch(`permissions.actions.${perm.key}`)
                                                            ? "bg-brand-white border-brand-navy shadow-xl"
                                                            : "bg-brand-navy/[0.02] border-transparent hover:bg-brand-navy/[0.04]"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-sm font-black text-brand-navy uppercase tracking-tight">{perm.label}</span>
                                                        <Checkbox
                                                            id={perm.key}
                                                            checked={form.watch(`permissions.actions.${perm.key}`)}
                                                            onCheckedChange={(checked) => {
                                                                form.setValue(`permissions.actions.${perm.key}`, checked === true);
                                                            }}
                                                            className="w-6 h-6 rounded-lg border-2 border-brand-navy/20 data-[state=checked]:bg-brand-navy data-[state=checked]:border-brand-navy"
                                                        />
                                                    </div>
                                                    <p className="text-[10px] font-bold text-muted-foreground/60 leading-relaxed uppercase tracking-widest">{perm.desc}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </ScrollArea>

                        <DialogFooter className="p-8 pt-4 gap-4 bg-brand-white border-t border-brand-navy/5">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="h-14 px-8 rounded-2xl font-black text-xs uppercase tracking-widest text-muted-foreground hover:bg-muted/50 hover:text-brand-navy transition-all"
                            >
                                Discard Changes
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-14 px-12 rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-brand-white font-black text-xs uppercase tracking-[0.1em] shadow-2xl shadow-brand-navy/40 transition-all hover:translate-y-[-2px] active:scale-95 disabled:opacity-50"
                            >
                                {loading && <Loader2 className="w-4 h-4 mr-3 animate-spin" />}
                                {initialData ? 'Save Modifications' : 'Finalize Account'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Users;
