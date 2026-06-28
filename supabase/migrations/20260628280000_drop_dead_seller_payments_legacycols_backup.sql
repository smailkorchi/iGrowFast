-- Drop the dead seller_payments legacy-columns backup table (db #61). User-approved 2026-06-28.
--
-- seller_payments_legacycols_bak_20260618 = a one-time 2026-06-18 snapshot of the legacy columns
-- (id, commission_earned, salary_earned, days_present, bank_snapshot) dropped from seller_payments
-- during that cleanup. 11 rows. ZERO consumers (no fn/view/frontend/edge reference).
--
-- SECURITY: it had RLS DISABLED + blanket anon grants (incl SELECT) → the public anon key could read
-- bank_snapshot + commission/salary money data. Dropping it removes both the dead data and the exposure.
-- The cleanup it backed is stable (the new seller payout ledger is live; engine fns running).
--
-- No inbound FKs (standalone backup) → DROP without CASCADE.
-- Rollback: not recoverable (it was itself a backup; the live data is in seller_payments + seller_daily_earnings).

DROP TABLE IF EXISTS public.seller_payments_legacycols_bak_20260618;
