import React, { useEffect, useState } from 'react';
import SellerSidebar from './SellerSidebar';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

interface SellerLayoutProps {
    children: React.ReactNode;
}

const SellerLayout: React.FC<SellerLayoutProps> = ({ children }) => {
    const [isReady, setIsReady] = useState(() => !!localStorage.getItem('activeBusinessId'));

    useEffect(() => {
        const checkBusinessId = async () => {
            if (!localStorage.getItem('activeBusinessId')) {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    const { data: profile } = await supabase
                        .from('users')
                        .select('"DigiCom Business"')
                        .eq('id', session.user.id)
                        .single();

                    if (profile?.['DigiCom Business']) {
                        localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
                    }
                }
                setIsReady(true);
            }
        };
        checkBusinessId();
    }, []);

    if (!isReady) {
        return (
            <div className="min-h-screen bg-brand-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

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
