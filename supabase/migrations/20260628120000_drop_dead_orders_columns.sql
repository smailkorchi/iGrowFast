-- Drop four dead columns from public.orders.
--
-- Verified 2026-06-28 across the live DB (prod+dev) and the full codebase
-- (src/ + supabase/functions/, excluding the generated database.types.ts):
--
--   delivery_type    : Only ever held the constant 'Home Delivery' (1417 rows) or NULL (302).
--                      Its UI selector was already removed; no DB function/view/trigger reads it.
--                      Remaining references were purely vestigial: hardcoded 'Home Delivery' write
--                      payloads, a zod .optional(), the orderSearch haystack, a select-and-ignore in
--                      ShippingSection, and two read-only detail-modal display lines
--                      ({selectedOrder.delivery_type || 'Standard Delivery'}). No logic ever branched
--                      on its value. All references removed in commit 16ba87b and deployed (two-phase
--                      prerequisite) BEFORE this DROP, so the live frontend never SELECTs the column.
--
--   free_shipping    : 0 rows true; zero code references; zero DB references. Superseded by
--                      include_delivery_in_total and the shipping_cost === 0 UI label.
--
--   delivery_fees_id : 0 rows populated; zero code references; zero DB references; never carried an
--                      FK constraint, index, or trigger.
--
--   old_client_id    : 0 rows populated; zero code references; zero DB references. Superseded by the
--                      exchange_of_order_id link used by the exchange-order feature.
--
-- No FK/index/constraint/trigger/function/view referenced any of these (confirmed via pg_proc.prosrc,
-- pg_get_viewdef, pg_index, pg_constraint, pg_trigger). DROP without CASCADE proves zero dependents.
-- orders: 59 -> 55 columns on both prod and dev (parity preserved).
--
-- NOT dropped this pass (deferred): orders.tracking_number is also a 0-populated legacy column, but it
-- is a defensive fallback referenced in ~20 frontend sites and 4 DB functions (incl. money functions
-- seller_month_orders / mediabuyer_month_orders) plus a provider-webhook lookup. It gets its own pass.
--
-- Rollback:
--   ALTER TABLE public.orders
--     ADD COLUMN delivery_type text,
--     ADD COLUMN free_shipping boolean DEFAULT false,
--     ADD COLUMN delivery_fees_id uuid,
--     ADD COLUMN old_client_id uuid;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS delivery_type,
  DROP COLUMN IF EXISTS free_shipping,
  DROP COLUMN IF EXISTS delivery_fees_id,
  DROP COLUMN IF EXISTS old_client_id;
