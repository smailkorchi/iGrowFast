-- F3-S4a: fine-grained flags (fake/double/blacklisted carve-outs of is_cancelled;
-- exact pkg refused/recheck). Seeded from category → zero behavior change.
ALTER TABLE public.order_statuses
  ADD COLUMN IF NOT EXISTS is_fake        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_double      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blacklisted boolean NOT NULL DEFAULT false;

UPDATE public.order_statuses SET
  is_fake        = (category = 'fake'),
  is_double      = (category = 'double'),
  is_blacklisted = (category = 'blacklisted');

ALTER TABLE public.package_statuses
  ADD COLUMN IF NOT EXISTS is_refused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_recheck boolean NOT NULL DEFAULT false;

UPDATE public.package_statuses SET
  is_refused = (category = 'refused'),
  is_recheck = (category = 'recheck');
