-- TKT-9: package status history — our own persistent record of every parcel
-- status transition (L1, append-only, trigger-captured) plus the last rich
-- provider-history snapshot (L2, upserted by provider-integration track_parcel).
-- Resilience goal: tracking renders from OUR data when the provider API is down.
--
-- Design decisions (post adversarial review, 2026-07-29):
--  * Parcel/provider ids are RAW uuids (no FKs): identity must survive parcel
--    deletion (delivery-note flows) and provider reconfiguration, and FK-less
--    columns cost nothing on parcel DELETE. Orphan ids are fine — this is a log.
--  * Status labels/colors are DENORMALIZED at write time: history stays
--    self-describing forever; master statuses remain deletable (FKs SET NULL).
--    The status-FK SET NULL sweep on master deletion is unindexed on purpose
--    (masters ≈30 rows, deletions rare; add partial indexes if that changes).
--  * new_status_id is NULLABLE: clearing a parcel's status writes a tombstone
--    row (old → NULL) — "every transition" includes un-setting.
--  * is_baseline marks backfill seeds ("observed as of", not "changed at").
--  * The box's default ACL grants anon/authenticated FULL table privileges
--    (verified live 2026-07-29) — RLS does NOT gate TRUNCATE/REFERENCES, so
--    explicit REVOKEs are mandatory. parcel_change_demands (2026-07-29) is
--    retro-hardened here for the same reason.
--  * No realtime publication ever. Retention: FOREVER (history is the point).
--    Scale: ~120 transitions/day today; ×100 growth ≈ 4.4M rows/yr ≈ 0.5 GB/yr —
--    unpartitioned is fine for years; schema is range-partition-ready.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── L1: transition log ─────────────────────────────────────────────────────
CREATE TABLE public.package_status_history (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "DigiCom Business" uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id           uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    source             text NOT NULL CHECK (source IN ('company_parcel', 'courier_parcel')),
    company_parcel_id  uuid,
    courier_parcel_id  uuid,
    provider_id        uuid,
    tracking_code      text,
    old_status_id      uuid REFERENCES public.package_statuses(id) ON DELETE SET NULL,
    new_status_id      uuid REFERENCES public.package_statuses(id) ON DELETE SET NULL,
    old_status_label   text,
    new_status_label   text,
    new_status_color   text,
    is_baseline        boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (source = 'company_parcel' AND company_parcel_id IS NOT NULL)
        OR (source = 'courier_parcel' AND courier_parcel_id IS NOT NULL)
    )
);

CREATE INDEX idx_psh_tracking_created ON public.package_status_history (tracking_code, created_at);
CREATE INDEX idx_psh_order_created ON public.package_status_history (order_id, created_at);
CREATE INDEX idx_psh_biz_created ON public.package_status_history ("DigiCom Business", created_at DESC);

ALTER TABLE public.package_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY psh_tenant_select ON public.package_status_history
    FOR SELECT TO authenticated
    USING ("DigiCom Business" = (SELECT current_user_digicom_business_id()));

REVOKE ALL ON public.package_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.package_status_history TO authenticated;

-- ── Trigger: capture every status transition on both parcel tables ─────────
CREATE OR REPLACE FUNCTION public.log_package_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_old_label text;
    v_new_label text;
    v_new_color text;
BEGIN
    -- SECDEF hardening: refuse to run from any relation but the two parcel
    -- tables (TG_TABLE_NAME alone is spoofable via a temp table).
    IF TG_RELID NOT IN ('public.company_parcels'::regclass, 'public.courier_parcels'::regclass) THEN
        RAISE EXCEPTION 'log_package_status_change: unexpected relation %', TG_RELID;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status_id IS NULL THEN
        RETURN NEW;  -- nothing to record yet
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
        RETURN NEW;
    END IF;

    -- Denormalize labels/colors now (PK lookups, master rows are hot).
    IF TG_OP = 'UPDATE' AND OLD.status_id IS NOT NULL THEN
        SELECT label INTO v_old_label FROM public.package_statuses WHERE id = OLD.status_id;
    END IF;
    IF NEW.status_id IS NOT NULL THEN
        SELECT label, color INTO v_new_label, v_new_color
        FROM public.package_statuses WHERE id = NEW.status_id;
    END IF;

    INSERT INTO public.package_status_history (
        "DigiCom Business", order_id, source, company_parcel_id, courier_parcel_id,
        provider_id, tracking_code, old_status_id, new_status_id,
        old_status_label, new_status_label, new_status_color
    ) VALUES (
        NEW."DigiCom Business",
        NEW.order_id,
        CASE WHEN TG_RELID = 'public.company_parcels'::regclass THEN 'company_parcel' ELSE 'courier_parcel' END,
        CASE WHEN TG_RELID = 'public.company_parcels'::regclass THEN NEW.id END,
        CASE WHEN TG_RELID = 'public.courier_parcels'::regclass THEN NEW.id END,
        CASE WHEN TG_RELID = 'public.company_parcels'::regclass THEN NEW.provider_id END,
        NULLIF(btrim(coalesce(NEW.tracking_code, '')), ''),
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.status_id END,
        NEW.status_id,
        v_old_label,
        v_new_label,
        v_new_color
    );
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_package_status_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_log_company_parcel_status_history
    AFTER INSERT OR UPDATE OF status_id ON public.company_parcels
    FOR EACH ROW EXECUTE FUNCTION public.log_package_status_change();

CREATE TRIGGER trg_log_courier_parcel_status_history
    AFTER INSERT OR UPDATE OF status_id ON public.courier_parcels
    FOR EACH ROW EXECUTE FUNCTION public.log_package_status_change();

-- ── Backfill: one baseline row per existing parcel at its current status ───
INSERT INTO public.package_status_history
    ("DigiCom Business", order_id, source, company_parcel_id, provider_id,
     tracking_code, new_status_id, new_status_label, new_status_color, is_baseline, created_at)
SELECT cp."DigiCom Business", cp.order_id, 'company_parcel', cp.id, cp.provider_id,
       NULLIF(btrim(coalesce(cp.tracking_code, '')), ''),
       cp.status_id, ps.label, ps.color, true,
       coalesce(cp.updated_at, cp.created_at, now())
FROM public.company_parcels cp
JOIN public.package_statuses ps ON ps.id = cp.status_id
WHERE cp.status_id IS NOT NULL;

INSERT INTO public.package_status_history
    ("DigiCom Business", order_id, source, courier_parcel_id,
     tracking_code, new_status_id, new_status_label, new_status_color, is_baseline, created_at)
SELECT crp."DigiCom Business", crp.order_id, 'courier_parcel', crp.id,
       NULLIF(btrim(coalesce(crp.tracking_code, '')), ''),
       crp.status_id, ps.label, ps.color, true,
       coalesce(crp.updated_at, crp.created_at, now())
FROM public.courier_parcels crp
JOIN public.package_statuses ps ON ps.id = crp.status_id
WHERE crp.status_id IS NOT NULL;

-- ── L2: last successful rich provider-history snapshot ─────────────────────
-- provider_id has NO FK on purpose: deleting/replacing a provider config must
-- not destroy the resilience data. Recycled tracking codes overwrite the old
-- snapshot — accepted: this is a latest-known cache, not a ledger (L1 is).
CREATE TABLE public.parcel_tracking_snapshots (
    provider_id        uuid NOT NULL,
    tracking_code      text NOT NULL CHECK (btrim(tracking_code) <> ''),
    "DigiCom Business" uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_id           uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    status             text,
    status_label       text,
    history            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
    fetched_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, tracking_code)
);

CREATE INDEX idx_pts_order ON public.parcel_tracking_snapshots (order_id);

ALTER TABLE public.parcel_tracking_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY pts_tenant_select ON public.parcel_tracking_snapshots
    FOR SELECT TO authenticated
    USING ("DigiCom Business" = (SELECT current_user_digicom_business_id()));

REVOKE ALL ON public.parcel_tracking_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.parcel_tracking_snapshots TO authenticated;

-- ── Retro-hardening: parcel_change_demands (2026-07-29) inherited the same
-- default-ACL exposure (anon/authenticated full privileges incl. TRUNCATE).
REVOKE ALL ON public.parcel_change_demands FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.parcel_change_demands TO authenticated;

COMMIT;
