-- Stage-0 additive indexes (enterprise audit). CREATE INDEX CONCURRENTLY = no
-- table lock, no write blocking; each is a superset-precise partial index for a
-- hot access pattern that currently seq-scans or sorts. Cannot run in a txn
-- (CONCURRENTLY), so run statement-by-statement:
--   ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file
-- If any CONCURRENTLY build fails it leaves an INVALID index — drop + retry.

-- 1. useInstancesUnread: SELECT ... WHERE unread_count>0 (per admin, per inbound
--    burst). No supporting index today → Seq Scan. O(table) at scale.
create index concurrently if not exists conversations_unread_idx
  on whatsapp.conversations (instance_id)
  where unread_count > 0 and merged_into is null;

-- 2. Inbox list ORDER BY is_pinned DESC, last_message_at DESC (the existing
--    status_active_idx orders by last_message_at only → a quicksort of the whole
--    open set every page/refetch). This satisfies the full sort from the index.
create index concurrently if not exists conversations_list_pinned_idx
  on whatsapp.conversations (instance_id, is_pinned desc, last_message_at desc nulls last)
  where status in ('open','pending') and is_archived = false and merged_into is null;

-- 3. dispatch_gate_check counts sent rows per number to enforce hourly/daily caps
--    (runs per dispatch); only a status='queued' partial index exists → Seq Scan
--    on the ever-growing 'sent' set.
create index concurrently if not exists outbound_queue_sent_cap_idx
  on whatsapp.outbound_queue (number_id, dispatched_at)
  where status = 'sent';

-- 4. _cron_consolidate_split_conversations (per-minute) scans conversations for
--    unmerged @lid DMs; today a full scan even when the set is empty.
create index concurrently if not exists conversations_lid_unmerged_idx
  on whatsapp.conversations (id)
  where remote_jid like '%@lid' and merged_into is null and is_group = false;
