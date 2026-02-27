import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  Store, Users, TrendingUp, DollarSign, Package, Truck,
  CheckCircle, XCircle, Clock, Eye, ChevronRight, Star,
  Receipt, ShieldCheck, HeartPulse, Trophy, CalendarDays,
  MapPin, CreditCard, Phone, Mail, X, BarChart3,
  Wallet, UserCheck, AlertTriangle, Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, differenceInDays } from 'date-fns';

// ============ TYPE DEFINITIONS ============

interface SellerProfile {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  products: string[];
  assignment: number;
  commission_price: number;
  created_at: string;
  bank_account_holder: string | null;
  bank_name: string | null;
  bank_rib: string | null;
  cin_number: string | null;
  address: string | null;
  phone: string | null;
}

interface SellerKPIs {
  totalOrders: number;
  pendingOrders: number;
  confirmedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  fakeOrders: number;
  shippedOrders: number;
  confirmRate: number;
  deliveryRate: number;
  cancellationRate: number;
  liveCommission: number;
  totalRevenue: number;
  totalEarnings: number;
  totalCommissionEarned: number;
  totalPaid: number;
  totalUnpaid: number;
  daysPresent: number;
  avgDailyDelivered: number;
  productNames: { name: string; image: string | null }[];
  lastActive: string | null;
  topCity: string | null;
  monthlyPayments: {
    month: string;
    commission_earned: number;
    total_amount: number;
    days_present: number;
    delivered_orders: number;
    status: string;
  }[];
}

interface EnrichedSeller extends SellerProfile {
  kpis: SellerKPIs;
}

// ============ MAIN COMPONENT ============

const Sellers = () => {
  const [sellers, setSellers] = useState<EnrichedSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeller, setSelectedSeller] = useState<EnrichedSeller | null>(null);
  const [globalStats, setGlobalStats] = useState({
    totalSellers: 0,
    totalDelivered: 0,
    totalRevenue: 0,
    totalPaid: 0,
    avgDeliveryRate: 0,
  });

  useEffect(() => {
    fetchSellers();
  }, []);

  const fetchSellers = async () => {
    setLoading(true);
    try {
      // 1. Fetch all sellers (users with role 'commercial')
      const { data: sellersData, error: sellersErr } = await supabase
        .from('users')
        .select('id, name, email, avatar_url, products, assignment, commission_price, created_at, bank_account_holder, bank_name, bank_rib, cin_number, address, phone')
        .eq('role', 'commercial')
        .order('created_at', { ascending: true });

      if (sellersErr) throw sellersErr;
      if (!sellersData || sellersData.length === 0) {
        setSellers([]);
        setLoading(false);
        return;
      }

      const sellerIds = sellersData.map(s => s.id);

      // 2. Fetch all orders for all sellers (using correct schema)
      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, seller_id, order_status_id, price, created_at, date_livraison, master_city_id, package_status_label, status:order_statuses(code, label), city:master_cities(name)')
        .in('seller_id', sellerIds);

      const orders = (ordersData || []) as any[];

      // Helper to get status code from joined order_statuses
      const getStatusCode = (o: any): string => (o.status?.code || '').toUpperCase();

      // 3. Fetch daily earnings
      const { data: earningsData } = await supabase
        .from('seller_daily_earnings')
        .select('*')
        .in('seller_id', sellerIds);

      const earnings = earningsData || [];

      // 4. Fetch presences
      const { data: presencesData } = await supabase
        .from('seller_presences')
        .select('*')
        .in('seller_id', sellerIds);

      const presences = presencesData || [];

      // 5. Fetch payments
      const { data: paymentsData } = await supabase
        .from('seller_payments')
        .select('*')
        .in('seller_id', sellerIds)
        .order('payout_month', { ascending: false });

      const payments = paymentsData || [];

      // 6. Fetch product names for attributed products
      const allProductIds = [...new Set(sellersData.flatMap(s => s.products || []))];
      let productsMap: Record<string, { name: string; image: string | null }> = {};
      if (allProductIds.length > 0) {
        const { data: prodData } = await supabase
          .from('products')
          .select('id, name, image_url')
          .in('id', allProductIds);

        (prodData || []).forEach(p => {
          const nameObj = p.name as any;
          const displayName = typeof nameObj === 'string' ? nameObj : (nameObj?.en || nameObj?.fr || 'Unknown');
          productsMap[p.id] = { name: displayName, image: p.image_url };
        });
      }

      // Status code groupings
      const CONFIRMED_CODES = ['CONFIRMED'];
      const DELIVERED_CODES = ['PAID', 'UNPAID'];
      const CANCELLED_CODES = ['CANCELED'];
      const FAKE_CODES = ['FAUX COMMANDE', 'COMMANDEDOUBLE'];
      const SHIPPED_CODES = ['PROCESSED'];
      const NEW_CODES = ['NEW', 'RELAUNCH_NEW'];

      // 7. Enrich each seller with KPIs
      const enriched: EnrichedSeller[] = sellersData.map(seller => {
        const sellerOrders = orders.filter(o => o.seller_id === seller.id);
        const sellerEarnings = earnings.filter(e => e.seller_id === seller.id);
        const sellerPresences = presences.filter(p => p.seller_id === seller.id);
        const sellerPayments = payments.filter(p => p.seller_id === seller.id);

        const total = sellerOrders.length;
        const pending = sellerOrders.filter(o => NEW_CODES.includes(getStatusCode(o))).length;
        const confirmed = sellerOrders.filter(o => CONFIRMED_CODES.includes(getStatusCode(o))).length;
        const delivered = sellerOrders.filter(o => (o.package_status_label || '').toLowerCase() === 'livré').length;
        const cancelled = sellerOrders.filter(o => CANCELLED_CODES.includes(getStatusCode(o))).length;
        const fake = sellerOrders.filter(o => FAKE_CODES.includes(getStatusCode(o))).length;
        const shipped = sellerOrders.filter(o => SHIPPED_CODES.includes(getStatusCode(o))).length;

        const totalConfirmedAndDelivered = confirmed + delivered + shipped;
        const confirmRate = total > 0 ? (totalConfirmedAndDelivered / total) * 100 : 0;
        const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;
        const cancellationRate = total > 0 ? ((cancelled + fake) / total) * 100 : 0;

        const liveCommission = delivered * (Number(seller.commission_price) || 0);

        const totalRevenue = sellerOrders
          .filter(o => (o.package_status_label || '').toLowerCase() === 'livré')
          .reduce((sum, o) => sum + (Number(o.price) || 0), 0);

        const totalCommissionEarned = sellerEarnings.reduce((sum, e) => sum + (Number(e.commission_earned) || 0), 0);
        const totalEarnings = sellerEarnings.reduce((sum, e) => sum + (Number(e.total_earned) || 0), 0);

        const totalPaid = sellerPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
        const totalUnpaid = sellerPayments.filter(p => p.status === 'pending').reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);

        const daysPresent = sellerPresences.length;
        const avgDailyDelivered = daysPresent > 0 ? delivered / daysPresent : 0;

        const productNames = (seller.products || []).map((pid: string) => productsMap[pid] || { name: 'Unknown Product', image: null });

        // Last active from presences
        const sortedPresences = [...sellerPresences].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastActive = sortedPresences[0]?.date || null;

        // Top city from delivered orders
        const cityMap: Record<string, number> = {};
        sellerOrders.filter(o => (o.package_status_label || '').toLowerCase() === 'livré').forEach(o => {
          const cityName = (o.city as any)?.name || 'Unknown';
          cityMap[cityName] = (cityMap[cityName] || 0) + 1;
        });
        const topCity = Object.entries(cityMap).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        // Monthly payments
        const monthlyPayments = sellerPayments.map(p => ({
          month: p.payout_month,
          commission_earned: Number(p.commission_earned) || 0,
          total_amount: Number(p.total_amount) || 0,
          days_present: p.days_present || 0,
          delivered_orders: p.delivered_orders || 0,
          status: p.status || 'pending',
        }));

        return {
          ...seller,
          commission_price: Number(seller.commission_price) || 0,
          assignment: Number(seller.assignment) || 0,
          products: seller.products || [],
          kpis: {
            totalOrders: total,
            pendingOrders: pending,
            confirmedOrders: confirmed,
            deliveredOrders: delivered,
            cancelledOrders: cancelled,
            fakeOrders: fake,
            shippedOrders: shipped,
            confirmRate,
            deliveryRate,
            cancellationRate,
            liveCommission,
            totalRevenue,
            totalEarnings,
            totalCommissionEarned,
            totalPaid,
            totalUnpaid,
            daysPresent,
            avgDailyDelivered,
            productNames,
            lastActive,
            topCity,
            monthlyPayments,
          }
        } as EnrichedSeller;
      });

      setSellers(enriched);

      // Global Stats
      const gTotalDelivered = enriched.reduce((s, e) => s + e.kpis.deliveredOrders, 0);
      const gTotalOrders = enriched.reduce((s, e) => s + e.kpis.totalOrders, 0);
      setGlobalStats({
        totalSellers: enriched.length,
        totalDelivered: gTotalDelivered,
        totalRevenue: enriched.reduce((s, e) => s + e.kpis.totalRevenue, 0),
        totalPaid: enriched.reduce((s, e) => s + e.kpis.totalPaid, 0),
        avgDeliveryRate: gTotalOrders > 0 ? (gTotalDelivered / gTotalOrders) * 100 : 0,
      });

    } catch (error) {
      console.error('Error fetching sellers:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============ GAUGE COMPONENT ============
  const MiniGauge = ({ value, size = 56, strokeWidth = 5 }: { value: number; size?: number; strokeWidth?: number }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = (Math.min(value, 100) / 100) * circumference;
    const color = value > 70 ? '#10B981' : value > 40 ? '#F59E0B' : '#EF4444';

    return (
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F3F4F6" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold" style={{ color }}>{value.toFixed(0)}%</span>
        </div>
      </div>
    );
  };

  // ============ SELLER CARD ============
  const SellerCard = ({ seller, index }: { seller: EnrichedSeller; index: number }) => {
    const k = seller.kpis;
    const daysActive = differenceInDays(new Date(), new Date(seller.created_at)) + 1;
    const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.08, duration: 0.4 }}
      >
        <Card
          className="border-0 shadow-sm rounded-3xl overflow-hidden hover:shadow-xl transition-all duration-500 cursor-pointer group bg-white"
          onClick={() => setSelectedSeller(seller)}
        >
          <CardContent className="p-6">
            {/* Top Row: Avatar + Info */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-4">
                <div className="relative">
                  {seller.avatar_url ? (
                    <img src={seller.avatar_url} alt={seller.name} className="w-14 h-14 rounded-2xl object-cover border-2 border-gray-100" />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center border-2 border-gray-100">
                      <span className="text-xl font-light text-primary">{seller.name?.charAt(0)?.toUpperCase()}</span>
                    </div>
                  )}
                  {/* Online indicator */}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{seller.name}</h3>
                  <p className="text-[10px] text-gray-400 truncate">{seller.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className="bg-amber-50 text-amber-700 border-0 text-[9px] px-1.5 py-0 rounded-md whitespace-nowrap">
                      {seller.commission_price} MAD/del
                    </Badge>
                    <Badge className="bg-blue-50 text-blue-700 border-0 text-[9px] px-1.5 py-0 rounded-md whitespace-nowrap">
                      {seller.assignment} orders/day
                    </Badge>
                  </div>
                </div>
              </div>
              <MiniGauge value={k.deliveryRate} />
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                <p className="text-lg font-light text-gray-900">{k.totalOrders}</p>
                <p className="text-[8px] uppercase tracking-widest font-bold text-gray-400">Total</p>
              </div>
              <div className="bg-emerald-50/60 rounded-xl p-2.5 text-center">
                <p className="text-lg font-light text-emerald-700">{k.deliveredOrders}</p>
                <p className="text-[8px] uppercase tracking-widest font-bold text-emerald-500">Delivered</p>
              </div>
              <div className="bg-orange-50/60 rounded-xl p-2.5 text-center">
                <p className="text-lg font-light text-orange-700">{k.pendingOrders}</p>
                <p className="text-[8px] uppercase tracking-widest font-bold text-orange-500">Pending</p>
              </div>
              <div className="bg-red-50/60 rounded-xl p-2.5 text-center">
                <p className="text-lg font-light text-red-700">{k.cancelledOrders + k.fakeOrders}</p>
                <p className="text-[8px] uppercase tracking-widest font-bold text-red-500">Lost</p>
              </div>
            </div>

            {/* Bottom: Earnings + CTA */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-50">
              <div>
                <p className="text-xs text-gray-400">Commission earned</p>
                <p className="text-sm font-semibold text-gray-900">{k.liveCommission.toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">MAD</span></p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Revenue generated</p>
                <p className="text-sm font-semibold text-gray-900">{k.totalRevenue.toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">MAD</span></p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-primary transition-colors ml-2" />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // ============ DETAIL MODAL ============
  const SellerDetailModal = ({ seller, onClose }: { seller: EnrichedSeller; onClose: () => void }) => {
    const k = seller.kpis;
    const daysActive = differenceInDays(new Date(), new Date(seller.created_at)) + 1;
    const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

    const statusDistribution = [
      { label: 'Delivered', count: k.deliveredOrders, color: 'bg-emerald-500' },
      { label: 'Confirmed', count: k.confirmedOrders - k.deliveredOrders - k.shippedOrders, color: 'bg-blue-500' },
      { label: 'Shipped', count: k.shippedOrders, color: 'bg-indigo-500' },
      { label: 'Pending', count: k.pendingOrders, color: 'bg-orange-500' },
      { label: 'Cancelled', count: k.cancelledOrders, color: 'bg-red-500' },
      { label: 'Fake', count: k.fakeOrders, color: 'bg-gray-400' },
    ].filter(s => s.count > 0);

    const totalForBar = statusDistribution.reduce((s, d) => s + d.count, 0);

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 20, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white/95 backdrop-blur-xl z-10 rounded-t-3xl border-b border-gray-100">
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  {seller.avatar_url ? (
                    <img src={seller.avatar_url} alt={seller.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-gray-100" />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center">
                      <span className="text-2xl font-light text-primary">{seller.name?.charAt(0)?.toUpperCase()}</span>
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                </div>
                <div>
                  <h2 className="text-2xl font-light text-gray-900">{seller.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /> {seller.email}</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Joined {format(new Date(seller.created_at), 'MMM d, yyyy')}</span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="rounded-xl"><X className="w-5 h-5" /></Button>
            </div>
          </div>

          <div className="p-6 space-y-6">

            {/* ======= SECTION 1: Contract & Config ======= */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <Receipt className="w-5 h-5 text-amber-500 mx-auto mb-2" />
                <p className="text-lg font-semibold text-gray-900">{seller.commission_price} MAD</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Per Delivery</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <Zap className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                <p className="text-lg font-semibold text-gray-900">{seller.assignment}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Orders/Day</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <Package className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                <p className="text-lg font-semibold text-gray-900">{seller.products.length}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Products</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4 text-center">
                <CalendarDays className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                <p className="text-lg font-semibold text-gray-900">{daysActive}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Days Since Join</p>
              </div>
            </div>

            {/* ======= SECTION 2: Order KPIs ======= */}
            <Card className="border-0 shadow-sm rounded-2xl bg-white">
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> Order Performance</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {/* Status bar */}
                {totalForBar > 0 && (
                  <div className="space-y-2">
                    <div className="flex h-3 rounded-full overflow-hidden">
                      {statusDistribution.map((s, i) => (
                        <div key={i} className={`${s.color} transition-all duration-500`} style={{ width: `${(s.count / totalForBar) * 100}%` }} title={`${s.label}: ${s.count}`} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {statusDistribution.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${s.color}`} />
                          <span className="text-[10px] text-gray-500">{s.label}: <strong>{s.count}</strong></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rate KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-blue-50/60 rounded-xl p-3 text-center">
                    <p className="text-xl font-light text-gray-900">{k.confirmRate.toFixed(1)}%</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-blue-500">Confirm Rate</p>
                  </div>
                  <div className="bg-emerald-50/60 rounded-xl p-3 text-center">
                    <p className="text-xl font-light text-gray-900">{k.deliveryRate.toFixed(1)}%</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-emerald-500">Delivery Rate</p>
                  </div>
                  <div className="bg-red-50/60 rounded-xl p-3 text-center">
                    <p className="text-xl font-light text-gray-900">{k.cancellationRate.toFixed(1)}%</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-red-500">Loss Rate</p>
                  </div>
                  <div className="bg-purple-50/60 rounded-xl p-3 text-center">
                    <p className="text-xl font-light text-gray-900">{k.avgDailyDelivered.toFixed(1)}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-purple-500">Avg/Day</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ======= SECTION 3: Financial Overview ======= */}
            <Card className="border-0 shadow-sm rounded-2xl bg-white">
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-600" /> Financial Overview</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <div className="bg-green-50/60 rounded-xl p-4">
                    <p className="text-xl font-light text-gray-900">{k.totalRevenue.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-green-600">Revenue Generated (MAD)</p>
                  </div>
                  <div className="bg-amber-50/60 rounded-xl p-4">
                    <p className="text-xl font-light text-gray-900">{k.liveCommission.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-amber-600">Live Commission (MAD)</p>
                  </div>
                  <div className="bg-blue-50/60 rounded-xl p-4">
                    <p className="text-xl font-light text-gray-900">{k.totalEarnings.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-blue-600">Total Earnings (MAD)</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-base font-semibold text-gray-900">{k.totalCommissionEarned.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-gray-400">Commission Earned</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-base font-semibold text-emerald-600">{k.totalPaid.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-gray-400">Total Paid</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-base font-semibold text-orange-600">{k.totalUnpaid.toLocaleString()}</p>
                    <p className="text-[8px] uppercase tracking-widest font-bold text-gray-400">Unpaid Draft</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ======= SECTION 4: Presence & Activity ======= */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><UserCheck className="w-4 h-4 text-indigo-500" /> Activity</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-gray-50">
                      <span className="text-xs text-gray-500">Days Present</span>
                      <span className="text-sm font-semibold text-gray-900">{k.daysPresent}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-50">
                      <span className="text-xs text-gray-500">Last Active</span>
                      <span className="text-sm font-semibold text-gray-900">{k.lastActive ? format(parseISO(k.lastActive), 'MMM d, yyyy') : 'Never'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-50">
                      <span className="text-xs text-gray-500">Top City</span>
                      <span className="text-sm font-semibold text-gray-900 flex items-center gap-1"><MapPin className="w-3 h-3 text-primary" />{k.topCity || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-xs text-gray-500">Daily Assignment</span>
                      <span className="text-sm font-semibold text-gray-900">{seller.assignment} orders/day</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Products */}
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><Package className="w-4 h-4 text-purple-500" /> Attributed Products</CardTitle></CardHeader>
                <CardContent>
                  {k.productNames.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No products attributed</p>
                  ) : (
                    <div className="space-y-2">
                      {k.productNames.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl">
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-gray-100 flex-shrink-0">
                            {p.image ? (
                              <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                              <Package className="w-4 h-4 text-gray-300" />
                            )}
                          </div>
                          <span className="text-xs text-gray-700 truncate">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ======= SECTION 5: Monthly Payout History ======= */}
            {k.monthlyPayments.length > 0 && (
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><CreditCard className="w-4 h-4 text-green-600" /> Payout History</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[9px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                          <th className="text-left pb-3 font-bold">Month</th>
                          <th className="text-right pb-3 font-bold">Days</th>
                          <th className="text-right pb-3 font-bold">Delivered</th>
                          <th className="text-right pb-3 font-bold">Commission</th>
                          <th className="text-right pb-3 font-bold">Total</th>
                          <th className="text-right pb-3 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {k.monthlyPayments.map((p, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                            <td className="py-3 font-medium text-gray-700">{format(parseISO(p.month), 'MMM yyyy')}</td>
                            <td className="py-3 text-right text-gray-500">{p.days_present}</td>
                            <td className="py-3 text-right text-gray-500">{p.delivered_orders}</td>
                            <td className="py-3 text-right text-gray-700">{p.commission_earned.toLocaleString()}</td>
                            <td className="py-3 text-right font-semibold text-gray-900">{p.total_amount.toLocaleString()} DH</td>
                            <td className="py-3 text-right">
                              <Badge className={`border-0 text-[9px] px-2 py-0.5 rounded-lg ${p.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                                {p.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ======= SECTION 6: Personal Info ======= */}
            {(seller.cin_number || seller.bank_name || seller.address) && (
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardHeader className="pb-3"><CardTitle className="text-base font-medium text-gray-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-500" /> Personal & Banking</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {seller.cin_number && (
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <ShieldCheck className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">CIN</p>
                          <p className="text-sm text-gray-700">{seller.cin_number}</p>
                        </div>
                      </div>
                    )}
                    {seller.address && (
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Address</p>
                          <p className="text-sm text-gray-700">{seller.address}</p>
                        </div>
                      </div>
                    )}
                    {seller.bank_name && (
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <CreditCard className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Bank</p>
                          <p className="text-sm text-gray-700">{seller.bank_name}</p>
                        </div>
                      </div>
                    )}
                    {seller.bank_rib && (
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <CreditCard className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">RIB</p>
                          <p className="text-sm text-gray-700 font-mono text-xs">{seller.bank_rib}</p>
                        </div>
                      </div>
                    )}
                    {seller.phone && (
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Phone</p>
                          <p className="text-sm text-gray-700">{seller.phone}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </motion.div>
      </motion.div>
    );
  };

  // ============ RENDER ============
  return (
    <>
      <div className="space-y-8 pb-8">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
          <div className="relative p-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-extralight text-gray-900 mb-2">Sellers</h1>
                <p className="text-gray-500 font-light">Comprehensive seller intelligence & performance tracking</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary border-0 text-xs px-3 py-1 rounded-xl">{globalStats.totalSellers} Active</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Global KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {[
            { label: 'Total Sellers', value: globalStats.totalSellers, icon: Users, color: 'text-primary', bg: 'bg-primary/5' },
            { label: 'Total Delivered', value: globalStats.totalDelivered, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Total Revenue', value: `${globalStats.totalRevenue.toLocaleString()} MAD`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Avg Delivery Rate', value: `${globalStats.avgDeliveryRate.toFixed(1)}%`, icon: Trophy, color: 'text-amber-600', bg: 'bg-amber-50' },
          ].map((stat, i) => (
            <Card key={i} className="border-0 shadow-sm rounded-3xl overflow-hidden bg-white hover:shadow-lg transition-all duration-300">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-light text-gray-900">{stat.value}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-gray-400 mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Seller Cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 bg-gray-50 rounded-3xl animate-pulse" />
            ))}
          </div>
        ) : sellers.length === 0 ? (
          <Card className="border-0 shadow-xl rounded-3xl">
            <CardContent className="p-16 text-center">
              <Store className="w-16 h-16 text-gray-200 mx-auto mb-4" />
              <h3 className="text-xl font-light text-gray-500 mb-2">No sellers found</h3>
              <p className="text-sm text-gray-400">Create a seller from the Users page to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {sellers.map((seller, i) => (
              <SellerCard key={seller.id} seller={seller} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedSeller && (
          <SellerDetailModal seller={selectedSeller} onClose={() => setSelectedSeller(null)} />
        )}
      </AnimatePresence>
    </>
  );
};

export default Sellers;
