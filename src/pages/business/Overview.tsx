import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import {
  Building2,
  Loader2,
  Upload,
  PenLine,
  Stamp,
  Save,
  FileImage,
  Shield,
  Calendar,
  CreditCard,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

const statusAccent: Record<string, string> = {
  active: '#059669',
  deactivated: '#ef4444',
  suspended: '#d97706',
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
        paid: business.paid,
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
      toast({ title: 'Fichier envoyé', description: "N'oubliez pas d'enregistrer." });
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
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <OverviewHeader />
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
          <p className="text-[11px] text-gray-400">No active business selected.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <OverviewHeader />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-xl lg:col-span-2" />
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-80 rounded-xl lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (isError || !business) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <OverviewHeader />
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
          <p className="text-[11px] text-gray-500">Could not load business details.</p>
        </div>
      </div>
    );
  }

  const logoPreview = form.watch('logo');
  const cachetPreview = form.watch('cachet_url');
  const signaturePreview = form.watch('signature_url');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">

        {/* Header */}
        <header className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Overview</h1>
              <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Business profile & legal identity</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold"
                  style={{
                    background: `${statusAccent[business.status] ?? '#9ca3af'}18`,
                    color: statusAccent[business.status] ?? '#9ca3af',
                  }}
                >
                  {business.status}
                </span>
                <span className={cn(
                  'h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold',
                  business.active ? 'bg-gray-100 text-brand-navy/70' : 'bg-gray-100 text-gray-500'
                )}>
                  {business.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <Button
                type="submit"
                disabled={saveMutation.isPending || !form.formState.isDirty}
                className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Enregistrer
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-3 lg:grid-cols-12 items-start">
          {/* Left column: subscription + business name */}
          <div className="lg:col-span-4 space-y-3">

            {/* Business name */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2.5">
                <Building2 className="w-3 h-3 text-gray-400" />
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Business Name</p>
              </div>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormControl>
                      <Input
                        {...field}
                        className="h-8 rounded-md border-gray-200 text-[13px] font-semibold text-brand-navy"
                        placeholder="Raison sociale"
                      />
                    </FormControl>
                    <FormMessage className="text-[10px]" />
                  </FormItem>
                )}
              />
            </div>

            {/* Subscription */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-gray-400" />
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Subscription</p>
              </div>
              <dl className="divide-y divide-gray-100">
                {meta.map((row) => (
                  <div key={row.label} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                    <dt className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mt-0.5 shrink-0">{row.label}</dt>
                    <dd className="text-[11px] font-semibold text-brand-navy text-right">
                      {'paid' in row ? (
                        <span style={{ color: row.paid ? '#059669' : '#ef4444' }}>{row.value}</span>
                      ) : (
                        <span>{row.value}</span>
                      )}
                      {'sub' in row && row.sub ? (
                        <span className="block text-[9px] font-normal text-gray-400 mt-0.5">{row.sub}</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Last updated */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-gray-400" />
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Last Updated</p>
              </div>
              <p className="text-[12px] font-semibold text-brand-navy">
                {business.updated_at ? format(parseISO(business.updated_at), 'MMM d, yyyy · HH:mm') : '—'}
              </p>
              {business.plan?.description && (
                <p className="text-[10px] text-gray-400 leading-relaxed mt-2 line-clamp-4">
                  {business.plan.description}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <CreditCard className="w-3 h-3 text-gray-400" />
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Workspace</p>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Les champs juridiques servent aux documents et à la conformité. Le plan et la facturation restent gérés par la plateforme.
              </p>
            </div>
          </div>

          {/* Right column: legal identity + branding */}
          <div className="lg:col-span-8 space-y-3">

            {/* Legal identity */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-gray-400" />
                  <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Identité légale (Maroc)</p>
                </div>
              </div>
              <div className="p-3.5 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { name: 'ice' as const, label: 'ICE', placeholder: 'Identifiant Commun de l\'Entreprise' },
                    { name: 'rc' as const, label: 'RC', placeholder: 'Registre de Commerce' },
                    { name: 'identifiant_fiscal' as const, label: 'IF · Identifiant fiscal', placeholder: 'IF' },
                    { name: 'patente' as const, label: 'Patente', placeholder: 'Numéro de patente' },
                    { name: 'cnss' as const, label: 'CNSS', placeholder: 'Affiliation / numéro CNSS' },
                    { name: 'legal_form' as const, label: 'Forme juridique', placeholder: 'SARL, SARLAU, SA…' },
                  ].map(f => (
                    <FormField
                      key={f.name}
                      control={form.control}
                      name={f.name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{f.label}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder={f.placeholder}
                              className="h-8 rounded-md border-gray-200 text-[11px]"
                            />
                          </FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )}
                    />
                  ))}
                  <FormField
                    control={form.control}
                    name="capital_social"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Capital social</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            placeholder="Ex. 100 000 DH"
                            className="h-8 rounded-md border-gray-200 text-[11px]"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <FormField
                    control={form.control}
                    name="legal_address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Siège social · Adresse</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ''}
                            rows={2}
                            placeholder="Adresse complète"
                            className="rounded-md border-gray-200 text-[11px] resize-none min-h-[64px]"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid sm:grid-cols-3 gap-3 border-t border-gray-100 pt-3">
                  {[
                    { name: 'legal_city' as const, label: 'Ville', placeholder: '' },
                    { name: 'postal_code' as const, label: 'Code postal', placeholder: '20000' },
                    { name: 'business_phone' as const, label: 'Téléphone', placeholder: '+212…' },
                  ].map(f => (
                    <FormField
                      key={f.name}
                      control={form.control}
                      name={f.name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{f.label}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder={f.placeholder}
                              className="h-8 rounded-md border-gray-200 text-[11px]"
                            />
                          </FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )}
                    />
                  ))}
                  <FormField
                    control={form.control}
                    name="business_email"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Email entreprise</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            type="email"
                            className="h-8 rounded-md border-gray-200 text-[11px]"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Site web</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            placeholder="https://acme.ma"
                            className="h-8 rounded-md border-gray-200 text-[11px]"
                          />
                        </FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Branding assets */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
                <FileImage className="w-3 h-3 text-gray-400" />
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Logo, cachet & signature</p>
              </div>
              <div className="p-3.5 grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    dropzone: logoDrop,
                    kind: 'logo' as const,
                    label: 'Logo',
                    hint: 'Carré ou paysage · PNG / JPG / WebP',
                    icon: Building2,
                    preview: logoPreview,
                  },
                  {
                    dropzone: cachetDrop,
                    kind: 'cachet' as const,
                    label: 'Cachet',
                    hint: 'PNG / JPG recommandé · fond transparent idéal',
                    icon: Stamp,
                    preview: cachetPreview,
                  },
                  {
                    dropzone: signatureDrop,
                    kind: 'signature' as const,
                    label: 'Signature',
                    hint: 'Scan ou image propre du signataire',
                    icon: PenLine,
                    preview: signaturePreview,
                  },
                ].map(({ dropzone, kind, label, hint, icon: Icon, preview }) => (
                  <div
                    key={kind}
                    {...dropzone.getRootProps()}
                    className={cn(
                      'relative rounded-xl border-2 border-dashed min-h-[160px] transition-all cursor-pointer',
                      dropzone.isDragActive ? 'border-brand-navy bg-brand-navy/5' : 'border-gray-200 hover:border-gray-300 bg-gray-50/30'
                    )}
                  >
                    <input {...dropzone.getInputProps()} />
                    {uploadKind === kind ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-10 rounded-xl">
                        <Loader2 className="w-5 h-5 animate-spin text-brand-navy/40" />
                      </div>
                    ) : null}
                    <div className="p-3 h-full flex flex-col">
                      <div className="flex items-center gap-1.5 mb-3">
                        <Icon className="w-3 h-3 text-gray-400" />
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy">{label}</p>
                          <p className="text-[9px] text-gray-400">{hint}</p>
                        </div>
                      </div>
                      {preview ? (
                        <div className="flex-1 flex items-center justify-center rounded-lg bg-white border border-gray-100 p-3">
                          <img src={preview} alt="" className="max-h-28 w-full object-contain" />
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-1.5">
                          <Upload className="w-6 h-6" />
                          <span className="text-[9px] font-medium text-gray-400">Glisser-déposer ou cliquer</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
};

function OverviewHeader() {
  return (
    <header className="space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Overview</h1>
          <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Business profile & legal identity</p>
        </div>
      </div>
    </header>
  );
}

export default BusinessOverview;
