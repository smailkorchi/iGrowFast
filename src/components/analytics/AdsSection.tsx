import { useMemo, ReactNode } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Megaphone,
} from 'lucide-react';
import {
    FaFacebook, FaInstagram, FaTiktok, FaGoogle,
    FaSnapchatGhost, FaTwitter, FaPinterest, FaReddit,
    FaWhatsapp, FaMicrosoft, FaBullseye,
} from 'react-icons/fa';
import { SiMessenger } from 'react-icons/si';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    differenceInDays,
    eachDayOfInterval,
    eachMonthOfInterval,
    eachWeekOfInterval,
    endOfDay,
    endOfMonth,
    endOfWeek,
    format,
    parseISO,
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';

const getPlatformIcon = (platformName: string): ReactNode => {
    switch (platformName.toLowerCase()) {
        case 'whatsapp ads': return <FaWhatsapp className="w-4 h-4" />;
        case 'messenger ads': return <SiMessenger className="w-4 h-4" />;
        case 'instagram ads': return <FaInstagram className="w-4 h-4" />;
        case 'facebook ads': return <FaFacebook className="w-4 h-4" />;
        case 'google ads': return <FaGoogle className="w-4 h-4" />;
        case 'tiktok ads': return <FaTiktok className="w-4 h-4" />;
        case 'snapchat ads': return <FaSnapchatGhost className="w-4 h-4" />;
        case 'twitter ads': return <FaTwitter className="w-4 h-4" />;
        case 'pinterest ads': return <FaPinterest className="w-4 h-4" />;
        case 'reddit ads': return <FaReddit className="w-4 h-4" />;
        case 'bing ads': return <FaMicrosoft className="w-4 h-4" />;
        case 'native ads': return <FaBullseye className="w-4 h-4" />;
        default: return <Megaphone className="w-4 h-4" />;
    }
};

const PLATFORM_COLORS: Record<string, string> = {
    'Facebook ads': '#1877F2', 'Instagram ads': '#E4405F', 'Tiktok ads': '#000000',
    'Google ads': '#4285F4', 'Snapchat ads': '#FFFC00', 'Twitter ads': '#1DA1F2',
    'Whatsapp ads': '#25D366', 'Messenger ads': '#0084FF', 'Pinterest ads': '#E60023',
    'Reddit ads': '#FF4500', 'Bing ads': '#00809D', 'Native ads': '#6b6a63',
};

/**
 * `ads` section of admin_analytics_stats (D3). Server-side: both spend sources
 * (ads_history overlap-pro-rated to the window + campaign_daily_entries summed
 * daily), the campaign counts, the cross-source deduped order/confirmed/
 * delivered/revenue top line, the raw-string platform buckets and the
 * day-bucketed spend/revenue trend.
 *
 * Replicated deviations (deliberate, parity-first): ROAS revenue counts
 * DELIVERED orders paid or not, and the Ads revenue chain is the LIVE partial
 * collapse (per-line unit_price × qty, then greatest(0, price − shipping_cost)
 * — no delivery add-back), matching the old select's narrower column set;
 * product ads with a NULL end_date reach the top-line spend but never
 * attribution or the platform buckets (the client's `new Date(null)` epoch
 * trap). Casablanca days replace the page's three old client timezone
 * conventions.
 *
 * Client keeps only presentation: platform icons/colors, the ROAS/cost
 * arithmetic, and the trend re-bucketing to the adaptive grain below.
 */
export interface AdsSlice {
    spend_product_ads: number;
    spend_global_ads: number;
    product_campaign_count: number;
    global_campaign_count: number;
    total_orders: number;
    total_confirmed: number;
    total_delivered: number;
    total_gross_revenue: number;
    /** Sorted spend desc by the RPC. Platform key = the RAW method/platform string. */
    platforms: Array<{
        platform: string;
        spend: number;
        orders: number;
        delivered: number;
        revenue: number;
        product_count: number;
        global_count: number;
    }>;
    /** Casablanca day buckets, ascending. `d` = 'YYYY-MM-DD'. */
    trend: Array<{ d: string; spend: number; revenue: number }>;
}

interface AdsSectionProps {
    businessId: string;
    dateFilter: DateFilter;
    stats?: AdsSlice | null;
}

export const AdsSection = ({ dateFilter, stats }: AdsSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        const totalSpend = stats.spend_product_ads + stats.spend_global_ads;
        const totalGrossRevenue = stats.total_gross_revenue;
        const totalOrders = stats.total_orders;
        const totalDelivered = stats.total_delivered;
        const campaignCount = stats.product_campaign_count + stats.global_campaign_count;

        const roas = totalSpend > 0 ? totalGrossRevenue / totalSpend : 0;
        const costPerOrder = totalOrders > 0 ? totalSpend / totalOrders : 0;
        const costPerDelivered = totalDelivered > 0 ? totalSpend / totalDelivered : 0;

        // Rows arrive sorted spend desc; only icon/colour lookups are client-side.
        const platformData = stats.platforms.map((p) => ({
            platform: p.platform,
            spend: p.spend,
            orders: p.orders,
            delivered: p.delivered,
            revenue: p.revenue,
            productCount: p.product_count,
            globalCount: p.global_count,
            cpd: p.delivered > 0 ? p.spend / p.delivered : 0,
            roas: p.spend > 0 ? p.revenue / p.spend : 0,
            color: PLATFORM_COLORS[p.platform] || '#6b6a63',
        }));

        // ── Trend (adaptive: day / week / month) ──
        // The RPC returns Casablanca day buckets; the grain choice and the
        // bucket clamping stay client-side. Auto-pick granularity from window
        // length AND clamp each bucket's [start, end] to the user-selected
        // range, so a "Today" filter can't sample a whole calendar month.
        // All-Time anchors to the earliest day carried by the trend array
        // (NOTE: the client used to anchor to the earliest ad/entry/order
        // placement — the RPC's trend only spans days with spend or delivered
        // revenue, so an all-time chart can start later. Axis extent only.)
        const earliest = stats.trend.length
            ? startOfDay(parseISO(stats.trend[0].d))
            : subMonths(new Date(), 6);

        const rangeStart = dateFilter.from ? startOfDay(dateFilter.from) : startOfDay(earliest);
        const rangeEnd = dateFilter.to ? endOfDay(dateFilter.to) : endOfDay(new Date());
        const rangeDays = Math.max(0, differenceInDays(rangeEnd, rangeStart));

        type Granularity = 'daily' | 'weekly' | 'monthly';
        const granularity: Granularity =
            rangeDays <= 31 ? 'daily' : rangeDays <= 120 ? 'weekly' : 'monthly';

        let intervals: Date[];
        let labelFormat: string;
        if (granularity === 'monthly') {
            intervals = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
            labelFormat = 'MMM yy';
        } else if (granularity === 'weekly') {
            intervals = eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 1 });
            labelFormat = 'MMM d';
        } else {
            intervals = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
            labelFormat = rangeDays <= 14 ? 'EEE d' : 'MMM d';
        }

        const bucketBounds = (anchor: Date): { start: Date; end: Date } => {
            let s: Date;
            let e: Date;
            if (granularity === 'monthly') {
                s = startOfMonth(anchor);
                e = endOfMonth(anchor);
            } else if (granularity === 'weekly') {
                s = startOfWeek(anchor, { weekStartsOn: 1 });
                e = endOfWeek(anchor, { weekStartsOn: 1 });
            } else {
                s = startOfDay(anchor);
                e = endOfDay(anchor);
            }
            if (s.getTime() < rangeStart.getTime()) s = rangeStart;
            if (e.getTime() > rangeEnd.getTime()) e = rangeEnd;
            return { start: s, end: e };
        };

        // Day keys are compared as 'YYYY-MM-DD' strings (ISO dates sort
        // lexicographically) so the server's Casablanca day never gets
        // re-interpreted through the browser's timezone.
        const trendData = intervals.map((anchor) => {
            const { start: bStart, end: bEnd } = bucketBounds(anchor);
            const startKey = format(bStart, 'yyyy-MM-dd');
            const endKey = format(bEnd, 'yyyy-MM-dd');

            let bucketSpend = 0;
            let bucketRevenue = 0;
            for (const row of stats.trend) {
                if (row.d < startKey || row.d > endKey) continue;
                bucketSpend += row.spend;
                bucketRevenue += row.revenue;
            }

            return {
                month: format(anchor, labelFormat),
                spend: bucketSpend,
                revenue: bucketRevenue,
                roas: bucketSpend > 0 ? bucketRevenue / bucketSpend : 0,
            };
        });

        return {
            totalSpend,
            spendProductAds: stats.spend_product_ads,
            spendGlobalAds: stats.spend_global_ads,
            totalOrders,
            totalConfirmed: stats.total_confirmed,
            totalDelivered,
            totalGrossRevenue, roas, costPerOrder, costPerDelivered,
            campaignCount,
            productCampaignCount: stats.product_campaign_count,
            globalCampaignCount: stats.global_campaign_count,
            platformData, trendData,
        };
    }, [stats, dateFilter]);

    return (
        <SectionWrapper
            id="ads"
            title="Advertising & Campaigns"
            description="Product ads + campaign ads. Spend pro-rated by window overlap. ROAS uses delivered revenue (paid or not)."
            icon={Megaphone}
            iconColor="text-ant-mid"
            loading={!stats}
        >
            {metrics && (() => {
                const roasTone: 'positive' | 'warning' | 'negative' =
                    metrics.roas >= 2 ? 'positive' : metrics.roas >= 1 ? 'warning' : 'negative';
                const narrative = metrics.totalSpend === 0
                    ? 'No ad spend recorded for this period.'
                    : metrics.roas >= 1
                        ? `Every 1 MAD in ads returned ${metrics.roas.toFixed(2)} MAD in delivered revenue across ${metrics.campaignCount} campaigns. ${metrics.totalDelivered.toLocaleString('fr-MA')} deliveries at ${Math.round(metrics.costPerDelivered).toLocaleString('fr-MA')} MAD per delivered order.`
                        : `Ads cost ${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD but returned only ${Math.round(metrics.totalGrossRevenue).toLocaleString('fr-MA')} MAD (ROAS ${metrics.roas.toFixed(2)}x). Every delivery cost ${Math.round(metrics.costPerDelivered).toLocaleString('fr-MA')} MAD — review underperforming campaigns.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'ROAS',
                            value: `${metrics.roas.toFixed(2)}x`,
                            tone: roasTone,
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Spend', value: `${Math.round(metrics.totalSpend).toLocaleString('fr-MA')} MAD`, sub: `${metrics.campaignCount} campaigns`, tone: 'negative' },
                            { label: 'Delivered revenue', value: `${Math.round(metrics.totalGrossRevenue).toLocaleString('fr-MA')} MAD`, tone: 'positive' },
                            { label: 'Orders', value: metrics.totalOrders.toLocaleString('fr-MA') },
                            { label: 'Confirmed', value: metrics.totalConfirmed.toLocaleString('fr-MA') },
                            { label: 'Delivered', value: metrics.totalDelivered.toLocaleString('fr-MA'), tone: 'positive' },
                            { label: 'Cost / delivery', value: `${Math.round(metrics.costPerDelivered).toLocaleString('fr-MA')} MAD` },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Spend vs revenue</CardTitle>
                                <div className="flex items-center gap-2.5 text-[10px] text-ant-muted">
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#c96356]" /> Spend</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#788c5d]" /> Revenue</span>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={140}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="colorAdSpend" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#c96356" stopOpacity={0.18} />
                                            <stop offset="95%" stopColor="#c96356" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorAdRevenue" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#788c5d" stopOpacity={0.22} />
                                            <stop offset="95%" stopColor="#788c5d" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={32} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`} />
                                    <Area type="monotone" dataKey="spend" stroke="#c96356" fill="url(#colorAdSpend)" strokeWidth={1.75} name="Spend" dot={false} />
                                    <Area type="monotone" dataKey="revenue" stroke="#788c5d" fill="url(#colorAdRevenue)" strokeWidth={1.75} name="Revenue" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {metrics.platformData.length > 0 && (
                        <Card className="border border-ant-line shadow-none rounded-xl">
                            <CardHeader className="pb-1">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">By platform</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-1">
                                    {metrics.platformData.map((p) => {
                                        const maxSpend = Math.max(...metrics.platformData.map((x) => x.spend), 1);
                                        const sharePct = (p.spend / maxSpend) * 100;
                                        return (
                                            <div key={p.platform} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ant-ink/[0.03] transition-colors">
                                                <div className="w-6 h-6 rounded text-ant-muted flex items-center justify-center shrink-0">
                                                    {getPlatformIcon(p.platform)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[11px] font-semibold text-ant-ink leading-tight truncate">{p.platform}</div>
                                                    <div className="text-[10px] text-ant-mid tabular-nums">
                                                        {p.orders} orders · {p.delivered} delivered
                                                    </div>
                                                </div>
                                                <div className="w-20 h-1 rounded-full bg-ant-line overflow-hidden shrink-0">
                                                    <div className="h-full rounded-full bg-ant-ink/60" style={{ width: `${sharePct}%` }} />
                                                </div>
                                                <div className="text-right shrink-0 tabular-nums">
                                                    <div className="text-[12px] font-semibold text-ant-ink">{Math.round(p.spend).toLocaleString('fr-MA')} <span className="text-[9px] text-ant-mid">MAD</span></div>
                                                    <div className="text-[9px] text-ant-mid">ROAS {p.roas.toFixed(2)}x</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
