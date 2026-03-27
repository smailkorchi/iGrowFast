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
  Trash2,
  Eye,
  PackageCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { embedRemoteImagesForPdf } from '@/lib/bonLivraison/embedImagesForPdf';
import { hydrateBonLivraisonFromCompanyNote, hydrateBonLivraisonFromOrder } from '@/lib/bonLivraison/hydrate';
import type { BonLivraisonSnapshot } from '@/lib/bonLivraison/types';
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
import { BonLivraisonPdfDocument } from './BonLivraisonPdfDocument';
import { BonLivraisonWizard } from './BonLivraisonWizard';
import { Badge } from '@/components/ui/badge';

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
  business_phone?: string | null;
  business_email?: string | null;
  cachet_url?: string | null;
  signature_url?: string | null;
};

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

function sourceLabel(s: BonLivraisonSnapshot['source']) {
  if (s === 'manual') return 'Manuel';
  if (s === 'order') return 'Commande';
  return 'Note soc.';
}

export default function BonLivraisonPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKey, setWizardKey] = useState(0);
  const [initialSnapshot, setInitialSnapshot] = useState<BonLivraisonSnapshot | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          'id, name, logo, ice, rc, identifiant_fiscal, patente, cnss, legal_form, capital_social, legal_address, legal_city, business_phone, business_email, cachet_url, signature_url',
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

  const { data: ordersForPicker = [] } = useQuery({
    queryKey: ['bl-orders-pick', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, name, phone, created_at')
        .eq('DigiCom Business', activeBusinessId!)
        .order('created_at', { ascending: false })
        .limit(400);
      if (error) throw error;
      return (data || []).map((o: Record<string, unknown>) => {
        const created = o.created_at ? format(parseISO(String(o.created_at)), 'dd/MM/yy') : '';
        return {
          id: String(o.id),
          label: `${o.name || 'Commande'} — ${o.phone || '—'}${created ? ` (${created})` : ''}`,
        };
      });
    },
  });

  const { data: notesForPicker = [] } = useQuery({
    queryKey: ['bl-notes-pick', activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_delivery_notes')
        .select('id, reference, created_at, provider:providers(name)')
        .eq('DigiCom Business', activeBusinessId!)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data || []).map((n: Record<string, unknown>) => {
        const p = n.provider as { name?: string } | null;
        const ref = n.reference ? String(n.reference) : String(n.id).slice(0, 8);
        const created = n.created_at ? format(parseISO(String(n.created_at)), 'dd/MM/yy') : '';
        return {
          id: String(n.id),
          label: `${ref}${p?.name ? ` — ${p.name}` : ''}${created ? ` (${created})` : ''}`,
        };
      });
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
      return hydrateBonLivraisonFromCompanyNote(supabase, activeBusinessId, noteId);
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
          blNumber = await uniqueBlNumber(activeBusinessId);
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
          if (insErr) throw insErr;
          rowId = inserted!.id;
        }

        const snapForPdf: BonLivraisonSnapshot = {
          ...snapshot,
          bl_number: blNumber,
          issued_at_iso: issuedAtIso,
        };

        const snapWithImages = await embedRemoteImagesForPdf(snapForPdf);

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

        setInlinePdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });

        setWizardOpen(false);
        setEditingId(null);
        setInitialSnapshot(null);
        await queryClient.invalidateQueries({ queryKey: ['bl-list', activeBusinessId] });

        toast({ title: wasEdit ? 'Mis à jour' : 'Enregistré', description: blNumber });
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
    async (row: BonLivraisonRow) => {
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
        a.download = `${row.bl_number}.pdf`;
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
      const { error } = await supabase.from('bons_livraison').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast({ title: 'Supprimé' });
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

  const emptyState = useMemo(
    () => !listLoading && list.length === 0,
    [listLoading, list.length],
  );

  useEffect(() => {
    return () => {
      if (inlinePdfUrl) URL.revokeObjectURL(inlinePdfUrl);
    };
  }, [inlinePdfUrl]);

  if (!activeBusinessId) {
    return (
      <div className="space-y-8 pb-8">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
          <div className="relative p-8">
            <h1 className="text-3xl font-extralight tracking-tight">Bon de livraison</h1>
            <p className="text-gray-500 text-sm mt-2">Sélectionnez une entreprise active.</p>
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
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">
              Bon de livraison
            </h1>
            <p className="text-gray-500 font-light text-sm max-w-lg">
              PDF depuis saisie manuelle, une commande (colis, transporteur) ou un bon transporteur société.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-2xl gap-2" onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Nouveau BL
            </Button>
            <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
              <PackageCheck className="w-7 h-7 text-primary/80" />
            </div>
          </div>
        </div>
      </div>

      {inlinePdfUrl ? (
        <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">Dernier PDF généré</p>
              <Button variant="outline" size="sm" className="rounded-xl" asChild>
                <a href={inlinePdfUrl} download="bon-livraison.pdf">
                  <Download className="w-4 h-4 mr-2" />
                  Télécharger
                </a>
              </Button>
            </div>
            <iframe title="BL PDF" src={inlinePdfUrl} className="w-full min-h-[70vh] bg-gray-100" />
          </CardContent>
        </Card>
      ) : null}

      {listLoading ? (
        <Card className="border-0 shadow-sm rounded-3xl">
          <CardContent className="p-16 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
          </CardContent>
        </Card>
      ) : emptyState ? (
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 sm:p-16 min-h-[280px] flex flex-col items-center justify-center text-center gap-4">
            <PackageCheck className="w-12 h-12 text-gray-200" />
            <p className="text-sm text-gray-500 font-light max-w-md">
              Aucun bon de livraison. Créez-en un : données manuelles, import depuis commande, ou depuis une note
              transporteur.
            </p>
            <Button className="rounded-2xl" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Nouveau BL
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((row) => {
            const snap = parseSnapshot(row.snapshot_json);
            return (
              <Card
                key={row.id}
                className="border-0 shadow-sm rounded-3xl cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => void openPreview(row)}
              >
                <CardContent className="p-6 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-light tracking-tight">{row.bl_number}</p>
                      <p className="text-xs text-gray-400">
                        {format(parseISO(row.issued_at), 'd MMM yyyy', { locale: fr })}
                      </p>
                    </div>
                    {snap ? (
                      <Badge variant="secondary" className="rounded-lg text-[10px]">
                        {sourceLabel(snap.source)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-1">{counterpartLabel(row)}</p>
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
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 rounded-3xl">
          <DialogHeader className="p-4 border-b shrink-0">
            <DialogTitle className="font-light text-lg">
              {previewRow?.bl_number}
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
              ) : null}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-gray-100 relative">
            {previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
              </div>
            ) : previewUrl ? (
              <iframe title="Aperçu BL" src={previewUrl} className="w-full h-full border-0" />
            ) : (
              <p className="p-8 text-sm text-gray-500">Aucun PDF.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce bon de livraison ?</AlertDialogTitle>
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
