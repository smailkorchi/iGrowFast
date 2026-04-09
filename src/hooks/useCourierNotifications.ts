/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * useCourierNotifications
 *
 * Subscribes to Supabase Realtime for `courier_notifications` INSERT events
 * scoped to the current courier. On each event it:
 *   1. Shows a branded in-app toast (works on every platform, every page)
 *   2. Triggers a system notification via the service worker (works when
 *      the app is backgrounded — iOS needs standalone PWA mode)
 *   3. Plays a short vibration if the device supports it
 *   4. Invalidates relevant React Query caches so the UI updates instantly
 *
 * Designed to be mounted ONCE at the CourierLayout level so the realtime
 * channel stays open across page navigation without tear-down churn.
 *
 * Security & scoping:
 *   - Server-side: RLS on `courier_notifications` limits SELECT to
 *     `courier_id = auth.uid()` — a courier cannot read another's feed
 *   - Client-side: filter `courier_id=eq.${courierId}` in the channel so
 *     even if RLS were off, only the current user's rows would be streamed
 *   - Channel is unique per courier ID so multiple tabs from the same user
 *     don't cross-contaminate state
 */

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { showLocalNotification } from '@/lib/notifications';

type CourierNotificationRow = {
    id: string;
    courier_id: string;
    type: string;
    title: string;
    body: string | null;
    target_url: string | null;
    payload: Record<string, any> | null;
    created_at: string;
};

export type UseCourierNotificationsOpts = {
    /** Enable/disable without unmounting (e.g. while waiting for auth) */
    enabled: boolean;
    /** Current courier user id — subscription stays silent until this is set */
    courierId: string | null | undefined;
    /**
     * Optional callback fired for every realtime notification. Lets callers
     * hook in additional UX (haptics, sound, toast action routing, etc.).
     */
    onNotification?: (row: CourierNotificationRow) => void;
};

export function useCourierNotifications(opts: UseCourierNotificationsOpts) {
    const { enabled, courierId, onNotification } = opts;
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const channelRef = useRef<RealtimeChannel | null>(null);

    // Freshest callback without re-subscribing on every render.
    const onNotificationRef = useRef(onNotification);
    useEffect(() => {
        onNotificationRef.current = onNotification;
    }, [onNotification]);

    useEffect(() => {
        if (!enabled || !courierId) return;

        const channelName = `courier_notifications:${courierId}`;
        const channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'courier_notifications',
                    filter: `courier_id=eq.${courierId}`,
                },
                (payload) => {
                    const row = payload.new as CourierNotificationRow;
                    if (!row || row.courier_id !== courierId) return;

                    // ── 1. In-app toast (works on every platform, every page) ──
                    toast({
                        title: row.title,
                        description: row.body || undefined,
                    });

                    // ── 2. System notification (background-capable) ──────────
                    // Show via the SW registration so it surfaces even when the
                    // tab is backgrounded / minimized. Silently no-ops if
                    // permission is not granted or the device doesn't support it.
                    showLocalNotification({
                        title: row.title,
                        body: row.body || undefined,
                        url: row.target_url || '/courier/orders',
                        tag: `courier-notif-${row.id}`,
                    }).catch(() => {
                        // ignore — toast is the guaranteed fallback
                    });

                    // ── 3. Haptic nudge ──────────────────────────────────────
                    try {
                        if (typeof navigator !== 'undefined' && navigator.vibrate) {
                            navigator.vibrate([80, 40, 80]);
                        }
                    } catch {
                        // ignore
                    }

                    // ── 4. Invalidate dependent caches so the UI refreshes ──
                    queryClient.invalidateQueries({ queryKey: ['courier-orders'] });
                    queryClient.invalidateQueries({ queryKey: ['courier-dashboard-parcels'] });

                    // ── 5. Consumer hook ─────────────────────────────────────
                    onNotificationRef.current?.(row);
                },
            )
            .subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    // connected
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('[courier-notifications] channel error', status, err);
                }
            });

        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                try {
                    supabase.removeChannel(channelRef.current);
                } catch {
                    // ignore
                }
                channelRef.current = null;
            }
        };
        // We intentionally depend on a stable set — re-running would tear down
        // and re-create the channel on every toast invocation otherwise.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, courierId]);
}
