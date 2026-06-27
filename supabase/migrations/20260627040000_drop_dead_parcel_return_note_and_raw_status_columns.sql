-- Drop dead parcel-grain return-note mirror columns + the never-built raw_provider_status stubs.
--
-- Returns are ORDER-grain: a return note attaches to ORDERS via the junctions
-- company_return_note_orders / courier_return_note_orders plus the back-pointers
-- orders.current_return_note_id / orders.current_courier_return_note_id. Delivery notes,
-- by contrast, are parcel-grain (company_parcels.company_delivery_note_id 1307/1307,
-- courier_parcels.courier_delivery_note_id 316/316).
--
-- The parcel-side *_return_note_id columns were created only as structural mirrors of the
-- delivery-note FK; no INSERT/UPDATE path was ever written for them, so they sat at
-- company_parcels.company_return_note_id 0/1307 and courier_parcels.courier_return_note_id 0/316
-- — the schema advertised a relationship it could never hold. Populating them would invent a
-- second, drift-prone source of truth for a link the order-grain junction already owns, so the
-- proper fix is to drop them and make the inconsistent state impossible to represent.
--
-- raw_provider_status (added 2026-06-23 in the status refactor for a provider-webhook no-match
-- capture branch that was never implemented) is 0-populated on both parcel tables — dropped too.
--
-- Dropping each column auto-drops its FK constraint and its index. Verified live before applying:
-- 0 functions / views / triggers / RLS policies / frontend code reference any of these 4 columns
-- (only the generated types, regenerated alongside this migration).
ALTER TABLE public.company_parcels DROP COLUMN IF EXISTS company_return_note_id;
ALTER TABLE public.company_parcels DROP COLUMN IF EXISTS raw_provider_status;
ALTER TABLE public.courier_parcels  DROP COLUMN IF EXISTS courier_return_note_id;
ALTER TABLE public.courier_parcels  DROP COLUMN IF EXISTS raw_provider_status;
