// Signed media URL hook.
//
// Frontend never reads the R2 URL directly; it invokes the `media-sign`
// edge function, which (a) checks RLS via the caller's JWT and (b) signs
// a 5-minute presigned GET URL with the worker-class R2 token held as an
// edge secret. Hooks refresh the URL well before TTL so <img>/<audio>
// streams stay valid through long-running playback.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

export interface SignedMedia {
  url:        string
  expires_at: string
  mime:       string | null
  size_bytes: number | null
  filename:   string | null
}

export type MediaSignError =
  | 'forbidden'
  | 'not_found'
  | 'pending'
  | 'no_media'
  | 'signing_failed'
  | 'unknown'

interface SignResponse {
  ok:         boolean
  url?:       string
  expires_at?:string
  mime?:      string | null
  size_bytes?:number | null
  filename?:  string | null
  reason?:    MediaSignError | string
}

async function signMedia(messageId: string): Promise<SignedMedia> {
  const { data, error } = await supabase.functions.invoke<SignResponse>('media-sign', {
    body: { message_id: messageId },
  })
  if (error) {
    // FunctionsHttpError surfaces non-2xx as `error`; the body may carry a
    // typed reason. supabase-js exposes it via error.context.
    const ctx = (error as { context?: { json?: () => Promise<SignResponse> } }).context
    const body = await ctx?.json?.().catch(() => undefined)
    throw new MediaError((body?.reason as MediaSignError | undefined) ?? 'unknown')
  }
  if (!data?.ok || !data.url || !data.expires_at) {
    throw new MediaError((data?.reason as MediaSignError) ?? 'unknown')
  }
  return {
    url:        data.url,
    expires_at: data.expires_at,
    mime:       data.mime ?? null,
    size_bytes: data.size_bytes ?? null,
    filename:   data.filename ?? null,
  }
}

export class MediaError extends Error {
  override readonly name = 'MediaError'
  readonly reason: MediaSignError
  constructor(reason: MediaSignError) {
    super(reason)
    this.reason = reason
  }
}

/**
 * Resolve a renderable media URL for a message row.
 *
 * Resolution order:
 *   1. R2 storage key present  → signed URL via `media-sign` edge function
 *   2. `media_pending=true`    → worker is still fetching; render skeleton
 *   3. Otherwise               → terminal failure; render "Média indisponible"
 *
 * All chat media lives in Cloudflare R2; there is no other source. Old
 * Evolution CDN URLs do not exist as a fallback because the deprecated
 * `media_url` column was dropped in migration `media_unify_drop_media_url`.
 */
export interface ResolvedMedia {
  url:     string | null
  pending: boolean
  expired: boolean
  mime:    string | null
}

export function useResolvedMediaUrl(msg: {
  id?:                 string | null
  media_storage_key?:  string | null
  media_pending?:      boolean | null
  media_mime?:         string | null
}): ResolvedMedia {
  const useSigned = !!msg.media_storage_key && !!msg.id
  // Hook MUST be called unconditionally; pass null id to disable.
  const signed = useSignedMedia(useSigned ? msg.id! : null, { enabled: useSigned })

  if (useSigned) {
    if (signed.data?.url) {
      return { url: signed.data.url, pending: false, expired: false, mime: signed.data.mime }
    }
    if (signed.error instanceof MediaError && signed.error.reason === 'pending') {
      return { url: null, pending: true, expired: false, mime: msg.media_mime ?? null }
    }
    if (signed.isPending) {
      return { url: null, pending: true, expired: false, mime: msg.media_mime ?? null }
    }
    // Hard error from signing: forbidden / not_found / no_media / signing_failed.
    return { url: null, pending: false, expired: true, mime: msg.media_mime ?? null }
  }

  if (msg.media_pending) {
    return { url: null, pending: true, expired: false, mime: msg.media_mime ?? null }
  }
  return { url: null, pending: false, expired: true, mime: msg.media_mime ?? null }
}

/**
 * useSignedMedia(messageId)
 *   - Returns `{ url, expires_at, mime, size_bytes, filename }` for a
 *     `<img|video|audio src>` once the R2 object exists and the caller has
 *     RLS access.
 *   - Auto-refreshes 30s before TTL expiry, so streaming media doesn't
 *     break mid-playback.
 *   - Re-tries every 5s on `pending` (worker is still uploading) so the
 *     bubble flips from skeleton to real media within seconds.
 *
 * Pass `enabled=false` to defer fetching (e.g. while bubble is offscreen).
 */
export function useSignedMedia(
  messageId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && !!messageId
  return useQuery<SignedMedia, MediaError>({
    queryKey: ['media-sign', messageId],
    enabled,
    queryFn: () => signMedia(messageId!),
    // URLs are now permanent (public R2 custom domain, no signature expiry).
    // Re-check RLS every 30 min in case the user gets unassigned from the
    // conversation. While the worker is still uploading, poll every 5s.
    staleTime: 25 * 60 * 1000,
    refetchInterval: (q) => {
      if (q.state.error instanceof MediaError && q.state.error.reason === 'pending') {
        return 5_000
      }
      return 25 * 60 * 1000
    },
    refetchOnWindowFocus: false,
    // Don't retry forbidden / not_found / no_media -- they're terminal.
    retry: (failureCount, err) => {
      if (err instanceof MediaError) {
        if (err.reason === 'forbidden' || err.reason === 'not_found' || err.reason === 'no_media') {
          return false
        }
      }
      return failureCount < 2
    },
  })
}
