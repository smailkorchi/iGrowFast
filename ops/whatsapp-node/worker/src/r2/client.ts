// Cloudflare R2 client.
//
// R2 speaks S3 with SigV4; we use @aws-sdk/client-s3 against the
// jurisdiction-specific endpoint with `region: 'auto'`. The worker only does
// two ops on the hot path:
//   - putObject  — uploaded media (called by media-ingest loop on inbound)
//   - getObject  — fetched bytes (called by outbound dispatcher when sending)
// Presigned URL generation lives in the Edge Function (media-sign), not here:
// the worker's R2 token must never leave the host.

import { createHash } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { config } from '../config.js'
import { log } from '../logger.js'

const client = new S3Client({
  region: 'auto',
  endpoint: config.r2MediaEndpoint,
  credentials: {
    accessKeyId:     config.r2MediaAccessKeyId,
    secretAccessKey: config.r2MediaSecretAccessKey,
  },
  // R2 expects path-style addressing for the jurisdiction endpoint.
  forcePathStyle: true,
})

export const MEDIA_BUCKET = config.r2MediaBucket

export interface UploadResult {
  bucket:    string
  key:       string
  sizeBytes: number
  mimeType:  string
  sha256:    Buffer        // raw 32 bytes (DB stores bytea)
}

/**
 * Upload a binary blob to R2. The body is hashed once (SHA-256) before
 * upload so the worker can later prove integrity and dedupe identical media.
 * Cache headers are set generously — keys are content-addressed by msg_id,
 * so once an object is at a key, it never changes.
 */
export async function putMedia(args: {
  key:       string
  body:      Buffer
  mimeType:  string
  /** Original WA filename (if any). Stored as content-disposition for downloads. */
  filename?: string | null
}): Promise<UploadResult> {
  const sha = createHash('sha256').update(args.body).digest()

  const cmd = new PutObjectCommand({
    Bucket:        MEDIA_BUCKET,
    Key:           args.key,
    Body:          args.body,
    ContentType:   args.mimeType,
    ContentLength: args.body.length,
    // public+immutable so Cloudflare edge (when wamancer-media is fronted by a
    // custom domain) can cache between requests. Signed URLs are the access
    // gate; the cache key is per-URL so different presigned signatures resolve
    // to distinct cache entries. The bytes themselves are immutable per key.
    CacheControl:  'public, max-age=31536000, immutable',
    // R2 ignores SSE headers (everything is server-side encrypted by default),
    // but setting them is harmless and helps SDK validation.
    ChecksumSHA256: sha.toString('base64'),
    ...(args.filename
      ? { ContentDisposition: buildContentDisposition(args.filename) }
      : {}),
    Metadata: {
      'wa-uploaded-at': new Date().toISOString(),
    },
  })

  await client.send(cmd)

  log.debug('r2.put_ok', {
    bucket: MEDIA_BUCKET,
    key:    args.key,
    bytes:  args.body.length,
    mime:   args.mimeType,
  })

  return {
    bucket:    MEDIA_BUCKET,
    key:       args.key,
    sizeBytes: args.body.length,
    mimeType:  args.mimeType,
    sha256:    sha,
  }
}

/**
 * Fetch an object's bytes from R2. Used by the outbound dispatcher when it
 * needs to base64-encode media for Evolution's /message/sendMedia.
 */
export async function getMediaBytes(key: string): Promise<{
  body:     Buffer
  mimeType: string | null
}> {
  const cmd = new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key })
  const out: GetObjectCommandOutput = await client.send(cmd)

  // Node SDK returns body as a Readable; collect to Buffer.
  if (!out.Body) throw new Error(`r2 get: empty body for ${key}`)
  const chunks: Buffer[] = []
  for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return {
    body:     Buffer.concat(chunks),
    mimeType: out.ContentType ?? null,
  }
}

/** Cheap existence check; used by backfill jobs to skip already-uploaded keys. */
export async function mediaExists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }))
    return true
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return false
    throw err
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg':       'jpg',
  'image/jpg':        'jpg',
  'image/png':        'png',
  'image/gif':        'gif',
  'image/webp':       'webp',
  'image/heic':       'heic',
  'video/mp4':        'mp4',
  'video/3gpp':       '3gp',
  'video/quicktime':  'mov',
  'video/webm':       'webm',
  'audio/ogg':        'ogg',
  'audio/mpeg':       'mp3',
  'audio/mp4':        'm4a',
  'audio/aac':        'aac',
  'audio/wav':        'wav',
  'audio/x-wav':      'wav',
  'application/pdf':            'pdf',
  'application/zip':            'zip',
  'application/msword':         'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel':   'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain':       'txt',
  'text/csv':         'csv',
  'application/octet-stream':   'bin',
}

/** Returns a safe extension for a given mime; falls back to 'bin'. */
export function extForMime(mime: string | null | undefined): string {
  if (!mime) return 'bin'
  const lower = mime.toLowerCase().split(';')[0]?.trim() ?? 'bin'
  return EXT_BY_MIME[lower] ?? 'bin'
}

/**
 * Build the canonical R2 storage key.
 *   <instance_id>/<conversation_id>/<message_id>.<ext>
 *
 * Format is content-addressed by message_id (uuid) — guarantees uniqueness
 * across instances/conversations and makes lifecycle rules trivial later.
 */
export function buildMediaKey(args: {
  instanceId:     string
  conversationId: string
  messageId:      string
  mime:           string | null
}): string {
  const ext = extForMime(args.mime)
  return `${args.instanceId}/${args.conversationId}/${args.messageId}.${ext}`
}

/**
 * Build an RFC 6266 / RFC 5987 compliant Content-Disposition header.
 *
 * HTTP header values must be visible ASCII (0x20-0x7E). The previous version
 * just stripped CRLF/quotes and shipped raw bytes — that throws
 * "Invalid character in header content" the moment a filename contains
 * Arabic/CJK/accented letters (a real case in WA documents).
 *
 * Fix: ship BOTH forms. ASCII-only `filename=` as the legacy fallback, plus
 * `filename*=UTF-8''<percent-encoded>` per RFC 5987 so modern clients render
 * the original name.
 */
function buildContentDisposition(name: string): string {
  const truncated = name.slice(0, 200)
  // ASCII fallback: replace anything outside printable ASCII (and quote/backslash)
  // with '_' so the legacy `filename=` value is always header-safe.
  const ascii = truncated.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  // RFC 5987: token chars stay, everything else percent-encoded — including
  // non-ASCII bytes, which is the whole point of this fix.
  const utf8 = encodeURIComponent(truncated)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
