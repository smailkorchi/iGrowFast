-- Whether orders.price includes shipping_cost (toggle in add/edit order modal).
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS include_delivery_in_total boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.orders.include_delivery_in_total IS 'When true, price = line items + shipping_cost; when false, price = line items only (shipping still stored on shipping_cost).';
