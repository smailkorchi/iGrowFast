-- Drop 4 dead columns from provider_cities (carrier-city→master-city normalization, 4279 rows).
--
-- Verified 2026-06-28 (full consumer sweep, see db-column-cleanup-progress #51):
--   * NO select('*') exists on provider_cities anywhere → every read is an explicit column list.
--   * Every from('provider_cities') site reviewed: owner/Cities upsert writes only
--     {master_city_id, provider_type, provider_city_id, provider_city_name, updated_at};
--     admin/seller Orders read {master_city_id, provider_type, fees}; provider-integration ×10
--     read only {provider_city_id, provider_city_name}.
--   * NO consumer (app / DB fn / view / edge fn) reads lat, lng, schedule, or metadata.
--   * NO live writer touches them — they were bulk-imported once from the carrier APIs and frozen.
--   * fn_refs = null, view_refs = null for the whole table (DROP without CASCADE proves zero deps).
--
-- lat/lng = the same dead geocoding dropped from master_cities (#34); identical 412/4279 population.
-- schedule (1464) / metadata (1650) = provider-API import artifacts, never wired to any feature.
-- fees (2725) is KEPT — actively read as the Orders delivery-fee fallback (fees.delivered/refused/returned).
--
-- Pure-DB drop: nothing names these in a PostgREST select() string, so no frontend phase-1 is needed.
--
-- Rollback:
--   ALTER TABLE public.provider_cities
--     ADD COLUMN lat numeric, ADD COLUMN lng numeric,
--     ADD COLUMN schedule jsonb DEFAULT '{}'::jsonb, ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
--   (data not recoverable — was one-time import only.)

ALTER TABLE public.provider_cities
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS schedule,
  DROP COLUMN IF EXISTS metadata;
