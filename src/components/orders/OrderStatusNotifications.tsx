import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { subscribeEcomBus } from '@/lib/ecomBus';
import { showOrderStatusToast } from './OrderStatusToast';
import { usePackageStatusResolver } from '@/hooks/usePackageStatusResolver';
import { resolveProviderLogo } from '@/lib/providerLogos';

type Role = 'admin' | 'seller';

interface Props {
    /** Which orders this user is allowed to see toasts for. */
    role: Role;
    /** Path the toast click should land on (with `?view=<id>` appended). */
    targetPath: string;
}

/**
 * Shows the status-change toast for any package_status transition the user is
 * allowed to see. Independent of which page the user is currently on.
 *
 * W7 R1a: consumes the ecomBus 'order' events republished by the layout's
 * <EcomBizRealtime/> (the single owner of the private ecom:biz:<biz> broadcast
 * channel) instead of its former unfiltered postgres_changes subscription.
 * Business scoping is now guaranteed by the topic itself, and the broadcast
 * payload carries the tracking/provider enrichment — ZERO follow-up queries
 * (the old version fired a company_parcels SELECT per event per client).
 *
 * - admin: every order on the active business
 * - seller: only orders where pkg.seller_id matches the signed-in user
 *
 * On click, navigates to `targetPath?view=<orderId>`; the destination Orders
 * page reads the query param and opens its existing preview modal.
 */
export function OrderStatusNotifications({ role, targetPath }: Props) {
    const navigate = useNavigate();
    const { resolveById } = usePackageStatusResolver();
    const [userId, setUserId] = useState<string | null>(null);
    // Dedupe identical status pushes that arrive within a short window
    // (webhook retries and double-syncs still flow through the trigger).
    const recentRef = useRef<Map<string, number>>(new Map());

    const refreshUser = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        setUserId(session?.user?.id || null);
    }, []);

    useEffect(() => {
        refreshUser();
        const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
                refreshUser();
            }
        });
        return () => { authSub.subscription.unsubscribe(); };
    }, [refreshUser]);

    useEffect(() => {
        if (role === 'seller' && !userId) return;

        const unsubscribe = subscribeEcomBus((event) => {
            if (event.type !== 'order') return;
            const payload = event.payload;
            // Only package-status transitions toast; soft-deleted orders never do.
            if (payload.op !== 'UPDATE' || !payload.pkg || payload.deleted) return;
            const pkg = payload.pkg;

            // Seller-side ownership filter — the biz-wide topic is readable by
            // every member; display stays scoped to the seller's own orders.
            if (role === 'seller' && (pkg.seller_id || null) !== userId) return;

            // Suppress duplicate (orderId + statusId) pings within 4s.
            const dedupeKey = `${payload.id}:${pkg.package_status_id || ''}`;
            const now = Date.now();
            const last = recentRef.current.get(dedupeKey);
            if (last && now - last < 4000) return;
            recentRef.current.set(dedupeKey, now);
            // Prune the dedupe map so it doesn't grow unbounded.
            if (recentRef.current.size > 200) {
                for (const [k, t] of recentRef.current) {
                    if (now - t > 60_000) recentRef.current.delete(k);
                }
            }

            // Always resolve to the master status (label + color + icon).
            const resolved = resolveById(pkg.package_status_id);

            showOrderStatusToast(
                {
                    orderId: payload.id,
                    orderName: pkg.name || null,
                    trackingCode: pkg.tracking_code || null,
                    providerLogo: resolveProviderLogo({
                        name: pkg.provider_name,
                        provider_type: pkg.provider_type,
                    }),
                    providerName: pkg.provider_name || null,
                    statusLabel: resolved?.label ?? null,
                    statusColor: resolved?.color ?? null,
                    statusIcon: resolved?.icon ?? null,
                },
                () => {
                    navigate(`${targetPath}?view=${payload.id}`);
                },
            );
        });

        return unsubscribe;
    }, [role, userId, targetPath, navigate, resolveById]);

    return null;
}
