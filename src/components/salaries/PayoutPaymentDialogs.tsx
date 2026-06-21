import React, { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Plus, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { fmtCur, fmtCurFull } from '@/lib/formatNumbers';
import { sendSellerPayoutEmail, sendMediaBuyerPayoutEmail } from '@/lib/sendPayoutStatement';
import { cn } from '@/lib/utils';

/**
 * Two dialogs for partial-payout flow:
 *   1. `RecordPaymentDialog`  — admin types in an amount + note, inserts one
 *      txn against a payout row. Defaults to "settle the remaining balance"
 *      but can be set to any positive value up to the remaining. Triggers on
 *      the txn table keep the parent row's `paid_amount` + `status` in sync.
 *   2. `PaymentHistoryDialog` — shows every txn on a payout, with a delete
 *      button per row to reverse that specific disbursement.
 *
 * The same shape works for `seller_payments` and `mediabuyer_payments`; the
 * caller passes `kind` so the dialog hits the right txn table and FK column.
 */

export type PayoutKind = 'seller' | 'mediabuyer';

const txnTable = (k: PayoutKind) =>
    k === 'seller' ? 'seller_payment_txns' : 'mediabuyer_payment_txns';

const fkColumn = (k: PayoutKind) =>
    k === 'seller' ? 'seller_payment_id' : 'mediabuyer_payment_id';

const queryInvalidationKeys = (k: PayoutKind) =>
    k === 'seller'
        ? [
              'seller-payouts',
              'seller-payouts-stats',
              'seller-payment-txns',
              // live-owed hook keys so the dialog + list + profile re-derive after pay
              'seller-live-owed-users',
              'seller-live-owed-orders',
              'seller-live-owed-payments',
          ]
        : ['mb-payouts', 'mb-payouts-stats', 'mediabuyer-payment-txns', 'mediabuyer-ledger', 'mb-earnings-prior'];

// ── Record Payment Dialog ────────────────────────────────────────────────────
interface RecordPaymentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: PayoutKind;
    payoutId: string;            // may be '' for seller when no canonical row exists yet
    totalAmount: number;
    paidAmount: number;
    collaboratorName: string;
    businessId: string | null;
    currency?: string;
    // ── seller-only LIVE owed (Option 1). When kind==='seller' and
    //    sellerAccruedTotal is provided, the dialog displays/pays against live
    //    owed and lazily tops up the canonical payout row at pay time so the
    //    full accrued-but-unbilled commission is payable in one action.
    sellerAccruedTotal?: number;       // live accrued cash (matches the seller profile)
    sellerPaidAcrossRows?: number;     // Σ paid_amount across ALL the seller's rows
    sellerId?: string;                 // to INSERT a catch-up row when none exists
    sellerCanonicalRowTotal?: number;  // current total_amount of the canonical row (0 if none)
    sellerOtherRowsTotal?: number;     // Σ total_amount of the seller's OTHER rows
    // ── media-buyer ROLLING-LEDGER mode. When kind==='mediabuyer' and mbLiveId is
    //    provided, pay via the pay_mediabuyer RPC (ensures the open monthly ticket +
    //    carry-forward), mirroring the seller flow. Without it, falls back to the
    //    legacy direct txn insert against payoutId.
    mbLiveId?: string;                 // the mediabuyer_id to pay against the rolling ledger
}

export const RecordPaymentDialog: React.FC<RecordPaymentDialogProps> = ({
    open,
    onOpenChange,
    kind,
    payoutId,
    totalAmount,
    paidAmount,
    collaboratorName,
    businessId,
    currency = 'MAD',
    sellerAccruedTotal,
    sellerPaidAcrossRows,
    sellerId,
    sellerCanonicalRowTotal,
    sellerOtherRowsTotal,
    mbLiveId,
}) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Seller live-owed mode: display + pay against live accrued − paid, not the
    // frozen row's total_amount. mediabuyer keeps the row-based remaining.
    const isSellerLive = kind === 'seller' && sellerAccruedTotal != null;
    // Media-buyer rolling-ledger mode: pay via pay_mediabuyer (ensures open ticket + carry).
    const isMbLive = kind === 'mediabuyer' && mbLiveId != null;
    const displayTotal = isSellerLive ? Number(sellerAccruedTotal || 0) : Number(totalAmount || 0);
    const displayPaid = isSellerLive ? Number(sellerPaidAcrossRows || 0) : Number(paidAmount || 0);
    const remaining = Math.max(0, displayTotal - displayPaid);
    const [amount, setAmount] = useState<string>('');
    const [paidAt, setPaidAt] = useState<string>('');
    const [note, setNote] = useState('');

    // Reset on open so the dialog always starts with "pay the remaining balance".
    useEffect(() => {
        if (open) {
            setAmount(remaining > 0 ? remaining.toFixed(2) : '');
            setPaidAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
            setNote('');
        }
    }, [open, remaining]);

    const numericAmount = Number(amount || 0);
    const overpaying = numericAmount > remaining + 0.0001;
    const invalid = !numericAmount || numericAmount <= 0 || overpaying;

    const mutation = useMutation({
        mutationFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const paidAtIso = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();

            // ── Seller / media-buyer rolling ledger: pay via the RPC. It ensures the
            //    current open ticket exists, syncs its live earned, and records the
            //    disbursement against it (the open ticket holds all carried-forward
            //    debt → FIFO oldest-first by construction). created_by captured in-RPC.
            void user;
            if (isSellerLive) {
                const { error: rpcErr } = await (supabase as any).rpc('pay_seller', {
                    p_seller_id: sellerId, p_business_id: businessId, p_amount: numericAmount,
                    p_paid_at: paidAtIso, p_note: note.trim() || null,
                });
                if (rpcErr) throw rpcErr;
                return;
            }
            if (isMbLive) {
                const { error: rpcErr } = await (supabase as any).rpc('pay_mediabuyer', {
                    p_mb: mbLiveId, p_business_id: businessId, p_amount: numericAmount,
                    p_paid_at: paidAtIso, p_note: note.trim() || null,
                });
                if (rpcErr) throw rpcErr;
                return;
            }

            // ── Legacy fallback: single txn insert against an existing frozen row. ──
            const { error } = await (supabase as any).from(txnTable(kind)).insert({
                [fkColumn(kind)]: payoutId,
                amount: numericAmount,
                paid_at: paidAtIso,
                note: note.trim() || null,
                created_by: user?.id || null,
                'DigiCom Business': businessId,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            queryInvalidationKeys(kind).forEach((key) => {
                queryClient.invalidateQueries({ queryKey: [key] });
            });
            toast({
                title: 'Payment recorded',
                description: `${fmtCur(numericAmount, currency)} paid to ${collaboratorName}.`,
            });
            onOpenChange(false);

            // Fire-and-forget: email the collaborator a branded payout statement (PDF)
            // with the business's super admins in CC. Never blocks/undoes the payment.
            const paidAtIso = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString();
            const sent =
                isSellerLive && sellerId && businessId
                    ? sendSellerPayoutEmail({
                          sellerId,
                          businessId,
                          amountPaid: numericAmount,
                          paidAtIso,
                          accruedTotal: Number(sellerAccruedTotal || 0),
                          paidBefore: Number(sellerPaidAcrossRows || 0),
                      })
                    : kind === 'mediabuyer' && payoutId && businessId
                      ? sendMediaBuyerPayoutEmail({ payoutId, businessId, amountPaid: numericAmount, paidAtIso })
                      : null;
            if (sent) {
                sent.catch((e) => {
                    console.error('[payout-statement] email failed', e);
                    toast({
                        title: 'Paiement enregistré',
                        description: "Le relevé PDF n'a pas pu être envoyé par e-mail.",
                        variant: 'destructive',
                    });
                });
            }
        },
        onError: (err: any) =>
            toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                className="ant-surface w-[min(96vw,480px)] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden"
            >
                <DialogHeader className="px-5 py-4 border-b border-ant-line">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Record payment
                    </div>
                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-tight mt-1">
                        Pay {collaboratorName}
                    </DialogTitle>
                    <DialogDescription className="text-[12px] text-ant-mid mt-0.5">
                        Adds a new entry to the payment history. The remaining balance updates automatically.
                    </DialogDescription>
                </DialogHeader>

                <div className="px-5 py-4 space-y-4">
                    {/* Balance summary */}
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg border border-ant-line bg-ant-light/50 px-3 py-2">
                            <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-mid">Total earned</p>
                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums mt-0.5">
                                {fmtCurFull(displayTotal, currency)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-ant-green/25 bg-ant-green-soft/40 px-3 py-2">
                            <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-green">Already paid</p>
                            <p className="font-display text-[14px] font-semibold text-ant-green tabular-nums mt-0.5">
                                {fmtCurFull(displayPaid, currency)}
                            </p>
                        </div>
                        <div className="rounded-lg border border-ant-orange/25 bg-ant-orange-soft/30 px-3 py-2">
                            <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-ant-orange">Remaining</p>
                            <p className="font-display text-[14px] font-semibold text-ant-orange tabular-nums mt-0.5">
                                {fmtCurFull(remaining, currency)}
                            </p>
                        </div>
                    </div>

                    {/* Amount field */}
                    <div>
                        <label className="block text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1.5">
                            Amount to pay now
                        </label>
                        <div className="relative">
                            <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                max={remaining}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className={cn(
                                    'h-11 rounded-lg border bg-ant-paper text-[15px] font-display font-semibold text-ant-ink pr-14 pl-3 tabular-nums focus-visible:ring-ant-orange focus-visible:ring-offset-0',
                                    overpaying ? 'border-ant-rose/50 focus-visible:border-ant-rose/50' : 'border-ant-line',
                                )}
                                placeholder="0.00"
                                autoFocus
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-ant-mid">
                                {currency}
                            </span>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                            <button
                                type="button"
                                onClick={() => setAmount(remaining.toFixed(2))}
                                className="text-[10px] font-semibold text-ant-orange hover:underline underline-offset-2"
                            >
                                Set to remaining
                            </button>
                            {overpaying && (
                                <span className="text-[10px] font-semibold text-ant-rose">
                                    Exceeds remaining balance
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Date field */}
                    <div>
                        <label className="block text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1.5">
                            Payment date
                        </label>
                        <Input
                            type="datetime-local"
                            value={paidAt}
                            onChange={(e) => setPaidAt(e.target.value)}
                            className="h-10 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink focus-visible:ring-ant-orange focus-visible:ring-offset-0"
                        />
                    </div>

                    {/* Note field */}
                    <div>
                        <label className="block text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1.5">
                            Note <span className="text-ant-muted normal-case font-normal">— optional</span>
                        </label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Advance, bank transfer ref, cash in hand…"
                            className="min-h-[64px] rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink resize-y focus-visible:ring-ant-orange focus-visible:ring-offset-0"
                        />
                    </div>
                </div>

                <DialogFooter className="px-5 py-3 border-t border-ant-line bg-ant-light/50 flex flex-row items-center justify-between gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="h-9 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:bg-ant-paper hover:text-ant-ink"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={() => mutation.mutate()}
                        disabled={invalid || mutation.isPending}
                        className="h-9 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {mutation.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Wallet className="w-3.5 h-3.5" />
                        )}
                        <span className="ml-1.5">Generate payment</span>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// ── Payment History Dialog ───────────────────────────────────────────────────
interface PaymentHistoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: PayoutKind;
    payoutId: string;
    totalAmount: number;
    paidAmount: number;
    collaboratorName: string;
    businessId: string | null;
    currency?: string;
    onAddPayment: () => void;
}

type TxnRow = {
    id: string;
    amount: number;
    paid_at: string;
    note: string | null;
    created_at: string;
};

export const PaymentHistoryDialog: React.FC<PaymentHistoryDialogProps> = ({
    open,
    onOpenChange,
    kind,
    payoutId,
    totalAmount,
    paidAmount,
    collaboratorName,
    currency = 'MAD',
    onAddPayment,
}) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const remaining = Math.max(0, Number(totalAmount || 0) - Number(paidAmount || 0));

    const { data: txns = [], isLoading } = useQuery<TxnRow[]>({
        queryKey: [
            kind === 'seller' ? 'seller-payment-txns' : 'mediabuyer-payment-txns',
            payoutId,
        ],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from(txnTable(kind))
                .select('id, amount, paid_at, note, created_at')
                .eq(fkColumn(kind), payoutId)
                .order('paid_at', { ascending: false });
            if (error) throw error;
            return (data || []) as TxnRow[];
        },
        enabled: open && !!payoutId,
    });

    const deleteMutation = useMutation({
        mutationFn: async (txnId: string) => {
            const { error } = await (supabase as any).from(txnTable(kind)).delete().eq('id', txnId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryInvalidationKeys(kind).forEach((key) => {
                queryClient.invalidateQueries({ queryKey: [key] });
            });
            toast({ title: 'Payment reversed', description: 'The disbursement was removed and the balance updated.' });
        },
        onError: (err: any) =>
            toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const sumPaid = useMemo(() => txns.reduce((s, t) => s + Number(t.amount || 0), 0), [txns]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                className="ant-surface w-[min(96vw,560px)] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden"
            >
                <DialogHeader className="px-5 py-4 border-b border-ant-line">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Payment history
                    </div>
                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink tracking-tight mt-1">
                        {collaboratorName}
                    </DialogTitle>
                    <DialogDescription className="text-[12px] text-ant-mid mt-0.5 tabular-nums">
                        {fmtCurFull(sumPaid, currency)} paid · {fmtCurFull(remaining, currency)} remaining of {fmtCurFull(totalAmount, currency)}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-5 py-4 max-h-[420px] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
                        </div>
                    ) : txns.length === 0 ? (
                        <div className="py-10 text-center">
                            <p className="font-serif italic text-[12px] text-ant-mid">No payments recorded yet.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {txns.map((t) => (
                                <div
                                    key={t.id}
                                    className="flex items-start gap-3 rounded-xl border border-ant-line bg-ant-paper p-3 hover:border-ant-ink/15 transition-colors"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-ant-green-soft border border-ant-line flex items-center justify-center shrink-0">
                                        <Wallet className="w-4 h-4 text-ant-green" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <p className="font-display text-[14px] font-semibold text-ant-green tabular-nums">
                                                {fmtCurFull(Number(t.amount), currency)}
                                            </p>
                                            <p className="text-[10px] text-ant-mid tabular-nums shrink-0">
                                                {format(new Date(t.paid_at), 'dd MMM yyyy · HH:mm')}
                                            </p>
                                        </div>
                                        {t.note && (
                                            <p className="text-[11px] text-ant-mid mt-1 line-clamp-2">{t.note}</p>
                                        )}
                                    </div>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => {
                                            if (window.confirm('Reverse this payment? The balance will reopen by this amount.')) {
                                                deleteMutation.mutate(t.id);
                                            }
                                        }}
                                        disabled={deleteMutation.isPending}
                                        className="h-8 w-8 rounded-lg text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10 shrink-0"
                                        title="Reverse this payment"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="px-5 py-3 border-t border-ant-line bg-ant-light/50 flex flex-row items-center justify-between gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="h-9 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:bg-ant-paper hover:text-ant-ink"
                    >
                        Close
                    </Button>
                    {remaining > 0 && (
                        <Button
                            onClick={onAddPayment}
                            className="h-9 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="ml-1.5">Record another</span>
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
