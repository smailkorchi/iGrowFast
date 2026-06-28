-- SECURITY: lock down the seller-commission money view seller_daily_earnings (db #57 / register T1).
--
-- The view is NON-security_invoker (bypasses orders/users RLS, returns ALL sellers' commission across
-- ALL businesses unfiltered) yet anon + authenticated held blanket grants incl. anon SELECT — so the
-- PUBLIC anon key (shipped in the frontend bundle) could GET /rest/v1/seller_daily_earnings and read
-- every seller's commission. This revoke closes the anon exposure.
--
-- SAFE: the app reads this view ONLY via the authenticated session (all 14 consumers are behind auth;
-- edge fns use service_role) — keeping authenticated SELECT preserves every read path. The view is an
-- aggregate (not writable), so the INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants are inert
-- junk; revoked for hygiene.
--
-- DEFERRED (Task #12, careful money-parity pass): ALTER VIEW ... SET (security_invoker = true) so
-- orders RLS scopes the view per caller (seller→own, admin→own business), closing the authenticated
-- cross-seller/cross-tenant read too. NOT done here (changes what each role sees on the money source).
--
-- Rollback (restores the insecure blanket grants):
--   GRANT ALL ON public.seller_daily_earnings TO anon, authenticated;

REVOKE ALL ON public.seller_daily_earnings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.seller_daily_earnings FROM authenticated;
