-- SECURITY: refresh_seller_payment_balance / refresh_mediabuyer_payment_balance are SECURITY DEFINER
-- with NO caller authorization check, and were callable as RPC by `authenticated` via /rest/v1/rpc.
-- (Low severity: they only recompute a payment's cached paid_amount/status/paid_at from existing txns
-- -- idempotent, return void, cannot create/move money -- but it is an unguarded privileged write
-- exposed to any signed-in user.) The app never calls them via rpc (grep-verified).
--
-- All call paths are SECURITY DEFINER (refresh_open_seller_ticket, refresh_open_mediabuyer_ticket,
-- close_seller_month, close_mediabuyer_month) EXCEPT the two AIUD trigger functions on
-- {seller,mediabuyer}_payment_txns, which were SECURITY INVOKER. When an admin writes those txn tables
-- directly (e.g. the bulk-settle path in admin/Salaries.tsx), the invoker trigger would need EXECUTE
-- on the refresh fn -- so we cannot simply revoke. FIX: make the two trigger functions SECURITY
-- DEFINER (they are thin wrappers that only PERFORM refresh_*; search_path already pinned), so every
-- call path runs as the owner; THEN revoke EXECUTE on the refresh fns from anon/authenticated/PUBLIC.
-- Net: refresh fns no longer reachable over the API; all internal/trigger paths keep working.
--
-- Verified on dev: an authenticated admin's direct INSERT and DELETE on mediabuyer_payment_txns still
-- fire the (now SECDEF) trigger and recompute the balance correctly (40 -> 47 -> 40) with no
-- "permission denied for function" error.
--
-- Rollback: ALTER ... SECURITY INVOKER on the two trigger fns; GRANT EXECUTE ON refresh_* TO authenticated.

ALTER FUNCTION public.trg_seller_payment_txns_refresh() SECURITY DEFINER;
ALTER FUNCTION public.trg_mediabuyer_payment_txns_refresh() SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.refresh_seller_payment_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_mediabuyer_payment_balance(uuid) FROM PUBLIC, anon, authenticated;
