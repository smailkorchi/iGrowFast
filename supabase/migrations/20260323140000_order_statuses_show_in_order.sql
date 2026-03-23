-- Whether this order status appears in add/edit order modals (admin + seller).
ALTER TABLE public.order_statuses
  ADD COLUMN IF NOT EXISTS show_in_order boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.order_statuses.show_in_order IS 'When true, status is selectable in add/edit order flows; list filters still see all active statuses.';
