-- SECURITY (defense-in-depth, sibling of seller_daily_earnings fix): public.seller_ledger is a
-- postgres-owned view = SELECT * FROM seller_payments (+ computed remaining), granted to anon and
-- authenticated, defined WITHOUT security_invoker. It does not currently leak (underlying RLS is
-- applied in this instance), but as a non-invoker view over a money table it is the same unsafe
-- pattern as seller_daily_earnings and must not depend on incidental RLS behavior.
--
-- FIX: security_invoker = on -> always run with the querying user's RLS on seller_payments
-- (seller_payments_select_scoped: seller_id = auth.uid() OR (tenant + admin role)). Zero behavior
-- change for legitimate users (verified on dev: biz admin sees 8 = RLS-direct 8); guarantees no
-- future bypass.
--
-- Rollback: ALTER VIEW public.seller_ledger SET (security_invoker = off);

ALTER VIEW public.seller_ledger SET (security_invoker = on);
