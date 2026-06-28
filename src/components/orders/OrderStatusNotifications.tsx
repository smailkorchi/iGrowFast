import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
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
 * Mounts a single realtime subscription on `orders` UPDATEs and shows the status-change
 * toast for any package_status transition the user is allowed to see. Independent of
 * which page the user is currently on.
 *
 * - admin: every order on the active business (filtered client-side on `DigiCom Business`)
 * - seller: only orders where seller_id or assign_id matches the signed-in user
 *
 * Reacts to auth changes (sign-in/out) and cross-tab storage events (business switch)
 * so a long-lived session always reflects the current scope.
 *
 * On click, navigates to `targetPath?view=<orderId>`; the destination Orders page reads
 * the query param and opens its existing preview modal.
 */
export function OrderStatusNotifications({ role, targetPath }: Props) {
    const navigate = useNavigate();
    const { resolve, resolveById } = usePackageStatusResolver();
    const [scope, setScope] = useState<{ businessId: string | null; userId: string | null }>({
        businessId: null,
        userId: null,
    });
    // Dedupe identical status pushes that arrive within a short window. Postgres logical
    // replication occasionally double-delivers; webhook retries also flow through.
    const recentRef = useRef<Map<string, number>>(new Map());

    const refreshScope = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || null;
        const businessId = localStorage.getItem('activeBusinessId');
        setScope((prev) =>
            prev.userId === userId && prev.businessId === businessId
                ? prev
                : { businessId, userId },
        );
    }, []);

    useEffect(() => {
        refreshScope();

        // Auth lifecycle — re-resolve on sign-in/out/user-update. Ignore INITIAL_SESSION
        // and TOKEN_REFRESHED to avoid redundant teardowns.
        const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
                refreshScope();
            }
        });

        // Cross-tab business switches.
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
        const { businessId, userId } = scope;
        if (!businessId) return;
        if (role === 'seller' && !userId) return;

        // No server-side filter on `DigiCom Business` — that column name contains a space
        // and Supabase Realtime's postgres_changes filter syntax does not support escaped
        // identifiers; the filter would silently match zero rows. Filter client-side instead.
        // RLS already scopes what we can subscribe to per role.
        const channel = supabase
            .channel(`order-status-notify-${role}-${businessId}`)
            .on(
                'postgres_changes' as any,
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                },
                async (payload: any) => {
                    const oldRow = payload.old || {};
                    const newRow = payload.new || {};
                    if (!newRow.id) return;

                    // Business scope check — defense in depth against RLS gaps and against
                    // owner sessions that subscribed to multiple businesses' realtime.
                    if (newRow['DigiCom Business'] && newRow['DigiCom Business'] !== businessId) return;

                    // Skip soft-deleted orders.
                    if (newRow.date_deleted) return;

                    const statusChanged =
                        (newRow.package_status_id || null) !== (oldRow.package_status_id || null);
                    if (!statusChanged) return;

                    // Seller-side ownership filter. RLS may already enforce this, but the
                    // realtime stream can leak rows when the underlying policy uses joins
                    // the replication slot can't evaluate. Verifying client-side prevents
                    // cross-seller leakage.
                    if (role === 'seller') {
                        const sellerId = newRow.seller_id || null;
                        const assignId = newRow.assign_id || null;
                        if (sellerId !== userId && assignId !== userId) return;
                    }

                    // Suppress duplicate (orderId + statusId) pings within 4s.
                    const dedupeKey = `${newRow.id}:${newRow.package_status_id || ''}`;
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

                    // Fetch enrichment: latest parcel + provider logo. The orders realtime
                    // payload doesn't include joined relations.
                    const { data: parcelRow } = await supabase
                        .from('company_parcels')
                        .select('tracking_code, provider:providers(name, provider_type, logo_url)')
                        .eq('order_id', newRow.id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    const provider: any = (parcelRow as any)?.provider || null;
                    const trackingCode =
                        (parcelRow as any)?.tracking_code ||
                        null;

                    // Always resolve to the master status (label + color + icon); the raw
                    // realtime columns are a fallback only when no master matches.
                    const resolved = resolveById(newRow.package_status_id);

                    showOrderStatusToast(
                        {
                            orderId: newRow.id,
                            orderName: newRow.name || null,
                            trackingCode,
                            providerLogo: resolveProviderLogo(provider),
                            providerName: provider?.name || null,
                            statusLabel: resolved?.label ?? null,
                            statusColor: resolved?.color ?? null,
                            statusIcon: resolved?.icon ?? null,
                        },
                        () => {
                            navigate(`${targetPath}?view=${newRow.id}`);
                        },
                    );
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [scope, role, targetPath, navigate, resolve]);

    return null;
}
