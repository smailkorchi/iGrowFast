import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet as WalletIcon,
    TrendingUp,
    Calendar,
    DollarSign,
    ArrowUpRight,
    History,
    ChevronRight,
    ChevronLeft,
    Search,
    Download,
    PieChart,
    ArrowDownRight,
    Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { format, startOfMonth, endOfMonth } from 'date-fns';

interface DailyEarning {
    id: string;
    date: string;
    salary_earned: number;
    commission_earned: number;
    delivered_count: number;
    total_earned: number;
}

const SellerWallet = () => {
    const navigate = useNavigate();
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
                    commission: acc.commission + Number(curr.commission_earned),
                    days: acc.days + (Number(curr.commission_earned) > 0 || Number(curr.delivered_count) > 0 ? 1 : 0),
                    delivered: acc.delivered + Number(curr.delivered_count)
                }), { total: 0, commission: 0, days: 0, delivered: 0 });

                setMonthStats(stats);
            }

            // Fetch actual presence days from seller_presences
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
        <div className="space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-12">
            {/* Header */}
            <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent rounded-3xl opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="relative p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-white shadow-2xl rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                            <WalletIcon className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-1 tracking-tight">Financial Wallet</h1>
                            <p className="text-gray-500 font-light flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-gray-400" />
                                {format(new Date(), 'MMMM yyyy')} · Live Earnings Pulse
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-primary/5 rounded-2xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                <DollarSign className="w-6 h-6 text-primary" />
                            </div>
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-0 font-medium">Month Pot</Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-3xl font-medium text-gray-900 tracking-tight">{monthStats.total.toFixed(2)} <span className="text-lg font-light text-gray-400">MAD</span></p>
                            <p className="text-sm text-gray-500 font-light">Accumulated Earnings</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                <Clock className="w-6 h-6 text-blue-600" />
                            </div>
                            <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-0 font-medium">Presence</Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-3xl font-medium text-gray-900 tracking-tight">{presenceDays} <span className="text-lg font-light text-gray-400">Days</span></p>
                            <p className="text-sm text-gray-500 font-light">Verified attendance</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center group-hover:bg-green-100 transition-colors">
                                <TrendingUp className="w-6 h-6 text-green-600" />
                            </div>
                            <Badge variant="secondary" className="bg-green-50 text-green-600 border-0 font-medium">Sales</Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-3xl font-medium text-gray-900 tracking-tight">{monthStats.delivered} <span className="text-lg font-light text-gray-400">Orders</span></p>
                            <p className="text-sm text-gray-500 font-light">Total delivered</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-white hover:shadow-2xl transition-all duration-500 group">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                                <PieChart className="w-6 h-6 text-purple-600" />
                            </div>
                            <Badge variant="secondary" className="bg-purple-50 text-purple-600 border-0 font-medium">Monthly Stats</Badge>
                        </div>
                        <div className="space-y-1">
                            <p className="text-3xl font-medium text-gray-900 tracking-tight">{monthStats.delivered} <span className="text-lg font-light text-gray-400">Orders</span></p>
                            <p className="text-sm text-gray-500 font-light">Performance overview</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Daily History */}
            <Card className="border-0 shadow-2xl rounded-[2rem] overflow-hidden bg-white">
                <CardHeader className="border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                                <History className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-light text-gray-900">Earning Timeline</CardTitle>
                                <CardDescription className="font-light">Daily breakdown of your financial performance</CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <input
                                    type="text"
                                    placeholder="Search days..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="pl-11 pr-4 h-11 w-64 rounded-2xl border-gray-100 bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-primary/5 transition-all duration-300 outline-none text-sm font-light"
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-left border-b border-gray-50/50 bg-gray-50/30">
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Date Log</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Earnings Details</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Activity Status</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400 text-right">Day Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {loading ? (
                                    [1, 2, 3, 4, 5].map((i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={5} className="p-8">
                                                <div className="h-4 bg-gray-50 rounded-full w-full" />
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedEarnings.length > 0 ? (
                                    paginatedEarnings.map((log) => (
                                        <tr key={log.id} className="group hover:bg-gray-50/50 transition-colors duration-300">
                                            <td className="p-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                                                        <Calendar className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">{format(new Date(log.date), 'EEEE, MMM d')}</p>
                                                        <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Verified presence</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                                                    <span className="text-sm text-gray-600 font-mono tracking-tighter">+{Number(log.commission_earned).toFixed(2)} MAD Portfolio</span>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <Badge variant="outline" className="rounded-lg border-gray-200 text-gray-500 font-light px-2 h-6">
                                                    {log.delivered_count} Units Delivered
                                                </Badge>
                                            </td>
                                            <td className="p-6 text-right">
                                                <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-2xl border border-gray-100 shadow-sm group-hover:border-primary/20 group-hover:shadow-md transition-all duration-300">
                                                    <span className="text-base font-semibold text-gray-900">{Number(log.total_earned).toFixed(2)}</span>
                                                    <span className="text-[10px] text-gray-400 font-light">MAD</span>
                                                    <ArrowUpRight className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all duration-300" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="p-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-gray-400 font-light">
                                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                                    <WalletIcon className="w-8 h-8 text-gray-200" />
                                                </div>
                                                <p className="text-lg">No earnings records found.</p>
                                                <p className="text-sm opacity-60 mt-1">Start working to see your wallet grow!</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {totalPages > 1 && (
                                    <tr>
                                        <td colSpan={5} className="p-6 bg-gray-50/30">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs text-gray-400 font-light">
                                                    Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredEarnings.length)} of {filteredEarnings.length} entries
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="outline"
                                                        disabled={currentPage === 1}
                                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                                        className="h-8 w-8 p-0 rounded-lg border-gray-200"
                                                    >
                                                        <ChevronLeft className="w-4 h-4" />
                                                    </Button>
                                                    {[...Array(totalPages)].map((_, i) => (
                                                        <Button
                                                            key={i + 1}
                                                            variant={currentPage === i + 1 ? "default" : "outline"}
                                                            onClick={() => setCurrentPage(i + 1)}
                                                            className={`h-8 w-8 p-0 rounded-lg text-xs ${currentPage === i + 1 ? 'bg-primary border-0' : 'border-gray-200 text-gray-400'}`}
                                                        >
                                                            {i + 1}
                                                        </Button>
                                                    ))}
                                                    <Button
                                                        variant="outline"
                                                        disabled={currentPage === totalPages}
                                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                                        className="h-8 w-8 p-0 rounded-lg border-gray-200"
                                                    >
                                                        <ChevronRight className="w-4 h-4" />
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

            {/* Bottom Insight Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                    <Card className="h-full border-0 shadow-xl rounded-3xl overflow-hidden bg-white">
                        <CardHeader className="p-8 pb-0">
                            <CardTitle className="text-xl font-light text-gray-900 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-primary" />
                                Earnings Distribution
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 pt-6">
                            <div className="flex items-center gap-8 h-40">
                                <div className="flex-1 space-y-4">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                                            <span>Commission Earned</span>
                                            <span className="font-mono">{monthStats.total > 0 ? 100 : 0}%</span>
                                        </div>
                                        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${monthStats.total > 0 ? 100 : 0}%` }} />
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-400 font-light leading-relaxed">
                                        Your monthly revenue is derived from successfully delivered orders and performance milestones.
                                    </div>
                                </div>
                                <div className="w-32 h-32 flex items-center justify-center relative">
                                    <div className="absolute inset-0 border-[12px] border-gray-50 rounded-full" />
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 uppercase tracking-tighter">Total</p>
                                        <p className="text-xl font-medium">{monthStats.total.toFixed(0)}</p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <Card className="border-0 shadow-xl rounded-3xl overflow-hidden bg-primary group">
                    <CardContent className="p-8 h-full flex flex-col justify-between relative">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-700">
                            <PieChart className="w-32 h-32 text-white" />
                        </div>
                        <div className="relative">
                            <h4 className="text-white/80 text-sm font-light uppercase tracking-widest mb-2">Next Payout</h4>
                            <p className="text-white text-3xl font-medium tracking-tight">March 1, 2026</p>
                            <p className="text-white/60 text-xs font-light mt-4 leading-relaxed">
                                Your balance will be automatically finalized at the end of the month.
                            </p>
                        </div>
                        <Button className="w-full bg-white text-primary hover:bg-white/90 rounded-2xl h-12 shadow-lg mt-8 group">
                            View Schedule
                            <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default SellerWallet;
