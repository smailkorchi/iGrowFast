-- F0-6 (2026-07-17): cron.job_run_details grew unbounded — 41,749 rows / 12MB in 7 days
-- (the every-minute payout cron alone adds 1,440/day; ~100MB+/year). No purge existed.
-- realtime.messages verified healthy: partitioned daily, realtime janitor drops
-- partitions older than ~3 days (oldest live partition = 3 days back) — no action.
-- ALREADY APPLIED to box via db.sh (jobid 54); this file is the repo record.
SELECT cron.schedule(
  'cron_history_purge',
  '20 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);
