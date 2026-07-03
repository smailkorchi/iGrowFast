-- R7 (part 2/2, BREAKING) — remove the anon username->email directory read.
--
-- APPLY ONLY AFTER the new frontend bundle (which resolves the login email via
-- public.login_email_for_username) is confirmed live. The previous bundle does
-- a pre-login `users.select('email').eq('username', ...)` under the anon key;
-- dropping the policy + column grant below breaks username login for anyone
-- still on the old bundle. Email login is unaffected either way.
--
-- Depends on 20260703000000 having created public.login_email_for_username.

BEGIN;

DROP POLICY IF EXISTS users_anon_login_lookup ON public.users;
REVOKE SELECT (email, username) ON public.users FROM anon;

COMMIT;
