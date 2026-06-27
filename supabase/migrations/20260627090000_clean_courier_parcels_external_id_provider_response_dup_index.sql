-- courier_parcels cleanup (re-audit of the table cleaned in 20260627* parcel sweep).
--
-- 1) Drop duplicate index: idx_courier_parcels_business == idx_courier_parcels_digicom_business
--    (both plain btree on "DigiCom Business"). Keep the digicom-named one (convention).
--
-- 2) Drop external_id + provider_response (each 0/316 prod, always NULL). Couriers are internal
--    drivers with no external carrier API, so neither column ever received a value: the courier
--    parcel creation path wrote only `external_id: null` / `provider_response: null`, and no
--    courier_parcels SELECT ever named either column (all are select('*') or explicit lists
--    without them; nothing reads them off a courier parcel). Mirrors the company_parcels schema
--    but is dead for couriers — same rationale as courier_delivery_notes.external_id (migration
--    20260627080000). company_parcels.{external_id,provider_response} are a DIFFERENT table and
--    stay (real carrier id + provider webhook payload). No function/trigger/RLS/view references
--    the courier columns. The two `null` writes were removed from CourierDeliveryNoteWizard and
--    DEPLOYED before this migration (two-phase). Rollback = re-add nullable text/jsonb columns.
DROP INDEX IF EXISTS public.idx_courier_parcels_business;
ALTER TABLE public.courier_parcels DROP COLUMN IF EXISTS external_id;
ALTER TABLE public.courier_parcels DROP COLUMN IF EXISTS provider_response;
