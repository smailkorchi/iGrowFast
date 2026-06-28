-- Drop 5 dead columns from sales_channels (sheet/woo sync-channel config, 1 row). 21→16.
--
-- Verified 2026-06-28 (db-column-cleanup-progress #56):
--   * WooCommerce was scaffolded but NEVER built — only a 'Google Sheets' channel type exists,
--     the config form (admin/SalesChannels.tsx) has no woo fields, and grep for
--     woocommerce/consumer_key/consumer_secret returns ZERO hits anywhere (src + edge).
--       - url            (woo store URL; NOT the sheet URL — that's parsed into spreadsheet_id)
--       - consumer_key   (woo REST API key)
--       - consumer_secret(woo REST API secret)
--   * last_modified_seen + last_sync_cursor = scaffolded sheet-sync watermarks, both null, ZERO refs.
--     The live sheets-sync engine uses last_synced_at + sync_cadence (due-check) and
--     sync_status/sync_error (state) instead — never these two.
--
-- select('*') paths exist (sheets-sync index.ts:148, admin/SalesChannels.tsx:173) but NONE of the 5
-- columns are read by any code, so the * paths simply return fewer fields — no breakage, no two-phase.
-- fn_refs=null, view_refs=null; no FK/index/CHECK on any of the 5 → DROP without CASCADE proves it.
--
-- KEPT (live): id, type, name, spreadsheet_id, spreadsheet_name, start_row, has_header, column_map,
-- is_active, sync_cadence, last_synced_at, sync_status, sync_error, "DigiCom Business", created_at, updated_at.
--
-- Rollback:
--   ALTER TABLE public.sales_channels
--     ADD COLUMN url text, ADD COLUMN consumer_key text, ADD COLUMN consumer_secret text,
--     ADD COLUMN last_modified_seen text, ADD COLUMN last_sync_cursor jsonb;

ALTER TABLE public.sales_channels
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS consumer_key,
  DROP COLUMN IF EXISTS consumer_secret,
  DROP COLUMN IF EXISTS last_modified_seen,
  DROP COLUMN IF EXISTS last_sync_cursor;
