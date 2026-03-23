-- Legacy public.cities deprecated; fees are keyed by master_city_id.
ALTER TABLE public.company_fees
  ALTER COLUMN city_id DROP NOT NULL;

ALTER TABLE public.courier_fees
  ALTER COLUMN city_id DROP NOT NULL;
