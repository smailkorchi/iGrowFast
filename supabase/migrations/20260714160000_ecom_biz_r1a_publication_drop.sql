-- R1a tail — drop the 5 orders-family tables from the wal2json publication.
--
-- Preconditions (verified 2026-07-14 ~04:50 UTC):
--   • New bundle live (commit 689dafc): zero postgres_changes bindings on these
--     tables — all consumers ride the ecom:biz broadcast (mig 20260714150000).
--   • realtime.subscription = ZERO rows database-wide (no old-bundle tab holds
--     a subscription; nginx serves only the new index.html from here on).
--   • Stale-tab residual accepted: an old bundle waking later keeps a silent
--     SUBSCRIBED channel but its aggregate queries refetch on window focus and
--     it fully heals on reload.
--
-- Publication after this drop = tracking_sync_runs, webhook_logs,
-- courier_notifications, campaign_source_locks (the R1b/R1c consumers, still
-- on postgres_changes until their ports land).
--
-- NOTE: this does NOT reduce the wal2json decode cost (61.4% of DB time) —
-- the poller decodes total WAL regardless of publication membership. The
-- decode dies only at R2 (poller retirement). This step just makes the tables
-- broadcast-only so R2's precondition (zero consumers) can be reached.
--
-- ONLY the wal2json publication is touched — supabase_realtime_messages_publication
-- (the pgoutput/broadcast slot's) must NEVER be altered.
--
-- Reversible: alter publication supabase_realtime add table <t>;

begin;

alter publication supabase_realtime drop table
  public.orders,
  public.company_parcels,
  public.courier_parcels,
  public.products,
  public.accessories;

commit;
