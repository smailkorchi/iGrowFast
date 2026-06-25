-- Stage A: harden orders→package_statuses link (SET NULL → RESTRICT) + index courier_parcels.status_id.
alter table public.orders drop constraint orders_package_status_id_fkey;
alter table public.orders
  add constraint orders_package_status_id_fkey
  foreign key (package_status_id) references public.package_statuses(id) on delete restrict;

create index if not exists idx_courier_parcels_status_id on public.courier_parcels(status_id);
