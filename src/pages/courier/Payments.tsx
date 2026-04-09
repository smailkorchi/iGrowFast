/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { downloadCourierPayoutPdf } from '@/lib/courierPayoutPdf';
import { useToast } from '@/hooks/use-toast';
import {
    Wallet,
    TrendingUp,
    Package,
    CheckCircle2,
    Eye,
    Download,
    Search,
    SearchX,
    Loader2,
    Hash,
    Calendar,
    X,
    Sparkles,
    ArrowDown,
    Receipt,
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

    // ─── Download premium PDF payout (same page, no popup, no print dialog) ───
    // Uses @react-pdf/renderer to build a real PDF blob client-side and
    // triggers a direct download. Works identically on iOS Safari, Chrome
    // Android, and desktop — the user stays on this page and the file
    // lands in their Downloads / Files app.
    const { toast } = useToast();
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const handlePrint = async (note: PaymentNote) => {
        if (downloadingId) return;
        setDownloadingId(note.id);
        try {
            // Resolve business name + logo if not already fetched
            let businessName = 'DigiCom';
            let businessLogo: string | null = null;
            if (businessId) {
                const { data } = await (supabase as any)
                    .from('businesses')
                    .select('name, logo')
                    .eq('id', businessId)
                    .single();
                if (data) {
                    businessName = data.name || businessName;
                    businessLogo = data.logo || null;
                }
            }

            await downloadCourierPayoutPdf({
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
                business: { name: businessName, logo: businessLogo },
                courier: {
                    name: me?.name || 'Courier',
                    avatar_url: me?.avatar_url || null,
                },
            });

            toast({
                title: 'PDF téléchargé',
                description: `${note.reference}.pdf est dans vos téléchargements.`,
            });
        } catch (e: any) {
            console.error('[courier-payments] PDF download failed', e);
            toast({
                title: 'Téléchargement impossible',
                description: e?.message || 'Le PDF n\'a pas pu être généré.',
                variant: 'destructive',
            });
        } finally {
            setDownloadingId(null);
        }
    };

    return (
        <div className="space-y-5 sm:space-y-6 pb-28 sm:pb-6">
            {/* ─── Hero: lifetime earnings ─── */}
            <div className="relative overflow-hidden rounded-[28px] sm:rounded-[36px] bg-gradient-to-br from-brand-navy via-[#2d4747] to-[#1f3535] text-white shadow-2xl">
                <div className="absolute -top-20 -right-20 w-[280px] h-[280px] rounded-full bg-emerald-300/20 blur-3xl" />
                <div className="absolute -bottom-24 -left-10 w-[220px] h-[220px] rounded-full bg-brand-white/5 blur-3xl" />

                <div className="relative p-6 sm:p-10 space-y-6 sm:space-y-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-200/75">
                                Lifetime Earnings
                            </p>
                            <h1 className="text-xs sm:text-sm font-semibold text-white/50">
                                {me?.name || 'Courier'}
                            </h1>
                        </div>
                        <div className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-300/15 backdrop-blur-md border border-emerald-300/20 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-200" />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-5xl sm:text-7xl font-black tracking-tight text-emerald-200 tabular-nums leading-none">
                                {fmtMAD(stats.lifetimeEarnings)}
                            </span>
                            <span className="text-lg sm:text-2xl font-bold text-emerald-200/50">MAD</span>
                        </div>
                        <p className="mt-3 text-[11px] sm:text-xs font-semibold text-white/40 flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-emerald-300/60" />
                            From {stats.lifetimeDelivered} delivered parcels across {stats.totalNotes} payout{stats.totalNotes !== 1 ? 's' : ''}
                        </p>
                    </div>

                    {/* Mini stats grid */}
                    <div className="grid grid-cols-2 gap-3 pt-5 border-t border-white/10">
                        <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Calendar className="w-3 h-3 text-white/30" />
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">
                                    This Month
                                </p>
                            </div>
                            <p className="text-xl sm:text-2xl font-black text-white tabular-nums">
                                {fmtMAD(stats.thisMonthEarnings)}
                                <span className="text-[10px] font-bold text-white/30 ml-1">MAD</span>
                            </p>
                            <p className="text-[10px] font-semibold text-white/30 mt-0.5">
                                {stats.thisMonthDelivered} parcels
                            </p>
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Package className="w-3 h-3 text-white/30" />
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">
                                    Gross Collected
                                </p>
                            </div>
                            <p className="text-xl sm:text-2xl font-black text-white tabular-nums">
                                {fmtMAD(stats.lifetimeGross)}
                                <span className="text-[10px] font-bold text-white/30 ml-1">MAD</span>
                            </p>
                            <p className="text-[10px] font-semibold text-white/30 mt-0.5">Handled lifetime</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Title + search ─── */}
            <div className="space-y-3">
                <div className="flex items-end justify-between gap-3 px-1">
                    <div>
                        <h2 className="text-lg sm:text-2xl font-black text-brand-navy tracking-tight">
                            Payout History
                        </h2>
                        <p className="text-[11px] sm:text-xs font-semibold text-brand-navy/45">
                            Settled payments from the business
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                            Paid Only
                        </span>
                    </div>
                </div>

                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                    <Input
                        placeholder="Search by ref or tracking code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-12 sm:h-14 pl-11 sm:pl-12 pr-4 rounded-2xl sm:rounded-[20px] border-none bg-white shadow-sm font-bold text-brand-navy placeholder:text-brand-navy/30 focus-visible:ring-brand-navy/10"
                    />
                </div>
            </div>

            {/* ─── List ─── */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 className="w-8 h-8 text-brand-navy/40 animate-spin" />
                    <p className="text-xs font-bold text-brand-navy/40 uppercase tracking-widest">Chargement…</p>
                </div>
            ) : filteredNotes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 sm:py-20 gap-4 text-center px-6">
                    <div className="w-16 h-16 rounded-3xl bg-brand-navy/[0.04] flex items-center justify-center">
                        <SearchX className="w-7 h-7 text-brand-navy/30" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-bold text-brand-navy">
                            {searchQuery ? 'Aucun paiement trouvé' : 'Aucun paiement pour le moment'}
                        </p>
                        <p className="text-xs text-brand-navy/40 font-medium max-w-xs">
                            {searchQuery
                                ? 'Essayez un autre terme de recherche.'
                                : 'Vos payouts apparaîtront ici une fois versés par le business.'}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredNotes.map((note) => (
                        <PayoutCard
                            key={note.id}
                            note={note}
                            onOpen={() => setSelectedNote(note)}
                            onPrint={() => handlePrint(note)}
                            isDownloading={downloadingId === note.id}
                        />
                    ))}
                </div>
            )}

            {/* ─── Detail sheet ─── */}
            <PayoutDetailSheet
                note={selectedNote}
                onClose={() => setSelectedNote(null)}
                onPrint={() => selectedNote && handlePrint(selectedNote)}
                isDownloading={!!selectedNote && downloadingId === selectedNote.id}
            />
        </div>
    );
};

export default CourierPayments;

// ─────────────────────────────────────────────────────────────────────────────
// Payout card
// ─────────────────────────────────────────────────────────────────────────────
function PayoutCard({
    note,
    onOpen,
    onPrint,
    isDownloading,
}: {
    note: PaymentNote;
    onOpen: () => void;
    onPrint: () => void;
    isDownloading: boolean;
}) {
    const dateStr = note.paid_at
        ? format(new Date(note.paid_at), 'dd MMM yyyy')
        : format(new Date(note.created_at), 'dd MMM yyyy');

    return (
        <div className="group relative bg-white rounded-[22px] sm:rounded-[28px] border border-brand-navy/[0.05] shadow-sm hover:shadow-lg hover:border-brand-navy/15 transition-all duration-300 overflow-hidden">
            <div className="h-[3px] w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600" />

            <button
                type="button"
                onClick={onOpen}
                className="w-full text-left p-4 sm:p-5 active:scale-[0.995] transition-transform"
            >
                {/* Row 1 */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Paid
                            </span>
                            <span className="text-[10px] font-bold text-brand-navy/40">{dateStr}</span>
                        </div>
                        <p className="mt-1.5 font-mono text-sm sm:text-base font-black text-brand-navy tracking-tight truncate">
                            {note.reference}
                        </p>
                    </div>

                    <div className="text-right shrink-0">
                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/35">Earned</p>
                        <div className="flex items-baseline gap-1 justify-end">
                            <span className="text-xl sm:text-2xl font-black text-emerald-600 tabular-nums leading-none">
                                +{fmtMAD(note.total_shipping_fees)}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-600/50">MAD</span>
                        </div>
                    </div>
                </div>

                {/* Row 2 */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/65">
                        <Package className="w-3 h-3 text-brand-navy/35" />
                        {note.order_count} delivered
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/65">
                        <Wallet className="w-3 h-3 text-brand-navy/35" />
                        {fmtMAD(note.total_amount)} collected
                    </span>
                </div>
            </button>

            {/* Actions — 44px+ touch targets */}
            <div className="px-3 pb-3 sm:px-4 sm:pb-4 grid grid-cols-2 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpen();
                    }}
                    className="h-11 rounded-xl font-bold text-xs border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5"
                >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    View
                </Button>
                <Button
                    size="sm"
                    disabled={isDownloading}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPrint();
                    }}
                    className="h-11 rounded-xl font-bold text-xs bg-brand-navy hover:bg-brand-navy/90 text-white disabled:opacity-60"
                >
                    {isDownloading ? (
                        <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            Génération…
                        </>
                    ) : (
                        <>
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            PDF
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet (mobile bottom sheet / desktop dialog)
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
                    'p-0 border-none bg-brand-white overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[600px] sm:rounded-[32px] sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-[28px] max-sm:!rounded-b-none'
                )}
            >
                {note && (
                    <div className="flex flex-col h-full max-h-[inherit]">
                        {/* Mobile drag handle */}
                        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-12 h-1.5 rounded-full bg-brand-navy/10" />
                        </div>

                        {/* Header */}
                        <DialogHeader className="px-5 sm:px-8 pt-3 sm:pt-8 pb-4 shrink-0 border-b border-brand-navy/5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-wider">
                                            <CheckCircle2 className="w-2.5 h-2.5" />
                                            Paid
                                        </span>
                                        <DialogDescription className="text-[10px] font-bold text-brand-navy/40 m-0">
                                            {note.paid_at
                                                ? format(new Date(note.paid_at), 'dd MMM yyyy • HH:mm')
                                                : '—'}
                                        </DialogDescription>
                                    </div>
                                    <DialogTitle className="font-mono text-lg sm:text-2xl font-black text-brand-navy truncate">
                                        {note.reference}
                                    </DialogTitle>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="hidden sm:flex w-10 h-10 shrink-0 items-center justify-center rounded-full hover:bg-brand-navy/5 text-brand-navy/50 hover:text-brand-navy transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </DialogHeader>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 space-y-5">
                            {/* Earnings hero */}
                            <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-brand-navy via-[#2d4747] to-[#1f3535] text-white p-6 sm:p-7">
                                <div className="absolute -top-16 -right-16 w-[200px] h-[200px] rounded-full bg-emerald-300/15 blur-3xl" />
                                <div className="relative">
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-200/75 mb-3">
                                        Your Earnings
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-4xl sm:text-5xl font-black text-emerald-200 tabular-nums leading-none">
                                            {fmtMAD(note.total_shipping_fees)}
                                        </span>
                                        <span className="text-base sm:text-xl font-bold text-emerald-200/50">MAD</span>
                                    </div>
                                    <p className="mt-3 text-[11px] font-semibold text-white/40">
                                        Delivery fees for {note.order_count} successfully delivered parcel
                                        {note.order_count !== 1 ? 's' : ''}
                                    </p>
                                </div>
                            </div>

                            {/* Context stats */}
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="p-3.5 rounded-2xl bg-white border border-brand-navy/[0.06]">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Package className="w-3 h-3 text-brand-navy/30" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">
                                            Delivered
                                        </p>
                                    </div>
                                    <p className="text-lg font-black text-brand-navy tabular-nums">{note.order_count}</p>
                                </div>
                                <div className="p-3.5 rounded-2xl bg-white border border-brand-navy/[0.06]">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Wallet className="w-3 h-3 text-brand-navy/30" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">
                                            Gross
                                        </p>
                                    </div>
                                    <p className="text-lg font-black text-brand-navy tabular-nums">
                                        {fmtMAD(note.total_amount)}
                                        <span className="text-[9px] font-bold text-brand-navy/30 ml-1">MAD</span>
                                    </p>
                                </div>
                            </div>

                            {/* Flow breakdown */}
                            <div className="rounded-2xl bg-white border border-brand-navy/[0.06] p-4 sm:p-5 space-y-3.5">
                                <div className="flex items-center gap-2 mb-1">
                                    <Receipt className="w-3.5 h-3.5 text-brand-navy/40" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        Flow Breakdown
                                    </p>
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-brand-navy/60">Total collected</span>
                                    <span className="text-sm font-black text-brand-navy tabular-nums">
                                        {fmtMAD(note.total_amount)}{' '}
                                        <span className="text-[10px] font-bold text-brand-navy/30">MAD</span>
                                    </span>
                                </div>

                                <div className="relative pl-6">
                                    <ArrowDown className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-navy/25" />
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-emerald-700">Your delivery fees</span>
                                        <span className="text-sm font-black text-emerald-600 tabular-nums">
                                            +{fmtMAD(note.total_shipping_fees)}{' '}
                                            <span className="text-[10px] font-bold text-emerald-600/50">MAD</span>
                                        </span>
                                    </div>
                                </div>

                                <div className="h-px bg-brand-navy/5" />

                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-brand-navy/50">Settled to business</span>
                                    <span className="text-sm font-black text-brand-navy/50 tabular-nums">
                                        {fmtMAD(note.net_amount)}{' '}
                                        <span className="text-[10px] font-bold text-brand-navy/25">MAD</span>
                                    </span>
                                </div>
                            </div>

                            {/* Parcels */}
                            <div>
                                <div className="flex items-center justify-between mb-2.5 px-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-navy/50">
                                        Parcels ({note.line_items.length})
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    {note.line_items.map((li, i) => (
                                        <div
                                            key={li.id}
                                            className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-brand-navy/[0.05]"
                                        >
                                            <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-navy/[0.04] flex items-center justify-center">
                                                <span className="text-[10px] font-black text-brand-navy/40 tabular-nums">
                                                    {String(i + 1).padStart(2, '0')}
                                                </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1">
                                                    <Hash className="w-3 h-3 text-brand-navy/30 shrink-0" />
                                                    <p className="font-mono text-xs font-black text-brand-navy truncate">
                                                        {li.tracking_code || '—'}
                                                    </p>
                                                </div>
                                                <p className="text-[10px] font-semibold text-brand-navy/40 tabular-nums mt-0.5">
                                                    {fmtMAD(li.amount)} MAD order
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600/60">
                                                    Earned
                                                </p>
                                                <p className="text-sm font-black text-emerald-600 tabular-nums">
                                                    +{fmtMAD(li.shipping_fee)}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Sticky footer */}
                        <div className="shrink-0 border-t border-brand-navy/5 bg-white p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
                            <Button
                                variant="outline"
                                onClick={onClose}
                                className="flex-1 h-12 rounded-2xl font-bold border-brand-navy/10 text-brand-navy hover:bg-brand-navy/5 sm:hidden"
                            >
                                Close
                            </Button>
                            <Button
                                onClick={onPrint}
                                disabled={isDownloading}
                                className="flex-1 h-12 rounded-2xl font-bold bg-brand-navy hover:bg-brand-navy/90 text-white shadow-xl shadow-brand-navy/20 disabled:opacity-60"
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Génération du PDF…
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4 mr-2" />
                                        Télécharger le PDF
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
