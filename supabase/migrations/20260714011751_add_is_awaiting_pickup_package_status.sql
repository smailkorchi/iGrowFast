-- Add the `is_awaiting_pickup` semantic behavior flag to package_statuses.
--
-- The shipped sub-statuses are all is_shipped=true, so "Attente De Ramassage"
-- (the state a parcel enters the moment it is placed in a provider pickup note)
-- was not uniquely identifiable by any single flag. This adds a dedicated,
-- owner-governable flag — mirroring is_new — so the delivery-note wizard can stamp
-- the correct status on link WITHOUT calling any provider tracking API (which, on
-- large batch notes, hammered the carrier's rate limiter). It is a subset of
-- is_shipped (a shipped parcel that is specifically awaiting pickup).
alter table public.package_statuses
  add column if not exists is_awaiting_pickup boolean not null default false;

-- Seed the flag on the canonical "Attente De Ramassage" master status.
update public.package_statuses
   set is_awaiting_pickup = true
 where code = 'P_A_RAMASSAGE';
