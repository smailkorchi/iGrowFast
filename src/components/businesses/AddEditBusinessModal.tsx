/* eslint-disable react-refresh/only-export-components */
import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery } from '@tanstack/react-query';
import {
    Upload, ImageIcon, Loader2, Check, Tag,
    ShieldOff, ShieldCheck, CalendarPlus, Power,
} from 'lucide-react';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export const businessSchema = z.object({
    name: z.string().min(2, 'Business name must be at least 2 characters'),
    active: z.boolean().default(true),
    logo: z.string().optional().nullable(),
    plan_id: z.string().min(1, 'Select a plan'),
    status: z.enum(['active', 'suspended', 'deactivated']).default('active'),
});

export type BusinessFormValues = z.infer<typeof businessSchema>;

const STATUS_MAP: Record<string, { dot: string; label: string }> = {
    active: { dot: 'bg-emerald-500', label: 'Active' },
    suspended: { dot: 'bg-amber-500', label: 'Suspended' },
    deactivated: { dot: 'bg-red-500', label: 'Deactivated' },
};

interface AddEditBusinessModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: BusinessFormValues) => void;
    initialData?: Partial<BusinessFormValues> & { id?: string; status?: string };
    loading?: boolean;
    onStatusChange?: (businessId: string, action: 'extend' | 'suspend' | 'deactivate' | 'reactivate') => void;
    statusLoading?: boolean;
}

export const AddEditBusinessModal: React.FC<AddEditBusinessModalProps> = ({
    isOpen, onClose, onSubmit, initialData, loading, onStatusChange, statusLoading,
}) => {
    const { toast } = useToast();
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    const { data: plans } = useQuery({
        queryKey: ['plans-active'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('plans')
                .select('*')
                .eq('active', true)
                .order('sort_order', { ascending: true });
            if (error) throw error;
            return data;
        },
    });

    const form = useForm<BusinessFormValues>({
        resolver: zodResolver(businessSchema),
        defaultValues: { name: '', active: true, logo: '', plan_id: '', status: 'active' },
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset({
                    name: initialData.name,
                    active: initialData.active,
                    logo: initialData.logo || '',
                    plan_id: initialData.plan_id || '',
                    status: initialData.status || 'active',
                });
                setLogoPreview(initialData.logo);
            } else {
                const defaultPlan = plans?.[0]?.id || '';
                form.reset({ name: '', active: true, logo: '', plan_id: defaultPlan, status: 'active' });
                setLogoPreview(null);
            }
        }
    }, [isOpen, initialData, form, plans]);

    const onDrop = useCallback(
        async (acceptedFiles: File[]) => {
            const file = acceptedFiles[0];
            if (!file) return;
            setIsUploading(true);
            try {
                const fileExt = file.name.split('.').pop();
                const filePath = `logos/${Math.random()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('business-logos').upload(filePath, file);
                if (uploadError) throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('business-logos').getPublicUrl(filePath);
                setLogoPreview(publicUrl);
                form.setValue('logo', publicUrl);
            } catch (error) {
                toast({ title: 'Upload failed', description: (error as Error).message, variant: 'destructive' });
            } finally {
                setIsUploading(false);
            }
        },
        [form, toast]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop, accept: { 'image/*': [] }, multiple: false,
    });

    const isEditing = !!initialData;
    const currentStatus = initialData?.status || 'active';
    const statusInfo = STATUS_MAP[currentStatus] || STATUS_MAP.active;
    const licenseEnd = initialData?.license_end ? new Date(initialData.license_end) : null;
    const isExpired = licenseEnd && licenseEnd < new Date();
    const daysLeft = licenseEnd ? Math.ceil((licenseEnd.getTime() - Date.now()) / 86400000) : null;
    const currentPlan = plans?.find(p => p.id === initialData?.plan_id);

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border border-slate-200/60 bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto gap-0">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
                    <DialogTitle className="text-lg font-semibold text-slate-900">
                        {isEditing ? 'Manage Business' : 'New Business'}
                    </DialogTitle>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
                        <div className="px-6 py-5 space-y-5">

                            {isEditing && (
                                <div className="space-y-3">
                                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                        Status & License
                                    </label>
                                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 divide-y divide-slate-100">
                                        <div className="flex items-center justify-between px-4 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className={cn('w-2 h-2 rounded-full', statusInfo.dot)} />
                                                <span className="text-sm font-medium text-slate-700">{statusInfo.label}</span>
                                            </div>
                                            <span className="text-xs font-medium text-slate-400">
                                                {currentPlan?.name || initialData?.license_type || '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between px-4 py-2.5">
                                            <span className="text-xs text-slate-400">Payment</span>
                                            <span className={cn('text-xs font-medium', initialData?.paid ? 'text-emerald-600' : 'text-red-500')}>
                                                {initialData?.paid ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        {initialData?.license_type !== 'lifetime' && licenseEnd && (
                                            <div className="flex items-center justify-between px-4 py-2.5">
                                                <span className="text-xs text-slate-400">{isExpired ? 'Expired on' : 'Expires'}</span>
                                                <span className={cn('text-xs font-medium', isExpired ? 'text-red-500' : 'text-slate-600')}>
                                                    {licenseEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    {daysLeft !== null && !isExpired && <span className="text-slate-400 ml-1">({daysLeft}d)</span>}
                                                </span>
                                            </div>
                                        )}
                                        {initialData?.license_type === 'lifetime' && (
                                            <div className="flex items-center justify-between px-4 py-2.5">
                                                <span className="text-xs text-slate-400">Expiry</span>
                                                <span className="text-xs font-medium text-emerald-600">Never</span>
                                            </div>
                                        )}
                                    </div>

                                    {onStatusChange && (
                                        <div className="flex flex-wrap gap-2">
                                            {currentStatus === 'active' && initialData?.license_type !== 'lifetime' && (
                                                <button type="button" disabled={statusLoading} onClick={() => onStatusChange(initialData.id, 'extend')}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition-colors disabled:opacity-40">
                                                    <CalendarPlus className="w-3.5 h-3.5" /> Extend
                                                </button>
                                            )}
                                            {currentStatus === 'active' && (
                                                <button type="button" disabled={statusLoading} onClick={() => onStatusChange(initialData.id, 'suspend')}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-100 transition-colors disabled:opacity-40">
                                                    <ShieldOff className="w-3.5 h-3.5" /> Suspend
                                                </button>
                                            )}
                                            {(currentStatus === 'suspended' || currentStatus === 'deactivated') && (
                                                <button type="button" disabled={statusLoading} onClick={() => onStatusChange(initialData.id, 'reactivate')}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 transition-colors disabled:opacity-40">
                                                    <ShieldCheck className="w-3.5 h-3.5" /> Reactivate
                                                </button>
                                            )}
                                            {currentStatus !== 'deactivated' && (
                                                <button type="button" disabled={statusLoading} onClick={() => onStatusChange(initialData.id, 'deactivate')}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-red-500 bg-red-50 hover:bg-red-100 border border-red-100 transition-colors disabled:opacity-40">
                                                    <Power className="w-3.5 h-3.5" /> Deactivate
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Logo */}
                            <div className="space-y-2">
                                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Logo</label>
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative h-32 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors cursor-pointer overflow-hidden',
                                        logoPreview ? 'border-transparent bg-slate-50' : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50',
                                        isDragActive && 'border-blue-400 bg-blue-50/30'
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {logoPreview ? (
                                        <div className="relative w-full h-full group">
                                            <img src={logoPreview} alt="" className="w-full h-full object-contain p-4" />
                                            <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <span className="text-white text-xs font-medium">Replace</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1.5 text-slate-400">
                                            <ImageIcon className="w-6 h-6" />
                                            <span className="text-xs">Drop image or click to upload</span>
                                        </div>
                                    )}
                                    {isUploading && (
                                        <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                                            <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Name */}
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Business Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Enter name..." {...field} className="h-10 rounded-lg border-slate-200 bg-white text-sm text-slate-900 px-3 focus-visible:ring-1 focus-visible:ring-slate-300" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            {/* Plan Selection */}
                            <FormField control={form.control} name="plan_id" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Plan</FormLabel>
                                    {!plans ? (
                                        <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
                                            <Loader2 className="w-4 h-4 animate-spin" /> Loading plans...
                                        </div>
                                    ) : plans.length === 0 ? (
                                        <p className="text-xs text-slate-400 py-2">No active plans. Create one in the Plans page first.</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {plans.map((plan) => {
                                                const selected = field.value === plan.id;
                                                const hasPromo = plan.promotion_active && plan.promotion_label;
                                                const hasDiscount = plan.old_price && plan.old_price > plan.price;
                                                return (
                                                    <div
                                                        key={plan.id}
                                                        onClick={() => field.onChange(plan.id)}
                                                        className={cn(
                                                            'flex items-center gap-3 px-3.5 py-3 rounded-lg cursor-pointer border transition-all',
                                                            selected ? 'border-brand-navy bg-brand-navy/[0.03]' : 'border-slate-100 hover:border-slate-200 bg-white'
                                                        )}
                                                    >
                                                        <div className={cn(
                                                            'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                                                            selected ? 'border-brand-navy bg-brand-navy' : 'border-slate-300'
                                                        )}>
                                                            {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn('text-sm font-medium', selected ? 'text-brand-navy' : 'text-slate-700')}>
                                                                    {plan.name}
                                                                </span>
                                                                {hasPromo && (
                                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 text-[9px] font-semibold uppercase">
                                                                        <Tag className="w-2.5 h-2.5" /> {plan.promotion_label}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {plan.description && (
                                                                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{plan.description}</p>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <div className="flex items-baseline gap-1">
                                                                <span className={cn('text-sm font-semibold', selected ? 'text-brand-navy' : 'text-slate-700')}>
                                                                    {Number(plan.price).toLocaleString()}
                                                                </span>
                                                                <span className="text-[10px] text-slate-400">{plan.currency}</span>
                                                            </div>
                                                            {hasDiscount && (
                                                                <span className="text-[10px] text-slate-400 line-through">
                                                                    {Number(plan.old_price).toLocaleString()}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>

                        <DialogFooter className="px-6 py-4 border-t border-slate-100 gap-2 sm:gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} className="h-9 px-4 text-sm text-slate-500 hover:text-slate-700">Cancel</Button>
                            <Button type="submit" disabled={loading || isUploading} className="h-9 px-5 bg-brand-navy hover:bg-brand-navy/90 text-white text-sm font-medium rounded-lg">
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isEditing ? 'Save Changes' : 'Create Business'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
