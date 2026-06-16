/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@/lib/supabase';

type ParcelRow = { order_id: string | null; tracking_code: string | null };

/**
 * Returns the set of order_ids that have a tracking_code in either
 * `company_parcels` (external provider like Coliaty/Ameex/OzonExpress) or
 * `courier_parcels` (in-house couriers).
 *
 * This is the "handed to the courier" universe used as the base of the
 * delivery-rate denominator (Coliaty formula). Every delivery-rate calculation
 * in the app derives from this set.
 *
 * Cached per businessId with staleTime: 0 and refetchOnMount: 'always', same
 * as the orders queries, so the seller and admin dashboards can't drift.
 */
export function useTrackedOrders(businessId: string | null | undefined) {
    const { data: companyParcels } = useQuery({
        queryKey: ['tracked-orders-company-parcels', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            return await fetchAllRows<ParcelRow>('company_parcels', 'order_id, tracking_code', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: businessId }],
            });
        },
        enabled: !!businessId,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const { data: courierParcels } = useQuery({
        queryKey: ['tracked-orders-courier-parcels', businessId],
        queryFn: async () => {
            if (!businessId) return [];
            return await fetchAllRows<ParcelRow>('courier_parcels', 'order_id, tracking_code', {
                filters: [{ column: 'DigiCom Business', op: 'eq', value: businessId }],
            });
        },
        enabled: !!businessId,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const trackedOrderIds = useMemo(() => {
        const set = new Set<string>();
        (companyParcels || []).forEach((p) => {
            if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) {
                set.add(p.order_id);
            }
        });
        (courierParcels || []).forEach((p) => {
            if (p.order_id && p.tracking_code && String(p.tracking_code).trim().length > 0) {
                set.add(p.order_id);
            }
        });
        return set;
    }, [companyParcels, courierParcels]);

    return { trackedOrderIds, isReady: !!companyParcels && !!courierParcels };
}
