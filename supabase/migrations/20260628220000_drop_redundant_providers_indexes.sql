-- Drop 2 low-value indexes on providers (carrier-config registry, 4 rows). Index-only hygiene.
--
-- Verified 2026-06-28 (db-column-cleanup-progress #53):
--   * providers_active_idx(active)  — advisor-flagged unused_index, 0 scans; no covering index,
--     just pointless on a 4-row table (active filter seq-scans anyway).
--   * providers_name_idx(name)      — left-prefix-redundant with UNIQUE(name, "DigiCom Business")
--     (providers_name_per_business), which serves name-only lookups via its leading column.
--
-- KEPT: providers_pkey (19M scans), idx_providers_digicom_business (35k, tenant scope),
-- providers_created_at_idx (ordering), providers_name_per_business UNIQUE (constraint + name lookups).
-- No columns/types/frontend touched. All 44 columns are wired (config form + provider-integration dispatch).
--
-- Rollback:
--   CREATE INDEX providers_active_idx ON public.providers USING btree (active);
--   CREATE INDEX providers_name_idx ON public.providers USING btree (name);

DROP INDEX IF EXISTS public.providers_active_idx;
DROP INDEX IF EXISTS public.providers_name_idx;
