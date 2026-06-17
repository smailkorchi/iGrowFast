import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet,
    Calendar,
    CheckCircle2,
    Receipt,
    Eye,
    Building2,
    TrendingUp,
    TrendingDown,
    CircleDollarSign,
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

// One closed monthly payout ticket (record). Source: public.seller_ledger.
interface LedgerTicket {
    id: string;
    payout_month: string;          // 'YYYY-MM-01'
    period_state: 'open' | 'closed';
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
    bank_snapshot: any;            // eslint-disable-line @typescript-eslint/no-explicit-any
}

const num = (v: unknown) => Number(v ?? 0) || 0;

function settledDateIso(t: LedgerTicket): string | null {
    return t.paid_at || t.closed_at || null;
}

const SellerPayments = () => {
    const [closed, setClosed] = useState<LedgerTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ lifetime: 0, thisMonth: 0, lastMonth: 0 });
    const [chartData, setChartData] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const [selected, setSelected] = useState<LedgerTicket | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    useEffect(() => { fetchLedger(); }, []);

    const fetchLedger = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // The seller's own ledger tickets (RLS scopes to seller_id = auth.uid()).
            const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .from('seller_ledger')
                .select('id, payout_month, period_state, carried_in, month_earned, total_amount, paid_amount, remaining, carried_out, delivered_orders, status, closed_at, paid_at, bank_snapshot')
                .eq('seller_id', user.id)
                .order('payout_month', { ascending: false });
            if (error) throw error;

            const tickets = ((data || []) as any[]).map((t) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
                ...t,
                carried_in: num(t.carried_in), month_earned: num(t.month_earned),
                total_amount: num(t.total_amount), paid_amount: num(t.paid_amount),
                remaining: num(t.remaining), carried_out: t.carried_out == null ? null : num(t.carried_out),
                delivered_orders: num(t.delivered_orders),
            })) as LedgerTicket[];

            // Seller sees only CLOSED months as official records (the open month is on the Wallet).
            setClosed(tickets.filter((t) => t.period_state === 'closed'));

            // Lifetime paid = Σ paid across every ticket (open + closed).
            const lifetime = tickets.reduce((s, t) => s + t.paid_amount, 0);
            const thisMonthKey = format(new Date(), 'yyyy-MM-01');
            const lastMonthKey = format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), 'yyyy-MM-01');
            const thisMonth = tickets.filter((t) => t.payout_month === thisMonthKey).reduce((s, t) => s + t.paid_amount, 0);
            const lastMonth = tickets.filter((t) => t.payout_month === lastMonthKey).reduce((s, t) => s + t.paid_amount, 0);
            setStats({ lifetime, thisMonth, lastMonth });

            setChartData(
                [...tickets].reverse().map((t) => ({
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
                        L&apos;historique officiel de vos mois clôturés — ce que vous avez gagné, ce qui a été versé, et le détail de chaque mois.
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
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" /> Gains à vie
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                        <CircleDollarSign className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {stats.lifetime.toLocaleString()}<span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={1.75} /> cumul des règlements payés
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" /> {format(new Date(), 'MMMM yyyy', { locale: fr })}
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                        <Wallet className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {stats.thisMonth.toLocaleString()}<span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className={`inline-flex items-center gap-1 mt-0.5 text-[11px] font-serif italic ${growthPos ? 'text-ant-green' : 'text-ant-rose'}`}>
                                    {growthPos ? <TrendingUp className="w-3 h-3" strokeWidth={1.75} /> : <TrendingDown className="w-3 h-3" strokeWidth={1.75} />}
                                    {growthPos ? '+' : ''}{growthPct}% vs {stats.lastMonth.toLocaleString()} MAD
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Mois clôturés
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                                        <Receipt className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                                    {closed.length}<span className="text-[12px] text-ant-mid font-normal ml-1.5">mois</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">périodes de règlement validées</p>
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
                                                    formatter={(v: number) => [`${v.toLocaleString()} MAD`, 'Versé']}
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

                        {/* Closed-month records */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span> Journal des règlements
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">mois clôturés</span>
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
                                        {closed.length > 0 ? (
                                            closed.map((t) => {
                                                const iso = settledDateIso(t);
                                                const periodLabel = (() => { const d = parseISO(t.payout_month); return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr }); })();
                                                return (
                                                    <tr key={t.id} className="border-b border-ant-line/60 last:border-0 hover:bg-ant-light/40 transition-colors">
                                                        <td className="px-5 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <Calendar className="w-3 h-3 text-ant-mid shrink-0" strokeWidth={1.75} />
                                                                <div>
                                                                    <p className="font-display text-[13px] font-semibold text-ant-ink capitalize">{periodLabel}</p>
                                                                    <p className="font-serif italic text-[10px] text-ant-mid">mois clôturé</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green tabular-nums">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                                {t.delivered_orders} unités
                                                            </span>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <p className="font-serif italic text-[12px] text-ant-mid tabular-nums">
                                                                {iso ? format(new Date(iso), 'd MMM yyyy', { locale: fr }) : '—'}
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right">
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                                {t.month_earned.toLocaleString()}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right">
                                                            <p className={cn('font-display text-[14px] font-semibold tabular-nums', t.paid_amount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                                {t.paid_amount.toLocaleString()}<span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
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
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink">Aucun mois clôturé</p>
                                                            <p className="font-serif italic text-[11px] text-ant-mid">Vos mois apparaîtront ici dès qu&apos;ils seront clôturés en fin de mois.</p>
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
                <DialogContent className="max-w-xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                    {selected && (() => {
                        const meta = statusMeta(selected);
                        const paid = selected.paid_amount;
                        const total = selected.total_amount;
                        const remaining = Math.max(0, total - paid);
                        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                        const rolled = selected.carried_out ?? Math.max(0, total - paid);
                        return (
                            <>
                                <div className="h-[3px] w-full bg-ant-orange" />
                                <DialogHeader className="px-5 py-4 border-b border-ant-line text-left space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Règlement · Détail
                                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case', meta.cls)}>
                                            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /> {meta.label}
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight capitalize">
                                        {(() => { const d = parseISO(selected.payout_month); return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr }); })()}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        {(() => { const iso = settledDateIso(selected); return iso ? `Clôturé le ${format(new Date(iso), 'd MMMM yyyy', { locale: fr })}` : 'Mois clôturé'; })()}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto ant-scroll">
                                    {/* Earned this month */}
                                    <div className="rounded-xl border border-ant-line bg-ant-light p-4">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Commission gagnée ce mois</p>
                                        <p className="font-display text-[28px] font-semibold tabular-nums text-ant-ink leading-none mt-2">
                                            {selected.month_earned.toLocaleString()}<span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                        </p>
                                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-ant-line">
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Activité</span>
                                            <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{selected.delivered_orders} unités livrées</span>
                                        </div>
                                        {selected.carried_in !== 0 && (
                                            <div className="flex items-center justify-between pt-2 mt-2 border-t border-ant-line">
                                                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Reporté du mois précédent</span>
                                                <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{selected.carried_in.toLocaleString()} MAD</span>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-ant-line">
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Total dû ce mois</span>
                                            <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">{total.toLocaleString()} MAD</span>
                                        </div>
                                    </div>

                                    {/* Paid */}
                                    <div className="rounded-xl bg-ant-ink p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" /> Versé
                                            </div>
                                            <span className="text-[10px] font-semibold text-white/60 tabular-nums">{pct.toFixed(0)}%</span>
                                        </div>
                                        <p className="font-display text-[28px] font-semibold tabular-nums text-white leading-none">
                                            {paid.toLocaleString()}<span className="text-[12px] text-white/50 font-normal ml-1.5">MAD</span>
                                        </p>
                                        <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                                            <div className="h-full rounded-full bg-ant-orange transition-all" style={{ width: `${pct}%` }} />
                                        </div>
                                        {rolled > 0 && (
                                            <p className="text-[11px] text-white/60 tabular-nums">
                                                <span className="font-semibold text-white">{rolled.toLocaleString()} MAD</span> reporté au mois suivant
                                            </p>
                                        )}
                                    </div>

                                    {/* Bank */}
                                    <div className="rounded-xl border border-ant-line bg-ant-paper p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="h-8 w-8 rounded-lg border border-ant-line bg-ant-light text-ant-mid flex items-center justify-center">
                                                <Building2 className="w-4 h-4" strokeWidth={1.75} />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-display text-[13px] font-semibold text-ant-ink">Compte destinataire</p>
                                                <p className="font-serif italic text-[11px] text-ant-mid">snapshot au moment du paiement</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4">
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Banque</p>
                                                <p className="font-display text-[13px] font-semibold text-ant-ink mt-0.5">{selected.bank_snapshot?.name || <span className="font-serif italic font-normal text-ant-mid">—</span>}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">RIB</p>
                                                <p className="font-mono text-[12px] text-ant-ink mt-0.5">{selected.bank_snapshot?.rib || '—'}</p>
                                            </div>
                                            <div className="sm:col-span-2">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Titulaire</p>
                                                <p className="font-display text-[13px] font-semibold text-ant-ink mt-0.5">{selected.bank_snapshot?.holder || <span className="font-serif italic font-normal text-ant-mid">—</span>}</p>
                                            </div>
                                        </div>
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
