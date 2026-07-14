import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { publishEcomBus, type EcomBusEvent } from '@/lib/ecomBus';

/**
 * THE single owner of the private `ecom:biz:<business_id>` broadcast channel
 * (W7 R1a — replaces the retired postgres_changes bindings of admin/Orders,
 * seller/Orders, OrderStatusNotifications and SheetReview).
 *
 * Mounted once per session in AppLayout (role="admin") / SellerLayout
 * (role="seller"). Do NOT open this topic anywhere else — same-topic joins on
 * the shared socket replace each other. Every event is republished on the
 * ecomBus for page-local consumers (SheetReview toast, WA chat-orders bridge);
 * the GLOBAL react-query invalidations live here:
 *
 *   order/parcel → ['orders-aggregate'] prefix, debounced 500ms
 *                  (covers admin ['orders-aggregate', biz] AND seller
 *                   ['orders-aggregate', biz, uid])
 *   stock        → the role's product/accessory dropdown keys, debounced 150ms
 *                  (snappy shortage-highlight flip, still coalesces bursts)
 *
 * Broadcast is at-most-once: on re-subscribe after an error the handler runs
 * both invalidations immediately and publishes 'reconnect' so bus consumers
 * reconcile too. Scope follows auth + cross-tab business switches, mirroring
 * the pattern proven by OrderStatusNotifications.
 */
export function EcomBizRealtime({ role }: { role: 'admin' | 'seller' }) {
    const queryClient = useQueryClient();
    const [businessId, setBusinessId] = useState<string | null>(null);

    const refreshScope = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        setBusinessId(session?.user ? localStorage.getItem('activeBusinessId') : null);
    }, []);

    useEffect(() => {
        refreshScope();
        const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
                refreshScope();
            }
        });
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'activeBusinessId') refreshScope();
        };
        window.addEventListener('storage', onStorage);
        return () => {
            authSub.subscription.unsubscribe();
            window.removeEventListener('storage', onStorage);
        };
    }, [refreshScope]);

    useEffect(() => {
        if (!businessId) return;

        let ordersTimer: ReturnType<typeof setTimeout> | null = null;
        const invalidateOrders = () => {
            // Prefix key: matches both the admin and the seller aggregate variants.
            queryClient.invalidateQueries({ queryKey: ['orders-aggregate'] });
        };
        const debouncedOrders = () => {
            if (ordersTimer) clearTimeout(ordersTimer);
            ordersTimer = setTimeout(invalidateOrders, 500);
        };

        let stockTimer: ReturnType<typeof setTimeout> | null = null;
        const invalidateStock = () => {
            if (role === 'admin') {
                queryClient.invalidateQueries({ queryKey: ['products-dropdown', businessId] });
                queryClient.invalidateQueries({ queryKey: ['accessories-dropdown-orders', businessId] });
            } else {
                queryClient.invalidateQueries({ queryKey: ['products-dropdown-seller'] });
                queryClient.invalidateQueries({ queryKey: ['accessories', businessId] });
            }
        };
        const debouncedStock = () => {
            if (stockTimer) clearTimeout(stockTimer);
            stockTimer = setTimeout(invalidateStock, 150);
        };

        let hadError = false;
        const channel = supabase
            .channel(`ecom:biz:${businessId}`, { config: { private: true } })
            .on('broadcast', { event: 'order' }, ({ payload }) => {
                publishEcomBus({ type: 'order', payload } as EcomBusEvent);
                debouncedOrders();
            })
            .on('broadcast', { event: 'parcel' }, ({ payload }) => {
                publishEcomBus({ type: 'parcel', payload } as EcomBusEvent);
                debouncedOrders();
            })
            .on('broadcast', { event: 'stock' }, ({ payload }) => {
                publishEcomBus({ type: 'stock', payload } as EcomBusEvent);
                debouncedStock();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Anything missed while the socket was down self-heals here.
                    if (hadError) {
                        hadError = false;
                        invalidateOrders();
                        invalidateStock();
                        publishEcomBus({ type: 'reconnect' });
                    }
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    hadError = true;
                }
            });

        return () => {
            if (ordersTimer) clearTimeout(ordersTimer);
            if (stockTimer) clearTimeout(stockTimer);
            supabase.removeChannel(channel);
        };
    }, [businessId, role, queryClient]);

    return null;
}
