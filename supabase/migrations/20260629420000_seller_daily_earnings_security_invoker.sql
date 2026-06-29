-- SECURITY (advisor security_definer_view ERROR): public.seller_daily_earnings is a view owned by
-- postgres with SELECT granted to `authenticated` and NO internal tenant/seller filter. As a
-- non-security_invoker view it accesses orders/users with the view owner's rights, BYPASSING RLS, so
-- any authenticated user reads every business's seller commissions.
-- Verified on dev: a different-business super admin saw 107 rows of another business's earnings via
-- the view; after the fix the same user sees 0 cross-business rows (only their own 21).
--
-- FIX: security_invoker = on -> the view runs with the QUERYING user's privileges and RLS, so
-- orders RLS (orders_tenant_select: "DigiCom Business" = current_user_digicom_business_id()) scopes
-- the result to the caller's own business. Safe: authenticated has SELECT on
-- orders/users/package_statuses/order_items; package_statuses RLS allows all authenticated; the
-- embedded sum_order_units_for_seller_products is SECURITY INVOKER reading only rows in the caller's
-- RLS scope. No app breakage (the frontend already scopes by its own business + seller_id).
--
-- Rollback: ALTER VIEW public.seller_daily_earnings SET (security_invoker = off);

ALTER VIEW public.seller_daily_earnings SET (security_invoker = on);
