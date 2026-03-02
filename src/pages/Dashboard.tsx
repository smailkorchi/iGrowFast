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
        <div className="min-h-screen">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Dashboard</h1>
                            <p className="text-gray-500 font-light">Command center overview</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <AnalyticsDateFilter dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="py-6 space-y-6">
                {/* KPI Cards */}
                <DashboardKPICards businessId={businessId} dateFilter={dateFilter} />

                {/* Sales Chart */}
                <SalesComparatifChart businessId={businessId} dateFilter={dateFilter} />

                {/* Pipeline Row: Pending + Confirmation */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <PendingOrdersBreakdown businessId={businessId} dateFilter={dateFilter} />
                    <ConfirmationPipeline businessId={businessId} dateFilter={dateFilter} />
                </div>

                {/* Shipping Pipeline */}
                <ShippingPipeline businessId={businessId} dateFilter={dateFilter} />

                {/* Sellers Performance */}
                <DashboardSellersPerformance businessId={businessId} dateFilter={dateFilter} />

                {/* Products Performance */}
                <DashboardProductsPerformance businessId={businessId} dateFilter={dateFilter} />

                {/* City Statistics */}
                <DashboardCityStats businessId={businessId} dateFilter={dateFilter} />
            </div>
        </div>
    );
};

export default Dashboard;
