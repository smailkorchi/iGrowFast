import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource, type Campaign, type CampaignDailyEntry } from '@/lib/campaignConstants';
import { toBusinessDate, shiftYmd } from '@/lib/dateBuckets';

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
    revenue: number; // mediabuyer commission earnings
    profit: number; // revenue - spend
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
    revenue: number;
    profit: number;
    roas: number | null; // revenue / spend (for mediabuyer)
    days: number; // number of days with any data
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
};

/**
 * Centralized metric engine for a single campaign.
 *
 * Live-computes confirmed/delivered/revenue/CPA/rates from:
 *   - campaign_daily_entries (manual: spend + leads)
 *   - orders joined via source_name = PLATFORM_SOURCE_MAP[campaign.platform] + date range.
 *
 * The daily row for a date without any entry is skipped entirely (matches sheet behavior:
 * cells with no data don't show fake #DIV/0 values).
 */
export function useCampaignMetrics(campaign: Campaign | null | undefined) {
    const { deliveredPkgIds } = useStatusCategories();
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

    // Orders scoped to business + source + date range.
    // orders.date is a timestamptz column and entry_date is a local (business-TZ) day.
    // We widen the server-side window by 1 day on each end so orders whose UTC day
    // differs from their business-TZ day (the 00:00–00:59 local hour in Africa/Casablanca
    // lands the previous UTC day, and 23:00–23:59 local lands the next UTC day) are
    // fetched. The client-side bucketing below re-attributes them by business-TZ date.
    const source = campaign ? getPlatformSource(campaign.platform) : '';
    const { data: orders = [], isLoading: loadingOrders } = useQuery<OrderRow[]>({
        queryKey: ['campaign-orders', campaign?.id, activeBusinessId, source, dateRange.from, dateRange.to],
        queryFn: async () => {
            if (!activeBusinessId || !source || !dateRange.from || !dateRange.to) return [];
            // source_name can have arbitrary casing in the DB — use ilike to be safe.
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, date, source_name, order_status_id, package_status_id')
                .eq('DigiCom Business', activeBusinessId)
                .ilike('source_name', source)
                .gte('date', shiftYmd(dateRange.from, -1))
                .lte('date', `${shiftYmd(dateRange.to, 1)}T23:59:59.999Z`)
                .is('date_deleted', null);
            if (error) throw error;
            return (data || []) as OrderRow[];
        },
        enabled: !!activeBusinessId && !!source && !!dateRange.from && !!dateRange.to,
    });

    // Build per-day metrics
    const { daily, totals } = useMemo(() => {
        const commissionPrice =
            mediabuyer?.payment_type === 'commission' ? Number(mediabuyer.commission_price || 0) : 0;

        // Index orders by YYYY-MM-DD in business timezone.
        // "Confirmed" = every order placed on the day, regardless of current status. Orders
        // reaching this loop have already passed the source_name + business + date-range
        // filter upstream, so presence here means the lead converted into an order.
        // "Delivered" = package status is in the 'delivered' category. No order-status
        // filter: a package marked delivered counts as a delivery regardless of whether
        // the cash has been collected (PAID/UNPAID) yet.
        const ordersByDate = new Map<string, { confirmed: number; delivered: number }>();
        for (const o of orders) {
            if (!o.date) continue;
            const d = toBusinessDate(o.date);
            const bucket = ordersByDate.get(d) || { confirmed: 0, delivered: 0 };
            bucket.confirmed += 1;
            if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) {
                bucket.delivered += 1;
            }
            ordersByDate.set(d, bucket);
        }

        const dailyRows: DailyMetrics[] = entries.map((e) => {
            const bucket = ordersByDate.get(e.entry_date) || { confirmed: 0, delivered: 0 };
            const spend = Number(e.spend || 0);
            const leads = Number(e.leads || 0);
            const confirmed = bucket.confirmed;
            const delivered = bucket.delivered;
            const revenue = delivered * commissionPrice;
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
            };
        });

        const t: CampaignTotals = dailyRows.reduce(
            (acc, r) => {
                acc.spend += r.spend;
                acc.leads += r.leads;
                acc.confirmed += r.confirmed;
                acc.delivered += r.delivered;
                acc.revenue += r.revenue;
                return acc;
            },
            {
                spend: 0,
                leads: 0,
                confirmed: 0,
                delivered: 0,
                revenue: 0,
                profit: 0,
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
        t.roas = t.spend > 0 ? t.revenue / t.spend : null;
        t.profit = t.revenue - t.spend;
        t.days = dailyRows.length;

        return { daily: dailyRows, totals: t };
    }, [entries, orders, deliveredPkgIds, mediabuyer]);

    return {
        entries,
        daily,
        totals,
        mediabuyer,
        isLoading: loadingEntries || loadingOrders,
    };
}
