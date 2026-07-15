/**
 * FIFO order attribution for seller payouts.
 *
 * A seller's monthly ledger ticket is money-based: `total = carried_in + month_earned`,
 * reduced by each payment (`seller_payment_txns`). A payment never "pays" specific
 * orders — but the collaborator wants every statement to show ONLY the orders that
 * payment actually covered, not the whole month.
 *
 * We attribute deterministically, oldest-first (FIFO):
 *   money is applied to `carried_in` (the prior-month debt, oldest) FIRST, then to the
 *   current month's delivered orders sorted by delivery date. A payment occupies a
 *   cumulative-money window [start, end); the orders whose own [cumStart, cumEnd] range
 *   overlaps that window are "settled by this payment". The boundary order (the one the
 *   window ends inside) is partially settled — we report the exact covered portion so the
 *   listed amounts tie out to the payment to the cent.
 *
 * Used identically by: the pay modal preview, the emailed PDF statement, the seller's
 * Payments page, and the admin ledger dialogs — one source of truth so they never disagree.
 */

const EPS = 0.005;

export interface AttribOrderInput {
  order_id: string;
  client?: string | null;
  phone?: string | null;
  tracking?: string | null;
  units?: number;
  commission: number;
  delivered_at?: string | null;
}

export interface AttributedOrder extends AttribOrderInput {
  /** Amount of this order's commission covered by the window. */
  paidPortion: number;
  /** True when only part of the commission is covered (boundary order). */
  partial: boolean;
}

export interface PaymentSlice {
  /** Portion of the window that fell on the prior-month carry-in (no listable orders). */
  reportPortion: number;
  /** Orders the window covers, FIFO, with per-order covered portions. */
  orders: AttributedOrder[];
  /** reportPortion + Σ paidPortion — equals the window width (clamped to available money). */
  coveredTotal: number;
}

/**
 * Sort orders FIFO: delivery date ascending (nulls last), then order_id for stability.
 *
 * RUNTIME-DEAD, RETAINED DELIBERATELY (D7, 2026-07-15) — zero external callers.
 * This is the parity reference for the FIFO ordering the payout RPCs implement
 * server-side; it is the readable spec for that SQL. Tree-shaken at build time.
 * Do not delete while the SQL it documents is live.
 */
export function sortOrdersFifo<T extends AttribOrderInput>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const da = a.delivered_at ? Date.parse(a.delivered_at) : Number.POSITIVE_INFINITY;
    const db = b.delivered_at ? Date.parse(b.delivered_at) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0;
  });
}

/**
 * Attribute the cumulative-money window [windowStart, windowEnd) to FIFO orders.
 * `carriedIn` (prior-month debt) is settled first, so orders begin accumulating at it.
 * Orders need NOT be pre-sorted — this sorts FIFO internally.
 */
export function attributePaymentOrders(
  orders: AttribOrderInput[],
  carriedIn: number,
  windowStart: number,
  windowEnd: number,
): PaymentSlice {
  const ci = Math.max(0, Number(carriedIn) || 0);
  const ws = Math.max(0, Number(windowStart) || 0);
  const we = Math.max(ws, Number(windowEnd) || 0);

  // How much of this window lands on the carried-in (prior-month) portion [0, ci].
  const reportPortion = Math.max(0, Math.min(we, ci) - Math.max(ws, 0));

  const sorted = sortOrdersFifo(orders);
  const out: AttributedOrder[] = [];
  let cursor = ci;
  for (const o of sorted) {
    const c = Number(o.commission) || 0;
    const start = cursor;
    const end = cursor + c;
    const portion = Math.max(0, Math.min(end, we) - Math.max(start, ws));
    if (portion > EPS) {
      out.push({ ...o, paidPortion: portion, partial: portion < c - EPS });
    }
    cursor = end;
    if (cursor >= we - EPS) break; // window exhausted
  }

  const coveredTotal = reportPortion + out.reduce((s, o) => s + o.paidPortion, 0);
  return { reportPortion, orders: out, coveredTotal };
}

export type OrderSettlementState = 'settled' | 'partial' | 'pending';

/**
 * Month overview: classify every order as settled / partial / pending given the total
 * paid so far (Σ of all the month's payments). Same FIFO model — carried-in first, then
 * orders by delivery date. The single boundary order is `partial`. Generic so the caller's
 * concrete order type (and its non-null fields) is preserved on the result.
 */
export function classifyMonthOrders<T extends AttribOrderInput>(
  orders: T[],
  carriedIn: number,
  totalPaid: number,
): Array<T & { state: OrderSettlementState; paidPortion: number }> {
  const ci = Math.max(0, Number(carriedIn) || 0);
  const paid = Math.max(0, Number(totalPaid) || 0);
  const sorted = sortOrdersFifo(orders);
  let cursor = ci;
  return sorted.map((o) => {
    const c = Number(o.commission) || 0;
    const start = cursor;
    const end = cursor + c;
    const portion = Math.max(0, Math.min(end, paid) - start);
    cursor = end;
    const state: OrderSettlementState =
      portion >= c - EPS && c > 0 ? 'settled' : portion > EPS ? 'partial' : 'pending';
    return { ...o, paidPortion: portion, state };
  });
}
