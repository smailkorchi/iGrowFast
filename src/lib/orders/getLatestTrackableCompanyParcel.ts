// company_parcels verified via MCP: id NOT NULL, tracking_code/external_id/provider_id/created_at nullable; provider (providers.id) NOT NULL
export type TrackableCompanyParcelRow = {
    id: string;
    tracking_code?: string | null;
    external_id?: string | null;
    provider_id?: string | null;
    provider?: { id: string } | null;
    created_at?: string | null;
    company_delivery_note_id?: string | null;
};
export type OrderWithParcels = { parcels?: TrackableCompanyParcelRow[] | null } | null | undefined;
type Parcel = TrackableCompanyParcelRow;

type CourierParcelRow = {
    tracking_code?: string | null;
    courier_delivery_note_id?: string | null;
    created_at?: string | null;
};

/**
 * Returns the tracking code of the parcel actually shipped via a delivery note,
 * preferring the most recent one. Falls back to order.tracking_number, then null.
 *
 * Used by return/payment note builders. Skips orphan parcels — rows that were
 * created but never attached to a delivery note (a stale row from a failed/retried
 * provider call). Picking an orphan would write a tracking code the courier doesn't
 * recognise into the financial document.
 */
export function pickShippedCompanyTrackingCode(order: {
    // Only the fields this function reads — accepts any company-parcel shape; callers' rows
    // need not carry `id` (unused here). getLatestTrackableCompanyParcel keeps the strict row type.
    parcels?: Array<{ company_delivery_note_id?: string | null; tracking_code?: string | null; created_at?: string | null }> | null;
    tracking_number?: string | null;
} | null | undefined): string | null {
    const shipped = (order?.parcels || [])
        .filter((p) => p?.company_delivery_note_id && p?.tracking_code);
    if (shipped.length > 0) {
        const sorted = [...shipped].sort(
            (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        return String(sorted[0].tracking_code).trim();
    }
    return order?.tracking_number ? String(order.tracking_number).trim() : null;
}

export function pickShippedCourierTrackingCode(order: {
    courier_parcels?: CourierParcelRow[] | null;
    tracking_number?: string | null;
} | null | undefined): string | null {
    const shipped = (order?.courier_parcels || [])
        .filter((p) => p?.courier_delivery_note_id && p?.tracking_code);
    if (shipped.length > 0) {
        const sorted = [...shipped].sort(
            (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        return String(sorted[0].tracking_code).trim();
    }
    return order?.tracking_number ? String(order.tracking_number).trim() : null;
}

/** Latest company parcel that can be tracked via provider-integration (needs tracking code + provider). */
export function getLatestTrackableCompanyParcel(order: OrderWithParcels): {
    id: string;
    tracking_code: string;
    external_id: string | null;
    provider_id: string;
} | null {
    const parcels = (order?.parcels || []).filter(
        (p: Parcel) => p?.tracking_code && String(p.tracking_code).trim()
    );
    if (!parcels.length) return null;
    const sorted = [...parcels].sort(
        (a: Parcel, b: Parcel) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    const p = sorted[0];
    const providerId = p.provider_id || p.provider?.id;
    if (!providerId) return null;
    return {
        id: p.id,
        tracking_code: String(p.tracking_code).trim(),
        external_id: p.external_id ?? null,
        provider_id: providerId,
    };
}
