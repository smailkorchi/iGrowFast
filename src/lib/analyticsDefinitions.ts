/**
 * Analytics Definitions — single source of truth.
 *
 * Every analytics/dashboard component MUST import from this file instead of
 * defining its own "revenue", "delivered", "confirmed", etc. See the plan at
 * /Users/elqorchiismail/.claude/plans/now-bro-let-s-continue-streamed-melody.md
 * for the rationale and full dictionary.
 *
 * Core rules (excerpt):
 * - Revenue = paid AND delivered, product-only (shipping stripped).
 * - Confirmed = order_status category in confirmed set OR tracking_number set.
 * - Delivered = `package_status_id` resolves to a delivered-category row in
 *   `package_statuses` (single source of truth; label matching removed
 *   2026-04-22 — see migration `seller_daily_earnings_category_only_delivered`).
 * - Returned orders contribute zero COGS (stock is restored server-side).
 * - Per-order ad share = spend ÷ delivered-order-count (equal split).
 * - Commission date anchor = delivery date (date_livraison, fallback updated_at).
 */

import {
    differenceInCalendarDays,
    endOfMonth,
    isWithinInterval,
    startOfMonth,
    max as maxDate,
    min as minDate,
} from 'date-fns';
import {
    CONFIRMED_ORDER_CATS,
    CANCELLED_ORDER_CATS,
    DELIVERED_PKG_CATS,
    RETURNED_PKG_CATS,
    SHIPPED_PKG_CATS,
} from '@/lib/status-categories';
import { PLATFORM_SOURCE_MAP } from '@/lib/campaignConstants';

// ─── Constants ────────────────────────────────────────────────────────────

/** Pending order is stale after this many days without confirmation. */
export const PENDING_STALE_DAYS = 3;

/** In-transit package is stuck after this many days without delivery. */
export const SHIPPING_STUCK_DAYS = 5;

/** Low-stock flag threshold (applies to products and accessories). */
export const LOW_STOCK_THRESHOLD = 10;

/** Team member is "active" only if flagged active AND has activity within this many days. */
export const ACTIVE_USER_WINDOW_DAYS = 30;

/** The single canonical "paid" order category. */
export const PAID_ORDER_CAT = 'paid';

/** The single canonical "unpaid" order category (delivered-but-unpaid = provisional). */
export const UNPAID_ORDER_CAT = 'unpaid';

// ─── Design tokens (locked — see plan §Design refresh) ───────────────────

/**
 * The only five semantic tones allowed across all analytics/dashboard views.
 * Any hue outside this palette must be approved and added here.
 */
export const SEMANTIC_TONES = {
    primary: '#3b5e5e',   // brand-navy — hero numbers, primary text
    positive: '#059669',  // emerald-600 — revenue, delivered, healthy
    negative: '#ef4444',  // red-500    — failed, over-budget, stuck
    warning: '#d97706',   // amber-600  — provisional, at-risk
    neutral: '#9ca3af',   // gray-400   — labels, secondary copy
} as const;

// ─── Types ────────────────────────────────────────────────────────────────

export type AnalyticsOrderItem = {
    product_id?: string | null;
    quantity?: number | string | null;
    unit_price?: number | string | null;
    total_price?: number | string | null;
    accessory_id?: string | null;
    accessory_quantity?: number | string | null;
    accessory_unit_price?: number | string | null;
    product_unit_cost_snapshot?: number | string | null;
};

export type AnalyticsOrder = {
    id?: string;
    date?: string | null;
    date_livraison?: string | null;
    updated_at?: string | null;
    price?: number | string | null;
    raw_price?: number | string | null;
    shipping_cost?: number | string | null;
    include_delivery_in_total?: boolean | null;
    order_status_id?: string | null;
    package_status_id?: string | null;
    package_status_label?: string | null;
    package_statuses?: { label?: string | null; category?: string | null } | null;
    order_statuses?: { code?: string | null; label?: string | null; category?: string | null } | null;
    tracking_number?: string | null;
    order_items?: AnalyticsOrderItem[] | null;
    source_name?: string | null;
    seller_id?: string | null;
    courier_id?: string | null;
    company_id?: string | null;
    master_city_id?: string | null;
    city_id?: string | null;
};

// ─── Number helpers ───────────────────────────────────────────────────────

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// ─── Delivered / paid / confirmed / failed classification ─────────────────

/**
 * Delivered iff `package_status_id` resolves to a delivered-category row in
 * `package_statuses`. Mirrors the single source of truth defined by the
 * `seller_daily_earnings` view (migration
 * `seller_daily_earnings_category_only_delivered`, 2026-04-22). Label matching
 * is intentionally absent — free-text labels drift and caused commission
 * inflation via substring ILIKE.
 */
export function isDelivered(order: AnalyticsOrder, deliveredPkgIds: Set<string>): boolean {
    return !!order.package_status_id && deliveredPkgIds.has(order.package_status_id);
}

/**
 * True when order_status category is 'paid'. For single-source-of-truth,
 * callers should use `isOrderCategory(order_status_id, 'paid')` from the hook.
 * This helper only works when the join is pre-loaded on the order.
 */
export function isPaid(order: AnalyticsOrder, paidOrderIds: Set<string>): boolean {
    return !!order.order_status_id && paidOrderIds.has(order.order_status_id);
}

/**
 * CORE REVENUE RULE: order counts as revenue when BOTH delivered AND paid.
 * Product-only revenue is computed separately via `pureRevenueForOrder`.
 */
export function isRevenueOrder(
    order: AnalyticsOrder,
    deliveredPkgIds: Set<string>,
    paidOrderIds: Set<string>,
): boolean {
    return isDelivered(order, deliveredPkgIds) && isPaid(order, paidOrderIds);
}

/**
 * True when the order is considered "has a tracking code". The real source of
 * truth is `company_parcels.tracking_code` or `courier_parcels.tracking_code`
 * (exposed via `useTrackedOrders` as a Set of order ids). The legacy
 * `orders.tracking_number` column is always null in production, so we only
 * keep it as a belt-and-suspenders fallback for any future backfill.
 */
export function hasTrackingCode(
    order: AnalyticsOrder & { id?: string },
    trackedOrderIds?: Set<string>,
): boolean {
    if (trackedOrderIds && order.id && trackedOrderIds.has(order.id)) return true;
    if (order.tracking_number && order.tracking_number.trim().length > 0) return true;
    return false;
}

/**
 * Confirmed = order_status is in confirmed set OR the order has a tracking
 * code. Once a package has been handed to a courier (tracking code written
 * to company_parcels/courier_parcels), the order is confirmed by definition —
 * even if the admin hasn't flipped the order status yet.
 *
 * NOTE: this strict definition is used for commission, revenue, and any
 * financial logic that requires an order to still be in a healthy state
 * (confirmed / processed / paid / unpaid). It is NOT the right helper for
 * the confirmation-rate metric — see `isRateConfirmed` below.
 */
export function isConfirmed(
    order: AnalyticsOrder & { id?: string },
    confirmedOrderIds: Set<string>,
    trackedOrderIds?: Set<string>,
): boolean {
    if (order.order_status_id && confirmedOrderIds.has(order.order_status_id)) return true;
    if (hasTrackingCode(order, trackedOrderIds)) return true;
    return false;
}

/**
 * Confirmation-rate numerator: an order counts as confirmed if a customer
 * was spoken to and said yes at some point in its life — regardless of what
 * happened afterwards (cancel, return, fake, blacklist, etc.).
 *
 * Definition: every order EXCEPT those still sitting at `new` (never worked)
 * or in `callback` (tried to call, no answer). The tracking-code override
 * still applies — if the order was handed to a courier, it is confirmed.
 */
export function isRateConfirmed(
    order: AnalyticsOrder & { id?: string },
    newOrderIds: Set<string>,
    unreachedOrderIds: Set<string>,
    trackedOrderIds?: Set<string>,
): boolean {
    if (hasTrackingCode(order, trackedOrderIds)) return true;
    if (!order.order_status_id) return false;
    if (newOrderIds.has(order.order_status_id)) return false;
    if (unreachedOrderIds.has(order.order_status_id)) return false;
    return true;
}

// ─── Delivery-rate helpers (Coliaty formula) ────────────────────────────

/**
 * An order is "admin-pulled-back" when it was handed to a courier (has tracking)
 * AND its current state signals a seller-initiated recall or a Coliaty-side
 * refusal. Excluded from the delivery-rate denominator per Coliaty's own rule.
 *
 * Matched at two levels:
 *  - order_status.category ∈ adminPullbackOrderIds (seller-side flags: fake,
 *    double, blacklisted, cancelled)
 *  - package_status.code ∈ adminPullbackPackageIds (Coliaty-side: Hors-zone,
 *    generic Annulé with tracking)
 *
 * The tracking check is the caller's responsibility (pass `hasTracking`).
 */
export function isAdminPullback(
    order: AnalyticsOrder,
    hasTracking: boolean,
    adminPullbackOrderIds: Set<string>,
    adminPullbackPackageIds: Set<string>,
): boolean {
    if (!hasTracking) return false;
    if (order.order_status_id && adminPullbackOrderIds.has(order.order_status_id)) return true;
    if (order.package_status_id && adminPullbackPackageIds.has(order.package_status_id)) return true;
    return false;
}

/**
 * Delivery-rate denominator (Coliaty formula): orders handed to the courier
 * minus admin pullbacks. That's the universe of packages that got (or are
 * getting) a real delivery attempt.
 *
 * `trackedOrderIds` is a Set of order ids that have a tracking code in
 * company_parcels or courier_parcels. Usually provided by `useTrackedOrders`.
 */
export function isInDeliveryDenominator(
    order: AnalyticsOrder & { id?: string },
    trackedOrderIds: Set<string>,
    adminPullbackOrderIds: Set<string>,
    adminPullbackPackageIds: Set<string>,
): boolean {
    if (!order.id) return false;
    if (!trackedOrderIds.has(order.id)) return false;
    return !isAdminPullback(order, true, adminPullbackOrderIds, adminPullbackPackageIds);
}

/**
 * Confirmation-rate denominator: orders the team has actually started
 * working on. An order counts as touched if:
 *   - it has a tracking code (shipped ⇒ confirmed ⇒ touched), OR
 *   - it has no order_status_id (edge case — still counted as touched), OR
 *   - its order_status_id is NOT in the `new` bucket.
 * This guarantees `isRateConfirmed` ⇒ `isRateTouched`, so the rate is
 * always ≤ 100%.
 */
export function isRateTouched(
    order: AnalyticsOrder & { id?: string },
    newOrderIds: Set<string>,
    trackedOrderIds?: Set<string>,
): boolean {
    if (hasTrackingCode(order, trackedOrderIds)) return true;
    if (!order.order_status_id) return true;
    return !newOrderIds.has(order.order_status_id);
}

/** Failed = cancelled / fake / double / blacklisted — merged to a single bucket. */
export function isFailed(order: AnalyticsOrder, cancelledOrderIds: Set<string>): boolean {
    return !!order.order_status_id && cancelledOrderIds.has(order.order_status_id);
}

/** Shipped = order has a non-empty tracking_number. Return rate denominator. */
export function isShipped(order: AnalyticsOrder): boolean {
    return !!order.tracking_number && order.tracking_number.trim().length > 0;
}

/** Returned = package_status is in returned set (returned/returning/refused). */
export function isReturned(order: AnalyticsOrder, returnedPkgIds: Set<string>): boolean {
    return !!order.package_status_id && returnedPkgIds.has(order.package_status_id);
}

/** Provisional = delivered AND unpaid order category (COD still out for collection). */
export function isProvisional(
    order: AnalyticsOrder,
    deliveredPkgIds: Set<string>,
    unpaidOrderIds: Set<string>,
): boolean {
    if (!isDelivered(order, deliveredPkgIds)) return false;
    return !!order.order_status_id && unpaidOrderIds.has(order.order_status_id);
}

// ─── Revenue computation ──────────────────────────────────────────────────

/**
 * PURE REVENUE — product-line subtotal only. Shipping fee NEVER counted as
 * revenue, regardless of `include_delivery_in_total`. Accessories never
 * contribute to revenue (they're cost-only attachments).
 *
 * Preference order per line:
 *   1. `total_price` (snapshot at order time)
 *   2. `unit_price × quantity`
 *
 * Fallback when line items are missing:
 *   - `raw_price` (product-only pre-shipping)
 *   - `price − shipping_cost` (strip shipping from total)
 *   - 0
 */
export function pureRevenueForOrder(order: AnalyticsOrder): number {
    const items = order.order_items || [];
    let sum = 0;
    for (const item of items) {
        if (!item?.product_id) continue;
        const q = num(item.quantity);
        if (q <= 0) continue;
        const lineTotal = num(item.total_price);
        sum += lineTotal > 0 ? lineTotal : num(item.unit_price) * q;
    }
    if (sum > 0) return sum;
    const raw = num(order.raw_price);
    if (raw > 0) return raw;
    const p = num(order.price);
    const ship = num(order.shipping_cost);
    if (order.include_delivery_in_total === false) return p;
    return Math.max(0, p - ship);
}

/**
 * DELIVERED REVENUE — broader than pure revenue. Used only for ROAS
 * (ad return on investment). Includes the delivered-but-unpaid COD orders.
 * Product-only (no shipping).
 */
export function deliveredRevenueForOrder(order: AnalyticsOrder): number {
    return pureRevenueForOrder(order);
}

// ─── Cost computation (COGS + shipping + return fees) ─────────────────────

/**
 * COGS per order — product cost (snapshot preferred) + accessory cost
 * (snapshot preferred). Returned orders contribute zero COGS (stock restored
 * server-side); callers should skip this function for returned orders.
 *
 * Cost preference order:
 *   - Product: order_items.product_unit_cost_snapshot → products.cost_price map
 *   - Accessory: order_items.accessory_unit_price (snapshot) → accessories.cost_price map
 */
export function cogsForOrder(
    order: AnalyticsOrder,
    productCostMap: Map<string, number>,
    accessoryCostMap: Map<string, number>,
): number {
    const items = order.order_items || [];
    let cogs = 0;
    for (const item of items) {
        if (item.product_id) {
            const q = num(item.quantity);
            if (q > 0) {
                const snap = num(item.product_unit_cost_snapshot);
                const unit = snap > 0 ? snap : (productCostMap.get(item.product_id) || 0);
                cogs += unit * q;
            }
        }
        if (item.accessory_id) {
            const aq = num(item.accessory_quantity);
            if (aq > 0) {
                const snap = num(item.accessory_unit_price);
                const unit = snap > 0 ? snap : (accessoryCostMap.get(item.accessory_id) || 0);
                cogs += unit * aq;
            }
        }
    }
    return cogs;
}

/** Shipping cost for a delivered order. Returns 0 for non-delivered rows. */
export function shippingCostForDelivered(order: AnalyticsOrder): number {
    return num(order.shipping_cost);
}

/**
 * Return fee resolver — resolves courier_fees.return_fee or
 * company_fees.return_fee by the order's city.
 *
 * Lookup key is `${courierOrCompanyId}|${cityId}` — caller builds the map
 * from the appropriate fees table. Returns 0 if no entry.
 */
export function returnFeeForOrder(
    order: AnalyticsOrder,
    returnFeeByCourierCity: Map<string, number>,
    returnFeeByCompanyCity: Map<string, number>,
): number {
    const cityId = order.master_city_id || order.city_id;
    if (!cityId) return 0;
    if (order.courier_id) {
        const k = `${order.courier_id}|${cityId}`;
        return returnFeeByCourierCity.get(k) || 0;
    }
    if (order.company_id) {
        const k = `${order.company_id}|${cityId}`;
        return returnFeeByCompanyCity.get(k) || 0;
    }
    return 0;
}

// ─── Date anchors ─────────────────────────────────────────────────────────

/**
 * Delivery timestamp for period bucketing. Prefers `date_livraison` (set by
 * the trigger `trg_set_order_date_livraison`), falls back to `updated_at`.
 * Mirrors the server-side seller_daily_earnings rule.
 */
export function deliveryTimestamp(order: AnalyticsOrder): Date | null {
    const raw = order.date_livraison || order.updated_at;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Placement timestamp (order creation). Used for cohort + volume metrics. */
export function placementTimestamp(order: AnalyticsOrder): Date | null {
    if (!order.date) return null;
    const d = new Date(order.date);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Return-event timestamp — when the order's package was flipped to a returned
 * category. No dedicated `returned_at` column exists; `updated_at` is the
 * best available proxy (it bumps on any status change, and "returned" is a
 * terminal state). Used to bucket return fees into the accounting period the
 * loss actually occurred in.
 */
export function returnTimestamp(order: AnalyticsOrder): Date | null {
    if (!order.updated_at) return null;
    const d = new Date(order.updated_at);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive interval check. Returns false for null/invalid dates. */
export function inWindow(
    ts: Date | null | undefined,
    windowStart: Date,
    windowEnd: Date,
): boolean {
    if (!ts || Number.isNaN(ts.getTime())) return false;
    return isWithinInterval(ts, { start: windowStart, end: windowEnd });
}

// ─── Ads overlap math ─────────────────────────────────────────────────────

/**
 * Inclusive-day overlap fraction between [a1, a2] and [windowStart, windowEnd].
 * Returns a value in [0, 1]; 0 when the ranges don't overlap.
 */
export function overlapFraction(
    a1: Date | null | undefined,
    a2: Date | null | undefined,
    windowStart: Date,
    windowEnd: Date,
): number {
    if (!a1 || !a2 || Number.isNaN(a1.getTime()) || Number.isNaN(a2.getTime())) return 0;
    const s = a1 <= a2 ? a1 : a2;
    const e = a1 <= a2 ? a2 : a1;
    const ovStart = maxDate([s, windowStart]);
    const ovEnd = minDate([e, windowEnd]);
    if (ovEnd < ovStart) return 0;
    const totalDays = differenceInCalendarDays(e, s) + 1;
    const ovDays = differenceInCalendarDays(ovEnd, ovStart) + 1;
    return totalDays > 0 ? ovDays / totalDays : 0;
}

/**
 * Pro-rated ad spend attributable to the window. Use for `ads_history`
 * (has start_date + end_date). Daily tables like `campaign_daily_entries`
 * should filter by entry_date instead — no overlap math needed.
 */
export function adSpendInWindow(
    ad: { amount?: number | string | null; start_date?: string | null; end_date?: string | null },
    windowStart: Date,
    windowEnd: Date,
): number {
    const s = ad.start_date ? new Date(ad.start_date) : null;
    const e = ad.end_date ? new Date(ad.end_date) : s;
    const frac = overlapFraction(s, e, windowStart, windowEnd);
    return frac > 0 ? num(ad.amount) * frac : 0;
}

/**
 * Payout month overlap for pro-rating monthly payouts/expenses that lie
 * partially inside the window. `payoutMonth` can be 'YYYY-MM-DD' or 'YYYY-MM'.
 */
export function payoutMonthOverlap(
    payoutMonth: string | null | undefined,
    windowStart: Date,
    windowEnd: Date,
): number {
    if (!payoutMonth) return 0;
    const head = payoutMonth.length >= 7 ? payoutMonth.slice(0, 7) : payoutMonth;
    if (!/^\d{4}-\d{2}$/.test(head)) return 0;
    const [y, m] = head.split('-').map(Number);
    const s = startOfMonth(new Date(y, m - 1, 1));
    const e = endOfMonth(s);
    return overlapFraction(s, e, windowStart, windowEnd);
}

// ─── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize `orders.source_name` / `ads_history.method` / campaign.platform
 * to canonical PLATFORM_SOURCE_MAP key. "Facebook ads" / "facebook" / "FB"
 * all collapse to 'facebook'.
 *
 * Returns empty string for unknown sources — callers should bucket those
 * as 'Direct' / 'Unknown' when displaying.
 */
export function normalizeSource(source: string | null | undefined): string {
    if (!source) return '';
    const lower = source.trim().toLowerCase();
    if (PLATFORM_SOURCE_MAP[lower]) return PLATFORM_SOURCE_MAP[lower];
    // Already a canonical key (e.g. 'facebook' vs 'facebook ads').
    if (Object.values(PLATFORM_SOURCE_MAP).includes(lower)) return lower;
    return lower;
}

/**
 * Normalize a customer phone for stable grouping. Strips every non-digit;
 * treats 0-prefixed Morocco numbers as equivalent to their +212 form.
 */
export function normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    // Morocco local format: leading 0 + 9 digits → strip the 0 to match 212XXXXXXXXX.
    if (digits.length === 10 && digits.startsWith('0')) return '212' + digits.slice(1);
    // International format already starts with country code.
    return digits;
}

// ─── Chart granularity ────────────────────────────────────────────────────

export type ChartGrain = 'daily' | 'weekly' | 'monthly';

/**
 * Auto-select chart bucket size based on window length.
 * < 60 days → daily; 60–180 → weekly; > 180 → monthly.
 */
export function pickChartGrain(windowStart: Date, windowEnd: Date): ChartGrain {
    const days = differenceInCalendarDays(windowEnd, windowStart) + 1;
    if (days < 60) return 'daily';
    if (days <= 180) return 'weekly';
    return 'monthly';
}

// ─── Re-exports (so callers only need this file) ──────────────────────────

export {
    CONFIRMED_ORDER_CATS,
    CANCELLED_ORDER_CATS,
    DELIVERED_PKG_CATS,
    RETURNED_PKG_CATS,
    SHIPPED_PKG_CATS,
    PLATFORM_SOURCE_MAP,
};
