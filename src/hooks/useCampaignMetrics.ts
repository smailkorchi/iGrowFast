import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useCampaignBasePath } from '@/hooks/useCampaignBasePath';
import { getPlatformSource, type Campaign, type CampaignDailyEntry } from '@/lib/campaignConstants';
import { toBusinessDate, shiftYmd } from '@/lib/dateBuckets';
import { pureRevenueForOrder, type AnalyticsOrderItem } from '@/lib/analyticsDefinitions';

/**
 * Revenue semantics on the campaign report.
 *
 * Two roles consume this page (admin under `/campaigns`, media buyer under
 * `/mediabuyer/campaigns`). Each reads "Revenue" with a different meaning:
 *
 *   - admin: gross revenue the ads brought to the business — product-only,
 *     shipping stripped, paid OR unpaid (matches the dashboard's "Revenue"
 *     for delivered orders, i.e. `pureRevenueForOrder` from
 *     analyticsDefinitions.ts which is the single source of truth).
 *   - commission (media buyer): `delivered × commission_price` — what the
 *     buyer personally earns. Salary buyers get 0 here; their pay is on a
 *     monthly cadence via `mediabuyer_payments`.
 *
 * The hook computes BOTH on every call and chooses which one to expose as
 * `revenue` / `profit` / `roas` based on the URL prefix (admin or mediabuyer).
 * Callers don't pass a role — that would invite per-page drift.
 */
export type RevenueBasis = 'admin' | 'commission';

export type DailyMetrics = {
    date: string; // YYYY-MM-DD
    spend: number;
    leads: number;
    confirmed: number;
    delivered: number;
    costPerLead: number | null;
    costPerConfirmed: number | null;
    costPerDelivered: number | null;
    confirmRate: number | null; // 0..1
    deliveryRate: number | null; // 0..1
    /** Revenue shown to the current viewer (admin gross or MB commission). */
    revenue: number;
    /** Profit = revenue − spend, viewer-scoped. */
    profit: number;
    /** Always-available components so a future UI can show the other side. */
    adminGrossRevenue: number;
    mbCommissionRevenue: number;
};

export type CampaignTotals = {
    spend: number;
    leads: number;
    confirmed: number;
    delivered: number;
    costPerLead: number | null;
    costPerConfirmed: number | null;
    costPerDelivered: number | null;
    confirmRate: number | null;
    deliveryRate: number | null;
    /** Revenue shown to the current viewer (admin gross or MB commission). */
    revenue: number;
    /** Profit = revenue − spend, viewer-scoped. */
    profit: number;
    /** Always-available components. */
    adminGrossRevenue: number;
    mbCommissionRevenue: number;
    /** revenue / spend, viewer-scoped. */
    roas: number | null;
    /** Number of daily rows with any entry. */
    days: number;
};

export type MediaBuyerProfile = {
    id: string;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
};

type OrderRow = {
    id: string;
    date: string;
    source_name: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
    /** Fields below feed `pureRevenueForOrder` for the admin revenue path. */
    price: number | string | null;
    raw_price: number | string | null;
    shipping_cost: number | string | null;
    include_delivery_in_total: boolean | null;
    order_items: AnalyticsOrderItem[] | null;
};

/**
 * Centralized metric engine for a single campaign — used by both the admin
 * and the media buyer preview pages.
 */
export function useCampaignMetrics(campaign: Campaign | null | undefined) {
    const { deliveredPkgIds, pendingIds } = useStatusCategories();
    const basePath = useCampaignBasePath();
    const revenueBasis: RevenueBasis = basePath.startsWith('/mediabuyer') ? 'commission' : 'admin';
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // Daily entries (manual spend + leads)
    const { data: entries = [], isLoading: loadingEntries } = useQuery<CampaignDailyEntry[]>({
        queryKey: ['campaign-daily-entries', campaign?.id],
        queryFn: async () => {
            if (!campaign?.id) return [];
            const { data, error } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('*')
                .eq('campaign_id', campaign.id)
                .order('entry_date', { ascending: true });
            if (error) throw error;
            return (data || []) as CampaignDailyEntry[];
        },
        enabled: !!campaign?.id,
    });

    // Mediabuyer profile (for commission lookup)
    const { data: mediabuyer } = useQuery<MediaBuyerProfile | null>({
        queryKey: ['campaign-mediabuyer', campaign?.created_by],
        queryFn: async () => {
            if (!campaign?.created_by) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, payment_type, commission_price, salary_amount')
                .eq('id', campaign.created_by)
                .single();
            return (data || null) as MediaBuyerProfile | null;
        },
        enabled: !!campaign?.created_by,
    });

    // Compute date range for order fetch from entries. Fall back to campaign dates when no entries.
    const dateRange = useMemo(() => {
        if (entries.length > 0) {
            const dates = entries.map((e) => e.entry_date).sort();
            return { from: dates[0], to: dates[dates.length - 1] };
        }
        if (campaign?.start_date || campaign?.end_date) {
            return { from: campaign.start_date || null, to: campaign.end_date || null };
        }
        return { from: null, to: null };
    }, [entries, campaign]);

    // Orders scoped to business + source + date range. We now pull the
    // revenue-bearing columns (price, raw_price, shipping_cost,
    // include_delivery_in_total) + per-line item totals so the admin's gross
    // revenue can be derived via the same formula the dashboard uses
    // (`pureRevenueForOrder` — product-only, shipping stripped).
    const source = campaign ? getPlatformSource(campaign.platform) : '';
    const { data: orders = [], isLoading: loadingOrders } = useQuery<OrderRow[]>({
        queryKey: ['campaign-orders', campaign?.id, activeBusinessId, source, dateRange.from, dateRange.to],
        queryFn: async () => {
            if (!activeBusinessId || !source || !dateRange.from || !dateRange.to) return [];
            // orders.date is timestamptz; entry_date is local. Widen by 1 day each side and
            // re-bucket client-side to business TZ.
            // Paginated so we never truncate at the 1000-row default cap.
            return await fetchAllRows<OrderRow>(
                'orders',
                'id, date, source_name, order_status_id, package_status_id, price, raw_price, shipping_cost, include_delivery_in_total, order_items(product_id, quantity, unit_price, total_price)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'source_name', op: 'ilike', value: source },
                        { column: 'date', op: 'gte', value: shiftYmd(dateRange.from, -1) },
                        { column: 'date', op: 'lte', value: `${shiftYmd(dateRange.to, 1)}T23:59:59.999Z` },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
        },
        enabled: !!activeBusinessId && !!source && !!dateRange.from && !!dateRange.to,
    });

    // Build per-day metrics
    const { daily, totals } = useMemo(() => {
        const commissionPrice =
            mediabuyer?.payment_type === 'commission' ? Number(mediabuyer.commission_price || 0) : 0;

        // Index orders by YYYY-MM-DD in business timezone.
        // "Confirmed" = order_status NOT in pendingIds (new + postponed). Empty-set guard:
        // skip until pendingIds is populated, otherwise every order slips through.
        // "Delivered" = package_status.is_delivered flag (resolved via package_status_id).
        // For each delivered order we also accumulate the admin gross revenue
        // (product-only, shipping stripped) via the canonical helper.
        const statusMapsReady = pendingIds.size > 0;
        const ordersByDate = new Map<
            string,
            { confirmed: number; delivered: number; adminGrossRevenue: number }
        >();
        for (const o of orders) {
            if (!o.date) continue;
            const d = toBusinessDate(o.date);
            const bucket = ordersByDate.get(d) || { confirmed: 0, delivered: 0, adminGrossRevenue: 0 };
            const isConfirmed = statusMapsReady
                && !!o.order_status_id
                && !pendingIds.has(o.order_status_id);
            if (isConfirmed) bucket.confirmed += 1;
            const isDelivered = !!o.package_status_id && deliveredPkgIds.has(o.package_status_id);
            if (isDelivered) {
                bucket.delivered += 1;
                bucket.adminGrossRevenue += pureRevenueForOrder(o as any);
            }
            ordersByDate.set(d, bucket);
        }

        const dailyRows: DailyMetrics[] = entries.map((e) => {
            const bucket = ordersByDate.get(e.entry_date) || {
                confirmed: 0,
                delivered: 0,
                adminGrossRevenue: 0,
            };
            const spend = Number(e.spend || 0);
            const leads = Number(e.leads || 0);
            const confirmed = bucket.confirmed;
            const delivered = bucket.delivered;
            const adminGrossRevenue = bucket.adminGrossRevenue;
            const mbCommissionRevenue = delivered * commissionPrice;
            const revenue = revenueBasis === 'admin' ? adminGrossRevenue : mbCommissionRevenue;
            return {
                date: e.entry_date,
                spend,
                leads,
                confirmed,
                delivered,
                costPerLead: leads > 0 ? spend / leads : null,
                costPerConfirmed: confirmed > 0 ? spend / confirmed : null,
                costPerDelivered: delivered > 0 ? spend / delivered : null,
                confirmRate: leads > 0 ? confirmed / leads : null,
                deliveryRate: confirmed > 0 ? delivered / confirmed : null,
                revenue,
                profit: revenue - spend,
                adminGrossRevenue,
                mbCommissionRevenue,
            };
        });

        const t: CampaignTotals = dailyRows.reduce(
            (acc, r) => {
                acc.spend += r.spend;
                acc.leads += r.leads;
                acc.confirmed += r.confirmed;
                acc.delivered += r.delivered;
                acc.adminGrossRevenue += r.adminGrossRevenue;
                acc.mbCommissionRevenue += r.mbCommissionRevenue;
                return acc;
            },
            {
                spend: 0,
                leads: 0,
                confirmed: 0,
                delivered: 0,
                revenue: 0,
                profit: 0,
                adminGrossRevenue: 0,
                mbCommissionRevenue: 0,
                costPerLead: null,
                costPerConfirmed: null,
                costPerDelivered: null,
                confirmRate: null,
                deliveryRate: null,
                roas: null,
                days: 0,
            } as CampaignTotals
        );
        t.costPerLead = t.leads > 0 ? t.spend / t.leads : null;
        t.costPerConfirmed = t.confirmed > 0 ? t.spend / t.confirmed : null;
        t.costPerDelivered = t.delivered > 0 ? t.spend / t.delivered : null;
        t.confirmRate = t.leads > 0 ? t.confirmed / t.leads : null;
        t.deliveryRate = t.confirmed > 0 ? t.delivered / t.confirmed : null;
        t.revenue = revenueBasis === 'admin' ? t.adminGrossRevenue : t.mbCommissionRevenue;
        t.profit = t.revenue - t.spend;
        t.roas = t.spend > 0 ? t.revenue / t.spend : null;
        t.days = dailyRows.length;

        return { daily: dailyRows, totals: t };
    }, [entries, orders, deliveredPkgIds, pendingIds, mediabuyer, revenueBasis]);

    return {
        entries,
        daily,
        totals,
        mediabuyer,
        revenueBasis,
        isLoading: loadingEntries || loadingOrders,
    };
}
