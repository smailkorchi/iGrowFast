import { supabase } from '@/lib/supabase';

export async function deleteOpenCompanyDeliveryNote(deliveryNoteId: string): Promise<void> {
    const { error } = await supabase.rpc('delete_open_company_delivery_note', {
        p_delivery_note_id: deliveryNoteId,
    });
    if (error) throw error;
}
