-- whatsapp_029_drop_resolve_contact_from_mapping.sql
-- Owner directive: remove unused. resolve_contact_from_mapping was the backend
-- of the manual contact-merge UI, which was removed (Contacts "en attente"
-- feature, commit f1b2403). After that removal it is fully orphaned in OUR
-- system:
--   * our frontend/worker/edge = 0 callers (only caller was the removed
--     useResolveContact hook)
--   * our DB internal callers = 0
--   * NOT wired to any trigger/cron/view/policy
-- The donor still defines + calls it (its manual-merge UI is intact), but we
-- deliberately cut that feature in favor of automatic deterministic resolution
-- (resolve_identity + conversations_resolve_identity trigger + consolidate_lid
-- soft path — all kept). So this RPC is dead weight here, not a gap to fill.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

drop function if exists whatsapp.resolve_contact_from_mapping(
  p_instance_id uuid, p_lid text, p_phone_jid text, p_push_name text, p_profile_pic text
);

commit;

-- Verify: expect 0
--   select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='whatsapp' and p.proname='resolve_contact_from_mapping';
