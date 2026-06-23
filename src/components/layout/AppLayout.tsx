import React from 'react';
import Sidebar from './Sidebar';
import { OrderStatusNotifications } from '@/components/orders/OrderStatusNotifications';

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
        </div>
    );
};

export default AppLayout;
