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

    // ─── Current courier (for realtime scoping + dialog gating) ─────
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

    // ─── Register SW once as soon as the layout mounts ─────────────
    // This pre-warms the service worker so the first push subscription
    // happens instantly (no cold-start) and foreground notifications
    // can use reg.showNotification() immediately.
    useEffect(() => {
        ensureServiceWorker().catch((e) => {
            console.warn('[courier-layout] SW registration failed', e);
        });
    }, []);

    // ─── Realtime subscription: drives in-app toast + system notif ──
    // Mounted at the layout level so it persists across page
    // navigation within the courier app — no re-subscribe churn.
    useCourierNotifications({
        enabled: !!courierId && isCourier,
        courierId,
    });

    // ─── Post-auth permission dialog ────────────────────────────────
    // Show once per session for couriers whose permission is still
    // `default` (never asked) AND who haven't dismissed it yet.
    useEffect(() => {
        if (!isCourier || !courierId) return;
        if (wasPermissionDialogDismissed()) return;
        if (!supportsForegroundNotifications()) {
            // Special case: iOS Safari (non-standalone). The dialog still
            // needs to show — it'll render the "Add to Home Screen"
            // instructions screen instead of the normal permission prompt.
            const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
            const isIOS = /iPad|iPhone|iPod/.test(ua);
            if (isIOS) {
                setShowPermissionDialog(true);
            }
            return;
        }

        const state = getPermissionState();
        if (state === 'default') {
            // Delay a beat so the dialog doesn't race the page entrance
            // animation — gives the app a chance to render first.
            const t = setTimeout(() => setShowPermissionDialog(true), 900);
            return () => clearTimeout(t);
        }

        // Permission already granted → opportunistically refresh the
        // push subscription in case the SW or VAPID key was rotated.
        if (state === 'granted' && courierId) {
            subscribeToPush(courierId, businessId).catch(() => {
                // Best effort — foreground notifications work regardless.
            });
        }
    }, [isCourier, courierId, businessId]);

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
