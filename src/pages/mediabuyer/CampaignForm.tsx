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
    GripVertical,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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

    // Redirect non-owners away from the edit form to the preview page.
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

    // Hydrate form when editing.
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

    // Media upload
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
            // Enforce single upload for single_image / video.
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
                    // Remove previous single media files from storage.
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

    // Wipe media when switching between image and video campaign types.
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
                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(basePath)}
                                className="h-12 w-12 rounded-2xl bg-white shadow-sm hover:bg-brand-navy hover:text-white transition-all"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                            <div>
                                <h1 className="text-4xl font-extralight text-gray-900 mb-2">
                                    {isEdit ? 'Edit Campaign' : 'Create Campaign'}
                                </h1>
                                <p className="text-gray-500 font-light">
                                    Configure targeting, creative, budget and conversion destination.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => navigate(basePath)}
                                className="h-12 px-6 rounded-2xl font-bold text-xs uppercase tracking-widest border-brand-navy/10"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={saveMutation.isPending || uploading}
                                onClick={form.handleSubmit((v) => saveMutation.mutate(v))}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-8 rounded-2xl font-bold text-xs uppercase tracking-widest gap-2"
                            >
                                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                {isEdit ? 'Update' : 'Save Campaign'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Form {...form}>
                <form className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {/* ── Basics ── */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/80 backdrop-blur">
                            <CardContent className="p-6 space-y-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Basics</h2>
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Campaign name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="E.g. Winter sale — carousel — FB" className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <FormField
                                        control={form.control}
                                        name="status"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Status</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl">
                                                        <SelectItem value="draft">Draft</SelectItem>
                                                        <SelectItem value="active">Active</SelectItem>
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
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Platform</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl">
                                                        {CAMPAIGN_PLATFORMS.map((p) => (
                                                            <SelectItem key={p} value={p} className="capitalize">
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
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Objective</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                <FormControl>
                                                    <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy">
                                                        <SelectValue placeholder="Select objective" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-2xl">
                                                    {CAMPAIGN_OBJECTIVES.map((o) => (
                                                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>

                        {/* ── Budget & Schedule ── */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/80 backdrop-blur">
                            <CardContent className="p-6 space-y-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Budget & Schedule</h2>
                                <FormField
                                    control={form.control}
                                    name="spending_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 gap-3">
                                                    <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                        <RadioGroupItem value="ongoing" className="mt-0.5" />
                                                        <div className="space-y-0.5 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <InfinityIcon className="w-4 h-4 text-brand-navy" />
                                                                <span className="text-xs font-bold text-brand-navy">Ongoing</span>
                                                            </div>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">No end date. Set a daily budget.</p>
                                                        </div>
                                                    </label>
                                                    <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]">
                                                        <RadioGroupItem value="date_limited" className="mt-0.5" />
                                                        <div className="space-y-0.5 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <CalendarIcon className="w-4 h-4 text-brand-navy" />
                                                                <span className="text-xs font-bold text-brand-navy">Date limited</span>
                                                            </div>
                                                            <p className="text-[10px] text-muted-foreground leading-snug">Fixed period. Set a total ad spend.</p>
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
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Daily budget</FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy pr-14" />
                                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-xs font-bold">{form.watch('currency')}</span>
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                ) : (
                                    <div className="space-y-5">
                                        <FormField
                                            control={form.control}
                                            name="total_budget"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Total ad spend</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" {...field} onChange={(e) => field.onChange(Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy pr-14" />
                                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-navy/30 text-xs font-bold">{form.watch('currency')}</span>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="grid grid-cols-2 gap-5">
                                            <FormField
                                                control={form.control}
                                                name="start_date"
                                                render={({ field }) => (
                                                    <FormItem className="flex flex-col">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Start date</FormLabel>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <FormControl>
                                                                    <Button
                                                                        variant="outline"
                                                                        className={cn(
                                                                            'h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-left font-bold text-brand-navy shadow-inner',
                                                                            !field.value && 'text-muted-foreground'
                                                                        )}
                                                                    >
                                                                        {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                                    </Button>
                                                                </FormControl>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-2xl border-none" align="start">
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
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">End date</FormLabel>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <FormControl>
                                                                    <Button
                                                                        variant="outline"
                                                                        className={cn(
                                                                            'h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-left font-bold text-brand-navy shadow-inner',
                                                                            !field.value && 'text-muted-foreground'
                                                                        )}
                                                                    >
                                                                        {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                                    </Button>
                                                                </FormControl>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden shadow-2xl border-none" align="start">
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
                            </CardContent>
                        </Card>

                        {/* ── Creative ── */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/80 backdrop-blur">
                            <CardContent className="p-6 space-y-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Creative</h2>
                                <FormField
                                    control={form.control}
                                    name="campaign_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Campaign type</FormLabel>
                                            <FormControl>
                                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                                    {CAMPAIGN_TYPES.map((t) => {
                                                        const Icon = t.icon;
                                                        return (
                                                            <label
                                                                key={t.value}
                                                                className="flex flex-col items-center gap-2 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]"
                                                            >
                                                                <RadioGroupItem value={t.value} className="sr-only" />
                                                                <Icon className="w-5 h-5 text-brand-navy" />
                                                                <span className="text-[11px] font-bold text-brand-navy text-center leading-tight">{t.label}</span>
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
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-2">
                                        Media ({isVideoType(campaignType) ? 'videos' : 'images'})
                                    </p>
                                    <div
                                        {...getRootProps()}
                                        className={cn(
                                            'relative border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all duration-300',
                                            isDragActive ? 'border-brand-navy bg-brand-navy/[0.04] scale-[0.99]' : 'border-brand-navy/15 hover:border-brand-navy/30 bg-brand-navy/[0.02]'
                                        )}
                                    >
                                        <input {...getInputProps()} />
                                        {uploading ? (
                                            <div className="flex flex-col items-center gap-3 py-4">
                                                <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                                                <p className="text-xs font-bold text-brand-navy/60">Uploading…</p>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-12 h-12 rounded-2xl bg-brand-navy/5 flex items-center justify-center">
                                                    <Upload className="w-5 h-5 text-brand-navy/60" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-brand-navy">
                                                        {isDragActive ? 'Drop here…' : 'Drop files or click to upload'}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground mt-1">
                                                        {isVideoType(campaignType) ? 'MP4, MOV, WebM' : 'PNG, JPG, WebP'} · Max 50 MB each
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Media list */}
                                    {media.length > 0 && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                                            {media.map((m, i) => (
                                                <div key={m.path} className="relative group/media rounded-2xl overflow-hidden border border-brand-navy/5 bg-brand-navy/[0.03]">
                                                    <div className="aspect-square bg-black/5 flex items-center justify-center">
                                                        {m.type === 'video' ? (
                                                            <>
                                                                <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                                                                <PlayCircle className="absolute inset-0 m-auto w-10 h-10 text-white/80" />
                                                            </>
                                                        ) : (
                                                            <img src={m.url} alt="" className="w-full h-full object-cover" />
                                                        )}
                                                    </div>
                                                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-[9px] font-black text-white uppercase flex items-center gap-1">
                                                        {m.type === 'video' ? <VideoIcon className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                                                        {i + 1}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeMedia(i)}
                                                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center shadow-md opacity-0 group-hover/media:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
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
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Primary text</FormLabel>
                                            <FormControl>
                                                <Textarea {...field} placeholder="The main copy shown above the media…" className="min-h-[100px] rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy resize-none" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <FormField
                                        control={form.control}
                                        name="headline"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Headline</FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Bold short headline" className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="cta_label"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Call-to-action</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy">
                                                            <SelectValue placeholder="Select a CTA" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl">
                                                        {DEFAULT_CTA_LABELS.map((c) => (
                                                            <SelectItem key={c} value={c}>{c}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* ── Conversion ── */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/80 backdrop-blur">
                            <CardContent className="p-6 space-y-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Conversion</h2>
                                <FormField
                                    control={form.control}
                                    name="conversion_type"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Conversion type</FormLabel>
                                            <FormControl>
                                                <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    {CONVERSION_TYPES.map((c) => {
                                                        const Icon = c.icon;
                                                        return (
                                                            <label
                                                                key={c.value}
                                                                className="flex flex-col items-center gap-2 cursor-pointer rounded-2xl border-2 border-brand-navy/5 bg-brand-navy/[0.02] p-4 hover:border-brand-navy/20 transition-all has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/[0.05]"
                                                            >
                                                                <RadioGroupItem value={c.value} className="sr-only" />
                                                                <Icon className="w-5 h-5 text-brand-navy" />
                                                                <span className="text-[11px] font-bold text-brand-navy text-center leading-tight">{c.label}</span>
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
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{conversionMeta?.contentLabel || 'Conversion content'}</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder={conversionMeta?.placeholder || ''} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy" />
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
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Pixel ID (optional)</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Meta / TikTok pixel identifier" className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>

                        {/* ── Audience ── */}
                        <Card className="border-none rounded-[28px] shadow-sm bg-white/80 backdrop-blur">
                            <CardContent className="p-6 space-y-5">
                                <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Audience</h2>
                                <div className="grid grid-cols-2 gap-5">
                                    <FormField
                                        control={form.control}
                                        name="audience_age_min"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Age min</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="audience_age_max"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Age max</FormLabel>
                                                <FormControl>
                                                    <Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-bold text-brand-navy" />
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
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Genders</FormLabel>
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
                                                                'flex-1 h-11 rounded-2xl border-2 text-xs font-bold uppercase capitalize transition-all',
                                                                checked ? 'border-brand-navy bg-brand-navy text-white' : 'border-brand-navy/5 bg-brand-navy/[0.02] text-brand-navy/60 hover:border-brand-navy/20'
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
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Countries</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Comma-separated, e.g. Morocco, France" className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="audience_interests"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Interests</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Comma-separated, e.g. Fashion, Beauty" className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="notes"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Internal notes</FormLabel>
                                            <FormControl>
                                                <Textarea {...field} placeholder="Reminders, references, hypotheses…" className="min-h-[80px] rounded-2xl border-none bg-brand-navy/[0.04] shadow-inner font-medium text-brand-navy resize-none" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    {/* ── Live preview column ── */}
                    <div className="lg:col-span-1">
                        <div className="sticky top-6 space-y-4">
                            <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50 px-2">Live preview</h2>
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

// ── Simple preview card for the right column ──
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
        <div className="rounded-[28px] overflow-hidden bg-white border border-brand-navy/[0.06] shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-3 p-4 pb-3">
                <div className="w-10 h-10 rounded-full bg-brand-navy/10 flex items-center justify-center">
                    <Megaphone className="w-4 h-4 text-brand-navy" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-brand-navy truncate leading-tight">Your business</p>
                    <p className="text-[10px] text-muted-foreground">Sponsored · <span className="inline-flex items-center gap-1" style={{ color: getPlatformColor(platform) }}>{getPlatformIcon(platform, 'w-2.5 h-2.5')}</span></p>
                </div>
            </div>
            {primaryText && (
                <div className="px-4 pb-3">
                    <p className="text-[13px] text-brand-navy/80 whitespace-pre-wrap break-words">{primaryText}</p>
                </div>
            )}
            <div className="relative w-full aspect-square bg-brand-navy/[0.05] flex items-center justify-center">
                {first ? (
                    first.type === 'video' ? (
                        <video src={first.url} className="w-full h-full object-cover" muted autoPlay loop playsInline />
                    ) : (
                        <img src={first.url} className="w-full h-full object-cover" alt="" />
                    )
                ) : (
                    <div className="text-brand-navy/20 flex flex-col items-center gap-2">
                        <ImageIcon className="w-10 h-10" />
                        <span className="text-[10px] font-bold uppercase">No media yet</span>
                    </div>
                )}
            </div>
            {(headline || ctaLabel) && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-brand-navy/[0.02] border-t border-brand-navy/5">
                    <div className="min-w-0 flex-1">
                        {conversionContent && (
                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                                {conversionContent.replace(/^https?:\/\//, '').split('/')[0]}
                            </p>
                        )}
                        {headline && <p className="text-[13px] font-bold text-brand-navy leading-tight truncate">{headline}</p>}
                    </div>
                    {ctaLabel && (
                        <div className="shrink-0 h-8 px-3 rounded-xl bg-brand-navy/[0.06] text-brand-navy text-[10px] font-black uppercase tracking-wider flex items-center">
                            {ctaLabel}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CampaignForm;
