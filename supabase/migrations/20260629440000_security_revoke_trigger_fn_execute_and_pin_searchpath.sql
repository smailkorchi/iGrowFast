-- SECURITY (advisor: anon/authenticated_security_definer_function_executable + function_search_path_mutable)
--
-- Bucket A — 16 SECURITY DEFINER *trigger* functions (return type `trigger`) were callable as RPC by
-- anon/authenticated via /rest/v1/rpc/<fn>. They are only ever invoked by row triggers; the app never
-- calls them as RPC (verified by grep across src/ + edge functions). A trigger function fires through
-- the trigger mechanism INDEPENDENTLY of EXECUTE privilege, so revoking EXECUTE removes the RPC attack
-- surface with zero functional impact. Verified on dev: an authenticated UPDATE on orders still fires
-- its triggers (trg_sync_customer_from_orders, auto_log_order_status_change) with no permission error.
-- The EXECUTE grant is held via PUBLIC, so it must be revoked FROM PUBLIC (revoking only anon/
-- authenticated is a no-op). service_role keeps its own explicit grant (not advisor-flagged, unused
-- for trigger firing).
--
-- Bucket B — 3 non-SECDEF IMMUTABLE helpers (_sheet_pick/_sheet_default_map/mb_source_norm) had a
-- mutable search_path. They use only built-ins (pg_catalog, always resolvable) and no public objects,
-- so pinning search_path = '' is safe and clears the warning.
--
-- Rollback: GRANT EXECUTE ON FUNCTION <fn> TO PUBLIC;  /  ALTER FUNCTION <fn> RESET search_path;

-- Bucket B: pin search_path
ALTER FUNCTION public._sheet_default_map() SET search_path = '';
ALTER FUNCTION public._sheet_pick(jsonb, jsonb) SET search_path = '';
ALTER FUNCTION public.mb_source_norm(text) SET search_path = '';

-- Bucket A: revoke RPC EXECUTE on trigger functions (triggers still fire); grant is via PUBLIC
REVOKE EXECUTE ON FUNCTION public.auto_create_vitex_webhook() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_log_order_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_courier_notification_push() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_courier_on_note_finalization() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_exchange_link() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_courier_parcel_delivered_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_order_date_livraison_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_order_item_product_cost_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_order_unpaid_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_seller_demand_business() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_company_parcel_status_to_order() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_courier_parcel_status_to_order() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_cleanup_meta_ads_connection_vault() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_campaign_lock_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_campaign_lock_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_customer_from_orders() FROM PUBLIC, anon, authenticated;
