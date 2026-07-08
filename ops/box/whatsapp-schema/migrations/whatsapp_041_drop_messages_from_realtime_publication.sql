-- whatsapp_041_drop_messages_from_realtime_publication.sql
-- THE 62.6% WIN: remove whatsapp.messages from the supabase_realtime publication.
-- realtime.list_changes (the wal2json poll) was 62.6% of DB exec time, and its
-- cost is O(WAL bytes decoded). messages is the hottest table; every message +
-- delivery-status/reaction/pin update was decoded by the poll for every whatsapp
-- realtime subscriber.
--
-- PRECONDITIONS (all met before applying, 2026-07-08):
--   • The message THREAD realtime was moved to the private wa:conv:<id> broadcast
--     (trigger whatsapp._broadcast_message, migration 040) — decrypted payload,
--     zero re-fetch. Verified correct on live traffic (text/media, no lost body).
--   • The frontend useThreadRealtime was cut over to broadcast-only + reconciliation
--     and DEPLOYED; owner verified a live thread updates broadcast-only.
--   • Exhaustive check: the only remaining messages postgres_changes subscriber is
--     the pair-modal sync-metrics (instances.ts), which has a 2s poll backstop and
--     degrades gracefully. Active realtime.subscription on messages = 0 (blast
--     radius zero at apply time).
--
-- Message broadcasts (realtime.send) ride the SEPARATE supabase_realtime_messages
-- publication/slot, so they are UNAFFECTED by this drop.
--
-- INSTANTLY REVERSIBLE:
--   alter publication supabase_realtime add table whatsapp.messages;
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;
alter publication supabase_realtime drop table whatsapp.messages;
commit;
