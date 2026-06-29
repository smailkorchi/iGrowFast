-- HYGIENE (T7 trigger-sweep #4, 2026-06-29): pin search_path on the two payment-txns refresh trigger
-- functions. They were the only trigger functions with an unpinned (mutable) search_path, yet they
-- sit on the money path (each PERFORMs the SECDEF refresh_*_payment_balance recompute on every
-- seller/mediabuyer payment-txn write). Both already fully-qualify their calls (public.refresh_*),
-- so this is purely defensive: pin resolution so a caller-set search_path can never influence them.
--
-- Rollback: ALTER FUNCTION ... RESET search_path; on both.

ALTER FUNCTION public.trg_seller_payment_txns_refresh()     SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_mediabuyer_payment_txns_refresh() SET search_path = public, pg_catalog;
