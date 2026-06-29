-- SECURITY (T6-SEC, db-function sweep 2026-06-29): final revoke batch for the remaining anon-reachable
-- SECDEF RPCs. Pure grant changes, no body/logic change. (#7 ingest, #8 pollers, #10 purge, #11
-- delivery-note RPCs, #12 internal helpers.)
--
-- GROUP A — revoke anon + authenticated + PUBLIC (no frontend/authed caller; cron / edge-service / trigger only):
--   ingest_sheet_rows            -- edge sheets-sync calls it via the SERVICE_ROLE client
--   invoke_ozon_poll / invoke_quicklivraison_poll / invoke_sheets_poll / invoke_vitex_poll
--                                -- cron-only (run as postgres); read the vault service key -> were an
--                                --   anon unauthorized-trigger / edge-cost DoS surface
--   purge_soft_deleted_orders    -- cron-only (run as postgres); was anon cross-tenant cascading delete
--   refresh_customer_from_orders -- trigger-internal (trg_sync_customer_from_orders, SECDEF/postgres)
--   mb_sync_source_lock          -- trigger-internal (trg_campaign_lock_sync, SECDEF/postgres)
--
-- GROUP B — revoke anon + PUBLIC, KEEP authenticated (frontend admin/seller RPCs):
--   link_company_parcels_to_delivery_note / link_courier_parcels_to_delivery_note
--   remove_company_parcel_from_delivery_note / remove_courier_parcel_from_delivery_note
--   delete_open_company_delivery_note / delete_open_courier_delivery_note
--
-- All callers verified (grep src/ + supabase/functions/). postgres + service_role retain EXECUTE
-- everywhere, so crons/triggers/edge-service paths are unaffected. Non-breaking.
-- Rollback: GRANT EXECUTE ON FUNCTION <sig> TO anon[, authenticated];

-- GROUP A
REVOKE EXECUTE ON FUNCTION public.ingest_sheet_rows(uuid, jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_ozon_poll(text)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_quicklivraison_poll(text)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_sheets_poll(text)                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invoke_vitex_poll(text)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_soft_deleted_orders()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_customer_from_orders(uuid, text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mb_sync_source_lock(uuid, text)             FROM PUBLIC, anon, authenticated;

-- GROUP B (keep authenticated)
REVOKE EXECUTE ON FUNCTION public.link_company_parcels_to_delivery_note(uuid, uuid[])     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.link_courier_parcels_to_delivery_note(uuid, uuid[])     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_company_parcel_from_delivery_note(uuid, uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_courier_parcel_from_delivery_note(uuid, uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_open_company_delivery_note(uuid)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_open_courier_delivery_note(uuid)                 FROM PUBLIC, anon;
