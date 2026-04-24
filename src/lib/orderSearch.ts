/** Push stringifiable order-related values into the search bucket. */
function addStrings(bucket: string[], ...vals: unknown[]) {
    for (const v of vals) {
        if (v === null || v === undefined || v === '') continue;
        bucket.push(String(v));
    }
}

function addLocalizedName(bucket: string[], name: unknown) {
    if (name == null || name === '') return;
    if (typeof name === 'string') {
        bucket.push(name);
        return;
    }
    if (typeof name === 'object') {
        const o = name as Record<string, unknown>;
        addStrings(bucket, o.en, o.fr, o.ar);
    }
}

/**
 * Permissive structural shape of the orders row + joined relations that the
 * search walks. Every field is optional + unknown because this function runs
 * against rows assembled by many different queries across the app — it must
 * not enforce strict shape. Arrays are declared so for..of iteration type-checks.
 */
type OrderForSearch = {
    id?: unknown;
    name?: unknown;
    phone?: unknown;
    address?: unknown;
    tracking_number?: unknown;
    coliaty_old_tracking?: unknown;
    ameex_old_tracking?: unknown;
    quicklivraison_old_tracking?: unknown;
    forcelog_old_tracking?: unknown;
    sendit_old_tracking?: unknown;
    note?: unknown;
    delivery_note?: unknown;
    source_name?: unknown;
    delivery_type?: unknown;
    package_status_label?: unknown;
    raw_price?: unknown;
    shipping_cost?: unknown;
    total_price?: unknown;
    discount?: unknown;
    seller_id?: unknown;
    assign_id?: unknown;
    confirmed_by_id?: unknown;
    courier_id?: unknown;
    company_id?: unknown;
    order_status_id?: unknown;
    package_status_id?: unknown;
    master_city_id?: unknown;
    city_id?: unknown;
    city?: { name?: unknown } | null;
    courier?: { name?: unknown } | null;
    assignee?: { name?: unknown } | null;
    company?: { name?: unknown } | null;
    status?: { label?: unknown } | null;
    package_status?: { label?: unknown } | null;
    items?: Array<{
        product?: { name?: unknown; code?: unknown } | null;
        accessory?: { name?: unknown; code?: unknown } | null;
        note?: unknown;
    }> | null;
    parcels?: Array<{
        id?: unknown;
        tracking_code?: unknown;
        status_label?: unknown;
        provider?: { name?: unknown } | null;
    }> | null;
    courier_parcels?: Array<{ id?: unknown; tracking_code?: unknown; status_label?: unknown }> | null;
    history?: Array<{
        comment?: unknown;
        user?: { name?: unknown } | null;
        status?: { label?: unknown } | null;
    }> | null;
};

/**
 * Main orders search bar: matches any loaded scalar or joined text on the row
 * (customer, address, notes, status labels, products, parcel/courier tracking,
 * history comments, Coliaty/AMEEX old exchange tracking, ids, etc.).
 */
export function orderMatchesTopSearch(order: OrderForSearch | null | undefined, raw: string): boolean {
    const q = raw.trim();
    if (!q) return true;

    const qLower = q.toLowerCase();
    const qNorm = qLower.replace(/\s+/g, '');

    const bucket: string[] = [];

    addStrings(
        bucket,
        order?.id,
        order?.name,
        order?.phone,
        order?.address,
        order?.tracking_number,
        order?.coliaty_old_tracking,
        order?.ameex_old_tracking,
        order?.quicklivraison_old_tracking,
        order?.forcelog_old_tracking,
        order?.sendit_old_tracking,
        order?.note,
        order?.delivery_note,
        order?.source_name,
        order?.delivery_type,
        order?.package_status_label,
        order?.raw_price,
        order?.shipping_cost,
        order?.total_price,
        order?.discount,
        order?.seller_id,
        order?.assign_id,
        order?.confirmed_by_id,
        order?.courier_id,
        order?.company_id,
        order?.order_status_id,
        order?.package_status_id,
        order?.master_city_id,
        order?.city_id
    );

    addStrings(bucket, order?.city?.name);
    addStrings(bucket, order?.courier?.name);
    addStrings(bucket, order?.assignee?.name);
    addStrings(bucket, order?.company?.name);
    addStrings(bucket, order?.status?.label);
    addStrings(bucket, order?.package_status?.label);

    for (const item of order?.items || []) {
        addLocalizedName(bucket, item?.product?.name);
        addStrings(bucket, item?.product?.code);
        addLocalizedName(bucket, item?.accessory?.name);
        addStrings(bucket, item?.accessory?.code);
        addStrings(bucket, item?.note);
    }

    for (const p of order?.parcels || []) {
        addStrings(bucket, p?.id, p?.tracking_code, p?.status_label, p?.provider?.name);
    }
    for (const p of order?.courier_parcels || []) {
        addStrings(bucket, p?.id, p?.tracking_code, p?.status_label);
    }

    for (const h of order?.history || []) {
        addStrings(bucket, h?.comment, h?.user?.name, h?.status?.label);
    }

    const normIncludes = (s: string) => s.toLowerCase().replace(/\s+/g, '').includes(qNorm);

    for (const s of bucket) {
        const sl = s.toLowerCase();
        if (sl.includes(qLower)) return true;
        if (qNorm && normIncludes(s)) return true;
    }

    return false;
}
