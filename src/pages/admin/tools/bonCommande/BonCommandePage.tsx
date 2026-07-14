import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Calendar,
  CircleDollarSign,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdf } from '@/lib/bonCommande/embedImagesForPdf';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import type { BonCommandeSnapshot } from '@/lib/bonCommande/types';
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
import { BonCommandePdfDocument } from './BonCommandePdfDocument';
import { BonCommandeWizard } from './BonCommandeWizard';

type BonCommandeRow = {
  id: string;
  business_id: string;
  bc_number: string;
  direction: string;
  issued_at: string;
  subtotal_ht: number;
  tva_rate: number;
  tva_amount: number;
  total_ttc: number;
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

type DirectionFilter = 'all' | 'purchase' | 'sales';

type RegisterTotals = {
  totalCount: number;
  purchaseCount: number;
  salesCount: number;
  totalTTC: number;
  thisMonth: number;
};

const EMPTY_TOTALS: RegisterTotals = {
  totalCount: 0,
  purchaseCount: 0,
  salesCount: 0,
  totalTTC: 0,
  thisMonth: 0,
};

async function uniqueBcNumber(businessId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = `BC-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data } = await supabase
      .from('bons_commande')
      .select('id')
      .eq('business_id', businessId)
      .eq('bc_number', n)
      .maybeSingle();
    if (!data) return n;
  }
  throw new Error('NUM_FAIL');
}

function parseSnapshot(json: unknown): BonCommandeSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  return json as BonCommandeSnapshot;
}

export default function BonCommandePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState<BonCommandeSnapshot | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<BonCommandeRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [inlinePdfUrl, setInlinePdfUrl] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<BonCommandeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: business } = useQuery({
    queryKey: ['bc-business', activeBusinessId],
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
    queryKey: ['bc-products', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, selling_price, cost_price')
        .eq('DigiCom Business', activeBusinessId!)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string; selling_price: number; cost_price: number }[];
    },
  });

  const { data: orderClients = [] } = useQuery({
    queryKey: ['bc-order-clients', activeBusinessId],
    enabled: !!activeBusinessId && wizardOpen,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('distinct_clients', {
        p_business: activeBusinessId!,
      });
      if (error) throw error;
      return ((data ?? []) as OrderDerivedClient[]);
    },
  });

  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ['bc-list', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const rows = await fetchAllRows<BonCommandeRow>('bons_commande', '*', {
        filters: [{ column: 'business_id', op: 'eq', value: activeBusinessId! }],
      });
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });

  const { data: kpis = EMPTY_TOTALS } = useQuery({
    queryKey: ['bc-totals', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('register_totals', {
        p_business: activeBusinessId!,
        p_register: 'bons_commande',
      });
      if (error) throw error;
      const t = (data ?? {}) as Record<string, number>;
      return {
        totalCount: Number(t.count || 0),
        purchaseCount: Number(t.purchase_count || 0),
        salesCount: Number(t.sales_count || 0),
        totalTTC: Number(t.total_ttc || 0),
        thisMonth: Number(t.this_month || 0),
      } satisfies RegisterTotals;
    },
  });

  const openCreate = useCallback(() => {
    setEditingId(null);
    setInitialSnapshot(null);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);

  const openEdit = useCallback(
    (row: BonCommandeRow) => {
      const snap = parseSnapshot(row.snapshot_json);
      if (!snap || !snap.direction) {
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

  const resolvePreviewUrl = useCallback(async (row: BonCommandeRow) => {
    if (!row.pdf_storage_path) return null;
    const { data, error } = await supabase.storage
      .from('business-documents')
      .createSignedUrl(row.pdf_storage_path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  const openPreview = useCallback(
    async (row: BonCommandeRow) => {
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

  useEffect(() => {
    return () => {
      if (inlinePdfUrl) URL.revokeObjectURL(inlinePdfUrl);
    };
  }, [inlinePdfUrl]);

  const persist = useCallback(
    async (snapshot: BonCommandeSnapshot) => {
      if (!activeBusinessId) return;
      setIsSubmitting(true);
      const wasEdit = !!editingId;
      try {
        const user = (await supabase.auth.getUser()).data.user;
        let rowId: string;
        let bcNumber: string;
        let issuedAtIso: string;
        const direction = snapshot.direction;

        if (editingId) {
          rowId = editingId;
          const { data: existing, error: exErr } = await supabase
            .from('bons_commande')
            .select('bc_number, issued_at')
            .eq('id', editingId)
            .single();
          if (exErr) throw exErr;
          bcNumber = existing!.bc_number;
          issuedAtIso = existing!.issued_at;
          const enriched: BonCommandeSnapshot = {
            ...snapshot,
            bc_number: bcNumber,
            issued_at_iso: issuedAtIso,
          };
          const { error: upErr } = await supabase
            .from('bons_commande')
            .update({
              subtotal_ht: snapshot.subtotal_ht,
              tva_rate: snapshot.tva_rate,
              tva_amount: snapshot.tva_amount,
              total_ttc: snapshot.total_ttc,
              snapshot_json: enriched as unknown as Json,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingId);
          if (upErr) throw upErr;
        } else {
          const customNumber = snapshot.bc_number?.trim();
          bcNumber = customNumber || (await uniqueBcNumber(activeBusinessId));
          issuedAtIso = new Date().toISOString();
          const enriched: BonCommandeSnapshot = {
            ...snapshot,
            bc_number: bcNumber,
            issued_at_iso: issuedAtIso,
          };
          const { data: inserted, error: insErr } = await supabase
            .from('bons_commande')
            .insert({
              business_id: activeBusinessId,
              bc_number: bcNumber,
              direction,
              issued_at: issuedAtIso,
              subtotal_ht: snapshot.subtotal_ht,
              tva_rate: snapshot.tva_rate,
              tva_amount: snapshot.tva_amount,
              total_ttc: snapshot.total_ttc,
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

        const snapForPdf: BonCommandeSnapshot = {
          ...snapshot,
          bc_number: bcNumber,
          issued_at_iso: issuedAtIso,
        };

        const snapWithImages = await embedRemoteImagesForPdf(snapForPdf);

        await registerPdfFonts();
        const blob = await pdf(
          <BonCommandePdfDocument snapshot={snapWithImages} bcNumber={bcNumber} issuedAtIso={issuedAtIso} />,
        ).toBlob();

        if (!blob || blob.size < 100) {
          throw new Error('PDF vide ou invalide (images / rendu).');
        }

        const path = `${activeBusinessId}/bons-commande/${rowId}.pdf`;
        const { error: upStorageErr } = await supabase.storage
          .from('business-documents')
          .upload(path, blob, {
            upsert: true,
            contentType: 'application/pdf',
            cacheControl: '3600',
          });
        if (upStorageErr) throw upStorageErr;

        const { error: pathErr } = await supabase
          .from('bons_commande')
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

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['bc-list', activeBusinessId] }),
          queryClient.invalidateQueries({ queryKey: ['bc-totals', activeBusinessId] }),
        ]);

        toast({ title: wasEdit ? 'Document mis a jour' : 'Document enregistre', description: bcNumber });
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
    async (row: BonCommandeRow) => {
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
        a.download = `${row.bc_number}.pdf`;
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
      const { error } = await supabase.from('bons_commande').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Supprime' });
      setDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bc-list', activeBusinessId] }),
        queryClient.invalidateQueries({ queryKey: ['bc-totals', activeBusinessId] }),
      ]);
    } catch (e) {
      console.error(e);
      toast({ title: 'Suppression impossible', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, activeBusinessId, queryClient, toast]);

  const counterpartLabel = useCallback((row: BonCommandeRow) => {
    const s = parseSnapshot(row.snapshot_json);
    if (!s) return '—';
    if (s.direction === 'purchase') return s.supplier?.name || '—';
    return s.client?.name || '—';
  }, []);

  const filteredList = useMemo(() => {
    if (directionFilter === 'all') return list;
    return list.filter(r => r.direction === directionFilter);
  }, [list, directionFilter]);

  const emptyState = useMemo(
    () => !listLoading && filteredList.length === 0,
    [listLoading, filteredList.length],
  );

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
              Bons de commande
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Sélectionnez une entreprise active pour générer vos bons.
            </p>
          </header>
        </div>
      </div>
    );
  }

  const filterPills: { key: DirectionFilter; label: string; count: number }[] = [
    { key: 'all', label: 'Tous', count: kpis.totalCount },
    { key: 'purchase', label: 'Achats', count: kpis.purchaseCount },
    { key: 'sales', label: 'Clients', count: kpis.salesCount },
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
              Bons de commande
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Achats auprès des fournisseurs, confirmations aux clients — un registre unique, deux flux tracés.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Nouveau bon
          </button>
        </header>

        {/* KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                Total documents
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                <FileText className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.totalCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">bons</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Achats
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                <ShoppingBag className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.purchaseCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">fournisseurs</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                Clients
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.salesCount}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">confirmations</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                Volume cumulé
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                <CircleDollarSign className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
              {(kpis.totalTTC / 1000).toFixed(1)}K
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD TTC</span>
            </p>
          </div>
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-mid" />
                Ce mois
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-light border-ant-line text-ant-mid flex items-center justify-center">
                <Calendar className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
              {kpis.thisMonth}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">émis</span>
            </p>
          </div>
        </section>

        {/* Filter & list header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="font-display text-ant-orange font-semibold">01</span>
            Registre des bons
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
            {filterPills.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setDirectionFilter(p.key)}
                className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${
                  directionFilter === p.key
                    ? 'bg-ant-ink text-white'
                    : 'text-ant-mid hover:text-ant-ink'
                }`}
              >
                {p.label}
                <span className={`text-[10px] font-normal ${directionFilter === p.key ? 'text-white/60' : 'text-ant-mid/70'}`}>
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
                <ClipboardList className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-[16px] font-semibold text-ant-ink">
                  {directionFilter === 'all'
                    ? 'Aucun bon enregistré'
                    : directionFilter === 'purchase'
                    ? 'Aucun bon d\u2019achat'
                    : 'Aucune confirmation client'}
                </h3>
                <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                  Créez un bon de commande fournisseur ou une confirmation client. Le PDF A4 est généré automatiquement.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors mt-1"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Nouveau bon
              </button>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredList.map((row) => {
              const isPurchase = row.direction === 'purchase';
              const hasVAT = Number(row.tva_rate || 0) > 0;
              const dirTone = isPurchase
                ? { stripe: 'bg-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', dot: 'bg-ant-orange', text: 'text-ant-orange', label: 'Achat', icon: <ShoppingBag className="w-3 h-3" strokeWidth={1.75} /> }
                : { stripe: 'bg-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', dot: 'bg-ant-green', text: 'text-ant-green', label: 'Client', icon: <ShoppingCart className="w-3 h-3" strokeWidth={1.75} /> };
              return (
                <div
                  key={row.id}
                  onClick={() => void openPreview(row)}
                  className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden cursor-pointer hover:border-ant-ink/30 transition-colors"
                >
                  <div className={`h-[3px] w-full ${dirTone.stripe}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                          <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                          {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                        </div>
                        <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums truncate">
                          {row.bc_number}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${dirTone.bg} ${dirTone.border} ${dirTone.text}`}>
                        {dirTone.icon}
                        {dirTone.label}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-ant-line space-y-1">
                      <p className="font-serif italic text-[11px] text-ant-mid truncate">{counterpartLabel(row)}</p>
                      <p className="font-display text-[20px] font-semibold tabular-nums text-ant-ink">
                        {Number(row.total_ttc).toFixed(2)}
                        <span className="text-[11px] text-ant-mid font-normal ml-1.5">MAD</span>
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em]">
                      <span className="text-ant-mid">Fiscalité</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-semibold ${hasVAT ? 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' : 'bg-ant-light border-ant-line text-ant-mid'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${hasVAT ? 'bg-ant-ink' : 'bg-ant-mid'}`} />
                        {hasVAT ? `TVA ${row.tva_rate}%` : 'HT'}
                      </span>
                    </div>

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

        <BonCommandeWizard
          key={wizardKey}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          business={business}
          products={products}
          orderClients={orderClients}
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
                    Aperçu du bon
                    {previewRow ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case ${
                        previewRow.direction === 'purchase'
                          ? 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange'
                          : 'bg-ant-green/10 border-ant-green/25 text-ant-green'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${previewRow.direction === 'purchase' ? 'bg-ant-orange' : 'bg-ant-green'}`} />
                        {previewRow.direction === 'purchase' ? 'Achat' : 'Client'}
                      </span>
                    ) : null}
                  </div>
                  <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight tabular-nums">
                    {previewRow?.bc_number || 'Nouveau bon'}
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
                      download="bon-de-commande.pdf"
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
                <iframe title="Aperçu bon de commande" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
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
                Supprimer ce bon ?
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
