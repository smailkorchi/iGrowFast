-- Optimize public.seller_daily_earnings (perf, zero behaviour change).
--
-- Problem: the view called sum_order_units_for_seller_products(o.id, o.seller_id)
-- THREE times per row (once each in commission_earned / delivered_count /
-- total_earned), and even for per_order sellers where the result is never used.
-- That STABLE function scans order_items + parses the seller's products jsonb per
-- call, so it dominated the plan (GroupAggregate: 28.5k shared buffer hits).
--
-- Fix: compute the units count ONCE per row via a LATERAL, and only when the
-- seller is per_unit (per_order sellers skip the call entirely). Output is
-- byte-identical: verified by EXCEPT parity in BOTH directions on real prod data
-- (0 diffs, 136=136 rows) and on dev (0 diffs). Measured: 210ms -> 79ms,
-- buffers 28526 -> 14453.
--
-- security_invoker=on is preserved (tenant isolation flows from underlying orders
-- RLS — see Task #14). CREATE OR REPLACE keeps existing grants (authenticated:SELECT).
CREATE OR REPLACE VIEW public.seller_daily_earnings AS
  SELECT md5((o.seller_id::text || date(COALESCE(o.date_livraison, o.updated_at))::text) || COALESCE(o."DigiCom Business"::text, ''::text))::uuid AS id,
    o.seller_id,
    date(COALESCE(o.date_livraison, o.updated_at)) AS date,
    0::numeric AS salary_earned,
    sum(
      CASE
        WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN COALESCE(u.commission_price, 0::numeric) * unit.cnt::numeric
        ELSE COALESCE(u.commission_price, 0::numeric)
      END) AS commission_earned,
    sum(
      CASE
        WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN unit.cnt
        ELSE 1::bigint
      END)::integer AS delivered_count,
    sum(
      CASE
        WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text THEN COALESCE(u.commission_price, 0::numeric) * unit.cnt::numeric
        ELSE COALESCE(u.commission_price, 0::numeric)
      END) AS total_earned,
    max(o.updated_at) AS created_at,
    o."DigiCom Business"
   FROM orders o
     JOIN users u ON u.id = o.seller_id
     JOIN package_statuses ps ON ps.id = o.package_status_id
     LEFT JOIN LATERAL (
       SELECT CASE
                WHEN COALESCE(u.commission_basis, 'per_order'::text) = 'per_unit'::text
                THEN sum_order_units_for_seller_products(o.id, o.seller_id)
                ELSE 0::bigint
              END AS cnt
     ) unit ON true
  WHERE o.seller_id IS NOT NULL AND ps.is_delivered AND o.date_deleted IS NULL
    AND o.source_review_status IS DISTINCT FROM 'pending'::text AND COALESCE(o.swap_only, false) = false
  GROUP BY o.seller_id, (date(COALESCE(o.date_livraison, o.updated_at))), o."DigiCom Business";

-- Idempotent re-assert of tenant isolation (CREATE OR REPLACE already preserves it).
ALTER VIEW public.seller_daily_earnings SET (security_invoker = on);

-- Correct the stale comment (this has been an invoker view since Task #14, not definer).
COMMENT ON VIEW public.seller_daily_earnings IS
  'security_invoker view: per-seller/day/business delivered-order commission rollup. Tenant isolation via underlying orders RLS. Units computed once per row via LATERAL, only for per_unit sellers.';
