import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource, type Campaign, type CampaignDailyEntry } from '@/lib/campaignConstants';

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
    const { confirmedIds, deliveredPkgIds, returnedPkgIds } = useStatusCategories();
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
    // orders.date is a timestamptz column — a bare YYYY-MM-DD string compares as midnight,
    // so .lte('date', '2026-03-31') would exclude every order after 00:00 on that day.
    // We append T23:59:59.999Z to the upper bound to capture the full day.
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
                .gte('date', dateRange.from)
                .lte('date', `${dateRange.to}T23:59:59.999Z`);
            if (error) throw error;
            return (data || []) as OrderRow[];
        },
        enabled: !!activeBusinessId && !!source && !!dateRange.from && !!dateRange.to,
    });

    // Build per-day metrics
    const { daily, totals } = useMemo(() => {
        const commissionPrice =
            mediabuyer?.payment_type === 'commission' ? Number(mediabuyer.commission_price || 0) : 0;

        // Index orders by YYYY-MM-DD.
        // "Confirmed" in the funnel sense: an order that progressed past initial confirmation,
        // regardless of whether it was later returned. This matches the tracking sheet where a
        // returned order still counts as "confirmed" (the return happened post-delivery).
        // Concretely: current status in confirmedIds, OR package was delivered, OR package was returned.
        const ordersByDate = new Map<string, { confirmed: number; delivered: number }>();
        for (const o of orders) {
            if (!o.date) continue;
            const d = o.date.slice(0, 10); // YYYY-MM-DD
            const bucket = ordersByDate.get(d) || { confirmed: 0, delivered: 0 };
            const isDelivered = !!(o.package_status_id && deliveredPkgIds.has(o.package_status_id));
            const isReturned = !!(o.package_status_id && returnedPkgIds.has(o.package_status_id));
            const isConfirmed = !!(o.order_status_id && confirmedIds.has(o.order_status_id))
                || isDelivered
                || isReturned;
            if (isConfirmed) bucket.confirmed += 1;
            if (isDelivered) bucket.delivered += 1;
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
    }, [entries, orders, confirmedIds, deliveredPkgIds, returnedPkgIds, mediabuyer]);

    return {
        entries,
        daily,
        totals,
        mediabuyer,
        isLoading: loadingEntries || loadingOrders,
    };
}
