# TICKET FIX-DB — TKT-10 migration fixes from Codex review (6 findings)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), fix `supabase/migrations/20260729150000_business_owner_parity.sql` per the six items below. AUTHOR ONLY — never run db.sh --write.

## FIXES
1. **Replace the protection trigger section entirely** (fn `protect_business_owner_role()` + its CREATE TRIGGER) with EXACTLY this text (guards transitions INTO the role too, drops the OF-list, cheap short-circuit before the actor lookup):
```sql
CREATE OR REPLACE FUNCTION public.protect_business_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_actor_role text;
    v_demote_or_delete boolean;
    v_become_owner boolean;
BEGIN
    IF TG_RELID <> 'public.users'::regclass THEN
        RAISE EXCEPTION 'protect_business_owner_role: unexpected relation %', TG_RELID;
    END IF;

    v_demote_or_delete :=
        (TG_OP = 'DELETE' AND OLD.role = 'business owner')
        OR (TG_OP = 'UPDATE' AND OLD.role = 'business owner' AND NEW.role IS DISTINCT FROM OLD.role);
    v_become_owner :=
        TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'business owner'
        AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'business owner');

    -- Fast path: the vast majority of users writes touch neither guard.
    IF NOT (v_demote_or_delete OR v_become_owner) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- System/service-role sessions pass (edge fns enforce their own caller
    -- checks; migrations/backfills run as postgres).
    IF auth.uid() IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    SELECT role::text INTO v_actor_role FROM public.users WHERE id = auth.uid();

    IF v_actor_role IS DISTINCT FROM 'owner' THEN
        IF v_demote_or_delete THEN
            RAISE EXCEPTION 'Le propriétaire de l''entreprise ne peut pas être modifié par un pair.';
        ELSE
            RAISE EXCEPTION 'Seule la plateforme peut désigner un propriétaire d''entreprise.';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_business_owner_role() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_business_owner ON public.users;
CREATE TRIGGER trg_protect_business_owner
    BEFORE INSERT OR UPDATE OR DELETE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.protect_business_owner_role();
```
Remove the old trigger's CREATE TRIGGER (whatever its name — add a DROP TRIGGER IF EXISTS for the OLD name too if it differs from trg_protect_business_owner).
2. **NULL-business guard**: add `ALTER TABLE public.users ADD CONSTRAINT users_business_owner_needs_business CHECK (role <> 'business owner' OR "DigiCom Business" IS NOT NULL);` (place with the unique index section).
3. **Lock ordering**: reorder FILE2's sections to: helper+functions FIRST (the big CREATE OR REPLACE FUNCTION block), THEN the 44 ALTER POLICY statements, THEN index + CHECK + trigger + whatsapp.profiles view, THEN COMMIT. Sections are comment-delimited — move whole blocks, do not edit their contents (beyond fixes here).
4. **Idempotency**: `CREATE UNIQUE INDEX IF NOT EXISTS users_one_business_owner_per_biz …` (keep the same definition).
5. **Deduplicate** `current_user_is_business_admin()`: it appears twice (standalone §1 + inside the generated functions block). Keep exactly ONE (the generated-block copy is fine; delete the other). Verify the surviving copy contains 'business owner'.
6. Keep the `SET LOCAL lock_timeout = '5s';` right after BEGIN.

## VERIFY BEFORE REPORTING
- Static: file still has exactly one BEGIN and one COMMIT; balanced parens/quotes (ignore apostrophes in `--` comments); count of ALTER POLICY unchanged (46 statements); exactly ONE definition of current_user_is_business_admin; grep confirms the new trigger text present and old OF-list form absent.
- Report the final section order.

## MUST NOT
Apply anything. Touch other files. Spawn subagents.

## WRITE SET
`supabase/migrations/20260729150000_business_owner_parity.sql` only.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-fix confirmation; section order; static-check results.
