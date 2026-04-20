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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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

// Slim users row used by the owner picker (full schema verified via MCP).
type OwnerUserRow = {
    id: string;
    name: string;
    username: string;
    email: string;
    role: string;
    avatar_url: string | null;
    active: boolean | null;
    created_at: string;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

const OwnerUsers = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<OwnerUserRow | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [userToDelete, setUserToDelete] = useState<OwnerUserRow | null>(null);
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
            return (data || []) as unknown as OwnerUserRow[];
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
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
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
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
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
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const filteredUsers = users?.filter(
        (u) =>
            u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Owner Users</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Accounts with owner-level platform access</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search by name, username or email..."
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-56"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <Button
                            onClick={() => setIsModalOpen(true)}
                            className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5 px-3"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add Owner
                        </Button>
                    </div>
                </div>
            </header>

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-36 rounded-xl bg-white border border-gray-100 animate-pulse" />
                    ))}
                </div>
            ) : filteredUsers?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 bg-white">
                    <UserIcon className="w-6 h-6 text-gray-300 mb-2" />
                    <p className="text-[11px] font-medium text-gray-500">No owner users found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredUsers?.map((user) => (
                        <OwnerUserCard
                            key={user.id}
                            user={user}
                            onEdit={() => setEditingUser(user)}
                            onDelete={() => setUserToDelete(user)}
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

            <ConfirmDialog
                open={!!userToDelete}
                onOpenChange={(o) => { if (!o) setUserToDelete(null); }}
                kicker="Propriétaire · Suppression"
                title="Supprimer ce compte propriétaire ?"
                description={userToDelete
                    ? `« ${userToDelete.name} » perdra son accès et sera retiré de la plateforme. L'action est irréversible.`
                    : undefined}
                confirmLabel="Supprimer le compte"
                loading={deleteMutation.isPending}
                onConfirm={() => {
                    if (!userToDelete) return;
                    deleteMutation.mutate(userToDelete.id, {
                        onSettled: () => setUserToDelete(null),
                    });
                }}
            />
        </div>
    );
};

const OwnerUserCard = ({ user, onEdit, onDelete }: { user: OwnerUserRow; onEdit: () => void; onDelete: () => void }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-3">
        <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8 rounded-md">
                    <AvatarImage src={user.avatar_url || ''} />
                    <AvatarFallback className="rounded-md bg-brand-navy text-white text-[10px] font-semibold">
                        {user.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-brand-navy truncate leading-tight">{user.name}</p>
                    <Badge
                        variant="secondary"
                        className="rounded text-[9px] uppercase font-semibold px-1.5 py-0 h-4 bg-amber-100 text-amber-700 border-0 mt-0.5"
                    >
                        owner
                    </Badge>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 p-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                        <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-lg border border-gray-200 shadow-md p-1 min-w-[130px]">
                    <DropdownMenuItem onClick={onEdit} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2">
                        <Edit2 className="w-3 h-3" /> Edit Account
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onDelete} className="rounded px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                        <Trash2 className="w-3 h-3" /> Delete Account
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>

        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400 shrink-0">@</span>
                <span className="text-[11px] font-semibold text-brand-navy truncate">{user.username}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-gray-50 border border-gray-100">
                <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                <span className="text-[11px] font-medium text-brand-navy/70 truncate">{user.email}</span>
            </div>
        </div>

        <div className="pt-2 border-t border-gray-50 flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', user.active ? 'bg-emerald-500' : 'bg-gray-300')} />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-400">
                {user.active ? 'Active' : 'Inactive'}
            </span>
        </div>
    </div>
);

type OwnerUserModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: OwnerUserFormValues) => void;
    initialData?: OwnerUserRow | null;
    loading?: boolean;
    title: string;
};

const OwnerUserModal = ({ isOpen, onClose, onSubmit, initialData, loading, title }: OwnerUserModalProps) => {
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
            <DialogContent className="max-w-lg p-0 border border-slate-200/60 bg-white rounded-2xl shadow-xl overflow-hidden gap-0">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
                            <DialogTitle className="text-[14px] font-semibold text-brand-navy">{title}</DialogTitle>
                            <DialogDescription className="text-[11px] text-gray-500 mt-0.5">
                                Role is locked to <span className="font-semibold text-amber-600">Owner</span>.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="px-6 py-5 space-y-4">
                            {/* Avatar */}
                            <div className="flex items-center gap-3">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative group flex items-center justify-center border-2 border-dashed rounded-full w-14 h-14 shrink-0 cursor-pointer transition-colors overflow-hidden',
                                        isDragActive ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300',
                                        avatarPreview && 'border-transparent'
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-4 h-4 text-white" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-4 h-4 text-slate-400" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold text-brand-navy">Profile Photo</p>
                                    <p className="text-[10px] text-gray-400">Click or drop an image</p>
                                </div>
                            </div>

                            {/* Name & Username */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Full Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="John Doe" {...field} className="h-9 rounded-lg border-slate-200 text-sm" />
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
                                            <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Username</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                                                    <Input placeholder="johndoe" {...field} className="h-9 pl-7 rounded-lg border-slate-200 text-sm" />
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
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email Address</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                                <Input type="email" placeholder="john@example.com" {...field} className="h-9 pl-9 rounded-lg border-slate-200 text-sm" />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Password & Active */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Password</FormLabel>
                                            <FormControl>
                                                <Input type="password" placeholder={initialData ? '••••••••' : 'Min 6 chars'} {...field} className="h-9 rounded-lg border-slate-200 text-sm" />
                                            </FormControl>
                                            {initialData && (
                                                <FormDescription className="text-[10px] text-gray-400">
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
                                            <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</FormLabel>
                                            <div className="flex items-center gap-2.5 h-9 px-3 bg-slate-50 rounded-lg border border-slate-200">
                                                <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-emerald-500 scale-90" />
                                                <span className="text-[11px] font-semibold text-slate-600">{field.value ? 'Active' : 'Disabled'}</span>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        <DialogFooter className="px-6 py-4 border-t border-slate-100 gap-2 sm:gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} className="h-9 px-4 text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="h-9 px-5 bg-brand-navy hover:bg-brand-navy/90 text-white text-[11px] font-semibold rounded-md">
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
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
