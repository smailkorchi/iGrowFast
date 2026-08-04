-- Bucket-level upload limits: real byte caps + an explicit MIME allow-list per bucket.
--
-- ORDER OF DEPLOY — THIS MIGRATION GOES SECOND. It must not be applied before the
-- client compressor (src/lib/imageCompress.ts) is live in the deployed bundle, or
-- users uploading the same phone photos they upload today start hitting bucket
-- rejections. Every cap below is chosen to sit far above what that compressor can
-- emit, so once the bundle ships, no flow that works today can start failing:
--
--   preset   longest edge   encoder                        typical    worst realistic
--   avatar   512 px         JPEG q0.82                     40-80 KB   ~250 KB
--   logo     800 px         PNG (lossless, keeps alpha)    50-300 KB  ~1.9 MB (photo-like PNG)
--   product  1600 px        WebP q0.82 (JPEG fallback)     ~500 KB    ~1.2 MB
--   media    1920 px        WebP q0.82 (JPEG fallback)     ~800 KB    ~1.5 MB
--
-- avatar/logo cannot be WebP: @react-pdf/renderer embeds both (payout statements,
-- facture/devis/bon de livraison) and decodes JPEG + PNG only.
--
-- WHY THE MIME LISTS CHANGE: `image/*` is matched against the CLIENT-DECLARED
-- Content-Type — nothing sniffs the bytes — and it admits image/svg+xml. An SVG is
-- a script container; served from a PUBLIC bucket on our own origin it is stored
-- XSS. Every list below is explicit and excludes it. GIF is kept only where an
-- animation is legitimate (campaign creatives, demand attachments); the compressor
-- passes GIFs through untouched there and re-encodes them everywhere else.
--
-- WHAT THIS DOES NOT CLOSE: none of this constrains the CLIENT wrapper — the tus
-- resumable endpoint and the S3 endpoint accept the same JWT and skip every line of
-- React code. The bucket row IS the enforcement point, which is exactly why the
-- numbers live here.
--
-- ROLLBACK (values as measured on the box 2026-08-04, before this migration):
--   avatar          20971520  {image/*}
--   business-logos  10485760  {image/*}
--   business-stamps 10485760  NULL            -- no list at all
--   campaign-media  52428800  {image/*,video/*}
--   demand-media    52428800  {image/*,video/*,application/pdf}
--   payment-proofs  10485760  {image/*,application/pdf}
--   products        10485760  {image/*}
--   providers-logos  5242880  {image/*}
-- Restore with the same UPDATE shape, e.g.
--   UPDATE storage.buckets SET file_size_limit = 20971520,
--          allowed_mime_types = ARRAY['image/*'] WHERE id = 'avatar';
--
-- Buckets deliberately untouched: business-documents and documents (no images, lists
-- already explicit) and whatsapp-media (written by the WhatsApp worker, not by a
-- browser; it has no limits by design and sizing it is a separate decision).

BEGIN;

-- avatar — public. Only ever holds one small square per user. 2 MB is ~25x the
-- compressor's output and still refuses a camera original outright.
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'avatar';

-- business-logos — public, and embedded into every generated invoice. PNG is the
-- compressor's output here, so the cap must clear a lossless 800 px raster: 3 MB.
UPDATE storage.buckets
   SET file_size_limit = 3145728,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'business-logos';

-- business-stamps — private (cachet + signature). Same encoder and same PDF
-- consumers as the logos, so the same 3 MB. This bucket had NO allowed_mime_types
-- at all, i.e. it accepted executables and HTML; give it the image list.
UPDATE storage.buckets
   SET file_size_limit = 3145728,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'business-stamps';

-- products — public catalogue images, 1600 px WebP/JPEG. 4 MB is ~8x the worst
-- realistic encode and leaves room for a legacy re-upload.
UPDATE storage.buckets
   SET file_size_limit = 4194304,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'products';

-- providers-logos — public. No client upload site remains (logos are preset assets
-- under /public/providers, see src/lib/providerLogos.ts), so this is purely a
-- containment cap on a bucket nothing writes.
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'providers-logos';

-- campaign-media — public. Images are compressed to ~1 MB, but VIDEO is uploaded
-- untouched (no client-side transcode exists), so the 50 MB ceiling has to stay:
-- lowering it would break video ad uploads. The win here is the MIME list.
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'video/mp4', 'video/quicktime', 'video/webm'
       ]
 WHERE id = 'campaign-media';

-- demand-media — private support attachments: images (compressed), plus video and
-- PDF passed through. Same reasoning as campaign-media for the 50 MB.
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'video/mp4', 'video/quicktime', 'video/webm',
         'application/pdf'
       ]
 WHERE id = 'demand-media';

-- payment-proofs — private. Photos of a transfer receipt are compressed to ~1 MB;
-- the 10 MB stays for multi-page PDF bank statements, which are not compressible
-- client-side. GIF is listed because this upload uses the same 'media' preset as
-- the demand attachments, which passes a GIF through untouched — the client must
-- never be able to emit a type this bucket then refuses.
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
 WHERE id = 'payment-proofs';

COMMIT;
