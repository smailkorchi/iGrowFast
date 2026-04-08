import React from 'react';
import CourierSidebar from './CourierSidebar';

interface CourierLayoutProps {
    children: React.ReactNode;
}

const CourierLayout: React.FC<CourierLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-brand-white md:flex overflow-x-hidden">
            <CourierSidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                <div className="p-4 md:p-8 pb-[96px] md:pb-8">
                    <div className="max-w-[1700px] mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default CourierLayout;
