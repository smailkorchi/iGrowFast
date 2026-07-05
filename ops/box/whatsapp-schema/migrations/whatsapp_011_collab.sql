-- whatsapp_011_collab.sql  (Wave 11) — tags/notes/quick_replies/templates/scheduled
-- TARGET: LIVE box .102 whatsapp ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports 4 tables 1:1 (tags, conversation_tags, conversation_notes, scheduled_messages) with L1 rewrites
-- (is_admin -> is_wa_admin(instance)/is_wa_admin_conv(conversation) + agent-via-assignment), and 2 ADAPT
-- tables to per-business scope (plan §3.1/§4.1):
--   * quick_replies: instance_id -> business_id (-> public.businesses); RLS = business members / admin-or-creator.
--   * message_templates: +business_id; 'global' = business-wide; uniques re-keyed on (business_id, name).
-- Also satisfies merge_conversations (wave 10b) runtime deps (conversation_notes/conversation_tags).

-- ============================================================ trigger fns (audit)
create or replace function whatsapp._on_conversation_note_change()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if TG_OP='INSERT' then
    perform whatsapp.audit('conversation_note.created','conversation_note',NEW.id::text,
      jsonb_build_object('conversation_id',NEW.conversation_id,'author_id',NEW.author_id,'mentions',NEW.mentions,'body_len',length(NEW.body)));
    return NEW;
  elsif TG_OP='UPDATE' then
    perform whatsapp.audit('conversation_note.updated','conversation_note',NEW.id::text,
      jsonb_build_object('conversation_id',NEW.conversation_id,'pinned_changed',OLD.pinned is distinct from NEW.pinned,'body_changed',OLD.body is distinct from NEW.body));
    return NEW;
  elsif TG_OP='DELETE' then
    perform whatsapp.audit('conversation_note.deleted','conversation_note',OLD.id::text,
      jsonb_build_object('conversation_id',OLD.conversation_id,'author_id',OLD.author_id));
    return OLD;
  end if;
  return null;
end;
$function$;
create or replace function whatsapp._on_message_template_change()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if TG_OP='INSERT' then
    perform whatsapp.audit('message_template.created','message_template',NEW.id::text, jsonb_build_object('scope',NEW.scope,'name',NEW.name,'created_by',NEW.created_by));
    return NEW;
  elsif TG_OP='UPDATE' then
    perform whatsapp.audit('message_template.updated','message_template',NEW.id::text, jsonb_build_object('scope',NEW.scope,'name',NEW.name));
    return NEW;
  elsif TG_OP='DELETE' then
    perform whatsapp.audit('message_template.deleted','message_template',OLD.id::text, jsonb_build_object('scope',OLD.scope,'name',OLD.name));
    return OLD;
  end if;
  return null;
end;
$function$;
revoke all on function whatsapp._on_conversation_note_change() from public; grant execute on function whatsapp._on_conversation_note_change() to service_role;
revoke all on function whatsapp._on_message_template_change()  from public; grant execute on function whatsapp._on_message_template_change()  to service_role;

-- ============================================================ tags (instance-scoped)
create table whatsapp.tags (
  id uuid not null default gen_random_uuid(),
  instance_id uuid not null,
  name text not null,
  color text not null default '#4CAF50',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_pkey primary key (id),
  constraint tags_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint tags_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null
);
create index idx_tags_instance on whatsapp.tags using btree (instance_id);
create unique index idx_tags_instance_name on whatsapp.tags using btree (instance_id, lower(name));
create index tags_created_by_idx on whatsapp.tags using btree (created_by);
create trigger tags_set_updated_at before update on whatsapp.tags for each row execute function whatsapp._set_updated_at();
alter table whatsapp.tags enable row level security;
create policy tags_select_assigned_or_admin on whatsapp.tags for select to authenticated using (
  whatsapp.is_wa_admin(instance_id) or exists (select 1 from whatsapp.conversation_assignments ca join whatsapp.conversations c on c.id=ca.conversation_id where ca.user_id=(select auth.uid()) and c.instance_id=tags.instance_id));
create policy tags_insert on whatsapp.tags for insert to authenticated with check (
  created_by=(select auth.uid()) and (whatsapp.is_wa_admin(instance_id) or exists (select 1 from whatsapp.conversation_assignments ca join whatsapp.conversations c on c.id=ca.conversation_id where ca.user_id=(select auth.uid()) and c.instance_id=tags.instance_id)));
create policy tags_update on whatsapp.tags for update to authenticated using (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid())) with check (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid()));
create policy tags_delete on whatsapp.tags for delete to authenticated using (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid()));
grant select,insert,update,delete on whatsapp.tags to authenticated; grant all on whatsapp.tags to service_role;

-- ============================================================ conversation_tags (conversation-scoped)
create table whatsapp.conversation_tags (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  constraint conversation_tags_pkey primary key (id),
  constraint conversation_tags_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint conversation_tags_tag_id_fkey foreign key (tag_id) references whatsapp.tags(id) on delete cascade
);
create index idx_conversation_tags_conv on whatsapp.conversation_tags using btree (conversation_id);
create index idx_conversation_tags_tag on whatsapp.conversation_tags using btree (tag_id);
create unique index idx_conversation_tags_unique on whatsapp.conversation_tags using btree (conversation_id, tag_id);
alter table whatsapp.conversation_tags enable row level security;
create policy conversation_tags_select_assigned_or_admin on whatsapp.conversation_tags for select to authenticated using (
  whatsapp.is_wa_admin_conv(conversation_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=conversation_tags.conversation_id and ca.user_id=(select auth.uid())));
create policy conversation_tags_insert_assigned_or_admin on whatsapp.conversation_tags for insert to authenticated with check (
  whatsapp.is_wa_admin_conv(conversation_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=conversation_tags.conversation_id and ca.user_id=(select auth.uid())));
create policy conversation_tags_delete_assigned_or_admin on whatsapp.conversation_tags for delete to authenticated using (
  whatsapp.is_wa_admin_conv(conversation_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=conversation_tags.conversation_id and ca.user_id=(select auth.uid())));
grant select,insert,update,delete on whatsapp.conversation_tags to authenticated; grant all on whatsapp.conversation_tags to service_role;

-- ============================================================ conversation_notes (conversation-scoped)
create table whatsapp.conversation_notes (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  author_id uuid,
  body text not null,
  mentions uuid[] not null default '{}'::uuid[],
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_notes_pkey primary key (id),
  constraint conversation_notes_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint conversation_notes_author_id_fkey foreign key (author_id) references auth.users(id) on delete set null,
  constraint conversation_notes_body_len check (length(body) >= 1 and length(body) <= 10000)
);
create index conversation_notes_author_idx on whatsapp.conversation_notes using btree (author_id, created_at desc) where (author_id is not null);
create index conversation_notes_conv_idx on whatsapp.conversation_notes using btree (conversation_id, pinned desc, created_at desc);
create index conversation_notes_mentions_idx on whatsapp.conversation_notes using gin (mentions);
create trigger conversation_notes_updated_at before update on whatsapp.conversation_notes for each row execute function whatsapp._set_updated_at();
create trigger conversation_notes_audit after insert or delete or update on whatsapp.conversation_notes for each row execute function whatsapp._on_conversation_note_change();
alter table whatsapp.conversation_notes enable row level security;
create policy conversation_notes_select on whatsapp.conversation_notes for select to authenticated using (
  whatsapp.is_wa_admin_conv(conversation_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=conversation_notes.conversation_id and ca.user_id=(select auth.uid())));
create policy conversation_notes_insert on whatsapp.conversation_notes for insert to authenticated with check (
  author_id=(select auth.uid()) and (whatsapp.is_wa_admin_conv(conversation_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=conversation_notes.conversation_id and ca.user_id=(select auth.uid()))));
create policy conversation_notes_update on whatsapp.conversation_notes for update to authenticated using (author_id=(select auth.uid()) or whatsapp.is_wa_admin_conv(conversation_id)) with check (author_id=(select auth.uid()) or whatsapp.is_wa_admin_conv(conversation_id));
create policy conversation_notes_delete on whatsapp.conversation_notes for delete to authenticated using (author_id=(select auth.uid()) or whatsapp.is_wa_admin_conv(conversation_id));
grant select,insert,update,delete on whatsapp.conversation_notes to authenticated; grant all on whatsapp.conversation_notes to service_role;

-- ============================================================ scheduled_messages (instance + conversation)
create table whatsapp.scheduled_messages (
  id uuid not null default gen_random_uuid(),
  instance_id uuid not null,
  conversation_id uuid not null,
  name text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending',
  sent_at timestamptz,
  failure_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  steps jsonb not null default '[]'::jsonb,
  constraint scheduled_messages_pkey primary key (id),
  constraint scheduled_messages_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint scheduled_messages_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint scheduled_messages_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null,
  constraint scheduled_messages_status_check check (status = any (array['pending','sent','cancelled','failed']))
);
create index scheduled_messages_conversation_idx on whatsapp.scheduled_messages using btree (conversation_id, scheduled_at);
create index scheduled_messages_created_by_idx on whatsapp.scheduled_messages using btree (created_by);
create index scheduled_messages_due_idx on whatsapp.scheduled_messages using btree (scheduled_at) where (status = 'pending');
create index scheduled_messages_instance_idx on whatsapp.scheduled_messages using btree (instance_id);
create trigger scheduled_messages_updated_at before update on whatsapp.scheduled_messages for each row execute function whatsapp._set_updated_at();
alter table whatsapp.scheduled_messages enable row level security;
create policy scheduled_messages_select on whatsapp.scheduled_messages for select to authenticated using (
  whatsapp.is_wa_admin(instance_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=scheduled_messages.conversation_id and ca.user_id=(select auth.uid())));
create policy scheduled_messages_insert on whatsapp.scheduled_messages for insert to authenticated with check (
  created_by=(select auth.uid()) and (whatsapp.is_wa_admin(instance_id) or exists (select 1 from whatsapp.conversation_assignments ca where ca.conversation_id=scheduled_messages.conversation_id and ca.user_id=(select auth.uid()))));
create policy scheduled_messages_update on whatsapp.scheduled_messages for update to authenticated using (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid())) with check (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid()));
create policy scheduled_messages_delete on whatsapp.scheduled_messages for delete to authenticated using (whatsapp.is_wa_admin(instance_id) or created_by=(select auth.uid()));
grant select,insert,update,delete on whatsapp.scheduled_messages to authenticated; grant all on whatsapp.scheduled_messages to service_role;

-- ============================================================ quick_replies (ADAPT: instance_id -> business_id)
create table whatsapp.quick_replies (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  name text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  steps jsonb not null default '[]'::jsonb,
  constraint quick_replies_pkey primary key (id),
  constraint quick_replies_business_id_fkey foreign key (business_id) references public.businesses(id) on delete cascade,
  constraint quick_replies_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null
);
create index quick_replies_created_by_idx on whatsapp.quick_replies using btree (created_by);
create index quick_replies_business_idx on whatsapp.quick_replies using btree (business_id);
create index quick_replies_business_name_idx on whatsapp.quick_replies using btree (business_id, name);
create trigger quick_replies_updated_at before update on whatsapp.quick_replies for each row execute function whatsapp._set_updated_at();
alter table whatsapp.quick_replies enable row level security;
-- business members see their business's quick replies; admin-of-business or creator edit.
create policy quick_replies_select on whatsapp.quick_replies for select to authenticated using (business_id = public.current_user_digicom_business_id());
create policy quick_replies_insert on whatsapp.quick_replies for insert to authenticated with check (created_by=(select auth.uid()) and business_id = public.current_user_digicom_business_id());
create policy quick_replies_update on whatsapp.quick_replies for update to authenticated
  using ((public.current_user_is_business_admin() and business_id = public.current_user_digicom_business_id()) or created_by=(select auth.uid()))
  with check ((public.current_user_is_business_admin() and business_id = public.current_user_digicom_business_id()) or created_by=(select auth.uid()));
create policy quick_replies_delete on whatsapp.quick_replies for delete to authenticated
  using ((public.current_user_is_business_admin() and business_id = public.current_user_digicom_business_id()) or created_by=(select auth.uid()));
grant select,insert,update,delete on whatsapp.quick_replies to authenticated; grant all on whatsapp.quick_replies to service_role;

-- ============================================================ message_templates (ADAPT: +business_id)
create table whatsapp.message_templates (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  name text not null,
  body text not null,
  variables text[] not null default '{}'::text[],
  scope text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_pkey primary key (id),
  constraint message_templates_business_id_fkey foreign key (business_id) references public.businesses(id) on delete cascade,
  constraint message_templates_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null,
  constraint message_templates_body_len check (length(body) >= 1 and length(body) <= 4096),
  constraint message_templates_name_len check (length(name) >= 1 and length(name) <= 80),
  constraint message_templates_scope_valid check (scope = any (array['global','user'])),
  constraint message_templates_user_has_owner check ((scope <> 'user') or (created_by is not null))
);
create unique index message_templates_global_name_idx on whatsapp.message_templates using btree (business_id, name) where (scope = 'global');
create unique index message_templates_user_name_idx on whatsapp.message_templates using btree (created_by, name) where (scope = 'user');
create index message_templates_scope_idx on whatsapp.message_templates using btree (business_id, scope, name);
create trigger message_templates_updated_at before update on whatsapp.message_templates for each row execute function whatsapp._set_updated_at();
create trigger message_templates_audit after insert or delete or update on whatsapp.message_templates for each row execute function whatsapp._on_message_template_change();
alter table whatsapp.message_templates enable row level security;
-- global templates business-wide; user templates personal. All scoped to the caller's business.
create policy message_templates_select on whatsapp.message_templates for select to authenticated using (
  business_id = public.current_user_digicom_business_id() and (scope='global' or created_by=(select auth.uid())));
create policy message_templates_insert on whatsapp.message_templates for insert to authenticated with check (
  business_id = public.current_user_digicom_business_id() and ((scope='global' and public.current_user_is_business_admin()) or (scope='user' and created_by=(select auth.uid()))));
create policy message_templates_update on whatsapp.message_templates for update to authenticated
  using (business_id = public.current_user_digicom_business_id() and (public.current_user_is_business_admin() or (scope='user' and created_by=(select auth.uid()))))
  with check (business_id = public.current_user_digicom_business_id() and (public.current_user_is_business_admin() or (scope='user' and created_by=(select auth.uid()))));
create policy message_templates_delete on whatsapp.message_templates for delete to authenticated
  using (business_id = public.current_user_digicom_business_id() and (public.current_user_is_business_admin() or (scope='user' and created_by=(select auth.uid()))));
grant select,insert,update,delete on whatsapp.message_templates to authenticated; grant all on whatsapp.message_templates to service_role;
