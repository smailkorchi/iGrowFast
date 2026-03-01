import { useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Megaphone, DollarSign, Target, TrendingUp,
    MousePointerClick, BarChart3, Zap,
} from 'lucide-react';
import {
    FaFacebook, FaInstagram, FaTiktok, FaGoogle,
    FaSnapchatGhost, FaTwitter, FaPinterest, FaReddit,
    FaWhatsapp, FaMicrosoft, FaBullseye,
} from 'react-icons/fa';
import { SiMessenger } from 'react-icons/si';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, BarChart, Bar, Cell, Legend, ComposedChart, Line,
} from 'recharts';
import { format, startOfDay, endOfDay, isWithinInterval, eachMonthOfInterval, startOfMonth, subMonths } from 'date-fns';

const PLATFORM_SOURCE_MAP: Record<string, string> = {
    'whatsapp ads': 'whatsapp', 'messenger ads': 'messenger',
    'instagram ads': 'instagram', 'facebook ads': 'facebook',
    'google ads': 'google', 'tiktok ads': 'tiktok',
    'native ads': 'native', 'snapchat ads': 'snapchat',
    'twitter ads': 'twitter', 'bing ads': 'bing',
    'pinterest ads': 'pinterest', 'reddit ads': 'reddit',
};

const CONFIRMED_CODES = ['confirmed', 'processed', 'paid', 'unpaid'];

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
    'Reddit ads': '#FF4500', 'Bing ads': '#00809D', 'Native ads': '#6B7280',
};

interface AdsSectionProps {
    businessId: string;
    dateFilter: DateFilter;
}

export const AdsSection = ({ businessId, dateFilter }: AdsSectionProps) => {
    const { data: adsHistory, isLoading } = useQuery({
        queryKey: ['analytics-ads-full', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('ads_history')
                .select('id, product_id, method, amount, start_date, end_date, products(name, image_url)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const { data: allOrders } = useQuery({
        queryKey: ['analytics-orders-for-ads-v2', businessId],
        queryFn: async () => {
            const { data } = await supabase
                .from('orders')
                .select('id, date, source_name, price, shipping_cost, package_status_label, order_statuses(code), order_items(product_id, unit_price, quantity)')
                .eq('DigiCom Business', businessId);
            return data || [];
        },
        enabled: !!businessId,
    });

    const metrics = useMemo(() => {
        if (!adsHistory || !allOrders) return null;

        const isInRange = (dateStr: string | null) => {
            if (!dateStr) return true;
            if (!dateFilter.from && !dateFilter.to) return true;
            const d = new Date(dateStr);
            return isWithinInterval(d, {
                start: dateFilter.from ? startOfDay(dateFilter.from) : new Date(0),
                end: dateFilter.to ? endOfDay(dateFilter.to) : new Date(),
            });
        };

        const filtered = adsHistory.filter(a => isInRange(a.start_date));
        const totalSpend = filtered.reduce((s, a) => s + Number(a.amount || 0), 0);

        const getMatchedOrders = (campaign: any) => {
            const sourceName = PLATFORM_SOURCE_MAP[campaign.method.toLowerCase()] || '';
            const cStart = new Date(campaign.start_date);
            const cEnd = new Date(campaign.end_date);
            cEnd.setHours(23, 59, 59, 999);

            return allOrders.filter((o: any) => {
                const orderDate = new Date(o.date);
                return orderDate >= cStart && orderDate <= cEnd
                    && sourceName && (o.source_name || '').toLowerCase() === sourceName
                    && o.order_items?.some((item: any) => item.product_id === campaign.product_id);
            });
        };

        const seenOrderIds = new Set<string>();
        let totalOrders = 0;
        let totalConfirmed = 0;
        let totalDelivered = 0;
        let totalGrossRevenue = 0;

        filtered.forEach(campaign => {
            const matched = getMatchedOrders(campaign);
            matched.forEach((o: any) => {
                if (seenOrderIds.has(o.id)) return;
                seenOrderIds.add(o.id);

                totalOrders++;
                const statusCode = ((o.order_statuses as any)?.code || '').toLowerCase();
                const packageLabel = (o.package_status_label || '').toLowerCase();
                if (packageLabel === 'livré') {
                    totalDelivered++;
                    totalConfirmed++;
                    totalGrossRevenue += Number(o.price) || 0;
                } else if (CONFIRMED_CODES.includes(statusCode)) {
                    totalConfirmed++;
                }
            });
        });

        const roas = totalSpend > 0 ? totalGrossRevenue / totalSpend : 0;
        const costPerOrder = totalOrders > 0 ? totalSpend / totalOrders : 0;
        const costPerDelivered = totalDelivered > 0 ? totalSpend / totalDelivered : 0;

        const platformBreakdown: Record<string, { spend: number; orderIds: Set<string>; delivered: number; revenue: number; count: number }> = {};
        filtered.forEach(campaign => {
            const platform = campaign.method || 'Other';
            if (!platformBreakdown[platform]) platformBreakdown[platform] = { spend: 0, orderIds: new Set(), delivered: 0, revenue: 0, count: 0 };
            platformBreakdown[platform].spend += Number(campaign.amount || 0);
            platformBreakdown[platform].count++;

            const matched = getMatchedOrders(campaign);
            matched.forEach((o: any) => {
                if (platformBreakdown[platform].orderIds.has(o.id)) return;
                platformBreakdown[platform].orderIds.add(o.id);
                if ((o.package_status_label || '').toLowerCase() === 'livré') {
                    platformBreakdown[platform].delivered++;
                    platformBreakdown[platform].revenue += Number(o.price) || 0;
                }
            });
        });

        const platformData = Object.entries(platformBreakdown)
            .map(([platform, data]) => ({
                platform,
                spend: data.spend,
                orders: data.orderIds.size,
                delivered: data.delivered,
                revenue: data.revenue,
                count: data.count,
                cpd: data.delivered > 0 ? data.spend / data.delivered : 0,
                roas: data.spend > 0 ? data.revenue / data.spend : 0,
                color: PLATFORM_COLORS[platform] || '#6B7280',
            }))
            .sort((a, b) => b.spend - a.spend);

        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            const monthAds = filtered.filter(a => a.start_date && isWithinInterval(new Date(a.start_date), { start: mStart, end: mEnd }));
            const monthSpend = monthAds.reduce((s, a) => s + Number(a.amount || 0), 0);

            const seenIds = new Set<string>();
            let monthRevenue = 0;
            monthAds.forEach(campaign => {
                getMatchedOrders(campaign)
                    .filter((o: any) => (o.package_status_label || '').toLowerCase() === 'livré')
                    .forEach((o: any) => {
                        if (seenIds.has(o.id)) return;
                        seenIds.add(o.id);
                        monthRevenue += Number(o.price) || 0;
                    });
            });

            return {
                month: format(month, 'MMM yy'),
                spend: monthSpend,
                revenue: monthRevenue,
                roas: monthSpend > 0 ? monthRevenue / monthSpend : 0,
            };
        });

        return {
            totalSpend, totalOrders, totalConfirmed, totalDelivered,
            totalGrossRevenue, roas, costPerOrder, costPerDelivered,
            campaignCount: filtered.length, platformData, trendData,
        };
    }, [adsHistory, allOrders, dateFilter]);

    return (
        <SectionWrapper
            id="ads"
            title="Advertising & Campaigns"
            description="Ad spend, ROAS, and platform performance (calculated from real orders)"
            icon={Megaphone}
            iconBg="bg-pink-50"
            iconColor="text-pink-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                        <StatCard title="Total Spend" value={metrics.totalSpend.toLocaleString('fr-MA')} suffix=" MAD" icon={DollarSign} iconBg="bg-pink-50" iconColor="text-pink-600" />
                        <StatCard title="Campaigns" value={metrics.campaignCount} icon={Megaphone} iconBg="bg-purple-50" iconColor="text-purple-600" />
                        <StatCard title="Orders" value={metrics.totalOrders} icon={MousePointerClick} iconBg="bg-blue-50" iconColor="text-blue-600" />
                        <StatCard title="Confirmed" value={metrics.totalConfirmed} icon={Target} iconBg="bg-teal-50" iconColor="text-teal-600" />
                        <StatCard title="Delivered" value={metrics.totalDelivered} icon={Zap} iconBg="bg-emerald-50" iconColor="text-emerald-600" />
                        <StatCard title="Revenue" value={metrics.totalGrossRevenue.toLocaleString('fr-MA')} suffix=" MAD" icon={TrendingUp} iconBg="bg-green-50" iconColor="text-green-600" />
                        <StatCard title="ROAS" value={metrics.roas.toFixed(2)} suffix="x" icon={TrendingUp} iconBg="bg-amber-50" iconColor="text-amber-600" valueColor={metrics.roas >= 1 ? 'text-emerald-600' : 'text-red-500'} />
                        <StatCard title="CPD" value={metrics.costPerDelivered.toFixed(0)} suffix=" MAD" icon={BarChart3} iconBg="bg-orange-50" iconColor="text-orange-600" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Spend vs Revenue</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <ComposedChart data={metrics.trendData}>
                                        <defs>
                                            <linearGradient id="colorAdSpend" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#c93942" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#c93942" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorAdRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: number, name: string) => name === 'ROAS' ? `${val.toFixed(2)}x` : `${val.toLocaleString('fr-MA')} MAD`} />
                                        <Area yAxisId="left" type="monotone" dataKey="spend" stroke="#c93942" fill="url(#colorAdSpend)" strokeWidth={2} name="Ad Spend" />
                                        <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#10B981" fill="url(#colorAdRevenue)" strokeWidth={2} name="Revenue" />
                                        <Line yAxisId="right" type="monotone" dataKey="roas" stroke="#F97316" strokeWidth={2} dot={false} name="ROAS" />
                                        <Legend />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Spend by Platform</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={metrics.platformData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="platform" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                                        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: number) => `${val.toLocaleString('fr-MA')} MAD`} />
                                        <Bar dataKey="spend" radius={[8, 8, 0, 0]} name="Spend">
                                            {metrics.platformData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    {metrics.platformData.length > 0 && (
                        <Card className="border-0 shadow-sm rounded-3xl">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-bold text-brand-navy">Platform Breakdown</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2.5">
                                    {metrics.platformData.map((p) => (
                                        <div key={p.platform} className="flex items-center gap-4 p-3 rounded-2xl bg-brand-navy/[0.02] hover:bg-brand-navy/[0.04] transition-colors">
                                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: p.color }}>
                                                {getPlatformIcon(p.platform)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-brand-navy">{p.platform}</div>
                                                <div className="text-xs text-gray-400">{p.count} campaigns · {p.orders} orders</div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-sm font-bold text-brand-navy">{p.spend.toLocaleString('fr-MA')} <span className="text-[10px] text-brand-navy/40">MAD</span></div>
                                                <div className="text-xs text-gray-400">{p.delivered} delivered · ROAS {p.roas.toFixed(2)}x</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </SectionWrapper>
    );
};
