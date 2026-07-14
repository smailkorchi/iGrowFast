import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AnalyticsDateFilter, DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { DashboardKPICards, type KpiCardsSection } from '@/components/dashboard/DashboardKPICards';
import { SalesComparatifChart, type SalesChartSection } from '@/components/dashboard/SalesComparatifChart';
import { PendingOrdersBreakdown, type PendingBreakdownSection } from '@/components/dashboard/PendingOrdersBreakdown';
import { ConfirmationPipeline, type ConfirmationPipelineSection } from '@/components/dashboard/ConfirmationPipeline';
import { ShippingPipeline, type ShippingPipelineSection } from '@/components/dashboard/ShippingPipeline';
import { DashboardSellersPerformance, type SellersPerformanceSection } from '@/components/dashboard/DashboardSellersPerformance';
import { DashboardProductsPerformance, type ProductsPerformanceSection } from '@/components/dashboard/DashboardProductsPerformance';
import { DashboardCityStats, type CityStatsSection } from '@/components/dashboard/DashboardCityStats';
import { format } from 'date-fns';

/**
 * One jsonb payload with a keyed section per widget — the admin_dashboard_stats
 * RPC (D2, mig 20260714230000) replaces the 8 independent full-history orders
 * downloads (+ full order_items + full parcels ×2) this page used to fire on
 * every mount/focus. The window travels as yyyy-MM-dd (null = all-time);
 * Casablanca day boundaries are resolved server-side. Invalidation rides the
 * EcomBizRealtime ['dash-stats'] prefix (debounced order/parcel events).
 */
interface AdminDashboardStats {
    kpi_cards: KpiCardsSection;
    sales_chart: SalesChartSection;
    pending_breakdown: PendingBreakdownSection;
    confirmation_pipeline: ConfirmationPipelineSection;
    shipping_pipeline: ShippingPipelineSection;
    city_stats: CityStatsSection;
    sellers_performance: SellersPerformanceSection;
    products_performance: ProductsPerformanceSection;
}

const Dashboard = () => {
    const businessId = localStorage.getItem('activeBusinessId') || '';

    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    const fromKey = dateFilter.from ? format(dateFilter.from, 'yyyy-MM-dd') : null;
    const toKey = dateFilter.to ? format(dateFilter.to, 'yyyy-MM-dd') : null;

    const { data: stats } = useQuery({
        queryKey: ['dash-stats', 'admin', businessId, fromKey, toKey],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('admin_dashboard_stats', {
                p_business: businessId,
                p_from: fromKey,
                p_to: toKey,
            });
            if (error) throw error;
            return data as AdminDashboardStats;
        },
        enabled: !!businessId,
        staleTime: 60_000,
    });

    if (!businessId) {
        return (
            <div className="ant-surface flex items-center justify-center h-[60vh]">
                <p className="text-ant-mid text-sm">No business selected.</p>
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
                        Dashboard
                    </h1>
                    <p className="font-serif-display text-[13px] text-ant-muted italic">
                        Viewing <span className="not-italic font-medium text-ant-ink">{dateFilter.label}</span>
                    </p>
                </div>
                <AnalyticsDateFilter
                    dateFilter={dateFilter}
                    onDateFilterChange={setDateFilter}
                    variant="ant"
                />
            </header>

            <div className="h-px bg-ant-line" />

            <DashboardKPICards stats={stats?.kpi_cards} />

            <SalesComparatifChart businessId={businessId} dateFilter={dateFilter} stats={stats?.sales_chart} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <PendingOrdersBreakdown stats={stats?.pending_breakdown} />
                <ConfirmationPipeline stats={stats?.confirmation_pipeline} />
            </div>

            <ShippingPipeline businessId={businessId} stats={stats?.shipping_pipeline} />
            <DashboardSellersPerformance businessId={businessId} stats={stats?.sellers_performance} />
            <DashboardProductsPerformance businessId={businessId} stats={stats?.products_performance} />
            <DashboardCityStats stats={stats?.city_stats} />
        </div>
    );
};

export default Dashboard;
