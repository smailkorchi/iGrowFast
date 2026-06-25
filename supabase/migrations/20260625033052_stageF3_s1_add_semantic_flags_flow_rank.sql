-- F3-S1: additive semantic flags + canonical forward-progression rank, seeded EXACTLY from
-- the current category values so flag-reads == category-reads (zero behavior change).

ALTER TABLE public.package_statuses
  ADD COLUMN IF NOT EXISTS is_new       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_cancelled boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_postponed boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_terminal  boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flow_rank    smallint;

UPDATE public.package_statuses SET
  is_new       = (category = 'new'),
  is_cancelled = (category = 'cancelled'),
  is_postponed = (category = 'postponed'),
  is_terminal  = (category IN ('delivered','returned','refused','cancelled')),
  flow_rank    = CASE category
                   WHEN 'new'              THEN 0
                   WHEN 'pickup_pending'   THEN 1
                   WHEN 'picked_up'        THEN 2
                   WHEN 'in_transit'       THEN 3
                   WHEN 'out_for_delivery' THEN 4
                   ELSE NULL
                 END;

ALTER TABLE public.order_statuses
  ADD COLUMN IF NOT EXISTS is_return     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_relaunch   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_postponed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deducts_stock boolean NOT NULL DEFAULT false;

UPDATE public.order_statuses SET
  is_return     = (category = 'return'),
  is_relaunch   = (category = 'relaunch_new'),
  is_postponed  = (category = 'postponed'),
  deducts_stock = (category = 'confirmed');
