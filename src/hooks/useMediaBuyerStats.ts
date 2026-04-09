import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { getPlatformSource, type Campaign, type CampaignDailyEntry } from '@/lib/campaignConstants';

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

type OrderRow = {
    id: string;
    date: string;
    source_name: string | null;
    order_status_id: string | null;
    package_status_id: string | null;
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
 * Attribution rules:
 *  - Entries are queried directly by `campaign_daily_entries.created_by = currentUserId` and
 *    `entry_date` in [from, to]. This survives campaign deletion: orphaned entries (campaign_id
 *    is null) still contribute because `platform` and `created_by` are denormalized on the entry.
 *  - Orders are fetched once for the date range + business and filtered client-side by the
 *    distinct platform sources present in entries (case-insensitive, to absorb inconsistent
 *    source_name casing in the orders table).
 *  - Orders are bucketed per (date, source) and counted ONCE per bucket. Two campaigns on the
 *    same platform+day do not double-count for daily/platform/overall totals. Per-campaign rows
 *    re-count the same (date, source) bucket per campaign (same behavior as Preview page).
 *  - Revenue = delivered × users.commission_price for payment_type='commission'. Salary users
 *    get 0 revenue in this view — salary is paid via mediabuyer_payments on a monthly cadence.
 */
export function useMediaBuyerStats(range: StatsDateRange) {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentUserId = useCurrentUserId();
    const { confirmedIds, deliveredPkgIds } = useStatusCategories();

    // 1. Entries directly by created_by — orphaned-safe.
    const { data: entries = [], isLoading: loadingEntries } = useQuery<CampaignDailyEntry[]>({
        queryKey: ['mb-stats-entries', activeBusinessId, currentUserId, range.from, range.to],
        queryFn: async () => {
            if (!activeBusinessId || !currentUserId) return [];
            const { data, error } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', currentUserId)
                .gte('entry_date', range.from)
                .lte('entry_date', range.to)
                .order('entry_date', { ascending: true });
            if (error) throw error;
            return (data || []) as CampaignDailyEntry[];
        },
        enabled: !!activeBusinessId && !!currentUserId,
    });

    // 2. Fetch live campaign rows (for leaderboard names + status badges). Orphaned entries
    //    remain valid even when the campaign row is gone.
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
    });

    // 3. Fetch orders once, scoped to business + date range; client-filter by distinct sources.
    const distinctSources = useMemo(() => {
        const set = new Set<string>();
        for (const e of entries) {
            const src = getPlatformSource(e.platform);
            if (src) set.add(src);
        }
        return set;
    }, [entries]);
    const sourceList = useMemo(() => Array.from(distinctSources), [distinctSources]);

    const { data: orders = [], isLoading: loadingOrders } = useQuery<OrderRow[]>({
        queryKey: ['mb-stats-orders', activeBusinessId, range.from, range.to, sourceList.join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sourceList.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, date, source_name, order_status_id, package_status_id')
                .eq('DigiCom Business', activeBusinessId)
                .gte('date', range.from)
                .lte('date', range.to);
            if (error) throw error;
            const srcLower = new Set(sourceList.map((s) => s.toLowerCase()));
            return ((data || []) as OrderRow[]).filter((o) =>
                o.source_name ? srcLower.has(o.source_name.toLowerCase()) : false
            );
        },
        enabled: !!activeBusinessId && sourceList.length > 0,
    });

    // 4. Mediabuyer commission price (for revenue calc).
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
    });

    // 5. Compute aggregates.
    const { totals, daily, perPlatform, perCampaign, currency } = useMemo(() => {
        const commissionPrice =
            mediabuyer?.payment_type === 'commission' ? Number(mediabuyer.commission_price || 0) : 0;
        const campaignById = new Map<string, Campaign>();
        for (const c of campaigns) campaignById.set(c.id, c);

        // Bucket orders by (YYYY-MM-DD, source_lower).
        const ordersByDaySource = new Map<string, { confirmed: number; delivered: number }>();
        const key = (d: string, s: string) => `${d}|${s}`;
        for (const o of orders) {
            if (!o.date || !o.source_name) continue;
            const d = o.date.slice(0, 10);
            const s = o.source_name.toLowerCase();
            const k = key(d, s);
            const b = ordersByDaySource.get(k) || { confirmed: 0, delivered: 0 };
            if (o.order_status_id && confirmedIds.has(o.order_status_id)) b.confirmed += 1;
            if (o.package_status_id && deliveredPkgIds.has(o.package_status_id)) b.delivered += 1;
            ordersByDaySource.set(k, b);
        }

        // --- Daily rollup (dedupe orders per (day, source)) ---
        const dailyMap = new Map<string, { spend: number; leads: number; seen: Set<string> }>();
        for (const e of entries) {
            const src = getPlatformSource(e.platform);
            let row = dailyMap.get(e.entry_date);
            if (!row) {
                row = { spend: 0, leads: 0, seen: new Set() };
                dailyMap.set(e.entry_date, row);
            }
            row.spend += Number(e.spend || 0);
            row.leads += Number(e.leads || 0);
            row.seen.add(src);
        }
        const dailyRows: DailyPoint[] = [];
        for (const [d, r] of Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
            let confirmed = 0;
            let delivered = 0;
            r.seen.forEach((s) => {
                const b = ordersByDaySource.get(key(d, s));
                if (b) {
                    confirmed += b.confirmed;
                    delivered += b.delivered;
                }
            });
            const point: DailyPoint = {
                ...emptyTotals(),
                date: d,
                spend: r.spend,
                leads: r.leads,
                confirmed,
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            dailyRows.push(point);
        }

        // --- Platform rollup (same dedupe) ---
        const platformMap = new Map<string, { spend: number; leads: number; days: Set<string>; src: string }>();
        for (const e of entries) {
            const p = e.platform;
            const src = getPlatformSource(e.platform);
            let row = platformMap.get(p);
            if (!row) {
                row = { spend: 0, leads: 0, days: new Set(), src };
                platformMap.set(p, row);
            }
            row.spend += Number(e.spend || 0);
            row.leads += Number(e.leads || 0);
            row.days.add(e.entry_date);
        }
        const perPlatformArr: PlatformPoint[] = [];
        for (const [p, r] of platformMap.entries()) {
            let confirmed = 0;
            let delivered = 0;
            r.days.forEach((d) => {
                const b = ordersByDaySource.get(key(d, r.src));
                if (b) {
                    confirmed += b.confirmed;
                    delivered += b.delivered;
                }
            });
            const point: PlatformPoint = {
                ...emptyTotals(),
                platform: p,
                spend: r.spend,
                leads: r.leads,
                confirmed,
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            perPlatformArr.push(point);
        }
        perPlatformArr.sort((a, b) => b.spend - a.spend);

        // --- Per-campaign rollup. Orphaned entries (campaign deleted) are grouped under a
        //     single synthetic "(Deleted) <platform>" row per platform. ---
        type CampBucket = { spend: number; leads: number; days: Set<string>; src: string; name: string; platform: string; status: 'active' | 'draft' | 'deleted'; currency: string };
        const campaignMap = new Map<string, CampBucket>();
        for (const e of entries) {
            const src = getPlatformSource(e.platform);
            if (e.campaign_id && campaignById.has(e.campaign_id)) {
                const c = campaignById.get(e.campaign_id)!;
                let row = campaignMap.get(e.campaign_id);
                if (!row) {
                    row = {
                        spend: 0,
                        leads: 0,
                        days: new Set(),
                        src,
                        name: c.name,
                        platform: c.platform,
                        status: c.status,
                        currency: c.currency,
                    };
                    campaignMap.set(e.campaign_id, row);
                }
                row.spend += Number(e.spend || 0);
                row.leads += Number(e.leads || 0);
                row.days.add(e.entry_date);
            } else {
                const deletedKey = `__deleted__${e.platform}`;
                let row = campaignMap.get(deletedKey);
                if (!row) {
                    row = {
                        spend: 0,
                        leads: 0,
                        days: new Set(),
                        src,
                        name: `(Deleted) ${e.platform}`,
                        platform: e.platform,
                        status: 'deleted',
                        currency: 'MAD',
                    };
                    campaignMap.set(deletedKey, row);
                }
                row.spend += Number(e.spend || 0);
                row.leads += Number(e.leads || 0);
                row.days.add(e.entry_date);
            }
        }
        const perCampaignArr: CampaignPoint[] = [];
        for (const [cid, r] of campaignMap.entries()) {
            let confirmed = 0;
            let delivered = 0;
            r.days.forEach((d) => {
                const b = ordersByDaySource.get(key(d, r.src));
                if (b) {
                    confirmed += b.confirmed;
                    delivered += b.delivered;
                }
            });
            const point: CampaignPoint = {
                ...emptyTotals(),
                id: cid,
                name: r.name,
                platform: r.platform,
                status: r.status,
                currency: r.currency,
                spend: r.spend,
                leads: r.leads,
                confirmed,
                delivered,
                revenue: delivered * commissionPrice,
            };
            finalize(point);
            perCampaignArr.push(point);
        }
        perCampaignArr.sort((a, b) => b.profit - a.profit);

        // --- Grand totals ---
        const grand = dailyRows.reduce((acc, r) => {
            acc.spend += r.spend;
            acc.leads += r.leads;
            acc.confirmed += r.confirmed;
            acc.delivered += r.delivered;
            acc.revenue += r.revenue;
            return acc;
        }, emptyTotals());
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
    }, [entries, orders, campaigns, confirmedIds, deliveredPkgIds, mediabuyer]);

    return {
        campaigns,
        totals,
        daily,
        perPlatform,
        perCampaign,
        currency,
        mediabuyer,
        isLoading: loadingCampaigns || loadingEntries || loadingOrders,
    };
}
