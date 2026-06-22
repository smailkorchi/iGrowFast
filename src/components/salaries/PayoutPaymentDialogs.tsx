import React, { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Plus, Wallet, ArrowRight, ArrowLeft, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { sendSellerPayoutEmail, sendMediaBuyerPayoutEmail } from '@/lib/sendPayoutStatement';
import { attributePaymentOrders } from '@/lib/payoutOrderAttribution';
import { cn } from '@/lib/utils';

// ── Small presentational helpers for the pay modal ───────────────────────────
const LedgerRow: React.FC<{ label: string; value: string; sub?: string; strong?: boolean; muted?: boolean; green?: boolean }> = ({ label, value, sub, strong, muted, green }) => (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div>
            <p className={cn('text-[12px]', strong ? 'font-semibold text-ant-ink' : muted ? 'text-ant-mid' : 'text-ant-ink')}>{label}</p>
            {sub ? <p className="text-[10px] text-ant-mid mt-0.5 tabular-nums">{sub}</p> : null}
        </div>
        <span className={cn('text-[13px] tabular-nums shrink-0', strong ? 'font-display font-semibold text-ant-ink' : green ? 'font-semibold text-ant-green' : 'font-medium text-ant-ink')}>{value}</span>
    </div>
);
const PaySection: React.FC<{ title: string; count?: number; children: React.ReactNode }> = ({ title, count, children }) => (
    <div>
        <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">{title}</span>
            {count != null ? <span className="text-[10px] font-semibold text-ant-mid/70 tabular-nums">{count}</span> : null}
        </div>
        <div className="rounded-xl border border-ant-line bg-ant-paper px-2">{children}</div>
    </div>
);
const PayEmpty: React.FC<{ text: string }> = ({ text }) => <p className="text-[11.5px] text-ant-mid italic text-center py-4">{text}</p>;
const PayChip: React.FC<{ onClick: () => void; active?: boolean; children: React.ReactNode }> = ({ onClick, active, children }) => (
    <button type="button" onClick={onClick} className={cn('h-7 rounded-full px-3 text-[11px] font-semibold border transition cursor-pointer', active ? 'bg-ant-ink text-white border-ant-ink' : 'bg-ant-paper text-ant-mid border-ant-line hover:border-ant-ink/30 hover:text-ant-ink')}>{children}</button>
);

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
              // rolling-ledger keys → the Salaries table rows + KPIs (useSellerLedger)
              'seller-ledger-users',
              'seller-ledger-tickets',
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
    // ── rich ledger context for the 2-step review (all optional; degrade gracefully)
    collaboratorEmail?: string | null;
    collaboratorAvatarUrl?: string | null;
    collaboratorAvatarConfig?: unknown;
    rate?: number | null;                  // commission_price
    rateUnit?: 'unit' | 'order' | null;
    ticketId?: string | null;              // open ticket id → versements + (seller) orders
    ledgerMonth?: string | null;           // 'YYYY-MM-01' → month label + seller_month_orders
    carriedIn?: number | null;
    monthEarned?: number | null;
    delivered?: number | null;
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
    collaboratorEmail,
    collaboratorAvatarUrl,
    collaboratorAvatarConfig,
    rate,
    rateUnit,
    ticketId,
    ledgerMonth,
    carriedIn,
    monthEarned,
    delivered,
}) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Pay routing: seller → pay_seller, media buyer → pay_mediabuyer, else legacy insert.
    const isSellerLive = kind === 'seller' && (sellerId != null || sellerAccruedTotal != null);
    const isMbLive = kind === 'mediabuyer' && mbLiveId != null;

    // Ledger math (carry-aware): total = carried_in + month_earned; remaining = total − paid.
    const hasLedger = carriedIn != null || monthEarned != null;
    const ci = Number(carriedIn || 0);
    const me = Number(monthEarned || 0);
    const total = hasLedger ? ci + me : (isSellerLive ? Number(sellerAccruedTotal || 0) : Number(totalAmount || 0));
    const paid = hasLedger ? Number(paidAmount || 0) : (isSellerLive ? Number(sellerPaidAcrossRows || 0) : Number(paidAmount || 0));
    const remaining = Math.max(0, total - paid);
    const statusKind: 'paid' | 'partial' | 'pending' = remaining <= 0.005 && total > 0 ? 'paid' : paid > 0.005 ? 'partial' : 'pending';
    const monthLabel = ledgerMonth ? format(new Date(ledgerMonth), 'MMM yyyy') : '';
    // Plain 2-decimal money (currency token comes from the adjacent span, never doubled).
    const money = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const [step, setStep] = useState(0);
    const [amount, setAmount] = useState('');
    const [paidAt, setPaidAt] = useState('');

    // Reset on open → start on the review step with "pay the remaining balance".
    useEffect(() => {
        if (open) {
            setStep(0);
            setAmount(remaining > 0 ? remaining.toFixed(2) : '');
            setPaidAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
        }
    }, [open, remaining]);

    const numericAmount = Number(amount || 0);
    const overpaying = numericAmount > remaining + 0.0001;
    const invalid = !numericAmount || numericAmount <= 0 || overpaying;
    const afterRemaining = Math.max(0, remaining - numericAmount);

    // Versements already recorded against the open ticket this month.
    const { data: versements = [] } = useQuery({
        queryKey: ['paydlg-txns', kind, ticketId],
        enabled: open && !!ticketId,
        queryFn: async () => {
            const { data } = await (supabase as any).from(txnTable(kind))
                .select('id, amount, paid_at, note').eq(fkColumn(kind), ticketId).order('paid_at', { ascending: false });
            return (data || []) as { id: string; amount: number; paid_at: string; note: string | null }[];
        },
    });
    // Seller only: the delivered orders behind this month's commission (the "what").
    const { data: orderLines = [] } = useQuery({
        queryKey: ['paydlg-orders', sellerId, businessId, ledgerMonth],
        enabled: open && kind === 'seller' && !!sellerId && !!businessId && !!ledgerMonth,
        queryFn: async () => {
            const { data } = await (supabase as any).rpc('seller_month_orders', { p_seller: sellerId, p_business: businessId, p_month: ledgerMonth });
            return (data || []) as { order_id: string; client: string; phone: string; tracking: string | null; units: number; commission: number; delivered_at: string | null }[];
        },
    });
    // Collaborator bank coordinates — shown on the pay step (where the money goes).
    const collabId = sellerId ?? mbLiveId ?? null;
    const { data: bank } = useQuery({
        queryKey: ['paydlg-bank', collabId],
        enabled: open && !!collabId,
        queryFn: async () => {
            const { data } = await (supabase as any).from('users')
                .select('bank_name, bank_account_holder, bank_rib, cin_number').eq('id', collabId).maybeSingle();
            return (data || null) as { bank_name: string | null; bank_account_holder: string | null; bank_rib: string | null; cin_number: string | null } | null;
        },
    });
    const formatRib = (r?: string | null) => (r || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
    const hasBank = !!(bank?.bank_rib || bank?.bank_name || bank?.bank_account_holder);
    // FIFO: the orders THIS versement settles = the slice [already-paid, already-paid+amount].
    // Carried-in (prior-month debt) is settled first. Matches the emailed statement exactly.
    const paySlice = attributePaymentOrders(orderLines, ci, paid, paid + numericAmount);

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
                    p_paid_at: paidAtIso, p_note: null,
                });
                if (rpcErr) throw rpcErr;
                return;
            }
            if (isMbLive) {
                const { error: rpcErr } = await (supabase as any).rpc('pay_mediabuyer', {
                    p_mb: mbLiveId, p_business_id: businessId, p_amount: numericAmount,
                    p_paid_at: paidAtIso, p_note: null,
                });
                if (rpcErr) throw rpcErr;
                return;
            }

            // ── Legacy fallback: single txn insert against an existing frozen row. ──
            const { error } = await (supabase as any).from(txnTable(kind)).insert({
                [fkColumn(kind)]: payoutId,
                amount: numericAmount,
                paid_at: paidAtIso,
                note: null,
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
                className="ant-surface w-[min(96vw,540px)] p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden max-h-[92vh] flex flex-col"
            >
                {/* Header — collaborator identity */}
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line text-left space-y-0">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">Versement{monthLabel ? ` · ${monthLabel}` : ''}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <UserAvatar url={collaboratorAvatarUrl} config={collaboratorAvatarConfig} name={collaboratorName} className="h-11 w-11 shrink-0 rounded-xl border border-ant-line text-[13px] font-display font-semibold" />
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="font-display text-[17px] font-semibold text-ant-ink tracking-tight leading-tight truncate">{collaboratorName}</DialogTitle>
                            <DialogDescription className="text-[11.5px] text-ant-mid leading-tight truncate mt-0.5">
                                {collaboratorEmail || (kind === 'seller' ? 'Commercial' : 'Media buyer')}
                                {rate != null ? <span className="text-ant-mid/70"> · {rate} {currency}/{rateUnit === 'order' ? 'commande' : 'unité'}</span> : null}
                            </DialogDescription>
                        </div>
                        <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold shrink-0', kind === 'seller' ? 'bg-ant-ink/[0.06] text-ant-ink' : 'bg-ant-orange/10 text-ant-orange')}>
                            {kind === 'seller' ? 'Commercial' : 'Media buyer'}
                        </span>
                    </div>
                </DialogHeader>

                {/* Stepper */}
                <div className="px-6 pt-4 flex items-center gap-3 shrink-0">
                    {[{ i: 0, label: 'Aperçu' }, { i: 1, label: 'Régler' }].map((s, idx, arr) => {
                        const active = step >= s.i; const current = step === s.i;
                        return (
                            <React.Fragment key={s.i}>
                                <button type="button" onClick={() => { if (s.i < step) setStep(s.i); }} disabled={s.i > step} className="flex items-center gap-2 disabled:cursor-default cursor-pointer">
                                    <span className={cn('font-display w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums border transition-all', current ? 'bg-ant-ink text-white border-ant-ink' : active ? 'bg-ant-orange/10 text-ant-orange border-ant-orange/30' : 'bg-ant-paper text-ant-mid border-ant-line')}>{String(s.i + 1).padStart(2, '0')}</span>
                                    <span className={cn('text-[11px] font-medium uppercase tracking-[0.2em]', current ? 'text-ant-ink' : 'text-ant-mid')}>{s.label}</span>
                                </button>
                                {idx < arr.length - 1 && <div className={cn('flex-1 h-px', step > s.i ? 'bg-ant-orange' : 'bg-ant-line')} />}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="px-6 py-4 space-y-4 overflow-y-auto custom-scrollbar flex-1">
                    {step === 0 ? (
                        <>
                            {/* Hero — reste à payer */}
                            <div className="rounded-2xl bg-ant-ink text-ant-light p-5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-ant-light/55">Reste à payer</span>
                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold', statusKind === 'paid' ? 'bg-ant-green/20 text-ant-green' : statusKind === 'partial' ? 'bg-white/15 text-ant-light' : 'bg-ant-orange/20 text-ant-orange')}>
                                        <span className={cn('h-1.5 w-1.5 rounded-full', statusKind === 'paid' ? 'bg-ant-green' : statusKind === 'partial' ? 'bg-ant-light' : 'bg-ant-orange')} />
                                        {statusKind === 'paid' ? 'Réglé' : statusKind === 'partial' ? 'Partiel' : 'En attente'}
                                    </span>
                                </div>
                                <p className="font-display text-[34px] font-semibold tabular-nums tracking-[-0.02em] mt-1 leading-none">{money(remaining)}<span className="text-[14px] font-normal text-ant-light/50 ml-1.5">{currency}</span></p>
                                <div className="mt-4 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-ant-green transition-all" style={{ width: `${total > 0 ? Math.min(100, (paid / total) * 100) : 0}%` }} /></div>
                                <p className="text-[10.5px] text-ant-light/55 mt-1.5 tabular-nums">{money(paid)} versé sur {money(total)} {currency}</p>
                            </div>

                            {/* Ledger math */}
                            <div className="rounded-xl border border-ant-line bg-ant-paper divide-y divide-ant-line/70">
                                {ci !== 0 ? <LedgerRow label={ci > 0 ? 'Reporté des mois précédents' : 'Crédit reporté'} value={`${ci > 0 ? '+' : ''}${fmtCur(ci, currency)}`} muted /> : null}
                                <LedgerRow label={`Gagné${monthLabel ? ` · ${monthLabel}` : ''}`} value={`+${fmtCur(me, currency)}`} sub={delivered != null ? `${fmtNum(delivered)} ${kind === 'seller' ? (rateUnit === 'order' ? 'commandes' : 'unités') : 'livrées'}` : undefined} />
                                <LedgerRow label="Total dû" value={fmtCur(total, currency)} strong />
                                <LedgerRow label="Déjà versé" value={`−${fmtCur(paid, currency)}`} green={paid > 0} />
                            </div>

                            {/* Seller: orders behind the commission */}
                            {kind === 'seller' ? (
                                <PaySection title="Commandes du mois" count={orderLines.length}>
                                    {orderLines.length === 0 ? <PayEmpty text="Aucune commande livrée pour ce mois." /> : (
                                        <div className="max-h-[180px] overflow-y-auto custom-scrollbar divide-y divide-ant-line/60">
                                            {orderLines.map((o) => (
                                                <div key={o.order_id} className="flex items-center justify-between gap-3 py-2 px-1">
                                                    <div className="min-w-0"><p className="text-[12px] font-medium text-ant-ink truncate">{o.client || '—'}</p><p className="text-[10.5px] text-ant-mid font-mono truncate">{o.tracking || o.phone}</p></div>
                                                    <div className="text-right shrink-0"><p className="text-[12px] font-semibold text-ant-ink tabular-nums">{money(o.commission)} {currency}</p><p className="text-[10px] text-ant-mid tabular-nums">{fmtNum(o.units)} u.</p></div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </PaySection>
                            ) : null}

                            {/* Versements this month */}
                            <PaySection title="Versements ce mois" count={versements.length}>
                                {versements.length === 0 ? <PayEmpty text="Aucun versement enregistré pour ce mois." /> : (
                                    <div className="divide-y divide-ant-line/60">
                                        {versements.map((v) => (
                                            <div key={v.id} className="flex items-center justify-between gap-3 py-2 px-1">
                                                <div className="min-w-0"><p className="text-[12px] font-semibold text-ant-green tabular-nums">{money(v.amount)} {currency}</p>{v.note ? <p className="text-[10.5px] text-ant-mid truncate">{v.note}</p> : null}</div>
                                                <p className="text-[10.5px] text-ant-mid shrink-0">{v.paid_at ? format(new Date(v.paid_at), 'd MMM · HH:mm') : ''}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </PaySection>
                        </>
                    ) : (
                        <>
                            {/* Bank destination — where the money goes */}
                            <div className="rounded-2xl bg-ant-ink text-ant-light p-5 relative overflow-hidden">
                                <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/[0.04]" />
                                <div className="absolute -right-10 top-6 w-20 h-20 rounded-full bg-white/[0.03]" />
                                <div className="flex items-center justify-between relative">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-ant-light/55">Coordonnées bancaires</span>
                                    <Landmark className="w-4 h-4 text-ant-light/40" strokeWidth={1.75} />
                                </div>
                                {hasBank ? (
                                    <div className="relative">
                                        <p className="font-display text-[15px] font-semibold mt-2.5">{bank?.bank_name || '—'}</p>
                                        <p className="font-mono text-[15.5px] tracking-[0.16em] text-ant-light/90 mt-3 break-all">{formatRib(bank?.bank_rib) || '—'}</p>
                                        <div className="flex items-end justify-between mt-3.5 gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[9px] uppercase tracking-[0.2em] text-ant-light/40">Titulaire</p>
                                                <p className="text-[12px] font-medium mt-0.5 truncate">{bank?.bank_account_holder || collaboratorName}</p>
                                            </div>
                                            {bank?.cin_number ? (
                                                <div className="text-right shrink-0">
                                                    <p className="text-[9px] uppercase tracking-[0.2em] text-ant-light/40">CIN</p>
                                                    <p className="text-[12px] font-medium mt-0.5 tabular-nums">{bank.cin_number}</p>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-[12px] text-ant-light/55 italic mt-3 relative">Coordonnées bancaires non renseignées pour ce collaborateur.</p>
                                )}
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="block text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-2">Montant à verser</label>
                                <div className="relative">
                                    <Input type="number" step="0.01" min="0.01" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0.00"
                                        className={cn('h-14 rounded-xl border bg-ant-paper text-[24px] font-display font-semibold text-ant-ink pr-16 pl-4 tabular-nums focus-visible:ring-ant-orange focus-visible:ring-offset-0', overpaying ? 'border-ant-rose/50' : 'border-ant-line')} />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ant-mid">{currency}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <PayChip onClick={() => setAmount(remaining.toFixed(2))} active={Math.abs(numericAmount - remaining) < 0.005 && remaining > 0}>Tout · {fmtCur(remaining, currency)}</PayChip>
                                    <PayChip onClick={() => setAmount((remaining / 2).toFixed(2))}>Moitié</PayChip>
                                    {overpaying ? <span className="ml-auto text-[10.5px] font-semibold text-ant-rose">Dépasse le reste dû</span> : null}
                                </div>
                            </div>

                            {/* After-payment preview */}
                            <div className="rounded-xl border border-ant-line bg-ant-light/50 p-4 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-ant-mid">Reste après ce versement</p>
                                    <p className="font-display text-[20px] font-semibold tabular-nums mt-1 text-ant-ink">{money(afterRemaining)} <span className="text-[11px] text-ant-mid font-normal">{currency}</span></p>
                                </div>
                                <div className="text-right text-[11px] tabular-nums">
                                    <span className="text-ant-orange font-semibold">{fmtCur(remaining, currency)}</span> <span className="text-ant-mid">→</span> <span className={cn('font-semibold', afterRemaining <= 0.005 ? 'text-ant-green' : 'text-ant-ink')}>{fmtCur(afterRemaining, currency)}</span>
                                    {afterRemaining <= 0.005 && numericAmount > 0 ? <p className="text-ant-green font-semibold mt-0.5">Solde réglé ✓</p> : null}
                                </div>
                            </div>

                            {/* Seller: the orders THIS versement settles (FIFO, live with the amount) */}
                            {kind === 'seller' && numericAmount > 0 ? (
                                <PaySection title="Réglées par ce versement" count={paySlice.orders.length}>
                                    {paySlice.reportPortion > 0.005 ? (
                                        <div className="flex items-center justify-between gap-3 py-2 px-1 border-b border-ant-line/60">
                                            <p className="text-[12px] text-ant-mid">Report mois précédent</p>
                                            <p className="text-[12px] font-semibold text-ant-ink tabular-nums">{money(paySlice.reportPortion)} {currency}</p>
                                        </div>
                                    ) : null}
                                    {paySlice.orders.length === 0 && paySlice.reportPortion <= 0.005 ? (
                                        <PayEmpty text="Aucune commande couverte par ce montant." />
                                    ) : (
                                        <div className="max-h-[180px] overflow-y-auto custom-scrollbar divide-y divide-ant-line/60">
                                            {paySlice.orders.map((o) => (
                                                <div key={o.order_id} className="flex items-center justify-between gap-3 py-2 px-1">
                                                    <div className="min-w-0"><p className="text-[12px] font-medium text-ant-ink truncate">{o.client || '—'}{o.partial ? <span className="text-ant-orange font-normal"> · partiel</span> : null}</p><p className="text-[10.5px] text-ant-mid font-mono truncate">{o.tracking || o.phone}</p></div>
                                                    <div className="text-right shrink-0"><p className="text-[12px] font-semibold text-ant-ink tabular-nums">{money(o.paidPortion)} {currency}</p><p className="text-[10px] text-ant-mid tabular-nums">{fmtNum(o.units)} u.</p></div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </PaySection>
                            ) : null}

                            <div>
                                <label className="block text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1.5">Date du versement</label>
                                <Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="h-10 rounded-lg border border-ant-line bg-ant-paper text-[12px] text-ant-ink focus-visible:ring-ant-orange focus-visible:ring-offset-0" />
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <DialogFooter className="px-6 py-4 border-t border-ant-line bg-ant-light/40 flex-row items-center justify-between gap-2 shrink-0">
                    {step === 0 ? (
                        <>
                            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:bg-ant-paper hover:text-ant-ink">Annuler</Button>
                            <Button onClick={() => setStep(1)} disabled={remaining <= 0.005} className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                                {remaining <= 0.005 ? 'Rien à régler' : 'Régler'} <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" onClick={() => setStep(0)} className="h-10 px-4 rounded-full text-[12px] font-semibold text-ant-mid hover:bg-ant-paper hover:text-ant-ink gap-1.5"><ArrowLeft className="w-3.5 h-3.5" /> Retour</Button>
                            <Button onClick={() => mutation.mutate()} disabled={invalid || mutation.isPending} className="h-10 px-5 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                                {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                                Confirmer{numericAmount > 0 ? ` · ${money(numericAmount)} ${currency}` : ''}
                            </Button>
                        </>
                    )}
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
