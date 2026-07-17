import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { type Campaign } from '@/lib/campaignConstants';

export type StatsDateRange = {
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
};

export type Totals = {
    spend: number;
    leads: number;
    confirmed: number;
    delivered: number;
    revenue: number;
    profit: number;
    costPerLead: number | null;
    costPerConfirmed: number | null;
    costPerDelivered: number | null;
    confirmRate: number | null;
    deliveryRate: number | null;
    roas: number | null;
};

export type DailyPoint = Totals & { date: string };
export type PlatformPoint = Totals & { platform: string };
export type CampaignPoint = Totals & {
    id: string;
    name: string;
    platform: string;
    status: 'active' | 'draft' | 'deleted';
    currency: string;
};

/** Current-Casablanca-month earnings block computed server-side (mb_dashboard_stats). */
export type MbMonthEarnings = {
    month: string;
    delivered_orders: number;
    total_spend: number;
    campaigns_count: number;
    salary_earned: number;
    commission_earned: number;
    total_amount: number;
    prior_paid_amount: number;
    remaining_amount: number;
};

/** Raw jsonb payload of public.mb_dashboard_stats (mig 20260714230000). Counts only —
 *  revenue / ROAS / profit are deliberately NOT in the payload (MB-facing data rule);
 *  they are derived below from the MB's own commission_price. */
type MbDashboardStatsPayload = {
    totals: { spend: number; leads: number; confirmed: number; delivered: number };
    daily: Array<{ date: string; spend: number; leads: number; confirmed: number; delivered: number }>;
    per_platform: Array<{ platform: string; spend: number; leads: number; confirmed: number; delivered: number }>;
    per_campaign: Array<{
        key: string;
        campaign_id: string | null;
        name: string;
        platform: string;
        status: string;
        currency: string;
        spend: number;
        leads: number;
        confirmed: number;
        delivered: number;
    }>;
    today_entry_campaign_ids: string[];
    month_earnings: MbMonthEarnings;
};

const emptyTotals = (): Totals => ({
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
});

const finalize = (t: Totals): Totals => {
    t.costPerLead = t.leads > 0 ? t.spend / t.leads : null;
    t.costPerConfirmed = t.confirmed > 0 ? t.spend / t.confirmed : null;
    t.costPerDelivered = t.delivered > 0 ? t.spend / t.delivered : null;
    t.confirmRate = t.leads > 0 ? t.confirmed / t.leads : null;
    t.deliveryRate = t.confirmed > 0 ? t.delivered / t.confirmed : null;
    t.roas = t.spend > 0 ? t.revenue / t.spend : null;
    t.profit = t.revenue - t.spend;
    return t;
};

/**
 * Aggregated performance of the current media buyer across ALL their campaigns in [from, to].
 *
 * D2: the entries + business-orders downloads (and their client-side (day, source)
 * bucketing) are replaced by ONE `mb_dashboard_stats` RPC call that returns raw
 * spend/leads/confirmed/delivered per day / platform / campaign, plus the
 * today-entry campaign ids and the current-month earnings block. Attribution is
 * unchanged server-side: entries by `created_by`, orders bucketed per
 * (Casablanca day, lower(source_name)), daily/platform totals dedupe each bucket
 * once while per-campaign rows re-count it per campaign (Preview-page behavior).
 *
 * Revenue = delivered × users.commission_price for payment_type='commission'.
 * Salary users get 0 revenue in this view — salary is paid via mediabuyer_payments
 * on a monthly cadence. Revenue / ROAS / profit / CPx stay CLIENT-side derivations
 * from the MB's own commission_price: the RPC payload carries no money columns.
 */
export function useMediaBuyerStats(range: StatsDateRange) {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();

    // 1. Server-side stats — replaces the entries fetch, the business-orders
    //    download and the status-flag lookups in one windowed aggregate.
    const { data: stats, isLoading: loadingStats } = useQuery<MbDashboardStatsPayload | null>({
        queryKey: ['dash-stats', 'mediabuyer', activeBusinessId, currentUserId, range.from, range.to],
        queryFn: async () => {
            if (!activeBusinessId || !currentUserId) return null;
            const { data, error } = await (supabase as any).rpc('mb_dashboard_stats', {
                p_business: activeBusinessId,
                p_mb: currentUserId,
                p_from: range.from,
                p_to: range.to,
            });
            if (error) throw error;
            return (data || null) as MbDashboardStatsPayload | null;
        },
        staleTime: 60_000,
        enabled: !!activeBusinessId && !!currentUserId,
    });

    // 2. Live campaign rows (for the needs-attention list, active counts and the
    //    dominant currency). Orphaned entries remain valid even when the campaign
    //    row is gone — the RPC handles those as synthetic "(Deleted)" rows.
    const { data: campaigns = [], isLoading: loadingCampaigns } = useQuery<Campaign[]>({
        queryKey: ['mb-stats-campaigns', activeBusinessId, currentUserId],
        queryFn: async () => {
            if (!activeBusinessId || !currentUserId) return [];
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', currentUserId);
            if (error) throw error;
            return (data || []) as Campaign[];
        },
        enabled: !!activeBusinessId && !!currentUserId,
        staleTime: 60_000, // matches the stats RPC — kills the every-focus re-download
    });

    // 3. Mediabuyer commission price (for revenue calc).
    const { data: mediabuyer } = useQuery({
        queryKey: ['mb-stats-profile', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, payment_type, commission_price, salary_amount')
                .eq('id', currentUserId)
                .single();
            return data as {
                id: string;
                payment_type: 'commission' | 'salary' | null;
                commission_price: number | null;
                salary_amount: number | null;
            } | null;
        },
        enabled: !!currentUserId,
        staleTime: 5 * 60 * 1000, // own commission config — near-static
    });

    // 4. Derive the money/ratio fields from the raw server counts.
    const { totals, daily, perPlatform, perCampaign, currency } = useMemo(() => {
        // O-2: salary => 0, EVERYTHING ELSE => commission. This is the DB's rule,
        // not a choice made here: pay_mediabuyer and close_mediabuyer_month both
        // write `coalesce(v_pt,'commission')` and branch on
        // `case when v_pt='salary' then 0 else v_earned end`, so a NULL
        // payment_type IS commission to the authority that moves the money. The
        // old `=== 'commission' ? price : 0` silently paid a NULL buyer 0 here
        // while the ledger accrued them a full commission. users_payment_type_check
        // allows exactly {NULL, 'commission', 'salary'}, so NULL is the only
        // divergent case — no live row has it today.
        const commissionPrice =
            mediabuyer?.payment_type === 'salary' ? 0 : Number(mediabuyer?.commission_price || 0);

        const dailyRows: DailyPoint[] = (stats?.daily ?? []).map((d) => {
            const delivered = Number(d.delivered || 0);
            const point: DailyPoint = {
                ...emptyTotals(),
                date: d.date,
                spend: Number(d.spend || 0),
                leads: Number(d.leads || 0),
                confirmed: Number(d.confirmed || 0),
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            return point;
        });

        const perPlatformArr: PlatformPoint[] = (stats?.per_platform ?? []).map((p) => {
            const delivered = Number(p.delivered || 0);
            const point: PlatformPoint = {
                ...emptyTotals(),
                platform: p.platform,
                spend: Number(p.spend || 0),
                leads: Number(p.leads || 0),
                confirmed: Number(p.confirmed || 0),
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            return point;
        });
        perPlatformArr.sort((a, b) => b.spend - a.spend);

        const perCampaignArr: CampaignPoint[] = (stats?.per_campaign ?? []).map((c) => {
            const delivered = Number(c.delivered || 0);
            const point: CampaignPoint = {
                ...emptyTotals(),
                id: c.key,
                name: c.name,
                platform: c.platform,
                status: c.status as CampaignPoint['status'],
                currency: c.currency || 'MAD',
                spend: Number(c.spend || 0),
                leads: Number(c.leads || 0),
                confirmed: Number(c.confirmed || 0),
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            return point;
        });
        perCampaignArr.sort((a, b) => b.profit - a.profit);

        // --- Grand totals (server sums over the deduped daily buckets) ---
        const grand = emptyTotals();
        grand.spend = Number(stats?.totals?.spend || 0);
        grand.leads = Number(stats?.totals?.leads || 0);
        grand.confirmed = Number(stats?.totals?.confirmed || 0);
        grand.delivered = Number(stats?.totals?.delivered || 0);
        grand.revenue = grand.delivered * commissionPrice;
        finalize(grand);

        // Dominant currency from live campaigns (fall back to MAD).
        const curCount: Record<string, number> = {};
        for (const c of campaigns) curCount[c.currency || 'MAD'] = (curCount[c.currency || 'MAD'] || 0) + 1;
        const dominantCurrency =
            Object.entries(curCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MAD';

        return {
            totals: grand,
            daily: dailyRows,
            perPlatform: perPlatformArr,
            perCampaign: perCampaignArr,
            currency: dominantCurrency,
        };
    }, [stats, campaigns, mediabuyer]);

    const todayEntryCampaignIds = useMemo(
        () => new Set<string>(stats?.today_entry_campaign_ids ?? []),
        [stats]
    );

    return {
        campaigns,
        totals,
        daily,
        perPlatform,
        perCampaign,
        currency,
        mediabuyer,
        todayEntryCampaignIds,
        monthEarnings: stats?.month_earnings ?? null,
        isLoading: loadingCampaigns || loadingStats,
    };
}
