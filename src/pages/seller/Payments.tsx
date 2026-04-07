import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet,
    Calendar,
    ChevronRight,
    ArrowUpRight,
    CheckCircle2,
    Clock,
    Receipt,
    Eye,
    TrendingUp,
    Download,
    Building2,
    CreditCard
} from 'lucide-react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Area,
    AreaChart
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

interface SellerPayment {
    id: string;
    payout_month: string;
    salary_earned: number;
    commission_earned: number;
    total_amount: number;
    days_present: number;
    delivered_orders: number;
    bank_snapshot: any;
    status: string;
    paid_at: string | null;
    created_at: string;
    updated_at?: string | null;
}

/** Shown in Settlement Logs; prefers explicit paid_at set when admin marks paid. */
function settledDateIso(p: SellerPayment): string | null {
    if (p.paid_at) return p.paid_at;
    if (p.updated_at) return p.updated_at;
    return p.created_at || null;
}

const SellerPayments = () => {
    const [payments, setPayments] = useState<SellerPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        lifetime: 0,
        thisMonth: 0,
        lastMonth: 0
    });
    const [chartData, setChartData] = useState<any[]>([]);
    const [selectedPayment, setSelectedPayment] = useState<SellerPayment | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    useEffect(() => {
        fetchPayments();
    }, []);

    const fetchPayments = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Fetch only 'paid' payments as requested
            const { data, error } = await supabase
                .from('seller_payments')
                .select('*')
                .eq('seller_id', user.id)
                .eq('status', 'paid')
                .order('payout_month', { ascending: true });

            if (error) throw error;

            const paidPayments = data || [];
            setPayments([...paidPayments].reverse()); // Table shows latest first

            // Calculate Stats
            const lifetime = paidPayments.reduce((sum, p) => sum + Number(p.total_amount), 0);

            const now = new Date();
            const thisMonthStr = format(now, 'yyyy-MM-01');
            const thisMonth = paidPayments
                .filter(p => p.payout_month === thisMonthStr)
                .reduce((sum, p) => sum + Number(p.total_amount), 0);

            const lastMonthStr = format(new Date(now.getFullYear(), now.getMonth() - 1), 'yyyy-MM-01');
            const lastMonth = paidPayments
                .filter(p => p.payout_month === lastMonthStr)
                .reduce((sum, p) => sum + Number(p.total_amount), 0);

            setStats({ lifetime, thisMonth, lastMonth });

            // Prepare Chart Data
            const monthlyData = paidPayments.map(p => {
                const date = p.payout_month ? parseISO(p.payout_month) : null;
                return {
                    month: date && !isNaN(date.getTime()) ? format(date, 'MMM yyyy') : 'Unknown',
                    amount: Number(p.total_amount),
                    commission: Number(p.commission_earned)
                };
            });
            setChartData(monthlyData);

        } catch (error) {
            console.error('Error fetching payments:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header Area */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Earnings Hub</h1>
                            <p className="text-gray-500 font-light">Your verified monthly settlements and financial performance.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card className="border-0 shadow-xl rounded-3xl bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white overflow-hidden relative group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl group-hover:bg-primary/20 transition-colors duration-700" />
                        <CardContent className="p-8 relative z-10">
                            <div className="flex items-center justify-between mb-8">
                                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md">
                                    <TrendingUp className="w-7 h-7 text-primary" />
                                </div>
                                <Badge className="bg-primary/20 text-primary border-primary/20 backdrop-blur-md px-4 py-1">Verified Total</Badge>
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-light text-gray-400 uppercase tracking-widest">Lifetime Earnings</p>
                                <div className="flex items-baseline gap-2">
                                    <h2 className="text-5xl font-extralight tracking-tight">{stats.lifetime.toLocaleString()}</h2>
                                    <span className="text-xl font-light text-gray-500">MAD</span>
                                </div>
                                <p className="text-xs text-gray-500 font-light pt-2 flex items-center gap-2">
                                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                                    Cumulative paid settlements to date
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <Card className="border-0 shadow-xl rounded-3xl bg-white overflow-hidden group">
                        <CardContent className="p-8">
                            <div className="flex items-center justify-between mb-8">
                                <div className="w-14 h-14 bg-primary/5 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                                    <Receipt className="w-7 h-7 text-primary" />
                                </div>
                                <Badge variant="outline" className="border-gray-100 text-gray-400 font-light px-4 py-1">Current Cycle</Badge>
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-light text-gray-500 uppercase tracking-widest">{format(new Date(), 'MMMM yyyy')}</p>
                                <div className="flex items-baseline gap-2">
                                    <h2 className="text-5xl font-extralight tracking-tight text-gray-900">{stats.thisMonth.toLocaleString()}</h2>
                                    <span className="text-xl font-light text-gray-400">MAD</span>
                                </div>
                                <div className="pt-2 flex items-center gap-3">
                                    <div className={`flex items-center gap-1 text-xs font-medium ${stats.thisMonth >= stats.lastMonth ? 'text-green-600' : 'text-orange-600'}`}>
                                        <ArrowUpRight className={`w-3 h-3 ${stats.thisMonth >= stats.lastMonth ? '' : 'rotate-90'}`} />
                                        {stats.lastMonth > 0 ? (((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100).toFixed(0) : '100'}%
                                    </div>
                                    <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Compared to last month ({stats.lastMonth.toLocaleString()} MAD)</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>

            {/* Performance Chart */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
            >
                <Card className="border-0 shadow-2xl rounded-[2rem] overflow-hidden bg-white">
                    <CardHeader className="p-8 border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-transparent">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl font-light text-gray-900">Revenue Growth</CardTitle>
                                <CardDescription className="font-light">Monthly payout progression curve</CardDescription>
                            </div>
                            <div className="hidden md:flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-primary" />
                                    <span className="text-xs text-gray-500 font-light">Total Payout</span>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-8 pt-10">
                        <div className="h-[350px] w-full">
                            {chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData}>
                                        <defs>
                                            <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#F4623A" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#F4623A" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis
                                            dataKey="month"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fill: '#9CA3AF', fontWeight: 300 }}
                                            dy={10}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fill: '#9CA3AF', fontWeight: 300 }}
                                            tickFormatter={(value) => `${value}`}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: '#111827',
                                                border: 'none',
                                                borderRadius: '1.5rem',
                                                color: '#fff',
                                                padding: '1.25rem',
                                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                                            }}
                                            itemStyle={{ color: '#fff', fontSize: '14px', fontWeight: 300 }}
                                            cursor={{ stroke: '#F4623A', strokeWidth: 2, strokeDasharray: '5 5' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="amount"
                                            stroke="#F4623A"
                                            strokeWidth={4}
                                            fillOpacity={1}
                                            fill="url(#colorAmount)"
                                            animationDuration={2000}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex items-center justify-center text-gray-400 font-light">
                                    No historical data to display yet
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* Payout History Table */}
            <Card className="border-0 shadow-2xl rounded-[2rem] overflow-hidden bg-white">
                <CardHeader className="p-8 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <Wallet className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-2xl font-light text-gray-900">Settlement Logs</CardTitle>
                            <CardDescription className="font-light">Official record of your confirmed payouts</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-left border-b border-gray-50/50 bg-gray-50/30">
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Payment ID</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Payout Period</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Performance Index</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Settled Date</th>
                                    <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400 text-right">Net Payout</th>
                                    <th className="p-6"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {payments.length > 0 ? (
                                    payments.map((p) => (
                                        <tr key={p.id} className="group hover:bg-gray-50/50 transition-colors duration-300">
                                            <td className="p-6">
                                                <code className="text-[10px] text-gray-400 font-mono">#{p.id.slice(0, 8).toUpperCase()}</code>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                                                        <Calendar className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {(() => {
                                                                const date = parseISO(p.payout_month);
                                                                return isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'MMMM yyyy');
                                                            })()}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Settlement Window</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <div className="flex items-center gap-3">
                                                    <Badge variant="outline" className="rounded-lg border-gray-100 font-light px-2 h-6 text-gray-500">
                                                        {p.days_present} Days
                                                    </Badge>
                                                    <Badge variant="outline" className="rounded-lg border-gray-100 font-light px-2 h-6 text-gray-500">
                                                        {p.delivered_orders} Units
                                                    </Badge>
                                                </div>
                                            </td>
                                            <td className="p-6">
                                                <p className="text-sm text-gray-600 font-light italic">
                                                    {(() => {
                                                        const iso = settledDateIso(p);
                                                        return iso
                                                            ? format(new Date(iso), 'MMM dd, yyyy')
                                                            : 'N/A';
                                                    })()}
                                                </p>
                                            </td>
                                            <td className="p-6 text-right">
                                                <p className="text-lg font-medium text-gray-900">{Number(p.total_amount).toLocaleString()} <span className="text-xs font-light text-gray-400">MAD</span></p>
                                            </td>
                                            <td className="p-6 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setSelectedPayment(p);
                                                        setIsDetailModalOpen(true);
                                                    }}
                                                    className="w-10 h-10 rounded-xl hover:bg-white hover:shadow-md transition-all text-gray-400 hover:text-primary"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="p-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-gray-400 font-light">
                                                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                                    <Receipt className="w-8 h-8 text-gray-200" />
                                                </div>
                                                <p className="text-lg">No confirmed payments yet.</p>
                                                <p className="text-sm opacity-60 mt-1">Earnings will appear here once processed by admin.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Detail Modal */}
            <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
                <DialogContent className="max-w-2xl p-0 border-0 overflow-hidden rounded-[2.5rem] bg-gray-50 flex flex-col max-h-[92vh]">
                    {selectedPayment && (
                        <div className="overflow-y-auto scrollbar-hide">
                            <div className="relative p-10 bg-white">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-50" />
                                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center shadow-inner">
                                            <Receipt className="w-10 h-10 text-primary" />
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-extralight text-gray-900">Settlement Report</h2>
                                            <p className="text-gray-500 font-light flex items-center gap-2 mt-1">
                                                <Calendar className="w-4 h-4 text-primary/40" />
                                                {(() => {
                                                    const date = parseISO(selectedPayment.payout_month);
                                                    return isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'MMMM yyyy');
                                                })()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <Badge className="bg-green-50 text-green-600 border-green-100 px-6 py-2 rounded-2xl text-xs uppercase tracking-widest font-bold">
                                            Verified Paid
                                        </Badge>
                                        {(() => {
                                            const iso = settledDateIso(selectedPayment);
                                            return iso ? (
                                                <p className="text-xs text-gray-500 mt-2 font-light">
                                                    Settled {format(new Date(iso), 'MMM d, yyyy')}
                                                </p>
                                            ) : null;
                                        })()}
                                        <p className="text-[10px] text-gray-300 mt-2 font-mono">TRANS_ID: {selectedPayment.id.slice(0, 12).toUpperCase()}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-10 space-y-8">
                                {/* Financial Grid */}
                                <div className="grid grid-cols-1 gap-6">
                                    <div className="p-6 rounded-3xl bg-white shadow-sm border border-gray-100 flex flex-col justify-between group hover:shadow-md transition-shadow">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-4">Settlement Breakdown</p>
                                        <p className="text-3xl font-light text-gray-900">{Number(selectedPayment.commission_earned).toLocaleString()} <span className="text-sm font-light text-gray-400">MAD</span></p>
                                        <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                                            <span className="text-[10px] text-gray-400 uppercase font-bold">Activity</span>
                                            <span className="text-xs font-medium text-gray-600">{selectedPayment.delivered_orders} Units · {selectedPayment.days_present} Days</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Total Area */}
                                <div className="p-8 rounded-[2rem] bg-gray-900 text-white shadow-2xl flex items-center justify-between relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl group-hover:bg-primary/30 transition-colors" />
                                    <div className="relative z-10">
                                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1">Total Disbursed Amount</p>
                                        <p className="text-5xl font-extralight tracking-tight">{Number(selectedPayment.total_amount).toLocaleString()} <span className="text-xl font-light opacity-40">MAD</span></p>
                                    </div>

                                </div>

                                {/* Bank Info Card */}
                                <Card className="border-0 shadow-sm rounded-3xl bg-white border border-gray-100">
                                    <CardContent className="p-6 flex items-start gap-4">
                                        <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
                                            <Building2 className="w-6 h-6 text-gray-400" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-sm font-medium text-gray-900">Destination Account</h3>
                                                <Badge variant="outline" className="text-[10px] uppercase border-gray-100 px-2 py-0 h-5">Snapshot at Payout</Badge>
                                            </div>
                                            <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                                                <div>
                                                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Bank Name</p>
                                                    <p className="text-sm text-gray-600">{selectedPayment.bank_snapshot?.name || 'N/A'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">RIB Account</p>
                                                    <p className="text-sm text-gray-600 font-mono tracking-tighter">{selectedPayment.bank_snapshot?.rib || 'N/A'}</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Account Holder</p>
                                                    <p className="text-sm text-gray-600">{selectedPayment.bank_snapshot?.holder || 'N/A'}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>


                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerPayments;
