-- Phase 2: drop the redundant parcel `reference` column.
--
-- `reference` was a byte-identical duplicate of `tracking_code` on BOTH parcel tables
-- (company_parcels 0/1307 rows differ, courier_parcels 0/316 differ). The two writers
-- (DeliveryNoteWizard / CourierDeliveryNoteWizard) set reference and tracking_code from the
-- same value; the only readers were a duplicate "Réf." column on the bon de livraison PDF
-- (= the "Suivi" tracking column) and unreachable `tracking_code || reference` fallbacks.
-- It is unindexed with no constraint/FK/default, so it carried write/width cost for zero
-- query benefit and was a latent drift hazard (the writer's `|| 'N/A'` operand could desync it
-- from tracking_code). Single source of truth = tracking_code; the genuinely-distinct carrier
-- id stays in external_id.
--
-- All frontend reads/writes were removed and DEPLOYED before this migration (phase 1), so the
-- live site never selects the now-missing column. company/courier_delivery_notes.reference is a
-- DIFFERENT column on a different table and is NOT touched. Nothing in functions / triggers /
-- views / RLS references the parcel column (verified). Both tables stay in supabase_realtime
-- (payloads simply stop carrying reference). Rollback = re-add nullable text column; no unique
-- data is lost (every value still lives in tracking_code).
ALTER TABLE public.company_parcels DROP COLUMN IF EXISTS reference;
ALTER TABLE public.courier_parcels DROP COLUMN IF EXISTS reference;
