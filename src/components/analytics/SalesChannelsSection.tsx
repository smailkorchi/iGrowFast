import { useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    AnalyticsOrder,
    inWindow,
    isRevenueOrder,
    normalizeSource,
    placementTimestamp,
    pureRevenueForOrder,
} from '@/lib/analyticsDefinitions';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Radio, TrendingUp, ShoppingCart,
    Award, Globe2,
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
    startOfDay,
    startOfMonth,
    startOfWeek,
    subMonths,
} from 'date-fns';

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
    businessId: string;
    dateFilter: DateFilter;
}

export const SalesChannelsSection = ({ businessId, dateFilter }: SalesChannelsSectionProps) => {
    const { deliveredPkgIds, paidOrderIds } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-channels-v2', businessId],
        queryFn: async () => {
            return await fetchAllRows(
                'orders',
                'id, source_name, source_id, price, raw_price, shipping_cost, include_delivery_in_total, date, order_status_id, package_status_id, package_status_label, package_statuses(label, category), order_items(product_id, quantity, unit_price, total_price, accessory_id, accessory_quantity, accessory_unit_price)',
                {
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: businessId },
                        { column: 'date_deleted', op: 'is', value: null },
                        { column: 'source_review_status', op: 'neq', value: 'pending' },
                    ],
                },
            );
        },
        enabled: !!businessId,
    });

    const { data: salesChannels } = useQuery({
        queryKey: ['analytics-sales-channels', businessId],
        queryFn: async () => {
            const { data } = await supabase.from('sales_channels').select('id, name, type').eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!orders) return null;
        const ordersTyped = orders as unknown as (AnalyticsOrder & { source_id?: string | null })[];

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        const filtered = ordersTyped.filter(o => inWindow(placementTimestamp(o), windowStart, windowEnd));
        const channelMap = new Map((salesChannels || []).map(c => [c.id, c.name]));

        // Normalize source via PLATFORM_SOURCE_MAP (§12). "Facebook ads" / "facebook" / "FB"
        // all collapse to a single canonical key. Orders with no source fall to 'direct'.
        const channelKeyFor = (o: AnalyticsOrder & { source_id?: string | null }): string => {
            const raw = o.source_name || (o.source_id ? channelMap.get(o.source_id) : '') || '';
            const normalized = normalizeSource(raw);
            if (normalized) return normalized;
            return raw ? raw.trim().toLowerCase() : 'direct';
        };

        // `converted` = orders that reached paid+delivered (matches the
        // P&L revenue contract). The field was called `delivered` before
        // even though it required paid too — rename to match reality.
        const channelBreakdown: Record<string, { orders: number; revenue: number; converted: number }> = {};
        filtered.forEach(o => {
            const key = channelKeyFor(o);
            if (!channelBreakdown[key]) channelBreakdown[key] = { orders: 0, revenue: 0, converted: 0 };
            channelBreakdown[key].orders++;
            if (isRevenueOrder(o, deliveredPkgIds, paidOrderIds)) {
                channelBreakdown[key].converted++;
                channelBreakdown[key].revenue += pureRevenueForOrder(o);
            }
        });

        const channelData = Object.entries(channelBreakdown)
            .map(([name, data]) => ({
                name,
                ...data,
                conversionRate: data.orders > 0 ? (data.converted / data.orders) * 100 : 0,
            }))
            .sort((a, b) => b.orders - a.orders);

        const topChannel = channelData[0];

        // ── Trend (adaptive: day / week / month) ──
        // Anchor the range to the earliest order timestamp on All-Time and
        // clamp each bucket to the user's window. Prior behaviour always
        // used monthly buckets with a fixed 6-month fallback, so "Today"
        // filters produced a single unlabeled monthly point.
        const allTimestamps: number[] = [];
        ordersTyped.forEach(o => {
            const t = placementTimestamp(o)?.getTime();
            if (t) allTimestamps.push(t);
        });
        const earliest = allTimestamps.length
            ? new Date(Math.min(...allTimestamps))
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

        const topNames = channelData.slice(0, 5).map(c => c.name);
        const trendData = intervals.map((anchor) => {
            const { start, end } = bucketBounds(anchor);
            const bucketOrders = filtered.filter(o => inWindow(placementTimestamp(o), start, end));
            const result: Record<string, string | number> = { month: format(anchor, labelFormat) };
            topNames.forEach(name => {
                result[name] = bucketOrders.filter(o => channelKeyFor(o) === name).length;
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
    }, [orders, salesChannels, dateFilter, deliveredPkgIds, paidOrderIds]);

    return (
        <SectionWrapper
            id="channels"
            title="Sales Channels"
            description="Sources normalized via the platform map. Revenue counts only paid+delivered orders."
            icon={Radio}
            iconColor="text-ant-mid"
            loading={isLoading}
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
