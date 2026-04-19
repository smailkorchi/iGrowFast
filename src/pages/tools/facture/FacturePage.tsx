import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Download,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdfDoc } from '@/lib/documentPdf/embedRemoteImages';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import type { OrderDerivedClient } from '@/lib/devis/types';
import type { FactureSnapshot } from '@/lib/facture/types';
import { Button } from '@/components/ui/button';
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
import { FacturePdfDocument } from './FacturePdfDocument';
import { FactureWizard } from './FactureWizard';
import { Badge } from '@/components/ui/badge';

type FactureRow = {
  id: string;
  business_id: string;
  facture_number: string;
  issued_at: string;
  due_date: string | null;
  payment_terms: string | null;
  devis_reference: string | null;
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

async function uniqueFactureNumber(businessId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = `FAC-${format(new Date(), 'yyyyMMdd')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { data } = await supabase
      .from('factures')
      .select('id')
      .eq('business_id', businessId)
      .eq('facture_number', n)
      .maybeSingle();
    if (!data) return n;
  }
  throw new Error('NUM_FAIL');
}

function parseSnapshot(json: unknown): FactureSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  return json as FactureSnapshot;
}

export default function FacturePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState<FactureSnapshot | null>(null);
  const [editingFactureId, setEditingFactureId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<FactureRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [inlinePdfUrl, setInlinePdfUrl] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<FactureRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: business } = useQuery({
    queryKey: ['facture-business', activeBusinessId],
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
    queryKey: ['facture-products', activeBusinessId],
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
    queryKey: ['facture-order-clients', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('name, phone, address, city:master_cities(name)')
        .eq('DigiCom Business', activeBusinessId!)
        .is('date_deleted', null);
      if (error) throw error;
      const map = new Map<string, OrderDerivedClient>();
      (orders || []).forEach((o: Record<string, unknown>) => {
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

  const { data: factureList = [], isLoading: listLoading } = useQuery({
    queryKey: ['facture-list', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('factures')
        .select('*')
        .eq('business_id', activeBusinessId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as FactureRow[];
    },
  });

  const openCreate = useCallback(() => {
    setEditingFactureId(null);
    setInitialSnapshot(null);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, []);

  const openEdit = useCallback((row: FactureRow) => {
    const snap = parseSnapshot(row.snapshot_json);
    if (!snap) {
      toast({ title: 'Erreur', description: 'Snapshot de facture invalide.', variant: 'destructive' });
      return;
    }
    setEditingFactureId(row.id);
    setInitialSnapshot(snap);
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }, [toast]);

  const resolvePreviewUrl = useCallback(async (row: FactureRow) => {
    if (!row.pdf_storage_path) return null;
    const { data, error } = await supabase.storage
      .from('business-documents')
      .createSignedUrl(row.pdf_storage_path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  const openPreview = useCallback(
    async (row: FactureRow) => {
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
          title: 'Apercu indisponible',
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

  const persistFacture = useCallback(
    async (snapshot: FactureSnapshot) => {
      if (!activeBusinessId) return;
      setIsSubmitting(true);
      const wasEdit = !!editingFactureId;
      try {
        const user = (await supabase.auth.getUser()).data.user;
        let rowId: string;
        let factureNumber: string;
        let issuedAtIso: string;

        if (editingFactureId) {
          rowId = editingFactureId;
          const { data: existing, error: exErr } = await supabase
            .from('factures')
            .select('facture_number, issued_at')
            .eq('id', editingFactureId)
            .single();
          if (exErr) throw exErr;
          factureNumber = existing!.facture_number;
          issuedAtIso = existing!.issued_at;
          const enriched: FactureSnapshot = {
            ...snapshot,
            facture_number: factureNumber,
            issued_at_iso: issuedAtIso,
          };
          const { error: upErr } = await supabase
            .from('factures')
            .update({
              due_date: snapshot.due_date,
              payment_terms: snapshot.payment_terms,
              devis_reference: snapshot.devis_reference,
              subtotal_ht: snapshot.subtotal_ht,
              tva_rate: snapshot.tva_rate,
              tva_amount: snapshot.tva_amount,
              total_ttc: snapshot.total_ttc,
              snapshot_json: enriched as unknown as Json,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingFactureId);
          if (upErr) throw upErr;
        } else {
          const customNumber = snapshot.facture_number?.trim();
          factureNumber = customNumber || (await uniqueFactureNumber(activeBusinessId));
          issuedAtIso = new Date().toISOString();
          const enriched: FactureSnapshot = {
            ...snapshot,
            facture_number: factureNumber,
            issued_at_iso: issuedAtIso,
          };
          const { data: inserted, error: insErr } = await supabase
            .from('factures')
            .insert({
              business_id: activeBusinessId,
              facture_number: factureNumber,
              issued_at: issuedAtIso,
              due_date: snapshot.due_date,
              payment_terms: snapshot.payment_terms,
              devis_reference: snapshot.devis_reference,
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

        const snapForPdf: FactureSnapshot = {
          ...snapshot,
          facture_number: factureNumber,
          issued_at_iso: issuedAtIso,
        };

        const snapWithImages = await embedRemoteImagesForPdfDoc(snapForPdf);

        await registerPdfFonts();
        const blob = await pdf(
          <FacturePdfDocument
            snapshot={snapWithImages}
            factureNumber={factureNumber}
            issuedAtIso={issuedAtIso}
          />,
        ).toBlob();

        if (!blob || blob.size < 100) {
          throw new Error('PDF vide ou invalide (images / rendu).');
        }

        const path = `${activeBusinessId}/factures/${rowId}.pdf`;
        const { error: upStorageErr } = await supabase.storage
          .from('business-documents')
          .upload(path, blob, {
            upsert: true,
            contentType: 'application/pdf',
            cacheControl: '3600',
          });
        if (upStorageErr) throw upStorageErr;

        const { error: pathErr } = await supabase
          .from('factures')
          .update({ pdf_storage_path: path, updated_at: new Date().toISOString() })
          .eq('id', rowId);
        if (pathErr) throw pathErr;

        const blobUrl = URL.createObjectURL(blob);
        setInlinePdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return blobUrl; });

        setWizardOpen(false);
        setEditingFactureId(null);
        setInitialSnapshot(null);

        setPreviewUrl(blobUrl);
        setPreviewRow(null);
        setPreviewLoading(false);
        setPreviewOpen(true);
        await queryClient.invalidateQueries({ queryKey: ['facture-list', activeBusinessId] });

        toast({ title: wasEdit ? 'Facture mise a jour' : 'Facture enregistree', description: factureNumber });
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
    [activeBusinessId, editingFactureId, queryClient, toast],
  );

  const handleDownload = useCallback(
    async (row: FactureRow) => {
      try {
        const url = await resolvePreviewUrl(row);
        if (!url) {
          toast({ title: 'Pas de fichier', description: 'PDF non genere pour cette facture.' });
          return;
        }
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${row.facture_number}.pdf`;
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
      const { error } = await supabase.from('factures').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Facture supprimee' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['facture-list', activeBusinessId] });
    } catch (e) {
      console.error(e);
      toast({ title: 'Suppression impossible', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, activeBusinessId, queryClient, toast]);

  const clientLabel = useCallback((row: FactureRow) => {
    const s = parseSnapshot(row.snapshot_json);
    return s?.client?.name || '—';
  }, []);

  const emptyState = useMemo(
    () => !listLoading && factureList.length === 0,
    [listLoading, factureList.length],
  );

  if (!activeBusinessId) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <header className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Facture</h1>
              <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Outils · PDF</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">Selectionnez une entreprise active.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
      <header className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Facture</h1>
            <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Outils · PDF</p>
          </div>
          <Button onClick={openCreate} className="h-8 rounded-md text-[11px] font-semibold gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nouvelle facture
          </Button>
        </div>
      </header>

      {listLoading ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 flex flex-col items-center justify-center gap-2.5 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
        </div>
      ) : emptyState ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 flex flex-col items-center justify-center gap-2.5 text-center">
          <Receipt className="w-8 h-8 text-gray-300" />
          <p className="text-[11px] text-gray-500 max-w-sm">Aucune facture enregistree. Assistant en 5 etapes, PDF A4, totaux HT / TVA / TTC.</p>
          <Button onClick={openCreate} className="h-8 rounded-md text-[11px] font-semibold gap-1.5">
            <Plus className="w-3.5 h-3.5" />Nouvelle facture
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {factureList.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-gray-100 bg-white p-3 hover:border-gray-200 transition-colors cursor-pointer"
              onClick={() => void openPreview(row)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-brand-navy tabular-nums">{row.facture_number}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}</p>
                </div>
                <Badge className="h-5 px-1.5 text-[9px] font-semibold rounded-md" variant={row.tva_rate > 0 ? 'secondary' : 'outline'}>
                  {row.tva_rate > 0 ? `TVA ${row.tva_rate}%` : 'HT'}
                </Badge>
              </div>
              <p className="text-[11px] text-gray-600 line-clamp-1 mt-2">{clientLabel(row)}</p>
              <p className="text-[15px] font-semibold tabular-nums text-brand-navy mt-1">
                {Number(row.total_ttc).toFixed(2)} <span className="text-[10px] font-normal text-gray-400">MAD</span>
              </p>
              <div className="flex gap-1 mt-2.5 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-semibold gap-1 rounded-md" onClick={() => void openPreview(row)}>
                  <Eye className="w-3 h-3" />Apercu
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-semibold gap-1 rounded-md" onClick={() => openEdit(row)}>
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-semibold gap-1 rounded-md" onClick={() => void handleDownload(row)}>
                  <Download className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] font-semibold gap-1 rounded-md ml-auto text-red-500 hover:text-red-600" onClick={() => setDeleteTarget(row)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FactureWizard
        key={wizardKey}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        business={business}
        products={products}
        orderClients={orderClients}
        initialSnapshot={initialSnapshot}
        isSubmitting={isSubmitting}
        onSubmit={(s) => persistFacture(s)}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-xl border border-gray-100">
          <DialogHeader className="p-3 border-b border-gray-100 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <DialogTitle className="text-[14px] font-semibold text-brand-navy leading-none">
                  {previewRow?.facture_number || 'Apercu de la facture'}
                </DialogTitle>
                {previewRow ? (
                  <p className="text-[11px] text-gray-400 mt-0.5">{clientLabel(previewRow)}</p>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                {previewRow ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-md text-[11px] font-semibold gap-1"
                      onClick={() => void handleDownload(previewRow)}
                    >
                      <Download className="w-3 h-3" />
                      Telecharger
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 rounded-md text-[11px] font-semibold gap-1"
                      onClick={() => {
                        if (!previewRow) return;
                        setPreviewOpen(false);
                        openEdit(previewRow);
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                      Modifier
                    </Button>
                  </>
                ) : inlinePdfUrl ? (
                  <Button size="sm" variant="outline" className="h-7 rounded-md text-[11px] font-semibold gap-1" asChild>
                    <a href={inlinePdfUrl} download="facture.pdf">
                      <Download className="w-3 h-3" />
                      Telecharger
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-gray-50 relative">
            {previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-gray-300" />
              </div>
            ) : previewUrl ? (
              <iframe title="Apercu facture" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
            ) : (
              <p className="p-8 text-[11px] text-gray-500">Aucun PDF.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-semibold text-brand-navy">Supprimer cette facture ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le fichier PDF et l&apos;entree seront supprimes definitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-md text-[11px] font-semibold">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 rounded-md text-[11px] font-semibold bg-red-600 hover:bg-red-700"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
