-- TKT-10b: business-owner multiplicity (owner decision 2026-07-29).
-- A business may now have SEVERAL business owners; business owners manage the
-- role within their OWN business (create/promote/demote/delete peers). The
-- platform owner can do anything. New safety rule: a business can never lose
-- its LAST business owner (self-demotion or peer removal of the final one is
-- blocked; platform owner overrides).
-- The users_business_owner_needs_business CHECK stays. Apply as supabase_admin
-- if postgres hits fn-ownership errors (see business-owner-role memory trap).

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.users_one_business_owner_per_biz;

CREATE OR REPLACE FUNCTION public.protect_business_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_actor_role text;
    v_actor_biz uuid;
    v_demote_or_delete boolean;
    v_become_owner boolean;
    v_biz_move boolean;
    v_platform_boundary boolean;
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
    -- Moving a BO between businesses changes neither role — it must count as
    -- leaving OLD's business (last-BO rule) AND entering NEW's (designation).
    v_biz_move :=
        TG_OP = 'UPDATE' AND OLD.role = 'business owner' AND NEW.role = 'business owner'
        AND NEW."DigiCom Business" IS DISTINCT FROM OLD."DigiCom Business";
    -- Any crossing of the PLATFORM 'owner' boundary (into or out of it) is
    -- platform-owner-only — a BO must never be able to mint or unmake one.
    v_platform_boundary :=
        (TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'owner'
            AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'owner'))
        OR (TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner'
            AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'owner'));

    -- Fast path: the vast majority of users writes touch none of the guards.
    IF NOT (v_demote_or_delete OR v_become_owner OR v_biz_move OR v_platform_boundary) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- System/service-role sessions pass (edge fns enforce their own caller
    -- checks; migrations/backfills run as postgres/supabase_admin).
    IF auth.uid() IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    SELECT role::text, "DigiCom Business" INTO v_actor_role, v_actor_biz
    FROM public.users WHERE id = auth.uid();

    -- Platform owner: unrestricted (including removing a last business owner).
    IF v_actor_role = 'owner' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF v_platform_boundary THEN
        RAISE EXCEPTION 'Seule la plateforme peut gérer le rôle propriétaire de la plateforme.';
    END IF;

    IF v_biz_move THEN
        RAISE EXCEPTION 'Seule la plateforme peut déplacer un propriétaire vers une autre entreprise.';
    END IF;

    -- Peer management: only a business owner OF THE SAME BUSINESS as the target.
    IF v_demote_or_delete AND (v_actor_role IS DISTINCT FROM 'business owner'
        OR v_actor_biz IS DISTINCT FROM OLD."DigiCom Business") THEN
        RAISE EXCEPTION 'Le propriétaire de l''entreprise ne peut pas être modifié par un pair.';
    END IF;
    IF v_become_owner AND (v_actor_role IS DISTINCT FROM 'business owner'
        OR v_actor_biz IS DISTINCT FROM NEW."DigiCom Business") THEN
        RAISE EXCEPTION 'Seul un propriétaire de l''entreprise ou la plateforme peut désigner un propriétaire.';
    END IF;

    -- A business must keep at least one business owner. Serialize the check on
    -- the businesses row (FOR UPDATE) — without it, two concurrent demotions of
    -- the two last owners both pass the count under READ COMMITTED.
    IF v_demote_or_delete THEN
        PERFORM 1 FROM public.businesses WHERE id = OLD."DigiCom Business" FOR UPDATE;
        IF NOT EXISTS (
            SELECT 1 FROM public.users u2
            WHERE u2."DigiCom Business" = OLD."DigiCom Business"
              AND u2.role = 'business owner'
              AND u2.id <> OLD.id
        ) THEN
            RAISE EXCEPTION 'Impossible de retirer le dernier propriétaire de l''entreprise.';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_business_owner_role() FROM PUBLIC, anon, authenticated;

COMMIT;
