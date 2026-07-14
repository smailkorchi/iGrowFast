import { supabase } from '@/lib/supabase';

/**
 * Full by-id order select — the old `?view=` fallback of admin/Orders.tsx
 * (recon 01 §0): every join the aggregate select carried PLUS the lazy
 * `history` join. D1 replaced the page aggregate with the slim
 * `orders_list_page` RPC rows, so this is now THE way to load a complete
 * order row (edit form prefill, `?view=` deep links) on both the admin and
 * seller pages.
 */
export const ORDER_BY_ID_SELECT = `
    *,
    status:order_statuses(*),
    package_status:package_statuses(*),
    city:master_cities(id, name),
    courier:users!orders_courier_id_fkey(id, name, avatar_url, avatar_config),
    assignee:users!orders_seller_id_fkey(id, name, avatar_url, avatar_config),
    company:providers(id, name, provider_type, logo_url),
    channel:sales_channels!orders_source_id_fkey(id, name, type),
    items:order_items(*, product:products(name, code, image_url), accessory:accessories(name, code, image_url)),
    history:order_status_history(*, user:users!changed_by(name, avatar_url, avatar_config), status:order_statuses!status_id(*)),
    parcels:company_parcels(id, tracking_code, external_id, provider_id, status_id, created_at, company_delivery_note_id, status:package_statuses(label, color), provider:providers(id, name, logo_url)),
    courier_parcels(id, tracking_code, status_id, created_at, courier_delivery_note_id, status:package_statuses(label, color))
`;

/**
 * Lazy by-id fetch of one live (non-trashed) order with the full join set.
 * Returns null when the order doesn't exist, is soft-deleted, or is outside
 * the caller's RLS scope. Throws on transport/query errors.
 */
export async function fetchOrderById(orderId: string): Promise<any | null> {
    const { data, error } = await (supabase as any)
        .from('orders')
        .select(ORDER_BY_ID_SELECT)
        .eq('id', orderId)
        .is('date_deleted', null)
        .maybeSingle();
    if (error) throw error;
    return data ?? null;
}
