import React from 'react';
import Sidebar from './Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-brand-white flex">
            <Sidebar />
            <main className="flex-1 pl-[100px] overflow-x-hidden transition-all duration-300">
                <div className="container mx-auto py-8 pr-8">
                    {children}
                </div>
            </main>
        </div>
    );
};

export default AppLayout;
