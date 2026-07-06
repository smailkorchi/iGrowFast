// Profile-picture (avatar) caching to R2.
//
// WhatsApp profile-picture URLs (pps.whatsapp.net / *.fbcdn.net) are signed
// with a short-lived expiry (the `oe`/`oh` query params). Once that lapses —
// or the contact changes their photo — the CDN returns 404. Storing those raw
// URLs in the DB and rendering them directly is the root cause of the broken
// avatars + console 404 spam.
//
// Fix: the moment the worker learns a profile-picture URL from Evolution, it
// downloads the bytes once and uploads them to our own R2 bucket under a
// content-addressed, immutable key, then stores the stable
// `https://<mediaPublicHost>/<key>` URL instead. That URL never expires.
//
// Content addressing: the key is derived from the URL *path* (which contains
// WhatsApp's own photo id and is stable per photo version) — NOT the full URL,
// because the signature query params rotate on every fetch even for the same
// photo. Same photo ⇒ same key ⇒ HEAD hit, no re-download. Changed photo ⇒
// new path ⇒ new key ⇒ new object; the old one is reaped by the bucket's
// 365-day lifecycle rule.

import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { log } from '../logger.js'
import { mediaExists, putMedia } from './client.js'

const AVATAR_PREFIX = 'avatars'
const FETCH_TIMEOUT_MS = 8000
// Profile pictures are tiny; anything larger than this is not an avatar and we
// refuse to cache it (defensive cap against a mis-pointed URL).
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** True if the URL is already one of our cached R2 avatar URLs. */
export function isCachedAvatar(url: string | null | undefined): boolean {
  if (!url) return false
  return url.includes(`${config.mediaPublicHost}/${AVATAR_PREFIX}/`)
}

/** True if the host is a WhatsApp/Facebook media CDN we know expires. */
function isWhatsAppCdn(hostname: string): boolean {
  return (
    hostname.endsWith('whatsapp.net') ||
    hostname.endsWith('fbcdn.net') ||
    hostname.endsWith('cdninstagram.com')
  )
}

function avatarKey(instanceId: string, pathname: string): string {
  const token = createHash('sha256').update(pathname).digest('hex').slice(0, 32)
  return `${AVATAR_PREFIX}/${instanceId}/${token}.jpg`
}

/**
 * Resolve a raw WhatsApp profile-picture URL to a stable, cached R2 URL.
 *
 * Returns:
 *   - the cached `https://<mediaPublicHost>/avatars/...` URL on success
 *   - the input unchanged if it is already a cached URL
 *   - `null` if the input is empty, not a WA CDN URL, or the fetch/upload
 *     fails. Callers store the result through COALESCE, so a `null` never
 *     overwrites a previously-cached value — it just declines to update.
 */
export async function cacheAvatar(
  instanceId: string,
  waUrl: string | null | undefined,
): Promise<string | null> {
  if (!waUrl) return null
  if (isCachedAvatar(waUrl)) return waUrl

  let parsed: URL
  try {
    parsed = new URL(waUrl)
  } catch {
    return null
  }
  // Only cache from known-expiring CDNs. Anything else (e.g. an already-stable
  // URL on some other host) we leave alone rather than risk mangling it.
  if (!isWhatsAppCdn(parsed.hostname)) return null

  const key = avatarKey(instanceId, parsed.pathname)
  const publicUrl = `https://${config.mediaPublicHost}/${key}`

  try {
    if (await mediaExists(key)) return publicUrl

    const res = await fetch(waUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      log.debug('avatar.fetch_not_ok', { instance_id: instanceId, status: res.status })
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) return null

    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
    if (!mime.startsWith('image/')) return null

    await putMedia({ key, body: buf, mimeType: mime })
    log.debug('avatar.cached', { instance_id: instanceId, key, bytes: buf.length })
    return publicUrl
  } catch (err) {
    log.warn('avatar.cache_failed', {
      instance_id: instanceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
