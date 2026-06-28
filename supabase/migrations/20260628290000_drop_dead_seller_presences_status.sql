-- Drop dead seller_presences.status (db #62). 6→5 cols.
--
-- Verified 2026-06-28: status is 141/141 NULL, no CHECK, no index, no fn ref (ILIKE), and ZERO
-- consumers read or write it. The presence model is row-EXISTENCE per (seller_id, date) — Dashboard
-- upserts {seller_id, date} (never status, which is why all rows are null), Wallet/SellersSection
-- select id/date/seller_id, Statistics is count-only (head:true), admin Sellers uses select('*') but
-- never reads .status. Scaffolded for a richer present/absent/late model never built.
--
-- No explicit select names `status`; the two select('*') paths adapt → no two-phase. DROP w/o CASCADE.
-- Rollback: ALTER TABLE public.seller_presences ADD COLUMN status text;

ALTER TABLE public.seller_presences DROP COLUMN IF EXISTS status;
