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
import { format } from 'date-fns';

const Dashboard = () => {
    const businessId = localStorage.getItem('activeBusinessId') || '';

    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
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

            <DashboardKPICards businessId={businessId} dateFilter={dateFilter} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
                <div className="lg:col-span-1 flex min-w-0">
                    <WhatsAppUnreadCard businessId={businessId} />
                </div>
                <div className="lg:col-span-2 min-w-0 [&>div]:h-full [&>div]:w-full">
                    <SalesComparatifChart businessId={businessId} dateFilter={dateFilter} />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
