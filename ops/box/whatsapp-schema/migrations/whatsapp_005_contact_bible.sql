-- whatsapp_005_contact_bible  (Wave 5) — 7 contact-identity tables
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports WA Mancer contact bible 1:1. Tenancy: every table carries instance_id NOT NULL ->
-- whatsapp_instances(id) ON DELETE CASCADE, so isolation is transitive (is_wa_admin(instance_id));
-- contacts are PER-INSTANCE (unique per (instance_id, phone_jid)/(instance_id, lid)).
--   * L2 seam: contacts.customer_id -> public.customers(id) ON DELETE SET NULL.
--   * L1: admin RLS uses whatsapp.is_wa_admin(instance_id). AGENT-select policies (all reference
--     conversation_assignments/conversations) DEFER to wave 8.
--   * DEFERRED to wave 6 (dependency): ALL contact-resolution functions + the jid_mapping_resolved
--     trigger (_on_jid_mapping_resolved needs public.conversations + private.merge_conversations).
--   * W5 hardening: contact_profiles/group_participants have SELECT-only policies, so authenticated
--     grant tightened to SELECT (source shipped inert DML grants that RLS already blocked).

-- ============================================================ contacts (+ customer_id L2 seam)
create table whatsapp.contacts (
  id           uuid not null default gen_random_uuid(),
  instance_id  uuid not null,
  phone_number text,
  phone_jid    text,
  lid          text,
  book_name    text,
  push_name    text,
  profile_pic  text,
  is_resolved  boolean not null default false,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  phone_source whatsapp.identifier_source,
  merged_into  uuid,
  customer_id  uuid,                                                   -- L2 seam
  constraint contacts_pkey primary key (id),
  constraint contacts_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint contacts_instance_lid_key unique (instance_id, lid),
  constraint contacts_instance_phone_jid_key unique (instance_id, phone_jid),
  constraint contacts_merged_into_fkey foreign key (merged_into) references whatsapp.contacts(id) on delete set null,
  constraint contacts_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null,
  constraint contacts_no_self_merge check ((merged_into is null) or (merged_into <> id))
);
create index contacts_phone_number_idx on whatsapp.contacts using btree (instance_id, phone_number);
create index contacts_unresolved_idx   on whatsapp.contacts using btree (instance_id) where (not is_resolved);
create index contacts_customer_id_idx  on whatsapp.contacts using btree (customer_id);

-- ============================================================ contact_identifiers
create table whatsapp.contact_identifiers (
  id            uuid not null default gen_random_uuid(),
  instance_id   uuid not null,
  contact_id    uuid not null,
  identifier    text not null,
  kind          whatsapp.identifier_kind not null,
  source        whatsapp.identifier_source not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint contact_identifiers_pkey primary key (id),
  constraint contact_identifiers_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint contact_identifiers_contact_id_fkey foreign key (contact_id) references whatsapp.contacts(id) on delete cascade,
  constraint contact_identifiers_uq unique (instance_id, identifier)
);
create index contact_identifiers_contact_idx on whatsapp.contact_identifiers using btree (contact_id);

-- ============================================================ jid_mapping (resolved trigger -> wave 6)
create table whatsapp.jid_mapping (
  instance_id   uuid not null,
  lid           text not null,
  phone_jid     text not null,
  source        text not null,
  discovered_at timestamptz not null default now(),
  constraint jid_mapping_pkey primary key (instance_id, lid),
  constraint jid_mapping_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);
create unique index jid_mapping_phone_idx on whatsapp.jid_mapping using btree (instance_id, phone_jid);

-- ============================================================ merge_decisions (no instance FK in source)
create table whatsapp.merge_decisions (
  instance_id uuid not null,
  id_a        text not null,
  id_b        text not null,
  decision    text not null,
  decided_by  uuid,
  decided_at  timestamptz not null default now(),
  constraint merge_decisions_pkey primary key (instance_id, id_a, id_b),
  constraint merge_decisions_decision_check check (decision = any (array['merge','reject']))
);

-- ============================================================ merge_review (no FKs in source)
create table whatsapp.merge_review (
  id             uuid not null default gen_random_uuid(),
  instance_id    uuid not null,
  kind           text not null,
  identifier     text,
  alt_identifier text,
  contact_id     uuid,
  detail         jsonb,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  constraint merge_review_pkey primary key (id)
);
create index merge_review_instance_idx on whatsapp.merge_review using btree (instance_id);
create index merge_review_open_idx     on whatsapp.merge_review using btree (instance_id) where (reviewed_at is null);

-- ============================================================ contact_profiles
create table whatsapp.contact_profiles (
  instance_id uuid not null,
  jid         text not null,
  push_name   text,
  profile_pic text,
  updated_at  timestamptz not null default now(),
  constraint contact_profiles_pkey primary key (instance_id, jid),
  constraint contact_profiles_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);

-- ============================================================ group_participants
create table whatsapp.group_participants (
  instance_id    uuid not null,
  group_jid      text not null,
  participant_jid text not null,
  phone_jid      text,
  push_name      text,
  profile_pic    text,
  admin_level    text,
  updated_at     timestamptz not null default now(),
  constraint group_participants_pkey primary key (instance_id, group_jid, participant_jid),
  constraint group_participants_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);
create index idx_group_participants_group on whatsapp.group_participants using btree (instance_id, group_jid);

-- ============================================================ RLS (admin-only; agent-select -> wave 8)
alter table whatsapp.contacts             enable row level security;
alter table whatsapp.contact_identifiers  enable row level security;
alter table whatsapp.jid_mapping          enable row level security;
alter table whatsapp.merge_decisions      enable row level security;
alter table whatsapp.merge_review         enable row level security;
alter table whatsapp.contact_profiles     enable row level security;
alter table whatsapp.group_participants   enable row level security;

create policy contacts_admin_all            on whatsapp.contacts            for all    to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy contact_identifiers_admin_all on whatsapp.contact_identifiers for all    to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy jid_mapping_admin_all         on whatsapp.jid_mapping         for all    to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy merge_decisions_admin_all     on whatsapp.merge_decisions     for all    to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy merge_review_admin_all        on whatsapp.merge_review        for all    to authenticated using (whatsapp.is_wa_admin(instance_id));
create policy contact_profiles_select       on whatsapp.contact_profiles    for select to authenticated using (whatsapp.is_wa_admin(instance_id));  -- wave 8: + agent branch
create policy group_participants_select     on whatsapp.group_participants  for select to authenticated using (whatsapp.is_wa_admin(instance_id));  -- wave 8: + agent branch

-- ============================================================ grants (grant==policy; W5 on profiles/groups)
grant select, insert, update, delete on whatsapp.contacts            to authenticated;
grant select                         on whatsapp.contact_identifiers  to authenticated;
grant select, insert, update, delete on whatsapp.jid_mapping         to authenticated;
grant select                         on whatsapp.merge_decisions      to authenticated;
grant select                         on whatsapp.merge_review         to authenticated;
grant select                         on whatsapp.contact_profiles     to authenticated;   -- W5 (source shipped inert DML)
grant select                         on whatsapp.group_participants   to authenticated;   -- W5 (source shipped inert DML)
grant all on whatsapp.contacts            to service_role;
grant all on whatsapp.contact_identifiers to service_role;
grant all on whatsapp.jid_mapping         to service_role;
grant all on whatsapp.merge_decisions     to service_role;
grant all on whatsapp.merge_review        to service_role;
grant all on whatsapp.contact_profiles    to service_role;
grant all on whatsapp.group_participants  to service_role;
