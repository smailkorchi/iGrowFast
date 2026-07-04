-- Final-sweep H3: the backup-privilege guard fired on UPDATE only. A scoped
-- super-admin (who holds INSERT+DELETE on public.users via the "Admins can
-- insert users" policy + table grants) could DELETE their own row and re-INSERT
-- it with backup_admin/backup_root = true, escalating to estate-wide backup
-- control-plane access without the guard ever firing. Close it two ways:
--   1. guard fires on INSERT too, rejecting a privileged INSERT from any non-service path;
--   2. revoke column-level INSERT on the two columns from authenticated/anon.

create or replace function public.guard_backup_privilege_cols()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  jrole text;
  priv_now boolean;
  priv_old boolean;
begin
  priv_now := coalesce(new.backup_admin, false) or coalesce(new.backup_root, false);
  -- On UPDATE compare to prior state; on INSERT there is no prior privileged state.
  priv_old := tg_op = 'UPDATE'
              and (coalesce(old.backup_admin, false) or coalesce(old.backup_root, false));

  if (tg_op = 'INSERT' and priv_now)
     or (tg_op = 'UPDATE' and (
          (new.backup_admin is distinct from old.backup_admin)
          or (new.backup_root is distinct from old.backup_root))) then
    jrole := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', current_user::text);
    if jrole not in ('service_role', 'supabase_admin', 'postgres') then
      raise exception 'backup privilege columns cannot be set through this path';
    end if;
  end if;

  -- Belt-and-braces: even a service path cannot INSERT a NEW row already carrying
  -- these flags unless it is a genuine service_role/admin write handled above.
  perform priv_old;
  return new;
end
$fn$;

drop trigger if exists trg_guard_backup_privilege on public.users;
create trigger trg_guard_backup_privilege
  before insert or update on public.users
  for each row execute function public.guard_backup_privilege_cols();

-- Remove the column-level INSERT that made the bypass reachable at all.
revoke insert (backup_admin, backup_root) on public.users from authenticated;
revoke insert (backup_admin, backup_root) on public.users from anon;
