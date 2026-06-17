import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet,
    Calendar,
    CheckCircle2,
    Receipt,
    Eye,
    TrendingUp,
    TrendingDown,
    CircleDollarSign,
    Coins,
    Package,
    Hash,
    Banknote,
    ArrowDownRight,
    ScrollText,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// One monthly payout ticket (record). Source: public.seller_ledger.
interface LedgerTicket {
    id: string;
    payout_month: string;          // 'YYYY-MM-01'
    period_state: 'open' | 'closed';
    business_id: string | null;    // "DigiCom Business"
    carried_in: number;
    month_earned: number;
    total_amount: number;          // carried_in + month_earned
    paid_amount: number;
    remaining: number;
    carried_out: number | null;    // rolled to next month
    delivered_orders: number;      // units this month
    status: string;
    closed_at: string | null;
    paid_at: string | null;
}

// A recorded payment against a ticket. Source: public.seller_payment_txns.
interface Txn {
    seller_payment_id: string;
    amount: number;
    paid_at: string;
    note: string | null;
}

// An order behind a month's commission. Source: rpc public.seller_month_orders.
interface MonthOrder {
    order_id: string;
    client: string | null;
    phone: string | null;
    tracking: string | null;
    delivered_at: string;
    units: number;
    commission: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (n: number) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const SellerPayments = () => {
    const [tickets, setTickets] = useState<LedgerTicket[]>([]);
    const [txnsByTicket, setTxnsByTicket] = useState<Record<string, Txn[]>>({});
    const [sellerId, setSellerId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ lifetime: 0, thisMonth: 0, lastMonth: 0 });
    const [chartData, setChartData] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [selected, setSelected] = useState<LedgerTicket | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // lazy-loaded orders for the open modal
    const [orders, setOrders] = useState<MonthOrder[] | null>(null);
    const [ordersLoading, setOrdersLoading] = useState(false);

    useEffect(() => { fetchLedger(); }, []);

    const fetchLedger = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setSellerId(user.id);

            // The seller's own ledger tickets (RLS scopes to seller_id = auth.uid()).
            const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .from('seller_ledger')
                .select('id, payout_month, period_state, "DigiCom Business", carried_in, month_earned, total_amount, paid_amount, remaining, carried_out, delivered_orders, status, closed_at, paid_at')
                .eq('seller_id', user.id)
                .order('payout_month', { ascending: false });
            if (error) throw error;

            const rows = ((data || []) as any[]).map((t) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                id: t.id,
                payout_month: t.payout_month,
                period_state: t.period_state,
                business_id: t['DigiCom Business'] ?? null,
                carried_in: num(t.carried_in), month_earned: num(t.month_earned),
                total_amount: num(t.total_amount), paid_amount: num(t.paid_amount),
                remaining: num(t.remaining), carried_out: t.carried_out == null ? null : num(t.carried_out),
                delivered_orders: num(t.delivered_orders),
                status: t.status, closed_at: t.closed_at, paid_at: t.paid_at,
            })) as LedgerTicket[];

            // Seller sees ALL their monthly records, newest first (current month
            // included, flagged "en cours").
            setTickets(rows);

            // Real payment dates + amounts come from the txns (now readable by the
            // owning seller). Group them by ticket so the table shows when money
            // actually landed, and the modal can list every versement.
            const ids = rows.map((t) => t.id);
            if (ids.length) {
                const { data: txData, error: txErr } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                    .from('seller_payment_txns')
                    .select('seller_payment_id, amount, paid_at, note')
                    .in('seller_payment_id', ids)
                    .order('paid_at', { ascending: false });
                if (txErr) throw txErr;
                const map: Record<string, Txn[]> = {};
                ((txData || []) as any[]).forEach((tx) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                    const k = tx.seller_payment_id as string;
                    (map[k] = map[k] || []).push({ ...tx, amount: num(tx.amount) });
                });
                setTxnsByTicket(map);
            } else {
                setTxnsByTicket({});
            }

            // Lifetime paid = Σ paid across every ticket (open + closed).
            const lifetime = rows.reduce((s, t) => s + t.paid_amount, 0);
            const thisMonthKey = format(new Date(), 'yyyy-MM-01');
            const lastMonthKey = format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), 'yyyy-MM-01');
            const thisMonth = rows.filter((t) => t.payout_month === thisMonthKey).reduce((s, t) => s + t.paid_amount, 0);
            const lastMonth = rows.filter((t) => t.payout_month === lastMonthKey).reduce((s, t) => s + t.paid_amount, 0);
            setStats({ lifetime, thisMonth, lastMonth });

            setChartData(
                [...rows].reverse().map((t) => ({
                    month: format(parseISO(t.payout_month), 'MMM yyyy', { locale: fr }),
                    amount: t.paid_amount,
                })),
            );
        } catch (error) {
            console.error('Error fetching ledger:', error);
        } finally {
            setLoading(false);
        }
    };

    // Load the orders behind the selected month when the modal opens.
    useEffect(() => {
        if (!selected || !sellerId) return;
        let cancelled = false;
        setOrders(null);
        setOrdersLoading(true);
        (async () => {
            const { data, error } = await (supabase as any).rpc('seller_month_orders', { // eslint-disable-line @typescript-eslint/no-explicit-any
                p_seller: sellerId,
                p_business: selected.business_id,
                p_month: selected.payout_month,
            });
            if (cancelled) return;
            setOrders(error ? [] : ((data || []) as any[]).map((o) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                ...o, units: num(o.units), commission: num(o.commission),
            })) as MonthOrder[]);
            setOrdersLoading(false);
        })();
        return () => { cancelled = true; };
    }, [selected, sellerId]);

    const lastTxnDate = (ticketId: string): string | null => {
        const list = txnsByTicket[ticketId];
        if (!list || !list.length) return null;
        return list[0].paid_at; // ordered desc
    };

    const growthPct = stats.lastMonth > 0
        ? (((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100).toFixed(0)
        : stats.thisMonth > 0 ? '100' : '0';
    const growthPos = stats.thisMonth >= stats.lastMonth;

    const statusMeta = (t: LedgerTicket) => {
        const fullyPaid = t.paid_amount >= t.total_amount && t.total_amount > 0;
        if (fullyPaid) return { cls: 'border-ant-green/25 bg-ant-green/10 text-ant-green', dot: 'bg-ant-green', label: 'Payé' };
        if (t.paid_amount > 0) return { cls: 'border-ant-blue/25 bg-ant-blue/10 text-ant-blue', dot: 'bg-ant-blue', label: 'Partiel' };
        return { cls: 'border-ant-orange/25 bg-ant-orange/10 text-ant-orange', dot: 'bg-ant-orange', label: 'En attente' };
    };

    const periodName = (m: string) => {
        const d = parseISO(m);
        return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr });
    };

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Commercial · Paiements
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Paiements vérifiés
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        L&apos;historique officiel de vos mois — ce que vous avez gagné, ce qui a été versé, et le détail des commandes derrière chaque commission.
                    </p>
                </header>

                {loading ? (
                    <section className="rounded-2xl border border-ant-line bg-ant-paper p-12 flex flex-col items-center justify-center gap-3">
                        <div className="h-8 w-8 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" />
                        <p className="font-serif italic text-[12px] text-ant-mid">Chargement de vos paiements…</p>
                    </section>
                ) : (
                    <>
                        {/* KPI strip */}
                        <section className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                            <div className="bg-ant-paper p-4 md:p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" /> Gains à vie
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                        <CircleDollarSign className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[24px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {fmt(stats.lifetime)}<span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> cumul des règlements payés
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4 md:p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" /> {format(new Date(), 'MMMM yyyy', { locale: fr })}
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                        <Wallet className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[24px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {fmt(stats.thisMonth)}<span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className={`inline-flex items-center gap-1 mt-0.5 text-[11px] font-serif italic ${growthPos ? 'text-ant-green' : 'text-ant-rose'}`}>
                                    {growthPos ? <TrendingUp className="w-3 h-3" strokeWidth={1.75} /> : <TrendingDown className="w-3 h-3" strokeWidth={1.75} />}
                                    {growthPos ? '+' : ''}{growthPct}% vs {fmt(stats.lastMonth)} MAD
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4 md:p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Périodes
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                                        <Receipt className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[24px] font-semibold text-ant-ink tabular-nums mt-2">
                                    {tickets.length}<span className="text-[12px] text-ant-mid font-normal ml-1.5">mois</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">vos mois de commission</p>
                            </div>
                        </section>

                        {/* Chart */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-green" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span> Courbe des versements
                                    </div>
                                    <span className="font-serif italic text-[11px] text-ant-mid">progression mensuelle</span>
                                </div>
                                <div className="h-[200px]">
                                    {chartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="sellerPayGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#2D7A3E" stopOpacity={0.18} />
                                                        <stop offset="95%" stopColor="#2D7A3E" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid stroke="#EDE9E0" strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6760' }} dy={4} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B6760' }} width={50} />
                                                <Tooltip
                                                    contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E6DC', borderRadius: 12, boxShadow: '0 16px 48px -20px rgba(20,20,19,0.2)', fontSize: 12 }}
                                                    formatter={(v: number) => [`${fmt(v)} MAD`, 'Versé']}
                                                />
                                                <Area type="monotone" dataKey="amount" stroke="#2D7A3E" strokeWidth={1.75} fill="url(#sellerPayGrad)" fillOpacity={1} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="h-full flex items-center justify-center">
                                            <p className="font-serif italic text-[12px] text-ant-mid">Pas encore d&apos;historique à afficher</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* Monthly records */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span> Journal des règlements
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">tous vos mois</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light">
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Période</th>
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Activité</th>
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Réglé le</th>
                                            <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Gagné</th>
                                            <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Versé</th>
                                            <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tickets.length > 0 ? (
                                            tickets.map((t) => {
                                                const settled = lastTxnDate(t.id);
                                                return (
                                                    <tr key={t.id} className="border-b border-ant-line/60 last:border-0 hover:bg-ant-light/40 transition-colors">
                                                        <td className="px-5 py-3">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center shrink-0',
                                                                    t.period_state === 'open' ? 'border-ant-green/25 bg-ant-green/10 text-ant-green' : 'border-ant-line bg-ant-light text-ant-mid')}>
                                                                    <Calendar className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                                </div>
                                                                <div>
                                                                    <p className="font-display text-[13px] font-semibold text-ant-ink capitalize">{periodName(t.payout_month)}</p>
                                                                    <p className="font-serif italic text-[10px] text-ant-mid">{t.period_state === 'open' ? 'mois en cours' : 'mois clôturé'}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                                <Package className="w-3 h-3 text-ant-mid" strokeWidth={1.75} />
                                                                {fmt(t.delivered_orders)} unités
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <p className="font-serif italic text-[12px] text-ant-mid tabular-nums">
                                                                {settled ? format(new Date(settled), 'd MMM yyyy', { locale: fr }) : '—'}
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right">
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                                {fmt(t.month_earned)}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right">
                                                            <p className={cn('font-display text-[14px] font-semibold tabular-nums', t.paid_amount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                                {fmt(t.paid_amount)}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 pr-5 text-right">
                                                            <button type="button" onClick={() => { setSelected(t); setIsDetailOpen(true); }} aria-label="Détails"
                                                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors">
                                                                <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan={6} className="p-0">
                                                    <div className="mx-5 my-5 rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-10 flex flex-col items-center justify-center gap-3 text-center">
                                                        <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper flex items-center justify-center">
                                                            <Receipt className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                                        </div>
                                                        <div className="space-y-0.5">
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink">Aucun paiement</p>
                                                            <p className="font-serif italic text-[11px] text-ant-mid">Vos mois apparaîtront ici dès que vous aurez gagné une commission.</p>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                )}
            </div>

            {/* Detail modal — full month breakdown */}
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                <DialogContent className="max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                    {selected && (() => {
                        const meta = statusMeta(selected);
                        const paid = selected.paid_amount;
                        const total = selected.total_amount;
                        const remaining = Math.max(0, total - paid);
                        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                        const rolled = selected.carried_out ?? remaining;
                        const txns = txnsByTicket[selected.id] || [];
                        return (
                            <>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <DialogHeader className="px-6 py-5 border-b border-ant-line text-left space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Règlement · Détail
                                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case', meta.cls)}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /> {meta.label}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[19px] font-semibold text-ant-ink leading-tight capitalize">
                                        {periodName(selected.payout_month)}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        {selected.period_state === 'open'
                                            ? 'Mois en cours — encore ouvert'
                                            : (selected.closed_at ? `Clôturé le ${format(new Date(selected.closed_at), 'd MMMM yyyy', { locale: fr })}` : 'Mois clôturé')}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-6 space-y-5 max-h-[72vh] overflow-y-auto ant-scroll">
                                    {/* Summary tiles */}
                                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <Coins className="w-3 h-3 text-ant-ink" strokeWidth={1.75} /> Gagné
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(selected.month_earned)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{fmt(selected.delivered_orders)} unités</p>
                                        </div>
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <Banknote className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> Versé
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-green leading-none mt-1.5">{fmt(paid)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{pct.toFixed(0)}% du total</p>
                                        </div>
                                        <div className="bg-ant-paper p-3.5">
                                            <div className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-ant-mid">
                                                <ArrowDownRight className="w-3 h-3 text-ant-orange" strokeWidth={1.75} /> {selected.period_state === 'open' ? 'Restant' : 'Reporté'}
                                            </div>
                                            <p className="font-display text-[18px] font-semibold tabular-nums text-ant-ink leading-none mt-1.5">{fmt(rolled)}</p>
                                            <p className="font-serif italic text-[10px] text-ant-mid mt-0.5">{selected.period_state === 'open' ? 'à régler' : 'au mois suivant'}</p>
                                        </div>
                                    </div>

                                    {/* carried_in line */}
                                    {selected.carried_in !== 0 && (
                                        <div className="flex items-center justify-between rounded-xl border border-ant-line bg-ant-light px-4 py-3">
                                            <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-ant-mid">
                                                <ArrowDownRight className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} /> Reporté du mois précédent
                                            </span>
                                            <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums">{fmt(selected.carried_in)} MAD</span>
                                        </div>
                                    )}

                                    {/* Versements */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                <Banknote className="w-3.5 h-3.5 text-ant-green" strokeWidth={1.75} /> Versements
                                            </div>
                                            <span className="font-serif italic text-[11px] text-ant-mid">{txns.length} {txns.length > 1 ? 'paiements' : 'paiement'}</span>
                                        </div>
                                        {txns.length > 0 ? (
                                            <div className="rounded-xl border border-ant-line overflow-hidden divide-y divide-ant-line">
                                                {txns.map((tx, i) => (
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
                                                        <span className="font-display text-[13px] font-semibold text-ant-green tabular-nums shrink-0">+{fmt(tx.amount)} MAD</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-5 text-center">
                                                <p className="font-serif italic text-[11px] text-ant-mid">Aucun versement enregistré pour ce mois</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Commandes incluses */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                                <ScrollText className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} /> Commandes incluses
                                            </div>
                                            <span className="font-serif italic text-[11px] text-ant-mid">
                                                {orders ? `${orders.length} commandes` : '…'}
                                            </span>
                                        </div>
                                        {ordersLoading || orders === null ? (
                                            <div className="rounded-xl border border-ant-line bg-ant-paper py-8 flex items-center justify-center gap-2">
                                                <div className="h-4 w-4 rounded-full border-2 border-ant-line border-t-ant-ink animate-spin" />
                                                <span className="font-serif italic text-[11px] text-ant-mid">Chargement des commandes…</span>
                                            </div>
                                        ) : orders.length > 0 ? (
                                            <div className="rounded-xl border border-ant-line overflow-hidden">
                                                <div className="max-h-[320px] overflow-y-auto ant-scroll">
                                                    <table className="w-full">
                                                        <thead className="sticky top-0 z-10">
                                                            <tr className="bg-ant-light border-b border-ant-line">
                                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Client</th>
                                                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Livré le</th>
                                                                <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Unités</th>
                                                                <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.14em] text-ant-mid font-semibold">Commission</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {orders.map((o) => (
                                                                <tr key={o.order_id} className="border-b border-ant-line/50 last:border-0 hover:bg-ant-light/40 transition-colors">
                                                                    <td className="px-3 py-2">
                                                                        <p className="font-display text-[12px] font-semibold text-ant-ink truncate max-w-[180px]">{o.client || <span className="font-serif italic font-normal text-ant-mid">Sans nom</span>}</p>
                                                                        {o.tracking && (
                                                                            <p className="font-mono text-[10px] text-ant-mid inline-flex items-center gap-1"><Hash className="w-2.5 h-2.5" strokeWidth={2} />{o.tracking}</p>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <p className="font-serif italic text-[11px] text-ant-mid tabular-nums">{format(new Date(o.delivered_at), 'd MMM', { locale: fr })}</p>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-right">
                                                                        <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{fmt(o.units)}</span>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-right">
                                                                        <span className="font-display text-[12px] font-semibold text-ant-green tabular-nums">{fmt(o.commission)}</span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot className="sticky bottom-0">
                                                            <tr className="bg-ant-ink text-white">
                                                                <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">Total</td>
                                                                <td className="px-3 py-2"></td>
                                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums">{fmt(orders.reduce((s, o) => s + o.units, 0))}</td>
                                                                <td className="px-3 py-2 text-right font-display text-[12px] font-semibold tabular-nums text-ant-orange">{fmt(orders.reduce((s, o) => s + o.commission, 0))}</td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-ant-line bg-ant-light/50 px-4 py-5 text-center">
                                                <p className="font-serif italic text-[11px] text-ant-mid">Aucune commande livrée pour ce mois</p>
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

export default SellerPayments;
