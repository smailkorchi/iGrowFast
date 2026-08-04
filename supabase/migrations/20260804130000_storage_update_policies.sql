-- Close the UPDATE half of the storage policy hole.
--
-- 20260804100000 fixed INSERT and DELETE; 20260804120000 scoped them per tenant. UPDATE was left
-- untouched and is just as wide — every one of these was `USING (bucket_id = '<name>')` with no
-- tenant, path or role condition, and in most cases no WITH CHECK at all (so the NEW row was
-- unconstrained even where the old one was):
--
--   avatar_auth_update                     -> any authenticated user could overwrite ANY user's avatar
--   "Authenticated Update for business-logos" -> any authenticated user could overwrite any tenant's logo
--   "campaign-media authenticated update"  -> same, campaign media
--   providers_logos_auth_update            -> same, provider logos
--   mb_avatar_update / mb_campaign_media_update -> the mediabuyer-role equivalents
--
-- An UPDATE on storage.objects can change `name`, so an unconstrained UPDATE is also a rename:
-- it lets one tenant move another tenant's object out from under them. Both USING and WITH CHECK
-- are set on every policy below, so neither the object you touch nor the state you leave it in
-- can belong to someone else.
--
-- Grandfather: same helper as 20260804120000 — public.storage_legacy_flat_path(name) — so the
-- objects still on flat paths keep working until the backfill finishes. Remove it there, once.
--
-- Rollback: DROP each policy below and recreate the originals as USING (bucket_id = '<name>').

BEGIN;

-- ── avatar: your own file, or a role that administers users ──────────────────────
DROP POLICY IF EXISTS "avatar_auth_update" ON storage.objects;
CREATE POLICY "avatar_update_own_or_manager" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatar'
    AND (
      name LIKE 'self/' || auth.uid()::text || '.%'
      OR public.is_owner()
      OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
    )
  )
  WITH CHECK (
    bucket_id = 'avatar'
    AND (
      name LIKE 'self/' || auth.uid()::text || '.%'
      OR public.is_owner()
      OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
    )
  );

DROP POLICY IF EXISTS "mb_avatar_update" ON storage.objects;
CREATE POLICY "mb_avatar_update_own" ON storage.objects
  FOR UPDATE TO mediabuyer
  USING (bucket_id = 'avatar' AND name LIKE 'self/' || auth.uid()::text || '.%')
  WITH CHECK (bucket_id = 'avatar' AND name LIKE 'self/' || auth.uid()::text || '.%');

-- ── business-logos: managers, own business folder (legacy flat paths still allowed) ──
DROP POLICY IF EXISTS "Authenticated Update for business-logos" ON storage.objects;
CREATE POLICY "business_logos_update_scoped" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-logos'
    AND (
      public.is_owner()
      OR (
        public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
          OR public.storage_legacy_flat_path(name)
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'business-logos'
    AND (
      public.is_owner()
      OR (
        public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
        AND (
          split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
          OR public.storage_legacy_flat_path(name)
        )
      )
    )
  );

-- ── providers-logos: managers only; bucket is empty, so no legacy branch needed ──
DROP POLICY IF EXISTS "providers_logos_auth_update" ON storage.objects;
CREATE POLICY "providers_logos_update_managers" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'providers-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  )
  WITH CHECK (
    bucket_id = 'providers-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

-- ── campaign-media: already stored under a business folder (0 flat paths measured) ──
DROP POLICY IF EXISTS "campaign-media authenticated update" ON storage.objects;
CREATE POLICY "campaign_media_update_scoped" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'campaign-media'
    AND (
      public.is_owner()
      OR (
        public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
        AND split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'campaign-media'
    AND (
      public.is_owner()
      OR (
        public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
        AND split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
      )
    )
  );

DROP POLICY IF EXISTS "mb_campaign_media_update" ON storage.objects;
CREATE POLICY "mb_campaign_media_update_scoped" ON storage.objects
  FOR UPDATE TO mediabuyer
  USING (
    bucket_id = 'campaign-media'
    AND split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
  )
  WITH CHECK (
    bucket_id = 'campaign-media'
    AND split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
  );

COMMIT;

-- Addendum: the last unscoped write policy on storage.objects. Media buyers could delete ANY
-- campaign-media object, including another tenant's. Same scoping as their update policy.
BEGIN;
DROP POLICY IF EXISTS "mb_campaign_media_delete" ON storage.objects;
CREATE POLICY "mb_campaign_media_delete_scoped" ON storage.objects
  FOR DELETE TO mediabuyer
  USING (
    bucket_id = 'campaign-media'
    AND split_part(name, '/', 1) = (SELECT public.current_user_digicom_business_id())::text
  );
COMMIT;
