-- ============================================================================
-- Security batch 1c: scope parent payout tables public.seller_payments +
-- public.mediabuyer_payments (were cross-tenant open; read DIRECTLY by
-- collaborators, so SELF-scoping is required, unlike the txn children).
-- ----------------------------------------------------------------------------
-- SELECT: collaborator self (seller_id / mediabuyer_id = auth.uid())
--         OR same-tenant admin-class ("DigiCom Business" = current_user_digicom_business_id()
--            AND check_user_role(auth.uid(), ARRAY['super admin','admin']))
--         OR is_owner() (cross-tenant).
-- INSERT/UPDATE/DELETE: tenant admin-class OR is_owner() — NO self-branch
--   (collaborators must never write their own payout rows; only admin Salaries writes).
-- Verified on prod (2026-06-02): seller_payments=9 / mediabuyer_payments=3,
--   0 NULL tenant, 0 NULL collaborator, 0 collaborator/tenant mismatch -> strict
--   predicate orphans nothing. Proven via rolled-back simulation: seller sees ONLY
--   own (6 / 2, 0 peer leak), super-admin whole tenant (7 / 2, 0 foreign), owner all.
-- Balance recompute safe: refresh_*_payment_balance() (on the txn children) are
--   SECURITY DEFINER and bypass parent RLS; audit_row_change is SECURITY DEFINER.
-- service_role.rolbypassrls=true -> edge functions unaffected.
-- CAVEAT: seller_payments."DigiCom Business" is NULLABLE; Salaries.tsx always sets
--   it. A future tenant-less INSERT would be visible only to that seller + owner.
-- ============================================================================

ALTER TABLE public.seller_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can select seller_payments" ON public.seller_payments;
DROP POLICY IF EXISTS "Authenticated users can insert seller_payments" ON public.seller_payments;
DROP POLICY IF EXISTS "Authenticated users can update seller_payments" ON public.seller_payments;
DROP POLICY IF EXISTS "Authenticated users can delete seller_payments" ON public.seller_payments;

CREATE POLICY seller_payments_select_scoped ON public.seller_payments FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid())
    OR ("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin']))
    OR public.is_owner());
CREATE POLICY seller_payments_insert_admin ON public.seller_payments FOR INSERT TO authenticated
  WITH CHECK (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());
CREATE POLICY seller_payments_update_admin ON public.seller_payments FOR UPDATE TO authenticated
  USING (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner())
  WITH CHECK (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());
CREATE POLICY seller_payments_delete_admin ON public.seller_payments FOR DELETE TO authenticated
  USING (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());

ALTER TABLE public.mediabuyer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.mediabuyer_payments;

CREATE POLICY mediabuyer_payments_select_scoped ON public.mediabuyer_payments FOR SELECT TO authenticated
  USING (mediabuyer_id = (SELECT auth.uid())
    OR ("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin']))
    OR public.is_owner());
CREATE POLICY mediabuyer_payments_insert_admin ON public.mediabuyer_payments FOR INSERT TO authenticated
  WITH CHECK (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());
CREATE POLICY mediabuyer_payments_update_admin ON public.mediabuyer_payments FOR UPDATE TO authenticated
  USING (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner())
  WITH CHECK (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());
CREATE POLICY mediabuyer_payments_delete_admin ON public.mediabuyer_payments FOR DELETE TO authenticated
  USING (("DigiCom Business" = public.current_user_digicom_business_id() AND public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin'])) OR public.is_owner());
