import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import {
    ArrowLeft,
    Loader2,
    Upload,
    X,
    Image as ImageIcon,
    Video as VideoIcon,
    Calendar as CalendarIcon,
    Infinity as InfinityIcon,
    Megaphone,
    PlayCircle,
    Sparkles,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { compressImage, validateUploadFile, MAX_IMAGE_SOURCE_BYTES } from '@/lib/imageCompress';
import { imageUrl } from '@/lib/imageUrl';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    CAMPAIGN_PLATFORMS,
    CAMPAIGN_TYPES,
    CONVERSION_TYPES,
    CAMPAIGN_OBJECTIVES,
    DEFAULT_CTA_LABELS,
    getPlatformIcon,
    getPlatformColor,
    getPlatformSource,
    isVideoType,
    type CampaignMedia,
    type CampaignType,
    type ConversionType,
    type Campaign,
} from '@/lib/campaignConstants';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useCampaignBasePath } from '@/hooks/useCampaignBasePath';

const campaignSchema = z
    .object({
        name: z.string().min(2, 'Name must be at least 2 characters'),
        status: z.enum(['active', 'draft']).default('draft'),
        platform: z.string().min(1, 'Select a platform'),
        objective: z.string().optional().or(z.literal('')),
        spending_type: z.enum(['ongoing', 'date_limited']),
        daily_budget: z.coerce.number().min(0).default(0),
        total_budget: z.coerce.number().min(0).default(0),
        start_date: z.date().optional().nullable(),
        end_date: z.date().optional().nullable(),
        campaign_type: z.enum(['single_image', 'multi_image', 'carousel', 'video', 'multi_video']),
        conversion_type: z.enum(['landing_page', 'whatsapp', 'shop', 'facebook_form']),
        conversion_content: z.string().min(1, 'Conversion content is required'),
        primary_text: z.string().optional().or(z.literal('')),
        headline: z.string().optional().or(z.literal('')),
        cta_label: z.string().optional().or(z.literal('')),
        pixel_id: z.string().optional().or(z.literal('')),
        notes: z.string().optional().or(z.literal('')),
        currency: z.string().default('MAD'),
        audience_age_min: z.coerce.number().min(13).max(99).optional().nullable(),
        audience_age_max: z.coerce.number().min(13).max(99).optional().nullable(),
        audience_genders: z.array(z.string()).default([]),
        audience_countries: z.string().optional().or(z.literal('')),
        audience_interests: z.string().optional().or(z.literal('')),
    })
    .superRefine((v, ctx) => {
        if (v.spending_type === 'ongoing' && (!v.daily_budget || v.daily_budget <= 0)) {
            ctx.addIssue({ path: ['daily_budget'], code: z.ZodIssueCode.custom, message: 'Daily budget is required for ongoing campaigns' });
        }
        if (v.spending_type === 'date_limited') {
            if (!v.total_budget || v.total_budget <= 0) {
                ctx.addIssue({ path: ['total_budget'], code: z.ZodIssueCode.custom, message: 'Total budget is required' });
            }
            if (!v.start_date) ctx.addIssue({ path: ['start_date'], code: z.ZodIssueCode.custom, message: 'Start date is required' });
            if (!v.end_date) ctx.addIssue({ path: ['end_date'], code: z.ZodIssueCode.custom, message: 'End date is required' });
            if (v.start_date && v.end_date && v.end_date < v.start_date) {
                ctx.addIssue({ path: ['end_date'], code: z.ZodIssueCode.custom, message: 'End date must be after start date' });
            }
        }
    });

type CampaignFormValues = z.infer<typeof campaignSchema>;

const GENDERS = ['male', 'female', 'all'] as const;

/** Matches the campaign-media bucket ceiling — videos are uploaded uncompressed. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

// Section chapter header
const Chapter: React.FC<{ num: string; label: string; children?: React.ReactNode }> = ({ num, label, children }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="font-display text-ant-orange font-semibold">{num}</span>
            {label}
        </div>
        {children}
    </div>
);

const CampaignForm: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isEdit = !!id;
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();
    const basePath = useCampaignBasePath();

    const [media, setMedia] = useState<CampaignMedia[]>([]);
    const [uploading, setUploading] = useState(false);

    const { data: existing, isLoading: loadingCampaign } = useQuery({
        queryKey: ['campaign', id],
        queryFn: async (): Promise<Campaign | null> => {
            if (!id) return null;
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('id', id)
                .single();
            if (error) throw error;
            return data as Campaign;
        },
        enabled: isEdit,
    });

    // Source-ownership locks: one ad source per media buyer per business.
    // W7 R1c: the postgres_changes subscription is retired — the table is
    // near-static and the DB guard (source_taken) enforces correctness at
    // submit regardless. A light poll while the form is open keeps the picker
    // fresh enough for the rare two-MBs-in-the-form-simultaneously case.
    const { data: sourceLocks = [] } = useQuery({
        queryKey: ['campaign-source-locks', activeBusinessId],
        enabled: !!activeBusinessId,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
        queryFn: async () => {
            // #45: under the dedicated mediabuyer DB role, peer users rows are
            // unreadable — holder names come from the gated mb_held_sources
            // DEFINER instead of a users embed. Same shape for admins.
            const { data } = await (supabase as any).rpc('mb_held_sources', { p_business: activeBusinessId });
            return ((data || []) as Array<{ source: string; mediabuyer_id: string; owner_name: string | null }>)
                .map((r) => ({
                    source: r.source,
                    mediabuyer_id: r.mediabuyer_id,
                    owner: r.owner_name ? { name: r.owner_name } : null,
                })) as Array<{ source: string; mediabuyer_id: string; owner: { name: string } | null }>;
        },
    });
    // Only media buyers are subject to the source lock — admins create campaigns with no
    // commission, so they see every source and never lock one.
    const { data: myRole } = useQuery({
        queryKey: ['my-role', currentUserId],
        enabled: !!currentUserId,
        queryFn: async () => {
            const { data } = await (supabase as any).from('users').select('role').eq('id', currentUserId).maybeSingle();
            return (data?.role as string) || null;
        },
    });
    const isMediaBuyer = myRole === 'mediabuyer';
    // source -> owner name, only for sources held by ANOTHER media buyer (mine never blocks me).
    const lockedSources = useMemo(() => {
        const m = new Map<string, string>();
        if (!isMediaBuyer) return m; // admins/non-MBs aren't subject to the lock
        for (const l of sourceLocks) {
            if (l.mediabuyer_id && l.mediabuyer_id !== currentUserId) m.set(l.source, l.owner?.name || 'un autre media buyer');
        }
        return m;
    }, [sourceLocks, currentUserId, isMediaBuyer]);

    const form = useForm<CampaignFormValues>({
        resolver: zodResolver(campaignSchema),
        defaultValues: {
            name: '',
            status: 'draft',
            platform: 'Facebook ads',
            objective: 'conversions',
            spending_type: 'ongoing',
            daily_budget: 0,
            total_budget: 0,
            start_date: null,
            end_date: null,
            campaign_type: 'single_image',
            conversion_type: 'landing_page',
            conversion_content: '',
            primary_text: '',
            headline: '',
            cta_label: 'Shop Now',
            pixel_id: '',
            notes: '',
            currency: 'MAD',
            audience_age_min: 18,
            audience_age_max: 65,
            audience_genders: ['all'],
            audience_countries: '',
            audience_interests: '',
        },
    });

    // Create flow: never leave a source another MB holds selected — jump to the first free one.
    useEffect(() => {
        if (isEdit) return;
        const cur = form.getValues('platform');
        if (cur && lockedSources.has(getPlatformSource(cur))) {
            const free = CAMPAIGN_PLATFORMS.find((p) => !lockedSources.has(getPlatformSource(p)));
            if (free) form.setValue('platform', free);
        }
    }, [lockedSources, isEdit, form]);

    useEffect(() => {
        if (!isEdit || !existing || !currentUserId) return;
        if (existing.created_by && existing.created_by !== currentUserId) {
            toast({
                title: 'Read only',
                description: 'You can only edit campaigns you created.',
                variant: 'destructive',
            });
            navigate(`${basePath}/${existing.id}`, { replace: true });
        }
    }, [existing, currentUserId, isEdit, basePath, navigate, toast]);

    useEffect(() => {
        if (!existing) return;
        const audience = (existing.audience || {}) as any;
        form.reset({
            name: existing.name,
            status: existing.status,
            platform: existing.platform,
            objective: existing.objective || '',
            spending_type: existing.spending_type,
            daily_budget: Number(existing.daily_budget ?? 0),
            total_budget: Number(existing.total_budget ?? 0),
            start_date: existing.start_date ? new Date(existing.start_date) : null,
            end_date: existing.end_date ? new Date(existing.end_date) : null,
            campaign_type: existing.campaign_type,
            conversion_type: existing.conversion_type,
            conversion_content: existing.conversion_content || '',
            primary_text: existing.primary_text || '',
            headline: existing.headline || '',
            cta_label: existing.cta_label || '',
            pixel_id: existing.pixel_id || '',
            notes: existing.notes || '',
            currency: existing.currency || 'MAD',
            audience_age_min: audience.age_min ?? 18,
            audience_age_max: audience.age_max ?? 65,
            audience_genders: Array.isArray(audience.genders) ? audience.genders : ['all'],
            audience_countries: Array.isArray(audience.countries) ? audience.countries.join(', ') : (audience.countries || ''),
            audience_interests: Array.isArray(audience.interests) ? audience.interests.join(', ') : (audience.interests || ''),
        });
        setMedia(Array.isArray(existing.media) ? existing.media : []);
    }, [existing, form]);

    const campaignType = form.watch('campaign_type') as CampaignType;
    const spendingType = form.watch('spending_type');
    const conversionType = form.watch('conversion_type') as ConversionType;
    const conversionMeta = useMemo(() => CONVERSION_TYPES.find((c) => c.value === conversionType), [conversionType]);

    const onDrop = useCallback(
        async (files: File[]) => {
            if (!activeBusinessId) {
                toast({ title: 'No business selected', variant: 'destructive' });
                return;
            }
            const wantsVideo = isVideoType(campaignType);
            const valid = files.filter((f) => (wantsVideo ? f.type.startsWith('video/') : f.type.startsWith('image/')));
            if (valid.length === 0) {
                toast({
                    title: 'Unsupported file',
                    description: `This campaign type requires ${wantsVideo ? 'videos' : 'images'}.`,
                    variant: 'destructive',
                });
                return;
            }
            const singleOnly = campaignType === 'single_image' || campaignType === 'video';
            const toUpload = singleOnly ? valid.slice(0, 1) : valid;

            // Images are re-encoded client-side; videos are uploaded as-is, so they
            // keep the bucket's own 50 MB ceiling.
            const rejected = toUpload
                .map((f) => validateUploadFile(f, {
                    maxBytes: f.type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_SOURCE_BYTES,
                    accept: ['image/', 'video/'],
                }))
                .filter(Boolean) as string[];
            if (rejected.length > 0) {
                toast({ title: 'Fichier refusé', description: rejected[0], variant: 'destructive' });
                return;
            }

            setUploading(true);
            try {
                const uploaded: CampaignMedia[] = [];
                for (const file of toUpload) {
                    const isVideo = file.type.startsWith('video/');
                    const compressed = isVideo ? null : await compressImage(file, 'media');
                    const body = compressed ? compressed.blob : file;
                    const ext = compressed ? compressed.ext : (file.name.split('.').pop() || 'bin');
                    const path = `${activeBusinessId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                    const { error: upErr } = await supabase.storage
                        .from('campaign-media')
                        .upload(path, body, {
                            cacheControl: '3600',
                            upsert: false,
                            ...(compressed ? { contentType: compressed.contentType } : {}),
                        });
                    if (upErr) throw upErr;
                    const { data: pub } = supabase.storage.from('campaign-media').getPublicUrl(path);
                    uploaded.push({
                        url: pub.publicUrl,
                        path,
                        type: isVideo ? 'video' : 'image',
                        name: file.name,
                    });
                }
                if (singleOnly) {
                    const toRemove = media.map((m) => m.path).filter(Boolean);
                    if (toRemove.length > 0) await supabase.storage.from('campaign-media').remove(toRemove);
                    setMedia(uploaded);
                } else {
                    setMedia((prev) => [...prev, ...uploaded]);
                }
            } catch (err: any) {
                toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
            } finally {
                setUploading(false);
            }
        },
        [activeBusinessId, campaignType, media, toast]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: isVideoType(campaignType) ? { 'video/*': [] } : { 'image/*': [] },
        multiple: campaignType !== 'single_image' && campaignType !== 'video',
    });

    useEffect(() => {
        if (media.length === 0) return;
        const wantsVideo = isVideoType(campaignType);
        const hasWrong = media.some((m) => (wantsVideo ? m.type !== 'video' : m.type !== 'image'));
        if (hasWrong) {
            setMedia([]);
            toast({ title: 'Media cleared', description: 'Switched to a different creative type. Upload matching media.' });
        }
    }, [campaignType]); // eslint-disable-line react-hooks/exhaustive-deps

    const removeMedia = async (index: number) => {
        const m = media[index];
        if (m?.path) await supabase.storage.from('campaign-media').remove([m.path]);
        setMedia((prev) => prev.filter((_, i) => i !== index));
    };

    const saveMutation = useMutation({
        mutationFn: async (values: CampaignFormValues) => {
            if (!activeBusinessId) throw new Error('No business selected');

            const { data: { user } } = await supabase.auth.getUser();

            const audience = {
                age_min: values.audience_age_min,
                age_max: values.audience_age_max,
                genders: values.audience_genders,
                countries: values.audience_countries?.split(',').map((s) => s.trim()).filter(Boolean),
                interests: values.audience_interests?.split(',').map((s) => s.trim()).filter(Boolean),
            };

            const payload = {
                'DigiCom Business': activeBusinessId,
                created_by: user?.id || null,
                name: values.name,
                status: values.status,
                platform: values.platform,
                objective: values.objective || null,
                spending_type: values.spending_type,
                daily_budget: values.spending_type === 'ongoing' ? values.daily_budget : null,
                total_budget: values.spending_type === 'date_limited' ? values.total_budget : null,
                start_date: values.start_date ? format(values.start_date, 'yyyy-MM-dd') : null,
                end_date: values.end_date ? format(values.end_date, 'yyyy-MM-dd') : null,
                campaign_type: values.campaign_type,
                media,
                conversion_type: values.conversion_type,
                conversion_content: values.conversion_content,
                primary_text: values.primary_text || null,
                headline: values.headline || null,
                cta_label: values.cta_label || null,
                audience,
                pixel_id: values.pixel_id || null,
                notes: values.notes || null,
                currency: values.currency || 'MAD',
            };

            if (isEdit) {
                const { error } = await (supabase as any)
                    .from('campaigns')
                    .update(payload)
                    .eq('id', id!);
                if (error) throw error;
            } else {
                const { error } = await (supabase as any).from('campaigns').insert(payload);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaigns', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['dash-stats', 'mediabuyer'] });
            toast({ title: isEdit ? 'Campaign updated' : 'Campaign created' });
            navigate(basePath);
        },
        onError: (err: any) => {
            const isLock = String(err?.message || '').includes('source_taken');
            toast({
                title: isLock ? 'Source indisponible' : 'Error',
                description: isLock ? (err?.details || 'Cette source est déjà gérée par un autre media buyer. Choisissez-en une autre.') : err.message,
                variant: 'destructive',
            });
        },
    });

    if (loadingCampaign) {
        return (
            <div className="ant-surface min-h-screen flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-ant-mid" />
            </div>
        );
    }

    const sectionCls = 'rounded-2xl border border-ant-line bg-ant-paper overflow-hidden';
    const sectionBody = 'p-5 space-y-4';

    const inputCls = 'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';
    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-10 w-10 rounded-full border border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light shrink-0 cursor-pointer"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </Button>
                        <div className="space-y-2 min-w-0">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                {isEdit ? 'Campaign · Edit' : 'Campaign · New'}
                            </div>
                            <h1 className="font-display text-[28px] md:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                                {isEdit ? 'Edit campaign' : 'Build a new campaign'}
                            </h1>
                            <p className="font-serif italic text-[13px] leading-relaxed text-ant-mid max-w-xl">
                                Targeting, creative, budget, conversion — five chapters that turn a spend into a story.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => navigate(basePath)}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={saveMutation.isPending || uploading}
                            onClick={form.handleSubmit((v) => saveMutation.mutate(v))}
                            className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {isEdit ? 'Save changes' : 'Publish campaign'}
                        </Button>
                    </div>
                </header>

                <Form {...form}>
                    <form className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        <div className="lg:col-span-2 space-y-5">
                            {/* 01 Basics */}
                            <section className={sectionCls}>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className={sectionBody}>
                                    <Chapter num="01" label="Basics" />
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Campaign name</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="E.g. Winter sale — carousel — FB" className={cn(inputCls, 'h-11 text-[13px]')} />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="status"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Status</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            <SelectItem value="draft" className="text-[12px]">Draft</SelectItem>
                                                            <SelectItem value="active" className="text-[12px]">Active</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="platform"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Platform</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            {CAMPAIGN_PLATFORMS
                                                                .filter((p) => !lockedSources.has(getPlatformSource(p)) || p === field.value)
                                                                .map((p) => {
                                                                    const takenEdge = lockedSources.has(getPlatformSource(p)); // only the currently-selected one, edge case
                                                                    return (
                                                                        <SelectItem key={p} value={p} disabled={takenEdge} className="text-[12px] capitalize">
                                                                            <div className="flex items-center gap-2">
                                                                                <span style={{ color: getPlatformColor(p) }}>{getPlatformIcon(p)}</span>
                                                                                {p}
                                                                                {takenEdge ? <span className="ml-auto pl-3 text-[10px] normal-case italic text-ant-mid">· indisponible</span> : null}
                                                                            </div>
                                                                        </SelectItem>
                                                                    );
                                                                })}
                                                        </SelectContent>
                                                    </Select>
                                                    {lockedSources.size > 0 ? (
                                                        <p className="text-[10.5px] italic text-ant-mid">Les sources gérées par un autre media buyer sont masquées — mises à jour en temps réel.</p>
                                                    ) : null}
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <FormField
                                        control={form.control}
                                        name="objective"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Objective</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                                    <FormControl>
                                                        <SelectTrigger className={inputCls}>
                                                            <SelectValue placeholder="Select objective" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-ant-line">
                                                        {CAMPAIGN_OBJECTIVES.map((o) => (
                                                            <SelectItem key={o.value} value={o.value} className="text-[12px]">{o.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </section>

                            {/* 02 Budget & Schedule */}
                            <section className={sectionCls}>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className={sectionBody}>
                                    <Chapter num="02" label="Budget & schedule" />
                                    <FormField
                                        control={form.control}
                                        name="spending_type"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="ongoing" className="mt-0.5" />
                                                            <div className="space-y-1 flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <InfinityIcon className="w-4 h-4 text-ant-ink" />
                                                                    <span className="font-display text-[14px] font-semibold text-ant-ink">Ongoing</span>
                                                                </div>
                                                                <p className="font-serif italic text-[11px] text-ant-mid">No end date. Set a daily budget and let it run.</p>
                                                            </div>
                                                        </label>
                                                        <label className="flex items-start gap-3 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-4 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5">
                                                            <RadioGroupItem value="date_limited" className="mt-0.5" />
                                                            <div className="space-y-1 flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <CalendarIcon className="w-4 h-4 text-ant-ink" />
                                                                    <span className="font-display text-[14px] font-semibold text-ant-ink">Date limited</span>
                                                                </div>
                                                                <p className="font-serif italic text-[11px] text-ant-mid">Fixed period. Set a total ad spend.</p>
                                                            </div>
                                                        </label>
                                                    </RadioGroup>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    {spendingType === 'ongoing' ? (
                                        <FormField
                                            control={form.control}
                                            name="daily_budget"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Daily budget</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'pr-14 tabular-nums')} />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">{form.watch('currency')}</span>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    ) : (
                                        <div className="space-y-3">
                                            <FormField
                                                control={form.control}
                                                name="total_budget"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className={labelCls}>Total ad spend</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className={cn(inputCls, 'pr-14 tabular-nums')} />
                                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid text-[10px] font-semibold uppercase tracking-[0.18em]">{form.watch('currency')}</span>
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage className="text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <FormField
                                                    control={form.control}
                                                    name="start_date"
                                                    render={({ field }) => (
                                                        <FormItem className="flex flex-col space-y-1.5">
                                                            <FormLabel className={labelCls}>Start date</FormLabel>
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <FormControl>
                                                                        <Button
                                                                            variant="outline"
                                                                            className={cn(
                                                                                'h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-left text-[12px] font-medium text-ant-ink justify-between',
                                                                                !field.value && 'text-ant-mid'
                                                                            )}
                                                                        >
                                                                            {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                            <CalendarIcon className="h-3.5 w-3.5 text-ant-mid" />
                                                                        </Button>
                                                                    </FormControl>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="ant-calendar w-auto p-0 rounded-xl overflow-hidden shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] border border-ant-line bg-ant-paper" align="start">
                                                                    <CalendarComponent mode="single" selected={field.value ?? undefined} onSelect={(d) => field.onChange(d ?? null)} initialFocus />
                                                                </PopoverContent>
                                                            </Popover>
                                                            <FormMessage className="text-ant-rose" />
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={form.control}
                                                    name="end_date"
                                                    render={({ field }) => (
                                                        <FormItem className="flex flex-col space-y-1.5">
                                                            <FormLabel className={labelCls}>End date</FormLabel>
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <FormControl>
                                                                        <Button
                                                                            variant="outline"
                                                                            className={cn(
                                                                                'h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-left text-[12px] font-medium text-ant-ink justify-between',
                                                                                !field.value && 'text-ant-mid'
                                                                            )}
                                                                        >
                                                                            {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                            <CalendarIcon className="h-3.5 w-3.5 text-ant-mid" />
                                                                        </Button>
                                                                    </FormControl>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="ant-calendar w-auto p-0 rounded-xl overflow-hidden shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] border border-ant-line bg-ant-paper" align="start">
                                                                    <CalendarComponent mode="single" selected={field.value ?? undefined} onSelect={(d) => field.onChange(d ?? null)} initialFocus />
                                                                </PopoverContent>
                                                            </Popover>
                                                            <FormMessage className="text-ant-rose" />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* 03 Creative */}
                            <section className={sectionCls}>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className={sectionBody}>
                                    <Chapter num="03" label="Creative" />
                                    <FormField
                                        control={form.control}
                                        name="campaign_type"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className={labelCls}>Campaign type</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                        {CAMPAIGN_TYPES.map((t) => {
                                                            const Icon = t.icon;
                                                            return (
                                                                <label
                                                                    key={t.value}
                                                                    className="flex flex-col items-center gap-2 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-3.5 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5"
                                                                >
                                                                    <RadioGroupItem value={t.value} className="sr-only" />
                                                                    <div className="h-8 w-8 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center">
                                                                        <Icon className="w-4 h-4 text-ant-ink" />
                                                                    </div>
                                                                    <span className="text-[11px] font-semibold text-ant-ink text-center leading-tight">{t.label}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </RadioGroup>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    {/* Dropzone */}
                                    <div className="space-y-2">
                                        <p className={labelCls}>
                                            Media ({isVideoType(campaignType) ? 'videos' : 'images'})
                                        </p>
                                        <div
                                            {...getRootProps()}
                                            className={cn(
                                                'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all',
                                                isDragActive ? 'border-ant-orange bg-ant-orange/5' : 'border-ant-line bg-ant-light hover:border-ant-ink/30 hover:bg-ant-light/60'
                                            )}
                                        >
                                            <input {...getInputProps()} />
                                            {uploading ? (
                                                <div className="flex flex-col items-center gap-3 py-2">
                                                    <div className="h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center">
                                                        <Loader2 className="w-5 h-5 animate-spin text-ant-orange" />
                                                    </div>
                                                    <p className="font-serif italic text-[12px] text-ant-mid">Uploading…</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="h-12 w-12 rounded-2xl bg-ant-paper border border-ant-line flex items-center justify-center">
                                                        <Upload className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                                                    </div>
                                                    <div>
                                                        <p className="font-display text-[14px] font-semibold text-ant-ink">
                                                            {isDragActive ? 'Drop here…' : 'Drop files or click to upload'}
                                                        </p>
                                                        <p className="font-serif italic text-[11px] text-ant-mid mt-1">
                                                            {isVideoType(campaignType) ? 'MP4, MOV, WebM' : 'PNG, JPG, WebP'} · Max 50 MB each
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {media.length > 0 && (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                                                {media.map((m, i) => (
                                                    <div key={m.path} className="relative group/media rounded-xl overflow-hidden border border-ant-line bg-ant-light">
                                                        <div className="aspect-square bg-ant-ink/5 flex items-center justify-center">
                                                            {m.type === 'video' ? (
                                                                <>
                                                                    <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                    <PlayCircle className="absolute inset-0 m-auto w-8 h-8 text-white/85" />
                                                                </>
                                                            ) : (
                                                                <img src={imageUrl(m.url, 'card')} alt="" className="w-full h-full object-cover" />
                                                            )}
                                                        </div>
                                                        <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-ant-ink/65 backdrop-blur px-2 py-0.5 text-[10px] font-semibold text-white">
                                                            {m.type === 'video' ? <VideoIcon className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                                                            {i + 1}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeMedia(i)}
                                                            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-ant-paper border border-ant-line flex items-center justify-center shadow-sm opacity-0 group-hover/media:opacity-100 transition-opacity hover:bg-ant-rose hover:text-white hover:border-ant-rose cursor-pointer"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="primary_text"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Primary text</FormLabel>
                                                <FormControl>
                                                    <Textarea {...field} placeholder="The main copy shown above the media..." className="min-h-[96px] rounded-2xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="headline"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Headline</FormLabel>
                                                    <FormControl>
                                                        <Input {...field} placeholder="Bold short headline" className={inputCls} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="cta_label"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Call-to-action</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value || ''}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue placeholder="Select a CTA" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            {DEFAULT_CTA_LABELS.map((c) => (
                                                                <SelectItem key={c} value={c} className="text-[12px]">{c}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 04 Conversion */}
                            <section className={sectionCls}>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className={sectionBody}>
                                    <Chapter num="04" label="Conversion" />
                                    <FormField
                                        control={form.control}
                                        name="conversion_type"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className={labelCls}>Conversion type</FormLabel>
                                                <FormControl>
                                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                        {CONVERSION_TYPES.map((c) => {
                                                            const Icon = c.icon;
                                                            return (
                                                                <label
                                                                    key={c.value}
                                                                    className="flex flex-col items-center gap-2 cursor-pointer rounded-2xl border border-ant-line bg-ant-light p-3.5 hover:border-ant-orange/40 transition-all has-[:checked]:border-ant-orange has-[:checked]:bg-ant-orange/5"
                                                                >
                                                                    <RadioGroupItem value={c.value} className="sr-only" />
                                                                    <div className="h-8 w-8 rounded-lg bg-ant-paper border border-ant-line flex items-center justify-center">
                                                                        <Icon className="w-4 h-4 text-ant-ink" />
                                                                    </div>
                                                                    <span className="text-[11px] font-semibold text-ant-ink text-center leading-tight">{c.label}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </RadioGroup>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="conversion_content"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>{conversionMeta?.contentLabel || 'Conversion content'}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder={conversionMeta?.placeholder || ''} className={cn(inputCls, 'font-mono')} />
                                                </FormControl>
                                                <FormDescription className="font-serif italic text-[11px] text-ant-mid">
                                                    {conversionType === 'whatsapp'
                                                        ? 'Full international number, digits only. Include the country code.'
                                                        : 'Paste the full URL where traffic will be sent.'}
                                                </FormDescription>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="pixel_id"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Pixel ID · optional</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Meta / TikTok pixel identifier" className={cn(inputCls, 'font-mono')} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </section>

                            {/* 05 Audience */}
                            <section className={sectionCls}>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className={sectionBody}>
                                    <Chapter num="05" label="Audience" />
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="audience_age_min"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Age min</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className={cn(inputCls, 'tabular-nums')} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="audience_age_max"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Age max</FormLabel>
                                                    <FormControl>
                                                        <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className={cn(inputCls, 'tabular-nums')} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <FormField
                                        control={form.control}
                                        name="audience_genders"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Genders</FormLabel>
                                                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper w-full">
                                                    {GENDERS.map((g) => {
                                                        const checked = field.value.includes(g);
                                                        return (
                                                            <button
                                                                key={g}
                                                                type="button"
                                                                onClick={() => {
                                                                    const next = checked ? field.value.filter((x) => x !== g) : [...field.value, g];
                                                                    field.onChange(next);
                                                                }}
                                                                className={cn(
                                                                    'flex-1 h-8 rounded-full text-[11px] font-semibold capitalize transition cursor-pointer',
                                                                    checked ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                                                )}
                                                            >
                                                                {g}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="audience_countries"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Countries</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Comma-separated, e.g. Morocco, France" className={inputCls} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="audience_interests"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Interests</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Comma-separated, e.g. Fashion, Beauty" className={inputCls} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="notes"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Internal notes</FormLabel>
                                                <FormControl>
                                                    <Textarea {...field} placeholder="Reminders, references, hypotheses..." className="min-h-[80px] rounded-2xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </section>
                        </div>

                        {/* Live preview column */}
                        <div className="lg:col-span-1">
                            <div className="sticky top-6 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Live preview
                                </div>
                                <PreviewCard
                                    platform={form.watch('platform')}
                                    primaryText={form.watch('primary_text')}
                                    headline={form.watch('headline')}
                                    ctaLabel={form.watch('cta_label')}
                                    conversionContent={form.watch('conversion_content')}
                                    media={media}
                                />
                            </div>
                        </div>
                    </form>
                </Form>
            </div>
        </div>
    );
};

// ── Live preview card ─────────────────────────────────────────────────────────
const PreviewCard: React.FC<{
    platform: string;
    primaryText?: string;
    headline?: string;
    ctaLabel?: string;
    conversionContent?: string;
    media: CampaignMedia[];
}> = ({ platform, primaryText, headline, ctaLabel, conversionContent, media }) => {
    const first = media[0];
    return (
        <div className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="flex items-center gap-2.5 px-3.5 py-3">
                <div className="w-9 h-9 rounded-full bg-ant-light border border-ant-line flex items-center justify-center">
                    <Megaphone className="w-4 h-4 text-ant-ink" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-ant-ink truncate leading-tight">Your business</p>
                    <p className="text-[10px] font-serif italic text-ant-mid inline-flex items-center gap-1">
                        Sponsored · <span style={{ color: getPlatformColor(platform) }}>{getPlatformIcon(platform, 'w-2.5 h-2.5')}</span>
                    </p>
                </div>
            </div>
            {primaryText && (
                <div className="px-3.5 pb-3">
                    <p className="text-[12px] text-ant-ink/85 whitespace-pre-wrap break-words">{primaryText}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-ant-light flex items-center justify-center">
                {first ? (
                    first.type === 'video' ? (
                        <video src={first.url} className="w-full h-full object-cover" muted autoPlay loop playsInline />
                    ) : (
                        <img src={imageUrl(first.url, 'card')} className="w-full h-full object-cover" alt="" />
                    )
                ) : (
                    <div className="text-ant-mid/40 flex flex-col items-center gap-2">
                        <ImageIcon className="w-10 h-10" strokeWidth={1.25} />
                        <span className="text-[10px] uppercase tracking-[0.24em] font-semibold">No media yet</span>
                    </div>
                )}
            </div>
            {(headline || ctaLabel) && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-3 bg-ant-light border-t border-ant-line">
                    <div className="min-w-0 flex-1">
                        {conversionContent && (
                            <p className="text-[10px] uppercase tracking-[0.18em] text-ant-mid truncate">
                                {conversionContent.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {headline && <p className="text-[12px] font-semibold text-ant-ink leading-tight truncate">{headline}</p>}
                    </div>
                    {ctaLabel && (
                        <div className="shrink-0 h-8 px-3 rounded-full bg-ant-ink text-white text-[11px] font-semibold flex items-center">
                            {ctaLabel}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CampaignForm;
