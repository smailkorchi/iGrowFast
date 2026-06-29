-- SECURITY (fix regression from 20260629450000): making trg_{seller,mediabuyer}_payment_txns_refresh
-- SECURITY DEFINER (to let us revoke the refresh fns) caused the trigger functions THEMSELVES to be
-- newly flagged as anon/authenticated-executable SECDEF functions. Like all trigger functions they
-- fire via the trigger mechanism regardless of EXECUTE privilege and are never called as RPC, so
-- revoke their EXECUTE from PUBLIC/anon/authenticated. Net: both refresh fns AND their trigger
-- wrappers are now unreachable over the API; trigger firing unaffected (dev-verified: authenticated
-- insert on mediabuyer_payment_txns still fires the trigger).
-- Rollback: GRANT EXECUTE ON FUNCTION <fn>() TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.trg_seller_payment_txns_refresh() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_mediabuyer_payment_txns_refresh() FROM PUBLIC, anon, authenticated;
