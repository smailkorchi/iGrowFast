import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { pdf } from '@react-pdf/renderer';
import {
  Download,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdf } from '@/lib/bonCommande/embedImagesForPdf';
import { registerPdfFonts } from '@/lib/documentPdf/registerFonts';
import type { BonCommandeSnapshot } from '@/lib/bonCommande/types';
import type { OrderDerivedClient } from '@/lib/devis/types';
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
import { BonCommandePdfDocument } from './BonCommandePdfDocument';
import { BonCommandeWizard } from './BonCommandeWizard';
import { Badge } from '@/components/ui/badge';

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
  business_phone?: string | null;
  business_email?: string | null;
  cachet_url?: string | null;
  signature_url?: string | null;
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
          'id, name, logo, ice, rc, identifiant_fiscal, patente, cnss, legal_form, capital_social, legal_address, legal_city, business_phone, business_email, cachet_url, signature_url',
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
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('name, phone, address, city:master_cities(name)')
        .eq('DigiCom Business', activeBusinessId!);
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

  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ['bc-list', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bons_commande')
        .select('*')
        .eq('business_id', activeBusinessId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as BonCommandeRow[];
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
          bcNumber = await uniqueBcNumber(activeBusinessId);
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
          if (insErr) throw insErr;
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

        await queryClient.invalidateQueries({ queryKey: ['bc-list', activeBusinessId] });

        toast({ title: wasEdit ? 'Document mis à jour' : 'Document enregistré', description: bcNumber });
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
    [activeBusinessId, editingId, queryClient, toast],
  );

  const handleDownload = useCallback(
    async (row: BonCommandeRow) => {
      try {
        const url = await resolvePreviewUrl(row);
        if (!url) {
          toast({ title: 'Pas de fichier', description: 'PDF non généré.' });
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
      const { error } = await supabase.from('bons_commande').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Supprimé' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['bc-list', activeBusinessId] });
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

  const emptyState = useMemo(
    () => !listLoading && list.length === 0,
    [listLoading, list.length],
  );

  if (!activeBusinessId) {
    return (
      <div className="space-y-8 pb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
          <div className="relative p-8">
            <h1 className="text-3xl font-extralight tracking-tight">Bon de commande</h1>
            <p className="text-gray-500 text-sm mt-2">Sélectionnez une entreprise active pour accéder aux documents.</p>
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
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">Bon de commande</h1>
            <p className="text-gray-500 font-light text-sm max-w-lg">
              Commande fournisseur ou confirmation client, TVA optionnelle, PDF archivé par entreprise.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-2xl gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Nouveau document
            </Button>
            <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
              <ClipboardList className="w-7 h-7 text-primary/80" />
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
            <ClipboardList className="w-12 h-12 text-gray-200" />
            <p className="text-sm text-gray-500 font-light max-w-md">
              Aucun document. Créez un bon de commande fournisseur ou une confirmation de commande client : assistant en
              étapes, PDF A4, totaux HT / TVA / TTC.
            </p>
            <Button className="rounded-2xl" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Nouveau document
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((row) => (
            <Card
              key={row.id}
              className="border-0 shadow-sm rounded-3xl cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => void openPreview(row)}
            >
              <CardContent className="p-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-light tracking-tight">{row.bc_number}</p>
                    <p className="text-xs text-gray-400">
                      {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="rounded-lg text-[10px]">
                      {row.direction === 'purchase' ? 'Achat' : 'Client'}
                    </Badge>
                    {row.tva_rate > 0 ? (
                      <Badge variant="outline" className="rounded-lg text-[10px]">
                        TVA {row.tva_rate}%
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-lg text-[10px]">
                        HT
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600 line-clamp-1">{counterpartLabel(row)}</p>
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
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-3xl">
          <DialogHeader className="p-4 border-b shrink-0">
            <DialogTitle className="font-light text-lg">
              {previewRow?.bc_number || 'Aperçu du bon de commande'}
              {previewRow ? (
                <span className="text-sm font-normal text-gray-400 ml-2">{counterpartLabel(previewRow)}</span>
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
                  <a href={inlinePdfUrl} download="bon-de-commande.pdf">
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
              <iframe title="Aperçu BC" src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" />
            ) : (
              <p className="p-8 text-sm text-gray-500">Aucun PDF.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
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
