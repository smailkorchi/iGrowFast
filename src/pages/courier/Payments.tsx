/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
    buildCourierPayoutPdfBlob,
    resolveCourierPayoutImages,
    type CourierPayoutPdfInput,
} from '@/lib/courierPayoutPdf';
import { saveBlob, canDirectSave } from '@/lib/saveBlob';
import { useToast } from '@/hooks/use-toast';
import {
    Wallet,
    Package,
    CheckCircle2,
    Eye,
    Download,
    Search,
    SearchX,
    Loader2,
    Hash,
    X,
    Receipt,
    FileText,
    Save,
    Calendar,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
    note: string | null;
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
    const [selectedNote, setSelectedNote] = useState<PaymentNote | null>(null);

    // ─── Current courier ───
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

    // ─── Fetch courier's PAID payment notes only ───
    const { data: notes = [], isLoading } = useQuery({
        queryKey: ['courier-payment-notes', courierId, businessId],
        queryFn: async () => {
            if (!courierId || !businessId) return [];
            const { data, error } = await (supabase as any)
                .from('courier_payment_notes')
                .select(
                    `id, reference, status, total_amount, total_shipping_fees, net_amount, order_count, paid_at, created_at, note,
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

    // ─── Aggregate stats ───
    const stats = useMemo(() => {
        const lifetimeEarnings = notes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const lifetimeDelivered = notes.reduce((s, n) => s + Number(n.order_count || 0), 0);
        const lifetimeGross = notes.reduce((s, n) => s + Number(n.total_amount || 0), 0);

        const now = new Date();
        const monthKey = format(now, 'yyyy-MM');
        const thisMonthNotes = notes.filter(
            (n) => n.paid_at && format(new Date(n.paid_at), 'yyyy-MM') === monthKey
        );
        const thisMonthEarnings = thisMonthNotes.reduce((s, n) => s + Number(n.total_shipping_fees || 0), 0);
        const thisMonthDelivered = thisMonthNotes.reduce((s, n) => s + Number(n.order_count || 0), 0);

        return {
            lifetimeEarnings,
            lifetimeDelivered,
            lifetimeGross,
            thisMonthEarnings,
            thisMonthDelivered,
            totalNotes: notes.length,
        };
    }, [notes]);

    // ─── Search filter ───
    const filteredNotes = useMemo(() => {
        if (!searchQuery.trim()) return notes;
        const q = searchQuery.toLowerCase();
        return notes.filter(
            (n) =>
                n.reference.toLowerCase().includes(q) ||
                n.line_items.some((li) => (li.tracking_code || '').toLowerCase().includes(q))
        );
    }, [notes, searchQuery]);

    // ─── PDF save flow ───────────────────────────────────────────────────
    const { toast } = useToast();
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [readyBlob, setReadyBlob] = useState<{
        blob: Blob;
        filename: string;
        noteRef: string;
    } | null>(null);

    // ── Fetch business meta once ───────────────────────────────────────
    const { data: businessMeta } = useQuery({
        queryKey: ['courier-payments-business-meta', businessId],
        queryFn: async () => {
            if (!businessId) return null;
            const { data } = await (supabase as any)
                .from('businesses')
                .select('name, logo')
                .eq('id', businessId)
                .single();
            return (data || null) as { name: string | null; logo: string | null } | null;
        },
        enabled: !!businessId,
        staleTime: 10 * 60_000,
    });

    // ── Pre-resolve remote images into data URIs ───────────────────────
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
        business: {
            name: businessMeta?.name || 'DigiCom',
            logo: resolvedImages?.businessLogo || null,
        },
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

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Payout History</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {me?.name || 'Courier'} · Settled payments
                        </p>
                    </div>
                </div>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { label: 'Lifetime Earned', value: `${fmtMAD(stats.lifetimeEarnings)} MAD`, accent: '#059669' },
                    { label: 'This Month', value: `${fmtMAD(stats.thisMonthEarnings)} MAD`, accent: '#3b5e5e' },
                    { label: 'Total Delivered', value: String(stats.lifetimeDelivered), accent: '#059669' },
                    { label: 'Payouts', value: String(stats.totalNotes), accent: '#3b5e5e' },
                ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: s.accent }} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 truncate">{s.label}</p>
                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none truncate">{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                    placeholder="Search by ref or tracking code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 rounded-md border-gray-200 bg-white text-[11px]"
                />
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
                    <p className="text-[11px] text-gray-400 uppercase tracking-widest">Chargement…</p>
                </div>
            ) : filteredNotes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white py-10 flex flex-col items-center gap-2 text-center">
                    <SearchX className="w-6 h-6 text-gray-400" />
                    <p className="text-[12px] font-semibold text-brand-navy">
                        {searchQuery ? 'Aucun paiement trouvé' : 'Aucun paiement pour le moment'}
                    </p>
                    <p className="text-[11px] text-gray-400 max-w-xs">
                        {searchQuery
                            ? 'Essayez un autre terme de recherche.'
                            : 'Vos payouts apparaîtront ici une fois versés par le business.'}
                    </p>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Reference</th>
                                <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400 hidden sm:table-cell">Paid on</th>
                                <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Delivered</th>
                                <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Earned</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredNotes.map((note) => {
                                const dateStr = note.paid_at
                                    ? format(new Date(note.paid_at), 'dd MMM yyyy')
                                    : format(new Date(note.created_at), 'dd MMM yyyy');
                                return (
                                    <tr key={note.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <span className="inline-flex items-center h-5 px-1.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-semibold">
                                                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                                                    Paid
                                                </span>
                                            </div>
                                            <p className="text-[11px] font-mono font-semibold text-brand-navy mt-0.5 truncate">{note.reference}</p>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums hidden sm:table-cell">{dateStr}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{note.order_count}</td>
                                        <td className="text-right px-3 py-2">
                                            <p className="text-[12px] font-semibold tabular-nums text-emerald-600">+{fmtMAD(note.total_shipping_fees)}</p>
                                            <p className="text-[9px] text-gray-400 tabular-nums">MAD</p>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 p-0 rounded text-gray-400 hover:text-brand-navy hover:bg-gray-100"
                                                    onClick={() => setSelectedNote(note)}
                                                    title="View"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 p-0 rounded text-gray-400 hover:text-brand-navy hover:bg-gray-100"
                                                    disabled={downloadingId === note.id}
                                                    onClick={() => handlePrint(note)}
                                                    title="Download PDF"
                                                >
                                                    {downloadingId === note.id
                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        : <Download className="w-3.5 h-3.5" />}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Detail sheet */}
            <PayoutDetailSheet
                note={selectedNote}
                onClose={() => setSelectedNote(null)}
                onPrint={() => selectedNote && handlePrint(selectedNote)}
                isDownloading={!!selectedNote && downloadingId === selectedNote.id}
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
}: {
    note: PaymentNote | null;
    onClose: () => void;
    onPrint: () => void;
    isDownloading: boolean;
}) {
    return (
        <Dialog open={!!note} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className={cn(
                    'p-0 border-none bg-white overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[600px] sm:rounded-xl sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-xl max-sm:!rounded-b-none'
                )}
            >
                {note && (
                    <div className="flex flex-col h-full max-h-[inherit]">
                        {/* Mobile drag handle */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-10 h-1 rounded-full bg-gray-200" />
                        </div>

                        {/* Header */}
                        <DialogHeader className="px-5 pt-4 pb-3 shrink-0 border-b border-gray-100">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="inline-flex items-center h-5 px-1.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-semibold">
                                            <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                                            Paid
                                        </span>
                                        <DialogDescription className="text-[10px] text-gray-400 m-0">
                                            {note.paid_at
                                                ? format(new Date(note.paid_at), 'dd MMM yyyy • HH:mm')
                                                : '—'}
                                        </DialogDescription>
                                    </div>
                                    <DialogTitle className="font-mono text-[14px] font-semibold text-brand-navy truncate">
                                        {note.reference}
                                    </DialogTitle>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="hidden sm:flex w-8 h-8 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-brand-navy transition"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </DialogHeader>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* KPI tiles */}
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { label: 'Earned', value: `${fmtMAD(note.total_shipping_fees)} MAD`, accent: '#059669' },
                                    { label: 'Delivered', value: String(note.order_count), accent: '#3b5e5e' },
                                    { label: 'Gross', value: `${fmtMAD(note.total_amount)} MAD`, accent: '#3b5e5e' },
                                ].map((s) => (
                                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-2.5 flex items-start gap-2">
                                        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: s.accent }} />
                                        <div className="min-w-0">
                                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                            <p className="text-[12px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none break-all">{s.value}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Flow breakdown */}
                            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2.5">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Flow Breakdown</p>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-gray-500">Total collected</span>
                                    <span className="text-[11px] font-semibold tabular-nums text-brand-navy">{fmtMAD(note.total_amount)} MAD</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-emerald-700">Your delivery fees</span>
                                    <span className="text-[11px] font-semibold tabular-nums text-emerald-600">+{fmtMAD(note.total_shipping_fees)} MAD</span>
                                </div>
                                <div className="h-px bg-gray-100" />
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-gray-400">Settled to business</span>
                                    <span className="text-[11px] font-semibold tabular-nums text-gray-400">{fmtMAD(note.net_amount)} MAD</span>
                                </div>
                            </div>

                            {/* Parcels table */}
                            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                                <div className="px-3 py-2 border-b border-gray-100">
                                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Parcels ({note.line_items.length})</p>
                                </div>
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">#</th>
                                            <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Tracking</th>
                                            <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Earned</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {note.line_items.map((li, i) => (
                                            <tr key={li.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                                <td className="px-3 py-2 text-[11px] text-gray-400 tabular-nums">{String(i + 1).padStart(2, '0')}</td>
                                                <td className="px-3 py-2">
                                                    <div className="flex items-center gap-1">
                                                        <Hash className="w-3 h-3 text-gray-400" />
                                                        <span className="text-[11px] font-mono text-brand-navy">{li.tracking_code || '—'}</span>
                                                    </div>
                                                    <p className="text-[9px] text-gray-400 tabular-nums mt-0.5">{fmtMAD(li.amount)} MAD order</p>
                                                </td>
                                                <td className="text-right px-3 py-2">
                                                    <p className="text-[11px] font-semibold tabular-nums text-emerald-600">+{fmtMAD(li.shipping_fee)}</p>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Sticky footer */}
                        <div className="shrink-0 border-t border-gray-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
                            <Button
                                variant="outline"
                                onClick={onClose}
                                className="flex-1 h-8 rounded-md text-[11px] font-semibold border-gray-200 text-brand-navy hover:bg-gray-50 sm:hidden"
                            >
                                Close
                            </Button>
                            <Button
                                onClick={onPrint}
                                disabled={isDownloading}
                                className="flex-1 h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white disabled:opacity-60"
                            >
                                {isDownloading ? (
                                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Génération…</>
                                ) : (
                                    <><Download className="w-3.5 h-3.5 mr-1.5" />Télécharger PDF</>
                                )}
                            </Button>
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
                    'p-0 border-none bg-white overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[440px] sm:rounded-xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!rounded-t-xl max-sm:!rounded-b-none'
                )}
            >
                {ready && (
                    <div className="flex flex-col">
                        <div className="sm:hidden flex justify-center pt-3 pb-1">
                            <div className="w-10 h-1 rounded-full bg-gray-200" />
                        </div>

                        <div className="px-5 pt-5 pb-5">
                            <div className="flex justify-center mb-4">
                                <div className="w-12 h-12 rounded-xl bg-brand-navy/5 border border-gray-100 flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-brand-navy/60" />
                                </div>
                            </div>

                            <DialogTitle className="text-center text-[14px] font-semibold text-brand-navy">
                                PDF prêt
                            </DialogTitle>
                            <DialogDescription className="text-center text-[11px] text-gray-400 mt-0.5">
                                {ready.filename}
                            </DialogDescription>

                            <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
                                <p className="text-[11px] text-gray-500 leading-relaxed text-center">
                                    {directSupported
                                        ? 'Touchez « Enregistrer » pour sauvegarder le PDF dans vos fichiers.'
                                        : 'Touchez « Enregistrer » pour ouvrir la feuille de partage et choisir « Enregistrer dans Fichiers ».'}
                                </p>
                            </div>

                            <Button
                                onClick={onSave}
                                className="w-full mt-4 h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white"
                            >
                                <Save className="w-3.5 h-3.5 mr-1.5" />
                                Enregistrer
                            </Button>

                            <Button
                                variant="ghost"
                                onClick={onOpen}
                                className="w-full mt-1.5 h-8 rounded-md text-[11px] font-semibold text-brand-navy/60 hover:bg-gray-50"
                            >
                                <Eye className="w-3.5 h-3.5 mr-1.5" />
                                Ouvrir dans le visualiseur
                            </Button>

                            <Button
                                variant="ghost"
                                onClick={onClose}
                                className="w-full mt-1 h-8 rounded-md text-[11px] text-gray-400 hover:bg-transparent hover:text-gray-500"
                            >
                                Annuler
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
