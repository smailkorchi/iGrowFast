-- Notes filter-bar + universal search foundation.
-- Adds: btree_gin, an IMMUTABLE accent/case fold, trigram + keyset indexes on the
-- 6 note-type table pairs and on orders, and 6 SECURITY-INVOKER "find matching note
-- ids" RPCs (client name / phone / parcel tracking / note reference / provider|courier
-- name). All search runs server-side, index-driven; RLS on each note header re-gates
-- every candidate id (commercial own-created gate is preserved automatically).
--
-- Scale notes:
--  * one union branch per axis, each driven by its own index -> no cross-table OR scans.
--  * final gate is the header's own RLS -> a line-item axis can never leak a note the
--    caller can't see (tenant-wide parcel rows collapse to own-created for 'commercial').
--  * result capped at 150 most-recent matches; the frontend intersects with its active
--    filters + pagination, so a huge match set never round-trips.

begin;

create extension if not exists btree_gin;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- IMMUTABLE fold: lower + strip common Latin-1 / French accents. Backs the GIN
-- functional indexes, so it must stay byte-stable (no unaccent(), which is STABLE).
-- ---------------------------------------------------------------------------
create or replace function public.fold_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüŸÿ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYy'));
$$;

-- ---------------------------------------------------------------------------
-- Indexes. Plain (non-concurrent) is safe: every target table is small today and
-- these are one-time creations; IF NOT EXISTS keeps the migration replayable.
-- ---------------------------------------------------------------------------

-- (1) parcel / line-item tracking_code  -- the critical missing axis
create index if not exists idx_cparcels_biz_track_trgm
  on public.company_parcels using gin ("DigiCom Business", tracking_code gin_trgm_ops);
create index if not exists idx_courparcels_biz_track_trgm
  on public.courier_parcels using gin ("DigiCom Business", tracking_code gin_trgm_ops);
create index if not exists idx_crno_biz_track_trgm
  on public.company_return_note_orders using gin ("DigiCom Business", tracking_code gin_trgm_ops);
create index if not exists idx_courno_biz_track_trgm
  on public.courier_return_note_orders using gin ("DigiCom Business", tracking_code gin_trgm_ops);
create index if not exists idx_cpno_biz_track_trgm
  on public.company_payment_note_orders using gin ("DigiCom Business", tracking_code gin_trgm_ops);
create index if not exists idx_courpno_biz_track_trgm
  on public.courier_payment_note_orders using gin ("DigiCom Business", tracking_code gin_trgm_ops);

-- (2) orders client name + phone (contains) -- live rows only
create index if not exists idx_orders_biz_name_fold_trgm
  on public.orders using gin ("DigiCom Business", public.fold_text(name) gin_trgm_ops)
  where date_deleted is null;
create index if not exists idx_orders_biz_phonenorm_trgm
  on public.orders using gin ("DigiCom Business", public.normalize_phone_for_customer(phone) gin_trgm_ops)
  where date_deleted is null;

-- (3) note-header reference (contains)
create index if not exists idx_cdn_biz_ref_trgm
  on public.company_delivery_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);
create index if not exists idx_courdn_biz_ref_trgm
  on public.courier_delivery_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);
create index if not exists idx_crn_biz_ref_trgm
  on public.company_return_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);
create index if not exists idx_courrn_biz_ref_trgm
  on public.courier_return_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);
create index if not exists idx_cpn_biz_ref_trgm
  on public.company_payment_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);
create index if not exists idx_courpn_biz_ref_trgm
  on public.courier_payment_notes using gin ("DigiCom Business", public.fold_text(reference) gin_trgm_ops);

-- (4) keyset listing (tenant-scoped, newest first)
create index if not exists idx_cdn_biz_keyset
  on public.company_delivery_notes ("DigiCom Business", created_at desc, id desc);
create index if not exists idx_courdn_biz_keyset
  on public.courier_delivery_notes ("DigiCom Business", created_at desc, id desc);
create index if not exists idx_crn_biz_keyset
  on public.company_return_notes ("DigiCom Business", created_at desc, id desc);
create index if not exists idx_courrn_biz_keyset
  on public.courier_return_notes ("DigiCom Business", created_at desc, id desc);
create index if not exists idx_cpn_biz_keyset
  on public.company_payment_notes ("DigiCom Business", created_at desc, id desc);
create index if not exists idx_courpn_biz_keyset
  on public.courier_payment_notes ("DigiCom Business", created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Search RPCs: return up to 150 matching note ids (most recent first).
-- SECURITY INVOKER -> the outer header select is RLS-gated per caller; every union
-- branch is index-driven and length-guarded (>=2 fold chars, >=3 phone digits,
-- >=2 raw tracking chars) so short/empty terms collapse each branch to nothing.
-- ---------------------------------------------------------------------------

create or replace function public.search_company_delivery_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.company_delivery_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.company_delivery_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.company_delivery_notes h2 join public.providers e on e.id=h2.provider_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.company_delivery_note_id from public.company_parcels li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.company_delivery_note_id from public.company_parcels li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.company_delivery_note_id from public.company_parcels li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

create or replace function public.search_courier_delivery_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.courier_delivery_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.courier_delivery_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.courier_delivery_notes h2 join public.users e on e.id=h2.courier_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.courier_delivery_note_id from public.courier_parcels li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.courier_delivery_note_id from public.courier_parcels li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.courier_delivery_note_id from public.courier_parcels li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

create or replace function public.search_company_return_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.company_return_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.company_return_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.company_return_notes h2 join public.providers e on e.id=h2.provider_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.return_note_id from public.company_return_note_orders li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.return_note_id from public.company_return_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.return_note_id from public.company_return_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

create or replace function public.search_courier_return_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.courier_return_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.courier_return_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.courier_return_notes h2 join public.users e on e.id=h2.courier_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.return_note_id from public.courier_return_note_orders li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.return_note_id from public.courier_return_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.return_note_id from public.courier_return_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

create or replace function public.search_company_payment_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.company_payment_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.company_payment_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.company_payment_notes h2 join public.providers e on e.id=h2.provider_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.payment_note_id from public.company_payment_note_orders li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.payment_note_id from public.company_payment_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.payment_note_id from public.company_payment_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

create or replace function public.search_courier_payment_note_ids(p_term text)
returns setof uuid language sql stable security invoker
set search_path = public, pg_catalog as $$
  with q as (select public.current_user_digicom_business_id() as biz,
                    public.fold_text(p_term) as fq,
                    regexp_replace(regexp_replace(coalesce(p_term,''),'\D','','g'),'^0+','') as pq,
                    btrim(coalesce(p_term,'')) as raw)
  select h.id from public.courier_payment_notes h, q
  where h."DigiCom Business" = q.biz and h.id in (
      select h2.id from public.courier_payment_notes h2, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(h2.reference) like '%'||q2.fq||'%'
      union
      select h2.id from public.courier_payment_notes h2 join public.users e on e.id=h2.courier_id, q q2
        where h2."DigiCom Business"=q2.biz and length(q2.fq)>=2 and public.fold_text(e.name) like '%'||q2.fq||'%'
      union
      select li.payment_note_id from public.courier_payment_note_orders li, q q2
        where li."DigiCom Business"=q2.biz and length(q2.raw)>=2 and li.tracking_code ilike '%'||q2.raw||'%'
      union
      select li.payment_note_id from public.courier_payment_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.fq)>=2 and o.date_deleted is null and public.fold_text(o.name) like '%'||q2.fq||'%'
      union
      select li.payment_note_id from public.courier_payment_note_orders li join public.orders o on o.id=li.order_id, q q2
        where li."DigiCom Business"=q2.biz and length(q2.pq)>=3 and o.date_deleted is null and public.normalize_phone_for_customer(o.phone) like '%'||q2.pq||'%'
  )
  order by h.created_at desc limit 150;
$$;

revoke all on function
  public.search_company_delivery_note_ids(text),
  public.search_courier_delivery_note_ids(text),
  public.search_company_return_note_ids(text),
  public.search_courier_return_note_ids(text),
  public.search_company_payment_note_ids(text),
  public.search_courier_payment_note_ids(text)
from public, anon;

grant execute on function
  public.search_company_delivery_note_ids(text),
  public.search_courier_delivery_note_ids(text),
  public.search_company_return_note_ids(text),
  public.search_courier_return_note_ids(text),
  public.search_company_payment_note_ids(text),
  public.search_courier_payment_note_ids(text)
to authenticated;

commit;
