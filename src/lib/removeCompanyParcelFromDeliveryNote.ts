import { supabase } from '@/lib/supabase';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-integration`;

/**
 * Remove a parcel from an OPEN company delivery note.
 *
 * The local RPC is authoritative (reverts the order to confirmed, fixes the parcel
 * count). On top of that we mirror the removal on the provider's pickup note so the
 * carrier stays in sync — today only Coliaty exposes a public remove-parcels endpoint.
 * The provider sync is strictly best-effort: it must never block or fail the local
 * removal (a provider hiccup should not strand the parcel in our UI).
 */
export async function removeCompanyParcelFromDeliveryNote(
    parcelId: string,
    deliveryNoteId: string
): Promise<void> {
    // Capture what the provider call needs BEFORE the RPC, which may unlink/clear the row.
    const { data: parcel } = await supabase
        .from('company_parcels')
        .select('tracking_code, provider_id')
        .eq('id', parcelId)
        .maybeSingle();
    const { data: note } = await supabase
        .from('company_delivery_notes')
        .select('reference')
        .eq('id', deliveryNoteId)
        .maybeSingle();

    // 1. Local removal — authoritative.
    const { error } = await supabase.rpc('remove_company_parcel_from_delivery_note', {
        p_parcel_id: parcelId,
        p_delivery_note_id: deliveryNoteId,
    });
    if (error) throw error;

    // 2. Provider-side sync — best-effort, Coliaty only.
    try {
        const trackingCode = parcel?.tracking_code as string | undefined;
        const reference = note?.reference as string | undefined;
        const providerId = parcel?.provider_id as string | undefined;
        if (!trackingCode || !reference || !providerId) return;

        const { data: provider } = await supabase
            .from('providers')
            .select('provider_type')
            .eq('id', providerId)
            .maybeSingle();
        if (!String(provider?.provider_type || '').toLowerCase().includes('coliaty')) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
                action: 'remove_parcels_from_delivery_note',
                provider_id: providerId,
                data: { delivery_note_ref: reference, parcel_codes: [trackingCode] },
            }),
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => String(res.status));
            console.warn('Coliaty remove-parcels (provider sync) failed:', detail);
        }
    } catch (e) {
        console.warn('Coliaty remove-parcels (provider sync) error:', e);
    }
}
