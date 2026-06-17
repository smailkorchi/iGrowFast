import { useState, useEffect } from 'react';
import { supabase, fetchAllRows } from '@/lib/supabase';
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

interface SellerPayment {
    id: string;
    payout_month: string;
    salary_earned: number;
    commission_earned: number;
    total_amount: number;
    paid_amount: number;
    days_present: number;
    delivered_orders: number;
    bank_snapshot: any;
    status: string;
    paid_at: string | null;
    created_at: string;
    updated_at?: string | null;
}

function settledDateIso(p: SellerPayment): string | null {
    if (p.paid_at) return p.paid_at;
    if (p.updated_at) return p.updated_at;
    return p.created_at || null;
}

const SellerPayments = () => {
    const [payments, setPayments] = useState<SellerPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ lifetime: 0, thisMonth: 0, lastMonth: 0 });
    // LIVE cumulative figures from the seller_daily_earnings view — the authoritative
    // source every other page uses. The frozen seller_payments fields (total_amount,
    // delivered_orders, days_present) go stale as new orders deliver, so we never
    // display them; paid_amount stays factual (trigger-synced from the txn table).
    const [liveStats, setLiveStats] = useState({ earned: 0, units: 0, days: 0 });
    const [chartData, setChartData] = useState<any[]>([]);
    const [selectedPayment, setSelectedPayment] = useState<SellerPayment | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    useEffect(() => { fetchPayments(); }, []);

    const fetchPayments = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Partial-payout-aware: pull every row with at least one disbursement
            // (status='partial' or 'paid'). Show the actually-received `paid_amount`,
            // not `total_amount`, in stats and chart — that's what the seller has
            // touched. The trigger keeps paid_amount in lockstep with the txn table.
            const { data, error } = await supabase
                .from('seller_payments')
                .select('*')
                .eq('seller_id', user.id)
                .gt('paid_amount', 0)
                .order('payout_month', { ascending: true });
            if (error) throw error;

            const rows = data || [];
            setPayments([...rows].reverse());

            // Live earned/units/days for this seller from the view (uncapped).
            const dailyRows = await fetchAllRows<{ commission_earned: number | string | null; delivered_count: number | string | null }>(
                'seller_daily_earnings',
                'commission_earned, delivered_count, date',
                { filters: [{ column: 'seller_id', op: 'eq', value: user.id }], orderBy: 'date' },
            );
            setLiveStats({
                earned: dailyRows.reduce((s, r) => s + Number(r.commission_earned || 0), 0),
                units: dailyRows.reduce((s, r) => s + Number(r.delivered_count || 0), 0),
                days: dailyRows.length,
            });

            const lifetime = rows.reduce((sum, p: any) => sum + Number(p.paid_amount || 0), 0);
            const now = new Date();
            const thisMonthStr = format(now, 'yyyy-MM-01');
            const thisMonth = rows
                .filter((p) => p.payout_month === thisMonthStr)
                .reduce((sum, p: any) => sum + Number(p.paid_amount || 0), 0);
            const lastMonthStr = format(new Date(now.getFullYear(), now.getMonth() - 1), 'yyyy-MM-01');
            const lastMonth = rows
                .filter((p) => p.payout_month === lastMonthStr)
                .reduce((sum, p: any) => sum + Number(p.paid_amount || 0), 0);
            setStats({ lifetime, thisMonth, lastMonth });

            const monthlyData = rows.map((p: any) => {
                const date = p.payout_month ? parseISO(p.payout_month) : null;
                return {
                    month: date && !isNaN(date.getTime()) ? format(date, 'MMM yyyy', { locale: fr }) : 'Inconnu',
                    amount: Number(p.paid_amount || 0),
                    commission: Number(p.commission_earned),
                };
            });
            setChartData(monthlyData);
        } catch (error) {
            console.error('Error fetching payments:', error);
        } finally {
            setLoading(false);
        }
    };

    const growthPct = stats.lastMonth > 0
        ? (((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100).toFixed(0)
        : stats.thisMonth > 0
            ? '100'
            : '0';
    const growthPos = stats.thisMonth >= stats.lastMonth;

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Commercial · Paiements
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Paiements vérifiés
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        L&apos;historique officiel de vos règlements mensuels — chiffre cumulé, tendance, détails de chaque décaissement.
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
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                        Gains à vie
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                        <CircleDollarSign className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {stats.lifetime.toLocaleString()}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-ant-green" strokeWidth={1.75} />
                                    cumul des règlements payés
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                        {format(new Date(), 'MMMM yyyy', { locale: fr })}
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                        <Wallet className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {stats.thisMonth.toLocaleString()}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className={`inline-flex items-center gap-1 mt-0.5 text-[11px] font-serif italic ${growthPos ? 'text-ant-green' : 'text-ant-rose'}`}>
                                    {growthPos ? <TrendingUp className="w-3 h-3" strokeWidth={1.75} /> : <TrendingDown className="w-3 h-3" strokeWidth={1.75} />}
                                    {growthPos ? '+' : ''}{growthPct}% vs {stats.lastMonth.toLocaleString()} MAD
                                </p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Règlements
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                                        <Receipt className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                                    {payments.length}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">versements</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">périodes de règlement validées</p>
                            </div>
                        </section>

                        {/* Revenue chart */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-green" />
                            <div className="p-5 space-y-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Courbe des versements
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
                                                    contentStyle={{
                                                        background: '#FFFFFF',
                                                        border: '1px solid #E8E6DC',
                                                        borderRadius: 12,
                                                        boxShadow: '0 16px 48px -20px rgba(20,20,19,0.2)',
                                                        fontSize: 12,
                                                    }}
                                                    formatter={(v: number) => [`${v.toLocaleString()} MAD`, 'Paiement']}
                                                />
                                                <Area type="monotone" dataKey="amount" stroke="#2D7A3E" strokeWidth={1.75} fill="url(#sellerPayGrad)" fillOpacity={1} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="h-full flex items-center justify-center">
                                            <p className="font-serif italic text-[12px] text-ant-mid">
                                                Pas encore d&apos;historique à afficher
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        {/* Settlement Logs table */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="px-5 py-4 border-b border-ant-line flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Journal des règlements
                                </div>
                                <span className="font-serif italic text-[11px] text-ant-mid">paiements officiels</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-ant-line bg-ant-light">
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Référence</th>
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Période</th>
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Activité</th>
                                            <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Réglé le</th>
                                            <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Dû</th>
                                            <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Versé</th>
                                            <th className="px-5 py-2.5 pr-5 w-12" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payments.length > 0 ? (
                                            payments.map((p) => {
                                                const date = parseISO(p.payout_month);
                                                const periodLabel = isNaN(date.getTime()) ? '—' : format(date, 'MMMM yyyy', { locale: fr });
                                                const iso = settledDateIso(p);
                                                return (
                                                    <tr key={p.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light/50 transition-colors">
                                                        <td className="px-5 py-3">
                                                            <code className="font-mono text-[11px] text-ant-mid">#{p.id.slice(0, 8).toUpperCase()}</code>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <Calendar className="w-3 h-3 text-ant-mid shrink-0" strokeWidth={1.75} />
                                                                <div>
                                                                    <p className="font-display text-[13px] font-semibold text-ant-ink capitalize">{periodLabel}</p>
                                                                    <p className="font-serif italic text-[10px] text-ant-mid">fenêtre de règlement</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                                                    {liveStats.days} j
                                                                </span>
                                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-green/25 bg-ant-green/10 px-2 py-0.5 text-[10px] font-semibold text-ant-green tabular-nums">
                                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                                                    {liveStats.units} unités
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-5 py-3">
                                                            <p className="font-serif italic text-[12px] text-ant-mid tabular-nums">
                                                                {iso ? format(new Date(iso), 'd MMM yyyy', { locale: fr }) : '—'}
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right">
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                                {liveStats.earned.toLocaleString()}
                                                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                            </p>
                                                        </td>
                                                        <td className="px-5 py-3 text-right" title={`${Number(p.paid_amount || 0).toLocaleString()} versé sur ${liveStats.earned.toLocaleString()}`}>
                                                            {(() => {
                                                                const paid = Number(p.paid_amount || 0);
                                                                const total = liveStats.earned;
                                                                const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                                                                const isPartial = p.status === 'partial';
                                                                return (
                                                                    <div className="flex flex-col items-end gap-1.5">
                                                                        <p className={cn('font-display text-[14px] font-semibold tabular-nums', paid > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                                            {paid.toLocaleString()}
                                                                            <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                                                        </p>
                                                                        {isPartial && (
                                                                            <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                                                <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="px-5 py-3 pr-5 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => { setSelectedPayment(p); setIsDetailModalOpen(true); }}
                                                                aria-label="Détails"
                                                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink cursor-pointer transition-colors"
                                                            >
                                                                <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            <tr>
                                                <td colSpan={7} className="p-0">
                                                    <div className="mx-5 my-5 rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-10 flex flex-col items-center justify-center gap-3 text-center">
                                                        <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper flex items-center justify-center">
                                                            <Receipt className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                                        </div>
                                                        <div className="space-y-0.5">
                                                            <p className="font-display text-[14px] font-semibold text-ant-ink">Aucun paiement confirmé</p>
                                                            <p className="font-serif italic text-[11px] text-ant-mid">Vos gains apparaîtront ici dès qu&apos;un administrateur les aura traités.</p>
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

            {/* Detail Modal */}
            <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
                <DialogContent className="max-w-xl p-0 gap-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] overflow-hidden">
                    {selectedPayment && (
                        <>
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <DialogHeader className="px-5 py-4 border-b border-ant-line text-left space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Règlement · Détail
                                    {(() => {
                                        const isPaid = selectedPayment.status === 'paid';
                                        const isPartial = selectedPayment.status === 'partial';
                                        const cls = isPaid
                                            ? 'border-ant-green/25 bg-ant-green/10 text-ant-green'
                                            : isPartial
                                              ? 'border-ant-blue/25 bg-ant-blue/10 text-ant-blue'
                                              : 'border-ant-orange/25 bg-ant-orange/10 text-ant-orange';
                                        const dot = isPaid ? 'bg-ant-green' : isPartial ? 'bg-ant-blue' : 'bg-ant-orange';
                                        const label = isPaid ? 'Payé' : isPartial ? 'Partiel' : 'En attente';
                                        return (
                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-normal normal-case', cls)}>
                                                <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
                                                {label}
                                            </span>
                                        );
                                    })()}
                                </div>
                                <DialogTitle className="font-display text-[18px] font-semibold text-ant-ink leading-tight capitalize">
                                    {(() => {
                                        const d = parseISO(selectedPayment.payout_month);
                                        return isNaN(d.getTime()) ? '—' : format(d, 'MMMM yyyy', { locale: fr });
                                    })()}
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    {(() => {
                                        const iso = settledDateIso(selectedPayment);
                                        return iso ? `Réglé le ${format(new Date(iso), 'd MMMM yyyy', { locale: fr })}` : 'Date de règlement inconnue';
                                    })()}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto ant-scroll">
                                {/* Commission earned (gross) */}
                                <div className="rounded-xl border border-ant-line bg-ant-light p-4">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Commission due</p>
                                    <p className="font-display text-[28px] font-semibold tabular-nums text-ant-ink leading-none mt-2">
                                        {liveStats.earned.toLocaleString()}
                                        <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                    </p>
                                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-ant-line">
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Activité</span>
                                        <span className="font-display text-[12px] font-semibold text-ant-ink tabular-nums">
                                            {liveStats.units} unités · {liveStats.days} jours
                                        </span>
                                    </div>
                                </div>

                                {/* Versé (what was actually paid) */}
                                {(() => {
                                    const paid = Number(selectedPayment.paid_amount || 0);
                                    const total = liveStats.earned;
                                    const remaining = Math.max(0, total - paid);
                                    const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                                    const isPartial = selectedPayment.status === 'partial';
                                    return (
                                        <div className="rounded-xl bg-ant-ink p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                    Versé
                                                </div>
                                                <span className="text-[10px] font-semibold text-white/60 tabular-nums">{pct.toFixed(0)}%</span>
                                            </div>
                                            <p className="font-display text-[28px] font-semibold tabular-nums text-white leading-none">
                                                {paid.toLocaleString()}
                                                <span className="text-[12px] text-white/50 font-normal ml-1.5">MAD</span>
                                            </p>
                                            <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                                                <div className="h-full rounded-full bg-ant-orange transition-all" style={{ width: `${pct}%` }} />
                                            </div>
                                            {isPartial && remaining > 0 && (
                                                <p className="text-[11px] text-white/60 tabular-nums">
                                                    Reste <span className="font-semibold text-white">{remaining.toLocaleString()} MAD</span> à régler
                                                </p>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Bank info */}
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
                                            <p className="font-display text-[13px] font-semibold text-ant-ink mt-0.5">
                                                {selectedPayment.bank_snapshot?.name || <span className="font-serif italic font-normal text-ant-mid">—</span>}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">RIB</p>
                                            <p className="font-mono text-[12px] text-ant-ink mt-0.5">
                                                {selectedPayment.bank_snapshot?.rib || '—'}
                                            </p>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Titulaire</p>
                                            <p className="font-display text-[13px] font-semibold text-ant-ink mt-0.5">
                                                {selectedPayment.bank_snapshot?.holder || <span className="font-serif italic font-normal text-ant-mid">—</span>}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerPayments;
