-- Whether this order status appears in add/edit order modals (admin + seller).
-- New and existing rows default to true; only explicit false hides from those modals.
ALTER TABLE public.order_statuses
  ADD COLUMN IF NOT EXISTS show_in_order boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.order_statuses.show_in_order IS 'When true, status is selectable in add/edit order flows; list filters still see all active statuses.';
