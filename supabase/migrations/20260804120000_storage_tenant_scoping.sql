-- Storage tenant scoping: a manager may only write/delete inside their OWN business's folder.
--
-- Follow-up to 20260804100000_storage_policy_hardening.sql, which stopped ordinary users from
-- touching these buckets but left the namespace FLAT: every object sat at the bucket root with a
-- random filename, so an `admin` of business A could still delete or overwrite business B's
-- product images. This migration adds the missing tenant condition.
--
-- PATH CONTRACT (frontend changed in the same commit):
--   products        <business id>/<random>.<ext>        src/pages/admin/Products.tsx, src/pages/admin/Accessories.tsx
--   business-logos  <business id>/logo-<ts>.<ext>       src/pages/admin/business/Overview.tsx,
--                                                        src/components/businesses/AddEditBusinessModal.tsx (edit mode)
--   providers-logos <business id>/…                      no client call site exists today
-- business-stamps is NOT touched: its policies match the business id on segment 2 of
-- `profile/<business id>/…` and its call site keeps that shape.
--
-- OWNER: `public.is_owner()` may act in any folder, as everywhere else in this schema.
--
-- MEDIA BUYERS: authenticate under the `mediabuyer` Postgres role and have no policy on these
-- three buckets at all, so nothing here affects them. campaign-media is already path-scoped and
-- is deliberately left alone.
--
-- APPLY AS: supabase_admin (storage.objects is owned by supabase_storage_admin; CREATE POLICY
-- needs table ownership — `postgres` is not superuser on this box).
--
-- ── KNOWN RESIDUAL, NOT FIXED HERE (out of this migration's scope, flagged for decision) ──
-- Two UPDATE policies on storage.objects still carry NO tenant condition and no WITH CHECK:
--   "Authenticated Update for business-logos"  USING (bucket_id = 'business-logos')
--   providers_logos_auth_update                USING (bucket_id = 'providers-logos')
-- Any authenticated user can therefore still UPDATE a row in those two buckets — including
-- renaming it into another tenant's folder — which bypasses the scoping added below. No client
-- call site uses upsert on either bucket, so tightening them looks safe, but it is an UPDATE
-- change and this migration was scoped to INSERT/DELETE. `products` has no UPDATE policy, so
-- that bucket is not exposed this way.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────
-- GRANDFATHER CLAUSE — TEMPORARY, REMOVE AFTER THE BACKFILL
--
-- 180 `products` objects and 10 `business-logos` objects still live on legacy unscoped paths
-- (`<random>.<ext>`, `logos/<random>.<ext>`, `profile/<uuid>/logo-*.jpg`). Until the backfill
-- moves them, managers must keep being able to act on those names, otherwise editing an existing
-- product image breaks. This predicate is the ONLY place that permits it.
--
-- TO REMOVE once the backfill reports zero flat objects: replace the single SELECT line in the
-- body below with `SELECT false` and re-run this file (or DROP the function and the policies
-- that reference it will need re-creating — prefer the one-line edit). Nothing else changes.
-- ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storage_legacy_flat_path(object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- ▼▼ THE ONE LINE TO REPLACE WITH `SELECT false` WHEN THE BACKFILL IS DONE ▼▼
  SELECT split_part(object_name, '/', 1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  -- ▲▲ true = the first path segment is not a business id, i.e. a legacy object ▲▲
$$;

COMMENT ON FUNCTION public.storage_legacy_flat_path(text) IS
  'TEMPORARY grandfather predicate for the pre-2026-08-04 flat storage namespace. True when the '
  'first path segment is not a uuid. Replace the body with SELECT false once the flat-object '
  'backfill reports zero remaining objects — that single edit makes every storage policy strict.';

-- Default ACL on a new function is EXECUTE to PUBLIC — pin it.
REVOKE ALL ON FUNCTION public.storage_legacy_flat_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_legacy_flat_path(text) TO authenticated;

-- ── products ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "products_insert_managers" ON storage.objects;
CREATE POLICY "products_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
          OR public.storage_legacy_flat_path(name)  -- grandfather; see note above
        )
      )
    )
  );

DROP POLICY IF EXISTS "products_delete_managers" ON storage.objects;
CREATE POLICY "products_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'products'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
          OR public.storage_legacy_flat_path(name)  -- grandfather; see note above
        )
      )
    )
  );

-- ── business-logos ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "business_logos_insert_managers" ON storage.objects;
CREATE POLICY "business_logos_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-logos'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
          OR public.storage_legacy_flat_path(name)  -- grandfather; see note above
        )
      )
    )
  );

DROP POLICY IF EXISTS "business_logos_delete_managers" ON storage.objects;
CREATE POLICY "business_logos_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'business-logos'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
          OR public.storage_legacy_flat_path(name)  -- grandfather; see note above
        )
      )
    )
  );

-- ── providers-logos ──────────────────────────────────────────────────────────────
-- Providers ARE tenant-owned: public.providers carries "DigiCom Business" and all 6 rows have it
-- set. The bucket is empty (0 objects) and no client call site writes to it — providers.logo_url
-- holds dead URLs and every display path resolves preset assets from /public/providers instead
-- (src/lib/providerLogos.ts). With nothing to grandfather, these two policies are STRICT: no
-- legacy branch, so they need no edit when the backfill lands.
DROP POLICY IF EXISTS "providers_logos_insert_managers" ON storage.objects;
CREATE POLICY "providers_logos_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'providers-logos'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
      )
    )
  );

DROP POLICY IF EXISTS "providers_logos_delete_managers" ON storage.objects;
CREATE POLICY "providers_logos_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'providers-logos'
    AND (
      (SELECT public.is_owner())
      OR (
        public.check_user_role((SELECT auth.uid()), ARRAY['super admin','admin','business owner'])
        AND split_part(name, '/', 1) = ((SELECT public.current_user_digicom_business_id()))::text
      )
    )
  );

COMMIT;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────
-- Restores the 20260804100000 predicates (role check only, no tenant condition). Run as
-- supabase_admin. Safe at any time; the tenant-scoped object paths written by the frontend keep
-- working under the looser policies, so no data has to move back.
--
-- BEGIN;
--   DROP POLICY IF EXISTS "products_insert_managers" ON storage.objects;
--   CREATE POLICY "products_insert_managers" ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'products'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP POLICY IF EXISTS "products_delete_managers" ON storage.objects;
--   CREATE POLICY "products_delete_managers" ON storage.objects FOR DELETE TO authenticated
--     USING (bucket_id = 'products'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP POLICY IF EXISTS "business_logos_insert_managers" ON storage.objects;
--   CREATE POLICY "business_logos_insert_managers" ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'business-logos'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP POLICY IF EXISTS "business_logos_delete_managers" ON storage.objects;
--   CREATE POLICY "business_logos_delete_managers" ON storage.objects FOR DELETE TO authenticated
--     USING (bucket_id = 'business-logos'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP POLICY IF EXISTS "providers_logos_insert_managers" ON storage.objects;
--   CREATE POLICY "providers_logos_insert_managers" ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'providers-logos'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP POLICY IF EXISTS "providers_logos_delete_managers" ON storage.objects;
--   CREATE POLICY "providers_logos_delete_managers" ON storage.objects FOR DELETE TO authenticated
--     USING (bucket_id = 'providers-logos'
--       AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])));
--   DROP FUNCTION IF EXISTS public.storage_legacy_flat_path(text);
-- COMMIT;
