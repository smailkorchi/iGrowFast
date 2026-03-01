import { useState } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard } from 'lucide-react';
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
            <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-brand-navy/5">
                <div className="py-4">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-3"
                        >
                            <div className="w-11 h-11 rounded-2xl bg-brand-navy flex items-center justify-center">
                                <LayoutDashboard className="w-5.5 h-5.5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-brand-navy tracking-tight">
                                    Dashboard
                                </h1>
                                <p className="text-xs text-gray-400">
                                    Command center overview
                                </p>
                            </div>
                        </motion.div>
                        <AnalyticsDateFilter dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
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
