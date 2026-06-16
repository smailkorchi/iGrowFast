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
 * - **Per-unit with empty `users.products`:** commission is **0** (a seller earns only on their assigned SKUs). Matches the DB function `sum_order_units_for_seller_products`, the `seller_daily_earnings` view, and the payout flow exactly — no display-vs-payout drift.
 */

/**
 * Single source of truth for "delivered": the order's `package_status_id` must
 * resolve to a package_statuses row whose `category = 'delivered'`. Matches the
 * rewritten `public.seller_daily_earnings` view exactly (migration
 * `seller_daily_earnings_category_only_delivered`, 2026-04-22).
 *
 * Label matching was removed because `ILIKE '%livre%'` matched "livrer"
 * (infinitive) in phrases like "Retour prêt à livrer", inflating delivered
 * counts and paying commission on non-delivered orders. Pre-flight DB audit
 * confirmed no legitimate delivered order exists without a delivered-category
 * `package_status_id`, so there is no legacy case the label path protects.
 */
export function isDeliveredForCommission(
  o: { package_status_id?: string | null },
  deliveredPkgIds: Set<string>,
): boolean {
  return !!o.package_status_id && deliveredPkgIds.has(o.package_status_id);
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
  // No assigned products = no commission. This MUST match the DB function
  // `sum_order_units_for_seller_products` (which returns 0 for empty
  // users.products) so the seller-facing displays and the payout/Salaries flow
  // can never disagree for a per_unit seller with no assigned catalog.
  if (set.size === 0) return 0;
  return items.reduce((sum: number, row: OrderLine) => {
    const pid = row.product_id;
    if (!pid) return sum;
    if (!set.has(pid)) return sum;
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

/**
 * Computes how much commission the seller is owed RIGHT NOW.
 *
 * Pre-partial-payouts model: callers passed `paidTally` = sum of
 * `delivered_orders` across paid payout rows. A partial payment couldn't be
 * represented — you either consumed all deliveries on the period or none.
 *
 * New model: callers pass `paidAmount` = `SUM(seller_payment_txns.amount)`
 * across every disbursement (full + partial). We convert that money back into
 * "delivery slots already paid" using the current commission price, then
 * subtract from accrued deliveries. Equivalent to the old behavior when every
 * payment is full; correct when there are partials.
 *
 * Backward-compat: the legacy `paidTally` field is still accepted. If callers
 * pass it but not `paidAmount`, we infer `paidAmount = paidTally × price`. New
 * callers should pass `paidAmount` directly (sum of all txn rows).
 */
export function computeUnpaidCommission(params: {
  basis: CommissionBasis;
  commissionPrice: number;
  orders: OrderForCommission[];
  isDelivered: (o: OrderForCommission) => boolean;
  sellerProductIds: string[];
  /** New (preferred): SUM(seller_payment_txns.amount) — all paid + partial. */
  paidAmount?: number;
  /** Legacy: count of delivered_orders across paid payouts. Translated to cash. */
  paidTally?: number;
}): { accruedTotal: number; unpaidAccrued: number; unpaidCommission: number } {
  const { basis, commissionPrice, orders, isDelivered, sellerProductIds, paidAmount, paidTally } = params;
  const accruedTotal = totalAccruedForCommission(orders, isDelivered, basis, sellerProductIds);
  const price = Number(commissionPrice || 0);
  const accruedCash = accruedTotal * price;
  // Prefer explicit paidAmount; otherwise derive from legacy paidTally.
  const paidCash = paidAmount != null
    ? Math.max(0, Number(paidAmount) || 0)
    : Math.max(0, Number(paidTally || 0) * price);
  const unpaidCommission = Math.max(0, accruedCash - paidCash);
  // Translate cash-owed back to delivery-equivalents so UIs that show "X deliveries unpaid"
  // keep working. When price is 0 (salary buyer) we report 0 — no deliveries are accruing.
  const unpaidAccrued = price > 0 ? unpaidCommission / price : 0;
  return {
    accruedTotal,
    unpaidAccrued,
    unpaidCommission,
  };
}
