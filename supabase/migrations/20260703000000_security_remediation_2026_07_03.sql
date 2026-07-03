-- Security remediation 2026-07-03 (self-owned self-hosted production box).
-- Enforces column/row/tenant authorization controls surfaced by the internal
-- secure-coding review. All changes are non-destructive to data.
--
-- Design note on the guard triggers (R2/R5/R6): they are SECURITY INVOKER so
-- that current_user reflects the ACTUAL executing role. This lets them exempt
-- non-end-user writers cleanly:
--   * service_role  -> manage-users / provider webhooks / admin edge flows
--   * postgres      -> SECURITY DEFINER fns (sync_imported_orders, approve_sheet_order)
--   * cron          -> scheduled jobs
-- Only a real `authenticated` self-write is gated. (A SECURITY DEFINER trigger
-- would see current_user='postgres' and auth.uid()=NULL for service_role, which
-- would WRONGLY block legitimate admin edits made through manage-users.)

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- Shared helper: is the acting user a business admin?
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.current_user_is_business_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('super admin','admin')
  );
$$;
REVOKE ALL ON FUNCTION public.current_user_is_business_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_is_business_admin() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- R2 — users: column-level UPDATE grant + privileged-column guard
-- ════════════════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (
  name, username, phone, address,
  avatar_url, avatar_config,
  bank_name, bank_account_holder, bank_rib, cin_number,
  courier_parcel_fragile, courier_parcel_open, courier_parcel_try_on,
  updated_at
) ON public.users TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_users_self_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- Exempt non-end-user writers (see header). Only gate real self-edits.
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF public.current_user_is_business_admin() THEN RETURN NEW; END IF;

  IF ( NEW.role              IS DISTINCT FROM OLD.role
    OR NEW."DigiCom Business" IS DISTINCT FROM OLD."DigiCom Business"
    OR NEW.permissions       IS DISTINCT FROM OLD.permissions
    OR NEW.commission_price  IS DISTINCT FROM OLD.commission_price
    OR NEW.commission_basis  IS DISTINCT FROM OLD.commission_basis
    OR NEW.salary_amount     IS DISTINCT FROM OLD.salary_amount
    OR NEW.payment_type      IS DISTINCT FROM OLD.payment_type
    OR NEW.active            IS DISTINCT FROM OLD.active ) THEN
    RAISE EXCEPTION 'privileged column change not permitted on self-update'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_users_self_privileged_cols ON public.users;
CREATE TRIGGER trg_guard_users_self_privileged_cols
  BEFORE UPDATE ON public.users FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_self_privileged_cols();

-- ════════════════════════════════════════════════════════════════════════
-- R4 — courier payout notes: split tenant-read from admin-only write
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS courier_payment_notes_tenant_all ON public.courier_payment_notes;
CREATE POLICY courier_payment_notes_tenant_select ON public.courier_payment_notes
  FOR SELECT TO authenticated
  USING ("DigiCom Business" = (SELECT current_user_digicom_business_id()));
CREATE POLICY courier_payment_notes_admin_write ON public.courier_payment_notes
  FOR ALL TO authenticated
  USING     ("DigiCom Business" = (SELECT current_user_digicom_business_id())
             AND (SELECT check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  WITH CHECK ("DigiCom Business" = (SELECT current_user_digicom_business_id())
             AND (SELECT check_user_role(auth.uid(), ARRAY['super admin','admin'])));

DROP POLICY IF EXISTS courier_payment_note_orders_tenant_all ON public.courier_payment_note_orders;
CREATE POLICY courier_payment_note_orders_tenant_select ON public.courier_payment_note_orders
  FOR SELECT TO authenticated
  USING ("DigiCom Business" = (SELECT current_user_digicom_business_id()));
CREATE POLICY courier_payment_note_orders_admin_write ON public.courier_payment_note_orders
  FOR ALL TO authenticated
  USING     ("DigiCom Business" = (SELECT current_user_digicom_business_id())
             AND (SELECT check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  WITH CHECK ("DigiCom Business" = (SELECT current_user_digicom_business_id())
             AND (SELECT check_user_role(auth.uid(), ARRAY['super admin','admin'])));

-- ════════════════════════════════════════════════════════════════════════
-- R5 — orders: ownership-scoped policies + money/attribution column freeze
--   Sellers (role 'commercial') legitimately CREATE/EDIT orders and set
--   price/raw_price (order total). price/raw_price do NOT feed seller
--   commission (which = users.commission_price x units gated by is_delivered
--   + seller_id), so they are NOT frozen. The attribution+eligibility columns
--   that DO drive the commission ledger — seller_id and a delivered
--   package_status_id — are frozen for non-admins.
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS orders_tenant_insert ON public.orders;
CREATE POLICY orders_tenant_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    "DigiCom Business" = (SELECT current_user_digicom_business_id())
    AND ( (SELECT current_user_is_business_admin())
          OR seller_id = (SELECT auth.uid()) )
  );

DROP POLICY IF EXISTS orders_tenant_update ON public.orders;
CREATE POLICY orders_tenant_update ON public.orders
  FOR UPDATE TO authenticated
  USING (
    "DigiCom Business" = (SELECT current_user_digicom_business_id())
    AND ( (SELECT current_user_is_business_admin())
          OR seller_id = (SELECT auth.uid())
          OR courier_id = (SELECT auth.uid()) )
  )
  WITH CHECK (
    "DigiCom Business" = (SELECT current_user_digicom_business_id())
    AND ( (SELECT current_user_is_business_admin())
          OR seller_id = (SELECT auth.uid())
          OR courier_id = (SELECT auth.uid()) )
  );

DROP POLICY IF EXISTS orders_tenant_delete ON public.orders;
CREATE POLICY orders_tenant_delete ON public.orders
  FOR DELETE TO authenticated
  USING (
    "DigiCom Business" = (SELECT current_user_digicom_business_id())
    AND (SELECT current_user_is_business_admin())
  );

CREATE OR REPLACE FUNCTION public.guard_orders_money_attribution_cols()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivered boolean;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF public.current_user_is_business_admin() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.seller_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'orders.seller_id must be the acting user on insert'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.package_status_id IS NOT NULL THEN
      SELECT ps.is_delivered INTO v_delivered
      FROM public.package_statuses ps WHERE ps.id = NEW.package_status_id;
      IF COALESCE(v_delivered, false) THEN
        RAISE EXCEPTION 'orders.package_status_id may not be set to a delivered status by a non-admin'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
    RAISE EXCEPTION 'orders.seller_id (attribution) is immutable for non-admins'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.package_status_id IS DISTINCT FROM OLD.package_status_id THEN
    SELECT ps.is_delivered INTO v_delivered
    FROM public.package_statuses ps WHERE ps.id = NEW.package_status_id;
    IF COALESCE(v_delivered, false) THEN
      RAISE EXCEPTION 'orders.package_status_id may not be moved to a delivered status by a non-admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_orders_money_attribution_cols ON public.orders;
CREATE TRIGGER trg_guard_orders_money_attribution_cols
  BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.guard_orders_money_attribution_cols();

-- ════════════════════════════════════════════════════════════════════════
-- R6 — campaign_daily_entries: bind created_by to the acting user for non-admins
--   Fires AFTER campaign_daily_entries_denorm_trig (name sorts after 'denorm'),
--   which fills created_by from the campaign owner when the client omits it.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.guard_cde_created_by()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF public.current_user_is_business_admin() THEN RETURN NEW; END IF;

  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'campaign_daily_entries.created_by must be the acting user'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS campaign_daily_entries_guard_created_by ON public.campaign_daily_entries;
CREATE TRIGGER campaign_daily_entries_guard_created_by
  BEFORE INSERT OR UPDATE ON public.campaign_daily_entries FOR EACH ROW
  EXECUTE FUNCTION public.guard_cde_created_by();

-- ════════════════════════════════════════════════════════════════════════
-- R7 (part 1/2, additive) — single-purpose username->email lookup fn.
--   Safe to apply before the frontend switches over: the new bundle calls this
--   RPC, the old bundle keeps using its anon column read. The breaking half
--   (DROP POLICY + REVOKE SELECT ... FROM anon) is deferred to
--   20260703000200_r7_revoke_anon_users_login_lookup.sql, applied only AFTER
--   the new frontend is confirmed live — else username login breaks on the old
--   bundle (its pre-login users.select('email') loses anon access).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.login_email_for_username(p_username text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT email FROM public.users WHERE lower(username) = lower(p_username) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.login_email_for_username(text) FROM public;
GRANT EXECUTE ON FUNCTION public.login_email_for_username(text) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- R9 — bind month-orders reporting fns to the caller's own tenant (drop is_owner bypass)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seller_month_orders(p_seller uuid, p_business uuid, p_month date)
RETURNS TABLE(order_id uuid, client text, phone text, tracking text, delivered_at timestamp with time zone, units integer, commission numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        o.id, o.name, o.phone,
        COALESCE(
            (SELECT cp.tracking_code FROM courier_parcels cp WHERE cp.order_id = o.id AND NULLIF(btrim(cp.tracking_code), '') IS NOT NULL ORDER BY cp.created_at DESC LIMIT 1),
            (SELECT pp.tracking_code FROM company_parcels pp WHERE pp.order_id = o.id AND NULLIF(btrim(pp.tracking_code), '') IS NOT NULL ORDER BY pp.created_at DESC LIMIT 1)
        ),
        COALESCE(o.date_livraison, o.updated_at),
        CASE WHEN COALESCE(u.commission_basis, 'per_order') = 'per_unit'
             THEN sum_order_units_for_seller_products(o.id, o.seller_id)
             ELSE 1 END::integer,
        CASE WHEN COALESCE(u.commission_basis, 'per_order') = 'per_unit'
             THEN COALESCE(u.commission_price, 0) * sum_order_units_for_seller_products(o.id, o.seller_id)::numeric
             ELSE COALESCE(u.commission_price, 0) END
    FROM orders o
        JOIN users u ON u.id = o.seller_id
        JOIN package_statuses ps ON ps.id = o.package_status_id
    WHERE o.seller_id = p_seller
      AND o."DigiCom Business" IS NOT DISTINCT FROM p_business
      AND ps.is_delivered
      AND o.date_deleted IS NULL
      AND o.source_review_status IS DISTINCT FROM 'pending'
      AND COALESCE(o.swap_only, false) = false
      AND date_trunc('month', COALESCE(o.date_livraison, o.updated_at)) = date_trunc('month', p_month::timestamptz)
      AND (auth.uid() = p_seller
           OR (public.current_user_digicom_business_id() = p_business
               AND check_user_role(auth.uid(), ARRAY['super admin','admin'])))
    ORDER BY 5 DESC;
$$;

CREATE OR REPLACE FUNCTION public.mediabuyer_month_orders(p_mb uuid, p_business uuid, p_month date)
RETURNS TABLE(order_id uuid, client text, phone text, tracking text, bucket_date date, source text, delivered_at timestamp with time zone, units integer, commission numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    o.id, o.name, o.phone,
    COALESCE(
      (SELECT cp.tracking_code FROM courier_parcels cp WHERE cp.order_id = o.id AND NULLIF(btrim(cp.tracking_code), '') IS NOT NULL ORDER BY cp.created_at DESC LIMIT 1),
      (SELECT pp.tracking_code FROM company_parcels pp WHERE pp.order_id = o.id AND NULLIF(btrim(pp.tracking_code), '') IS NOT NULL ORDER BY pp.created_at DESC LIMIT 1)
    ),
    (o.date AT TIME ZONE 'Africa/Casablanca')::date,
    lower(o.source_name),
    COALESCE(o.date_livraison, o.updated_at),
    COALESCE((SELECT sum(oi.quantity)::int FROM order_items oi WHERE oi.order_id = o.id), 0),
    COALESCE(u.commission_price, 0)
  FROM orders o
    JOIN users u ON u.id = p_mb
    JOIN package_statuses ps ON ps.id = o.package_status_id
  WHERE o."DigiCom Business" IS NOT DISTINCT FROM p_business
    AND ps.is_delivered
    AND o.date_deleted IS NULL
    AND o.source_review_status IS DISTINCT FROM 'pending'
    AND COALESCE(o.swap_only, false) = false
    AND EXISTS (
      SELECT 1 FROM campaign_daily_entries e
      WHERE e.created_by = p_mb AND e."DigiCom Business" = p_business
        AND date_trunc('month', e.entry_date)::date = date_trunc('month', p_month)::date
        AND e.entry_date = (o.date AT TIME ZONE 'Africa/Casablanca')::date
        AND lower(o.source_name) = CASE lower(e.platform)
            WHEN 'whatsapp ads' THEN 'whatsapp'  WHEN 'messenger ads' THEN 'messenger'
            WHEN 'instagram ads' THEN 'instagram' WHEN 'facebook ads' THEN 'facebook'
            WHEN 'google ads' THEN 'google'       WHEN 'tiktok ads' THEN 'tiktok'
            WHEN 'native ads' THEN 'native'       WHEN 'snapchat ads' THEN 'snapchat'
            WHEN 'twitter ads' THEN 'twitter'     WHEN 'bing ads' THEN 'bing'
            WHEN 'pinterest ads' THEN 'pinterest' WHEN 'reddit ads' THEN 'reddit'
            ELSE '' END
    )
    AND (auth.uid() = p_mb
         OR (public.current_user_digicom_business_id() = p_business
             AND check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  ORDER BY COALESCE(o.date_livraison, o.updated_at) ASC;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- R14 — DB hygiene
-- ════════════════════════════════════════════════════════════════════════
-- Remove latent anon WRITE grants on the storage schema (keep SELECT so
-- public-bucket reads via the REST-exposed storage schema still work).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA storage FROM anon;

-- Cron telemetry is platform-level (no tenant): restrict read to the operator.
DROP POLICY IF EXISTS tracking_sync_runs_read_all_authenticated ON public.tracking_sync_runs;
CREATE POLICY tracking_sync_runs_owner_read ON public.tracking_sync_runs
  FOR SELECT TO authenticated USING ((SELECT is_owner()));

-- order_status_history retention (180 days), weekly.
SELECT cron.schedule(
  'order-status-history-retention-weekly',
  '30 4 * * 0',
  $$DELETE FROM public.order_status_history WHERE created_at < now() - interval '180 days'$$
);

-- Modest idle-in-transaction ceiling on the app roles (kills stuck idle txns;
-- PostgREST never holds an idle-in-transaction backend, so no legit request breaks).
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE anon          SET idle_in_transaction_session_timeout = '60s';

COMMIT;
