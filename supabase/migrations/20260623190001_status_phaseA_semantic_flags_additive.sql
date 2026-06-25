-- Phase A (additive, no behavior change): semantic flags on the status masters seeded
-- from the current category mapping, raw_provider_status capture, and the missing index.
-- Later phases make flags authoritative and retire the hardcoded category contract.

-- package_statuses flags
alter table public.package_statuses
  add column if not exists is_delivered boolean not null default false,
  add column if not exists is_returned boolean not null default false,
  add column if not exists is_shipped boolean not null default false,
  add column if not exists excluded_from_delivery_rate boolean not null default false;
update public.package_statuses set
  is_delivered = (category = 'delivered'),
  is_returned  = (category in ('returned','returning','refused')),
  is_shipped   = (category in ('in_transit','out_for_delivery','picked_up','pickup_pending')),
  excluded_from_delivery_rate = (code in ('HorsZone','5684'));
comment on column public.package_statuses.is_delivered is 'Semantic flag: counts as delivery (replaces DELIVERED_PKG_CATS). Resolve money/analytics by this, not category text.';
comment on column public.package_statuses.is_returned is 'Semantic flag: return/refused leg (replaces RETURNED_PKG_CATS).';
comment on column public.package_statuses.is_shipped is 'Semantic flag: in-transit/out-for-delivery/picked-up/pickup-pending (replaces SHIPPED_PKG_CATS).';
comment on column public.package_statuses.excluded_from_delivery_rate is 'Semantic flag: excluded from delivery-rate denominator (replaces ADMIN_PULLBACK_PACKAGE_CODES).';

-- order_statuses flags
alter table public.order_statuses
  add column if not exists is_confirmed boolean not null default false,
  add column if not exists is_cancelled boolean not null default false,
  add column if not exists is_unreached boolean not null default false,
  add column if not exists excluded_from_delivery_rate boolean not null default false;
update public.order_statuses set
  is_confirmed = (category in ('confirmed','processed','paid','unpaid')),
  is_cancelled = (category in ('cancelled','fake','double','blacklisted')),
  is_unreached = (category = 'callback'),
  excluded_from_delivery_rate = (category in ('fake','double','blacklisted','cancelled'));
comment on column public.order_statuses.is_confirmed is 'Semantic flag: confirmed/processed/paid/unpaid (replaces CONFIRMED_ORDER_CATS).';
comment on column public.order_statuses.is_cancelled is 'Semantic flag: cancelled/fake/double/blacklisted (replaces CANCELLED_ORDER_CATS).';
comment on column public.order_statuses.is_unreached is 'Semantic flag: callback/unreached (replaces UNREACHED_ORDER_CATS).';
comment on column public.order_statuses.excluded_from_delivery_rate is 'Semantic flag: excluded from delivery-rate denominator (replaces ADMIN_PULLBACK_ORDER_CATS).';

-- raw provider status capture (webhook no-match writes here instead of clobbering the master label)
alter table public.company_parcels add column if not exists raw_provider_status text;
alter table public.courier_parcels add column if not exists raw_provider_status text;
comment on column public.company_parcels.raw_provider_status is 'Raw provider status on no-match; status_id/status_label stay master-derived.';
comment on column public.courier_parcels.raw_provider_status is 'Raw provider status on no-match.';

-- missing FK index (company_parcels already has one)
create index if not exists idx_courier_parcels_status_id on public.courier_parcels(status_id);
-- partial indexes on hot flags
create index if not exists idx_package_statuses_is_delivered on public.package_statuses(is_delivered) where is_delivered;
create index if not exists idx_package_statuses_excl_rate on public.package_statuses(excluded_from_delivery_rate) where excluded_from_delivery_rate;
create index if not exists idx_order_statuses_is_confirmed on public.order_statuses(is_confirmed) where is_confirmed;
