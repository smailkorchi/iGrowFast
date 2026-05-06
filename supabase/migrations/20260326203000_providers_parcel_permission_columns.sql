-- Parcel-creation permission fields per provider row (public.providers).
-- App reads/writes the set matching providers.provider_type; others stay at defaults.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS coliaty_package_no_open boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.providers.coliaty_package_no_open IS 'Coliaty parcel create JSON: package_no_open';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS ameex_parcel_replace boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ameex_parcel_open boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ameex_parcel_try_on boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ameex_parcel_fragile boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.providers.ameex_parcel_replace IS 'AMEEX multipart: replace=true/false';
COMMENT ON COLUMN public.providers.ameex_parcel_open IS 'AMEEX multipart: open=YES (true) / NO (false)';
COMMENT ON COLUMN public.providers.ameex_parcel_try_on IS 'AMEEX multipart: try=YES (true) / NO (false)';
COMMENT ON COLUMN public.providers.ameex_parcel_fragile IS 'AMEEX multipart: fragile 1 (true) / 0 (false)';

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS ozon_parcel_open smallint NOT NULL DEFAULT 1
    CONSTRAINT providers_ozon_parcel_open_chk CHECK (ozon_parcel_open = ANY (ARRAY[1, 2])),
  ADD COLUMN IF NOT EXISTS ozon_parcel_fragile smallint NOT NULL DEFAULT 0
    CONSTRAINT providers_ozon_parcel_fragile_chk CHECK (ozon_parcel_fragile = ANY (ARRAY[0, 1])),
  ADD COLUMN IF NOT EXISTS ozon_parcel_replace smallint NOT NULL DEFAULT 0
    CONSTRAINT providers_ozon_parcel_replace_chk CHECK (ozon_parcel_replace = ANY (ARRAY[0, 1]));

COMMENT ON COLUMN public.providers.ozon_parcel_open IS 'Ozon parcel-open: 1=ouvrir, 2=ne pas ouvrir (default 1)';
COMMENT ON COLUMN public.providers.ozon_parcel_fragile IS 'Ozon parcel-fragile: 1=oui, 0=non (default 0)';
COMMENT ON COLUMN public.providers.ozon_parcel_replace IS 'Ozon parcel-replace: 1=oui, 0=non (default 0)';
