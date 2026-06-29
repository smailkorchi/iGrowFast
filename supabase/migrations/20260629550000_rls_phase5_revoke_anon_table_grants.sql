-- SECURITY RLS SWEEP — PHASE 5: revoke the blanket `anon` table grants (defense-in-depth).
--
-- The Supabase clone default granted `anon` FULL table+column DML
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on EVERY public table — including
-- UPDATE on users.role and users.salary_amount. After Phases 1-4 the RLS is tenant-scoped on
-- every table and is the live gate that blocks anon, so these grants are inert today — but they
-- are a privilege-escalation landmine if any policy ever regresses or a table's RLS is disabled.
--
-- anon legitimately needs exactly ONE thing over PostgREST: SELECT(email, username) on `users`
-- for the username->email login lookup (Auth.tsx:122). Register + ChangeCredentials authenticate
-- via GoTrue + service_role edge functions and never read tables as anon (verified empirically:
-- post-Phase-4, anon could already only read `users`; businesses/plans/platform_settings/
-- user_invitations all returned 0 under RLS).
--
-- `REVOKE ALL PRIVILEGES ON ALL TABLES` clears BOTH table-level and column-level grants
-- (verified on dev: 0 table + 0 column anon grants remain), so we then re-grant only the two
-- login-lookup columns. authenticated/service_role grants are untouched.
--
-- Rollback: GRANT ALL ON ALL TABLES IN SCHEMA public TO anon; (do NOT — restores the landmine).

revoke all privileges on all tables in schema public from anon;
grant select (email, username) on public.users to anon;
