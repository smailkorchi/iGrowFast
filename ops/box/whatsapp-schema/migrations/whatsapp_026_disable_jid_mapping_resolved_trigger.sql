-- whatsapp_026_disable_jid_mapping_resolved_trigger.sql
-- PORT DRIFT FIX (donor-faithful). The donor CREATED the jid_mapping_resolved
-- trigger then PERMANENTLY DISABLED it in phase0 on 2026-06-01
-- (donor 20260601050031_phase0_disable_jid_mapping_resolved_trigger.sql:
--  `ALTER TABLE public.jid_mapping DISABLE TRIGGER jid_mapping_resolved;`,
-- never re-enabled in any of its 249 migrations). Our port created the trigger
-- (whatsapp_010b_resolution.sql:587-591) but never disabled it — it is
-- live-ENABLED on the box (tgenabled='O', verified).
--
-- Why it's a landmine: the trigger fires whatsapp._on_jid_mapping_resolved →
-- whatsapp.merge_conversations (plural), which HARD-DELETES a conversation
--   (delete from whatsapp.conversations where id = p_source_id)
-- keyed off the raw jid_mapping table. Every worker upsert_jid_mapping INSERT
-- synchronously runs that hard-delete merge BEFORE the sanctioned bible-gated
-- SOFT path (consolidate_lid → merge_conversation → merged_into tombstone) runs
-- in the same worker function — so consolidate_lid then finds the conversation
-- already gone and no-ops, making the DESTRUCTIVE hard-delete the live
-- consolidation path and defeating the entire merged_into soft-tombstone
-- design. A wrong/transposed jid_mapping pair fuses two unrelated conversations
-- and unrecoverably deletes one. Masked today only because the presence-guesser
-- was removed (jid_mapping now gets clean deterministic pairs) — but it is a
-- live fusion landmine, not benign.
--
-- Fix = the donor's fix, verbatim: disable the trigger. All @lid consolidation
-- then flows ONLY through the soft path + the per-minute
-- _cron_consolidate_split_conversations, exactly as the donor runs it. The dead
-- merge_conversations(plural) / _on_jid_mapping_resolved functions are LEFT in
-- place (the donor left them too — disable, don't drop).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

alter table whatsapp.jid_mapping disable trigger jid_mapping_resolved;

commit;

-- Verify:
--   select tgname, case tgenabled when 'D' then 'disabled' else 'ENABLED' end
--   from pg_trigger where tgrelid='whatsapp.jid_mapping'::regclass and not tgisinternal;
--   -- expect: jid_mapping_resolved | disabled
