-- OR-C Orders-family realtime storm-proofing (2026-07-17) — docs/AUDIT_FINDINGS.md task #4 OR-13
-- Per-row AFTER triggers emitted ONE broadcast per touched row: orders_bulk_guarded on 500
-- rows = 500 events × every subscriber = 500k WS frames; carrier webhook streams = a REST
-- thundering herd (each event → full list+KPI refetch per client). Root fix: statement-level
-- triggers with transition tables — ONE coalesced event per (statement, business), plus
-- per-row pkg-toast events ONLY for package_status_id transitions, capped at 10/statement
-- (OrderStatusNotifications contract; a 500-row bulk flip should never fire 500 toasts).
-- Consumer contracts preserved (verified in source):
--   EcomBizRealtime      — invalidation ignores payload fields entirely.
--   ChatOrdersBridge     — event.payload.phone ?? null → null already means broad
--                          invalidation; coalesced events carry phone only when the
--                          statement touched exactly one normalized phone.
--   OrderStatusNotifications — acts only on op='UPDATE' && payload.pkg && !deleted;
--                          per-row pkg events keep the exact 7-field pkg shape.
--   SheetReview          — acts on op='INSERT' && review_pending; coalesced INSERT
--                          carries review_pending=true when any new row is a pending draft.
--   webhook_logs         — untouched (one row per carrier sync tx already).
-- All functions stay SECURITY DEFINER + whole-body exception-swallowed (a broadcast
-- failure must never roll back the business write). Multi-business statements group by
-- biz and emit per business. Empty statements (0 rows) emit nothing.

BEGIN;

-- ── orders: coalesced statement events + capped pkg toasts ───────────────────
CREATE OR REPLACE FUNCTION public.broadcast_orders_stmt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  r record;
  t record;
  v_pkg_changes int;
  v_tracking text; v_pname text; v_ptype text; v_plogo text;
begin
  begin
    if tg_op = 'INSERT' then
      for r in
        select n."DigiCom Business" as biz,
               count(*) as cnt,
               bool_or(n.source_review_status = 'pending') as review_pending,
               case when count(distinct public.normalize_phone_for_customer(n.phone)) = 1
                    then min(public.normalize_phone_for_customer(n.phone)) end as phone
        from new_rows n
        where n."DigiCom Business" is not null
        group by n."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object(
            'op', 'INSERT', 'count', r.cnt, 'phone', r.phone,
            'review_pending', case when r.review_pending then true end
          )),
          'order', 'ecom:biz:' || r.biz::text, true);
      end loop;

    elsif tg_op = 'UPDATE' then
      for r in
        select n."DigiCom Business" as biz,
               count(*) as cnt,
               case when count(distinct public.normalize_phone_for_customer(n.phone)) = 1
                    then min(public.normalize_phone_for_customer(n.phone)) end as phone
        from new_rows n
        where n."DigiCom Business" is not null
        group by n."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object('op', 'UPDATE', 'count', r.cnt, 'phone', r.phone)),
          'order', 'ecom:biz:' || r.biz::text, true);
      end loop;

      -- pkg-toast rows: package_status_id transitions, per-row parity payload,
      -- capped at 10 per statement (bulk flips invalidate via the coalesced
      -- event; they must not fire a toast per row).
      select count(*) into v_pkg_changes
      from new_rows n join old_rows o on o.id = n.id
      where n."DigiCom Business" is not null
        and o.package_status_id is distinct from n.package_status_id;

      if v_pkg_changes between 1 and 10 then
        for t in
          select n.*
          from new_rows n join old_rows o on o.id = n.id
          where n."DigiCom Business" is not null
            and o.package_status_id is distinct from n.package_status_id
        loop
          begin
            select cp.tracking_code, p.name, p.provider_type, p.logo_url
              into v_tracking, v_pname, v_ptype, v_plogo
              from public.company_parcels cp
              left join public.providers p on p.id = cp.provider_id
             where cp.order_id = t.id
             order by cp.created_at desc
             limit 1;
          exception when others then
            v_tracking := null; v_pname := null; v_ptype := null; v_plogo := null;
          end;
          perform realtime.send(
            jsonb_build_object(
              'op', 'UPDATE',
              'id', t.id::text,
              'phone', public.normalize_phone_for_customer(t.phone),
              'pkg', jsonb_build_object(
                'package_status_id', t.package_status_id::text,
                'name',              t.name,
                'seller_id',         t.seller_id::text,
                'tracking_code',     v_tracking,
                'provider_name',     v_pname,
                'provider_type',     v_ptype,
                'provider_logo_url', v_plogo)
            ) || case when t.date_deleted is not null
                      then jsonb_build_object('deleted', true) else '{}'::jsonb end,
            'order', 'ecom:biz:' || (t."DigiCom Business")::text, true);
        end loop;
      end if;

    elsif tg_op = 'DELETE' then
      for r in
        select o."DigiCom Business" as biz,
               count(*) as cnt,
               case when count(distinct public.normalize_phone_for_customer(o.phone)) = 1
                    then min(public.normalize_phone_for_customer(o.phone)) end as phone
        from old_rows o
        where o."DigiCom Business" is not null
        group by o."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object('op', 'DELETE', 'count', r.cnt, 'phone', r.phone)),
          'order', 'ecom:biz:' || r.biz::text, true);
      end loop;
    end if;
  exception when others then
    null;  -- never roll back the order write
  end;
  return null;
end;
$function$;

-- ── parcels + stock: coalesced statement events ──────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_parcels_stmt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r record; v_tbl text;
begin
  begin
    v_tbl := case tg_table_name when 'company_parcels' then 'company' else 'courier' end;
    -- transition tables are NOT visible to EXECUTE'd dynamic SQL -> static branches
    if tg_op = 'DELETE' then
      for r in
        select o."DigiCom Business" as biz, count(*) as cnt,
               case when count(distinct o.order_id) = 1 then min(o.order_id::text) end as order_id
        from old_rows o where o."DigiCom Business" is not null group by o."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object(
            'op', tg_op, 'tbl', v_tbl, 'count', r.cnt, 'order_id', r.order_id)),
          'parcel', 'ecom:biz:' || r.biz::text, true);
      end loop;
    else
      for r in
        select n."DigiCom Business" as biz, count(*) as cnt,
               case when count(distinct n.order_id) = 1 then min(n.order_id::text) end as order_id
        from new_rows n where n."DigiCom Business" is not null group by n."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object(
            'op', tg_op, 'tbl', v_tbl, 'count', r.cnt, 'order_id', r.order_id)),
          'parcel', 'ecom:biz:' || r.biz::text, true);
      end loop;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.broadcast_stock_stmt()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare r record; v_tbl text;
begin
  begin
    v_tbl := case tg_table_name when 'products' then 'product' else 'accessory' end;
    -- transition tables are NOT visible to EXECUTE'd dynamic SQL -> static branches
    if tg_op = 'DELETE' then
      for r in
        select o."DigiCom Business" as biz, count(*) as cnt,
               case when count(*) = 1 then min(o.id::text) end as id
        from old_rows o where o."DigiCom Business" is not null group by o."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object(
            'op', tg_op, 'tbl', v_tbl, 'count', r.cnt, 'id', r.id)),
          'stock', 'ecom:biz:' || r.biz::text, true);
      end loop;
    else
      for r in
        select n."DigiCom Business" as biz, count(*) as cnt,
               case when count(*) = 1 then min(n.id::text) end as id
        from new_rows n where n."DigiCom Business" is not null group by n."DigiCom Business"
      loop
        perform realtime.send(
          jsonb_strip_nulls(jsonb_build_object(
            'op', tg_op, 'tbl', v_tbl, 'count', r.cnt, 'id', r.id)),
          'stock', 'ecom:biz:' || r.biz::text, true);
      end loop;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$function$;

-- ── swap row triggers → statement triggers ───────────────────────────────────
DROP TRIGGER trg_broadcast_order_change_ins ON public.orders;
DROP TRIGGER trg_broadcast_order_change_upd ON public.orders;
DROP TRIGGER trg_broadcast_order_change_del ON public.orders;
CREATE TRIGGER trg_broadcast_orders_stmt_ins AFTER INSERT ON public.orders
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_orders_stmt();
CREATE TRIGGER trg_broadcast_orders_stmt_upd AFTER UPDATE ON public.orders
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_orders_stmt();
CREATE TRIGGER trg_broadcast_orders_stmt_del AFTER DELETE ON public.orders
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_orders_stmt();

DROP TRIGGER trg_broadcast_parcel_change ON public.company_parcels;
DROP TRIGGER trg_broadcast_parcel_change ON public.courier_parcels;
CREATE TRIGGER trg_broadcast_parcels_stmt_ins AFTER INSERT ON public.company_parcels
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();
CREATE TRIGGER trg_broadcast_parcels_stmt_upd AFTER UPDATE ON public.company_parcels
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();
CREATE TRIGGER trg_broadcast_parcels_stmt_del AFTER DELETE ON public.company_parcels
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();
CREATE TRIGGER trg_broadcast_parcels_stmt_ins AFTER INSERT ON public.courier_parcels
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();
CREATE TRIGGER trg_broadcast_parcels_stmt_upd AFTER UPDATE ON public.courier_parcels
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();
CREATE TRIGGER trg_broadcast_parcels_stmt_del AFTER DELETE ON public.courier_parcels
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_parcels_stmt();

DROP TRIGGER trg_broadcast_stock_change ON public.products;
DROP TRIGGER trg_broadcast_stock_change ON public.accessories;
CREATE TRIGGER trg_broadcast_stock_stmt_ins AFTER INSERT ON public.products
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();
CREATE TRIGGER trg_broadcast_stock_stmt_upd AFTER UPDATE ON public.products
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();
CREATE TRIGGER trg_broadcast_stock_stmt_del AFTER DELETE ON public.products
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();
CREATE TRIGGER trg_broadcast_stock_stmt_ins AFTER INSERT ON public.accessories
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();
CREATE TRIGGER trg_broadcast_stock_stmt_upd AFTER UPDATE ON public.accessories
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();
CREATE TRIGGER trg_broadcast_stock_stmt_del AFTER DELETE ON public.accessories
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.broadcast_stock_stmt();

COMMIT;
