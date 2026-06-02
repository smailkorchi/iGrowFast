-- ============================================================================
-- Security batch 1b: tenant-scope public.seller_payment_txns +
-- public.mediabuyer_payment_txns (advisor: rls_policy_always_true).
-- ----------------------------------------------------------------------------
-- Granularity: TENANT + ADMIN-CLASS. Neither txn table has a collaborator
-- (seller_id/mediabuyer_id) column — identity lives on the parent payment;
-- created_by is the recording admin (NULL on 8/13 + 3/3 rows). So self-scoping
-- is impossible and unnecessary: the ONLY authenticated reader/writer is
-- super admin/owner via the admin-only Salaries route (App.tsx allowedRoles
-- ['super admin','admin','owner']). Predicate mirrors batch 1 + the is_owner()
-- cross-tenant branch (owner has NULL business, administers payouts).
-- Verified on prod (2026-06-02): 0 NULL "DigiCom Business", 0 parent-tenant
-- mismatch across all 16 rows; service_role bypasses RLS (ingestion N/A here).
-- Proven via rolled-back simulation: super-admin sees own tenant only
-- (11/2, 0 foreign), owner sees all (13/3), commercial denied (0/0).
-- Seller balances unaffected: refresh_seller_payment_balance() is SECURITY
-- DEFINER and reads txns as definer.
-- RESIDUAL (next batch): parent seller_payments / mediabuyer_payments are still
-- open cross-tenant; sellers read seller_payments directly.
-- ============================================================================

-- ---------- seller_payment_txns ----------
DROP POLICY IF EXISTS "Allow authenticated read seller_payment_txns"   ON public.seller_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated insert seller_payment_txns" ON public.seller_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated update seller_payment_txns" ON public.seller_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated delete seller_payment_txns" ON public.seller_payment_txns;

CREATE POLICY seller_payment_txns_tenant_select ON public.seller_payment_txns FOR SELECT TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY seller_payment_txns_tenant_insert ON public.seller_payment_txns FOR INSERT TO authenticated
  WITH CHECK (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY seller_payment_txns_tenant_update ON public.seller_payment_txns FOR UPDATE TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  WITH CHECK (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY seller_payment_txns_tenant_delete ON public.seller_payment_txns FOR DELETE TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));

-- ---------- mediabuyer_payment_txns ----------
DROP POLICY IF EXISTS "Allow authenticated read mediabuyer_payment_txns"   ON public.mediabuyer_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated insert mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated update mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;
DROP POLICY IF EXISTS "Allow authenticated delete mediabuyer_payment_txns" ON public.mediabuyer_payment_txns;

CREATE POLICY mediabuyer_payment_txns_tenant_select ON public.mediabuyer_payment_txns FOR SELECT TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY mediabuyer_payment_txns_tenant_insert ON public.mediabuyer_payment_txns FOR INSERT TO authenticated
  WITH CHECK (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY mediabuyer_payment_txns_tenant_update ON public.mediabuyer_payment_txns FOR UPDATE TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])))
  WITH CHECK (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
CREATE POLICY mediabuyer_payment_txns_tenant_delete ON public.mediabuyer_payment_txns FOR DELETE TO authenticated
  USING (public.is_owner() OR ("DigiCom Business" = public.current_user_digicom_business_id()
         AND public.check_user_role(auth.uid(), ARRAY['super admin','admin'])));
