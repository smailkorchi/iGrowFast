-- whatsapp_028_drop_unused_functions.sql
-- Owner directive 2026-07-08: "if something is not used, remove it" — keeping
-- dead code around is what bit us (the jid_mapping hard-delete path).
--
-- Full unused-function sweep of the whatsapp schema. Each function below was
-- proven to have ZERO usage across EVERY surface:
--   * DB internal callers = 0 (no other function body references it)
--   * enabled triggers = 0, cron jobs = 0, view refs = 0, RLS policy refs = 0
--   * our frontend / worker / edge = 0 references
--   * the DONOR's live DB (xlhlezgpgrypdijynmqr) internal callers = 0
--   * the DONOR's entire codebase (frontend/worker/edge) = 0 references
-- i.e. the donor DEFINES these but never calls them from anywhere — abandoned /
-- superseded RPCs. (toggle_message_star's only donor hit is a generated
-- database.types.ts, not a call site.)
--
-- Kept (verified live, do NOT confuse): set_message_pin, cancel_outbound_message,
-- force_dispatch_now, instance_capacity_status, admin_conversation_clear,
-- admin_conversation_purge_preflight, and the whole resolution/consolidation
-- pipeline (see docs/wa-mancer-recon/13).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- superseded resolution helpers (old paths, dead in the donor too)
drop function if exists whatsapp._resolve_conversation(p_instance uuid, p_remote_jid text);
drop function if exists whatsapp.consolidate_contact(p_contact_id uuid);
drop function if exists whatsapp.pair_lid_to_contact(p_instance uuid, p_lid text, p_contact_id uuid);

-- abandoned outbound dead-letter admin RPCs (never wired in either UI)
drop function if exists whatsapp.admin_list_dead_outbound(p_instance_id uuid, p_limit integer, p_offset integer);
drop function if exists whatsapp.admin_requeue_dead(p_queue_id uuid);

-- superseded message pin/star toggles (the live pin path is set_message_pin)
drop function if exists whatsapp.toggle_message_pin(p_message_id uuid);
drop function if exists whatsapp.toggle_message_star(p_message_id uuid);

commit;

-- Verify: expect 0 rows
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='whatsapp' and proname in
--     ('_resolve_conversation','consolidate_contact','pair_lid_to_contact',
--      'admin_list_dead_outbound','admin_requeue_dead','toggle_message_pin','toggle_message_star');
