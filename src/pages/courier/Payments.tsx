/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import {
    buildCourierPayoutPdfBlob,
    resolveCourierPayoutImages,
    type CourierPayoutPdfInput,
} from '@/lib/courierPayoutPdf';
import { buildCourierReturnPdfBlob, type CourierReturnPdfInput } from '@/lib/courierReturnPdf';
import { saveBlob, canDirectSave } from '@/lib/saveBlob';
import { useToast } from '@/hooks/use-toast';
import {
    CheckCircle2,
    Eye,
    Download,
    Search,
    SearchX,
    Loader2,
    Hash,
    X,
    FileText,
    Save,
    RotateCcw,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type PaymentNote = {
    id: string;
    reference: string;
    status: string;
    total_amount: number;
    total_shipping_fees: number;
    net_amount: number;
    order_count: number;
    paid_at: string | null;
    created_at: string;
    line_items: Array<{
        id: string;
        order_id: string;
        tracking_code: string | null;
        amount: number;
        shipping_fee: number;
    }>;
};

// Return notes the courier received back: he subtracted these return fees from the COD
// before remitting, so for him they are also earnings. Same shape as a payment note,
// keyed on `received_at` instead of `paid_at`.
type ReturnNote = {
    id: string;
    reference: string;
    status: string;
    total_amount: number;
    total_shipping_fees: number;
    net_amount: number;
    order_count: number;
    received_at: string | null;
    created_at: string;
    line_items: Array<{
        id: string;
        order_id: string;
        tracking_code: string | null;
        amount: number;
        shipping_fee: number;
    }>;
};

const fmtMAD = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const CourierPayments = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [view, setView] = useState<'payments' | 'returns'>('payments');
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);
    const [selectedReturn, setSelectedReturn] = useState<ReturnNote | null>(null);

    const { data: me } = useQuery({
        queryKey: ['courier-me-payments'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, avatar_url, "DigiCom Business"')
                .eq('id', user.id)
                .maybeSingle();
            return data as { id: string; name: string | null; avatar_url: string | null; ['DigiCom Business']: string } | null;
        },
        staleTime: 60_000,
    });

    const courierId = me?.id;
    const businessId = me?.['DigiCom Business'];

    const { data: earnedThisMonth = 0 } = useQuery({
        queryKey: ['courier-earned-this-month', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return 0;
            const now = new Date();
            const from = startOfMonth(now).toISOString();
            const to = endOfMonth(now).toISOString();

            const [{ data: parcels, error: pErr }, { data: fees, error: fErr }] = await Promise.all([
                (supabase as any)
                    .from('courier_parcels')
                    .select(`
                        id,
                        order:orders!courier_parcels_order_id_fkey(include_delivery_in_total, shipping_cost, master_city_id)
                    `)
                    .eq('courier_id', courierId)
                    .eq('DigiCom Business', businessId)
                    .gte('delivered_at', from)
                    .lte('delivered_at', to),
                (supabase as any)
                    .from('courier_fees')
                    .select('master_city_id, fee')
                    .eq('courier_id', courierId),
            ]);
            if (pErr) throw pErr;
            if (fErr) throw fErr;
            const feeMap = new Map<string, number>();
            for (const f of (fees || []) as Array<{ master_city_id: string; fee: number | string | null }>) {
                feeMap.set(f.master_city_id, Number(f.fee || 0));
            }
            let total = 0;
            for (const p of (parcels || []) as Array<{ order: { include_delivery_in_total: boolean | null; shipping_cost: number | string | null; master_city_id: string | null } | null }>) {
                const o = p.order;
                if (!o) continue;
                if (o.include_delivery_in_total) {
                    total += Number(o.shipping_cost || 0);
                } else if (o.master_city_id) {
                    total += feeMap.get(o.master_city_id) ?? 0;
                }
            }
            return total;
        },
        enabled: !!courierId && !!businessId,
    });

    const { data: notes = [], isLoading } = useQuery({
        queryKey: ['courier-payment-notes', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select(
                    `id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at,
                    line_items:courier_payment_note_orders(id, order_id, tracking_code, amount, shipping_fee)`
                )
                .eq('courier_id', courierId)
                .eq('DigiCom Business', businessId)
                .eq('status', 'paid')
                .order('paid_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            return (data || []) as PaymentNote[];
        },
        enabled: !!courierId && !!businessId,
    });

    // Return notes received back from this courier — the return fees he kept are also earnings.
    const { data: returnNotes = [] } = useQuery({
        queryKey: ['courier-return-notes', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_return_notes')
                .select(
                    `id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, received_at, created_at,
                    line_items:courier_return_note_orders(id, order_id, tracking_code, amount, shipping_fee)`
                )
                .eq('courier_id', courierId)
                .eq('DigiCom Business', businessId)
                .eq('status', 'received')
                .order('received_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            return (data || []) as ReturnNote[];
        },
        enabled: !!courierId && !!businessId,
    });

    const stats = useMemo(() => {
        const deliveryEarnings = notes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const lifetimeDelivered = notes.reduce((s, n) => s + Number(n.order_count || 0), 0);
        const lifetimeGross = notes.reduce((s, n) => s + Number(n.total_amount || 0), 0);
        const returnEarnings = returnNotes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const returnedCount = returnNotes.reduce((s, n) => s + Number(n.order_count || 0), 0);
        const now = new Date();
        const mFrom = startOfMonth(now).getTime();
        const mTo = endOfMonth(now).getTime();
        const returnsThisMonth = returnNotes.reduce((s, n) => {
            const t = n.received_at ? new Date(n.received_at).getTime() : 0;
            return t >= mFrom && t <= mTo ? s + Number(n.total_shipping_fees || 0) : s;
        }, 0);

        return {
            deliveryEarnings,
            returnEarnings,
            combinedEarnings: deliveryEarnings + returnEarnings,
            lifetimeDelivered,
            lifetimeGross,
            returnedCount,
            thisMonthEarnings: Number(earnedThisMonth || 0),
            returnsThisMonth,
            combinedThisMonth: Number(earnedThisMonth || 0) + returnsThisMonth,
            totalNotes: notes.length,
            totalReturnNotes: returnNotes.length,
        };
    }, [notes, returnNotes, earnedThisMonth]);

    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return notes;
        const q = searchQuery.toLowerCase();
        return notes.filter(
            (n) =>
                n.reference.toLowerCase().includes(q) ||
                n.line_items.some((li) => (li.tracking_code || '').toLowerCase().includes(q))
        );
    }, [notes, searchQuery]);

    const filteredReturns = useMemo(() => {
        if (!searchQuery.trim()) return returnNotes;
        const q = searchQuery.toLowerCase();
        return returnNotes.filter(
            (n) =>
                n.reference.toLowerCase().includes(q) ||
                n.line_items.some((li) => (li.tracking_code || '').toLowerCase().includes(q))
        );
    }, [returnNotes, searchQuery]);

    const { toast } = useToast();
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [downloadingReturnId, setDownloadingReturnId] = useState<string | null>(null);
    const [readyBlob, setReadyBlob] = useState<{
        blob: Blob;
        filename: string;
        noteRef: string;
    } | null>(null);

    const { data: businessMeta } = useQuery({
        queryKey: ['courier-payments-business-meta', businessId],
        queryFn: async () => {
            if (!businessId) return null;
            const { data } = await (supabase as any)
                .from('businesses')
                .select('name, logo, legal_form, capital_social, ice, rc, patente, identifiant_fiscal, cnss, legal_address, legal_city, postal_code, business_phone, business_email, website, cachet_url, signature_url')
                .eq('id', businessId)
                .single();
            return (data || null) as (Record<string, string | null>) | null;
        },
        enabled: !!businessId,
        staleTime: 10 * 60_000,
    });

    const { data: resolvedImages } = useQuery({
        queryKey: [
            'courier-payments-pdf-images',
            businessMeta?.logo || null,
            me?.avatar_url || null,
        ],
        queryFn: async () => {
            return resolveCourierPayoutImages({
                businessLogo: businessMeta?.logo || null,
                courierAvatar: me?.avatar_url || null,
            });
        },
        enabled: !!businessMeta || !!me,
        staleTime: 30 * 60_000,
    });

    // Full branding (name + logo + legal fields) shared by both PDF builders — matches the facture footer.
    const pdfBusiness = {
        name: businessMeta?.name || 'iGrowFast',
        logo: resolvedImages?.businessLogo || null,
        legal_form: businessMeta?.legal_form ?? null,
        capital_social: businessMeta?.capital_social ?? null,
        ice: businessMeta?.ice ?? null,
        rc: businessMeta?.rc ?? null,
        patente: businessMeta?.patente ?? null,
        identifiant_fiscal: businessMeta?.identifiant_fiscal ?? null,
        cnss: businessMeta?.cnss ?? null,
        legal_address: businessMeta?.legal_address ?? null,
        legal_city: businessMeta?.legal_city ?? null,
        postal_code: businessMeta?.postal_code ?? null,
        business_phone: businessMeta?.business_phone ?? null,
        business_email: businessMeta?.business_email ?? null,
        website: businessMeta?.website ?? null,
        cachet_url: businessMeta?.cachet_url ?? null,
        signature_url: businessMeta?.signature_url ?? null,
    };

    const buildPdfInput = (note: PaymentNote): CourierPayoutPdfInput => ({
        reference: note.reference,
        status: note.status,
        total_amount: Number(note.total_amount || 0),
        total_shipping_fees: Number(note.total_shipping_fees || 0),
        net_amount: Number(note.net_amount || 0),
        order_count: note.order_count,
        paid_at: note.paid_at,
        created_at: note.created_at,
        line_items: note.line_items.map((li) => ({
            id: li.id,
            tracking_code: li.tracking_code,
            amount: Number(li.amount || 0),
            shipping_fee: Number(li.shipping_fee || 0),
        })),
        business: pdfBusiness,
        courier: {
            name: me?.name || 'Courier',
            avatar_url: resolvedImages?.courierAvatar || null,
        },
    });

    const handlePrint = async (note: PaymentNote) => {
        if (downloadingId) return;
        setDownloadingId(note.id);
        try {
            const input = buildPdfInput(note);
            const blob = await buildCourierPayoutPdfBlob(input);
            const filename = `${note.reference || 'courier-payout'}.pdf`;

            const result = await saveBlob(blob, {
                filename,
                title: `${note.reference} — Payout`,
                text: `Payout statement ${note.reference}`,
                mimeType: 'application/pdf',
            });

            switch (result.status) {
                case 'shared':
                    toast({ title: 'Enregistré', description: `${filename} a été enregistré via le partage système.` });
                    break;
                case 'downloaded':
                    toast({ title: 'Téléchargé', description: `${filename} est dans vos téléchargements.` });
                    break;
                case 'cancelled':
                    break;
                case 'opened':
                case 'unsupported':
                case 'failed':
                default:
                    setReadyBlob({ blob, filename, noteRef: note.reference });
                    break;
            }
        } catch (e: any) {
            console.error('[courier-payments] PDF generation failed', e);
            toast({
                title: 'Téléchargement impossible',
                description: e?.message || "Le PDF n'a pas pu être généré.",
                variant: 'destructive',
            });
        } finally {
            setDownloadingId(null);
        }
    };

    const handlePrintReturn = async (rn: ReturnNote) => {
        if (downloadingReturnId) return;
        setDownloadingReturnId(rn.id);
        try {
            const input: CourierReturnPdfInput = {
                reference: rn.reference,
                total_amount: Number(rn.total_amount || 0),
                total_shipping_fees: Number(rn.total_shipping_fees || 0),
                net_amount: Number(rn.net_amount || 0),
                order_count: rn.order_count,
                received_at: rn.received_at,
                created_at: rn.created_at,
                line_items: rn.line_items.map((li) => ({
                    id: li.id,
                    tracking_code: li.tracking_code,
                    amount: Number(li.amount || 0),
                    shipping_fee: Number(li.shipping_fee || 0),
                })),
                business: pdfBusiness,
                courier: { name: me?.name || 'Courier', avatar_url: resolvedImages?.courierAvatar || null },
            };
            const blob = await buildCourierReturnPdfBlob(input);
            const filename = `${rn.reference || 'courier-return'}.pdf`;
            const result = await saveBlob(blob, {
                filename,
                title: `${rn.reference} — Retour`,
                text: `Relevé de retour ${rn.reference}`,
                mimeType: 'application/pdf',
            });
            switch (result.status) {
                case 'shared':
                    toast({ title: 'Enregistré', description: `${filename} a été enregistré via le partage système.` });
                    break;
                case 'downloaded':
                    toast({ title: 'Téléchargé', description: `${filename} est dans vos téléchargements.` });
                    break;
                case 'cancelled':
                    break;
                default:
                    setReadyBlob({ blob, filename, noteRef: rn.reference });
                    break;
            }
        } catch (e: any) {
            console.error('[courier-returns] PDF generation failed', e);
            toast({
                title: 'Téléchargement impossible',
                description: e?.message || "Le PDF n'a pas pu être généré.",
                variant: 'destructive',
            });
        } finally {
            setDownloadingReturnId(null);
        }
    };

    const handleRetrySave = async () => {
        if (!readyBlob) return;
        const result = await saveBlob(readyBlob.blob, {
            filename: readyBlob.filename,
            title: `${readyBlob.noteRef} — Payout`,
            text: `Payout statement ${readyBlob.noteRef}`,
            mimeType: 'application/pdf',
        });

        if (result.status === 'shared' || result.status === 'downloaded') {
            setReadyBlob(null);
            toast({
                title: result.status === 'shared' ? 'Enregistré' : 'Téléchargé',
                description: `${readyBlob.filename} est sauvegardé.`,
            });
        } else if (result.status === 'cancelled') {
            // keep modal open
        } else {
            toast({
                title: 'Ouvrez le PDF manuellement',
                description: 'Utilisez le bouton "Ouvrir" puis le menu Partager.',
                variant: 'destructive',
            });
        }
    };

    const handleOpenInViewer = () => {
        if (!readyBlob) return;
        const url = URL.createObjectURL(readyBlob.blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    const kpiTiles = [
        { label: 'Gains cumulés', value: `${fmtMAD(stats.combinedEarnings)}`, unit: 'MAD', accent: 'bg-ant-green', sub: `Livraison ${fmtMAD(stats.deliveryEarnings)} · Retour ${fmtMAD(stats.returnEarnings)}` },
        { label: 'Ce mois-ci', value: `${fmtMAD(stats.combinedThisMonth)}`, unit: 'MAD', accent: 'bg-ant-orange', sub: `Livraison ${fmtMAD(stats.thisMonthEarnings)} · Retour ${fmtMAD(stats.returnsThisMonth)}` },
        { label: 'Livrés', value: String(stats.lifetimeDelivered), unit: 'colis', accent: 'bg-ant-ink', sub: `${stats.totalNotes} paiement${stats.totalNotes !== 1 ? 's' : ''}` },
        { label: 'Retournés', value: String(stats.returnedCount), unit: 'colis', accent: 'bg-ant-ink', sub: `${stats.totalReturnNotes} bon${stats.totalReturnNotes !== 1 ? 's' : ''}` },
    ];

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Livreur · Paiements
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Historique des paiements
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Vos gains — frais de livraison et frais de retour réglés par votre business.
                        </p>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                {kpiTiles.map((k) => (
                    <div key={k.label} className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('w-1 h-4 rounded-full', k.accent)} />
                            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">
                                {k.label}
                            </span>
                        </div>
                        <p className="font-display text-[20px] md:text-[24px] leading-none tabular-nums text-ant-ink">
                            {k.value}
                            <span className="text-[11px] text-ant-mid ml-1 font-normal tracking-normal">{k.unit}</span>
                        </p>
                        {k.sub && (
                            <p className="text-[9px] text-ant-mid tabular-nums leading-tight truncate">{k.sub}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Paiements / Retours toggle */}
            <div className="inline-flex p-1 rounded-full border border-ant-line bg-ant-paper gap-1">
                <button
                    type="button"
                    onClick={() => setView('payments')}
                    className={cn(
                        'h-8 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors',
                        view === 'payments' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                    )}
                >
                    Paiements
                    <span className="ml-1.5 font-normal tracking-normal opacity-70">{stats.totalNotes}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setView('returns')}
                    className={cn(
                        'h-8 px-4 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors',
                        view === 'returns' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                    )}
                >
                    Retours
                    <span className="ml-1.5 font-normal tracking-normal opacity-70">{stats.totalReturnNotes}</span>
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                <input
                    type="search"
                    placeholder="Rechercher par référence ou tracking…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-11 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                />
                {searchQuery && (
                    <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                        aria-label="Effacer"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="w-6 h-6 text-ant-mid animate-spin" />
                    <p className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">Chargement…</p>
                </div>
            ) : view === 'returns' ? (
                filteredReturns.length === 0 ? (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <div className="p-10 flex flex-col items-center gap-3 text-center">
                            <SearchX className="w-6 h-6 text-ant-mid" />
                            <div className="space-y-1">
                                <p className="font-display text-[14px] text-ant-ink">
                                    {searchQuery ? 'Aucun retour trouvé' : 'Aucun retour pour le moment'}
                                </p>
                                <p className="font-serif italic text-[12px] text-ant-mid max-w-xs mx-auto">
                                    {searchQuery
                                        ? 'Essayez un autre terme de recherche.'
                                        : 'Vos frais de retour apparaîtront ici une fois les colis reçus par votre business.'}
                                </p>
                            </div>
                        </div>
                    </section>
                ) : (
                    <>
                        {/* Mobile: return cards */}
                        <div className="md:hidden space-y-2">
                            {filteredReturns.map((rn) => {
                                const dateStr = rn.received_at
                                    ? format(new Date(rn.received_at), 'dd MMM yyyy', { locale: fr })
                                    : format(new Date(rn.created_at), 'dd MMM yyyy', { locale: fr });
                                return (
                                    <button
                                        key={rn.id}
                                        type="button"
                                        onClick={() => setSelectedReturn(rn)}
                                        className="w-full rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left active:scale-[0.995] transition-transform"
                                    >
                                        <div className="h-[3px] w-full bg-ant-orange" />
                                        <div className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1 space-y-1">
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                                        <RotateCcw className="w-2.5 h-2.5" />
                                                        Reçu
                                                    </span>
                                                    <p className="font-mono text-[12px] font-semibold text-ant-ink truncate">
                                                        {rn.reference}
                                                    </p>
                                                    <p className="text-[11px] text-ant-mid">{dateStr}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handlePrintReturn(rn); }}
                                                    disabled={downloadingReturnId === rn.id}
                                                    className="w-9 h-9 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors disabled:opacity-50 shrink-0"
                                                    aria-label="Télécharger PDF"
                                                >
                                                    {downloadingReturnId === rn.id
                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        : <Download className="w-3.5 h-3.5" />}
                                                </button>
                                            </div>
                                            <div className="flex items-end justify-between pt-2 border-t border-ant-line">
                                                <div>
                                                    <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid mb-0.5">Colis</p>
                                                    <p className="font-display text-[16px] tabular-nums text-ant-ink leading-none">
                                                        {rn.order_count}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid mb-0.5">Frais de retour</p>
                                                    <p className="font-display text-[18px] tabular-nums text-ant-green leading-none">
                                                        +{fmtMAD(rn.total_shipping_fees)}{' '}
                                                        <span className="text-[11px] text-ant-mid font-normal">MAD</span>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Desktop: return table */}
                        <section className="hidden md:block rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/40">
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Référence</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Reçu le</th>
                                        <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Colis</th>
                                        <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Frais de retour</th>
                                        <th className="px-4 py-3 w-16"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredReturns.map((rn) => {
                                        const dateStr = rn.received_at
                                            ? format(new Date(rn.received_at), 'dd MMM yyyy', { locale: fr })
                                            : format(new Date(rn.created_at), 'dd MMM yyyy', { locale: fr });
                                        return (
                                            <tr key={rn.id} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="space-y-1">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                                            <RotateCcw className="w-2.5 h-2.5" />
                                                            Reçu
                                                        </span>
                                                        <p className="font-mono text-[12px] font-semibold text-ant-ink">{rn.reference}</p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-[12px] text-ant-ink tabular-nums">{dateStr}</td>
                                                <td className="text-right px-4 py-3 text-[12px] text-ant-ink tabular-nums">{rn.order_count}</td>
                                                <td className="text-right px-4 py-3">
                                                    <p className="font-display text-[14px] tabular-nums text-ant-green">+{fmtMAD(rn.total_shipping_fees)}</p>
                                                    <p className="text-[10px] text-ant-mid tabular-nums">MAD</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedReturn(rn)}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                            title="Voir"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={downloadingReturnId === rn.id}
                                                            onClick={() => handlePrintReturn(rn)}
                                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors disabled:opacity-50"
                                                            title="Télécharger PDF"
                                                        >
                                                            {downloadingReturnId === rn.id
                                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                : <Download className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </section>
                    </>
                )
            ) : filteredNotes.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <SearchX className="w-6 h-6 text-ant-mid" />
                        <div className="space-y-1">
                            <p className="font-display text-[14px] text-ant-ink">
                                {searchQuery ? 'Aucun paiement trouvé' : 'Aucun paiement pour le moment'}
                            </p>
                            <p className="font-serif italic text-[12px] text-ant-mid max-w-xs mx-auto">
                                {searchQuery
                                    ? 'Essayez un autre terme de recherche.'
                                    : 'Vos paiements apparaîtront ici une fois versés par le business.'}
                            </p>
                        </div>
                    </div>
                </section>
            ) : (
                <>
                    {/* Mobile: card list */}
                    <div className="md:hidden space-y-2">
                        {filteredNotes.map((note) => {
                            const dateStr = note.paid_at
                                ? format(new Date(note.paid_at), 'dd MMM yyyy', { locale: fr })
                                : format(new Date(note.created_at), 'dd MMM yyyy', { locale: fr });
                            return (
                                <button
                                    key={note.id}
                                    type="button"
                                    onClick={() => setSelectedNote(note)}
                                    className="w-full rounded-2xl border border-ant-line bg-ant-paper overflow-hidden text-left active:scale-[0.995] transition-transform"
                                >
                                    <div className="h-[3px] w-full bg-ant-green" />
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-green/12 text-ant-green">
                                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                                    Payé
                                                </span>
                                                <p className="font-mono text-[12px] font-semibold text-ant-ink truncate">
                                                    {note.reference}
                                                </p>
                                                <p className="text-[11px] text-ant-mid">{dateStr}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); handlePrint(note); }}
                                                disabled={downloadingId === note.id}
                                                className="w-9 h-9 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors disabled:opacity-50 shrink-0"
                                                aria-label="Télécharger PDF"
                                            >
                                                {downloadingId === note.id
                                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    : <Download className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>

                                        <div className="flex items-end justify-between pt-2 border-t border-ant-line">
                                            <div>
                                                <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid mb-0.5">Colis</p>
                                                <p className="font-display text-[16px] tabular-nums text-ant-ink leading-none">
                                                    {note.order_count}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid mb-0.5">Gains</p>
                                                <p className="font-display text-[18px] tabular-nums text-ant-green leading-none">
                                                    +{fmtMAD(note.total_shipping_fees)}{' '}
                                                    <span className="text-[11px] text-ant-mid font-normal">MAD</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Desktop: table */}
                    <section className="hidden md:block rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-green" />
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/40">
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Référence</th>
                                    <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Payé le</th>
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Colis</th>
                                    <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Gains</th>
                                    <th className="px-4 py-3 w-24"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredNotes.map((note) => {
                                    const dateStr = note.paid_at
                                        ? format(new Date(note.paid_at), 'dd MMM yyyy', { locale: fr })
                                        : format(new Date(note.created_at), 'dd MMM yyyy', { locale: fr });
                                    return (
                                        <tr key={note.id} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="space-y-1">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-green/12 text-ant-green">
                                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                                        Payé
                                                    </span>
                                                    <p className="font-mono text-[12px] font-semibold text-ant-ink">{note.reference}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-[12px] text-ant-ink tabular-nums">{dateStr}</td>
                                            <td className="text-right px-4 py-3 text-[12px] text-ant-ink tabular-nums">{note.order_count}</td>
                                            <td className="text-right px-4 py-3">
                                                <p className="font-display text-[14px] tabular-nums text-ant-green">+{fmtMAD(note.total_shipping_fees)}</p>
                                                <p className="text-[10px] text-ant-mid tabular-nums">MAD</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedNote(note)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                                        title="Voir"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={downloadingId === note.id}
                                                        onClick={() => handlePrint(note)}
                                                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors disabled:opacity-50"
                                                        title="Télécharger PDF"
                                                    >
                                                        {downloadingId === note.id
                                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                            : <Download className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                </>
            )}

            {/* Detail sheet */}
            <PayoutDetailSheet
                note={selectedNote}
                onClose={() => setSelectedNote(null)}
                onPrint={() => selectedNote && handlePrint(selectedNote)}
                isDownloading={!!selectedNote && downloadingId === selectedNote.id}
            />

            {/* Return detail sheet */}
            <PayoutDetailSheet
                note={selectedReturn ? { ...selectedReturn, paid_at: selectedReturn.received_at } : null}
                variant="return"
                onClose={() => setSelectedReturn(null)}
                onPrint={() => selectedReturn && handlePrintReturn(selectedReturn)}
                isDownloading={!!selectedReturn && downloadingReturnId === selectedReturn.id}
            />

            {/* PDF ready modal */}
            <PdfReadyModal
                ready={readyBlob}
                onClose={() => setReadyBlob(null)}
                onSave={handleRetrySave}
                onOpen={handleOpenInViewer}
            />
        </div>
    );
};

export default CourierPayments;

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function PayoutDetailSheet({
    note,
    onClose,
    onPrint,
    isDownloading,
    variant = 'payment',
}: {
    note: (PaymentNote | (ReturnNote & { paid_at: string | null })) | null;
    onClose: () => void;
    onPrint: () => void;
    isDownloading: boolean;
    variant?: 'payment' | 'return';
}) {
    const isReturn = variant === 'return';
    return (
        <Dialog open={!!note} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className={cn(
                    'p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:max-w-[620px] sm:rounded-2xl sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}
            >
                {note && (
                    <div className="flex flex-col h-full max-h-[inherit]">
                        {/* Mobile drag handle */}
                        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                            <div className="w-10 h-1 rounded-full bg-ant-line" />
                        </div>

                        {/* Green stripe */}
                        <div className="h-[3px] w-full bg-ant-green shrink-0" />

                        {/* Header */}
                        <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-green" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            {isReturn ? 'Retour · Reçu' : 'Paiement · Reçu'}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-mono text-[18px] leading-tight text-ant-ink truncate">
                                        {note.reference}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        {note.paid_at
                                            ? `${isReturn ? 'Reçu' : 'Réglé'} le ${format(new Date(note.paid_at), 'dd MMMM yyyy · HH:mm', { locale: fr })}`
                                            : 'Date inconnue'}
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                    aria-label="Fermer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </DialogHeader>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* Earnings ink card */}
                            <div className="rounded-2xl bg-ant-ink text-ant-light p-4 md:p-5">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                        Vos gains
                                    </span>
                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-green/25 text-ant-light">
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                        Payé
                                    </span>
                                </div>
                                <p className="font-display text-[32px] tabular-nums leading-none text-ant-light">
                                    {fmtMAD(note.total_shipping_fees)}
                                    <span className="text-[13px] text-ant-light/60 ml-1 font-normal">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-light/60 mt-2">
                                    sur {note.order_count} colis {isReturn ? 'retourné' : 'livré'}{note.order_count !== 1 ? 's' : ''}
                                </p>
                            </div>

                            {/* Flow breakdown */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <div className="px-4 py-3 border-b border-ant-line">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[10px] text-ant-orange">01</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Flux financier
                                        </span>
                                    </div>
                                </div>
                                <div className="p-4 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] text-ant-mid">{isReturn ? 'Valeur des colis' : 'Total encaissé'}</span>
                                        <span className="font-display text-[13px] tabular-nums text-ant-ink">{fmtMAD(note.total_amount)} MAD</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] text-ant-green">{isReturn ? 'Vos frais de retour' : 'Vos frais de livraison'}</span>
                                        <span className="font-display text-[13px] tabular-nums text-ant-green">+{fmtMAD(note.total_shipping_fees)} MAD</span>
                                    </div>
                                    <div className="h-px bg-ant-line" />
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] text-ant-mid">Reversé au business</span>
                                        <span className="font-display text-[13px] tabular-nums text-ant-mid">{fmtMAD(note.net_amount)} MAD</span>
                                    </div>
                                </div>
                            </section>

                            {/* Parcels */}
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="h-[3px] w-full bg-ant-ink" />
                                <div className="px-4 py-3 border-b border-ant-line flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-display text-[10px] text-ant-orange">02</span>
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            {isReturn ? 'Colis retournés' : 'Colis réglés'}
                                        </span>
                                    </div>
                                    <span className="text-[11px] tabular-nums text-ant-mid">{note.line_items.length}</span>
                                </div>

                                {/* Mobile: stacked rows */}
                                <div className="sm:hidden divide-y divide-ant-line">
                                    {note.line_items.map((li, i) => (
                                        <div key={li.id} className="px-4 py-3 flex items-center gap-3">
                                            <span className="font-display text-[11px] tabular-nums text-ant-mid w-6 shrink-0">
                                                {String(i + 1).padStart(2, '0')}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1">
                                                    <Hash className="w-3 h-3 text-ant-mid shrink-0" />
                                                    <span className="font-mono text-[12px] text-ant-ink truncate">
                                                        {li.tracking_code || '—'}
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-ant-mid tabular-nums mt-0.5">
                                                    Commande {fmtMAD(li.amount)} MAD
                                                </p>
                                            </div>
                                            <p className="font-display text-[13px] tabular-nums text-ant-green shrink-0">
                                                +{fmtMAD(li.shipping_fee)}
                                            </p>
                                        </div>
                                    ))}
                                </div>

                                {/* Desktop: table */}
                                <table className="hidden sm:table w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light/40">
                                            <th className="text-left px-4 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid w-12">#</th>
                                            <th className="text-left px-4 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Tracking</th>
                                            <th className="text-right px-4 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Commande</th>
                                            <th className="text-right px-4 py-2 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Gains</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {note.line_items.map((li, i) => (
                                            <tr key={li.id} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/30 transition-colors">
                                                <td className="px-4 py-2 text-[11px] text-ant-mid tabular-nums">{String(i + 1).padStart(2, '0')}</td>
                                                <td className="px-4 py-2">
                                                    <div className="flex items-center gap-1">
                                                        <Hash className="w-3 h-3 text-ant-mid" />
                                                        <span className="font-mono text-[12px] text-ant-ink">{li.tracking_code || '—'}</span>
                                                    </div>
                                                </td>
                                                <td className="text-right px-4 py-2 text-[11px] text-ant-mid tabular-nums">{fmtMAD(li.amount)}</td>
                                                <td className="text-right px-4 py-2 font-display text-[13px] tabular-nums text-ant-green">+{fmtMAD(li.shipping_fee)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>
                        </div>

                        {/* Sticky footer */}
                        <div className="shrink-0 border-t border-ant-line bg-ant-paper px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 h-11 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                            >
                                Fermer
                            </button>
                            <button
                                type="button"
                                onClick={onPrint}
                                disabled={isDownloading}
                                className="flex-1 h-11 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 active:scale-[0.98] transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Génération…
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-3.5 h-3.5" />
                                        Télécharger PDF
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF ready modal
// ─────────────────────────────────────────────────────────────────────────────
function PdfReadyModal({
    ready,
    onClose,
    onSave,
    onOpen,
}: {
    ready: { blob: Blob; filename: string; noteRef: string } | null;
    onClose: () => void;
    onSave: () => void;
    onOpen: () => void;
}) {
    const directSupported = canDirectSave();

    return (
        <Dialog open={!!ready} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className={cn(
                    'p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:max-w-[440px] sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}
            >
                {ready && (
                    <div className="flex flex-col">
                        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
                            <div className="w-10 h-1 rounded-full bg-ant-line" />
                        </div>

                        <div className="h-[3px] w-full bg-ant-orange" />

                        <div className="px-5 pt-5 pb-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                            <div className="flex justify-center mb-4">
                                <div className="w-12 h-12 rounded-2xl bg-ant-light border border-ant-line flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-ant-ink" />
                                </div>
                            </div>

                            <div className="flex items-center justify-center gap-2 mb-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                    Document · Prêt
                                </span>
                            </div>
                            <DialogTitle className="font-display text-center text-[18px] text-ant-ink tracking-[-0.01em]">
                                PDF prêt
                            </DialogTitle>
                            <DialogDescription className="font-mono text-center text-[11px] text-ant-mid mt-1">
                                {ready.filename}
                            </DialogDescription>

                            <div className="mt-4 p-3 rounded-xl bg-ant-light border border-ant-line">
                                <p className="font-serif italic text-[12px] text-ant-mid leading-relaxed text-center">
                                    {directSupported
                                        ? 'Touchez « Enregistrer » pour sauvegarder le PDF dans vos fichiers.'
                                        : 'Touchez « Enregistrer » pour ouvrir la feuille de partage et choisir « Enregistrer dans Fichiers ».'}
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={onSave}
                                className="w-full mt-4 h-11 rounded-full bg-ant-ink text-ant-light font-medium text-[12px] flex items-center justify-center gap-2 hover:bg-ant-ink/95 active:scale-[0.98] transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                <Save className="w-3.5 h-3.5" />
                                Enregistrer
                            </button>

                            <button
                                type="button"
                                onClick={onOpen}
                                className="w-full mt-2 h-11 rounded-full border border-ant-line bg-ant-paper text-ant-ink font-medium text-[12px] flex items-center justify-center gap-2 hover:bg-ant-light transition-colors"
                            >
                                <Eye className="w-3.5 h-3.5" />
                                Ouvrir dans le visualiseur
                            </button>

                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full mt-2 h-9 rounded-full text-[11px] text-ant-mid hover:text-ant-ink transition-colors"
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
