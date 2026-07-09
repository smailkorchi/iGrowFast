-- whatsapp_053_drop_last_tables_from_publication.sql
-- Enterprise-scale plan PHASE 2b — FINAL. Drops the last 5 WhatsApp tables from
-- the supabase_realtime publication. After this, ZERO whatsapp-schema tables are
-- in the publication → WhatsApp is fully off postgres_changes (the precondition
-- for eventually dropping the shared wal2json slot, once the e-commerce/public
-- tables are also migrated — W7).
--
-- All 5 consumers were re-homed onto the unified wa:biz (admin) / wa:user (agent)
-- broadcast channels (waChannels.ts) via the mig 052 triggers + the earlier
-- 049/051 triggers. Verified live BEFORE this drop: a multi-line-aware search
-- (grep for `use*Realtime(` call sites outside lib/queries/) returns ZERO — no
-- component subscribes any of these tables via postgres_changes. (This is the
-- exact check that was skipped before mig 050 and caused the assignments.ts
-- regression; done properly here.)
--
-- Broadcast is publication-INDEPENDENT (realtime.send → pgoutput messages slot ≠
-- wal2json slot), so the triggers keep firing after this drop.
--
-- Reversible: alter publication supabase_realtime add table whatsapp.<t> (×5).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

alter publication supabase_realtime drop table whatsapp.conversation_assignments;
alter publication supabase_realtime drop table whatsapp.conversation_tags;
alter publication supabase_realtime drop table whatsapp.tags;
alter publication supabase_realtime drop table whatsapp.quick_replies;
alter publication supabase_realtime drop table whatsapp.scheduled_messages;

commit;
