import { useState, useRef } from 'react';
import {
    BarChart3, DollarSign, ShoppingBag, Megaphone, Truck,
    PackageOpen, Radio, Users, UserCheck, Bike, Radar, Activity,
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
import { CouriersSection } from '@/components/analytics/CouriersSection';
import { MediaBuyersSection } from '@/components/analytics/MediaBuyersSection';
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
    { id: 'couriers', label: 'Couriers', icon: Bike },
    { id: 'mediabuyers', label: 'Media Buyers', icon: Radar },
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">
                            Analytics
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            {dateFilter.label}
                        </p>
                    </div>
                    <AnalyticsDateFilter dateFilter={dateFilter} onDateFilterChange={setDateFilter} />
                </div>

                <div className="-mx-1 overflow-x-auto scrollbar-hide" ref={scrollContainerRef}>
                    <div className="flex items-center gap-1 px-1 pb-0.5">
                        {SECTIONS.map((section) => (
                            <Button
                                key={section.id}
                                variant="ghost"
                                size="sm"
                                onClick={() => scrollToSection(section.id)}
                                className="rounded-md text-[10px] font-semibold h-6 px-2 gap-1 bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 whitespace-nowrap shrink-0"
                            >
                                <section.icon className="w-3 h-3" />
                                {section.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="space-y-2.5">
                <ProfitabilitySection businessId={businessId} dateFilter={dateFilter} />
                <OrdersSection businessId={businessId} dateFilter={dateFilter} />
                <AdsSection businessId={businessId} dateFilter={dateFilter} />
                <ShippingSection businessId={businessId} dateFilter={dateFilter} />
                <InventorySection businessId={businessId} dateFilter={dateFilter} />
                <SalesChannelsSection businessId={businessId} dateFilter={dateFilter} />
                <CustomersSection businessId={businessId} dateFilter={dateFilter} />
                <SellersSection businessId={businessId} dateFilter={dateFilter} />
                <CouriersSection businessId={businessId} dateFilter={dateFilter} />
                <MediaBuyersSection businessId={businessId} dateFilter={dateFilter} />
                <UsersSection businessId={businessId} dateFilter={dateFilter} />
                <BusinessHealthSection businessId={businessId} dateFilter={dateFilter} />
            </div>
        </div>
    );
};

export default Analytics;
