import React from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-ant-light flex overflow-x-hidden">
            <Sidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                <div className="p-4 md:p-6">
                    <div className="max-w-[1700px] mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AppLayout;
