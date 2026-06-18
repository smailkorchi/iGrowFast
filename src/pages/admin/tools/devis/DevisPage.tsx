import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Calendar,
  CircleDollarSign,
  Receipt,
} from 'lucide-react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdf } from '@/lib/devis/embedImagesForPdf';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import type { DevisSnapshot, OrderDerivedClient } from '@/lib/devis/types';
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
import { DevisPdfDocument } from './DevisPdfDocument';
import { DevisWizard } from './DevisWizard';

type DevisRow = {
  id: string;
  business_id: string;
  devis_number: string;
  issued_at: string;
  valid_until: string | null;
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

async function uniqueDevisNumber(businessId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = `DEV-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data } = await supabase
      .from('devis')
      .select('id')
      .eq('business_id', businessId)
      .eq('devis_number', n)
      .maybeSingle();
    if (!data) return n;
  }
  throw new Error('NUM_FAIL');
}

function parseSnapshot(json: unknown): DevisSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  return json as DevisSnapshot;
}

export default function DevisPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState<DevisSnapshot | null>(null);
  const [editingDevisId, setEditingDevisId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<DevisRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [inlinePdfUrl, setInlinePdfUrl] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DevisRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: business } = useQuery({
    queryKey: ['devis-business', activeBusinessId],
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
    queryKey: ['devis-products', activeBusinessId],
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
    queryKey: ['devis-order-clients', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const orders = await fetchAllRows('orders', 'name, phone, address, city:master_cities(name)', {
        filters: [
          { column: 'DigiCom Business', op: 'eq', value: activeBusinessId! },
          { column: 'date_deleted', op: 'is', value: null },
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

  const { data: devisList = [], isLoading: listLoading } = useQuery({
    queryKey: ['devis-list', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devis')
        .select('*')
        .eq('business_id', activeBusinessId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DevisRow[];
    },
  });

  const openCreate = useCallback(() => {
    setEditingDevisId(null);
    setInitialSnapshot(null);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);

  const openEdit = useCallback((row: DevisRow) => {
    const snap = parseSnapshot(row.snapshot_json);
    if (!snap) {
      toast({ title: 'Erreur', description: 'Snapshot de devis invalide.', variant: 'destructive' });
      return;
    }
    setEditingDevisId(row.id);
    setInitialSnapshot(snap);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, [toast]);

  const resolvePreviewUrl = useCallback(async (row: DevisRow) => {
    if (!row.pdf_storage_path) return null;
    const { data, error } = await supabase.storage
      .from('business-documents')
      .createSignedUrl(row.pdf_storage_path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  const openPreview = useCallback(
    async (row: DevisRow) => {
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

  const persistDevis = useCallback(
    async (snapshot: DevisSnapshot) => {
      if (!activeBusinessId) return;
      setIsSubmitting(true);
      const wasEdit = !!editingDevisId;
      try {
        const user = (await supabase.auth.getUser()).data.user;
        let rowId: string;
        let devisNumber: string;
        let issuedAtIso: string;

        if (editingDevisId) {
          rowId = editingDevisId;
          const { data: existing, error: exErr } = await supabase
            .from('devis')
            .select('devis_number, issued_at')
            .eq('id', editingDevisId)
            .single();
          if (exErr) throw exErr;
          devisNumber = existing!.devis_number;
          issuedAtIso = existing!.issued_at;
          const enriched: DevisSnapshot = {
            ...snapshot,
            devis_number: devisNumber,
            issued_at_iso: issuedAtIso,
          };
          const { error: upErr } = await supabase
            .from('devis')
            .update({
              valid_until: snapshot.valid_until,
              subtotal_ht: snapshot.subtotal_ht,
              tva_rate: snapshot.tva_rate,
              tva_amount: snapshot.tva_amount,
              total_ttc: snapshot.total_ttc,
              snapshot_json: enriched as unknown as Json,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingDevisId);
          if (upErr) throw upErr;
        } else {
          const customNumber = snapshot.devis_number?.trim();
          devisNumber = customNumber || (await uniqueDevisNumber(activeBusinessId));
          issuedAtIso = new Date().toISOString();
          const enriched: DevisSnapshot = {
            ...snapshot,
            devis_number: devisNumber,
            issued_at_iso: issuedAtIso,
          };
          const { data: inserted, error: insErr } = await supabase
            .from('devis')
            .insert({
              business_id: activeBusinessId,
              devis_number: devisNumber,
              issued_at: issuedAtIso,
              valid_until: snapshot.valid_until,
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

        const snapForPdf: DevisSnapshot = {
          ...snapshot,
          devis_number: devisNumber,
          issued_at_iso: issuedAtIso,
        };

        const snapWithImages = await embedRemoteImagesForPdf(snapForPdf);

        await registerPdfFonts();
        const blob = await pdf(
          <DevisPdfDocument snapshot={snapWithImages} devisNumber={devisNumber} issuedAtIso={issuedAtIso} />,
        ).toBlob();

        if (!blob || blob.size < 100) {
          throw new Error('PDF vide ou invalide (images / rendu).');
        }

        const path = `${activeBusinessId}/devis/${rowId}.pdf`;
        const { error: upStorageErr } = await supabase.storage
          .from('business-documents')
          .upload(path, blob, {
            upsert: true,
            contentType: 'application/pdf',
            cacheControl: '3600',
          });
        if (upStorageErr) throw upStorageErr;

        const { error: pathErr } = await supabase
          .from('devis')
          .update({ pdf_storage_path: path, updated_at: new Date().toISOString() })
          .eq('id', rowId);
        if (pathErr) throw pathErr;

        const blobUrl = URL.createObjectURL(blob);
        setInlinePdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return blobUrl; });

        setWizardOpen(false);
        setEditingDevisId(null);
        setInitialSnapshot(null);

        setPreviewUrl(blobUrl);
        setPreviewRow(null);
        setPreviewLoading(false);
        setPreviewOpen(true);
        await queryClient.invalidateQueries({ queryKey: ['devis-list', activeBusinessId] });

        toast({ title: wasEdit ? 'Devis mis a jour' : 'Devis enregistre', description: devisNumber });
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
    [activeBusinessId, editingDevisId, queryClient, toast],
  );

  const handleDownload = useCallback(
    async (row: DevisRow) => {
      try {
        const url = await resolvePreviewUrl(row);
        if (!url) {
          toast({ title: 'Pas de fichier', description: 'PDF non genere pour ce devis.' });
          return;
        }
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${row.devis_number}.pdf`;
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
      const { error } = await supabase.from('devis').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Devis supprime' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['devis-list', activeBusinessId] });
    } catch (e) {
      console.error(e);
      toast({ title: 'Suppression impossible', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, activeBusinessId, queryClient, toast]);

  const clientLabel = useCallback((row: DevisRow) => {
    const s = parseSnapshot(row.snapshot_json);
    return s?.client?.name || '—';
  }, []);

  const emptyState = useMemo(
    () => !listLoading && devisList.length === 0,
    [listLoading, devisList.length],
  );

  const kpis = useMemo(() => {
    const totalCount = devisList.length;
    const totalTTC = devisList.reduce((sum, r) => sum + Number(r.total_ttc || 0), 0);
    const withVAT = devisList.filter(r => Number(r.tva_rate || 0) > 0).length;
    const now = new Date();
    const thisMonth = devisList.filter(r => {
      try {
        const d = parseISO(r.issued_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      } catch {
        return false;
      }
    }).length;
    const avgTTC = totalCount > 0 ? totalTTC / totalCount : 0;
    return { totalCount, totalTTC, withVAT, thisMonth, avgTTC };
  }, [devisList]);

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
              Devis
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Sélectionnez une entreprise active pour émettre vos devis.
            </p>
          </header>
        </div>
      </div>
    );
  }

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
              Devis
            </h1>
            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
              Offres chiffrées, prêtes à signer. Un assistant en cinq étapes, un PDF A4 à l&apos;arrivée — sans friction.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Nouveau devis
          </button>
        </header>

        {/* KPI Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
          <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                Devis émis
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
                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                Montant cumulé
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
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
                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                Panier moyen
              </div>
              <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                <Receipt className="w-4 h-4" strokeWidth={1.75} />
              </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
              {kpis.avgTTC.toFixed(0)}
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
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
              <span className="text-[12px] text-ant-mid font-normal ml-1.5">
                {kpis.thisMonth > 1 ? 'devis' : 'devis'}
              </span>
            </p>
          </div>
        </section>

        {/* List */}
        {listLoading ? (
          <section className="rounded-2xl border border-ant-line bg-ant-paper p-12 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-ant-mid" strokeWidth={1.5} />
            <p className="font-serif italic text-[12px] text-ant-mid">Chargement des devis…</p>
          </section>
        ) : emptyState ? (
          <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <div className="h-[3px] w-full bg-ant-orange" />
            <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
              <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-[16px] font-semibold text-ant-ink">Aucun devis enregistré</h3>
                <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                  La page blanche attend son premier chiffre. Assistant en cinq étapes, rendu PDF A4 prêt à envoyer.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors mt-1"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Nouveau devis
              </button>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                <span className="font-display text-ant-orange font-semibold">01</span>
                Registre des devis
              </div>
              <span className="font-serif italic text-[11px] text-ant-mid">
                {devisList.length} {devisList.length > 1 ? 'documents émis' : 'document émis'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {devisList.map((row) => {
                const isExpired = row.valid_until
                  ? differenceInDays(parseISO(row.valid_until), new Date()) < 0
                  : false;
                const hasVAT = Number(row.tva_rate || 0) > 0;
                return (
                  <div
                    key={row.id}
                    onClick={() => void openPreview(row)}
                    className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden cursor-pointer hover:border-ant-ink/30 transition-colors"
                  >
                    <div className="h-[3px] w-full bg-ant-orange group-hover:bg-ant-ink transition-colors" />
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                            {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                          </div>
                          <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums truncate">
                            {row.devis_number}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0 ${hasVAT ? 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' : 'bg-ant-light border-ant-line text-ant-mid'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${hasVAT ? 'bg-ant-ink' : 'bg-ant-mid'}`} />
                          {hasVAT ? `TVA ${row.tva_rate}%` : 'HT'}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-ant-line space-y-1">
                        <p className="font-serif italic text-[11px] text-ant-mid truncate">{clientLabel(row)}</p>
                        <p className="font-display text-[20px] font-semibold tabular-nums text-ant-ink">
                          {Number(row.total_ttc).toFixed(2)}
                          <span className="text-[11px] text-ant-mid font-normal ml-1.5">MAD</span>
                        </p>
                      </div>

                      {row.valid_until ? (
                        <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em]">
                          <span className="text-ant-mid">Valide jusqu&apos;au</span>
                          <span className={`font-semibold tabular-nums ${isExpired ? 'text-ant-rose' : 'text-ant-ink'}`}>
                            {format(parseISO(row.valid_until), 'd MMM yyyy', { locale: fr })}
                            {isExpired && <span className="ml-1.5 font-serif italic lowercase tracking-normal opacity-80">· expiré</span>}
                          </span>
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
          </section>
        )}

        <DevisWizard
          key={wizardKey}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          business={business}
          products={products}
          orderClients={orderClients}
          initialSnapshot={initialSnapshot}
          isSubmitting={isSubmitting}
          onSubmit={(s) => persistDevis(s)}
        />

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
            <DialogHeader className="px-5 py-3.5 border-b border-ant-line shrink-0 bg-ant-paper">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                    Aperçu du devis
                  </div>
                  <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight tabular-nums">
                    {previewRow?.devis_number || 'Nouveau devis'}
                  </DialogTitle>
                  {previewRow ? (
                    <p className="font-serif italic text-[12px] text-ant-mid">{clientLabel(previewRow)}</p>
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
                      download="devis.pdf"
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
                <iframe title="Aperçu devis" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
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
                Supprimer ce devis ?
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
