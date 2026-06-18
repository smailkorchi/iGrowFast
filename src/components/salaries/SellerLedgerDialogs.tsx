import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    Coins,
    Banknote,
    ArrowDownRight,
    ChevronDown,
    Package,
    Hash,
    Layers,
    Users,
    ScrollText,
    CheckCircle2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { SellerLedger, LedgerTicket } from '@/hooks/useSellerLedger';

const fmt = (n: number) =>
    (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const periodName = (m: string) => {
    const d = parseISO(m);
    return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr });
};

interface MonthOrder {
    order_id: string;
    client: string | null;
    phone: string | null;
    tracking: string | null;
    delivered_at: string;
    units: number;
    commission: number;
}

const ticketStatusMeta = (t: LedgerTicket) => {
    const fullyPaid = t.paid_amount >= t.total_amount && t.total_amount > 0;
    if (fullyPaid) return { cls: 'border-ant-green/25 bg-ant-green/10 text-ant-green', dot: 'bg-ant-green', label: 'Payé' };
    if (t.paid_amount > 0) return { cls: 'border-ant-blue/25 bg-ant-blue/10 text-ant-blue', dot: 'bg-ant-blue', label: 'Partiel' };
    return { cls: 'border-ant-orange/25 bg-ant-orange/10 text-ant-orange', dot: 'bg-ant-orange', label: 'En attente' };
};

// ─────────────────────────── per-month expandable row ───────────────────────
const MonthRow: React.FC<{ ticket: LedgerTicket; sellerId: string; businessId: string | null }> = ({ ticket, sellerId, businessId }) => {
    const [open, setOpen] = useState(false);
    const [orders, setOrders] = useState<MonthOrder[] | null>(null);
    const [loading, setLoading] = useState(false);
    const meta = ticketStatusMeta(ticket);
    const remaining = Math.max(0, ticket.total_amount - ticket.paid_amount);
    const rolled = ticket.carried_out ?? remaining;

    useEffect(() => {
        if (!open || orders !== null) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const { data, error } = await (supabase as any).rpc('seller_month_orders', { // eslint-disable-line @typescript-eslint/no-explicit-any
                p_seller: sellerId, p_business: businessId, p_month: ticket.payout_month,
            });
            if (cancelled) return;
            setOrders(error ? [] : ((data || []) as any[]).map((o) => ({ ...o, units: Number(o.units) || 0, commission: Number(o.commission) || 0 })) as MonthOrder[]); // eslint-disable-line @typescript-eslint/no-explicit-any
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [open, orders, sellerId, businessId, ticket.payout_month]);

    return (
        <div className="rounded-xl border border-ant-line overflow-hidden bg-ant-paper">
            <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ant-light/50 transition-colors cursor-pointer text-left">
                <ChevronDown className={cn('w-4 h-4 text-ant-mid shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="font-display text-[13px] font-semibold text-ant-ink capitalize">{periodName(ticket.payout_month)}</p>
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', meta.cls)}>
                            <span className={cn('h-1 w-1 rounded-full', meta.dot)} /> {meta.label}
                        </span>
                        {ticket.period_state === 'open' && <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-green">en cours</span>}
                    </div>
                    <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{Number(ticket.delivered_orders) || 0} unités{ticket.carried_in !== 0 ? ` · reporté ${fmt(ticket.carried_in)}` : ''}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0 tabular-nums">
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Gagné</p>
                        <p className="font-display text-[13px] font-semibold text-ant-ink">{fmt(ticket.month_earned)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Versé</p>
                        <p className={cn('font-display text-[13px] font-semibold', ticket.paid_amount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>{fmt(ticket.paid_amount)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">{ticket.period_state === 'open' ? 'Restant' : 'Reporté'}</p>
                        <p className="font-display text-[13px] font-semibold text-ant-orange">{fmt(rolled)}</p>
                    </div>
                </div>
            </button>
            {open && (
                <div className="border-t border-ant-line bg-ant-light/30 px-4 py-3">
                    {loading || orders === null ? (
                        <div className="py-6 flex items-center justify-center gap-2">
                            <div className="h-4 w-4 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" />
                            <span className="font-serif italic text-[11px] text-ant-mid">Chargement des commandes…</span>
                        </div>
                    ) : orders.length > 0 ? (
                        <div className="rounded-lg border border-ant-line overflow-hidden bg-ant-paper">
                            <div className="max-h-[300px] overflow-y-auto ant-scroll">
                                <table className="w-full">
                                    <thead className="sticky top-0 z-10">
                                        <tr className="bg-ant-light border-b border-ant-line">
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Client</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Livré</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Unités</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Commission</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orders.map((o) => (
                                            <tr key={o.order_id} className="border-b border-ant-line/50 last:border-0">
                                                <td className="px-3 py-2">
                                                    <p className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[200px]">{o.client || <span className="font-serif italic font-normal text-ant-mid">Sans nom</span>}</p>
                                                    {o.tracking && <p className="font-mono text-[10px] text-ant-mid inline-flex items-center gap-1"><Hash className="w-2.5 h-2.5" strokeWidth={2} />{o.tracking}</p>}
                                                </td>
                                                <td className="px-3 py-2"><p className="font-serif italic text-[11px] text-ant-mid tabular-nums">{format(new Date(o.delivered_at), 'd MMM', { locale: fr })}</p></td>
                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold text-ant-ink tabular-nums">{fmt(o.units)}</td>
                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold text-ant-green tabular-nums">{fmt(o.commission)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="sticky bottom-0">
                                        <tr className="bg-ant-ink text-white">
                                            <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">{orders.length} commandes</td>
                                            <td></td>
                                            <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums">{fmt(orders.reduce((s, o) => s + o.units, 0))}</td>
                                            <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums text-ant-orange">{fmt(orders.reduce((s, o) => s + o.commission, 0))}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <p className="py-4 text-center font-serif italic text-[11px] text-ant-mid">Aucune commande livrée pour ce mois</p>
                    )}
                </div>
            )}
        </div>
    );
};

// ─────────────────────────── per-seller breakdown ───────────────────────────
export const SellerBreakdownDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    seller: SellerLedger | null;
    businessId: string | null;
}> = ({ open, onOpenChange, seller, businessId }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                {seller && (() => {
                    const months = [...(seller.open ? [seller.open] : []), ...seller.closed];
                    return (
                        <>
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-11 w-11 rounded-xl border border-ant-line">
                                        <AvatarImage src={seller.avatar_url || ''} className="object-cover" />
                                        <AvatarFallback className="rounded-xl text-[13px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(seller.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                        <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight truncate">{seller.name}</DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid truncate">
                                            {seller.email} · {fmt(seller.commissionPrice)} MAD/{seller.commissionBasis === 'per_unit' ? 'unité' : 'commande'}
                                        </DialogDescription>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné à vie</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(seller.lifetimeEarned)}</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(seller.lifetimePaid)}</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> Doit</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-orange leading-none mt-1.5">{fmt(Math.max(0, seller.owe))}</p>
                                    </div>
                                </div>
                            </DialogHeader>
                            <div className="p-6 space-y-2.5 max-h-[64vh] overflow-y-auto ant-scroll">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-1">
                                    <ScrollText className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Détail par mois
                                </div>
                                {months.length > 0 ? months.map((t) => (
                                    <MonthRow key={t.id} ticket={t} sellerId={seller.seller_id} businessId={businessId} />
                                )) : (
                                    <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-6 text-center">
                                        <p className="font-serif italic text-[11px] text-ant-mid">Aucun mois de commission</p>
                                    </div>
                                )}
                            </div>
                        </>
                    );
                })()}
            </DialogContent>
        </Dialog>
    );
};

// ─────────────────────────── global overview ────────────────────────────────
export const GlobalLedgerDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    sellers: SellerLedger[];
    onPick: (seller: SellerLedger) => void;
}> = ({ open, onOpenChange, sellers, onPick }) => {
    const active = sellers.filter((s) => s.lifetimeEarned > 0.005 || s.lifetimePaid > 0.005 || Math.abs(s.owe) > 0.005);
    const totals = active.reduce(
        (a, s) => ({ earned: a.earned + s.lifetimeEarned, paid: a.paid + s.lifetimePaid, owe: a.owe + Math.max(0, s.owe) }),
        { earned: 0, paid: 0, owe: 0 },
    );
    const sorted = [...active].sort((a, b) => b.owe - a.owe || b.lifetimeEarned - a.lifetimeEarned);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                <div className="h-[3px] w-full bg-ant-ink" />
                <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <Layers className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Vue d&apos;ensemble · Commissions
                    </div>
                    <DialogTitle className="sr-only">Vue d&apos;ensemble des commissions</DialogTitle>
                    <DialogDescription className="sr-only">Totaux gagné, versé et dû par commercial.</DialogDescription>
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
                        <Users className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Par commercial
                    </div>
                    <div className="rounded-xl border border-ant-line overflow-hidden">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-ant-light border-b border-ant-line">
                                    <th className="px-4 py-2.5 text-left text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Commercial</th>
                                    <th className="px-3 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Gagné</th>
                                    <th className="px-3 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Versé</th>
                                    <th className="px-4 py-2.5 text-right text-[9px] uppercase tracking-[0.16em] text-ant-mid font-semibold">Doit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((s) => (
                                    <tr key={s.seller_id} onClick={() => onPick(s)} className="border-b border-ant-line/50 last:border-0 hover:bg-ant-light/50 transition-colors cursor-pointer tabular-nums">
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2.5">
                                                <Avatar className="h-7 w-7 rounded-lg border border-ant-line">
                                                    <AvatarImage src={s.avatar_url || ''} className="object-cover" />
                                                    <AvatarFallback className="rounded-lg text-[10px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(s.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                                </Avatar>
                                                <span className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[180px]">{s.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold text-ant-ink">{fmt(s.lifetimeEarned)}</td>
                                        <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold text-ant-green">{fmt(s.lifetimePaid)}</td>
                                        <td className={cn('px-4 py-2.5 text-right font-display text-[12px] font-semibold', s.owe > 0.005 ? 'text-ant-orange' : 'text-ant-mid/50')}>{fmt(Math.max(0, s.owe))}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-ant-ink text-white tabular-nums">
                                    <td className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{sorted.length} commerciaux</td>
                                    <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold">{fmt(totals.earned)}</td>
                                    <td className="px-3 py-2.5 text-right font-display text-[12px] font-semibold">{fmt(totals.paid)}</td>
                                    <td className="px-4 py-2.5 text-right font-display text-[12px] font-semibold text-ant-orange">{fmt(totals.owe)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <p className="font-serif italic text-[10px] text-ant-mid mt-2 inline-flex items-center gap-1"><Package className="w-3 h-3" strokeWidth={1.75} /> Cliquez un commercial pour voir le détail par mois.</p>
                </div>
            </DialogContent>
        </Dialog>
    );
};

// ─────────── single-month seller detail (one ticket, for a list-row eye) ─────
export const SellerTicketDetailDialog: React.FC<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    seller: SellerLedger | null;
    ticket: LedgerTicket | null;
    businessId: string | null;
}> = ({ open, onOpenChange, seller, ticket, businessId }) => {
    const [orders, setOrders] = useState<MonthOrder[] | null>(null);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [txns, setTxns] = useState<{ amount: number; paid_at: string; note: string | null }[] | null>(null);

    useEffect(() => {
        if (!open || !seller || !ticket) return;
        let cancelled = false;
        setOrders(null); setOrdersLoading(true); setTxns(null);
        (async () => {
            const { data, error } = await (supabase as any).rpc('seller_month_orders', { // eslint-disable-line @typescript-eslint/no-explicit-any
                p_seller: seller.seller_id, p_business: businessId, p_month: ticket.payout_month,
            });
            if (!cancelled) {
                setOrders(error ? [] : ((data || []) as any[]).map((o) => ({ ...o, units: Number(o.units) || 0, commission: Number(o.commission) || 0 })) as MonthOrder[]); // eslint-disable-line @typescript-eslint/no-explicit-any
                setOrdersLoading(false);
            }
            const { data: tx, error: te } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .from('seller_payment_txns')
                .select('amount, paid_at, note')
                .eq('seller_payment_id', ticket.id)
                .order('paid_at', { ascending: false });
            if (!cancelled) setTxns(te ? [] : ((tx || []) as any[]).map((t) => ({ amount: Number(t.amount) || 0, paid_at: t.paid_at, note: t.note }))); // eslint-disable-line @typescript-eslint/no-explicit-any
        })();
        return () => { cancelled = true; };
    }, [open, seller, ticket, businessId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                {seller && ticket && (() => {
                    const meta = ticketStatusMeta(ticket);
                    const isOpenTicket = ticket.period_state === 'open';
                    const remaining = Math.max(0, ticket.total_amount - ticket.paid_amount);
                    const rolled = ticket.carried_out ?? remaining;
                    const pct = ticket.total_amount > 0 ? Math.min(100, (ticket.paid_amount / ticket.total_amount) * 100) : 0;
                    return (
                        <>
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-3">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-11 w-11 rounded-xl border border-ant-line">
                                        <AvatarImage src={seller.avatar_url || ''} className="object-cover" />
                                        <AvatarFallback className="rounded-xl text-[13px] bg-ant-ink/5 text-ant-ink font-display font-semibold">{(seller.name || '??').substring(0, 2).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0 flex-1">
                                        <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight truncate">{seller.name}</DialogTitle>
                                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid truncate">{seller.email}</DialogDescription>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-display text-[15px] font-semibold text-ant-ink capitalize">{periodName(ticket.payout_month)}</span>
                                    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', meta.cls)}>
                                        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /> {meta.label}
                                    </span>
                                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-ant-light text-ant-mid">{isOpenTicket ? 'Mois en cours' : 'Clôturé'}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(ticket.month_earned)}</p>
                                        <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{fmt(ticket.delivered_orders)} unités{ticket.carried_in !== 0 ? ` · reporté ${fmt(ticket.carried_in)}` : ''}</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(ticket.paid_amount)}</p>
                                        <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{pct.toFixed(0)}%</p>
                                    </div>
                                    <div className="bg-ant-paper p-3">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid"><ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> {isOpenTicket ? 'Restant' : 'Reporté'}</div>
                                        <p className="font-display text-[17px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(rolled)}</p>
                                        <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{isOpenTicket ? 'à régler' : 'au mois suivant'}</p>
                                    </div>
                                </div>
                            </DialogHeader>
                            <div className="p-6 space-y-5 max-h-[64vh] overflow-y-auto ant-scroll">
                                {/* Versements */}
                                <div>
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid mb-2"><Banknote className="w-3.5 h-3.5 text-ant-green" strokeWidth={1.75} /> Versements</div>
                                    {txns === null ? (
                                        <div className="py-4 flex items-center justify-center gap-2"><div className="h-4 w-4 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" /><span className="font-serif italic text-[11px] text-ant-mid">Chargement…</span></div>
                                    ) : txns.length > 0 ? (
                                        <div className="rounded-xl border border-ant-line overflow-hidden divide-y divide-ant-line bg-ant-paper">
                                            {txns.map((tx, i) => (
                                                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <div className="h-7 w-7 rounded-lg border border-ant-green/25 bg-ant-green/10 text-ant-green flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} /></div>
                                                        <div className="min-w-0"><p className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{format(new Date(tx.paid_at), 'd MMMM yyyy', { locale: fr })}</p>{tx.note && <p className="font-serif italic text-[10px] text-ant-mid truncate">{tx.note}</p>}</div>
                                                    </div>
                                                    <span className="font-display text-[13px] font-semibold text-ant-green tabular-nums shrink-0">+{fmt(tx.amount)} MAD</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-5 text-center"><p className="font-serif italic text-[11px] text-ant-mid">Aucun versement enregistré pour ce mois</p></div>
                                    )}
                                </div>
                                {/* Commandes incluses */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid"><ScrollText className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Commandes incluses</div>
                                        <span className="font-serif italic text-[11px] text-ant-mid">{orders ? `${orders.length} commandes` : '…'}</span>
                                    </div>
                                    {ordersLoading || orders === null ? (
                                        <div className="rounded-xl border border-ant-line bg-ant-paper py-8 flex items-center justify-center gap-2"><div className="h-4 w-4 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" /><span className="font-serif italic text-[11px] text-ant-mid">Chargement des commandes…</span></div>
                                    ) : orders.length > 0 ? (
                                        <div className="rounded-xl border border-ant-line overflow-hidden">
                                            <div className="max-h-[300px] overflow-y-auto ant-scroll">
                                                <table className="w-full">
                                                    <thead className="sticky top-0 z-10">
                                                        <tr className="bg-ant-light border-b border-ant-line">
                                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Client</th>
                                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Livré</th>
                                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Unités</th>
                                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Commission</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {orders.map((o) => (
                                                            <tr key={o.order_id} className="border-b border-ant-line/50 last:border-0">
                                                                <td className="px-3 py-2"><p className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[200px]">{o.client || <span className="font-serif italic font-normal text-ant-mid">Sans nom</span>}</p>{o.tracking && <p className="font-mono text-[10px] text-ant-mid inline-flex items-center gap-1"><Hash className="w-2.5 h-2.5" strokeWidth={2} />{o.tracking}</p>}</td>
                                                                <td className="px-3 py-2"><p className="font-serif italic text-[11px] text-ant-mid tabular-nums">{format(new Date(o.delivered_at), 'd MMM', { locale: fr })}</p></td>
                                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold text-ant-ink tabular-nums">{fmt(o.units)}</td>
                                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold text-ant-green tabular-nums">{fmt(o.commission)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="sticky bottom-0">
                                                        <tr className="bg-ant-ink text-white">
                                                            <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">{orders.length} commandes</td>
                                                            <td></td>
                                                            <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums">{fmt(orders.reduce((s, o) => s + o.units, 0))}</td>
                                                            <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums text-ant-orange">{fmt(orders.reduce((s, o) => s + o.commission, 0))}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-5 text-center"><p className="font-serif italic text-[11px] text-ant-mid">Aucune commande livrée pour ce mois</p></div>
                                    )}
                                </div>
                            </div>
                        </>
                    );
                })()}
            </DialogContent>
        </Dialog>
    );
};
