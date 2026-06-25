import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useMemo } from 'react';

/**
 * Status classification is now 100% driven by owner-governable boolean flags on the
 * master rows (package_statuses / order_statuses). The legacy free-text `category`
 * column has been removed; the category-string helpers below are a thin compatibility
 * facade that resolves each historical category name to its flag predicate, so existing
 * call-sites keep working without a hidden, hardcoded business-rule contract.
 */

export interface OrderStatus {
  id: string;
  code: string;
  label: string;
  color: string | null;
  ranking: number | null;
  recheck: boolean | null;
  active: boolean | null;
  show_in_quick_status: boolean;
  show_in_seller_confirmation: boolean;
  show_in_seller_suivi: boolean;
  perf_breakdown: boolean;
  perf_breakdown_phase: string | null;
  // Semantic behavior flags — owner-governable source of truth.
  is_new: boolean;
  is_confirmed: boolean;
  is_paid: boolean;
  is_unpaid: boolean;
  is_cancelled: boolean;
  is_callback: boolean;
  is_fake: boolean;
  is_double: boolean;
  is_blacklisted: boolean;
  is_postponed: boolean;
  is_relaunch: boolean;
  is_return: boolean;
  deducts_stock: boolean;
  excluded_from_delivery_rate: boolean;
  /** Source of truth for "pending confirmation" (RAPPEL retry queue + NEW + REPORTER). */
  pending_confirmation: boolean;
}

export interface PackageStatus {
  id: string;
  code: string;
  label: string;
  color: string | null;
  ranking: number | null;
  delivery_service_statuses: unknown;
  show_in_courier: boolean;
  show_in_seller_suivi: boolean;
  show_in_seller_confirmation: boolean;
  perf_breakdown: boolean;
  perf_breakdown_phase: string | null;
  // Semantic behavior flags — owner-governable source of truth.
  is_delivered: boolean;
  is_shipped: boolean;
  is_returned: boolean;
  is_refused: boolean;
  is_new: boolean;
  is_cancelled: boolean;
  is_postponed: boolean;
  is_recheck: boolean;
  is_terminal: boolean;
  flow_rank: number | null;
  excluded_from_delivery_rate: boolean;
}

/**
 * Legacy category-name → flag-predicate facade. Each name resolves EXACTLY to the rows
 * the old `category` value covered (verified by parity when the flags were seeded).
 * 'processed' and 'cancelled' are derived (no dedicated flag) to stay exact.
 */
const ORDER_CAT_PRED: Record<string, (s: OrderStatus) => boolean> = {
  new: s => s.is_new,
  confirmed: s => s.deducts_stock,
  processed: s => s.is_confirmed && !s.deducts_stock && !s.is_paid && !s.is_unpaid,
  paid: s => s.is_paid,
  unpaid: s => s.is_unpaid,
  cancelled: s => s.is_cancelled && !s.is_fake && !s.is_double && !s.is_blacklisted,
  fake: s => s.is_fake,
  double: s => s.is_double,
  blacklisted: s => s.is_blacklisted,
  callback: s => s.is_callback,
  relaunch_new: s => s.is_relaunch,
  return: s => s.is_return,
  postponed: s => s.is_postponed,
};

const PKG_CAT_PRED: Record<string, (s: PackageStatus) => boolean> = {
  delivered: s => s.is_delivered,
  new: s => s.is_new,
  recheck: s => s.is_recheck,
  refused: s => s.is_refused,
  returned: s => s.is_returned,
  cancelled: s => s.is_cancelled,
  postponed: s => s.is_postponed,
  // Forward "shipped" progression — only ever queried as a group.
  in_transit: s => s.is_shipped,
  out_for_delivery: s => s.is_shipped,
  picked_up: s => s.is_shipped,
  pickup_pending: s => s.is_shipped,
};

const orderPred = (cat: string) => ORDER_CAT_PRED[cat] ?? (() => false);
const pkgPred = (cat: string) => PKG_CAT_PRED[cat] ?? (() => false);

export function useStatusCategories() {
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const { data: orderStatuses = [] } = useQuery<OrderStatus[]>({
    queryKey: ['order_statuses_cat', activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const { data } = await supabase
        .from('order_statuses')
        .select('id, code, label, color, ranking, recheck, active, show_in_quick_status, show_in_seller_confirmation, show_in_seller_suivi, perf_breakdown, perf_breakdown_phase, pending_confirmation, is_new, is_confirmed, is_paid, is_unpaid, is_cancelled, is_callback, is_fake, is_double, is_blacklisted, is_postponed, is_relaunch, is_return, deducts_stock, excluded_from_delivery_rate')
        .order('ranking');
      return (data || []) as OrderStatus[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: packageStatuses = [] } = useQuery<PackageStatus[]>({
    queryKey: ['package_statuses_cat', activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const { data } = await supabase
        .from('package_statuses')
        .select('id, code, label, color, ranking, delivery_service_statuses, show_in_courier, show_in_seller_suivi, show_in_seller_confirmation, perf_breakdown, perf_breakdown_phase, is_delivered, is_shipped, is_returned, is_refused, is_new, is_cancelled, is_postponed, is_recheck, is_terminal, flow_rank, excluded_from_delivery_rate')
        .order('ranking');
      return (data || []) as PackageStatus[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const orderIdMap = new Map<string, OrderStatus>();
    for (const s of orderStatuses) orderIdMap.set(s.id, s);

    const pkgIdMap = new Map<string, PackageStatus>();
    for (const s of packageStatuses) pkgIdMap.set(s.id, s);

    const idsWhere = <T extends { id: string }>(rows: T[], pred: (r: T) => boolean) =>
      new Set(rows.filter(pred).map(r => r.id));

    const confirmedIds = idsWhere(orderStatuses, s => s.is_confirmed);
    const paidOrderIds = idsWhere(orderStatuses, s => s.is_paid);
    const unpaidOrderIds = idsWhere(orderStatuses, s => s.is_unpaid);
    const cancelledIds = idsWhere(orderStatuses, s => s.is_cancelled);
    const callbackIds = idsWhere(orderStatuses, s => s.is_callback);
    const pendingIds = idsWhere(orderStatuses, s => s.pending_confirmation);
    const newOrderIds = idsWhere(orderStatuses, s => s.is_new);
    const unreachedOrderIds = idsWhere(orderStatuses, s => s.is_callback);

    const adminPullbackOrderIds = idsWhere(orderStatuses, s => s.excluded_from_delivery_rate);
    const adminPullbackPackageIds = idsWhere(packageStatuses, s => s.excluded_from_delivery_rate);
    const deliveredPkgIds = idsWhere(packageStatuses, s => s.is_delivered);
    const shippedPkgIds = idsWhere(packageStatuses, s => s.is_shipped);
    const returnedPkgIds = idsWhere(packageStatuses, s => s.is_returned);

    const preConfBreakdownIds = new Set(
      orderStatuses.filter(s => s.perf_breakdown && s.perf_breakdown_phase === 'before_confirmation').map(s => s.id)
    );
    const postConfBreakdownIds = new Set(
      packageStatuses.filter(s => s.perf_breakdown && s.perf_breakdown_phase === 'after_confirmation').map(s => s.id)
    );

    const getPreConfBreakdownStatuses = () =>
      orderStatuses.filter(s => s.perf_breakdown && s.perf_breakdown_phase === 'before_confirmation');
    const getPostConfBreakdownStatuses = () =>
      packageStatuses.filter(s => s.perf_breakdown && s.perf_breakdown_phase === 'after_confirmation');

    const liveBeforeConfStatuses: OrderStatus[] = orderStatuses.filter(s =>
      s.perf_breakdown &&
      s.perf_breakdown_phase === 'before_confirmation' &&
      !s.is_confirmed &&
      !s.is_cancelled,
    );
    const liveAfterConfStatuses: PackageStatus[] = packageStatuses.filter(s =>
      s.perf_breakdown &&
      s.perf_breakdown_phase === 'after_confirmation' &&
      !s.is_delivered &&
      !s.is_returned,
    );

    return {
      orderStatuses,
      packageStatuses,

      // Category-name facade (resolves to flag predicates; no `category` column).
      getOrderByCategory: (cat: string) => orderStatuses.find(orderPred(cat)),
      getOrdersByCategories: (cats: string[]) =>
        orderStatuses.filter(s => cats.some(c => orderPred(c)(s))),
      getPkgByCategory: (cat: string) => packageStatuses.find(pkgPred(cat)),
      getPkgsByCategories: (cats: string[]) =>
        packageStatuses.filter(s => cats.some(c => pkgPred(c)(s))),

      isOrderCategory: (statusId: string, cat: string) => {
        const s = orderIdMap.get(statusId);
        return s ? orderPred(cat)(s) : false;
      },
      isOrderInCategories: (statusId: string, cats: string[]) => {
        const s = orderIdMap.get(statusId);
        return s ? cats.some(c => orderPred(c)(s)) : false;
      },
      isPkgCategory: (statusId: string, cat: string) => {
        const s = pkgIdMap.get(statusId);
        return s ? pkgPred(cat)(s) : false;
      },
      isPkgInCategories: (statusId: string, cats: string[]) => {
        const s = pkgIdMap.get(statusId);
        return s ? cats.some(c => pkgPred(c)(s)) : false;
      },

      confirmedIds,
      paidOrderIds,
      unpaidOrderIds,
      cancelledIds,
      callbackIds,
      pendingIds,
      newOrderIds,
      unreachedOrderIds,
      adminPullbackOrderIds,
      adminPullbackPackageIds,
      deliveredPkgIds,
      shippedPkgIds,
      returnedPkgIds,

      preConfBreakdownIds,
      postConfBreakdownIds,
      getPreConfBreakdownStatuses,
      getPostConfBreakdownStatuses,
      liveBeforeConfStatuses,
      liveAfterConfStatuses,

      getOrderStatusColor: (statusId: string) => orderIdMap.get(statusId)?.color || '#6b7280',
      getPkgStatusColor: (statusId: string) => pkgIdMap.get(statusId)?.color || '#6b7280',
    };
  }, [orderStatuses, packageStatuses]);
}
