-- TKT-12 (Notion Ref 10): user deletion — auth/public split fix + archive model.
-- Load-bearing users are ARCHIVED (active=false + archived_at + GoTrue soft
-- delete), never hard-deleted: orders.seller_id/confirmed_by_id and the note
-- created_by FKs BLOCK deletion, and the payment ledgers
-- (seller_payments, mediabuyer_payments) are ON DELETE CASCADE — a
-- "successful" hard delete would silently destroy money history.
-- Post-review hardening (Codex round, 2026-07-30): eligibility count and the
-- destructive write are ATOMIC (SECDEF RPCs locking the user/business row),
-- the archived state is frozen by a CHECK, and the last-BO trigger counts
-- only active, non-archived owners.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Archived is terminal-off: an archived row can never be active. Any stale
-- reactivation (account-status-change racing an archive) dies here.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_archived_means_inactive;
ALTER TABLE public.users ADD CONSTRAINT users_archived_means_inactive
    CHECK (archived_at IS NULL OR active = false);

-- ── Reference counting (single definition, used by profile + hard delete) ──
-- Meaningful operational/financial references only. Deliberately EXCLUDED as
-- non-attribution config/ephemera (they cascade harmlessly): courier_fees,
-- courier_zones, seller_presences, push_subscriptions, GA/Meta access rows,
-- credential_change_requests, user_invitations stamps, email_log.
CREATE OR REPLACE FUNCTION public.count_user_references(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT jsonb_build_object(
        'commandes',  (SELECT count(*) FROM orders o
                        WHERE o.seller_id = p_user_id OR o.confirmed_by_id = p_user_id
                           OR o.courier_id = p_user_id OR o.deleted_by_id = p_user_id),
        'paiements',  (SELECT (SELECT count(*) FROM seller_payments WHERE seller_id = p_user_id)
                            + (SELECT count(*) FROM mediabuyer_payments WHERE mediabuyer_id = p_user_id)
                            + (SELECT count(*) FROM courier_payment_notes WHERE courier_id = p_user_id OR created_by = p_user_id)
                            + (SELECT count(*) FROM business_payments WHERE submitted_by = p_user_id OR reviewed_by = p_user_id)),
        'colis',      (SELECT count(*) FROM courier_parcels WHERE courier_id = p_user_id),
        'notes',      (SELECT (SELECT count(*) FROM company_delivery_notes WHERE created_by = p_user_id)
                            + (SELECT count(*) FROM company_return_notes WHERE created_by = p_user_id)
                            + (SELECT count(*) FROM courier_delivery_notes WHERE courier_id = p_user_id OR created_by = p_user_id)
                            + (SELECT count(*) FROM courier_return_notes WHERE courier_id = p_user_id OR created_by = p_user_id)),
        'campagnes',  (SELECT (SELECT count(*) FROM campaigns WHERE created_by = p_user_id)
                            + (SELECT count(*) FROM campaign_daily_entries WHERE created_by = p_user_id)
                            + (SELECT count(*) FROM ads_history WHERE created_by = p_user_id)
                            + (SELECT count(*) FROM campaign_source_locks WHERE mediabuyer_id = p_user_id)),
        'demandes',   (SELECT (SELECT count(*) FROM seller_demands WHERE seller_id = p_user_id)
                            + (SELECT count(*) FROM mediabuyer_demands WHERE mediabuyer_id = p_user_id)
                            + (SELECT count(*) FROM parcel_change_demands WHERE created_by = p_user_id)),
        'historique', (SELECT (SELECT count(*) FROM order_status_history WHERE changed_by = p_user_id)
                            + (SELECT count(*) FROM businesses WHERE creator_id = p_user_id))
    );
$$;
REVOKE ALL ON FUNCTION public.count_user_references(uuid) FROM PUBLIC, anon, authenticated;

-- ── Receipts for the adaptive dialog (caller-gated) ────────────────────────
CREATE OR REPLACE FUNCTION public.user_deletion_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_me record;
    v_target record;
    v_counts jsonb;
    v_total bigint;
BEGIN
    SELECT role::text AS role, "DigiCom Business" AS biz INTO v_me
    FROM public.users WHERE id = auth.uid();
    IF v_me.role IS NULL THEN
        RAISE EXCEPTION 'Authentification requise.';
    END IF;

    SELECT role::text AS role, "DigiCom Business" AS biz INTO v_target
    FROM public.users WHERE id = p_user_id;
    IF v_target.role IS NULL THEN
        RAISE EXCEPTION 'Utilisateur introuvable.';
    END IF;

    -- NULL-safe on purpose: the platform owner's business is NULL — a bare
    -- equality would go NULL and skip the gate.
    IF v_me.role <> 'owner' THEN
        IF v_target.role = 'owner'
           OR v_me.role NOT IN ('business owner', 'super admin', 'admin')
           OR v_me.biz IS NULL OR v_target.biz IS NULL
           OR v_me.biz <> v_target.biz THEN
            RAISE EXCEPTION 'Accès refusé.';
        END IF;
    END IF;

    v_counts := public.count_user_references(p_user_id);
    SELECT sum(value::bigint) INTO v_total FROM jsonb_each_text(v_counts);

    RETURN v_counts || jsonb_build_object('total', v_total, 'hard_deletable', v_total = 0);
END;
$$;
REVOKE ALL ON FUNCTION public.user_deletion_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_deletion_profile(uuid) TO authenticated, service_role;

-- ── Atomic hard delete (service-role only; the edge is the caller) ─────────
-- Locks the user row, recounts INSIDE the same transaction (no TOCTOU window
-- for a fresh payment row to slip into a CASCADE), deletes the profile.
CREATE OR REPLACE FUNCTION public.hard_delete_user_checked(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_row record;
    v_counts jsonb;
    v_total bigint;
BEGIN
    SELECT id, role::text AS role INTO v_row FROM public.users
    WHERE id = p_user_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Utilisateur introuvable.';
    END IF;

    v_counts := public.count_user_references(p_user_id);
    SELECT sum(value::bigint) INTO v_total FROM jsonb_each_text(v_counts);
    IF v_total > 0 THEN
        RAISE EXCEPTION 'Cet utilisateur a un historique d''activité — archivez-le au lieu de le supprimer.';
    END IF;

    DELETE FROM public.users WHERE id = p_user_id;
    RETURN jsonb_build_object('deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.hard_delete_user_checked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_user_checked(uuid) TO service_role;

-- ── Atomic archive (service-role only) ─────────────────────────────────────
-- Locks the BUSINESS row so two concurrent archives of the two last owners
-- serialize; counts only ACTIVE, NON-ARCHIVED peers; flips the row.
CREATE OR REPLACE FUNCTION public.archive_user_checked(p_user_id uuid, p_enforce_last_bo boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_row record;
BEGIN
    SELECT id, role::text AS role, "DigiCom Business" AS biz, archived_at INTO v_row
    FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Utilisateur introuvable.';
    END IF;
    IF v_row.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Utilisateur déjà archivé.';
    END IF;

    IF v_row.role = 'business owner' AND p_enforce_last_bo THEN
        IF v_row.biz IS NOT NULL THEN
            PERFORM 1 FROM public.businesses WHERE id = v_row.biz FOR UPDATE;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.users u2
            WHERE u2."DigiCom Business" = v_row.biz
              AND u2.role = 'business owner'
              AND u2.active = true
              AND u2.archived_at IS NULL
              AND u2.id <> p_user_id
        ) THEN
            RAISE EXCEPTION 'Impossible de retirer le dernier propriétaire de l''entreprise.';
        END IF;
    END IF;

    UPDATE public.users SET active = false, archived_at = now() WHERE id = p_user_id;
    RETURN jsonb_build_object('archived', true);
END;
$$;
REVOKE ALL ON FUNCTION public.archive_user_checked(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_user_checked(uuid, boolean) TO service_role;

-- ── Last-BO trigger refinement: only ACTIVE, NON-ARCHIVED owners count ─────
-- (protect_business_owner_role otherwise unchanged from 20260729180000.)
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
    v_biz_move :=
        TG_OP = 'UPDATE' AND OLD.role = 'business owner' AND NEW.role = 'business owner'
        AND NEW."DigiCom Business" IS DISTINCT FROM OLD."DigiCom Business";
    v_platform_boundary :=
        (TG_OP IN ('INSERT', 'UPDATE') AND NEW.role = 'owner'
            AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'owner'))
        OR (TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'owner'
            AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'owner'));

    IF NOT (v_demote_or_delete OR v_become_owner OR v_biz_move OR v_platform_boundary) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF auth.uid() IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    SELECT role::text, "DigiCom Business" INTO v_actor_role, v_actor_biz
    FROM public.users WHERE id = auth.uid();

    IF v_actor_role = 'owner' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF v_platform_boundary THEN
        RAISE EXCEPTION 'Seule la plateforme peut gérer le rôle propriétaire de la plateforme.';
    END IF;

    IF v_biz_move THEN
        RAISE EXCEPTION 'Seule la plateforme peut déplacer un propriétaire vers une autre entreprise.';
    END IF;

    IF v_demote_or_delete AND (v_actor_role IS DISTINCT FROM 'business owner'
        OR v_actor_biz IS DISTINCT FROM OLD."DigiCom Business") THEN
        RAISE EXCEPTION 'Le propriétaire de l''entreprise ne peut pas être modifié par un pair.';
    END IF;
    IF v_become_owner AND (v_actor_role IS DISTINCT FROM 'business owner'
        OR v_actor_biz IS DISTINCT FROM NEW."DigiCom Business") THEN
        RAISE EXCEPTION 'Seul un propriétaire de l''entreprise ou la plateforme peut désigner un propriétaire.';
    END IF;

    IF v_demote_or_delete THEN
        PERFORM 1 FROM public.businesses WHERE id = OLD."DigiCom Business" FOR UPDATE;
        IF NOT EXISTS (
            SELECT 1 FROM public.users u2
            WHERE u2."DigiCom Business" = OLD."DigiCom Business"
              AND u2.role = 'business owner'
              AND u2.active = true
              AND u2.archived_at IS NULL
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
