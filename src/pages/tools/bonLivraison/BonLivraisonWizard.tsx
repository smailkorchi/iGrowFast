import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Package,
  PackageCheck,
  Percent,
  Stamp,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import ProductSearchSelect from '@/components/tools/ProductSearchSelect';
import ClientSearchSelect from '@/components/tools/ClientSearchSelect';
import OrderSearchSelect from '@/components/tools/OrderSearchSelect';
import { useToast } from '@/hooks/use-toast';
import type {
  BonLivraisonHydrateResult,
  BonLivraisonParcelSnapshot,
  BonLivraisonSnapshot,
  BonLivraisonSource,
} from '@/lib/bonLivraison/types';
import type { DevisLine, DevisLinesSource, DevisSnapshot, OrderDerivedClient } from '@/lib/devis/types';

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

type ProductRow = { id: string; name: string; selling_price: number };

type PickerRow = { id: string; label: string };

const STEPS = [
  { title: 'Source', icon: Database },
  { title: 'Entreprise', icon: Building2 },
  { title: 'Contenu', icon: Package },
  { title: 'Destinataire', icon: User },
  { title: 'Options', icon: Percent },
  { title: 'Finalisation', icon: Stamp },
];

function emptyManualBusiness() {
  return {
    name: '',
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
  };
}

function businessBlockFromRow(b: BusinessRow): DevisSnapshot['business'] {
  return {
    source: 'database',
    name: b.name || '',
    ice: b.ice,
    rc: b.rc,
    identifiant_fiscal: b.identifiant_fiscal,
    patente: b.patente,
    cnss: b.cnss,
    legal_form: b.legal_form,
    capital_social: b.capital_social,
    legal_address: b.legal_address,
    legal_city: b.legal_city,
    postal_code: b.postal_code,
    business_phone: b.business_phone,
    business_email: b.business_email,
    website: b.website,
    logo_url: b.logo,
  };
}

function applyHydrateToState(h: BonLivraisonHydrateResult, setters: {
  setLines: (l: DevisLine[]) => void;
  setLinesSource: (s: DevisLinesSource) => void;
  setParcels: (p: BonLivraisonParcelSnapshot[]) => void;
  setTransport: (t: BonLivraisonSnapshot['transport']) => void;
  setLinkedReference: (r: string) => void;
  setCompanyDeliveryNoteId: (id: string | null) => void;
  setOrderIdRef: (id: string | null) => void;
  setShowTransportBlock: (v: boolean) => void;
  setManualClient: (c: { name: string; phone: string; address: string; city: string }) => void;
  setClientSource: (s: 'orders' | 'manual') => void;
  setClientPhone: (p: string) => void;
}) {
  setters.setLines(h.lines);
  setters.setLinesSource(h.linesSource);
  setters.setParcels(h.parcels);
  setters.setTransport(h.transport);
  setters.setLinkedReference(h.linked_reference || '');
  setters.setCompanyDeliveryNoteId(h.company_delivery_note_id);
  setters.setOrderIdRef(h.order_id);
  setters.setShowTransportBlock(h.show_transport_default);
  setters.setManualClient({
    name: h.client.name,
    phone: h.client.phone || '',
    address: h.client.address || '',
    city: h.client.city || '',
  });
  setters.setClientSource('manual');
  setters.setClientPhone('');
}

type WizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business: BusinessRow | null | undefined;
  products: ProductRow[];
  orderClients: OrderDerivedClient[];
  ordersForPicker: PickerRow[];
  notesForPicker: PickerRow[];
  hydrateOrder: (orderId: string) => Promise<BonLivraisonHydrateResult | null>;
  hydrateCompanyNote: (noteId: string) => Promise<BonLivraisonHydrateResult | null>;
  initialSnapshot: BonLivraisonSnapshot | null;
  isSubmitting: boolean;
  onSubmit: (snapshot: BonLivraisonSnapshot) => void | Promise<void>;
};

export function BonLivraisonWizard({
  open,
  onOpenChange,
  business,
  products,
  orderClients,
  ordersForPicker,
  notesForPicker,
  hydrateOrder,
  hydrateCompanyNote,
  initialSnapshot,
  isSubmitting,
  onSubmit,
}: WizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<BonLivraisonSource>('manual');
  const [businessSource, setBusinessSource] = useState<'database' | 'manual'>('database');
  const [manualBusiness, setManualBusiness] = useState(emptyManualBusiness);
  const [linesSource, setLinesSource] = useState<DevisLinesSource>('database');
  const [lines, setLines] = useState<DevisLine[]>([]);
  const [pickProductId, setPickProductId] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [clientSource, setClientSource] = useState<'orders' | 'manual'>('orders');
  const [clientPhone, setClientPhone] = useState('');
  const [manualClient, setManualClient] = useState({ name: '', phone: '', address: '', city: '' });
  const [stampSource, setStampSource] = useState<'business' | 'blank'>('business');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  // Optional user-supplied BL number. Empty → auto-generated at save.
  const [customNumber, setCustomNumber] = useState('');
  // Optional closing line printed just above the legal footer.
  const [thankYou, setThankYou] = useState('');
  const [includePrices, setIncludePrices] = useState(false);
  const [showTransportBlock, setShowTransportBlock] = useState(false);
  const [transport, setTransport] = useState<BonLivraisonSnapshot['transport']>(null);
  const [parcels, setParcels] = useState<BonLivraisonParcelSnapshot[]>([]);
  const [linkedReference, setLinkedReference] = useState('');
  const [companyDeliveryNoteId, setCompanyDeliveryNoteId] = useState<string | null>(null);
  const [orderIdRef, setOrderIdRef] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [hydrating, setHydrating] = useState(false);

  const editingLocked = !!initialSnapshot;

  const resetFromSnapshot = useCallback((snap: BonLivraisonSnapshot) => {
    setSource(snap.source);
    setBusinessSource(snap.business.source);
    if (snap.business.source === 'manual') {
      setManualBusiness({
        name: snap.business.name,
        ice: snap.business.ice || '',
        rc: snap.business.rc || '',
        identifiant_fiscal: snap.business.identifiant_fiscal || '',
        patente: snap.business.patente || '',
        cnss: snap.business.cnss || '',
        legal_form: snap.business.legal_form || '',
        capital_social: snap.business.capital_social || '',
        legal_address: snap.business.legal_address || '',
        legal_city: snap.business.legal_city || '',
        postal_code: snap.business.postal_code || '',
        business_phone: snap.business.business_phone || '',
        business_email: snap.business.business_email || '',
        website: snap.business.website || '',
      });
    } else {
      setManualBusiness(emptyManualBusiness());
    }
    setLinesSource(snap.lines.source);
    setLines(snap.lines.items);
    setIncludePrices(snap.include_prices);
    setShowTransportBlock(snap.show_transport_block);
    setTransport(snap.transport ?? null);
    setParcels(snap.parcels || []);
    setLinkedReference(snap.linked_reference || '');
    setCompanyDeliveryNoteId(snap.company_delivery_note_id ?? null);
    setOrderIdRef(snap.order_id ?? null);
    setSelectedOrderId(snap.order_id || '');
    setSelectedNoteId(snap.company_delivery_note_id || '');
    setClientSource(snap.client.source);
    if (snap.client.source === 'orders' && snap.client.phone) {
      setClientPhone(String(snap.client.phone).replace(/[^0-9]/g, ''));
    } else {
      setClientPhone('');
    }
    setManualClient({
      name: snap.client.name,
      phone: snap.client.phone || '',
      address: snap.client.address || '',
      city: snap.client.city || '',
    });
    setStampSource(snap.stamps.source);
    setDeliveryDate(snap.delivery_date ? snap.delivery_date.slice(0, 10) : '');
    setNotes(snap.notes || '');
    setCustomNumber(snap.bl_number || '');
    setThankYou(snap.thank_you_text || '');
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    if (initialSnapshot) {
      resetFromSnapshot(initialSnapshot);
      return;
    }
    setSource('manual');
    setBusinessSource('database');
    setManualBusiness(emptyManualBusiness());
    setLinesSource('database');
    setLines([]);
    setPickProductId('');
    setPickQty('1');
    setClientSource('orders');
    setClientPhone('');
    setManualClient({ name: '', phone: '', address: '', city: '' });
    setStampSource('business');
    setDeliveryDate('');
    setNotes('');
    setCustomNumber('');
    setThankYou('');
    setIncludePrices(false);
    setShowTransportBlock(false);
    setTransport(null);
    setParcels([]);
    setLinkedReference('');
    setCompanyDeliveryNoteId(null);
    setOrderIdRef(null);
    setSelectedOrderId('');
    setSelectedNoteId('');
  }, [open, initialSnapshot, resetFromSnapshot]);

  const businessBlock = useMemo((): DevisSnapshot['business'] => {
    if (businessSource === 'database' && business) {
      return businessBlockFromRow(business);
    }
    return {
      source: 'manual',
      name: manualBusiness.name,
      ice: manualBusiness.ice || null,
      rc: manualBusiness.rc || null,
      identifiant_fiscal: manualBusiness.identifiant_fiscal || null,
      patente: manualBusiness.patente || null,
      cnss: manualBusiness.cnss || null,
      legal_form: manualBusiness.legal_form || null,
      capital_social: manualBusiness.capital_social || null,
      legal_address: manualBusiness.legal_address || null,
      legal_city: manualBusiness.legal_city || null,
      postal_code: manualBusiness.postal_code || null,
      business_phone: manualBusiness.business_phone || null,
      business_email: manualBusiness.business_email || null,
      website: manualBusiness.website || null,
      logo_url: null,
    };
  }, [businessSource, business, manualBusiness]);

  const clientBlock = useMemo((): DevisSnapshot['client'] => {
    if (clientSource === 'manual') {
      return {
        source: 'manual',
        name: manualClient.name,
        phone: manualClient.phone || undefined,
        address: manualClient.address || undefined,
        city: manualClient.city || undefined,
      };
    }
    const found = orderClients.find((c) => c.phone === clientPhone);
    if (found) {
      return {
        source: 'orders',
        name: found.name,
        phone: found.phone,
        address: found.address,
        city: found.city,
      };
    }
    return { source: 'orders', name: '', phone: clientPhone || undefined };
  }, [clientSource, manualClient, orderClients, clientPhone]);

  const stampsBlock = useMemo(() => {
    if (stampSource === 'blank' || !business) {
      return { source: 'blank' as const, cachet_url: null as string | null, signature_url: null as string | null };
    }
    return {
      source: 'business' as const,
      cachet_url: business.cachet_url,
      signature_url: business.signature_url,
    };
  }, [stampSource, business]);

  const onPickOrder = useCallback(
    async (orderId: string) => {
      setSelectedOrderId(orderId);
      if (!orderId) return;
      setHydrating(true);
      try {
        const h = await hydrateOrder(orderId);
        if (h) {
          applyHydrateToState(h, {
            setLines,
            setLinesSource,
            setParcels,
            setTransport,
            setLinkedReference,
            setCompanyDeliveryNoteId,
            setOrderIdRef,
            setShowTransportBlock,
            setManualClient,
            setClientSource,
            setClientPhone,
          });
        } else {
          toast({ title: 'Impossible de charger la commande', variant: 'destructive' });
        }
      } finally {
        setHydrating(false);
      }
    },
    [hydrateOrder, toast],
  );

  const onPickNote = useCallback(
    async (noteId: string) => {
      setSelectedNoteId(noteId);
      if (!noteId) return;
      setHydrating(true);
      try {
        const h = await hydrateCompanyNote(noteId);
        if (h) {
          applyHydrateToState(h, {
            setLines,
            setLinesSource,
            setParcels,
            setTransport,
            setLinkedReference,
            setCompanyDeliveryNoteId,
            setOrderIdRef,
            setShowTransportBlock,
            setManualClient,
            setClientSource,
            setClientPhone,
          });
        } else {
          toast({ title: 'Impossible de charger la note transporteur', variant: 'destructive' });
        }
      } finally {
        setHydrating(false);
      }
    },
    [hydrateCompanyNote, toast],
  );

  const setSourceAndReset = useCallback(
    (s: BonLivraisonSource) => {
      if (editingLocked) return;
      setSource(s);
      setLines([]);
      setParcels([]);
      setTransport(null);
      setLinkedReference('');
      setCompanyDeliveryNoteId(null);
      setOrderIdRef(null);
      setSelectedOrderId('');
      setSelectedNoteId('');
      setShowTransportBlock(false);
    },
    [editingLocked],
  );

  const canNext = useMemo(() => {
    if (step === 0) return true;
    if (step === 1) {
      if (businessSource === 'database') return !!business?.name?.trim();
      return manualBusiness.name.trim().length >= 2;
    }
    if (step === 2) {
      if (source === 'manual') {
        return lines.length > 0 && lines.every((l) => l.label.trim() && l.quantity > 0 && l.unit_price >= 0);
      }
      if (source === 'order') {
        return !!selectedOrderId && lines.length > 0 && lines.every((l) => l.label.trim() && l.quantity >= 0);
      }
      return !!selectedNoteId && lines.length > 0;
    }
    if (step === 3) {
      if (clientSource === 'manual') return manualClient.name.trim().length >= 1;
      return !!clientPhone && !!clientBlock.name;
    }
    if (step === 4) return true;
    return true;
  }, [
    step,
    source,
    businessSource,
    business,
    manualBusiness,
    lines,
    selectedOrderId,
    selectedNoteId,
    clientSource,
    manualClient,
    clientPhone,
    clientBlock.name,
  ]);

  function addProductLine() {
    const p = products.find((x) => x.id === pickProductId);
    if (!p) return;
    const qty = Math.max(1, Number(pickQty) || 1);
    setLines((prev) => [
      ...prev,
      {
        label: p.name,
        quantity: qty,
        unit_price: Number(p.selling_price) || 0,
        product_id: p.id,
      },
    ]);
    setPickQty('1');
  }

  function addManualLine() {
    setLines((prev) => [...prev, { label: '', quantity: 1, unit_price: 0, product_id: null }]);
  }

  function updateLine(i: number, patch: Partial<DevisLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleGenerate() {
    const snapshot: BonLivraisonSnapshot = {
      source,
      company_delivery_note_id: companyDeliveryNoteId,
      order_id: orderIdRef,
      linked_reference: linkedReference.trim() || null,
      business: businessBlock,
      client: clientBlock,
      lines: { source: linesSource, items: lines },
      include_prices: includePrices,
      show_transport_block: showTransportBlock,
      transport: showTransportBlock ? transport : null,
      parcels,
      stamps: stampsBlock,
      delivery_date: deliveryDate ? `${deliveryDate}T12:00:00.000Z` : null,
      notes: notes.trim() || null,
      bl_number: customNumber.trim() || undefined,
      thank_you_text: thankYou.trim() || null,
    };
    await onSubmit(snapshot);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] min-h-0 flex flex-col p-0 gap-0 rounded-3xl border-0 shadow-xl overflow-hidden">
        <DialogHeader className="p-6 pb-2 shrink-0 border-b border-gray-100">
          <DialogTitle className="text-xl font-light tracking-tight flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-primary/70" />
            {initialSnapshot ? 'Modifier le bon de livraison' : 'Nouveau bon de livraison'}
          </DialogTitle>
          <div className="flex gap-1 pt-4 overflow-x-auto">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = i === step;
              const done = i < step;
              return (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => done && setStep(i)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-wider transition-colors min-w-[4.25rem]',
                    active && 'bg-primary/10 text-primary',
                    done && !active && 'text-gray-400 hover:text-gray-600',
                    !done && !active && 'text-gray-300',
                  )}
                  disabled={!done && !active}
                >
                  <Icon className="w-4 h-4" />
                  {s.title}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
          <div className="p-6 space-y-6 pb-8">
            {step === 0 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-4">
                  <Label className="text-xs uppercase tracking-widest text-gray-400">Origine des données</Label>
                  <RadioGroup
                    value={source}
                    onValueChange={(v) => setSourceAndReset(v as BonLivraisonSource)}
                    className="grid gap-3"
                    disabled={editingLocked}
                  >
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        source === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        editingLocked && 'opacity-70',
                      )}
                    >
                      <RadioGroupItem value="manual" id="src-man" disabled={editingLocked} />
                      <span className="text-sm">Manuel (saisie libre)</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        source === 'order' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        editingLocked && 'opacity-70',
                      )}
                    >
                      <RadioGroupItem value="order" id="src-ord" disabled={editingLocked} />
                      <span className="text-sm">Depuis une commande (lignes, client, colis)</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        source === 'company_delivery_note' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        editingLocked && 'opacity-70',
                      )}
                    >
                      <RadioGroupItem value="company_delivery_note" id="src-cdn" disabled={editingLocked} />
                      <span className="text-sm">Bon transporteur (note société + colis)</span>
                    </label>
                  </RadioGroup>
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-4">
                  <Label className="text-xs uppercase tracking-widest text-gray-400">Émetteur</Label>
                  <RadioGroup
                    value={businessSource}
                    onValueChange={(v) => setBusinessSource(v as 'database' | 'manual')}
                    className="grid grid-cols-2 gap-3"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        businessSource === 'database' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="database" id="bs-db" />
                      <span className="text-sm">Fiche entreprise</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        businessSource === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="manual" id="bs-man" />
                      <span className="text-sm">Saisie manuelle</span>
                    </label>
                  </RadioGroup>
                  {businessSource === 'database' ? (
                    <div className="rounded-2xl bg-gray-50 p-4 text-sm">
                      <p className="font-medium">{business?.name || '—'}</p>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <Label>Raison sociale</Label>
                        <Input
                          value={manualBusiness.name}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, name: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Adresse</Label>
                        <Input
                          value={manualBusiness.legal_address}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, legal_address: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div>
                        <Label>Téléphone</Label>
                        <Input
                          value={manualBusiness.business_phone}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, business_phone: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div>
                        <Label>ICE</Label>
                        <Input
                          value={manualBusiness.ice}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, ice: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-4">
                  {source === 'order' ? (
                    <div className="space-y-2">
                      <Label>Commande</Label>
                      <OrderSearchSelect
                        orders={ordersForPicker}
                        value={selectedOrderId}
                        onValueChange={(id) => void onPickOrder(id)}
                        disabled={hydrating}
                      />
                      {hydrating ? (
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Chargement…
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {source === 'company_delivery_note' ? (
                    <div className="space-y-2">
                      <Label>Bon transporteur (société)</Label>
                      <OrderSearchSelect
                        orders={notesForPicker}
                        value={selectedNoteId}
                        onValueChange={(id) => void onPickNote(id)}
                        placeholder="Choisir une note…"
                        disabled={hydrating}
                      />
                      {hydrating ? (
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Chargement…
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <Label className="text-xs uppercase tracking-widest text-gray-400">Lignes</Label>
                  {source === 'manual' ? (
                    <RadioGroup
                      value={linesSource}
                      onValueChange={(v) => setLinesSource(v as DevisLinesSource)}
                      className="grid grid-cols-2 gap-3"
                    >
                      <label
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                          linesSource === 'database' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        )}
                      >
                        <RadioGroupItem value="database" id="ls-db" />
                        <span className="text-sm">Catalogue</span>
                      </label>
                      <label
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                          linesSource === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        )}
                      >
                        <RadioGroupItem value="manual" id="ls-man" />
                        <span className="text-sm">Libre</span>
                      </label>
                    </RadioGroup>
                  ) : (
                    <p className="text-xs text-gray-500">Vous pouvez ajuster les quantités et libellés ci-dessous.</p>
                  )}

                  {source === 'manual' && linesSource === 'database' ? (
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[160px]">
                        <Label>Produit</Label>
                        <ProductSearchSelect
                          products={products}
                          value={pickProductId}
                          onValueChange={setPickProductId}
                        />
                      </div>
                      <div className="w-20">
                        <Label>Qté</Label>
                        <Input
                          type="number"
                          min={1}
                          value={pickQty}
                          onChange={(e) => setPickQty(e.target.value)}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <Button type="button" variant="secondary" className="rounded-xl" onClick={addProductLine}>
                        Ajouter
                      </Button>
                    </div>
                  ) : source === 'manual' ? (
                    <Button type="button" variant="outline" className="rounded-xl" onClick={addManualLine}>
                      Ajouter une ligne
                    </Button>
                  ) : null}

                  <div className="space-y-2">
                    {lines.map((line, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-12 gap-2 items-center p-3 rounded-2xl bg-gray-50/80"
                      >
                        <div className="col-span-12 sm:col-span-5">
                          <Input
                            placeholder="Désignation"
                            value={line.label}
                            onChange={(e) => updateLine(i, { label: e.target.value })}
                            className="rounded-xl"
                            disabled={source === 'manual' && linesSource === 'database' && !!line.product_id}
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Input
                            type="number"
                            min={0}
                            value={line.quantity}
                            onChange={(e) => updateLine(i, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                            className="rounded-xl"
                          />
                        </div>
                        <div className="col-span-5 sm:col-span-3">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unit_price}
                            onChange={(e) =>
                              updateLine(i, { unit_price: Math.max(0, Number(e.target.value) || 0) })
                            }
                            className="rounded-xl"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2 flex justify-end">
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)}>
                            Retirer
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {parcels.length > 0 ? (
                    <p className="text-xs text-gray-500">{parcels.length} colis liés seront listés sur le PDF.</p>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-4">
                  <RadioGroup
                    value={clientSource}
                    onValueChange={(v) => setClientSource(v as 'orders' | 'manual')}
                    className="grid grid-cols-2 gap-3"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        clientSource === 'orders' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="orders" id="cs-ord" />
                      <span className="text-sm">Clients (commandes)</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        clientSource === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="manual" id="cs-man" />
                      <span className="text-sm">Saisie manuelle</span>
                    </label>
                  </RadioGroup>
                  {clientSource === 'orders' ? (
                    <div>
                      <Label>Client</Label>
                      <ClientSearchSelect
                        clients={orderClients}
                        value={clientPhone}
                        onValueChange={setClientPhone}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <div>
                        <Label>Nom</Label>
                        <Input
                          value={manualClient.name}
                          onChange={(e) => setManualClient((m) => ({ ...m, name: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <Label>Téléphone</Label>
                          <Input
                            value={manualClient.phone}
                            onChange={(e) => setManualClient((m) => ({ ...m, phone: e.target.value }))}
                            className="rounded-xl mt-1"
                          />
                        </div>
                        <div>
                          <Label>Ville</Label>
                          <Input
                            value={manualClient.city}
                            onChange={(e) => setManualClient((m) => ({ ...m, city: e.target.value }))}
                            className="rounded-xl mt-1"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Adresse</Label>
                        <Input
                          value={manualClient.address}
                          onChange={(e) => setManualClient((m) => ({ ...m, address: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === 4 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-6">
                  <div className="flex items-center justify-between rounded-2xl border border-gray-100 p-4">
                    <div>
                      <p className="font-medium">Afficher les prix (HT)</p>
                      <p className="text-xs text-gray-500">Sinon le PDF ne montre que désignations et quantités.</p>
                    </div>
                    <Switch checked={includePrices} onCheckedChange={setIncludePrices} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-gray-100 p-4">
                    <div>
                      <p className="font-medium">Bloc transporteur</p>
                      <p className="text-xs text-gray-500">Logo et nom du prestataire (si chargés depuis la base).</p>
                    </div>
                    <Switch checked={showTransportBlock} onCheckedChange={setShowTransportBlock} />
                  </div>
                  <div>
                    <Label>Référence affichée (optionnel)</Label>
                    <Input
                      value={linkedReference}
                      onChange={(e) => setLinkedReference(e.target.value)}
                      className="rounded-xl mt-1"
                      placeholder="Réf. note transport ou commentaire"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 5 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-6">
                  <div>
                    <Label className="text-xs uppercase tracking-widest text-gray-400">Cachet & signature</Label>
                    <RadioGroup
                      value={stampSource}
                      onValueChange={(v) => setStampSource(v as 'business' | 'blank')}
                      className="grid grid-cols-2 gap-3 mt-2"
                    >
                      <label
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                          stampSource === 'business' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        )}
                      >
                        <RadioGroupItem value="business" id="st-b" />
                        <span className="text-sm">Fiche entreprise</span>
                      </label>
                      <label
                        className={cn(
                          'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                          stampSource === 'blank' ? 'border-primary bg-primary/5' : 'border-gray-100',
                        )}
                      >
                        <RadioGroupItem value="blank" id="st-bl" />
                        <span className="text-sm">Ne pas afficher</span>
                      </label>
                    </RadioGroup>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Numéro (optionnel)</Label>
                      <Input
                        value={customNumber}
                        onChange={(e) => setCustomNumber(e.target.value)}
                        placeholder="BL-2026-001"
                        disabled={!!initialSnapshot}
                        className="rounded-xl mt-1"
                      />
                      <p className="text-[10px] text-gray-400 mt-1">
                        Laisser vide pour générer automatiquement.
                      </p>
                    </div>
                    <div>
                      <Label>Date de livraison (optionnel)</Label>
                      <Input
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="rounded-xl mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="rounded-xl mt-1 min-h-[72px]"
                    />
                  </div>
                  <div>
                    <Label>Phrase de remerciement (optionnel)</Label>
                    <Input
                      value={thankYou}
                      onChange={(e) => setThankYou(e.target.value)}
                      placeholder="Merci pour votre confiance."
                      className="rounded-xl mt-1"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">
                      Affichée en bas de page, juste au-dessus des mentions légales.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-dashed border-gray-200 p-4 space-y-2 text-sm">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Récap</p>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Source</span>
                      <span>
                        {source === 'manual' ? 'Manuel' : source === 'order' ? 'Commande' : 'Note société'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Lignes</span>
                      <span>{lines.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Colis</span>
                      <span>{parcels.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Destinataire</span>
                      <span className="font-medium">{clientBlock.name || '—'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-between gap-3 shrink-0 bg-white">
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => (step > 0 ? setStep((s) => s - 1) : onOpenChange(false))}
          >
            {step === 0 ? (
              'Annuler'
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Retour
              </>
            )}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" className="rounded-xl" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Suivant
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-xl"
              disabled={!canNext || isSubmitting}
              onClick={() => void handleGenerate()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Génération…
                </>
              ) : (
                'Générer le PDF'
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
