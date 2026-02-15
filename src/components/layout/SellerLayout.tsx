import React from 'react';
import SellerSidebar from './SellerSidebar';

interface SellerLayoutProps {
    children: React.ReactNode;
}

const SellerLayout: React.FC<SellerLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-brand-white flex overflow-x-hidden">
            {/* Sidebar stays in the flex flow to naturally push the content */}
            <SellerSidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                {/* 
                    Responsive Container:
                    - p-4 on mobile (if we support mobile later)
                    - p-8 on desktop
                    - max-w-[1600px] to prevent content from stretching too far on ultra-wide screens
                */}
                <div className="p-4 md:p-8">
                    <div className="max-w-[1700px] mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default SellerLayout;
