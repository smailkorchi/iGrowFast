-- whatsapp_003_audit_core  (Wave 3)
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ported 1:1 from WA Mancer (public.audit_log + audit machinery); public.* -> whatsapp.*, with:
--   * COLLISION RESOLUTION: WA Mancer had public.audit (thin SQL wrapper) + private.audit (SECDEF
--     impl), same 4-arg signature. The private schema collapses into whatsapp, so the two merge into
--     ONE whatsapp.audit(...) = the SECDEF impl (writes the row with auth.uid() as actor). Every RPC
--     call site keeps the identical signature. auth.uid() reads the JWT (independent of SECDEF role).
--   * L1 rewrite: audit_log is FLEET-WIDE (no business_id), read by the owner Log/Monitor pages, so
--     is_admin() -> public.is_owner() (owner-only fleet surface, plan §4.1) -- NOT per-business admin.
-- Placed early: ~25 later operational RPCs call whatsapp.audit() internally.

-- 1) Table (bigserial => whatsapp.audit_log_id_seq) + constraints + indexes.
create table whatsapp.audit_log (
  id          bigserial primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_uid   uuid references auth.users(id) on delete set null,
  event_type  text not null,
  target_type text,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  prev_hash   bytea not null,
  this_hash   bytea not null,
  constraint audit_log_this_hash_key unique (this_hash)
);
create index audit_log_actor_idx       on whatsapp.audit_log using btree (actor_uid);
create index audit_log_event_idx       on whatsapp.audit_log using btree (event_type);
create index audit_log_occurred_at_idx on whatsapp.audit_log using btree (occurred_at desc);
create index audit_log_target_idx      on whatsapp.audit_log using btree (target_type, target_id);

alter table whatsapp.audit_log enable row level security;

-- 2) SHA-256 hash-chain trigger (BEFORE INSERT): each row hashes over prev this_hash + its own fields.
create or replace function whatsapp._audit_log_hash()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_prev bytea;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  select this_hash into v_prev from whatsapp.audit_log order by id desc limit 1;
  if v_prev is null then
    v_prev := decode(repeat('00', 32), 'hex');
  end if;
  new.prev_hash := v_prev;
  new.this_hash := extensions.digest(
    v_prev
    || convert_to(new.occurred_at::text, 'UTF8')
    || convert_to(coalesce(new.actor_uid::text, ''), 'UTF8')
    || convert_to(new.event_type, 'UTF8')
    || convert_to(coalesce(new.target_type, ''), 'UTF8')
    || convert_to(coalesce(new.target_id, ''), 'UTF8')
    || convert_to(new.payload::text, 'UTF8'),
    'sha256'
  );
  return new;
end;
$function$;

create trigger audit_log_hash_t before insert on whatsapp.audit_log
  for each row execute function whatsapp._audit_log_hash();

-- 3) Writer (merged public.audit + private.audit -> one SECDEF fn).
create or replace function whatsapp.audit(p_event_type text, p_target_type text default null, p_target_id text default null, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path to '' as $function$
declare
  v_id bigint;
begin
  insert into whatsapp.audit_log (actor_uid, event_type, target_type, target_id, payload)
  values (auth.uid(), p_event_type, p_target_type, p_target_id, p_payload)
  returning id into v_id;
  return v_id;
end;
$function$;

-- 4) Chain validator + owner-gated status.
create or replace function whatsapp.validate_audit_chain(p_limit integer default null)
returns table(broken_id bigint) language plpgsql security definer set search_path to '' as $function$
declare
  r record;
  v_prev bytea := decode(repeat('00', 32), 'hex');
  v_calc bytea;
begin
  for r in
    select id, occurred_at, actor_uid, event_type, target_type, target_id, payload, prev_hash, this_hash
      from whatsapp.audit_log order by id asc limit coalesce(p_limit, 2147483647)
  loop
    v_calc := extensions.digest(
      v_prev
      || convert_to(r.occurred_at::text, 'UTF8')
      || convert_to(coalesce(r.actor_uid::text, ''), 'UTF8')
      || convert_to(r.event_type, 'UTF8')
      || convert_to(coalesce(r.target_type, ''), 'UTF8')
      || convert_to(coalesce(r.target_id, ''), 'UTF8')
      || convert_to(r.payload::text, 'UTF8'),
      'sha256'
    );
    if r.prev_hash != v_prev or r.this_hash != v_calc then
      broken_id := r.id;
      return next;
      return;
    end if;
    v_prev := r.this_hash;
  end loop;
  return;
end;
$function$;

create or replace function whatsapp.admin_audit_chain_status(p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_broken bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 100000);
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select broken_id into v_broken from whatsapp.validate_audit_chain(v_limit) limit 1;
  return jsonb_build_object('ok', v_broken is null, 'broken_id', v_broken, 'checked', v_limit);
end
$function$;

-- 5) RLS: owner-only SELECT (L1: is_admin -> is_owner; fleet-wide table).
create policy audit_log_admin_select on whatsapp.audit_log for select to authenticated using (public.is_owner());

-- 6) Table + sequence grants (grant==policy).
grant select        on whatsapp.audit_log to authenticated;                 -- RLS gates to owner
grant all           on whatsapp.audit_log to service_role;                  -- bypasses RLS
grant usage, select on sequence whatsapp.audit_log_id_seq to service_role;  -- for direct service inserts

-- 7) Function grants (strip PUBLIC, grant to intended roles only -- W5).
revoke all on function whatsapp.audit(text, text, text, jsonb)        from public;
grant  execute on function whatsapp.audit(text, text, text, jsonb)    to authenticated, service_role;
revoke all on function whatsapp._audit_log_hash()                     from public;
grant  execute on function whatsapp._audit_log_hash()                 to service_role;
revoke all on function whatsapp.validate_audit_chain(integer)         from public;
grant  execute on function whatsapp.validate_audit_chain(integer)     to service_role;
revoke all on function whatsapp.admin_audit_chain_status(integer)     from public;
grant  execute on function whatsapp.admin_audit_chain_status(integer) to authenticated, service_role;
