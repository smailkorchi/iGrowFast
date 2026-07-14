-- R1b tail — drop the 3 logistics tables from the wal2json publication.
--
-- GATE (verify before applying): R1b FE bundle deployed AND
-- realtime.subscription shows zero rows on these entities (couriers rely on
-- courier_notifications for operational toasts — never cut the old feed while
-- a pre-R1b bundle holds it).
--
-- Publication after this drop = campaign_source_locks ONLY (→ R1c empties it,
-- unblocking R2 poller retirement).
--
-- Reversible: alter publication supabase_realtime add table <t>;

begin;

alter publication supabase_realtime drop table
  public.tracking_sync_runs,
  public.webhook_logs,
  public.courier_notifications;

commit;
