-- HYGIENE (T7 trigger-sweep #3, 2026-06-29): align the courier parcel->order status-sync trigger
-- with its company twin.
--
-- sync_courier_parcel_status_trigger fired AFTER INSERT OR UPDATE (ALL columns, no WHEN), so every
-- courier_parcels edit (tracking_code, flags, delivered_at...) entered sync_courier_parcel_status_to_order.
-- The company twin sync_company_parcel_status_trigger is scoped to UPDATE OF status_id WHEN
-- (new.order_id IS NOT NULL). The function already short-circuits on an unchanged status_id, so
-- behavior is unchanged; this only stops the trigger being entered on unrelated updates and removes a
-- pointless asymmetry between the two parcel tables.
--
-- Rollback: recreate sync_courier_parcel_status_trigger AFTER INSERT OR UPDATE (all columns, no WHEN).

DROP TRIGGER IF EXISTS sync_courier_parcel_status_trigger ON public.courier_parcels;
CREATE TRIGGER sync_courier_parcel_status_trigger
  AFTER INSERT OR UPDATE OF status_id ON public.courier_parcels
  FOR EACH ROW WHEN (new.order_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_courier_parcel_status_to_order();
