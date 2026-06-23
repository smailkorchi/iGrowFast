import React from 'react';
import OwnerSidebar from './OwnerSidebar';

interface OwnerLayoutProps {
    children: React.ReactNode;
}

const OwnerLayout: React.FC<OwnerLayoutProps> = ({ children }) => {
    return (
        <div className="min-h-screen bg-ant-light flex overflow-x-hidden">
            <OwnerSidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-smooth">
                <div className="px-4 py-4 md:px-6 md:py-6">
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default OwnerLayout;
