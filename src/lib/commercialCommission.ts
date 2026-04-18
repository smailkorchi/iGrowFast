import { endOfDay, isWithinInterval, startOfDay } from "date-fns";

export type CommissionBasis = "per_order" | "per_unit";

/**
 * Commission / delivery semantics (keep UI and payouts aligned):
 *
 * - **Delivered for commission:** `isDeliveredForCommission` (order label, joined package row label, or package category IDs).
 * - **seller_daily_earnings:** Rows are written by database logic; `date` / `delivered_count` / `commission_earned` must match the same delivered rule and basis. Inspect remote with:
 *   `SELECT pg_get_viewdef('public.seller_daily_earnings'::regclass, true);` and trigger sources on `orders`.
 * - **Delivery day for “today” KPIs (client):** `date_livraison` when set, else `updated_at`, only for orders that pass `isDeliveredForCommission`.
 * - **Unpaid commission:** `computeUnpaidCommission` must use the **full** order history for the seller (same scope as lifetime `paidTally` from paid `seller_payments`), not a date-filtered subset.
 * - **Per-unit with empty `users.products`:** All line quantities on the order count (lenient fallback); when products are assigned, only those SKUs count.
 */

function labelIndicatesDelivered(label: string | null | undefined): boolean {
  const t = (label || "").toLowerCase();
  return t.includes("livré") || t.includes("livre") || t.includes("delivered");
}

/**
 * Aligns with public.seller_daily_earnings: delivered when order.package_status_label matches,
 * or joined package_statuses.label matches, or package_status_id is in configured "delivered" categories.
 */
export function isDeliveredForCommission(
  o: {
    package_status_id?: string | null;
    package_status_label?: string | null;
    package_statuses?: { label?: string | null } | null;
    package_status?: { label?: string | null } | null;
  },
  deliveredPkgIds: Set<string>,
): boolean {
  if (labelIndicatesDelivered(o.package_status_label)) return true;
  const ps = o.package_statuses ?? o.package_status;
  if (ps && typeof ps === "object" && !Array.isArray(ps)) {
    if (labelIndicatesDelivered((ps as { label?: string | null }).label)) return true;
  }
  if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) return true;
  return false;
}

export function normalizeCommissionBasis(v: string | null | undefined): CommissionBasis {
  return v === "per_unit" ? "per_unit" : "per_order";
}

/** True when the order's order_status belongs to a "committed to fulfill" category. */
export function isConfirmed(
  o: { order_status_id?: string | null },
  confirmedIds: Set<string>,
): boolean {
  return !!o.order_status_id && confirmedIds.has(o.order_status_id);
}

/**
 * Stage attribution timestamps — each stage uses its dedicated column with a safe fallback
 * so orders without the dedicated timestamp still bucket into the period correctly.
 * Mirrors the policy used by seller_daily_earnings for delivery.
 */
export function assignmentTimestampForMetrics(o: {
  assignment_date?: string | null;
  date?: string | null;
}): Date | null {
  const s = o.assignment_date || o.date;
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function confirmationTimestampForMetrics(o: {
  confirmation_date?: string | null;
  date?: string | null;
}): Date | null {
  const s = o.confirmation_date || o.date;
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sum quantities on order lines: if the seller has no assigned product IDs, count **all** lines;
 * otherwise only lines whose product_id is in the assigned list.
 */
type OrderLine = { product_id?: string | null; quantity?: number | string | null };
type OrderForCommission = {
  order_items?: OrderLine[] | null;
  items?: OrderLine[] | null;
} & Parameters<typeof isDeliveredForCommission>[0] & Parameters<typeof deliveryTimestampForMetrics>[0];

export function sumAssignedProductUnits(order: OrderForCommission, sellerProductIds: string[]): number {
  const items = order.order_items ?? order.items ?? [];
  const set = new Set((sellerProductIds || []).filter(Boolean));
  const countAllLines = set.size === 0;
  return items.reduce((sum: number, row: OrderLine) => {
    const pid = row.product_id;
    if (!pid) return sum;
    if (!countAllLines && !set.has(pid)) return sum;
    return sum + Number(row.quantity || 0);
  }, 0);
}

/** Timestamp used to attribute a delivery to a calendar day (KPIs / “delivered today”). */
export function deliveryTimestampForMetrics(o: {
  date_livraison?: string | null;
  updated_at?: string | null;
}): Date | null {
  if (o.date_livraison) {
    const d = new Date(o.date_livraison);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (o.updated_at) {
    const d = new Date(o.updated_at);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Delivered for commission, and delivery timestamp falls on the given local calendar day. */
export function isDeliveredOnLocalDay(o: OrderForCommission, deliveredPkgIds: Set<string>, day: Date): boolean {
  if (!isDeliveredForCommission(o, deliveredPkgIds)) return false;
  const t = deliveryTimestampForMetrics(o);
  if (!t) return false;
  return isWithinInterval(t, { start: startOfDay(day), end: endOfDay(day) });
}

/** Gross commission for one order (already delivered); does not subtract payouts. */
export function commissionAccruedForDeliveredOrder(params: {
  order: OrderForCommission;
  basis: CommissionBasis;
  commissionPrice: number;
  sellerProductIds: string[];
}): number {
  const { order, basis, commissionPrice, sellerProductIds } = params;
  const rate = Number(commissionPrice || 0);
  if (basis === "per_unit") {
    return sumAssignedProductUnits(order, sellerProductIds) * rate;
  }
  return rate;
}

/**
 * Total accrual count for commission: order count (per_order) or sum of assigned-product units (per_unit).
 */
export function totalAccruedForCommission(
  orders: OrderForCommission[],
  isDelivered: (o: OrderForCommission) => boolean,
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
  orders: OrderForCommission[];
  isDelivered: (o: OrderForCommission) => boolean;
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
