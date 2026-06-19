-- These run only from the sync trigger (definer context, owned by postgres)
-- and the pg_cron job (owned by postgres). No client should call them
-- directly, so strip the default PUBLIC execute grant. Triggers still fire
-- (EXECUTE is checked at CREATE TRIGGER time, not at fire time) and the
-- cron job still runs as its postgres owner.
revoke execute on function public.generate_recurring_charges(date, uuid) from public, anon, authenticated;
revoke execute on function public.tg_recurring_charges_sync() from public, anon, authenticated;
revoke execute on function public.tg_touch_updated_at() from public, anon, authenticated;
