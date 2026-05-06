-- AMEEX exchange: old parcel tracking is per-order (like coliaty_old_tracking), not a provider toggle.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ameex_old_tracking text NULL;

COMMENT ON COLUMN public.orders.ameex_old_tracking IS 'AMEEX Parcels/Add: exchange_code (previous parcel tracking) when order.replace is true.';
