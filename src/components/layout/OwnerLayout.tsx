import React from 'react';
import OwnerSidebar from './OwnerSidebar';

interface OwnerLayoutProps {
    children: React.ReactNode;
}

const OwnerLayout: React.FC<OwnerLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-brand-white flex overflow-x-hidden">
            <OwnerSidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                <div className="p-4 md:p-8">
                    <div className="max-w-[1700px] mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default OwnerLayout;
