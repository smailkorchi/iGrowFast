import { supabase } from '@/lib/supabase';

export async function removeCompanyParcelFromDeliveryNote(
    parcelId: string,
    deliveryNoteId: string
): Promise<void> {
    const { error } = await supabase.rpc('remove_company_parcel_from_delivery_note', {
        p_parcel_id: parcelId,
        p_delivery_note_id: deliveryNoteId,
    });
    if (error) throw error;
}
