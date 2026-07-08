-- whatsapp_027_drop_dead_hard_delete_merge_path.sql
-- Owner directive 2026-07-08: "ditch every old path that was disabled or patched."
-- Verified against the DONOR'S LIVE production DB (project xlhlezgpgrypdijynmqr):
-- the donor keeps jid_mapping_resolved DISABLED and its hard-delete merge
-- functions dead-but-present; we go one better and REMOVE the path entirely.
--
-- The dead path (the old hard-delete conversation-merge, superseded by the
-- soft-tombstone consolidate_lid_conversation → merge_conversation path):
--   * trigger jid_mapping_resolved (already disabled in 026)
--   * whatsapp._on_jid_mapping_resolved()  — 0 callers, only wired to the trigger
--   * whatsapp.merge_conversations(uuid,uuid) [PLURAL, hard-deletes conversations]
--        — sole caller is _on_jid_mapping_resolved (dropped here)
--
-- VERIFIED SAFE (both DBs + repo + edge fns): the plural merge_conversations is
-- referenced by nothing except _on_jid_mapping_resolved; no code/edge/worker
-- caller; the LIVE consolidation path uses merge_conversation (SINGULAR, soft)
-- via consolidate_lid_conversation + _cron_consolidate_split_conversations, both
-- kept. Not to be confused with the singular merge_conversation which STAYS.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

drop trigger if exists jid_mapping_resolved on whatsapp.jid_mapping;
drop function if exists whatsapp._on_jid_mapping_resolved();
drop function if exists whatsapp.merge_conversations(uuid, uuid);   -- PLURAL, hard-delete

commit;

-- Verify:
--   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='whatsapp' and p.proname in ('_on_jid_mapping_resolved','merge_conversations');
--   -- expect 0 rows
--   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='whatsapp' and p.proname='merge_conversation';  -- expect 1 (singular SOFT — kept)
