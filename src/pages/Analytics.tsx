import { useState, useRef } from 'react';
import {
    BarChart3, DollarSign, ShoppingBag, Megaphone, Truck,
    PackageOpen, Radio, Users, UserCheck, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnalyticsDateFilter, DateFilter } from '@/components/analytics/AnalyticsDateFilter';
import { ProfitabilitySection } from '@/components/analytics/ProfitabilitySection';
import { OrdersSection } from '@/components/analytics/OrdersSection';
import { AdsSection } from '@/components/analytics/AdsSection';
import { ShippingSection } from '@/components/analytics/ShippingSection';
import { InventorySection } from '@/components/analytics/InventorySection';
import { SalesChannelsSection } from '@/components/analytics/SalesChannelsSection';
import { CustomersSection } from '@/components/analytics/CustomersSection';
import { SellersSection } from '@/components/analytics/SellersSection';
import { UsersSection } from '@/components/analytics/UsersSection';
import { BusinessHealthSection } from '@/components/analytics/BusinessHealthSection';

const SECTIONS = [
    { id: 'profitability', label: 'P&L', icon: DollarSign },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'shipping', label: 'Shipping', icon: Truck },
    { id: 'inventory', label: 'Inventory', icon: PackageOpen },
    { id: 'channels', label: 'Channels', icon: Radio },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'sellers', label: 'Sellers', icon: UserCheck },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'business-health', label: 'Health', icon: Activity },
];

const Analytics = () => {
    const [dateFilter, setDateFilter] = useState<DateFilter>({
        from: undefined,
        to: undefined,
        label: 'All Time',
    });

    const businessId = localStorage.getItem('activeBusinessId') || '';
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const scrollToSection = (id: string) => {
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    if (!businessId) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="text-center">
                    <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-brand-navy mb-2">No Business Selected</h2>
                    <p className="text-gray-400">Select a business to view analytics.</p>
                </div>
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
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Analytics War Room</h1>
                            <p className="text-gray-500 font-light">Complete business intelligence across all operations</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <AnalyticsDateFilter dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
                        </div>
                    </div>

                    {/* Section Quick Nav */}
                    <div className="mt-6 -mx-1 overflow-x-auto scrollbar-hide" ref={scrollContainerRef}>
                        <div className="flex items-center gap-1.5 px-1 pb-1">
                            {SECTIONS.map((section) => (
                                <Button
                                    key={section.id}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => scrollToSection(section.id)}
                                    className="rounded-xl text-xs font-semibold h-8 px-3 gap-1.5 bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 whitespace-nowrap shrink-0"
                                >
                                    <section.icon className="w-3.5 h-3.5" />
                                    {section.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Sections */}
            <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6">
                <ProfitabilitySection businessId={businessId} dateFilter={dateFilter} />
                <OrdersSection businessId={businessId} dateFilter={dateFilter} />
                <AdsSection businessId={businessId} dateFilter={dateFilter} />
                <ShippingSection businessId={businessId} dateFilter={dateFilter} />
                <InventorySection businessId={businessId} dateFilter={dateFilter} />
                <SalesChannelsSection businessId={businessId} dateFilter={dateFilter} />
                <CustomersSection businessId={businessId} dateFilter={dateFilter} />
                <SellersSection businessId={businessId} dateFilter={dateFilter} />
                <UsersSection businessId={businessId} dateFilter={dateFilter} />
                <BusinessHealthSection businessId={businessId} dateFilter={dateFilter} />
            </div>
        </div>
    );
};

export default Analytics;
