import { useMemo, ReactNode } from 'react';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Radio, Globe2,
} from 'lucide-react';
import {
    FaFacebook, FaInstagram, FaTiktok, FaGoogle,
    FaSnapchatGhost, FaTwitter, FaWhatsapp, FaYoutube,
    FaPinterest, FaReddit, FaShopify,
} from 'react-icons/fa';
import { SiMessenger, SiShopee } from 'react-icons/si';
import {
    Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
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

/**
 * `channels` section of admin_analytics_stats (D3). Pool = replace-excluded,
 * STRICT placement window. The channel key is resolved server-side:
 * `normalize_ad_source(source_name ?? sales_channels[source_id].name)` — the
 * ONE SQL mirror of the client PLATFORM_SOURCE_MAP, so the map cannot drift in
 * two places — with an empty raw source falling to 'direct' (a whitespace-only
 * raw keeps its '' key, replicating the old client quirk). `converted` =
 * paid+delivered and `revenue` = the FULL pureRevenue chain over those, as
 * before. `trend` carries per-day counts for the server-ranked top-5 channels
 * only (top-5 is window-dependent, so the server has to rank it); this section
 * re-buckets to its grain. Icons/colors stay client-side lookups on the key.
 */
export interface ChannelsSlice {
    /** == Σ channels[].orders (every order gets a key). */
    total_orders: number;
    /** Sorted orders desc, key asc. */
    channels: Array<{ key: string; orders: number; converted: number; revenue: number }>;
    trend: Array<{ d: string; key: string; orders: number }>;
}

const getChannelIcon = (name: string): ReactNode => {
    const n = name.toLowerCase();
    if (n.includes('facebook')) return <FaFacebook className="w-4 h-4" />;
    if (n.includes('instagram')) return <FaInstagram className="w-4 h-4" />;
    if (n.includes('tiktok')) return <FaTiktok className="w-4 h-4" />;
    if (n.includes('google')) return <FaGoogle className="w-4 h-4" />;
    if (n.includes('whatsapp')) return <FaWhatsapp className="w-4 h-4" />;
    if (n.includes('messenger')) return <SiMessenger className="w-4 h-4" />;
    if (n.includes('snapchat')) return <FaSnapchatGhost className="w-4 h-4" />;
    if (n.includes('twitter') || n.includes('x')) return <FaTwitter className="w-4 h-4" />;
    if (n.includes('youtube')) return <FaYoutube className="w-4 h-4" />;
    if (n.includes('pinterest')) return <FaPinterest className="w-4 h-4" />;
    if (n.includes('reddit')) return <FaReddit className="w-4 h-4" />;
    if (n.includes('shopify')) return <FaShopify className="w-4 h-4" />;
    if (n.includes('shopee')) return <SiShopee className="w-4 h-4" />;
    return <Globe2 className="w-4 h-4" />;
};

const getChannelColor = (name: string): string => {
    const n = name.toLowerCase();
    if (n.includes('facebook')) return '#1877F2';
    if (n.includes('instagram')) return '#E4405F';
    if (n.includes('tiktok')) return '#000000';
    if (n.includes('google')) return '#4285F4';
    if (n.includes('whatsapp')) return '#25D366';
    if (n.includes('messenger')) return '#0084FF';
    if (n.includes('snapchat')) return '#FFFC00';
    if (n.includes('twitter') || n.includes('x')) return '#1DA1F2';
    if (n.includes('youtube')) return '#FF0000';
    if (n.includes('shopify')) return '#96BF48';
    if (n.includes('native')) return '#6b6a63';
    return '#141413';
};

interface SalesChannelsSectionProps {
    dateFilter: DateFilter;
    stats?: ChannelsSlice | null;
}

export const SalesChannelsSection = ({ dateFilter, stats }: SalesChannelsSectionProps) => {
    const metrics = useMemo(() => {
        if (!stats) return null;

        // `converted` = orders that reached paid+delivered (matches the
        // P&L revenue contract). Server sorts orders desc, key asc.
        const channelData = stats.channels.map(c => ({
            name: c.key,
            orders: c.orders,
            converted: c.converted,
            revenue: c.revenue,
            conversionRate: c.orders > 0 ? (c.converted / c.orders) * 100 : 0,
        }));

        const topChannel = channelData[0];

        // ── Trend (adaptive: day / week / month) ──
        // Anchor the range to the earliest day carrying top-5 channel orders
        // on All-Time and clamp each bucket to the user's window.
        const byKeyDay = new Map<string, Map<string, number>>();
        stats.trend.forEach(r => {
            let m = byKeyDay.get(r.key);
            if (!m) { m = new Map(); byKeyDay.set(r.key, m); }
            m.set(r.d, (m.get(r.d) || 0) + r.orders);
        });
        const earliest = stats.trend.length
            ? parseISO(stats.trend.reduce((min, r) => (r.d < min ? r.d : min), stats.trend[0].d))
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

        // Same ranking the server used to pick the trend's top-5 (orders desc,
        // key asc) — so every name here has a series in `trend`.
        const topNames = channelData.slice(0, 5).map(c => c.name);
        const trendData = intervals.map((anchor) => {
            const { start, end } = bucketBounds(anchor);
            const days = eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'));
            const result: Record<string, string | number> = { month: format(anchor, labelFormat) };
            topNames.forEach(name => {
                const m = byKeyDay.get(name);
                result[name] = m ? days.reduce((s, d) => s + (m.get(d) || 0), 0) : 0;
            });
            return result;
        });

        return {
            totalChannels: channelData.length,
            channelData,
            topChannel,
            trendData,
            channelNames: topNames,
        };
    }, [stats, dateFilter]);

    return (
        <SectionWrapper
            id="channels"
            title="Sales Channels"
            description="Sources normalized via the platform map. Revenue counts only paid+delivered orders."
            icon={Radio}
            iconColor="text-ant-mid"
            loading={!stats}
        >
            {metrics && (() => {
                const totalOrdersViaChannels = metrics.channelData.reduce((s, c) => s + c.orders, 0);
                const topShare = metrics.topChannel && totalOrdersViaChannels > 0
                    ? (metrics.topChannel.orders / totalOrdersViaChannels) * 100
                    : 0;
                // Gate "Best conversion" by a minimum order volume so a 1/1
                // channel can't dominate the tile. Fall back to the raw max
                // only when no channel has reached the threshold, and flag
                // that case in the sub-label.
                const BEST_CONV_MIN_ORDERS = 5;
                const qualifiers = metrics.channelData.filter((c) => c.orders >= BEST_CONV_MIN_ORDERS);
                const bestConv = qualifiers.length > 0
                    ? Math.max(...qualifiers.map((c) => c.conversionRate), 0)
                    : Math.max(...metrics.channelData.map((c) => c.conversionRate), 0);
                const bestConvLowSample = qualifiers.length === 0 && metrics.channelData.length > 0;
                const narrative = metrics.totalChannels === 0
                    ? 'No channel data for this period.'
                    : `${metrics.topChannel?.name || 'No top channel'} leads with ${metrics.topChannel?.orders || 0} orders (${topShare.toFixed(0)}% of all channel traffic). Across ${metrics.totalChannels} active channels, best conversion rate is ${bestConv.toFixed(1)}%.`;

                return (
                    <SectionStory
                        hero={{
                            label: 'top channel',
                            value: metrics.topChannel?.name || 'N/A',
                        }}
                        narrative={narrative}
                        supporting={[
                            { label: 'Active channels', value: metrics.totalChannels.toString() },
                            { label: 'Top channel orders', value: (metrics.topChannel?.orders || 0).toLocaleString('fr-MA'), sub: `${topShare.toFixed(0)}% share` },
                            {
                                label: 'Best conversion',
                                value: `${bestConv.toFixed(1)}%`,
                                tone: 'positive',
                                ...(bestConvLowSample
                                    ? { sub: `low sample (<${BEST_CONV_MIN_ORDERS} orders)` }
                                    : {}),
                            },
                            { label: 'Total via channels', value: totalOrdersViaChannels.toLocaleString('fr-MA') },
                        ]}
                    >

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <CardTitle className="text-[12px] font-semibold text-ant-ink">Channel trends</CardTitle>
                                <div className="flex items-center gap-2.5 text-[10px] text-ant-muted flex-wrap">
                                    {metrics.channelNames.slice(0, 4).map((name) => (
                                        <span key={name} className="inline-flex items-center gap-1 capitalize">
                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getChannelColor(name) }} />
                                            {name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={140}>
                                <AreaChart data={metrics.trendData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke="#e8e6dc" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#b0aea5' }} tickLine={false} axisLine={false} width={32} />
                                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e6dc', boxShadow: 'none', fontSize: 11 }} />
                                    {metrics.channelNames.map((name) => (
                                        <Area key={name} type="monotone" dataKey={name} stroke={getChannelColor(name)} fill={getChannelColor(name)} fillOpacity={0.08} strokeWidth={1.75} dot={false} />
                                    ))}
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card className="border border-ant-line shadow-none rounded-xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[12px] font-semibold text-ant-ink">Channel Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-1">
                                {metrics.channelData.map((ch) => (
                                    <div key={ch.name} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-ant-ink/[0.02] hover:bg-ant-ink/[0.04] transition-colors">
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ backgroundColor: getChannelColor(ch.name) }}>
                                            {getChannelIcon(ch.name)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-semibold text-ant-ink truncate capitalize leading-tight">{ch.name}</div>
                                            <div className="text-[10px] text-ant-mid tabular-nums">{ch.orders} orders</div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-[12px] font-semibold text-ant-ink tabular-nums">{Math.round(ch.revenue).toLocaleString('fr-MA')} <span className="text-[9px] text-ant-mid">MAD</span></div>
                                            <div className="text-[9px] text-ant-mid tabular-nums">{ch.conversionRate.toFixed(1)}% conv.</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                    </SectionStory>
                );
            })()}
        </SectionWrapper>
    );
};
