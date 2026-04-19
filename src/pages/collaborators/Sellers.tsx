import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  Users, CheckCircle, TrendingUp, Trophy,
  MapPin, CreditCard, Phone, Mail, X,
  Package, CalendarDays, Store, ShieldCheck,
  UserCheck, BarChart3, DollarSign, Receipt, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format, parseISO, differenceInDays } from 'date-fns';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { computeUnpaidCommission, normalizeCommissionBasis, isDeliveredForCommission } from '@/lib/commercialCommission';

// ============ TYPE DEFINITIONS ============

interface SellerProfile {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  products: string[];
  assignment: number;
  commission_price: number;
  commission_basis?: string | null;
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
  const activeBusinessId = localStorage.getItem('activeBusinessId');
  const {
    confirmedIds,
    cancelledIds,
    deliveredPkgIds,
    pendingIds,
    getOrderCategory,
  } = useStatusCategories();
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
  }, [confirmedIds, cancelledIds, deliveredPkgIds, pendingIds, getOrderCategory]);

  const fetchSellers = async () => {
    setLoading(true);
    try {
      const { data: sellersData, error: sellersErr } = await supabase
        .from('users')
        .select('id, name, email, avatar_url, products, assignment, commission_price, commission_basis, created_at, bank_account_holder, bank_name, bank_rib, cin_number, address, phone')
        .eq('role', 'commercial')
        .eq('DigiCom Business', activeBusinessId)
        .order('created_at', { ascending: true });

      if (sellersErr) throw sellersErr;
      if (!sellersData || sellersData.length === 0) {
        setSellers([]);
        setLoading(false);
        return;
      }

      const sellerIds = sellersData.map(s => s.id);

      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, seller_id, order_status_id, package_status_id, price, created_at, date_livraison, master_city_id, package_status_label, status:order_statuses(code, label), city:master_cities(name), package_statuses(label), order_items(product_id, quantity)')
        .in('seller_id', sellerIds)
        .is('date_deleted', null);

      const orders = (ordersData || []) as any[];

      const { data: earningsData } = await supabase
        .from('seller_daily_earnings')
        .select('*')
        .eq('DigiCom Business', activeBusinessId);

      const earnings = earningsData || [];

      const { data: presencesData } = await supabase
        .from('seller_presences')
        .select('*')
        .eq('DigiCom Business', activeBusinessId);

      const presences = presencesData || [];

      const { data: paymentsData } = await supabase
        .from('seller_payments')
        .select('*')
        .eq('DigiCom Business', activeBusinessId)
        .order('payout_month', { ascending: false });

      const payments = paymentsData || [];

      const allProductIds = [...new Set(sellersData.flatMap(s => s.products || []))];
      let productsMap: Record<string, { name: string; image: string | null }> = {};
      if (allProductIds.length > 0) {
        const { data: prodData } = await supabase
          .from('products')
          .select('id, name, image_url')
          .eq('active', true)
          .in('id', allProductIds);

        (prodData || []).forEach(p => {
          const nameObj = p.name as any;
          const displayName = typeof nameObj === 'string' ? nameObj : (nameObj?.en || nameObj?.fr || 'Unknown');
          productsMap[p.id] = { name: displayName, image: p.image_url };
        });
      }

      const enriched: EnrichedSeller[] = sellersData.map(seller => {
        const sellerOrders = orders.filter(o => o.seller_id === seller.id);
        const sellerEarnings = earnings.filter(e => e.seller_id === seller.id);
        const sellerPresences = presences.filter(p => p.seller_id === seller.id);
        const sellerPayments = payments.filter(p => p.seller_id === seller.id);

        const total = sellerOrders.length;

        let delivered = 0, shipped = 0, confirmed = 0, pending = 0, cancelled = 0, fake = 0;

        sellerOrders.forEach(o => {
          const orderCat = getOrderCategory(o.order_status_id);
          const isDeliveredPkg = isDeliveredForCommission(o, deliveredPkgIds);

          if (isDeliveredPkg) {
            delivered++;
          } else if (orderCat === 'processed') {
            shipped++;
          } else if (confirmedIds.has(o.order_status_id)) {
            confirmed++;
          } else if (orderCat === 'cancelled') {
            cancelled++;
          } else if (orderCat === 'fake' || orderCat === 'double') {
            fake++;
          } else if (pendingIds.has(o.order_status_id)) {
            pending++;
          } else {
            pending++;
          }
        });

        const totalConfirmedAndDelivered = confirmed + delivered + shipped;
        const confirmRate = total > 0 ? (totalConfirmedAndDelivered / total) * 100 : 0;
        const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;
        const cancellationRate = total > 0 ? ((cancelled + fake) / total) * 100 : 0;

        const alreadyPaidDeliveries = sellerPayments
          .filter(p => p.status === 'paid')
          .reduce((sum, p) => sum + (Number(p.delivered_orders) || 0), 0);

        const isDeliveredOrder = (o: any) => isDeliveredForCommission(o, deliveredPkgIds);
        const basis = normalizeCommissionBasis(seller.commission_basis);
        const sellerProductIds = (seller.products || []).filter((id: string) => typeof id === 'string' && id.length > 0);
        const { unpaidCommission: liveCommission } = computeUnpaidCommission({
          basis,
          commissionPrice: Number(seller.commission_price) || 0,
          orders: sellerOrders,
          isDelivered: isDeliveredOrder,
          sellerProductIds,
          paidTally: alreadyPaidDeliveries,
        });

        const totalRevenue = sellerOrders
          .filter(o => isDeliveredForCommission(o, deliveredPkgIds))
          .reduce((sum, o) => sum + (Number(o.price) || 0), 0);

        const totalCommissionEarned = sellerEarnings.reduce((sum, e) => sum + (Number(e.commission_earned) || 0), 0);
        const totalEarnings = sellerEarnings.reduce((sum, e) => sum + (Number(e.total_earned) || 0), 0);

        const totalPaid = sellerPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
        const totalUnpaid = sellerPayments.filter(p => p.status === 'pending').reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);

        const daysPresent = sellerPresences.length;
        const avgDailyDelivered = daysPresent > 0 ? delivered / daysPresent : 0;

        const productNames = (seller.products || [])
          .map((pid: string) => productsMap[pid])
          .filter((x): x is { name: string; image: string | null } => !!x);

        const sortedPresences = [...sellerPresences].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastActive = sortedPresences[0]?.date || null;

        const cityMap: Record<string, number> = {};
        sellerOrders.filter(o => isDeliveredForCommission(o, deliveredPkgIds)).forEach(o => {
          const cityName = (o.city as any)?.name || 'Unknown';
          cityMap[cityName] = (cityMap[cityName] || 0) + 1;
        });
        const topCity = Object.entries(cityMap).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

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

  // ============ SELLER ROW ============
  const SellerRow = ({ seller, index }: { seller: EnrichedSeller; index: number }) => {
    const k = seller.kpis;
    const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;
    const rateColor = k.deliveryRate > 70 ? '#059669' : k.deliveryRate > 40 ? '#d97706' : '#ef4444';

    return (
      <tr
        className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={() => setSelectedSeller(seller)}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              {seller.avatar_url ? (
                <img src={seller.avatar_url} alt={seller.name} className="h-7 w-7 rounded-lg object-cover border border-gray-100" />
              ) : (
                <div className="h-7 w-7 rounded-lg bg-gray-100 border border-gray-100 flex items-center justify-center">
                  <span className="text-[10px] font-semibold text-brand-navy/60">{seller.name?.charAt(0)?.toUpperCase()}</span>
                </div>
              )}
              <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${isOnline ? 'bg-emerald-400' : 'bg-gray-300'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-brand-navy truncate leading-none">{seller.name}</p>
              <p className="text-[10px] text-gray-500 truncate mt-0.5">{seller.email}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="h-5 px-1.5 inline-flex items-center rounded border border-gray-200 text-[9px] font-semibold text-gray-500 tabular-nums bg-gray-50">
              {seller.commission_price} MAD/{normalizeCommissionBasis(seller.commission_basis) === 'per_unit' ? 'unit' : 'order'}
            </span>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            <span className="text-[11px] text-brand-navy/80 tabular-nums">{k.pendingOrders}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] text-brand-navy/80 tabular-nums">{k.confirmedOrders}</span>
            <span className="w-2 h-2 rounded-full" style={{ background: '#059669' }} />
            <span className="text-[11px] text-brand-navy/80 tabular-nums">{k.deliveredOrders}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-[11px] tabular-nums" style={{ color: rateColor }}>
          {k.deliveryRate.toFixed(1)}%
        </td>
        <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums">
          {k.liveCommission.toLocaleString()} <span className="text-[9px] text-gray-400 font-normal">MAD</span>
        </td>
      </tr>
    );
  };

  // ============ DETAIL MODAL ============
  const SellerDetailModal = ({ seller, onClose }: { seller: EnrichedSeller; onClose: () => void }) => {
    const k = seller.kpis;
    const daysActive = differenceInDays(new Date(), new Date(seller.created_at)) + 1;
    const isOnline = k.lastActive ? new Date(k.lastActive).toDateString() === new Date().toDateString() : false;

    const statusDistribution = [
      { label: 'Delivered', count: k.deliveredOrders, color: '#059669' },
      { label: 'Shipped', count: k.shippedOrders, color: '#6366f1' },
      { label: 'Confirmed', count: k.confirmedOrders, color: '#3b82f6' },
      { label: 'Pending', count: k.pendingOrders, color: '#d97706' },
      { label: 'Cancelled', count: k.cancelledOrders, color: '#ef4444' },
      { label: 'Fake', count: k.fakeOrders, color: '#9ca3af' },
    ].filter(s => s.count > 0);

    const totalForBar = statusDistribution.reduce((s, d) => s + d.count, 0);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl border border-gray-100 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-lg"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                {seller.avatar_url ? (
                  <img src={seller.avatar_url} alt={seller.name} className="h-7 w-7 rounded-lg object-cover border border-gray-100" />
                ) : (
                  <div className="h-7 w-7 rounded-lg bg-gray-100 border border-gray-100 flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-brand-navy/60">{seller.name?.charAt(0)?.toUpperCase()}</span>
                  </div>
                )}
                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${isOnline ? 'bg-emerald-400' : 'bg-gray-300'}`} />
              </div>
              <div>
                <p className="text-[12px] font-semibold text-brand-navy leading-none">{seller.name}</p>
                <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-0.5 flex items-center gap-1">
                  <Mail className="w-2.5 h-2.5" /> {seller.email}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 rounded-md">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="p-4 space-y-4">

            {/* Contract config tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Commission', value: `${seller.commission_price} MAD`, sub: normalizeCommissionBasis(seller.commission_basis) === 'per_unit' ? 'per unit' : 'per order', accent: '#d97706' },
                { label: 'Assignment', value: `${seller.assignment}`, sub: 'orders/day', accent: '#3b5e5e' },
                { label: 'Products', value: `${k.productNames.length}`, sub: 'attributed', accent: '#6366f1' },
                { label: 'Days since join', value: `${daysActive}`, sub: 'days', accent: '#3b82f6' },
              ].map(t => (
                <div key={t.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2">
                  <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: t.accent }} />
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                    <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none">{t.value}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">{t.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Order performance */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-3">
              <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" /> Order Performance
              </p>

              {totalForBar > 0 && (
                <div className="space-y-1.5">
                  <div className="flex h-2 rounded-full overflow-hidden gap-px">
                    {statusDistribution.map((s, i) => (
                      <div key={i} className="rounded-full" style={{ width: `${(s.count / totalForBar) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {statusDistribution.map((s, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                        <span className="text-[9px] text-gray-500">{s.label}: <strong>{s.count}</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Confirm Rate', value: `${k.confirmRate.toFixed(1)}%`, accent: '#3b82f6' },
                  { label: 'Delivery Rate', value: `${k.deliveryRate.toFixed(1)}%`, accent: '#059669' },
                  { label: 'Loss Rate', value: `${k.cancellationRate.toFixed(1)}%`, accent: '#ef4444' },
                  { label: 'Avg/Day', value: k.avgDailyDelivered.toFixed(1), accent: '#3b5e5e' },
                ].map(t => (
                  <div key={t.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2">
                    <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: t.accent }} />
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                      <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none">{t.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial overview */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-3">
              <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                <DollarSign className="w-3 h-3" /> Financial Overview
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { label: 'Revenue Generated', value: `${k.totalRevenue.toLocaleString()} MAD`, accent: '#059669' },
                  { label: 'Unpaid Commission', value: `${k.liveCommission.toLocaleString()} MAD`, accent: '#d97706' },
                  { label: 'Total Earnings', value: `${k.totalEarnings.toLocaleString()} MAD`, accent: '#3b5e5e' },
                ].map(t => (
                  <div key={t.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2">
                    <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: t.accent }} />
                    <div className="min-w-0">
                      <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                      <p className="text-[15px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-tight">{t.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Commission Earned', value: k.totalCommissionEarned.toLocaleString(), sub: 'MAD' },
                  { label: 'Total Paid', value: k.totalPaid.toLocaleString(), sub: 'MAD' },
                  { label: 'Unpaid Draft', value: k.totalUnpaid.toLocaleString(), sub: 'MAD' },
                ].map(t => (
                  <div key={t.label} className="border-b border-gray-100 pb-2">
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{t.label}</p>
                    <p className="text-[12px] font-semibold text-brand-navy mt-0.5 tabular-nums">{t.value} <span className="text-[9px] text-gray-400 font-normal">{t.sub}</span></p>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity + Products */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                  <UserCheck className="w-3 h-3" /> Activity
                </p>
                {[
                  { label: 'Days Present', value: String(k.daysPresent) },
                  { label: 'Last Active', value: k.lastActive ? format(parseISO(k.lastActive), 'MMM d, yyyy') : 'Never' },
                  { label: 'Top City', value: k.topCity || 'N/A' },
                  { label: 'Daily Assignment', value: `${seller.assignment} orders/day` },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-[10px] text-gray-500">{r.label}</span>
                    <span className="text-[11px] font-semibold text-brand-navy">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                  <Package className="w-3 h-3" /> Attributed Products
                </p>
                {k.productNames.length === 0 ? (
                  <p className="text-[10px] text-gray-400 py-2">No products attributed</p>
                ) : (
                  <div className="space-y-1.5">
                    {k.productNames.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 py-1 border-b border-gray-50 last:border-0">
                        <div className="w-6 h-6 bg-gray-50 rounded border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                          {p.image ? (
                            <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <Package className="w-3 h-3 text-gray-300" />
                          )}
                        </div>
                        <span className="text-[10px] text-brand-navy/80 truncate">{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Payout history */}
            {k.monthlyPayments.length > 0 && (
              <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                  <CreditCard className="w-3 h-3" /> Payout History
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Month', 'Days', 'Delivered', 'Commission', 'Total', 'Status'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {k.monthlyPayments.map((p, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{format(parseISO(p.month), 'MMM yyyy')}</td>
                          <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{p.days_present}</td>
                          <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{p.delivered_orders}</td>
                          <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">{p.commission_earned.toLocaleString()}</td>
                          <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy tabular-nums">{p.total_amount.toLocaleString()} DH</td>
                          <td className="px-3 py-2">
                            <span className={`h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold ${p.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Personal & Banking */}
            {(seller.cin_number || seller.bank_name || seller.address) && (
              <div className="rounded-xl border border-gray-100 bg-white p-3.5 space-y-2">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3" /> Personal & Banking
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {seller.cin_number && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <ShieldCheck className="w-3 h-3 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">CIN</p>
                        <p className="text-[11px] text-brand-navy/80">{seller.cin_number}</p>
                      </div>
                    </div>
                  )}
                  {seller.address && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Address</p>
                        <p className="text-[11px] text-brand-navy/80">{seller.address}</p>
                      </div>
                    </div>
                  )}
                  {seller.bank_name && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <CreditCard className="w-3 h-3 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Bank</p>
                        <p className="text-[11px] text-brand-navy/80">{seller.bank_name}</p>
                      </div>
                    </div>
                  )}
                  {seller.bank_rib && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <CreditCard className="w-3 h-3 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">RIB</p>
                        <p className="text-[11px] text-brand-navy/80 font-mono">{seller.bank_rib}</p>
                      </div>
                    </div>
                  )}
                  {seller.phone && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                      <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Phone</p>
                        <p className="text-[11px] text-brand-navy/80">{seller.phone}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  };

  // ============ RENDER ============
  return (
    <>
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        {/* Header */}
        <header className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Sellers</h1>
              <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Seller intelligence & performance tracking</p>
            </div>
            <Badge className="bg-gray-100 text-brand-navy/70 border-0 text-[10px] px-2.5 py-1 rounded-md font-semibold w-fit">
              {globalStats.totalSellers} active
            </Badge>
          </div>
        </header>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Total Sellers', value: globalStats.totalSellers, accent: '#3b5e5e' },
            { label: 'Total Delivered', value: globalStats.totalDelivered, accent: '#059669' },
            { label: 'Total Revenue', value: `${globalStats.totalRevenue.toLocaleString()} MAD`, accent: '#059669' },
            { label: 'Avg Delivery Rate', value: `${globalStats.avgDeliveryRate.toFixed(1)}%`, accent: '#d97706' },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
              <span className="w-[3px] self-stretch rounded-full" style={{ background: stat.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{stat.label}</p>
                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Seller table */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="h-5 w-5 border-2 border-brand-navy/20 border-t-brand-navy rounded-full animate-spin" />
            </div>
          ) : sellers.length === 0 ? (
            <div className="p-12 text-center">
              <Store className="w-8 h-8 text-gray-200 mx-auto mb-3" />
              <p className="text-[11px] text-gray-400">No sellers found. Create a seller from the Users page.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-gray-100">
                <tr>
                  {['Seller', 'Commission', 'Funnel (pending · confirmed · delivered)', 'Delivery Rate', 'Unpaid Commission'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller, i) => (
                  <SellerRow key={seller.id} seller={seller} index={i} />
                ))}
              </tbody>
            </table>
          )}
        </div>
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
