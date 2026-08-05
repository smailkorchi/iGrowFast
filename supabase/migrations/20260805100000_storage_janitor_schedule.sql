-- Schedule the storage janitor (Notion Ref 16).
--
-- Two jobs, deliberately separate, because they carry different risk:
--   quarantine  — reversible. Finds newly orphaned objects and MOVES them under _gc/<date>/.
--                 Nothing is destroyed; a mistake is undone with a rename.
--   purge       — irreversible, and only ever touches objects ALREADY under _gc/ whose quarantine
--                 date is older than 30 days. So an object must be unreferenced for 30 days,
--                 survive a quarantine run, and then sit visibly in _gc/ for another 30 before it
--                 can be destroyed. Roughly two months from "nothing points at this" to deletion.
--
-- The janitor itself enforces the real safety: a hardcoded two-bucket allow-list (products,
-- business-logos), an abort if any reference fails to resolve, and a per-run object cap. These
-- schedules only decide when it runs — they cannot widen what it may touch.
--
-- Weekly rather than nightly on purpose: this reclaims tens of megabytes, not gigabytes, and a
-- slower cadence means a mistake sits visible for longer before the next stage moves it along.
--
-- Rollback: select cron.unschedule('storage-janitor-quarantine');
--           select cron.unschedule('storage-janitor-purge');

BEGIN;

SELECT cron.unschedule('storage-janitor-quarantine')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-janitor-quarantine');
SELECT cron.unschedule('storage-janitor-purge')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storage-janitor-purge');

-- Sunday 03:20 UTC — after the nightly logical dump (03:10 CEST) so a mistake is already captured
-- in that night's backup, and before the storage mirror (04:30 CEST) so the move is reflected there.
SELECT cron.schedule(
  'storage-janitor-quarantine',
  '20 3 * * 0',
  $$SELECT public.app_invoke_edge('storage-janitor', '{"mode":"quarantine"}'::jsonb);$$
);

-- Sunday 03:40 UTC, twenty minutes later so the two never overlap.
SELECT cron.schedule(
  'storage-janitor-purge',
  '40 3 * * 0',
  $$SELECT public.app_invoke_edge('storage-janitor', '{"mode":"purge"}'::jsonb);$$
);

COMMIT;
