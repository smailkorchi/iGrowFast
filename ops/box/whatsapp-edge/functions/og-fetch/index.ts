// og-fetch
// Authenticated. Fetches a URL server-side and returns parsed Open Graph /
// Twitter Card / fallback metadata for the Conversations composer & link
// previews inside bubbles when we don't already have WhatsApp-provided
// metadata. SSRF-hardened: only http/https, no private/loopback hosts.
//
// Body:    { url: string }
// Returns: { ok: true, preview: {
//             url, canonical, title, description, image, site_name, domain
//           } }
//        | { ok: false, reason: 'invalid_input' | 'forbidden' | 'unfetchable'
//                              | 'timeout' | 'too_large' | 'not_html' }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { json, preflight } from '../_shared/cors.ts'
import { asCaller, admin } from '../_shared/admin.ts'
import { logError } from '../_shared/logError.ts'

const TIMEOUT_MS  = 6_000
const MAX_BYTES   = 1_500_000   // 1.5 MB HTML cap
const CACHE_TTL_MS = 24 * 60 * 60 * 1000   // 24 h link-preview cache
const UA          = 'Mozilla/5.0 (compatible; iGrowFast/1.0; +https://igrowfast.com) link-preview/og-fetch'

Deno.serve(async (req) => {
  try {
    const pre = preflight(req); if (pre) return pre
    if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, { status: 405 })

    // Auth: any authenticated user can request a preview (no admin gate).
    const auth = req.headers.get('authorization') ?? ''
    if (!auth.toLowerCase().startsWith('bearer ')) {
      return json({ ok: false, reason: 'forbidden' }, { status: 401 })
    }
    const jwt = auth.slice(7).trim()
    const caller = asCaller(jwt)
    const { data: u, error: ue } = await caller.auth.getUser()
    if (ue || !u?.user) return json({ ok: false, reason: 'forbidden' }, { status: 401 })

    let body: unknown
    try { body = await req.json() }
    catch { return json({ ok: false, reason: 'invalid_input' }, { status: 400 }) }

    const url = (body as { url?: unknown } | null)?.url
    if (typeof url !== 'string' || url.length > 2048) {
      return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
    }

    const parsed = safeParseUrl(url)
    if (!parsed) return json({ ok: false, reason: 'invalid_input' }, { status: 400 })
    if (!isSafeHost(parsed.hostname)) {
      return json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }
    // Cache read-probe (after the cheap host-safety check, before DNS/fetch). Content-addressed
    // by the requested href; shared across all callers (no auth dimension). Best-effort.
    const reqHash = await sha256hex(parsed.href)
    try {
      const { data: hit } = await admin.schema('whatsapp').from('og_cache')
        .select('payload, fresh_until').eq('url_hash', reqHash).maybeSingle()
      if (hit?.payload && new Date(hit.fresh_until as string).getTime() > Date.now()) {
        return json({ ok: true, preview: hit.payload })
      }
    } catch { /* cache miss / unavailable → fall through to live fetch */ }
    // DNS-resolution validation: defeats rebinding & non-canonical IP literals
    // that pass the string check above.
    try {
      await assertResolvedHostSafe(parsed.hostname)
    } catch {
      return json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(parsed.href, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent': UA,
          'accept': 'text/html,application/xhtml+xml',
          'accept-language': 'fr,en;q=0.9',
        },
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(t)
      const msg = (e as Error)?.name === 'AbortError' ? 'timeout' : 'unfetchable'
      return json({ ok: false, reason: msg }, { status: 200 })
    }
    clearTimeout(t)

    // Final URL after redirects must also be safe-host.
    const finalUrl = safeParseUrl(res.url)
    if (!finalUrl || !isSafeHost(finalUrl.hostname)) {
      return json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }
    try {
      await assertResolvedHostSafe(finalUrl.hostname)
    } catch {
      return json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }

    const ct = res.headers.get('content-type') ?? ''
    if (!ct.toLowerCase().includes('html')) {
      return json({ ok: false, reason: 'not_html' }, { status: 200 })
    }

    // Cap the body we read; tag URLs almost always live in the first ~100 KB
    // of <head>, so we don't need the whole document.
    const reader = res.body?.getReader()
    if (!reader) return json({ ok: false, reason: 'unfetchable' }, { status: 200 })
    const chunks: Uint8Array[] = []
    let read = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      read += value.length
      if (read >= MAX_BYTES) { await reader.cancel(); break }
    }
    const buf = concat(chunks, Math.min(read, MAX_BYTES))
    const charset = guessCharset(ct, buf)
    const html = new TextDecoder(charset).decode(buf)

    const preview = parsePreview(html, finalUrl.href)
    // Write-back (only on success, after BOTH pre- and post-redirect SSRF checks). Cache under the
    // final href and, if redirected, also the requested href so the next request short-circuits.
    try {
      const exp = new Date(Date.now() + CACHE_TTL_MS).toISOString()
      const nowIso = new Date().toISOString()
      const finalHash = await sha256hex(finalUrl.href)
      const rows = [{ url_hash: finalHash, url: finalUrl.href, payload: preview, fetched_at: nowIso, fresh_until: exp }]
      if (reqHash !== finalHash) rows.push({ url_hash: reqHash, url: parsed.href, payload: preview, fetched_at: nowIso, fresh_until: exp })
      await admin.schema('whatsapp').from('og_cache').upsert(rows, { onConflict: 'url_hash' })
    } catch { /* cache write best-effort; never fail the response on it */ }
    return json({ ok: true, preview })
  } catch (e) {
    console.error('og-fetch uncaught', e)
    logError('og-fetch', e, { status: 500 })
    return json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
})

// ─── helpers ────────────────────────────────────────────────────────────────

async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function safeParseUrl(s: string): URL | null {
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u
  } catch { return null }
}

const PRIVATE_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '::',
])
function isSafeHost(host: string): boolean {
  const h = host.toLowerCase()
  if (PRIVATE_HOSTS.has(h)) return false
  // IPv4 private blocks: 10/8, 172.16/12, 192.168/16, 169.254/16
  if (/^10\./.test(h)) return false
  if (/^192\.168\./.test(h)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
  if (/^169\.254\./.test(h)) return false
  if (/^127\./.test(h)) return false
  // Plain numeric IPv6 fc00::/7 (unique local)
  if (/^fc/.test(h) || /^fd/.test(h)) return false
  // Plain ".local" mDNS
  if (h.endsWith('.local')) return false
  return true
}

// True if `ip` (a canonical literal from Deno.resolveDns or a parsed host) sits
// in any range we refuse to connect to: RFC1918 private, loopback, link-local
// (incl. cloud metadata 169.254.169.254), unique-local IPv6, 0.0.0.0/8.
function isBlockedIp(ip: string): boolean {
  const s = ip.toLowerCase().trim()
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — validate the embedded v4.
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isBlockedIpv4(mapped[1])
  if (s.includes(':')) return isBlockedIpv6(s)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return isBlockedIpv4(s)
  // Not a recognizable canonical IP literal — refuse rather than guess.
  return true
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // malformed → block
  }
  const [a, b] = parts
  if (a === 0)   return true              // 0.0.0.0/8
  if (a === 10)  return true              // 10/8
  if (a === 127) return true              // loopback 127/8
  if (a === 169 && b === 254) return true // link-local 169.254/16 (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (s === '::1' || s === '::') return true       // loopback / unspecified
  if (s.startsWith('fe8') || s.startsWith('fe9') ||
      s.startsWith('fea') || s.startsWith('feb')) return true // fe80::/10 link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true   // fc00::/7 unique-local
  return false
}

// Resolve a hostname to its A/AAAA records and reject if any resolved address
// falls in a blocked range. Defeats DNS-rebinding and non-canonical IP literals
// that pass the cheap string check. Throws on resolution failure.
async function assertResolvedHostSafe(host: string): Promise<void> {
  const h = host.replace(/^\[|\]$/g, '')
  // Bare IP literal: validate directly, no DNS needed.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h.includes(':')) {
    if (isBlockedIp(h)) throw new Error('blocked_ip')
    return
  }
  const addrs: string[] = []
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      const recs = await Deno.resolveDns(h, kind)
      addrs.push(...recs)
    } catch (e) {
      // NotFound for one family is fine if the other resolves; rethrow only
      // when nothing resolved (handled after the loop).
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  if (addrs.length === 0) throw new Error('unresolvable')
  for (const ip of addrs) {
    if (isBlockedIp(ip)) throw new Error('blocked_ip')
  }
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    const take = Math.min(p.length, total - off)
    out.set(p.subarray(0, take), off)
    off += take
    if (off >= total) break
  }
  return out
}

function guessCharset(ct: string, head: Uint8Array): string {
  const m = ct.match(/charset=([^;]+)/i)
  if (m && m[1]) return m[1].trim().replace(/^"|"$/g, '')
  // Look inside the first 4 KB for meta charset
  const peek = new TextDecoder('utf-8').decode(head.subarray(0, Math.min(head.length, 4096)))
  const m2 = peek.match(/<meta[^>]+charset=["']?([\w-]+)/i)
  return (m2 && m2[1]) ? m2[1] : 'utf-8'
}

interface Preview {
  url: string
  canonical: string | null
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
  domain: string
}

function parsePreview(html: string, requestedUrl: string): Preview {
  // Cheap, regex-based meta-tag extraction. We only read <head>-ish content
  // so the document size is bounded and an HTML parser is overkill.
  const head = (html.match(/<head[\s\S]*?<\/head>/i)?.[0]) ?? html

  const og   = (k: string) => meta(head, `og:${k}`)
  const tw   = (k: string) => meta(head, `twitter:${k}`)
  const name = (k: string) => meta(head, k, 'name')

  const title = og('title')
    ?? tw('title')
    ?? extractTagText(head, 'title')

  const description = og('description')
    ?? tw('description')
    ?? name('description')

  const imageRaw = og('image')
    ?? og('image:secure_url')
    ?? og('image:url')
    ?? tw('image')
    ?? tw('image:src')

  const canonical = extractCanonical(head)
  const siteName  = og('site_name')

  const base = new URL(canonical ?? requestedUrl)
  const image = imageRaw ? resolveUrl(imageRaw, base) : null

  return {
    url: requestedUrl,
    canonical: canonical ? resolveUrl(canonical, base) : null,
    title:       decodeEntities(title)?.trim() || null,
    description: decodeEntities(description)?.trim().slice(0, 320) || null,
    image,
    site_name:   decodeEntities(siteName)?.trim() || null,
    domain:      base.hostname.replace(/^www\./, ''),
  }
}

function meta(head: string, key: string, attr: 'property' | 'name' = 'property'): string | null {
  // Allow either order of property/content attributes.
  const reA = new RegExp(
    `<meta[^>]+${attr}=["']${escape(key)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i',
  )
  const reB = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${escape(key)}["'][^>]*>`,
    'i',
  )
  const m = head.match(reA) ?? head.match(reB)
  return m ? m[1] ?? null : null
}
function extractTagText(head: string, tag: string): string | null {
  const m = head.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1] ?? null : null
}
function extractCanonical(head: string): string | null {
  const reA = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i
  const reB = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i
  const m = head.match(reA) ?? head.match(reB)
  return m ? m[1] ?? null : null
}
function escape(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function resolveUrl(href: string, base: URL): string {
  try { return new URL(href, base).href } catch { return href }
}
function decodeEntities(s: string | null | undefined): string | null {
  if (s == null) return null
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
}
