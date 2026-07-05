-- whatsapp_001_enums  (Wave 1)
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- 12 enums ported 1:1 from WA Mancer (xlhlezgpgrypdijynmqr, public.*). Values + order verbatim from
-- live pg_enum (enumsortorder). Drop `user_role` only (identity layer, iGrowFast owns roles).
-- Types default to PUBLIC USAGE (matches WA Mancer); anon is still fully blocked by having no
-- USAGE on schema `whatsapp`, so an enum type is unreachable to anon regardless.

create type whatsapp.conversation_status     as enum ('open','pending','resolved','snoozed');
create type whatsapp.identifier_kind         as enum ('phone','lid','group');
create type whatsapp.identifier_source       as enum ('inferred','history_sync','contacts_upsert','same_envelope_alt','group_participants','phone_book','human');
create type whatsapp.instance_lifecycle_state as enum ('warming','established','cooling','banned');
create type whatsapp.instance_status         as enum ('pending','connecting','connected','disconnected','error');
create type whatsapp.log_level               as enum ('debug','info','warn','error');
create type whatsapp.log_source              as enum ('worker','edge','cron','db','evolution','caddy','redis','client','platform_api','platform_postgres','platform_auth','platform_storage','platform_realtime','platform_edge');
create type whatsapp.message_direction       as enum ('inbound','outbound');
create type whatsapp.message_kind            as enum ('text','image','video','audio','document','sticker','location','contact','reaction','system','poll');
create type whatsapp.outbound_action_status  as enum ('queued','dispatching','sent','failed','dead','cancelled');
create type whatsapp.outbound_action_type    as enum ('send_text','send_media','mark_read','typing_start','typing_stop','react','edit_message','delete_message','send_poll','send_contact');
create type whatsapp.outbound_origin         as enum ('interactive','forward','scheduled','batch','auto','quick_reply');
