-- R1a — ecom:biz orders-family broadcast (W7, MASTER_TODO §1).
--
-- Replaces the postgres_changes dependency of the 4 orders-family consumers
-- (admin/Orders 7 bindings, seller/Orders 7 bindings, OrderStatusNotifications,
-- SheetReview) with events on the existing private topic ecom:biz:<business_id>
-- (authz = mig 20260711160000's can_read_ecom_biz_topic policy — any
-- authenticated member of the business; unchanged here).
--
-- Event contract (tiny payloads, at-most-once, clients debounce):
--   'order'  — public.orders INSERT/UPDATE/DELETE.
--              {op, id, phone}                              (always; phone normalized — WA chat-orders key)
--              + review_pending:true                        (INSERT with source_review_status='pending' → SheetReview)
--              + deleted:true                               (UPDATE that set/carries date_deleted → toast gate)
--              + pkg:{package_status_id,name,seller_id,     (UPDATE where package_status_id changed →
--                     tracking_code,provider_name,           OrderStatusNotifications toast renders with
--                     provider_type,provider_logo_url}       ZERO follow-up queries)
--   'parcel' — company_parcels/courier_parcels INSERT/UPDATE/DELETE: {op, tbl, order_id}
--   'stock'  — products/accessories INSERT/UPDATE/DELETE: {op, tbl, id}
--
-- Parity notes vs the postgres_changes bindings being retired:
--   • orders UPDATE loses the old 5-column WHEN gate — postgres_changes delivered
--     EVERY update, so full-update emit is exact parity for the Orders pages'
--     cache invalidation (strictly ≥ events for the WA chat-orders consumer,
--     whose handler is a targeted debounced invalidate — safe).
--   • parcels/stock had event:'*' with no filter — same here (no WHEN), so no
--     consumer can miss a column change.
--   • The pkg parcel lookup (latest company_parcel + provider) runs ONLY on
--     package-status transitions (webhook/sync path, ~low rate) and replaces a
--     per-CLIENT enrichment SELECT fired by every connected admin/seller today.
--
-- Every emitter: SECURITY DEFINER, empty search_path, whole body
-- exception-swallowed (a broadcast hiccup must NEVER roll back a business
-- write), skips rows with NULL "DigiCom Business".
--
-- Reversible: drop the new triggers + functions; restore broadcast_order_change
-- from mig 20260711160000 (5-col WHEN + {id,phone,op} payload).
--
-- Apply: ~/.igrowfast/db.sh < this file   (dry-run first with COMMIT→ROLLBACK)

begin;

-- ── 1. orders: replace the emitter (payload v2) ──────────────────────────────
create or replace function public.broadcast_order_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_biz      uuid;
  v_row      public.orders;
  v_payload  jsonb;
  v_tracking text;
  v_pname    text;
  v_ptype    text;
  v_plogo    text;
begin
  begin
    v_row := coalesce(new, old);
    v_biz := v_row."DigiCom Business";
    if v_biz is null then
      return coalesce(new, old);
    end if;

    v_payload := jsonb_build_object(
      'op',    tg_op,
      'id',    v_row.id::text,
      'phone', public.normalize_phone_for_customer(v_row.phone)  -- matches WA chat-orders query key
    );

    -- SheetReview: a sheet-imported draft landing in the review inbox.
    if tg_op = 'INSERT' and new.source_review_status = 'pending' then
      v_payload := v_payload || jsonb_build_object('review_pending', true);
    end if;

    if tg_op = 'UPDATE' then
      -- Toast gate: soft-deleted orders never toast.
      if new.date_deleted is not null then
        v_payload := v_payload || jsonb_build_object('deleted', true);
      end if;

      -- Package-status transition → carry everything the status toast renders,
      -- so no client fires a follow-up query (replaces the per-client
      -- company_parcels enrichment SELECT in OrderStatusNotifications).
      -- The parcel/provider lookup gets its OWN exception sub-block: a
      -- persistent enrichment failure (column rename, timeout) must degrade to
      -- provider-less pkg fields — never suppress the whole order event.
      if old.package_status_id is distinct from new.package_status_id then
        begin
          select cp.tracking_code, p.name, p.provider_type, p.logo_url
            into v_tracking, v_pname, v_ptype, v_plogo
            from public.company_parcels cp
            left join public.providers p on p.id = cp.provider_id
           where cp.order_id = new.id
           order by cp.created_at desc
           limit 1;
        exception when others then
          v_tracking := null; v_pname := null; v_ptype := null; v_plogo := null;
        end;

        v_payload := v_payload || jsonb_build_object(
          'pkg', jsonb_build_object(
            'package_status_id',   new.package_status_id::text,
            'name',                new.name,
            'seller_id',           new.seller_id::text,
            'tracking_code',       v_tracking,
            'provider_name',       v_pname,
            'provider_type',       v_ptype,
            'provider_logo_url',   v_plogo
          )
        );
      end if;
    end if;

    perform realtime.send(v_payload, 'order', 'ecom:biz:' || v_biz::text, true);
  exception when others then
    -- A broadcast failure must NEVER roll back the order write.
    null;
  end;
  return coalesce(new, old);
end;
$function$;
alter function public.broadcast_order_change() owner to postgres;

-- UPDATE trigger loses the 5-column WHEN (see parity notes). INSERT/DELETE unchanged.
drop trigger if exists trg_broadcast_order_change_upd on public.orders;
create trigger trg_broadcast_order_change_upd
  after update on public.orders
  for each row execute function public.broadcast_order_change();

-- ── 2. parcels: new emitter (both parcel tables carry "DigiCom Business") ────
create or replace function public.broadcast_parcel_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_biz      uuid;
  v_order_id uuid;
begin
  begin
    if tg_op = 'DELETE' then
      v_biz := old."DigiCom Business"; v_order_id := old.order_id;
    else
      v_biz := new."DigiCom Business"; v_order_id := new.order_id;
    end if;
    if v_biz is not null then
      perform realtime.send(
        jsonb_build_object(
          'op',       tg_op,
          'tbl',      case tg_table_name when 'company_parcels' then 'company' else 'courier' end,
          'order_id', v_order_id::text
        ),
        'parcel',
        'ecom:biz:' || v_biz::text,
        true
      );
    end if;
  exception when others then
    null;  -- never roll back a parcel write
  end;
  return coalesce(new, old);
end;
$function$;
alter function public.broadcast_parcel_change() owner to postgres;

drop trigger if exists trg_broadcast_parcel_change on public.company_parcels;
create trigger trg_broadcast_parcel_change
  after insert or update or delete on public.company_parcels
  for each row execute function public.broadcast_parcel_change();

drop trigger if exists trg_broadcast_parcel_change on public.courier_parcels;
create trigger trg_broadcast_parcel_change
  after insert or update or delete on public.courier_parcels
  for each row execute function public.broadcast_parcel_change();

-- ── 3. stock: new emitter (products + accessories) ───────────────────────────
create or replace function public.broadcast_stock_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_biz uuid;
  v_id  uuid;
begin
  begin
    if tg_op = 'DELETE' then
      v_biz := old."DigiCom Business"; v_id := old.id;
    else
      v_biz := new."DigiCom Business"; v_id := new.id;
    end if;
    if v_biz is not null then
      perform realtime.send(
        jsonb_build_object(
          'op',  tg_op,
          'tbl', case tg_table_name when 'products' then 'product' else 'accessory' end,
          'id',  v_id::text
        ),
        'stock',
        'ecom:biz:' || v_biz::text,
        true
      );
    end if;
  exception when others then
    null;  -- never roll back a stock write
  end;
  return coalesce(new, old);
end;
$function$;
alter function public.broadcast_stock_change() owner to postgres;

drop trigger if exists trg_broadcast_stock_change on public.products;
create trigger trg_broadcast_stock_change
  after insert or update or delete on public.products
  for each row execute function public.broadcast_stock_change();

drop trigger if exists trg_broadcast_stock_change on public.accessories;
create trigger trg_broadcast_stock_change
  after insert or update or delete on public.accessories
  for each row execute function public.broadcast_stock_change();

commit;
