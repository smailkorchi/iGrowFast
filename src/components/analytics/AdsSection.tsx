import { useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { StatCard } from './StatCard';
import { DateFilter } from './AnalyticsDateFilter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useStatusCategories } from '@/hooks/useStatusCategories';
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

// ── Product Ads (legacy per-product ads_history) ──────────────────
type ProductAdRow = {
    id: string;
    product_id: string | null;
    method: string;
    amount: number | string;
    start_date: string;
    end_date: string;
};

// ── Global Ads (new: campaign_daily_entries from media-buyer campaigns) ──
type CampaignRow = { id: string; platform: string; name: string };
type GlobalAdEntry = {
    id: string;
    campaign_id: string | null;
    platform: string;           // denormalized from campaign at insert time
    entry_date: string;         // YYYY-MM-DD
    spend: number | string;
    leads: number;
};

type AdsOrderItem = { product_id: string };

type AdsOrderForMatching = {
    id: string;
    date: string | null;
    source_name: string | null;
    price: number | null;
    package_status_id: string | null;
    order_status_id: string | null;
    order_items: AdsOrderItem[] | null;
};

export const AdsSection = ({ businessId, dateFilter }: AdsSectionProps) => {
    const { confirmedIds, deliveredPkgIds } = useStatusCategories();

    // ── Source 1: legacy per-product ads (ads_history) ─────────────
    const { data: adsHistory, isLoading: loadingAds } = useQuery<ProductAdRow[]>({
        queryKey: ['analytics-ads-full', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('ads_history')
                .select('id, product_id, method, amount, start_date, end_date, products(name, image_url)')
                .eq('DigiCom Business', businessId);
            return (data || []) as ProductAdRow[];
        },
        enabled: !!businessId,
    });

    // ── Source 2: global ads (campaign_daily_entries) ──────────────
    const { data: campaignEntries = [], isLoading: loadingEntries } = useQuery<GlobalAdEntry[]>({
        queryKey: ['analytics-campaign-entries', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('id, campaign_id, platform, entry_date, spend, leads')
                .eq('DigiCom Business', businessId);
            return (data || []) as GlobalAdEntry[];
        },
        enabled: !!businessId,
    });

    // Campaign lookup (name + platform) — for display only; entries carry their own platform.
    const { data: campaignRows = [] } = useQuery<CampaignRow[]>({
        queryKey: ['analytics-campaigns-lookup', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('campaigns')
                .select('id, platform, name')
                .eq('DigiCom Business', businessId);
            return (data || []) as CampaignRow[];
        },
        enabled: !!businessId,
    });

    const { data: allOrders } = useQuery<AdsOrderForMatching[]>({
        queryKey: ['analytics-orders-for-ads-v3', businessId],
        queryFn: async () => {
            const { data } = await (supabase as any)
                .from('orders')
                .select('id, date, source_name, price, shipping_cost, package_status_id, order_status_id, order_items(product_id, unit_price, quantity)')
                .eq('DigiCom Business', businessId);
            return (data || []) as AdsOrderForMatching[];
        },
        enabled: !!businessId,
    });

    const isLoading = loadingAds || loadingEntries;

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

        // ── Filter both sources by the selected range ────────────────
        const filteredProductAds = adsHistory.filter(a => isInRange(a.start_date));
        const filteredEntries = campaignEntries.filter(e => isInRange(e.entry_date));

        // ── Spend totals (product ads + global ads) ─────────────────
        const spendProductAds = filteredProductAds.reduce((s, a) => s + Number(a.amount || 0), 0);
        const spendGlobalAds = filteredEntries.reduce((s, e) => s + Number(e.spend || 0), 0);
        const totalSpend = spendProductAds + spendGlobalAds;

        // Count: product ads = row count; global ads = distinct campaign ids
        const productCampaignCount = filteredProductAds.length;
        const globalCampaignCount = new Set(
            filteredEntries.map(e => e.campaign_id).filter((x): x is string => !!x)
        ).size;
        const campaignCount = productCampaignCount + globalCampaignCount;

        const orders = allOrders as AdsOrderForMatching[];

        // Order classification using the SHARED status category hook (no more hardcoded codes/labels).
        const classify = (o: AdsOrderForMatching) => {
            const isDelivered = !!(o.package_status_id && deliveredPkgIds.has(o.package_status_id));
            const isConfirmed = isDelivered || !!(o.order_status_id && confirmedIds.has(o.order_status_id));
            return { isDelivered, isConfirmed };
        };

        // ── Attribution: match orders to each ad source ─────────────
        // Shared dedupe set so an order that matches both a product ad and a global campaign
        // only counts once toward totalOrders / totalConfirmed / totalDelivered / totalGrossRevenue.
        const seenOrderIds = new Set<string>();
        let totalOrders = 0;
        let totalConfirmed = 0;
        let totalDelivered = 0;
        let totalGrossRevenue = 0;

        const recordOrder = (o: AdsOrderForMatching) => {
            if (seenOrderIds.has(o.id)) return;
            seenOrderIds.add(o.id);
            totalOrders++;
            const { isDelivered, isConfirmed } = classify(o);
            if (isDelivered) {
                totalDelivered++;
                totalGrossRevenue += Number(o.price || 0);
            }
            if (isConfirmed) totalConfirmed++;
        };

        // ── Product-ad matcher: source + in ad date range + order contains product_id ──
        const matchProductAd = (o: AdsOrderForMatching, src: string, start: Date, end: Date, productId: string | null): boolean => {
            if (!src) return false;
            if ((o.source_name || '').toLowerCase() !== src) return false;
            const odate = new Date(o.date || 0);
            if (odate < start || odate > end) return false;
            if (productId) {
                return !!o.order_items?.some(item => item.product_id === productId);
            }
            return true;
        };

        // ── Global-ad matcher: source + same day as entry (no product filter) ──
        const matchGlobalEntry = (o: AdsOrderForMatching, src: string, entryDate: string): boolean => {
            if (!src) return false;
            if ((o.source_name || '').toLowerCase() !== src) return false;
            const odate = (o.date || '').slice(0, 10);
            return odate === entryDate;
        };

        // ── Platform breakdown accumulator (combines both sources) ──
        type PlatformBucket = {
            spend: number;
            orderIds: Set<string>;
            delivered: number;
            revenue: number;
            productCount: number;
            globalCount: number;
        };
        const platformBreakdown: Record<string, PlatformBucket> = {};
        const bucket = (platform: string): PlatformBucket => {
            if (!platformBreakdown[platform]) {
                platformBreakdown[platform] = {
                    spend: 0, orderIds: new Set(), delivered: 0, revenue: 0,
                    productCount: 0, globalCount: 0,
                };
            }
            return platformBreakdown[platform];
        };

        // Product ads → attribute orders + update buckets
        filteredProductAds.forEach(ad => {
            const platform = ad.method || 'Other';
            const src = PLATFORM_SOURCE_MAP[(ad.method || '').toLowerCase()] || '';
            const cStart = new Date(ad.start_date);
            const cEnd = new Date(ad.end_date);
            cEnd.setHours(23, 59, 59, 999);

            const b = bucket(platform);
            b.spend += Number(ad.amount || 0);
            b.productCount++;

            orders.forEach(o => {
                if (!matchProductAd(o, src, cStart, cEnd, ad.product_id)) return;
                recordOrder(o);
                if (!b.orderIds.has(o.id)) {
                    b.orderIds.add(o.id);
                    const { isDelivered } = classify(o);
                    if (isDelivered) {
                        b.delivered++;
                        b.revenue += Number(o.price || 0);
                    }
                }
            });
        });

        // Global ads (campaign entries) → same treatment
        const campaignCountedIntoPlatform = new Set<string>(); // dedupe distinct-campaign count per platform
        filteredEntries.forEach(entry => {
            const platform = entry.platform || 'Other';
            const src = PLATFORM_SOURCE_MAP[(entry.platform || '').toLowerCase()] || '';
            const b = bucket(platform);
            b.spend += Number(entry.spend || 0);
            if (entry.campaign_id && !campaignCountedIntoPlatform.has(entry.campaign_id)) {
                campaignCountedIntoPlatform.add(entry.campaign_id);
                b.globalCount++;
            }

            orders.forEach(o => {
                if (!matchGlobalEntry(o, src, entry.entry_date)) return;
                recordOrder(o);
                if (!b.orderIds.has(o.id)) {
                    b.orderIds.add(o.id);
                    const { isDelivered } = classify(o);
                    if (isDelivered) {
                        b.delivered++;
                        b.revenue += Number(o.price || 0);
                    }
                }
            });
        });

        const roas = totalSpend > 0 ? totalGrossRevenue / totalSpend : 0;
        const costPerOrder = totalOrders > 0 ? totalSpend / totalOrders : 0;
        const costPerDelivered = totalDelivered > 0 ? totalSpend / totalDelivered : 0;

        const platformData = Object.entries(platformBreakdown)
            .map(([platform, data]) => ({
                platform,
                spend: data.spend,
                orders: data.orderIds.size,
                delivered: data.delivered,
                revenue: data.revenue,
                count: data.productCount + data.globalCount,
                productCount: data.productCount,
                globalCount: data.globalCount,
                cpd: data.delivered > 0 ? data.spend / data.delivered : 0,
                roas: data.spend > 0 ? data.revenue / data.spend : 0,
                color: PLATFORM_COLORS[platform] || '#6B7280',
            }))
            .sort((a, b) => b.spend - a.spend);

        // ── Monthly trend (combines both sources) ──
        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0);
            mEnd.setHours(23, 59, 59, 999);
            const inMonth = (d: Date) => d >= mStart && d <= mEnd;

            // Spend this month from both sources.
            const monthProductAds = filteredProductAds.filter(a => a.start_date && inMonth(new Date(a.start_date)));
            const monthEntries = filteredEntries.filter(e => inMonth(new Date(e.entry_date)));
            const monthSpend =
                monthProductAds.reduce((s, a) => s + Number(a.amount || 0), 0) +
                monthEntries.reduce((s, e) => s + Number(e.spend || 0), 0);

            // Revenue this month — dedupe across ad rows within the month only.
            const monthSeen = new Set<string>();
            let monthRevenue = 0;

            monthProductAds.forEach(ad => {
                const src = PLATFORM_SOURCE_MAP[(ad.method || '').toLowerCase()] || '';
                const cStart = new Date(ad.start_date);
                const cEnd = new Date(ad.end_date);
                cEnd.setHours(23, 59, 59, 999);
                orders.forEach(o => {
                    if (!matchProductAd(o, src, cStart, cEnd, ad.product_id)) return;
                    if (monthSeen.has(o.id)) return;
                    const { isDelivered } = classify(o);
                    if (!isDelivered) return;
                    monthSeen.add(o.id);
                    monthRevenue += Number(o.price || 0);
                });
            });

            monthEntries.forEach(entry => {
                const src = PLATFORM_SOURCE_MAP[(entry.platform || '').toLowerCase()] || '';
                orders.forEach(o => {
                    if (!matchGlobalEntry(o, src, entry.entry_date)) return;
                    if (monthSeen.has(o.id)) return;
                    const { isDelivered } = classify(o);
                    if (!isDelivered) return;
                    monthSeen.add(o.id);
                    monthRevenue += Number(o.price || 0);
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
            totalSpend,
            spendProductAds,
            spendGlobalAds,
            totalOrders, totalConfirmed, totalDelivered,
            totalGrossRevenue, roas, costPerOrder, costPerDelivered,
            campaignCount,
            productCampaignCount,
            globalCampaignCount,
            platformData, trendData,
        };
    }, [adsHistory, campaignEntries, allOrders, dateFilter, confirmedIds, deliveredPkgIds]);

    // Expose campaignRows to satisfy linter usage (campaign names could be reused later in the UI).
    void campaignRows;

    return (
        <SectionWrapper
            id="ads"
            title="Advertising & Campaigns"
            description="Combined product ads + global (media-buyer) ads. ROAS and delivery metrics auto-computed from attributed orders."
            icon={Megaphone}
            iconBg="bg-pink-50"
            iconColor="text-pink-600"
            loading={isLoading}
        >
            {metrics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                        <StatCard
                            title="Total Spend"
                            value={metrics.totalSpend.toLocaleString('fr-MA')}
                            suffix=" MAD"
                            subtitle={`Product ${metrics.spendProductAds.toLocaleString('fr-MA')} · Global ${metrics.spendGlobalAds.toLocaleString('fr-MA')}`}
                            icon={DollarSign}
                            iconBg="bg-pink-50"
                            iconColor="text-pink-600"
                        />
                        <StatCard
                            title="Campaigns"
                            value={metrics.campaignCount}
                            subtitle={`${metrics.productCampaignCount} product · ${metrics.globalCampaignCount} global`}
                            icon={Megaphone}
                            iconBg="bg-purple-50"
                            iconColor="text-purple-600"
                        />
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
                                                <div className="text-xs text-gray-400">
                                                    {p.productCount > 0 && <span>{p.productCount} product</span>}
                                                    {p.productCount > 0 && p.globalCount > 0 && <span> · </span>}
                                                    {p.globalCount > 0 && <span>{p.globalCount} global</span>}
                                                    <span> · {p.orders} orders</span>
                                                </div>
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
