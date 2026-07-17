import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SellerSidebar from './SellerSidebar';
import SuspensionOverlay from './SuspensionOverlay';
import { supabase } from '@/lib/supabase';
import { FullscreenLoader } from '@/components/ui/fullscreen-loader';
import { OrderStatusNotifications } from '@/components/orders/OrderStatusNotifications';
import { EcomBizRealtime } from '@/components/realtime/EcomBizRealtime';
import { WaUserRealtime } from '@/whatsapp/lib/queries/waChannels';

interface SellerLayoutProps {
    children: React.ReactNode;
}

const SellerLayout: React.FC<SellerLayoutProps> = ({ children }) => {
    const [isReady, setIsReady] = useState(() => !!localStorage.getItem('activeBusinessId'));
    const [businessId, setBusinessId] = useState<string | null>(() => localStorage.getItem('activeBusinessId'));

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

            if (bid) setBusinessId(bid);
            setIsReady(true);
        };
        init();
    }, []);

    // Suspension gate (owner-approved 2026-07-17): re-verified on window focus
    // once >5min stale — a mid-session suspension now bites within minutes
    // instead of "whenever they hard-reload". Still FAILS OPEN (error/missing
    // row coerces to 'active') so a backend outage never locks sellers out.
    const { data: businessStatus = 'active' } = useQuery({
        queryKey: ['seller-business-status', businessId],
        queryFn: async () => {
            const { data: business } = await supabase
                .from('businesses')
                .select('status')
                .eq('id', businessId!)
                .single();
            return business?.status || 'active';
        },
        enabled: !!businessId,
        staleTime: 5 * 60 * 1000,
    });

    if (!isReady) {
        return <FullscreenLoader sublabel="Chargement de votre espace commercial." />;
    }

    const isSuspended = businessStatus !== 'active';

    return (
        <div className="ant-surface min-h-screen flex overflow-x-hidden">
            <SellerSidebar />
            <main className="flex-1 min-w-0 transition-all duration-700 ease-smooth">
                {children}
            </main>
            {isSuspended && businessId && (
                <SuspensionOverlay role="commercial" businessId={businessId} />
            )}
            {/* THE single ecom:biz broadcast channel (orders/parcels/stock events →
                cache invalidation + ecomBus fan-out) — W7 R1a. */}
            <EcomBizRealtime role="seller" />

            {/* Surfaces status changes on every seller page — only for orders attributed to this user. */}
            <OrderStatusNotifications role="seller" targetPath="/seller/orders" />
            {/* Persistent wa:user realtime — WhatsApp cache sync + inbound-message
                toasts on every seller page (self-wraps in the WA QueryClient). */}
            <WaUserRealtime />
        </div>
    );
};

export default SellerLayout;
