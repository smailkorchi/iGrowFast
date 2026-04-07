import { useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
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
    PieChart, Pie, Cell, Tooltip, Legend,
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths } from 'date-fns';

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
    if (n.includes('native')) return '#6B7280';
    return '#3b5e5e';
};

interface SalesChannelsSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const SalesChannelsSection = ({ businessId, dateFilter }: SalesChannelsSectionProps) => {
    const { deliveredPkgIds, isOrderCategory } = useStatusCategories();

    const { data: orders, isLoading } = useQuery({
        queryKey: ['analytics-orders-channels', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, source_name, source_id, price, date, order_status_id, package_status_id, package_status_label, package_statuses(label)')
                .eq('DigiCom Business', businessId);
            return data || [];
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

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = orders.filter(o => isInRange(o.date));
        const channelMap = new Map((salesChannels || []).map(c => [c.id, c.name]));

        const isPaidAndDelivered = (o: any) =>
            isDeliveredForCommission(o, deliveredPkgIds) &&
            o.order_status_id && isOrderCategory(o.order_status_id, 'paid');

        const channelBreakdown: Record<string, { orders: number; revenue: number; delivered: number }> = {};
        filtered.forEach(o => {
            const source = o.source_name || (o.source_id ? channelMap.get(o.source_id) : null) || 'Direct';
            if (!channelBreakdown[source]) channelBreakdown[source] = { orders: 0, revenue: 0, delivered: 0 };
            channelBreakdown[source].orders++;
            channelBreakdown[source].revenue += Number(o.price || 0);
            if (isPaidAndDelivered(o)) {
                channelBreakdown[source].delivered++;
            }
        });

        const channelData = Object.entries(channelBreakdown)
            .map(([name, data]) => ({
                name,
                ...data,
                conversionRate: data.orders > 0 ? (data.delivered / data.orders) * 100 : 0,
            }))
            .sort((a, b) => b.orders - a.orders);

        const topChannel = channelData[0];

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthOrders = filtered.filter(o => o.date && isWithinInterval(new Date(o.date), { start: mStart, end: mEnd }));

            const result: Record<string, any> = { month: format(month, 'MMM yy') };
            channelData.slice(0, 5).forEach(ch => {
                result[ch.name] = monthOrders.filter(o => (o.source_name || 'Direct') === ch.name).length;
            });
            return result;
        });

        return {
            totalChannels: channelData.length,
            channelData,
            topChannel,
            pieData: channelData.slice(0, 8).map(c => ({ name: c.name, value: c.orders, color: getChannelColor(c.name) })),
            trendData,
            channelNames: channelData.slice(0, 5).map(c => c.name),
        };
    }, [orders, salesChannels, dateFilter, deliveredPkgIds, isOrderCategory]);

    return (
        <SectionWrapper
            id="channels"
            title="Sales Channels"
            description="Order sources and channel performance"
            icon={Radio}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        <StatCard title="Total Channels" value={metrics.totalChannels} icon={Radio} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
                        <StatCard title="Top Channel" value={metrics.topChannel?.name || 'N/A'} icon={Award} iconBg="bg-amber-50" iconColor="text-amber-600" subtitle={`${metrics.topChannel?.orders || 0} orders`} />
                        <StatCard title="Best Conversion" value={Math.max(...metrics.channelData.map(c => c.conversionRate), 0).toFixed(1)} suffix="%" icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Total Via Channels" value={metrics.channelData.reduce((s, c) => s + c.orders, 0)} icon={ShoppingCart} iconBg="bg-blue-50" iconColor="text-blue-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Orders by Source</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={metrics.pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
                                            {metrics.pieData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(val: number) => `${val} orders`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Channel Trends</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={metrics.trendData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        {metrics.channelNames.map((name) => (
                                            <Area key={name} type="monotone" dataKey={name} stroke={getChannelColor(name)} fill={getChannelColor(name)} fillOpacity={0.1} strokeWidth={2} />
                                        ))}
                                        <Legend />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="border-0 shadow-sm rounded-3xl">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold text-brand-navy">Channel Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {metrics.channelData.map((ch) => (
                                    <div key={ch.name} className="flex items-center gap-4 p-3 rounded-2xl bg-brand-navy/[0.02] hover:bg-brand-navy/[0.04] transition-colors">
                                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: getChannelColor(ch.name) }}>
                                            {getChannelIcon(ch.name)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-brand-navy truncate capitalize">{ch.name}</div>
                                            <div className="text-xs text-gray-400">{ch.orders} orders</div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-sm font-bold text-brand-navy">{ch.revenue.toLocaleString('fr-MA')} <span className="text-[10px] text-brand-navy/40">MAD</span></div>
                                            <div className="text-xs text-gray-400">{ch.conversionRate.toFixed(1)}% conv.</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </SectionWrapper>
    );
};
