/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import CourierSidebar from './CourierSidebar';
import NotificationPermissionDialog from '@/components/notifications/NotificationPermissionDialog';
import { useCourierNotifications } from '@/hooks/useCourierNotifications';
import {
    ensureServiceWorker,
    getPermissionState,
    supportsForegroundNotifications,
    subscribeToPush,
    wasPermissionDialogDismissed,
} from '@/lib/notifications';

interface CourierLayoutProps {
    children: React.ReactNode;
}

const CourierLayout: React.FC<CourierLayoutProps> = ({ children }) => {
    const [showPermissionDialog, setShowPermissionDialog] = useState(false);

    const { data: me } = useQuery({
        queryKey: ['courier-layout-me'],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, role, "DigiCom Business"')
                .eq('id', user.id)
                .maybeSingle();
            return data as { id: string; role: string | null; ['DigiCom Business']: string } | null;
        },
        staleTime: 60_000,
    });

    const courierId = me?.id ?? null;
    const businessId = me?.['DigiCom Business'] ?? null;
    const isCourier = me?.role === 'courier';

    useEffect(() => {
        ensureServiceWorker().catch((e) => {
            console.warn('[courier-layout] SW registration failed', e);
        });
    }, []);

    useCourierNotifications({
        enabled: !!courierId && isCourier,
        courierId,
    });

    useEffect(() => {
        if (!isCourier || !courierId) return;
        if (wasPermissionDialogDismissed()) return;
        if (!supportsForegroundNotifications()) {
            const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            if (isIOS) {
                setShowPermissionDialog(true);
            }
            return;
        }

        const state = getPermissionState();
        if (state === 'default') {
            const t = setTimeout(() => setShowPermissionDialog(true), 900);
            return () => clearTimeout(t);
        }

        if (state === 'granted' && courierId) {
            subscribeToPush(courierId, businessId).catch(() => { });
        }
    }, [isCourier, courierId, businessId]);

    return (
        <div className="min-h-screen bg-ant-light md:flex overflow-x-hidden">
            <CourierSidebar />

            <main className="flex-1 min-w-0 transition-all duration-700 ease-smooth">
                <div className="px-3 pt-3 pb-[calc(96px+env(safe-area-inset-bottom))] md:px-6 md:py-6 md:pb-6">
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </main>

            <NotificationPermissionDialog
                open={showPermissionDialog}
                onClose={() => setShowPermissionDialog(false)}
                userId={courierId}
                businessId={businessId}
            />
        </div>
    );
};

export default CourierLayout;
