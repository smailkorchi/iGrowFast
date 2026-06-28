-- Drop 2 exact-duplicate indexes on seller_demands (the 2 DB-wide duplicate_index advisor lints). #58.
--
-- Verified 2026-06-28: byte-identical pairs —
--   idx_sd_business_id      == seller_demands_business_idx   (both btree on "DigiCom Business")
--   idx_sd_seller_id        == seller_demands_seller_idx     (both btree on seller_id)
-- Keep the twin-consistent, higher-scan ones (seller_demands_business_idx 120, seller_demands_seller_idx 101);
-- the dropped abbreviated ones (idx_sd_business_id 4, idx_sd_seller_id 71) transfer their scans to the kept
-- duplicates. Matches the mediabuyer_demands twin naming (#35). No col/type/frontend change.
--
-- Rollback:
--   CREATE INDEX idx_sd_business_id ON public.seller_demands USING btree ("DigiCom Business");
--   CREATE INDEX idx_sd_seller_id ON public.seller_demands USING btree (seller_id);

DROP INDEX IF EXISTS public.idx_sd_business_id;
DROP INDEX IF EXISTS public.idx_sd_seller_id;
