-- RLS PERF (rls optimization 2026-06-29, part 1/?): hoist session-constant function calls
-- in RLS policies into scalar sub-selects so they evaluate ONCE per query (InitPlan) instead of
-- per row. Behavior-preserving: (select f()) returns the identical scalar as f(); only evaluation
-- count changes. Covers the 34 advisor auth_rls_initplan WARNs PLUS the ~50 advisor-invisible bare
-- helper call-sites (is_owner / current_user_digicom_business_id / check_user_role) that re-scan
-- public.users per row (the 45M-seq-scan source).
--
-- PREREQUISITE: check_user_role is marked STABLE. It is read-only (EXISTS SELECT on users); STABLE
-- is the correct volatility and is REQUIRED for (select check_user_role(...)) to fold into a single
-- InitPlan (a VOLATILE function in a sublink is re-evaluated per row, defeating the wrap).
--
-- mb_ga_allowed(conn)/mb_meta_allowed(conn) are intentionally NOT wrapped: their argument is the
-- scanned ROW's id (row-correlated), so they cannot hoist to a single eval.
--
-- Rollback: ALTER FUNCTION check_user_role ... VOLATILE; and ALTER POLICY each back to the un-wrapped expr.

ALTER FUNCTION public.check_user_role(uuid, text[]) STABLE;


-- bons_commande
ALTER POLICY "bons_commande_delete" ON public.bons_commande
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_commande.business_id)))));
ALTER POLICY "bons_commande_insert" ON public.bons_commande
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_commande.business_id)))));
ALTER POLICY "bons_commande_select" ON public.bons_commande
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_commande.business_id)))));
ALTER POLICY "bons_commande_update" ON public.bons_commande
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_commande.business_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_commande.business_id)))));

-- bons_livraison
ALTER POLICY "bons_livraison_delete" ON public.bons_livraison
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_livraison.business_id)))));
ALTER POLICY "bons_livraison_insert" ON public.bons_livraison
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_livraison.business_id)))));
ALTER POLICY "bons_livraison_select" ON public.bons_livraison
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_livraison.business_id)))));
ALTER POLICY "bons_livraison_update" ON public.bons_livraison
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_livraison.business_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = bons_livraison.business_id)))));

-- businesses
ALTER POLICY "businesses_tenant_select" ON public.businesses
  USING (((id = (select current_user_digicom_business_id())) OR (select is_owner())));

-- campaign_source_locks
ALTER POLICY "lock_select" ON public.campaign_source_locks
  USING ((("DigiCom Business" = ( SELECT users."DigiCom Business"
   FROM users
  WHERE (users.id = (select auth.uid())))) OR (select is_owner()) OR (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));

-- channel_aliases
ALTER POLICY "channel_aliases_tenant_all" ON public.channel_aliases
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- company_parcels
ALTER POLICY "company_parcels_tenant_all" ON public.company_parcels
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- courier_parcels
ALTER POLICY "courier_parcels_tenant_all" ON public.courier_parcels
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- courier_payment_note_orders
ALTER POLICY "courier_payment_note_orders_ins" ON public.courier_payment_note_orders
  WITH CHECK ((("DigiCom Business" IS NOT NULL) AND ("DigiCom Business" = ( SELECT users."DigiCom Business"
   FROM users
  WHERE (users.id = (select auth.uid()))))));

-- courier_payment_notes
ALTER POLICY "courier_payment_notes_ins" ON public.courier_payment_notes
  WITH CHECK ((("DigiCom Business" IS NOT NULL) AND ("DigiCom Business" = ( SELECT users."DigiCom Business"
   FROM users
  WHERE (users.id = (select auth.uid()))))));

-- devis
ALTER POLICY "devis_delete" ON public.devis
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = devis.business_id)))));
ALTER POLICY "devis_insert" ON public.devis
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = devis.business_id)))));
ALTER POLICY "devis_select" ON public.devis
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = devis.business_id)))));
ALTER POLICY "devis_update" ON public.devis
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = devis.business_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = devis.business_id)))));

-- email_accounts
ALTER POLICY "email_accounts_owner_select" ON public.email_accounts
  USING ((select is_owner()));

-- email_log
ALTER POLICY "email_log_owner_select" ON public.email_log
  USING ((select is_owner()));

-- email_templates
ALTER POLICY "email_templates_owner_all" ON public.email_templates
  USING ((select is_owner()))
  WITH CHECK ((select is_owner()));

-- factures
ALTER POLICY "factures_delete" ON public.factures
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = factures.business_id)))));
ALTER POLICY "factures_insert" ON public.factures
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = factures.business_id)))));
ALTER POLICY "factures_select" ON public.factures
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = factures.business_id)))));
ALTER POLICY "factures_update" ON public.factures
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = factures.business_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND (u."DigiCom Business" = factures.business_id)))));

-- google_analytics_connections
ALTER POLICY "ga_connections_delete_own_business" ON public.google_analytics_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));
ALTER POLICY "ga_connections_insert_own_business" ON public.google_analytics_connections
  WITH CHECK (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));
ALTER POLICY "ga_connections_select_own_business" ON public.google_analytics_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business") AND (((u.role)::text <> 'mediabuyer'::text) OR mb_ga_allowed(google_analytics_connections.id)))))));
ALTER POLICY "ga_connections_update_own_business" ON public.google_analytics_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))))
  WITH CHECK (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = google_analytics_connections."DigiCom Business"))))));

-- mediabuyer_ga_access
ALTER POLICY "mb_ga_access_select" ON public.mediabuyer_ga_access
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = mediabuyer_ga_access.business_id))))));

-- mediabuyer_meta_access
ALTER POLICY "mb_meta_access_select" ON public.mediabuyer_meta_access
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR (select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = mediabuyer_meta_access.business_id))))));

-- mediabuyer_payment_txns
ALTER POLICY "mediabuyer_payment_txns_tenant_delete" ON public.mediabuyer_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "mediabuyer_payment_txns_tenant_insert" ON public.mediabuyer_payment_txns
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "mediabuyer_payment_txns_tenant_select" ON public.mediabuyer_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "mediabuyer_payment_txns_tenant_update" ON public.mediabuyer_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))))
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));

-- mediabuyer_payments
ALTER POLICY "mediabuyer_payments_delete_admin" ON public.mediabuyer_payments
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "mediabuyer_payments_insert_admin" ON public.mediabuyer_payments
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "mediabuyer_payments_select_scoped" ON public.mediabuyer_payments
  USING (((mediabuyer_id = ( SELECT auth.uid() AS uid)) OR (("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text])))));
ALTER POLICY "mediabuyer_payments_update_admin" ON public.mediabuyer_payments
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))))
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));

-- meta_ads_connections
ALTER POLICY "meta_ads_connections_delete_own_business" ON public.meta_ads_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));
ALTER POLICY "meta_ads_connections_insert_own_business" ON public.meta_ads_connections
  WITH CHECK (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));
ALTER POLICY "meta_ads_connections_select_own_business" ON public.meta_ads_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business") AND (((u.role)::text <> 'mediabuyer'::text) OR mb_meta_allowed(meta_ads_connections.id)))))));
ALTER POLICY "meta_ads_connections_update_own_business" ON public.meta_ads_connections
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))))
  WITH CHECK (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.role)::text = ANY (ARRAY['admin'::text, 'super admin'::text])) AND (u."DigiCom Business" = meta_ads_connections."DigiCom Business"))))));

-- orders
ALTER POLICY "orders_tenant_delete" ON public.orders
  USING (("DigiCom Business" = (select current_user_digicom_business_id())));
ALTER POLICY "orders_tenant_insert" ON public.orders
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));
ALTER POLICY "orders_tenant_select" ON public.orders
  USING (("DigiCom Business" = (select current_user_digicom_business_id())));
ALTER POLICY "orders_tenant_update" ON public.orders
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- provider_webhooks
ALTER POLICY "provider_webhooks_tenant_all" ON public.provider_webhooks
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- providers
ALTER POLICY "providers_delete_own_business" ON public.providers
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me."DigiCom Business" = providers."DigiCom Business"))))));
ALTER POLICY "providers_select_own_business" ON public.providers
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me."DigiCom Business" = providers."DigiCom Business"))))));
ALTER POLICY "providers_update_own_business" ON public.providers
  USING (((select is_owner()) OR (EXISTS ( SELECT 1
   FROM users me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me."DigiCom Business" = providers."DigiCom Business"))))));

-- seller_demands
ALTER POLICY "seller_demands_delete_admin_same_business" ON public.seller_demands
  USING (((select check_user_role((select auth.uid()), ARRAY['admin'::text, 'super admin'::text, 'owner'::text])) AND ("DigiCom Business" = (select current_user_digicom_business_id()))));
ALTER POLICY "seller_demands_insert_self" ON public.seller_demands
  WITH CHECK ((seller_id = (select auth.uid())));
ALTER POLICY "seller_demands_select_scoped" ON public.seller_demands
  USING (((seller_id = (select auth.uid())) OR ((select check_user_role((select auth.uid()), ARRAY['admin'::text, 'super admin'::text, 'owner'::text])) AND ("DigiCom Business" = (select current_user_digicom_business_id())))));
ALTER POLICY "seller_demands_update_admin_same_business" ON public.seller_demands
  USING (((select check_user_role((select auth.uid()), ARRAY['admin'::text, 'super admin'::text, 'owner'::text])) AND ("DigiCom Business" = (select current_user_digicom_business_id()))))
  WITH CHECK (((select check_user_role((select auth.uid()), ARRAY['admin'::text, 'super admin'::text, 'owner'::text])) AND ("DigiCom Business" = (select current_user_digicom_business_id()))));

-- seller_payment_txns
ALTER POLICY "seller_payment_txns_tenant_delete" ON public.seller_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "seller_payment_txns_tenant_insert" ON public.seller_payment_txns
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "seller_payment_txns_tenant_select" ON public.seller_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "seller_payment_txns_tenant_update" ON public.seller_payment_txns
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))))
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));

-- seller_payments
ALTER POLICY "seller_payments_delete_admin" ON public.seller_payments
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "seller_payments_insert_admin" ON public.seller_payments
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "seller_payments_select_scoped" ON public.seller_payments
  USING (((seller_id = ( SELECT auth.uid() AS uid)) OR (("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text])))));
ALTER POLICY "seller_payments_update_admin" ON public.seller_payments
  USING ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))))
  WITH CHECK ((("DigiCom Business" = (select current_user_digicom_business_id())) AND (select check_user_role(( SELECT auth.uid() AS uid), ARRAY['super admin'::text, 'admin'::text]))));

-- sheet_ingest_rows
ALTER POLICY "sheet_ingest_rows_tenant_all" ON public.sheet_ingest_rows
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));

-- user_invitations
ALTER POLICY "user_invitations_admin_select" ON public.user_invitations
  USING (((business_id = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));
ALTER POLICY "user_invitations_admin_revoke" ON public.user_invitations
  USING (((business_id = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text])) AND (consumed_at IS NULL) AND (revoked_at IS NULL)))
  WITH CHECK (((business_id = (select current_user_digicom_business_id())) AND (select check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]))));

-- users
ALTER POLICY "users_tenant_select" ON public.users
  USING (((id = (select auth.uid())) OR ("DigiCom Business" = (select current_user_digicom_business_id())) OR (select is_owner())));
ALTER POLICY "Users can update themselves or admins can update anyone" ON public.users
  USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]) AS check_user_role)))
  WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT check_user_role((select auth.uid()), ARRAY['super admin'::text, 'admin'::text]) AS check_user_role)));

-- webhook_logs
ALTER POLICY "webhook_logs_tenant_all" ON public.webhook_logs
  USING (("DigiCom Business" = (select current_user_digicom_business_id())))
  WITH CHECK (("DigiCom Business" = (select current_user_digicom_business_id())));
