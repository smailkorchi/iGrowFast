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

interface DashboardContentProps {
    businessId: string;
}

export const DashboardContent = ({ businessId }: DashboardContentProps) => {
    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    return (
        <div className="min-h-screen">
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

            <div className="py-6 space-y-6">
                <DashboardKPICards businessId={businessId} dateFilter={dateFilter} />
                <SalesComparatifChart businessId={businessId} dateFilter={dateFilter} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <PendingOrdersBreakdown businessId={businessId} dateFilter={dateFilter} />
                    <ConfirmationPipeline businessId={businessId} dateFilter={dateFilter} />
                </div>
                <ShippingPipeline businessId={businessId} dateFilter={dateFilter} />
                <DashboardSellersPerformance businessId={businessId} dateFilter={dateFilter} />
                <DashboardProductsPerformance businessId={businessId} dateFilter={dateFilter} />
                <DashboardCityStats businessId={businessId} dateFilter={dateFilter} />
            </div>
        </div>
    );
};
