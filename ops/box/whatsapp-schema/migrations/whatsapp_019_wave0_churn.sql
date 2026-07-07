-- whatsapp_019_wave0_churn.sql — DB-sweep wave 0 (see docs/wa-mancer-recon/12-db-sweep-ledger.md)
--
-- 0.2  W3 grant normalization the 014b port missed: whatsapp._cron_purge_metric_samples
--      (SECURITY DEFINER purge) was EXECUTE-granted to anon+authenticated — callable by
--      any browser via /rest/v1/rpc. Build plan §5 W3 ordered all _cron_* fns
--      postgres-only (pg_cron runs as postgres; nothing else calls them).
-- 0.3  Stop the 30s stats warmer. Donor de-cached the stats RPCs on 2026-06-08 and we
--      ported the de-cached versions: ~28 of cache_warm's ~30 keys have no possible
--      reader in either codebase; the one live cached RPC (instance_stats) is not
--      warmed by it; cache_get_or_compute is compute-on-miss self-healing (0-11ms).
--      Cost of the warmer: ~86k app_cache row updates + 2,880 cron runs/day of pure
--      WAL. Janitor (job 46) STAYS — it prunes og_cache + cron.job_run_details.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ── 0.2 cron functions: postgres-only ────────────────────────────────────────
do $mig$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'whatsapp' and p.prokind = 'f'
      and p.proname like '\_cron\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    raise notice 'revoked public/anon/authenticated on %', r.sig;
  end loop;
end
$mig$;

-- ── 0.3 unschedule the warmer ────────────────────────────────────────────────
select cron.unschedule('wa-cache-warm');

commit;

-- Verify:
--   select p.proname, a.grantee::regrole
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
--        lateral aclexplode(p.proacl) a
--   where n.nspname='whatsapp' and p.proname like '\_cron\_%' escape '\';
--   -- expect only postgres (owner) rows
--   select jobname from cron.job where jobname like 'wa-cache%';
--   -- expect only wa-cache-janitor
