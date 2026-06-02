-- HOTFIX: restore the pre-auth username->email login lookup broken by
-- 20260602120000_rls_tenant_scoping_status_and_pii.sql.
--
-- Auth.tsx:34-38 (login) runs as the ANON role before sign-in:
--   supabase.from('users').select('email').eq('username', identifier).single()
-- Batch 1 dropped "Profiles are viewable by everyone" (which allowed anon),
-- so anon got 0 rows -> PostgREST .single() -> HTTP 406 -> nobody can log in
-- with a username.
--
-- Restore anon read for this lookup ONLY, column-restricted to (username,email)
-- so the sensitive PII batch 1 was protecting (bank_rib, cin_number,
-- salary_amount, phone, address, bank_account_holder, commission_*, permissions,
-- products) stays hidden from anon. This is strictly tighter than the original
-- policy, which exposed every column to anon.
--
-- Authenticated reads remain governed by users_tenant_select (self/tenant/owner).
-- Follow-up hardening (separate change): replace the direct anon table read with
-- a SECURITY DEFINER RPC returning email-by-username, then drop this anon policy
-- to also remove username->email enumeration.

REVOKE SELECT ON public.users FROM anon;
GRANT SELECT (username, email) ON public.users TO anon;

DROP POLICY IF EXISTS users_anon_login_lookup ON public.users;
CREATE POLICY users_anon_login_lookup ON public.users
  FOR SELECT TO anon
  USING (true);
