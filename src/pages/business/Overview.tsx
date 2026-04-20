import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO, differenceInDays } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import {
    Building2,
    Loader2,
    Upload,
    PenLine,
    Stamp,
    Sparkles,
    Shield,
    Calendar,
    Globe,
    Mail,
    Phone,
    MapPin,
    Info,
    Hash,
    Receipt,
    Briefcase,
    Trash2,
    type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const profileSchema = z.object({
    name: z.string().min(2, 'Au moins 2 caractères'),
    logo: z.string().optional().nullable(),
    ice: z.string().optional().nullable(),
    rc: z.string().optional().nullable(),
    identifiant_fiscal: z.string().optional().nullable(),
    patente: z.string().optional().nullable(),
    cnss: z.string().optional().nullable(),
    legal_form: z.string().optional().nullable(),
    capital_social: z.string().optional().nullable(),
    legal_address: z.string().optional().nullable(),
    legal_city: z.string().optional().nullable(),
    postal_code: z.string().optional().nullable(),
    business_phone: z.string().optional().nullable(),
    business_email: z
        .string()
        .optional()
        .nullable()
        .refine((v) => !v || v === '' || z.string().email().safeParse(v).success, {
            message: 'Email invalide',
        }),
    website: z
        .string()
        .optional()
        .nullable()
        .refine(
            (v) => {
                if (!v || v === '') return true;
                const candidate = /^https?:\/\//i.test(v) ? v : `https://${v}`;
                return z.string().url().safeParse(candidate).success;
            },
            { message: 'URL invalide' }
        ),
    cachet_url: z.string().optional().nullable(),
    signature_url: z.string().optional().nullable(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

type PlanRow = {
    id: string;
    name: string;
    license_type: string;
    price: number;
    currency: string;
    description: string | null;
};

type BusinessRow = {
    id: string;
    name: string;
    logo: string | null;
    active: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    license_type: string;
    license_start: string;
    license_end: string | null;
    status: string;
    paid: boolean;
    plan_id: string | null;
    plan: PlanRow | null;
    ice?: string | null;
    rc?: string | null;
    identifiant_fiscal?: string | null;
    patente?: string | null;
    cnss?: string | null;
    legal_form?: string | null;
    capital_social?: string | null;
    legal_address?: string | null;
    legal_city?: string | null;
    postal_code?: string | null;
    business_phone?: string | null;
    business_email?: string | null;
    website?: string | null;
    cachet_url?: string | null;
    signature_url?: string | null;
};

function formatLicenseLabel(type: string) {
    if (type === 'lifetime') return 'Lifetime';
    if (type === 'yearly') return 'Yearly';
    if (type === 'monthly') return 'Monthly';
    return type.replace(/_/g, ' ');
}

const statusPill = (status: string) => {
    switch (status) {
        case 'active':
            return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
        case 'suspended':
            return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
        case 'deactivated':
            return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose' };
        default:
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
    }
};

async function rasteriseToPng(file: File, maxDim = 1024): Promise<Blob> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image inaccessible'));
        el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Image sans dimensions (SVG vectoriel sans viewBox ?)');
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Conversion PNG échouée'));
        }, 'image/png');
    });
}

async function uploadBrandingAsset(businessId: string, kind: 'logo' | 'cachet' | 'signature', file: File) {
    const pngBlob = await rasteriseToPng(file);
    const path = `profile/${businessId}/${kind}-${Date.now()}.png`;
    const { error } = await supabase.storage.from('business-logos').upload(path, pngBlob, { contentType: 'image/png' });
    if (error) throw error;
    const {
        data: { publicUrl },
    } = supabase.storage.from('business-logos').getPublicUrl(path);
    return publicUrl;
}

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const BizKpi: React.FC<{
    label: string;
    value: string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
    mono?: boolean;
}> = ({ label, value, suffix, accent, icon: Icon, mono }) => {
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
            <p className={cn('text-[15px] font-semibold text-ant-ink mt-2 truncate', mono ? 'font-mono tabular-nums' : 'font-display text-[17px] tabular-nums')}>
                {value}
                {suffix ? <span className="text-[11px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const HeaderShell = ({ children }: { children?: React.ReactNode }) => (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Business · Profile
            </div>
            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                Overview
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                The legal identity of the house — name, ICE, RC, the cachet that closes every document. Keep it current, the paperwork depends on it.
            </p>
        </div>
        {children}
    </header>
);

const BusinessOverview = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [uploadKind, setUploadKind] = useState<'logo' | 'cachet' | 'signature' | null>(null);

    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            name: '',
            logo: '',
            ice: '',
            rc: '',
            identifiant_fiscal: '',
            patente: '',
            cnss: '',
            legal_form: '',
            capital_social: '',
            legal_address: '',
            legal_city: '',
            postal_code: '',
            business_phone: '',
            business_email: '',
            website: '',
            cachet_url: '',
            signature_url: '',
        },
    });

    const { data: business, isLoading, isError } = useQuery({
        queryKey: ['business-overview', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return null;
            const { data, error } = await supabase
                .from('businesses')
                .select(`*, plan:plans(id, name, license_type, price, currency, description)`)
                .eq('id', activeBusinessId)
                .single();
            if (error) throw error;
            return data as BusinessRow;
        },
        enabled: !!activeBusinessId,
    });

    useEffect(() => {
        if (!business) return;
        form.reset({
            name: business.name || '',
            logo: business.logo || '',
            ice: business.ice || '',
            rc: business.rc || '',
            identifiant_fiscal: business.identifiant_fiscal || '',
            patente: business.patente || '',
            cnss: business.cnss || '',
            legal_form: business.legal_form || '',
            capital_social: business.capital_social || '',
            legal_address: business.legal_address || '',
            legal_city: business.legal_city || '',
            postal_code: business.postal_code || '',
            business_phone: business.business_phone || '',
            business_email: business.business_email || '',
            website: business.website || '',
            cachet_url: business.cachet_url || '',
            signature_url: business.signature_url || '',
        });
    }, [business, form]);

    const saveMutation = useMutation({
        mutationFn: async (values: ProfileFormValues) => {
            if (!activeBusinessId) throw new Error('No business');
            const { error } = await supabase.rpc('update_business_profile_fields', {
                p_business_id: activeBusinessId,
                p_name: values.name,
                p_logo: values.logo || '',
                p_ice: values.ice || '',
                p_rc: values.rc || '',
                p_identifiant_fiscal: values.identifiant_fiscal || '',
                p_patente: values.patente || '',
                p_cnss: values.cnss || '',
                p_legal_form: values.legal_form || '',
                p_capital_social: values.capital_social || '',
                p_legal_address: values.legal_address || '',
                p_legal_city: values.legal_city || '',
                p_postal_code: values.postal_code || '',
                p_business_phone: values.business_phone || '',
                p_business_email: values.business_email || '',
                p_website: values.website || '',
                p_cachet_url: values.cachet_url || '',
                p_signature_url: values.signature_url || '',
            });
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['business-overview', activeBusinessId] });
            toast({ title: 'Saved', description: 'Business profile updated.' });
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const memberSince = useMemo(() => {
        if (!business?.created_at) return null;
        const d = parseISO(business.created_at);
        const days = differenceInDays(new Date(), d);
        return { label: format(d, 'MMM yyyy'), days };
    }, [business]);

    const wrapUpload = async (kind: 'logo' | 'cachet' | 'signature', file: File, setValue: (url: string) => void) => {
        if (!activeBusinessId) return;
        setUploadKind(kind);
        try {
            const url = await uploadBrandingAsset(activeBusinessId, kind, file);
            setValue(url);
            toast({ title: 'Uploaded', description: "Remember to save your changes." });
        } catch (e) {
            toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' });
        } finally {
            setUploadKind(null);
        }
    };

    const logoDrop = useDropzone({
        accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
        maxFiles: 1,
        disabled: saveMutation.isPending || !!uploadKind,
        onDrop: async (files) => {
            const f = files[0];
            if (!f) return;
            await wrapUpload('logo', f, (url) => form.setValue('logo', url, { shouldDirty: true }));
        },
    });
    const cachetDrop = useDropzone({
        accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
        maxFiles: 1,
        disabled: saveMutation.isPending || !!uploadKind,
        onDrop: async (files) => {
            const f = files[0];
            if (!f) return;
            await wrapUpload('cachet', f, (url) => form.setValue('cachet_url', url, { shouldDirty: true }));
        },
    });
    const signatureDrop = useDropzone({
        accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
        maxFiles: 1,
        disabled: saveMutation.isPending || !!uploadKind,
        onDrop: async (files) => {
            const f = files[0];
            if (!f) return;
            await wrapUpload('signature', f, (url) => form.setValue('signature_url', url, { shouldDirty: true }));
        },
    });

    if (!activeBusinessId) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper p-16 text-center">
                        <p className="font-serif italic text-[13px] text-ant-mid">No active business selected.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <Skeleton className="h-44 rounded-2xl" />
                    <Skeleton className="h-24 rounded-2xl" />
                    <Skeleton className="h-96 rounded-2xl" />
                </div>
            </div>
        );
    }

    if (isError || !business) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper p-16 text-center">
                        <p className="font-serif italic text-[13px] text-ant-mid">Could not load business details.</p>
                    </div>
                </div>
            </div>
        );
    }

    const logoPreview = form.watch('logo');
    const cachetPreview = form.watch('cachet_url');
    const signaturePreview = form.watch('signature_url');
    const currentName = form.watch('name');
    const sPill = statusPill(business.status);

    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';
    const monoInputCls = cn(inputCls, 'font-mono tabular-nums');

    const planName = business.plan?.name ?? '—';
    const priceLabel =
        business.plan?.price != null
            ? `${Number(business.plan.price).toLocaleString()} ${business.plan.currency || 'MAD'}`
            : '—';

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="ant-surface min-h-screen">
                <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                    {/* Editorial header */}
                    <HeaderShell>
                        <Button
                            type="submit"
                            disabled={saveMutation.isPending || !form.formState.isDirty}
                            className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                        >
                            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            Save changes
                        </Button>
                    </HeaderShell>

                    {/* HERO · Ink business card */}
                    <section className="relative overflow-hidden rounded-2xl border border-ant-ink bg-ant-ink text-white">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(217,119,6,0.15)_0%,transparent_55%)] pointer-events-none" />

                        <div className="relative flex flex-col md:flex-row items-stretch">
                            {/* Logo column */}
                            <div className="md:w-[220px] shrink-0 p-6 md:border-r md:border-white/10 flex flex-col items-center md:items-start gap-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                    <Building2 className="w-3 h-3" />
                                    Identity
                                </div>
                                {logoPreview ? (
                                    <div className="w-36 h-36 rounded-2xl bg-ant-paper border border-white/20 flex items-center justify-center p-3 shrink-0">
                                        <img src={logoPreview} alt={currentName} className="max-w-full max-h-full object-contain" />
                                    </div>
                                ) : (
                                    <div className="w-36 h-36 rounded-2xl bg-white/5 border border-white/20 flex items-center justify-center shrink-0">
                                        <span className="font-display text-[48px] font-semibold text-white/70">
                                            {(currentName || business.name || 'B').charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Info column */}
                            <div className="flex-1 p-6 flex flex-col justify-between gap-5">
                                <div className="space-y-2.5">
                                    <h2 className="font-display text-[26px] md:text-[30px] leading-tight tracking-[-0.015em] text-white truncate">
                                        {currentName || business.name}
                                    </h2>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize', sPill.bg, sPill.border, sPill.text)}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', sPill.dot)} />
                                            {business.status}
                                        </span>
                                        <span className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                                            business.active
                                                ? 'bg-ant-green/15 border-ant-green/30 text-ant-green'
                                                : 'bg-white/5 border-white/15 text-white/60'
                                        )}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', business.active ? 'bg-ant-green' : 'bg-white/40')} />
                                            {business.active ? 'Live' : 'Off'}
                                        </span>
                                        {business.legal_form && (
                                            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70 uppercase tracking-[0.14em]">
                                                {business.legal_form}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Mini subscription panel — 3 cells */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 rounded-xl border border-white/15 overflow-hidden">
                                    <div className="bg-ant-ink px-4 py-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.24em] text-white/55">
                                            <Shield className="w-2.5 h-2.5" />
                                            Plan
                                        </div>
                                        <p className="font-display text-[15px] font-semibold text-white mt-0.5 truncate">{planName}</p>
                                        <p className="text-[10px] text-white/55 tabular-nums mt-0.5">{priceLabel} · {formatLicenseLabel(business.license_type)}</p>
                                    </div>
                                    <div className="bg-ant-ink px-4 py-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.24em] text-white/55">
                                            <Receipt className="w-2.5 h-2.5" />
                                            Billing
                                        </div>
                                        <p className={cn('font-display text-[15px] font-semibold mt-0.5', business.paid ? 'text-ant-green' : 'text-ant-rose')}>
                                            {business.paid ? 'Paid' : 'Unpaid'}
                                        </p>
                                        <p className="text-[10px] text-white/55 tabular-nums mt-0.5">
                                            {business.license_type === 'lifetime'
                                                ? 'No expiry'
                                                : business.license_end
                                                ? `Ends ${format(parseISO(business.license_end), 'MMM d, yyyy')}`
                                                : `Since ${format(parseISO(business.license_start), 'MMM yyyy')}`}
                                        </p>
                                    </div>
                                    <div className="bg-ant-ink px-4 py-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.24em] text-white/55">
                                            <Calendar className="w-2.5 h-2.5" />
                                            Member since
                                        </div>
                                        <p className="font-display text-[15px] font-semibold text-white mt-0.5 tabular-nums">
                                            {memberSince?.label ?? '—'}
                                        </p>
                                        <p className="text-[10px] text-white/55 tabular-nums mt-0.5">
                                            {memberSince ? `${memberSince.days.toLocaleString()} days in` : '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Identity snapshot KPI strip */}
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <BizKpi label="ICE" value={business.ice || '—'} accent="orange" icon={Hash} mono />
                        <BizKpi label="RC" value={business.rc || '—'} accent="ink" icon={Briefcase} mono />
                        <BizKpi label="IF" value={business.identifiant_fiscal || '—'} accent="green" icon={Receipt} mono />
                        <BizKpi label="Capital" value={business.capital_social || '—'} accent="rose" icon={Hash} />
                    </section>

                    {/* Chapter 01 · Raison sociale */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 space-y-4">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Raison sociale
                                    </div>
                                    <h2 className="font-display text-[20px] tracking-tight text-ant-ink">Legal name</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">
                                        The name that appears on every document you ever send out. Change this only when the legal reality changes.
                                    </p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-ink/5 border border-ant-ink/15 items-center justify-center shrink-0">
                                    <Building2 className="w-5 h-5 text-ant-ink" strokeWidth={1.5} />
                                </div>
                            </div>

                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormControl>
                                            <Input
                                                {...field}
                                                className="h-14 rounded-2xl border-ant-line bg-ant-paper text-[20px] font-display font-semibold text-ant-ink px-5 focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                placeholder="Ex. ACME Trading SARL"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-ant-rose" />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </section>

                    {/* Chapter 02 · Identité légale */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 space-y-4">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">02</span>
                                        Identité légale · Maroc
                                    </div>
                                    <h2 className="font-display text-[20px] tracking-tight text-ant-ink">Official numbers</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">
                                        ICE, RC, IF, CNSS — the codes Morocco cares about. Double-check these; every invoice depends on them.
                                    </p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 items-center justify-center shrink-0">
                                    <Shield className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {[
                                    { name: 'ice' as const, label: 'ICE', placeholder: "Identifiant Commun de l'Entreprise", mono: true },
                                    { name: 'rc' as const, label: 'RC', placeholder: 'Registre de Commerce', mono: true },
                                    { name: 'identifiant_fiscal' as const, label: 'IF · Identifiant fiscal', placeholder: 'IF', mono: true },
                                    { name: 'patente' as const, label: 'Patente', placeholder: 'Numéro de patente', mono: true },
                                    { name: 'cnss' as const, label: 'CNSS', placeholder: 'Affiliation / numéro CNSS', mono: true },
                                    { name: 'legal_form' as const, label: 'Forme juridique', placeholder: 'SARL, SARLAU, SA...', mono: false },
                                ].map((f) => (
                                    <FormField
                                        key={f.name}
                                        control={form.control}
                                        name={f.name}
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>{f.label}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={field.value ?? ''}
                                                        placeholder={f.placeholder}
                                                        className={f.mono ? monoInputCls : inputCls}
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                ))}
                                <FormField
                                    control={form.control}
                                    name="capital_social"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2 lg:col-span-3 space-y-1.5">
                                            <FormLabel className={labelCls}>Capital social</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value ?? ''}
                                                    placeholder="Ex. 100 000 DH"
                                                    className={cn(inputCls, 'tabular-nums')}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    </section>

                    {/* Chapter 03 · Contact & siège */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 space-y-4">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">03</span>
                                        Siège social &amp; contact
                                    </div>
                                    <h2 className="font-display text-[20px] tracking-tight text-ant-ink">Headquarters &amp; reach</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">
                                        Where you are, how to reach you — printed on every document and on every outbound email.
                                    </p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-green/10 border border-ant-green/25 items-center justify-center shrink-0">
                                    <MapPin className="w-5 h-5 text-ant-green" strokeWidth={1.5} />
                                </div>
                            </div>

                            <FormField
                                control={form.control}
                                name="legal_address"
                                render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className={labelCls}>Adresse complète</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                {...field}
                                                value={field.value ?? ''}
                                                rows={2}
                                                placeholder="Rue, quartier, ville..."
                                                className="rounded-2xl border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid resize-none min-h-[80px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-ant-rose" />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {[
                                    { name: 'legal_city' as const, label: 'Ville', placeholder: 'Casablanca' },
                                    { name: 'postal_code' as const, label: 'Code postal', placeholder: '20000', mono: true },
                                    { name: 'business_phone' as const, label: 'Téléphone', placeholder: '+212 5 22 00 00 00', mono: true },
                                ].map((f) => (
                                    <FormField
                                        key={f.name}
                                        control={form.control}
                                        name={f.name}
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>{f.label}</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={field.value ?? ''}
                                                        placeholder={f.placeholder}
                                                        className={'mono' in f && f.mono ? monoInputCls : inputCls}
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                ))}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="business_email"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className={cn(labelCls, 'inline-flex items-center gap-1.5')}>
                                                <Mail className="w-3 h-3" />
                                                Email entreprise
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value ?? ''}
                                                    type="email"
                                                    placeholder="contact@acme.ma"
                                                    className={inputCls}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="website"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className={cn(labelCls, 'inline-flex items-center gap-1.5')}>
                                                <Globe className="w-3 h-3" />
                                                Site web
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={field.value ?? ''}
                                                    placeholder="https://acme.ma"
                                                    className={inputCls}
                                                />
                                            </FormControl>
                                            <FormMessage className="text-ant-rose" />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    </section>

                    {/* Chapter 04 · Branding document preview */}
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-6 space-y-5">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">04</span>
                                        Branding assets
                                    </div>
                                    <h2 className="font-display text-[20px] tracking-tight text-ant-ink">Logo, cachet &amp; signature</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">
                                        The three images that sign every invoice, bon de commande and bon de livraison. Rasterised to PNG automatically for PDF fidelity.
                                    </p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 items-center justify-center shrink-0">
                                    <Stamp className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <BrandingTile
                                    dropzone={logoDrop}
                                    kind="logo"
                                    label="Logo"
                                    hint="Header of every document"
                                    icon={Building2}
                                    preview={logoPreview}
                                    uploading={uploadKind === 'logo'}
                                    accent="orange"
                                    onClear={() => form.setValue('logo', '', { shouldDirty: true })}
                                />
                                <BrandingTile
                                    dropzone={cachetDrop}
                                    kind="cachet"
                                    label="Cachet"
                                    hint="Stamp at the bottom-right"
                                    icon={Stamp}
                                    preview={cachetPreview}
                                    uploading={uploadKind === 'cachet'}
                                    accent="green"
                                    onClear={() => form.setValue('cachet_url', '', { shouldDirty: true })}
                                />
                                <BrandingTile
                                    dropzone={signatureDrop}
                                    kind="signature"
                                    label="Signature"
                                    hint="Authorised signer at checkout"
                                    icon={PenLine}
                                    preview={signaturePreview}
                                    uploading={uploadKind === 'signature'}
                                    accent="ink"
                                    onClear={() => form.setValue('signature_url', '', { shouldDirty: true })}
                                />
                            </div>

                            {/* Document preview mini mockup */}
                            <div className="rounded-2xl border border-ant-line bg-ant-light/40 p-5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-3">
                                    <Info className="w-3 h-3" />
                                    Document preview
                                </div>
                                <div className="rounded-xl bg-ant-paper border border-ant-line p-5 space-y-4">
                                    <div className="flex items-start justify-between gap-4 border-b border-ant-line pb-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {logoPreview ? (
                                                <img src={logoPreview} alt="" className="h-12 w-12 object-contain border border-ant-line rounded-lg p-1 bg-ant-light" />
                                            ) : (
                                                <div className="h-12 w-12 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center font-display font-semibold text-ant-ink">
                                                    {(currentName || 'B').charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <p className="font-display text-[14px] font-semibold text-ant-ink truncate">{currentName || business.name}</p>
                                                <p className="text-[10px] font-mono text-ant-mid tabular-nums">
                                                    {(form.watch('ice') || '—')} · RC {(form.watch('rc') || '—')}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-display text-[11px] font-semibold text-ant-orange uppercase tracking-[0.24em]">Devis</p>
                                            <p className="text-[10px] text-ant-mid tabular-nums">N° 0001 · {format(new Date(), 'MMM d, yyyy')}</p>
                                        </div>
                                    </div>
                                    <p className="font-serif italic text-[11px] text-ant-mid">
                                        {(form.watch('legal_address') || 'Adresse non renseignée').toString()}
                                        {form.watch('legal_city') ? ` · ${form.watch('legal_city')}` : ''}
                                        {form.watch('postal_code') ? ` ${form.watch('postal_code')}` : ''}
                                    </p>
                                    <div className="flex items-end justify-between gap-4 pt-3 border-t border-ant-line">
                                        <p className="font-serif italic text-[10px] text-ant-mid max-w-xs">
                                            Merci de votre confiance. Paiement 30 jours fin de mois.
                                        </p>
                                        <div className="flex items-end gap-4">
                                            {signaturePreview && (
                                                <div className="text-center">
                                                    <img src={signaturePreview} alt="" className="h-10 w-20 object-contain mx-auto" />
                                                    <p className="text-[9px] text-ant-mid uppercase tracking-[0.24em] font-semibold mt-1">Signature</p>
                                                </div>
                                            )}
                                            {cachetPreview && (
                                                <div className="text-center">
                                                    <img src={cachetPreview} alt="" className="h-14 w-14 object-contain mx-auto opacity-90" />
                                                    <p className="text-[9px] text-ant-mid uppercase tracking-[0.24em] font-semibold mt-1">Cachet</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Footer save bar */}
                    <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 p-4 rounded-2xl border border-ant-line bg-ant-paper/95 backdrop-blur shadow-[0_12px_48px_-20px_rgba(20,20,19,0.2)]">
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-ant-mid">
                            <Calendar className="w-3.5 h-3.5" />
                            Last updated
                            <span className="text-ant-ink tabular-nums">
                                {business.updated_at ? format(parseISO(business.updated_at), 'MMM d, yyyy · HH:mm') : '—'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {form.formState.isDirty && (
                                <span className="font-serif italic text-[11px] text-ant-orange">Unsaved changes</span>
                            )}
                            <Button
                                type="submit"
                                disabled={saveMutation.isPending || !form.formState.isDirty}
                                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                Save changes
                            </Button>
                        </div>
                    </div>
                </div>
            </form>
        </Form>
    );
};

const BrandingTile: React.FC<{
    dropzone: ReturnType<typeof useDropzone>;
    kind: 'logo' | 'cachet' | 'signature';
    label: string;
    hint: string;
    icon: LucideIcon;
    preview: string | null | undefined;
    uploading: boolean;
    accent: keyof typeof KPI_ACCENTS;
    onClear?: () => void;
}> = ({ dropzone, label, hint, icon: Icon, preview, uploading, accent, onClear }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper group">
            <div className={cn('h-[3px] w-full', a.dot)} />

            <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <div className={cn('h-9 w-9 rounded-xl border flex items-center justify-center', a.tile)}>
                            <Icon className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div>
                            <p className="font-display text-[13px] font-semibold text-ant-ink">{label}</p>
                            <p className="font-serif italic text-[10px] text-ant-mid">{hint}</p>
                        </div>
                    </div>
                    {preview && onClear && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClear();
                            }}
                            className="h-7 w-7 rounded-full hover:bg-ant-rose/10 text-ant-mid hover:text-ant-rose transition-colors cursor-pointer inline-flex items-center justify-center"
                            title="Remove"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                <div
                    {...dropzone.getRootProps()}
                    className={cn(
                        'relative rounded-xl border-2 border-dashed min-h-[160px] flex items-center justify-center transition-all cursor-pointer overflow-hidden',
                        dropzone.isDragActive
                            ? 'border-ant-orange bg-ant-orange/5'
                            : 'border-ant-line bg-ant-light/50 hover:border-ant-ink/30'
                    )}
                >
                    <input {...dropzone.getInputProps()} />
                    {uploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-ant-paper/90 z-10 rounded-xl">
                            <Loader2 className="w-6 h-6 animate-spin text-ant-orange" />
                        </div>
                    )}
                    {preview ? (
                        <img src={preview} alt="" className="max-h-36 max-w-full object-contain p-3" />
                    ) : (
                        <div className="flex flex-col items-center justify-center text-ant-mid gap-2 py-6">
                            <div className={cn('h-10 w-10 rounded-xl border flex items-center justify-center', a.tile)}>
                                <Upload className="w-4 h-4" strokeWidth={1.5} />
                            </div>
                            <span className="text-[11px] font-semibold text-ant-mid uppercase tracking-[0.14em] text-center">
                                {dropzone.isDragActive ? 'Drop to upload' : 'Drop or click'}
                            </span>
                            <span className="font-serif italic text-[10px] text-ant-mid">PNG · JPG · WebP</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BusinessOverview;
