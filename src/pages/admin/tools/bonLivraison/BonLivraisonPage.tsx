import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Download,
  Eye,
  FileText,
  Loader2,
  Package,
  PackageCheck,
  Pencil,
  PenLine,
  Plus,
  ShoppingCart,
  Trash2,
  Truck,
} from 'lucide-react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdf } from '@/lib/bonLivraison/embedImagesForPdf';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import { hydrateBonLivraisonFromAnyNote, hydrateBonLivraisonFromOrder } from '@/lib/bonLivraison/hydrate';
import type { BonLivraisonSnapshot, BonLivraisonSource } from '@/lib/bonLivraison/types';
import type { OrderDerivedClient } from '@/lib/devis/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { BonLivraisonPdfDocument } from './BonLivraisonPdfDocument';
import { BonLivraisonWizard } from './BonLivraisonWizard';

type BonLivraisonRow = {
  id: string;
  business_id: string;
  bl_number: string;
  issued_at: string;
  pdf_storage_path: string | null;
  snapshot_json: Json;
  created_at: string;
};

type BusinessRow = {
  id: string;
  name: string | null;
  logo?: string | null;
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

type SourceFilter = 'all' | BonLivraisonSource;

async function uniqueBlNumber(businessId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = `BL-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data } = await supabase
      .from('bons_livraison')
      .select('id')
      .eq('business_id', businessId)
      .eq('bl_number', n)
      .maybeSingle();
    if (!data) return n;
  }
  throw new Error('NUM_FAIL');
}

function parseSnapshot(json: unknown): BonLivraisonSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  return json as BonLivraisonSnapshot;
}

const SOURCE_META: Record<BonLivraisonSource, {
  label: string;
  short: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
  stripe: string;
  iconBg: string;
  icon: JSX.Element;
}> = {
  manual: {
    label: 'Manuel',
    short: 'Manuel',
    bg: 'bg-ant-ink/6',
    border: 'border-ant-ink/15',
    text: 'text-ant-ink',
    dot: 'bg-ant-ink',
    stripe: 'bg-ant-ink',
    iconBg: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink',
    icon: <PenLine className="w-3 h-3" strokeWidth={1.75} />,
  },
  order: {
    label: 'Commande',
    short: 'Commande',
    bg: 'bg-ant-green/10',
    border: 'border-ant-green/25',
    text: 'text-ant-green',
    dot: 'bg-ant-green',
    stripe: 'bg-ant-green',
    iconBg: 'bg-ant-green/10 border-ant-green/25 text-ant-green',
    icon: <ShoppingCart className="w-3 h-3" strokeWidth={1.75} />,
  },
  company_delivery_note: {
    label: 'Note transporteur',
    short: 'Note soc.',
    bg: 'bg-ant-orange/10',
    border: 'border-ant-orange/25',
    text: 'text-ant-orange',
    dot: 'bg-ant-orange',
    stripe: 'bg-ant-orange',
    iconBg: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange',
    icon: <Truck className="w-3 h-3" strokeWidth={1.75} />,
  },
};

export default function BonLivraisonPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState<BonLivraisonSnapshot | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<BonLivraisonRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [inlinePdfUrl, setInlinePdfUrl] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<BonLivraisonRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: business } = useQuery({
    queryKey: ['bl-business', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select(
          'id, name, logo, ice, rc, identifiant_fiscal, patente, cnss, legal_form, capital_social, legal_address, legal_city, postal_code, business_phone, business_email, website, cachet_url, signature_url',
        )
        .eq('id', activeBusinessId!)
        .single();
      if (error) throw error;
      return data as BusinessRow;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['bl-products', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, selling_price')
        .eq('DigiCom Business', activeBusinessId!)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string; selling_price: number }[];
    },
  });

  const { data: orderClients = [] } = useQuery({
    queryKey: ['bl-order-clients', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const orders = await fetchAllRows('orders', 'name, phone, address, city:master_cities(name)', {
        filters: [
          { column: 'DigiCom Business', op: 'eq', value: activeBusinessId! },
          { column: 'date_deleted', op: 'is', value: null },
          { column: 'source_review_status', op: 'neq', value: 'pending' },
        ],
      });
      const map = new Map<string, OrderDerivedClient>();
      orders.forEach((o: Record<string, unknown>) => {
        const raw = String(o.phone || '');
        const phone = raw.replace(/[^0-9]/g, '');
        if (!phone) return;
        const cityObj = o.city as { name?: string } | null;
        const cityName = cityObj?.name || '';
        const existing = map.get(phone);
        const name = String(o.name || existing?.name || 'Client');
        const address = String(o.address || existing?.address || '');
        map.set(phone, {
          phone,
          name,
          address,
          city: cityName || existing?.city || '',
        });
      });
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const { data: ordersForPicker = [] } = useQuery({
    queryKey: ['bl-orders-pick', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, name, phone, created_at')
        .eq('DigiCom Business', activeBusinessId!)
        .is('date_deleted', null).neq('source_review_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data || []).map((o: Record<string, unknown>) => {
        const created = o.created_at ? format(parseISO(String(o.created_at)), 'dd/MM/yy') : '';
        return {
          id: String(o.id),
          label: `${o.name || 'Commande'} - ${o.phone || '-'}${created ? ` (${created})` : ''}`,
        };
      });
    },
  });

  const { data: notesForPicker = [] } = useQuery({
    queryKey: ['bl-notes-pick', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const [companyRes, courierRes] = await Promise.all([
        supabase
          .from('company_delivery_notes')
          .select('id, reference, created_at, provider:providers(name)')
          .eq('DigiCom Business', activeBusinessId!)
          .order('created_at', { ascending: false })
          .limit(300),
        (supabase as any)
          .from('courier_delivery_notes')
          .select('id, reference, created_at, courier:users!courier_delivery_notes_courier_id_fkey(name)')
          .eq('DigiCom Business', activeBusinessId!)
          .order('created_at', { ascending: false })
          .limit(300),
      ]);
      if (companyRes.error) throw companyRes.error;
      if (courierRes.error) throw courierRes.error;

      const companyNotes = (companyRes.data || []).map((n: Record<string, unknown>) => {
        const p = n.provider as { name?: string } | null;
        const ref = n.reference ? String(n.reference) : String(n.id).slice(0, 8);
        const created = n.created_at ? format(parseISO(String(n.created_at)), 'dd/MM/yy') : '';
        return {
          id: String(n.id),
          label: `${ref}${p?.name ? ` - ${p.name}` : ''}${created ? ` (${created})` : ''}`,
        };
      });

      const courierNotes = (courierRes.data || []).map((n: Record<string, unknown>) => {
        const c = n.courier as { name?: string } | null;
        const ref = n.reference ? String(n.reference) : String(n.id).slice(0, 8);
        const created = n.created_at ? format(parseISO(String(n.created_at)), 'dd/MM/yy') : '';
        return {
          id: String(n.id),
          label: `${ref}${c?.name ? ` - ${c.name}` : ''}${created ? ` (${created})` : ''}`,
        };
      });

      return [...companyNotes, ...courierNotes].sort((a, b) =>
        a.label.localeCompare(b.label)
      );
    },
  });

  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ['bl-list', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bons_livraison')
        .select('*')
        .eq('business_id', activeBusinessId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BonLivraisonRow[];
    },
  });

  const hydrateOrder = useCallback(
    async (orderId: string) => {
      if (!activeBusinessId) return null;
      return hydrateBonLivraisonFromOrder(supabase, activeBusinessId, orderId);
    },
    [activeBusinessId],
  );

  const hydrateCompanyNote = useCallback(
    async (noteId: string) => {
      if (!activeBusinessId) return null;
      return hydrateBonLivraisonFromAnyNote(supabase, activeBusinessId, noteId);
    },
    [activeBusinessId],
  );

  const openCreate = useCallback(() => {
    setEditingId(null);
    setInitialSnapshot(null);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);

  const openEdit = useCallback(
    (row: BonLivraisonRow) => {
      const snap = parseSnapshot(row.snapshot_json);
      if (!snap?.source) {
        toast({ title: 'Erreur', description: 'Snapshot invalide.', variant: 'destructive' });
        return;
      }
      setEditingId(row.id);
      setInitialSnapshot(snap);
      setWizardKey((k) => k + 1);
      setWizardOpen(true);
    },
    [toast],
  );

  const resolvePreviewUrl = useCallback(async (row: BonLivraisonRow) => {
    if (!row.pdf_storage_path) return null;
    const { data, error } = await supabase.storage
      .from('business-documents')
      .createSignedUrl(row.pdf_storage_path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  const openPreview = useCallback(
    async (row: BonLivraisonRow) => {
      setPreviewRow(row);
      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewUrl(null);
      try {
        const url = await resolvePreviewUrl(row);
        setPreviewUrl(url);
      } catch (e) {
        console.error(e);
        toast({
          title: 'Aperçu indisponible',
          description: 'Impossible de charger le PDF.',
          variant: 'destructive',
        });
      } finally {
        setPreviewLoading(false);
      }
    },
    [resolvePreviewUrl, toast],
  );

  const persist = useCallback(
    async (snapshot: BonLivraisonSnapshot) => {
      if (!activeBusinessId) return;
      setIsSubmitting(true);
      const wasEdit = !!editingId;
      try {
        const user = (await supabase.auth.getUser()).data.user;
        let rowId: string;
        let blNumber: string;
        let issuedAtIso: string;

        if (editingId) {
          rowId = editingId;
          const { data: existing, error: exErr } = await supabase
            .from('bons_livraison')
            .select('bl_number, issued_at')
            .eq('id', editingId)
            .single();
          if (exErr) throw exErr;
          blNumber = existing!.bl_number;
          issuedAtIso = existing!.issued_at;
          const enriched: BonLivraisonSnapshot = {
            ...snapshot,
            bl_number: blNumber,
            issued_at_iso: issuedAtIso,
          };
          const { error: upErr } = await supabase
            .from('bons_livraison')
            .update({
              snapshot_json: enriched as unknown as Json,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingId);
          if (upErr) throw upErr;
        } else {
          const customNumber = snapshot.bl_number?.trim();
          blNumber = customNumber || (await uniqueBlNumber(activeBusinessId));
          issuedAtIso = new Date().toISOString();
          const enriched: BonLivraisonSnapshot = {
            ...snapshot,
            bl_number: blNumber,
            issued_at_iso: issuedAtIso,
          };
          const { data: inserted, error: insErr } = await supabase
            .from('bons_livraison')
            .insert({
              business_id: activeBusinessId,
              bl_number: blNumber,
              issued_at: issuedAtIso,
              status: 'issued',
              snapshot_json: enriched as unknown as Json,
              created_by: user?.id ?? null,
            })
            .select('id')
            .single();
          if (insErr) {
            if (customNumber && (insErr.code === '23505' || /duplicate|unique/i.test(insErr.message))) {
              throw new Error(`Le numero << ${customNumber} >> existe deja pour ce business.`);
            }
            throw insErr;
          }
          rowId = inserted!.id;
        }

        const snapForPdf: BonLivraisonSnapshot = {
          ...snapshot,
          bl_number: blNumber,
          issued_at_iso: issuedAtIso,
        };

        const snapWithImages = await embedRemoteImagesForPdf(snapForPdf);

        await registerPdfFonts();
        const blob = await pdf(
          <BonLivraisonPdfDocument snapshot={snapWithImages} blNumber={blNumber} issuedAtIso={issuedAtIso} />,
        ).toBlob();

        if (!blob || blob.size < 100) {
          throw new Error('PDF vide ou invalide (images / rendu).');
        }

        const path = `${activeBusinessId}/bons-livraison/${rowId}.pdf`;
        const { error: upStorageErr } = await supabase.storage
          .from('business-documents')
          .upload(path, blob, {
            upsert: true,
            contentType: 'application/pdf',
            cacheControl: '3600',
          });
        if (upStorageErr) throw upStorageErr;

        const { error: pathErr } = await supabase
          .from('bons_livraison')
          .update({ pdf_storage_path: path, updated_at: new Date().toISOString() })
          .eq('id', rowId);
        if (pathErr) throw pathErr;

        const blobUrl = URL.createObjectURL(blob);
        setInlinePdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return blobUrl; });

        setWizardOpen(false);
        setEditingId(null);
        setInitialSnapshot(null);

        setPreviewUrl(blobUrl);
        setPreviewRow(null);
        setPreviewLoading(false);
        setPreviewOpen(true);

        await queryClient.invalidateQueries({ queryKey: ['bl-list', activeBusinessId] });

        toast({ title: wasEdit ? 'Mis a jour' : 'Enregistre', description: blNumber });
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : 'Enregistrement impossible.';
        toast({
          title: 'Echec',
          description: msg,
          variant: 'destructive',
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeBusinessId, editingId, queryClient, toast],
  );

  const handleDownload = useCallback(
    async (row: BonLivraisonRow) => {
      try {
        const url = await resolvePreviewUrl(row);
        if (!url) {
          toast({ title: 'Pas de fichier', description: 'PDF non genere.' });
          return;
        }
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${row.bl_number}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.error(e);
        toast({ title: 'Telechargement impossible', variant: 'destructive' });
      }
    },
    [resolvePreviewUrl, toast],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || !activeBusinessId) return;
    setDeleting(true);
    try {
      if (deleteTarget.pdf_storage_path) {
        await supabase.storage.from('business-documents').remove([deleteTarget.pdf_storage_path]);
      }
      const { error } = await supabase.from('bons_livraison').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Supprime' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['bl-list', activeBusinessId] });
    } catch (e) {
      console.error(e);
      toast({ title: 'Suppression impossible', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, activeBusinessId, queryClient, toast]);

  const counterpartLabel = useCallback((row: BonLivraisonRow) => {
    const s = parseSnapshot(row.snapshot_json);
    return s?.client?.name || '—';
  }, []);

  const filteredList = useMemo(() => {
    if (sourceFilter === 'all') return list;
    return list.filter(r => {
      const s = parseSnapshot(r.snapshot_json);
      return s?.source === sourceFilter;
    });
  }, [list, sourceFilter]);

  const emptyState = useMemo(
    () => !listLoading && filteredList.length === 0,
    [listLoading, filteredList.length],
  );

  const kpis = useMemo(() => {
    const totalCount = list.length;
    let manualCount = 0;
    let orderCount = 0;
    let noteCount = 0;
    let parcelCount = 0;
    list.forEach(r => {
      const s = parseSnapshot(r.snapshot_json);
      if (!s) return;
      if (s.source === 'manual') manualCount++;
      else if (s.source === 'order') orderCount++;
      else if (s.source === 'company_delivery_note') noteCount++;
      parcelCount += Array.isArray(s.parcels) ? s.parcels.length : 0;
    });
    const now = new Date();
    const thisMonth = list.filter(r => {
      try {
        const d = parseISO(r.issued_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      } catch {
        return false;
      }
    }).length;
    return { totalCount, manualCount, orderCount, noteCount, parcelCount, thisMonth };
  }, [list]);

  useEffect(() => {
    return () => {
      if (inlinePdfUrl) URL.revokeObjectURL(inlinePdfUrl);
    };
  }, [inlinePdfUrl]);

  if (!activeBusinessId) {
    return (
      <div className="ant-surface min-h-screen">
        <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
          <header className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
              <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
              Outils · Documents
            </div>
            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
              Bons de livraison
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Sélectionnez une entreprise active pour générer vos bons de livraison.
            </p>
          </header>
        </div>
      </div>
    );
  }

  const filterPills: { key: SourceFilter; label: string; count: number }[] = [
    { key: 'all', label: 'Tous', count: kpis.totalCount },
    { key: 'manual', label: 'Manuels', count: kpis.manualCount },
    { key: 'order', label: 'Commandes', count: kpis.orderCount },
    { key: 'company_delivery_note', label: 'Notes', count: kpis.noteCount },
  ];

  return (
    <div className="ant-surface min-h-screen">
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
        {/* Editorial header */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
              <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
              Outils · Documents PDF
            </div>
            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
              Bons de livraison
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Colis chargés, BL signés. Trois sources, un registre unique — saisie manuelle, import commande, ou reprise d&apos;une note transporteur.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Nouveau BL
          </button>
        </header>

        {/* KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                Bons émis
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                <FileText className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.totalCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">documents</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                Manuels
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                <PenLine className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.manualCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">saisis</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                Commandes
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.orderCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">importées</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Notes
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                <Truck className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.noteCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">transporteur</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                Colis tracés
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-light border-ant-line text-ant-mid flex items-center justify-center">
                <Package className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.parcelCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">suivis</span>
            </p>
          </div>
        </section>

        {/* Filter & list header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="font-display text-ant-orange font-semibold">01</span>
            Registre des BL
            <span className="font-serif italic tracking-normal normal-case text-[11px] text-ant-mid">
              · {kpis.thisMonth} ce mois
            </span>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
            {filterPills.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setSourceFilter(p.key)}
                className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[11px] font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                  sourceFilter === p.key
                    ? 'bg-ant-ink text-white'
                    : 'text-ant-mid hover:text-ant-ink'
                }`}
              >
                {p.label}
                <span className={`text-[10px] font-normal ${sourceFilter === p.key ? 'text-white/60' : 'text-ant-mid/70'}`}>
                  {p.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {listLoading ? (
          <section className="rounded-2xl border border-ant-line bg-ant-paper p-12 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-ant-mid" strokeWidth={1.5} />
            <p className="font-serif italic text-[12px] text-ant-mid">Chargement des bons…</p>
          </section>
        ) : emptyState ? (
          <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                <PackageCheck className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-[16px] font-semibold text-ant-ink">
                  {sourceFilter === 'all'
                    ? 'Aucun bon de livraison enregistré'
                    : 'Aucun bon pour ce filtre'}
                </h3>
                <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                  Créez un premier BL — données manuelles, import depuis une commande, ou reprise d&apos;une note transporteur.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors mt-1"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Nouveau BL
              </button>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredList.map((row) => {
              const snap = parseSnapshot(row.snapshot_json);
              const src = snap?.source ?? 'manual';
              const meta = SOURCE_META[src];
              const itemCount = snap?.lines?.items?.length || 0;
              const parcelCount = snap?.parcels?.length || 0;
              const transportName = snap?.transport?.provider_name;
              const deliveryDate = snap?.delivery_date;
              return (
                <div
                  key={row.id}
                  onClick={() => void openPreview(row)}
                  className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden cursor-pointer hover:border-ant-ink/30 transition-colors"
                >
                  <div className={`h-[3px] w-full ${meta.stripe}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                          <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                          {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                        </div>
                        <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums truncate">
                          {row.bl_number}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${meta.bg} ${meta.border} ${meta.text}`}>
                        {meta.icon}
                        {meta.short}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-ant-line space-y-1">
                      <p className="font-serif italic text-[11px] text-ant-mid truncate">
                        {counterpartLabel(row)}
                      </p>
                      {deliveryDate ? (
                        <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em]">
                          <span className="text-ant-mid">Livraison</span>
                          <span className="font-semibold tabular-nums text-ant-ink">
                            {format(parseISO(deliveryDate), 'd MMM yyyy', { locale: fr })}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                      <div className="bg-ant-paper px-3 py-2">
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid">
                          <Package className="w-2.5 h-2.5" strokeWidth={2} />
                          Lignes
                        </div>
                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink mt-0.5">{itemCount}</p>
                      </div>
                      <div className="bg-ant-paper px-3 py-2">
                        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ant-mid">
                          <Truck className="w-2.5 h-2.5" strokeWidth={2} />
                          Colis
                        </div>
                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink mt-0.5">{parcelCount}</p>
                      </div>
                    </div>

                    {transportName ? (
                      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em]">
                        <span className="text-ant-mid">Transporteur</span>
                        <span className="font-semibold text-ant-orange truncate max-w-[60%]">{transportName}</span>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-1 pt-2 border-t border-ant-line" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => void openPreview(row)}
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                      >
                        <Eye className="w-3 h-3" strokeWidth={1.75} />
                        Aperçu
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        aria-label="Modifier"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors"
                      >
                        <Pencil className="w-3 h-3" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownload(row)}
                        aria-label="Télécharger"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors"
                      >
                        <Download className="w-3 h-3" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        aria-label="Supprimer"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-rose/10 hover:border-ant-rose/25 text-ant-rose cursor-pointer transition-colors ml-auto"
                      >
                        <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <BonLivraisonWizard
          key={wizardKey}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          business={business}
          products={products}
          orderClients={orderClients}
          ordersForPicker={ordersForPicker}
          notesForPicker={notesForPicker}
          hydrateOrder={hydrateOrder}
          hydrateCompanyNote={hydrateCompanyNote}
          initialSnapshot={initialSnapshot}
          isSubmitting={isSubmitting}
          onSubmit={(s) => persist(s)}
        />

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <DialogHeader className="px-5 py-3.5 border-b border-ant-line shrink-0 bg-ant-paper">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                    Aperçu du BL
                    {previewRow ? (() => {
                      const snap = parseSnapshot(previewRow.snapshot_json);
                      const src = snap?.source ?? 'manual';
                      const meta = SOURCE_META[src];
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case ${meta.bg} ${meta.border} ${meta.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      );
                    })() : null}
                  </div>
                  <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight tabular-nums">
                    {previewRow?.bl_number || 'Nouveau BL'}
                  </DialogTitle>
                  {previewRow ? (
                    <p className="font-serif italic text-[12px] text-ant-mid">{counterpartLabel(previewRow)}</p>
                  ) : null}
                </div>
                <div className="flex gap-1.5">
                  {previewRow ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleDownload(previewRow)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                      >
                        <Download className="w-3 h-3" strokeWidth={1.75} />
                        Télécharger
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!previewRow) return;
                          setPreviewOpen(false);
                          openEdit(previewRow);
                        }}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[11px] font-semibold cursor-pointer transition-colors"
                      >
                        <Pencil className="w-3 h-3" strokeWidth={1.75} />
                        Modifier
                      </button>
                    </>
                  ) : inlinePdfUrl ? (
                    <a
                      href={inlinePdfUrl}
                      download="bon-livraison.pdf"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[11px] font-semibold text-ant-ink cursor-pointer transition-colors"
                    >
                      <Download className="w-3 h-3" strokeWidth={1.75} />
                      Télécharger
                    </a>
                  ) : null}
                </div>
              </div>
            </DialogHeader>
            <div className="flex-1 min-h-0 bg-ant-light relative">
              {previewLoading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-ant-mid" strokeWidth={1.5} />
                </div>
              ) : previewUrl ? (
                <iframe title="Aperçu BL" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
              ) : (
                <p className="p-8 font-serif italic text-[12px] text-ant-mid">Aucun PDF disponible.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent className="rounded-2xl border border-ant-line bg-ant-paper">
            <AlertDialogHeader>
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                Suppression définitive
              </div>
              <AlertDialogTitle className="font-display text-[18px] font-semibold text-ant-ink">
                Supprimer ce bon de livraison ?
              </AlertDialogTitle>
              <AlertDialogDescription className="font-serif italic text-[12px] text-ant-mid">
                Le fichier PDF et l&apos;entrée seront supprimés définitivement. L&apos;action est irréversible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink">
                Annuler
              </AlertDialogCancel>
              <AlertDialogAction
                className="h-9 rounded-full bg-ant-rose hover:bg-ant-rose/90 text-white text-[12px] font-semibold"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} /> : 'Supprimer'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
