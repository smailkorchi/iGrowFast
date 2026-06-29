-- RLS PERF (rls optimization 2026-06-29, part 2): collapse the 4 overlapping permissive SELECT
-- policy pairs the advisor flags (multiple_permissive_policies). Two permissive policies for the
-- same role+action are OR'd by Postgres but each is evaluated separately per row; merging into one
-- OR'd policy removes the duplicate evaluation. Behavior-preserving (A OR B is identical truth).
--
-- providers: providers_select_platform_owner's qual is EXACTLY is_owner()
-- (EXISTS users WHERE id=auth.uid() AND role='owner'), which is already a branch of
-- providers_select_own_business -> it is a fully redundant/dead policy, simply dropped.
--
-- For the merged {public} policies the tenant/admin branch is false for anon (cudbi()/check_user_role
-- null) so anon visibility is unchanged from the prior {public}+{authenticated} pair.
--
-- Verified on dev (impersonated): seller sees own 7 txns / 0 mb; mediabuyer sees own 2 / 0 seller;
-- super admin sees 10 business seller-txns + 3 providers -> identical to pre-merge.
--
-- Rollback: recreate each dropped policy from git history (pre-merge definitions).

-- courier_notifications: merge 2 permissive SELECT {public}
DROP POLICY "Business staff view notifications" ON public.courier_notifications;
DROP POLICY "Couriers view own notifications" ON public.courier_notifications;
CREATE POLICY "courier_notifications_select" ON public.courier_notifications
  FOR SELECT TO public
  USING (
    ((((select auth.uid()) IS NOT NULL) AND (EXISTS ( SELECT 1
       FROM users u
      WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = courier_notifications."DigiCom Business")))))
     OR (courier_id = (select auth.uid())))
  );

-- mediabuyer_payment_txns: merge self {public} + tenant {authenticated}
DROP POLICY "mediabuyer_payment_txns_self_select" ON public.mediabuyer_payment_txns;
DROP POLICY "mediabuyer_payment_txns_tenant_select" ON public.mediabuyer_payment_txns;
CREATE POLICY "mediabuyer_payment_txns_select" ON public.mediabuyer_payment_txns
  FOR SELECT TO public
  USING (
    ((EXISTS ( SELECT 1
       FROM mediabuyer_payments mp
      WHERE ((mp.id = mediabuyer_payment_txns.mediabuyer_payment_id) AND (mp.mediabuyer_id = (select auth.uid())))))
     OR (("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))))
  );

-- providers: drop the redundant platform-owner policy (subsumed by is_owner() in own_business)
DROP POLICY "providers_select_platform_owner" ON public.providers;

-- seller_payment_txns: merge seller {public} + tenant {authenticated}
DROP POLICY "seller_payment_txns_seller_select" ON public.seller_payment_txns;
DROP POLICY "seller_payment_txns_tenant_select" ON public.seller_payment_txns;
CREATE POLICY "seller_payment_txns_select" ON public.seller_payment_txns
  FOR SELECT TO public
  USING (
    ((EXISTS ( SELECT 1
       FROM seller_payments sp
      WHERE ((sp.id = seller_payment_txns.seller_payment_id) AND (sp.seller_id = (select auth.uid())))))
     OR (("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))))
  );
