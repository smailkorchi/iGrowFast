import { useState, useCallback, useEffect, useMemo } from 'react';
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
    X,
    Shield,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const ownerUserSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    username: z.string().min(3, 'Username must be at least 3 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
    active: z.boolean().default(true),
    avatar_url: z.string().optional().nullable(),
});

type OwnerUserFormValues = z.infer<typeof ownerUserSchema>;

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
            toast({ title: 'Account created', description: 'The owner account is now active.' });
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
            toast({ title: 'Account updated', description: 'Owner details have been saved.' });
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
            toast({ title: 'Account deleted', description: 'The owner has been removed from the platform.' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const filteredUsers = useMemo(() => {
        if (!users) return [];
        if (!searchQuery) return users;
        const q = searchQuery.toLowerCase();
        return users.filter(
            (u) =>
                u.name.toLowerCase().includes(q) ||
                u.username.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q),
        );
    }, [users, searchQuery]);

    const stats = useMemo(() => {
        if (!users) return { total: 0, active: 0, inactive: 0 };
        const active = users.filter((u) => u.active).length;
        return { total: users.length, active, inactive: users.length - active };
    }, [users]);

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Owner users
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Owner accounts
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Accounts with owner-level access — the people who run iGrowFast.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 lg:flex-initial min-w-[220px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <input
                                type="search"
                                placeholder="Search name, username, email…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full lg:w-64 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add owner
                        </button>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-3 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Total owners" value={stats.total} accent="bg-ant-ink" />
                <KpiTile label="Active" value={stats.active} accent="bg-ant-green" />
                <KpiTile label="Inactive" value={stats.inactive} accent="bg-ant-mid" />
            </div>

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-44 rounded-2xl bg-ant-paper border border-ant-line animate-pulse" />
                    ))}
                </div>
            ) : filteredUsers.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <UserIcon className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No owner accounts</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Add the first owner or adjust your search to see matching accounts.
                        </p>
                    </div>
                </section>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                    {filteredUsers.map((user) => (
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
                kicker="Owner · New"
                title="Create owner account"
            />

            {/* Edit Modal */}
            {editingUser && (
                <OwnerUserModal
                    isOpen={!!editingUser}
                    onClose={() => setEditingUser(null)}
                    onSubmit={(values) => updateMutation.mutate({ id: editingUser.id, values })}
                    initialData={editingUser}
                    loading={updateMutation.isPending}
                    kicker="Owner · Edit"
                    title="Edit owner account"
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

const KpiTile = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
            {value.toLocaleString('fr-MA')}
        </p>
    </div>
);

const OwnerUserCard = ({ user, onEdit, onDelete }: { user: OwnerUserRow; onEdit: () => void; onDelete: () => void }) => (
    <div className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors">
        <div className={cn('h-[3px] w-full', user.active ? 'bg-ant-green' : 'bg-ant-mid')} />
        <div className="p-4 md:p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar className="h-11 w-11 rounded-xl border border-ant-line">
                        <AvatarImage src={user.avatar_url || ''} />
                        <AvatarFallback className="rounded-xl bg-ant-ink text-ant-light text-[12px] font-medium">
                            {user.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 space-y-1">
                        <p className="font-display text-[14px] text-ant-ink truncate leading-tight">{user.name}</p>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-orange/12 text-ant-orange text-[9px] font-semibold uppercase tracking-[0.14em]">
                            <Shield className="w-2.5 h-2.5" />
                            Owner
                        </span>
                    </div>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-light transition-colors shrink-0"
                        >
                            <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[160px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                        <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                            <Edit2 className="w-3.5 h-3.5" /> Edit account
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-ant-line" />
                        <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                            <Trash2 className="w-3.5 h-3.5" /> Delete account
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ant-light border border-ant-line">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ant-mid shrink-0">@</span>
                    <span className="font-mono text-[12px] text-ant-ink truncate">{user.username}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ant-light border border-ant-line">
                    <Mail className="w-3 h-3 text-ant-mid shrink-0" />
                    <span className="text-[12px] text-ant-ink truncate">{user.email}</span>
                </div>
            </div>

            <div className="pt-3 border-t border-ant-line flex items-center justify-between">
                <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                    user.active ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid',
                )}>
                    <span className={cn('w-1 h-1 rounded-full', user.active ? 'bg-ant-green' : 'bg-ant-mid')} />
                    {user.active ? 'Active' : 'Inactive'}
                </span>
                <span className="font-serif italic text-[10px] text-ant-mid tabular-nums">
                    {format(new Date(user.created_at), 'dd MMM yyyy', { locale: fr })}
                </span>
            </div>
        </div>
    </div>
);

type OwnerUserModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: OwnerUserFormValues) => void;
    initialData?: OwnerUserRow | null;
    loading?: boolean;
    kicker: string;
    title: string;
};

const OwnerUserModal = ({ isOpen, onClose, onSubmit, initialData, loading, kicker, title }: OwnerUserModalProps) => {
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
                    active: initialData.active ?? true,
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

    const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                'max-w-lg p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                'sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none',
                'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                '[&>button.absolute]:hidden',
            )}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="flex flex-col h-full overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                        <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            {kicker}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        {title}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid flex items-center gap-1.5">
                                        Role is locked to
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ant-orange/12 text-ant-orange text-[9px] font-semibold uppercase tracking-[0.14em] not-italic">
                                            <Shield className="w-2.5 h-2.5" /> Owner
                                        </span>
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* Avatar */}
                            <div className="flex items-center gap-3">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative group flex items-center justify-center border-2 border-dashed rounded-full w-16 h-16 shrink-0 cursor-pointer transition-colors overflow-hidden',
                                        isDragActive ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/40',
                                        avatarPreview && 'border-transparent',
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-ant-ink/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-4 h-4 text-ant-light" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-4 h-4 text-ant-mid" />
                                    )}
                                </div>
                                <div>
                                    <p className="font-display text-[13px] text-ant-ink">Profile photo</p>
                                    <p className="font-serif italic text-[11px] text-ant-mid">Click or drop an image</p>
                                </div>
                            </div>

                            {/* Name & Username */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Full name</FormLabel>
                                            <FormControl>
                                                <input placeholder="John Doe" {...field} className={inputClass} />
                                            </FormControl>
                                            <FormMessage className="text-[10px] text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="username"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Username</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ant-mid text-[13px]">@</span>
                                                    <input
                                                        placeholder="johndoe"
                                                        {...field}
                                                        className="w-full h-10 pl-7 pr-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                                    />
                                                </div>
                                            </FormControl>
                                            <FormMessage className="text-[10px] text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Email */}
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Email address</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                                <input
                                                    type="email"
                                                    placeholder="john@example.com"
                                                    {...field}
                                                    className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )}
                            />

                            {/* Password & Active */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Password</FormLabel>
                                            <FormControl>
                                                <input type="password" placeholder={initialData ? '••••••••' : 'Min 6 chars'} {...field} className={inputClass} />
                                            </FormControl>
                                            {initialData && (
                                                <FormDescription className="font-serif italic text-[11px] text-ant-mid">
                                                    Leave blank to keep current
                                                </FormDescription>
                                            )}
                                            <FormMessage className="text-[10px] text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="active"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col justify-end space-y-1.5">
                                            <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Status</FormLabel>
                                            <div className="flex items-center gap-2.5 h-10 px-3.5 bg-ant-light rounded-xl border border-ant-line">
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className="data-[state=checked]:bg-ant-green scale-90"
                                                />
                                                <span className="text-[11px] font-medium text-ant-ink">
                                                    {field.value ? 'Active' : 'Disabled'}
                                                </span>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {initialData ? 'Save changes' : 'Create owner'}
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default OwnerUsers;
