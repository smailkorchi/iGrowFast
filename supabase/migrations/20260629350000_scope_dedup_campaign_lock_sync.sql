-- HYGIENE (T7 trigger-sweep #6, 2026-06-29): stop campaign_lock_sync over-firing and double-syncing
-- the same source lock.
--
-- campaign_lock_sync was AFTER INSERT OR DELETE OR UPDATE (ALL columns), so EVERY campaign edit
-- (budget, dates, notes, daily-entry-driven touches...) re-ran the source-lock maintenance, and on
-- UPDATE it always called mb_sync_source_lock TWICE — once for OLD (biz,source) and once for NEW —
-- even when the (business, normalized source) pair was unchanged (the common case). mb_sync_source_lock
-- is idempotent so this was wasteful, not wrong.
--
-- The lock for a (business, source) depends ONLY on these campaign columns: status (active?),
-- platform (the source), "DigiCom Business" (the tenant), created_by (the owning media buyer). FIX:
--  1) Scope the trigger to AFTER INSERT OR DELETE OR UPDATE OF (status, platform, "DigiCom Business",
--     created_by) — INSERT/DELETE still fire unconditionally; UPDATE only when a lock-relevant column
--     changes.
--  2) In the function, sync the OLD (biz,source) and NEW (biz,source) pairs but skip the NEW call when
--     it targets the exact same pair already synced for OLD (dedup). Net result identical (idempotent),
--     one call instead of two on a same-pair change.
--
-- Behavior preserving: the enable check (coalesce(NEW,OLD)."DigiCom Business") and the set of
-- (biz,source) pairs actually maintained are unchanged; only redundant work is removed.
--
-- Rollback: recreate the trigger AFTER INSERT OR DELETE OR UPDATE (all columns) and restore the
-- two unconditional perform calls.

CREATE OR REPLACE FUNCTION public.trg_campaign_lock_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_biz uuid;
  v_old_src text;
  v_new_src text;
begin
  v_biz := coalesce(NEW."DigiCom Business", OLD."DigiCom Business");
  select coalesce(source_exclusivity_enabled,false) into v_enabled from public.businesses where id = v_biz;
  if not coalesce(v_enabled,false) then return coalesce(NEW, OLD); end if;

  if TG_OP in ('UPDATE','DELETE') then v_old_src := mb_source_norm(OLD.platform); end if;
  if TG_OP in ('INSERT','UPDATE') then v_new_src := mb_source_norm(NEW.platform); end if;

  -- OLD side (UPDATE/DELETE)
  if TG_OP in ('UPDATE','DELETE') then
    perform mb_sync_source_lock(OLD."DigiCom Business", v_old_src);
  end if;

  -- NEW side (INSERT/UPDATE), skipped when it is the exact same (biz, source) just synced above.
  if TG_OP in ('INSERT','UPDATE') then
    if TG_OP = 'INSERT'
       or OLD."DigiCom Business" is distinct from NEW."DigiCom Business"
       or v_old_src is distinct from v_new_src then
      perform mb_sync_source_lock(NEW."DigiCom Business", v_new_src);
    end if;
  end if;

  return coalesce(NEW, OLD);
end $function$;

DROP TRIGGER IF EXISTS campaign_lock_sync ON public.campaigns;
CREATE TRIGGER campaign_lock_sync
  AFTER INSERT OR DELETE OR UPDATE OF status, platform, "DigiCom Business", created_by ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.trg_campaign_lock_sync();
