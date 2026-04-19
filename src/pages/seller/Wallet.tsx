import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet as WalletIcon,
    TrendingUp,
    Calendar,
    Search,
    Clock,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';

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
        delivered: 0
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

            const { data, error } = await supabase
                .from('seller_daily_earnings')
                .select('*')
                .eq('seller_id', session.user.id)
                .order('date', { ascending: false });

            if (error) throw error;

            if (data) {
                setEarnings(data as DailyEarning[]);

                const start = startOfMonth(new Date());
                const end = endOfMonth(new Date());

                const currentMonthLogs = data.filter(curr => {
                    const d = new Date(curr.date);
                    return d >= start && d <= end;
                });

                const stats = currentMonthLogs.reduce((acc, curr) => ({
                    total: acc.total + Number(curr.total_earned),
                    salary: 0,
                    commission: acc.commission + Number(curr.commission_earned),
                    days: acc.days + (Number(curr.commission_earned) > 0 || Number(curr.delivered_count) > 0 ? 1 : 0),
                    delivered: acc.delivered + Number(curr.delivered_count)
                }), { total: 0, salary: 0, commission: 0, days: 0, delivered: 0 });

                setMonthStats(stats);
            }

            const { data: presenceData, error: presenceError } = await supabase
                .from('seller_presences')
                .select('id, date')
                .eq('seller_id', session.user.id)
                .gte('date', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
                .lte('date', format(endOfMonth(new Date()), 'yyyy-MM-dd'));

            if (!presenceError && presenceData) {
                setPresenceDays(presenceData.length);
            }
        } catch (error) {
            console.error('Error fetching earnings:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEarnings = earnings.filter(e =>
        format(new Date(e.date), 'EEEE, MMM d').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalPages = Math.ceil(filteredEarnings.length / itemsPerPage);
    const paginatedEarnings = filteredEarnings.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Financial Wallet</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">{format(new Date(), 'MMMM yyyy')} · Earnings Overview</p>
                    </div>
                </div>
            </header>

            {/* KPI Tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {loading ? (
                    <>
                        {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
                    </>
                ) : (
                    <>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Month Total</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{monthStats.total.toFixed(2)} <span className="text-[11px] text-gray-400">MAD</span></p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Presence Days</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{presenceDays} <span className="text-[11px] text-gray-400">Days</span></p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Delivered</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{monthStats.delivered} <span className="text-[11px] text-gray-400">Orders</span></p>
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: '#d97706' }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Next Payout</p>
                                <p className="text-[13px] font-semibold tabular-nums text-brand-navy mt-1">{format(startOfMonth(addMonths(new Date(), 1)), 'MMM d, yyyy')}</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Earnings History Table */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardContent className="p-0">
                    {/* Card header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 pt-3 pb-2.5 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5 text-brand-navy/50" />
                            <span className="text-[11px] font-semibold text-brand-navy">Earning Timeline</span>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                type="text"
                                placeholder="Search days..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="pl-7 h-8 w-52 text-[11px] rounded-md border-gray-100 bg-gray-50"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Date</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Commission</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Activity</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    [1, 2, 3, 4, 5].map((i) => (
                                        <tr key={i}>
                                            <td colSpan={4} className="px-3 py-2">
                                                <Skeleton className="h-6 w-full rounded" />
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedEarnings.length > 0 ? (
                                    paginatedEarnings.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100">
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                                <div className="flex items-center gap-1.5">
                                                    <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
                                                    {format(new Date(log.date), 'EEE, MMM d')}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                                +{Number(log.commission_earned).toFixed(2)} MAD
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-500">
                                                    <Clock className="w-2.5 h-2.5" />
                                                    {log.delivered_count} delivered
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums">
                                                {Number(log.total_earned).toFixed(2)} MAD
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={4}>
                                            <div className="border border-dashed border-gray-200 rounded-xl py-8 mx-3 my-3 flex flex-col items-center justify-center text-center">
                                                <WalletIcon className="w-6 h-6 text-gray-400 mb-2" />
                                                <p className="text-[11px] font-medium text-gray-400">No earnings records found.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {totalPages > 1 && (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] text-gray-400">
                                                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredEarnings.length)} of {filteredEarnings.length}
                                                </p>
                                                <div className="flex items-center gap-1.5">
                                                    <Button
                                                        variant="outline"
                                                        disabled={currentPage === 1}
                                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                                        className="h-8 w-8 p-0 rounded-md border-gray-200"
                                                    >
                                                        <ChevronLeft className="w-3.5 h-3.5" />
                                                    </Button>
                                                    {[...Array(totalPages)].map((_, i) => (
                                                        <Button
                                                            key={i + 1}
                                                            variant={currentPage === i + 1 ? "default" : "outline"}
                                                            onClick={() => setCurrentPage(i + 1)}
                                                            className={`h-8 w-8 p-0 rounded-md text-[11px] ${currentPage === i + 1 ? 'bg-brand-navy border-0 text-white' : 'border-gray-200 text-gray-400'}`}
                                                        >
                                                            {i + 1}
                                                        </Button>
                                                    ))}
                                                    <Button
                                                        variant="outline"
                                                        disabled={currentPage === totalPages}
                                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                                        className="h-8 w-8 p-0 rounded-md border-gray-200"
                                                    >
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default SellerWallet;
