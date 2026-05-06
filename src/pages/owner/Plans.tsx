import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Plus, Search, MoreVertical, Edit2, Trash2, Loader2, CreditCard,
    Clock, Calendar, Infinity as InfinityIcon, AlertTriangle, X, GripVertical, Tag,
    Check,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const planSchema = z.object({
    name: z.string().min(2, 'Plan name is required'),
    license_type: z.enum(['monthly', 'yearly', 'lifetime']),
    price: z.coerce.number().min(0, 'Price must be 0 or more'),
    old_price: z.coerce.number().nullable().optional(),
    currency: z.string().default('MAD'),
    description: z.string().optional().nullable(),
    features: z.array(z.object({ value: z.string() })).default([]),
    promotion_label: z.string().optional().nullable(),
    promotion_active: z.boolean().default(false),
    active: z.boolean().default(true),
    sort_order: z.coerce.number().default(0),
});

type PlanFormValues = z.infer<typeof planSchema>;

type PlanRow = {
    id: string;
    name: string;
    license_type: string;
    price: number;
    old_price: number | null;
    currency: string;
    description: string | null;
    features: string[] | null;
    promotion_label: string | null;
    promotion_active: boolean;
    active: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

const TYPE_CFG: Record<string, { label: string; stripe: string; text: string; tint: string }> = {
    monthly: { label: 'Monthly', stripe: 'bg-ant-ink', text: 'text-ant-ink', tint: 'bg-ant-ink/8' },
    yearly: { label: 'Yearly', stripe: 'bg-ant-orange', text: 'text-ant-orange', tint: 'bg-ant-orange/12' },
    lifetime: { label: 'Lifetime', stripe: 'bg-ant-green', text: 'text-ant-green', tint: 'bg-ant-green/12' },
};

const Plans = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<PlanRow | null>(null);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: plans, isLoading } = useQuery({
        queryKey: ['plans'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('plans')
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) throw error;
            return (data || []) as unknown as PlanRow[];
        },
    });

    const filtered = useMemo(() => {
        if (!plans) return [];
        if (!searchQuery) return plans;
        const q = searchQuery.toLowerCase();
        return plans.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.license_type.toLowerCase().includes(q)
        );
    }, [plans, searchQuery]);

    const stats = useMemo(() => {
        if (!plans) return { total: 0, active: 0, monthly: 0, yearly: 0, lifetime: 0, promos: 0 };
        let active = 0, monthly = 0, yearly = 0, lifetime = 0, promos = 0;
        for (const p of plans) {
            if (p.active) active++;
            if (p.license_type === 'monthly') monthly++;
            else if (p.license_type === 'yearly') yearly++;
            else if (p.license_type === 'lifetime') lifetime++;
            if (p.promotion_active) promos++;
        }
        return { total: plans.length, active, monthly, yearly, lifetime, promos };
    }, [plans]);

    const upsertMutation = useMutation({
        mutationFn: async (payload: PlanFormValues & { id?: string }) => {
            const { id, features, ...values } = payload;
            const dataToSubmit = {
                ...values,
                old_price: values.old_price || null,
                features: JSON.stringify(features.map(f => f.value).filter(Boolean)),
                updated_at: new Date().toISOString(),
            };

            if (id) {
                const { error } = await supabase.from('plans').update(dataToSubmit as unknown as never).eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('plans').insert([dataToSubmit as unknown as never]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['plans'] });
            setIsModalOpen(false);
            setSelected(null);
            toast({ title: 'Saved', description: 'Plan has been saved.' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('plans').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['plans'] });
            setIsDeleteOpen(false);
            setSelected(null);
            toast({ title: 'Deleted', description: 'Plan removed.' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const openEdit = (plan: PlanRow) => { setSelected(plan); setIsModalOpen(true); };
    const openDelete = (plan: PlanRow) => { setSelected(plan); setIsDeleteOpen(true); };

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Plans
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Pricing plans
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Manage subscription tiers, promotions and features.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 lg:flex-initial min-w-[200px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <input
                                type="search"
                                placeholder="Search plans…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full lg:w-56 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                                    aria-label="Clear"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { setSelected(null); setIsModalOpen(true); }}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New plan
                        </button>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Total" value={stats.total} accent="bg-ant-ink" />
                <KpiTile label="Active" value={stats.active} accent="bg-ant-green" />
                <KpiTile label="Monthly" value={stats.monthly} accent="bg-ant-ink" />
                <KpiTile label="Yearly" value={stats.yearly} accent="bg-ant-orange" />
                <KpiTile label="Lifetime" value={stats.lifetime} accent="bg-ant-green" />
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <CreditCard className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No plans yet</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Create your first pricing plan to assign to businesses.
                        </p>
                    </div>
                </section>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                    {filtered.map(plan => (
                        <PlanCard key={plan.id} plan={plan} onEdit={() => openEdit(plan)} onDelete={() => openDelete(plan)} />
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            <PlanModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setSelected(null); }}
                onSubmit={(values) => upsertMutation.mutate({ ...values, id: selected?.id })}
                initialData={selected}
                loading={upsertMutation.isPending}
            />

            {/* Delete Dialog */}
            <Dialog open={isDeleteOpen} onOpenChange={(v) => !v && setIsDeleteOpen(false)}>
                <DialogContent className={cn(
                    'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    <div className="h-[3px] w-full bg-ant-rose" />
                    <DialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-2">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div className="w-10 h-10 rounded-xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center text-ant-rose shrink-0">
                                    <AlertTriangle className="w-4 h-4" />
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-rose" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                            Plan · Delete
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                                        Delete plan
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        Businesses using this plan will be unlinked.
                                    </DialogDescription>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsDeleteOpen(false)}
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </DialogHeader>
                    <div className="px-5 py-4">
                        <p className="text-[13px] text-ant-ink">
                            Permanently delete{' '}
                            <span className="font-display">"{selected?.name}"</span>?
                        </p>
                    </div>
                    <div className="px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line">
                        <button
                            type="button"
                            onClick={() => setIsDeleteOpen(false)}
                            className="flex-1 h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => selected && deleteMutation.mutate(selected.id)}
                            disabled={deleteMutation.isPending}
                            className="flex-1 h-11 px-5 rounded-full bg-ant-rose text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(201,57,66,0.5)]"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Delete
                        </button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// --- KPI tile ---

const KpiTile = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[24px] leading-none tabular-nums text-ant-ink">
            {value.toLocaleString('fr-MA')}
        </p>
    </div>
);

// --- Plan Card ---

const PlanCard = ({ plan, onEdit, onDelete }: { plan: PlanRow; onEdit: () => void; onDelete: () => void }) => {
    const cfg = TYPE_CFG[plan.license_type] || TYPE_CFG.monthly;
    const features: string[] = Array.isArray(plan.features) ? plan.features : [];
    const hasPromo = plan.promotion_active && plan.promotion_label;
    const hasDiscount = plan.old_price && plan.old_price > plan.price;

    return (
        <div className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors relative">
            {hasPromo && (
                <div className="absolute top-4 right-4 z-10">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-ant-rose text-white text-[9px] font-semibold uppercase tracking-[0.14em] shadow-[0_6px_16px_-6px_rgba(201,57,66,0.55)]">
                        <Tag className="w-2.5 h-2.5" /> {plan.promotion_label}
                    </span>
                </div>
            )}

            <div className={cn('h-[3px] w-full', cfg.stripe)} />

            <div className="p-4 md:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', cfg.tint, cfg.text)}>
                            {cfg.label}
                        </span>
                        <p className="font-display text-[16px] text-ant-ink leading-tight">{plan.name}</p>
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
                        <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[140px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                            <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-ant-line" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Price */}
                <div>
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="font-display text-[28px] leading-none tabular-nums text-ant-ink">
                            {plan.price.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-ant-mid uppercase">{plan.currency}</span>
                        {hasDiscount && (
                            <span className="text-[12px] text-ant-mid line-through tabular-nums">
                                {plan.old_price!.toLocaleString()}
                            </span>
                        )}
                    </div>
                    {plan.description && (
                        <p className="font-serif italic text-[12px] text-ant-mid mt-2 leading-relaxed">
                            {plan.description}
                        </p>
                    )}
                </div>

                {features.length > 0 && (
                    <ul className="space-y-1.5 pt-3 border-t border-ant-line">
                        {features.slice(0, 4).map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-[12px] text-ant-ink">
                                <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-ant-orange shrink-0" />
                                <span className="leading-snug">{f}</span>
                            </li>
                        ))}
                        {features.length > 4 && (
                            <li className="font-serif italic text-[11px] text-ant-mid">+{features.length - 4} more features</li>
                        )}
                    </ul>
                )}

                <div className="pt-3 border-t border-ant-line flex items-center justify-between text-[10px]">
                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold uppercase tracking-[0.14em]', plan.active ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-mid/10 text-ant-mid')}>
                        <span className={cn('w-1 h-1 rounded-full', plan.active ? 'bg-ant-green' : 'bg-ant-mid')} />
                        {plan.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-ant-mid tabular-nums">Order · {plan.sort_order}</span>
                </div>
            </div>
        </div>
    );
};

// --- Plan Modal ---

const PlanModal = ({ isOpen, onClose, onSubmit, initialData, loading }: {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: PlanFormValues) => void;
    initialData?: PlanRow | null;
    loading?: boolean;
}) => {
    const isEditing = !!initialData;

    const form = useForm<PlanFormValues>({
        resolver: zodResolver(planSchema),
        defaultValues: {
            name: '', license_type: 'monthly', price: 0, old_price: null,
            currency: 'MAD', description: '', features: [],
            promotion_label: '', promotion_active: false, active: true, sort_order: 0,
        },
    });

    const { fields, append, remove } = useFieldArray({ control: form.control, name: 'features' });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                const rawFeatures: string[] = Array.isArray(initialData.features) ? initialData.features : [];
                const licenseType: PlanFormValues['license_type'] =
                    initialData.license_type === 'yearly' || initialData.license_type === 'lifetime'
                        ? initialData.license_type
                        : 'monthly';
                form.reset({
                    name: initialData.name,
                    license_type: licenseType,
                    price: initialData.price,
                    old_price: initialData.old_price,
                    currency: initialData.currency || 'MAD',
                    description: initialData.description || '',
                    features: rawFeatures.map((f) => ({ value: f })),
                    promotion_label: initialData.promotion_label || '',
                    promotion_active: initialData.promotion_active || false,
                    active: initialData.active,
                    sort_order: initialData.sort_order || 0,
                });
            } else {
                form.reset({
                    name: '', license_type: 'monthly', price: 0, old_price: null,
                    currency: 'MAD', description: '', features: [],
                    promotion_label: '', promotion_active: false, active: true, sort_order: 0,
                });
            }
        }
    }, [isOpen, initialData, form]);

    const LICENSE_TYPES = [
        { value: 'monthly' as const, label: 'Monthly', icon: Clock },
        { value: 'yearly' as const, label: 'Yearly', icon: Calendar },
        { value: 'lifetime' as const, label: 'Lifetime', icon: InfinityIcon },
    ];

    const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
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
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                        <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Plan · {isEditing ? 'Edit' : 'New'}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        {isEditing ? 'Edit plan' : 'New plan'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        Configure pricing, billing cycle and marketing features.
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

                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                            {/* Name */}
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Plan name</FormLabel>
                                    <FormControl>
                                        <input placeholder="e.g. Pro Monthly" {...field} className={inputClass} />
                                    </FormControl>
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />

                            {/* License Type */}
                            <FormField control={form.control} name="license_type" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Billing cycle</FormLabel>
                                    <div className="grid grid-cols-3 gap-2">
                                        {LICENSE_TYPES.map(opt => {
                                            const sel = field.value === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => field.onChange(opt.value)}
                                                    className={cn(
                                                        'flex items-center justify-center gap-1.5 h-10 rounded-xl border text-[12px] font-medium transition-all',
                                                        sel
                                                            ? 'border-ant-ink bg-ant-ink/[0.04] text-ant-ink shadow-[0_4px_12px_-4px_rgba(20,20,19,0.15)]'
                                                            : 'border-ant-line bg-ant-paper text-ant-mid hover:border-ant-ink/30 hover:text-ant-ink',
                                                    )}
                                                >
                                                    <opt.icon className={cn('w-3.5 h-3.5', sel && 'text-ant-orange')} />
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />

                            {/* Price Row */}
                            <div className="grid grid-cols-3 gap-3">
                                <FormField control={form.control} name="price" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Price</FormLabel>
                                        <FormControl>
                                            <input type="number" step="0.01" {...field} className={inputClass} />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="old_price" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Old price</FormLabel>
                                        <FormControl>
                                            <input type="number" step="0.01" placeholder="Optional" {...field} value={field.value ?? ''} className={inputClass} />
                                        </FormControl>
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="currency" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Currency</FormLabel>
                                        <FormControl>
                                            <input {...field} className={inputClass} />
                                        </FormControl>
                                    </FormItem>
                                )} />
                            </div>

                            {/* Description */}
                            <FormField control={form.control} name="description" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Description</FormLabel>
                                    <FormControl>
                                        <textarea
                                            placeholder="Short marketing description…"
                                            {...field}
                                            value={field.value ?? ''}
                                            className="w-full min-h-[72px] px-3.5 py-2.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 resize-none transition-all"
                                        />
                                    </FormControl>
                                </FormItem>
                            )} />

                            {/* Features */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[10px] text-ant-orange">01</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Features
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => append({ value: '' })}
                                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                    >
                                        <Plus className="w-3 h-3" /> Add
                                    </button>
                                </div>
                                <div className="p-3 space-y-1.5">
                                    {fields.length === 0 ? (
                                        <p className="font-serif italic text-[11px] text-ant-mid text-center py-2">
                                            No features yet. Add bullet points to promote what's included.
                                        </p>
                                    ) : (
                                        fields.map((f, idx) => (
                                            <div key={f.id} className="flex items-center gap-2">
                                                <GripVertical className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                                <input
                                                    placeholder="Feature description…"
                                                    {...form.register(`features.${idx}.value`)}
                                                    className="flex-1 h-9 px-3 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => remove(idx)}
                                                    className="w-7 h-7 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-mid hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors shrink-0"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* Promotion */}
                            <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/[0.04] overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-rose" />
                                <div className="px-4 py-3 border-b border-ant-rose/20 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[10px] text-ant-rose">02</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                            Promotion
                                        </span>
                                    </div>
                                    <FormField control={form.control} name="promotion_active" render={({ field }) => (
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            className="data-[state=checked]:bg-ant-rose scale-90"
                                        />
                                    )} />
                                </div>
                                <div className="p-3">
                                    <FormField control={form.control} name="promotion_label" render={({ field }) => (
                                        <FormControl>
                                            <input
                                                placeholder='e.g. "30% OFF"'
                                                {...field}
                                                value={field.value ?? ''}
                                                className="w-full h-9 px-3 rounded-lg border border-ant-rose/25 bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-rose focus:ring-2 focus:ring-ant-rose/20 transition-all"
                                            />
                                        </FormControl>
                                    )} />
                                </div>
                            </section>

                            {/* Active + Sort */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="active" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Status</FormLabel>
                                        <div className="flex items-center gap-2.5 h-10 px-3.5 bg-ant-light rounded-xl border border-ant-line">
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                className="data-[state=checked]:bg-ant-green scale-90"
                                            />
                                            <span className="text-[11px] font-medium text-ant-ink">
                                                {field.value ? 'Active' : 'Inactive'}
                                            </span>
                                        </div>
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="sort_order" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Sort order</FormLabel>
                                        <FormControl>
                                            <input type="number" {...field} className={inputClass} />
                                        </FormControl>
                                    </FormItem>
                                )} />
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
                                {loading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Check className="w-3.5 h-3.5" />
                                )}
                                {isEditing ? 'Save changes' : 'Create plan'}
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Plans;
