-- Backup-agent access model (Phase 7, owner decision 2026-07-04):
-- backup_admin = capability to use the backup agent + /owner/backups dashboard.
-- backup_root  = the single account allowed to grant/revoke backup_admin
--                (via manage-users); never settable through the app itself.
-- Guard trigger: no authenticated/anon path can flip either column — only
-- service-role paths (edge functions, which enforce backup_root themselves)
-- and direct admin SQL.

alter table public.users add column if not exists backup_admin boolean not null default false;
alter table public.users add column if not exists backup_root  boolean not null default false;

comment on column public.users.backup_admin is
  'Backup agent + /owner/backups access (view/download/trigger; restore per agent gates). Grantable only by the backup_root account.';
comment on column public.users.backup_root is
  'Sole granter of backup_admin. Not settable through the app; changed only by direct admin SQL.';

create or replace function public.guard_backup_privilege_cols()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  jrole text;
begin
  if (new.backup_admin is distinct from old.backup_admin)
     or (new.backup_root is distinct from old.backup_root) then
    jrole := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', current_user::text);
    if jrole not in ('service_role', 'supabase_admin', 'postgres') then
      raise exception 'backup privilege columns cannot be changed through this path';
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_guard_backup_privilege on public.users;
create trigger trg_guard_backup_privilege
  before update on public.users
  for each row execute function public.guard_backup_privilege_cols();

-- seed: the official owner account is the root granter and first holder
update public.users
   set backup_admin = true, backup_root = true
 where id = 'c3417920-6c7f-4a78-a24a-9d9f81708b9a';
