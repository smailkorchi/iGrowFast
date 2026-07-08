// Renderable media URL resolution.
//
// R2 media lives behind a PUBLIC Cloudflare custom domain (media.igrowfast.com)
// with a capability-token path (instance/conversation/message UUIDs = 366 bits;
// no LIST endpoint). The URL is built entirely client-side from the message row
// the thread query already returned — which the caller only HAS because it
// passed RLS on that thread query. So there is no separate media authz step:
// the thread RLS is the gate (unassigned → empty thread → no bubbles → no URLs).
//
// This retires the `media-sign` edge function (enterprise audit): every
// attachment render used to invoke an edge function that did an RLS SELECT of
// the same row already in hand, then returned this exact URL. At 1000 tenants
// that was an edge invocation + a messages_decrypted read per rendered media.
// Now: zero network calls. The pending→ready transition rides the message-row
// realtime UPDATE (the worker flips media_pending + sets the key after upload),
// so the bubble flips from skeleton to media without polling.

import { useMemo } from 'react'

// R2 custom domain. Override via VITE_R2_MEDIA_PUBLIC_DOMAIN; default matches the
// edge function's R2_MEDIA_PUBLIC_DOMAIN so URLs are byte-identical.
const R2_MEDIA_DOMAIN =
  (import.meta.env.VITE_R2_MEDIA_PUBLIC_DOMAIN as string | undefined) ?? 'media.igrowfast.com'

/** Build the public R2 URL from a storage key — identical to what media-sign
 *  returned (per-segment encodeURIComponent, joined by '/'). */
function buildMediaUrl(key: string): string {
  return `https://${R2_MEDIA_DOMAIN}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export interface ResolvedMedia {
  url:     string | null
  pending: boolean
  expired: boolean
  mime:    string | null
}

/**
 * Resolve a renderable media URL for a message row.
 *   1. storage key present & not pending → public R2 URL (built client-side)
 *   2. media_pending=true                → worker still fetching; render skeleton
 *   3. otherwise                         → no media / terminal; render fallback
 *
 * All chat media lives in R2; there is no other source (the deprecated
 * media_url column was dropped in migration media_unify_drop_media_url).
 */
export function useResolvedMediaUrl(msg: {
  id?:                string | null
  media_storage_key?: string | null
  media_pending?:     boolean | null
  media_mime?:        string | null
}): ResolvedMedia {
  const key     = msg.media_storage_key ?? null
  const pending = msg.media_pending ?? false
  const mime    = msg.media_mime ?? null
  return useMemo<ResolvedMedia>(() => {
    if (key && !pending) {
      return { url: buildMediaUrl(key), pending: false, expired: false, mime }
    }
    if (pending) {
      return { url: null, pending: true, expired: false, mime }
    }
    return { url: null, pending: false, expired: true, mime }
  }, [key, pending, mime])
}
