export type CommissionBasis = "per_order" | "per_unit";

export function normalizeCommissionBasis(v: string | null | undefined): CommissionBasis {
  return v === "per_unit" ? "per_unit" : "per_order";
}

/** Sum quantities on order lines whose product_id is in the seller's assigned list. */
export function sumAssignedProductUnits(order: any, sellerProductIds: string[]): number {
  const items = order.order_items ?? order.items ?? [];
  const set = new Set((sellerProductIds || []).filter(Boolean));
  if (set.size === 0) return 0;
  return items.reduce((sum: number, row: any) => {
    const pid = row.product_id;
    if (!pid || !set.has(pid)) return sum;
    return sum + Number(row.quantity || 0);
  }, 0);
}

/**
 * Total accrual count for commission: order count (per_order) or sum of assigned-product units (per_unit).
 */
export function totalAccruedForCommission(
  orders: any[],
  isDelivered: (o: any) => boolean,
  basis: CommissionBasis,
  sellerProductIds: string[],
): number {
  const delivered = orders.filter(isDelivered);
  if (basis === "per_unit") {
    return delivered.reduce((acc, o) => acc + sumAssignedProductUnits(o, sellerProductIds), 0);
  }
  return delivered.length;
}

export function computeUnpaidCommission(params: {
  basis: CommissionBasis;
  commissionPrice: number;
  orders: any[];
  isDelivered: (o: any) => boolean;
  sellerProductIds: string[];
  /** Sum of seller_payments.delivered_orders for paid payouts */
  paidTally: number;
}): { accruedTotal: number; unpaidAccrued: number; unpaidCommission: number } {
  const { basis, commissionPrice, orders, isDelivered, sellerProductIds, paidTally } = params;
  const accruedTotal = totalAccruedForCommission(orders, isDelivered, basis, sellerProductIds);
  const unpaidAccrued = Math.max(0, accruedTotal - paidTally);
  return {
    accruedTotal,
    unpaidAccrued,
    unpaidCommission: unpaidAccrued * Number(commissionPrice || 0),
  };
}
