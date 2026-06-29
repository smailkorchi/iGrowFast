-- SECURITY (T6-SEC, db-function sweep 2026-06-29): lock down app_invoke_edge.
--
-- app_invoke_edge(p_function_name text, p_body jsonb) is SECURITY DEFINER: it reads the service_role
-- key from vault and net.http_post()s to /functions/v1/<p_function_name> with Authorization: Bearer
-- <service_role_key> and body := p_body — BOTH the target function name and the body are caller-
-- controlled. EXECUTE was granted to PUBLIC + anon + authenticated, so any logged-in (or even
-- unauthenticated, via the public anon key) PostgREST caller could invoke ANY edge function with a
-- full service-role Authorization header and an arbitrary forged payload (service-role impersonation
-- / SSRF). Verified live-exploitable against prod (workflow wf_2b34ab3f).
--
-- FIX: revoke EXECUTE from PUBLIC, anon, authenticated. The only legitimate callers run as postgres
-- and are unaffected: trigger fn tg_notify_new_login is SECURITY DEFINER owned by postgres (its
-- internal call is privilege-checked against postgres, which retains EXECUTE), and crons 33/34
-- (invitations-auto-reminder / -revoke) run as the postgres job owner. service_role keeps EXECUTE.
-- No frontend/edge .rpc('app_invoke_edge') caller exists.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.app_invoke_edge(text, jsonb) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.app_invoke_edge(text, jsonb) FROM PUBLIC, anon, authenticated;
