-- whatsapp_007_queue_pacing_assign  (Wave 7) — dispatch + assignment structural core
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports 6 tables 1:1 (outbound_queue, number_pacing_state, worker_instance_leases, dispatcher_snapshot,
-- worker_health, conversation_assignments) + their own triggers + the NEW L1 same-business guard on
-- conversation_assignments + the wave-4/6 deferred triggers now buildable (ensure_pacing, sync_is_group).
--   * L1 RLS: per-business surfaces (conversation_assignments, number_pacing_state, outbound_queue) gate on
--     is_wa_admin(instance); FLEET surfaces (worker_health, worker_instance_leases, dispatcher_snapshot)
--     gate on is_owner() per plan §4.1. Agents: ca_select (self), oq_select (own agent rows).
--   * W5: worker_instance_leases + dispatcher_snapshot authenticated grant tightened to SELECT.
--   * DEFERRED to next chunk (open decisions): messages_auto_assign_on_inbound + _auto_assign_on_inbound
--     (round-robin cursor storage decision; source used dropped profiles.last_auto_assigned_at) and
--     _release_dms_on_profile_deactivation on public.users (core-table trigger). Operational RPCs
--     (queue/pacing/lease/heartbeat/assign/claim/dispatch_gate_check) also next.

-- ============================================================ conversation_assignments
create table whatsapp.conversation_assignments (
  conversation_id uuid not null,
  user_id         uuid not null,
  assigned_by     uuid,
  assigned_at     timestamptz not null default now(),
  is_group        boolean not null default false,
  constraint conversation_assignments_pkey primary key (conversation_id, user_id),
  constraint conversation_assignments_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint conversation_assignments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint conversation_assignments_assigned_by_fkey foreign key (assigned_by) references auth.users(id) on delete set null
);
create index conversation_assignments_assigned_by_idx on whatsapp.conversation_assignments using btree (assigned_by);
create index conversation_assignments_conversation_idx on whatsapp.conversation_assignments using btree (conversation_id);
create index conversation_assignments_user_idx on whatsapp.conversation_assignments using btree (user_id);
create unique index conversation_assignments_singleton_dm on whatsapp.conversation_assignments using btree (conversation_id) where (is_group = false);

-- ============================================================ outbound_queue (+ its own sequence)
create sequence whatsapp.outbound_queue_seq_seq;
create table whatsapp.outbound_queue (
  id               uuid not null default gen_random_uuid(),
  number_id        uuid not null,
  conversation_id  uuid not null,
  agent_id         uuid,
  action_type      whatsapp.outbound_action_type not null,
  payload          jsonb not null,
  status           whatsapp.outbound_action_status not null default 'queued',
  attempts         smallint not null default 0,
  priority         smallint not null default 100,
  enqueued_at      timestamptz not null default now(),
  not_before       timestamptz not null default now(),
  dispatched_at    timestamptz,
  completed_at     timestamptz,
  evolution_msg_id text,
  error            text,
  seq              bigint not null default nextval('whatsapp.outbound_queue_seq_seq'::regclass),
  origin           whatsapp.outbound_origin not null default 'interactive',
  constraint outbound_queue_pkey primary key (id),
  constraint outbound_queue_number_id_fkey foreign key (number_id) references whatsapp.whatsapp_instances(id) on delete cascade,
  constraint outbound_queue_conversation_id_fkey foreign key (conversation_id) references whatsapp.conversations(id) on delete cascade,
  constraint outbound_queue_agent_id_fkey foreign key (agent_id) references auth.users(id) on delete set null,
  constraint outbound_queue_attempts_nonneg check (attempts >= 0),
  constraint outbound_queue_status_lifecycle check (
    case status
      when 'queued'      then (completed_at is null)
      when 'dispatching' then ((dispatched_at is not null) and (completed_at is null))
      when 'sent'        then ((dispatched_at is not null) and (completed_at is not null) and (evolution_msg_id is not null))
      when 'failed'      then ((dispatched_at is not null) and (completed_at is null))
      when 'dead'        then (completed_at is not null)
      when 'cancelled'   then (completed_at is not null)
      else null::boolean
    end)
);
create index outbound_queue_agent_recent_idx  on whatsapp.outbound_queue using btree (agent_id, enqueued_at desc);
create index outbound_queue_conv_recent_idx   on whatsapp.outbound_queue using btree (conversation_id, enqueued_at desc);
create index outbound_queue_dead_idx          on whatsapp.outbound_queue using btree (completed_at desc) where (status = 'dead'::whatsapp.outbound_action_status);
create index outbound_queue_dispatch_idx      on whatsapp.outbound_queue using btree (number_id, not_before, priority, seq) where (status = 'queued'::whatsapp.outbound_action_status);
create index outbound_queue_evolution_msg_idx on whatsapp.outbound_queue using btree (evolution_msg_id) where (evolution_msg_id is not null);

-- ============================================================ number_pacing_state
create table whatsapp.number_pacing_state (
  number_id                 uuid not null,
  last_dispatched_at        timestamptz,
  last_completed_at         timestamptz,
  last_send_at              timestamptz,
  updated_at                timestamptz not null default now(),
  tokens                    numeric,
  last_refill_at            timestamptz,
  last_send_conversation_id uuid,
  constraint number_pacing_state_pkey primary key (number_id),
  constraint number_pacing_state_number_id_fkey foreign key (number_id) references whatsapp.whatsapp_instances(id) on delete cascade
);

-- ============================================================ worker_instance_leases
create table whatsapp.worker_instance_leases (
  instance_id  uuid not null,
  worker_id    text not null,
  leased_until timestamptz not null,
  lease_seq    bigint not null default 1,
  acquired_at  timestamptz not null default now(),
  renewed_at   timestamptz not null default now(),
  constraint worker_instance_leases_pkey primary key (instance_id),
  constraint worker_instance_leases_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);
create index worker_instance_leases_expires_idx on whatsapp.worker_instance_leases using btree (leased_until);
create index worker_instance_leases_worker_idx  on whatsapp.worker_instance_leases using btree (worker_id);

-- ============================================================ dispatcher_snapshot
create table whatsapp.dispatcher_snapshot (
  instance_id        uuid not null,
  last_dispatched_at timestamptz,
  last_completed_at  timestamptz,
  last_send_at       timestamptz,
  sends_last_min     integer not null default 0,
  queue_queued       integer not null default 0,
  queue_dispatching  integer not null default 0,
  queue_dead_24h     integer not null default 0,
  updated_at         timestamptz not null default now(),
  constraint dispatcher_snapshot_pkey primary key (instance_id),
  constraint dispatcher_snapshot_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);

-- ============================================================ worker_health (fleet, no instance)
create table whatsapp.worker_health (
  worker_id         text not null,
  hostname          text not null,
  version           text not null,
  started_at        timestamptz not null,
  last_heartbeat_at timestamptz not null default now(),
  active_numbers    integer not null default 0,
  queue_depth       integer not null default 0,
  dispatching_count integer not null default 0,
  drain_rate_1m     real not null default 0,
  last_dispatch_at  timestamptz,
  notes             jsonb not null default '{}'::jsonb,
  constraint worker_health_pkey primary key (worker_id)
);
create index worker_health_heartbeat_idx on whatsapp.worker_health using btree (last_heartbeat_at desc);

-- ============================================================ trigger functions
create or replace function whatsapp._on_conversation_assignment_change()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if TG_OP = 'INSERT' then
    perform whatsapp.audit('conversation_assigned','conversation',NEW.conversation_id::text, jsonb_build_object('user_id',NEW.user_id));
    return NEW;
  elsif TG_OP = 'DELETE' then
    perform whatsapp.audit('conversation_unassigned','conversation',OLD.conversation_id::text, jsonb_build_object('user_id',OLD.user_id));
    return OLD;
  end if;
  return NEW;
end;
$function$;

create or replace function whatsapp._set_assignment_is_group()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_is_group boolean;
begin
  select is_group into v_is_group from whatsapp.conversations where id = NEW.conversation_id;
  if v_is_group is null then raise exception 'conversation % not found', NEW.conversation_id; end if;
  NEW.is_group := v_is_group;
  return NEW;
end;
$function$;

-- NEW L1 same-business + sellers-only guard (plan §4.1).
create or replace function whatsapp._guard_assignment_business()
returns trigger language plpgsql security invoker set search_path to '' as $function$
declare v_conv_biz uuid; v_user_biz uuid; v_role public.user_role;
begin
  select i.business_id into v_conv_biz
    from whatsapp.conversations c join whatsapp.whatsapp_instances i on i.id = c.instance_id
   where c.id = NEW.conversation_id;
  if v_conv_biz is null then raise exception 'assignment: conversation % has no instance/business', NEW.conversation_id; end if;
  select u."DigiCom Business", u.role into v_user_biz, v_role from public.users u where u.id = NEW.user_id;
  if v_user_biz is distinct from v_conv_biz then
    raise exception 'assignment: cross-business forbidden (user biz % <> conversation biz %)', v_user_biz, v_conv_biz using errcode='42501';
  end if;
  if v_role <> 'commercial' then
    raise exception 'assignment: only sellers (commercial) can be assigned, got %', v_role using errcode='42501';
  end if;
  return NEW;
end;
$function$;

create or replace function whatsapp._on_outbound_queue_dead()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if NEW.status = 'dead' and (OLD.status is null or OLD.status <> 'dead') then
    perform whatsapp.audit('outbound_dead_letter','outbound_queue',NEW.id::text,
      jsonb_build_object('number_id',NEW.number_id,'conversation_id',NEW.conversation_id,'agent_id',NEW.agent_id,
                         'action_type',NEW.action_type,'attempts',NEW.attempts,'error',NEW.error));
  end if;
  return NEW;
end;
$function$;

create or replace function whatsapp._outbound_queue_notify()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  perform pg_notify('outbound_enqueued', NEW.number_id::text);
  return NEW;
end;
$function$;

create or replace function whatsapp._ensure_number_pacing_state()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  insert into whatsapp.number_pacing_state (number_id) values (NEW.id) on conflict (number_id) do nothing;
  return NEW;
end;
$function$;

create or replace function whatsapp._sync_assignments_is_group()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if NEW.is_group is distinct from OLD.is_group then
    update whatsapp.conversation_assignments set is_group = NEW.is_group where conversation_id = NEW.id;
  end if;
  return NEW;
end;
$function$;

revoke all on function whatsapp._on_conversation_assignment_change() from public; grant execute on function whatsapp._on_conversation_assignment_change() to service_role;
revoke all on function whatsapp._set_assignment_is_group()           from public; grant execute on function whatsapp._set_assignment_is_group()           to service_role;
revoke all on function whatsapp._guard_assignment_business()          from public; grant execute on function whatsapp._guard_assignment_business()          to authenticated, service_role;
revoke all on function whatsapp._on_outbound_queue_dead()            from public; grant execute on function whatsapp._on_outbound_queue_dead()            to service_role;
revoke all on function whatsapp._outbound_queue_notify()            from public; grant execute on function whatsapp._outbound_queue_notify()            to service_role;
revoke all on function whatsapp._ensure_number_pacing_state()        from public; grant execute on function whatsapp._ensure_number_pacing_state()        to service_role;
revoke all on function whatsapp._sync_assignments_is_group()         from public; grant execute on function whatsapp._sync_assignments_is_group()         to service_role;

-- ============================================================ triggers
create trigger conversation_assignments_guard before insert or update on whatsapp.conversation_assignments
  for each row execute function whatsapp._guard_assignment_business();
create trigger conversation_assignments_set_is_group before insert or update of conversation_id on whatsapp.conversation_assignments
  for each row execute function whatsapp._set_assignment_is_group();
create trigger conversation_assignments_audit after insert or delete on whatsapp.conversation_assignments
  for each row execute function whatsapp._on_conversation_assignment_change();
create trigger outbound_queue_notify_ins after insert on whatsapp.outbound_queue
  for each row when (new.status = 'queued'::whatsapp.outbound_action_status) execute function whatsapp._outbound_queue_notify();
create trigger outbound_queue_notify_upd after update of status on whatsapp.outbound_queue
  for each row when ((old.status <> 'queued'::whatsapp.outbound_action_status) and (new.status = 'queued'::whatsapp.outbound_action_status)) execute function whatsapp._outbound_queue_notify();
create trigger outbound_queue_dead_audit after update of status on whatsapp.outbound_queue
  for each row execute function whatsapp._on_outbound_queue_dead();
create trigger number_pacing_state_updated_at before update on whatsapp.number_pacing_state
  for each row execute function whatsapp._set_updated_at();
-- deferred-from-wave-4/6 triggers now buildable:
create trigger whatsapp_instances_ensure_pacing after insert on whatsapp.whatsapp_instances
  for each row execute function whatsapp._ensure_number_pacing_state();
create trigger conversations_sync_assignment_is_group after update of remote_jid on whatsapp.conversations
  for each row execute function whatsapp._sync_assignments_is_group();

-- ============================================================ RLS
alter table whatsapp.conversation_assignments enable row level security;
alter table whatsapp.outbound_queue           enable row level security;
alter table whatsapp.number_pacing_state      enable row level security;
alter table whatsapp.worker_instance_leases   enable row level security;
alter table whatsapp.dispatcher_snapshot      enable row level security;
alter table whatsapp.worker_health            enable row level security;

-- per-business surfaces (is_wa_admin of the conversation's/number's instance; agents see own)
create policy ca_admin_delete on whatsapp.conversation_assignments for delete to authenticated
  using (whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = conversation_id)));
create policy ca_admin_insert on whatsapp.conversation_assignments for insert to authenticated
  with check (whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = conversation_id)) and assigned_by = (select auth.uid()));
create policy ca_select on whatsapp.conversation_assignments for select to authenticated
  using (whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = conversation_id)) or user_id = (select auth.uid()));
create policy nps_select on whatsapp.number_pacing_state for select to authenticated
  using (whatsapp.is_wa_admin(number_id));
create policy oq_select on whatsapp.outbound_queue for select to authenticated
  using (agent_id = (select auth.uid()) or whatsapp.is_wa_admin(number_id));
-- fleet surfaces (owner Monitor page) -> is_owner()
create policy worker_health_admin_select on whatsapp.worker_health for select to authenticated using (public.is_owner());
create policy worker_instance_leases_admin_select on whatsapp.worker_instance_leases for select to authenticated using (public.is_owner());
create policy dispatcher_snapshot_select on whatsapp.dispatcher_snapshot for select to authenticated using (public.is_owner());

-- ============================================================ grants
grant select, delete on whatsapp.conversation_assignments to authenticated;
grant select         on whatsapp.number_pacing_state      to authenticated;
grant select         on whatsapp.outbound_queue           to authenticated;
grant select         on whatsapp.worker_health            to authenticated;
grant select         on whatsapp.worker_instance_leases   to authenticated;   -- W5 (source shipped DML)
grant select         on whatsapp.dispatcher_snapshot      to authenticated;   -- W5 (source shipped full DML)
grant all on whatsapp.conversation_assignments to service_role;
grant all on whatsapp.outbound_queue           to service_role;
grant all on whatsapp.number_pacing_state      to service_role;
grant all on whatsapp.worker_instance_leases   to service_role;
grant all on whatsapp.dispatcher_snapshot      to service_role;
grant all on whatsapp.worker_health            to service_role;
grant usage, select on sequence whatsapp.outbound_queue_seq_seq to service_role;
