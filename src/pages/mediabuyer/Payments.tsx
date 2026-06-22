/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
    Loader2,
    Calendar,
    Info,
    CheckCircle2,
    Eye,
    Coins,
    Banknote,
    ArrowDownRight,
    Megaphone,
    Wallet,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Payout = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    payment_type: 'commission' | 'salary';
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    paid_amount: number | string;
    delivered_orders: number;
    total_spend: number | string;
    campaigns_count: number;
    bank_snapshot: any;
    status: 'pending' | 'partial' | 'paid';
    created_at: string;
    paid_at: string | null;
};

type Txn = {
    mediabuyer_payment_id: string;
    amount: number;
    paid_at: string;
    note: string | null;
};

type UserProfile = {
    id: string;
    name: string;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
};

const Payments: React.FC = () => {
    const currentUserId = useCurrentUserId();
    const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []);

    const { data: profile } = useQuery<UserProfile | null>({
        queryKey: ['mb-payments-profile', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, payment_type, commission_price, salary_amount, bank_name, bank_account_holder, bank_rib, cin_number')
                .eq('id', currentUserId)
                .single();
            return (data || null) as UserProfile | null;
        },
        enabled: !!currentUserId,
    });

    const { data: payouts = [], isLoading: loadingPayouts } = useQuery<Payout[]>({
        queryKey: ['mb-payments-list', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('*')
                .eq('mediabuyer_id', currentUserId)
                .order('payout_month', { ascending: false });
            if (error) throw error;
            return (data || []) as Payout[];
        },
        enabled: !!currentUserId,
    });

    // Real payment dates + amounts come from the txns (now readable by the owning
    // media buyer via RLS). Group by payout so "Versé le" reflects when money
    // actually landed and the eye modal can list every versement.
    const payoutIds = useMemo(() => payouts.map((p) => p.id), [payouts]);
    const { data: txns = [] } = useQuery<Txn[]>({
        queryKey: ['mb-payments-txns', currentUserId, payoutIds.join(',')],
        queryFn: async () => {
            if (payoutIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payment_txns')
                .select('mediabuyer_payment_id, amount, paid_at, note')
                .in('mediabuyer_payment_id', payoutIds)
                .order('paid_at', { ascending: false });
            if (error) throw error;
            return (data || []) as Txn[];
        },
        enabled: payoutIds.length > 0,
    });

    const txnsByPayout = useMemo(() => {
        const m: Record<string, Txn[]> = {};
        for (const t of txns) (m[t.mediabuyer_payment_id] = m[t.mediabuyer_payment_id] || []).push({ ...t, amount: Number(t.amount) || 0 });
        return m;
    }, [txns]);
    // Latest real payment date for a payout (txn date, else the ticket paid_at).
    const settledDate = (p: Payout): string | null => txnsByPayout[p.id]?.[0]?.paid_at || p.paid_at || null;

    const [selected, setSelected] = useState<Payout | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const { rows: allRows, isLoading: loadingEarnings } = useMediaBuyerEarnings(currentMonth);
    const myEarnings = useMemo(() => allRows.find((r) => r.mediabuyer_id === currentUserId) || null, [allRows, currentUserId]);

    const stats = useMemo(() => {
        // Partial-payout-aware: paid = sum of trigger-maintained paid_amount,
        // pending = sum of (total − paid). A half-settled row contributes to both.
        let totalPaid = 0;
        let totalPending = 0;
        let lifetime = 0;
        for (const p of payouts) {
            const amt = Number(p.total_amount || 0);
            const paid = Number((p as any).paid_amount || 0);
            lifetime += amt;
            totalPaid += paid;
            totalPending += Math.max(0, amt - paid);
        }
        return { totalPaid, totalPending, lifetime };
    }, [payouts]);

    const paymentType = profile?.payment_type || 'commission';

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Media Buyer · Paiements
                    </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Mes paiements
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Gains et historique des versements.
                        </p>
                    </div>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 self-start sm:self-auto h-9 px-3.5 rounded-full text-[11px] font-medium border',
                            paymentType === 'commission'
                                ? 'bg-ant-green/10 text-ant-green border-ant-green/25'
                                : 'bg-ant-ink/5 text-ant-ink border-ant-line',
                        )}
                    >
                        <span className={cn('w-1.5 h-1.5 rounded-full', paymentType === 'commission' ? 'bg-ant-green' : 'bg-ant-ink')} />
                        {paymentType === 'commission'
                            ? `Commission · ${fmtCur(Number(profile?.commission_price || 0))} / livrée`
                            : `Salaire fixe · ${fmtCur(Number(profile?.salary_amount || 0))} / mois`}
                    </span>
                </div>
            </header>

            {/* Current month ink card */}
            <section className="rounded-2xl bg-ant-ink text-ant-light overflow-hidden">
                <div className="p-4 md:p-6 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                    Ce mois · {format(new Date(), 'MMMM yyyy', { locale: fr })}
                                </span>
                            </div>
                            <p className="font-serif italic text-[12px] text-ant-light/55 max-w-md">
                                Accumulation en temps réel. Le paiement final est généré par l'admin à la fin du mois.
                            </p>
                        </div>
                        <div className="md:text-right">
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/45">
                                À percevoir
                            </span>
                            {loadingEarnings ? (
                                <Skeleton className="h-9 w-32 md:ml-auto mt-1" />
                            ) : (
                                <p
                                    className="font-display text-[32px] leading-none tabular-nums text-ant-light mt-1"
                                    title={fmtCurFull(myEarnings?.remaining_amount || 0)}
                                >
                                    {fmtCur(myEarnings?.remaining_amount || 0)}
                                </p>
                            )}
                        </div>
                    </div>

                    {loadingEarnings ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 rounded-2xl overflow-hidden">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="bg-ant-ink p-3"><Skeleton className="h-12 w-full" /></div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 rounded-2xl overflow-hidden">
                            <InkCell label="Dépenses" value={fmtCur(myEarnings?.total_spend || 0)} valueTitle={fmtCurFull(myEarnings?.total_spend || 0)} accent="bg-ant-rose" />
                            <InkCell label="Livrées" value={fmtNum(myEarnings?.delivered_orders || 0)} accent="bg-ant-green" />
                            <InkCell label="Campagnes" value={fmtNum(myEarnings?.campaigns_count || 0)} accent="bg-ant-orange" />
                            {paymentType === 'commission' ? (
                                <InkCell
                                    label="Commission"
                                    value={fmtCur(myEarnings?.commission_earned || 0)}
                                    valueTitle={fmtCurFull(myEarnings?.commission_earned || 0)}
                                    accent="bg-ant-green"
                                />
                            ) : (
                                <InkCell
                                    label="Salaire"
                                    value={fmtCur(myEarnings?.salary_earned || 0)}
                                    valueTitle={fmtCurFull(myEarnings?.salary_earned || 0)}
                                    accent="bg-ant-orange"
                                />
                            )}
                        </div>
                    )}

                    {myEarnings && myEarnings.prior_paid_amount > 0 && (
                        <div className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ant-light/55" />
                            <p className="font-serif italic text-[11px] text-ant-light/65">
                                {fmtCurFull(myEarnings.prior_paid_amount)} déjà versés pour ce mois ({fmtCurFull(myEarnings.total_amount)} gagnés au total).
                            </p>
                        </div>
                    )}
                </div>
            </section>

            {/* Lifetime KPI strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Total reçu" value={fmtCur(stats.totalPaid)} valueTitle={fmtCurFull(stats.totalPaid)} accent="bg-ant-green" />
                <KpiTile label="En attente" value={fmtCur(stats.totalPending)} valueTitle={fmtCurFull(stats.totalPending)} accent="bg-ant-orange" />
                <KpiTile label="Gains cumulés" value={fmtCur(stats.lifetime)} valueTitle={fmtCurFull(stats.lifetime)} accent="bg-ant-ink" />
            </div>

            {/* Payout history */}
            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                    <div className="flex items-center gap-2">
                        <span className="font-display text-[11px] text-ant-orange">01</span>
                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                            Historique des versements
                        </span>
                    </div>
                    <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                        {payouts.length} paiement{payouts.length !== 1 ? 's' : ''} · générés par l'administration
                    </p>
                </div>
                {loadingPayouts ? (
                    <div className="p-10 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-ant-mid" />
                    </div>
                ) : payouts.length === 0 ? (
                    <div className="p-10 text-center">
                        <p className="font-display text-[14px] text-ant-ink">Aucun paiement pour le moment</p>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1 max-w-sm mx-auto">
                            Votre premier paiement apparaîtra ici une fois généré par l'administration.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Mobile: card list */}
                        <div className="md:hidden divide-y divide-ant-line">
                            {payouts.map((p) => (
                                <div key={p.id} className="px-4 py-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3 text-ant-mid" />
                                                <span className="font-display text-[13px] text-ant-ink capitalize">
                                                    {format(parseISO(p.payout_month), 'MMMM yyyy', { locale: fr })}
                                                </span>
                                            </div>
                                            <span className={cn(
                                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                                p.payment_type === 'commission' ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-ink/10 text-ant-ink',
                                            )}>
                                                {p.payment_type === 'commission' ? 'Commission' : 'Salaire'}
                                            </span>
                                        </div>
                                        {(() => {
                                            const totalAmt = Number(p.total_amount || 0);
                                            const paidAmt = Number(p.paid_amount || 0);
                                            const pct = totalAmt > 0 ? Math.round((paidAmt / totalAmt) * 100) : 0;
                                            if (p.status === 'paid') {
                                                return (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] shrink-0 bg-ant-green/12 text-ant-green">
                                                        <CheckCircle2 className="w-2.5 h-2.5" /> Payé
                                                    </span>
                                                );
                                            }
                                            if (p.status === 'partial') {
                                                return (
                                                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] shrink-0 bg-ant-blue/12 text-ant-blue">
                                                        <span className="w-1 h-1 rounded-full bg-ant-blue" /> Partiel · {pct}%
                                                    </span>
                                                );
                                            }
                                            return (
                                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] shrink-0 bg-ant-orange/12 text-ant-orange">
                                                    <span className="w-1 h-1 rounded-full bg-ant-orange" /> En attente
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-ant-line">
                                        <div>
                                            <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid">Livrées</p>
                                            <p className="font-display text-[14px] tabular-nums text-ant-green">{fmtNum(p.delivered_orders)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid">Dépenses</p>
                                            <p className="font-display text-[14px] tabular-nums text-ant-ink">{fmtCur(Number(p.total_spend))}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] uppercase tracking-[0.2em] text-ant-mid">Montant</p>
                                            <p className="font-display text-[14px] tabular-nums text-ant-ink">{fmtCur(Number(p.total_amount))}</p>
                                            {p.status !== 'pending' && Number(p.paid_amount || 0) > 0 && (
                                                <p className="text-[10px] text-ant-mid tabular-nums">
                                                    <span className="text-ant-green font-semibold">{fmtCur(Number(p.paid_amount))}</span> versé
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 pt-1">
                                        {(() => { const d = settledDate(p); return d ? (
                                            <p className="font-serif italic text-[11px] text-ant-mid">Versé le {format(new Date(d), 'dd MMMM yyyy', { locale: fr })}</p>
                                        ) : <span />; })()}
                                        <button type="button" onClick={() => { setSelected(p); setDetailOpen(true); }}
                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-ant-line bg-ant-paper text-[11px] font-semibold text-ant-ink hover:bg-ant-light cursor-pointer">
                                            <Eye className="w-3.5 h-3.5" strokeWidth={1.75} /> Détails
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop: table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/40">
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Mois</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Type</th>
                                        <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Livrées</th>
                                        <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Dépenses</th>
                                        <th className="text-right px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Montant</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Statut</th>
                                        <th className="text-left px-4 py-3 text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Versé le</th>
                                        <th className="px-4 py-3 w-12"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payouts.map((p) => (
                                        <tr key={p.id} className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <Calendar className="w-3.5 h-3.5 text-ant-mid" />
                                                    <span className="font-display text-[12px] text-ant-ink capitalize">
                                                        {format(parseISO(p.payout_month), 'MMMM yyyy', { locale: fr })}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={cn(
                                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                                    p.payment_type === 'commission' ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-ink/10 text-ant-ink',
                                                )}>
                                                    {p.payment_type === 'commission' ? 'Commission' : 'Salaire'}
                                                </span>
                                            </td>
                                            <td className="text-right px-4 py-3 text-[12px] text-ant-green tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                            <td className="text-right px-4 py-3 text-[12px] text-ant-ink tabular-nums" title={fmtCurFull(Number(p.total_spend))}>{fmtCur(Number(p.total_spend))}</td>
                                            <td className="text-right px-4 py-3 font-display text-[14px] text-ant-ink tabular-nums" title={fmtCurFull(Number(p.total_amount))}>
                                                <div className="flex flex-col items-end">
                                                    {fmtCur(Number(p.total_amount))}
                                                    {p.status !== 'pending' && Number(p.paid_amount || 0) > 0 && (
                                                        <span className="text-[10px] text-ant-green tabular-nums">
                                                            {fmtCur(Number(p.paid_amount))} versé
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {(() => {
                                                    const totalAmt = Number(p.total_amount || 0);
                                                    const paidAmt = Number(p.paid_amount || 0);
                                                    const pct = totalAmt > 0 ? Math.round((paidAmt / totalAmt) * 100) : 0;
                                                    if (p.status === 'paid') {
                                                        return (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-green/12 text-ant-green">
                                                                <CheckCircle2 className="w-2.5 h-2.5" /> Payé
                                                            </span>
                                                        );
                                                    }
                                                    if (p.status === 'partial') {
                                                        return (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-blue/12 text-ant-blue">
                                                                <span className="w-1 h-1 rounded-full bg-ant-blue" /> Partiel · {pct}%
                                                            </span>
                                                        );
                                                    }
                                                    return (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                                            <span className="w-1 h-1 rounded-full bg-ant-orange" /> En attente
                                                        </span>
                                                    );
                                                })()}
                                            </td>
                                            <td className="px-4 py-3 text-[12px] text-ant-ink tabular-nums">
                                                {(() => { const d = settledDate(p); return d ? format(new Date(d), 'dd MMM yyyy', { locale: fr }) : '—'; })()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button type="button" onClick={() => { setSelected(p); setDetailOpen(true); }} aria-label="Détails"
                                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors">
                                                    <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </section>

            {/* Detail modal — payout breakdown */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="max-w-xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                    {selected && (() => {
                        const total = Number(selected.total_amount || 0);
                        const paid = Number(selected.paid_amount || 0);
                        const remaining = Math.max(0, total - paid);
                        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                        const isCommission = selected.payment_type === 'commission';
                        const earned = isCommission ? Number(selected.commission_earned || 0) : Number(selected.salary_earned || 0);
                        const list = txnsByPayout[selected.id] || [];
                        const statusMeta = selected.status === 'paid'
                            ? { cls: 'border-ant-green/25 bg-ant-green/10 text-ant-green', dot: 'bg-ant-green', label: 'Payé' }
                            : selected.status === 'partial'
                              ? { cls: 'border-ant-blue/25 bg-ant-blue/10 text-ant-blue', dot: 'bg-ant-blue', label: 'Partiel' }
                              : { cls: 'border-ant-orange/25 bg-ant-orange/10 text-ant-orange', dot: 'bg-ant-orange', label: 'En attente' };
                        return (
                            <>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <DialogHeader className="px-5 py-4 border-b border-ant-line text-left space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Paiement · Détail
                                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case', statusMeta.cls)}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} /> {statusMeta.label}
                                        </span>
                                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case', isCommission ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-ink/10 text-ant-ink')}>
                                            {isCommission ? 'Commission' : 'Salaire'}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight capitalize">
                                        {format(parseISO(selected.payout_month), 'MMMM yyyy', { locale: fr })}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        {(() => { const d = settledDate(selected); return d ? `Versé le ${format(new Date(d), 'd MMMM yyyy', { locale: fr })}` : 'Pas encore versé'; })()}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto ant-scroll">
                                    {/* Summary tiles */}
                                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmtCur(earned)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{isCommission ? `${fmtNum(selected.delivered_orders)} livrées` : 'salaire fixe'}</p>
                                        </div>
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmtCur(paid)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{pct.toFixed(0)}% du total</p>
                                        </div>
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Restant
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmtCur(remaining)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">à percevoir</p>
                                        </div>
                                    </div>

                                    {/* Activity (commission only) */}
                                    {isCommission && (
                                        <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                            <div className="bg-ant-paper p-3">
                                                <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Wallet className="w-3 h-3 text-ant-rose" strokeWidth={1.75} /> Dépenses</div>
                                                <p className="font-display text-[15px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5" title={fmtCurFull(Number(selected.total_spend))}>{fmtCur(Number(selected.total_spend))}</p>
                                            </div>
                                            <div className="bg-ant-paper p-3">
                                                <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Livrées</div>
                                                <p className="font-display text-[15px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmtNum(selected.delivered_orders)}</p>
                                            </div>
                                            <div className="bg-ant-paper p-3">
                                                <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Megaphone className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Campagnes</div>
                                                <p className="font-display text-[15px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmtNum(selected.campaigns_count)}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Versements */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                <Banknote className="w-3.5 h-3.5 text-ant-green" strokeWidth={1.75} /> Versements
                                            </div>
                                            <span className="font-serif italic text-[11px] text-ant-mid">{list.length} {list.length > 1 ? 'paiements' : 'paiement'}</span>
                                        </div>
                                        {list.length > 0 ? (
                                            <div className="rounded-xl border border-ant-line overflow-hidden divide-y divide-ant-line">
                                                {list.map((tx, i) => (
                                                    <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-ant-paper">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className="h-7 w-7 rounded-lg border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center shrink-0">
                                                                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{format(new Date(tx.paid_at), 'd MMMM yyyy', { locale: fr })}</p>
                                                                {tx.note && <p className="font-serif italic text-[10px] text-ant-mid truncate">{tx.note}</p>}
                                                            </div>
                                                        </div>
                                                        <span className="font-display text-[13px] font-semibold text-ant-green tabular-nums shrink-0">+{fmtCur(tx.amount)} MAD</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-5 text-center">
                                                <p className="font-serif italic text-[11px] text-ant-mid">Aucun versement enregistré pour ce mois</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    );
};

const InkCell: React.FC<{ label: string; value: string; valueTitle?: string; accent: string }> = ({
    label,
    value,
    valueTitle,
    accent,
}) => (
    <div className="bg-ant-ink p-3 md:p-4 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
            <span className={cn('w-0.5 h-3 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-light/55 truncate">{label}</span>
        </div>
        <p className="font-display text-[16px] leading-none tabular-nums text-ant-light break-words" title={valueTitle || value}>
            {value}
        </p>
    </div>
);

const KpiTile: React.FC<{ label: string; value: string; valueTitle?: string; accent: string }> = ({
    label,
    value,
    valueTitle,
    accent,
}) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink break-words" title={valueTitle || value}>
            {value}
        </p>
    </div>
);

export default Payments;
