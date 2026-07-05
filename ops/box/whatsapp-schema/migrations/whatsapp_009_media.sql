-- whatsapp_009_media  (Wave 9) — media fetch queue + Storage bucket
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports media_fetch_jobs (RESTRICTIVE deny-all) + enqueue/complete/fail fns + provisions the private
-- Storage bucket whatsapp-media (F6). Two adaptations:
--   * enqueue_media_fetch default bucket 'wamancer-media' -> 'whatsapp-media' (iGrowFast bucket).
--   * fail_media_fetch: source ships a 2-arg AND a 3-arg overload that are AMBIGUOUS when called with 2
--     args (the 3-arg's p_terminal defaults false). Port ONLY the 3-arg superset (covers both call shapes).

-- ============================================================ media_fetch_jobs (deny-all)
create table whatsapp.media_fetch_jobs (
  id                   bigserial primary key,
  message_id           uuid not null,
  instance_id          uuid not null,
  evolution_message_id text not null,
  kind                 whatsapp.message_kind not null,
  attempts             smallint not null default 0,
  last_error           text,
  next_attempt_at      timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  constraint media_fetch_jobs_message_id_fkey foreign key (message_id) references whatsapp.messages(id) on delete cascade,
  constraint media_fetch_jobs_instance_id_fkey foreign key (instance_id) references whatsapp.whatsapp_instances(id) on delete cascade
);
create index media_fetch_jobs_instance_id_idx on whatsapp.media_fetch_jobs using btree (instance_id);
create unique index uq_media_fetch_jobs_active_message on whatsapp.media_fetch_jobs using btree (message_id) where (completed_at is null);
create index idx_media_fetch_jobs_drain on whatsapp.media_fetch_jobs using btree (next_attempt_at) where (completed_at is null);

alter table whatsapp.media_fetch_jobs enable row level security;
create policy media_fetch_jobs_deny_all on whatsapp.media_fetch_jobs as restrictive for all to anon, authenticated using (false) with check (false);
-- deny-all: RESTRICTIVE false for anon/authenticated + no authenticated grant (W5). service_role bypasses RLS.
grant all on whatsapp.media_fetch_jobs to service_role;
grant usage, select on sequence whatsapp.media_fetch_jobs_id_seq to service_role;

-- ============================================================ media fns (SECDEF, service_role)
create or replace function whatsapp.enqueue_media_fetch(p_message_id uuid, p_instance_id uuid, p_evolution_message_id text, p_kind whatsapp.message_kind)
returns bigint language plpgsql security definer set search_path to '' as $function$
declare v_id bigint;
begin
  insert into whatsapp.media_fetch_jobs (message_id, instance_id, evolution_message_id, kind)
  values (p_message_id, p_instance_id, p_evolution_message_id, p_kind)
  on conflict (message_id) where completed_at is null do nothing
  returning id into v_id;

  update whatsapp.messages
    set media_pending = true,
        media_storage_bucket = coalesce(media_storage_bucket, 'whatsapp-media')
    where id = p_message_id;

  perform pg_notify('media_fetch_ready', p_message_id::text);
  return v_id;
end;
$function$;

create or replace function whatsapp.complete_media_fetch(p_message_id uuid, p_storage_bucket text, p_storage_key text, p_size_bytes bigint, p_mime text, p_sha256 bytea)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  update whatsapp.messages
    set media_storage_bucket = p_storage_bucket,
        media_storage_key    = p_storage_key,
        media_size_bytes     = p_size_bytes,
        media_mime           = p_mime,
        media_sha256         = p_sha256,
        media_uploaded_at    = now(),
        media_pending        = false
    where id = p_message_id;

  update whatsapp.media_fetch_jobs set completed_at = now() where message_id = p_message_id and completed_at is null;
end;
$function$;

create or replace function whatsapp.fail_media_fetch(p_job_id bigint, p_error text, p_terminal boolean default false)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_attempts smallint; v_msg_id uuid; v_done boolean;
begin
  update whatsapp.media_fetch_jobs
    set attempts        = attempts + 1,
        last_error      = left(p_error, 500),
        next_attempt_at = case when p_terminal then now()
                               else now() + make_interval(mins => least(60, (5 * power(2, attempts))::int)) end,
        completed_at    = case when p_terminal then now()
                               when attempts + 1 >= 5 then now()
                               else null end
    where id = p_job_id
    returning attempts, message_id, completed_at is not null into v_attempts, v_msg_id, v_done;

  if v_done then
    update whatsapp.messages set media_pending = false, media_failed_at = coalesce(media_failed_at, now()) where id = v_msg_id;
  end if;
end;
$function$;

revoke all on function whatsapp.enqueue_media_fetch(uuid, uuid, text, whatsapp.message_kind) from public; grant execute on function whatsapp.enqueue_media_fetch(uuid, uuid, text, whatsapp.message_kind) to service_role;
revoke all on function whatsapp.complete_media_fetch(uuid, text, text, bigint, text, bytea)          from public; grant execute on function whatsapp.complete_media_fetch(uuid, text, text, bigint, text, bytea)          to service_role;
revoke all on function whatsapp.fail_media_fetch(bigint, text, boolean)                              from public; grant execute on function whatsapp.fail_media_fetch(bigint, text, boolean)                              to service_role;

-- ============================================================ F6: private Storage bucket
insert into storage.buckets (id, name, public) values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;
