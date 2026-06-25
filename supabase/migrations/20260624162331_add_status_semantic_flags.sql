-- Semantic behavior flags on the status master rows (Option A).
-- Seeded from the current category/code mapping so behavior is byte-identical.

-- ORDER axis
alter table public.order_statuses
  add column if not exists is_new                       boolean not null default false,
  add column if not exists is_confirmed                 boolean not null default false,
  add column if not exists is_paid                      boolean not null default false,
  add column if not exists is_unpaid                    boolean not null default false,
  add column if not exists is_cancelled                 boolean not null default false,
  add column if not exists is_callback                  boolean not null default false,
  add column if not exists excluded_from_delivery_rate  boolean not null default false;

update public.order_statuses set
  is_new       = (category = 'new'),
  is_confirmed = (category in ('confirmed','processed','paid','unpaid')),
  is_paid      = (category = 'paid'),
  is_unpaid    = (category = 'unpaid'),
  is_cancelled = (category in ('cancelled','fake','double','blacklisted')),
  is_callback  = (category = 'callback'),
  excluded_from_delivery_rate = (category in ('fake','double','blacklisted','cancelled'));

-- PACKAGE axis
alter table public.package_statuses
  add column if not exists is_delivered                 boolean not null default false,
  add column if not exists is_shipped                   boolean not null default false,
  add column if not exists is_returned                  boolean not null default false,
  add column if not exists excluded_from_delivery_rate  boolean not null default false;

update public.package_statuses set
  is_delivered = (category = 'delivered'),
  is_shipped   = (category in ('in_transit','out_for_delivery','picked_up','pickup_pending')),
  is_returned  = (category in ('returned','returning','refused')),
  excluded_from_delivery_rate = (code in ('HorsZone','5684'));

comment on column public.order_statuses.excluded_from_delivery_rate is
  'Order pulled back by seller/admin (fake/double/blacklisted/cancelled) — removed from the delivery-rate denominator (Coliaty formula).';
comment on column public.package_statuses.excluded_from_delivery_rate is
  'Parcel pulled back before a real delivery attempt (e.g. HorsZone/5684) — removed from the delivery-rate denominator.';
