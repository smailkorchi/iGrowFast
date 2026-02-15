import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign,
  Users,
  Calendar,
  Search,
  Filter,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  XCircle,
  MoreHorizontal,
  Plus,
  Download,
  Building2,
  CreditCard,
  Receipt,
  ChevronLeft,
  ChevronRight,
  Check
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { format, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval } from 'date-fns';
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

interface Payout {
  id: string;
  seller_id: string;
  payout_month: string;
  salary_earned: number;
  commission_earned: number;
  total_amount: number;
  days_present: number;
  delivered_orders: number;
  bank_snapshot: any;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at: string | null;
  seller: {
    name: string;
    email: string;
    avatar_url: string;
  };
}

interface SellerUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
  commission_price: number;
  bank_name: string;
  bank_rib: string;
  bank_account_holder: string;
  cin_number: string;
}

const AdminSalaries = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payout[]>([]);
  const [sellers, setSellers] = useState<SellerUser[]>([]);
  const [stats, setStats] = useState({
    totalPaid: 0,
    totalPending: 0,
    thisMonthCount: 0,
    paidThisMonth: 0
  });

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM-01'));
  const [payoutPreview, setPayoutPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [activePayout, setActivePayout] = useState<Payout | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch Payments
      const { data: paymentsData, error: pError } = await supabase
        .from('seller_payments')
        .select('*, seller:users(name, email, avatar_url)')
        .order('created_at', { ascending: false });

      if (pError) throw pError;
      setPayments(paymentsData || []);

      // Fetch Sellers (users with role 'commercial')
      const { data: sellersData, error: sError } = await supabase
        .from('users')
        .select('id, name, email, avatar_url, commission_price, bank_name, bank_rib, bank_account_holder, cin_number')
        .eq('role', 'commercial');

      if (sError) throw sError;
      setSellers(sellersData || []);

      // Calculate Stats
      if (paymentsData) {
        const now = new Date();
        const startOfThisMonth = startOfMonth(now);

        const statsObj = paymentsData.reduce((acc, p) => {
          const amt = Number(p.total_amount);
          if (p.status === 'paid') acc.totalPaid += amt;
          if (p.status === 'pending') acc.totalPending += amt;

          const payDate = new Date(p.created_at);
          if (payDate >= startOfThisMonth) {
            acc.thisMonthCount++;
            if (p.status === 'paid') acc.paidThisMonth += amt;
          }
          return acc;
        }, { totalPaid: 0, totalPending: 0, thisMonthCount: 0, paidThisMonth: 0 });

        setStats(statsObj);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to load financial data.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePreview = async () => {
    if (!selectedSellerId || !selectedMonth) return;

    try {
      setPreviewLoading(true);
      const seller = sellers.find(s => s.id === selectedSellerId);
      if (!seller) return;

      const start = format(startOfMonth(new Date(selectedMonth)), 'yyyy-MM-dd');
      const end = format(endOfMonth(new Date(selectedMonth)), 'yyyy-MM-dd');

      // Get daily earnings for this seller in this month
      const { data, error } = await supabase
        .from('seller_daily_earnings')
        .select('*')
        .eq('seller_id', selectedSellerId)
        .gte('date', start)
        .lte('date', end);

      if (error) throw error;

      const calc = (data || []).reduce((acc, curr) => ({
        commission: acc.commission + Number(curr.commission_earned),
        days: acc.days + (Number(curr.commission_earned) > 0 ? 1 : 0),
        orders: acc.orders + Number(curr.delivered_count)
      }), { commission: 0, days: 0, orders: 0 });

      setPayoutPreview({
        ...calc,
        total: calc.commission,
        seller_name: seller.name,
        bank: {
          name: seller.bank_name,
          rib: seller.bank_rib,
          holder: seller.bank_account_holder,
          cin: seller.cin_number
        }
      });

    } catch (error) {
      console.error('Error generating preview:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSellerId && selectedMonth) {
      handleGeneratePreview();
    }
  }, [selectedSellerId, selectedMonth]);

  const handleCreatePayout = async () => {
    if (!payoutPreview || !selectedSellerId) return;

    try {
      const { error } = await supabase
        .from('seller_payments')
        .insert({
          seller_id: selectedSellerId,
          payout_month: selectedMonth,
          salary_earned: 0,
          commission_earned: payoutPreview.commission,
          total_amount: payoutPreview.total,
          days_present: payoutPreview.days,
          delivered_orders: payoutPreview.orders,
          bank_snapshot: payoutPreview.bank,
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Draft payout generated successfully.",
      });
      setIsCreateModalOpen(false);
      fetchData();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create payout.",
        variant: "destructive"
      });
    }
  };

  const updateStatus = async (ids: string[], status: 'paid' | 'pending') => {
    try {
      const { error } = await supabase
        .from('seller_payments')
        .update({ status })
        .in('id', ids);

      if (error) throw error;

      toast({
        title: "Updated",
        description: `${ids.length} record(s) marked as ${status}.`,
      });
      setSelectedItems([]);
      fetchData();
      if (activePayout && ids.includes(activePayout.id)) {
        setIsDetailsModalOpen(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Update failed.",
        variant: "destructive"
      });
    }
  };

  const filteredPayments = payments.filter(p => {
    const matchesSearch = p.seller?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.seller?.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const paginatedPayments = filteredPayments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const toggleSelect = (id: string) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const monthOptions = eachMonthOfInterval({
    start: subMonths(new Date(), 6),
    end: new Date()
  }).reverse();

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-12">
      {/* Header Area */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl font-extralight text-gray-900 mb-2">Salaries</h1>
              <p className="text-gray-500 font-light">Financial administration and monthly settlement for DigiCom sellers.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group"
              >
                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                Generate Payout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Paid Out', val: stats.totalPaid, icon: CheckCircle2, sub: 'All time history', color: 'primary' },
          { label: 'Pending Payouts', val: stats.totalPending, icon: Clock, sub: 'Awaiting approval', color: 'orange' },
          { label: 'Paid This Month', val: stats.paidThisMonth, icon: Receipt, sub: `${stats.thisMonthCount} settlements`, color: 'blue' },
          { label: 'Active Sellers', val: sellers.length, icon: Users, sub: 'Total workforce', color: 'purple' }
        ].map((s, i) => (
          <Card key={i} className="border-0 shadow-xl rounded-3xl group hover:-translate-y-1 transition-all duration-500 overflow-hidden bg-white">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center group-hover:bg-primary/10 transition-colors`}>
                  <s.icon className="w-6 h-6 text-gray-400 group-hover:text-primary transition-colors" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-gray-200 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-all" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-light text-gray-500">{s.label}</p>
                <p className="text-3xl font-medium text-gray-900 tracking-tight">
                  {typeof s.val === 'number' ? s.val.toLocaleString() : s.val}
                  {typeof s.val === 'number' && i !== 3 ? <span className="text-xs font-light text-gray-400 ml-1">MAD</span> : ''}
                </p>
                <p className="text-[10px] uppercase tracking-widest text-gray-300 font-medium">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Card */}
      <Card className="border-0 shadow-sm rounded-2xl overflow-hidden bg-white">
        <CardHeader className="p-8 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-gray-50/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white shadow-md rounded-2xl flex items-center justify-center">
              <Receipt className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl font-light">Payment Records</CardTitle>
              <CardDescription className="text-xs tracking-wide">Select records to perform bulk actions</CardDescription>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="relative group min-w-[300px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Search by seller name..."
                className="pl-11 h-12 rounded-2xl border-gray-100 focus:ring-primary/10 bg-white"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-12 rounded-2xl border-gray-100 bg-white">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-gray-100">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left bg-gray-50/50">
                  <th className="p-6 w-12 text-center">
                    <Checkbox
                      checked={selectedItems.length === paginatedPayments.length && paginatedPayments.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) setSelectedItems(paginatedPayments.map(p => p.id));
                        else setSelectedItems([]);
                      }}
                    />
                  </th>
                  <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Seller Details</th>
                  <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Period</th>
                  <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Activity</th>
                  <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400">Financials</th>
                  <th className="p-6 text-[10px] uppercase tracking-widest font-medium text-gray-400 text-center">Status</th>
                  <th className="p-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  [1, 2, 3, 4, 5].map(i => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={7} className="p-8">
                        <div className="h-4 bg-gray-50 rounded-full w-full" />
                      </td>
                    </tr>
                  ))
                ) : paginatedPayments.length > 0 ? (
                  paginatedPayments.map((p) => (
                    <tr key={p.id} className="group hover:bg-gray-50/50 transition-all">
                      <td className="p-6 text-center">
                        <Checkbox
                          checked={selectedItems.includes(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <td className="p-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden border border-white shadow-sm">
                            {p.seller?.avatar_url ? (
                              <img src={p.seller.avatar_url} className="w-full h-full object-cover" />
                            ) : <Users className="w-4 h-4 text-gray-400" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{p.seller?.name}</p>
                            <p className="text-[10px] text-gray-400 tracking-tighter">{p.seller?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-gray-100 rounded-lg text-sm font-light text-gray-600">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          {format(new Date(p.payout_month), 'MMMM yyyy')}
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-xs font-light text-gray-500">
                            <Clock className="w-3 h-3" /> {p.days_present} Days Worked
                          </div>
                          <div className="flex items-center gap-2 text-xs font-light text-gray-500">
                            <CheckCircle2 className="w-3 h-3" /> {p.delivered_orders} Orders
                          </div>
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-col">
                          <span className="text-base font-semibold text-gray-900 tracking-tight">{Number(p.total_amount).toLocaleString()} <span className="text-[10px] text-gray-400">MAD</span></span>
                          <span className="text-[10px] text-gray-400 uppercase tracking-tighter">Net Payout</span>
                        </div>
                      </td>
                      <td className="p-6 text-center">
                        <Badge className={`rounded-xl px-4 h-8 border-0 shadow-sm ${p.status === 'paid' ? 'bg-green-50 text-green-700' :
                          p.status === 'pending' ? 'bg-orange-50 text-orange-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                          <div className={`w-1.5 h-1.5 rounded-full mr-2 ${p.status === 'paid' ? 'bg-green-500' :
                            p.status === 'pending' ? 'bg-orange-500' :
                              'bg-red-500'
                            }`} />
                          {p.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-6 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-10 w-10 p-0 rounded-xl">
                              <MoreHorizontal className="h-4 w-4 text-gray-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-2xl w-48 border-gray-100 shadow-2xl p-2">
                            <DropdownMenuItem
                              onClick={() => {
                                setActivePayout(p);
                                setIsDetailsModalOpen(true);
                              }}
                              className="rounded-xl h-11 px-4 cursor-pointer focus:bg-primary/5"
                            >
                              <Receipt className="w-4 h-4 mr-3 text-gray-400" /> View Details
                            </DropdownMenuItem>
                            {p.status !== 'paid' && (
                              <DropdownMenuItem
                                onClick={() => updateStatus([p.id], 'paid')}
                                className="rounded-xl h-11 px-4 cursor-pointer text-green-600 focus:bg-green-50"
                              >
                                <CheckCircle2 className="w-4 h-4 mr-3" /> Mark as Paid
                              </DropdownMenuItem>
                            )}
                            {p.status === 'paid' && (
                              <DropdownMenuItem
                                onClick={() => updateStatus([p.id], 'pending')}
                                className="rounded-xl h-11 px-4 cursor-pointer text-orange-600 focus:bg-orange-50"
                              >
                                <XCircle className="w-4 h-4 mr-3" /> Revert to Pending
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-24 text-center">
                      <div className="flex flex-col items-center justify-center space-y-4 opacity-30">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                          <Receipt className="w-10 h-10" />
                        </div>
                        <p className="text-xl font-light">No records found matching your filters.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>

        {/* Pagination */}
        <div className="p-6 border-t border-gray-100 flex items-center justify-between bg-white">
          <p className="text-xs text-gray-400 font-light tracking-wide">
            Showing {filteredPayments.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, filteredPayments.length)} of {filteredPayments.length} entries
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl h-10 w-10 p-0 border-gray-100"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-sm font-medium px-4 h-10 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-xl min-w-[40px]">
              {currentPage}
            </div>
            <Button
              variant="outline"
              className="rounded-xl h-10 w-10 p-0 border-gray-100"
              disabled={currentPage * itemsPerPage >= filteredPayments.length}
              onClick={() => setCurrentPage(prev => prev + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Create Payout Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden border-0 rounded-[2.5rem] shadow-3xl bg-white">
          <DialogHeader className="p-8 pb-0">
            <DialogTitle className="text-3xl font-extralight tracking-tight">Generate New Payout</DialogTitle>
            <DialogDescription className="text-gray-400 font-light">Select a seller and a month to calculate their commission earnings.</DialogDescription>
          </DialogHeader>

          <div className="p-8 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Member Seller</label>
                <Select value={selectedSellerId} onValueChange={setSelectedSellerId}>
                  <SelectTrigger className="h-14 rounded-2xl border-gray-100 bg-gray-50/50 shadow-inner">
                    <SelectValue placeholder="Select a seller..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl p-2 border-gray-100">
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="rounded-xl h-12">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
                            {s.avatar_url ? <img src={s.avatar_url} /> : <Users className="w-3 h-3 text-gray-400" />}
                          </div>
                          {s.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 ml-1">Calculation Period</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-14 rounded-2xl border-gray-100 bg-gray-50/50 shadow-inner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl p-2 border-gray-100">
                    {monthOptions.map((m) => {
                      const val = format(m, 'yyyy-MM-01');
                      return (
                        <SelectItem key={val} value={val} className="rounded-xl h-12">
                          {format(m, 'MMMM yyyy')}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {previewLoading ? (
              <div className="p-12 text-center rounded-3xl border border-dashed border-gray-200 bg-gray-50">
                <Clock className="w-8 h-8 text-primary mx-auto animate-spin mb-4" />
                <p className="text-gray-400 font-light">Calculating financial data...</p>
              </div>
            ) : payoutPreview ? (
              <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="p-6 rounded-3xl bg-purple-50/50 border border-purple-100/50">
                  <p className="text-[10px] uppercase font-bold text-purple-400 mb-1">Commission Earned</p>
                  <p className="text-2xl font-medium text-purple-900">{payoutPreview.commission.toLocaleString()} <span className="text-sm font-light">MAD</span></p>
                  <p className="text-xs text-purple-600/60 mt-2">{payoutPreview.orders} delivered units • {payoutPreview.days} active days</p>
                </div>
                <div className="p-6 rounded-3xl bg-gray-900 text-white shadow-2xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-1">Final Settlement Amount</p>
                    <p className="text-4xl font-light tracking-tight">{payoutPreview.total.toLocaleString()} <span className="text-lg">MAD</span></p>
                  </div>
                  <div className="text-right opacity-60">
                    <Receipt className="w-10 h-10" />
                  </div>
                </div>

                <Card className="border-0 shadow-sm rounded-3xl bg-gray-50 border border-gray-100">
                  <CardContent className="p-6 flex items-start gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                      <Building2 className="w-6 h-6 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{payoutPreview.bank.name || 'No Bank Configured'}</p>
                      <p className="text-xs font-mono text-gray-400 mt-1">{payoutPreview.bank.rib || 'No RIB Provided'}</p>
                      <p className="text-[10px] text-gray-400 mt-2 uppercase tracking-tight">Holder: {payoutPreview.bank.holder || 'N/A'}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>

          <DialogFooter className="p-8 bg-gray-50 border-t border-gray-100 sm:justify-end gap-3">
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)} className="h-12 rounded-2xl border-gray-200">Cancel</Button>
            <Button
              disabled={!payoutPreview || previewLoading}
              onClick={handleCreatePayout}
              className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-8 rounded-2xl"
            >
              Generate Draft Settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden border-0 rounded-[2.5rem] shadow-3xl bg-white">
          {activePayout && (
            <>
              <DialogHeader className="p-8 flex flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden border-2 border-white shadow-md">
                    {activePayout.seller?.avatar_url ? (
                      <img src={activePayout.seller.avatar_url} />
                    ) : <Users className="w-6 h-6 text-gray-400" />}
                  </div>
                  <div>
                    <DialogTitle className="text-2xl font-light tracking-tight">{activePayout.seller?.name}</DialogTitle>
                    <p className="text-sm text-gray-400 font-light">{format(new Date(activePayout.payout_month), 'MMMM yyyy')} Settlement</p>
                  </div>
                </div>
                <Badge className={`rounded-xl px-4 h-8 border-0 ${activePayout.status === 'paid' ? 'bg-green-50 text-green-700' :
                  activePayout.status === 'pending' ? 'bg-orange-50 text-orange-700' :
                    'bg-red-50 text-red-700'
                  }`}>
                  {activePayout.status.toUpperCase()}
                </Badge>
              </DialogHeader>

              <div className="p-8 pt-0 space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Net Amount</p>
                    <p className="text-3xl font-medium text-gray-900 tracking-tight">{Number(activePayout.total_amount).toLocaleString()} <span className="text-sm font-light text-gray-400">MAD</span></p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Created On</p>
                    <p className="text-sm font-light text-gray-600">{format(new Date(activePayout.created_at), 'MMMM d, yyyy')}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-primary" /> Breakdown
                  </h4>
                  <div className="bg-gray-50 rounded-3xl p-6 space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-light">Commission ({activePayout.delivered_orders} units)</span>
                      <span className="font-mono tabular-nums text-gray-900">+{Number(activePayout.commission_earned).toLocaleString()} MAD</span>
                    </div>
                    <div className="pt-4 border-t border-gray-200 flex justify-between items-center text-base">
                      <span className="font-medium text-gray-900">Total Settlement</span>
                      <span className="font-bold text-gray-900">{Number(activePayout.total_amount).toLocaleString()} MAD</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-primary" /> Disburse to
                  </h4>
                  <Card className="border-0 shadow-sm rounded-3xl bg-gray-50 border border-gray-100">
                    <CardContent className="p-6">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-gray-100 shadow-sm">
                            <Building2 className="w-5 h-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{activePayout.bank_snapshot?.name || 'N/A'}</p>
                            <p className="text-xs text-gray-400">Institution Name</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-gray-100 shadow-sm">
                            <CreditCard className="w-5 h-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="text-sm font-mono text-gray-800 break-all">{activePayout.bank_snapshot?.rib || 'No Account Provided'}</p>
                            <p className="text-xs text-gray-400">RIB / Account Number</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <DialogFooter className="p-8 bg-gray-50 border-t border-gray-100 flex-col sm:flex-row gap-3">
                {activePayout.status !== 'paid' && (
                  <Button
                    onClick={() => updateStatus([activePayout.id], 'paid')}
                    className="bg-green-600 hover:bg-green-700 text-white flex-1 h-14 rounded-2xl shadow-lg shadow-green-100 group"
                  >
                    <Check className="w-5 h-5 mr-3 group-hover:scale-125 transition-transform" />
                    Confirm Payment & Notify Seller
                  </Button>
                )}
                {activePayout.status === 'paid' && (
                  <Button
                    variant="outline"
                    onClick={() => updateStatus([activePayout.id], 'pending')}
                    className="h-14 rounded-2xl border-gray-200 flex-1 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                  >
                    Revert to Pending
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedItems.length > 0 && (
          <motion.div
            initial={{ y: 200, x: '-50%', opacity: 0 }}
            animate={{ y: 0, x: '-50%', opacity: 1 }}
            exit={{ y: 200, x: '-50%', opacity: 0 }}
            className="fixed bottom-10 left-1/2 z-50 w-full max-w-xl px-4"
          >
            <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-[2rem] p-4 flex items-center justify-between">
              <div className="flex items-center gap-4 ml-2">
                <div className="w-11 h-11 bg-primary/20 rounded-2xl flex items-center justify-center shrink-0">
                  <Receipt className="w-5 h-5 text-primary" />
                </div>
                <div className="whitespace-nowrap">
                  <p className="text-white text-sm font-medium">{selectedItems.length} Settlements Selected</p>
                  <p className="text-gray-400 text-[10px] uppercase tracking-widest font-bold">Ready for bulk action</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => updateStatus(selectedItems, 'paid')}
                  className="bg-primary hover:bg-primary/90 text-white h-12 px-6 rounded-2xl shadow-lg shadow-primary/20 transition-all active:scale-95"
                >
                  Mark as Paid
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSelectedItems([])}
                  className="text-gray-400 hover:text-white hover:bg-white/5 h-12 w-12 p-0 rounded-2xl"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminSalaries;
