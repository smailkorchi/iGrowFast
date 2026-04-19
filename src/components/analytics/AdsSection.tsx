import { useMemo, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SectionWrapper } from './SectionWrapper';
import { SectionStory } from './SectionStory';
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
import { format, startOfDay, endOfDay, eachMonthOfInterval, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
    AnalyticsOrder,
    adSpendInWindow,
    deliveredRevenueForOrder,
    inWindow,
    isDelivered as isDeliveredHelper,
    normalizeSource,
    overlapFraction,
    placementTimestamp,
} from '@/lib/analyticsDefinitions';

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
                .eq('DigiCom Business', businessId)
                .is('date_deleted', null);
            return (data || []) as AdsOrderForMatching[];
        },
        enabled: !!businessId,
    });

    const isLoading = loadingAds || loadingEntries;

    const metrics = useMemo(() => {
        if (!adsHistory || !allOrders) return null;

        const windowStart = dateFilter.from ? startOfDay(dateFilter.from) : new Date(0);
        const windowEnd = dateFilter.to ? endOfDay(dateFilter.to) : new Date();

        // ── Filter both sources — product ads use overlap math; campaign entries are daily rows.
        //    Keep every ad whose [start, end] touches the window at all so per-ad attribution
        //    works even when start_date is before the window.
        const filteredProductAds = adsHistory.filter(a => {
            const s = a.start_date ? new Date(a.start_date) : null;
            const e = a.end_date ? new Date(a.end_date) : s;
            return overlapFraction(s, e, windowStart, windowEnd) > 0;
        });
        const filteredEntries = campaignEntries.filter(e => {
            if (!e.entry_date) return false;
            const d = new Date(e.entry_date);
            return !Number.isNaN(d.getTime()) && inWindow(d, windowStart, windowEnd);
        });

        // ── Spend totals — product ads pro-rated by overlap. ────────
        const spendProductAds = filteredProductAds.reduce(
            (s, a) => s + adSpendInWindow(a, windowStart, windowEnd),
            0,
        );
        const spendGlobalAds = filteredEntries.reduce((s, e) => s + Number(e.spend || 0), 0);
        const totalSpend = spendProductAds + spendGlobalAds;

        // Count: product ads = row count; global ads = distinct campaign ids
        const productCampaignCount = filteredProductAds.length;
        const globalCampaignCount = new Set(
            filteredEntries.map(e => e.campaign_id).filter((x): x is string => !!x)
        ).size;
        const campaignCount = productCampaignCount + globalCampaignCount;

        const orders = allOrders as unknown as (AdsOrderForMatching & AnalyticsOrder)[];

        // Shared classification helpers. Delivered uses label OR category (consistent with
        // seller_daily_earnings). Confirmed includes the tracking-number short-circuit.
        const classify = (o: AnalyticsOrder) => {
            const isDelivered = isDeliveredHelper(o, deliveredPkgIds);
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

        const recordOrder = (o: AnalyticsOrder & { id: string }) => {
            if (seenOrderIds.has(o.id)) return;
            seenOrderIds.add(o.id);
            totalOrders++;
            const { isDelivered, isConfirmed } = classify(o);
            if (isDelivered) {
                totalDelivered++;
                // ROAS uses delivered revenue (paid or not), product-only (shipping stripped).
                totalGrossRevenue += deliveredRevenueForOrder(o);
            }
            if (isConfirmed) totalConfirmed++;
        };

        // ── Product-ad matcher: normalized source + in ad date range + order contains product_id ──
        const matchProductAd = (o: AnalyticsOrder, src: string, start: Date, end: Date, productId: string | null): boolean => {
            if (!src) return false;
            if (normalizeSource(o.source_name) !== src) return false;
            const odate = placementTimestamp(o);
            if (!odate || odate < start || odate > end) return false;
            if (productId) {
                return !!o.order_items?.some(item => item.product_id === productId);
            }
            return true;
        };

        // ── Global-ad matcher: normalized source + same day as entry (no product filter) ──
        const matchGlobalEntry = (o: AnalyticsOrder, src: string, entryDate: string): boolean => {
            if (!src) return false;
            if (normalizeSource(o.source_name) !== src) return false;
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

        // Product ads → attribute orders + update buckets (spend pro-rated by window overlap)
        filteredProductAds.forEach(ad => {
            const platform = ad.method || 'Other';
            const src = normalizeSource(ad.method);
            const cStart = new Date(ad.start_date);
            const cEnd = new Date(ad.end_date);
            cEnd.setHours(23, 59, 59, 999);

            const b = bucket(platform);
            b.spend += adSpendInWindow(ad, windowStart, windowEnd);
            b.productCount++;

            orders.forEach(o => {
                if (!matchProductAd(o, src, cStart, cEnd, ad.product_id)) return;
                recordOrder(o);
                if (!b.orderIds.has(o.id)) {
                    b.orderIds.add(o.id);
                    const { isDelivered } = classify(o);
                    if (isDelivered) {
                        b.delivered++;
                        b.revenue += deliveredRevenueForOrder(o);
                    }
                }
            });
        });

        // Global ads (campaign entries) → same treatment
        const campaignCountedIntoPlatform = new Set<string>();
        filteredEntries.forEach(entry => {
            const platform = entry.platform || 'Other';
            const src = normalizeSource(entry.platform);
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
                        b.revenue += deliveredRevenueForOrder(o);
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
                color: PLATFORM_COLORS[platform] || '#6b6a63',
            }))
            .sort((a, b) => b.spend - a.spend);

        // ── Monthly trend (combines both sources) ──
        const rangeStart = dateFilter.from || subMonths(new Date(), 6);
        const rangeEnd = dateFilter.to || new Date();
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });

        const trendData = months.map(month => {
            const mStart = startOfMonth(month);
            const mEnd = endOfMonth(month);

            // Spend this month from both sources — product ads pro-rated by month overlap.
            const monthProductAds = filteredProductAds.filter(a => {
                const s = a.start_date ? new Date(a.start_date) : null;
                const e = a.end_date ? new Date(a.end_date) : s;
                return overlapFraction(s, e, mStart, mEnd) > 0;
            });
            const monthEntries = filteredEntries.filter(e => {
                if (!e.entry_date) return false;
                const d = new Date(e.entry_date);
                return !Number.isNaN(d.getTime()) && inWindow(d, mStart, mEnd);
            });
            const monthSpend =
                monthProductAds.reduce((s, a) => s + adSpendInWindow(a, mStart, mEnd), 0) +
                monthEntries.reduce((s, e) => s + Number(e.spend || 0), 0);

            // Revenue this month — dedupe orders across ad rows within the month.
            const monthSeen = new Set<string>();
            let monthRevenue = 0;

            monthProductAds.forEach(ad => {
                const src = normalizeSource(ad.method);
                const cStart = new Date(ad.start_date);
                const cEnd = new Date(ad.end_date);
                cEnd.setHours(23, 59, 59, 999);
                orders.forEach(o => {
                    if (!matchProductAd(o, src, cStart, cEnd, ad.product_id)) return;
                    if (monthSeen.has(o.id)) return;
                    const { isDelivered } = classify(o);
                    if (!isDelivered) return;
                    monthSeen.add(o.id);
                    monthRevenue += deliveredRevenueForOrder(o);
                });
            });

            monthEntries.forEach(entry => {
                const src = normalizeSource(entry.platform);
                orders.forEach(o => {
                    if (!matchGlobalEntry(o, src, entry.entry_date)) return;
                    if (monthSeen.has(o.id)) return;
                    const { isDelivered } = classify(o);
                    if (!isDelivered) return;
                    monthSeen.add(o.id);
                    monthRevenue += deliveredRevenueForOrder(o);
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
            description="Product ads + campaign ads. Spend pro-rated by window overlap. ROAS uses delivered revenue (paid or not)."
            icon={Megaphone}
            iconColor="text-ant-mid"
            loading={isLoading}
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
