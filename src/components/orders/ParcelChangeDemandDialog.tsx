/**
 * ParcelChangeDemandDialog — Coliaty parcel-change demand, 3 steps.
 *
 *   0. Type de demande — correction d'informations OU changement de destination
 *   1. Formulaire      — champs préremplis depuis la commande (+ ville/adresse)
 *   2. Résultat        — envoi, succès / succès partiel / erreur
 *
 * Shared by the admin and the seller Orders pages. The host owns the open state
 * (exactly like `parcelTrackingOpen` / `setParcelTrackingOrderId`) and passes the
 * minimal order slice plus an `onSuccess` callback for its own invalidations.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle, ArrowLeft, ArrowRight, Check, ListChecks, Loader2, MapPin,
    PackageOpen, PencilLine, Send, type LucideIcon,
} from 'lucide-react';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

/** Minimal order slice the dialog needs — built by the host at click time. */
export type ParcelChangeDemandOrder = {
    id: string;
    name?: string | null;
    phone?: string | null;
    price?: number | string | null;
    /** Latest trackable company parcel */
    trackingCode: string;
    providerId: string;
    /** Resolved master package status of the parcel (context line only) */
    statusLabel?: string | null;
    statusColor?: string | null;
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    order: ParcelChangeDemandOrder | null;
    /** Host-owned invalidation of its orders list (+ KPI) query keys. */
    onSuccess?: () => void;
};

type Step = 0 | 1 | 2;
type DemandType = 'CORRECT_INFORMATION' | 'CHANGE_DESTINATION';
type AllowedCity = { id: number | null; name: string };
type AllowedCitiesResult = {
    cities: AllowedCity[];
    /** Coliaty says whether this parcel's status allows a destination change. */
    canChange: boolean;
    /** Coliaty's French reason when canChange is false. */
    reason: string | null;
};

const STEPS: { label: string; icon: LucideIcon }[] = [
    { label: 'Type', icon: ListChecks },
    { label: 'Détails', icon: PencilLine },
    { label: 'Envoi', icon: Send },
];

const STEP_TITLES: { title: string; desc: string }[] = [
    { title: 'Type de demande', desc: 'Que faut-il modifier sur ce colis ?' },
    { title: 'Détails de la demande', desc: 'Vérifiez les informations avant l’envoi.' },
    { title: 'Envoi de la demande', desc: 'Transmission à Coliaty.' },
];

class EdgeError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'EdgeError';
        this.status = status;
    }
}

const FORBIDDEN_MSG =
    'La clé API Coliaty de ce fournisseur n’a pas la permission de créer des demandes de modification. Contactez Coliaty pour l’activer.';

export function ParcelChangeDemandDialog({ open, onOpenChange, order, onSuccess }: Props) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [step, setStep] = useState<Step>(0);
    const [type, setType] = useState<DemandType | null>(null);
    const [phone, setPhone] = useState('');
    const [receiver, setReceiver] = useState('');
    const [price, setPrice] = useState('');
    const [note, setNote] = useState('');
    const [city, setCity] = useState('');
    const [address, setAddress] = useState('');

    const trackingCode = order?.trackingCode ?? '';
    const providerId = order?.providerId ?? '';

    // Fresh prefill each time the dialog opens on an order; full reset on close.
    useEffect(() => {
        if (!open) return;
        setStep(0);
        setType(null);
        setPhone(order?.phone ? String(order.phone) : '');
        setReceiver(order?.name ? String(order.name) : '');
        setPrice(order?.price === null || order?.price === undefined ? '' : String(order.price));
        setNote('');
        setCity('');
        setAddress('');
    }, [open, order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const postEdge = async (action: string, data: Record<string, unknown>) => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new EdgeError('Session expirée — reconnectez-vous.', 401);
        const res = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ action, provider_id: providerId, data }),
        });
        const json = await res.json().catch(() => ({} as Record<string, unknown>));
        if (!res.ok) {
            const msg = res.status === 403
                ? FORBIDDEN_MSG
                : (typeof (json as { error?: unknown }).error === 'string' && (json as { error: string }).error)
                    || 'Échec de la requête Coliaty.';
            throw new EdgeError(msg, res.status);
        }
        return json as Record<string, unknown>;
    };

    // OR-11: kept-mounted dialog — every query here MUST be gated on `open`, or it
    // fires on every page load of every host page with the dialog closed.
    const citiesQuery = useQuery({
        queryKey: ['coliaty-allowed-cities', providerId, trackingCode],
        queryFn: async () => {
            const json = await postEdge('get_allowed_destination_cities', { tracking_code: trackingCode });
            // Success responses are wrapped `{ success: true, data: {...} }` by the
            // dispatcher; errors are NOT wrapped (read at top level in postEdge above).
            const payload = ((json as { data?: Record<string, unknown> }).data ?? json) as Record<string, unknown>;
            return {
                cities: (payload.cities ?? []) as AllowedCity[],
                canChange: payload.can_change_destination !== false,
                reason: typeof payload.reason === 'string' ? payload.reason : null,
            } satisfies AllowedCitiesResult;
        },
        enabled: open && step === 1 && type === 'CHANGE_DESTINATION' && !!trackingCode && !!providerId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });

    const submit = useMutation({
        mutationFn: async (): Promise<{ ref: string; partial: boolean }> => {
            if (!order || !type) throw new EdgeError('Commande introuvable.', 400);

            const payload: Record<string, unknown> = {
                tracking_code: trackingCode,
                request_type: type,
                package_phone: phone.trim(),
                // `package_reciever` is Coliaty's own spelling — send it verbatim.
                package_reciever: receiver.trim(),
                package_price: Number(price),
                package_note: note.trim(),
            };
            if (type === 'CHANGE_DESTINATION') {
                const picked = (citiesQuery.data?.cities ?? []).find(
                    (c) => String(c.id ?? c.name) === city,
                );
                payload.package_city = picked ? (picked.id ?? picked.name) : city;
                // Human label for our own demand record (edge stores it in new_values.city
                // so the tracking diff reads « Casablanca », not a city ID). Not sent to Coliaty.
                payload.package_city_label = picked ? picked.name : city;
                payload.package_address = address.trim();
            }

            const json = await postEdge('create_parcel_change_demand', payload);
            const respPayload = ((json as { data?: Record<string, unknown> }).data ?? json) as Record<string, unknown>;
            const demand = (respPayload.demand ?? {}) as { ref?: string | number };
            // Never treat a 2xx as success without an explicit, non-empty ref —
            // the edge function itself now enforces this, but the dialog stays
            // defensive so a wrapper-shape drift can't silently show "success".
            if (demand.ref === undefined || demand.ref === null || String(demand.ref).trim() === '') {
                throw new EdgeError('Réponse Coliaty invalide — demande non confirmée.', 502);
            }
            const ref = String(demand.ref);

            if (type !== 'CHANGE_DESTINATION') return { ref, partial: false };

            // Resolve by CODE — never hardcode the status UUID. DB triggers own the
            // stock hold and the history line.
            try {
                const { data: st, error: stErr } = await supabase
                    .from('order_statuses')
                    .select('id')
                    .eq('code', 'RELAUNCH_NEW')
                    .maybeSingle();
                if (stErr || !st?.id) return { ref, partial: true };

                const { data: updRows, error: updErr } = await supabase
                    .from('orders')
                    .update({ order_status_id: st.id })
                    .eq('id', order.id)
                    .select('id');
                if (updErr || !updRows?.length) return { ref, partial: true };
            } catch {
                return { ref, partial: true };
            }
            return { ref, partial: false };
        },
        onSuccess: (res) => {
            toast({
                title: res.partial ? 'Demande créée — statut non mis à jour' : 'Demande créée',
                description: `Réf ${res.ref}`,
                variant: res.partial ? 'destructive' : undefined,
            });
            // The tracking dialog reads the demand we just filed from its own query.
            // Prefix match: the dialog's key is ['parcel-change-demands', orderId, trackingCode].
            queryClient.invalidateQueries({ queryKey: ['parcel-change-demands', order.id] });
            onSuccess?.();
        },
        onError: (e: unknown) => {
            toast({
                title: 'Demande refusée',
                description: e instanceof Error ? e.message : 'Échec de la demande Coliaty.',
                variant: 'destructive',
            });
        },
    });

    const priceNum = Number(price);
    const formValid =
        phone.trim().length > 0
        && receiver.trim().length > 0
        && price.trim().length > 0
        && Number.isFinite(priceNum)
        && priceNum >= 0
        && (type !== 'CHANGE_DESTINATION' || (city.length > 0 && address.trim().length > 0));

    const stepValid = step === 0 ? !!type : step === 1 ? formValid : false;

    const goToResult = () => {
        setStep(2);
        submit.reset();
        submit.mutate();
    };

    const submitError = submit.error;
    const errorMessage = submitError instanceof Error ? submitError.message : null;

    // Never let a demand-in-flight get dismissed — Escape, outside-click, or a
    // programmatic close would abandon the mutation while it may still land.
    const handleOpenChange = (next: boolean) => {
        if (!next && submit.isPending) return;
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                onEscapeKeyDown={(e) => { if (submit.isPending) e.preventDefault(); }}
                onInteractOutside={(e) => { if (submit.isPending) e.preventDefault(); }}
                className="max-w-2xl p-0 border border-ant-line bg-ant-paper rounded-[20px] shadow-[0_32px_90px_-28px_rgba(20,20,19,0.4)] overflow-hidden max-h-[92vh] flex flex-col"
            >
                {/* Gradient hairline */}
                <div className="h-[3px] w-full bg-gradient-to-r from-ant-orange via-ant-orange/60 to-transparent" />

                <DialogHeader className="px-6 pt-5 pb-5 border-b border-ant-line space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-ant-ink text-white flex items-center justify-center shrink-0 shadow-sm">
                            <PackageOpen className="w-5 h-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <div className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Demande Coliaty
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink mt-1">
                                {STEP_TITLES[step].title}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12.5px] text-ant-mid mt-0.5">
                                {STEP_TITLES[step].desc}
                            </DialogDescription>
                        </div>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-2">
                        {STEPS.map((s, i) => {
                            const Icon = s.icon;
                            const done = i < step;
                            const current = i === step;
                            return (
                                <div key={s.label} className="flex items-center gap-2 flex-1 last:flex-none">
                                    <div className={cn(
                                        'inline-flex items-center gap-2 px-2.5 h-7 rounded-full border text-[10px] font-semibold uppercase tracking-[0.12em] transition',
                                        current ? 'bg-ant-ink text-white border-ant-ink'
                                            : done ? 'bg-ant-green/10 text-ant-green border-ant-green/30'
                                            : 'bg-ant-light text-ant-mid border-ant-line',
                                    )}>
                                        {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                                        {s.label}
                                    </div>
                                    {i < STEPS.length - 1 && (
                                        <div className={cn('h-px flex-1 transition', done ? 'bg-ant-green/40' : 'bg-ant-line')} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </DialogHeader>

                <div className="ant-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6">
                    {/* ── STEP 0 — TYPE ───────────────────────────────────────── */}
                    {step === 0 && (
                        <div className="space-y-4">
                            {/* Parcel context */}
                            <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-ant-mid">
                                <span className="font-semibold text-ant-ink tabular-nums">{trackingCode || '—'}</span>
                                {order?.statusLabel && (
                                    <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide"
                                        style={{
                                            backgroundColor: order.statusColor ? `${order.statusColor}12` : 'rgba(0,31,63,0.04)',
                                            color: order.statusColor || 'rgba(0,31,63,0.5)',
                                        }}
                                    >
                                        {order.statusLabel}
                                    </span>
                                )}
                            </div>

                            <div className="space-y-2.5" role="radiogroup" aria-label="Type de demande">
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={type === 'CORRECT_INFORMATION'}
                                    onClick={() => setType('CORRECT_INFORMATION')}
                                    className={cn(
                                        'w-full rounded-xl p-4 text-left border transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/25',
                                        type === 'CORRECT_INFORMATION' ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/20',
                                    )}
                                >
                                    <span className="flex items-center gap-2 text-[13px] font-semibold text-ant-ink">
                                        <PencilLine className="w-4 h-4" /> Corriger les informations
                                    </span>
                                    <span className="block text-[11.5px] text-ant-mid mt-1">
                                        Téléphone, destinataire, prix ou note — sans changer la ville.
                                    </span>
                                </button>

                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={type === 'CHANGE_DESTINATION'}
                                    onClick={() => setType('CHANGE_DESTINATION')}
                                    className={cn(
                                        'w-full rounded-xl p-4 text-left border transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ant-ink/25',
                                        type === 'CHANGE_DESTINATION' ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/20',
                                    )}
                                >
                                    <span className="flex items-center gap-2 text-[13px] font-semibold text-ant-ink">
                                        <MapPin className="w-4 h-4" /> Changer la destination
                                    </span>
                                    <span className="block text-[11.5px] text-ant-mid mt-1">
                                        Nouvelle ville et adresse de livraison. Le statut de la commande passera à «&nbsp;Relancer vers un nouveau client&nbsp;».
                                    </span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 1 — FORMULAIRE ─────────────────────────────────── */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="pcd-phone" className="text-[11.5px] font-semibold text-ant-ink">Téléphone</Label>
                                    <Input
                                        id="pcd-phone"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        className="h-10 rounded-xl border-ant-line text-[12.5px] text-ant-ink"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="pcd-receiver" className="text-[11.5px] font-semibold text-ant-ink">Destinataire</Label>
                                    <Input
                                        id="pcd-receiver"
                                        value={receiver}
                                        onChange={(e) => setReceiver(e.target.value)}
                                        className="h-10 rounded-xl border-ant-line text-[12.5px] text-ant-ink"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="pcd-price" className="text-[11.5px] font-semibold text-ant-ink">Prix (DH)</Label>
                                    <Input
                                        id="pcd-price"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                        className="h-10 rounded-xl border-ant-line text-[12.5px] text-ant-ink tabular-nums"
                                    />
                                </div>
                            </div>

                            {type === 'CHANGE_DESTINATION' && (
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[11.5px] font-semibold text-ant-ink">Ville de destination</Label>
                                        {citiesQuery.isPending ? (
                                            <div className="space-y-2">
                                                <Skeleton className="h-10 w-full rounded-xl" />
                                                <Skeleton className="h-3 w-1/3 rounded-full" />
                                            </div>
                                        ) : citiesQuery.isError ? (
                                            <div className="rounded-xl border border-ant-rose/30 bg-ant-rose/10 px-3 py-2.5 space-y-2">
                                                <p className="flex items-start gap-2 text-[11.5px] font-semibold text-ant-rose">
                                                    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                                                    {citiesQuery.error instanceof Error ? citiesQuery.error.message : 'Échec du chargement des villes.'}
                                                </p>
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => void citiesQuery.refetch()}
                                                    className="h-8 px-3 rounded-full text-[11.5px] font-semibold text-ant-ink hover:bg-ant-ink/5"
                                                >
                                                    Réessayer
                                                </Button>
                                            </div>
                                        ) : citiesQuery.data && !citiesQuery.data.canChange ? (
                                            // Coliaty refuses a destination change for this parcel's
                                            // current status — surface its reason instead of an empty list.
                                            <div className="rounded-xl border border-ant-orange/30 bg-ant-orange/10 px-3 py-2.5">
                                                <p className="flex items-start gap-2 text-[11.5px] font-semibold text-ant-ink">
                                                    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0 text-ant-orange" />
                                                    {citiesQuery.data.reason || 'Le statut du colis ne permet pas le changement de destination.'}
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <Select value={city} onValueChange={setCity}>
                                                    <SelectTrigger className="h-10 rounded-xl border-ant-line text-[12.5px] text-ant-ink">
                                                        <SelectValue placeholder="Choisir une ville" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl">
                                                        {(citiesQuery.data?.cities ?? []).map((c) => (
                                                            <SelectItem
                                                                key={String(c.id ?? c.name)}
                                                                value={String(c.id ?? c.name)}
                                                                className="text-[12.5px] rounded-lg"
                                                            >
                                                                {c.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {citiesQuery.data?.reason && (
                                                    // e.g. « changement autorisé uniquement dans le hub actuel »
                                                    <p className="text-[11px] text-ant-mid">{citiesQuery.data.reason}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pcd-address" className="text-[11.5px] font-semibold text-ant-ink">Adresse</Label>
                                        <Input
                                            id="pcd-address"
                                            value={address}
                                            onChange={(e) => setAddress(e.target.value)}
                                            className="h-10 rounded-xl border-ant-line text-[12.5px] text-ant-ink"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="pcd-note" className="text-[11.5px] font-semibold text-ant-ink">
                                    Note <span className="font-normal text-ant-mid">(optionnel)</span>
                                </Label>
                                <Textarea
                                    id="pcd-note"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={3}
                                    className="rounded-xl border-ant-line text-[12.5px] text-ant-ink"
                                />
                            </div>
                        </div>
                    )}

                    {/* ── STEP 2 — RÉSULTAT ───────────────────────────────────── */}
                    {step === 2 && (
                        <div className="space-y-3">
                            {submit.isPending && (
                                <div className="flex items-center gap-3 rounded-xl border border-ant-line bg-ant-light px-4 py-4">
                                    <Loader2 className="w-4 h-4 animate-spin text-ant-ink shrink-0" />
                                    <p className="text-[12.5px] font-semibold text-ant-ink">Envoi de la demande à Coliaty…</p>
                                </div>
                            )}

                            {submit.isSuccess && !submit.data.partial && (
                                <div className="rounded-xl border border-ant-green/30 bg-ant-green/10 px-4 py-4 space-y-1.5">
                                    <p className="flex items-center gap-2 text-[13px] font-semibold text-ant-green">
                                        <Check className="w-4 h-4" /> Demande créée
                                    </p>
                                    <p className="text-[12.5px] font-semibold text-ant-ink tabular-nums">Réf {submit.data.ref}</p>
                                    <p className="text-[11.5px] text-ant-mid uppercase tracking-[0.12em] font-semibold">
                                        En attente chez Coliaty
                                    </p>
                                    {type === 'CHANGE_DESTINATION' && (
                                        <p className="text-[11.5px] text-ant-mid">
                                            Statut de la commande mis à jour : «&nbsp;Relancer vers un nouveau client&nbsp;»
                                        </p>
                                    )}
                                </div>
                            )}

                            {submit.isSuccess && submit.data.partial && (
                                <div className="rounded-xl border border-ant-orange/30 bg-ant-orange/10 px-4 py-4">
                                    <p className="flex items-start gap-2 text-[12.5px] font-semibold text-ant-ink">
                                        <AlertCircle className="w-4 h-4 mt-px shrink-0 text-ant-orange" />
                                        La demande a été créée (réf {submit.data.ref}) mais le statut n’a pas pu être mis à jour — modifiez-le manuellement.
                                    </p>
                                </div>
                            )}

                            {submit.isError && (
                                <div className="rounded-xl border border-ant-rose/30 bg-ant-rose/10 px-4 py-4">
                                    <p className="flex items-start gap-2 text-[12.5px] font-semibold text-ant-rose">
                                        <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                                        {errorMessage || 'Échec de la demande Coliaty.'}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── FOOTER ──────────────────────────────────────────────────── */}
                <div className="px-6 py-4 border-t border-ant-line bg-ant-paper">
                    <div className="flex items-center justify-between gap-2">
                        {step === 1 ? (
                            <Button
                                variant="ghost"
                                onClick={() => setStep(0)}
                                className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5"
                            >
                                <ArrowLeft className="w-4 h-4" /> {STEPS[0].label}
                            </Button>
                        ) : step === 2 && submit.isError ? (
                            <Button
                                variant="ghost"
                                onClick={() => { submit.reset(); setStep(1); }}
                                className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5"
                            >
                                <ArrowLeft className="w-4 h-4" /> Retour
                            </Button>
                        ) : <span />}

                        {step < 2 ? (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => onOpenChange(false)}
                                    className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink"
                                >
                                    Fermer
                                </Button>
                                <Button
                                    onClick={() => { if (!stepValid) return; if (step === 0) setStep(1); else goToResult(); }}
                                    disabled={!stepValid}
                                    className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-2 disabled:opacity-50"
                                >
                                    Continuer <ArrowRight className="w-4 h-4" />
                                </Button>
                            </div>
                        ) : (
                            <Button
                                onClick={() => onOpenChange(false)}
                                disabled={submit.isPending}
                                className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold disabled:opacity-50"
                            >
                                Fermer
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ParcelChangeDemandDialog;
