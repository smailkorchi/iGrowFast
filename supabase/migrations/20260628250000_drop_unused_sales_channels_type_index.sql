-- Drop the unused, non-FK-backing idx_sales_channels_type (sales_channels, 1 row). Index-only hygiene.
--
-- Verified 2026-06-28 (db-column-cleanup-progress #56): advisor-flagged unused_index; `type` is a plain
-- text column (not an FK), and no code filters by it (SalesChannelsSection selects type for display only,
-- filters by "DigiCom Business"). Dropping it cannot cause an unindexed_fk regression.
--
-- KEPT: sales_channels_business_idx — also advisor-flagged unused, but it BACKS the
-- "DigiCom Business"→businesses FK (+ the SalesChannelsSection tenant filter); dropping it would just
-- trade unused_index for unindexed_fk and hurt at scale. Conservative keep (ga_connections/meta_ads rule).
--
-- Rollback: CREATE INDEX idx_sales_channels_type ON public.sales_channels USING btree (type);

DROP INDEX IF EXISTS public.idx_sales_channels_type;
