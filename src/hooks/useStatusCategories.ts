import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useMemo } from 'react';
import {
  type OrderCategory,
  type PkgCategory,
  CONFIRMED_ORDER_CATS,
  CANCELLED_ORDER_CATS,
  CALLBACK_ORDER_CATS,
  PENDING_ORDER_CATS,
  SHIPPED_PKG_CATS,
  DELIVERED_PKG_CATS,
  RETURNED_PKG_CATS,
  ORDER_CATEGORY_COLORS,
  PKG_CATEGORY_COLORS,
} from '@/lib/status-categories';

export interface OrderStatus {
  id: string;
  code: string;
  label: string;
  color: string | null;
  category: OrderCategory;
  ranking: number | null;
  recheck: boolean | null;
  active: boolean | null;
  show_in_quick_status: boolean;
  show_in_seller_confirmation: boolean;
  show_in_seller_suivi: boolean;
  perf_breakdown: boolean;
  perf_breakdown_phase: string | null;
}

export interface PackageStatus {
  id: string;
  code: string;
  label: string;
  color: string | null;
  category: PkgCategory;
  ranking: number | null;
  delivery_service_statuses: unknown;
  show_in_courier: boolean;
  show_in_seller_suivi: boolean;
  show_in_seller_confirmation: boolean;
  perf_breakdown: boolean;
  perf_breakdown_phase: string | null;
}

export function useStatusCategories() {
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const { data: orderStatuses = [] } = useQuery<OrderStatus[]>({
    queryKey: ['order_statuses_cat', activeBusinessId],
    queryFn: async () => {
      if (!activeBusinessId) return [];
      const { data } = await supabase
        .from('order_statuses')
        .select('id, code, label, color, category, ranking, recheck, active, show_in_quick_status, show_in_seller_confirmation, show_in_seller_suivi, perf_breakdown, perf_breakdown_phase')
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
        .select('id, code, label, color, category, ranking, delivery_service_statuses, show_in_courier, show_in_seller_suivi, show_in_seller_confirmation, perf_breakdown, perf_breakdown_phase')
        .order('ranking');
      return (data || []) as PackageStatus[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const orderCatMap = new Map<string, OrderStatus[]>();
    const orderIdMap = new Map<string, OrderStatus>();
    for (const s of orderStatuses) {
      orderIdMap.set(s.id, s);
      const arr = orderCatMap.get(s.category) || [];
      arr.push(s);
      orderCatMap.set(s.category, arr);
    }

    const pkgCatMap = new Map<string, PackageStatus[]>();
    const pkgIdMap = new Map<string, PackageStatus>();
    for (const s of packageStatuses) {
      pkgIdMap.set(s.id, s);
      const arr = pkgCatMap.get(s.category) || [];
      arr.push(s);
      pkgCatMap.set(s.category, arr);
    }

    const collectIds = (cats: string[], map: Map<string, { id: string }[]>) =>
      new Set(cats.flatMap(c => (map.get(c) || []).map(s => s.id)));

    const confirmedIds = collectIds(CONFIRMED_ORDER_CATS, orderCatMap);
    const unpaidOrderIds = collectIds(['unpaid'], orderCatMap);
    const cancelledIds = collectIds(CANCELLED_ORDER_CATS, orderCatMap);
    const callbackIds = collectIds(CALLBACK_ORDER_CATS, orderCatMap);
    const pendingIds = collectIds(PENDING_ORDER_CATS, orderCatMap);
    const deliveredPkgIds = collectIds(DELIVERED_PKG_CATS, pkgCatMap);
    const shippedPkgIds = collectIds(SHIPPED_PKG_CATS, pkgCatMap);
    const returnedPkgIds = collectIds(RETURNED_PKG_CATS, pkgCatMap);

    // Performance breakdown sets
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

    return {
      orderStatuses,
      packageStatuses,

      getOrderByCategory: (cat: OrderCategory) => orderCatMap.get(cat)?.[0],
      getOrdersByCategories: (cats: OrderCategory[]) =>
        cats.flatMap(c => orderCatMap.get(c) || []),
      getPkgByCategory: (cat: PkgCategory) => pkgCatMap.get(cat)?.[0],
      getPkgsByCategories: (cats: PkgCategory[]) =>
        cats.flatMap(c => pkgCatMap.get(c) || []),

      isOrderCategory: (statusId: string, cat: OrderCategory) =>
        orderIdMap.get(statusId)?.category === cat,
      isOrderInCategories: (statusId: string, cats: OrderCategory[]) => {
        const s = orderIdMap.get(statusId);
        return s ? (cats as string[]).includes(s.category) : false;
      },
      isPkgCategory: (statusId: string, cat: PkgCategory) =>
        pkgIdMap.get(statusId)?.category === cat,
      isPkgInCategories: (statusId: string, cats: PkgCategory[]) => {
        const s = pkgIdMap.get(statusId);
        return s ? (cats as string[]).includes(s.category) : false;
      },

      getOrderCategory: (statusId: string) => orderIdMap.get(statusId)?.category,
      getPkgCategory: (statusId: string) => pkgIdMap.get(statusId)?.category,

      confirmedIds,
      unpaidOrderIds,
      cancelledIds,
      callbackIds,
      pendingIds,
      deliveredPkgIds,
      shippedPkgIds,
      returnedPkgIds,

      preConfBreakdownIds,
      postConfBreakdownIds,
      getPreConfBreakdownStatuses,
      getPostConfBreakdownStatuses,

      getCategoryColor: (cat: string) =>
        ORDER_CATEGORY_COLORS[cat] || PKG_CATEGORY_COLORS[cat] || '#6b7280',
      getOrderStatusColor: (statusId: string) => {
        const s = orderIdMap.get(statusId);
        return s?.color || ORDER_CATEGORY_COLORS[s?.category || ''] || '#6b7280';
      },
      getPkgStatusColor: (statusId: string) => {
        const s = pkgIdMap.get(statusId);
        return s?.color || PKG_CATEGORY_COLORS[s?.category || ''] || '#6b7280';
      },
    };
  }, [orderStatuses, packageStatuses]);
}
