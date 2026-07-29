-- TKT-10 backfill: each existing business's EARLIEST super admin becomes its
-- business owner. Rule + the exact 7-user list previewed to and approved by
-- the owner 2026-07-29 (Bellora Bio, El Moda, Golden Design, moulay soltan,
-- Orelle, Ouzlim Bio, test env). Runs AFTER 20260729150000 (trigger + unique
-- index exist; the trigger only guards demotion/deletion, not promotion, and
-- the partial unique index enforces one owner per business).

BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.users u
SET role = 'business owner'
FROM (
    SELECT DISTINCT ON (u2."DigiCom Business") u2.id
    FROM public.users u2
    WHERE u2.role = 'super admin' AND u2."DigiCom Business" IS NOT NULL
    ORDER BY u2."DigiCom Business", u2.created_at ASC
) first_admin
WHERE u.id = first_admin.id;

COMMIT;
