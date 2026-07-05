-- whatsapp_010_fix_is_group_generated.sql  — WAVE-6 CORRECTION (discovered during 10c rehearsal)
-- TARGET: LIVE box .102 whatsapp ONLY. Apply wrapped in a transaction (BEGIN/COMMIT via the pipe).
-- conversations.is_group is a STORED GENERATED column in WA Mancer: GENERATED ALWAYS AS (remote_jid LIKE
-- '%@g.us') STORED. Wave 6 ported it as a plain NOT NULL column because information_schema.column_default
-- does NOT surface generated columns, so ingest_message / ensure_conversation (which omit is_group and rely
-- on generation) fail with a NOT NULL violation. Fix: re-create is_group as GENERATED. Postgres has no
-- ALTER-to-add-generation, so drop+re-add the column; the dependent conversations_decrypted view (wave 10a)
-- must be dropped and recreated. conversations is EMPTY on the box, so no data is lost (is_group re-derives).
drop view if exists whatsapp.conversations_decrypted;
alter table whatsapp.conversations drop column is_group;
alter table whatsapp.conversations add column is_group boolean not null generated always as (remote_jid like '%@g.us') stored;

create view whatsapp.conversations_decrypted with (security_invoker=true) as
 select c.id, c.instance_id, c.remote_jid, c.is_group, c.peer_display_name, c.peer_profile_pic,
   c.last_message_at, whatsapp._decrypt_conv_preview(c.id) as last_message_preview,
   c.last_message_kind, c.last_message_direction, c.last_message_sender_name, c.last_message_media_meta,
   c.unread_count, c.is_archived, c.is_pinned, c.status, c.snoozed_until, c.resolved_at, c.resolved_by,
   c.created_at, c.updated_at, c.last_inbound_at, c.last_outbound_at, c.contact_id,
   ct.book_name as contact_book_name, c.last_outbound_status, c.left_at
 from whatsapp.conversations c
 left join whatsapp.contacts ct on ct.id = c.contact_id
 where c.merged_into is null and c.remote_jid !~~ '%@lid';
grant select on whatsapp.conversations_decrypted to authenticated, service_role;
