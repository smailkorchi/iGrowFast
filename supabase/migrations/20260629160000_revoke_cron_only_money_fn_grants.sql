-- SECURITY (T6-SEC, db-function sweep 2026-06-29): lock down the cron/internal-only money functions.
--
-- These five SECURITY DEFINER functions (run as postgres, bypass RLS) had EXECUTE granted to
-- PUBLIC + anon + authenticated, yet have NO legitimate external caller — only pg_cron jobs and
-- other SECDEF functions invoke them, all running as postgres:
--   close_seller_month(date)              cron 30 (monthly)            -- anon could force-close payout month for all biz
--   close_mediabuyer_month(date)          cron 35 (monthly)            --   (the admin guard is fail-open for anon: auth.uid() IS NULL)
--   refresh_open_seller_ticket(uuid,uuid,date)     cron 31 + pay_seller (SECDEF)
--   refresh_open_mediabuyer_ticket(uuid,uuid,date) cron 36 + pay_mediabuyer (SECDEF)
--   mb_month_earned(uuid,uuid,date)       close_mediabuyer_month + refresh_open_mediabuyer_ticket (SECDEF)
--                                                                       -- no guard at all: anon cross-tenant financial read
-- Verified zero frontend/edge .rpc() callers (only generated database.types.ts + code comments).
--
-- FIX: revoke EXECUTE from PUBLIC, anon, authenticated. Crons run as the postgres job owner and the
-- SECDEF callers run as postgres, so postgres (retains EXECUTE) drives every legitimate path.
-- service_role keeps EXECUTE. Non-breaking. (The fail-open guard inside close_*/refresh_open_* is left
-- as-is for now — once anon can't reach them the NULL-uid bypass is moot; hardening it to fail-closed
-- is tracked separately as defense-in-depth.)
--
-- Rollback: GRANT EXECUTE ON FUNCTION <each signature> TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.close_seller_month(date)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_mediabuyer_month(date)                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_open_seller_ticket(uuid, uuid, date)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_open_mediabuyer_ticket(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mb_month_earned(uuid, uuid, date)              FROM PUBLIC, anon, authenticated;
