import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Wallet,
    Calendar,
    CheckCircle2,
    Receipt,
    Eye,
    Building2,
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { format, parseISO } from 'date-fns';

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

function settledDateIso(p: SellerPayment): string | null {
    if (p.paid_at) return p.paid_at;
    if (p.updated_at) return p.updated_at;
    return p.created_at || null;
}

const SellerPayments = () => {
    const [payments, setPayments] = useState<SellerPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ lifetime: 0, thisMonth: 0, lastMonth: 0 });
    const [chartData, setChartData] = useState<any[]>([]);
    const [selectedPayment, setSelectedPayment] = useState<SellerPayment | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    useEffect(() => { fetchPayments(); }, []);

    const fetchPayments = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from('seller_payments')
                .select('*')
                .eq('seller_id', user.id)
                .eq('status', 'paid')
                .order('payout_month', { ascending: true });
            if (error) throw error;

            const paidPayments = data || [];
            setPayments([...paidPayments].reverse());

            const lifetime = paidPayments.reduce((sum, p) => sum + Number(p.total_amount), 0);
            const now = new Date();
            const thisMonthStr = format(now, 'yyyy-MM-01');
            const thisMonth = paidPayments.filter(p => p.payout_month === thisMonthStr).reduce((sum, p) => sum + Number(p.total_amount), 0);
            const lastMonthStr = format(new Date(now.getFullYear(), now.getMonth() - 1), 'yyyy-MM-01');
            const lastMonth = paidPayments.filter(p => p.payout_month === lastMonthStr).reduce((sum, p) => sum + Number(p.total_amount), 0);
            setStats({ lifetime, thisMonth, lastMonth });

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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
            </div>
        );
    }

    const growthPct = stats.lastMonth > 0
        ? (((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100).toFixed(0)
        : '100';
    const growthPos = stats.thisMonth >= stats.lastMonth;

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Earnings Hub
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Verified monthly settlements
                        </p>
                    </div>
                </div>
            </header>

            {/* KPI tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#3b5e5e' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Lifetime Earnings</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{stats.lifetime.toLocaleString()} MAD</p>
                        <p className="text-[9px] text-gray-400 mt-0.5 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-[#059669]" />
                            Cumulative paid settlements
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#059669' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{format(new Date(), 'MMMM yyyy')}</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{stats.thisMonth.toLocaleString()} MAD</p>
                        <p className="text-[9px] mt-0.5 flex items-center gap-1" style={{ color: growthPos ? '#059669' : '#ef4444' }}>
                            {growthPos ? '+' : ''}{growthPct}% vs last month ({stats.lastMonth.toLocaleString()} MAD)
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#d97706' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total Payouts</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{payments.length}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">Confirmed settlement periods</p>
                    </div>
                </div>
            </div>

            {/* Revenue chart */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardHeader className="p-3.5 pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[11px] font-semibold text-brand-navy">Revenue Growth</p>
                            <p className="text-[9px] text-gray-400 mt-0.5">
                                <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#3b5e5e] inline-block" />
                                    Monthly payout progression
                                </span>
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-3.5 pb-3.5">
                    <div className="h-[160px]">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="sellerPayGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.12} />
                                            <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} dy={4} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} width={40} />
                                    <Tooltip
                                        contentStyle={{ background: '#fff', border: '1px solid #f3f4f6', borderRadius: 8, boxShadow: 'none', fontSize: 11 }}
                                        formatter={(v: number) => [`${v.toLocaleString()} MAD`, 'Total Payout']}
                                    />
                                    <Area type="monotone" dataKey="amount" stroke="#3b5e5e" strokeWidth={2} fill="url(#sellerPayGrad)" fillOpacity={1} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-[11px] text-gray-400">
                                No historical data to display yet
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Settlement Logs table */}
            <Card className="border border-gray-100 shadow-none rounded-xl">
                <CardHeader className="p-3.5 pb-2">
                    <div className="flex items-center gap-2">
                        <Wallet className="w-3.5 h-3.5 text-gray-400" />
                        <div>
                            <p className="text-[11px] font-semibold text-brand-navy">Settlement Logs</p>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-gray-400 mt-0.5">Official record of confirmed payouts</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-left border-b border-gray-50 bg-gray-50/40">
                                    <th className="px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Payment ID</th>
                                    <th className="px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Period</th>
                                    <th className="px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Activity</th>
                                    <th className="px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400">Settled</th>
                                    <th className="px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 text-right">Net Payout</th>
                                    <th className="px-3.5 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {payments.length > 0 ? (
                                    payments.map((p) => (
                                        <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-3.5 py-2.5">
                                                <code className="text-[10px] text-gray-400 font-mono">#{p.id.slice(0, 8).toUpperCase()}</code>
                                            </td>
                                            <td className="px-3.5 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    <div>
                                                        <p className="text-[11px] font-semibold text-brand-navy">
                                                            {(() => {
                                                                const date = parseISO(p.payout_month);
                                                                return isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'MMMM yyyy');
                                                            })()}
                                                        </p>
                                                        <p className="text-[9px] text-gray-400 uppercase tracking-wider">Settlement window</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3.5 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <Badge variant="outline" className="rounded border-gray-100 text-[9px] font-semibold h-5 px-1.5 text-gray-500">
                                                        {p.days_present} days
                                                    </Badge>
                                                    <Badge variant="outline" className="rounded border-gray-100 text-[9px] font-semibold h-5 px-1.5 text-gray-500">
                                                        {p.delivered_orders} units
                                                    </Badge>
                                                </div>
                                            </td>
                                            <td className="px-3.5 py-2.5">
                                                <p className="text-[11px] text-gray-500">
                                                    {(() => {
                                                        const iso = settledDateIso(p);
                                                        return iso ? format(new Date(iso), 'MMM dd, yyyy') : 'N/A';
                                                    })()}
                                                </p>
                                            </td>
                                            <td className="px-3.5 py-2.5 text-right">
                                                <p className="text-[13px] font-semibold text-brand-navy tabular-nums">
                                                    {Number(p.total_amount).toLocaleString()} <span className="text-[10px] text-gray-400">MAD</span>
                                                </p>
                                            </td>
                                            <td className="px-3.5 py-2.5 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => { setSelectedPayment(p); setIsDetailModalOpen(true); }}
                                                    className="w-7 h-7 rounded-md text-gray-400 hover:text-brand-navy hover:bg-gray-100"
                                                >
                                                    <Eye className="w-3.5 h-3.5" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-3.5 py-12 text-center">
                                            <Receipt className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                            <p className="text-[11px] text-gray-400">No confirmed payments yet.</p>
                                            <p className="text-[10px] text-gray-300 mt-0.5">Earnings will appear here once processed by admin.</p>
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
                <DialogContent className="max-w-xl border border-gray-100 shadow-none rounded-xl p-0 overflow-hidden bg-white">
                    {selectedPayment && (
                        <div className="overflow-y-auto max-h-[80vh]">
                            <DialogHeader className="p-4 border-b border-gray-50">
                                <div className="flex items-center gap-2">
                                    <Receipt className="w-4 h-4 text-gray-400" />
                                    <div>
                                        <DialogTitle className="text-[13px] font-semibold text-brand-navy">Settlement Report</DialogTitle>
                                        <DialogDescription className="text-[10px] text-gray-400 mt-0.5">
                                            {(() => {
                                                const date = parseISO(selectedPayment.payout_month);
                                                return isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'MMMM yyyy');
                                            })()}
                                        </DialogDescription>
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="p-4 space-y-3">
                                {/* Status badge */}
                                <div className="flex items-center justify-between">
                                    <Badge className="bg-[#05966920] text-[#059669] border-0 text-[9px] font-bold uppercase tracking-wider h-5 px-2 rounded">
                                        Verified Paid
                                    </Badge>
                                    {(() => {
                                        const iso = settledDateIso(selectedPayment);
                                        return iso ? (
                                            <p className="text-[10px] text-gray-400">Settled {format(new Date(iso), 'MMM d, yyyy')}</p>
                                        ) : null;
                                    })()}
                                </div>

                                {/* Commission breakdown */}
                                <div className="rounded-lg border border-gray-100 p-3">
                                    <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 mb-2">Settlement Breakdown</p>
                                    <p className="text-[22px] font-semibold text-brand-navy tabular-nums">
                                        {Number(selectedPayment.commission_earned).toLocaleString()} <span className="text-[11px] text-gray-400">MAD</span>
                                    </p>
                                    <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
                                        <span className="text-[9px] text-gray-400 uppercase font-bold">Activity</span>
                                        <span className="text-[10px] font-semibold text-gray-600">{selectedPayment.delivered_orders} units · {selectedPayment.days_present} days</span>
                                    </div>
                                </div>

                                {/* Total */}
                                <div className="rounded-lg bg-brand-navy p-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-gray-400 mb-1">Total Disbursed</p>
                                        <p className="text-[22px] font-semibold text-white tabular-nums">
                                            {Number(selectedPayment.total_amount).toLocaleString()} <span className="text-[11px] text-gray-400">MAD</span>
                                        </p>
                                    </div>
                                </div>

                                {/* Bank info */}
                                <div className="rounded-lg border border-gray-100 p-3">
                                    <div className="flex items-center gap-2 mb-2.5">
                                        <Building2 className="w-3.5 h-3.5 text-gray-400" />
                                        <p className="text-[10px] font-semibold text-gray-600">Destination Account</p>
                                        <Badge variant="outline" className="ml-auto text-[9px] uppercase border-gray-100 px-1.5 h-4 rounded">Snapshot at payout</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
                                        <div>
                                            <p className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Bank Name</p>
                                            <p className="text-[11px] text-gray-700">{selectedPayment.bank_snapshot?.name || 'N/A'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">RIB Account</p>
                                            <p className="text-[11px] text-gray-700 font-mono">{selectedPayment.bank_snapshot?.rib || 'N/A'}</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Account Holder</p>
                                            <p className="text-[11px] text-gray-700">{selectedPayment.bank_snapshot?.holder || 'N/A'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default SellerPayments;
