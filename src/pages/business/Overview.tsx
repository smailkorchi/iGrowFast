import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import {
  LayoutDashboard,
  Building2,
  Calendar,
  CreditCard,
  Shield,
  Sparkles,
  Loader2,
  Upload,
  PenLine,
  Stamp,
  Save,
  FileImage,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
    .refine((v) => {
      if (!v || v === '') return true;
      // Accept domain-only entries (e.g. "acme.ma") by prepending https:// before validation.
      const candidate = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      return z.string().url().safeParse(candidate).success;
    }, { message: 'URL invalide' }),
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

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  deactivated: 'bg-red-50 text-red-800 border-red-100',
  suspended: 'bg-amber-50 text-amber-900 border-amber-100',
};

// @react-pdf/renderer's <Image> component only accepts raster formats (PNG / JPEG).
// SVG files render as a blank box in Devis / Facture / Bon de commande / Bon de
// livraison PDFs. To keep the upload UX unchanged while guaranteeing the document
// templates render, every branding asset is rasterised to PNG on the client before
// it hits Supabase Storage. Raster inputs are re-encoded (cheap) so dimensions are
// also normalised.
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
  const { error } = await supabase.storage
    .from('business-logos')
    .upload(path, pngBlob, { contentType: 'image/png' });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from('business-logos').getPublicUrl(path);
  return publicUrl;
}

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
        .select(
          `
          *,
          plan:plans(id, name, license_type, price, currency, description)
        `
        )
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
      toast({ title: 'Enregistré', description: 'Informations entreprise mises à jour.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const meta = useMemo(() => {
    if (!business) return [];
    const planName = business.plan?.name ?? '—';
    const price =
      business.plan?.price != null
        ? `${Number(business.plan.price).toLocaleString()} ${business.plan.currency || 'MAD'}`
        : '—';
    return [
      { label: 'Plan', value: planName, sub: price },
      { label: 'License type', value: formatLicenseLabel(business.license_type) },
      {
        label: 'License period',
        value:
          business.license_type === 'lifetime'
            ? 'No expiry'
            : business.license_end
              ? `${format(parseISO(business.license_start), 'MMM d, yyyy')} → ${format(parseISO(business.license_end), 'MMM d, yyyy')}`
              : format(parseISO(business.license_start), 'MMM d, yyyy'),
      },
      {
        label: 'Billing',
        value: business.paid ? 'Paid' : 'Unpaid',
        valueClass: business.paid ? 'text-emerald-700' : undefined,
      },
      {
        label: 'Member since',
        value: business.created_at
          ? format(parseISO(business.created_at), 'MMMM d, yyyy')
          : '—',
      },
    ];
  }, [business]);

  const wrapUpload = async (
    kind: 'logo' | 'cachet' | 'signature',
    file: File,
    setValue: (url: string) => void
  ) => {
    if (!activeBusinessId) return;
    setUploadKind(kind);
    try {
      const url = await uploadBrandingAsset(activeBusinessId, kind, file);
      setValue(url);
      toast({ title: 'Fichier envoyé', description: 'N’oubliez pas d’enregistrer.' });
    } catch (e) {
      toast({ title: 'Échec envoi', description: (e as Error).message, variant: 'destructive' });
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
      <div className="space-y-8 pb-8">
        <HeaderShell />
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 text-center">
            <p className="text-sm text-gray-400 font-light">No active business selected.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-8 pb-8">
        <HeaderShell />
        <div className="grid gap-5 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-3xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-96 rounded-3xl lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (isError || !business) {
    return (
      <div className="space-y-8 pb-8">
        <HeaderShell />
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 text-center">
            <p className="text-sm text-gray-500 font-light">Could not load business details.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusClass =
    statusStyles[business.status] ?? 'bg-gray-50 text-gray-700 border-gray-100';

  const logoPreview = form.watch('logo');
  const cachetPreview = form.watch('cachet_url');
  const signaturePreview = form.watch('signature_url');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-8 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
          className="relative"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/[0.03] rounded-3xl" />
          <div className="relative p-6 sm:p-8 flex flex-col xl:flex-row xl:items-end justify-between gap-8">
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Overview</p>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormControl>
                        <Input
                          {...field}
                          className="text-2xl sm:text-3xl font-extralight h-auto py-2 border-0 border-b border-transparent focus-visible:ring-0 focus-visible:border-gray-200 rounded-none px-0 bg-transparent"
                          placeholder="Raison sociale"
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn('rounded-full text-[10px] font-bold uppercase tracking-wide border', statusClass)}
                >
                  {business.status}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    'rounded-full text-[10px] font-bold uppercase tracking-wide border',
                    business.active
                      ? 'bg-slate-50 text-slate-700 border-slate-100'
                      : 'bg-gray-100 text-gray-500 border-gray-100'
                  )}
                >
                  {business.active ? 'Active account' : 'Inactive account'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Button
                type="submit"
                disabled={saveMutation.isPending || !form.formState.isDirty}
                className="rounded-2xl h-11 px-6 font-bold gap-2 shadow-sm"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Enregistrer
              </Button>
              <LayoutDashboard className="w-9 h-9 text-primary/15 hidden sm:block" />
            </div>
          </div>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-12 items-start">
          <motion.div
            className="lg:col-span-4 space-y-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.45 }}
          >
            <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="px-6 py-5 border-b border-gray-50 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary/70" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Subscription</span>
                </div>
                <dl className="divide-y divide-gray-50">
                  {meta.map((row) => (
                    <div
                      key={row.label}
                      className="px-6 py-4 flex flex-col gap-1"
                    >
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{row.label}</dt>
                      <dd className="text-sm font-medium text-gray-900">
                        <span className={cn('inline-flex flex-col', 'valueClass' in row && row.valueClass)}>
                          {row.value}
                          {'sub' in row && row.sub ? (
                            <span className="text-xs font-normal text-gray-400 mt-0.5">{row.sub}</span>
                          ) : null}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm rounded-3xl bg-gradient-to-br from-slate-900/[0.02] to-transparent">
              <CardContent className="p-6">
                <Calendar className="w-5 h-5 text-primary/45 mb-3" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Last updated</p>
                <p className="text-lg font-light text-gray-900">
                  {business.updated_at ? format(parseISO(business.updated_at), 'MMM d, yyyy · HH:mm') : '—'}
                </p>
                {business.plan?.description && (
                  <p className="text-xs text-gray-500 font-light leading-relaxed mt-5 line-clamp-5">
                    {business.plan.description}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm rounded-3xl bg-white">
              <CardContent className="p-6">
                <CreditCard className="w-5 h-5 text-primary/45 mb-3" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Workspace</p>
                <p className="text-sm text-gray-600 font-light leading-relaxed">
                  Les champs juridiques servent aux documents et à la conformité. Le plan et la facturation restent gérés par la plateforme.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            className="lg:col-span-8 space-y-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45 }}
          >
            <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary/70" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Identité légale (Maroc)
                    </span>
                  </div>
                  <Sparkles className="w-4 h-4 text-amber-400/80" />
                </div>
                <div className="p-6 sm:p-8 space-y-6">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <FormField
                      control={form.control}
                      name="ice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            ICE
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Identifiant Commun de l’Entreprise"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50 focus:bg-white transition-colors"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="rc"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            RC
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Registre de Commerce"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="identifiant_fiscal"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            IF · Identifiant fiscal
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="IF"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="patente"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Patente
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Numéro de patente"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="cnss"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            CNSS
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Affiliation / numéro CNSS"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="legal_form"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Forme juridique
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="SARL, SARLAU, SA…"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="capital_social"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Capital social
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Ex. 100 000 DH"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="legal_address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          Siège social · Adresse
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ''}
                            rows={3}
                            placeholder="Adresse complète"
                            className="rounded-2xl border-gray-100 bg-gray-50/50 resize-none min-h-[88px]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid sm:grid-cols-3 gap-5">
                    <FormField
                      control={form.control}
                      name="legal_city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Ville
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="postal_code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Code postal
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="20000"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="business_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Téléphone
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="+212…"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="business_email"
                      render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Email entreprise
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              type="email"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            Site web
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="https://acme.ma"
                              className="h-11 rounded-2xl border-gray-100 bg-gray-50/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden">
              <CardContent className="p-0">
                <div className="px-6 py-5 border-b border-gray-50 flex items-center gap-2">
                  <FileImage className="w-4 h-4 text-primary/70" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Logo, cachet & signature
                  </span>
                </div>
                <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div
                    {...logoDrop.getRootProps()}
                    className={cn(
                      'relative rounded-2xl border-2 border-dashed min-h-[200px] transition-all cursor-pointer',
                      logoDrop.isDragActive ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/25 bg-gray-50/30'
                    )}
                  >
                    <input {...logoDrop.getInputProps()} />
                    {uploadKind === 'logo' ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-10 rounded-2xl">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : null}
                    <div className="p-5 h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-4">
                        <Building2 className="w-5 h-5 text-primary/60" />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider">Logo</p>
                          <p className="text-[10px] text-gray-400 font-light">Carré ou paysage · PNG / JPG / WebP</p>
                        </div>
                      </div>
                      {logoPreview ? (
                        <div className="flex-1 flex items-center justify-center rounded-xl bg-white border border-gray-100 p-4">
                          <img src={logoPreview} alt="" className="max-h-40 w-full object-contain" />
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
                          <Upload className="w-8 h-8 opacity-35" />
                          <span className="text-xs font-medium">Glisser-déposer ou cliquer</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    {...cachetDrop.getRootProps()}
                    className={cn(
                      'relative rounded-2xl border-2 border-dashed min-h-[200px] transition-all cursor-pointer',
                      cachetDrop.isDragActive ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/25 bg-gray-50/30'
                    )}
                  >
                    <input {...cachetDrop.getInputProps()} />
                    {uploadKind === 'cachet' ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-10 rounded-2xl">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : null}
                    <div className="p-5 h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-4">
                        <Stamp className="w-5 h-5 text-primary/60" />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider">Cachet</p>
                          <p className="text-[10px] text-gray-400 font-light">PNG / JPG recommandé · fond transparent idéal</p>
                        </div>
                      </div>
                      {cachetPreview ? (
                        <div className="flex-1 flex items-center justify-center rounded-xl bg-white border border-gray-100 p-4">
                          <img src={cachetPreview} alt="" className="max-h-40 w-full object-contain" />
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
                          <Upload className="w-8 h-8 opacity-35" />
                          <span className="text-xs font-medium">Glisser-déposer ou cliquer</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    {...signatureDrop.getRootProps()}
                    className={cn(
                      'relative rounded-2xl border-2 border-dashed min-h-[200px] transition-all cursor-pointer',
                      signatureDrop.isDragActive ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-primary/25 bg-gray-50/30'
                    )}
                  >
                    <input {...signatureDrop.getInputProps()} />
                    {uploadKind === 'signature' ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-10 rounded-2xl">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : null}
                    <div className="p-5 h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-4">
                        <PenLine className="w-5 h-5 text-primary/60" />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider">Signature</p>
                          <p className="text-[10px] text-gray-400 font-light">Scan ou image propre du signataire</p>
                        </div>
                      </div>
                      {signaturePreview ? (
                        <div className="flex-1 flex items-center justify-center rounded-xl bg-white border border-gray-100 p-4">
                          <img src={signaturePreview} alt="" className="max-h-40 w-full object-contain" />
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
                          <Upload className="w-8 h-8 opacity-35" />
                          <span className="text-xs font-medium">Glisser-déposer ou cliquer</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </form>
    </Form>
  );
};

function HeaderShell() {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
      <div className="relative p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Overview</h1>
            <p className="text-gray-500 font-light">Business overview and settings</p>
          </div>
          <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-primary/10 items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default BusinessOverview;
