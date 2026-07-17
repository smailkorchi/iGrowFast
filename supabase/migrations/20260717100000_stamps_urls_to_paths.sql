-- #44 step 2: businesses.cachet_url / signature_url switch from public
-- business-logos URLs to bare storage paths (objects already copied into the
-- private business-stamps bucket). Client resolveStampUrl() handles both forms,
-- so ordering vs the SPA deploy is safe either way.
BEGIN;
UPDATE public.businesses
SET cachet_url = regexp_replace(cachet_url, '^https?://[^/]+/storage/v1/object/public/business-logos/', '')
WHERE cachet_url LIKE '%/storage/v1/object/public/business-logos/%';
UPDATE public.businesses
SET signature_url = regexp_replace(signature_url, '^https?://[^/]+/storage/v1/object/public/business-logos/', '')
WHERE signature_url LIKE '%/storage/v1/object/public/business-logos/%';
COMMIT;
