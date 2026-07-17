import { useState, useEffect } from 'react';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Wallet as WalletIcon,
    TrendingUp,
    Calendar,
    Search,
    PackageCheck,
    ChevronLeft,
    ChevronRight,
    CalendarClock,
    CalendarDays,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface DailyEarning {
    id: string;
    date: string;
    salary_earned: number;
    commission_earned: number;
    delivered_count: number;
    total_earned: number;
}

const SellerWallet = () => {
    const [loading, setLoading] = useState(true);
    const [earnings, setEarnings] = useState<DailyEarning[]>([]);
    const [monthStats, setMonthStats] = useState({
        total: 0,
        salary: 0,
        commission: 0,
        days: 0,
        delivered: 0,
    });
    const [presenceDays, setPresenceDays] = useState(0);

    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const itemsPerPage = 8;

    useEffect(() => {
        fetchEarnings();
    }, []);

    const fetchEarnings = async () => {
        try {
            setLoading(true);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            // Paginated (silent 1000-row cap would drop the OLDEST days) and
            // slimmed to the 6 DailyEarning columns the page renders — the
            // view is O(history) per read, no reason to ship every column.
            const data = await fetchAllRows<DailyEarning>(
                'seller_daily_earnings',
                'id, date, salary_earned, commission_earned, delivered_count, total_earned',
                {
                    orderBy: 'date',
                    ascending: false,
                    filters: [{ column: 'seller_id', op: 'eq', value: session.user.id }],
                },
            );

            if (data) {
                setEarnings(data as DailyEarning[]);

                const start = startOfMonth(new Date());
                const end = endOfMonth(new Date());

                const currentMonthLogs = data.filter((curr) => {
                    const d = new Date(curr.date);
                    return d >= start && d <= end;
                });

                const stats = currentMonthLogs.reduce(
                    (acc, curr) => ({
                        total: acc.total + Number(curr.total_earned),
                        salary: 0,
                        commission: acc.commission + Number(curr.commission_earned),
                        days:
                            acc.days +
                            (Number(curr.commission_earned) > 0 || Number(curr.delivered_count) > 0 ? 1 : 0),
                        delivered: acc.delivered + Number(curr.delivered_count),
                    }),
                    { total: 0, salary: 0, commission: 0, days: 0, delivered: 0 },
                );

                setMonthStats(stats);
            }

            // KPI needs the COUNT only — head request returns zero rows.
            const { count: presenceCount, error: presenceError } = await supabase
                .from('seller_presences')
                .select('id', { count: 'exact', head: true })
                .eq('seller_id', session.user.id)
                .gte('date', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
                .lte('date', format(endOfMonth(new Date()), 'yyyy-MM-dd'));

            if (!presenceError && presenceCount != null) {
                setPresenceDays(presenceCount);
            }
        } catch (error) {
            console.error('Error fetching earnings:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEarnings = earnings.filter((e) =>
        format(new Date(e.date), 'EEEE, MMM d').toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const totalPages = Math.ceil(filteredEarnings.length / itemsPerPage);
    const paginatedEarnings = filteredEarnings.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
    );

    const nextPayout = format(startOfMonth(addMonths(new Date(), 1)), 'd MMM yyyy', { locale: fr });
    const monthLabel = format(new Date(), 'MMMM yyyy', { locale: fr });

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Commercial · Portefeuille
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Mon portefeuille
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        Vos gains jour par jour — commission cumulée, jours de présence, compte à rebours vers le prochain paiement.
                    </p>
                    <p className="font-serif italic text-[12px] text-ant-mid">{monthLabel}</p>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    {loading ? (
                        [1, 2, 3, 4].map((i) => (
                            <div key={i} className="bg-ant-paper p-4 animate-pulse">
                                <div className="h-3 w-24 bg-ant-line rounded" />
                                <div className="mt-3 h-6 w-20 bg-ant-line rounded" />
                                <div className="mt-2 h-3 w-28 bg-ant-line rounded" />
                            </div>
                        ))
                    ) : (
                        <>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                        Total du mois
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                        <WalletIcon className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {monthStats.total.toFixed(2)}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">MAD</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">commission cumulée</p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-ink" />
                                        Jours de présence
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-ink/6 border-ant-ink/15 text-ant-ink flex items-center justify-center">
                                        <CalendarDays className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                                    {presenceDays}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">jours</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">ce mois-ci</p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                        Livrées
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-green/10 border-ant-green/25 text-ant-green flex items-center justify-center">
                                        <PackageCheck className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                                    {monthStats.delivered}
                                    <span className="text-[12px] text-ant-mid font-normal ml-1.5">cmdes</span>
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{monthStats.days} jours actifs</p>
                            </div>
                            <div className="bg-ant-paper p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Prochain versement
                                    </div>
                                    <div className="h-8 w-8 rounded-lg border bg-ant-orange/10 border-ant-orange/25 text-ant-orange flex items-center justify-center">
                                        <CalendarClock className="w-4 h-4" strokeWidth={1.75} />
                                    </div>
                                </div>
                                <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                                    {nextPayout}
                                </p>
                                <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">date prévisionnelle</p>
                            </div>
                        </>
                    )}
                </section>

                {/* Timeline */}
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-ant-line">
                        <div className="space-y-1">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">01</span>
                                Chronologie des gains
                            </div>
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                                <span className="font-serif italic text-[12px] text-ant-mid">
                                    {filteredEarnings.length} {filteredEarnings.length > 1 ? 'jours enregistrés' : 'jour enregistré'}
                                </span>
                            </div>
                        </div>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <Input
                                type="text"
                                placeholder="Rechercher un jour…"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light">
                                    <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Date</th>
                                    <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Commission</th>
                                    <th className="px-5 py-2.5 text-left text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Activité</th>
                                    <th className="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.18em] text-ant-mid font-semibold">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    [1, 2, 3, 4, 5].map((i) => (
                                        <tr key={i} className="border-b border-ant-line">
                                            <td colSpan={4} className="px-5 py-3">
                                                <div className="h-4 w-full bg-ant-light rounded animate-pulse" />
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedEarnings.length > 0 ? (
                                    paginatedEarnings.map((log) => (
                                        <tr key={log.id} className="border-b border-ant-line hover:bg-ant-light/50 transition-colors">
                                            <td className="px-5 py-3">
                                                <div className="inline-flex items-center gap-2 font-display text-[13px] font-semibold text-ant-ink tabular-nums">
                                                    <Calendar className="w-3 h-3 text-ant-mid shrink-0" strokeWidth={1.75} />
                                                    {format(new Date(log.date), 'EEE, d MMM', { locale: fr })}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-green">
                                                +{Number(log.commission_earned).toFixed(2)}
                                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-ink/15 bg-ant-ink/6 px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                    <PackageCheck className="w-2.5 h-2.5" strokeWidth={2} />
                                                    {log.delivered_count} livrées
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-right font-display text-[13px] font-semibold tabular-nums text-ant-ink">
                                                {Number(log.total_earned).toFixed(2)}
                                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={4} className="p-0">
                                            <div className="mx-5 my-5 rounded-xl border border-dashed border-ant-line bg-ant-light/50 py-10 flex flex-col items-center justify-center gap-2 text-center">
                                                <div className="h-10 w-10 rounded-xl border border-ant-line bg-ant-paper flex items-center justify-center">
                                                    <WalletIcon className="w-4 h-4 text-ant-mid" strokeWidth={1.5} />
                                                </div>
                                                <p className="font-serif italic text-[12px] text-ant-mid">
                                                    {searchQuery ? 'Aucune correspondance' : 'Aucun gain enregistré pour le moment'}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-ant-line flex items-center justify-between bg-ant-light/50">
                            <span className="font-serif italic text-[11px] text-ant-mid">
                                {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredEarnings.length)} sur {filteredEarnings.length}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    aria-label="Précédente"
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed text-ant-ink cursor-pointer transition-colors"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </button>
                                {[...Array(Math.min(totalPages, 5))].map((_, i) => {
                                    const pageNum = i + 1;
                                    const active = currentPage === pageNum;
                                    return (
                                        <button
                                            key={pageNum}
                                            type="button"
                                            onClick={() => setCurrentPage(pageNum)}
                                            className={cn(
                                                'inline-flex items-center justify-center h-8 w-8 rounded-lg text-[11px] font-semibold tabular-nums cursor-pointer transition-colors',
                                                active
                                                    ? 'bg-ant-ink text-white'
                                                    : 'border border-ant-line bg-ant-paper hover:bg-ant-light text-ant-ink',
                                            )}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                                {totalPages > 5 && <span className="text-[11px] text-ant-mid font-serif italic">…</span>}
                                <button
                                    type="button"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    aria-label="Suivante"
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-ant-line bg-ant-paper hover:bg-ant-light disabled:opacity-40 disabled:cursor-not-allowed text-ant-ink cursor-pointer transition-colors"
                                >
                                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default SellerWallet;
