-- ============================================================================
-- RLS tenant-scoping: status pipeline + users/businesses PII  (Security batch 1)
-- ----------------------------------------------------------------------------
-- Closes C1/C2 from the 2026-06 pipeline audit:
--   * Any authenticated user of ANY tenant could read/write EVERY tenant's
--     orders, company_parcels, courier_parcels, webhook_logs and
--     provider_webhooks (the last exposing webhook_secret -> webhook forgery).
--   * public.users SELECT ("Profiles are viewable by everyone") and
--     public.businesses SELECT ("Allow authenticated read") leaked cross-tenant
--     PII (bank RIB, CIN, salary, ICE/RC fiscal IDs) to any authenticated user
--     (users was readable by anon too).
--
-- Model: strict per-tenant via public.current_user_digicom_business_id().
-- Owners (role='owner', "DigiCom Business" IS NULL until they pick a business)
-- intentionally see nothing on the 5 status tables until selection (confirmed
-- with product owner). Owners retain cross-tenant visibility ONLY where the
-- product needs it: the business picker and owner consoles (is_owner()).
--
-- Verified on prod before authoring (2026-06-02):
--   * service_role.rolbypassrls = true  -> ALL edge-function ingestion
--     (provider-webhook, *-poll-webhook, provider-integration, ai-review-act)
--     bypasses RLS and is UNAFFECTED by these TO authenticated policies.
--   * authenticated / anon do NOT bypass RLS -> these policies govern them.
--   * 0 NULL "DigiCom Business" rows on orders / company_parcels /
--     courier_parcels / webhook_logs / provider_webhooks / businesses
--     -> equality predicate orphans no legitimate row.
--   * Helpers re-declared CREATE OR REPLACE (identical to live bodies) so the
--     migration is self-contained and applies cleanly on a fresh branch.
--
-- Scope guard: this migration ONLY swaps the OPEN SELECT / ALL visibility
-- policies. The already role-gated WRITE policies on users (check_user_role)
-- and businesses (creator_id / is_owner) are LEFT INTACT.
-- NOTE: webhook_secret column-level REVOKE is intentionally NOT done here — it
-- must ship together with the Webhooks.tsx narrowed-select to avoid 500ing the
-- admin page (tracked as a separate coordinated change).
-- ============================================================================

-- 1) Tenant + owner helpers (self-contained; bodies identical to live) --------
CREATE OR REPLACE FUNCTION public.current_user_digicom_business_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u."DigiCom Business"
  FROM public.users u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_user_digicom_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_digicom_business_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'owner'
  );
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

-- 2) orders: 4 open per-command policies -> tenant-scoped ---------------------
DROP POLICY IF EXISTS "Allow authenticated users to read orders"   ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated users to insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated users to update orders" ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated users to delete orders" ON public.orders;

CREATE POLICY orders_tenant_select ON public.orders FOR SELECT TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id());
CREATE POLICY orders_tenant_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());
CREATE POLICY orders_tenant_update ON public.orders FOR UPDATE TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id())
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());
CREATE POLICY orders_tenant_delete ON public.orders FOR DELETE TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id());

-- 3) company_parcels / courier_parcels / provider_webhooks / webhook_logs -----
--    (each had a single open ALL policy -> single tenant-scoped ALL policy)
DROP POLICY IF EXISTS "Authenticated users can manage company parcels" ON public.company_parcels;
CREATE POLICY company_parcels_tenant_all ON public.company_parcels FOR ALL TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id())
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());

DROP POLICY IF EXISTS "Authenticated users can manage courier parcels" ON public.courier_parcels;
CREATE POLICY courier_parcels_tenant_all ON public.courier_parcels FOR ALL TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id())
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());

DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.provider_webhooks;
CREATE POLICY provider_webhooks_tenant_all ON public.provider_webhooks FOR ALL TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id())
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());

DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.webhook_logs;
CREATE POLICY webhook_logs_tenant_all ON public.webhook_logs FOR ALL TO authenticated
  USING ("DigiCom Business" = public.current_user_digicom_business_id())
  WITH CHECK ("DigiCom Business" = public.current_user_digicom_business_id());

-- 4) users SELECT: same-tenant + self + owner (writes already role-gated) -----
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.users;
CREATE POLICY users_tenant_select ON public.users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR "DigiCom Business" = public.current_user_digicom_business_id()
    OR public.is_owner()
  );

-- 5) businesses SELECT: own business + owner (picker / owner consoles) ---------
DROP POLICY IF EXISTS "Allow authenticated read" ON public.businesses;
CREATE POLICY businesses_tenant_select ON public.businesses FOR SELECT TO authenticated
  USING (
    id = public.current_user_digicom_business_id()
    OR public.is_owner()
  );
