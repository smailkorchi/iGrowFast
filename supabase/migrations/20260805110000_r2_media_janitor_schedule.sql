-- Schedule the R2 media janitor (Notion Ref 16, second half).
--
-- Same two-phase shape as the Supabase janitor, and the same reasoning: quarantine is a MOVE and
-- is reversible; purge only ever touches what already sat under _gc/ for the age floor.
--
-- One difference that matters: the whatsapp-media bucket has NO byte-level backup, unlike Supabase
-- storage (which is mirrored nightly to R2 with a 45-day archive). Nothing recovers a wrongly purged
-- object here. That is why the janitor moves rather than deletes, and why these run weekly rather
-- than nightly — a mistake stays visible in _gc/ for a long time before anything is final.
--
-- First live report: 4,900 objects / 2.60 GB, 4,878 referenced, 22 orphaned (4.8 MB), 0 old enough.
-- The existing deletion-time cleanup is evidently working; this is the leak-catcher, not the mechanism.
--
-- Rollback: select cron.unschedule('r2-media-janitor-quarantine');
--           select cron.unschedule('r2-media-janitor-purge');

BEGIN;

SELECT cron.unschedule('r2-media-janitor-quarantine')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'r2-media-janitor-quarantine');
SELECT cron.unschedule('r2-media-janitor-purge')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'r2-media-janitor-purge');

-- Staggered well clear of the Supabase janitor (03:20 / 03:40) so the two never contend.
SELECT cron.schedule('r2-media-janitor-quarantine', '10 4 * * 0',
  $$SELECT public.app_invoke_edge('r2-media-janitor', '{"mode":"quarantine"}'::jsonb);$$);

SELECT cron.schedule('r2-media-janitor-purge', '30 4 * * 0',
  $$SELECT public.app_invoke_edge('r2-media-janitor', '{"mode":"purge"}'::jsonb);$$);

COMMIT;
