-- public.campaign_source_locks (1 policy)
ALTER POLICY "lock_select" ON public.campaign_source_locks
  USING ((("DigiCom Business" = ( SELECT users."DigiCom Business"
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_owner() AS is_owner) OR ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.courier_payment_note_orders (1 policy)
ALTER POLICY "courier_payment_note_orders_admin_write" ON public.courier_payment_note_orders
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(auth.uid(), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(auth.uid(), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.courier_payment_notes (1 policy)
ALTER POLICY "courier_payment_notes_admin_write" ON public.courier_payment_notes
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(auth.uid(), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(auth.uid(), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.google_analytics_connections (3 policies)
ALTER POLICY "ga_connections_delete_own_business" ON public.google_analytics_connections
  USING ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));
ALTER POLICY "ga_connections_insert_own_business" ON public.google_analytics_connections
  WITH CHECK ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));
ALTER POLICY "ga_connections_update_own_business" ON public.google_analytics_connections
  USING ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))))
  WITH CHECK ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));

-- public.mediabuyer_demands (3 policies)
ALTER POLICY "mediabuyer_demands_delete_admin_same_business" ON public.mediabuyer_demands
  USING ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))));
ALTER POLICY "mediabuyer_demands_select_scoped" ON public.mediabuyer_demands
  USING (((mediabuyer_id = ( SELECT auth.uid() AS uid)) OR (( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)))));
ALTER POLICY "mediabuyer_demands_update_admin_same_business" ON public.mediabuyer_demands
  USING ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))))
  WITH CHECK ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))));

-- public.mediabuyer_ga_access (1 policy)
ALTER POLICY "mb_ga_access_select" ON public.mediabuyer_ga_access
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = mediabuyer_ga_access.business_id))))));

-- public.mediabuyer_meta_access (1 policy)
ALTER POLICY "mb_meta_access_select" ON public.mediabuyer_meta_access
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = mediabuyer_meta_access.business_id))))));

-- public.mediabuyer_payment_txns (4 policies)
ALTER POLICY "mediabuyer_payment_txns_select" ON public.mediabuyer_payment_txns
  USING (((EXISTS ( SELECT 1
   FROM mediabuyer_payments mp
  WHERE ((mp.id = mediabuyer_payment_txns.mediabuyer_payment_id) AND (mp.mediabuyer_id = ( SELECT auth.uid() AS uid))))) OR (("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role))));
ALTER POLICY "mediabuyer_payment_txns_tenant_delete" ON public.mediabuyer_payment_txns
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "mediabuyer_payment_txns_tenant_insert" ON public.mediabuyer_payment_txns
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "mediabuyer_payment_txns_tenant_update" ON public.mediabuyer_payment_txns
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.mediabuyer_payments (4 policies)
ALTER POLICY "mediabuyer_payments_delete_admin" ON public.mediabuyer_payments
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "mediabuyer_payments_insert_admin" ON public.mediabuyer_payments
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "mediabuyer_payments_select_scoped" ON public.mediabuyer_payments
  USING (((mediabuyer_id = ( SELECT auth.uid() AS uid)) OR (("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role))));
ALTER POLICY "mediabuyer_payments_update_admin" ON public.mediabuyer_payments
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.meta_ads_connections (3 policies)
ALTER POLICY "meta_ads_connections_delete_own_business" ON public.meta_ads_connections
  USING ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));
ALTER POLICY "meta_ads_connections_insert_own_business" ON public.meta_ads_connections
  WITH CHECK ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));
ALTER POLICY "meta_ads_connections_update_own_business" ON public.meta_ads_connections
  USING ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))))
  WITH CHECK ((( SELECT is_owner() AS is_owner) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text, 'business owner'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));

-- public.seller_demands (3 policies)
ALTER POLICY "seller_demands_delete_admin_same_business" ON public.seller_demands
  USING ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))));
ALTER POLICY "seller_demands_select_scoped" ON public.seller_demands
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR (( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)))));
ALTER POLICY "seller_demands_update_admin_same_business" ON public.seller_demands
  USING ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))))
  WITH CHECK ((( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AS check_user_role) AND ("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id))));

-- public.seller_payment_txns (4 policies)
ALTER POLICY "seller_payment_txns_select" ON public.seller_payment_txns
  USING (((EXISTS ( SELECT 1
   FROM seller_payments sp
  WHERE ((sp.id = seller_payment_txns.seller_payment_id) AND (sp.seller_id = ( SELECT auth.uid() AS uid))))) OR (("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role))));
ALTER POLICY "seller_payment_txns_tenant_delete" ON public.seller_payment_txns
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "seller_payment_txns_tenant_insert" ON public.seller_payment_txns
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "seller_payment_txns_tenant_update" ON public.seller_payment_txns
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.seller_payments (4 policies)
ALTER POLICY "seller_payments_delete_admin" ON public.seller_payments
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "seller_payments_insert_admin" ON public.seller_payments
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "seller_payments_select_scoped" ON public.seller_payments
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR (("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role))));
ALTER POLICY "seller_payments_update_admin" ON public.seller_payments
  USING ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK ((("DigiCom Business" = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.user_invitations (2 policies)
ALTER POLICY "user_invitations_admin_revoke" ON public.user_invitations
  USING (((business_id = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role) AND (consumed_at IS NULL) AND (revoked_at IS NULL)))
  WITH CHECK (((business_id = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));
ALTER POLICY "user_invitations_admin_select" ON public.user_invitations
  USING (((business_id = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- public.users (3 policies)
ALTER POLICY "Admins can delete users" ON public.users
  USING (( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role));
ALTER POLICY "Admins can insert users" ON public.users
  WITH CHECK (( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role));
ALTER POLICY "Users can update themselves or admins can update anyone" ON public.users
  USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)))
  WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text]) AS check_user_role)));

-- storage.objects (6 policies)
ALTER POLICY "demand_media_delete_scoped" ON storage.objects
  USING (((bucket_id = 'demand-media'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (check_user_role(auth.uid(), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE (((u.id)::text = (storage.foldername(objects.name))[1]) AND (u."DigiCom Business" = current_user_digicom_business_id()))))) OR (((storage.foldername(name))[1] = 'responses'::text) AND check_user_role(auth.uid(), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AND (EXISTS ( SELECT 1
   FROM seller_demands sd
  WHERE (((sd.id)::text = (storage.foldername(objects.name))[2]) AND (sd."DigiCom Business" = current_user_digicom_business_id()))))))));
ALTER POLICY "demand_media_insert_scoped" ON storage.objects
  WITH CHECK (((bucket_id = 'demand-media'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (((storage.foldername(name))[1] = 'responses'::text) AND check_user_role(auth.uid(), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AND (EXISTS ( SELECT 1
   FROM seller_demands sd
  WHERE (((sd.id)::text = (storage.foldername(objects.name))[2]) AND (sd."DigiCom Business" = current_user_digicom_business_id()))))))));
ALTER POLICY "demand_media_select_scoped" ON storage.objects
  USING (((bucket_id = 'demand-media'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (check_user_role(auth.uid(), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE (((u.id)::text = (storage.foldername(objects.name))[1]) AND (u."DigiCom Business" = current_user_digicom_business_id()))))) OR (((storage.foldername(name))[1] = 'responses'::text) AND (EXISTS ( SELECT 1
   FROM seller_demands sd
  WHERE (((sd.id)::text = (storage.foldername(objects.name))[2]) AND ((sd.seller_id = auth.uid()) OR (check_user_role(auth.uid(), ARRAY['admin'::text, 'super admin'::text, 'owner'::text, 'business owner'::text]) AND (sd."DigiCom Business" = current_user_digicom_business_id()))))))))));
ALTER POLICY "stamps_delete_business_admins" ON storage.objects
  USING (((bucket_id = 'business-stamps'::text) AND (name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'::text) AND (( SELECT is_owner() AS is_owner) OR (((split_part(name, '/'::text, 2))::uuid = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text])))));
ALTER POLICY "stamps_update_business_admins" ON storage.objects
  USING (((bucket_id = 'business-stamps'::text) AND (name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'::text) AND (( SELECT is_owner() AS is_owner) OR (((split_part(name, '/'::text, 2))::uuid = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text])))));
ALTER POLICY "stamps_write_business_admins" ON storage.objects
  WITH CHECK (((bucket_id = 'business-stamps'::text) AND (name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'::text) AND (( SELECT is_owner() AS is_owner) OR (((split_part(name, '/'::text, 2))::uuid = ( SELECT current_user_digicom_business_id() AS current_user_digicom_business_id)) AND check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text, 'business owner'::text])))));
