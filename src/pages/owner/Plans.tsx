import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Plus, Search, MoreVertical, Edit2, Trash2, Loader2, CreditCard,
    Clock, Calendar, Infinity, AlertTriangle, X, GripVertical, Tag,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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

const TYPE_META: Record<string, { icon: any; color: string }> = {
    monthly: { icon: Clock, color: 'text-blue-600 bg-blue-50' },
    yearly: { icon: Calendar, color: 'text-amber-600 bg-amber-50' },
    lifetime: { icon: Infinity, color: 'text-emerald-600 bg-emerald-50' },
};

const Plans = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<any>(null);

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
            return data;
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
                const { error } = await supabase.from('plans').update(dataToSubmit).eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('plans').insert([dataToSubmit]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['plans'] });
            setIsModalOpen(false);
            setSelected(null);
            toast({ title: 'Saved', description: 'Plan has been saved.' });
        },
        onError: (err: any) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
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
        onError: (err: any) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const openEdit = (plan: any) => { setSelected(plan); setIsModalOpen(true); };
    const openDelete = (plan: any) => { setSelected(plan); setIsDeleteOpen(true); };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Plans</h1>
                            <p className="text-gray-500 font-light">Manage pricing, promotions and plan details.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search plans..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => { setSelected(null); setIsModalOpen(true); }}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" /> New Plan
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-56 rounded-xl" />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                    <CreditCard className="w-10 h-10 text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-500">No plans yet</p>
                    <p className="text-xs text-slate-400 mt-1">Create your first plan to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                <DialogContent className="max-w-sm border border-slate-200/60 bg-white rounded-2xl shadow-xl gap-0 p-0">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center text-red-500">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                            <DialogTitle className="text-lg font-semibold text-slate-900">Delete Plan</DialogTitle>
                        </div>
                    </div>
                    <div className="px-6 py-5">
                        <p className="text-sm text-slate-600">
                            Permanently delete <span className="font-semibold text-slate-900">"{selected?.name}"</span>? Businesses using this plan will be unlinked.
                        </p>
                    </div>
                    <DialogFooter className="px-6 py-4 border-t border-slate-100 gap-2 sm:gap-2">
                        <Button variant="ghost" onClick={() => setIsDeleteOpen(false)} className="h-9 text-sm text-slate-500">Cancel</Button>
                        <Button
                            onClick={() => deleteMutation.mutate(selected.id)}
                            disabled={deleteMutation.isPending}
                            className="h-9 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg gap-2"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// --- Plan Card ---

const PlanCard = ({ plan, onEdit, onDelete }: { plan: any; onEdit: () => void; onDelete: () => void }) => {
    const meta = TYPE_META[plan.license_type] || TYPE_META.monthly;
    const Icon = meta.icon;
    const features: string[] = Array.isArray(plan.features) ? plan.features : [];
    const hasPromo = plan.promotion_active && plan.promotion_label;
    const hasDiscount = plan.old_price && plan.old_price > plan.price;

    return (
        <Card className="group border border-slate-200/60 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            {hasPromo && (
                <div className="absolute top-3 right-3 z-10">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-semibold uppercase tracking-wide">
                        <Tag className="w-3 h-3" /> {plan.promotion_label}
                    </span>
                </div>
            )}
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', meta.color)}>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">{plan.name}</h3>
                            <span className="text-xs text-slate-400 capitalize">{plan.license_type}</span>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-lg border border-slate-200 shadow-lg p-1 min-w-[130px]">
                            <DropdownMenuItem onClick={onEdit} className="rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer gap-2">
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onDelete} className="rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900">{plan.price.toLocaleString()}</span>
                    <span className="text-sm text-slate-400">{plan.currency}</span>
                    {hasDiscount && (
                        <span className="text-sm text-slate-400 line-through ml-1">{plan.old_price.toLocaleString()}</span>
                    )}
                </div>

                {plan.description && (
                    <p className="text-xs text-slate-500 leading-relaxed">{plan.description}</p>
                )}

                {features.length > 0 && (
                    <ul className="space-y-1">
                        {features.slice(0, 4).map((f, i) => (
                            <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                                <div className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                                {f}
                            </li>
                        ))}
                        {features.length > 4 && (
                            <li className="text-xs text-slate-400">+{features.length - 4} more</li>
                        )}
                    </ul>
                )}

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <div className={cn('w-1.5 h-1.5 rounded-full', plan.active ? 'bg-emerald-500' : 'bg-slate-300')} />
                        <span className="text-xs text-slate-500">{plan.active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">Order: {plan.sort_order}</span>
                </div>
            </CardContent>
        </Card>
    );
};

// --- Plan Modal ---

const PlanModal = ({ isOpen, onClose, onSubmit, initialData, loading }: {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: PlanFormValues) => void;
    initialData?: any;
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
                const rawFeatures = Array.isArray(initialData.features) ? initialData.features : [];
                form.reset({
                    name: initialData.name,
                    license_type: initialData.license_type,
                    price: initialData.price,
                    old_price: initialData.old_price,
                    currency: initialData.currency || 'MAD',
                    description: initialData.description || '',
                    features: rawFeatures.map((f: string) => ({ value: f })),
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
        { value: 'lifetime' as const, label: 'Lifetime', icon: Infinity },
    ];

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border border-slate-200/60 bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto gap-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        {isEditing ? 'Edit Plan' : 'New Plan'}
                    </DialogTitle>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
                        <div className="px-6 py-5 space-y-5">

                            {/* Name */}
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Plan Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Pro Monthly" {...field} className="h-10 rounded-lg border-slate-200 text-sm" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            {/* License Type */}
                            <FormField control={form.control} name="license_type" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Billing Cycle</FormLabel>
                                    <div className="grid grid-cols-3 gap-2">
                                        {LICENSE_TYPES.map(opt => {
                                            const sel = field.value === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => field.onChange(opt.value)}
                                                    className={cn(
                                                        'flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-medium transition-all',
                                                        sel ? 'border-brand-navy bg-brand-navy/[0.03] text-brand-navy' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                                                    )}
                                                >
                                                    <opt.icon className="w-4 h-4" />
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            {/* Price Row */}
                            <div className="grid grid-cols-3 gap-3">
                                <FormField control={form.control} name="price" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Price</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} className="h-10 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="old_price" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Old Price</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" placeholder="Optional" {...field} value={field.value ?? ''} className="h-10 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="currency" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Currency</FormLabel>
                                        <FormControl>
                                            <Input {...field} className="h-10 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                    </FormItem>
                                )} />
                            </div>

                            {/* Description */}
                            <FormField control={form.control} name="description" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Description</FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="Short description..." {...field} value={field.value ?? ''} className="rounded-lg border-slate-200 text-sm min-h-[72px] resize-none" />
                                    </FormControl>
                                </FormItem>
                            )} />

                            {/* Features */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Features</label>
                                    <button
                                        type="button"
                                        onClick={() => append({ value: '' })}
                                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                    >
                                        + Add
                                    </button>
                                </div>
                                {fields.length === 0 && (
                                    <p className="text-xs text-slate-400 py-2">No features added.</p>
                                )}
                                <div className="space-y-1.5">
                                    {fields.map((f, idx) => (
                                        <div key={f.id} className="flex items-center gap-2">
                                            <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                                            <Input
                                                placeholder="Feature description..."
                                                {...form.register(`features.${idx}.value`)}
                                                className="h-8 rounded-md border-slate-200 text-xs flex-1"
                                            />
                                            <button type="button" onClick={() => remove(idx)} className="text-slate-400 hover:text-red-500 shrink-0">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Promotion */}
                            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Promotion</label>
                                    <FormField control={form.control} name="promotion_active" render={({ field }) => (
                                        <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-rose-500 scale-90" />
                                    )} />
                                </div>
                                <FormField control={form.control} name="promotion_label" render={({ field }) => (
                                    <FormControl>
                                        <Input placeholder='e.g. "30% OFF"' {...field} value={field.value ?? ''} className="h-9 rounded-lg border-slate-200 text-sm bg-white" />
                                    </FormControl>
                                )} />
                            </div>

                            {/* Active + Sort */}
                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="active" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</FormLabel>
                                        <div className="flex items-center gap-2.5 h-10 px-3 bg-slate-50 rounded-lg border border-slate-200">
                                            <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-emerald-500 scale-90" />
                                            <span className="text-xs font-medium text-slate-600">{field.value ? 'Active' : 'Inactive'}</span>
                                        </div>
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="sort_order" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sort Order</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} className="h-10 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                    </FormItem>
                                )} />
                            </div>
                        </div>

                        <DialogFooter className="px-6 py-4 border-t border-slate-100 gap-2 sm:gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} className="h-9 px-4 text-sm text-slate-500">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="h-9 px-5 bg-brand-navy hover:bg-brand-navy/90 text-white text-sm font-medium rounded-lg">
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isEditing ? 'Save Changes' : 'Create Plan'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Plans;
