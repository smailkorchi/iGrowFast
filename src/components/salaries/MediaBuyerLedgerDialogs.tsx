import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/users/UserAvatar';
import {
    Coins,
    Banknote,
    ArrowDownRight,
    ChevronDown,
    Layers,
    Users,
    ScrollText,
    CheckCircle2,
    Wallet,
    Megaphone,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const fmt = (n: number) =>
    (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const periodName = (m: string) => {
    // mediabuyer payout_month is 'YYYY-MM'
    const d = parseISO((m || '').length === 7 ? `${m}-01` : m);
    return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr });
};

export interface MBPayoutLite {
    id: string;
    payout_month: string;
    payment_type: 'commission' | 'salary';
    salary_earned: number;
    commission_earned: number;
    total_amount: number;
    paid_amount: number;
    delivered_orders: number;
    total_spend: number;
    campaigns_count: number;
    status: 'pending' | 'partial' | 'paid';
    paid_at: string | null;
}

export interface MediaBuyerLedger {
    mediabuyer_id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    payouts: MBPayoutLite[];          // newest first
    lifetimeEarned: number;           // Σ total_amount
    lifetimePaid: number;             // Σ paid_amount
    owe: number;                      // Σ remaining
}

interface MBTxn { amount: number; paid_at: string; note: string | null }

const statusMeta = (p: MBPayoutLite) => {
    if (p.status === 'paid') return { cls: 'border-ant-green/25 bg-ant-green/10 text-ant-green', dot: 'bg-ant-green', label: 'Payé' };
    if (p.status === 'partial') return { cls: 'border-ant-blue/25 bg-ant-blue/10 text-ant-blue', dot: 'bg-ant-blue', label: 'Partiel' };
    return { cls: 'border-ant-orange/25 bg-ant-orange/10 text-ant-orange', dot: 'bg-ant-orange', label: 'En attente' };
};

// Shared breakdown body: commission activity tiles (if any) + the versements
// list (txns fetched on demand). Used by both the expandable MonthRow and the
// single-payout detail dialog so the two never drift.
const PayoutBreakdownBody: React.FC<{ payout: MBPayoutLite; load: boolean }> = ({ payout, load }) => {
    const [txns, setTxns] = useState<MBTxn[] | null>(null);
    const [loading, setLoading] = useState(false);
    const isCommission = payout.payment_type === 'commission';

    useEffect(() => {
        if (!load || txns !== null) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .from('mediabuyer_payment_txns')
                .select('amount, paid_at, note')
                .eq('mediabuyer_payment_id', payout.id)
                .order('paid_at', { ascending: false });
            if (cancelled) return;
            setTxns(error ? [] : ((data || []) as any[]).map((t) => ({ amount: Number(t.amount) || 0, paid_at: t.paid_at, note: t.note })) as MBTxn[]); // eslint-disable-line @typescript-eslint/no-explicit-any
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [load, txns, payout.id]);

    return (
        <div className="space-y-3">
            {isCommission && (
                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-lg border border-ant-line overflow-hidden">
                    <div className="bg-ant-paper p-2.5">
                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid"><Wallet className="w-3 h-3 text-ant-rose" strokeWidth={1.75} /> Dépenses</div>
                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink leading-none mt-1">{fmt(payout.total_spend)}</p>
                    </div>
                    <div className="bg-ant-paper p-2.5">
                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid"><CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Livrées</div>
                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-green leading-none mt-1">{fmt(payout.delivered_orders)}</p>
                    </div>
                    <div className="bg-ant-paper p-2.5">
                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid"><Megaphone className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Campagnes</div>
                        <p className="font-display text-[14px] font-semibold tabular-nums text-ant-ink leading-none mt-1">{fmt(payout.campaigns_count)}</p>
                    </div>
                </div>
            )}
            <div>
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-ant-mid mb-1.5">
                    <Banknote className="w-3.5 h-3.5 text-ant-green" strokeWidth={1.75} /> Versements
                </div>
                {loading || txns === null ? (
                    <div className="py-4 flex items-center justify-center gap-2">
                        <div className="h-4 w-4 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" />
                        <span className="font-serif italic text-[11px] text-ant-mid">Chargement…</span>
                    </div>
                ) : txns.length > 0 ? (
                    <div className="rounded-lg border border-ant-line overflow-hidden divide-y divide-ant-line bg-ant-paper">
                        {txns.map((tx, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                    <p className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{format(new Date(tx.paid_at), 'd MMMM yyyy', { locale: fr })}</p>
                                    {tx.note && <p className="font-serif italic text-[10px] text-ant-mid truncate">{tx.note}</p>}
                                </div>
                                <span className="font-display text-[12px] font-semibold text-ant-green tabular-nums shrink-0">+{fmt(tx.amount)} MAD</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="py-3 text-center font-serif italic text-[11px] text-ant-mid">Aucun versement enregistré</p>
                )}
            </div>
        </div>
    );
};

// ─────────────────────────── per-month expandable row ───────────────────────
const MonthRow: React.FC<{ payout: MBPayoutLite }> = ({ payout }) => {
    const [open, setOpen] = useState(false);
    const meta = statusMeta(payout);
    const remaining = Math.max(0, payout.total_amount - payout.paid_amount);
    const isCommission = payout.payment_type === 'commission';
    const earned = isCommission ? payout.commission_earned : payout.salary_earned;

    return (
        <div className="rounded-xl border border-ant-line overflow-hidden bg-ant-paper">
            <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ant-light/50 transition-colors cursor-pointer text-left">
                <ChevronDown className={cn('w-4 h-4 text-ant-mid shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-display text-[13px] font-semibold text-ant-ink capitalize">{periodName(payout.payout_month)}</p>
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', meta.cls)}>
                            <span className={cn('h-1 w-1 rounded-full', meta.dot)} /> {meta.label}
                        </span>
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', isCommission ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-ink/10 text-ant-ink')}>{isCommission ? 'Commission' : 'Salaire'}</span>
                    </div>
                    <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{isCommission ? `${fmt(payout.delivered_orders)} livrées · ${fmt(payout.total_spend)} dépensé` : 'salaire fixe'}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 tabular-nums">
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Gagné</p>
                        <p className="font-display text-[13px] font-semibold text-ant-ink">{fmt(earned)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Versé</p>
                        <p className={cn('font-display text-[13px] font-semibold', payout.paid_amount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>{fmt(payout.paid_amount)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Restant</p>
                        <p className="font-display text-[13px] font-semibold text-ant-orange">{fmt(remaining)}</p>
                    </div>
                </div>
            </button>
            {open && (
                <div className="border-t border-ant-line bg-ant-light/30 px-4 py-3">
                    <PayoutBreakdownBody payout={payout} load={open} />
                </div>
            )}
        </div>
    );
};

// ─────────────── single-payout detail (one month, for a list-row eye) ───────
export const MediaBuyerPayoutDetailDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    payout: MBPayoutLite | null;
    buyerName: string;
    buyerEmail: string;
    buyerAvatar: string | null;
    buyerAvatarConfig?: unknown;
}> = ({ open, onOpenChange, payout, buyerName, buyerEmail, buyerAvatar, buyerAvatarConfig }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                {payout && (() => {
                    const meta = statusMeta(payout);
                    const remaining = Math.max(0, payout.total_amount - payout.paid_amount);
                    const pct = payout.total_amount > 0 ? Math.min(100, (payout.paid_amount / payout.total_amount) * 100) : 0;
                    const isCommission = payout.payment_type === 'commission';
                    const earned = isCommission ? payout.commission_earned : payout.salary_earned;
                    return (
                        <>
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                                <div className="flex items-center gap-3">
                                    <UserAvatar url={buyerAvatar} config={buyerAvatarConfig} name={buyerName} className="h-11 w-11 rounded-xl border border-ant-line text-[13px] font-display font-semibold" />
                                    <div className="min-w-0 flex-1">
                                        <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight truncate">{buyerName}</DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid truncate">{buyerEmail}</DialogDescription>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[15px] font-semibold text-ant-ink capitalize">{periodName(payout.payout_month)}</span>
                                    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', meta.cls)}>
                                        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /> {meta.label}
                                    </span>
                                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', isCommission ? 'bg-ant-green/10 text-ant-green' : 'bg-ant-ink/10 text-ant-ink')}>{isCommission ? 'Commission' : 'Salaire'}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(earned)}</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(payout.paid_amount)}</p>
                                        <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{pct.toFixed(0)}%</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Restant</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(remaining)}</p>
                                    </div>
                                </div>
                            </DialogHeader>
                            <div className="p-6 max-h-[64vh] overflow-y-auto ant-scroll">
                                <PayoutBreakdownBody payout={payout} load={open} />
                            </div>
                        </>
                    );
                })()}
            </DialogContent>
        </Dialog>
    );
};

// ─────────────────────────── per-MB breakdown ───────────────────────────────
export const MediaBuyerBreakdownDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    buyer: MediaBuyerLedger | null;
}> = ({ open, onOpenChange, buyer }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                {buyer && (
                    <>
                        <div className="h-[3px] w-full bg-ant-orange" />
                        <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                            <div className="flex items-center gap-3">
                                <UserAvatar url={buyer.avatar_url} config={(buyer as any).avatar_config} name={buyer.name} className="h-11 w-11 rounded-xl border border-ant-line text-[13px] font-display font-semibold" />
                                <div className="min-w-0">
                                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight truncate">{buyer.name}</DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid truncate">{buyer.email}</DialogDescription>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                <div className="bg-ant-paper p-3">
                                    <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné à vie</div>
                                    <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(buyer.lifetimeEarned)}</p>
                                </div>
                                <div className="bg-ant-paper p-3">
                                    <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé</div>
                                    <p className="font-display text-[17px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(buyer.lifetimePaid)}</p>
                                </div>
                                <div className="bg-ant-paper p-3">
                                    <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Doit</div>
                                    <p className="font-display text-[17px] font-semibold tabular-nums text-ant-orange leading-none mt-1.5">{fmt(Math.max(0, buyer.owe))}</p>
                                </div>
                            </div>
                        </DialogHeader>
                        <div className="p-6 space-y-2.5 max-h-[64vh] overflow-y-auto ant-scroll">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1">
                                <ScrollText className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Détail par mois
                            </div>
                            {buyer.payouts.length > 0 ? buyer.payouts.map((p) => (
                                <MonthRow key={p.id} payout={p} />
                            )) : (
                                <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-6 text-center">
                                    <p className="font-serif italic text-[11px] text-ant-mid">Aucun paiement</p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

// ─────────────────────────── global overview ────────────────────────────────
export const MediaBuyerGlobalDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    buyers: MediaBuyerLedger[];
    onPick: (buyer: MediaBuyerLedger) => void;
}> = ({ open, onOpenChange, buyers, onPick }) => {
    const active = buyers.filter((b) => b.lifetimeEarned > 0.005 || b.lifetimePaid > 0.005 || Math.abs(b.owe) > 0.005);
    const totals = active.reduce(
        (a, b) => ({ earned: a.earned + b.lifetimeEarned, paid: a.paid + b.lifetimePaid, owe: a.owe + Math.max(0, b.owe) }),
        { earned: 0, paid: 0, owe: 0 },
    );
    const sorted = [...active].sort((a, b) => b.owe - a.owe || b.lifetimeEarned - a.lifetimeEarned);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <Layers className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Vue d&apos;ensemble · Media buyers
                    </div>
                    <DialogTitle className="sr-only">Vue d&apos;ensemble des media buyers</DialogTitle>
                    <DialogDescription className="sr-only">Totaux gagné, versé et dû par media buyer.</DialogDescription>
                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-3.5">
                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné à vie</div>
                            <p className="font-display text-[20px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(totals.earned)}<span className="text-[11px] text-ant-mid font-normal ml-1">MAD</span></p>
                        </div>
                        <div className="bg-ant-paper p-3.5">
                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé</div>
                            <p className="font-display text-[20px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(totals.paid)}<span className="text-[11px] text-ant-mid font-normal ml-1">MAD</span></p>
                        </div>
                        <div className="bg-ant-paper p-3.5">
                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Dû</div>
                            <p className="font-display text-[20px] font-semibold tabular-nums text-ant-orange leading-none mt-1.5">{fmt(totals.owe)}<span className="text-[11px] text-ant-mid font-normal ml-1">MAD</span></p>
                        </div>
                    </div>
                </DialogHeader>
                <div className="p-6 max-h-[64vh] overflow-y-auto ant-scroll">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-2">
                        <Users className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Par media buyer
                    </div>
                    <div className="rounded-xl border border-ant-line overflow-hidden">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-ant-light border-b border-ant-line">
                                    <th className="px-4 py-2.5 text-left text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Media buyer</th>
                                    <th className="px-3 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Gagné</th>
                                    <th className="px-3 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Versé</th>
                                    <th className="px-4 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Doit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((b) => (
                                    <tr key={b.mediabuyer_id} onClick={() => onPick(b)} className="border-b border-ant-line/50 last:border-0 hover:bg-ant-light/50 transition-colors cursor-pointer tabular-nums">
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                <UserAvatar url={b.avatar_url} config={(b as any).avatar_config} name={b.name} className="h-7 w-7 rounded-lg border border-ant-line text-[10px] font-display font-semibold" />
                                                <span className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[180px]">{b.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold text-ant-ink">{fmt(b.lifetimeEarned)}</td>
                                        <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold text-ant-green">{fmt(b.lifetimePaid)}</td>
                                        <td className={cn('px-4 py-2.5 text-right font-display text-[12px] font-semibold', b.owe > 0.005 ? 'text-ant-orange' : 'text-ant-mid/50')}>{fmt(Math.max(0, b.owe))}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-ant-ink text-white tabular-nums">
                                    <td className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{sorted.length} media buyers</td>
                                    <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold">{fmt(totals.earned)}</td>
                                    <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold">{fmt(totals.paid)}</td>
                                    <td className="px-4 py-2.5 text-right font-display text-[12px] font-semibold text-ant-orange">{fmt(totals.owe)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <p className="font-serif italic text-[10px] text-ant-mid mt-2">Cliquez un media buyer pour voir le détail par mois.</p>
                </div>
            </DialogContent>
        </Dialog>
    );
};
