// company_parcels verified via MCP: id NOT NULL, tracking_code/external_id/provider_id/created_at nullable; provider (providers.id) NOT NULL
export type TrackableCompanyParcelRow = {
    id: string;
    tracking_code?: string | null;
    external_id?: string | null;
    provider_id?: string | null;
    provider?: { id: string } | null;
    created_at?: string | null;
};
export type OrderWithParcels = { parcels?: TrackableCompanyParcelRow[] | null } | null | undefined;
type Parcel = TrackableCompanyParcelRow;

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
