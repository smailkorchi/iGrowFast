-- R1c — retire campaign_source_locks from the wal2json publication.
--
-- Its sole consumer (CampaignForm) is off realtime as of this batch: the table
-- is near-static (0 rows, 0 writes in 11 days of prod) and the campaign-create
-- DB guard (source_taken) enforces the one-source-per-MB rule at submit; the
-- form keeps the picker fresh with a 30s poll while open. Broadcasting it
-- would have required granting media-buyer sessions the whole ecom:biz feed —
-- rejected as an unjustified access widening for a dead-churn table.
--
-- THE PUBLICATION IS EMPTY AFTER THIS. postgres_changes has ZERO consumers and
-- zero published tables app-wide → R2 (retire the postgres_cdc_rls poller,
-- reclaim the 61.4% realtime.list_changes DB time) is unblocked.
--
-- Reversible: alter publication supabase_realtime add table public.campaign_source_locks;

begin;

alter publication supabase_realtime drop table public.campaign_source_locks;

commit;
