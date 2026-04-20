/* eslint-disable react-refresh/only-export-components */
import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery } from '@tanstack/react-query';
import {
    ImageIcon, Loader2, Check, Tag,
    ShieldOff, ShieldCheck, CalendarPlus, Power,
    X,
} from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
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

const STATUS_CFG: Record<string, { dot: string; label: string; text: string; tint: string }> = {
    active: { dot: 'bg-ant-green', label: 'Active', text: 'text-ant-green', tint: 'bg-ant-green/12' },
    suspended: { dot: 'bg-ant-orange', label: 'Suspended', text: 'text-ant-orange', tint: 'bg-ant-orange/12' },
    deactivated: { dot: 'bg-ant-rose', label: 'Deactivated', text: 'text-ant-rose', tint: 'bg-ant-rose/12' },
};

interface AddEditBusinessModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: BusinessFormValues) => void;
    initialData?: BusinessFormValues & {
        id?: string;
        license_end?: string | null;
        license_type?: string;
        paid?: boolean;
    };
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
    const statusInfo = STATUS_CFG[currentStatus] || STATUS_CFG.active;
    const licenseEnd = initialData?.license_end ? new Date(initialData.license_end) : null;
    const isExpired = licenseEnd && licenseEnd < new Date();
    const daysLeft = licenseEnd ? Math.ceil((licenseEnd.getTime() - Date.now()) / 86400000) : null;
    const currentPlan = plans?.find(p => p.id === initialData?.plan_id);

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
                                            Business · {isEditing ? 'Manage' : 'New'}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        {isEditing ? 'Manage business' : 'New business'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        {isEditing
                                            ? 'Update logo, rename, change plan or adjust the license state.'
                                            : 'Create a new tenant and assign it a plan.'}
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

                            {isEditing && (
                                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                    <div className="h-[3px] w-full bg-ant-ink" />
                                    <div className="px-4 py-3 border-b border-ant-line">
                                        <div className="flex items-center gap-2">
                                            <span className="font-display text-[10px] text-ant-orange">01</span>
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                Status & license
                                            </span>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-ant-line">
                                        <div className="flex items-center justify-between px-4 py-3">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                                    statusInfo.tint, statusInfo.text,
                                                )}
                                            >
                                                <span className={cn('w-1 h-1 rounded-full', statusInfo.dot)} />
                                                {statusInfo.label}
                                            </span>
                                            <span className="font-display text-[12px] text-ant-ink">
                                                {currentPlan?.name || initialData?.license_type || '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between px-4 py-2.5">
                                            <span className="text-[11px] text-ant-mid">Payment</span>
                                            <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', initialData?.paid ? 'text-ant-green' : 'text-ant-rose')}>
                                                <span className={cn('w-1 h-1 rounded-full', initialData?.paid ? 'bg-ant-green' : 'bg-ant-rose')} />
                                                {initialData?.paid ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        {initialData?.license_type !== 'lifetime' && licenseEnd && (
                                            <div className="flex items-center justify-between px-4 py-2.5">
                                                <span className="text-[11px] text-ant-mid">{isExpired ? 'Expired on' : 'Expires'}</span>
                                                <span className={cn('font-display text-[11px] tabular-nums', isExpired ? 'text-ant-rose' : 'text-ant-ink')}>
                                                    {licenseEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    {daysLeft !== null && !isExpired && <span className="text-ant-mid ml-1">({daysLeft}d)</span>}
                                                </span>
                                            </div>
                                        )}
                                        {initialData?.license_type === 'lifetime' && (
                                            <div className="flex items-center justify-between px-4 py-2.5">
                                                <span className="text-[11px] text-ant-mid">Expiry</span>
                                                <span className="text-[11px] font-medium text-ant-green">Never</span>
                                            </div>
                                        )}
                                    </div>

                                    {onStatusChange && (
                                        <div className="px-4 py-3 border-t border-ant-line flex flex-wrap gap-2">
                                            {currentStatus === 'active' && initialData?.license_type !== 'lifetime' && (
                                                <button
                                                    type="button"
                                                    disabled={statusLoading}
                                                    onClick={() => onStatusChange(initialData.id!, 'extend')}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[11px] font-medium text-ant-ink bg-ant-light border border-ant-line hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors disabled:opacity-40"
                                                >
                                                    <CalendarPlus className="w-3.5 h-3.5" /> Extend
                                                </button>
                                            )}
                                            {currentStatus === 'active' && (
                                                <button
                                                    type="button"
                                                    disabled={statusLoading}
                                                    onClick={() => onStatusChange(initialData.id!, 'suspend')}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[11px] font-medium text-ant-orange bg-ant-orange/10 border border-ant-orange/30 hover:bg-ant-orange hover:text-white transition-colors disabled:opacity-40"
                                                >
                                                    <ShieldOff className="w-3.5 h-3.5" /> Suspend
                                                </button>
                                            )}
                                            {(currentStatus === 'suspended' || currentStatus === 'deactivated') && (
                                                <button
                                                    type="button"
                                                    disabled={statusLoading}
                                                    onClick={() => onStatusChange(initialData.id!, 'reactivate')}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[11px] font-medium text-ant-green bg-ant-green/10 border border-ant-green/30 hover:bg-ant-green hover:text-white transition-colors disabled:opacity-40"
                                                >
                                                    <ShieldCheck className="w-3.5 h-3.5" /> Reactivate
                                                </button>
                                            )}
                                            {currentStatus !== 'deactivated' && (
                                                <button
                                                    type="button"
                                                    disabled={statusLoading}
                                                    onClick={() => onStatusChange(initialData.id!, 'deactivate')}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[11px] font-medium text-ant-rose bg-ant-rose/10 border border-ant-rose/30 hover:bg-ant-rose hover:text-white transition-colors disabled:opacity-40"
                                                >
                                                    <Power className="w-3.5 h-3.5" /> Deactivate
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Logo */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Logo</label>
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative h-32 rounded-2xl border-2 border-dashed flex items-center justify-center transition-colors cursor-pointer overflow-hidden',
                                        logoPreview ? 'border-transparent bg-ant-light' : 'border-ant-line bg-ant-light hover:border-ant-ink/40',
                                        isDragActive && 'border-ant-ink bg-ant-ink/5',
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {logoPreview ? (
                                        <div className="relative w-full h-full group">
                                            <img src={logoPreview} alt="" className="w-full h-full object-contain p-4" />
                                            <div className="absolute inset-0 bg-ant-ink/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <span className="font-display text-[12px] text-ant-light">Replace</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1.5 text-ant-mid">
                                            <ImageIcon className="w-6 h-6" />
                                            <p className="font-display text-[12px] text-ant-ink">Drop image or click</p>
                                            <p className="font-serif italic text-[11px] text-ant-mid">Square transparent PNG works best</p>
                                        </div>
                                    )}
                                    {isUploading && (
                                        <div className="absolute inset-0 bg-ant-paper/80 flex items-center justify-center">
                                            <Loader2 className="w-5 h-5 animate-spin text-ant-ink" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Name */}
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Business name</FormLabel>
                                    <FormControl>
                                        <input
                                            placeholder="Enter name…"
                                            {...field}
                                            className="w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                        />
                                    </FormControl>
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />

                            {/* Plan Selection */}
                            <FormField control={form.control} name="plan_id" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Plan</FormLabel>
                                    {!plans ? (
                                        <div className="flex items-center gap-2 py-3 text-[12px] text-ant-mid">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading plans…
                                        </div>
                                    ) : plans.length === 0 ? (
                                        <p className="font-serif italic text-[12px] text-ant-mid py-2">
                                            No active plans. Create one in the Plans page first.
                                        </p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {plans.map((plan) => {
                                                const selected = field.value === plan.id;
                                                const hasPromo = plan.promotion_active && plan.promotion_label;
                                                const hasDiscount = plan.old_price && plan.old_price > plan.price;
                                                return (
                                                    <button
                                                        key={plan.id}
                                                        type="button"
                                                        onClick={() => field.onChange(plan.id)}
                                                        className={cn(
                                                            'w-full flex items-center gap-3 px-3.5 py-3 rounded-xl cursor-pointer border transition-all text-left',
                                                            selected
                                                                ? 'border-ant-ink bg-ant-ink/[0.04] shadow-[0_4px_12px_-4px_rgba(20,20,19,0.15)]'
                                                                : 'border-ant-line bg-ant-paper hover:border-ant-ink/30',
                                                        )}
                                                    >
                                                        <div className={cn(
                                                            'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                                                            selected ? 'border-ant-orange bg-ant-orange' : 'border-ant-line',
                                                        )}>
                                                            {selected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className={cn('font-display text-[13px]', selected ? 'text-ant-ink' : 'text-ant-ink')}>
                                                                    {plan.name}
                                                                </span>
                                                                {hasPromo && (
                                                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-ant-rose/12 text-ant-rose text-[9px] font-semibold uppercase tracking-[0.14em]">
                                                                        <Tag className="w-2.5 h-2.5" /> {plan.promotion_label}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {plan.description && (
                                                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 truncate">{plan.description}</p>
                                                            )}
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <div className="flex items-baseline gap-1 justify-end">
                                                                <span className="font-display text-[14px] tabular-nums text-ant-ink">
                                                                    {Number(plan.price).toLocaleString()}
                                                                </span>
                                                                <span className="text-[10px] text-ant-mid uppercase">{plan.currency}</span>
                                                            </div>
                                                            {hasDiscount && (
                                                                <span className="text-[10px] text-ant-mid line-through tabular-nums">
                                                                    {Number(plan.old_price).toLocaleString()}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />
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
                                disabled={loading || isUploading}
                                className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                {isEditing ? 'Save changes' : 'Create business'}
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
