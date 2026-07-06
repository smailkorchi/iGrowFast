// Link-preview helpers for the composer and inbound message bubbles.
// The actual scraping happens server-side in supabase/functions/og-fetch
// (SSRF-hardened). This module:
//   - extracts the first URL from arbitrary text (markdown-friendly)
//   - calls og-fetch with a per-session in-memory cache + in-flight dedupe
//   - exposes a tiny React hook for the composer

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export interface OgPreview {
  url: string
  canonical: string | null
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
  domain: string
}

// URL regex: http(s)://… up to whitespace / common terminators. Conservative
// enough that "see https://foo.com." matches "https://foo.com" without the
// trailing period. We trim trailing punctuation in trimTrailing().
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i

export function extractFirstUrl(text: string): string | null {
  const m = URL_RE.exec(text)
  if (!m) return null
  return trimTrailing(m[0])
}

/** Match every URL in a text — used to linkify bubble bodies. */
export function findAllUrls(text: string): Array<{ start: number; end: number; url: string }> {
  const re = /\bhttps?:\/\/[^\s<>"']+/gi
  const out: Array<{ start: number; end: number; url: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const trimmed = trimTrailing(m[0])
    out.push({ start: m.index, end: m.index + trimmed.length, url: trimmed })
  }
  return out
}

function trimTrailing(u: string): string {
  // Strip trailing punctuation that's almost never part of a URL.
  return u.replace(/[)\]\}>.,;!?'"]+$/g, '')
}

// ─── cache + in-flight dedupe ───────────────────────────────────────────────
const cache = new Map<string, OgPreview | null>()
const inflight = new Map<string, Promise<OgPreview | null>>()

export async function fetchOgPreview(rawUrl: string): Promise<OgPreview | null> {
  const url = trimTrailing(rawUrl)
  if (cache.has(url)) return cache.get(url) ?? null
  const existing = inflight.get(url)
  if (existing) return existing

  const p = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; preview?: OgPreview }>(
        'og-fetch',
        { body: { url } },
      )
      if (error || !data?.ok || !data.preview) {
        cache.set(url, null)
        return null
      }
      cache.set(url, data.preview)
      return data.preview
    } catch {
      cache.set(url, null)
      return null
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, p)
  return p
}

/**
 * Hook for the composer: watches `text`, extracts the first URL, debounces,
 * fetches preview, exposes a dismissible card. Returns null preview when
 * the user types over the URL or dismisses the card.
 */
export function useComposerLinkPreview(text: string, debounceMs = 400) {
  const [preview, setPreview] = useState<OgPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const dismissedRef = useRef<Set<string>>(new Set())
  const lastUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const url = extractFirstUrl(text)
    // If text no longer contains a URL, clear.
    if (!url) {
      lastUrlRef.current = null
      setPreview(null)
      setLoading(false)
      return
    }
    // Same URL as currently displayed — nothing to do.
    if (url === lastUrlRef.current && preview && preview.url === url) return
    // User explicitly dismissed this URL — don't refetch.
    if (dismissedRef.current.has(url)) {
      setPreview(null)
      setLoading(false)
      return
    }
    lastUrlRef.current = url
    setLoading(true)

    let cancelled = false
    const t = setTimeout(async () => {
      const og = await fetchOgPreview(url)
      if (cancelled) return
      // Only commit if the URL is still relevant.
      if (lastUrlRef.current !== url) return
      setPreview(og)
      setLoading(false)
    }, debounceMs)
    return () => { cancelled = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const dismiss = () => {
    const url = lastUrlRef.current
    if (url) dismissedRef.current.add(url)
    setPreview(null)
    setLoading(false)
  }

  return { preview, loading, dismiss }
}

/** Pull a link-preview record out of a message's media_meta if present. */
export function previewFromMediaMeta(mediaMeta: unknown): OgPreview | null {
  if (!mediaMeta || typeof mediaMeta !== 'object') return null
  const m = mediaMeta as Record<string, unknown>
  const lp = m['link_preview'] as Record<string, unknown> | undefined
  if (!lp) return null
  const url = (lp['url'] ?? lp['canonical']) as string | undefined
  if (typeof url !== 'string') return null
  return {
    url,
    canonical: (lp['canonical']    as string | null | undefined) ?? null,
    title:       (lp['title']       as string | null | undefined) ?? null,
    description: (lp['description'] as string | null | undefined) ?? null,
    image:       (lp['image']       as string | null | undefined) ?? null,
    site_name:   (lp['site_name']   as string | null | undefined) ?? null,
    domain:      (lp['domain']      as string | undefined) ?? safeDomain(url),
  }
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
