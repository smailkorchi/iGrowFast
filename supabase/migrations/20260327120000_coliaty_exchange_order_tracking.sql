-- Coliaty exchange (package_replacement) is per-order with package_old_tracking, not a provider default.

ALTER TABLE public.providers
  DROP COLUMN IF EXISTS coliaty_package_replacement;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coliaty_old_tracking text NULL;

COMMENT ON COLUMN public.orders.coliaty_old_tracking IS 'Coliaty /parcel/normal package_old_tracking when replace (exchange) is true.';
