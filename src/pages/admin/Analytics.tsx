import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    BarChart3, DollarSign, ShoppingBag, Megaphone, Truck,
    PackageOpen, Radio, Users, UserCheck, Bike, Radar, Activity,
} from 'lucide-react';
import { AnalyticsDateFilter, DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { ProfitabilitySection, type ProfitabilitySlice } from '@/components/analytics/ProfitabilitySection';
import { OrdersSection, type OrdersSlice } from '@/components/analytics/OrdersSection';
import { AdsSection, type AdsSlice } from '@/components/analytics/AdsSection';
import { ShippingSection, type ShippingSlice } from '@/components/analytics/ShippingSection';
import { InventorySection, type InventorySlice } from '@/components/analytics/InventorySection';
import { SalesChannelsSection, type ChannelsSlice } from '@/components/analytics/SalesChannelsSection';
import { CustomersSection, type CustomersSlice } from '@/components/analytics/CustomersSection';
import { SellersSection, type SellersSlice } from '@/components/analytics/SellersSection';
import { CouriersSection, type CouriersSlice } from '@/components/analytics/CouriersSection';
import { MediaBuyersSection, type MediaBuyersSlice } from '@/components/analytics/MediaBuyersSection';
import { UsersSection, type UsersSlice } from '@/components/analytics/UsersSection';
import { BusinessHealthSection, type HealthSlice } from '@/components/analytics/BusinessHealthSection';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

/**
 * ONE jsonb payload with a keyed section per page section — the
 * admin_analytics_stats RPC (D3, mig 20260715010000) replaces the 10 full
 * all-time `orders` copies (+ a full order_items copy + 2 parcel dumps + a
 * dozen satellite bare selects) this page fired on every mount/focus. The
 * window travels as yyyy-MM-dd (null = all-time); Casablanca day boundaries
 * are resolved server-side. Trends arrive as day-bucketed Casablanca arrays
 * and each section re-buckets them to its own grain (D2 sales_chart
 * precedent). Invalidation rides the EcomBizRealtime ['analytics-stats']
 * prefix (debounced order/parcel events).
 *
 * `users` is window-independent by design (its 30-day activity rule runs on
 * now() inside the fn) but rides the same payload — one call per page.
 */
export interface AdminAnalyticsStats {
    profitability: ProfitabilitySlice;
    health: HealthSlice;
    orders: OrdersSlice;
    ads: AdsSlice;
    shipping: ShippingSlice;
    inventory: InventorySlice;
    channels: ChannelsSlice;
    customers: CustomersSlice;
    sellers: SellersSlice;
    couriers: CouriersSlice;
    mediabuyers: MediaBuyersSlice;
    users: UsersSlice;
}

const SECTIONS = [
    { id: 'profitability', label: 'P&L', icon: DollarSign },
    { id: 'business-health', label: 'Health', icon: Activity },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'shipping', label: 'Shipping', icon: Truck },
    { id: 'inventory', label: 'Inventory', icon: PackageOpen },
    { id: 'channels', label: 'Channels', icon: Radio },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'sellers', label: 'Sellers', icon: UserCheck },
    { id: 'couriers', label: 'Couriers', icon: Bike },
    { id: 'mediabuyers', label: 'Media Buyers', icon: Radar },
    { id: 'users', label: 'Users', icon: Users },
];

const Analytics = () => {
    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    const businessId = localStorage.getItem('activeBusinessId') || '';
    const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
    const navScrollRef = useRef<HTMLDivElement>(null);

    const fromKey = dateFilter.from ? format(dateFilter.from, 'yyyy-MM-dd') : null;
    const toKey = dateFilter.to ? format(dateFilter.to, 'yyyy-MM-dd') : null;

    const { data: stats, isError, error, refetch, isFetching } = useQuery({
        queryKey: ['analytics-stats', businessId, fromKey, toKey],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('admin_analytics_stats', {
                p_business: businessId,
                p_from: fromKey,
                p_to: toKey,
            });
            if (error) throw error;
            return data as AdminAnalyticsStats;
        },
        enabled: !!businessId,
        staleTime: 60_000,
    });

    // A failed RPC must NOT leave every section as a permanent skeleton: the
    // sections gate on `!stats`, which never resolves on error. Surface the
    // failure with a retry instead (D3 review).
    const statsFailed = isError && !stats;

    // Scroll-spy: watch every section and set `activeSection` to the one whose
    // top is closest to (but still below) the sticky nav row. Uses a single
    // observer with a root margin that only leaves a thin "trigger line" near
    // the top of the viewport, so only the section currently under the nav
    // reports as intersecting. This avoids the taller-section-wins bug and the
    // rapid-flip behaviour that was scrolling the window on every change.
    useEffect(() => {
        const visibility = new Map<string, boolean>();

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    visibility.set(e.target.id, e.isIntersecting);
                });
                // Pick the first section (in document order) that is currently
                // crossing the trigger line.
                const current = SECTIONS.find(({ id }) => visibility.get(id));
                if (current) {
                    setActiveSection((prev) => (prev === current.id ? prev : current.id));
                }
            },
            {
                // Trigger line sits just below the sticky nav (~160px from top).
                // The bottom margin is huge so only the section crossing the top
                // trigger line intersects at any given moment.
                rootMargin: '-160px 0px -85% 0px',
                threshold: 0,
            },
        );

        SECTIONS.forEach(({ id }) => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [businessId]);

    // When active chip changes, keep it in view inside the horizontal nav
    // container. Manipulates only the rail's scrollLeft so it never propagates
    // to the window (scrollIntoView walks every scrollable ancestor, which was
    // jumping the page to the top when the first chip was already at the edge).
    useEffect(() => {
        const rail = navScrollRef.current;
        if (!rail) return;
        const activeEl = rail.querySelector<HTMLAnchorElement>(`a[data-section-id="${activeSection}"]`);
        if (!activeEl) return;
        const railRect = rail.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        const overflowLeft = railRect.left - elRect.left;
        const overflowRight = elRect.right - railRect.right;
        if (overflowLeft > -8 && overflowRight < -8) return; // fully in view
        const targetLeft =
            rail.scrollLeft + (elRect.left - railRect.left) - rail.clientWidth / 2 + activeEl.clientWidth / 2;
        rail.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }, [activeSection]);

    const scrollToSection = useCallback((id: string) => {
        const el = document.getElementById(id);
        if (!el) return;
        const y = el.getBoundingClientRect().top + window.scrollY - 156;
        window.scrollTo({ top: y, behavior: 'smooth' });
    }, []);

    if (!businessId) {
        return (
            <div className="ant-surface flex items-center justify-center h-[60vh]">
                <div className="text-center">
                    <BarChart3 className="w-12 h-12 text-ant-mid mx-auto mb-4" strokeWidth={1.5} />
                    <h2 className="font-display text-[22px] font-semibold text-ant-ink mb-1 tracking-tight">No business selected</h2>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">Select a business to view analytics.</p>
                </div>
            </div>
        );
    }

    // Every section renders a skeleton while `stats` is undefined — on a failed
    // RPC that never resolves, so a visible failure + retry replaces the wall.
    if (statsFailed) {
        return (
            <div className="ant-surface flex items-center justify-center h-[60vh]">
                <div className="text-center max-w-md px-6">
                    <BarChart3 className="w-12 h-12 text-ant-mid mx-auto mb-4" strokeWidth={1.5} />
                    <h2 className="font-display text-[22px] font-semibold text-ant-ink mb-1 tracking-tight">
                        Analytics indisponibles
                    </h2>
                    <p className="font-serif-display text-[13px] text-ant-muted italic mb-4">
                        {(error as Error)?.message || 'Le chargement des statistiques a échoué.'}
                    </p>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        className="inline-flex items-center gap-2 rounded-xl border border-ant-line bg-ant-paper px-4 py-2 text-[12px] font-semibold text-ant-ink hover:bg-ant-light disabled:opacity-60"
                    >
                        {isFetching ? 'Chargement…' : 'Réessayer'}
                    </button>
                </div>
            </div>
        );
    }

    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <div className="ant-surface px-2 md:px-3 py-2 space-y-4">
            {/* Editorial header */}
            <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
                <div className="space-y-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                        <span className="w-1 h-1 rounded-full bg-ant-orange" />
                        {today}
                    </span>
                    <h1 className="font-display text-[30px] md:text-[34px] font-semibold text-ant-ink leading-[1.05] tracking-[-0.02em]">
                        Analytics
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        {SECTIONS.length} sections · viewing{' '}
                        <span className="not-italic font-medium text-ant-ink">{dateFilter.label}</span>
                    </p>
                </div>
                <AnalyticsDateFilter
                    dateFilter={dateFilter}
                    onDateFilterChange={setDateFilter}
                    variant="ant"
                />
            </header>

            {/* Sticky scroll-spy nav rail */}
            <nav className="sticky top-0 z-30 -mx-2 md:-mx-3 px-2 md:px-3 bg-ant-light/92 backdrop-blur-md border-b border-ant-line">
                <div
                    ref={navScrollRef}
                    // `flex-wrap` drops pills onto a second line on narrow
                    // viewports instead of hiding the last ones behind a
                    // horizontal scroll. `justify-between` spaces them to
                    // fill the row evenly when they fit in one line.
                    className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-1 py-2"
                >
                    {SECTIONS.map((section, i) => {
                        const isActive = activeSection === section.id;
                        return (
                            <a
                                key={section.id}
                                data-section-id={section.id}
                                href={`#${section.id}`}
                                onClick={(e) => {
                                    e.preventDefault();
                                    scrollToSection(section.id);
                                }}
                                className={cn(
                                    'group relative inline-flex items-center gap-1 rounded-full h-7 px-2.5 text-[11px] font-medium whitespace-nowrap shrink-0 transition-all border',
                                    isActive
                                        ? 'bg-ant-ink text-ant-light border-ant-ink'
                                        : 'bg-transparent text-ant-muted border-ant-line hover:border-ant-ink/30 hover:text-ant-ink',
                                )}
                            >
                                <span
                                    className={cn(
                                        'tabular-nums text-[9px] font-semibold tracking-[0.08em]',
                                        isActive ? 'text-ant-orange' : 'text-ant-mid',
                                    )}
                                >
                                    {String(i + 1).padStart(2, '0')}
                                </span>
                                <section.icon className="w-3 h-3" />
                                {section.label}
                            </a>
                        );
                    })}
                </div>
            </nav>

            {/* Sections — scroll-margin so anchor jumps clear the sticky nav row */}
            <div className="space-y-4 [&>section]:scroll-mt-[160px]">
                <ProfitabilitySection businessId={businessId} dateFilter={dateFilter} stats={stats?.profitability} />
                <BusinessHealthSection dateFilter={dateFilter} stats={stats?.health} />
                <OrdersSection dateFilter={dateFilter} stats={stats?.orders} />
                <AdsSection businessId={businessId} dateFilter={dateFilter} stats={stats?.ads} />
                <ShippingSection businessId={businessId} dateFilter={dateFilter} stats={stats?.shipping} />
                <InventorySection businessId={businessId} dateFilter={dateFilter} stats={stats?.inventory} />
                <SalesChannelsSection dateFilter={dateFilter} stats={stats?.channels} />
                <CustomersSection dateFilter={dateFilter} stats={stats?.customers} />
                <SellersSection businessId={businessId} dateFilter={dateFilter} stats={stats?.sellers} />
                <CouriersSection businessId={businessId} dateFilter={dateFilter} stats={stats?.couriers} />
                <MediaBuyersSection businessId={businessId} dateFilter={dateFilter} stats={stats?.mediabuyers} />
                <UsersSection stats={stats?.users} />
            </div>
        </div>
    );
};

export default Analytics;
