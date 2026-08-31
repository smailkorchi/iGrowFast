-- Fix: log_package_status_change blew up on courier_parcels with
--   record "new" has no field "provider_id"
-- PL/pgSQL resolves every NEW.<field> in an expression against the firing
-- table's row type when the statement is planned — a CASE branch does not
-- protect a reference to a column the table lacks. courier_parcels has no
-- provider_id, so every INSERT/UPDATE with a status_id failed since
-- 20260729120000 shipped. Move the reference into an IF statement, which is
-- only planned when its branch actually executes.

BEGIN;

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
    v_provider_id uuid;
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

    -- provider_id exists only on company_parcels; referencing NEW.provider_id
    -- inside the INSERT below would fail to plan on courier_parcels rows.
    IF TG_RELID = 'public.company_parcels'::regclass THEN
        v_provider_id := NEW.provider_id;
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
        v_provider_id,
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

COMMIT;
