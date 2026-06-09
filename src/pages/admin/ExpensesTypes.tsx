import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Repeat,
    Receipt,
    Wallet,
    Layers,
    Tag,
    Sparkles,
    type LucideIcon,
} from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

const expenseTypeSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    active: z.boolean().default(true),
    recurrent: z.boolean().default(false),
});

type ExpenseTypeFormValues = z.infer<typeof expenseTypeSchema>;

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const TypeKpi: React.FC<{
    label: string;
    value: string;
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

const ExpensesTypes = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingType, setEditingType] = useState<any>(null);
    const [typeToDelete, setTypeToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'recurrent'>('all');

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: expenseTypes, isLoading } = useQuery({
        queryKey: ['expense_types', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('expense_types' as any)
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('name', { ascending: true }) as any);
            if (error) throw error;
            return data;
        },
    });

    const form = useForm<ExpenseTypeFormValues>({
        resolver: zodResolver(expenseTypeSchema),
        defaultValues: { name: '', active: true, recurrent: false },
    });

    const upsertMutation = useMutation({
        mutationFn: async (values: ExpenseTypeFormValues) => {
            if (editingType) {
                const { data, error } = await (supabase
                    .from('expense_types' as any)
                    .update({ ...values, 'DigiCom Business': activeBusinessId })
                    .eq('id', editingType.id)
                    .eq('DigiCom Business', activeBusinessId) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('expense_types' as any)
                    .insert({ ...values, 'DigiCom Business': activeBusinessId }) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['expense_types', activeBusinessId] });
            setIsUpsertOpen(false);
            setEditingType(null);
            toast({
                title: editingType ? 'Category updated' : 'Category created',
                description: `Successfully ${editingType ? 'updated' : 'created'} ${data.name}.`,
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('expense_types' as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId) as any);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expense_types', activeBusinessId] });
            setTypeToDelete(null);
            toast({ title: 'Category deleted', description: 'The expense category was successfully removed.' });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'This category might be linked to existing expenses.',
                variant: 'destructive',
            });
        },
    });

    const handleUpsert = (values: ExpenseTypeFormValues) => upsertMutation.mutate(values);

    const openUpsert = (type: any = null) => {
        if (type) {
            setEditingType(type);
            form.reset({ name: type.name, active: type.active, recurrent: type.recurrent });
        } else {
            setEditingType(null);
            form.reset({ name: '', active: true, recurrent: false });
        }
        setIsUpsertOpen(true);
    };

    const filteredTypes = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return (expenseTypes || []).filter((t: any) => {
            if (statusFilter === 'active' && !t.active) return false;
            if (statusFilter === 'inactive' && t.active) return false;
            if (statusFilter === 'recurrent' && !t.recurrent) return false;
            if (!q) return true;
            return (t.name || '').toLowerCase().includes(q);
        });
    }, [expenseTypes, searchQuery, statusFilter]);

    const stats = useMemo(() => {
        const list = expenseTypes || [];
        return {
            total: list.length,
            active: list.filter((t: any) => t.active).length,
            inactive: list.filter((t: any) => !t.active).length,
            recurrent: list.filter((t: any) => t.recurrent).length,
        };
    }, [expenseTypes]);

    const counts = {
        all: expenseTypes?.length || 0,
        active: stats.active,
        inactive: stats.inactive,
        recurrent: stats.recurrent,
    };

    const TABS = [
        { key: 'all' as const, label: 'All' },
        { key: 'active' as const, label: 'Active' },
        { key: 'recurrent' as const, label: 'Recurrent' },
        { key: 'inactive' as const, label: 'Inactive' },
    ];

    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Finance · Classification
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Expense categories
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            The buckets every outflow lands in — rent, salaries, fuel, coffee. A clean taxonomy makes every month&rsquo;s reading honest.
                        </p>
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        New category
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <TypeKpi label="Total categories" value={String(stats.total)} suffix="buckets" accent="ink" icon={Layers} />
                        <TypeKpi label="Active" value={String(stats.active)} suffix="live" accent="green" icon={Tag} />
                        <TypeKpi label="Recurrent" value={String(stats.recurrent)} suffix="fixed costs" accent="orange" icon={Repeat} />
                        <TypeKpi label="Inactive" value={String(stats.inactive)} suffix="off" accent="rose" icon={Wallet} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {TABS.map((t) => {
                            const active = statusFilter === t.key;
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setStatusFilter(t.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                        {counts[t.key]}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative w-full md:w-[340px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search categories..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                </div>

                {/* Grid */}
                {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <Skeleton key={i} className="h-36 rounded-2xl" />
                        ))}
                    </div>
                ) : filteredTypes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Receipt className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {expenseTypes?.length ? 'No categories match these filters' : 'No categories yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {expenseTypes?.length
                                ? 'Relax the search or status tab to bring categories back into view.'
                                : 'Start with Rent, Salaries, Marketing — the three buckets that capture most of the outflow.'}
                        </p>
                        {!expenseTypes?.length && (
                            <Button
                                onClick={() => openUpsert()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Create first category
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filteredTypes.map((type: any) => (
                            <ExpenseTypeCard
                                key={type.id}
                                type={type}
                                onEdit={() => openUpsert(type)}
                                onDelete={() => setTypeToDelete(type)}
                            />
                        ))}
                    </div>
                )}

                {/* Upsert Modal */}
                <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                    <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {editingType ? 'Edit · Category' : 'New · Category'}
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                        {editingType ? 'Update category' : 'Add a new category'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        A good bucket name answers one question in a glance — &ldquo;Is this Rent or Marketing?&rdquo;
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-6 space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Category name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Marketing, Salaries, Rent" {...field} className={inputCls} />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="recurrent"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-ant-line bg-ant-paper">
                                                    <div className="space-y-0.5 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn('h-1.5 w-1.5 rounded-full', field.value ? 'bg-ant-orange' : 'bg-ant-mid')} />
                                                            <FormLabel className="text-[12px] font-semibold text-ant-ink">Recurrent</FormLabel>
                                                        </div>
                                                        <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Fixed monthly cost.</p>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            className="data-[state=checked]:bg-ant-orange"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="active"
                                            render={({ field }) => (
                                                <FormItem className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-ant-line bg-ant-paper">
                                                    <div className="space-y-0.5 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn('h-1.5 w-1.5 rounded-full', field.value ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                            <FormLabel className="text-[12px] font-semibold text-ant-ink">Active</FormLabel>
                                                        </div>
                                                        <p className="font-serif italic text-[11px] text-ant-mid leading-snug">Pickable in logging.</p>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            className="data-[state=checked]:bg-ant-green"
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>

                                <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setIsUpsertOpen(false)}
                                        className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={upsertMutation.isPending}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        {editingType ? 'Save changes' : 'Create category'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!typeToDelete} onOpenChange={() => setTypeToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this category?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Removing <span className="not-italic font-semibold text-ant-ink">&ldquo;{typeToDelete?.name}&rdquo;</span> cannot be undone if expenses are already linked to it.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(typeToDelete.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

// --- Sub-components ---

const ExpenseTypeCard = ({ type, onEdit, onDelete }: any) => {
    const stripe = !type.active ? 'bg-ant-line' : type.recurrent ? 'bg-ant-orange' : 'bg-ant-ink';
    const iconTone = !type.active
        ? 'bg-ant-light border-ant-line text-ant-mid'
        : type.recurrent
        ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange'
        : 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink';
    const TypeIcon = type.recurrent ? Repeat : Tag;

    return (
        <div className={cn('relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper flex flex-col hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all', !type.active && 'opacity-70')}>
            <div className={cn('h-[3px] w-full', stripe)} />
            <div className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                        <div className={cn('h-9 w-9 rounded-xl border flex items-center justify-center shrink-0', iconTone)}>
                            <TypeIcon className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-display text-[14px] font-semibold text-ant-ink leading-tight truncate">
                                {type.name}
                            </h3>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid mt-1">
                                {type.recurrent ? 'Fixed cost' : 'Variable'}
                            </p>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer shrink-0">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[140px]">
                            <DropdownMenuItem onClick={onEdit} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-ant-line" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 gap-2">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-ant-line mt-auto">
                    <span className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                        type.active
                            ? 'bg-ant-green/10 border-ant-green/25 text-ant-green'
                            : 'bg-ant-light border-ant-line text-ant-mid'
                    )}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', type.active ? 'bg-ant-green' : 'bg-ant-mid')} />
                        {type.active ? 'Active' : 'Inactive'}
                    </span>
                    {type.recurrent && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange">
                            <Repeat className="w-2.5 h-2.5" />
                            Monthly
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExpensesTypes;
