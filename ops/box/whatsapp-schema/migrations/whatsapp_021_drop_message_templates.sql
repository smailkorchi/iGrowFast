-- whatsapp_021_drop_message_templates.sql — sweep gray-item resolution (owner go 2026-07-08)
--
-- message_templates: donor feature never ported — ZERO references in FE/worker/
-- edge, 0 rows, only its own triggers depend on it. NOT quick_replies (separate
-- table, live in the inbox, untouched).
--
-- merge_review: KEPT — written by link_alt + pair_lid_to_contact (core identity
-- bible, message-ingest path); it is the anti-fusion parking lot for ambiguous
-- identity pairs. Dropping it would break ingest.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

drop table whatsapp.message_templates;               -- cascades its triggers; leaves supabase_realtime
drop function whatsapp._on_message_template_change();

commit;
