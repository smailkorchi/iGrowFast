import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Download,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdfDoc } from '@/lib/documentPdf/embedRemoteImages';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import type { OrderDerivedClient } from '@/lib/devis/types';
import type { FactureSnapshot } from '@/lib/facture/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  business_phone?: string | null;
  business_email?: string | null;
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
          'id, name, logo, ice, rc, identifiant_fiscal, patente, cnss, legal_form, capital_social, legal_address, legal_city, business_phone, business_email, cachet_url, signature_url',
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
          factureNumber = await uniqueFactureNumber(activeBusinessId);
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
          if (insErr) throw insErr;
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

        toast({ title: wasEdit ? 'Facture mise à jour' : 'Facture enregistrée', description: factureNumber });
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : 'Enregistrement impossible.';
        toast({
          title: 'Échec',
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
          toast({ title: 'Pas de fichier', description: 'PDF non généré pour cette facture.' });
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
        toast({ title: 'Téléchargement impossible', variant: 'destructive' });
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
      toast({ title: 'Facture supprimée' });
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
      <div className="space-y-8 pb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
          <div className="relative p-8">
            <h1 className="text-3xl font-extralight tracking-tight">Facture</h1>
            <p className="text-gray-500 text-sm mt-2">Sélectionnez une entreprise active pour accéder aux factures.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Tools</p>
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">Facture</h1>
            <p className="text-gray-500 font-light text-sm max-w-lg">
              Factures PDF, TVA optionnelle, échéance et conditions de paiement, historique par entreprise.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-2xl gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Nouvelle facture
            </Button>
            <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
              <Receipt className="w-7 h-7 text-primary/80" />
            </div>
          </div>
        </div>
      </div>

      {/* Inline PDF removed — preview modal opens directly after generation */}

      {listLoading ? (
        <Card className="border-0 shadow-sm rounded-3xl">
          <CardContent className="p-16 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
          </CardContent>
        </Card>
      ) : emptyState ? (
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 sm:p-16 min-h-[280px] flex flex-col items-center justify-center text-center gap-4">
            <Receipt className="w-12 h-12 text-gray-200" />
            <p className="text-sm text-gray-500 font-light max-w-md">
              Aucune facture enregistrée. Assistant en 5 étapes, PDF A4, totaux HT / TVA / TTC.
            </p>
            <Button className="rounded-2xl" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Nouvelle facture
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {factureList.map((row) => (
            <Card
              key={row.id}
              className="border-0 shadow-sm rounded-3xl cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => void openPreview(row)}
            >
              <CardContent className="p-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-light tracking-tight">{row.facture_number}</p>
                    <p className="text-xs text-gray-400">
                      {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                    </p>
                  </div>
                  {row.tva_rate > 0 ? (
                    <Badge variant="secondary" className="rounded-lg text-[10px]">
                      TVA {row.tva_rate}%
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-lg text-[10px]">
                      HT
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600 line-clamp-1">{clientLabel(row)}</p>
                <p className="text-xl font-light">{Number(row.total_ttc).toFixed(2)} MAD</p>
                <div className="flex flex-wrap gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="secondary" className="rounded-xl gap-1" onClick={() => void openPreview(row)}>
                    <Eye className="w-3.5 h-3.5" />
                    Aperçu
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl gap-1" onClick={() => openEdit(row)}>
                    <Pencil className="w-3.5 h-3.5" />
                    Modifier
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl gap-1" onClick={() => void handleDownload(row)}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-xl text-red-600 hover:text-red-700"
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
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
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-3xl">
          <DialogHeader className="p-4 border-b shrink-0">
            <DialogTitle className="font-light text-lg">
              {previewRow?.facture_number || 'Aperçu de la facture'}
              {previewRow ? (
                <span className="text-sm font-normal text-gray-400 ml-2">{clientLabel(previewRow)}</span>
              ) : null}
            </DialogTitle>
            <div className="flex gap-2 pt-2">
              {previewRow ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => void handleDownload(previewRow)}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Télécharger
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-xl"
                    onClick={() => {
                      if (!previewRow) return;
                      setPreviewOpen(false);
                      openEdit(previewRow);
                    }}
                  >
                    <Pencil className="w-4 h-4 mr-2" />
                    Modifier
                  </Button>
                </>
              ) : inlinePdfUrl ? (
                <Button size="sm" variant="outline" className="rounded-xl" asChild>
                  <a href={inlinePdfUrl} download="facture.pdf">
                    <Download className="w-4 h-4 mr-2" />
                    Télécharger
                  </a>
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-gray-100 relative">
            {previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
              </div>
            ) : previewUrl ? (
              <iframe title="Aperçu facture" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
            ) : (
              <p className="p-8 text-sm text-gray-500">Aucun PDF.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette facture ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le fichier PDF et l&apos;entrée seront supprimés définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-red-600 hover:bg-red-700"
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
