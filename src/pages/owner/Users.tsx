import React, { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Mail,
    User as UserIcon,
    Loader2,
    Upload,
    Check,
    X,
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter,
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
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

const ownerUserSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    username: z.string().min(3, 'Username must be at least 3 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
    active: z.boolean().default(true),
    avatar_url: z.string().optional().nullable(),
});

type OwnerUserFormValues = z.infer<typeof ownerUserSchema>;

const OwnerUsers = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: users, isLoading } = useQuery({
        queryKey: ['owner-users'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('role', 'owner')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const createMutation = useMutation({
        mutationFn: async (values: OwnerUserFormValues) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: { ...values, role: 'owner' },
                },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['owner-users'] });
            setIsModalOpen(false);
            toast({ title: 'User created', description: 'Owner account has been provisioned.' });
        },
        onError: (err: any) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string; values: OwnerUserFormValues }) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'update',
                    userId: id,
                    userData: { ...values, role: 'owner' },
                },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['owner-users'] });
            setEditingUser(null);
            toast({ title: 'User updated', description: 'Owner account has been updated.' });
        },
        onError: (err: any) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.functions.invoke('manage-users', {
                body: { action: 'delete', userId: id },
            });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['owner-users'] });
            toast({ title: 'User deleted', description: 'Owner account has been removed.' });
        },
        onError: (err: any) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const filteredUsers = users?.filter(
        (u) =>
            u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Owner Users</h1>
                            <p className="text-gray-500 font-light">Manage accounts with owner-level access.</p>
                        </div>
                        <Button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group"
                        >
                            <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                            Add Owner
                        </Button>
                    </div>
                </div>
            </div>

            {/* Search */}
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

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                        <Card key={i} className="h-[240px] animate-pulse bg-muted rounded-[32px] border-none" />
                    ))}
                </div>
            ) : filteredUsers?.length === 0 ? (
                <div className="text-center py-20 bg-white/50 backdrop-blur-sm rounded-[32px]">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-4">
                        <UserIcon className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-bold">No owner users found</h3>
                    <p className="text-muted-foreground">Add a new owner account to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredUsers?.map((user) => (
                        <OwnerUserCard
                            key={user.id}
                            user={user}
                            onEdit={() => setEditingUser(user)}
                            onDelete={() => {
                                if (confirm('Are you sure you want to delete this owner account?')) {
                                    deleteMutation.mutate(user.id);
                                }
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Create Modal */}
            <OwnerUserModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={(values) => createMutation.mutate(values)}
                loading={createMutation.isPending}
                title="Create Owner Account"
            />

            {/* Edit Modal */}
            {editingUser && (
                <OwnerUserModal
                    isOpen={!!editingUser}
                    onClose={() => setEditingUser(null)}
                    onSubmit={(values) => updateMutation.mutate({ id: editingUser.id, values })}
                    initialData={editingUser}
                    loading={updateMutation.isPending}
                    title="Edit Owner Account"
                />
            )}
        </div>
    );
};

const OwnerUserCard = ({ user, onEdit, onDelete }: { user: any; onEdit: () => void; onDelete: () => void }) => (
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
                    <CardTitle className="text-xl font-bold group-hover:text-brand-navy transition-colors">
                        {user.name}
                    </CardTitle>
                    <CardDescription>
                        <Badge
                            variant="secondary"
                            className="rounded-lg text-[10px] uppercase font-bold px-2 py-0.5 bg-amber-500/10 text-amber-600"
                        >
                            owner
                        </Badge>
                    </CardDescription>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="h-10 w-10 rounded-full p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreVertical className="h-5 w-5 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-xl">
                    <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer">
                        <Edit2 className="w-4 h-4 mr-3" />
                        Edit Account
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={onDelete}
                        className="rounded-xl p-3 cursor-pointer text-brand-red hover:bg-brand-red/5"
                    >
                        <Trash2 className="w-4 h-4 mr-3" />
                        Delete Account
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
            <div className="flex flex-col p-3 rounded-2xl bg-muted/30">
                <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Username</span>
                <span className="font-semibold text-brand-navy truncate">@{user.username}</span>
            </div>
            <div className="flex flex-col p-3 rounded-2xl bg-brand-navy/5 border border-brand-navy/10">
                <div className="flex items-center gap-2 mb-1">
                    <Mail className="w-3.5 h-3.5 text-brand-navy/60" />
                    <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">Email</span>
                </div>
                <span className="font-medium text-brand-navy truncate">{user.email}</span>
            </div>
        </CardContent>
        <CardFooter className="pt-0 pb-6 flex items-center justify-end">
            <div className="flex items-center gap-2">
                <div
                    className={cn(
                        'w-2 h-2 rounded-full',
                        user.active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-muted'
                    )}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {user.active ? 'Active' : 'Inactive'}
                </span>
            </div>
        </CardFooter>
    </Card>
);

const OwnerUserModal = ({ isOpen, onClose, onSubmit, initialData, loading, title }: any) => {
    const [avatar, setAvatar] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(initialData?.avatar_url || null);

    const form = useForm<OwnerUserFormValues>({
        resolver: zodResolver(ownerUserSchema),
        defaultValues: {
            name: '',
            username: '',
            email: '',
            password: '',
            active: true,
            avatar_url: null,
        },
    });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({
                    name: initialData.name,
                    username: initialData.username,
                    email: initialData.email,
                    password: '',
                    active: initialData.active,
                    avatar_url: initialData.avatar_url,
                });
                setAvatarPreview(initialData.avatar_url);
            } else {
                form.reset({ name: '', username: '', email: '', password: '', active: true, avatar_url: null });
                setAvatarPreview(null);
            }
            setAvatar(null);
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
        multiple: false,
    });

    const handleFormSubmit = async (values: OwnerUserFormValues) => {
        const finalValues = { ...values };

        if (avatar) {
            const fileExt = avatar.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `avatars/${fileName}`;

            const { error: uploadError } = await supabase.storage.from('avatar').upload(filePath, avatar);

            if (!uploadError) {
                const {
                    data: { publicUrl },
                } = supabase.storage.from('avatar').getPublicUrl(filePath);
                finalValues.avatar_url = publicUrl;
            }
        }

        onSubmit(finalValues);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col">
                        <DialogHeader className="p-8 pb-4 border-b border-brand-navy/5">
                            <DialogTitle className="text-3xl font-bold text-brand-navy">{title}</DialogTitle>
                            <DialogDescription className="text-muted-foreground mt-1">
                                Role is locked to <span className="font-bold text-amber-600">Owner</span>.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="p-8 space-y-6">
                            {/* Avatar */}
                            <div className="flex items-center gap-6">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative group flex items-center justify-center border-2 border-dashed rounded-full w-20 h-20 shrink-0 cursor-pointer transition-all overflow-hidden',
                                        isDragActive
                                            ? 'border-brand-blue bg-brand-blue/5'
                                            : 'border-brand-navy/10 hover:border-brand-navy/30',
                                        avatarPreview && 'border-transparent'
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-brand-navy/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-5 h-5 text-white" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-5 h-5 text-brand-navy/30" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-brand-navy">Profile Photo</p>
                                    <p className="text-xs text-muted-foreground">Click or drop an image</p>
                                </div>
                            </div>

                            {/* Name & Username */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                                                Full Name
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="John Doe"
                                                    {...field}
                                                    className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="username"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                                                Username
                                            </FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-brand-navy/30 font-black text-sm">
                                                        @
                                                    </span>
                                                    <Input
                                                        placeholder="johndoe"
                                                        {...field}
                                                        className="h-12 pl-10 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner"
                                                    />
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Email */}
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                                            Email Address
                                        </FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                                <Input
                                                    type="email"
                                                    placeholder="john@example.com"
                                                    {...field}
                                                    className="h-12 pl-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner"
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Password & Active */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                                                Password
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="password"
                                                    placeholder={initialData ? '••••••••' : 'Min 6 chars'}
                                                    {...field}
                                                    className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-sm font-bold text-brand-navy shadow-inner"
                                                />
                                            </FormControl>
                                            {initialData && (
                                                <FormDescription className="text-[10px] uppercase font-bold text-brand-navy/30 px-2">
                                                    Leave blank to keep current
                                                </FormDescription>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="active"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col justify-end">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
                                                Status
                                            </FormLabel>
                                            <div className="flex items-center gap-4 h-12 bg-brand-navy/[0.04] px-4 rounded-2xl shadow-inner">
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className="data-[state=checked]:bg-green-500"
                                                />
                                                <span className="text-xs font-black uppercase text-brand-navy tracking-tight">
                                                    {field.value ? 'Active' : 'Disabled'}
                                                </span>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        <DialogFooter className="p-8 pt-4 gap-4 border-t border-brand-navy/5">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onClose}
                                className="h-12 px-8 rounded-2xl font-bold text-xs uppercase tracking-widest text-muted-foreground"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="h-12 px-10 rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-brand-white font-bold text-xs uppercase tracking-[0.1em] shadow-xl shadow-brand-navy/20 transition-all hover:translate-y-[-2px] active:scale-95 disabled:opacity-50"
                            >
                                {loading && <Loader2 className="w-4 h-4 mr-3 animate-spin" />}
                                {initialData ? 'Update Account' : 'Create Owner'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default OwnerUsers;
