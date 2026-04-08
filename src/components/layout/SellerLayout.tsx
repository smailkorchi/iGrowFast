import React, { useEffect, useState } from 'react';
import SellerSidebar from './SellerSidebar';
import SuspensionOverlay from './SuspensionOverlay';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

interface SellerLayoutProps {
    children: React.ReactNode;
}

const SellerLayout: React.FC<SellerLayoutProps> = ({ children }) => {
    const [isReady, setIsReady] = useState(() => !!localStorage.getItem('activeBusinessId'));
    const [businessStatus, setBusinessStatus] = useState<string>('active');
    const [businessId, setBusinessId] = useState<string | null>(null);

    useEffect(() => {
        const init = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) { setIsReady(true); return; }

            let bid = localStorage.getItem('activeBusinessId');

            if (!bid) {
                const { data: profile } = await supabase
                    .from('users')
                    .select('"DigiCom Business"')
                    .eq('id', session.user.id)
                    .single();

                if (profile?.['DigiCom Business']) {
                    bid = profile['DigiCom Business'];
                    localStorage.setItem('activeBusinessId', bid!);
                }
            }

            if (bid) {
                setBusinessId(bid);
                const { data: business } = await supabase
                    .from('businesses')
                    .select('status')
                    .eq('id', bid)
                    .single();
                setBusinessStatus(business?.status || 'active');
            }

            setIsReady(true);
        };
        init();
    }, []);

    if (!isReady) {
        return (
            <div className="min-h-screen bg-brand-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    const isSuspended = businessStatus !== 'active';

    return (
        <div className="min-h-screen bg-brand-white flex overflow-x-hidden">
            <SellerSidebar />
            <main className="flex-1 min-w-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                <div className="p-4 md:p-8">
                    <div className="max-w-[1700px] mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
            {isSuspended && businessId && (
                <SuspensionOverlay role="commercial" businessId={businessId} />
            )}
        </div>
    );
};

export default SellerLayout;
