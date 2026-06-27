-- courier_delivery_notes cleanup:
--
-- 1) Drop 2 duplicate indexes (identical btree on a single column as an existing sibling — pure
--    redundant write/storage cost, no query benefit):
--      idx_courier_dn_courier_id              == idx_courier_delivery_notes_courier_id   (courier_id)
--      idx_courier_delivery_notes_business    == idx_courier_delivery_notes_digicom_business ("DigiCom Business")
--    The descriptive-named sibling of each pair is kept; status_id/created_by/is_finalized indexes untouched.
--
-- 2) Drop external_id (0/18 prod, 0/18 dev — always NULL). Couriers are internal drivers with no
--    external provider system, so the column never received a real value: the courier delivery-note
--    creation path wrote only `external_id: null`, and no courier-note SELECT ever named the column
--    (all are select('*') or explicit lists without it; the only external_id *read* is the company
--    delivery-note finalize branch, on company_delivery_notes — a different table, untouched).
--    The lone `external_id: null` write was removed from CourierDeliveryNoteWizard and DEPLOYED
--    before this migration (two-phase), so the live site never inserts the now-missing column.
--    No function / trigger / RLS / view references it. Rollback = re-add nullable text column.
DROP INDEX IF EXISTS public.idx_courier_dn_courier_id;
DROP INDEX IF EXISTS public.idx_courier_delivery_notes_business;
ALTER TABLE public.courier_delivery_notes DROP COLUMN IF EXISTS external_id;
