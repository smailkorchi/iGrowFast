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
    Save,
    Loader2,
    Upload,
    X,
    Image as ImageIcon,
    Video as VideoIcon,
    Calendar as CalendarIcon,
    Infinity as InfinityIcon,
    Megaphone,
    PlayCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
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

            setUploading(true);
            try {
                const uploaded: CampaignMedia[] = [];
                for (const file of toUpload) {
                    const ext = file.name.split('.').pop() || 'bin';
                    const path = `${activeBusinessId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                    const { error: upErr } = await supabase.storage
                        .from('campaign-media')
                        .upload(path, file, { cacheControl: '3600', upsert: false });
                    if (upErr) throw upErr;
                    const { data: pub } = supabase.storage.from('campaign-media').getPublicUrl(path);
                    uploaded.push({
                        url: pub.publicUrl,
                        path,
                        type: file.type.startsWith('video/') ? 'video' : 'image',
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
            toast({ title: isEdit ? 'Campaign updated' : 'Campaign created' });
            navigate(basePath);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    if (loadingCampaign) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(basePath)}
                            className="h-8 w-8 rounded-md border border-gray-200 text-gray-500 hover:text-brand-navy shrink-0"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                        </Button>
                        <div>
                            <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                                {isEdit ? 'Edit Campaign' : 'Create Campaign'}
                            </h1>
                            <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                                Configure targeting, creative, budget and conversion
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => navigate(basePath)}
                            className="h-8 rounded-md text-[11px] font-semibold border-gray-200"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={saveMutation.isPending || uploading}
                            onClick={form.handleSubmit((v) => saveMutation.mutate(v))}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-4"
                        >
                            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {isEdit ? 'Update' : 'Save Campaign'}
                        </Button>
                    </div>
                </div>
            </header>

            <Form {...form}>
                <form className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="lg:col-span-2 space-y-3">
                        {/* ── Basics ── */}
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Basics</p>
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Campaign name</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="E.g. Winter sale — carousel — FB" className="h-9 text-[12px] rounded-md border-gray-200" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="status"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Status</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-9 text-[12px] rounded-md border-gray-200">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-xl">
                                                    <SelectItem value="draft" className="text-[11px]">Draft</SelectItem>
                                                    <SelectItem value="active" className="text-[11px]">Active</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="platform"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Platform</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-9 text-[12px] rounded-md border-gray-200">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-xl">
                                                    {CAMPAIGN_PLATFORMS.map((p) => (
                                                        <SelectItem key={p} value={p} className="text-[11px] capitalize">
                                                            <div className="flex items-center gap-2">
                                                                <span style={{ color: getPlatformColor(p) }}>{getPlatformIcon(p)}</span>
                                                                {p}
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={form.control}
                                name="objective"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Objective</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <FormControl>
                                                <SelectTrigger className="h-9 text-[12px] rounded-md border-gray-200">
                                                    <SelectValue placeholder="Select objective" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl">
                                                {CAMPAIGN_OBJECTIVES.map((o) => (
                                                    <SelectItem key={o.value} value={o.value} className="text-[11px]">{o.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* ── Budget & Schedule ── */}
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Budget & Schedule</p>
                            <FormField
                                control={form.control}
                                name="spending_type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-2">
                                                <label className="flex items-start gap-2.5 cursor-pointer rounded-md border border-gray-200 bg-gray-50 p-3 hover:border-brand-navy/30 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.03]">
                                                    <RadioGroupItem value="ongoing" className="mt-0.5" />
                                                    <div className="space-y-0.5 flex-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <InfinityIcon className="w-3.5 h-3.5 text-brand-navy" />
                                                            <span className="text-[11px] font-semibold text-brand-navy">Ongoing</span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-400">No end date. Set a daily budget.</p>
                                                    </div>
                                                </label>
                                                <label className="flex items-start gap-2.5 cursor-pointer rounded-md border border-gray-200 bg-gray-50 p-3 hover:border-brand-navy/30 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.03]">
                                                    <RadioGroupItem value="date_limited" className="mt-0.5" />
                                                    <div className="space-y-0.5 flex-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <CalendarIcon className="w-3.5 h-3.5 text-brand-navy" />
                                                            <span className="text-[11px] font-semibold text-brand-navy">Date limited</span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-400">Fixed period. Set a total ad spend.</p>
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
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Daily budget</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className="h-9 text-[12px] rounded-md border-gray-200 pr-12" />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] font-semibold">{form.watch('currency')}</span>
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ) : (
                                <div className="space-y-3">
                                    <FormField
                                        control={form.control}
                                        name="total_budget"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[11px] font-medium text-gray-500">Total ad spend</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className="h-9 text-[12px] rounded-md border-gray-200 pr-12" />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] font-semibold">{form.watch('currency')}</span>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="start_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <FormLabel className="text-[11px] font-medium text-gray-500">Start date</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-9 rounded-md border-gray-200 text-left text-[12px] font-medium text-brand-navy justify-between',
                                                                        !field.value && 'text-gray-400'
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                    <CalendarIcon className="h-3.5 w-3.5 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-auto p-0 rounded-xl overflow-hidden shadow-md border-gray-100" align="start">
                                                            <CalendarComponent mode="single" selected={field.value ?? undefined} onSelect={(d) => field.onChange(d ?? null)} initialFocus />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="end_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <FormLabel className="text-[11px] font-medium text-gray-500">End date</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-9 rounded-md border-gray-200 text-left text-[12px] font-medium text-brand-navy justify-between',
                                                                        !field.value && 'text-gray-400'
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                    <CalendarIcon className="h-3.5 w-3.5 opacity-50" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-auto p-0 rounded-xl overflow-hidden shadow-md border-gray-100" align="start">
                                                            <CalendarComponent mode="single" selected={field.value ?? undefined} onSelect={(d) => field.onChange(d ?? null)} initialFocus />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ── Creative ── */}
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Creative</p>
                            <FormField
                                control={form.control}
                                name="campaign_type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Campaign type</FormLabel>
                                        <FormControl>
                                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                {CAMPAIGN_TYPES.map((t) => {
                                                    const Icon = t.icon;
                                                    return (
                                                        <label
                                                            key={t.value}
                                                            className="flex flex-col items-center gap-1.5 cursor-pointer rounded-md border border-gray-200 bg-gray-50 p-3 hover:border-brand-navy/30 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.03]"
                                                        >
                                                            <RadioGroupItem value={t.value} className="sr-only" />
                                                            <Icon className="w-4 h-4 text-brand-navy" />
                                                            <span className="text-[10px] font-semibold text-brand-navy text-center leading-tight">{t.label}</span>
                                                        </label>
                                                    );
                                                })}
                                            </RadioGroup>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {/* Dropzone */}
                            <div>
                                <p className="text-[11px] font-medium text-gray-500 mb-1.5">
                                    Media ({isVideoType(campaignType) ? 'videos' : 'images'})
                                </p>
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
                                        isDragActive ? 'border-brand-navy bg-brand-navy/[0.03]' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {uploading ? (
                                        <div className="flex flex-col items-center gap-2 py-2">
                                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                                            <p className="text-[11px] text-gray-400">Uploading...</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2">
                                            <Upload className="w-5 h-5 text-gray-400" />
                                            <div>
                                                <p className="text-[12px] font-semibold text-brand-navy">
                                                    {isDragActive ? 'Drop here...' : 'Drop files or click to upload'}
                                                </p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">
                                                    {isVideoType(campaignType) ? 'MP4, MOV, WebM' : 'PNG, JPG, WebP'} · Max 50 MB each
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {media.length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2.5">
                                        {media.map((m, i) => (
                                            <div key={m.path} className="relative group/media rounded-md overflow-hidden border border-gray-200 bg-gray-50">
                                                <div className="aspect-square bg-black/5 flex items-center justify-center">
                                                    {m.type === 'video' ? (
                                                        <>
                                                            <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                            <PlayCircle className="absolute inset-0 m-auto w-8 h-8 text-white/80" />
                                                        </>
                                                    ) : (
                                                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                                                    )}
                                                </div>
                                                <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur text-[9px] font-semibold text-white flex items-center gap-1">
                                                    {m.type === 'video' ? <VideoIcon className="w-2 h-2" /> : <ImageIcon className="w-2 h-2" />}
                                                    {i + 1}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeMedia(i)}
                                                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-white/90 flex items-center justify-center shadow opacity-0 group-hover/media:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                                                >
                                                    <X className="w-3 h-3" />
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
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Primary text</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} placeholder="The main copy shown above the media..." className="min-h-[90px] text-[12px] rounded-md border-gray-200 resize-none" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="headline"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Headline</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Bold short headline" className="h-9 text-[12px] rounded-md border-gray-200" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="cta_label"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Call-to-action</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                <FormControl>
                                                    <SelectTrigger className="h-9 text-[12px] rounded-md border-gray-200">
                                                        <SelectValue placeholder="Select a CTA" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-xl">
                                                    {DEFAULT_CTA_LABELS.map((c) => (
                                                        <SelectItem key={c} value={c} className="text-[11px]">{c}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {/* ── Conversion ── */}
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Conversion</p>
                            <FormField
                                control={form.control}
                                name="conversion_type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Conversion type</FormLabel>
                                        <FormControl>
                                            <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                {CONVERSION_TYPES.map((c) => {
                                                    const Icon = c.icon;
                                                    return (
                                                        <label
                                                            key={c.value}
                                                            className="flex flex-col items-center gap-1.5 cursor-pointer rounded-md border border-gray-200 bg-gray-50 p-3 hover:border-brand-navy/30 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.03]"
                                                        >
                                                            <RadioGroupItem value={c.value} className="sr-only" />
                                                            <Icon className="w-4 h-4 text-brand-navy" />
                                                            <span className="text-[10px] font-semibold text-brand-navy text-center leading-tight">{c.label}</span>
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
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">{conversionMeta?.contentLabel || 'Conversion content'}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={conversionMeta?.placeholder || ''} className="h-9 text-[12px] rounded-md border-gray-200" />
                                        </FormControl>
                                        <FormDescription className="text-[10px]">
                                            {conversionType === 'whatsapp'
                                                ? 'Full international number, digits only. Include country code.'
                                                : 'Paste the full URL where traffic will be sent.'}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="pixel_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Pixel ID (optional)</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Meta / TikTok pixel identifier" className="h-9 text-[12px] rounded-md border-gray-200" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* ── Audience ── */}
                        <div className="border border-gray-100 rounded-xl bg-white p-3.5 space-y-3">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Audience</p>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="audience_age_min"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Age min</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-9 text-[12px] rounded-md border-gray-200" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="audience_age_max"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[11px] font-medium text-gray-500">Age max</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-9 text-[12px] rounded-md border-gray-200" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <FormField
                                control={form.control}
                                name="audience_genders"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Genders</FormLabel>
                                        <div className="flex gap-2">
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
                                                            'flex-1 h-8 rounded-md border text-[11px] font-semibold uppercase capitalize transition-all',
                                                            checked ? 'border-brand-navy bg-brand-navy text-white' : 'border-gray-200 bg-gray-50 text-brand-navy/60 hover:border-gray-300'
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
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Countries</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Comma-separated, e.g. Morocco, France" className="h-9 text-[12px] rounded-md border-gray-200" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="audience_interests"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Interests</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Comma-separated, e.g. Fashion, Beauty" className="h-9 text-[12px] rounded-md border-gray-200" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-medium text-gray-500">Internal notes</FormLabel>
                                        <FormControl>
                                            <Textarea {...field} placeholder="Reminders, references, hypotheses..." className="min-h-[70px] text-[12px] rounded-md border-gray-200 resize-none" />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    {/* ── Live preview column ── */}
                    <div className="lg:col-span-1">
                        <div className="sticky top-4 space-y-2.5">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Live preview</p>
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
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <Megaphone className="w-3.5 h-3.5 text-brand-navy" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-brand-navy truncate leading-tight">Your business</p>
                    <p className="text-[9px] text-gray-400">Sponsored · <span className="inline-flex items-center gap-1" style={{ color: getPlatformColor(platform) }}>{getPlatformIcon(platform, 'w-2.5 h-2.5')}</span></p>
                </div>
            </div>
            {primaryText && (
                <div className="px-3 pb-2">
                    <p className="text-[11px] text-brand-navy/80 whitespace-pre-wrap break-words">{primaryText}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-gray-50 flex items-center justify-center">
                {first ? (
                    first.type === 'video' ? (
                        <video src={first.url} className="w-full h-full object-cover" muted autoPlay loop playsInline />
                    ) : (
                        <img src={first.url} className="w-full h-full object-cover" alt="" />
                    )
                ) : (
                    <div className="text-gray-300 flex flex-col items-center gap-2">
                        <ImageIcon className="w-8 h-8" />
                        <span className="text-[9px] uppercase tracking-[0.18em]">No media yet</span>
                    </div>
                )}
            </div>
            {(headline || ctaLabel) && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <div className="min-w-0 flex-1">
                        {conversionContent && (
                            <p className="text-[9px] uppercase tracking-[0.12em] text-gray-400 truncate">
                                {conversionContent.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {headline && <p className="text-[11px] font-semibold text-brand-navy leading-tight truncate">{headline}</p>}
                    </div>
                    {ctaLabel && (
                        <div className="shrink-0 h-7 px-2.5 rounded-md bg-brand-navy text-white text-[10px] font-semibold flex items-center">
                            {ctaLabel}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CampaignForm;
