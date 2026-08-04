-- Storage policy hardening: stop any authenticated user from writing or deleting
-- arbitrary objects in the shared public buckets.
--
-- Found while inventorying image uploads (Notion Ref 14). Five buckets carried policies whose
-- ONLY condition was the bucket name, granted to every authenticated user:
--
--   INSERT: products, business-logos, avatar, campaign-media, providers-logos
--   DELETE: products, business-logos, campaign-media, providers-logos
--
-- The DELETE half is the serious one. There is no tenant condition, so any logged-in user of
-- ANY business — a courier, a commercial — could delete every product image and every business
-- logo belonging to every tenant on the platform, straight from the console. Nothing in the UI
-- exposes that; the policy did.
--
-- WHAT THIS CHANGES: writes to these buckets now require a role that legitimately manages the
-- asset, and an ordinary user may only write their OWN avatar. Verified against the real call
-- sites before restricting, so no working flow loses access:
--   products        <- src/pages/admin/Products.tsx        (admin surface only; sellers never upload)
--   business-logos  <- src/components/businesses/AddEditBusinessModal.tsx, src/pages/admin/business/Overview.tsx
--   campaign-media  <- src/pages/mediabuyer/CampaignForm.tsx + Campaigns.tsx
--   avatar          <- src/lib/profile.ts (self/<uid>.png, every role) and
--                      src/pages/owner/Businesses.tsx (avatars/<random>, admin creating a user)
--   providers-logos <- no client call site found; kept at admin level
--
-- Media buyers authenticate under their own `mediabuyer` Postgres role, not `authenticated`
-- (see the mb_* policies), so their campaign-media access is untouched by the changes here.
--
-- WHAT THIS DOES NOT FIX: these buckets share a flat namespace — products and legacy avatars use
-- random filenames with no per-business folder — so objects still cannot be scoped to a tenant.
-- Closing that needs a path restructure plus a migration of existing objects, and is deliberately
-- left as follow-up. This migration removes the destructive capability, which is the acute risk.

BEGIN;

-- ── DELETE: was "any authenticated user, any object in the bucket" ────────────────
DROP POLICY IF EXISTS "Authenticated users can delete images" ON storage.objects;
CREATE POLICY "products_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'products'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

DROP POLICY IF EXISTS "Authenticated Delete for business-logos" ON storage.objects;
CREATE POLICY "business_logos_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'business-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

DROP POLICY IF EXISTS "providers_logos_auth_delete" ON storage.objects;
CREATE POLICY "providers_logos_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'providers-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

-- campaign-media: the blanket policy was granted to `public` and merely asserted that the caller
-- was authenticated. Media buyers keep their own mb_campaign_media_delete policy.
DROP POLICY IF EXISTS "campaign-media authenticated delete" ON storage.objects;
CREATE POLICY "campaign_media_delete_managers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'campaign-media'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

-- ── INSERT: same blanket problem ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
CREATE POLICY "products_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

DROP POLICY IF EXISTS "Authenticated Upload for business-logos" ON storage.objects;
CREATE POLICY "business_logos_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

DROP POLICY IF EXISTS "providers_logos_auth_insert" ON storage.objects;
CREATE POLICY "providers_logos_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'providers-logos'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

DROP POLICY IF EXISTS "campaign-media authenticated insert" ON storage.objects;
CREATE POLICY "campaign_media_insert_managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'campaign-media'
    AND (public.is_owner() OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner']))
  );

-- avatar: every role must keep uploading its OWN photo, so this stays open to all authenticated
-- users but is pinned to the caller's own object path. Admin-managed avatars (an admin creating a
-- user, which writes avatars/<random>) stay allowed for the roles that can create users.
-- Invitation avatars are written by the service role inside consume-invitation and bypass RLS.
DROP POLICY IF EXISTS "avatar_auth_insert" ON storage.objects;
CREATE POLICY "avatar_insert_own_or_manager" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatar'
    AND (
      name LIKE 'self/' || auth.uid()::text || '.%'
      OR public.is_owner()
      OR public.check_user_role(auth.uid(), ARRAY['super admin','admin','business owner'])
    )
  );

COMMIT;
