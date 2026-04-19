import { useState } from 'react';
import { AnalyticsDateFilter, DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { DashboardKPICards } from '@/components/dashboard/DashboardKPICards';
import { SalesComparatifChart } from '@/components/dashboard/SalesComparatifChart';
import { PendingOrdersBreakdown } from '@/components/dashboard/PendingOrdersBreakdown';
import { ConfirmationPipeline } from '@/components/dashboard/ConfirmationPipeline';
import { ShippingPipeline } from '@/components/dashboard/ShippingPipeline';
import { DashboardSellersPerformance } from '@/components/dashboard/DashboardSellersPerformance';
import { DashboardProductsPerformance } from '@/components/dashboard/DashboardProductsPerformance';
import { DashboardCityStats } from '@/components/dashboard/DashboardCityStats';
import { WhatsAppUnreadCard } from '@/components/dashboard/WhatsAppUnreadCard';

const Dashboard = () => {
    const businessId = localStorage.getItem('activeBusinessId') || '';

    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    if (!businessId) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <p className="text-gray-400 text-sm">No business selected.</p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-2.5">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                        Dashboard
                    </h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                        {dateFilter.label}
                    </p>
                </div>
                <AnalyticsDateFilter dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
            </header>

            <DashboardKPICards businessId={businessId} dateFilter={dateFilter} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 items-stretch">
                <div className="lg:col-span-1 flex min-w-0">
                    <WhatsAppUnreadCard businessId={businessId} />
                </div>
                <div className="lg:col-span-2 min-w-0 [&>div]:h-full [&>div]:w-full">
                    <SalesComparatifChart businessId={businessId} dateFilter={dateFilter} />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                <PendingOrdersBreakdown businessId={businessId} dateFilter={dateFilter} />
                <ConfirmationPipeline businessId={businessId} dateFilter={dateFilter} />
            </div>

            <ShippingPipeline businessId={businessId} dateFilter={dateFilter} />
            <DashboardSellersPerformance businessId={businessId} dateFilter={dateFilter} />
            <DashboardProductsPerformance businessId={businessId} dateFilter={dateFilter} />
            <DashboardCityStats businessId={businessId} dateFilter={dateFilter} />
        </div>
    );
};

export default Dashboard;
