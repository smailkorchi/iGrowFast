-- whatsapp_006_conversations_messages  (Wave 6) — the core inbox tables
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports WA Mancer conversations + messages 1:1 with the encryption + e-commerce seams.
--   * SEAMS: conversations +customer_id (-> public.customers ON DELETE SET NULL, L2),
--     +key_id (smallint NOT NULL DEFAULT 1 -> encryption_keys, guards last_message_preview_ct);
--     messages +key_id (guards body_ciphertext).
--   * L1: admin RLS via whatsapp.is_wa_admin(instance_id). SELECT agent branches (conversation_assignments)
--     -> wave 8.
--   * DEPENDENCY-DEFERRED (created after wave 7 assignments/queue + wave 11 collab exist):
--       - trigger conversations_resolve_identity (+ _conversations_resolve_identity, calls resolve_identity)
--         and the entire contact-resolution fn graph (resolve_identity, resolve_contact_from_mapping,
--         upsert_jid_mapping, link_alt, consolidate_*, pick_survivor, chase_merged_into,
--         _resolve_lid_to_phone, identifier_trust, pair_lid_to_contact, ...).
--       - trigger conversations_sync_assignment_is_group (+ _sync_assignments_is_group) -> wave 7.
--       - trigger messages_auto_assign_on_inbound (+ _auto_assign_on_inbound, needs L1 profiles->users
--         rewrite) -> wave 7.
--       - private.merge_conversations + trigger jid_mapping_resolved (+ _on_jid_mapping_resolved) ->
--         after wave 7 (queue/assignments) & wave 11 (notes/tags).
--   Wave 6 ships ONLY the 5 self-contained triggers whose fns reference existing objects.

-- ============================================================ conversations
create table whatsapp.conversations (
  id                       uuid not null default gen_random_uuid(),
  instance_id              uuid not null,
  remote_jid               text not null,
  is_group                 boolean not null,
  peer_display_name        text,
  peer_profile_pic         text,
  last_message_at          timestamptz,
  last_message_preview_ct  bytea,
  unread_count             integer not null default 0,
  is_archived              boolean not null default false,
  is_pinned                boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  last_inbound_at          timestamptz,
  last_outbound_at         timestamptz,
  status                   whatsapp.conversation_status not null default 'open',
  snoozed_until            timestamptz,
  resolved_at              timestamptz,
  resolved_by              uuid,
  last_message_kind        whatsapp.message_kind,
  last_message_direction   whatsapp.message_direction,
  last_message_sender_name text,
  last_message_media_meta  jsonb,
  contact_id               uuid,
  last_outbound_status     text,
  merged_into              uuid,
  left_at                  timestamptz,
  customer_id              uuid,                                    -- L2 seam
  key_id                   smallint not null default 1,            -- crypto seam (last_message_preview_ct)
  constraint conversations_pkey primary key (id),
  constraint conversations_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint conversations_contact_id_fkey foreign key (contact_id) references whatsapp.contacts(id) on delete set null,
  constraint conversations_merged_into_fkey foreign key (merged_into) references whatsapp.conversations(id) on delete set null,
  constraint conversations_resolved_by_fkey foreign key (resolved_by) references auth.users(id) on delete set null,
  constraint conversations_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null,
  constraint conversations_key_id_fkey foreign key (key_id) references whatsapp.encryption_keys(key_id),
  constraint conversations_instance_id_remote_jid_key unique (instance_id, remote_jid),
  constraint conversations_resolved_requires_at check ((status <> 'resolved') or (resolved_at is not null)),
  constraint conversations_snoozed_requires_until check ((status <> 'snoozed') or (snoozed_until is not null))
);
create index conversations_contact_idx           on whatsapp.conversations using btree (contact_id);
create index conversations_instance_last_idx     on whatsapp.conversations using btree (instance_id, last_message_at desc nulls last);
create index conversations_is_archived_idx       on whatsapp.conversations using btree (is_archived) where (is_archived = false);
create index conversations_last_inbound_idx      on whatsapp.conversations using btree (id, last_inbound_at);
create index conversations_peer_name_trgm_idx    on whatsapp.conversations using gin (peer_display_name extensions.gin_trgm_ops) where (peer_display_name is not null);
create index conversations_remote_jid_idx        on whatsapp.conversations using btree (remote_jid);
create index conversations_remote_jid_trgm_idx   on whatsapp.conversations using gin (remote_jid extensions.gin_trgm_ops);
create index conversations_resolved_by_idx       on whatsapp.conversations using btree (resolved_by) where (resolved_by is not null);
create index conversations_status_active_idx     on whatsapp.conversations using btree (instance_id, last_message_at desc nulls last) where (status = any (array['open'::whatsapp.conversation_status,'pending'::whatsapp.conversation_status]));
create index conversations_status_snoozed_idx    on whatsapp.conversations using btree (snoozed_until) where (status = 'snoozed'::whatsapp.conversation_status);
create index conversations_unanswered_inbound_idx on whatsapp.conversations using btree (last_inbound_at) where ((last_inbound_at is not null) and ((last_outbound_at is null) or (last_outbound_at < last_inbound_at)));
create index conversations_customer_id_idx       on whatsapp.conversations using btree (customer_id);

-- ============================================================ messages
create table whatsapp.messages (
  id                   uuid not null default gen_random_uuid(),
  conversation_id      uuid not null,
  instance_id          uuid not null,
  evolution_message_id text,
  direction            whatsapp.message_direction not null,
  kind                 whatsapp.message_kind not null default 'text',
  body_ciphertext      bytea,
  media_meta           jsonb,
  reply_to_message_id  uuid,
  sender_jid           text,
  whatsapp_timestamp   timestamptz not null,
  delivery_status      text,
  created_at           timestamptz not null default now(),
  reactions            jsonb not null default '[]'::jsonb,
  forwarded            boolean not null default false,
  forwarding_score     smallint not null default 0,
  is_starred           boolean not null default false,
  sent_by_agent_id     uuid,
  media_storage_bucket text,
  media_storage_key    text,
  media_pending        boolean not null default false,
  media_size_bytes     bigint,
  media_mime           text,
  media_sha256         bytea,
  media_uploaded_at    timestamptz,
  media_failed_at      timestamptz,
  idempotency_key      uuid,
  edited_at            timestamptz,
  revoked_at           timestamptz,
  revoked_by           text,
  hidden_for_user_ids  uuid[] not null default '{}'::uuid[],
  is_pinned            boolean not null default false,
  pinned_at            timestamptz,
  pinned_by            uuid,
  pin_expires_at       timestamptz,
  key_id               smallint not null default 1,                -- crypto seam (body_ciphertext)
  constraint messages_pkey primary key (id),
  constraint messages_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint messages_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint messages_reply_to_message_id_fkey foreign key (reply_to_message_id) references whatsapp.messages(id) on delete set null,
  constraint messages_sent_by_agent_id_fkey foreign key (sent_by_agent_id) references auth.users(id) on delete set null,
  constraint messages_key_id_fkey foreign key (key_id) references whatsapp.encryption_keys(key_id),
  constraint messages_instance_id_evolution_message_id_key unique (instance_id, evolution_message_id),
  constraint messages_agent_only_for_outbound check ((sent_by_agent_id is null) or (direction = 'outbound')),
  constraint messages_evolution_id_required_after_dispatch check ((evolution_message_id is not null) or (delivery_status = any (array['PENDING','DISPATCHING','FAILED','CANCELLED']))),
  constraint messages_reactions_is_array check (jsonb_typeof(reactions) = 'array'),
  constraint messages_revoked_by_check check ((revoked_by is null) or (revoked_by = any (array['us','remote'])))
);
create index idx_messages_media_pending      on whatsapp.messages using btree (instance_id, created_at desc) where media_pending;
create index idx_messages_pinned             on whatsapp.messages using btree (conversation_id, pinned_at desc) where (is_pinned = true);
create index idx_messages_starred            on whatsapp.messages using btree (conversation_id) where (is_starred = true);
create index messages_agent_idx             on whatsapp.messages using btree (sent_by_agent_id, whatsapp_timestamp desc) where (sent_by_agent_id is not null);
create index messages_conversation_ts_idx    on whatsapp.messages using btree (conversation_id, whatsapp_timestamp desc);
create index messages_direction_idx          on whatsapp.messages using btree (direction);
create unique index messages_idempotency_key_idx on whatsapp.messages using btree (idempotency_key) where (idempotency_key is not null);
create index messages_instance_ts_idx        on whatsapp.messages using btree (instance_id, whatsapp_timestamp desc);
create index messages_pending_outbound_idx    on whatsapp.messages using btree (sent_by_agent_id, created_at desc) where (evolution_message_id is null);
create index messages_reply_to_idx           on whatsapp.messages using btree (reply_to_message_id) where (reply_to_message_id is not null);
create index messages_starred_idx            on whatsapp.messages using btree (conversation_id, whatsapp_timestamp desc) where (is_starred = true);

-- ============================================================ self-contained triggers (deps satisfied)
create or replace function whatsapp._on_conversation_status_change()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if OLD.status is distinct from NEW.status then
    perform whatsapp.audit('conversation.status_changed','conversation',NEW.id::text,
      jsonb_build_object('old_status',OLD.status,'new_status',NEW.status,'snoozed_until',NEW.snoozed_until,
                         'resolved_at',NEW.resolved_at,'resolved_by',NEW.resolved_by));
  end if;
  return NEW;
end;
$function$;

create or replace function whatsapp._touch_conversation_on_message()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  update whatsapp.conversations set
    last_message_at  = greatest(coalesce(last_message_at,'-infinity'::timestamptz), NEW.whatsapp_timestamp),
    last_inbound_at  = case when NEW.direction='inbound'  then greatest(coalesce(last_inbound_at,'-infinity'::timestamptz),  NEW.whatsapp_timestamp) else last_inbound_at  end,
    last_outbound_at = case when NEW.direction='outbound' then greatest(coalesce(last_outbound_at,'-infinity'::timestamptz), NEW.whatsapp_timestamp) else last_outbound_at end
  where id = NEW.conversation_id;
  return NEW;
end;
$function$;

create or replace function whatsapp._mark_conversation_preview_revoked()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  update whatsapp.conversations
     set last_message_media_meta = coalesce(last_message_media_meta,'{}'::jsonb)
           || jsonb_build_object('revoked',true,'revoked_by',NEW.revoked_by)
   where id = NEW.conversation_id and last_message_at <= NEW.whatsapp_timestamp;
  return NEW;
end;
$function$;

create or replace function whatsapp._sync_conv_last_outbound_status()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if NEW.direction <> 'outbound' then return NEW; end if;
  update whatsapp.conversations c set last_outbound_status = NEW.delivery_status
   where c.id = NEW.conversation_id
     and not exists (select 1 from whatsapp.messages m2
                      where m2.conversation_id = NEW.conversation_id and m2.direction='outbound'
                        and m2.whatsapp_timestamp > NEW.whatsapp_timestamp);
  return NEW;
end;
$function$;

revoke all on function whatsapp._on_conversation_status_change()    from public;  grant execute on function whatsapp._on_conversation_status_change()    to service_role;
revoke all on function whatsapp._touch_conversation_on_message()    from public;  grant execute on function whatsapp._touch_conversation_on_message()    to service_role;
revoke all on function whatsapp._mark_conversation_preview_revoked() from public;  grant execute on function whatsapp._mark_conversation_preview_revoked() to service_role;
revoke all on function whatsapp._sync_conv_last_outbound_status()    from public;  grant execute on function whatsapp._sync_conv_last_outbound_status()    to service_role;

create trigger conversations_updated_at before update on whatsapp.conversations
  for each row execute function whatsapp._set_updated_at();
create trigger conversations_status_audit after update of status on whatsapp.conversations
  for each row execute function whatsapp._on_conversation_status_change();
create trigger messages_touch_conversation after insert on whatsapp.messages
  for each row execute function whatsapp._touch_conversation_on_message();
create trigger messages_revoke_conversation_preview after update of revoked_at on whatsapp.messages
  for each row when ((old.revoked_at is null) and (new.revoked_at is not null)) execute function whatsapp._mark_conversation_preview_revoked();
create trigger trg_sync_conv_last_outbound_status after insert or update of delivery_status on whatsapp.messages
  for each row when (new.direction = 'outbound') execute function whatsapp._sync_conv_last_outbound_status();
-- DEFERRED triggers: conversations_resolve_identity, conversations_sync_assignment_is_group -> later;
--                    messages_auto_assign_on_inbound -> wave 7.

-- ============================================================ RLS (admin-only; agent SELECT -> wave 8)
alter table whatsapp.conversations enable row level security;
alter table whatsapp.messages      enable row level security;

create policy conversations_admin_delete on whatsapp.conversations for delete to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy conversations_admin_insert on whatsapp.conversations for insert to authenticated with check (whatsapp.is_wa_admin(instance_id));
create policy conversations_admin_update on whatsapp.conversations for update to authenticated using (whatsapp.is_wa_admin(instance_id)) with check (whatsapp.is_wa_admin(instance_id));
create policy conversations_select       on whatsapp.conversations for select to authenticated using (whatsapp.is_wa_admin(instance_id));   -- wave 8: + agent branch
create policy messages_select            on whatsapp.messages      for select to authenticated using (whatsapp.is_wa_admin(instance_id));   -- wave 8: + agent branch

-- ============================================================ grants (match source)
grant select, delete on whatsapp.conversations to authenticated;
grant select         on whatsapp.messages      to authenticated;
grant all on whatsapp.conversations to service_role;
grant all on whatsapp.messages      to service_role;
