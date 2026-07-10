import React from 'react';
import Sidebar from './Sidebar';
import { OrderStatusNotifications } from '@/components/orders/OrderStatusNotifications';
import { AdminWaRealtime } from '@/whatsapp/lib/queries/waChannels';

interface AppLayoutProps {
    children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-ant-light flex overflow-x-hidden">
            <Sidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-smooth">
                <div className="p-4 md:p-6">
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </main>

            {/* Mounted once per session — surfaces webhook-driven status changes on every admin page. */}
            <OrderStatusNotifications role="admin" targetPath="/orders" />

            {/* Persistent wa:biz realtime — WhatsApp cache sync + inbound-message
                toasts on every admin page (self-wraps in the WA QueryClient). */}
            <AdminWaRealtime />
        </div>
    );
};

export default AppLayout;
