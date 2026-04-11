import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Percent,
  Receipt,
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
import { computeTotals } from '@/lib/devis/totals';
import type { OrderDerivedClient } from '@/lib/devis/types';
import type { FactureLine, FactureSnapshot } from '@/lib/facture/types';

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

type ProductRow = { id: string; name: string; selling_price: number };

const STEPS = [
  { title: 'Entreprise', icon: Building2 },
  { title: 'Lignes', icon: Package },
  { title: 'TVA', icon: Percent },
  { title: 'Client', icon: User },
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
    business_phone: '',
    business_email: '',
  };
}

function businessBlockFromRow(b: BusinessRow): FactureSnapshot['business'] {
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
    business_phone: b.business_phone,
    business_email: b.business_email,
    logo_url: b.logo,
  };
}

type WizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business: BusinessRow | null | undefined;
  products: ProductRow[];
  orderClients: OrderDerivedClient[];
  initialSnapshot: FactureSnapshot | null;
  isSubmitting: boolean;
  onSubmit: (snapshot: FactureSnapshot) => void | Promise<void>;
};

export function FactureWizard({
  open,
  onOpenChange,
  business,
  products,
  orderClients,
  initialSnapshot,
  isSubmitting,
  onSubmit,
}: WizardProps) {
  const [step, setStep] = useState(0);
  const [businessSource, setBusinessSource] = useState<'database' | 'manual'>('database');
  const [manualBusiness, setManualBusiness] = useState(emptyManualBusiness);
  const [linesSource, setLinesSource] = useState<'database' | 'manual'>('database');
  const [lines, setLines] = useState<FactureLine[]>([]);
  const [pickProductId, setPickProductId] = useState<string>('');
  const [pickQty, setPickQty] = useState('1');
  const [tvaIncluded, setTvaIncluded] = useState(false);
  const [tvaRate, setTvaRate] = useState('20');
  const [clientSource, setClientSource] = useState<'orders' | 'manual'>('orders');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [manualClient, setManualClient] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
  });
  const [stampSource, setStampSource] = useState<'business' | 'blank'>('business');
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [devisReference, setDevisReference] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(0);
    if (initialSnapshot) {
      setBusinessSource(initialSnapshot.business.source);
      if (initialSnapshot.business.source === 'manual') {
        setManualBusiness({
          name: initialSnapshot.business.name,
          ice: initialSnapshot.business.ice || '',
          rc: initialSnapshot.business.rc || '',
          identifiant_fiscal: initialSnapshot.business.identifiant_fiscal || '',
          patente: initialSnapshot.business.patente || '',
          cnss: initialSnapshot.business.cnss || '',
          legal_form: initialSnapshot.business.legal_form || '',
          capital_social: initialSnapshot.business.capital_social || '',
          legal_address: initialSnapshot.business.legal_address || '',
          legal_city: initialSnapshot.business.legal_city || '',
          business_phone: initialSnapshot.business.business_phone || '',
          business_email: initialSnapshot.business.business_email || '',
        });
      } else {
        setManualBusiness(emptyManualBusiness());
      }
      setLinesSource(initialSnapshot.lines.source);
      setLines(initialSnapshot.lines.items);
      setTvaIncluded(initialSnapshot.tva_included);
      setTvaRate(String(initialSnapshot.tva_rate || 20));
      setClientSource(initialSnapshot.client.source);
      if (initialSnapshot.client.source === 'orders' && initialSnapshot.client.phone) {
        setClientPhone(initialSnapshot.client.phone.replace(/[^0-9]/g, ''));
      } else {
        setClientPhone('');
      }
      setManualClient({
        name: initialSnapshot.client.name,
        phone: initialSnapshot.client.phone || '',
        address: initialSnapshot.client.address || '',
        city: initialSnapshot.client.city || '',
      });
      setStampSource(initialSnapshot.stamps.source);
      setDueDate(initialSnapshot.due_date ? initialSnapshot.due_date.slice(0, 10) : '');
      setPaymentTerms(initialSnapshot.payment_terms || '');
      setDevisReference(initialSnapshot.devis_reference || '');
      setNotes(initialSnapshot.notes || '');
      return;
    }
    setBusinessSource('database');
    setManualBusiness(emptyManualBusiness());
    setLinesSource('database');
    setLines([]);
    setPickProductId('');
    setPickQty('1');
    setTvaIncluded(false);
    setTvaRate('20');
    setClientSource('orders');
    setClientPhone('');
    setManualClient({ name: '', phone: '', address: '', city: '' });
    setStampSource('business');
    setDueDate('');
    setPaymentTerms('');
    setDevisReference('');
    setNotes('');
  }, [open, initialSnapshot]);

  const businessBlock = useMemo((): FactureSnapshot['business'] => {
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
      business_phone: manualBusiness.business_phone || null,
      business_email: manualBusiness.business_email || null,
      logo_url: null,
    };
  }, [businessSource, business, manualBusiness]);

  const clientBlock = useMemo((): FactureSnapshot['client'] => {
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

  const totals = useMemo(
    () => computeTotals(lines, tvaIncluded, Number(tvaRate) || 0),
    [lines, tvaIncluded, tvaRate],
  );

  const canNext = useMemo(() => {
    if (step === 0) {
      if (businessSource === 'database') return !!business?.name?.trim();
      return manualBusiness.name.trim().length >= 2;
    }
    if (step === 1) {
      return lines.length > 0 && lines.every((l) => l.label.trim() && l.quantity > 0 && l.unit_price >= 0);
    }
    if (step === 2) {
      if (!tvaIncluded) return true;
      const r = Number(tvaRate);
      return !Number.isNaN(r) && r >= 0 && r <= 100;
    }
    if (step === 3) {
      if (clientSource === 'manual') return manualClient.name.trim().length >= 1;
      return !!clientPhone && !!clientBlock.name;
    }
    return true;
  }, [
    step,
    businessSource,
    business,
    manualBusiness,
    lines,
    tvaIncluded,
    tvaRate,
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

  function updateLine(i: number, patch: Partial<FactureLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  async function handleGenerate() {
    const rateNum = tvaIncluded ? Math.min(100, Math.max(0, Number(tvaRate) || 0)) : 0;
    const t = computeTotals(lines, tvaIncluded, rateNum);
    const snapshot: FactureSnapshot = {
      business: businessBlock,
      lines: { source: linesSource, items: lines },
      tva_included: tvaIncluded,
      tva_rate: rateNum,
      subtotal_ht: t.subtotal_ht,
      tva_amount: t.tva_amount,
      total_ttc: t.total_ttc,
      client: clientBlock,
      stamps: stampsBlock,
      due_date: dueDate ? `${dueDate}T12:00:00.000Z` : null,
      payment_terms: paymentTerms.trim() || null,
      devis_reference: devisReference.trim() || null,
      notes: notes.trim() || null,
    };
    await onSubmit(snapshot);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] min-h-0 flex flex-col p-0 gap-0 rounded-3xl border-0 shadow-xl overflow-hidden">
        <DialogHeader className="p-6 pb-2 shrink-0 border-b border-gray-100">
          <DialogTitle className="text-xl font-light tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary/70" />
            {initialSnapshot ? 'Modifier la facture' : 'Nouvelle facture'}
          </DialogTitle>
          <div className="flex gap-1 pt-4">
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
                    'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-wider transition-colors',
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
                  <Label className="text-xs uppercase tracking-widest text-gray-400">Source des informations</Label>
                  <RadioGroup
                    value={businessSource}
                    onValueChange={(v) => setBusinessSource(v as 'database' | 'manual')}
                    className="grid grid-cols-2 gap-3"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer transition-colors',
                        businessSource === 'database' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="database" id="bs-db" />
                      <span className="text-sm">Fiche entreprise (base)</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer transition-colors',
                        businessSource === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="manual" id="bs-man" />
                      <span className="text-sm">Saisie manuelle</span>
                    </label>
                  </RadioGroup>
                  {businessSource === 'database' ? (
                    <div className="rounded-2xl bg-gray-50 p-4 text-sm space-y-1">
                      <p className="font-medium">{business?.name || '—'}</p>
                      <p className="text-gray-500 text-xs">
                        Les champs légaux et le logo proviennent de la fiche entreprise.
                      </p>
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
                      <div>
                        <Label>ICE</Label>
                        <Input
                          value={manualBusiness.ice}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, ice: e.target.value }))}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div>
                        <Label>RC</Label>
                        <Input
                          value={manualBusiness.rc}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, rc: e.target.value }))}
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
                        <Label>Ville</Label>
                        <Input
                          value={manualBusiness.legal_city}
                          onChange={(e) => setManualBusiness((m) => ({ ...m, legal_city: e.target.value }))}
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
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-4">
                  <RadioGroup
                    value={linesSource}
                    onValueChange={(v) => setLinesSource(v as 'database' | 'manual')}
                    className="grid grid-cols-2 gap-3"
                  >
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        linesSource === 'database' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="database" id="ls-db" />
                      <span className="text-sm">Catalogue produits</span>
                    </label>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-4 cursor-pointer',
                        linesSource === 'manual' ? 'border-primary bg-primary/5' : 'border-gray-100',
                      )}
                    >
                      <RadioGroupItem value="manual" id="ls-man" />
                      <span className="text-sm">Lignes libres</span>
                    </label>
                  </RadioGroup>
                  {linesSource === 'database' ? (
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[180px]">
                        <Label>Produit</Label>
                        <ProductSearchSelect
                          products={products}
                          value={pickProductId}
                          onValueChange={setPickProductId}
                          renderPrice={(p) => `${Number(p.selling_price || 0).toFixed(2)} MAD`}
                        />
                      </div>
                      <div className="w-24">
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
                  ) : (
                    <Button type="button" variant="outline" className="rounded-xl" onClick={addManualLine}>
                      Ajouter une ligne
                    </Button>
                  )}
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
                            disabled={linesSource === 'database' && !!line.product_id}
                          />
                        </div>
                        <div className="col-span-4 sm:col-span-2">
                          <Input
                            type="number"
                            min={0}
                            step="1"
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
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card className="border-0 shadow-sm rounded-3xl">
                <CardContent className="p-6 space-y-6">
                  <div className="flex items-center justify-between rounded-2xl border border-gray-100 p-4">
                    <div>
                      <p className="font-medium">Inclure la TVA</p>
                      <p className="text-xs text-gray-500">Si non, le total TTC = montant HT.</p>
                    </div>
                    <Switch checked={tvaIncluded} onCheckedChange={setTvaIncluded} />
                  </div>
                  {tvaIncluded ? (
                    <div>
                      <Label>Taux (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        placeholder="20"
                        value={tvaRate}
                        onChange={(e) => setTvaRate(e.target.value)}
                        className="rounded-xl mt-1 max-w-xs"
                      />
                    </div>
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
                        <span className="text-sm">Depuis la fiche entreprise</span>
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
                      <Label>Date d&apos;échéance (optionnel)</Label>
                      <Input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="rounded-xl mt-1"
                      />
                    </div>
                    <div>
                      <Label>Réf. devis (optionnel)</Label>
                      <Input
                        value={devisReference}
                        onChange={(e) => setDevisReference(e.target.value)}
                        placeholder="ex. DEV-20260327-AB12"
                        className="rounded-xl mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Conditions de paiement (optionnel)</Label>
                    <Textarea
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      className="rounded-xl mt-1 min-h-[72px]"
                      placeholder="Virement, délai, IBAN…"
                    />
                  </div>
                  <div>
                    <Label>Notes (optionnel)</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="rounded-xl mt-1 min-h-[80px]"
                    />
                  </div>
                  <div className="rounded-2xl border border-dashed border-gray-200 p-4 space-y-2 text-sm">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Récapitulatif</p>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Lignes</span>
                      <span>{lines.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Client</span>
                      <span className="font-medium">{clientBlock.name || '—'}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t">
                      <span>HT</span>
                      <span>{totals.subtotal_ht.toFixed(2)} MAD</span>
                    </div>
                    {tvaIncluded ? (
                      <div className="flex justify-between">
                        <span>TVA ({tvaRate}%)</span>
                        <span>{totals.tva_amount.toFixed(2)} MAD</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between font-semibold text-base">
                      <span>TTC</span>
                      <span>{totals.total_ttc.toFixed(2)} MAD</span>
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
